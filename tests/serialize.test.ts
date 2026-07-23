import { it, expect } from 'vitest';
import { newGame, applyMove } from '../src/engine/game';
import { legalMoves } from '../src/engine/legal';

const cfg = { tier1: true, tier2: true, tier3: true, bigBoard: true };

it('JSON round-trip preserves state and remains playable', () => {
  let s = newGame(cfg);
  const revived = JSON.parse(JSON.stringify(s));
  expect(revived).toEqual(s);
  expect(() => applyMove(revived, legalMoves(revived)[0])).not.toThrow();
});

it('replay determinism: same moves → same state (150 plies of first-legal-move)', () => {
  const play = () => {
    let s = newGame(cfg);
    const moves = [];
    for (let i = 0; i < 150 && !s.result; i++) {
      const ms = legalMoves(s);
      const m = ms[i % ms.length];   // deterministic pseudo-variety
      moves.push(m);
      s = applyMove(s, m);
    }
    return { s, moves };
  };
  const a = play();
  let b = newGame(cfg);
  for (const m of a.moves) b = applyMove(b, m);
  expect(JSON.stringify(b)).toBe(JSON.stringify(a.s));
});
