import { useEffect, useLayoutEffect, useRef } from 'react';
import { isLegendary } from '@gtr/shared';
import type { PlaqueLines } from '../lib/tankPlaque';

// Museum placard beside a clicked fish; Tank.tsx positions it and the Dex link is the only way out of the tank.
export function TankPlaque({
  lines, species, compact, reserveTop, elRef, onPlace, onClose, onDex,
}: {
  lines: PlaqueLines;
  species: number;
  compact: boolean;
  /** px of the fullscreen top band the plaque keeps clear of */
  reserveTop: number;
  elRef: React.RefObject<HTMLDivElement>;
  onPlace: () => void;
  onClose: () => void;
  onDex: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Place before first paint, and again whenever the content (and so the size) changes.
  useLayoutEffect(onPlace, [onPlace, species, compact, reserveTop]);
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [species]);
  return (
    <div
      ref={elRef}
      data-reef-nofeed
      role="dialog"
      aria-label={`${lines.name} plaque`}
      className={`reef-plaque ${compact ? 'reef-plaque-compact' : ''}`}
      // The 16px is the CSS max-height's top and bottom margin; the band takes the rest off the top.
      style={reserveTop > 0 ? { maxHeight: `calc(100% - ${16 + reserveTop}px)` } : undefined}
    >
      <button ref={closeRef} type="button" className="reef-plaque-close" aria-label="Close plaque" onClick={onClose}>
        ✕
      </button>
      <div className="reef-plaque-rarity" data-rarity={lines.rarity}>
        {lines.shiny ? '✨ shiny · ' : ''}{lines.rarity}
      </div>
      <div className="reef-plaque-name">{lines.name}</div>
      {lines.sci && <div className="reef-plaque-sci">{lines.sci}</div>}
      {lines.marks && <p className="reef-plaque-marks">{lines.marks}</p>}
      {lines.fact && <p className="reef-plaque-fact">{lines.fact}</p>}
      <dl className="reef-plaque-stats">
        <div><dt>Best</dt><dd>{lines.best}</dd></div>
        <div><dt>Caught</dt><dd>{lines.count}</dd></div>
        <div><dt>First</dt><dd>{lines.first}</dd></div>
      </dl>
      <div className="reef-plaque-foot">
        <span className={lines.setDone ? 'reef-plaque-set-done' : undefined}>
          {lines.setDone ? '★ ' : ''}{lines.set}
        </span>
        {!isLegendary(species) && (
          <a
            href={`/reef?species=${species}`}
            onClick={(e) => {
              e.preventDefault();
              onDex();
            }}
          >
            Open in Dex →
          </a>
        )}
      </div>
    </div>
  );
}
