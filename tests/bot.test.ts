import { describe, it, expect } from 'vitest';
import { initialState, fromAlg } from '../src/engine/board';
import { legalMoves } from '../src/engine/legal';
import { applyMove } from '../src/engine/game';
import type { GameState, Config } from '../src/engine/types';
import { chooseBotMove, evaluate } from '../src/ai/bot';

const cfg: Config = { tier1: true, tier2: true, tier3: true, bigBoard: false };
const bigCfg: Config = { tier1: true, tier2: true, tier3: true, bigBoard: true };

const empty = (config: Config): GameState => {
  const s = initialState(config);
  s.board = s.board.map(() => null);
  return s;
};
const put = (s: GameState, a: string, color: 'w' | 'b', type: any) => {
  s.board[fromAlg(a, s.size)] = { color, type };
};

// Seeded LCG rng so tests are deterministic.
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe('chooseBotMove level 1 (Rusty)', () => {
  it('returns a legal move on the initial position (small board)', () => {
    const s = initialState(cfg);
    const rng = seededRng(1);
    for (let i = 0; i < 10; i++) {
      const move = chooseBotMove(s, 1, rng);
      const legal = legalMoves(s);
      expect(legal.some(m => m.from === move.from && m.to === move.to && m.promotion === move.promotion)).toBe(true);
    }
  });

  it('returns a legal move on the initial position (big board)', () => {
    const s = initialState(bigCfg);
    const rng = seededRng(2);
    for (let i = 0; i < 10; i++) {
      const move = chooseBotMove(s, 1, rng);
      const legal = legalMoves(s);
      expect(legal.some(m => m.from === move.from && m.to === move.to && m.promotion === move.promotion)).toBe(true);
    }
  });
});

describe('chooseBotMove level 2 (Corrode)', () => {
  it('takes a hanging queen', () => {
    const s = empty(cfg);
    put(s, 'a1', 'w', 'k');
    put(s, 'h8', 'b', 'k');
    put(s, 'd1', 'w', 'r');
    put(s, 'd8', 'b', 'q');
    const move = chooseBotMove(s, 2, seededRng(3));
    expect(move.from).toBe(fromAlg('d1', 8));
    expect(move.to).toBe(fromAlg('d8', 8));
  });

  it('avoids a suicidal corrosion capture when a neutral move is better', () => {
    const s = empty(cfg);
    put(s, 'a1', 'w', 'k');
    put(s, 'h8', 'b', 'k');
    put(s, 'd4', 'w', 'r');
    // Enemy corrosion cell sits at d6; the only rook could capture it but
    // (per legal.ts's resolveCorrosionCapture) a non-king mover capturing a
    // hostile corrosion cell is destroyed for nothing in return.
    s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('d6', 8)], dir: -1, bornRound: 0 }];
    const move = chooseBotMove(s, 2, seededRng(4));
    expect(move.to).not.toBe(fromAlg('d6', 8));
  });
});

describe('chooseBotMove level 3 (Meltdown)', () => {
  it('retreats the queen off a square an enemy class-1 corrosion cell marches onto next phase', () => {
    const s = empty(cfg);
    s.round = 2;
    put(s, 'a1', 'w', 'k');
    put(s, 'd4', 'w', 'q');
    put(s, 'h8', 'b', 'k');
    // Enemy (black) class-1 corrosion at d3, marching dir +1 (toward higher
    // ranks) will land on d4 -- exactly where the white queen stands -- at
    // the next corrosion phase (after black's reply move).
    s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('d3', 8)], dir: 1, bornRound: 1 }];
    const move = chooseBotMove(s, 3, seededRng(5));
    expect(move.from).toBe(fromAlg('d4', 8));
    expect(move.to).not.toBe(fromAlg('d4', 8));

    // Confirm the danger was real: if the queen stayed at d4, black's reply
    // would trigger the corrosion phase and destroy it.
    const stayed = empty(cfg);
    stayed.round = 2;
    put(stayed, 'a1', 'w', 'k');
    put(stayed, 'd4', 'w', 'q');
    put(stayed, 'h8', 'b', 'k');
    stayed.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('d3', 8)], dir: 1, bornRound: 1 }];
    const afterKingMove = applyMove(stayed, { from: fromAlg('a1', 8), to: fromAlg('a2', 8) });
    const afterBlackReply = applyMove(afterKingMove, { from: fromAlg('h8', 8), to: fromAlg('g8', 8) });
    expect(afterBlackReply.board[fromAlg('d4', 8)]).toBeNull();
  });
});

describe('chooseBotMove: legality property test (all levels)', () => {
  for (const level of [1, 2, 3] as const) {
    it(`level ${level}: every chosen move is legal across 20 self-played plies`, () => {
      let s = initialState(cfg);
      const rng = seededRng(100 + level);
      for (let i = 0; i < 20; i++) {
        if (s.result) break;
        const legal = legalMoves(s);
        expect(legal.length).toBeGreaterThan(0);
        // Level 3 defaults to a 1500ms soft budget per move, which would
        // make 20 plies of self-play flirt with vitest's test timeout on
        // slow CI; a much smaller budget is plenty to exercise the search
        // and its legality guarantees without the real-world time cost.
        const move = chooseBotMove(s, level, rng, { timeBudgetMs: 150 });
        expect(legal.some(m => m.from === move.from && m.to === move.to && m.promotion === move.promotion)).toBe(true);
        s = applyMove(s, move);
      }
    }, 20000);
  }
});

describe('evaluate', () => {
  it('scores material advantage in favor of the side up material', () => {
    const s = empty(cfg);
    put(s, 'a1', 'w', 'k');
    put(s, 'h8', 'b', 'k');
    put(s, 'd1', 'w', 'q');
    expect(evaluate(s, 'w')).toBeGreaterThan(evaluate(s, 'b'));
  });

  it('penalizes a piece standing on a square a hostile corrosion cell will hit next phase', () => {
    const withoutThreat = empty(cfg);
    put(withoutThreat, 'a1', 'w', 'k');
    put(withoutThreat, 'h8', 'b', 'k');
    put(withoutThreat, 'd4', 'w', 'r');

    const withThreat = empty(cfg);
    put(withThreat, 'a1', 'w', 'k');
    put(withThreat, 'h8', 'b', 'k');
    put(withThreat, 'd4', 'w', 'r');
    withThreat.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('d3', 8)], dir: 1, bornRound: 1 }];

    expect(evaluate(withThreat, 'w')).toBeLessThan(evaluate(withoutThreat, 'w'));
  });

  it('does not penalize a king on a threatened square, unlike a non-king piece on another threatened square', () => {
    // A king's material value is 0, so a king-only board can't distinguish
    // "king exempt" from "king penalized" (0 discounted is still 0) -- add a
    // knight on its own threatened square as a witness: if the king
    // exemption guard were dropped or inverted, this delta would drift from
    // the knight-only discount below.
    const baseline = empty(cfg);
    put(baseline, 'd4', 'w', 'k');
    put(baseline, 'g6', 'w', 'n');
    put(baseline, 'a8', 'b', 'k');

    const withThreats = empty(cfg);
    put(withThreats, 'd4', 'w', 'k');
    put(withThreats, 'g6', 'w', 'n');
    put(withThreats, 'a8', 'b', 'k');
    withThreats.corrosions = [
      { id: 1, color: 'b', cls: 1, cells: [fromAlg('d3', 8)], dir: 1, bornRound: 1 }, // marches onto the king's d4
      { id: 2, color: 'b', cls: 1, cells: [fromAlg('g5', 8)], dir: 1, bornRound: 1 }, // marches onto the knight's g6
    ];

    const delta = evaluate(baseline, 'w') - evaluate(withThreats, 'w');
    expect(delta).toBeCloseTo(3 * 0.6, 5); // only the knight's value (3) takes the ~60% hit
  });
});

describe('chooseBotMove: guards', () => {
  it('throws when the game already has a result', () => {
    const s = initialState(cfg);
    s.result = { winner: 'w', reason: 'checkmate' };
    expect(() => chooseBotMove(s, 1)).toThrow();
  });
});
