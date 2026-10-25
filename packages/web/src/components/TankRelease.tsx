import { useEffect } from 'react';
import type { ReefCatch } from '../lib/api';
import { BACKDROP_META, DECOR_META, setRewardOf } from '../lib/tankDecor';
import { bannerGlow, queueLabel, type ReleaseStep } from '../lib/tankRelease';
import { chestWidth } from '../lib/tankVisitors';
import { BackdropThumb, DecorSvg } from './TankDecor';
import { Fish } from './Fish';
import { PILL_H, PILL_TOP_OFFSET } from './TankLines';
import { TankVisitors } from './TankVisitors';
import type { ReleaseBanner, ReleaseSplash, useTankRelease } from './useTankRelease';

// Release visuals (reef-alive spec §1): button, surface splashes, catch banners and visitor moments; motion is CSS (.reef-splash/.reef-banner).

// Bottom of the fullscreen session label pills (TankLines), below the waterline.
const PILL_BAND_BOTTOM = PILL_TOP_OFFSET(true) + PILL_H;

export function TankRelease({ release, count, canRelease, width, lineXs, taken, surfaceY, restBottom, fullscreen }: {
  release: Pick<
    ReturnType<typeof useTankRelease>,
    'banners' | 'splashes' | 'visitors' | 'dismissVisitor' | 'removeVisitor' | 'setSpots' | 'releasing' | 'start' | 'counts'
  >;
  count: number;
  /** false until the tank knows which fish it shows, so a release never snapshots an unpicked roster */
  canRelease: boolean;
  width: number;
  lineXs: number[];
  /** sand taken by rocks and decor pieces (centre x, width, px), kept clear by landing chests */
  taken: { x: number; w: number }[];
  surfaceY: number;
  /** where a chest settles on the sand, px from the tank bottom */
  restBottom: number;
  fullscreen: boolean;
}) {
  const { setSpots } = release;
  // Visitors are placed when they arrive (in the release hook), against the tank as it is drawn now.
  useEffect(() => {
    setSpots({ width, taken, bobbers: lineXs, chestW: chestWidth(fullscreen), fullscreen });
  });
  return (
    <>
      <ReleaseSplashes splashes={release.splashes} surfaceY={surfaceY} />
      <TankVisitors
        visitors={release.visitors}
        surfaceY={surfaceY}
        pillBottom={fullscreen && lineXs.length > 0 ? surfaceY + PILL_BAND_BOTTOM : null}
        restBottom={restBottom}
        fullscreen={fullscreen}
        onDismiss={release.dismissVisitor}
        onDone={release.removeVisitor}
      />
      <ReleaseBanners banners={release.banners} top={fullscreen ? (lineXs.length ? 96 : 64) : 36} fullscreen={fullscreen} />
      {count > 0 && canRelease && !release.releasing && (
        <ReleaseButton
          label={queueLabel(release.counts)}
          top={releaseButtonTop(lineXs, surfaceY, fullscreen)}
          fullscreen={fullscreen}
          onRelease={() => release.start('tank')}
        />
      )}
    </>
  );
}

// Top-left, but below the bobbers (strip) or the label band (fullscreen) when a line is in the way.
function releaseButtonTop(lineXs: number[], surfaceY: number, fullscreen: boolean): number {
  if (lineXs.length === 0) return 12;
  if (fullscreen) return surfaceY + PILL_BAND_BOTTOM + 10;
  return Math.min(...lineXs) < 170 ? surfaceY + 6 + 10 : 12;
}

function ReleaseButton({ label, top, fullscreen, onRelease }: {
  label: string;
  top: number;
  fullscreen: boolean;
  onRelease: () => void;
}) {
  return (
    <button
      type="button"
      data-reef-nofeed
      onClick={onRelease}
      title="Release everything waiting into the tank: new fish, visitors and rewards"
      className={`reef-release-btn absolute left-3 z-30 flex items-center gap-1.5 rounded-full bg-amber-300 font-semibold text-amber-950 shadow-lg ring-1 ring-amber-100/80 transition-colors hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
        fullscreen ? 'px-4 py-1.5 text-base' : 'px-3 py-1 text-sm'
      }`}
      style={{ top }}
    >
      {label}
    </button>
  );
}

const DROPLETS = 7;
const BIG_DROPLETS = 11;
const BUBBLES = 6;

function ReleaseSplashes({ splashes, surfaceY }: { splashes: ReleaseSplash[]; surfaceY: number }) {
  return (
    <>
      {splashes.map((s) => {
        const n = s.big ? BIG_DROPLETS : DROPLETS;
        // Droplets have only the strip of air above the waterline before the tank's top edge clips them.
        const rise = Math.max(8, surfaceY - 3);
        return (
          <div
            key={s.key}
            aria-hidden="true"
            className={`reef-splash reef-splash-${s.tone} ${s.big ? 'reef-splash-big' : ''}`}
            style={{ left: s.x, top: surfaceY }}
          >
            <span className="reef-splash-flash" />
            <span className="reef-ripple" />
            <span className="reef-ripple" style={{ animationDelay: '0.22s' }} />
            {s.big && <span className="reef-ripple" style={{ animationDelay: '0.45s' }} />}
            {Array.from({ length: n }, (_, i) => {
              const t = i / (n - 1) - 0.5;
              return (
                <span
                  key={`d${i}`}
                  className="reef-droplet"
                  style={{
                    ['--dx' as string]: `${(t * (s.big ? 110 : 70)).toFixed(1)}px`,
                    ['--dy' as string]: `${(-rise * (0.55 + 0.45 * Math.cos(t * Math.PI))).toFixed(1)}px`,
                    animationDelay: `${((i * 37) % 5) * 0.03}s`,
                  }}
                />
              );
            })}
            {Array.from({ length: BUBBLES }, (_, i) => (
              <span
                key={`b${i}`}
                className="reef-splash-bubble"
                style={{
                  left: ((i * 29) % 34) - 17,
                  ['--by' as string]: `${30 + ((i * 41) % 50) * (s.big ? 1.6 : 1)}px`,
                  width: 3 + (i % 3) * 2,
                  height: 3 + (i % 3) * 2,
                  animationDelay: `${0.15 + i * 0.08}s`,
                }}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

const RARITY_TEXT: Record<ReefCatch['rarity'], string> = {
  common: 'text-white/70',
  uncommon: 'text-emerald-300',
  rare: 'text-sky-300',
  epic: 'text-purple-300',
  legendary: 'text-amber-300',
};

function ReleaseBanners({ banners, top, fullscreen }: { banners: ReleaseBanner[]; top: number; fullscreen: boolean }) {
  if (banners.length === 0) return null;
  return (
    <div
      data-reef-nofeed
      className="pointer-events-none absolute inset-x-0 z-30 grid justify-items-center px-4"
      style={{ top }}
      aria-live="polite"
    >
      {banners.map((b) => (
        <div key={b.key} style={{ gridArea: '1 / 1' }} className="max-w-full">
          <Banner banner={b} fullscreen={fullscreen} />
        </div>
      ))}
    </div>
  );
}

// Names the set and its reward; the tank shows the reward itself (decor settling, backdrop fading in, fish flashing gold).
function RewardBanner({ step, fullscreen }: { step: Extract<ReleaseStep, { kind: 'reward' }>; fullscreen: boolean }) {
  const r = setRewardOf(step.event);
  const label = r?.label ?? step.event.ref;
  const thumb = fullscreen ? 'h-10 w-14' : 'h-8 w-11';
  let art = <span className="flex-none text-xl">🏆</span>;
  let line = '';
  if (r?.reward.type === 'decor') {
    art = <DecorSvg item={r.reward.item} className={`${thumb} flex-none`} />;
    line = `${DECOR_META[r.reward.item]?.label ?? r.reward.item} added to the sand`;
  } else if (r?.reward.type === 'backdrop') {
    art = <BackdropThumb item={r.reward.item} className={`${thumb} flex-none ring-1 ring-white/30`} />;
    line = `New backdrop: ${BACKDROP_META[r.reward.item]?.label ?? r.reward.item}`;
  } else if (r) {
    art = <span className={`reef-dex-badge flex-none ${fullscreen ? 'scale-125' : ''}`} aria-hidden>★</span>;
    line = 'Gold badge: every variant caught';
  }
  return (
    <div className="reef-banner reef-banner-shiny flex max-w-full items-center gap-3 rounded-2xl bg-black/55 py-2 pl-3 pr-4 text-white shadow-xl ring-1 ring-amber-300/70 backdrop-blur-md">
      {art}
      <div className="min-w-0">
        <div className={`truncate font-semibold ${fullscreen ? 'text-base' : 'text-sm'}`}>🏆 {label} set complete</div>
        {line && <div className="truncate text-xs font-medium text-amber-200">{line}</div>}
      </div>
    </div>
  );
}

function Banner({ banner: { step }, fullscreen }: { banner: ReleaseBanner; fullscreen: boolean }) {
  if (step.kind === 'reward') return <RewardBanner step={step} fullscreen={fullscreen} />;
  // Visitors play as their own moments (TankVisitors), never as banners.
  if (step.kind === 'visitor' || step.kind === 'visitorBatch') return null;
  if (step.kind === 'more') {
    return (
      <div className={`reef-banner flex items-center gap-2 rounded-2xl bg-black/55 px-4 py-2 text-white shadow-xl ring-1 ring-white/15 backdrop-blur-md ${fullscreen ? 'text-base' : 'text-sm'}`}>
        <span>🎣</span>
        <span className="font-semibold">+{step.count} more</span>
        <span className="text-white/60">in the collection</span>
      </div>
    );
  }
  const c = step.catch;
  const glow = bannerGlow(c);
  const muted = 'font-normal text-white/80';
  const parts = [
    c.size > 0 ? { text: `${c.size}cm`, cls: muted } : null,
    { text: c.rarity.toUpperCase(), cls: RARITY_TEXT[c.rarity] },
    c.project ? { text: c.project.split('/').pop() || c.project, cls: muted } : null,
    c.agent ? { text: c.agent === 'codex' ? 'Codex' : 'Claude', cls: muted } : null,
  ].filter((p) => p !== null);
  return (
    <div className={`reef-banner flex max-w-full items-center gap-3 rounded-2xl bg-black/55 py-2 pl-3 pr-4 text-white shadow-xl ring-1 backdrop-blur-md ${glow}`}>
      <Fish
        species={c.species}
        shiny={!!c.shiny}
        className={`${fullscreen ? 'h-10 w-[4.5rem]' : 'h-8 w-14'} flex-none [&>svg]:h-full [&>svg]:w-full ${c.shiny ? 'reef-shiny' : ''}`}
      />
      <div className="min-w-0">
        <div className={`truncate font-semibold ${fullscreen ? 'text-base' : 'text-sm'}`}>
          {c.shiny ? '✨ ' : ''}{c.name}
          {parts.map((p, i) => (
            <span key={i} className={p.cls}>
              {' · '}{p.text}
            </span>
          ))}
        </div>
        {step.kind === 'upgrade' && <div className="text-xs font-medium text-amber-200">✨ shiny upgrade</div>}
        {step.pb && <div className="text-xs font-medium text-emerald-200">New personal best: {step.pb.from} → {step.pb.to} cm</div>}
      </div>
    </div>
  );
}
