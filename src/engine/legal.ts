import type { GameState, Move, Color } from './types';
import { fileOf, rankOf, sq, offsetOf } from './board';
import { pseudoMoves, isAttacked } from './movegen';

function findKing(s: GameState, color: Color): number {
  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i];
    if (p && p.color === color && p.type === 'k') return i;
  }
  return -1;
}

export function inCheck(s: GameState, color: Color): boolean {
  const kingSq = findKing(s, color);
  if (kingSq === -1) return false;
  const enemy: Color = color === 'w' ? 'b' : 'w';
  return isAttacked(s, kingSq, enemy);
}

// Resolve corrosion-capture landing on `to`. Returns true if the mover was
// destroyed (and thus should not remain on the board).
function resolveCorrosionCapture(s: GameState, to: number, moverColor: Color, moverIsKing: boolean): boolean {
  let destroyedMover = false;
  const remaining = [];
  for (const unit of s.corrosions) {
    const idx = unit.cells.indexOf(to);
    if (idx === -1) {
      remaining.push(unit);
      continue;
    }
    const hostile = unit.cls === 3 || unit.color !== moverColor;
    if (!hostile) {
      // friendly non-class-3 corrosion: no effect
      remaining.push(unit);
      continue;
    }
    // destroy this cell from the unit
    if (!moverIsKing) destroyedMover = true;
    const cells = unit.cells.filter(c => c !== to);
    if (cells.length > 0) {
      remaining.push({ ...unit, cells });
    }
    // else: unit fully destroyed, drop it
  }
  s.corrosions = remaining;
  return destroyedMover;
}

export function applyMoveCore(s: GameState, m: Move): void {
  const size = s.size;
  const mover = s.board[m.from];
  if (!mover) return;
  const color = mover.color;
  const enemy: Color = color === 'w' ? 'b' : 'w';
  const off = offsetOf(size);
  const backRank = color === 'w' ? off : size - 1 - off;

  const isKing = mover.type === 'k';
  const isCastle = isKing && m.from === sq(4 + off, backRank, size) &&
    (m.to === sq(6 + off, backRank, size) || m.to === sq(2 + off, backRank, size));
  const isEnPassant = mover.type === 'p' && s.epSquare === m.to && !s.board[m.to] &&
    fileOf(m.from, size) !== fileOf(m.to, size);
  const isDoublePush = mover.type === 'p' && Math.abs(rankOf(m.to, size) - rankOf(m.from, size)) === 2;

  // capture removal (regular capture, if any) — do this before moving the piece
  // en passant capture: remove the pawn on the square behind `to`
  if (isEnPassant) {
    const dir = color === 'w' ? 1 : -1;
    const capturedSq = sq(fileOf(m.to, size), rankOf(m.to, size) - dir, size);
    s.board[capturedSq] = null;
  }

  const capturedPiece = s.board[m.to];

  // castling-rights updates: rook captured
  if (capturedPiece && capturedPiece.type === 'r') {
    updateCastlingRightsForRookSquare(s, m.to, capturedPiece.color);
  }

  // move the piece (promoting if applicable)
  s.board[m.from] = null;
  s.board[m.to] = { color, type: m.promotion ?? mover.type };

  // castling rook hop
  if (isCastle) {
    const kingSide = m.to === sq(6 + off, backRank, size);
    const rookFrom = kingSide ? sq(7 + off, backRank, size) : sq(off, backRank, size);
    const rookTo = kingSide ? sq(5 + off, backRank, size) : sq(3 + off, backRank, size);
    const rook = s.board[rookFrom];
    s.board[rookFrom] = null;
    s.board[rookTo] = rook;
  }

  // castling-rights updates: king move, rook move
  if (isKing) {
    if (color === 'w') { s.castling.wK = false; s.castling.wQ = false; }
    else { s.castling.bK = false; s.castling.bQ = false; }
  }
  if (mover.type === 'r') {
    updateCastlingRightsForRookSquare(s, m.from, color);
  }

  // corrosion-capture resolution on destination
  const destroyedMover = resolveCorrosionCapture(s, m.to, color, isKing);
  if (destroyedMover) {
    s.board[m.to] = null;
  }

  // king landing on purple cleanses it
  if (isKing) {
    const pIdx = s.purple.indexOf(m.to);
    if (pIdx !== -1) s.purple.splice(pIdx, 1);
  }

  // epSquare set on double-push, cleared otherwise
  if (isDoublePush) {
    const dir = color === 'w' ? 1 : -1;
    s.epSquare = sq(fileOf(m.from, size), rankOf(m.from, size) + dir, size);
  } else {
    s.epSquare = null;
  }

  s.turn = enemy;
}

function updateCastlingRightsForRookSquare(s: GameState, square: number, rookColor: Color): void {
  const size = s.size;
  const off = offsetOf(size);
  const backRank = rookColor === 'w' ? off : size - 1 - off;
  if (rankOf(square, size) !== backRank) return;
  const file = fileOf(square, size);
  if (file === off) {
    if (rookColor === 'w') s.castling.wQ = false; else s.castling.bQ = false;
  } else if (file === 7 + off) {
    if (rookColor === 'w') s.castling.wK = false; else s.castling.bK = false;
  }
}

export function legalMoves(s: GameState, from?: number): Move[] {
  const froms: number[] = [];
  if (from !== undefined) {
    froms.push(from);
  } else {
    for (let i = 0; i < s.board.length; i++) {
      if (s.board[i]?.color === s.turn) froms.push(i);
    }
  }

  const result: Move[] = [];
  for (const f of froms) {
    const piece = s.board[f];
    if (!piece || piece.color !== s.turn) continue;
    for (const m of pseudoMoves(s, f)) {
      const clone = structuredClone(s);
      applyMoveCore(clone, m);
      if (!inCheck(clone, piece.color)) {
        result.push(m);
      }
    }
  }
  return result;
}
