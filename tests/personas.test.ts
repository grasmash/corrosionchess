import { describe, it, expect } from 'vitest';
import { initialState, fromAlg, fileOf, rankOf, sq, offsetOf } from '../src/engine/board';
import { legalMoves } from '../src/engine/legal';
import { applyMove } from '../src/engine/game';
import type { Config } from '../src/engine/types';
import {
  PERSONAS,
  FAMILY_PERSONAS,
  BOB_ARMY_PERSONAS,
  paramsForRating,
  choosePersonaMove,
  pickQuip,
} from '../src/ai/personas';
import type { Persona, QuipEvent } from '../src/ai/personas';

const cfg: Config = { tier1: true, tier2: true, tier3: true, bigBoard: false };
const bigCfg: Config = { tier1: true, tier2: true, tier3: true, bigBoard: true };

const QUIP_EVENTS: QuipEvent[] = [
  'start', 'botCaptures', 'botLosesPiece', 'corrosionSpawns',
  'corrosionKills', 'check', 'botWins', 'botLoses', 'idle',
];

// Seeded LCG rng so tests are deterministic (mirrors tests/bot.test.ts).
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function isLegal(state: ReturnType<typeof initialState>, move: { from: number; to: number; promotion?: unknown }): boolean {
  return legalMoves(state).some(
    m => m.from === move.from && m.to === move.to && m.promotion === move.promotion,
  );
}

describe('roster shape', () => {
  it('has exactly seven family/coach personas', () => {
    expect(FAMILY_PERSONAS.length).toBe(7);
  });

  it('includes Coach Kestony as a level-3, zero-blunder, rating-2400 coach persona', () => {
    const kestony = FAMILY_PERSONAS.find(p => p.id === 'kestony')!;
    expect(kestony).toBeDefined();
    expect(kestony.rating).toBe(2400);
    expect(kestony.level).toBe(3);
    expect(kestony.blunderChance).toBe(0);
    expect(kestony.group).toBe('coach');
  });

  it('every family persona has at least 3 quip lines for every event', () => {
    for (const p of FAMILY_PERSONAS) {
      for (const ev of QUIP_EVENTS) {
        expect(p.quips[ev].length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('every persona in the full roster has a non-empty quip list for every event', () => {
    for (const p of PERSONAS) {
      for (const ev of QUIP_EVENTS) {
        expect(p.quips[ev].length).toBeGreaterThan(0);
      }
    }
  });

  it('has 8 Bobs plus one Joe, ascending by rating with Joe between bob400 and bob600', () => {
    const ids = BOB_ARMY_PERSONAS.map(p => p.id);
    expect(ids).toEqual(['bob150', 'bob400', 'joe550', 'bob600', 'bob800', 'bob1000', 'bob1200', 'bob1500', 'bob2000']);
    const bobs = BOB_ARMY_PERSONAS.filter(p => p.name === 'Bob');
    expect(bobs.length).toBe(8);
    const joe = BOB_ARMY_PERSONAS.find(p => p.id === 'joe550')!;
    expect(joe.name).toBe('Joe');
    expect(joe.rating).toBe(550);
  });

  it('full PERSONAS roster is the 7 family/coach personas followed by the Bob army', () => {
    expect(PERSONAS.length).toBe(16);
    expect(PERSONAS.slice(0, 7)).toEqual(FAMILY_PERSONAS);
    expect(PERSONAS.slice(7)).toEqual(BOB_ARMY_PERSONAS);
  });
});

describe('paramsForRating', () => {
  it('maps <=200 to level 1', () => {
    expect(paramsForRating(150).level).toBe(1);
    expect(paramsForRating(200).level).toBe(1);
  });

  it('maps 201-900 to level 2 with blunderChance sliding 0.4 -> 0.05', () => {
    expect(paramsForRating(201).level).toBe(2);
    expect(paramsForRating(201).blunderChance).toBeCloseTo(0.4, 1);
    expect(paramsForRating(900).level).toBe(2);
    expect(paramsForRating(900).blunderChance).toBeCloseTo(0.05, 1);
  });

  it('maps >900 to level 3 with blunderChance sliding 0.05 -> 0', () => {
    expect(paramsForRating(901).level).toBe(3);
    expect(paramsForRating(901).blunderChance).toBeCloseTo(0.05, 1);
    expect(paramsForRating(2000).level).toBe(3);
    expect(paramsForRating(2000).blunderChance).toBeCloseTo(0, 1);
  });

  it('is monotonically non-increasing in blunderChance within each level band', () => {
    // Level 1's blunderChance is a fixed 0 (the level itself is already
    // uniform-random, so the field is moot) -- only levels 2 and 3 slide.
    const level2Ratings = [201, 400, 600, 800, 900];
    const level2Chances = level2Ratings.map(r => paramsForRating(r).blunderChance);
    for (let i = 1; i < level2Chances.length; i++) {
      expect(level2Chances[i]).toBeLessThanOrEqual(level2Chances[i - 1] + 1e-9);
    }

    const level3Ratings = [901, 1000, 1200, 1500, 2000];
    const level3Chances = level3Ratings.map(r => paramsForRating(r).blunderChance);
    for (let i = 1; i < level3Chances.length; i++) {
      expect(level3Chances[i]).toBeLessThanOrEqual(level3Chances[i - 1] + 1e-9);
    }
  });
});

describe('choosePersonaMove', () => {
  it('always returns a legal move over 20 plies, for a level-1, level-2, and level-3 persona', () => {
    const reps = [
      FAMILY_PERSONAS.find(p => p.id === 'toby')!,  // level 1
      FAMILY_PERSONAS.find(p => p.id === 'mom')!,   // level 2
      FAMILY_PERSONAS.find(p => p.id === 'theo')!,  // level 3
    ];
    for (const persona of reps) {
      let state = initialState(cfg);
      const rng = seededRng(persona.rating + 7);
      for (let i = 0; i < 20 && !state.result; i++) {
        const move = choosePersonaMove(state, persona, rng);
        expect(isLegal(state, move)).toBe(true);
        state = applyMove(state, move);
      }
    }
  });

  it('always returns a legal move on the big board too', () => {
    const theo = FAMILY_PERSONAS.find(p => p.id === 'theo')!;
    let state = initialState(bigCfg);
    const rng = seededRng(99);
    for (let i = 0; i < 10 && !state.result; i++) {
      const move = choosePersonaMove(state, theo, rng);
      expect(isLegal(state, move)).toBe(true);
      state = applyMove(state, move);
    }
  });

  it("Bella plays e2e4 then Qh5 when rng forces the opening book", () => {
    const bella = FAMILY_PERSONAS.find(p => p.id === 'bella')!;
    const rng = () => 0; // always under prob/blunderChance; opening scan wins first
    let state = initialState(cfg);

    const m1 = choosePersonaMove(state, bella, rng);
    expect(m1).toEqual({ from: fromAlg('e2', 8), to: fromAlg('e4', 8) });
    state = applyMove(state, m1);

    // Any legal Black reply that isn't itself in Bella's book -- we only
    // need Bella (White) to move again next.
    const blackReply = legalMoves(state)[0];
    state = applyMove(state, blackReply);

    const m2 = choosePersonaMove(state, bella, rng);
    expect(m2).toEqual({ from: fromAlg('d1', 8), to: fromAlg('h5', 8) });
  });

  it('a blunderChance=1 persona can return any legal move, not just the best one', () => {
    const persona: Persona = {
      id: 'test-blunderer',
      name: 'Test',
      rating: 0,
      tagline: '',
      avatar: '',
      level: 2,
      blunderChance: 1,
      group: 'family',
      quips: {
        start: ['x'], botCaptures: ['x'], botLosesPiece: ['x'], corrosionSpawns: ['x'],
        corrosionKills: ['x'], check: ['x'], botWins: ['x'], botLoses: ['x'], idle: ['x'],
      },
    };
    const state = initialState(cfg);
    const seen = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const rng = seededRng(seed);
      const move = choosePersonaMove(state, persona, rng);
      expect(isLegal(state, move)).toBe(true);
      seen.add(`${move.from}-${move.to}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('translates Bella\'s opening squares by the board offset on the 12x12 board', () => {
    const bella = FAMILY_PERSONAS.find(p => p.id === 'bella')!;
    const state = initialState(bigCfg);
    const rng = () => 0;
    const move = choosePersonaMove(state, bella, rng);

    const off = offsetOf(12);
    const e2 = fromAlg('e2', 8);
    const e4 = fromAlg('e4', 8);
    const expectedFrom = sq(fileOf(e2, 8) + off, rankOf(e2, 8) + off, 12);
    const expectedTo = sq(fileOf(e4, 8) + off, rankOf(e4, 8) + off, 12);

    expect(move).toEqual({ from: expectedFrom, to: expectedTo });
  });
});

describe('pickQuip', () => {
  it('returns one of the lines for the given event, deterministically for a given rng', () => {
    const toby = FAMILY_PERSONAS.find(p => p.id === 'toby')!;
    const line = pickQuip(toby, 'start', () => 0);
    expect(toby.quips.start).toContain(line);
    expect(line).toBe(toby.quips.start[0]);
  });

  it('the Bobs all share the same quip pool (the joke is that they are identical)', () => {
    const bobs = BOB_ARMY_PERSONAS.filter(p => p.name === 'Bob');
    const first = bobs[0].quips;
    for (const bob of bobs.slice(1)) {
      expect(bob.quips).toEqual(first);
    }
  });
});
