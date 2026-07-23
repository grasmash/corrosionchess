import { describe, it, expect } from 'vitest';
import { initialState, fromAlg } from '../src/engine/board';
import { applyMoveCore, legalMoves, inCheck } from '../src/engine/legal';
import type { GameState } from '../src/engine/types';

const cfg = { tier1: true, tier2: true, tier3: true, bigBoard: false };
const empty8 = (): GameState => { const s = initialState(cfg); s.board = s.board.map(() => null); return s; };
const put = (s: GameState, a: string, color: 'w'|'b', type: any) => { s.board[fromAlg(a, s.size)] = { color, type }; };
const mv = (s: GameState, from: string, to: string, promotion?: any) =>
  ({ from: fromAlg(from, s.size), to: fromAlg(to, s.size), promotion });

it('pinned piece cannot move', () => {
  const s = empty8();
  put(s, 'e1', 'w', 'k'); put(s, 'e2', 'w', 'r'); put(s, 'e8', 'b', 'r');
  expect(legalMoves(s, fromAlg('e2', 8)).every(m => [fromAlg('e3',8),fromAlg('e4',8),fromAlg('e5',8),fromAlg('e6',8),fromAlg('e7',8),fromAlg('e8',8)].includes(m.to))).toBe(true);
});

it('en passant executes: captured pawn removed', () => {
  const s = empty8();
  put(s, 'e5', 'w', 'p'); put(s, 'd5', 'b', 'p');
  put(s, 'a1', 'w', 'k'); put(s, 'h8', 'b', 'k');
  s.epSquare = fromAlg('d6', 8);
  applyMoveCore(s, mv(s, 'e5', 'd6'));
  expect(s.board[fromAlg('d5', 8)]).toBeNull();
  expect(s.board[fromAlg('d6', 8)]).toEqual({ color: 'w', type: 'p' });
});

it('castling moves the rook too', () => {
  const s = initialState(cfg);
  s.board[fromAlg('f1', 8)] = null; s.board[fromAlg('g1', 8)] = null;
  applyMoveCore(s, mv(s, 'e1', 'g1'));
  expect(s.board[fromAlg('f1', 8)]).toEqual({ color: 'w', type: 'r' });
  expect(s.castling.wK).toBe(false);
});

it('capturing enemy corrosion destroys the mover (non-king)', () => {
  const s = empty8();
  put(s, 'a1', 'w', 'k'); put(s, 'h8', 'b', 'k'); put(s, 'd4', 'w', 'r');
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('d6', 8)], dir: -1, bornRound: 0 }];
  applyMoveCore(s, mv(s, 'd4', 'd6'));
  expect(s.board[fromAlg('d6', 8)]).toBeNull();
  expect(s.corrosions).toEqual([]);
});

it('king captures corrosion for free and cleanses purple on landing', () => {
  const s = empty8();
  put(s, 'e1', 'w', 'k'); put(s, 'h8', 'b', 'k');
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('e2', 8)], dir: -1, bornRound: 0 }];
  s.purple = [fromAlg('e2', 8)];
  applyMoveCore(s, mv(s, 'e1', 'e2'));
  expect(s.board[fromAlg('e2', 8)]).toEqual({ color: 'w', type: 'k' });
  expect(s.corrosions).toEqual([]);
  expect(s.purple).toEqual([]);
});

it('suicidal corrosion capture that exposes king is illegal', () => {
  const s = empty8();
  put(s, 'e1', 'w', 'k'); put(s, 'e2', 'w', 'r'); put(s, 'e8', 'b', 'r'); put(s, 'h8', 'b', 'k');
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('a2', 8)], dir: -1, bornRound: 0 }];
  // Re2xa2 (rook takes corrosion) would destroy the rook and expose e1 to e8 rook
  expect(legalMoves(s, fromAlg('e2', 8)).map(m => m.to)).not.toContain(fromAlg('a2', 8));
});

it('no phantom en passant when double-pushing pawn is destroyed by corrosion', () => {
  const s = empty8();
  put(s, 'e2', 'w', 'p'); put(s, 'd4', 'b', 'p');
  put(s, 'a1', 'w', 'k'); put(s, 'h8', 'b', 'k');
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('e4', 8)], dir: -1, bornRound: 0 }];
  applyMoveCore(s, mv(s, 'e2', 'e4'));
  expect(s.board[fromAlg('e4', 8)]).toBeNull();
  expect(s.corrosions).toEqual([]);
  expect(s.epSquare).toBeNull();
});

it('scholars mate leaves black with zero legal moves and inCheck', () => {
  const s = initialState(cfg);
  const play = (a: string, b: string) => applyMoveCore(s, mv(s, a, b));
  play('e2','e4'); play('e7','e5'); play('d1','h5'); play('b8','c6');
  play('f1','c4'); play('g8','f6'); play('h5','f7');
  expect(inCheck(s, 'b')).toBe(true);
  const all = Array.from({ length: 64 }, (_, i) => i)
    .filter(i => s.board[i]?.color === 'b')
    .flatMap(i => legalMoves(s, i));
  expect(all).toEqual([]);
});
