// The Reef Dex v2 — body-plan SVG builders (art direction approved
// 2026-08-27, prototype: the "Reef Dex" artifact). Each builder draws one
// species-recognizable fish, facing LEFT in a 320×180 viewBox, deriving every
// color from the palette so pigment morphs recolor cleanly. Layering rule:
// fins first (bases tuck under), body, then markings and face.

import type { Palette } from './fishCatalog.ts';

export type PlanOpts = Record<string, unknown>;
export type PlanBuilder = (uid: string, p: Palette, o?: PlanOpts) => string;

export function grad(uid: string, top: string, mid: string, belly: string): string {
  return `<linearGradient id="${uid}-b" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${top}"/><stop offset="0.55" stop-color="${mid}"/>
    <stop offset="1" stop-color="${belly}"/></linearGradient>`;
}

export function eye(x: number, y: number, r: number, iris = '#8a7440', pupil = '#0c0d0a'): string {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#181a14"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.82}" fill="${iris}"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.45}" fill="${pupil}"/>
    <circle cx="${x - r * 0.3}" cy="${y - r * 0.35}" r="${r * 0.2}" fill="#f4f7f5"/>`;
}

const svgOpen = (label: string) =>
  `<svg viewBox="0 0 320 180" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">`;

// ---------------------------------------------------------------------------
// bass — perciform gamefish (Largemouth/Smallmouth, Yellow Perch, Walleye,
// Striped Bass). o.vbars: vertical bars; o.hstripes: horizontal stripes;
// default: broken lateral blotch row.

export const bass: PlanBuilder = (uid, p, o = {}) => {
  let marks = '';
  if (o['hstripes']) {
    for (let i = 0; i < 5; i++) {
      const y = 74 + i * 12;
      marks += `<path d="M78 ${y} C130 ${y + 4} 190 ${y + 5} 248 ${y + 2}" stroke="${p.mark}" stroke-width="3" fill="none" opacity="0.6"/>`;
    }
  } else if (o['vbars']) {
    for (let i = 0; i < 7; i++) {
      const x = 92 + i * 22;
      marks += `<path d="M${x} 62 q5 32 0 58" stroke="${p.mark}" stroke-width="9" fill="none" opacity="0.28" stroke-linecap="round"/>`;
    }
  } else {
    for (let i = 0; i < 9; i++) {
      const x = 92 + i * 17.5, y = 93 + ((i % 3) - 1) * 2.5;
      marks += `<ellipse cx="${x}" cy="${y}" rx="${9 + (i % 2) * 2.5}" ry="${5.5 + (i % 3)}" fill="${p.mark}" opacity="0.82"/>`;
    }
    marks += [[110, 62], [145, 60], [180, 64], [215, 72]]
      .map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="16" ry="7" fill="${p.mark}" opacity="0.28"/>`).join('');
  }
  return `${svgOpen('bass')}
  <defs>${grad(uid, p.back, p.mid, p.belly)}</defs>
  <path d="M252 86 C266 76 278 66 292 60 C286 78 286 88 289 95 C286 102 286 112 292 130 C278 124 266 114 252 104 Z" fill="${p.fin}"/>
  <path d="M106 55 L114 34 L121 51 L129 33 L136 50 L144 34 L151 50 L159 37 L164 53 C145 56 125 56 106 55 Z" fill="${p.fin}" opacity="0.92"/>
  <path d="M172 57 C178 42 196 40 208 46 C215 54 220 66 223 74 C205 66 188 60 172 57 Z" fill="${p.fin}" opacity="0.92"/>
  <path d="M182 128 C188 142 200 146 212 142 C208 134 204 126 200 120 C194 124 188 126 182 128 Z" fill="${p.fin}" opacity="0.92"/>
  <path d="M116 128 C118 140 126 144 134 142 C132 134 130 128 128 124 Z" fill="${p.fin}" opacity="0.92"/>
  <path d="M30 95 C45 70 70 58 105 54 C140 50 180 56 225 74 C238 79 246 82 252 86 L252 104 C240 112 210 124 175 130 C135 137 90 128 62 112 C48 104 36 100 30 95 Z" fill="url(#${uid}-b)"/>
  ${marks}
  <path d="M92 102 C106 104 116 112 120 122 C110 122 100 118 92 112 Z" fill="${p.fin}"/>
  <path d="M84 62 C94 78 96 100 88 118" fill="none" stroke="${p.mark}" stroke-width="2" opacity="0.5"/>
  <path d="M74 68 C82 80 84 98 78 112" fill="none" stroke="${p.mark}" stroke-width="1.5" opacity="0.3"/>
  <path d="M30 97 C40 102 50 106 58 108" fill="none" stroke="${p.mark}" stroke-width="2.5" opacity="0.7" stroke-linecap="round"/>
  ${eye(60, 76, 7, p.iris, p.pupil)}
</svg>`;
};

// ---------------------------------------------------------------------------
// salmonid — trout & salmon. o.band: pink lateral band (rainbow); o.redSpots:
// haloed red spots (brown); o.lightSpots: light vermiculation + white-edged
// red fins (brook); default: sparse dark spots on silver (salmon).

export const salmonid: PlanBuilder = (uid, p, o = {}) => {
  const accent = p.accent ?? p.fin;
  const darkPts: [number, number][] = [[96, 66], [112, 60], [128, 70], [142, 62], [158, 68], [172, 60],
    [186, 70], [200, 64], [214, 72], [228, 66], [104, 80], [124, 84], [148, 80], [168, 84], [190, 80],
    [212, 84], [232, 80], [152, 50], [188, 52], [276, 84], [280, 104], [150, 48]];
  let spots: string;
  if (o['lightSpots']) {
    spots = darkPts.map(([x, y], i) =>
      `<circle cx="${x}" cy="${y}" r="${1.8 + (i % 3) * 0.4}" fill="${p.mark}" opacity="0.9"/>`).join('');
    spots += [[120, 92], [160, 94], [200, 92]].map(([x, y]) =>
      `<circle cx="${x}" cy="${y}" r="2.6" fill="${accent}" opacity="0.9"/>`).join('');
    spots += `<path d="M100 58 q8 -6 16 0 q8 6 16 0 q8 -6 16 0 q8 6 16 0 q8 -6 16 0" stroke="${p.mark}" stroke-width="1.6" fill="none" opacity="0.7"/>`;
  } else if (o['redSpots']) {
    spots = darkPts.slice(0, 14).map(([x, y], i) =>
      `<circle cx="${x}" cy="${y}" r="${1.6 + (i % 3) * 0.4}" fill="${p.mark}" opacity="0.85"/>`).join('');
    spots += [[110, 84], [150, 88], [190, 86], [225, 84]].map(([x, y]) =>
      `<g><circle cx="${x}" cy="${y}" r="3.6" fill="${p.belly}" opacity="0.9"/><circle cx="${x}" cy="${y}" r="2.2" fill="${accent}"/></g>`).join('');
  } else {
    const n = o['band'] ? darkPts.length : 12;
    spots = darkPts.slice(0, n).map(([x, y], i) =>
      `<circle cx="${x}" cy="${y}" r="${1.6 + (i % 3) * 0.4}" fill="${p.mark}" opacity="0.85"/>`).join('');
  }
  const band = o['band']
    ? `<ellipse cx="66" cy="88" rx="13" ry="11" fill="${accent}" opacity="0.5"/>
       <path d="M70 90 C120 96 180 98 256 96 L256 104 C180 108 120 106 68 100 Z" fill="${accent}" opacity="0.6"/>`
    : '';
  const finEdge = o['lightSpots']
    ? `<path d="M196 118 C199 126 204 131 210 133" stroke="${p.belly}" stroke-width="2.5" fill="none"/>
       <path d="M126 118 C128 125 132 129 137 131" stroke="${p.belly}" stroke-width="2.5" fill="none"/>`
    : '';
  return `${svgOpen('salmonid')}
  <defs>${grad(uid, p.back, p.mid, p.belly)}</defs>
  <path d="M258 88 C270 80 280 72 292 66 L288 94 L292 122 C280 116 270 108 258 100 Z" fill="${p.fin}"/>
  <path d="M138 57 C144 44 158 42 168 46 C170 52 172 58 173 60 C161 58 150 57 138 57 Z" fill="${p.fin}" opacity="0.9"/>
  <path d="M218 70 C221 62 229 61 233 67 C229 71 223 72 218 70 Z" fill="${p.fin}"/>
  <path d="M26 92 C44 72 74 62 112 58 C150 54 195 60 235 76 C245 80 252 84 258 88 L258 100 C250 106 242 110 232 112 C192 122 140 122 100 114 C70 108 44 102 26 92 Z" fill="url(#${uid}-b)"/>
  ${band}${spots}
  <path d="M196 118 C200 130 210 134 220 130 C217 123 214 117 212 112 Z" fill="${p.fin}" opacity="0.9"/>
  <path d="M126 118 C128 128 135 132 142 130 C140 123 138 118 136 114 Z" fill="${p.fin}" opacity="0.9"/>
  ${finEdge}
  <path d="M88 100 C100 102 108 108 112 116 C103 116 94 112 88 106 Z" fill="${p.fin}"/>
  <path d="M80 66 C88 80 90 98 84 110" fill="none" stroke="${p.mark}" stroke-width="1.8" opacity="0.45"/>
  <path d="M26 94 C36 98 44 101 52 103" fill="none" stroke="${p.mark}" stroke-width="2" opacity="0.6" stroke-linecap="round"/>
  ${eye(54, 80, 6.5, p.iris, p.pupil)}
</svg>`;
};

// ---------------------------------------------------------------------------
// panfish — deep-bodied sunfish (Bluegill, Pumpkinseed, Crappie).
// o.speckles: irregular flecks instead of vertical bars (crappie).

export const panfish: PlanBuilder = (uid, p, o = {}) => {
  let marks = '';
  if (o['speckles']) {
    const pts = [[110, 60], [130, 72], [150, 58], [170, 74], [190, 66], [125, 92], [145, 104],
      [165, 90], [185, 100], [140, 120], [160, 128], [120, 78], [180, 118], [200, 88], [155, 70]];
    marks = pts.map(([x, y], i) =>
      `<circle cx="${x}" cy="${y}" r="${2.2 + (i % 3)}" fill="${p.mark}" opacity="0.6"/>`).join('');
  } else {
    for (let i = 0; i < 6; i++) {
      const x = 112 + i * 18;
      marks += `<path d="M${x} 52 q6 42 0 84" stroke="${p.mark}" stroke-width="9" fill="none" opacity="0.2" stroke-linecap="round"/>`;
    }
  }
  const breast = p.accent
    ? `<radialGradient id="${uid}-br" cx="0.3" cy="0.8" r="0.75">
        <stop offset="0" stop-color="${p.accent}" stop-opacity="0.95"/>
        <stop offset="1" stop-color="${p.accent}" stop-opacity="0"/></radialGradient>`
    : '';
  const body = 'M50 92 C56 70 78 48 110 41 C150 33 190 50 214 76 C222 84 228 88 230 92 C228 100 222 108 214 116 C196 138 163 150 128 148 C94 146 64 122 50 92 Z';
  return `${svgOpen('panfish')}
  <defs>${grad(uid, p.back, p.mid, p.belly)}${breast}</defs>
  <path d="M228 84 C242 76 252 72 262 70 C258 84 258 100 262 116 C252 112 242 106 228 100 Z" fill="${p.fin}"/>
  <path d="M104 43 L110 26 L116 41 L123 26 L129 40 L136 27 L142 40 L149 28 L154 41 L161 30 L166 43 C145 44 124 44 104 43 Z" fill="${p.fin}" opacity="0.9"/>
  <path d="M166 44 C180 32 198 40 205 56 C197 62 187 64 177 64 C173 57 169 50 166 44 Z" fill="${p.fin}" opacity="0.9"/>
  <path d="M168 140 C182 150 198 146 205 132 C197 126 187 123 177 122 C173 128 170 134 168 140 Z" fill="${p.fin}" opacity="0.9"/>
  <path d="${body}" fill="url(#${uid}-b)"/>
  ${p.accent ? `<path d="${body}" fill="url(#${uid}-br)"/>` : ''}
  ${marks}
  <path d="M120 100 C132 104 140 112 143 122 C133 122 124 116 118 108 Z" fill="${p.fin}"/>
  <path d="M118 128 C120 140 128 145 136 143 C134 135 132 129 130 124 Z" fill="${p.fin}" opacity="0.9"/>
  <path d="M92 58 C102 74 104 96 96 114" fill="none" stroke="${p.mark}" stroke-width="2" opacity="0.5"/>
  <ellipse cx="110" cy="79" rx="10" ry="4.5" transform="rotate(12 110 79)" fill="${p.mark}"/>
  <path d="M52 90 C58 90 63 88 67 86" fill="none" stroke="${p.mark}" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>
  ${eye(84, 74, 7.5, p.iris ?? '#7c4a2e', p.pupil)}
</svg>`;
};

// ---------------------------------------------------------------------------
// catfish — Ictalurids. o.flat: flatter head + squared tail (flathead);
// spots only when the palette marks them (channel cat).

export const catfish: PlanBuilder = (uid, p, o = {}) => {
  const dots = o['flat'] || o['nospots'] ? '' : [[110, 90], [130, 84], [150, 92], [172, 86], [192, 94], [214, 88],
    [124, 98], [160, 100], [200, 98], [142, 80], [182, 78], [226, 94]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="${p.mark}" opacity="0.7"/>`).join('');
  const tail = o['flat']
    ? `<path d="M260 92 C272 84 282 76 292 68 L290 96 L292 128 C282 118 272 108 260 102 Z" fill="${p.fin}"/>`
    : `<path d="M260 92 C272 82 284 70 296 56 C292 76 289 88 288 95 L288 97 C289 106 292 118 296 136 C284 122 272 110 260 102 Z" fill="${p.fin}"/>`;
  return `${svgOpen('catfish')}
  <defs>${grad(uid, p.back, p.mid, p.belly)}</defs>
  ${tail}
  <path d="M122 67 L127 40 C133 45 139 54 143 63 Z" fill="${p.fin}"/>
  <path d="M206 71 C212 63 221 63 226 69 C220 72 213 73 206 71 Z" fill="${p.fin}"/>
  <path d="M24 88 C42 74 68 66 100 66 C152 66 206 72 248 84 C254 86 258 89 260 92 L260 102 C254 106 248 108 240 108 C190 112 120 112 70 106 C48 103 32 96 24 88 Z" fill="url(#${uid}-b)"/>
  ${dots}
  <path d="M150 110 C160 124 190 128 218 122 C214 116 208 111 200 108 C183 111 166 111 150 110 Z" fill="${p.fin}" opacity="0.9"/>
  <path d="M86 100 C98 102 106 110 109 120 C100 120 92 114 86 106 Z" fill="${p.fin}"/>
  <g stroke="${p.mark}" stroke-width="2.2" fill="none" stroke-linecap="round">
    <path d="M38 91 C56 100 72 114 82 132"/>
    <path d="M34 82 C42 74 50 70 58 68"/>
    <path d="M46 104 C52 114 58 122 64 128"/>
    <path d="M54 105 C62 112 70 118 78 124"/>
  </g>
  <path d="M78 70 C86 82 88 96 82 106" fill="none" stroke="${p.mark}" stroke-width="1.8" opacity="0.5"/>
  <path d="M24 90 C32 94 40 97 48 99" fill="none" stroke="${p.mark}" stroke-width="2" opacity="0.6" stroke-linecap="round"/>
  ${eye(52, 80, 4.5, p.iris ?? '#4a4234', p.pupil)}
</svg>`;
};

// ---------------------------------------------------------------------------
// reef — small compressed reef fish. Default: clownfish (three edged bars;
// o.misbar breaks them).
// o.tang: palette-knife flank marking + accent tail. o.angel: diagonal
// stripes + eye mask + trailing dorsal.

export const reef: PlanBuilder = (uid, p, o = {}) => {
  const edge = p.edge ?? p.mark;
  const bar = p.bar ?? '#fbf7ee';
  const body = 'M58 94 C72 66 104 50 140 50 C176 50 208 66 224 92 C226 96 228 100 228 102 C224 112 216 122 204 130 C184 142 152 146 124 140 C96 134 72 118 58 94 Z';
  let overlay = '';
  let tailFill = p.mid, finStroke = `stroke="${edge}" stroke-width="2.5"`, dorsalExtra = '';
  if (o['tang']) {
    tailFill = p.accent ?? p.fin;
    finStroke = `stroke="${p.mark}" stroke-width="1.5"`;
    overlay = `<path d="M92 66 C130 58 176 60 204 78 C186 76 170 78 160 86 C150 94 148 104 152 116 C132 118 108 108 94 92 C90 82 90 73 92 66 Z" fill="${p.mark}" opacity="0.92"/>
      <path d="M152 116 C170 112 190 100 204 78 C210 90 210 102 202 114 C188 124 168 124 152 116 Z" fill="${p.mid}" opacity="0.35"/>`;
  } else if (o['angel']) {
    for (let i = 0; i < 7; i++) {
      const x = 96 + i * 20;
      overlay += `<path d="M${x} 130 C${x + 22} 108 ${x + 34} 84 ${x + 38} 58" stroke="${bar}" stroke-width="6" fill="none" opacity="0.85"/>`;
    }
    overlay += `<path d="M64 76 C74 70 88 70 98 78 C96 92 84 100 70 96 C64 90 62 82 64 76 Z" fill="${p.mark}" opacity="0.9"/>`;
    dorsalExtra = `<path d="M196 54 C212 50 226 54 234 66 C224 64 214 64 206 68 Z" fill="${p.fin}"/>`;
  } else {
    const b = (d: string) => `<path d="${d}" fill="${bar}" stroke="${edge}" stroke-width="2.5"/>`;
    overlay = b('M96 58 C90 78 90 100 96 124 C104 127 111 127 117 124 C111 100 111 80 117 58 C110 55 102 55 96 58 Z');
    // o.misbar: the middle bar stops halfway and the tail bar is missing.
    overlay += o['misbar']
      ? b('M150 51 C144 66 143 78 147 88 C156 92 166 92 175 88 C172 76 172 64 178 53 C168 49 158 49 150 51 Z')
      : b('M150 51 C144 68 142 82 148 95 C142 108 144 124 152 139 C162 142 171 141 179 137 C173 122 173 108 178 96 C172 84 172 68 178 53 C168 49 158 49 150 51 Z') +
        b('M206 76 C202 88 202 102 206 116 C212 120 219 121 225 118 C222 106 222 90 225 80 C219 76 212 75 206 76 Z');
  }
  return `${svgOpen('reef')}
  <defs>${grad(uid, p.back, p.mid, p.belly)}</defs>
  <path d="M228 92 C240 82 252 76 264 74 C262 88 262 104 264 122 C252 118 240 110 228 104 Z" fill="${tailFill}" ${finStroke}/>
  <path d="M112 53 L118 40 L124 50 L131 40 L137 49 L144 41 L149 50 C137 52 124 53 112 53 Z" fill="${p.fin}" ${finStroke}/>
  <path d="M158 51 C170 39 188 42 196 54 C184 56 170 55 158 51 Z" fill="${p.fin}" ${finStroke}/>
  ${dorsalExtra}
  <path d="M168 138 C178 148 192 146 199 136 C189 132 178 130 170 130 Z" fill="${p.fin}" ${finStroke}/>
  <path d="M122 130 C124 142 132 147 141 144 C138 136 135 130 132 125 Z" fill="${p.fin}" ${finStroke}/>
  <path d="${body}" fill="url(#${uid}-b)"/>
  ${overlay}
  <path d="M116 98 C130 100 140 108 144 120 C132 121 121 115 114 106 Z" fill="${p.fin}" ${finStroke}/>
  ${eye(80, 84, 8, p.iris ?? '#e8862f', p.pupil)}
</svg>`;
};

// ---------------------------------------------------------------------------
// pelagic — tunas & mackerels: fusiform, sickle fins, finlets, crescent tail.

export const pelagic: PlanBuilder = (uid, p, o = {}) => {
  const accent = p.accent ?? p.fin;
  // o.longfin: the very long second dorsal and anal fins of big yellowfin.
  const dorsal2 = o['longfin']
    ? 'M172 60 C186 40 204 20 230 4 C214 28 198 50 188 64 C182 63 177 62 172 60 Z'
    : 'M172 60 C182 46 196 38 212 34 C203 48 194 58 188 64 C182 63 177 62 172 60 Z';
  const anal = o['longfin']
    ? 'M186 116 C200 136 220 156 246 172 C230 148 212 126 200 112 C195 114 190 115 186 116 Z'
    : 'M186 116 C196 130 210 140 226 144 C216 130 207 120 200 112 C195 114 190 115 186 116 Z';
  let finlets = '';
  for (let i = 0; i < 5; i++) {
    const x = 214 + i * 10, y = 66 + i * 3.6;
    finlets += `<path d="M${x} ${y} l7 -7 l2 8 Z" fill="${accent}"/>`;
    const bx = 220 + i * 9, by = 112 - i * 2.6;
    finlets += `<path d="M${bx} ${by} l7 7 l2 -8 Z" fill="${accent}"/>`;
  }
  return `${svgOpen('pelagic')}
  <defs>${grad(uid, p.back, p.mid, p.belly)}</defs>
  <path d="M264 94 C276 84 288 68 296 48 C298 64 294 82 286 95 L286 97 C294 110 298 128 296 144 C288 124 276 108 264 98 Z" fill="${p.fin}"/>
  <path d="${dorsal2}" fill="${accent}"/>
  <path d="${anal}" fill="${accent}"/>
  ${finlets}
  <path d="M122 62 L130 44 C136 50 140 56 143 61 Z" fill="${p.fin}"/>
  <path d="M20 96 C42 76 84 64 132 62 C176 60 216 70 246 84 C254 88 260 91 264 94 L264 98 C258 102 252 105 244 107 C210 116 168 120 128 116 C84 112 44 106 20 96 Z" fill="url(#${uid}-b)"/>
  <path d="M84 96 C130 102 190 104 244 100" fill="none" stroke="${accent}" stroke-width="3" opacity="0.35" stroke-linecap="round"/>
  <path d="M108 92 C130 96 152 104 168 114 C152 114 134 110 118 104 C112 100 108 96 108 92 Z" fill="${p.fin}"/>
  <path d="M72 74 C80 84 82 96 78 106" fill="none" stroke="${p.mark}" stroke-width="1.8" opacity="0.6"/>
  <path d="M20 96 C28 99 36 101 44 103" fill="none" stroke="${p.mark}" stroke-width="2" opacity="0.7" stroke-linecap="round"/>
  ${eye(56, 88, 6, p.iris ?? '#3d3a2a', p.pupil)}
</svg>`;
};

// ---------------------------------------------------------------------------
// Body plans authored 2026-08-27 (batch a) — verified by contact-sheet render.

// Contract: fn(uid, palette, opts) => one <svg> string, viewBox 0 0 320 180,
// fish faces LEFT. Fins paint BEFORE the body so their bases tuck under;
// details (marks, pectoral, gill line, mouth, eye) after.

/* ---------- Northern Pike / Barracuda ---------- */
export function pike(uid: string, p: Palette, o: PlanOpts = {}): string {
  const { back, mid, belly, fin, mark, bar = p.belly, iris = '#c9a23c', pupil = '#0c0d0a' } = p;
  const cuda = o.snout === 'barracuda';
  let marks: string;
  if (cuda) {
    marks = [[128, 100], [156, 104], [184, 99], [210, 104], [232, 99], [142, 92], [198, 92]]
      .map(([x, y], i) => `<ellipse cx="${x}" cy="${y}" rx="${6 + (i % 2) * 2}" ry="4" fill="${mark}" opacity="0.65"/>`).join('');
  } else if (o.vbars) {
    marks = [104, 122, 140, 158, 176, 194, 212, 230]
      .map((x, i) => `<path d="M${x} ${71 + i} q4 ${16 - i / 2} 0 ${32 - i * 1.5}" stroke="${bar}" stroke-width="6" fill="none" opacity="0.6" stroke-linecap="round"/>`).join('');
  } else {
    const rows = [];
    for (let r = 0; r < 3; r++) for (let i = 0; i < 9; i++) {
      const x = 100 + i * 16 + (r % 2) * 8, y = [77, 90, 103][r]! + (i % 2);
      if (x < 246) rows.push(`<ellipse cx="${x}" cy="${y}" rx="4.4" ry="2.1" fill="${bar}" opacity="0.7"/>`);
    }
    marks = rows.join('');
  }
  const body = cuda
    ? `M10 88 C40 80 74 74 112 70 C158 66 208 68 250 80 L250 100 C208 113 158 115 112 111 C76 108 44 101 30 96 C22 93 14 90 10 88 Z`
    : `M18 85 C44 77 76 71 112 68 C158 64 208 66 250 80 L250 100 C208 114 158 116 112 112 C74 108 42 101 18 95 Z`;
  const teeth = [];
  if (cuda) {
    for (let i = 0; i < 5; i++) teeth.push(`<path d="M${20 + i * 7.5} ${88.6 + i * 0.5} l2.2 3.8 l2.2 -3.8 Z" fill="${belly}"/>`);
    for (let i = 0; i < 5; i++) teeth.push(`<path d="M${12 + i * 8} ${95.6 - i * 0.2} l2 -4 l2 4 Z" fill="${belly}"/>`);
  } else {
    for (let i = 0; i < 6; i++) teeth.push(`<path d="M${24 + i * 6.5} ${90.4 + i * 0.35} l2.2 3.6 l2.2 -3.6 Z" fill="${belly}"/>`);
  }
  const jaw = cuda
    ? `<path d="M2 97 C16 93.5 32 92.5 48 93.5 L50 98.5 C34 100.5 16 100 4 99.5 Z" fill="${mid}"/>
       <path d="M10 88 C28 89.5 46 91 62 91" fill="none" stroke="${mark}" stroke-width="2" opacity="0.75" stroke-linecap="round"/>
       <path d="M2 97 C18 94.5 34 93.5 50 94.5" fill="none" stroke="${mark}" stroke-width="1.6" opacity="0.55" stroke-linecap="round"/>`
    : `<path d="M18 90 C36 92.5 52 93.5 66 92.5" fill="none" stroke="${mark}" stroke-width="2" opacity="0.7" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 320 180" role="img" aria-label="${cuda ? 'Great Barracuda' : 'Northern Pike'}">
  <defs>${grad(uid, back, mid, belly)}</defs>
  <path d="M248 80 C260 72 272 68 282 70 C290 76 294 83 294 90 C294 97 290 104 282 110 C272 112 260 108 248 100 Z" fill="${fin}"/>
  <g stroke="${mark}" stroke-width="1.4" fill="none" opacity="0.3">
    <path d="M258 82 C270 78 280 76 288 78"/><path d="M260 90 C272 89 282 89 290 90"/>
    <path d="M258 98 C270 102 280 104 288 102"/></g>
  <path d="M196 75 C202 56 220 51 234 57 L240 77 C226 72 210 72 196 75 Z" fill="${fin}" opacity="0.95"/>
  <path d="M200 105 C206 124 222 129 234 123 L240 103 C227 109 213 109 200 105 Z" fill="${fin}" opacity="0.95"/>
  <path d="M136 109 C138 122 146 127 155 125 C152 117 149 111 146 106 Z" fill="${fin}" opacity="0.9"/>
  <path d="${body}" fill="url(#${uid}-b)"/>
  ${marks}
  <path d="M90 100 C103 102 112 109 116 119 C106 119 97 114 90 107 Z" fill="${fin}"/>
  ${jaw}
  ${teeth.join('')}
  <path d="M80 72 C89 84 91 98 84 108" fill="none" stroke="${mark}" stroke-width="2" opacity="0.5"/>
  <path d="M71 75 C78 85 80 96 75 105" fill="none" stroke="${mark}" stroke-width="1.5" opacity="0.3"/>
  ${eye(cuda ? 60 : 58, 80, 6, iris, pupil)}
</svg>`;
}

/* ---------- Alligator Gar ---------- */
export function gar(uid: string, p: Palette, _o: PlanOpts = {}): string {
  const { back, mid, belly, fin, mark, iris = '#8a7440', pupil = '#0c0d0a' } = p;
  const body = `M14 87 C38 82 62 78 90 73 C148 65 210 68 250 80 L250 98 C210 109 148 112 90 106 C62 103 38 96 14 91 Z`;
  const hatch = [];
  for (let x = 100; x <= 232; x += 13) {
    hatch.push(`<path d="M${x} 70 L${x + 20} 108" stroke="${mark}" stroke-width="1.1" opacity="0.22"/>`);
    hatch.push(`<path d="M${x + 20} 70 L${x} 108" stroke="${mark}" stroke-width="1.1" opacity="0.22"/>`);
  }
  const teeth = [];
  for (let i = 0; i < 8; i++) {
    teeth.push(`<path d="M${22 + i * 8} ${88.2 + i * 0.25} l2 3.4 l2 -3.4 Z" fill="${belly}"/>`);
    teeth.push(`<path d="M${26 + i * 8} ${92.4 + i * 0.2} l1.8 -3 l1.8 3 Z" fill="${belly}"/>`);
  }
  return `<svg viewBox="0 0 320 180" role="img" aria-label="Alligator Gar">
  <defs>${grad(uid, back, mid, belly)}
    <clipPath id="${uid}-c"><path d="${body}"/></clipPath></defs>
  <path d="M248 80 C258 74 268 71 277 73 C284 78 287 84 287 89 C287 94 284 101 277 106 C268 108 258 104 248 98 Z" fill="${fin}"/>
  <g stroke="${mark}" stroke-width="1.2" fill="none" opacity="0.3">
    <path d="M256 82 C266 79 274 78 281 79"/><path d="M256 96 C266 100 274 101 281 100"/></g>
  <path d="M212 78 C217 62 231 59 242 65 L245 80 C234 74 223 74 212 78 Z" fill="${fin}" opacity="0.95"/>
  <path d="M216 100 C221 116 235 119 244 113 L246 98 C236 104 226 104 216 100 Z" fill="${fin}" opacity="0.95"/>
  <path d="M156 107 C158 119 166 123 174 121 C171 114 168 108 166 104 Z" fill="${fin}" opacity="0.9"/>
  <path d="${body}" fill="url(#${uid}-b)"/>
  <g clip-path="url(#${uid}-c)">${hatch.join('')}</g>
  <path d="M100 98 C112 100 120 106 124 116 C114 116 105 111 98 104 Z" fill="${fin}"/>
  ${teeth.join('')}
  <path d="M14 89 C42 88 68 87 92 88" fill="none" stroke="${mark}" stroke-width="2" opacity="0.75" stroke-linecap="round"/>
  <path d="M18 86 C20 84.5 23 84 26 84.5" fill="none" stroke="${mark}" stroke-width="1.5" opacity="0.5" stroke-linecap="round"/>
  <path d="M92 74 C99 85 100 96 94 105" fill="none" stroke="${mark}" stroke-width="2" opacity="0.5"/>
  ${eye(76, 81, 4.5, iris, pupil)}
</svg>`;
}

/* ---------- Common Carp ---------- */
export function carp(uid: string, p: Palette, o: PlanOpts = {}): string {
  const { back, mid, belly, fin, mark, iris = '#c08a3a', pupil = '#0c0d0a' } = p;
  const body = `M46 92 C56 64 86 46 126 42 C170 38 208 56 228 82 C233 88 236 92 236 96 C232 104 225 112 215 120 C192 138 152 146 118 140 C84 134 58 118 46 92 Z`;
  const scaleMode = o.scales || 'full';
  let scales = '';
  if (scaleMode === 'full') {
    const arcs = [];
    for (let r = 0; r < 6; r++) for (let i = 0; i < 10; i++) {
      const x = 88 + i * 15 + (r % 2) * 7.5, y = 58 + r * 14;
      arcs.push(`<path d="M${x} ${y} q7.5 7 15 0" fill="none" stroke="${mark}" stroke-width="1.4" opacity="0.3"/>`);
    }
    scales = `<g clip-path="url(#${uid}-c)">${arcs.join('')}</g>`;
  } else if (scaleMode === 'mirror') {
    scales = `<g clip-path="url(#${uid}-c)">` + [[104, 66], [150, 58], [128, 96], [178, 84], [200, 108], [96, 116], [158, 126]]
      .map(([x, y]) => `<path d="M${x} ${y} q11 10 22 0 q-4 -9 -11 -9 q-7 0 -11 9 Z" fill="none" stroke="${mark}" stroke-width="1.8" opacity="0.45"/>`).join('') + `</g>`;
  }
  return `<svg viewBox="0 0 320 180" role="img" aria-label="Common Carp">
  <defs>${grad(uid, back, mid, belly)}
    <clipPath id="${uid}-c"><path d="${body}"/></clipPath></defs>
  <path d="M232 80 C248 68 262 56 276 46 C272 64 270 79 271 90 C270 101 272 118 276 136 C262 126 248 114 232 102 Z" fill="${fin}"/>
  <path d="M112 52 C114 36 119 22 126 15 C132 20 136 27 138 35 C141 42 147 47 155 50 C172 57 190 62 206 64 C210 66 213 68 215 71 C181 58 146 52 112 52 Z" fill="${fin}" opacity="0.95"/>
  <path d="M186 118 C190 133 202 139 214 135 C210 124 205 116 200 110 Z" fill="${fin}" opacity="0.9"/>
  <path d="M134 128 C136 141 146 146 156 143 C152 134 148 127 145 122 Z" fill="${fin}" opacity="0.9"/>
  <path d="${body}" fill="url(#${uid}-b)"/>
  ${scales}
  <path d="M124 16 L118 52" fill="none" stroke="${mark}" stroke-width="2" opacity="0.55" stroke-linecap="round"/>
  <path d="M96 110 C108 114 116 122 119 132 C108 131 99 125 92 116 Z" fill="${fin}"/>
  <path d="M46 98 C50 103 54 106.5 59 108.5" fill="none" stroke="${mark}" stroke-width="2.4" opacity="0.75" stroke-linecap="round"/>
  <ellipse cx="52" cy="104" rx="4.5" ry="2.6" transform="rotate(-32 52 104)" fill="none" stroke="${mark}" stroke-width="1.6" opacity="0.55"/>
  <path d="M58 109 C60 115 63 119 67 122" fill="none" stroke="${mark}" stroke-width="2" opacity="0.7" stroke-linecap="round"/>
  <path d="M54 108 C55 112 57 115 59 117" fill="none" stroke="${mark}" stroke-width="1.7" opacity="0.6" stroke-linecap="round"/>
  <path d="M90 62 C102 80 104 106 94 124" fill="none" stroke="${mark}" stroke-width="2" opacity="0.45"/>
  ${eye(72, 80, 6.5, iris, pupil)}
</svg>`;
}

/* ---------- Lake Sturgeon ---------- */
export function sturgeon(uid: string, p: Palette, _o: PlanOpts = {}): string {
  const { back, mid, belly, fin, mark, edge = p.mark, iris = '#6a5a38', pupil = '#0c0d0a' } = p;
  const dorsalScutes = [], flankScutes = [];
  const backline = [[72, 74.5], [94, 71.5], [116, 69.5], [138, 68.5], [160, 68.5], [182, 70], [204, 72.5], [224, 76]];
  for (const [x, y] of backline) dorsalScutes.push(`<path d="M${x} ${y} l5 -4.4 l5 4.4 l-5 4.4 Z" fill="${mark}" opacity="0.9"/>`);
  for (let i = 0; i < 8; i++) {
    const x = 88 + i * 19, y = 88 + Math.sin(i) * 1.5;
    flankScutes.push(`<path d="M${x} ${y} l3.6 -3.2 l3.6 3.2 l-3.6 3.2 Z" fill="${mark}" opacity="0.5"/>`);
  }
  return `<svg viewBox="0 0 320 180" role="img" aria-label="Lake Sturgeon">
  <defs>${grad(uid, back, mid, belly)}</defs>
  <path d="M238 84 C256 72 274 55 291 36 C289 55 283 72 272 84 C279 92 283 102 285 113 C273 108 256 98 238 96 Z" fill="${fin}"/>
  <path d="M200 74 C208 57 222 54 233 60 L236 76 C224 71 212 71 200 74 Z" fill="${fin}" opacity="0.95"/>
  <path d="M206 100 C211 114 222 117 231 112 L233 98 C224 103 215 103 206 100 Z" fill="${fin}" opacity="0.95"/>
  <path d="M152 104 C154 116 162 120 170 118 C167 111 164 105 162 101 Z" fill="${fin}" opacity="0.9"/>
  <path d="M18 88 C46 76 82 68 124 66 C168 64 208 68 240 82 L240 96 C208 106 168 110 124 108 C84 106 46 100 18 93 Z" fill="url(#${uid}-b)"/>
  <path d="M230 84 C246 74 262 60 280 42 C272 62 260 78 246 89 C241 92 235 93 230 92 Z" fill="url(#${uid}-b)"/>
  ${dorsalScutes.join('')}${flankScutes.join('')}
  <path d="M72 100 C86 102 96 110 100 121 C88 121 78 115 70 106 Z" fill="${fin}"/>
  <ellipse cx="56" cy="101" rx="6" ry="3" fill="none" stroke="${edge}" stroke-width="2" opacity="0.75"/>
  <g stroke="${mark}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.9">
    <path d="M36 96 C35.5 101 35 105 35 109"/>
    <path d="M41 97 C40.5 102 40 107 40 111"/>
    <path d="M46 98 C45.5 103 45 108 45 112"/>
    <path d="M51 98.5 C50.5 103 50 106 50 109"/>
  </g>
  <path d="M64 76 C72 86 74 95 68 103" fill="none" stroke="${edge}" stroke-width="1.8" opacity="0.5"/>
  ${eye(46, 84, 4, iris, pupil)}
</svg>`;
}

/* ---------- American Eel / Green Moray ---------- */
export function eel(uid: string, p: Palette, o: PlanOpts = {}): string {
  const { back, mid, belly, fin, mark, edge = p.mark, iris = '#7a6a3a', pupil = '#0c0d0a' } = p;
  const moray = !!o.moray;
  const body = `M40 68 C70 52 104 50 138 68 C158 78 172 92 192 102 C214 113 240 112 258 98 C270 88 280 76 287 66 C282 84 272 100 258 110 C238 126 208 126 184 114 C162 103 148 90 128 80 C106 68 78 72 56 84 C51 86 46 88 42 88 C36 84 36 72 40 68 Z`;
  const fringe = `<path d="M64 62 C100 54 130 68 158 88 C182 106 214 122 244 114 C266 108 280 90 287 68" fill="none" stroke="${fin}" stroke-width="34" stroke-linecap="round" opacity="0.85"/>`;
  const lateral = `<path d="M44 78 C90 62 122 68 152 88 C178 106 212 120 244 110 C262 104 274 90 283 74" fill="none" stroke="${mark}" stroke-width="1.6" opacity="0.35"/>`;
  let head = `<path d="M38 80 C44 82 51 82.5 58 81.5" fill="none" stroke="${mark}" stroke-width="1.8" opacity="0.7" stroke-linecap="round"/>`;
  let headExtra = '';
  if (moray) {
    head = '';
    headExtra = `
  <path d="M48 76 C36 70 24 64 13 59 C16 74 25 90 40 99 C45 94 48 86 48 78 Z" fill="${edge}" opacity="0.95"/>
  <path d="M52 74 C40 65 27 58 12 55 C13 59 16 63 21 67 C31 73 42 77 52 80 Z" fill="url(#${uid}-b)"/>
  <path d="M52 92 C41 95 30 100 21 108 C27 110 35 109 43 105 C48 102 51 97 52 92 Z" fill="url(#${uid}-b)"/>
  <path d="M25 64 l1.2 5 l3.2 -3.2 Z" fill="${belly}"/><path d="M33 68 l1.2 4.8 l3.2 -3 Z" fill="${belly}"/>
  <path d="M41 72 l1 4.4 l3 -2.8 Z" fill="${belly}"/>
  <path d="M30 102 l1.4 -5 l3.2 3.4 Z" fill="${belly}"/><path d="M39 98 l1.3 -4.8 l3.1 3.2 Z" fill="${belly}"/>`;
  }
  const mottling = moray
    ? [[90, 66], [124, 72], [150, 88], [178, 102], [210, 116], [240, 108], [262, 92], [110, 62], [196, 112]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${mark}" opacity="0.4"/>`).join('')
    : '';
  return `<svg viewBox="0 0 320 180" role="img" aria-label="${moray ? 'Green Moray' : 'American Eel'}">
  <defs>${grad(uid, back, mid, belly)}</defs>
  ${fringe}
  <path d="${body}" fill="url(#${uid}-b)"/>
  ${mottling}${lateral}
  <path d="M68 82 C76 84 81 89 83 96 C76 95 70 91 65 86 Z" fill="${fin}"/>
  ${headExtra}${head}
  <path d="M62 70 C67 76 68 82 64 88" fill="none" stroke="${mark}" stroke-width="1.6" opacity="0.5"/>
  ${eye(52, moray ? 70 : 72, moray ? 5 : 4.5, iris, pupil)}
</svg>`;
}

/* ---------- Suggested standard palettes ---------- */

// ---------------------------------------------------------------------------
// Body plans authored 2026-08-27 (batch b) — verified by contact-sheet render.

// Contract: <plan>(uid, p, o = {}) => one <svg> string, viewBox 0 0 320 180, fish faces LEFT.
// All colors come from the palette p; only the eyeball near-black/white is hardcoded (in eye()).

function pal(p: Palette) {
  const { back = '#4a5a4a', mid = '#7a8a72', belly = '#e8e6d0', fin = mid, mark = '#26331c',
    accent = fin, iris = '#8a7440', pupil = '#0c0d0a', bar = belly, edge = '#1d1a16' } = p;
  return { back, mid, belly, fin, mark, accent, iris, pupil, bar, edge };
}

/* ---------- 1. heavy — Red Drum / Atlantic Cod / Red Snapper / Goliath Grouper ---------- */
// o.tailSpot: one ocellus, or 'multi' for a row of them (multi-spot red drum).
export function heavy(uid: string, p: Palette, o: PlanOpts = {}): string {
  const c = pal(p);
  const dorsal = o.triDorsal
    ? `<path d="M90 51 C96 22 120 17 134 33 C137 38 139 44 141 48 C124 46 106 47 90 51 Z" fill="${c.fin}" opacity="0.92"/>
       <path d="M150 46 C160 25 180 25 189 40 C191 44 193 49 194 53 C179 48 164 46 150 46 Z" fill="${c.fin}" opacity="0.92"/>
       <path d="M202 53 C212 35 228 36 235 50 C237 54 238 59 239 64 C226 58 214 55 202 53 Z" fill="${c.fin}" opacity="0.92"/>`
    : `<path d="M104 47 L111 22 L118 42 L126 21 L133 41 L141 23 L148 41 L155 25 L161 42 L168 28 L173 45 C150 46 127 46 104 47 Z" fill="${c.fin}" opacity="0.92"/>
       <path d="M180 47 C190 33 208 33 218 44 C224 52 228 60 230 66 C213 58 196 51 180 47 Z" fill="${c.fin}" opacity="0.92"/>`;
  const mottle = o.grouper
    ? [[104, 66, 13, 7], [140, 58, 15, 8], [178, 64, 14, 7], [212, 76, 12, 6], [118, 92, 15, 8], [158, 96, 16, 8], [198, 98, 13, 7], [96, 114, 11, 6], [136, 118, 13, 6], [176, 118, 12, 6], [72, 82, 10, 6], [222, 96, 9, 5]]
        .map(([x, y, rx, ry], i) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${c.mark}" opacity="${0.3 + (i % 3) * 0.07}"/>`).join('')
    : '';
  const codBits = o.chinBarbel
    ? `<path d="M47 105 C46 111 44 116 41 121" fill="none" stroke="${c.edge}" stroke-width="2.2" stroke-linecap="round"/>
       <path d="M62 68 C110 56 180 60 250 90" fill="none" stroke="${c.bar}" stroke-width="3" opacity="0.7" stroke-linecap="round"/>`
    : '';
  const spot = ([x, y, r]: number[]) => `<circle cx="${x}" cy="${y}" r="${r! + 3}" fill="${c.belly}" opacity="0.9"/><circle cx="${x}" cy="${y}" r="${r}" fill="${c.edge}"/>`;
  const tailSpot = o.tailSpot === 'multi'
    ? [[238, 88, 5.5], [222, 78, 4.5], [214, 100, 4], [200, 86, 3.5], [186, 74, 3]].map(spot).join('')
    : o.tailSpot ? spot([238, 88, 5.5]) : '';
  const mouth = o.grouper
    ? `<path d="M31 90 C44 97 58 101 72 102" fill="none" stroke="${c.edge}" stroke-width="3.5" stroke-linecap="round"/>
       <path d="M33 100 C42 104 52 106 62 107" fill="none" stroke="${c.mark}" stroke-width="2" opacity="0.7" stroke-linecap="round"/>`
    : `<path d="M32 92 C41 96 50 98 58 99" fill="none" stroke="${c.edge}" stroke-width="3" stroke-linecap="round"/>
       <path d="M33 86 C30 90 30 96 34 101" fill="none" stroke="${c.mark}" stroke-width="2.5" opacity="0.8" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 320 180" role="img" aria-label="heavy perciform">
  <defs>${grad(uid, c.back, c.mid, c.belly)}</defs>
  <path d="M254 88 C264 80 274 74 286 70 C292 80 294 90 294 97 C294 106 292 116 286 126 C274 120 264 112 254 104 Z" fill="${c.fin}"/>
  ${dorsal}
  <path d="M186 126 C192 142 206 146 218 140 C214 132 209 124 204 118 C198 122 192 124 186 126 Z" fill="${c.fin}" opacity="0.92"/>
  <path d="M112 130 C114 144 124 148 132 145 C130 136 127 129 124 123 Z" fill="${c.fin}" opacity="0.92"/>
  <path d="M36 88 C44 62 70 47 106 43 C148 39 194 50 230 68 C242 74 250 82 254 90 L254 104 C248 112 240 118 226 124 C188 138 134 139 96 127 C64 117 44 106 36 88 Z" fill="url(#${uid}-b)"/>
  ${mottle}${tailSpot}
  <path d="M96 100 C112 102 122 110 126 122 C114 123 103 117 95 109 Z" fill="${c.fin}"/>
  <path d="M86 58 C97 76 99 100 91 120" fill="none" stroke="${c.mark}" stroke-width="2" opacity="0.5"/>
  <path d="M75 64 C83 78 85 98 79 114" fill="none" stroke="${c.mark}" stroke-width="1.5" opacity="0.3"/>
  ${mouth}${codBits}
  ${eye(60, 74, 7, c.iris, c.pupil)}
</svg>`;
}

/* ---------- 2. flatfish — Pacific Halibut / Summer Flounder ---------- */
export function flatfish(uid: string, p: Palette, _o: PlanOpts = {}): string {
  const c = pal(p);
  // fringe rays: short strokes across the fin band around the oval (skip head + tail gaps)
  const rays = [];
  const cx = 150, cy = 90, rx1 = 104, ry1 = 45, rx2 = 116, ry2 = 60;
  for (let a = 30; a <= 138; a += 7) {
    const t = (a * Math.PI) / 180;
    for (const s of [1, -1]) {
      rays.push(`<path d="M${(cx - Math.cos(t) * rx1).toFixed(1)} ${(cy + s * Math.sin(t) * ry1).toFixed(1)} L${(cx - Math.cos(t) * rx2).toFixed(1)} ${(cy + s * Math.sin(t) * ry2).toFixed(1)}" stroke="${c.edge}" stroke-width="1.4" opacity="0.6"/>`);
    }
  }
  const rings = [[112, 72, 8], [156, 62, 6.5], [196, 76, 8], [128, 104, 7], [176, 108, 8], [216, 96, 6], [92, 92, 6]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c.mark}" stroke-width="2.2" opacity="0.55"/>`).join('');
  const pebbles = [[100, 78, 2.2], [140, 84, 1.8], [168, 70, 2.4], [188, 94, 1.8], [148, 118, 2], [210, 82, 1.6], [122, 92, 1.5], [230, 90, 1.8], [160, 96, 1.6], [108, 112, 1.8]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c.mark}" opacity="0.7"/>`).join('');
  const pale = [[132, 70, 2.4], [180, 84, 2.6], [152, 106, 2.2], [206, 106, 2], [98, 100, 2]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c.bar}" opacity="0.8"/>`).join('');
  return `<svg viewBox="0 0 320 180" role="img" aria-label="flatfish">
  <defs>${grad(uid, c.back, c.mid, c.belly)}</defs>
  <path d="M48 90 C60 48 102 27 148 26 C202 24 246 46 264 78 L266 90 L264 102 C246 134 202 156 148 154 C102 153 60 132 48 90 Z" fill="${c.fin}" opacity="0.95"/>
  <path d="M258 82 C272 74 282 70 292 72 C288 81 287 88 288 92 C288 98 290 106 295 114 C284 115 271 108 257 99 Z" fill="${c.fin}"/>
  <path d="M38 90 C50 62 88 45 142 43 C196 41 240 57 258 79 L262 90 L258 101 C240 123 196 139 142 137 C88 135 50 118 38 90 Z" fill="url(#${uid}-b)"/>
  ${rays.join('')}
  ${rings}${pebbles}${pale}
  <path d="M120 86 C132 84 142 88 146 96 C138 101 127 101 119 96 Z" fill="${c.fin}" opacity="0.9"/>
  <path d="M94 64 C102 78 103 98 96 112" fill="none" stroke="${c.mark}" stroke-width="2" opacity="0.5"/>
  <path d="M38 88 C44 92 51 95 58 96" fill="none" stroke="${c.edge}" stroke-width="2.5" stroke-linecap="round"/>
  ${eye(64, 72, 6, c.iris, c.pupil)}
  ${eye(82, 62, 6, c.iris, c.pupil)}
</svg>`;
}

/* ---------- 3. mahi — Mahi-Mahi ---------- */
export function mahi(uid: string, p: Palette, o: PlanOpts = {}): string {
  const c = pal(p);
  // Default is the bull's blunt, near-vertical forehead; o.cow slopes it back.
  const dorsal = o.cow
    ? 'M76 46 C80 28 92 20 110 22 C152 30 204 58 248 86 L248 90 C196 64 140 48 106 46 C94 45 84 45 76 46 Z'
    : 'M52 44 C54 24 68 14 90 16 C142 22 198 52 248 86 L248 90 C196 64 140 46 94 42 C78 41 64 42 52 44 Z';
  const body = o.cow
    ? 'M76 46 C58 52 46 68 42 86 C42 95 44 100 46 104 C58 118 86 127 122 125 C166 121 212 107 250 96 L250 88 C212 72 166 54 122 48 C104 46 90 44 76 46 Z'
    : 'M46 42 C42 62 41 84 46 104 C58 118 86 127 122 125 C166 121 212 107 250 96 L250 88 C212 72 166 54 122 48 C92 44 62 40 46 42 Z';
  const spots = [[92, 66, 2], [116, 60, 1.7], [138, 66, 2.2], [162, 62, 1.6], [184, 70, 2], [206, 74, 1.7], [104, 82, 1.6], [130, 86, 2], [156, 82, 1.7], [180, 88, 2.1], [204, 88, 1.5], [88, 96, 1.8], [120, 100, 1.6], [150, 100, 2], [226, 82, 1.6]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c.mark}" opacity="0.8"/>`).join('');
  return `<svg viewBox="0 0 320 180" role="img" aria-label="mahi-mahi">
  <defs>${grad(uid, c.back, c.mid, c.belly)}</defs>
  <path d="M250 87 C264 76 280 61 294 44 C288 65 285 80 285 91 C285 103 288 118 294 136 C280 118 264 103 250 97 Z" fill="${c.fin}"/>
  <path d="${dorsal}" fill="${c.fin}" opacity="0.94"/>
  <path d="M146 121 C168 135 212 126 248 99 L248 96 C214 112 180 119 146 117 Z" fill="${c.fin}" opacity="0.9"/>
  <path d="${body}" fill="url(#${uid}-b)"/>
  <path d="M52 102 C100 119 172 119 244 96" fill="none" stroke="${c.accent}" stroke-width="8" opacity="0.5" stroke-linecap="round"/>
  ${spots}
  <path d="M84 90 C100 92 112 100 118 112 C106 112 94 106 85 98 Z" fill="${c.fin}"/>
  <path d="M76 58 C86 76 88 96 80 110" fill="none" stroke="${c.mark}" stroke-width="2" opacity="0.5"/>
  <path d="M44 90 C51 95 59 98 68 99" fill="none" stroke="${c.edge}" stroke-width="2.8" stroke-linecap="round"/>
  ${eye(62, 76, 6, c.iris, c.pupil)}
</svg>`;
}

/* ---------- 4. billfish — Blue Marlin / Sailfish / Swordfish ---------- */
export function billfish(uid: string, p: Palette, o: PlanOpts = {}): string {
  const c = pal(p);
  const bill = o.swordLong
    ? `<path d="M70 79 C48 76 26 74 5 73 L6 78 C27 80 49 84 70 88 Z" fill="${c.mid}" stroke="${c.edge}" stroke-width="1.2"/>`
    : `<path d="M70 78 C52 74 34 71 16 68 L17 73 C35 76 52 81 70 87 Z" fill="${c.mid}" stroke="${c.edge}" stroke-width="1.2"/>`;
  const dorsal = o.sail
    ? `<path d="M102 66 C104 38 118 20 142 14 C182 10 222 28 248 62 L250 80 C240 70 230 76 220 68 C208 78 196 70 184 76 C170 68 156 78 142 70 C128 76 114 68 102 66 Z" fill="${c.fin}" opacity="0.85"/>
       ${[[130, 40], [152, 32], [176, 34], [200, 44], [222, 56], [142, 54], [166, 52], [190, 58], [212, 66], [120, 54]]
         .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="${c.mark}" opacity="0.8"/>`).join('')}`
    : `<path d="M116 62 C120 38 130 24 148 18 C151 34 148 48 141 60 C132 60 124 61 116 62 Z" fill="${c.fin}"/>`;
  const pelvic = o.swordLong ? '' :
    `<path d="M112 96 C116 116 122 132 130 143 L134 141 C128 126 124 110 122 97 Z" fill="${c.fin}"/>`;
  const bars = (o.sail || o.swordLong) ? '' :
    [100, 122, 144, 166, 188, 210].map((x, i) =>
      `<path d="M${x} ${66 + i} q5 ${18 - i} 0 ${38 - i * 2}" stroke="${c.bar}" stroke-width="4" fill="none" opacity="0.35" stroke-linecap="round"/>`).join('');
  return `<svg viewBox="0 0 320 180" role="img" aria-label="billfish">
  <defs>${grad(uid, c.back, c.mid, c.belly)}</defs>
  <path d="M252 88 C268 72 282 52 292 30 C295 52 289 74 277 90 L277 94 C289 110 295 132 292 154 C282 132 268 112 252 96 Z" fill="${c.fin}"/>
  ${dorsal}
  <path d="M222 70 C228 59 237 59 242 66 C236 70 229 71 222 70 Z" fill="${c.fin}"/>
  <path d="M196 112 C202 122 210 124 216 120 C212 114 207 109 202 106 Z" fill="${c.fin}" opacity="0.9"/>
  ${pelvic}
  <path d="M64 82 C100 62 160 56 208 64 C228 68 244 78 252 88 L252 96 C244 104 228 112 206 114 C160 120 104 110 72 94 C66 90 62 86 64 82 Z" fill="url(#${uid}-b)"/>
  ${bill}${bars}
  <path d="M240 92 L256 87 L264 92 L256 97 Z" fill="${c.edge}" opacity="0.85"/>
  <path d="M118 92 C136 96 150 106 156 120 C142 120 128 112 118 101 Z" fill="${c.fin}"/>
  <path d="M100 68 C108 80 110 92 104 102" fill="none" stroke="${c.mark}" stroke-width="2" opacity="0.5"/>
  <path d="M68 85 C60 87 52 87 44 86" fill="none" stroke="${c.edge}" stroke-width="2" stroke-linecap="round"/>
  ${eye(88, 80, 6, c.iris, c.pupil)}
</svg>`;
}

/* ---------- 5. wrasse — Stoplight Parrotfish / Humphead Wrasse ---------- */
export function wrasse(uid: string, p: Palette, o: PlanOpts = {}): string {
  const c = pal(p);
  const body = o.hump
    ? `M44 92 C42 72 44 52 56 42 C66 34 80 33 88 41 C93 46 96 51 98 55 C112 48 128 45 144 45 C182 45 214 58 236 76 L240 90 L236 104 C212 126 174 138 130 136 C86 134 54 118 44 92 Z`
    : `M44 90 C54 62 88 46 132 44 C176 42 214 54 236 76 L240 90 L236 104 C212 126 174 138 130 136 C86 134 54 118 44 90 Z`;
  const dorsal = o.hump
    ? `<path d="M118 47 C116 36 126 31 140 30 C176 29 210 46 232 70 C235 76 237 82 238 86 C214 60 182 48 150 47 C139 46 128 46 118 47 Z" fill="${c.fin}" opacity="0.92"/>`
    : `<path d="M94 46 C92 33 104 27 120 26 C164 23 208 42 234 70 C237 76 239 82 239 86 C214 58 176 45 134 44 C120 43 106 44 94 46 Z" fill="${c.fin}" opacity="0.92"/>`;
  // scale arcs
  const arcs = [];
  for (let r = 0; r < 5; r++) {
    const y = 58 + r * 15;
    const x0 = r === 0 || r === 4 ? 96 : 78;
    const x1 = r === 0 || r === 4 ? 208 : 222;
    for (let x = x0 + (r % 2) * 8; x < x1; x += 16) {
      arcs.push(`<path d="M${x} ${y} q8 6 16 0" stroke="${c.mark}" stroke-width="1.5" fill="none" opacity="0.35"/>`);
    }
  }
  const squiggles = o.hump
    ? `<g stroke="${c.mark}" stroke-width="1.2" fill="none" opacity="0.75">
       <path d="M58 66 q6 4 12 0 q6 -4 12 0"/><path d="M56 78 q6 4 13 0 q6 -4 13 1"/>
       <path d="M58 90 q7 4 14 0 q6 -3 12 1"/><path d="M62 101 q6 4 12 0 q5 -3 10 1"/>
       <path d="M74 58 q5 4 11 1"/></g>`
    : '';
  return `<svg viewBox="0 0 320 180" role="img" aria-label="wrasse">
  <defs>${grad(uid, c.back, c.mid, c.belly)}</defs>
  <path d="M240 84 C254 75 270 64 288 51 C280 66 273 79 273 92 C273 105 280 118 288 133 C270 119 254 108 240 100 Z" fill="${c.fin}"/>
  ${dorsal}
  <path d="M122 134 C132 147 162 151 196 139 C216 131 230 119 236 108 C214 124 180 135 148 134 Z" fill="${c.fin}" opacity="0.92"/>
  <path d="M100 122 C102 136 110 141 118 139 C116 130 113 124 110 118 Z" fill="${c.fin}" opacity="0.92"/>
  <path d="${body}" fill="url(#${uid}-b)"/>
  ${arcs.join('')}${squiggles}
  <path d="M42 82 C36 87 36 96 42 101 C48 104 54 104 59 102 C55 95 55 88 59 81 C53 79 47 79 42 82 Z" fill="${c.bar}" stroke="${c.edge}" stroke-width="1.5"/>
  <path d="M40 92 C46 93 52 93 59 92" fill="none" stroke="${c.edge}" stroke-width="2" stroke-linecap="round"/>
  <path d="M104 96 C118 98 128 106 132 118 C120 118 110 112 103 104 Z" fill="${c.fin}"/>
  <path d="M96 58 C106 76 108 98 100 114" fill="none" stroke="${c.mark}" stroke-width="2" opacity="0.45"/>
  ${eye(o.hump ? 80 : 74, o.hump ? 74 : 74, 7, c.iris, c.pupil)}
</svg>`;
}

// ---------------------------------------------------------------------------
// Body plans authored 2026-08-27 (batch c) — verified by contact-sheet render.

/* Reef Dex body-plan builders — batch C: lionfish, puffer, shark, ray, seahorse.
 * Contract: fn(uid, p, o = {}) => one <svg> string, viewBox 0 0 320 180, fish faces LEFT.
 * All colors from palette p; only the eyeball near-black/white is hardcoded. */

const pt = (cx: number, cy: number, r: number, aDeg: number): [number, number] => {
  const a = aDeg * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
const rd = (n: number): number => Math.round(n * 10) / 10;
// Fan fin: membrane sector + banded arcs + thin rays, from pivot between angles.
function fanFin(cx: number, cy: number, r: number, a0: number, a1: number, finC: string, barC: string, markC: string, op = 0.55, nRays = 7): string {
  const arc = (rad: number) => {
    const seg = [];
    for (let i = 0; i <= 12; i++) {
      const [x, y] = pt(cx, cy, rad, a0 + (a1 - a0) * i / 12);
      seg.push(`${i ? 'L' : 'M'}${rd(x)} ${rd(y)}`);
    }
    return seg.join(' ');
  };
  let s = `<path d="M${cx} ${cy} ${arc(r).replace(/^M/, 'L')} Z" fill="${finC}" opacity="${op}"/>`;
  s += `<path d="${arc(r * 0.52)}" fill="none" stroke="${barC}" stroke-width="5" opacity="0.65"/>`;
  s += `<path d="${arc(r * 0.8)}" fill="none" stroke="${barC}" stroke-width="4" opacity="0.55"/>`;
  for (let i = 0; i <= nRays; i++) {
    const a = a0 + (a1 - a0) * i / nRays;
    const [x1, y1] = pt(cx, cy, r * 0.08, a), [x2, y2] = pt(cx, cy, r * 1.02, a);
    s += `<path d="M${rd(x1)} ${rd(y1)} L${rd(x2)} ${rd(y2)}" stroke="${markC}" stroke-width="1.6" opacity="0.8" stroke-linecap="round"/>`;
  }
  return s;
}

/* ---------- Red Lionfish ---------- */
export function lionfish(uid: string, p: Palette, _o: PlanOpts = {}): string {
  const { back, mid, belly, fin, mark, accent = p.fin, bar = belly, edge = mark,
          iris = '#c2452e', pupil = '#0c0d0a' } = p;
  const body = 'M56 100 C66 76 96 62 132 62 C168 62 196 74 208 90 L208 110 C196 122 168 132 132 130 C98 128 70 116 56 106 Z';
  // Dorsal spines: separate venomous rays fanning up, membrane webs at bases.
  let spines = '';
  for (let i = 0; i < 11; i++) {
    const bx = 92 + i * 10.6;
    const by = 66 + Math.pow((bx - 140) / 62, 2) * 14;
    const a = -142 + i * 10.4;
    const len = 40 + 18 * Math.sin(Math.PI * i / 10);
    const [tx, ty] = pt(bx, by, len, a);
    const [mx, my] = pt(bx, by, len * 0.42, a);
    spines += `<path d="M${bx - 4} ${by + 2} L${rd(mx)} ${rd(my)} L${bx + 5} ${by + 2} Z" fill="${fin}" opacity="0.32"/>
      <path d="M${bx} ${by + 2} L${rd(tx)} ${rd(ty)}" stroke="${fin}" stroke-width="2" stroke-linecap="round"/>
      <path d="M${rd((bx + tx) / 2)} ${rd((by + ty) / 2)} L${rd(tx)} ${rd(ty)}" stroke="${bar}" stroke-width="2" opacity="0.55" stroke-linecap="round"/>`;
  }
  // Anal spines below rear body.
  let anal = '';
  for (let i = 0; i < 4; i++) {
    const bx = 162 + i * 10, a = 118 - i * 14;
    const [tx, ty] = pt(bx, 126, 30, a);
    anal += `<path d="M${bx} 126 L${rd(tx)} ${rd(ty)}" stroke="${fin}" stroke-width="2" stroke-linecap="round"/>`;
  }
  // Body candy stripes, clipped to the body.
  let stripes = '';
  for (let i = 0; i < 7; i++) {
    const x = 74 + i * 20;
    stripes += `<path d="M${x} 58 C${x + 8} 86 ${x + 6} 112 ${x - 2} 136" stroke="${mark}" stroke-width="${8 - (i % 2) * 2}" fill="none" opacity="0.85"/>`;
    stripes += `<path d="M${x + 10} 58 C${x + 18} 86 ${x + 16} 112 ${x + 8} 136" stroke="${bar}" stroke-width="3" fill="none" opacity="0.7"/>`;
  }
  // Tail: rounded, rayed, spotted.
  const tailDots = [[228,84],[238,92],[230,100],[240,108],[228,116],[246,100],[236,120],[244,84]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="${mark}" opacity="0.8"/>`).join('');
  return `<svg viewBox="0 0 320 180" role="img" aria-label="Red Lionfish">
  <defs>${grad(uid, back, mid, belly)}<clipPath id="${uid}-c"><path d="${body}"/></clipPath></defs>
  ${fanFin(122, 96, 62, -78, -8, fin, bar, mark, 0.4, 6)}
  ${spines}
  <path d="M204 84 C220 74 240 70 252 74 C256 86 256 96 254 102 C256 108 256 118 252 128 C238 132 220 126 204 116 Z" fill="${fin}" opacity="0.75"/>
  <g stroke="${mark}" stroke-width="1.4" opacity="0.6">${[78,90,100,110,122].map(y =>
    `<path d="M206 ${y > 100 ? y + 2 : y - 2} L250 ${y}" fill="none"/>`).join('')}</g>
  ${tailDots}
  ${fanFin(140, 122, 40, 42, 128, fin, bar, mark, 0.5, 5)}
  ${anal}
  <path d="${body}" fill="url(#${uid}-b)"/>
  <g clip-path="url(#${uid}-c)">${stripes}
    <path d="M60 92 C70 82 82 76 96 72" stroke="${mark}" stroke-width="5" fill="none" opacity="0.7"/></g>
  ${fanFin(118, 102, 58, 24, 116, fin, bar, mark, 0.62, 7)}
  <path d="M92 66 C94 58 98 52 104 48 M86 68 C86 60 88 54 92 49" stroke="${accent}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M100 70 C108 84 110 100 104 114" fill="none" stroke="${mark}" stroke-width="2" opacity="0.55"/>
  <path d="M56 102 C64 106 72 108 80 109" fill="none" stroke="${edge}" stroke-width="2.4" opacity="0.75" stroke-linecap="round"/>
  ${eye(80, 84, 6.5, iris, pupil)}
</svg>`;
}

/* ---------- Porcupine Pufferfish ---------- */
export function puffer(uid: string, p: Palette, o: PlanOpts = {}): string {
  const { back, mid, belly, fin, mark, bar = belly, edge = mark,
          iris = '#c9a23c', pupil = '#0c0d0a' } = p;
  const inf = !!o.inflated;
  const cx = 152, cy = 94, rx = inf ? 58 : 58, ry = inf ? 56 : 44;
  // Spikes: flat-lying triangles when relaxed, erect radial spikes when inflated.
  let spikes = '';
  if (inf) {
    for (let i = 0; i < 22; i++) {
      const a = -180 + i * (360 / 22) + 8;
      const sx = cx + (rx - 2) * Math.cos(a * Math.PI / 180), sy = cy + (ry - 2) * Math.sin(a * Math.PI / 180);
      const ox = sx - cx, oy = sy - cy, ol = Math.hypot(ox, oy);
      const ux = ox / ol, uy = oy / ol, tx = -uy, ty = ux;
      spikes += `<path d="M${rd(sx + tx * 4)} ${rd(sy + ty * 4)} L${rd(sx + ux * 15)} ${rd(sy + uy * 15)} L${rd(sx - tx * 4)} ${rd(sy - ty * 4)} Z" fill="${mark}" opacity="0.9"/>`;
    }
    // interior erect spikes reading as texture
    for (const [a, f] of [[-150,0.6],[-110,0.55],[-70,0.6],[-30,0.55],[30,0.6],[70,0.55],[110,0.6],[150,0.55],[-170,0.35],[0,0.3]] as [number, number][]) {
      const sx = cx + rx * f * Math.cos(a * Math.PI / 180), sy = cy + ry * f * Math.sin(a * Math.PI / 180);
      spikes += `<path d="M${rd(sx - 4)} ${rd(sy + 3)} L${rd(sx)} ${rd(sy - 8)} L${rd(sx + 4)} ${rd(sy + 3)} Z" fill="${mark}" opacity="0.5"/>`;
    }
  } else {
    for (const [a, f] of [[-160,1],[-135,1],[-105,1],[-75,1],[-45,1],[-15,1],[15,1],[45,1],[75,1],[105,1],[135,1],[165,1],
                          [-120,0.55],[-60,0.55],[-20,0.5],[60,0.55],[120,0.55],[170,0.5],[20,0.5],[-90,0.5]] as [number, number][]) {
      const sx = cx + (rx - 4) * f * Math.cos(a * Math.PI / 180), sy = cy + (ry - 4) * f * Math.sin(a * Math.PI / 180);
      spikes += `<path d="M${rd(sx - 5)} ${rd(sy - 2)} L${rd(sx + 8)} ${rd(sy - 4)} L${rd(sx - 2)} ${rd(sy + 3)} Z" fill="${mark}" opacity="0.65"/>`;
    }
  }
  const spots = [[128,66],[176,64],[196,92],[150,120],[120,108],[186,116],[160,74],[136,92]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${mark}" opacity="0.45"/>`).join('');
  const fs = inf ? 0.6 : 1; // fin scale — comically tiny when inflated
  return `<svg viewBox="0 0 320 180" role="img" aria-label="Porcupine Pufferfish">
  <defs>${grad(uid, back, mid, belly)}</defs>
  <path d="M${cx + rx - 6} 94 c${14 * fs} ${-10 * fs} ${22 * fs} ${-12 * fs} ${28 * fs} ${-12 * fs} c${-3 * fs} ${8 * fs} ${-3 * fs} ${16 * fs} 0 ${24 * fs} c${-6 * fs} 0 ${-14 * fs} ${-2 * fs} ${-28 * fs} ${-12 * fs} Z" fill="${fin}"/>
  <path d="M${cx + 22} ${cy - ry + 8} c${4 * fs} ${-12 * fs} ${14 * fs} ${-16 * fs} ${22 * fs} ${-12 * fs} c${-2 * fs} ${8 * fs} ${-8 * fs} ${14 * fs} ${-14 * fs} ${16 * fs} Z" fill="${fin}" opacity="0.9"/>
  <path d="M${cx + 24} ${cy + ry - 8} c${4 * fs} ${12 * fs} ${14 * fs} ${16 * fs} ${22 * fs} ${12 * fs} c${-2 * fs} ${-8 * fs} ${-8 * fs} ${-14 * fs} ${-14 * fs} ${-16 * fs} Z" fill="${fin}" opacity="0.9"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${uid}-b)"/>
  ${spots}${spikes}
  <path d="M${cx - 10} ${cy + 6} c${10 * fs} ${4 * fs} ${16 * fs} ${12 * fs} ${17 * fs} ${20 * fs} c${-10 * fs} ${-1 * fs} ${-17 * fs} ${-8 * fs} ${-20 * fs} ${-16 * fs} Z" fill="${fin}"/>
  <path d="M${cx - 34} ${cy - 16} c6 10 7 22 2 32" fill="none" stroke="${mark}" stroke-width="2" opacity="0.5"/>
  <path d="M${cx - rx + 4} ${cy + 10} q10 12 24 12" fill="none" stroke="${edge}" stroke-width="3" stroke-linecap="round" opacity="0.85"/>
  <path d="M${cx - rx + 7} ${cy + 13} q8 8 17 9" fill="none" stroke="${bar}" stroke-width="1.8" stroke-linecap="round" opacity="0.6"/>
  ${eye(cx - 40, cy - 18, 11, iris, pupil)}
  <circle cx="${cx - 52}" cy="${cy - 6}" r="1.6" fill="${mark}" opacity="0.7"/>
</svg>`;
}

/* ---------- Blacktip Reef Shark / Scalloped Hammerhead ---------- */
// o.parts swaps whole layers (legendary sharks redraw head, body and fins); o.label names the svg.
export type SharkPart = 'defs' | 'tail' | 'dorsal' | 'body' | 'marks' | 'gills' | 'fins' | 'head';
export type SharkParts = Partial<Record<SharkPart, (uid: string, p: Palette) => string>>;

export function shark(uid: string, p: Palette, o: PlanOpts = {}): string {
  const { back, mid, belly, fin, mark, edge = mark,
          iris = '#3d3a2a', pupil = '#0c0d0a' } = p;
  const parts = (o.parts ?? {}) as SharkParts;
  const part = (k: SharkPart, d: string) => parts[k]?.(uid, p) ?? d;
  const hammer = !!o.hammer, tips = !!o.blacktip;
  const gills = [0, 1, 2, 3, 4].map(i =>
    `<path d="M${118 + i * 7} 76 C${121 + i * 7} 84 ${121 + i * 7} 92 ${118 + i * 7} 99" fill="none" stroke="${mark}" stroke-width="2" opacity="0.8"/>`).join('');
  const head = hammer
    ? `<path d="M20 76 C32 71 46 69 62 71 L86 75 C84 83 84 90 86 96 L62 101 C46 103 31 101 23 95 C17 89 16 81 20 76 Z" fill="url(#${uid}-b)"/>
       <path d="M23 92 C34 97 48 99 62 98" fill="none" stroke="${mark}" stroke-width="2" opacity="0.55"/>
       <path d="M54 96 C62 99 70 100 78 99" fill="none" stroke="${edge}" stroke-width="2.2" stroke-linecap="round"/>
       ${eye(27, 85, 5, iris, pupil)}`
    : `<path d="M38 94 C46 100 56 103 66 103" fill="none" stroke="${edge}" stroke-width="2.6" stroke-linecap="round"/>
       <circle cx="38" cy="88" r="1.7" fill="${mark}" opacity="0.8"/>
       ${eye(52, 80, 5, iris, pupil)}`;
  const capsC = tips ? `
  <path d="M150 40 C154 31 159 25 163 22 C167 29 171 38 174 46 C166 41 158 39 150 40 Z" fill="${edge}"/>
  <path d="M138 140 C142 147 146 152 149 155 C140 152 132 146 126 139 C130 141 134 141 138 140 Z" fill="${edge}"/>
  <path d="M282 56 C288 47 293 40 297 36 C297 44 295 53 292 61 C289 58 285 56 282 56 Z" fill="${edge}"/>
  <path d="M272 118 C277 122 282 125 287 127 C281 128 274 126 268 122 Z" fill="${edge}"/>` : '';
  const label = (o.label as string | undefined) ?? (hammer ? 'Scalloped Hammerhead' : 'Blacktip Reef Shark');
  return `<svg viewBox="0 0 320 180" role="img" aria-label="${label}">
  <defs>${grad(uid, back, mid, belly)}${part('defs', '')}</defs>
  ${part('tail', `<path d="M248 86 C260 74 276 56 297 36 C296 54 291 72 281 88 L284 92 C278 104 270 112 260 114 C255 108 252 102 250 98 Z" fill="${fin}"/>
  <path d="M252 96 C258 106 266 114 287 127 C274 128 262 122 252 112 Z" fill="${fin}"/>`)}
  ${part('dorsal', `<path d="M146 62 C151 44 157 31 163 22 C171 34 178 50 182 63 C170 58 158 58 146 62 Z" fill="${fin}"/>
  <path d="M222 70 C226 62 231 57 235 54 C238 61 240 68 241 74 C235 70 228 69 222 70 Z" fill="${fin}"/>`)}
  ${part('body', `<path d="M${hammer ? 60 : 26} 88 C${hammer ? 74 : 48} 70 92 61 140 58 C186 56 224 66 250 84 L252 98 C222 108 176 114 128 110 C84 106 ${hammer ? 60 : 46} 100 ${hammer ? 58 : 26} 92 Z" fill="url(#${uid}-b)"/>
  <path d="M${hammer ? 62 : 34} 92 C80 87 130 88 185 92 C215 94 236 92 250 88 L252 96 C214 107 158 111 112 107 C78 104 ${hammer ? 64 : 48} 99 ${hammer ? 60 : 32} 94 Z" fill="${belly}" opacity="0.95"/>`)}${part('marks', '')}
  ${part('gills', gills)}
  ${part('fins', `<path d="M108 102 C118 118 128 138 133 154 C120 150 108 137 100 118 C102 112 105 106 108 102 Z" fill="${fin}"/>
  <path d="M186 106 C191 114 197 121 203 125 C196 126 189 122 183 115 Z" fill="${fin}"/>
  <path d="M228 100 C231 105 235 109 239 111 C234 112 229 110 225 106 Z" fill="${fin}" opacity="0.9"/>`)}
  ${capsC}${part('head', head)}
</svg>`;
}

/* ---------- Giant Manta Ray ---------- */
export function ray(uid: string, p: Palette, _o: PlanOpts = {}): string {
  const { back, mid, belly, fin, mark, bar = belly, edge = mark,
          iris = '#3d3a2a', pupil = '#0c0d0a' } = p;
  return `<svg viewBox="0 0 320 180" role="img" aria-label="Giant Manta Ray">
  <defs>${grad(uid, back, mid, belly)}</defs>
  <path d="M226 88 C252 84 278 82 304 84" fill="none" stroke="${mark}" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M262 84 C278 82 292 82 306 84" fill="none" stroke="${mark}" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M222 82 C226 76 231 72 236 70 C236 76 234 82 231 86 Z" fill="${fin}"/>
  <path d="M112 72 C134 46 164 28 198 20 C192 46 178 66 156 78 C141 79 126 77 112 72 Z" fill="${mid}" stroke="${edge}" stroke-width="1.5"/>
  <path d="M118 68 C140 46 164 32 190 25" fill="none" stroke="${bar}" stroke-width="1.8" opacity="0.45"/>
  <path d="M44 86 C68 62 122 54 172 60 C204 64 224 76 232 90 C224 102 198 110 166 112 C118 116 70 106 44 96 Z" fill="url(#${uid}-b)"/>
  <path d="M82 72 C92 67 102 64 112 63 C106 70 100 76 94 80 Z" fill="${bar}" opacity="0.4"/>
  <path d="M124 66 C134 61 144 59 154 59 C147 66 140 71 133 74 Z" fill="${bar}" opacity="0.35"/>
  <path d="M66 100 C80 118 98 138 122 156 C152 138 182 118 210 100 C162 110 106 108 66 100 Z" fill="${mid}"/>
  <path d="M78 103 C122 109 166 109 204 102" fill="none" stroke="${mark}" stroke-width="1.8" opacity="0.4"/>
  <path d="M122 156 C107 144 94 131 84 118 C86 136 100 150 122 156 Z" fill="${belly}"/>
  <path d="M46 76 C34 71 23 72 16 79 C23 85 34 87 44 85 Z" fill="${mid}" opacity="0.9"/>
  <path d="M44 84 C36 84 28 86 21 90 C28 94 38 96 46 94 Z" fill="${edge}"/>
  <path d="M48 92 C37 92 27 96 21 104 C29 108 41 105 50 99 Z" fill="${fin}"/>
  <g stroke="${mark}" stroke-width="1.8" opacity="0.55">
    <path d="M72 104 C74 108 76 111 79 113" fill="none"/>
    <path d="M82 106 C84 110 86 113 89 115" fill="none"/>
    <path d="M92 108 C94 112 96 114 99 116" fill="none"/>
    <path d="M102 109 C104 113 106 115 109 117" fill="none"/>
  </g>
  ${eye(58, 80, 4.5, iris, pupil)}
</svg>`;
}

/* ---------- Lined Seahorse ---------- */
export function seahorse(uid: string, p: Palette, _o: PlanOpts = {}): string {
  const { back, mid, belly, fin, mark, accent = p.fin, bar = belly, edge = mark,
          iris = '#7c5a22', pupil = '#0c0d0a' } = p;
  const body = `M100 48 L128 44 C132 34 141 27 150 29 L148 39 C158 44 165 55 167 68 C177 82 183 98 181 113 C179 130 171 143 162 150 C160 158 153 164 145 161 C137 158 136 148 143 143 C149 139 153 133 152 126 C142 120 134 110 132 98 C130 86 132 74 138 65 C133 63 128 60 124 57 L100 57 C95 55 95 50 100 48 Z`;
  // Bony segment ridges — horizontal rings down trunk and tail.
  const rings = [
    'M150 62 C158 64 164 68 167 73', 'M146 74 C156 77 165 82 170 88',
    'M144 86 C155 90 167 96 175 102', 'M145 98 C156 102 168 107 178 111',
    'M149 110 C158 113 168 116 177 118', 'M152 121 C160 124 168 126 174 127',
    'M150 132 C157 134 163 135 168 135', 'M146 141 C152 143 157 143 161 142',
  ].map(d => `<path d="${d}" fill="none" stroke="${mark}" stroke-width="1.8" opacity="0.65"/>`).join('');
  const neckLines = [
    'M136 52 C142 54 147 58 150 63', 'M132 58 C139 61 145 66 149 72',
    'M134 66 C140 70 145 75 148 80',
  ].map(d => `<path d="${d}" fill="none" stroke="${bar}" stroke-width="1.4" opacity="0.8"/>`).join('');
  return `<svg viewBox="0 0 320 180" role="img" aria-label="Lined Seahorse">
  <defs>${grad(uid, back, mid, belly)}<clipPath id="${uid}-s"><path d="${body}"/></clipPath></defs>
  <path d="M176 86 C190 80 200 88 198 102 C196 112 188 118 179 116 C177 108 176 96 176 86 Z" fill="${fin}" opacity="0.85"/>
  <g stroke="${mark}" stroke-width="1.2" opacity="0.7">
    <path d="M178 90 L194 88" fill="none"/><path d="M179 98 L196 98" fill="none"/>
    <path d="M179 106 L192 108" fill="none"/></g>
  <path d="${body}" fill="url(#${uid}-b)"/>
  <g clip-path="url(#${uid}-s)">${rings}${neckLines}
    <path d="M126 44 C130 52 130 56 126 58" stroke="${mark}" stroke-width="1.6" fill="none" opacity="0.5"/></g>
  <path d="M141 30 l3 -7 l3 6 l4 -7 l3 7" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M156 66 C162 62 168 63 170 68 C166 71 161 71 156 69 Z" fill="${fin}" opacity="0.8"/>
  <path d="M152 58 C155 62 156 66 155 70" fill="none" stroke="${mark}" stroke-width="1.6" opacity="0.6"/>
  <path d="M100 55 L114 55" stroke="${edge}" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M148 147 C143 149 140 153 142 157 C146 158 150 155 151 151" fill="none" stroke="${mark}" stroke-width="1.6" opacity="0.7"/>
  ${eye(136, 48, 5, iris, pupil)}
</svg>`;
}
