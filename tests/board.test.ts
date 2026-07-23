import { describe, it, expect } from 'vitest';
import { initialState, toAlg, fromAlg, sq, pawnStartRank, offsetOf } from '../src/engine/board';

const cfg = (bigBoard: boolean) => ({ tier1: true, tier2: true, tier3: true, bigBoard });

describe('geometry', () => {
  it('round-trips algebraic on both sizes', () => {
    expect(toAlg(0, 8)).toBe('a1');
    expect(toAlg(63, 8)).toBe('h8');
    expect(toAlg(143, 12)).toBe('l12');
    expect(fromAlg('e4', 8)).toBe(sq(4, 3, 8));
    expect(fromAlg('c3', 12)).toBe(sq(2, 2, 12));
  });
});

describe('initialState 8x8', () => {
  const s = initialState(cfg(false));
  it('places standard army', () => {
    expect(s.board[fromAlg('e1', 8)]).toEqual({ color: 'w', type: 'k' });
    expect(s.board[fromAlg('d8', 8)]).toEqual({ color: 'b', type: 'q' });
    expect(s.board[fromAlg('a2', 8)]).toEqual({ color: 'w', type: 'p' });
    expect(s.board.filter(Boolean).length).toBe(32);
  });
});

describe('initialState 12x12', () => {
  const s = initialState(cfg(true));
  it('centers army both axes', () => {
    expect(offsetOf(12)).toBe(2);
    expect(s.size).toBe(12);
    expect(s.board[fromAlg('g3', 12)]).toEqual({ color: 'w', type: 'k' }); // file 6 = c+4 → e-file shifted by 2 → g
    expect(s.board[fromAlg('f10', 12)]).toEqual({ color: 'b', type: 'q' });
    expect(s.board[fromAlg('c4', 12)]).toEqual({ color: 'w', type: 'p' });
    expect(s.board[fromAlg('b2', 12)]).toBeNull(); // outside army footprint
    expect(s.board.filter(Boolean).length).toBe(32);
    expect(pawnStartRank('w', 12)).toBe(3);
    expect(pawnStartRank('b', 12)).toBe(8);
  });
});
