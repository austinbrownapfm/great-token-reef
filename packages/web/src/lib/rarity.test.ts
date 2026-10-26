import { describe, expect, it } from 'vitest';
import { RARITIES } from './rarity';

describe('RARITIES', () => {
  it('offers every rarity, legendary first', () => {
    expect(RARITIES).toEqual(['legendary', 'epic', 'rare', 'uncommon', 'common']);
  });
});
