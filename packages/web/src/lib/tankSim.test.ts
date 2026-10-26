import { describe, expect, it } from 'vitest';
import { depthFor } from './tankHabits';
import {
  DART_FACTOR,
  FLAKE_TTL_LANDED,
  MAX_FLAKES,
  SPEED_MAX_FACTOR,
  SPEED_MIN_FACTOR,
  TURN_SECONDS,
  dropFood,
  easeWag,
  hold,
  quantizeWag,
  mouthOf,
  isGone,
  rescale,
  ceilingOf,
  depthY,
  puff,
  spawn,
  spawnDropIn,
  step,
  swimOff,
  transformOf,
  type Bounds,
  type Swimmer,
  type SwimmerSpec,
  type World,
} from './tankSim';

// Deterministic rng (mulberry32) so failures reproduce.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bounds: Bounds = { width: 1200, height: 224 };
const specs: SwimmerSpec[] = Array.from({ length: 12 }, (_, i) => ({
  id: `f${i}`,
  width: 90 + (i % 4) * 30,
  cruise: 40 + (i % 5) * 15,
  depth: [0.1 + (i % 3) * 0.2, 0.3 + (i % 3) * 0.2],
  hoverBias: (i % 3) / 2,
  dartBias: (i % 2),
}));

function run(seconds: number, seed = 1, dt = 1 / 60, onStep?: (s: Swimmer[], now: number) => void): Swimmer[] {
  const r = rng(seed);
  const fish = spawn(specs, bounds, r, 0);
  let now = 0;
  for (let i = 0; i < seconds / dt; i++) {
    now += dt;
    step(fish, bounds, dt, r, now);
    onStep?.(fish, now);
  }
  return fish;
}

describe('tankSim', () => {
  it('keeps every fish inside the tank for a minute', () => {
    // One assertion at the end: 3,600 frames of per-fish expects made this test flake on timeout.
    let worst = 0;
    run(60, 7, 1 / 60, (fish) => {
      for (const s of fish) {
        worst = Math.max(
          worst,
          -(s.x - s.width / 2) - 0.001,
          s.x + s.width / 2 - bounds.width - 0.001,
          -(s.y - s.height / 2) - 0.001,
          s.y + s.height / 2 - bounds.height,
        );
      }
    });
    expect(worst).toBeLessThanOrEqual(0);
  });

  it('keeps speed goals inside the clamp, allowing the dart burst', () => {
    run(60, 3, 1 / 60, (fish) => {
      for (const s of fish) {
        const hi = s.mode === 'dart' ? s.cruise * DART_FACTOR : s.cruise * SPEED_MAX_FACTOR;
        expect(s.target).toBeLessThanOrEqual(hi + 1e-9);
        if (s.mode === 'cruise') expect(s.target).toBeGreaterThanOrEqual(s.cruise * SPEED_MIN_FACTOR - 1e-9);
      }
    });
  });

  it('varies speed over time rather than cruising at one value', () => {
    const seen = new Map<string, Set<number>>();
    run(30, 5, 1 / 60, (fish) => {
      for (const s of fish) {
        const set = seen.get(s.id) ?? new Set<number>();
        set.add(Math.round(Math.abs(s.vx) / 5));
        seen.set(s.id, set);
      }
    });
    for (const set of seen.values()) expect(set.size).toBeGreaterThan(3);
  });

  it('turns by decelerating and passing scaleX through zero, never snapping', () => {
    let turns = 0;
    let minAbsFlip = 1;
    const prevFlip = new Map<string, number>();
    run(120, 11, 1 / 60, (fish) => {
      for (const s of fish) {
        const prev = prevFlip.get(s.id);
        if (prev !== undefined) expect(Math.abs(s.flip - prev)).toBeLessThan(0.3);
        prevFlip.set(s.id, s.flip);
        if (s.mode === 'turn') {
          minAbsFlip = Math.min(minAbsFlip, Math.abs(s.flip));
          expect(s.target).toBeLessThanOrEqual(s.cruise * 0.2 + 1e-9);
        }
      }
    });
    run(120, 11, 1 / 60, (fish, now) => {
      for (const s of fish) if (s.mode === 'turn' && Math.abs(now - s.turnStart) < 1 / 60) turns++;
    });
    expect(turns).toBeGreaterThan(5);
    expect(minAbsFlip).toBeLessThan(0.15);
  });

  it('completes a turn in TURN_SECONDS and ends facing the other way', () => {
    const r = rng(2);
    const [s] = spawn([specs[0]!], { width: 300, height: 224 }, r, 0);
    // Park the fish at the right wall heading right so a turn must begin.
    s!.heading = 1;
    s!.flip = -1;
    s!.x = 290 - s!.width / 2;
    s!.mode = 'cruise';
    s!.modeUntil = 999;
    let now = 0;
    step([s!], { width: 300, height: 224 }, 1 / 60, r, (now += 1 / 60));
    expect(s!.mode).toBe('turn');
    for (let i = 0; i < Math.ceil(TURN_SECONDS * 60) + 2; i++) step([s!], { width: 300, height: 224 }, 1 / 60, r, (now += 1 / 60));
    expect(s!.mode).not.toBe('turn');
    expect(s!.heading).toBe(-1);
    expect(s!.flip).toBe(1);
  });

  it('caps a huge dt so a backgrounded tab does not launch fish', () => {
    const r = rng(9);
    const fish = spawn(specs, bounds, r, 0);
    const before = fish.map((s) => s.x);
    step(fish, bounds, 30, r, 30);
    fish.forEach((s, i) => expect(Math.abs(s.x - before[i]!)).toBeLessThan(20));
  });

  it('renders a transform that flips the left-facing art for a right-heading fish', () => {
    const r = rng(4);
    const [s] = spawn([specs[0]!], bounds, r, 0);
    s!.heading = 1;
    s!.flip = -1;
    expect(transformOf(s!)).toMatch(/scaleX\(-1\.000\)$/);
  });

  it('hold pins a fish into hover until released', () => {
    const r = rng(6);
    const [s] = spawn([specs[1]!], bounds, r, 0);
    hold(s!, true, 0);
    let now = 0;
    for (let i = 0; i < 600; i++) step([s!], bounds, 1 / 60, r, (now += 1 / 60));
    expect(s!.mode).toBe('hover');
    expect(Math.abs(s!.vx)).toBeLessThan(s!.cruise * 0.2);
    hold(s!, false, now);
    for (let i = 0; i < 120; i++) step([s!], bounds, 1 / 60, r, (now += 1 / 60));
    expect(s!.modeUntil).not.toBe(Number.POSITIVE_INFINITY);
  });

  it('without a world, step behaves as before', () => {
    const plain = run(20, 13);
    const r = rng(13);
    const fish = spawn(specs, bounds, r, 0);
    const world: World = { current: 0, flakes: [] };
    let now = 0;
    for (let i = 0; i < 20 * 60; i++) {
      now += 1 / 60;
      const events = step(fish, bounds, 1 / 60, r, now, world);
      expect(events.eaten).toEqual([]);
    }
    fish.forEach((s, i) => {
      expect(s.x).toBe(plain[i]!.x);
      expect(s.y).toBe(plain[i]!.y);
    });
  });

  it('fish stay in bounds under a strong current', () => {
    const many: SwimmerSpec[] = Array.from({ length: 20 }, (_, i) => ({ ...specs[i % specs.length]!, id: `c${i}` }));
    const r = rng(21);
    const fish = spawn(many, bounds, r, 0);
    const world: World = { current: 30, flakes: [] };
    let now = 0;
    // One assertion at the end: 288k expect() calls overran the timeout on CI runners.
    let escaped: string | null = null;
    for (let i = 0; i < 60 * 60 && !escaped; i++) {
      now += 1 / 60;
      step(fish, bounds, 1 / 60, r, now, world);
      for (const s of fish) {
        if (s.x - s.width / 2 < -0.001 || s.x + s.width / 2 > bounds.width + 0.001
          || s.y - s.height / 2 < -0.001 || s.y + s.height / 2 > bounds.height) {
          escaped = `${s.id} at frame ${i}: x=${s.x} y=${s.y}`;
          break;
        }
      }
    }
    expect(escaped).toBeNull();
  });

  it('fish swimming against the current still make headway', () => {
    const swim = (current: number | null) => {
      const r = rng(8);
      const [s] = spawn([{ ...specs[0]!, cruise: 60 }], bounds, r, 0);
      s!.x = 700;
      s!.heading = -1;
      s!.flip = 1;
      s!.vx = -60;
      s!.target = 60;
      s!.mode = 'cruise';
      s!.modeUntil = 999;
      const world: World | undefined = current === null ? undefined : { current, flakes: [] };
      let now = 0;
      for (let i = 0; i < 120; i++) step([s!], bounds, 1 / 60, r, (now += 1 / 60), world);
      return s!;
    };
    const still = swim(null);
    const against = swim(18);
    expect(against.heading).toBe(-1);
    expect(against.x).toBeLessThan(700);
    // Upstream, just slower: roughly current × 2s less distance covered.
    expect(700 - against.x).toBeLessThan(700 - still.x - 30);
  });

  describe('feeding', () => {
    const flakeAt = (x: number, y: number, id = 1) => ({ id, x, y, phase: 0, bornAt: -10, landedAt: null });
    const cruiser = (x: number, y: number, heading: 1 | -1, seed = 30): Swimmer => {
      const [s] = spawn([{ ...specs[0]!, hoverBias: 0 }], bounds, rng(seed), 0);
      s!.x = x;
      s!.y = y;
      s!.heading = heading;
      s!.flip = -heading;
      s!.vx = s!.cruise * heading;
      s!.mode = 'cruise';
      s!.modeUntil = 999;
      return s!;
    };

    it('dropFood adds 3-5 flakes and respects the cap', () => {
      for (let seed = 1; seed <= 20; seed++) {
        const world: World = { current: 0, flakes: [] };
        const added = dropFood(world, 300, 100, rng(seed), 5);
        expect(added).toBeGreaterThanOrEqual(3);
        expect(added).toBeLessThanOrEqual(5);
        expect(world.flakes).toHaveLength(added);
        for (const f of world.flakes) {
          expect(Math.abs(f.x - 300)).toBeLessThanOrEqual(12);
          expect(Math.abs(f.y - 100)).toBeLessThanOrEqual(12);
          expect(f.bornAt).toBe(5);
          expect(f.landedAt).toBeNull();
        }
        expect(new Set(world.flakes.map((f) => f.id)).size).toBe(added);
      }
      const world: World = { current: 0, flakes: [] };
      const r = rng(3);
      for (let i = 0; i < 10; i++) dropFood(world, 300, 100, r, 0);
      expect(world.flakes).toHaveLength(MAX_FLAKES);
      expect(dropFood(world, 300, 100, r, 0)).toBe(0);
      expect(world.flakes).toHaveLength(MAX_FLAKES);
    });

    it('a flake is eaten exactly once when two fish reach it together', () => {
      const a = cruiser(500, 100, 1, 31);
      const b = cruiser(500, 100, 1, 32);
      const m = mouthOf(a);
      const world: World = { current: 0, flakes: [flakeAt(m.x + 2, m.y)] };
      const events = step([a, b], bounds, 1 / 60, rng(33), 1, world);
      expect(events.eaten).toHaveLength(1);
      expect(world.flakes).toHaveLength(0);
      const again = step([a, b], bounds, 1 / 60, rng(34), 1 + 1 / 60, world);
      expect(again.eaten).toHaveLength(0);
    });

    it('a feeding fish reverses only through a turn', () => {
      const s = cruiser(600, 100, 1);
      const world: World = { current: 0, flakes: [flakeAt(420, 100)] };
      const r = rng(35);
      let now = 0;
      let sawFeedOrTurn = false;
      let minAbsFlip = 1;
      let reversed = false;
      for (let i = 0; i < 240 && !reversed; i++) {
        step([s], bounds, 1 / 60, r, (now += 1 / 60), world);
        if (s.mode === 'turn') {
          sawFeedOrTurn = true;
          minAbsFlip = Math.min(minAbsFlip, Math.abs(s.flip));
        }
        if (s.heading === -1) {
          reversed = true;
          expect(s.mode).toBe('turn');
        }
      }
      expect(reversed).toBe(true);
      expect(sawFeedOrTurn).toBe(true);
      expect(minAbsFlip).toBeLessThan(0.2);
      // After the turn it chases the flake.
      for (let i = 0; i < 30; i++) step([s], bounds, 1 / 60, r, (now += 1 / 60), world);
      expect(['feed', 'turn']).toContain(s.mode);
    });

    it('fish outside the radius ignore food', () => {
      const s = cruiser(100, 100, -1);
      const world: World = { current: 0, flakes: [flakeAt(1100, 60)] };
      const r = rng(36);
      let now = 0;
      for (let i = 0; i < 60; i++) {
        step([s], bounds, 1 / 60, r, (now += 1 / 60), world);
        expect(s.mode).not.toBe('feed');
      }
      expect(world.flakes).toHaveLength(1);
    });

    it('a fish chases a nearby flake and eats it', () => {
      const s = cruiser(300, 100, 1);
      const world: World = { current: 0, flakes: [flakeAt(480, 80)] };
      const r = rng(37);
      let now = 0;
      let eaten = 0;
      for (let i = 0; i < 600 && world.flakes.length; i++) {
        eaten += step([s], bounds, 1 / 60, r, (now += 1 / 60), world).eaten.length;
      }
      expect(eaten).toBe(1);
      expect(world.flakes).toHaveLength(0);
    });

    it('landed flakes dissolve after the TTL', () => {
      const world: World = { current: 0, flakes: [flakeAt(300, bounds.height - 30)] };
      const r = rng(38);
      let now = 0;
      for (let i = 0; i < 600 && world.flakes[0]!.landedAt === null; i++) step([], bounds, 1 / 60, r, (now += 1 / 60), world);
      const landedAt = world.flakes[0]!.landedAt;
      expect(landedAt).not.toBeNull();
      if (landedAt === null) return;
      expect(world.flakes[0]!.y).toBe(bounds.height - 20);
      while (now < landedAt + FLAKE_TTL_LANDED - 0.1) step([], bounds, 1 / 60, r, (now += 1 / 60), world);
      expect(world.flakes).toHaveLength(1);
      for (let i = 0; i < 12; i++) step([], bounds, 1 / 60, r, (now += 1 / 60), world);
      expect(world.flakes).toHaveLength(0);
    });

    it('a held fish does not chase food', () => {
      const s = cruiser(500, 100, 1);
      hold(s, true, 0);
      const world: World = { current: 0, flakes: [flakeAt(600, 100)] };
      const r = rng(39);
      let now = 0;
      for (let i = 0; i < 120; i++) {
        step([s], bounds, 1 / 60, r, (now += 1 / 60), world);
        expect(s.mode).toBe('hover');
      }
      expect(world.flakes).toHaveLength(1);
    });
  });

  describe('puff', () => {
    it('scales the fish 1.35x for 3s, then returns to normal', () => {
      const [s] = spawn([specs[0]!], bounds, rng(50), 0);
      expect(transformOf(s!, 10)).not.toMatch(/scale\(/);
      puff(s!, 10);
      expect(s!.puffUntil).toBe(13);
      expect(transformOf(s!, 11)).toMatch(/scale\(1\.350\) scaleX/);
      expect(transformOf(s!, 12.5)).toMatch(/scale\(1\.350\) scaleX/);
      expect(transformOf(s!, 13.1)).not.toMatch(/scale\(/);
    });

    it('a puffed fish slows down', () => {
      const [s] = spawn([{ ...specs[0]!, habit: 'puffer' }], bounds, rng(51), 0);
      s!.mode = 'cruise';
      s!.modeUntil = 999;
      puff(s!, 0);
      const r = rng(52);
      let now = 0;
      for (let i = 0; i < 90; i++) step([s!], bounds, 1 / 60, r, (now += 1 / 60));
      expect(Math.abs(s!.vx)).toBeLessThan(s!.cruise * 0.3);
    });
  });

  describe('release', () => {
    it('a dropped-in fish reaches its band and cruises within 3s', () => {
      const spec = specs[5]!;
      const r = rng(41);
      const s = spawnDropIn(spec, bounds, 400, r, 0);
      expect(s.mode).toBe('drop');
      expect(s.y + s.height / 2).toBeLessThanOrEqual(0);
      expect(s.pitch).toBeGreaterThan(45);
      const school = spawn(specs.slice(0, 4), bounds, r, 0);
      let now = 0;
      let cruisingAt: number | null = null;
      while (now < 3 && cruisingAt === null) {
        step([s, ...school], bounds, 1 / 60, r, (now += 1 / 60));
        if (s.mode !== 'drop') cruisingAt = now;
      }
      expect(cruisingAt).not.toBeNull();
      expect(s.mode).toBe('cruise');
      expect(s.y).toBeGreaterThanOrEqual(bounds.height * spec.depth[0]);
      expect(s.y).toBeLessThanOrEqual(bounds.height * spec.depth[1]);
      for (let i = 0; i < 60; i++) step([s, ...school], bounds, 1 / 60, r, (now += 1 / 60));
      expect(Math.abs(s.pitch)).toBeLessThan(1);
    });

    it('a leaving fish exits and reports gone', () => {
      const r = rng(43);
      // Start near the left wall heading right, so it must turn round to leave by the nearer side.
      const [s] = spawn([specs[2]!], bounds, r, 0);
      s!.x = 200;
      s!.heading = 1;
      s!.flip = -1;
      swimOff(s!, bounds, 0);
      expect(s!.heading).toBe(-1);
      expect(isGone(s!, bounds)).toBe(false);
      let now = 0;
      while (now < 20 && !isGone(s!, bounds)) {
        step([s!], bounds, 1 / 60, r, (now += 1 / 60), { current: 0, flakes: [] });
        expect(s!.mode).toBe('leave');
      }
      expect(isGone(s!, bounds)).toBe(true);
      expect(s!.x + s!.width / 2).toBeLessThan(0);
    });

    it('a fish sent off mid-turn finishes its flip', () => {
      const r = rng(44);
      // Past the midpoint of a right-to-left turn near the left wall: already heading the exit way, half flipped.
      const [s] = spawn([specs[2]!], bounds, r, 0);
      s!.x = 200;
      s!.mode = 'turn';
      s!.turnFrom = 1;
      s!.heading = -1;
      s!.flip = 0.3;
      swimOff(s!, bounds, 0);
      let now = 0;
      let prev = s!.flip;
      let flipped = false;
      while (now < 20 && !isGone(s!, bounds)) {
        step([s!], bounds, 1 / 60, r, (now += 1 / 60), { current: 0, flakes: [] });
        expect(Math.abs(s!.flip - prev)).toBeLessThan(0.3);
        prev = s!.flip;
        if (Math.abs(s!.flip) >= 1 - 1e-9) flipped = true;
      }
      expect(isGone(s!, bounds)).toBe(true);
      expect(flipped).toBe(true);
    });
  });

  describe('tail beat', () => {
    it('eases toward the target rate instead of jumping', () => {
      const next = easeWag(1, 2.5, 1 / 60);
      expect(next).toBeGreaterThan(1);
      expect(next).toBeLessThan(1.1);
      let r = 1;
      for (let i = 0; i < 180; i++) r = easeWag(r, 2.5, 1 / 60);
      expect(r).toBeCloseTo(2.5, 1);
    });

    it('never drops below the slowest beat', () => {
      expect(easeWag(0.3, 0, 1)).toBeGreaterThanOrEqual(0.3);
      expect(quantizeWag(0.1)).toBe(0.3);
    });

    it('steps the applied beat rate in small increments even through darts and turns', () => {
      const rates = new Map<string, number>();
      const applied = new Map<string, number>();
      let worst = 0;
      const dt = 1 / 60;
      run(30, 3, dt, (fish) => {
        for (const s of fish) {
          const r = easeWag(rates.get(s.id) ?? Math.max(0.3, s.wag), s.wag, dt);
          rates.set(s.id, r);
          const q = quantizeWag(r);
          const prev = applied.get(s.id);
          if (prev !== undefined) worst = Math.max(worst, Math.abs(q - prev));
          applied.set(s.id, q);
        }
      });
      expect(worst).toBeLessThanOrEqual(0.1 + 1e-9);
    });
  });
});

describe('fullscreen top band', () => {
  const tall: Bounds = { width: 1600, height: 900, floor: 44, top: 180 };
  const pelagic = (i: number): SwimmerSpec => ({
    id: `p${i}`, width: 120 + (i % 3) * 60, cruise: 70 + (i % 4) * 10, depth: [0.08, 0.35], hoverBias: 0.2, dartBias: 0.6, habit: 'pelagic',
  });

  it('no open-ocean swimmer steers above the band, even with food at the surface', () => {
    // Steering targets, not positions: the end-of-step clamp would hide a fish aiming above the band.
    let fed = 0;
    for (const seed of [71, 72, 73]) {
      const r = rng(seed);
      const fish = spawn(Array.from({ length: 6 }, (_, i) => pelagic(i)), tall, r, 0);
      fish.push(spawnDropIn(pelagic(9), tall, 800, r, 0));
      const world: World = { current: 0, flakes: [] };
      let now = 0;
      for (let i = 0; i < 90 * 60; i++) {
        now += 1 / 60;
        if (i % 600 === 0) dropFood(world, 200 + (i % 1200), 40, r, now);
        // Before the step: a flake eaten this step is gone after it. A flake sinks well under 1px a step.
        const underBand = world.flakes.some((f) => f.landedAt === null && f.y >= ceilingOf(pelagic(0), tall) - 1);
        step(fish, tall, 1 / 60, r, now, world);
        for (const s of fish) {
          if (s.mode === 'drop') continue;
          // Feeding is only ever on food that has sunk under the band.
          if (s.mode === 'feed') {
            fed++;
            expect(underBand).toBe(true);
          }
          // The home band the fish bobs around starts under the band.
          expect(depthY(s, tall, s.depth[0]) - s.liftPx - s.height / 2).toBeGreaterThanOrEqual(tall.top! - 1e-6);
        }
      }
    }
    expect(fed).toBeGreaterThan(0);
  });

  it('a vertical goal above the band is lifted under it before the fish steers to it', () => {
    const r = rng(77);
    const [s] = spawn([pelagic(0)], tall, r, 0);
    let now = 0;
    hold(s!, true, now);
    s!.goalY = 0;
    step([s!], tall, 1 / 60, r, (now += 1 / 60));
    expect(s!.goalY).toBe(tall.top! + s!.height / 2);
    for (let i = 0; i < 10 * 60; i++) step([s!], tall, 1 / 60, r, (now += 1 / 60));
    expect(s!.y - s!.height / 2).toBeCloseTo(tall.top!, 0);
  });

  it('the end-of-step clamp holds every open-ocean swimmer under the band', () => {
    const r = rng(71);
    const fish = spawn(Array.from({ length: 6 }, (_, i) => pelagic(i)), tall, r, 0);
    const world: World = { current: 0, flakes: [] };
    let now = 0;
    for (let i = 0; i < 30 * 60; i++) {
      now += 1 / 60;
      if (i % 600 === 0) dropFood(world, 200 + (i % 1200), 40, r, now);
      step(fish, tall, 1 / 60, r, now, world);
      for (const s of fish) expect(s.y - s.height / 2).toBeGreaterThanOrEqual(tall.top! - 1e-6);
    }
  });

  it('steering, not just the end-of-step clamp, keeps them under: drop-ins hand over below it and fish are rarely pinned to it', () => {
    const r = rng(76);
    const fish = spawn(Array.from({ length: 6 }, (_, i) => pelagic(i)), tall, r, 0);
    const world: World = { current: 0, flakes: [] };
    let pinned = 0;
    let n = 0;
    let handovers = 0;
    let now = 0;
    for (let i = 0; i < 90 * 60; i++) {
      now += 1 / 60;
      if (i % 900 === 0) fish.push(spawnDropIn(pelagic(20 + i), tall, 300 + (i % 1000), r, now));
      if (i % 600 === 300) dropFood(world, 200 + (i % 1200), 40, r, now);
      const dropping = new Set(fish.filter((s) => s.mode === 'drop'));
      step(fish, tall, 1 / 60, r, now, world);
      for (const s of fish) {
        if (s.mode === 'drop') continue;
        if (dropping.has(s)) {
          handovers++;
          expect(s.y - s.height / 2).toBeGreaterThanOrEqual(tall.top! - 1e-6);
        }
        if (s.goalY !== null) expect(s.goalY - s.height / 2).toBeGreaterThanOrEqual(tall.top! - 1e-6);
        n++;
        if (s.y - s.height / 2 < tall.top! + 1) pinned++;
      }
    }
    expect(handovers).toBeGreaterThanOrEqual(5);
    // Clamp-only steering sat ~35% of the time against the ceiling; what remains is meeting food as it sinks under the band.
    expect(pinned / n).toBeLessThan(0.1);
  });

  it('the home band starts under the ceiling, and a band taller than half the tank is capped', () => {
    expect(depthY({ habit: 'pelagic' }, tall, 0)).toBe(tall.top);
    expect(depthY({ habit: 'default' }, tall, 0)).toBe(tall.top);
    expect(depthY({ habit: 'default' }, { width: 1200, height: 224 }, 0)).toBe(0);
    expect(ceilingOf({ habit: 'pelagic' }, { width: 1200, height: 224, top: 222 })).toBeLessThanOrEqual(112);
  });

  it('open-ocean fish still keep to the upper water below the band', () => {
    const r = rng(74);
    const fish = spawn(Array.from({ length: 6 }, (_, i) => pelagic(i)), tall, r, 0);
    let sum = 0;
    let n = 0;
    let now = 0;
    for (let i = 0; i < 60 * 60; i++) {
      step(fish, tall, 1 / 60, r, (now += 1 / 60));
      for (const s of fish) { sum += s.y; n++; }
    }
    expect(sum / n).toBeLessThan(tall.height * 0.5);
  });

  it('every habit keeps under the band too, a top-water trout included', () => {
    const habits = ['default', 'holdCurrent', 'reef', 'weed', 'puffer', 'bottom', 'ambush', 'glide', 'hoverReef', 'nibble', 'lurk'] as const;
    for (const habit of habits) {
      const r = rng(75);
      const fish = spawn(
        Array.from({ length: 4 }, (_, i) => ({ ...pelagic(i), id: `${habit}${i}`, habit, depth: depthFor(habit, [0.02, 0.12]) })),
        tall, r, 0,
      );
      const world: World = { current: 0, flakes: [] };
      let pinned = 0;
      let n = 0;
      let now = 0;
      for (let i = 0; i < 30 * 60; i++) {
        now += 1 / 60;
        if (i % 600 === 0) dropFood(world, 300 + (i % 900), 40, r, now);
        step(fish, tall, 1 / 60, r, now, world);
        for (const s of fish) {
          expect(s.y - s.height / 2, habit).toBeGreaterThanOrEqual(tall.top! - 1e-6);
          if (s.goalY !== null) expect(s.goalY - s.height / 2, habit).toBeGreaterThanOrEqual(tall.top! - 1e-6);
          n++;
          if (s.y - s.height / 2 < tall.top! + 1) pinned++;
        }
      }
      // Steered under the band, not just clamped against it.
      expect(pinned / n, habit).toBeLessThan(0.15);
    }
  });
});

describe('rescale', () => {
  it('scales fish, their station and vertical goal, and food, keeping landed flakes on the new sand', () => {
    const from: Bounds = { width: 1000, height: 200, floor: 24 };
    const to: Bounds = { width: 2000, height: 1000, floor: 44 };
    const [s] = spawn([specs[0]!], from, rng(81), 0);
    s!.x = 500;
    s!.y = 100;
    s!.holdX = 300;
    s!.goalY = 150;
    s!.anchor = 2;
    const world: World = { current: 0, flakes: [] };
    dropFood(world, 400, 50, rng(82), 0);
    const sinking = { ...world.flakes[0]! };
    world.flakes.push({ id: -1, x: 600, y: 176, phase: 0, bornAt: 0, landedAt: 3 });
    rescale([s!], world.flakes, from, to);
    expect([s!.x, s!.y, s!.holdX, s!.goalY]).toEqual([1000, 500, 600, 750]);
    expect(s!.anchor).toBe(-1);
    expect(world.flakes[0]!.x).toBeCloseTo(sinking.x * 2);
    expect(world.flakes[0]!.y).toBeCloseTo(sinking.y * 5);
    expect(world.flakes.at(-1)).toMatchObject({ x: 1200, y: 1000 - 44 });
  });

  it('a held fish follows its rescaled goal instead of the old one', () => {
    const from: Bounds = { width: 1000, height: 200, floor: 24 };
    const to: Bounds = { width: 1000, height: 1000, floor: 44 };
    const [s] = spawn([{ ...specs[0]!, habit: 'bottom', depth: [0.74, 0.9] }], from, rng(83), 0);
    const r = rng(84);
    let now = 0;
    for (let i = 0; i < 120; i++) step([s!], from, 1 / 60, r, (now += 1 / 60));
    hold(s!, true, now);
    rescale([s!], [], from, to);
    for (let i = 0; i < 20 * 60; i++) step([s!], to, 1 / 60, r, (now += 1 / 60));
    expect(s!.y).toBeGreaterThan(to.height * 0.7);
  });

  it('is a no-op at the same size', () => {
    const b: Bounds = { width: 1000, height: 200 };
    const [s] = spawn([specs[0]!], b, rng(85), 0);
    s!.anchor = 1;
    const before = { ...s! };
    rescale([s!], [], b, b);
    expect(s).toEqual(before);
  });
});

describe('rescale under a taller band', () => {
  it('strip to fullscreen with the band already set keeps open-ocean fish in the water, off the sand', () => {
    const strip: Bounds = { width: 1200, height: 224, floor: 24 };
    const full: Bounds = { width: 1600, height: 900, floor: 44, top: 200 };
    const r = rng(87);
    const fish = spawn(Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`, width: 90 + i * 10, cruise: 70, depth: [0.08, 0.35] as [number, number], hoverBias: 0.2, dartBias: 0.6, habit: 'pelagic' as const,
    })), strip, r, 0);
    rescale(fish, [], strip, full);
    for (const s of fish) {
      expect(s.y - s.height / 2).toBeGreaterThanOrEqual(200);
      expect(s.y).toBeLessThan(full.height * 0.6);
    }
  });

  it('moves an open-ocean fish below a band that grew, even with the tank paused', () => {
    const b: Bounds = { width: 1600, height: 900, floor: 44, top: 26 };
    const [s] = spawn([{ id: 'shark', width: 200, cruise: 80, depth: [0.08, 0.35], hoverBias: 0.2, dartBias: 0.6, habit: 'pelagic' }], b, rng(86), 0);
    s!.y = 80;
    const taller = { ...b, top: 200 };
    rescale([s!], [], b, taller);
    expect(s!.y - s!.height / 2).toBeGreaterThanOrEqual(200);
  });
});
