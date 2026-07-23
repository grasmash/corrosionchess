import { it, expect } from 'vitest';
import { newGame, applyMove } from '../src/engine/game';
import { fromAlg } from '../src/engine/board';

const cfg = { tier1: true, tier2: true, tier3: true, bigBoard: false };
const mv = (s: any, a: string, b: string) => ({ from: fromAlg(a, s.size), to: fromAlg(b, s.size) });

it('capture spawns corrosion on the origin square, mover color', () => {
  let s = newGame(cfg);
  s = applyMove(s, mv(s, 'e2', 'e4'));
  s = applyMove(s, mv(s, 'd7', 'd5'));
  s = applyMove(s, mv(s, 'e4', 'd5')); // pawn takes pawn
  expect(s.corrosions).toHaveLength(1);
  expect(s.corrosions[0]).toMatchObject({ color: 'w', cls: 1, cells: [fromAlg('e4', 8)], dir: 1 });
});

it('no spawn when tier1 disabled', () => {
  let s = newGame({ ...cfg, tier1: false });
  s = applyMove(s, mv(s, 'e2', 'e4'));
  s = applyMove(s, mv(s, 'd7', 'd5'));
  s = applyMove(s, mv(s, 'e4', 'd5'));
  expect(s.corrosions).toEqual([]);
});

it('capturing corrosion does not spawn corrosion', () => {
  let s = newGame(cfg);
  s.board = s.board.map(() => null);
  s.board[fromAlg('a1', 8)] = { color: 'w', type: 'k' };
  s.board[fromAlg('h8', 8)] = { color: 'b', type: 'k' };
  s.board[fromAlg('d4', 8)] = { color: 'w', type: 'r' };
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('d6', 8)], dir: -1, bornRound: 0 }];
  s = applyMove(s, mv(s, 'd4', 'd6'));
  expect(s.corrosions).toEqual([]);
});

it('fools mate produces checkmate result', () => {
  let s = newGame(cfg);
  s = applyMove(s, mv(s, 'f2', 'f3'));
  s = applyMove(s, mv(s, 'e7', 'e5'));
  s = applyMove(s, mv(s, 'g2', 'g4'));
  s = applyMove(s, mv(s, 'd8', 'h4'));
  expect(s.result).toEqual({ winner: 'b', reason: 'checkmate' });
});

it('checkmate created by the corrosion phase ends the game immediately', () => {
  let s = newGame(cfg);
  s.board = s.board.map(() => null);
  s.board[fromAlg('a1', 8)] = { color: 'w', type: 'k' };
  s.board[fromAlg('a2', 8)] = { color: 'w', type: 'p' }; // shields the king from the rook
  s.board[fromAlg('a8', 8)] = { color: 'b', type: 'r' }; // gives check once a2 is cleared
  s.board[fromAlg('b8', 8)] = { color: 'b', type: 'q' }; // covers b1/b2 escape squares
  s.board[fromAlg('h8', 8)] = { color: 'b', type: 'k' };
  s.turn = 'b';
  s.round = 5;
  // A black cls-1 unit marching onto a2 this phase strikes the white pawn,
  // opening the a-file check -- the move itself (h8-h7) captures nothing.
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('a3', 8)], dir: -1, bornRound: 0 }];

  s = applyMove(s, mv(s, 'h8', 'h7'));

  expect(s.board[fromAlg('a2', 8)]).toBeNull();
  expect(s.corrosions).toEqual([]);
  expect(s.result).toEqual({ winner: 'b', reason: 'checkmate' });
});

it('round increments only after black moves', () => {
  let s = newGame(cfg);
  s = applyMove(s, mv(s, 'e2', 'e4'));
  expect(s.round).toBe(1);
  s = applyMove(s, mv(s, 'e7', 'e5'));
  expect(s.round).toBe(2);
});

it('bare kings is an immediate draw by insufficient material', () => {
  let s = newGame(cfg);
  s.board = s.board.map(() => null);
  s.board[fromAlg('a1', 8)] = { color: 'w', type: 'k' };
  s.board[fromAlg('h8', 8)] = { color: 'b', type: 'k' };
  s.board[fromAlg('b3', 8)] = { color: 'b', type: 'n' };
  // White king captures the last non-king piece -> only kings remain.
  s.board[fromAlg('a1', 8)] = null;
  s.board[fromAlg('a2', 8)] = { color: 'w', type: 'k' };
  s = applyMove(s, mv(s, 'a2', 'b3'));
  expect(s.result).toEqual({ winner: null, reason: 'insufficient material' });
});

it('kings-only draw fires even while corrosion units linger', () => {
  let s = newGame(cfg);
  s.board = s.board.map(() => null);
  s.board[fromAlg('a2', 8)] = { color: 'w', type: 'k' };
  s.board[fromAlg('h8', 8)] = { color: 'b', type: 'k' };
  s.board[fromAlg('b3', 8)] = { color: 'b', type: 'p' };
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('e5', 8)], dir: -1, bornRound: 0 }];
  s = applyMove(s, mv(s, 'a2', 'b3'));
  // Corrosion cannot harm kings (strikes are blocked), so lingering units
  // don't stop the dead-position draw.
  expect(s.result).toEqual({ winner: null, reason: 'insufficient material' });
});

it('threefold repetition is a draw (knight shuffle)', () => {
  let s = newGame(cfg);
  const shuffle = [
    ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
  ] as const;
  // Start position count = 1; each full shuffle returns to it. After the
  // second full shuffle the position has occurred 3 times -> draw.
  for (const [a, b] of shuffle) s = applyMove(s, mv(s, a, b));
  expect(s.result).toBeNull();
  for (const [a, b] of shuffle) s = applyMove(s, mv(s, a, b));
  expect(s.result).toEqual({ winner: null, reason: 'threefold repetition' });
});

it('repetition count distinguishes corrosion state (units make positions differ)', () => {
  let s = newGame(cfg);
  // Plant a dormant far-away corrosion unit; piece shuffle alone must NOT
  // draw, because the unit marches each round -- positions never repeat.
  s.corrosions = [{ id: 1, color: 'w', cls: 1, cells: [0], dir: 1, bornRound: 0 }];
  const shuffle = [
    ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
  ] as const;
  for (const [a, b] of shuffle) s = applyMove(s, mv(s, a, b));
  for (const [a, b] of shuffle) s = applyMove(s, mv(s, a, b));
  expect(s.result).toBeNull();
});

it('100 quiet halfmoves is a draw by the 50-move rule', () => {
  let s = newGame(cfg);
  s.halfmoveClock = 99;
  s = applyMove(s, mv(s, 'g1', 'f3')); // knight move: quiet, 100th halfmove
  expect(s.result).toEqual({ winner: null, reason: '50-move rule' });
});

it('pawn moves and captures reset the halfmove clock', () => {
  let s = newGame(cfg);
  s.halfmoveClock = 42;
  s = applyMove(s, mv(s, 'e2', 'e4'));
  expect(s.halfmoveClock).toBe(0);
  s.halfmoveClock = 42;
  s = applyMove(s, mv(s, 'g8', 'f6'));
  expect(s.halfmoveClock).toBe(43);
  s = applyMove(s, mv(s, 'd2', 'd3'));
  expect(s.halfmoveClock).toBe(0);
});
