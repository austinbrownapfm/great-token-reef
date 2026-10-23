import { useId, useMemo } from 'react';
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
