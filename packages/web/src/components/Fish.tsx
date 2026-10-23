import { useId, useMemo, useState } from 'react';
import { fishSvg } from '@gtr/shared';

// Procedural fish renderer — the SVG comes from @gtr/shared so the
// server (which names the catch) and the web (which draws it) can never
// disagree about what a species looks like.

export function Fish({ species, shiny, className, title }: {
  species: number;
  shiny?: boolean;
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const svg = useMemo(() => fishSvg(species, !!shiny, uid), [species, shiny, uid]);
  return <div className={className} title={title} dangerouslySetInnerHTML={{ __html: svg }} />;
}

// Legendary tier renders the legendary fish art: drop PNGs at
// packages/web/public/reef/legendary/1.png, 2.png, … (award order). Until an
// image lands the legend shows as a mystery silhouette.
export function LegendFish({ index, name, className }: {
  index: number;
  name: string;
  className?: string;
}) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <div
        className={`flex items-center justify-center rounded-full bg-zinc-800 text-3xl dark:bg-zinc-900 ${className ?? ''}`}
        title={`${name} — awaiting art (public/reef/legendary/${index + 1}.png)`}
      >
        <span className="opacity-40 grayscale">🐋</span>
      </div>
    );
  }
  return (
    <img
      src={`/reef/legendary/${index + 1}.png`}
      alt={name}
      title={name}
      className={className}
      onError={() => setMissing(true)}
    />
  );
}
