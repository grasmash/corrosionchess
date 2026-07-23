import { it, expect } from 'vitest';
import { soundEventsForTransition, currentVolume } from '../src/ui/audio';
import type { GameState } from '../src/engine/types';

/** Minimal GameState fixture -- only `log` and `result` matter to the pure
 * mapper under test, so everything else is filler that satisfies the type. */
function state(log: string[], result: GameState['result'] = null): GameState {
  return {
    size: 8,
    board: [],
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    epSquare: null,
    corrosions: [],
    purple: [],
    round: 1,
    nextId: 1,
    config: { tier1: true, tier2: true, tier3: true, bigBoard: false },
    result,
    log: log.map(text => ({ round: 1, text })),
  };
}

it('plain SAN entry with no corrosion lines -> move', () => {
  const prev = state([]);
  const next = state(['1. e4']);
  expect(soundEventsForTransition(prev, next)).toEqual(['move']);
});

it('SAN containing x -> capture', () => {
  const prev = state([]);
  const next = state(['1. exd5']);
  expect(soundEventsForTransition(prev, next)).toEqual(['capture']);
});

it('SAN ending + -> check', () => {
  const prev = state([]);
  const next = state(['1. Qh5+']);
  expect(soundEventsForTransition(prev, next)).toEqual(['check']);
});

it('new log with corrosion spawn line + SAN -> includes corrosionSpawn, not move', () => {
  const prev = state([]);
  const next = state(['1. exd4', 'Corrosion spawns at e4']);
  const events = soundEventsForTransition(prev, next);
  expect(events).toContain('corrosionSpawn');
  expect(events).not.toContain('move');
});

it('Corrosion destroys line -> corrosionKill', () => {
  const prev = state([]);
  const next = state(['1. e4', 'Corrosion destroys knight at e5']);
  expect(soundEventsForTransition(prev, next)).toContain('corrosionKill');
});

it('prev.result null, next.result winner w -> includes win', () => {
  const prev = state([], null);
  const next = state(['1-0'], { winner: 'w', reason: 'checkmate' });
  expect(soundEventsForTransition(prev, next)).toContain('win');
});

it('winner null -> includes draw', () => {
  const prev = state([], null);
  const next = state(['1/2-1/2'], { winner: null, reason: 'stalemate' });
  expect(soundEventsForTransition(prev, next)).toContain('draw');
});

it('Corrosion goes CRITICAL -> corrosionCritical, not corrosionPromote', () => {
  const prev = state([]);
  const next = state(['1. e4', 'Corrosion goes CRITICAL (class 3)']);
  const events = soundEventsForTransition(prev, next);
  expect(events).toContain('corrosionCritical');
  expect(events).not.toContain('corrosionPromote');
});

it('currentVolume clamps garbage to default 0.7 (no localStorage under node)', () => {
  expect(currentVolume()).toBe(0.7);
});
