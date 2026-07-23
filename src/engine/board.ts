import type { Color, PieceType, GameState, Config, Piece } from './types';

export const FILES = 'abcdefghijkl';

export function fileOf(s: number, size: number): number {
  return s % size;
}

export function rankOf(s: number, size: number): number {
  return Math.floor(s / size);
}

export function sq(file: number, rank: number, size: number): number {
  return rank * size + file;
}

export function inBounds(file: number, rank: number, size: number): boolean {
  return file >= 0 && file < size && rank >= 0 && rank < size;
}

export function toAlg(s: number, size: number): string {
  const file = fileOf(s, size);
  const rank = rankOf(s, size);
  return FILES[file] + (rank + 1);
}

export function fromAlg(a: string, size: number): number {
  const file = FILES.indexOf(a[0]);
  const rank = parseInt(a.slice(1), 10) - 1;
  return sq(file, rank, size);
}

export function offsetOf(size: number): number {
  return (size - 8) / 2;
}

export function pawnStartRank(color: Color, size: number): number {
  const off = offsetOf(size);
  return color === 'w' ? off + 1 : size - 2 - off;
}

export function promotionRank(color: Color, size: number): number {
  return color === 'w' ? size - 1 : 0;
}

export function enemyEdgeRank(color: Color, size: number): number {
  return promotionRank(color, size);
}

export function ownerEdgeRank(color: Color, size: number): number {
  return color === 'w' ? 0 : size - 1;
}

export function forwardDir(color: Color): 1 | -1 {
  return color === 'w' ? 1 : -1;
}

export function initialState(config: Config): GameState {
  const size = config.bigBoard ? 12 : 8;
  const board: (Piece | null)[] = Array(size * size).fill(null);
  const off = offsetOf(size);

  // Standard back rank order: r n b q k b n r
  const backRankPieces: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

  // Place white pieces
  const wBackRank = off;
  const wPawnRank = off + 1;

  for (let file = 0; file < 8; file++) {
    // White pawns
    board[sq(off + file, wPawnRank, size)] = { color: 'w', type: 'p' };
    // White back rank
    board[sq(off + file, wBackRank, size)] = { color: 'w', type: backRankPieces[file] };
  }

  // Place black pieces
  const bPawnRank = size - 2 - off;
  const bBackRank = size - 1 - off;

  for (let file = 0; file < 8; file++) {
    // Black pawns
    board[sq(off + file, bPawnRank, size)] = { color: 'b', type: 'p' };
    // Black back rank
    board[sq(off + file, bBackRank, size)] = { color: 'b', type: backRankPieces[file] };
  }

  return {
    size,
    board,
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    epSquare: null,
    corrosions: [],
    purple: [],
    round: 1,
    nextId: 1,
    config,
    result: null,
    log: [],
    halfmoveClock: 0,
    positionCounts: {},
  };
}
