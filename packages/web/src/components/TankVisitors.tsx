import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type CSSProperties } from 'react';
import {
  bottleRestY, cardAlign, chestWidth, eventLink, isDemoVisitor, visitorLabel, visitorLink, whaleExit, whalePhase,
  type CardAlign, type VisitorLabel, type VisitorMoment,
} from '../lib/tankVisitors';
import { uiEvent } from '../lib/telemetry';

// Visitors (fish-picker spec "Chests", "Bottles and whales stay too"): a chest, bottle or whale rests in the tank until its body is clicked.
// Motion is CSS (.reef-chest/.reef-bottle/.reef-whale in index.css): an entrance, a resting loop, and on leaving an exit whose end removes it.
// They sit above the HUD band (z-30) and below the plaque (z-40); the whale's body swims behind the fish (z-5), its caption above them but under resting cards (z-34).

type Vars = CSSProperties & Record<`--${string}`, string>;

export function TankVisitors({ visitors, surfaceY, pillBottom, restBottom, fullscreen, onDismiss, onDone }: {
  visitors: VisitorMoment[];
  surfaceY: number;
  /** bottom of the fullscreen session label pills, px from the top; null when none are drawn */
  pillBottom: number | null;
  /** px from the tank bottom where a chest settles on the sand */
  restBottom: number;
  fullscreen: boolean;
  /** a visitor's body was clicked: send it away */
  onDismiss: (key: number) => void;
  /** its exit animation ended: remove it */
  onDone: (key: number) => void;
}) {
  // The live region stays mounted so screen readers announce visitors added to it.
  return (
    <div className="pointer-events-none absolute inset-0" aria-live="polite">
      {visitors.map((m) => {
        const label = visitorLabel(m.step);
        const links = m.step.kind === 'visitorBatch' ? m.step.events.map(eventLink) : [visitorLink(m.step)];
        const props: MomentProps = {
          label,
          list: m.step.kind === 'visitorBatch',
          links,
          x: m.x,
          leaving: !!m.leaving,
          compact: !!m.compact,
          fullscreen,
          onDismiss: () => onDismiss(m.key),
          onOpen: () => {
            if (!isDemoVisitor(m.step)) uiEvent('reef.visitor.open', label.kind);
          },
          onEnd: (e) => {
            if (e.target === e.currentTarget && e.animationName === 'reef-visitor-out') onDone(m.key);
          },
        };
        if (label.kind === 'whale') return <Whale key={m.key} {...props} />;
        if (label.kind === 'ticket') return <Bottle key={m.key} {...props} surfaceY={surfaceY} pillBottom={pillBottom} />;
        return <Chest key={m.key} {...props} surfaceY={surfaceY} restBottom={restBottom} />;
      })}
    </div>
  );
}

interface MomentProps {
  label: VisitorLabel;
  list: boolean;
  /** one per label line; null where there is nothing to open */
  links: (string | null)[];
  x: number;
  leaving: boolean;
  /** no room for the full card: it rests as one line and opens on hover or focus */
  compact: boolean;
  fullscreen: boolean;
  onDismiss: () => void;
  onOpen: () => void;
  onEnd: (e: AnimationEvent) => void;
}

const leaveClass = (leaving: boolean) => (leaving ? 'reef-visitor-leaving' : '');
const BODY = 'pointer-events-auto cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

function Chest({ label, list, links, x, leaving, compact, fullscreen, onDismiss, onOpen, onEnd, surfaceY, restBottom }: MomentProps & { surfaceY: number; restBottom: number }) {
  const w = chestWidth(fullscreen);
  const h = Math.round(w * 0.93);
  return (
    <div
      className={`reef-visitor reef-visitor-chest absolute z-[35] w-0 ${leaveClass(leaving)}`}
      style={{ left: `${(x * 100).toFixed(2)}%`, top: surfaceY, bottom: restBottom, '--cw': `${w}px`, '--ch': `${h}px` } as Vars}
      onAnimationEnd={onEnd}
    >
      <button
        type="button"
        data-reef-nofeed
        disabled={leaving}
        className={`reef-chest ${BODY}`}
        aria-label={`Send the chest away: ${label.head}`}
        title="Click to send the chest away"
        onClick={onDismiss}
      >
        <span className="reef-chest-glow pointer-events-none" />
        <span className="reef-chest-puff pointer-events-none" />
        <ChestArt />
      </button>
      <VisitorCard label={label} list={list} links={links} tone="chest" align={cardAlign(x)} compact={compact} fullscreen={fullscreen} onOpen={onOpen} className="reef-chest-card" style={{ bottom: h + 8 }} />
    </div>
  );
}

function ChestArt() {
  return (
    <svg viewBox="0 -8 60 56" className="relative block h-full w-full overflow-visible" aria-hidden="true">
      <ellipse cx="30" cy="21" rx="21" ry="4.5" fill="#f2c94c" className="reef-chest-gold" />
      <circle cx="22" cy="19" r="2.6" fill="#ffe08a" stroke="#b8862b" strokeWidth="0.6" className="reef-chest-gold" />
      <circle cx="35" cy="18.5" r="2.6" fill="#ffe08a" stroke="#b8862b" strokeWidth="0.6" className="reef-chest-gold" />
      <rect x="6" y="22" width="48" height="24" rx="3" fill="#6b3f1d" stroke="#3a210d" strokeWidth="1.5" />
      <path d="M7 30 H53 M7 38 H53" stroke="#4e2c12" strokeWidth="1" />
      <rect x="13" y="22" width="5" height="24" fill="#c9973a" />
      <rect x="42" y="22" width="5" height="24" fill="#c9973a" />
      <rect x="26" y="24" width="8" height="9" rx="1.5" fill="#e2b54f" stroke="#7a5418" strokeWidth="0.8" />
      <circle cx="30" cy="28" r="1.3" fill="#3a210d" />
      <g className="reef-chest-lid">
        <path d="M6 22 V16 Q6 6 30 6 Q54 6 54 16 V22 Z" fill="#7a4a22" stroke="#3a210d" strokeWidth="1.5" />
        <path d="M13 8.2 V22 H18 V7.2 Z M42 7.2 V22 H47 V8.2 Z" fill="#c9973a" />
      </g>
      <path className="reef-glint" d="M30 -8 L32 0 L40 2 L32 4 L30 12 L28 4 L20 2 L28 0 Z" fill="#fff6c8" />
    </svg>
  );
}

function Bottle({ label, list, links, x, leaving, compact, fullscreen, onDismiss, onOpen, onEnd, surfaceY, pillBottom }: MomentProps & { surfaceY: number; pillBottom: number | null }) {
  const w = fullscreen ? 72 : 52;
  const h = Math.round(w * 0.5);
  return (
    <div
      className={`reef-visitor reef-visitor-bottle absolute z-[35] h-0 w-0 ${leaveClass(leaving)}`}
      style={{ left: `${(x * 100).toFixed(2)}%`, top: bottleRestY(surfaceY, h, pillBottom) }}
      onAnimationEnd={onEnd}
    >
      <div className="reef-bottle-drift relative h-0 w-0">
        <button
          type="button"
          data-reef-nofeed
          disabled={leaving}
          className={`reef-bottle-bob absolute ${BODY}`}
          style={{ left: -w / 2, top: -h / 2, width: w, height: h }}
          aria-label={`Send the bottle away: ${label.head}`}
          title="Click to send the bottle away"
          onClick={onDismiss}
        >
          <BottleArt />
        </button>
        <VisitorCard label={label} list={list} links={links} tone="note" align={cardAlign(x)} compact={compact} fullscreen={fullscreen} onOpen={onOpen} className="reef-bottle-note" style={{ top: h / 2 + 10 }} />
      </div>
    </div>
  );
}

function BottleArt() {
  return (
    <svg viewBox="0 -6 68 34" className="block h-full w-full overflow-visible" aria-hidden="true">
      <g transform="rotate(-12 32 14)">
        <path
          d="M6 6 Q2 6 2 14 Q2 22 6 22 H40 Q46 22 49 18 H56 V10 H49 Q46 6 40 6 Z"
          fill="rgb(126 200 168 / 0.45)" stroke="rgb(214 255 236 / 0.85)" strokeWidth="1.2"
        />
        <rect x="9" y="10" width="26" height="8" rx="2" fill="#f4ead2" />
        <path d="M12 13 H31 M12 15.5 H27" stroke="#b39a6b" strokeWidth="0.8" />
        <path d="M8 9 H36" stroke="white" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" />
        <rect className="reef-bottle-cork" x="55" y="10.5" width="7" height="7" rx="1.5" fill="#b07a45" stroke="#6e4523" strokeWidth="0.8" />
      </g>
      <path className="reef-glint reef-glint-cork" d="M62 -2 L63.4 3.6 L69 5 L63.4 6.4 L62 12 L60.6 6.4 L55 5 L60.6 3.6 Z" fill="#fff6c8" />
    </svg>
  );
}

function Whale({ label, list, links, x, leaving, fullscreen, onDismiss, onOpen, onEnd }: MomentProps) {
  const w = fullscreen ? 600 : 240;
  const h = Math.round(w * 0.3);
  // `x` seeds each whale's depth and where in its cruise it starts, so up to three never swim in step.
  const dur = fullscreen ? 52 : 36;
  const top = `calc(${fullscreen ? '52%' : '46%'} + ${((x - 0.5) * (fullscreen ? 140 : 24)).toFixed(0)}px)`;
  const born = useRef(0);
  const cruiseRef = useRef<HTMLDivElement>(null);
  const [exit, setExit] = useState<1 | -1>(-1);
  useEffect(() => {
    born.current = performance.now();
  }, []);
  // Exit heading is read once from the cruise, so a fullscreen toggle or paused cruise cannot flip it; clock as fallback.
  const timing = useRef({ dur, x });
  useLayoutEffect(() => {
    timing.current = { dur, x };
  }, [dur, x]);
  useLayoutEffect(() => {
    if (!leaving) return;
    const progress = cruiseRef.current?.getAnimations?.()[0]?.effect?.getComputedTiming().progress;
    const { dur: d, x: seed } = timing.current;
    setExit(whaleExit(typeof progress === 'number' ? progress : whalePhase((performance.now() - born.current) / 1000, d, seed)));
  }, [leaving]);
  const vars: Vars = { top, '--ww': `${w}px`, '--dur': `${dur}s`, '--delay': `${(-x * dur).toFixed(2)}s`, '--seed': x.toFixed(3), '--exit': String(exit) };
  // Two layers that cruise in step: the body behind the fish, its card above them.
  return (
    <>
      <div className={`reef-visitor reef-visitor-whale absolute inset-x-0 z-[5] h-0 ${leaveClass(leaving)}`} style={vars} onAnimationEnd={onEnd}>
        <div className="reef-whale-exit relative h-0">
          <div ref={cruiseRef} className="reef-whale-cruise relative h-0">
            <div className="reef-whale-face absolute left-0" style={{ top: -h / 2, width: w, height: h }}>
              {/* Only the silhouette takes the click, so open water around it still feeds. */}
              <button
                type="button"
                data-reef-nofeed
                disabled={leaving}
                className="reef-whale-swim pointer-events-none block h-full w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
                aria-label={`Send the whale away: ${label.lines[0]?.title ?? label.head}`}
                title="Click to send the whale away"
                onClick={onDismiss}
              >
                <svg viewBox="0 0 400 120" className="block h-full w-full overflow-visible" aria-hidden="true">
                  <path
                    className="pointer-events-auto"
                    d="M12 62 C12 36 60 22 130 24 C210 26 280 40 330 56 C345 50 362 34 392 24 C384 44 372 56 360 62 C372 68 384 80 392 100 C362 90 345 74 330 68 C280 84 200 98 130 96 C70 94 30 86 18 76 C14 72 12 68 12 62 Z M120 88 C130 104 150 116 176 118 C162 106 150 96 146 90 Z"
                    fill="rgb(3 14 26 / 0.5)"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className={`reef-visitor absolute inset-x-0 z-[34] h-0 ${leaveClass(leaving)}`} style={vars}>
        <div className="reef-whale-cruise relative h-0">
          <VisitorCard label={label} list={list} links={links} tone="whale" align="center" compact={false} fullscreen={fullscreen} onOpen={onOpen} className="reef-whale-caption" style={{ top: h / 2 + 6, left: w / 2 }} />
        </div>
      </div>
    </>
  );
}

const TONE: Record<'chest' | 'note' | 'whale', string> = {
  chest: 'rounded-xl bg-black/60 px-3 py-2 text-white shadow-xl ring-1 ring-amber-300/60 backdrop-blur-md',
  note: 'reef-note rounded-md px-3 py-2 shadow-lg',
  whale: 'rounded-full bg-black/35 px-3 py-1 text-white/90 backdrop-blur-sm',
};
const HEAD_TONE: Record<'chest' | 'note' | 'whale', string> = { chest: 'text-amber-200', note: 'reef-note-key', whale: 'text-sky-200/90' };
const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
const LINK = 'cursor-pointer hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current';

function VisitorCard({ label, list, links, tone, align, compact, fullscreen, onOpen, className, style }: {
  label: VisitorLabel;
  list: boolean;
  links: (string | null)[];
  tone: 'chest' | 'note' | 'whale';
  align: CardAlign;
  compact: boolean;
  fullscreen: boolean;
  onOpen: () => void;
  className: string;
  style: CSSProperties;
}) {
  const size = fullscreen ? 'text-sm' : 'text-xs';
  const width = fullscreen ? 'max-w-[320px]' : 'max-w-[240px]';
  const base = `reef-visitor-card reef-card-${align} pointer-events-auto absolute ${compact ? 'reef-card-compact' : ''}`;
  const [first] = label.lines;
  // Compact: one line (icon + title, or the batch head) until hovered or focused, then the full card.
  // The short line repeats the full card (still read, only visually hidden), so screen readers skip it.
  const short = (text: string | undefined) =>
    compact ? <div aria-hidden="true" className="reef-card-short max-w-[156px] truncate font-semibold">{label.icon} {text}</div> : null;
  const focusRing = compact ? FOCUS_RING : '';
  if (list) {
    return (
      <div
        data-reef-nofeed
        tabIndex={compact ? 0 : undefined}
        {...(compact ? { role: 'group', 'aria-label': label.head } : {})}
        className={`${base} w-max ${compact ? '' : 'min-w-[200px]'} ${width} ${TONE[tone]} ${size} ${focusRing} ${className}`}
        style={style}
      >
        {short(label.head)}
        {/* Compact, the group's label already says the head; the links below stay readable. */}
        <div aria-hidden={compact || undefined} className={`reef-card-full min-w-[176px] font-semibold ${HEAD_TONE[tone]}`}>{label.icon} {label.head}</div>
        <ul className={`reef-card-full reef-visitor-list mt-1 overflow-y-auto overscroll-contain pr-1 ${fullscreen ? 'max-h-[180px]' : 'max-h-[84px]'}`}>
          {label.lines.map((l, i) => {
            const href = links[i];
            const body = (
              <>
                {l.detail && <span className="flex-none opacity-70">{l.detail}</span>}
                <span className="truncate" title={l.title}>{l.title}</span>
              </>
            );
            return (
              <li key={i} className="leading-snug">
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" onClick={onOpen} onAuxClick={(e) => { if (e.button === 1) onOpen(); }} className={`flex min-w-0 gap-2 ${LINK}`}>{body}</a>
                ) : (
                  <div className="flex min-w-0 gap-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  if (tone === 'whale') {
    return (
      <div data-reef-nofeed className={`${base} flex w-max items-center gap-1.5 whitespace-nowrap ${size} ${TONE.whale} ${className}`} style={style}>
        <span>{label.icon}</span>
        <span className={`truncate font-semibold ${fullscreen ? 'max-w-[420px]' : 'max-w-[200px]'}`}>{first?.title}</span>
        {first?.detail && <span className="text-white/60">· {first.detail}</span>}
      </div>
    );
  }
  const content = (
    <>
      {short(first?.title)}
      <div className="reef-card-full">
        <div className={`truncate font-semibold ${HEAD_TONE[tone]}`}>
          {label.icon} {label.head}{first?.detail ? ` · ${first.detail}` : ''}
        </div>
        <div className="mt-0.5 line-clamp-2 leading-snug">{first?.title}</div>
      </div>
    </>
  );
  const cls = `${base} block w-max ${width} ${TONE[tone]} ${size} ${className}`;
  const href = links[0];
  if (!href) {
    // Compact, the group's label carries the whole card once; its drawn text is hidden from screen readers.
    const full = `${label.head}${first?.detail ? ` · ${first.detail}` : ''}: ${first?.title ?? ''}`;
    return (
      <div
        data-reef-nofeed
        tabIndex={compact ? 0 : undefined}
        {...(compact ? { role: 'group', 'aria-label': full } : {})}
        className={`${cls} ${focusRing}`}
        style={style}
      >
        {compact ? <div aria-hidden="true">{content}</div> : content}
      </div>
    );
  }
  return (
    <a data-reef-nofeed href={href} target="_blank" rel="noreferrer" onClick={onOpen} onAuxClick={(e) => { if (e.button === 1) onOpen(); }} title="Open in a new tab" className={`${cls} cursor-pointer transition-[filter] hover:brightness-110 ${FOCUS_RING}`} style={style}>
      {content}
    </a>
  );
}
