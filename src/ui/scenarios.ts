// Shared scenario-staging machinery, extracted from the DEV-only VFX Lab
// (src/ui/vfxlab.ts) so the user-facing rules explainer (src/ui/rules.ts)
// can reuse the exact same "real engine, real board, real animation"
// staging without duplicating it. Both consumers mount their own board via
// `createScenarioPlayer` and pick scenarios from `SCENARIOS` by `id`.

import { createBoardView } from './boardview';
import type { CgBoardView } from './cgboard';
import { renderOverlays } from './overlays';
import { newGame, applyMove } from '../engine/game';
import { corrosionPhase } from '../engine/corrosion';
import { fromAlg } from '../engine/board';
import type { Config, CorrosionUnit, GameState } from '../engine/types';

export const SCENARIO_BOARD_SIZE = 8;
const SCENARIO_CONFIG: Config = { tier1: true, tier2: true, tier3: true, bigBoard: false };

function sq(alg: string): number {
  return fromAlg(alg, SCENARIO_BOARD_SIZE);
}

/** A fresh, otherwise-empty board (both kings placed in far corners, out of
 * every scenario's way, so engine helpers that assume a king exists --
 * findKing/inCheck/computeResult -- always have one) at round 2, so a unit
 * staged with `bornRound: 1` is already a "mover" the instant a scenario's
 * `play()` runs a phase, with no throwaway warm-up phase needed first. */
function emptyBoardState(): GameState {
  const s = newGame(SCENARIO_CONFIG);
  s.board = s.board.map(() => null);
  s.board[sq('a1')] = { color: 'w', type: 'k' };
  s.board[sq('h8')] = { color: 'b', type: 'k' };
  s.corrosions = [];
  s.purple = [];
  s.log = [];
  s.round = 2;
  s.turn = 'w';
  return s;
}

function oneRoundPhase(staged: GameState): GameState {
  const next = structuredClone(staged);
  corrosionPhase(next);
  next.round++;
  return next;
}

function unit(u: Omit<CorrosionUnit, 'id'> & { id: number }): CorrosionUnit {
  return u;
}

export interface Scenario {
  /** Stable identifier so callers (rules.ts's sections) can look up a
   * specific scenario without depending on array order. */
  id: string;
  label: string;
  /** Builds the staged pre-state, shown first with no entry animations
   * (prev=null) so the viewer can see the "before" clearly. */
  stage: () => GameState;
  /** Applies the real transition (a real Move via applyMove, or a direct
   * corrosionPhase call -- exactly what production code does internally in
   * either case) to the staged state, returning the "after" state. Rendered
   * against the staged state as `prev`, triggering the actual animation
   * pipeline the same way a real game would. */
  play: (staged: GameState) => GameState;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'spawn',
    label: 'Corrosion spawns',
    // White rook captures a black pawn -- isolated to just the spawn (only
    // BLACK's move triggers a corrosion phase, so a white capture alone
    // can't also trigger a march in the same click).
    stage: () => {
      const s = emptyBoardState();
      s.board[sq('a4')] = { color: 'w', type: 'r' };
      s.board[sq('a5')] = { color: 'b', type: 'p' };
      return s;
    },
    play: staged => applyMove(staged, { from: sq('a4'), to: sq('a5') }),
  },
  {
    id: 'march',
    label: 'March',
    stage: () => {
      const s = emptyBoardState();
      s.corrosions = [unit({ id: 901, color: 'w', cls: 1, cells: [sq('d4')], dir: 1, bornRound: 1 })];
      return s;
    },
    play: oneRoundPhase,
  },
  {
    id: 'piece-kill',
    label: 'Piece killed by corrosion',
    // White cls-2's LEAD cell (d4) marches onto d5 -- an enemy pawn waiting
    // there gets struck. Deliberately cls-2 (lead + trail), not cls-1: per
    // corrosion.ts's strikeAt, the STRIKING CELL is destroyed along with the
    // piece it kills (a real "mutual kamikaze" mechanic, not a bug -- found
    // while building this scenario, see the exec report) -- for a cls-1 unit
    // that means the WHOLE unit dies in the same instant, muddying an
    // isolated demo of the kill choreography with a second, simultaneous
    // death animation. Cls-2's surviving trail cell (d3->d4) keeps the unit
    // on the board so the kill choreography reads on its own. This is the
    // exact scenario the "reads as a plain disappear" complaint was about --
    // see the exec report for the full diagnostic.
    stage: () => {
      const s = emptyBoardState();
      s.board[sq('d5')] = { color: 'b', type: 'p' };
      s.corrosions = [unit({ id: 902, color: 'w', cls: 2, cells: [sq('d4'), sq('d3')], dir: 1, bornRound: 1 })];
      return s;
    },
    play: oneRoundPhase,
  },
  {
    id: 'friendly-pass',
    label: 'Passes through your own pieces',
    // corrosion.ts's strikeAt: cls 1/2 landing on a FRIENDLY piece does
    // nothing (co-occupies) -- only an enemy piece or a cls-3 unit destroys
    // what it lands on. White cls-1 marches from d4 onto d5, where a white
    // pawn is waiting; after the phase both occupy d5 unharmed.
    stage: () => {
      const s = emptyBoardState();
      s.board[sq('d5')] = { color: 'w', type: 'p' };
      s.corrosions = [unit({ id: 908, color: 'w', cls: 1, cells: [sq('d4')], dir: 1, bornRound: 1 })];
      return s;
    },
    play: oneRoundPhase,
  },
  {
    id: 'annihilation',
    label: 'Annihilation',
    // White cls-1 at d3 (marching up) and black cls-1 at d5 (marching down)
    // both land on d4 this phase -- same-square annihilation destroys both
    // (corrosion.ts step 5).
    stage: () => {
      const s = emptyBoardState();
      s.corrosions = [
        unit({ id: 903, color: 'w', cls: 1, cells: [sq('d3')], dir: 1, bornRound: 1 }),
        unit({ id: 904, color: 'b', cls: 1, cells: [sq('d5')], dir: -1, bornRound: 1 }),
      ];
      return s;
    },
    play: oneRoundPhase,
  },
  {
    id: 'split',
    label: 'Class 1→2 split',
    // A cls-1 cell already sitting on the enemy edge rank (d8, white's
    // enemy edge) promotes to cls-2 on its next moving phase, gaining a
    // second (trail) cell -- corrosion.ts step 8.
    stage: () => {
      const s = emptyBoardState();
      s.corrosions = [unit({ id: 905, color: 'w', cls: 1, cells: [sq('d8')], dir: 1, bornRound: 1 })];
      return s;
    },
    play: oneRoundPhase,
  },
  {
    id: 'purple-trail',
    label: 'Class 2→3 + purple trail',
    // A cls-2 unit whose lead cell (d1, white's own edge) has already
    // arrived promotes to cls-3 and bounces (dir flips) on the first phase;
    // NOW being cls-3, the SECOND phase paints purple under its
    // pre-move position (corrosion.ts step 2) before it marches off again --
    // two phases in one click show both the promotion/bounce and the
    // resulting void trail.
    stage: () => {
      const s = emptyBoardState();
      s.corrosions = [unit({ id: 906, color: 'w', cls: 2, cells: [sq('d1'), sq('d2')], dir: -1, bornRound: 1 })];
      return s;
    },
    play: staged => oneRoundPhase(oneRoundPhase(staged)),
  },
  {
    id: 'piece-captures-corrosion',
    label: 'Piece captures corrosion',
    // A rook moving onto enemy (hostile) corrosion is destroyed along with
    // it -- mutual destruction, corrosion.ts's resolveCorrosionCapture via
    // legal.ts's applyMoveCore.
    stage: () => {
      const s = emptyBoardState();
      s.board[sq('a1')] = null;
      s.board[sq('b1')] = { color: 'w', type: 'k' };
      s.board[sq('a1')] = { color: 'w', type: 'r' };
      s.corrosions = [unit({ id: 907, color: 'b', cls: 1, cells: [sq('a4')], dir: -1, bornRound: 1 })];
      return s;
    },
    play: staged => applyMove(staged, { from: sq('a1'), to: sq('a4') }),
  },
  {
    id: 'king-cleanse',
    label: 'King cleanses purple',
    stage: () => {
      const s = emptyBoardState();
      s.board[sq('a1')] = null;
      s.board[sq('e1')] = { color: 'w', type: 'k' };
      s.purple = [sq('e2')];
      return s;
    },
    play: staged => applyMove(staged, { from: sq('e1'), to: sq('e2') }),
  },
];

export function findScenario(id: string): Scenario {
  const found = SCENARIOS.find(s => s.id === id);
  if (!found) throw new Error(`findScenario: unknown scenario id "${id}"`);
  return found;
}

export interface ScenarioPlayer {
  /** The board's mount element -- append this to the caller's own layout
   * (a `board-wrap`-classed div; caller adds any extra sizing class). */
  boardEl: HTMLDivElement;
  /** Stages `scenario`, renders the "before" immediately, then plays the
   * real transition after a short pause so the viewer can register the
   * starting position first. */
  run: (scenario: Scenario) => void;
  /** Scopes `--vfx-speed` to this player's board only (custom properties
   * inherit down through the DOM, never up to a live game elsewhere) --
   * `on` maps to 4x duration = 0.25x playback speed, matching the VFX Lab's
   * existing "Slow motion" toggle. */
  setSlowMo: (on: boolean) => void;
}

/**
 * Mounts a real board (createBoardView + renderOverlays, no mocks) and
 * returns a controller to stage/play scenarios against it. `onStatusChange`,
 * if given, is called with a short status string before staging and again
 * once the transition plays -- callers render it however fits their UI (or
 * omit it entirely).
 */
export function createScenarioPlayer(onStatusChange?: (text: string) => void): ScenarioPlayer {
  const boardEl = document.createElement('div');
  boardEl.className = 'board-wrap';

  const view = createBoardView(SCENARIO_BOARD_SIZE);
  view.mount(boardEl);

  function render(state: GameState, prev: GameState | null): void {
    view.setState(state, new Map());
    renderOverlays(boardEl, view, state, prev);
  }

  function run(scenario: Scenario): void {
    onStatusChange?.(`${scenario.label} — staged.`);
    const staged = scenario.stage();
    render(staged, null);
    window.setTimeout(() => {
      const after = scenario.play(staged);
      render(after, staged);
      onStatusChange?.(`${scenario.label} — playing.`);
    }, 500);
  }

  function setSlowMo(on: boolean): void {
    boardEl.style.setProperty('--vfx-speed', on ? '4' : '1');
  }

  // Manual-verification hook only (matches the pattern in main.ts's own
  // mount functions and the VFX Lab) -- not part of BoardView's contract.
  (window as unknown as { __cg: ReturnType<CgBoardView['api']> }).__cg = (view as unknown as CgBoardView).api();

  return { boardEl, run, setSlowMo };
}
