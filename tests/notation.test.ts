import { it, expect } from 'vitest';
import { initialState, fromAlg } from '../src/engine/board';
import { applyMoveCore } from '../src/engine/legal';
import { newGame, applyMove } from '../src/engine/game';
import { moveToSan } from '../src/engine/notation';
import type { GameState } from '../src/engine/types';

const cfg = { tier1: true, tier2: true, tier3: true, bigBoard: false };
const empty = (size = 8): GameState => {
  const s = initialState({ ...cfg, bigBoard: size === 12 });
  s.board = s.board.map(() => null);
  return s;
};
const put = (s: GameState, a: string, color: 'w' | 'b', type: any) => {
  s.board[fromAlg(a, s.size)] = { color, type };
};
const mv = (s: GameState, from: string, to: string, promotion?: any) =>
  ({ from: fromAlg(from, s.size), to: fromAlg(to, s.size), promotion });

it('pawn push', () => {
  const s = newGame(cfg);
  expect(moveToSan(s, mv(s, 'e2', 'e4'))).toBe('e4');
});

it('pawn capture', () => {
  const s = empty();
  put(s, 'a1', 'w', 'k'); put(s, 'h8', 'b', 'k');
  put(s, 'e4', 'w', 'p'); put(s, 'd5', 'b', 'p');
  expect(moveToSan(s, mv(s, 'e4', 'd5'))).toBe('exd5');
});

it('en passant capture', () => {
  const s = empty();
  put(s, 'a1', 'w', 'k'); put(s, 'h8', 'b', 'k');
  put(s, 'e5', 'w', 'p'); put(s, 'd5', 'b', 'p');
  s.epSquare = fromAlg('d6', 8);
  expect(moveToSan(s, mv(s, 'e5', 'd6'))).toBe('exd6');
});

it('knight move, no disambiguation needed', () => {
  const s = newGame(cfg);
  expect(moveToSan(s, mv(s, 'g1', 'f3'))).toBe('Nf3');
});

it('knight disambiguation by file', () => {
  const s = empty();
  put(s, 'a1', 'w', 'k'); put(s, 'h8', 'b', 'k');
  put(s, 'b1', 'w', 'n'); put(s, 'f1', 'w', 'n');
  expect(moveToSan(s, mv(s, 'b1', 'd2'))).toBe('Nbd2');
});

it('rook disambiguation by rank when files match', () => {
  const s = empty();
  put(s, 'e1', 'w', 'k'); put(s, 'h8', 'b', 'k');
  put(s, 'a1', 'w', 'r'); put(s, 'a5', 'w', 'r');
  expect(moveToSan(s, mv(s, 'a1', 'a3'))).toBe('R1a3');
});

it('kingside castling', () => {
  const s = initialState(cfg);
  s.board[fromAlg('f1', 8)] = null;
  s.board[fromAlg('g1', 8)] = null;
  expect(moveToSan(s, mv(s, 'e1', 'g1'))).toBe('O-O');
});

it('queenside castling', () => {
  const s = initialState(cfg);
  s.board[fromAlg('b1', 8)] = null;
  s.board[fromAlg('c1', 8)] = null;
  s.board[fromAlg('d1', 8)] = null;
  expect(moveToSan(s, mv(s, 'e1', 'c1'))).toBe('O-O-O');
});

it('pawn promotion', () => {
  const s = empty();
  put(s, 'a1', 'w', 'k'); put(s, 'h4', 'b', 'k');
  put(s, 'a7', 'w', 'p');
  expect(moveToSan(s, mv(s, 'a7', 'a8', 'q'))).toBe('a8=Q');
});

it('underpromotion capture', () => {
  const s = empty();
  put(s, 'a1', 'w', 'k'); put(s, 'h8', 'b', 'k');
  put(s, 'b7', 'w', 'p'); put(s, 'a8', 'b', 'r');
  expect(moveToSan(s, mv(s, 'b7', 'a8', 'n'))).toBe('bxa8=N');
});

it('check suffix', () => {
  const s = empty();
  put(s, 'e1', 'w', 'k'); put(s, 'e8', 'b', 'k');
  put(s, 'h5', 'w', 'q');
  expect(moveToSan(s, mv(s, 'h5', 'e5'))).toBe('Qe5+');
});

it('checkmate suffix (scholars mate final move)', () => {
  const s = initialState(cfg);
  const play = (a: string, b: string) => applyMoveCore(s, mv(s, a, b));
  play('e2', 'e4'); play('e7', 'e5'); play('d1', 'h5'); play('b8', 'c6');
  play('f1', 'c4'); play('g8', 'f6');
  expect(moveToSan(s, mv(s, 'h5', 'f7'))).toBe('Qxf7#');
});

it('12x12: double-digit rank destination', () => {
  const s = empty(12);
  put(s, 'a1', 'w', 'k'); put(s, 'l12', 'b', 'k');
  put(s, 'f1', 'w', 'q');
  expect(moveToSan(s, mv(s, 'f1', 'f10'))).toBe('Qf10');
});

it('game.ts integration: applyMove logs the SAN move entry', () => {
  let s = newGame(cfg);
  s = applyMove(s, mv(s, 'e2', 'e4'));
  expect(s.log.some(e => e.text === '1. e4')).toBe(true);
});

it('game.ts integration: move entry appears before the corrosion-spawn entry', () => {
  let s = newGame(cfg);
  s = applyMove(s, mv(s, 'e2', 'e4'));
  s = applyMove(s, mv(s, 'd7', 'd5'));
  s = applyMove(s, mv(s, 'e4', 'd5')); // pawn takes pawn, spawns corrosion
  const moveIdx = s.log.findIndex(e => e.text === '2. exd5');
  const spawnIdx = s.log.findIndex(e => e.text.startsWith('Corrosion spawns'));
  expect(moveIdx).toBeGreaterThanOrEqual(0);
  expect(spawnIdx).toBeGreaterThan(moveIdx);
});

it('game.ts integration: SAN move entry precedes its own corrosion-capture destruction event', () => {
  let s = newGame(cfg);
  s.board = s.board.map(() => null);
  s.board[fromAlg('a1', 8)] = { color: 'w', type: 'k' };
  s.board[fromAlg('h8', 8)] = { color: 'b', type: 'k' };
  s.board[fromAlg('d4', 8)] = { color: 'w', type: 'r' };
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('d6', 8)], dir: -1, bornRound: 0 }];
  s = applyMove(s, mv(s, 'd4', 'd6'));
  const moveIdx = s.log.findIndex(e => e.text === '1. Rd6');
  const destroyIdx = s.log.findIndex(e => e.text === 'Rook destroyed capturing corrosion at d6');
  expect(moveIdx).toBeGreaterThanOrEqual(0);
  expect(destroyIdx).toBeGreaterThan(moveIdx);
});

it('legal.ts integration: rook captures corrosion logs the destruction', () => {
  const s = empty();
  put(s, 'a1', 'w', 'k'); put(s, 'h8', 'b', 'k'); put(s, 'd4', 'w', 'r');
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('d6', 8)], dir: -1, bornRound: 0 }];
  applyMoveCore(s, mv(s, 'd4', 'd6'));
  expect(s.log.some(e => e.text === 'Rook destroyed capturing corrosion at d6')).toBe(true);
});
