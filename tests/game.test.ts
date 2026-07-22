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

it('round increments only after black moves', () => {
  let s = newGame(cfg);
  s = applyMove(s, mv(s, 'e2', 'e4'));
  expect(s.round).toBe(1);
  s = applyMove(s, mv(s, 'e7', 'e5'));
  expect(s.round).toBe(2);
});
