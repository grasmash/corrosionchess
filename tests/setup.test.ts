import { it, expect } from 'vitest';
import { encodeConfig, decodeConfig } from '../src/ui/setup';

it('config token round-trips all combinations', () => {
  for (let i = 0; i < 16; i++) {
    const c = { tier1: !!(i & 1), tier2: !!(i & 2), tier3: !!(i & 4), bigBoard: !!(i & 8) };
    expect(decodeConfig(encodeConfig(c))).toEqual(c);
  }
});
