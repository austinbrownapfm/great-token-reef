import { describe, expect, it } from 'vitest';
import { FISH_CAPS, FishPicks, fishPickSchema } from './fishPicks.ts';

describe('fish picks contract', () => {
  it('accepts null or a unique integer list within the cap', () => {
    expect(FishPicks.parse({ strip: null, full: [3, 1] })).toEqual({ strip: null, full: [3, 1] });
    expect(fishPickSchema('strip').safeParse(Array.from({ length: FISH_CAPS.strip }, (_, i) => i)).success).toBe(true);
  });

  it.each([
    ['duplicates', [1, 1]],
    ['non-integers', [1.5]],
    ['over cap', Array.from({ length: FISH_CAPS.strip + 1 }, (_, i) => i)],
  ])('rejects %s', (_label, species) => {
    expect(fishPickSchema('strip').safeParse(species).success).toBe(false);
  });
});
