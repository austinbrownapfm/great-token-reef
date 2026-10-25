import { ENTRIES, LEGENDARY_DEFS, SPECIES_DEFS, isLegendary, legendaryIndex } from '@gtr/shared';

// Real relative tank sizes (reef-living-tank spec §5): log-scaled species length, grown by personal best.

const FULL_BAND: [number, number] = [50, 280];
const STRIP_BAND: [number, number] = [34, 190];
// Log domain: fish under 16 cm sit at the band floor so they stay clickable; 16 keeps a sturgeon over 3× a bluegill.
const LOG_MIN_CM = 16;
const LOG_MAX_CM = 450;
const DEFAULT_CM = 30;

/** Drawn length: juveniles look young, trophies look big. */
const displayBias = (b: 's' | 'L' | undefined) => (b === 's' ? 0.6 : b === 'L' ? 1.15 : 1);
/** Matches rollCatch's size multiplier, so growth is measured in the entry's own roll range. */
const rollBias = (b: 's' | 'L' | undefined) => (b === 's' ? 0.5 : b === 'L' ? 1.6 : 1);

export function growthFactor(entry: number, bestSize: number): number {
  const m = rollBias(ENTRIES[entry]?.b);
  const t = (bestSize - 14 * m) / (72 * m);
  return 0.85 + 0.35 * Math.min(1, Math.max(0, t));
}

// Legendaries draw past the band's ceiling: 1.05× to 1.55× it by length, so none beats 1.6× the biggest regular fish.
const LEGEND_MIN_CM = Math.min(...LEGENDARY_DEFS.map((d) => d.lengthCm));
const LEGEND_MAX_CM = Math.max(...LEGENDARY_DEFS.map((d) => d.lengthCm));

function legendaryWidth(species: number, fullscreen: boolean): number {
  const cm = LEGENDARY_DEFS[legendaryIndex(species)]!.lengthCm;
  const t = Math.log(cm / LEGEND_MIN_CM) / Math.log(LEGEND_MAX_CM / LEGEND_MIN_CM);
  return (fullscreen ? FULL_BAND : STRIP_BAND)[1] * (1.05 + 0.5 * t);
}

export function tankWidth(entry: number, bestSize: number, fullscreen: boolean): number {
  if (isLegendary(entry)) return legendaryWidth(entry, fullscreen);
  const e = ENTRIES[entry];
  const cm = (e ? SPECIES_DEFS[e.s]?.lengthCm ?? DEFAULT_CM : DEFAULT_CM) * displayBias(e?.b);
  const t = Math.min(1, Math.max(0, Math.log(cm / LOG_MIN_CM) / Math.log(LOG_MAX_CM / LOG_MIN_CM)));
  const [lo, hi] = fullscreen ? FULL_BAND : STRIP_BAND;
  return Math.min(hi, Math.max(lo, (lo + (hi - lo) * t) * growthFactor(entry, bestSize)));
}

/** 0 at the band floor, 1 at its ceiling; drives cruise speed and depth. */
export function bigness(width: number, fullscreen: boolean): number {
  const [lo, hi] = fullscreen ? FULL_BAND : STRIP_BAND;
  return (width - lo) / (hi - lo);
}
