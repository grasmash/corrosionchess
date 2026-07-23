import type { GameState, Move, Piece, PieceType } from './types';
import { toAlg, fileOf, rankOf, FILES, offsetOf } from './board';
import { legalMoves, applyMoveCore, inCheck, isEnPassant } from './legal';

const PIECE_LETTERS: Record<PieceType, string> = { p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

function disambiguation(pre: GameState, m: Move, mover: Piece, size: number): string {
  const ambiguous: number[] = [];
  for (let i = 0; i < pre.board.length; i++) {
    if (i === m.from) continue;
    const p = pre.board[i];
    if (!p || p.color !== mover.color || p.type !== mover.type) continue;
    if (legalMoves(pre, i).some(other => other.to === m.to)) ambiguous.push(i);
  }
  if (ambiguous.length === 0) return '';

  const sameFile = ambiguous.some(i => fileOf(i, size) === fileOf(m.from, size));
  const sameRank = ambiguous.some(i => rankOf(i, size) === rankOf(m.from, size));
  if (!sameFile) return FILES[fileOf(m.from, size)];
  if (!sameRank) return String(rankOf(m.from, size) + 1);
  return FILES[fileOf(m.from, size)] + String(rankOf(m.from, size) + 1);
}

/** Must be called with the PRE-move state; calling it post-move silently
 * produces wrong captures/disambiguation. */
export function moveToSan(pre: GameState, m: Move): string {
  const size = pre.size;
  const mover = pre.board[m.from];
  if (!mover) return '';

  const off = offsetOf(size);
  const backRank = mover.color === 'w' ? off : size - 1 - off;
  const isKing = mover.type === 'k';
  const isCastle = isKing && rankOf(m.from, size) === backRank &&
    Math.abs(fileOf(m.to, size) - fileOf(m.from, size)) === 2;

  let san: string;
  if (isCastle) {
    san = fileOf(m.to, size) > fileOf(m.from, size) ? 'O-O' : 'O-O-O';
  } else {
    const destPiece = pre.board[m.to];
    const isCapture = (!!destPiece && destPiece.color !== mover.color) || isEnPassant(pre, m);

    if (mover.type === 'p') {
      san = isCapture
        ? `${FILES[fileOf(m.from, size)]}x${toAlg(m.to, size)}`
        : toAlg(m.to, size);
      if (m.promotion) san += `=${PIECE_LETTERS[m.promotion]}`;
    } else {
      const letter = PIECE_LETTERS[mover.type];
      const disambig = disambiguation(pre, m, mover, size);
      san = `${letter}${disambig}${isCapture ? 'x' : ''}${toAlg(m.to, size)}`;
    }
  }

  const clone = structuredClone(pre);
  applyMoveCore(clone, m);
  const opponent = mover.color === 'w' ? 'b' : 'w';
  if (inCheck(clone, opponent)) {
    san += legalMoves(clone).length > 0 ? '+' : '#';
  }

  return san;
}
