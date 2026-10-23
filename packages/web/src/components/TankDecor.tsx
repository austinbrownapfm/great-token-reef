import { useEffect, useId, useState, type ReactNode } from 'react';
import { DECOR_META, OPEN_WATER, backdropLayers, type BackdropLayer, type DecorPlacement } from '../lib/tankDecor';

// Set reward art (living-tank spec §4): 21 sand pieces and 3 backdrops, flat SVG in the weeds/pebbles/rocks style.
// Each piece draws in a `0 0 w h` box (DECOR_META) with its foot on y = h; anything below sinks under the sand.

const INK = { stroke: '#1b1712', strokeOpacity: 0.35, strokeWidth: 1.2, strokeLinejoin: 'round' as const };
const WOOD = '#8a5a2b';
const WOOD_DARK = '#5a3816';
const IRON = '#3e464b';
const BRASS = '#c9973a';
const MOSS = '#5d8a3a';
const ROPE = '#c8a874';

type Art = (uid: string) => ReactNode;

export const DECOR_ART: Record<string, Art> = {
  rowboat: () => (
    <g transform="rotate(-3 60 44)">
      <path d="M4,14 Q60,6 116,20 Q60,17 4,14 Z" fill="#3f2610" />
      <path d="M54,10 L55,17 M86,13 L86,19" stroke="#6b4520" strokeWidth="2.5" />
      <path d="M4,14 Q60,18 116,20 Q114,36 96,46 L34,46 Q10,42 4,14 Z" fill="#7a4a24" {...INK} />
      <path d="M8,25 Q60,31 112,30 M16,35 Q60,41 104,39" stroke="#5a3414" strokeWidth="1.2" fill="none" />
      <path d="M7,20 Q60,25 114,26" stroke="#e8dcc0" strokeWidth="1.8" fill="none" opacity=".5" />
      <path d="M4,14 Q60,18 116,20" stroke="#a8743d" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="42" cy="44" rx="11" ry="3" fill={MOSS} opacity=".55" />
      <ellipse cx="92" cy="42" rx="8" ry="2.6" fill={MOSS} opacity=".5" />
    </g>
  ),
  'tackle-box': () => (
    <g>
      <path d="M6,21 L10,5 L58,3 L60,21 Z" fill="#2f5f46" {...INK} />
      <path d="M27,4 Q34,-1 41,3.5" stroke="#2a2a2a" strokeWidth="2" fill="none" />
      <ellipse cx="20" cy="19" rx="5.5" ry="2.6" fill="#d94a3a" />
      <path d="M16,19 H24" stroke="#f2ede2" strokeWidth="1" />
      <path d="M28,20 A4,4 0 0 1 36,20 Z" fill="#f2ede2" />
      <path d="M28,20 A4,4 0 0 1 32,16 V20 Z" fill="#d94a3a" />
      <ellipse cx="45" cy="18" rx="6.5" ry="2.6" fill="#e8c13a" />
      <circle cx="41" cy="17.6" r=".9" fill="#1b1712" />
      <path d="M51.5,18 q4,0 3,4.5 q-1,1.5 -2.5,0" stroke="#b8bcc0" strokeWidth="1" fill="none" />
      <rect x="6" y="21" width="54" height="23" rx="2" fill="#3f7a5a" {...INK} />
      <rect x="6" y="34" width="54" height="10" fill="#000" opacity=".12" />
      <path d="M6,26 H60" stroke="#5c9a78" strokeWidth="1" opacity=".7" />
      <rect x="30" y="22" width="6" height="5" rx="1" fill="#c9a24a" />
      <circle cx="14" cy="38" r="2.2" fill="#a0582a" opacity=".45" />
      <circle cx="51" cy="31" r="1.6" fill="#a0582a" opacity=".4" />
    </g>
  ),
  log: () => (
    <g>
      <path d="M44,15 L38,3 Q42,1 46,3 L52,14 Z" fill="#6b4a2c" {...INK} />
      <ellipse cx="42" cy="3" rx="4" ry="1.8" fill="#c49a64" />
      <path d="M10,38 Q4,24 12,16 Q20,12 30,13 L114,8 Q124,8 126,20 Q128,34 116,38 Z" fill="#6b4a2c" {...INK} />
      <path d="M20,22 Q50,18 80,20 Q96,21 108,18 M18,30 Q48,27 78,30 Q96,31 110,28" stroke="#4e341c" strokeWidth="1.4" fill="none" opacity=".75" />
      <ellipse cx="64" cy="25" rx="4" ry="2.4" fill="#4e341c" />
      <path d="M11,36 L6,30 L11,26 L7,20 L12,16" stroke="#4e341c" strokeWidth="1.4" fill="none" />
      <ellipse cx="118" cy="23" rx="9" ry="13.5" fill="#c49a64" {...INK} />
      <ellipse cx="118" cy="23" rx="6" ry="9" fill="none" stroke="#8a6236" strokeWidth="1" />
      <ellipse cx="118" cy="23" rx="2.6" ry="4" fill="none" stroke="#8a6236" strokeWidth="1" />
      <path d="M22,15 Q30,10 38,14 M58,12 Q70,7 84,11 Q92,8 102,10" stroke={MOSS} strokeWidth="4" fill="none" strokeLinecap="round" opacity=".9" />
    </g>
  ),
  barrel: () => (
    <g transform="rotate(-7 29 62)">
      <path d="M12,10 Q5,36 11,64 L47,64 Q53,36 46,10 Z" fill={WOOD} {...INK} />
      <path d="M20,10 Q15,36 20,64 M29,10 V64 M38,10 Q43,36 38,64" stroke="#6a421c" strokeWidth="1" fill="none" />
      <path d="M14,14 Q11,36 15,58" stroke="#c08a50" strokeWidth="2" fill="none" opacity=".35" />
      <path d="M10,18 Q29,22 48,18 M8,55 Q29,59 50,55" stroke={IRON} strokeWidth="3.5" fill="none" />
      <path d="M7,31 Q29,35 51,31 M7,43 Q29,47 51,43" stroke="#4a5257" strokeWidth="2.4" fill="none" />
      <ellipse cx="29" cy="10" rx="17" ry="4" fill="#6e4520" {...INK} />
      <circle cx="35" cy="10" r="1.6" fill="#3f2610" />
      <circle cx="44" cy="48" r="2" fill="#a0582a" opacity=".45" />
    </g>
  ),
  'treasure-chest': () => (
    <g transform="rotate(4 33 54)">
      <ellipse cx="33" cy="23" rx="23" ry="4" fill="#ffd76a" opacity=".6" />
      <rect x="8" y="24" width="50" height="30" rx="3" fill="#6b3f1d" stroke="#3a210d" strokeWidth="1.5" />
      <path d="M9,33 H57 M9,42 H57" stroke="#4e2c12" strokeWidth="1" />
      <rect x="15" y="24" width="5" height="30" fill={BRASS} />
      <rect x="46" y="24" width="5" height="30" fill={BRASS} />
      <rect x="29" y="26" width="8" height="9" rx="1.5" fill="#e2b54f" stroke="#7a5418" strokeWidth=".8" />
      <circle cx="33" cy="30" r="1.3" fill="#3a210d" />
      <g transform="rotate(-7 8 23)">
        <path d="M8,23 V16 Q8,6 33,5 Q58,6 58,16 V23 Z" fill="#7a4a22" stroke="#3a210d" strokeWidth="1.5" />
        <path d="M15,7.6 V23 H20 V6.6 Z M46,6.6 V23 H51 V7.6 Z" fill={BRASS} />
      </g>
      <path d="M58,30 Q66,22 62,12" stroke={MOSS} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".85" />
      <circle cx="4" cy="52" r="3" fill="#f2c94c" stroke="#b8862b" strokeWidth=".7" />
      <circle cx="10" cy="54" r="3" fill="#f2c94c" stroke="#b8862b" strokeWidth=".7" />
    </g>
  ),
  buoy: () => (
    <g>
      <path d="M24,71 Q31,58 22,48 Q15,40 24,36" stroke={ROPE} strokeWidth="2" fill="none" />
      <rect x="12" y="72" width="24" height="14" rx="1.5" fill="#8a8f86" {...INK} />
      <rect x="12" y="79" width="24" height="7" fill="#000" opacity=".12" />
      <circle cx="24" cy="72" r="2.5" stroke={IRON} strokeWidth="1.5" fill="none" />
      <circle cx="24" cy="20" r="16" fill="#d9483b" {...INK} />
      <path d="M8.4,16 Q24,22 39.6,16 L40,22 Q24,28 8,22 Z" fill="#f2ede2" />
      <ellipse cx="18" cy="11" rx="5" ry="3" fill="#fff" opacity=".35" transform="rotate(-25 18 11)" />
      <circle cx="24" cy="37.5" r="2" stroke={IRON} strokeWidth="1.4" fill="none" />
      <circle cx="33" cy="28" r="1.4" fill="#e8e2d2" stroke="#8a8478" strokeWidth=".5" />
      <circle cx="30" cy="31" r="1.1" fill="#e8e2d2" stroke="#8a8478" strokeWidth=".5" />
    </g>
  ),
  canoe: () => (
    <g transform="rotate(3 72 30)">
      <path d="M2,8 Q72,3 142,4 Q72,13 2,8 Z" fill="#5a2a1a" />
      <path d="M2,8 Q72,14 142,4 Q136,24 112,32 L34,32 Q8,28 2,8 Z" fill="#b5452e" {...INK} />
      <path d="M6,17 Q72,25 138,12" stroke="#8e3320" strokeWidth="1" fill="none" opacity=".75" />
      <path d="M2,8 Q72,14 142,4" stroke="#e8d8b0" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M9,13 L16,14 L11,19 Z M135,9 L128,11 L132,16 Z" fill="#e8d8b0" opacity=".85" />
      <ellipse cx="70" cy="31" rx="14" ry="2.6" fill={MOSS} opacity=".5" />
    </g>
  ),
  'old-boot': () => (
    <g>
      <path d="M21,10 Q15,2 20,-6 M23,10 Q27,4 25,-2" stroke="#2f7a4a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <ellipse cx="20" cy="10" rx="10" ry="3" fill="#2a1d14" />
      <path d="M10,10 L30,10 L31,30 Q46,30 53,40 Q56,44 54,48 L8,48 Q6,28 10,10 Z" fill="#6b4a30" {...INK} />
      <path d="M14,15 L26,21 M26,15 L14,21 M14,23 L26,29 M26,23 L14,29" stroke="#d8cfae" strokeWidth="1.2" />
      <path d="M32,34 Q44,34 50,42" stroke="#3f2a18" strokeWidth="1" strokeDasharray="2 2" fill="none" />
      <path d="M7,48 L36,48 L36,52 L7,52 Z" fill="#2e2620" />
      <path d="M36,47 L55,43 L56,47 L36,52 Z" fill="#2e2620" />
      <path d="M38,47.6 L54,44.6 L55,46 Z" fill="#120d09" />
      <path d="M12,18 Q10,32 12,44" stroke="#8a6444" strokeWidth="2" fill="none" opacity=".45" />
    </g>
  ),
  pagoda: () => (
    <g>
      <rect x="6" y="80" width="52" height="12" fill="#7d8278" {...INK} />
      <rect x="14" y="62" width="36" height="18" fill="#e3d6b4" {...INK} />
      <path d="M15,63 V80 M49,63 V80" stroke="#b8443a" strokeWidth="2.4" />
      <path d="M28,80 V72 Q32,66 36,72 V80 Z" fill="#1d2a2c" />
      <path d="M2,62 Q12,60 16,54 L48,54 Q52,60 62,62 L56,65 L8,65 Z" fill="#b8443a" {...INK} />
      <path d="M8,65 L56,65" stroke="#3f8a72" strokeWidth="1.6" />
      <rect x="19" y="42" width="26" height="12" fill="#e3d6b4" {...INK} />
      <rect x="28" y="45" width="8" height="7" rx="1" fill="#1d2a2c" />
      <path d="M8,43 Q16,41 20,35 L44,35 Q48,41 56,43 L51,45.5 L13,45.5 Z" fill="#b8443a" {...INK} />
      <path d="M13,45.5 L51,45.5" stroke="#3f8a72" strokeWidth="1.4" />
      <rect x="24" y="25" width="16" height="10" fill="#e3d6b4" {...INK} />
      <circle cx="32" cy="30" r="2.4" fill="#1d2a2c" />
      <path d="M14,26 Q20,24 24,18 L40,18 Q44,24 50,26 L46,28 L18,28 Z" fill="#b8443a" {...INK} />
      <path d="M31,18 L32,6 L33,18 Z" fill={BRASS} />
      <circle cx="32" cy="7" r="2" fill="#e2b54f" />
      <ellipse cx="18" cy="82" rx="7" ry="2.2" fill={MOSS} opacity=".55" />
    </g>
  ),
  'stone-arch': () => (
    <g>
      <path
        d="M4,76 L6,34 Q12,2 56,2 Q100,2 106,34 L108,76 Z M30,76 L32,44 Q36,22 56,22 Q76,22 80,44 L82,76 Z"
        fillRule="evenodd" fill="#8d8a7c" {...INK}
      />
      <path d="M32,44 Q36,22 56,22 Q76,22 80,44 L82,76" stroke="#000" strokeOpacity=".2" strokeWidth="4" fill="none" />
      <path d="M86,10 Q104,20 106,40 L108,76 L94,76 Z" fill="#000" opacity=".1" />
      <path
        d="M18,24 L33,33 M36,8 L42,24 M56,2 V22 M76,8 L70,24 M94,24 L79,33 M5,48 H31 M5,61 H31 M81,48 H107 M81,61 H107 M18,48 V61 M94,48 V61 M12,61 V76 M100,61 V76 M24,34 V48 M88,34 V48"
        stroke="#5f5c50" strokeWidth="1.2" fill="none" opacity=".8"
      />
      <path d="M16,14 Q30,2 56,3 Q70,3 82,7" stroke={MOSS} strokeWidth="4.5" fill="none" strokeLinecap="round" opacity=".85" />
      <path d="M30,9 v5 M46,4 v4 M70,5 v6" stroke={MOSS} strokeWidth="2" strokeLinecap="round" opacity=".7" />
    </g>
  ),
  amphora: () => (
    <g transform="rotate(16 25 72)">
      <path d="M19,16 Q7,16 10,30 M31,16 Q43,16 40,30" stroke="#a8522e" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M18,12 L32,12 L31,18 Q46,28 42,48 Q38,64 25,74 Q12,64 8,48 Q4,28 19,18 Z" fill="#c0643a" {...INK} />
      <rect x="15" y="8" width="20" height="5" rx="2" fill="#a8522e" {...INK} />
      <path d="M29,8 L31,11 L33,8 Z" fill="#5a2a14" />
      <path d="M7,36 Q25,42 43,36" stroke="#2b1d14" strokeWidth="4" fill="none" />
      <path d="M10,36.6 l3,2 l3,-1.5 l3,2 l3,-1.5 l3,2 l3,-1.5 l3,2 l3,-1.5 l3,2" stroke="#e8a070" strokeWidth=".8" fill="none" />
      <path d="M9,45 Q25,51 41,45" stroke="#2b1d14" strokeWidth="1.5" fill="none" />
      <path d="M13,28 Q10,42 15,54" stroke="#e8a070" strokeWidth="2" fill="none" opacity=".45" />
      <circle cx="34" cy="56" r="1.6" fill="#e8e2d2" stroke="#8a8478" strokeWidth=".5" />
    </g>
  ),
  'lobster-pot': (uid) => (
    <g>
      <defs>
        <pattern id={`${uid}net`} width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0,0 L6,6 M6,0 L0,6" stroke="#ece4c8" strokeWidth=".6" opacity=".75" />
        </pattern>
      </defs>
      <path d="M60,12 Q66,8 69,6" stroke={ROPE} strokeWidth="1.4" fill="none" />
      <ellipse cx="73" cy="5" rx="5" ry="3.5" fill="#e8743a" {...INK} />
      <path d="M6,52 V30 Q6,8 42,8 Q78,8 78,30 V52 Z" fill="#2c3f44" opacity=".35" />
      <path d="M6,52 V30 Q6,8 42,8 Q78,8 78,30 V52 Z" fill={`url(#${uid}net)`} />
      <ellipse cx="28" cy="38" rx="7" ry="6" fill="#1d2a2c" opacity=".6" stroke="#ece4c8" strokeOpacity=".6" strokeWidth=".8" />
      <path d="M6,52 V30 Q6,8 42,8 Q78,8 78,30 V52 M42,8 V52" stroke="#9a7a4e" strokeWidth="3" fill="none" />
      <path d="M6,41 H78 M6,30 H78 M11,19 Q42,11 73,19" stroke="#9a7a4e" strokeWidth="2.4" fill="none" />
      <rect x="2" y="50" width="80" height="6" rx="1" fill="#9a7a4e" {...INK} />
      <path d="M8,50 Q12,44 10,38" stroke={MOSS} strokeWidth="2.2" fill="none" strokeLinecap="round" opacity=".8" />
    </g>
  ),
  anchor: () => (
    <g transform="rotate(-12 33 84)">
      <path d="M38,8 Q52,12 48,24 Q44,34 56,40" stroke={ROPE} strokeWidth="2" fill="none" />
      <circle cx="33" cy="8" r="5" stroke={IRON} strokeWidth="3" fill="none" />
      <rect x="30" y="12" width="6" height="64" rx="1" fill={IRON} {...INK} />
      <path d="M8,60 Q12,82 33,82 Q54,82 58,60" stroke={IRON} strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M3,64 L8,50 L15,61 Z M63,64 L58,50 L51,61 Z" fill={IRON} {...INK} />
      <rect x="12" y="16" width="42" height="6" rx="2" fill="#7a5232" {...INK} />
      <path d="M18,16 V22 M48,16 V22" stroke="#3e2a18" strokeWidth="1.5" />
      <ellipse cx="33" cy="44" rx="2.6" ry="5" fill="#8a4b2a" opacity=".5" />
      <ellipse cx="46" cy="78" rx="5" ry="2" fill="#8a4b2a" opacity=".5" />
    </g>
  ),
  surfboard: () => (
    <g transform="rotate(9 22 100)">
      <path d="M22,2 Q38,26 35,104 L9,104 Q6,26 22,2 Z" fill="#f2e6c8" {...INK} />
      <path d="M22,5 Q24,50 22,104" stroke="#3aa0c8" strokeWidth="5" fill="none" />
      <path d="M18,10 Q19,50 17,104 M26,10 Q27,50 27,104" stroke="#d94a3a" strokeWidth="1" fill="none" />
      <path d="M35,104 Q38,26 22,2" stroke="#c9b88e" strokeWidth="2" fill="none" />
      <circle cx="22" cy="32" r="4" fill="#e8743a" />
      <circle cx="21" cy="31" r="1.4" fill="#fff" opacity=".6" />
      <circle cx="14" cy="88" r="1.6" fill="#e8e2d2" stroke="#8a8478" strokeWidth=".5" />
      <circle cx="29" cy="84" r="1.3" fill="#e8e2d2" stroke="#8a8478" strokeWidth=".5" />
      <path d="M12,96 Q16,90 15,84" stroke={MOSS} strokeWidth="2" fill="none" strokeLinecap="round" opacity=".7" />
    </g>
  ),
  'ship-wheel': () => {
    const spokes = Array.from({ length: 8 }, (_, k) => ((k * 45 + 22.5) * Math.PI) / 180);
    const at = (a: number, r: number) => `${(37 + Math.cos(a) * r).toFixed(1)},${(44 + Math.sin(a) * r).toFixed(1)}`;
    return (
      <g transform="rotate(-8 37 44)">
        {spokes.map((a, k) => (
          <g key={k}>
            <path d={`M${at(a, 6)} L${at(a, 28)}`} stroke="#7a5232" strokeWidth="3.6" strokeLinecap="round" />
            <path d={`M${at(a, 29)} L${at(a, 35)}`} stroke="#8a5e38" strokeWidth="5.5" strokeLinecap="round" />
          </g>
        ))}
        <circle cx="37" cy="44" r="23" stroke={WOOD} strokeWidth="6" fill="none" />
        <circle cx="37" cy="44" r="23" stroke={WOOD_DARK} strokeWidth="1" fill="none" opacity=".6" />
        <circle cx="37" cy="44" r="20" stroke="#a8743d" strokeWidth="1" fill="none" opacity=".5" />
        <circle cx="37" cy="44" r="8" fill="#7a5232" {...INK} />
        <circle cx="37" cy="44" r="4" fill={BRASS} />
        <ellipse cx="22" cy="28" rx="4" ry="2" fill={MOSS} opacity=".55" transform="rotate(-40 22 28)" />
      </g>
    );
  },
  'giant-clam': () => (
    <g>
      <path d="M8,32 Q8,6 42,4 Q76,6 76,32 Z" fill="#d8cfc0" {...INK} />
      <path d="M42,31 L18,10 M42,31 L30,5.5 M42,31 L54,5.5 M42,31 L66,10" stroke="#b0a690" strokeWidth="1.6" />
      <path
        d="M6,32 Q12,25 18,31 Q24,25 30,31 Q36,25 42,31 Q48,25 54,31 Q60,25 66,31 Q72,25 78,32 L78,38 L6,38 Z"
        fill="#2a9d9a" {...INK}
      />
      <circle cx="20" cy="33" r="1.6" fill="#7b5ba6" />
      <circle cx="34" cy="34" r="1.3" fill="#9fe0d0" />
      <circle cx="60" cy="33" r="1.6" fill="#7b5ba6" />
      <circle cx="70" cy="34" r="1.2" fill="#9fe0d0" />
      <circle cx="46" cy="28" r="3.5" fill="#f6f2ec" stroke="#c8c0b4" strokeWidth=".6" />
      <circle cx="45" cy="27" r="1" fill="#fff" />
      <path
        d="M4,34 Q10,40 16,34 Q22,40 28,34 Q34,40 40,34 Q46,40 52,34 Q58,40 64,34 Q70,40 80,34 Q78,50 42,50 Q6,50 4,34 Z"
        fill="#e8e0d0" {...INK}
      />
      <path d="M16,36 Q18,44 22,50 M28,36 Q30,44 32,50 M52,36 Q52,44 50,50 M64,36 Q62,44 60,50" stroke="#c4b9a4" strokeWidth="1.2" fill="none" />
    </g>
  ),
  cannon: () => (
    <g>
      <circle cx="84" cy="44" r="6" fill="#2f363a" {...INK} />
      <circle cx="97" cy="44" r="6" fill="#2f363a" {...INK} />
      <circle cx="90.5" cy="34" r="6" fill="#2f363a" {...INK} />
      <circle cx="88.5" cy="32" r="1.6" fill="#7d868c" opacity=".6" />
      <path d="M18,48 L22,32 L58,28 L62,48 Z" fill="#7a5232" {...INK} />
      <g transform="translate(6 32) rotate(-12)">
        <path d="M10,-7 L78,-5 L78,5 L10,7 Z" fill={IRON} {...INK} />
        <circle cx="6" cy="0" r="4" fill={IRON} {...INK} />
        <rect x="76" y="-6.5" width="6" height="13" rx="1.5" fill="#4a5257" {...INK} />
        <rect x="28" y="-7.5" width="3" height="15" fill="#4a5257" />
        <rect x="52" y="-6.8" width="3" height="13.6" fill="#4a5257" />
        <path d="M12,-4 L76,-3" stroke="#7d868c" strokeWidth="1.4" opacity=".5" />
        <ellipse cx="42" cy="2" rx="5" ry="2.4" fill="#8a4b2a" opacity=".5" />
      </g>
      <circle cx="26" cy="46" r="8" fill="#6b4528" {...INK} />
      <circle cx="26" cy="46" r="2.5" fill={IRON} />
      <circle cx="54" cy="46" r="8" fill="#6b4528" {...INK} />
      <circle cx="54" cy="46" r="2.5" fill={IRON} />
    </g>
  ),
  'diver-helmet': () => (
    <g>
      <path d="M50,30 Q66,36 60,52 Q56,62 64,72" stroke="#3a3a34" strokeWidth="4" fill="none" />
      <path d="M6,70 Q8,52 20,48 L42,48 Q54,52 56,70 Z" fill="#b88a32" {...INK} />
      <circle cx="12" cy="60" r="1.6" fill="#e2b54f" />
      <circle cx="22" cy="55" r="1.6" fill="#e2b54f" />
      <circle cx="31" cy="54" r="1.6" fill="#e2b54f" />
      <circle cx="40" cy="55" r="1.6" fill="#e2b54f" />
      <circle cx="50" cy="60" r="1.6" fill="#e2b54f" />
      <rect x="27" y="4" width="8" height="5" rx="1" fill="#8f6a24" />
      <circle cx="31" cy="29" r="22" fill={BRASS} {...INK} />
      <path d="M44,12 A22,22 0 0 1 47,45" stroke="#8f6a24" strokeWidth="5" fill="none" opacity=".5" />
      <ellipse cx="21" cy="16" rx="6" ry="3.5" fill="#f2d58a" opacity=".6" transform="rotate(-30 21 16)" />
      <circle cx="12" cy="27" r="4.5" fill="#1f3d47" stroke="#8f6a24" strokeWidth="2" />
      <circle cx="31" cy="31" r="10" fill="#1f3d47" stroke="#8f6a24" strokeWidth="3" />
      <path d="M31,21 V41 M21,31 H41" stroke="#8f6a24" strokeWidth="1.5" />
      <path d="M25,26 Q27,23 30,23" stroke="#9fd6e0" strokeWidth="1.4" fill="none" opacity=".6" />
      <ellipse cx="40" cy="42" rx="4" ry="2.4" fill="#5fae9a" opacity=".5" />
      <ellipse cx="16" cy="40" rx="3" ry="2" fill="#5fae9a" opacity=".45" />
    </g>
  ),
  shipwreck: () => (
    <g>
      <path d="M106,48 L136,6" stroke="#5a3d22" strokeWidth="5" strokeLinecap="round" />
      <path d="M133,9 L137,2 L139,8 L142,4 L140,11 Z" fill="#c49a64" />
      <path d="M116,26 L150,34" stroke="#5a3d22" strokeWidth="3" strokeLinecap="round" />
      <path d="M120,27 L148,34 L144,46 L137,42 L133,50 L127,44 L119,48 Z" fill="#e3d6b4" opacity=".7" {...INK} />
      <path d="M196,30 L209,18" stroke="#5a3d22" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M4,100 L10,86 L4,78 L12,70 L8,62 Q12,54 40,51 L150,47 Q170,45 186,37 L204,26 Q202,52 194,72 L186,100 Z"
        fill="#5a3d22" {...INK}
      />
      <path d="M8,74 Q90,66 197,50 M8,86 Q100,78 192,66" stroke="#3f2a16" strokeWidth="1.2" fill="none" />
      <path d="M10,58 Q60,51 150,47 Q172,45 204,26" stroke="#7a5232" strokeWidth="3" fill="none" />
      <path d="M30,55 V50 M60,52 V47 M90,51 V46 M120,49 V44" stroke="#7a5232" strokeWidth="2" />
      <path d="M12,62 Q60,56 150,51 Q172,49 200,34" stroke="#8a6440" strokeWidth="1.5" fill="none" opacity=".5" />
      <path d="M60,72 L68,66 L74,72 L82,68 L84,80 L74,86 L66,82 Z" fill="#120d09" />
      <circle cx="110" cy="64" r="4" fill="#1d2a2c" stroke={BRASS} strokeWidth="1.5" />
      <circle cx="132" cy="60" r="4" fill="#1d2a2c" stroke={BRASS} strokeWidth="1.5" />
      <circle cx="154" cy="56" r="4" fill="#1d2a2c" stroke={BRASS} strokeWidth="1.5" />
      <path d="M40,54 Q42,62 38,70 M100,50 Q103,58 100,64 M170,44 Q172,52 169,58" stroke={MOSS} strokeWidth="3" fill="none" strokeLinecap="round" opacity=".6" />
    </g>
  ),
  'treasure-map': () => (
    <g>
      <ellipse cx="50" cy="38" rx="17" ry="8" fill="#6b726b" {...INK} />
      <path d="M6,36 L16,15 L60,13 L68,33 Z" fill="#efe2bf" stroke="#a68a52" strokeWidth="1" />
      <path d="M26,24 Q30,20 36,22 Q42,20 44,26 Q40,30 32,29 Q26,30 26,24 Z" fill="#b8a26a" opacity=".7" />
      <path d="M18,32 Q26,28 34,26 Q44,24 50,20" stroke="#b8443a" strokeWidth="1.2" strokeDasharray="2.5 2" fill="none" />
      <path d="M49,17 L55,23 M55,17 L49,23" stroke="#b8443a" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M58,26 L58,32 M55,29 L61,29" stroke="#6b5a3a" strokeWidth=".9" />
      <path d="M6,36 L16,15 M60,13 L68,33" stroke="#d9c48e" strokeWidth="5" strokeLinecap="round" />
      <path d="M7.6,35 L17,16 M61,14.6 L68.6,31.6" stroke="#a68a52" strokeWidth="1" opacity=".6" />
      <ellipse cx="18" cy="32" rx="5" ry="3.5" fill="#8a8f86" {...INK} />
    </g>
  ),
  castle: () => (
    <g>
      <rect x="6" y="36" width="22" height="70" fill="#9a968a" {...INK} />
      <rect x="76" y="36" width="22" height="70" fill="#9a968a" {...INK} />
      <path d="M3,38 L17,8 L31,38 Z M73,38 L87,8 L101,38 Z" fill="#4a6f9a" {...INK} />
      <path d="M17,8 L31,38 L24,38 Z M87,8 L101,38 L94,38 Z" fill="#000" opacity=".15" />
      <path d="M24,48 V38 H31 V43 H37 V38 H44 V43 H50 V38 H57 V43 H63 V38 H70 V43 H76 V38 H80 V48 Z" fill="#a8a498" {...INK} />
      <rect x="26" y="46" width="52" height="60" fill="#a8a498" {...INK} />
      <path d="M40,46 V20 H44 V24 H49 V20 H55 V24 H60 V20 H64 V46 Z" fill="#b2aea2" {...INK} />
      <path d="M52,20 V2" stroke="#4e4a40" strokeWidth="1.2" />
      <path d="M52,3 L64,7 L52,11 Z" fill="#e0b23c" />
      <path d="M42,106 V84 Q52,72 62,84 V106 Z" fill="#14222a" />
      <path d="M47,80 V106 M52,77 V106 M57,80 V106 M43,90 H61 M43,98 H61" stroke="#4e4a40" strokeWidth="1" opacity=".7" />
      <path
        d="M15,56 V50 Q17,47 19,50 V56 Z M85,56 V50 Q87,47 89,50 V56 Z M33,66 V60 Q35,57 37,60 V66 Z M67,66 V60 Q69,57 71,60 V66 Z M50,36 V30 Q52,27 54,30 V36 Z"
        fill="#14222a"
      />
      <path d="M6,72 H28 M6,90 H28 M76,72 H98 M76,90 H98 M26,62 H40 M64,62 H78 M26,78 H40 M64,78 H78" stroke="#7d7a70" strokeWidth="1" opacity=".6" />
      <ellipse cx="14" cy="102" rx="9" ry="3" fill={MOSS} opacity=".6" />
      <ellipse cx="90" cy="100" rx="7" ry="2.6" fill={MOSS} opacity=".55" />
      <path d="M28,40 Q30,46 28,52" stroke={MOSS} strokeWidth="2" fill="none" strokeLinecap="round" opacity=".6" />
    </g>
  ),
};

/** One decor piece as a standalone SVG; `bleed` lets a half-buried piece draw past its foot (under the sand). */
export function DecorSvg({ item, className, bleed = false }: { item: string; className?: string; bleed?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const meta = DECOR_META[item];
  const art = DECOR_ART[item];
  if (!meta || !art) return null;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${meta.w} ${meta.h}`}
      className={className}
      overflow={bleed ? 'visible' : 'hidden'}
      preserveAspectRatio="xMidYMax meet"
    >
      {art(uid)}
    </svg>
  );
}

/** Earned pieces on the sand, behind the fish; a piece being unveiled settles in with a sparkle. */
export function TankDecor({ pieces, settling }: { pieces: DecorPlacement[]; settling: Set<string> }) {
  return (
    <>
      {pieces.map((p) => (
        <div
          key={p.item}
          className={`reef-nightdim pointer-events-none absolute ${settling.has(p.item) ? 'reef-decor-settle' : ''}`}
          style={{ left: p.left, top: p.top, width: p.w, height: p.h }}
          data-reef-decor={p.item}
        >
          <DecorSvg item={p.item} bleed className="block h-full w-full" />
          {settling.has(p.item) && <Sparkles />}
        </div>
      ))}
    </>
  );
}

const SPARKS = [
  { left: '8%', top: '10%', delay: 1.05, size: 12 },
  { left: '78%', top: '0%', delay: 1.25, size: 15 },
  { left: '46%', top: '-18%', delay: 1.45, size: 11 },
  { left: '92%', top: '52%', delay: 1.6, size: 9 },
];

function Sparkles() {
  return (
    <>
      <span className="reef-decor-puff" />
      {SPARKS.map((s, i) => (
        <svg
          key={i}
          aria-hidden
          viewBox="-10 -10 20 20"
          className="reef-decor-spark absolute"
          style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: `${s.delay}s` }}
        >
          <path d="M0,-10 L2,-2 L10,0 L2,2 L0,10 L-2,2 L-10,0 L-2,-2 Z" fill="#fff6c8" />
        </svg>
      ))}
    </>
  );
}

// Backdrops draw in a 1000×400 box pinned to the tank bottom (slice), muted so the water colour still leads.

const FAR_ROCKS = Array.from({ length: 14 }, (_, i) => {
  const ry = 60 + ((i * 53) % 50);
  return { cx: i * 78 - 20 + ((i * 37) % 30), cy: 400 - ry * 0.55, rx: 70 + ((i * 29) % 40), ry };
});
const NEAR_ROCKS = Array.from({ length: 11 }, (_, i) => {
  const ry = 40 + ((i * 31) % 32);
  return { cx: i * 100 + 10 + ((i * 41) % 40), cy: 400 - ry * 0.3, rx: 55 + ((i * 47) % 40), ry };
});

function RiverRock() {
  return (
    <g>
      <g fill="#3f5f68" opacity=".4">
        {FAR_ROCKS.map((r, i) => <ellipse key={i} cx={r.cx} cy={r.cy} rx={r.rx} ry={r.ry} />)}
      </g>
      <g opacity=".75">
        {NEAR_ROCKS.map((r, i) => (
          <g key={i}>
            <ellipse cx={r.cx} cy={r.cy} rx={r.rx} ry={r.ry} fill={i % 3 === 0 ? '#5f6a5c' : '#55625a'} />
            <ellipse cx={r.cx - r.rx * 0.2} cy={r.cy - r.ry * 0.45} rx={r.rx * 0.55} ry={r.ry * 0.3} fill="#7f8c7c" opacity=".45" />
            <path
              d={`M${r.cx - r.rx * 0.7},${r.cy - r.ry * 0.7} Q${r.cx},${r.cy - r.ry * 1.12} ${r.cx + r.rx * 0.6},${r.cy - r.ry * 0.78}`}
              stroke="#4f7a3a" strokeWidth="7" fill="none" strokeLinecap="round" opacity={i % 2 ? 0.55 : 0.35}
            />
          </g>
        ))}
      </g>
    </g>
  );
}

const WALL_TOPS = Array.from({ length: 22 }, (_, i) => 150 + ((i * 53) % 70) + (i % 4 === 0 ? 30 : 0));
const wallTop = (x: number) => WALL_TOPS[Math.max(0, Math.min(WALL_TOPS.length - 1, Math.round(x / 50)))]!;
const WALL_PATH =
  `M0,400 L0,${WALL_TOPS[0]} ` +
  WALL_TOPS.slice(1).map((y, i) => `Q${i * 50 + 25},${Math.min(y, WALL_TOPS[i]!) - 22} ${(i + 1) * 50},${y}`).join(' ') +
  ' L1000,400 Z';
const CORALS = Array.from({ length: 19 }, (_, i) => {
  const x = 26 + i * 52 + ((i * 23) % 18);
  return { x, y: wallTop(x) + 10 + ((i * 17) % 22), kind: (i * 7) % 5, s: 0.8 + ((i * 13) % 6) / 10 };
});
const CORAL_FILL = ['#b97a5e', '#c9604f', '#8a5a9e', '#c99545', '#a88a4a'];

function CoralHead({ x, y, kind, s }: { x: number; y: number; kind: number; s: number }) {
  const fill = CORAL_FILL[kind]!;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {kind === 0 && (
        <>
          <ellipse cx="0" cy="0" rx="22" ry="15" fill={fill} />
          <path d="M-16,-2 q5,-6 10,0 t10,0 t10,0 M-12,6 q5,-6 10,0 t10,0" stroke="#8a5040" strokeWidth="2" fill="none" />
        </>
      )}
      {kind === 1 && (
        <path d="M0,12 C-4,-4 -14,-10 -18,-26 M0,12 C2,-8 8,-14 6,-34 M0,12 C4,0 14,-6 20,-18 M-9,-9 L-16,-12 M5,-18 L12,-22" stroke={fill} strokeWidth="5" fill="none" strokeLinecap="round" />
      )}
      {kind === 2 && (
        <>
          <path d="M0,12 Q-34,-6 -24,-36 Q0,-50 24,-36 Q34,-6 0,12 Z" fill={fill} opacity=".75" />
          <path d="M0,12 L-20,-30 M0,12 L-8,-40 M0,12 L8,-40 M0,12 L20,-30 M-24,-18 Q0,-26 24,-18" stroke="#5e3a70" strokeWidth="1.5" fill="none" />
        </>
      )}
      {kind === 3 && (
        <>
          <rect x="-16" y="-28" width="10" height="40" rx="5" fill={fill} />
          <rect x="-4" y="-38" width="11" height="50" rx="5.5" fill={fill} />
          <rect x="9" y="-20" width="9" height="32" rx="4.5" fill={fill} />
          <ellipse cx="-11" cy="-26" rx="3" ry="1.6" fill="#5a3a18" />
          <ellipse cx="1.5" cy="-36" rx="3.4" ry="1.8" fill="#5a3a18" />
          <ellipse cx="13.5" cy="-18" rx="2.8" ry="1.5" fill="#5a3a18" />
        </>
      )}
      {kind === 4 && (
        <>
          <ellipse cx="0" cy="4" rx="26" ry="6" fill={fill} />
          <ellipse cx="-4" cy="-6" rx="20" ry="5" fill={fill} />
          <ellipse cx="2" cy="-15" rx="14" ry="4" fill={fill} />
        </>
      )}
    </g>
  );
}

function CoralWall() {
  return (
    <g>
      <path d={WALL_PATH} fill="#2f4a58" opacity=".55" />
      <path d={WALL_PATH} transform="translate(30 70)" fill="#3b5866" opacity=".45" />
      <g opacity=".6">
        {CORALS.map((c, i) => <CoralHead key={i} {...c} />)}
      </g>
    </g>
  );
}

const KELP = Array.from({ length: 26 }, (_, i) => {
  const near = i % 5 < 2;
  return {
    x: 18 + i * 38 + ((i * 29) % 22),
    top: (near ? 30 : 70) + ((i * 41) % 60),
    lean: (((i * 17) % 9) - 4) * 6,
    near,
    delay: -((i * 1.7) % 7),
  };
});

function kelpPoint(k: (typeof KELP)[number], t: number): [number, number] {
  return [k.x + k.lean * t + Math.sin(t * Math.PI * 2) * 10, 400 - (400 - k.top) * t];
}

function KelpForest() {
  const strand = (k: (typeof KELP)[number], i: number) => {
    const [mx, my] = kelpPoint(k, 0.5);
    const [tx, ty] = kelpPoint(k, 1);
    const blades = Array.from({ length: Math.floor((400 - k.top) / (k.near ? 30 : 40)) }, (_, j) => {
      const t = (j + 1) / ((400 - k.top) / (k.near ? 30 : 40) + 1);
      const [bx, by] = kelpPoint(k, t);
      return { bx, by, side: j % 2 ? 1 : -1 };
    });
    return (
      <g key={i} className="reef-kelp-sway" style={{ animationDelay: `${k.delay}s` }}>
        <path d={`M${k.x},400 Q${mx * 2 - (k.x + tx) / 2},${my} ${tx},${ty}`} stroke={k.near ? '#6b6428' : '#355e55'} strokeWidth={k.near ? 5 : 3} fill="none" />
        {blades.map((b, j) => (
          <g key={j} transform={`translate(${b.bx} ${b.by}) rotate(${b.side * -32})`}>
            <ellipse cx={b.side * 14} cy="0" rx="15" ry={k.near ? 4.5 : 3} fill={k.near ? (j % 3 ? '#7d7a2e' : '#8a7a2e') : '#3f6a5a'} />
            {k.near && <circle cx={b.side * 1.5} cy="0" r="2.8" fill="#a08a2c" />}
          </g>
        ))}
      </g>
    );
  };
  return (
    <g>
      <g opacity=".35">{KELP.filter((k) => !k.near).map(strand)}</g>
      <g opacity=".62">{KELP.filter((k) => k.near).map(strand)}</g>
    </g>
  );
}

export const BACKDROP_ART: Record<string, () => ReactNode> = {
  'river-rock': () => <RiverRock />,
  'coral-wall': () => <CoralWall />,
  'kelp-forest': () => <KelpForest />,
};

function BackdropSvg({ item, className }: { item: string; className?: string }) {
  const art = BACKDROP_ART[item];
  if (!art) return null;
  return (
    <svg aria-hidden viewBox="0 0 1000 400" preserveAspectRatio="xMidYMax slice" className={className}>
      {art()}
    </svg>
  );
}

const FADE_MS = 2000;

/** Behind everything; switching cross-fades over ~2s (instant with reduced motion). Open water draws nothing. */
export function TankBackdrop({ active, reduced }: { active: string | null; reduced: boolean }) {
  const [layers, setLayers] = useState<BackdropLayer[]>([]);
  const next = backdropLayers(layers, active);
  if (next !== layers) setLayers(next);
  useEffect(() => {
    if (layers.length < 2) return;
    const t = window.setTimeout(() => setLayers((cur) => cur.slice(-1)), reduced ? 0 : FADE_MS);
    return () => window.clearTimeout(t);
  }, [layers, reduced]);
  return (
    <>
      {layers.map((l, i) =>
        l.item === OPEN_WATER ? null : (
          <BackdropSvg
            key={l.id}
            item={l.item}
            className={`reef-backdrop ${i < layers.length - 1 ? 'reef-backdrop-out' : l.fresh ? 'reef-backdrop-in' : ''}`}
          />
        ),
      )}
    </>
  );
}

/** Small swatch of a backdrop over the day water, for the unveiling banner. */
export function BackdropThumb({ item, className }: { item: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-md bg-gradient-to-b from-[#0ea5b7] to-[#085b7a] ${className ?? ''}`}>
      <BackdropSvg item={item} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
