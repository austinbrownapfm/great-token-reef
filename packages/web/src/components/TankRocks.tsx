import { useId } from 'react';

// Fixed scenery rocks with eel crevices (spec §2); crevice mouths double as the sim's rock anchors.

export interface Rock {
  /** centre x, tank px */
  x: number;
  w: number;
  h: number;
  /** y of the rock's foot, tank px (sunk a little into the sand) */
  base: number;
  shape: number;
  /** crevice mouths, tank px; `face` is the way a resting eel looks out */
  crevices: { x: number; y: number; face: 1 | -1 }[];
  /** foreground lip per crevice (same order), drawn over the fish so an eel's body hides behind it */
  lips: { x: number; y: number; w: number; h: number; face: 1 | -1 }[];
}

// viewBox 0 0 100 60, foot on y = 60.
const SHAPES = [
  {
    d: 'M2,60 C0,44 8,30 20,24 C30,8 52,4 64,12 C78,10 94,24 96,40 C99,50 98,56 98,60 Z',
    crevices: [{ x: 30, y: 42, r: -12 }, { x: 70, y: 30, r: 10 }],
  },
  {
    d: 'M4,60 C2,46 12,36 24,34 C30,18 46,10 60,16 C74,14 88,26 92,38 C97,46 96,56 96,60 Z',
    crevices: [{ x: 36, y: 44, r: 8 }, { x: 68, y: 36, r: -10 }],
  },
];

export function rocksFor(width: number, height: number, floor: number, fullscreen: boolean): Rock[] {
  if (width <= 0 || height <= 0) return [];
  const fracs = width >= 900 ? [0.16, 0.5, 0.83] : [0.2, 0.76];
  // Strip rocks shrink with the tank height so they stay low scenery.
  const scale = fullscreen ? 1.6 : Math.min(1, Math.max(0.5, height / 360));
  return fracs.map((f, i) => {
    const w = (96 + ((i * 29) % 30)) * scale;
    const h = w * 0.55;
    const base = height - floor + 6;
    const left = f * width - w / 2;
    const shape = i % SHAPES.length;
    const crevices = SHAPES[shape]!.crevices.map((c) => ({
      x: left + (c.x / 100) * w,
      y: base - h + (c.y / 60) * h,
      face: (c.x < 50 ? -1 : 1) as 1 | -1,
    }));
    // The lip starts just inside the mouth and runs back into the rock, below the slit's centre line.
    const lips = crevices.map((c) => {
      const lw = w * 0.45;
      return { x: c.face === -1 ? c.x - 3 : c.x + 3 - lw, y: c.y - 2, w: lw, h: Math.max(8, base - (c.y - 2) - 4), face: c.face };
    });
    return { x: f * width, w, h, base, shape, crevices, lips };
  });
}

export function TankRocks({ rocks }: { rocks: Rock[] }) {
  const id = useId();
  return (
    <>
      {rocks.map((r, i) => {
        const shape = SHAPES[r.shape]!;
        return (
          <svg
            key={`rock${i}`}
            aria-hidden
            viewBox="0 0 100 60"
            preserveAspectRatio="none"
            className="reef-nightdim pointer-events-none absolute"
            style={{ left: r.x - r.w / 2, top: r.base - r.h, width: r.w, height: r.h }}
          >
            <defs>
              <linearGradient id={`${id}g${i}`} x1="0" y1="0" x2="0.3" y2="1">
                <stop offset="0" stopColor="#6b747c" />
                <stop offset="0.55" stopColor="#4a535b" />
                <stop offset="1" stopColor="#2b3238" />
              </linearGradient>
            </defs>
            <path d={shape.d} fill={`url(#${id}g${i})`} />
            <path d={shape.d} fill="none" stroke="#86909a" strokeOpacity=".35" strokeWidth="1.2" />
            {shape.crevices.map((c, j) => (
              <ellipse
                key={j}
                cx={c.x}
                cy={c.y}
                rx="8"
                ry="3.6"
                transform={`rotate(${c.r} ${c.x} ${c.y})`}
                fill="#0b1216"
                opacity=".9"
              />
            ))}
          </svg>
        );
      })}
    </>
  );
}

/** Rock lips in front of the fish layer; pointer-events-none so food clicks pass through. */
export function TankRockLips({ rocks }: { rocks: Rock[] }) {
  const id = useId();
  return (
    <>
      {rocks.flatMap((r, i) =>
        r.lips.map((l, j) => (
          <svg
            key={`lip${i}-${j}`}
            aria-hidden
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="reef-nightdim pointer-events-none absolute z-10"
            style={{ left: l.x, top: l.y, width: l.w, height: l.h, transform: l.face === 1 ? 'scaleX(-1)' : undefined }}
          >
            <defs>
              <linearGradient id={`${id}l${i}-${j}`} x1="0" y1="0" x2="0.2" y2="1">
                <stop offset="0" stopColor="#5f6870" />
                <stop offset="1" stopColor="#2b3238" />
              </linearGradient>
            </defs>
            <path d="M0,100 C0,60 4,14 16,6 C40,-2 70,4 88,22 C98,40 100,70 100,100 Z" fill={`url(#${id}l${i}-${j})`} />
            <path d="M0,100 C0,60 4,14 16,6 C40,-2 70,4 88,22" fill="none" stroke="#86909a" strokeOpacity=".35" strokeWidth="2" />
          </svg>
        )),
      )}
    </>
  );
}
