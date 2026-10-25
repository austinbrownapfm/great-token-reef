// Habit steering for the swim simulation: where each body-plan habit (tankHabits.ts)
// rests at spawn, how it steers every frame, and what it does when a mode runs out.

import type { Anchors, WeedAnchor } from './tankHabits';
import {
  DART_FACTOR, HOLD_CURRENT, beginTurn, clamp, clampX, clampY, rollMode, sinkOf,
  type Bounds, type Rng, type SwimMode, type Swimmer,
} from './tankMotion';

function setMode(s: Swimmer, mode: SwimMode, until: number, target: number): void {
  s.mode = mode;
  s.modeUntil = until;
  s.target = target;
}

/** Weed sway amplitude in degrees, and degrees of lean per px/s of current (index.css reef-sway). */
export interface Sway {
  amp: number;
  degPerCurrent: number;
}

const SWAY_SECONDS = 4;

// index.css reef-sway: 4s ease-in-out alternate from (lean - amp) to (lean + amp) degrees about the weed's foot,
// with the weed's animations started at the clock's zero (Tank.tsx), so `now` gives its phase.
export function weedSway(w: WeedAnchor, now: number, drift: number, sway: Sway | undefined): { dx: number; dy: number } {
  if (!w.sway || !sway) return { dx: 0, dy: 0 };
  const cycle = 2 * SWAY_SECONDS;
  const t = (((now - w.sway.delay) % cycle) + cycle) % cycle;
  const u = t < SWAY_SECONDS ? t / SWAY_SECONDS : 2 - t / SWAY_SECONDS;
  const ease = (1 - Math.cos(Math.PI * u)) / 2;
  const deg = drift * sway.degPerCurrent - sway.amp + 2 * sway.amp * ease;
  const rad = (deg * Math.PI) / 180;
  return { dx: w.sway.reach * Math.sin(rad), dy: w.sway.reach * (1 - Math.cos(rad)) };
}

export function placeHabit(s: Swimmer, b: Bounds, rng: Rng, now: number, a?: Anchors): void {
  const list = s.habit === 'crevice' ? a?.rocks : s.habit === 'weed' ? a?.weeds : s.habit === 'lurk' && a ? homesOf(a, 'lurk') : undefined;
  if (list?.length) {
    s.anchor = Math.floor(rng() * list.length);
    const p = s.habit === 'crevice' ? crevicePoint(s, a!.rocks[s.anchor]!) : list[s.anchor]!;
    const face = s.habit === 'crevice' ? a!.rocks[s.anchor]!.face : undefined;
    if (face) {
      s.heading = face;
      s.flip = -face;
    }
    s.x = clampX(p.x, s.width, b);
    s.mode = 'rest';
    s.sinkPx = sinkOf(s);
    s.y = clampY(p.y, s.height, b, s.sinkPx);
  } else if (s.habit === 'sand') {
    s.mode = 'rest';
    s.sinkPx = sinkOf(s);
    s.y = floorY(s, b);
  } else if (s.habit === 'ambush') {
    s.vx = 0;
    setMode(s, 'ambush', now + 2 + rng() * 5, s.cruise * 0.03);
    return;
  } else if (s.habit === 'hoverReef') {
    s.vx = 0;
    setMode(s, 'hover', now + 2 + rng() * 5, s.cruise * 0.08);
    return;
  } else return;
  s.vx = 0;
  setMode(s, 'rest', now + 3 + rng() * 10, 0);
}

// Per-frame habit steering; runs only in non-v3 modes.
export function habitTick(s: Swimmer, b: Bounds, rng: Rng, now: number, drift: number, a?: Anchors, sway?: Sway): void {
  s.goalY = null;
  switch (s.habit) {
    case 'holdCurrent': {
      const strong = Math.abs(drift) >= HOLD_CURRENT;
      if (strong && s.mode !== 'rest') {
        setMode(s, 'rest', now + 4, 0);
        s.holdX = s.x;
      } else if (!strong && s.mode === 'rest') {
        rollMode(s, rng, now);
        return;
      }
      if (s.mode !== 'rest') return;
      const into: 1 | -1 = drift > 0 ? -1 : 1;
      if (s.heading !== into) {
        beginTurn(s, now);
        return;
      }
      // Swim exactly against the water, plus a pull back to the station.
      const back = clamp((s.holdX - s.x) * 1.5, -s.cruise * 0.5, s.cruise * 0.5);
      s.target = Math.max(0, (back - drift) * s.heading);
      return;
    }
    case 'crevice':
    case 'weed': {
      if (s.mode !== 'rest') return;
      const list = s.habit === 'crevice' ? a?.rocks : a?.weeds;
      if (!list?.length) return;
      if (s.anchor < 0 || s.anchor >= list.length) s.anchor = nearest(list, s.x, s.y);
      if (s.habit === 'crevice') {
        const c = a!.rocks[s.anchor]!;
        const p = crevicePoint(s, c);
        // Settled at the crevice: turn to look out of it, body behind the lip.
        if (c.face && s.heading !== c.face && Math.abs(p.x - s.x) < 20) {
          beginTurn(s, now);
          return;
        }
        seek(s, p.x, now, 0.8);
        s.goalY = p.y;
        return;
      }
      const p = a!.weeds[s.anchor]!;
      const { dx, dy } = weedSway(p, now, drift, sway);
      s.goalY = p.y + dy;
      if (Math.abs(p.x + dx - s.x) > s.width * 0.6) {
        seek(s, p.x + dx, now, 0.5);
        return;
      }
      // On its weed a seahorse rides the sway (matching its speed), back-paddling rather than turning each time the weed swings behind it.
      const swing = (weedSway(p, now + 0.05, drift, sway).dx - dx) / 0.05;
      s.target = clamp((swing + (p.x + dx - s.x) * 3) * s.heading, -s.cruise * 0.5, s.cruise * 0.5);
      return;
    }
    case 'nibble': {
      if (s.mode !== 'rest' || !a?.weeds.length) return;
      if (s.anchor < 0 || s.anchor >= a.weeds.length) s.anchor = nearest(a.weeds, s.x, s.y);
      const p = a.weeds[s.anchor]!;
      s.goalY = p.y + s.height * 0.05;
      if (Math.abs(p.x - s.x) > s.width * 0.6) {
        seek(s, p.x, now, 0.7);
        return;
      }
      // Mouth at the stem with small pecking nudges; it back-paddles rather than turning on the spot.
      const spot = p.x - s.heading * s.width * 0.42 + Math.sin(now * 7 + s.phase) * 3;
      s.target = clamp((spot - s.x) * s.heading * 0.8, -s.cruise * 0.3, s.cruise * 0.3);
      s.goalY += Math.sin(now * 5 + s.phase) * 2;
      return;
    }
    case 'lurk': {
      if (s.mode !== 'rest' || !a) return;
      const homes = homesOf(a, 'lurk');
      if (!homes.length) return;
      if (s.anchor < 0 || s.anchor >= homes.length) s.anchor = nearest(homes, s.x, s.y);
      const p = homes[s.anchor]!;
      seek(s, p.x, now, 0.4);
      s.goalY = p.y - s.height * 0.3;
      return;
    }
    case 'sand': {
      if (s.mode === 'rest') s.target = 0;
      // A flutter lifts the fish just off the sand, never out of the bottom of the tank.
      s.goalY = s.mode === 'cruise' ? floorY(s, b) - Math.min(b.height * 0.04, 40) : s.mode === 'rest' ? floorY(s, b) : null;
      return;
    }
    case 'bottom':
      // Hug the sand, belly just above it, whatever the tank height.
      s.goalY = floorY(s, b) - s.height * 0.12 + Math.sin(s.phase) * s.height * 0.05;
      return;
    case 'reef':
    case 'hoverReef': {
      if (s.mode !== 'cruise' || !a) return;
      const homes = homesOf(a, 'reef');
      if (!homes.length) return;
      if (s.anchor < 0 || s.anchor >= homes.length) s.anchor = nearest(homes, s.x, s.y);
      const dx = homes[s.anchor]!.x - s.x;
      if (Math.abs(dx) > 140 && dx * s.heading < 0) beginTurn(s, now);
      return;
    }
  }
}

// Mode choice when the current mode expires; false = fall back to default swimming.
export function rollHabit(s: Swimmer, b: Bounds, rng: Rng, now: number, drift: number, a?: Anchors): boolean {
  s.liftPx = 0;
  const r = rng();
  switch (s.habit) {
    case 'crevice': {
      if (!a?.rocks.length) return false;
      // Now and then a short loop out of the crevice; habitTick swims it home again.
      if (s.mode === 'rest') setMode(s, 'cruise', now + 1.5 + r, s.cruise * 0.7);
      else setMode(s, 'rest', now + 15 + r * 10, 0);
      return true;
    }
    case 'weed': {
      if (!a?.weeds.length) return false;
      // After each rest, drift on to a neighbouring weed.
      if (s.mode === 'rest' && a.weeds.length > 1 && s.anchor >= 0) {
        const next = s.anchor + (r < 0.5 ? -1 : 1);
        s.anchor = next < 0 || next >= a.weeds.length ? s.anchor - (next - s.anchor) : next;
      }
      setMode(s, 'rest', now + 12 + rng() * 10, 0);
      return true;
    }
    case 'sand':
      if (s.mode === 'rest') setMode(s, 'cruise', now + 1.5 + r * 1.5, s.cruise * 0.5);
      else setMode(s, 'rest', now + 10 + r * 10, 0);
      return true;
    case 'puffer':
      if (r < 0.35) setMode(s, 'hover', now + 3 + rng() * 3, s.cruise * 0.1);
      else setMode(s, 'cruise', now + 4 + rng() * 4, s.cruise * (0.6 + rng() * 0.3));
      return true;
    case 'ambush':
      // Lie still, dash, now and then edge to a new spot, lie still again.
      if (s.mode === 'ambush') setMode(s, 'dart', now + 0.8, s.cruise * DART_FACTOR);
      else if (s.mode === 'dart' && r < 0.25) setMode(s, 'cruise', now + 2 + rng(), s.cruise * 0.4);
      else setMode(s, 'ambush', now + 4 + rng() * 5, s.cruise * 0.03);
      return true;
    case 'pelagic':
      if (r < 0.12) setMode(s, 'dart', now + 0.6, s.cruise * DART_FACTOR);
      else if (r < 0.2) beginTurn(s, now);
      else setMode(s, 'cruise', now + 4 + rng() * 5, s.cruise * (1 + rng() * 0.3));
      return true;
    case 'reef':
      if (r < 0.25) setMode(s, 'hover', now + 2 + rng() * 2, s.cruise * 0.15);
      else if (r < 0.55) setMode(s, 'dart', now + 0.35, s.cruise * DART_FACTOR);
      else setMode(s, 'cruise', now + 2 + rng() * 3, s.cruise * (0.8 + rng() * 0.3));
      return true;
    case 'hoverReef':
      // A lionfish mostly hangs still near the decor; darts are rare and short.
      if (r < 0.75) setMode(s, 'hover', now + 5 + rng() * 4, s.cruise * 0.08);
      else if (r < 0.85) setMode(s, 'dart', now + 0.35, s.cruise * DART_FACTOR);
      else setMode(s, 'cruise', now + 2 + rng() * 2, s.cruise * 0.6);
      return true;
    case 'nibble':
      if (s.mode === 'rest') setMode(s, 'cruise', now + 6 + r * 4, s.cruise * (0.8 + rng() * 0.3));
      else if (a?.weeds.length) {
        s.anchor = nearest(a.weeds, s.x, s.y);
        setMode(s, 'rest', now + 7 + r * 3, 0);
      } else return false;
      return true;
    case 'lurk':
      // Hang by the rocks; now and then edge off and pick the nearest spot again.
      if (s.mode === 'rest' && r < 0.3) {
        setMode(s, 'cruise', now + 2 + rng(), s.cruise * 0.5);
        s.anchor = -1;
      } else setMode(s, 'rest', now + 8 + rng() * 6, 0);
      return true;
    case 'glide':
      if (r < 0.15) {
        // A rare sweeping pass up through the water.
        setMode(s, 'cruise', now + 5, s.cruise * 1.3);
        s.liftPx = b.height * 0.22;
      } else setMode(s, 'cruise', now + 6 + rng() * 6, s.cruise * (0.8 + rng() * 0.2));
      return true;
    case 'holdCurrent':
      if (Math.abs(drift) < HOLD_CURRENT) return false;
      setMode(s, 'rest', now + 4, 0);
      return true;
    default:
      return false;
  }
}

// Swim toward an x, arriving gently; a target behind the fish means a turn first.
function seek(s: Swimmer, x: number, now: number, cap: number): void {
  const dx = x - s.x;
  if (Math.abs(dx) > 20 && dx * s.heading < -Math.max(12, s.width * 0.2)) {
    beginTurn(s, now);
    return;
  }
  s.target = dx * s.heading > 0 ? Math.min(Math.abs(dx) * 0.8, s.cruise * cap) : 0;
}

function nearest(points: { x: number; y: number }[], x: number, y: number): number {
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    if (Math.hypot(points[i]!.x - x, points[i]!.y - y) < Math.hypot(points[best]!.x - x, points[best]!.y - y)) best = i;
  }
  return best;
}

function homesOf(a: Anchors, habit: 'reef' | 'lurk'): { x: number; y: number }[] {
  return habit === 'lurk' ? [...a.rocks, ...a.decor] : [...a.decor, ...a.rocks];
}

// A resting eel lies a quarter-length back from the mouth, so its head pokes out past the lip.
function crevicePoint(s: Swimmer, c: { x: number; y: number; face?: 1 | -1 }): { x: number; y: number } {
  return { x: c.x - (c.face ?? 0) * s.width * 0.25, y: c.y };
}

function floorY(s: Swimmer, b: Bounds): number {
  return clampY(Number.POSITIVE_INFINITY, s.height, b, sinkOf(s));
}
