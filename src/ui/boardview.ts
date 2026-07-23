import type { GameState, Color } from '../engine/types';
import { createCgBoardView } from './cgboard';

export interface BoardView {
  mount(el: HTMLElement): void;
  // dests = legal targets per from-square for the side to move
  setState(gs: GameState, dests: Map<number, number[]>): void;
  onMove(cb: (from: number, to: number) => void): void;
  // Fires on every square click/selection attempt (chessground's own
  // `events.select`, deferred a microtask so the click has fully resolved --
  // select, deselect, or completed move -- by the time this reads back the
  // settled selection), with the CURRENTLY selected square, or null once
  // nothing is selected (deselected, or a move just completed). Used to
  // drive the corrosion danger-ring affordance in overlays.ts, which needs
  // to know what's selected to know which legal destinations to flag.
  onSelect(cb: (sq: number | null) => void): void;
  setOrientation(c: Color): void;
  // geometry hook the overlay layer (Task 10) uses to position corrosion markers
  squareEl(): { boardPx: () => DOMRect; squarePx: (sq: number) => { x: number; y: number; w: number } };
}

/**
 * Picks the board renderer. chessgroundx (cgboard.ts) handles both 8x8 and
 * 12x12 boards fine once its `dimensions` config and the key-naming scheme
 * for ranks beyond 9 are accounted for (see cgboard.ts). No fallback
 * (customboard.ts) was needed for this spike.
 */
export function createBoardView(size: number): BoardView {
  return createCgBoardView(size);
}
