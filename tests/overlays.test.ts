// @vitest-environment jsdom
//
// DOM-logic regression coverage for the corrosion overlay renderer
// (src/ui/overlays.ts). Drives `renderOverlays` directly against a stub
// `BoardView` (no chessgroundx, no real board) through the exact render
// sequences a real hotseat game produces -- initial render, a capturing
// move that spawns a fresh unit, a march step, a real corrosion kill, and a
// selection change -- and asserts on the resulting DOM. This is the
// regression suite requested after a "corrosion invisible in real games"
// report: exhaustive headless/real-input testing never reproduced units
// failing to render, but it uncovered a real, adjacent defect in the
// piece-destroy detection heuristic (see the "does not treat a capturing
// move's own origin square as a kill" test below), which this suite pins
// down so it can't silently regress again.
import { describe, it, expect, beforeEach } from 'vitest';
import { renderOverlays } from '../src/ui/overlays';
import type { BoardView } from '../src/ui/boardview';
import { newGame } from '../src/engine/game';
import { fromAlg } from '../src/engine/board';
import type { GameState, CorrosionUnit, Color } from '../src/engine/types';

const SIZE = 8;
const SQUARE_W = 80;
const BOARD_LEFT = 100;
const BOARD_TOP = 50;

function stubView(orientation: Color = 'w'): BoardView {
  const boardRect = {
    left: BOARD_LEFT,
    top: BOARD_TOP,
    width: SQUARE_W * SIZE,
    height: SQUARE_W * SIZE,
  } as DOMRect;
  function squarePx(sqIdx: number) {
    const file = sqIdx % SIZE;
    const rank = Math.floor(sqIdx / SIZE);
    const colFromLeft = orientation === 'w' ? file : SIZE - 1 - file;
    const rowFromTop = orientation === 'w' ? SIZE - 1 - rank : rank;
    return { x: boardRect.left + colFromLeft * SQUARE_W, y: boardRect.top + rowFromTop * SQUARE_W, w: SQUARE_W };
  }
  return {
    mount() {},
    setState() {},
    onMove() {},
    onSelect() {},
    setOrientation() {},
    squareEl: () => ({ boardPx: () => boardRect, squarePx }),
  };
}

const cfg = { tier1: true, tier2: true, tier3: true, bigBoard: false };

function emptyState(): GameState {
  const s = newGame(cfg);
  s.board = s.board.map(() => null);
  return s;
}

function unit(o: Partial<CorrosionUnit>): CorrosionUnit {
  return { id: 1, color: 'w', cls: 1, cells: [], dir: 1, bornRound: 0, ...o };
}

let container: HTMLDivElement;
let view: BoardView;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  view = stubView();

  // jsdom doesn't implement matchMedia -- overlays.ts's prefersReducedMotion()
  // and the VFX-speed reads call into window.matchMedia/getComputedStyle,
  // neither of which jsdom provides a real implementation for. Stubbed to
  // always report "no preference" (animations on), matching a default
  // browser -- the reduced-motion-specific CSS behavior itself lives in
  // style.css and isn't exercised by this DOM-logic-only suite.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

describe('renderOverlays: unit spawn/march', () => {
  it('renders a unit div for a corrosion cell on the first render', () => {
    const gs = emptyState();
    gs.corrosions = [unit({ cells: [fromAlg('d4', SIZE)] })];
    renderOverlays(container, view, gs, null, null);

    const units = container.querySelectorAll('.corrosion-units-layer > .corrosion-unit');
    expect(units.length).toBe(1);
    // First render never plays a spawn animation -- there's no "before" to
    // animate in from.
    expect(units[0].classList.contains('is-spawning')).toBe(false);
  });

  it('marks a unit that appears for the first time on a LATER render as spawning', () => {
    const gs0 = emptyState();
    renderOverlays(container, view, gs0, null, null);

    const gs1 = emptyState();
    gs1.corrosions = [unit({ cells: [fromAlg('d4', SIZE)] })];
    renderOverlays(container, view, gs1, gs0, null);

    const units = container.querySelectorAll('.corrosion-units-layer > .corrosion-unit');
    expect(units.length).toBe(1);
    expect(units[0].classList.contains('is-spawning')).toBe(true);
  });

  it('moves an existing unit div to its new square and marks it marching', () => {
    const gs0 = emptyState();
    gs0.corrosions = [unit({ cells: [fromAlg('d4', SIZE)], dir: 1 })];
    renderOverlays(container, view, gs0, null, null);

    const gs1 = emptyState();
    gs1.corrosions = [unit({ cells: [fromAlg('d5', SIZE)], dir: 1 })];
    renderOverlays(container, view, gs1, gs0, null);

    const units = container.querySelectorAll('.corrosion-units-layer > .corrosion-unit');
    expect(units.length).toBe(1);
    expect(units[0].classList.contains('is-marching')).toBe(true);

    // d5 is one rank "up" (toward White's forward direction) from d4 -- in
    // white-orientation screen space that's a smaller `rowFromTop`, i.e. a
    // smaller y translate than d4's.
    const d4Pos = view.squareEl().squarePx(fromAlg('d4', SIZE));
    const d5Pos = view.squareEl().squarePx(fromAlg('d5', SIZE));
    expect(d5Pos.y).toBeLessThan(d4Pos.y);
    const style = (units[0] as HTMLElement).style.translate;
    expect(style).toBe(`${d5Pos.x - BOARD_LEFT}px ${d5Pos.y - BOARD_TOP}px`);
  });
});

describe('renderOverlays: piece-destroy (kill) detection', () => {
  it('plays the kill ghost when a PRE-EXISTING corrosion cell destroys a piece', () => {
    const gs0 = emptyState();
    gs0.board[fromAlg('d5', SIZE)] = { color: 'b', type: 'p' };
    gs0.corrosions = [unit({ id: 5, color: 'w', cells: [fromAlg('d4', SIZE)], dir: 1 })];

    const gs1 = emptyState();
    // The pawn is gone; the corrosion cell that was already on the board
    // struck it while marching (it's removed from the unit the same
    // instant it strikes, per corrosion.ts's strikeAt -- see the "kill
    // choreography" doc comments in overlays.ts).
    gs1.corrosions = [];

    renderOverlays(container, view, gs1, gs0, null);

    const ghosts = container.querySelectorAll('.corrosion-piece-ghost');
    expect(ghosts.length).toBe(1);
  });

  it('does NOT treat a capturing move\'s own origin square as a kill (regression)', () => {
    // Mirrors engine/game.ts's applyMove exactly: on any capturing move, a
    // brand-new tier-1 unit spawns at the MOVER's own origin square in the
    // very same state transition that vacates it (the piece is alive and
    // well at its destination). Before the fix, the piece-destroy loop's
    // naive "had a piece, now doesn't, square touched by corrosion" check
    // couldn't tell that apart from a real kill, and played a false
    // "piece destroyed by corrosion" ghost/dissolve on the mover's own
    // origin square on EVERY SINGLE capturing move in real play.
    const gs0 = emptyState();
    gs0.board[fromAlg('e4', SIZE)] = { color: 'w', type: 'p' };
    gs0.board[fromAlg('d5', SIZE)] = { color: 'b', type: 'p' };
    gs0.corrosions = [];

    const gs1 = emptyState();
    gs1.board[fromAlg('d5', SIZE)] = { color: 'w', type: 'p' }; // pawn captured onto d5, very much alive
    gs1.corrosions = [unit({ id: 7, color: 'w', cells: [fromAlg('e4', SIZE)], dir: 1 })]; // fresh spawn at its old origin

    renderOverlays(container, view, gs1, gs0, null);

    const ghosts = container.querySelectorAll('.corrosion-piece-ghost');
    expect(ghosts.length).toBe(0);

    // The corrosion unit itself must still render normally at e4.
    const units = container.querySelectorAll('.corrosion-units-layer > .corrosion-unit');
    expect(units.length).toBe(1);
  });

  it('still detects a real kill on a square that ALSO gets a fresh spawn elsewhere the same render', () => {
    // Guards against an overly broad fix: suppressing the mover's-origin
    // false positive must not accidentally suppress an UNRELATED, real kill
    // happening elsewhere in the very same render.
    const gs0 = emptyState();
    gs0.board[fromAlg('e4', SIZE)] = { color: 'w', type: 'p' };
    gs0.board[fromAlg('d5', SIZE)] = { color: 'b', type: 'p' };
    gs0.board[fromAlg('h6', SIZE)] = { color: 'b', type: 'p' }; // about to be struck by a pre-existing cell
    gs0.corrosions = [unit({ id: 9, color: 'w', cells: [fromAlg('h5', SIZE)], dir: 1 })];

    const gs1 = emptyState();
    gs1.board[fromAlg('d5', SIZE)] = { color: 'w', type: 'p' };
    // h5's cell struck-and-died destroying the h6 pawn (removed from its unit,
    // per strikeAt); a brand-new unit also spawns at e4 from the capture.
    gs1.corrosions = [unit({ id: 7, color: 'w', cells: [fromAlg('e4', SIZE)], dir: 1 })];

    renderOverlays(container, view, gs1, gs0, null);

    const ghosts = container.querySelectorAll('.corrosion-piece-ghost');
    expect(ghosts.length).toBe(1); // only the real h6 kill, not e4
  });
});

describe('renderOverlays: danger/safe-capture ring', () => {
  it('flags a hostile-corrosion destination for a selected non-king piece', () => {
    const gs = emptyState();
    gs.board[fromAlg('f3', SIZE)] = { color: 'w', type: 'n' };
    gs.corrosions = [unit({ id: 3, color: 'b', cls: 2, cells: [fromAlg('d4', SIZE)], dir: -1 })];

    renderOverlays(container, view, gs, null, { sq: fromAlg('f3', SIZE), dests: [fromAlg('d4', SIZE), fromAlg('g5', SIZE)] });

    const markers = container.querySelectorAll('.corrosion-danger-marker');
    expect(markers.length).toBe(1);
    expect(markers[0].classList.contains('corrosion-danger-marker--hostile')).toBe(true);
  });

  it('flags a hostile-corrosion destination as SAFE for a selected king', () => {
    const gs = emptyState();
    gs.board[fromAlg('e2', SIZE)] = { color: 'w', type: 'k' };
    gs.corrosions = [unit({ id: 4, color: 'w', cls: 3, cells: [fromAlg('f3', SIZE)], dir: 1 })];

    renderOverlays(container, view, gs, null, { sq: fromAlg('e2', SIZE), dests: [fromAlg('f3', SIZE)] });

    const markers = container.querySelectorAll('.corrosion-danger-marker');
    expect(markers.length).toBe(1);
    expect(markers[0].classList.contains('corrosion-danger-marker--safe')).toBe(true);
  });

  it('renders no danger markers when nothing is selected', () => {
    const gs = emptyState();
    gs.corrosions = [unit({ cells: [fromAlg('d4', SIZE)] })];
    renderOverlays(container, view, gs, null, null);
    expect(container.querySelectorAll('.corrosion-danger-marker').length).toBe(0);
  });
});
