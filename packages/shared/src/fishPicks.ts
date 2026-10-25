import { z } from 'zod';

// Hand-picked tank fish: one list of catalog entry indices per tank view, capped to keep the sim cheap.

export type FishView = 'strip' | 'full';
export const FISH_CAPS: Record<FishView, number> = { strip: 10, full: 30 };

export const fishPickSchema = (view: FishView) =>
  z.array(z.number().int())
    .max(FISH_CAPS[view])
    .refine((species) => new Set(species).size === species.length, 'species must not repeat');

export const FishPicks = z.object({
  strip: fishPickSchema('strip').nullable(),
  full: fishPickSchema('full').nullable(),
});
export type FishPicks = z.infer<typeof FishPicks>;
