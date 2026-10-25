import { describe, expect, it } from 'vitest';
import { tankLayout, type TankLayout } from './tankLayout';

const strip: TankLayout = { mode: null, width: 1104, height: 224 };

describe('tankLayout', () => {
  it('a resize keeps the mode and rounds the size', () => {
    expect(tankLayout(strip, { kind: 'resize', width: 1000.4, height: 223.6, native: false })).toEqual({ mode: null, width: 1000, height: 224 });
  });

  it('a resize to the same size is the same layout, so nothing re-renders', () => {
    expect(tankLayout(strip, { kind: 'resize', width: 1104.2, height: 224, native: false })).toBe(strip);
  });

  it('a mode change lands together with the size measured for it, never one without the other', () => {
    const full = tankLayout(strip, { kind: 'mode', mode: 'native', width: 1400, height: 900 });
    expect(full).toEqual({ mode: 'native', width: 1400, height: 900 });
    expect(tankLayout(full, { kind: 'mode', mode: null, width: 1104, height: 224 })).toEqual(strip);
  });

  it('a mode change to the same mode and size is the same layout', () => {
    expect(tankLayout(strip, { kind: 'mode', mode: null, width: 1104, height: 224 })).toBe(strip);
  });

  it('a later resize in fullscreen stays fullscreen', () => {
    const full: TankLayout = { mode: 'theater', width: 1400, height: 900 };
    expect(tankLayout(full, { kind: 'resize', width: 1200, height: 800, native: false })).toEqual({ mode: 'theater', width: 1200, height: 800 });
  });

  it('a resize from entering native fullscreen lands with the native mode, before React hears of the change', () => {
    expect(tankLayout(strip, { kind: 'resize', width: 1400, height: 900, native: true })).toEqual({ mode: 'native', width: 1400, height: 900 });
  });

  it('a resize from leaving native fullscreen lands with the strip mode', () => {
    const full: TankLayout = { mode: 'native', width: 1400, height: 900 };
    expect(tankLayout(full, { kind: 'resize', width: 1104, height: 224, native: false })).toEqual(strip);
  });
});
