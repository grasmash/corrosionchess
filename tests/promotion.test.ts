import { it, expect } from 'vitest';
import { newGame } from '../src/engine/game';
import { corrosionPhase } from '../src/engine/corrosion';
import { fromAlg } from '../src/engine/board';
import type { GameState, CorrosionUnit } from '../src/engine/types';

const mk = (tier2 = true, tier3 = true): GameState => {
  const s = newGame({ tier1: true, tier2, tier3, bigBoard: false });
  s.board = s.board.map(() => null);
  s.board[fromAlg('a1', 8)] = { color: 'w', type: 'k' };
  s.board[fromAlg('h8', 8)] = { color: 'b', type: 'k' };
  s.round = 5;
  return s;
};
const unit = (o: Partial<CorrosionUnit>): CorrosionUnit =>
  ({ id: 1, color: 'w', cls: 1, cells: [], dir: 1, bornRound: 0, ...o });

it('class 1 reaching enemy edge becomes class 2 pair heading home', () => {
  const s = mk();
  s.corrosions = [unit({ cells: [fromAlg('d7', 8)] })];
  corrosionPhase(s);
  const u = s.corrosions[0];
  expect(u.cls).toBe(2);
  expect(u.dir).toBe(-1);
  expect(u.cells.sort((a, b) => a - b)).toEqual([fromAlg('d7', 8), fromAlg('d8', 8)]);
});

it('tier2 disabled: class 1 fizzles at edge', () => {
  const s = mk(false);
  s.corrosions = [unit({ cells: [fromAlg('d7', 8)] })];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('class 2 pair marches as a pair', () => {
  const s = mk();
  s.corrosions = [unit({ cls: 2, dir: -1, cells: [fromAlg('d8', 8), fromAlg('d7', 8)] })];
  corrosionPhase(s);
  expect(s.corrosions[0].cells.sort((a, b) => a - b)).toEqual([fromAlg('d6', 8), fromAlg('d7', 8)]);
});

it('corrosion strikes instead of promoting when enemy piece on edge-adjacent path', () => {
  const s = mk();
  s.board[fromAlg('d7', 8)] = { color: 'b', type: 'n' };
  s.corrosions = [unit({ cells: [fromAlg('d6', 8)] })];
  corrosionPhase(s); // moves d6->d7, strikes knight, consumed — never promotes
  expect(s.board[fromAlg('d7', 8)]).toBeNull();
  expect(s.corrosions).toEqual([]);
});

it('promotion trail cell annihilates with enemy corrosion on trail square', () => {
  const s = mk();
  s.corrosions = [
    unit({ id: 1, color: 'w', cells: [fromAlg('d7', 8)] }),
    unit({ id: 2, color: 'b', cls: 1, dir: -1, cells: [fromAlg('d7', 8)], bornRound: s.round }),
  ];
  corrosionPhase(s);
  const white = s.corrosions.find(u => u.id === 1);
  expect(white).toBeDefined();
  expect(white!.cls).toBe(2);
  expect(white!.cells).toEqual([fromAlg('d8', 8)]);
  expect(s.corrosions.find(u => u.id === 2)).toBeUndefined();
});

it('class 2 reaching owner edge becomes class 3', () => {
  const s = mk();
  s.corrosions = [unit({ cls: 2, dir: -1, cells: [fromAlg('d2', 8), fromAlg('d3', 8)] })];
  corrosionPhase(s);
  const u = s.corrosions[0];
  expect(u.cls).toBe(3);
  expect(u.dir).toBe(1);
  expect(u.cells).toEqual([fromAlg('d1', 8)]);
});

it('tier3 disabled: class 2 removed at owner edge', () => {
  const s = mk(true, false);
  s.corrosions = [unit({ cls: 2, dir: -1, cells: [fromAlg('d2', 8), fromAlg('d3', 8)] })];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('degraded single-cell class 2 still promotes to class 3 at owner edge', () => {
  const s = mk();
  s.corrosions = [unit({ cls: 2, dir: -1, cells: [fromAlg('d2', 8)] })];
  corrosionPhase(s);
  expect(s.corrosions[0].cls).toBe(3);
});

it('12x12: promotions use true board edges', () => {
  const s = newGame({ tier1: true, tier2: true, tier3: true, bigBoard: true });
  s.board = s.board.map(() => null);
  s.board[fromAlg('a1', 12)] = { color: 'w', type: 'k' };
  s.board[fromAlg('l12', 12)] = { color: 'b', type: 'k' };
  s.round = 5;
  s.corrosions = [unit({ cells: [fromAlg('f11', 12)] })];
  corrosionPhase(s);
  expect(s.corrosions[0].cls).toBe(2);
  expect(s.corrosions[0].cells.sort((a, b) => a - b)).toEqual([fromAlg('f11', 12), fromAlg('f12', 12)]);
});
