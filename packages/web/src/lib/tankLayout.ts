// A tank mode paired with the size measured for it, so geometry never mixes a new mode with the old size.

export type ScreenMode = 'native' | 'theater' | null;
export interface TankLayout { mode: ScreenMode; width: number; height: number }
export type LayoutAction =
  | { kind: 'resize'; width: number; height: number; native: boolean }
  | { kind: 'mode'; mode: ScreenMode; width: number; height: number };

// The browser resizes for native fullscreen before React hears of it, so a resize carries the live native state.
function resizeMode(cur: ScreenMode, native: boolean): ScreenMode {
  if (native) return 'native';
  return cur === 'native' ? null : cur;
}

/** A resize keeps the mode (bar native fullscreen); a mode change carries its own size. The same layout back when nothing changed. */
export function tankLayout(cur: TankLayout, a: LayoutAction): TankLayout {
  const width = Math.round(a.width);
  const height = Math.round(a.height);
  const mode = a.kind === 'mode' ? a.mode : resizeMode(cur.mode, a.native);
  return mode === cur.mode && width === cur.width && height === cur.height ? cur : { mode, width, height };
}
