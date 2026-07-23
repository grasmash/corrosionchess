import type { Color, Config, GameState, Move } from './types';
import { initialState, forwardDir, toAlg, fileOf } from './board';
import { applyMoveCore, inCheck, legalMoves } from './legal';
import { corrosionPhase } from './corrosion';
import { moveToSan } from './notation';

export function other(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

export function newGame(config: Config): GameState {
  return initialState(config);
}

function computeResult(s: GameState): void {
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

  const mover = s.board[m.from];
  const moverColor = s.turn;

  const destPiece = s.board[m.to];
  const isEnPassant = !!mover && mover.type === 'p' && s.epSquare === m.to && !destPiece &&
    fileOf(m.from, size) !== fileOf(m.to, size);
  const wasPieceCapture = (!!destPiece && destPiece.color !== moverColor) || isEnPassant;
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

  computeResult(s);

  return s;
}
