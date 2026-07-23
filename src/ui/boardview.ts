import type { GameState, Color } from '../engine/types';
import { createCgBoardView } from './cgboard';

export interface BoardView {
  mount(el: HTMLElement): void;
  // dests = legal targets per from-square for the side to move
  setState(gs: GameState, dests: Map<number, number[]>): void;
  onMove(cb: (from: number, to: number) => void): void;
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
