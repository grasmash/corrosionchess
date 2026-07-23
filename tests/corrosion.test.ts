import { it, expect } from 'vitest';
import { newGame } from '../src/engine/game';
import { corrosionPhase } from '../src/engine/corrosion';
import { fromAlg } from '../src/engine/board';
import type { GameState, CorrosionUnit } from '../src/engine/types';

const cfg = { tier1: true, tier2: true, tier3: true, bigBoard: false };
const base = (): GameState => {
  const s = newGame(cfg);
  s.board = s.board.map(() => null);
  s.board[fromAlg('a1', 8)] = { color: 'w', type: 'k' };
  s.board[fromAlg('h8', 8)] = { color: 'b', type: 'k' };
  s.round = 5;
  return s;
};
const unit = (o: Partial<CorrosionUnit>): CorrosionUnit =>
  ({ id: 99, color: 'w', cls: 1, cells: [], dir: 1, bornRound: 0, ...o });

it('marches one square toward enemy side', () => {
  const s = base();
  s.corrosions = [unit({ cells: [fromAlg('d4', 8)] })];
  corrosionPhase(s);
  expect(s.corrosions[0].cells).toEqual([fromAlg('d5', 8)]);
});

it('does not move in its born round', () => {
  const s = base();
  s.corrosions = [unit({ cells: [fromAlg('d4', 8)], bornRound: 5 })];
  corrosionPhase(s);
  expect(s.corrosions[0].cells).toEqual([fromAlg('d4', 8)]);
});

it('destroys enemy piece and is consumed', () => {
  const s = base();
  s.board[fromAlg('d5', 8)] = { color: 'b', type: 'n' };
  s.corrosions = [unit({ cells: [fromAlg('d4', 8)] })];
  corrosionPhase(s);
  expect(s.board[fromAlg('d5', 8)]).toBeNull();
  expect(s.corrosions).toEqual([]);
});

it('passes through friendly piece', () => {
  const s = base();
  s.board[fromAlg('d5', 8)] = { color: 'w', type: 'n' };
  s.corrosions = [unit({ cells: [fromAlg('d4', 8)] })];
  corrosionPhase(s);
  expect(s.board[fromAlg('d5', 8)]).toEqual({ color: 'w', type: 'n' });
  expect(s.corrosions[0].cells).toEqual([fromAlg('d5', 8)]);
  corrosionPhase(s);
  expect(s.corrosions[0].cells).toEqual([fromAlg('d6', 8)]);
});

it('king blocks: corrosion destroyed, king unharmed', () => {
  const s = base();
  s.corrosions = [unit({ color: 'b', dir: -1, cells: [fromAlg('a2', 8)] })];
  corrosionPhase(s);
  expect(s.board[fromAlg('a1', 8)]).toEqual({ color: 'w', type: 'k' });
  expect(s.corrosions).toEqual([]);
});

it('opposite colors annihilate on same square', () => {
  const s = base();
  s.corrosions = [
    unit({ id: 1, color: 'w', dir: 1, cells: [fromAlg('d4', 8)] }),
    unit({ id: 2, color: 'b', dir: -1, cells: [fromAlg('d6', 8)] }),
  ];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('opposite colors annihilate on swap', () => {
  const s = base();
  s.corrosions = [
    unit({ id: 1, color: 'w', dir: 1, cells: [fromAlg('d4', 8)] }),
    unit({ id: 2, color: 'b', dir: -1, cells: [fromAlg('d5', 8)] }),
  ];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('same color stacks and passes through', () => {
  const s = base();
  s.board[fromAlg('d5', 8)] = { color: 'w', type: 'b' };
  s.corrosions = [
    unit({ id: 1, color: 'w', cells: [fromAlg('d4', 8)] }),
    unit({ id: 2, color: 'w', cells: [fromAlg('d3', 8)] }),
  ];
  corrosionPhase(s);
  expect(s.corrosions).toHaveLength(2);
  expect(s.corrosions.find(u => u.id === 1)!.cells).toEqual([fromAlg('d5', 8)]);
  expect(s.corrosions.find(u => u.id === 2)!.cells).toEqual([fromAlg('d4', 8)]);
});

it('dormant unit is destroyed by same-square annihilation with a mover', () => {
  const s = base();
  s.corrosions = [
    unit({ id: 1, color: 'w', dir: 1, cells: [fromAlg('d4', 8)] }),
    unit({ id: 2, color: 'b', dir: -1, cells: [fromAlg('d5', 8)], bornRound: s.round }),
  ];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('converged same-color units: first strikes, second survives on vacated square', () => {
  const s = base();
  s.board[fromAlg('d5', 8)] = { color: 'b', type: 'n' };
  s.corrosions = [
    unit({ id: 1, color: 'w', cells: [fromAlg('d4', 8)] }),
    unit({ id: 2, color: 'w', cells: [fromAlg('d4', 8)] }),
  ];
  corrosionPhase(s);
  expect(s.board[fromAlg('d5', 8)]).toBeNull();
  expect(s.corrosions).toHaveLength(1);
  // unit 1 (processed first) strikes the knight and is consumed; unit 2
  // (processed second) then lands on the now-empty square and survives.
  // A Map keyed by origin square would silently drop unit 1's move record
  // and leave the WRONG unit (1, never struck at all) as the "survivor".
  expect(s.corrosions[0].id).toBe(2);
  expect(s.corrosions[0].cells).toEqual([fromAlg('d5', 8)]);
});

it('converged same-color units both die entering purple', () => {
  const s = base();
  s.purple = [fromAlg('d5', 8)];
  s.corrosions = [
    unit({ id: 1, color: 'w', cells: [fromAlg('d4', 8)] }),
    unit({ id: 2, color: 'w', cells: [fromAlg('d4', 8)] }),
  ];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('non-class-3 corrosion dies entering purple', () => {
  const s = base();
  s.purple = [fromAlg('d5', 8)];
  s.corrosions = [unit({ cells: [fromAlg('d4', 8)] })];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('purple deaths apply to dormant units too', () => {
  const s = base();
  s.purple = [fromAlg('d5', 8)];
  s.corrosions = [unit({ cells: [fromAlg('d5', 8)], bornRound: s.round })];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('class 3 paints purple behind it, kills own-color piece, bounces at edge', () => {
  const s = base();
  s.board[fromAlg('d5', 8)] = { color: 'w', type: 'q' }; // own color — class 3 kills it
  s.corrosions = [unit({ cls: 3, color: 'w', dir: 1, cells: [fromAlg('d4', 8)] })];
  corrosionPhase(s);
  expect(s.purple).toContain(fromAlg('d4', 8));
  expect(s.board[fromAlg('d5', 8)]).toBeNull();
  expect(s.corrosions).toEqual([]); // consumed on strike
  // bounce: fresh unit at edge
  const s2 = base();
  s2.corrosions = [unit({ cls: 3, color: 'w', dir: 1, cells: [fromAlg('d8', 8)] })];
  corrosionPhase(s2);
  expect(s2.corrosions[0].dir).toBe(-1);
  expect(s2.corrosions[0].cells).toEqual([fromAlg('d7', 8)]);
  expect(s2.purple).toContain(fromAlg('d8', 8));
});

it('purple void consumes a non-king piece standing on it during the phase', () => {
  const s = base();
  s.board[fromAlg('d4', 8)] = { color: 'w', type: 'q' };
  s.purple = [fromAlg('d4', 8)];
  corrosionPhase(s);
  expect(s.board[fromAlg('d4', 8)]).toBeNull();
  expect(s.purple).toContain(fromAlg('d4', 8));
  expect(s.log.some(e => e.text.includes('Purple void consumes queen at d4'))).toBe(true);
});

it('kings are immune to purple decay', () => {
  const s = base();
  s.purple = [fromAlg('a1', 8)]; // white king's square
  corrosionPhase(s);
  expect(s.board[fromAlg('a1', 8)]).toEqual({ color: 'w', type: 'k' });
  expect(s.purple).toContain(fromAlg('a1', 8));
});

it('cls-3 marching off a co-occupied birth square leaves purple that consumes the piece', () => {
  const s = base();
  // cls-2 went critical last round on its own back rank while co-occupying
  // a friendly rook (cls 1/2 pass through friendlies). This phase the cls-3
  // unit paints d1 purple as it leaves -- the rook must be consumed.
  s.board[fromAlg('d1', 8)] = { color: 'w', type: 'r' };
  s.corrosions = [unit({ cls: 3, dir: 1, cells: [fromAlg('d1', 8)], bornRound: 4 })];
  corrosionPhase(s);
  expect(s.purple).toContain(fromAlg('d1', 8));
  expect(s.board[fromAlg('d1', 8)]).toBeNull();
});
