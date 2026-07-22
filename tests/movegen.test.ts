import { describe, it, expect } from 'vitest';
import { initialState, fromAlg } from '../src/engine/board';
import { pseudoMoves, isAttacked } from '../src/engine/movegen';
import type { GameState } from '../src/engine/types';

const cfg = { tier1: true, tier2: true, tier3: true, bigBoard: false };
const empty8 = (): GameState => {
  const s = initialState(cfg);
  s.board = s.board.map(() => null);
  return s;
};
const put = (s: GameState, a: string, color: 'w' | 'b', type: any) => {
  s.board[fromAlg(a, s.size)] = { color, type };
};
const dests = (s: GameState, a: string) =>
  pseudoMoves(s, fromAlg(a, s.size)).map(m => m.to).sort((x, y) => x - y);

it('knight from b1 in initial position', () => {
  const s = initialState(cfg);
  expect(dests(s, 'b1')).toEqual([fromAlg('a3', 8), fromAlg('c3', 8)].sort((x, y) => x - y));
});

it('rook blocked by purple', () => {
  const s = empty8();
  put(s, 'a1', 'w', 'r');
  s.purple = [fromAlg('a4', 8)];
  const d = dests(s, 'a1');
  expect(d).toContain(fromAlg('a3', 8));
  expect(d).not.toContain(fromAlg('a4', 8));
  expect(d).not.toContain(fromAlg('a5', 8));
});

it('knight may jump over purple but not land on it', () => {
  const s = empty8();
  put(s, 'b1', 'w', 'n');
  s.purple = [fromAlg('b2', 8), fromAlg('c3', 8)];
  const d = dests(s, 'b1');
  expect(d).toContain(fromAlg('a3', 8));
  expect(d).not.toContain(fromAlg('c3', 8));
});

it('king may land on purple', () => {
  const s = empty8();
  put(s, 'e1', 'w', 'k');
  s.purple = [fromAlg('e2', 8)];
  expect(dests(s, 'e1')).toContain(fromAlg('e2', 8));
});

it('pawn double-step blocked by purple transit', () => {
  const s = empty8();
  put(s, 'e2', 'w', 'p');
  s.purple = [fromAlg('e3', 8)];
  expect(dests(s, 'e2')).toEqual([]);
});

it('pawn promotion emits four moves', () => {
  const s = empty8();
  put(s, 'a7', 'w', 'p');
  const ms = pseudoMoves(s, fromAlg('a7', 8));
  expect(ms.map(m => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
});

it('en passant target is generated', () => {
  const s = empty8();
  put(s, 'e5', 'w', 'p');
  put(s, 'd5', 'b', 'p');
  s.epSquare = fromAlg('d6', 8);
  expect(dests(s, 'e5')).toContain(fromAlg('d6', 8));
});

it('isAttacked respects purple blocking', () => {
  const s = empty8();
  put(s, 'a1', 'b', 'r');
  s.purple = [fromAlg('a4', 8)];
  expect(isAttacked(s, fromAlg('a3', 8), 'b')).toBe(true);
  expect(isAttacked(s, fromAlg('a6', 8), 'b')).toBe(false);
});

it('castling kingside available in cleared initial position', () => {
  const s = initialState(cfg);
  s.board[fromAlg('f1', 8)] = null;
  s.board[fromAlg('g1', 8)] = null;
  expect(dests(s, 'e1')).toContain(fromAlg('g1', 8));
});

it('12x12 pawn double-step from c4', () => {
  const s = initialState({ ...cfg, bigBoard: true });
  expect(dests(s, 'c4')).toContain(fromAlg('c6', 12));
});
