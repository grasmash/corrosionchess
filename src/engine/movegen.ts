import type { GameState, Move, Color, PieceType, Piece } from './types';
import { fileOf, rankOf, sq, inBounds, pawnStartRank, promotionRank, forwardDir, offsetOf } from './board';

const N = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const B = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const R = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const K = [...B, ...R];
const isPurple = (s: GameState, x: number) => s.purple.includes(x);

function ray(s: GameState, from: number, df: number, dr: number, out: number[]) {
  const size = s.size;
  let f = fileOf(from, size) + df, r = rankOf(from, size) + dr;
  while (inBounds(f, r, size)) {
    const t = sq(f, r, size);
    if (isPurple(s, t)) break;
    if (s.board[t]) { out.push(t); break; }
    out.push(t);
    f += df; r += dr;
  }
}

export function attackSquares(s: GameState, from: number): number[] {
  const piece = s.board[from];
  if (!piece) return [];
  const size = s.size;
  const f0 = fileOf(from, size);
  const r0 = rankOf(from, size);
  const out: number[] = [];

  switch (piece.type) {
    case 'n':
      for (const [df, dr] of N) {
        const f = f0 + df, r = r0 + dr;
        if (inBounds(f, r, size)) out.push(sq(f, r, size));
      }
      break;
    case 'k':
      for (const [df, dr] of K) {
        const f = f0 + df, r = r0 + dr;
        if (inBounds(f, r, size)) out.push(sq(f, r, size));
      }
      break;
    case 'b':
      for (const [df, dr] of B) ray(s, from, df, dr, out);
      break;
    case 'r':
      for (const [df, dr] of R) ray(s, from, df, dr, out);
      break;
    case 'q':
      for (const [df, dr] of K) ray(s, from, df, dr, out);
      break;
    case 'p': {
      const dir = forwardDir(piece.color);
      for (const df of [-1, 1]) {
        const f = f0 + df, r = r0 + dir;
        if (inBounds(f, r, size)) out.push(sq(f, r, size));
      }
      break;
    }
  }
  return out;
}

export function isAttacked(s: GameState, target: number, by: Color): boolean {
  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i];
    if (!p || p.color !== by) continue;
    if (attackSquares(s, i).includes(target)) return true;
  }
  return false;
}

function addPawnMove(moves: Move[], from: number, to: number, size: number, color: Color) {
  if (rankOf(to, size) === promotionRank(color, size)) {
    for (const promotion of ['q', 'r', 'b', 'n'] as PieceType[]) {
      moves.push({ from, to, promotion });
    }
  } else {
    moves.push({ from, to });
  }
}

function pawnMoves(s: GameState, from: number, color: Color): Move[] {
  const size = s.size;
  const f0 = fileOf(from, size);
  const r0 = rankOf(from, size);
  const dir = forwardDir(color);
  const moves: Move[] = [];

  const r1 = r0 + dir;
  if (inBounds(f0, r1, size)) {
    const t1 = sq(f0, r1, size);
    if (!s.board[t1] && !isPurple(s, t1)) {
      addPawnMove(moves, from, t1, size, color);
      if (r0 === pawnStartRank(color, size)) {
        const r2 = r0 + 2 * dir;
        if (inBounds(f0, r2, size)) {
          const t2 = sq(f0, r2, size);
          if (!s.board[t2] && !isPurple(s, t2)) {
            addPawnMove(moves, from, t2, size, color);
          }
        }
      }
    }

    for (const df of [-1, 1]) {
      const f = f0 + df;
      if (!inBounds(f, r1, size)) continue;
      const t = sq(f, r1, size);
      if (isPurple(s, t)) continue;
      const target = s.board[t];
      if (target && target.color !== color) {
        addPawnMove(moves, from, t, size, color);
      } else if (s.epSquare === t) {
        addPawnMove(moves, from, t, size, color);
      }
    }
  }

  return moves;
}

function stepOrSliderMoves(s: GameState, from: number, piece: Piece): Move[] {
  const moves: Move[] = [];
  for (const t of attackSquares(s, from)) {
    const occ = s.board[t];
    if (occ && occ.color === piece.color) continue;
    if (piece.type !== 'k' && isPurple(s, t)) continue;
    moves.push({ from, to: t });
  }
  return moves;
}

function castlingMoves(s: GameState, from: number, piece: Piece): Move[] {
  if (piece.type !== 'k') return [];
  const size = s.size;
  const off = offsetOf(size);
  const backRank = piece.color === 'w' ? off : size - 1 - off;
  const kingStart = sq(4 + off, backRank, size);
  if (from !== kingStart) return [];

  const enemy: Color = piece.color === 'w' ? 'b' : 'w';
  const kSideRight = piece.color === 'w' ? s.castling.wK : s.castling.bK;
  const qSideRight = piece.color === 'w' ? s.castling.wQ : s.castling.bQ;
  const moves: Move[] = [];

  if (kSideRight) {
    const rookSq = sq(7 + off, backRank, size);
    const rook = s.board[rookSq];
    if (rook && rook.type === 'r' && rook.color === piece.color) {
      const f1 = sq(5 + off, backRank, size);
      const f2 = sq(6 + off, backRank, size);
      if (
        !s.board[f1] && !s.board[f2] &&
        !isPurple(s, f1) && !isPurple(s, f2) &&
        !isAttacked(s, kingStart, enemy) &&
        !isAttacked(s, f1, enemy) &&
        !isAttacked(s, f2, enemy)
      ) {
        moves.push({ from: kingStart, to: f2 });
      }
    }
  }

  if (qSideRight) {
    const rookSq = sq(off, backRank, size);
    const rook = s.board[rookSq];
    if (rook && rook.type === 'r' && rook.color === piece.color) {
      const d1 = sq(3 + off, backRank, size);
      const d2 = sq(2 + off, backRank, size);
      const d3 = sq(1 + off, backRank, size);
      if (
        !s.board[d1] && !s.board[d2] && !s.board[d3] &&
        !isPurple(s, d1) && !isPurple(s, d2) && !isPurple(s, d3) &&
        !isAttacked(s, kingStart, enemy) &&
        !isAttacked(s, d1, enemy) &&
        !isAttacked(s, d2, enemy)
      ) {
        moves.push({ from: kingStart, to: d2 });
      }
    }
  }

  return moves;
}

export function pseudoMoves(s: GameState, from: number): Move[] {
  const piece = s.board[from];
  if (!piece) return [];

  if (piece.type === 'p') {
    return pawnMoves(s, from, piece.color);
  }

  const moves = stepOrSliderMoves(s, from, piece);
  if (piece.type === 'k') {
    moves.push(...castlingMoves(s, from, piece));
  }
  return moves;
}
