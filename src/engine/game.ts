import type { Color, Config, GameState, Move } from './types';
import { initialState, forwardDir, toAlg } from './board';
import { applyMoveCore, inCheck, isEnPassant, legalMoves } from './legal';
import { corrosionPhase } from './corrosion';
import { moveToSan } from './notation';

export function other(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

export function newGame(config: Config): GameState {
  const s = initialState(config);
  // Seed the repetition table with the starting position: the initial
  // position itself counts as the first occurrence (a knight shuffle
  // returning to it twice is a threefold draw, per standard chess).
  s.positionCounts[positionKey(s)] = 1;
  return s;
}

/**
 * Canonical key for threefold-repetition detection. Two states are "the
 * same position" iff every element that affects future play matches: board,
 * side to move, castling rights, en-passant square -- plus, unique to this
 * variant, the full corrosion picture (each unit's color/class/direction/
 * cells and whether it will move next phase, i.e. bornRound < round) and
 * the purple squares. Units and cells are sorted so key equality doesn't
 * depend on array order (units can be created/destroyed in any order).
 * Because corrosion marches every round, positions with live units almost
 * never repeat -- exactly right: those games ARE progressing.
 */
function positionKey(s: GameState): string {
  const board = s.board.map(p => (p ? p.color + p.type : '-')).join('');
  const units = s.corrosions
    .map(u => `${u.color}${u.cls}${u.dir}${u.bornRound < s.round ? 'm' : 'f'}:${[...u.cells].sort((a, b) => a - b).join(',')}`)
    .sort()
    .join('|');
  const purple = [...s.purple].sort((a, b) => a - b).join(',');
  const c = s.castling;
  return `${board} ${s.turn} ${+c.wK}${+c.wQ}${+c.bK}${+c.bQ} ${s.epSquare ?? '-'} ${units} ${purple}`;
}

function countPieces(board: GameState['board']): number {
  let n = 0;
  for (const p of board) if (p) n++;
  return n;
}

/** Dead position: only the two kings remain. Corrosion can never harm a
 * king (strikes are blocked — see strikeAt in corrosion.ts) and with no
 * other pieces no capture can ever spawn new corrosion, so no sequence of
 * moves leads to mate regardless of any units or purple still on the
 * board. Richer insufficient-material cases (K+B vs K etc.) are deliberately
 * NOT claimed here: corrosion changes what "insufficient" means and the
 * bare-kings case is the only one that's unambiguous in this variant. */
function onlyKingsRemain(s: GameState): boolean {
  return s.board.every(p => !p || p.type === 'k');
}

function computeResult(s: GameState): void {
  if (onlyKingsRemain(s)) {
    s.result = { winner: null, reason: 'insufficient material' };
    return;
  }
  if (legalMoves(s).length > 0) return;
  if (inCheck(s, s.turn)) {
    s.result = { winner: other(s.turn), reason: 'checkmate' };
  } else {
    s.result = { winner: null, reason: 'stalemate' };
  }
}

export function applyMove(prev: GameState, m: Move): GameState {
  if (prev.result) throw new Error('Game is already over');
  const legal = legalMoves(prev, m.from);
  const isLegal = legal.some(lm => lm.from === m.from && lm.to === m.to && lm.promotion === m.promotion);
  if (!isLegal) throw new Error('Illegal move');

  const s = structuredClone(prev);
  const size = s.size;

  const moverColor = s.turn;

  const destPiece = s.board[m.to];
  const wasPieceCapture = (!!destPiece && destPiece.color !== moverColor) || isEnPassant(s, m);
  const san = moveToSan(prev, m);
  const moveRound = prev.round;

  s.log.push({
    round: moveRound,
    text: moverColor === 'w' ? `${moveRound}. ${san}` : `${moveRound}… ${san}`,
  });

  applyMoveCore(s, m);

  if (wasPieceCapture && s.config.tier1) {
    s.corrosions.push({
      id: s.nextId++,
      color: moverColor,
      cls: 1,
      cells: [m.from],
      dir: forwardDir(moverColor),
      bornRound: s.round,
    });
    s.log.push({ round: s.round, text: `Corrosion spawns at ${toAlg(m.from, size)}` });
  }

  if (moverColor === 'b') {
    corrosionPhase(s);
    s.round++;
  }

  // 50-move clock: a pawn move or ANY material change is progress. Material
  // is compared by piece count against the pre-move state, which folds every
  // destruction path into one check -- plain captures, en passant, a mover
  // dying to a corrosion cell, and pieces destroyed during the corrosion
  // phase above. Corrosion spawning/marching alone is NOT progress (it only
  // ever follows a capture, which already reset the clock).
  const pawnMoved = prev.board[m.from]!.type === 'p';
  const materialChanged = countPieces(s.board) < countPieces(prev.board);
  if (pawnMoved || materialChanged) {
    s.halfmoveClock = 0;
    // Irreversible move: no earlier position can ever recur, so the
    // repetition table restarts (keeps it small for the bot's search too).
    s.positionCounts = {};
  } else {
    s.halfmoveClock++;
  }

  computeResult(s);

  // Draw claims come AFTER computeResult: a mate delivered on the 100th
  // quiet halfmove (or on a repeating move) is still a mate, per FIDE.
  if (!s.result && s.halfmoveClock >= 100) {
    s.result = { winner: null, reason: '50-move rule' };
  }
  if (!s.result) {
    const key = positionKey(s);
    const n = (s.positionCounts[key] ?? 0) + 1;
    s.positionCounts[key] = n;
    if (n >= 3) s.result = { winner: null, reason: 'threefold repetition' };
  }

  return s;
}
