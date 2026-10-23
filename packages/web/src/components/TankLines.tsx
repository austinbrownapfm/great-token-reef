import { useRef, useState } from 'react';
import { compactNumber, timeAgo } from '../lib/format';
import type { LineSpec } from '../lib/tankLines';
import type { Bounds } from '../lib/tankSim';
import { uiEvent } from '../lib/telemetry';

// Session fishing lines (spec §2): bobber at the surface, hook depth = progress; SVG at z-5 under the fish, over the fog.

const BOBBER: Record<LineSpec['agent'], { top: string; bottom: string }> = {
  claude: { top: '#ff4d2e', bottom: '#fff4ec' },
  codex: { top: '#f4fff8', bottom: '#22c55e' },
};

/** Fullscreen label pills sit this far below the waterline: bobber radius plus room for the catch dip (10px scaled). */
export const PILL_TOP_OFFSET = (fullscreen: boolean) => (fullscreen ? 9 : 6) + 16;
/** A label pill's height, about one line of text-sm with py-0.5. */
export const PILL_H = 24;

interface Props {
  lines: LineSpec[];
  bounds: Bounds;
  surfaceY: number;
  floorY: number;
  fullscreen: boolean;
  jerking: Set<string>;
}

export function TankLines({ lines, bounds, surfaceY, floorY, fullscreen, jerking }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const lastLogged = useRef<string | null>(null);
  if (bounds.width === 0 || lines.length === 0) return null;
  const r = fullscreen ? 9 : 6;
  const lineW = fullscreen ? 1.6 : 1.1;
  const depth = Math.max(0, floorY - surfaceY - 10);
  const hoveredLine = hovered ? lines.find((l) => l.sessionId === hovered) : undefined;
  // Each label owns its slot between neighbours, so pills never touch.
  const slot = Math.min(288, bounds.width / (lines.length + 1) - 12);
  // Below the bobber, so the bobber stays visible.
  const labelTop = surfaceY + PILL_TOP_OFFSET(fullscreen);

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 z-[5]" width={bounds.width} height={bounds.height} aria-hidden="true">
        {lines.map((l, i) => {
          const x = l.xFrac * bounds.width;
          const hook = Math.max(r + 8, Math.min(1, Math.max(0, l.pct)) * depth);
          const colour = BOBBER[l.agent];
          const jerk = jerking.has(l.sessionId);
          const line = l.idle
            ? `M 0 ${r} Q ${hook * 0.18} ${hook * 0.55} 0 ${hook}`
            : `M 0 ${r} L 0 ${hook}`;
          return (
            <g key={l.sessionId} transform={`translate(${x.toFixed(1)} ${surfaceY})`} opacity={l.idle ? 0.5 : 1}>
              <g className="reef-bob" style={{ animationDelay: `${-i * 0.9}s` }}>
                <g key={jerk ? 'j' : 'n'} className={jerk ? 'reef-line-twang' : undefined}>
                  <path d={line} fill="none" stroke="rgb(0 0 0 / 0.35)" strokeWidth={lineW + 1.6} />
                  <path d={line} fill="none" stroke="rgb(240 248 255 / 0.85)" strokeWidth={lineW} />
                  <path
                    d={`M 0 ${hook} v ${r * 0.7} a ${r * 0.45} ${r * 0.45} 0 0 1 ${-r * 0.9} 0 v ${-r * 0.25}`}
                    fill="none" stroke="#e2e8f0" strokeWidth={lineW + 0.6} strokeLinecap="round"
                  />
                </g>
                <g key={jerk ? 'bj' : 'bn'} className={jerk ? 'reef-bobber-jerk' : undefined}>
                  <g transform={l.idle ? 'rotate(80)' : undefined}>
                    <line x1="0" y1={-r} x2="0" y2={-r - r * 0.7} stroke={colour.top} strokeWidth={lineW + 0.8} strokeLinecap="round" />
                    <path d={`M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0 Z`} fill={colour.top} />
                    <path d={`M ${-r} 0 A ${r} ${r} 0 0 0 ${r} 0 Z`} fill={colour.bottom} />
                    <circle r={r} fill="none" stroke="rgb(0 0 0 / 0.45)" strokeWidth="1" />
                  </g>
                </g>
              </g>
            </g>
          );
        })}
      </svg>
      {fullscreen &&
        lines.map((l) => {
          const x = l.xFrac * bounds.width;
          const enter = () => {
            // Bobber and label are separate targets with a gap between; log once until another line is hovered.
            if (lastLogged.current !== l.sessionId) uiEvent('reef.tank.line.hover', l.agent);
            lastLogged.current = l.sessionId;
            setHovered(l.sessionId);
          };
          return (
            <div key={l.sessionId}>
              <div
                data-reef-nofeed
                className="absolute z-20 cursor-default"
                style={{ left: x - r - 6, top: surfaceY - r - 10, width: 2 * r + 12, height: 2 * r + 18 }}
                onMouseEnter={enter}
                onMouseLeave={() => setHovered(null)}
              />
              <div
                data-reef-nofeed
                className={`absolute z-20 flex cursor-default items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-0.5 text-sm text-white backdrop-blur-sm ${
                  jerking.has(l.sessionId) ? 'ring-2 ring-amber-300' : ''
                } ${l.idle ? 'opacity-60' : ''}`}
                style={{ left: x, top: labelTop, maxWidth: slot, transform: 'translateX(-50%)' }}
                onMouseEnter={enter}
                onMouseLeave={() => setHovered(null)}
              >
                <span className="min-w-0 truncate">{l.label || '(untitled)'}</span>
                <span className="flex-none font-semibold tabular-nums">{Math.round(l.pct * 100)}%</span>
              </div>
            </div>
          );
        })}
      {/* Above resting visitors (z-35, z-36 hovered) so a bottle never covers it; under the plaque (z-40). */}
      {fullscreen && hoveredLine && (
        <div
          className="pointer-events-none absolute z-[37] w-64 rounded-lg bg-black/65 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm"
          style={{
            left: Math.max(8, Math.min(bounds.width - 264, hoveredLine.xFrac * bounds.width - 128)),
            top: labelTop + 32,
          }}
        >
          <div className="font-semibold">{hoveredLine.label || '(untitled)'}</div>
          <div className="truncate text-white/70" title={hoveredLine.project}>
            {hoveredLine.agent === 'codex' ? 'Codex' : 'Claude'} · {hoveredLine.project.split('/').pop() || hoveredLine.project}
          </div>
          <div className="text-white/70">
            {compactNumber(hoveredLine.tokens)} tok · {Math.round(hoveredLine.pct * 100)}% to 🎣 · active {timeAgo(hoveredLine.endedAt)}
          </div>
        </div>
      )}
    </>
  );
}
