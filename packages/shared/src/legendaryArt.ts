// Legendary art, drawn in code in the Reef Dex style: flat fills, a vertical
// body gradient, simple highlights. Same contract as fishArt.ts — viewBox
// 0 0 320 180, facing LEFT, every id prefixed with the uid. The five sharks
// reuse fishArt's `shark` with redrawn parts; the others get their own plans.

import type { Palette } from './fishCatalog.ts';
import { eye, grad, shark, type PlanBuilder, type PlanOpts, type SharkParts } from './fishArt.ts';
import { LEGENDARY_DEFS, type LegendaryPlan } from './legendaries.ts';

type Pt = [number, number];

const rd = (n: number): number => Math.round(n * 10) / 10;
const open = (label: unknown) => `<svg viewBox="0 0 320 180" role="img" aria-label="${label}">`;
const rad = (deg: number) => (deg * Math.PI) / 180;

// Centerline that turns by `turn` degrees (eased toward the tip) with an optional side-to-side wave.
function curve(x: number, y: number, a0: number, len: number, turn: number, wave = 0, n = 28): Pt[] {
  const pts: Pt[] = [[x, y]];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const a = rad(a0 + turn * t * t + wave * Math.sin(t * Math.PI * 2));
    x += (Math.cos(a) * len) / n;
    y += (Math.sin(a) * len) / n;
    pts.push([x, y]);
  }
  return pts;
}

function normals(pts: Pt[]): Pt[] {
  return pts.map((_, i) => {
    const [ax, ay] = pts[Math.max(0, i - 1)]!, [bx, by] = pts[Math.min(pts.length - 1, i + 1)]!;
    const l = Math.hypot(bx - ax, by - ay) || 1;
    return [-(by - ay) / l, (bx - ax) / l];
  });
}

// Smooth closed outline through points (quadratic curves via midpoints).
function smooth(pts: Pt[]): string {
  const m = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = pts.length;
  const start = m(pts[n - 1]!, pts[0]!);
  let d = `M${rd(start[0])} ${rd(start[1])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, q = m(p, pts[(i + 1) % n]!);
    d += ` Q${rd(p[0])} ${rd(p[1])} ${rd(q[0])} ${rd(q[1])}`;
  }
  return `${d} Z`;
}

const widthAt = (t: number, w0: number, w1: number, pow: number) => w1 + (w0 - w1) * (1 - t) ** pow;

// Tapered limb or ribbon body along a centerline.
function ribbon(pts: Pt[], w0: number, w1: number, pow = 1): string {
  const ns = normals(pts), last = pts.length - 1;
  const left: Pt[] = [], right: Pt[] = [];
  pts.forEach(([x, y], i) => {
    const w = widthAt(i / last, w0, w1, pow) / 2, [nx, ny] = ns[i]!;
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
  });
  return smooth([...left, ...right.reverse()]);
}

// Points along one edge of a ribbon (side = 1 or -1), inset by `inset` of the half-width.
function edge(pts: Pt[], w0: number, w1: number, pow: number, side: number, inset: number): Pt[] {
  const ns = normals(pts), last = pts.length - 1;
  return pts.map(([x, y], i) => {
    const w = (widthAt(i / last, w0, w1, pow) / 2) * inset * side, [nx, ny] = ns[i]!;
    return [x + nx * w, y + ny * w];
  });
}

function suckers(pts: Pt[], w0: number, w1: number, side: number, fill: string, upTo = 0.8): string {
  const last = pts.length - 1, ring = edge(pts, w0, w1, 1, side, 0.5);
  let s = '';
  for (let i = 2; i <= last * upTo; i += 2) {
    const [x, y] = ring[i]!, r = widthAt(i / last, w0, w1, 1) * 0.2;
    s += `<circle cx="${rd(x)}" cy="${rd(y)}" r="${rd(Math.max(r, 0.6))}" fill="${fill}" opacity="0.9"/>`;
  }
  return s;
}

const dots = (pts: number[][], fill: string, op = 0.85) =>
  pts.map(([x, y, rx, ry = rx]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" opacity="${op}"/>`).join('');

const gillSlits = (x0: number, step: number, y0: number, y1: number, stroke: string, w = 2) =>
  [0, 1, 2, 3, 4].map((i) => {
    const x = x0 + i * step;
    return `<path d="M${x} ${y0} C${x + 3} ${y0 + (y1 - y0) * 0.35} ${x + 3} ${y0 + (y1 - y0) * 0.7} ${x} ${y1}" fill="none" stroke="${stroke}" stroke-width="${w}" opacity="0.8"/>`;
  }).join('');

const clip = (uid: string, d: string) => `<clipPath id="${uid}-c"><path d="${d}"/></clipPath>`;

// ---------------------------------------------------------------------------
// Sharks — parts for fishArt's `shark`.

const TIGER_BODY = 'M24 90 C24 78 34 70 54 66 C86 60 116 57 150 57 C192 57 226 68 250 84 L252 98 C222 108 178 115 130 113 C88 111 50 107 34 101 C27 98 24 95 24 90 Z';
const tigerParts: SharkParts = {
  defs: (uid) => clip(uid, TIGER_BODY),
  tail: (_, p) => `<path d="M248 86 C262 72 282 50 306 26 C304 48 296 70 283 88 L285 92 C279 104 271 112 261 114 C256 108 252 102 250 98 Z" fill="${p.fin}"/>
  <path d="M252 96 C258 106 266 114 284 124 C272 126 261 120 252 112 Z" fill="${p.fin}"/>
  ${[0, 1, 2].map((i) => `<path d="M${262 + i * 9} ${74 - i * 9} q4 8 1 15" stroke="${p.mark}" stroke-width="3.5" fill="none" opacity="0.5" stroke-linecap="round"/>`).join('')}`,
  dorsal: (_, p) => `<path d="M138 60 C144 42 152 30 160 22 C168 34 175 48 180 61 C166 57 152 57 138 60 Z" fill="${p.fin}"/>
  <path d="M150 40 q4 6 2 14 M164 30 q3 10 1 22" stroke="${p.mark}" stroke-width="3" fill="none" opacity="0.4" stroke-linecap="round"/>
  <path d="M224 72 C227 65 231 60 234 58 C236 64 238 70 239 75 C234 73 229 72 224 72 Z" fill="${p.fin}"/>`,
  body: (uid, p) => `<path d="${TIGER_BODY}" fill="url(#${uid}-b)"/>
  <path d="M30 97 C60 93 120 92 185 93 C215 94 236 92 250 88 L252 96 C214 107 160 113 116 111 C80 109 48 105 34 101 Z" fill="${p.belly}" opacity="0.95"/>`,
  marks: (uid, p) => {
    let bars = '';
    for (let i = 0; i < 8; i++) {
      const x = 142 + i * 13, top = 56 + Math.max(0, i - 3) * 2.5;
      bars += `<path d="M${x} ${top} q${5 - (i % 2) * 2} 13 ${-1 + (i % 3)} ${27 - (i % 2) * 5}" stroke="${p.mark}" stroke-width="${5 - (i % 2)}" fill="none" opacity="0.6" stroke-linecap="round"/>`;
    }
    const spots = dots([[72, 70, 2.2], [84, 66, 1.8], [96, 72, 2.4], [90, 80, 1.6], [104, 64, 2], [62, 76, 1.5], [108, 78, 1.7]], p.mark, 0.55);
    return `<g clip-path="url(#${uid}-c)">${bars}${spots}
  <path d="M60 68 C110 58 180 58 236 76" fill="none" stroke="${p.belly}" stroke-width="2.5" opacity="0.18" stroke-linecap="round"/></g>`;
  },
  gills: (_, p) => gillSlits(104, 7, 76, 99, p.mark),
  fins: (_, p) => `<path d="M100 102 C112 118 124 136 132 152 C118 150 104 136 94 116 C95 110 97 106 100 102 Z" fill="${p.fin}"/>
  <path d="M106 110 q8 14 18 30" stroke="${p.mark}" stroke-width="1.4" fill="none" opacity="0.4"/>
  <path d="M186 106 C191 114 197 121 203 125 C196 126 189 122 183 115 Z" fill="${p.fin}"/>
  <path d="M228 100 C231 105 235 109 239 111 C234 112 229 110 225 106 Z" fill="${p.fin}" opacity="0.9"/>`,
  head: (_, p) => `<path d="M30 99 C40 104 54 106 68 105" fill="none" stroke="${p.edge ?? p.mark}" stroke-width="2.8" stroke-linecap="round"/>
  <path d="M66 103 C70 101 72 98 72 95" fill="none" stroke="${p.mark}" stroke-width="1.6" opacity="0.7" stroke-linecap="round"/>
  <path d="M27 86 C30 85 33 85 35 86.5" fill="none" stroke="${p.mark}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
  ${eye(50, 79, 5.5, p.iris, p.pupil)}`,
};

const WHITE_BODY = 'M14 86 C30 74 52 64 84 58 C116 52 150 50 180 54 C214 60 238 72 254 86 L256 96 C236 108 206 116 170 118 C130 120 90 114 60 106 C40 100 24 93 14 86 Z';
const whiteParts: SharkParts = {
  defs: (uid) => clip(uid, WHITE_BODY),
  tail: (_, p) => `<path d="M250 88 C264 74 280 54 300 30 C303 52 298 72 286 90 L286 94 C298 110 303 128 300 148 C282 128 266 112 250 100 Z" fill="${p.fin}"/>
  <path d="M286 92 C292 72 298 52 300 32" fill="none" stroke="${p.mark}" stroke-width="1.4" opacity="0.4"/>`,
  dorsal: (_, p) => `<path d="M126 56 C134 38 143 24 151 13 C160 29 168 44 175 56 C158 51 142 51 126 56 Z" fill="${p.fin}"/>
  <path d="M151 15 C156 28 162 40 167 52" fill="none" stroke="${p.mark}" stroke-width="1.6" opacity="0.4"/>
  <path d="M230 76 C233 71 236 68 239 66 C240 70 241 74 241 79 Z" fill="${p.fin}"/>`,
  body: (uid, p) => `<path d="${WHITE_BODY}" fill="url(#${uid}-b)"/>
  <g clip-path="url(#${uid}-c)"><path d="M10 88 L30 90 L40 94 L54 91 L68 97 L84 94 L98 100 L114 97 L132 102 L150 99 L168 104 L186 100 L204 103 L222 98 L240 97 L260 92 L260 130 L10 130 Z" fill="${p.belly}"/></g>`,
  marks: (uid, p) => `<g clip-path="url(#${uid}-c)">
  <path d="M40 72 C90 56 160 52 230 72" fill="none" stroke="${p.belly}" stroke-width="3" opacity="0.15" stroke-linecap="round"/>
  <path d="M236 90 L262 89 L262 94 L236 96 Z" fill="${p.mark}" opacity="0.55"/></g>`,
  gills: (_, p) => gillSlits(92, 7.5, 72, 100, p.mark, 2.2),
  fins: (_, p) => `<path d="M94 104 C106 120 118 140 124 158 C110 154 96 140 86 120 C87 113 90 108 94 104 Z" fill="${p.fin}"/>
  <path d="M117 146 C120 150 122 154 124 158 C118 156 113 153 109 149 Z" fill="${p.edge ?? p.mark}" opacity="0.8"/>
  <path d="M184 110 C189 117 195 123 201 126 C194 127 187 123 181 117 Z" fill="${p.fin}"/>
  <path d="M226 104 C229 108 232 111 236 113 C231 114 227 112 223 109 Z" fill="${p.fin}" opacity="0.9"/>`,
  head: (_, p) => {
    const teeth = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      `<path d="M${25 + i * 6} ${93.4 + i * 1.1} l2.4 4.6 l2.4 -4.2 Z" fill="#f6f6f2"/>`).join('');
    return `<path d="M20 91 C30 99 46 104 66 103 C52 106 36 104 24 97 Z" fill="${p.edge ?? p.mark}" opacity="0.9"/>
  ${teeth}
  <path d="M20 90 C32 96 48 100 66 101" fill="none" stroke="${p.edge ?? p.mark}" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="24" cy="84" r="1.6" fill="${p.mark}" opacity="0.8"/>
  ${eye(44, 79, 4.6, p.iris, p.pupil)}`;
  },
};

const WHALE_BODY = 'M18 82 C18 75 26 71 42 69 C82 63 122 57 162 56 C202 56 232 68 252 84 L254 98 C226 110 182 117 134 115 C92 113 52 109 30 103 C21 100 18 95 18 90 Z';
const whaleParts: SharkParts = {
  defs: (uid) => clip(uid, WHALE_BODY),
  tail: (_, p) => `<path d="M250 86 C264 70 282 50 302 26 C303 50 296 72 284 90 L286 94 C294 106 300 120 302 138 C284 124 266 110 252 100 Z" fill="${p.fin}"/>
  ${dots([[272, 70, 1.6], [282, 58, 1.4], [290, 46, 1.2], [276, 108, 1.5], [288, 120, 1.3]], p.mark, 0.8)}`,
  dorsal: (_, p) => `<path d="M154 58 C160 44 166 34 172 27 C180 38 186 50 190 60 C178 56 166 56 154 58 Z" fill="${p.fin}"/>
  ${dots([[166, 46, 1.4], [174, 38, 1.2], [178, 52, 1.3]], p.mark, 0.8)}
  <path d="M222 72 C225 66 228 62 231 60 C233 65 235 70 236 75 Z" fill="${p.fin}"/>`,
  body: (uid, p) => `<path d="${WHALE_BODY}" fill="url(#${uid}-b)"/>
  <path d="M22 96 C60 98 120 97 185 95 C215 94 236 92 250 88 L254 98 C226 110 182 117 134 115 C92 113 52 109 30 103 C24 101 22 99 22 96 Z" fill="${p.belly}" opacity="0.95"/>`,
  marks: (uid, p) => {
    let grid = '';
    for (let c = 0; c < 14; c++) {
      const x = 74 + c * 13;
      grid += `<path d="M${x - 2} 58 C${x} 72 ${x + 1} 84 ${x} 98" stroke="${p.mark}" stroke-width="1.6" fill="none" opacity="0.55"/>`;
      for (let r = 0; r < 5; r++) {
        const y = 64 + r * 8 + (c % 2) * 4;
        if (y < 98) grid += `<circle cx="${x + 6.5}" cy="${y}" r="${2 - r * 0.15}" fill="${p.mark}" opacity="0.9"/>`;
      }
    }
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      grid += `<circle cx="${26 + c * 8 + (r % 2) * 4}" cy="${74 + r * 5}" r="1.1" fill="${p.mark}" opacity="0.85"/>`;
    }
    const ridges = [70, 79, 88].map((y, i) =>
      `<path d="M${70 + i * 6} ${y} C130 ${y - 6 + i * 2} 200 ${y - 2 + i * 3} 250 ${86 + i * 2}" fill="none" stroke="${p.mid}" stroke-width="2.4" opacity="0.7"/>`).join('');
    return `<g clip-path="url(#${uid}-c)">${grid}${ridges}</g>`;
  },
  gills: (_, p) => gillSlits(84, 8, 70, 102, p.edge ?? p.mark, 2.4),
  fins: (_, p) => `<path d="M114 104 C126 120 138 138 144 154 C130 152 116 140 106 120 C107 113 110 108 114 104 Z" fill="${p.fin}"/>
  ${dots([[120, 118, 1.4], [128, 130, 1.3], [134, 142, 1.2], [116, 128, 1.1]], p.mark, 0.8)}
  <path d="M190 108 C195 115 201 121 207 124 C200 125 193 121 187 115 Z" fill="${p.fin}"/>
  <path d="M228 102 C231 106 235 109 239 111 C234 112 229 110 225 107 Z" fill="${p.fin}" opacity="0.9"/>`,
  head: (_, p) => `<path d="M18 84 C32 84 48 85 62 88 C48 91 32 92 18 92 Z" fill="${p.edge ?? p.mark}"/>
  <path d="M18 84 C32 84 48 85 62 88" fill="none" stroke="${p.mid}" stroke-width="1.6" opacity="0.7"/>
  ${eye(66, 80, 3.4, p.iris, p.pupil)}`,
};

const MEGA_BODY = 'M14 92 C12 70 28 54 60 50 C96 46 130 54 164 60 C200 66 230 74 252 86 L254 96 C226 106 186 112 140 112 C96 112 60 118 36 114 C20 110 14 102 14 92 Z';
const megaParts: SharkParts = {
  defs: (uid) => clip(uid, MEGA_BODY),
  tail: (_, p) => `<path d="M248 88 C262 74 282 52 306 30 C303 52 294 74 282 90 L284 94 C278 102 270 108 262 110 C256 104 252 100 250 98 Z" fill="${p.fin}"/>
  <path d="M252 96 C258 104 266 110 280 116 C268 118 259 113 252 108 Z" fill="${p.fin}"/>`,
  dorsal: (_, p) => `<path d="M148 60 C152 50 157 43 162 38 C168 46 172 55 175 64 C166 60 157 59 148 60 Z" fill="${p.fin}"/>
  <path d="M224 76 C227 70 230 67 233 65 C235 69 236 73 237 78 Z" fill="${p.fin}"/>`,
  body: (uid, p) => `<path d="${MEGA_BODY}" fill="url(#${uid}-b)"/>
  <g clip-path="url(#${uid}-c)"><path d="M40 108 C90 104 150 102 200 98 C224 96 240 94 254 92 L254 120 L30 120 Z" fill="${p.belly}" opacity="0.45"/></g>`,
  marks: (uid, p) => `<g clip-path="url(#${uid}-c)">
  <path d="M30 62 C60 50 110 50 160 62" fill="none" stroke="${p.mid}" stroke-width="5" opacity="0.35" stroke-linecap="round"/>
  <path d="M120 108 C140 104 160 104 180 106 M150 112 C170 108 190 106 210 104" fill="none" stroke="${p.mark}" stroke-width="1.4" opacity="0.4"/></g>`,
  gills: (_, p) => gillSlits(98, 7, 66, 100, p.mark, 2),
  fins: (_, p) => `<path d="M104 104 C112 118 120 134 124 148 C114 144 104 132 98 116 C99 111 101 107 104 104 Z" fill="${p.fin}"/>
  <path d="M124 148 C116 140 108 128 102 114" fill="none" stroke="${p.bar ?? p.belly}" stroke-width="1.8" opacity="0.7"/>
  <path d="M190 104 C194 110 199 115 204 118 C198 119 192 116 188 111 Z" fill="${p.fin}"/>
  <path d="M228 98 C231 102 234 105 238 107 C233 108 229 106 226 103 Z" fill="${p.fin}" opacity="0.9"/>`,
  head: (_, p) => {
    const teeth = Array.from({ length: 10 }, (_, i) =>
      `<circle cx="${22 + i * 6}" cy="${rd(92.6 + i * 0.25)}" r="0.9" fill="${p.bar ?? p.belly}" opacity="0.7"/>`).join('');
    return `<path d="M14 90 C30 92 54 94 86 92 C74 102 52 108 30 107 C20 105 15 99 14 90 Z" fill="${p.edge ?? p.mark}"/>
  <path d="M18 98 C36 100 56 100 76 97" fill="none" stroke="#6a3a3e" stroke-width="3" opacity="0.6" stroke-linecap="round"/>
  ${teeth}
  <path d="M14 88 C34 90 58 91 86 90" fill="none" stroke="${p.bar ?? p.belly}" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="20" cy="80" r="1.5" fill="${p.mark}" opacity="0.8"/>
  ${eye(54, 74, 3.6, p.iris, p.pupil)}`;
  },
};

const GREENLAND_BODY = 'M22 92 C22 80 34 70 58 66 C100 60 150 60 196 66 C226 72 246 80 258 88 L258 98 C240 106 214 112 180 114 C130 118 80 116 48 110 C30 106 22 100 22 92 Z';
const greenlandParts: SharkParts = {
  defs: (uid) => clip(uid, GREENLAND_BODY),
  tail: (_, p) => `<path d="M256 88 C268 80 282 70 296 60 C296 74 292 86 286 92 L288 96 C282 104 276 110 268 112 C262 106 258 102 256 98 Z" fill="${p.fin}"/>
  <path d="M258 98 C264 104 270 108 280 112 C270 114 262 110 258 104 Z" fill="${p.fin}"/>`,
  dorsal: (_, p) => `<path d="M132 62 C136 55 140 51 145 49 C149 54 152 59 154 63 C147 61 139 61 132 62 Z" fill="${p.fin}"/>
  <path d="M190 66 C194 60 197 57 201 55 C204 60 206 65 207 70 C201 67 196 66 190 66 Z" fill="${p.fin}"/>`,
  body: (uid, p) => `<path d="${GREENLAND_BODY}" fill="url(#${uid}-b)"/>`,
  marks: (uid, p) => {
    const dark: number[][] = [], pale: number[][] = [];
    for (let i = 0; i < 26; i++) {
      const x = 40 + ((i * 47) % 210), y = 70 + ((i * 29) % 38);
      (i % 3 === 0 ? pale : dark).push([x, y, 2 + (i % 4) * 0.9, 1.6 + (i % 3) * 0.7]);
    }
    return `<g clip-path="url(#${uid}-c)">${dots(dark, p.mark, 0.55)}${dots(pale, p.bar ?? p.belly, 0.5)}
  <path d="M40 74 C90 64 170 64 240 82" fill="none" stroke="${p.bar ?? p.belly}" stroke-width="2" opacity="0.2"/></g>`;
  },
  gills: (_, p) => gillSlits(74, 6, 84, 100, p.mark, 1.6),
  fins: (_, p) => `<path d="M88 104 C94 112 100 118 107 121 C99 123 90 118 84 110 Z" fill="${p.fin}"/>
  <path d="M204 106 C208 111 212 114 217 116 C211 117 206 114 202 110 Z" fill="${p.fin}"/>`,
  head: (_, p) => `<path d="M30 99 C38 102 46 103 56 102" fill="none" stroke="${p.edge ?? p.mark}" stroke-width="2.4" stroke-linecap="round"/>
  <circle cx="27" cy="88" r="1.4" fill="${p.mark}" opacity="0.8"/>
  ${eye(46, 80, 3.2, p.iris, p.pupil)}
  <path d="M47 83.5 C48 88 46 91 48 95" fill="none" stroke="#e2dcc4" stroke-width="1.8" stroke-linecap="round"/>
  <ellipse cx="48" cy="96" rx="1.8" ry="1.4" fill="#e2dcc4"/>`,
};

// ---------------------------------------------------------------------------
// Leatherback Sea Turtle — ridged leathery carapace, long front flippers.

export const turtle: PlanBuilder = (uid, p, o = {}) => {
  const ridge = p.bar ?? p.mid;
  const shell = 'M92 96 C96 70 120 52 158 48 C200 46 238 64 262 88 C266 92 270 95 276 98 C254 104 230 110 198 114 C160 118 118 116 96 108 C92 104 91 100 92 96 Z';
  const ridges = ['M108 70 C140 50 196 50 230 66 C248 76 262 88 274 97', 'M98 84 C140 66 200 66 236 78 C252 84 264 92 274 97',
    'M94 98 C140 88 200 88 238 91 C254 93 264 95 274 97']
    .map((d) => `<path d="${d}" fill="none" stroke="${ridge}" stroke-width="3" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${p.mark}" stroke-width="1" opacity="0.25" transform="translate(0 -1.5)"/>`).join('');
  const spots = dots([[126, 62, 1.8], [150, 56, 1.4], [178, 58, 1.7], [204, 64, 1.3], [134, 78, 1.5], [168, 74, 1.9],
    [196, 76, 1.4], [222, 80, 1.6], [116, 92, 1.4], [150, 94, 1.7], [186, 94, 1.3], [214, 96, 1.5], [242, 90, 1.2],
    [132, 106, 1.3], [170, 108, 1.5], [206, 106, 1.2]], p.mark, 0.75);
  const flipSpots = dots([[140, 116, 1.6], [162, 128, 1.4], [184, 140, 1.7], [204, 152, 1.3], [222, 160, 1.2], [150, 124, 1.1]], p.mark, 0.75);
  return `${open(o.label ?? 'Leatherback Sea Turtle')}
  <defs>${grad(uid, p.back, p.mid, p.belly)}${clip(uid, shell)}</defs>
  <path d="M122 102 C130 122 140 144 150 162 C155 169 163 169 164 163 C160 146 152 124 142 102 Z" fill="${p.edge ?? p.back}" opacity="0.9"/>
  <path d="M238 102 C248 112 262 118 274 118 C270 110 260 104 250 100 Z" fill="${p.fin}"/>
  <path d="${shell}" fill="url(#${uid}-b)"/>
  <g clip-path="url(#${uid}-c)">${ridges}${spots}
    <path d="M96 106 C140 118 200 116 262 100" fill="none" stroke="${p.belly}" stroke-width="5" opacity="0.5"/>
    <path d="M120 58 C150 48 190 50 220 62" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.08" stroke-linecap="round"/></g>
  <path d="M102 98 C128 110 168 130 212 158 C222 165 234 168 240 164 C234 156 212 140 188 124 C164 110 140 100 116 94 Z" fill="${p.fin}"/>
  <path d="M112 100 C146 114 186 136 232 162" fill="none" stroke="${ridge}" stroke-width="2" opacity="0.8" stroke-linecap="round"/>
  ${flipSpots}
  <path d="M100 86 C88 74 66 72 50 76 C36 80 27 88 29 96 C31 104 44 109 60 107 C78 105 92 100 100 96 Z" fill="url(#${uid}-b)"/>
  <path d="M86 78 C92 84 94 92 92 100" fill="none" stroke="${p.mark}" stroke-width="1.2" opacity="0.35"/>
  ${dots([[66, 80, 1.3], [78, 84, 1.5], [72, 96, 1.2], [84, 94, 1.3], [46, 82, 1]], p.mark, 0.7)}
  <ellipse cx="58" cy="77" rx="6" ry="2.6" fill="${p.accent ?? p.belly}" opacity="0.9"/>
  <path d="M29 95 C38 98 50 99 62 98" fill="none" stroke="${p.edge ?? p.mark}" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M30 94 l2.6 4.6 l2.8 -3.8 l2.6 4 l2.4 -3.4" fill="none" stroke="${p.belly}" stroke-width="1.3" stroke-linejoin="round" opacity="0.8"/>
  ${eye(48, 86, 4, p.iris, p.pupil)}
  <path d="M42 82 C46 80 51 80 54 82" fill="none" stroke="${p.edge ?? p.mark}" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;
};

// ---------------------------------------------------------------------------
// Giant Pacific Octopus — mantle behind the head, eight curling arms.

export const octopus: PlanBuilder = (uid, p, o = {}) => {
  const sucker = p.accent ?? p.belly;
  // [x, y, startAngle, length, turn, wave, baseWidth, suckerSide]
  const far: number[][] = [[132, 104, 200, 70, 150, 0, 9, 1], [160, 104, 330, 80, -150, 0, 9, -1], [148, 108, 250, 60, -40, 8, 8, 1]];
  const near: number[][] = [
    [110, 102, 165, 92, 190, 0, 13, 1], [118, 110, 135, 98, 170, 0, 13, 1], [134, 114, 108, 86, -170, 0, 13, -1],
    [154, 112, 70, 92, -200, 0, 13, -1], [170, 106, 25, 104, -170, 0, 12, -1],
  ];
  const limb = (a: number[], fill: string, withSuckers: boolean) => {
    const [x, y, a0, len, turn, wave, w0, side] = a as [number, number, number, number, number, number, number, number];
    const pts = curve(x, y, a0, len, turn, wave);
    return `<path d="${ribbon(pts, w0, 1.2, 0.9)}" fill="${fill}"/>${withSuckers ? suckers(pts, w0, 1.2, side, sucker) : ''}`;
  };
  const mantle = 'M96 88 C92 70 104 56 124 54 C140 40 170 26 210 26 C252 26 276 46 272 70 C268 92 242 104 208 104 C184 104 164 100 150 104 C136 112 116 112 104 104 C98 99 96 94 96 88 Z';
  const papillae = dots([[150, 46, 2.2], [176, 38, 2.6], [204, 34, 2], [232, 40, 2.4], [252, 54, 2], [170, 56, 1.8],
    [198, 52, 2.4], [226, 60, 2], [248, 74, 1.8], [186, 76, 2.2], [214, 82, 1.9], [160, 74, 1.6], [236, 88, 1.6], [136, 64, 1.6]], p.mark, 0.5);
  return `${open(o.label ?? 'Giant Pacific Octopus')}
  <defs>${grad(uid, p.back, p.mid, p.belly)}${clip(uid, mantle)}</defs>
  ${far.map((a) => limb(a, p.mark, false)).join('')}
  <path d="${mantle}" fill="url(#${uid}-b)"/>
  <g clip-path="url(#${uid}-c)">${papillae}
    <path d="M150 40 C180 28 230 28 258 46" fill="none" stroke="#ffffff" stroke-width="7" opacity="0.12" stroke-linecap="round"/>
    <path d="M140 74 C170 66 210 70 240 86 M150 90 C180 84 210 88 236 98" fill="none" stroke="${p.mark}" stroke-width="1.6" opacity="0.35"/></g>
  ${near.map((a) => limb(a, p.fin, true)).join('')}
  <path d="M100 100 C116 112 150 116 178 104" fill="none" stroke="${p.mark}" stroke-width="2" opacity="0.4"/>
  <path d="M146 96 C156 92 166 94 172 100 C166 104 156 104 148 102 Z" fill="${p.fin}" stroke="${p.mark}" stroke-width="1.2"/>
  <path d="M110 60 l-2 -9 l7 6 Z" fill="${p.fin}"/>
  <circle cx="118" cy="74" r="9" fill="${p.mid}"/>
  <circle cx="118" cy="74" r="7" fill="${p.iris ?? '#e2b65a'}"/>
  <rect x="112.5" y="72.2" width="11" height="3.6" rx="1.8" fill="${p.pupil ?? '#140c08'}"/>
  <circle cx="115.5" cy="71" r="1.3" fill="#f4f7f5"/>
</svg>`;
};

// ---------------------------------------------------------------------------
// Ocean Sunfish — tall disc, no tail: a scalloped clavus between tall dorsal and anal fins.

export const sunfish: PlanBuilder = (uid, p, o = {}) => {
  const body = 'M48 92 C48 64 70 42 110 38 C150 34 190 40 224 50 L224 132 C190 142 150 146 110 142 C70 138 48 120 48 92 Z';
  let clavus = 'M220 48';
  const bumps = 9;
  for (let i = 0; i < bumps; i++) {
    const a0 = -80 + (160 * i) / bumps, a1 = -80 + (160 * (i + 1)) / bumps;
    const [x1, y1] = [214 + Math.cos(rad(a1)) * 34, 90 + Math.sin(rad(a1)) * 44];
    const [cx, cy] = [214 + Math.cos(rad((a0 + a1) / 2)) * 42, 90 + Math.sin(rad((a0 + a1) / 2)) * 52];
    clavus += ` Q${rd(cx)} ${rd(cy)} ${rd(x1)} ${rd(y1)}`;
  }
  clavus += ' L220 132 Z';
  const rays = Array.from({ length: 9 }, (_, i) => {
    const a = rad(-70 + (140 * i) / 8);
    return `<path d="M${rd(214 + Math.cos(a) * 10)} ${rd(90 + Math.sin(a) * 18)} L${rd(214 + Math.cos(a) * 34)} ${rd(90 + Math.sin(a) * 42)}" stroke="${p.mark}" stroke-width="1.3" opacity="0.4"/>`;
  }).join('');
  const blotches = dots([[90, 60, 9, 5], [130, 54, 11, 6], [170, 58, 9, 5], [110, 118, 12, 6], [154, 124, 10, 5], [196, 112, 8, 5],
    [146, 92, 10, 6], [190, 80, 7, 5], [84, 110, 7, 4]], p.bar ?? p.belly, 0.45);
  return `${open(o.label ?? 'Ocean Sunfish')}
  <defs>${grad(uid, p.back, p.mid, p.belly)}${clip(uid, body)}</defs>
  <path d="M174 46 C186 30 200 14 216 4 C222 20 224 36 224 54 C208 48 190 46 174 46 Z" fill="${p.fin}"/>
  <path d="M174 136 C186 150 200 166 216 176 C222 160 224 144 224 126 C208 132 190 134 174 136 Z" fill="${p.fin}"/>
  <path d="M188 40 C198 28 206 18 214 10 M188 140 C198 152 206 162 214 170" fill="none" stroke="${p.mark}" stroke-width="1.4" opacity="0.4"/>
  <path d="${clavus}" fill="${p.fin}"/>
  ${rays}
  <path d="${body}" fill="url(#${uid}-b)"/>
  <g clip-path="url(#${uid}-c)">${blotches}
    <path d="M70 52 C110 38 170 40 214 52" fill="none" stroke="#ffffff" stroke-width="5" opacity="0.15" stroke-linecap="round"/>
    <path d="M60 120 C100 136 160 140 214 128" fill="none" stroke="${p.mark}" stroke-width="2" opacity="0.25"/></g>
  <ellipse cx="104" cy="88" rx="3.2" ry="5" fill="${p.edge ?? p.mark}" opacity="0.85"/>
  <path d="M112 82 C122 76 134 78 136 87 C130 94 118 96 112 92 Z" fill="${p.fin}" stroke="${p.mark}" stroke-width="1"/>
  <path d="M48 94 C48 99 50 102 54 102 C57 102 58 98 56 95 Z" fill="${p.edge ?? p.mark}"/>
  <path d="M50 92 C53 91 56 92 58 94" fill="none" stroke="${p.mark}" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
  ${eye(76, 78, 6, p.iris, p.pupil)}
</svg>`;
};

// ---------------------------------------------------------------------------
// Coelacanth — fleshy lobed fins, steel-blue with white blotches, three-lobed tail.

function lobeFin(x: number, y: number, angle: number, scale: number, p: Palette): string {
  const rays = [-4, -1.5, 1, 3.5, 6].map((dy) =>
    `<path d="M28 ${dy * 0.5} L${rd(48 + Math.abs(dy) * -0.6)} ${dy * 1.6}" stroke="${p.mark}" stroke-width="1" opacity="0.35"/>`).join('');
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">
    <path d="M24 -5 C34 -13 46 -11 52 -2 C51 5 46 11 38 13 C32 11 27 7 24 5 Z" fill="${p.fin}"/>${rays}
    <path d="M0 -6 C10 -8 20 -6 28 -3 L28 3 C20 6 10 8 0 6 Z" fill="${p.bar ?? p.mid}"/>
    <path d="M6 -3 C14 -4 20 -3 26 -1" fill="none" stroke="${p.mark}" stroke-width="1" opacity="0.4"/></g>`;
}

export const coelacanth: PlanBuilder = (uid, p, o = {}) => {
  const body = 'M30 92 C36 70 62 56 100 54 C150 50 200 60 236 78 L246 86 L246 98 L236 106 C200 122 150 130 100 126 C62 124 36 112 30 92 Z';
  const scales: string[] = [];
  for (let r = 0; r < 6; r++) for (let i = 0; i < 11; i++) {
    const x = 96 + i * 13 + (r % 2) * 6.5, y = 62 + r * 11;
    scales.push(`<path d="M${x} ${y} q6.5 6 13 0" fill="none" stroke="${p.mark}" stroke-width="1" opacity="0.14"/>`);
  }
  const blotches = dots([[104, 70, 6, 4], [132, 62, 5, 3.5], [160, 72, 7, 4.5], [190, 66, 5, 3.5], [214, 82, 5, 3.5],
    [118, 94, 7, 4.5], [150, 100, 5, 3.5], [180, 92, 6, 4], [206, 104, 4.5, 3], [130, 116, 5, 3], [92, 108, 4, 3], [168, 116, 4.5, 3]], p.mark, 0.85);
  const tailRays = (sign: number) => [0, 1, 2, 3, 4].map((i) =>
    `<path d="M${250 + i * 2} ${92 + sign * (4 + i)} L${266 + i * 4} ${92 + sign * (16 + i * 6)}" stroke="${p.mark}" stroke-width="1" opacity="0.35"/>`).join('');
  return `${open(o.label ?? 'Coelacanth')}
  <defs>${grad(uid, p.back, p.mid, p.belly)}${clip(uid, body)}</defs>
  <path d="M234 80 C250 66 268 56 284 52 C282 66 276 80 266 88 L248 90 Z" fill="${p.fin}"/>
  <path d="M234 104 C250 118 268 128 284 132 C282 118 276 104 266 96 L248 94 Z" fill="${p.fin}"/>
  ${tailRays(-1)}${tailRays(1)}
  <path d="M244 86 C258 87 272 88 284 88 L284 96 C272 96 258 97 244 98 Z" fill="url(#${uid}-b)"/>
  <path d="M282 88 C290 80 300 78 308 82 C304 88 304 96 308 102 C300 106 290 104 282 96 Z" fill="${p.fin}"/>
  ${[82, 92, 102].map((y) => `<path d="M284 92 L${y === 92 ? 306 : 304} ${y}" stroke="${p.mark}" stroke-width="1" opacity="0.4"/>`).join('')}
  ${lobeFin(204, 66, -35, 1, p)}
  ${lobeFin(208, 112, 30, 0.95, p)}
  <path d="M128 56 C128 40 136 30 148 28 C158 32 164 42 166 56 C152 54 140 54 128 56 Z" fill="${p.fin}"/>
  ${[0, 1, 2, 3, 4].map((i) => `<path d="M${132 + i * 7} 56 L${138 + i * 6} ${32 + Math.abs(i - 2) * 3}" stroke="${p.mark}" stroke-width="1.4" opacity="0.5"/>`).join('')}
  ${lobeFin(152, 122, 55, 0.95, p)}
  <path d="${body}" fill="url(#${uid}-b)"/>
  <g clip-path="url(#${uid}-c)">${scales.join('')}${blotches}
    <path d="M60 66 C110 54 170 56 230 76" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.12" stroke-linecap="round"/></g>
  ${lobeFin(96, 102, 32, 1.2, p)}
  <path d="M84 62 C96 78 98 100 88 116" fill="none" stroke="${p.mark}" stroke-width="2" opacity="0.5"/>
  <path d="M32 96 C44 100 56 102 68 101" fill="none" stroke="${p.edge ?? p.mark}" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M40 104 C50 108 62 110 74 108" fill="none" stroke="${p.mark}" stroke-width="1.4" opacity="0.5"/>
  ${dots([[50, 70, 2.4, 1.8], [72, 66, 2, 1.5]], p.mark, 0.8)}
  ${eye(60, 80, 8, p.iris, p.pupil)}
</svg>`;
};

// ---------------------------------------------------------------------------
// Killer Whale — black and white, eye patch, grey saddle, very tall dorsal fin.

export const orca: PlanBuilder = (uid, p, o = {}) => {
  const white = p.belly, patch = p.mark;
  const body = 'M20 98 C18 82 32 70 58 66 C100 58 150 56 190 62 C226 68 252 80 270 92 L272 98 C252 106 222 112 186 116 C140 122 90 122 56 116 C34 112 22 106 20 98 Z';
  return `${open(o.label ?? 'Killer Whale')}
  <defs>${grad(uid, p.back, p.mid, p.back)}${clip(uid, body)}</defs>
  <path d="M264 92 C278 84 294 74 312 70 C308 82 298 92 286 96 Z" fill="${p.fin}"/>
  <path d="M264 98 C278 104 292 112 310 120 C304 108 296 100 284 96 Z" fill="${p.fin}"/>
  <path d="M144 62 C150 44 154 22 157 4 C166 22 178 46 192 66 C176 61 160 60 144 62 Z" fill="${p.fin}"/>
  <path d="M157 8 C162 26 170 44 180 60" fill="none" stroke="#ffffff" stroke-width="1.6" opacity="0.12"/>
  <path d="${body}" fill="url(#${uid}-b)"/>
  <g clip-path="url(#${uid}-c)">
    <path d="M22 102 C36 112 60 118 96 120 C122 121 140 118 154 112 C172 104 190 94 214 92 C206 100 198 108 196 116 C214 114 234 110 252 104 L272 98 L272 130 L10 130 Z" fill="${white}"/>
    <path d="M186 64 C202 61 216 66 228 76 C214 78 198 76 186 70 Z" fill="${p.bar ?? '#9aa3aa'}" opacity="0.9"/>
    <path d="M40 74 C80 60 140 56 190 62" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.1" stroke-linecap="round"/></g>
  <path d="M66 82 C76 74 94 74 108 79 C102 86 86 90 72 89 C67 87 65 85 66 82 Z" fill="${patch}"/>
  <path d="M82 110 C88 124 98 138 112 144 C120 144 122 138 118 130 C112 120 102 112 92 106 Z" fill="${p.fin}"/>
  <path d="M22 100 C32 103 44 104 58 102" fill="none" stroke="${p.edge ?? '#050608'}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
  ${eye(58, 92, 3, p.iris, p.pupil)}
</svg>`;
};

// ---------------------------------------------------------------------------
// Oarfish — a long silver ribbon with a red dorsal crest the whole way along.

export const oarfish: PlanBuilder = (uid, p, o = {}) => {
  const pts: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = 30 + (i / 40) * 284;
    pts.push([x, 92 + Math.sin((x - 30) / 46) * 14 * Math.min(1, (x - 30) / 80)]);
  }
  const w0 = 24, w1 = 2, pow = 0.35;
  const bodyD = ribbon(pts, w0, w1, pow);
  const top = edge(pts, w0, w1, pow, -1, 1);
  const finOut = edge(pts, w0 + 18, w1 + 6, pow, -1, 1);
  const finD = smooth([...top, ...finOut.slice().reverse()]);
  const rays = top.filter((_, i) => i % 2 === 0).map(([x, y], j) => {
    const [fx, fy] = finOut[j * 2]!;
    return `<path d="M${rd(x)} ${rd(y)} L${rd(fx + 2)} ${rd(fy)}" stroke="${p.accent ?? p.fin}" stroke-width="1" opacity="0.8"/>`;
  }).join('');
  const streaks = pts.slice(3, 36).filter((_, i) => i % 2 === 0).map(([x, y], i) =>
    `<path d="M${rd(x - 3)} ${rd(y - 4 + (i % 2) * 5)} l6 3" stroke="${p.mark}" stroke-width="1.6" opacity="0.55" stroke-linecap="round"/>`).join('');
  const [hx, hy] = pts[0]!;
  const crest = [[-118, 42], [-110, 52], [-100, 58], [-90, 52], [-80, 44], [-72, 34]].map(([a, len], i) => {
    const c = curve(hx + 2 + i * 3, hy - 11, a!, len!, 40 + i * 8, 0, 10);
    const d = c.map(([x, y], k) => `${k ? 'L' : 'M'}${rd(x)} ${rd(y)}`).join(' ');
    const [ex, ey] = c[c.length - 1]!;
    return `<path d="${d}" fill="none" stroke="${p.fin}" stroke-width="2.4" stroke-linecap="round"/><circle cx="${rd(ex)}" cy="${rd(ey)}" r="2" fill="${p.fin}"/>`;
  }).join('');
  const oars = [[60, 72], [70, 66]].map(([a, len]) => {
    const c = curve(hx + 4, hy + 10, a!, len!, -30, 0, 10);
    const d = c.map(([x, y], k) => `${k ? 'L' : 'M'}${rd(x)} ${rd(y)}`).join(' ');
    const [ex, ey] = c[c.length - 1]!;
    return `<path d="${d}" fill="none" stroke="${p.fin}" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="${rd(ex)}" cy="${rd(ey)}" rx="5" ry="2.4" transform="rotate(20 ${rd(ex)} ${rd(ey)})" fill="${p.fin}"/>`;
  }).join('');
  return `${open(o.label ?? 'Oarfish')}
  <defs>${grad(uid, p.back, p.mid, p.belly)}</defs>
  <path d="${finD}" fill="${p.fin}" opacity="0.92"/>
  ${rays}${crest}${oars}
  <path d="${bodyD}" fill="url(#${uid}-b)"/>
  <path d="M${hx} ${hy - 12} C${hx - 10} ${hy - 12} ${hx - 16} ${hy - 6} ${hx - 16} ${hy + 1} C${hx - 16} ${hy + 8} ${hx - 10} ${hy + 12} ${hx} ${hy + 12} Z" fill="url(#${uid}-b)"/>
  ${streaks}
  <path d="M${hx + 8} ${hy - 9} C${hx + 12} ${hy - 2} ${hx + 12} ${hy + 4} ${hx + 8} ${hy + 10}" fill="none" stroke="${p.mark}" stroke-width="1.6" opacity="0.5"/>
  <path d="M${hx - 15} ${hy + 3} l6 3" stroke="${p.edge ?? p.mark}" stroke-width="1.8" stroke-linecap="round"/>
  ${eye(hx - 6, hy - 3, 4, p.iris, p.pupil)}
</svg>`;
};

// ---------------------------------------------------------------------------
// Giant Squid — long mantle with fins at the tip, eight arms and two long tentacles.

export const squid: PlanBuilder = (uid, p, o = {}) => {
  const mantle = 'M168 60 C200 55 240 59 270 67 C286 71 298 75 308 80 C298 85 286 89 270 93 C240 101 200 104 168 99 C163 88 163 71 168 60 Z';
  const sucker = p.accent ?? p.belly;
  // [startY, angle, length, turn, wave]
  const arms: number[][] = [[72, 196, 92, -30, 6], [76, 186, 104, 24, -6], [80, 178, 110, -20, 8], [84, 172, 102, 30, -6],
    [88, 166, 96, -26, 5], [90, 158, 88, 40, -4], [74, 204, 80, 40, -4], [92, 150, 80, 34, 6]];
  const armSvg = arms.map(([y, a, len, turn, wave], i) => {
    const pts = curve(136, y!, a!, len!, turn!, wave!);
    const fill = i % 2 ? p.fin : p.mid;
    return `<path d="${ribbon(pts, 8, 1, 1)}" fill="${fill}"/>${i % 2 ? '' : suckers(pts, 8, 1, 1, sucker, 0.7)}`;
  });
  const tentacle = (y: number, a: number, turn: number) => {
    const pts = curve(136, y, a, 132, turn, 4, 32);
    const club = pts.slice(-8);
    return `<path d="${ribbon(pts, 4, 2, 1)}" fill="${p.fin}"/>
    <path d="${ribbon(club, 7, 2, 0.5)}" fill="${p.fin}"/>${suckers(club, 7, 2, 1, sucker, 1)}`;
  };
  const chroma = dots([[190, 66, 1.6], [214, 64, 1.4], [238, 68, 1.7], [258, 72, 1.3], [202, 78, 1.8], [228, 80, 1.5],
    [252, 84, 1.4], [184, 90, 1.5], [212, 92, 1.3], [240, 90, 1.2], [278, 78, 1.2], [176, 74, 1.3]], p.mark, 0.6);
  return `${open(o.label ?? 'Giant Squid')}
  <defs>${grad(uid, p.back, p.mid, p.belly)}${clip(uid, mantle)}</defs>
  ${tentacle(80, 186, -12)}${tentacle(86, 172, 14)}
  ${armSvg.slice(0, 4).join('')}
  <path d="M252 66 C262 50 282 50 296 62 L310 80 C292 75 272 70 252 66 Z" fill="${p.fin}"/>
  <path d="M252 94 C262 110 282 110 296 98 L310 80 C292 85 272 90 252 94 Z" fill="${p.fin}"/>
  <path d="${mantle}" fill="url(#${uid}-b)"/>
  <g clip-path="url(#${uid}-c)">${chroma}
    <path d="M176 64 C210 58 250 62 290 74" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.15" stroke-linecap="round"/></g>
  <path d="M172 60 C160 58 146 62 138 68 C130 74 128 84 132 90 C138 98 154 100 172 99 Z" fill="url(#${uid}-b)"/>
  ${armSvg.slice(4).join('')}
  <path d="M166 62 C162 72 162 88 166 98" fill="none" stroke="${p.mark}" stroke-width="1.6" opacity="0.5"/>
  ${eye(152, 79, 11, p.iris, p.pupil)}
</svg>`;
};

// ---------------------------------------------------------------------------
// Per-legendary looks, aligned with LEGENDARY_DEFS (index = species - 1000).

const sharkLook = (parts: SharkParts): PlanOpts => ({ parts });

const LOOKS: { palette: Palette; planOpts?: PlanOpts }[] = [
  { palette: { back: '#55615f', mid: '#8d978e', belly: '#ecebe0', fin: '#5a6663', mark: '#2a3231', edge: '#242b2b', iris: '#4a4630' },
    planOpts: sharkLook(tigerParts) },
  { palette: { back: '#1f252b', mid: '#343d45', belly: '#c4cac8', fin: '#262d34', mark: '#e4ebea', bar: '#56626c', accent: '#d8949c', edge: '#11161a', iris: '#2c2a24' } },
  { palette: { back: '#8e2a1c', mid: '#c4502e', belly: '#f2a882', fin: '#b03e26', mark: '#5e1810', accent: '#f6cdb4', iris: '#e2b65a', pupil: '#140c08' } },
  { palette: { back: '#5e696f', mid: '#959fa3', belly: '#dfe4e2', fin: '#6c777c', mark: '#434d53', bar: '#cbd2d3', edge: '#2e363a', iris: '#4a4a3a' } },
  { palette: { back: '#1d3956', mid: '#2e5878', belly: '#5a7e9a', fin: '#3a6890', mark: '#e8eef2', bar: '#4c7ca2', edge: '#0f2234', iris: '#cfe070', pupil: '#0b1218' } },
  { palette: { back: '#56626c', mid: '#8b97a1', belly: '#f4f4f0', fin: '#4f5b65', mark: '#2a323a', edge: '#1a2026', iris: '#141414', pupil: '#000000' },
    planOpts: sharkLook(whiteParts) },
  { palette: { back: '#101317', mid: '#1c2127', belly: '#f4f6f6', fin: '#14181c', mark: '#f4f6f6', bar: '#9aa3aa', edge: '#050608', iris: '#1a1a1a' } },
  { palette: { back: '#2a4457', mid: '#44657a', belly: '#dfe7ea', fin: '#2e4a5f', mark: '#eef4f5', edge: '#16242e', iris: '#2a2a22' },
    planOpts: sharkLook(whaleParts) },
  { palette: { back: '#8f9aa6', mid: '#cdd5dc', belly: '#f0f3f5', fin: '#d42e3a', mark: '#47525f', accent: '#ef6670', edge: '#56616d', iris: '#c8c8b8' } },
  { palette: { back: '#3a3234', mid: '#5a4f4f', belly: '#9c928a', fin: '#3a3133', mark: '#1d1819', bar: '#e6dfd4', edge: '#140f10', iris: '#3a3430' },
    planOpts: sharkLook(megaParts) },
  { palette: { back: '#4b453f', mid: '#6c655c', belly: '#938a7e', fin: '#47413b', mark: '#2a2622', bar: '#a8a092', edge: '#201c19', iris: '#7d8a92', pupil: '#1a1c1e' },
    planOpts: sharkLook(greenlandParts) },
  { palette: { back: '#7a2c32', mid: '#b4544f', belly: '#e6a898', fin: '#963c40', mark: '#4e1a1e', accent: '#f2cbbb', iris: '#d8d2c0', pupil: '#0a0808' } },
];

export const LEGENDARY_PLANS: Record<LegendaryPlan, PlanBuilder> = {
  shark, turtle, octopus, sunfish, coelacanth, orca, oarfish, squid,
};

export const LEGENDARY_LOOKS: readonly { palette: Palette; planOpts: PlanOpts }[] = LOOKS.map((l, i) => ({
  palette: l.palette,
  planOpts: { ...l.planOpts, label: LEGENDARY_DEFS[i]!.name },
}));
