"use client";

/* ============================================================================
   CH.06 - SPIDER DIARY: DRAWN OBJECTS
   ----------------------------------------------------------------------------
   Everything physical in Chapter 6 lives here so DiaryScreen.tsx can stay about
   data and layout. Same split as Chapter 5 (LetterJarArt.tsx / LetterJarScreen).

   Nothing in this file animates and nothing in it uses a CSS or SVG filter. The
   whole chapter's motion budget is spent on transform and opacity, per the
   performance rules the rest of the app already follows.
   ========================================================================== */

/* -------------------------------------------------------------------------
   Deterministic noise. Every scrap of "handmade" wobble in this chapter (a
   clipping's tilt, a torn edge, a city block's width) is derived from a seed
   rather than Math.random, so a re-render never reshuffles the board under the
   reader's cursor.
   ------------------------------------------------------------------------- */

export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable 0..1 from a seed plus a channel, so one id can drive many values. */
export function seeded(seed: number, channel: number): number {
  let t = (seed + channel * 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Picks a value from a list using the seed. */
export function seededPick<T>(seed: number, channel: number, list: readonly T[]): T {
  return list[Math.floor(seeded(seed, channel) * list.length) % list.length];
}

/* -------------------------------------------------------------------------
   Torn paper edges.

   A clipping is torn, not cut, so its top and bottom run as a jagged polygon
   instead of a straight line. This is a clip-path rather than a filter or a
   background image: it costs one composited clip and it survives any card
   height. The jaggedness is seeded so a given entry always tears the same way.
   ------------------------------------------------------------------------- */

export function tornClipPath(seed: number, teeth = 20): string {
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= teeth; i += 1) {
    const x = (i / teeth) * 100;
    const t = seeded(seed, i + 1);
    const b = seeded(seed, i + 101);
    top.push(x.toFixed(2) + "% " + (t * 1.7).toFixed(2) + "%");
    bottom.push(x.toFixed(2) + "% " + (100 - b * 1.7).toFixed(2) + "%");
  }
  return "polygon(" + top.join(", ") + ", " + bottom.reverse().join(", ") + ")";
}

/* -------------------------------------------------------------------------
   THE TYPEWRITER

   Front-on, sitting on the desk with the platen at the top so a sheet of paper
   can appear to be rolling out of it. Two parts of the drawing are addressable
   from the outside:

     .dy-tw-roller  turns a few degrees as the reader scrolls the sheet
     .dy-tw-bars    kicks once per keystroke

   Both are driven by writing a CSS custom property onto the machine's own DOM
   node from a ref, never through React state. A component that re-renders on
   every keypress is the one thing this screen cannot afford.
   ------------------------------------------------------------------------- */

const KEY_ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "+"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "{", "}"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", ":", '"'],
  ["Z", "X", "C", "V", "B", "N", "M", ",", ".", "?"],
];

const TYPE_FACE = "'Courier New', Courier, monospace";

export function Typewriter({ className = "" }: { className?: string }) {
  const keyR = 11.5;
  const rowY = [116, 141, 166, 191];
  const rowInset = [0, 7, 14, 21];

  return (
    <svg
      viewBox="0 0 420 240"
      className={className}
      aria-hidden
      focusable="false"
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <linearGradient id="dy-tw-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9E1B2B" />
          <stop offset="0.42" stopColor="#7D1220" />
          <stop offset="1" stopColor="#4A0912" />
        </linearGradient>
        <linearGradient id="dy-tw-deck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B02334" />
          <stop offset="1" stopColor="#7A101E" />
        </linearGradient>
        <linearGradient id="dy-tw-platen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FBF7F0" />
          <stop offset="0.5" stopColor="#DCD3C4" />
          <stop offset="1" stopColor="#A79C8B" />
        </linearGradient>
        <linearGradient id="dy-tw-key" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFDF9" />
          <stop offset="1" stopColor="#D5CEC2" />
        </linearGradient>
      </defs>

      {/* carriage rail and the platen the sheet is wound around */}
      <g className="dy-tw-roller">
        <rect x="52" y="30" width="316" height="9" rx="4.5" fill="#2A2126" />
        <rect
          x="46"
          y="38"
          width="328"
          height="30"
          rx="15"
          fill="url(#dy-tw-platen)"
          stroke="#3A2F28"
          strokeWidth="2.5"
        />
        {/* the ribbing of the rubber roller, which is what appears to turn */}
        {Array.from({ length: 26 }).map((_, i) => (
          <line
            key={i}
            x1={58 + i * 12}
            y1="41"
            x2={58 + i * 12}
            y2="65"
            stroke="#8E8474"
            strokeWidth="1"
            opacity="0.45"
          />
        ))}
        <circle cx="40" cy="53" r="16" fill="#EFE9DE" stroke="#3A2F28" strokeWidth="2.5" />
        <circle cx="380" cy="53" r="16" fill="#EFE9DE" stroke="#3A2F28" strokeWidth="2.5" />
        <circle cx="40" cy="53" r="5" fill="#8E8474" />
        <circle cx="380" cy="53" r="5" fill="#8E8474" />
      </g>

      {/* paper-guide fingers clamping the sheet against the platen */}
      <rect x="96" y="60" width="34" height="9" rx="3" fill="#2A2126" />
      <rect x="290" y="60" width="34" height="9" rx="3" fill="#2A2126" />

      {/* the shell */}
      <path
        d="M34 74 H386 a16 16 0 0 1 16 16 v34 a10 10 0 0 1 -6 9 l-12 5 v70 a12 12 0 0 1 -12 12 H44 a12 12 0 0 1 -12 -12 v-70 l-12 -5 a10 10 0 0 1 -6 -9 V90 a16 16 0 0 1 16 -16 Z"
        fill="url(#dy-tw-shell)"
        stroke="#280509"
        strokeWidth="3"
        strokeLinejoin="round"
      />

      {/* the type basket, and the bars that kick on a keystroke */}
      <path d="M150 78 H270 L286 104 H134 Z" fill="#15080B" stroke="#280509" strokeWidth="2" />
      <g className="dy-tw-bars">
        {Array.from({ length: 13 }).map((_, i) => (
          <line
            key={i}
            x1={210 + (i - 6) * 3.4}
            y1="102"
            x2={210 + (i - 6) * 11}
            y2="80"
            stroke="#6E6258"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        ))}
      </g>
      {/* the inked ribbon stretched across the basket */}
      <rect x="146" y="86" width="128" height="5" rx="2.5" fill="#B3202F" />
      <circle cx="140" cy="88" r="9" fill="#2A2126" stroke="#120406" strokeWidth="2" />
      <circle cx="280" cy="88" r="9" fill="#2A2126" stroke="#120406" strokeWidth="2" />

      {/* deck, then the keys */}
      <rect
        x="30"
        y="104"
        width="360"
        height="106"
        rx="10"
        fill="url(#dy-tw-deck)"
        stroke="#280509"
        strokeWidth="2.5"
      />
      <rect x="42" y="110" width="336" height="94" rx="8" fill="#1A0C10" opacity="0.55" />

      {KEY_ROWS.map((row, ri) =>
        row.map((label, ki) => {
          const cx = 62 + rowInset[ri] + ki * 27;
          return (
            <g key={ri + "-" + ki}>
              <circle cx={cx} cy={rowY[ri] + 2.5} r={keyR} fill="#0E0507" opacity="0.7" />
              <circle
                cx={cx}
                cy={rowY[ri]}
                r={keyR}
                fill="url(#dy-tw-key)"
                stroke="#6E655A"
                strokeWidth="1.2"
              />
              <text
                x={cx}
                y={rowY[ri] + 3.6}
                textAnchor="middle"
                fontSize="9.5"
                fontFamily={TYPE_FACE}
                fontWeight="700"
                fill="#2A2126"
              >
                {label}
              </text>
            </g>
          );
        })
      )}

      {/* space bar, carriage-return lever, feet */}
      <rect x="120" y="206" width="180" height="17" rx="6" fill="#F4EFE6" stroke="#6E655A" strokeWidth="1.6" />
      <path
        d="M14 96 h-9 a7 7 0 0 0 -7 7 v10 a7 7 0 0 0 7 7 h9"
        fill="none"
        stroke="#241016"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <rect x="52" y="222" width="40" height="10" rx="5" fill="#170A0D" />
      <rect x="328" y="222" width="40" height="10" rx="5" fill="#170A0D" />
    </svg>
  );
}

/* -------------------------------------------------------------------------
   THE PATROL MAP

   A stylised borough, not a real one. Real map tiles would be a network
   dependency, an attribution obligation and completely off-theme; a detective's
   wall map is the thing the brief actually asks for.

   The geometry is generated once at module scope from a fixed seed, so the city
   is identical on every render and every reload but is not a regular grid.
   ------------------------------------------------------------------------- */

export const MAP_W = 1000;
export const MAP_H = 680;

type Block = { x: number; y: number; w: number; h: number; tone: number; rot: number };

/** The river's centreline. Blocks are kept clear of it. */
function riverCentreAt(y: number): number {
  return 300 + Math.sin((y / MAP_H) * 2.35 + 0.6) * 210 + (y / MAP_H) * 250;
}

const CITY_BLOCKS: Block[] = (() => {
  const blocks: Block[] = [];
  let n = 0;
  for (let gy = 44; gy < MAP_H - 70; gy += 46) {
    for (let gx = 40; gx < MAP_W - 60; gx += 54) {
      n += 1;
      const x = gx + seeded(9137, n) * 10;
      const y = gy + seeded(9137, n + 500) * 8;
      const w = 30 + seeded(9137, n + 1000) * 18;
      const h = 24 + seeded(9137, n + 1500) * 14;
      // carve out the river channel and the park
      const bank = riverCentreAt(y + h / 2);
      if (x + w > bank - 46 && x < bank + 46) continue;
      if (x > 96 && x + w < 268 && y > 380 && y + h < 566) continue;
      blocks.push({
        x,
        y,
        w,
        h,
        tone: seeded(9137, n + 2000),
        rot: (seeded(9137, n + 2500) - 0.5) * 2.2,
      });
    }
  }
  return blocks;
})();

const RIVER_PATH = (() => {
  const left: string[] = [];
  const right: string[] = [];
  for (let y = -20; y <= MAP_H + 20; y += 34) {
    const c = riverCentreAt(y);
    const width = 40 + Math.sin(y / 120) * 9;
    left.push((c - width).toFixed(1) + " " + y);
    right.push((c + width).toFixed(1) + " " + y);
  }
  return "M " + left.join(" L ") + " L " + right.reverse().join(" L ") + " Z";
})();

export function PatrolMap({ className = "" }: { className?: string }) {
  const bridgeY = 250;
  const bridgeC = riverCentreAt(bridgeY);

  return (
    <svg
      viewBox={"0 0 " + MAP_W + " " + MAP_H}
      className={className}
      aria-hidden
      focusable="false"
      preserveAspectRatio="none"
    >
      <defs>
        <pattern
          id="dy-map-hatch"
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(35)"
        >
          <line x1="0" y1="0" x2="0" y2="7" stroke="#3E5B5C" strokeWidth="0.9" opacity="0.5" />
        </pattern>
        <pattern id="dy-map-grain" width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="4" r="0.8" fill="#7A6A55" opacity="0.30" />
          <circle cx="17" cy="12" r="0.7" fill="#7A6A55" opacity="0.24" />
          <circle cx="9" cy="20" r="0.6" fill="#7A6A55" opacity="0.20" />
        </pattern>
      </defs>

      <rect width={MAP_W} height={MAP_H} fill="#E4DAC4" />
      <rect width={MAP_W} height={MAP_H} fill="url(#dy-map-grain)" />

      {/* avenues, under the blocks so the blocks read as sitting on them */}
      {[70, 168, 266, 364, 462, 560, 658].map((y) => (
        <line key={"av-" + y} x1="0" y1={y} x2={MAP_W} y2={y} stroke="#C4B597" strokeWidth="9" />
      ))}
      {[92, 200, 308, 470, 604, 736, 868].map((x) => (
        <line key={"st-" + x} x1={x} y1="0" x2={x} y2={MAP_H} stroke="#C4B597" strokeWidth="7" />
      ))}

      {/* the park */}
      <rect x="96" y="380" width="172" height="186" fill="#9FB08A" stroke="#6F7F5E" strokeWidth="2" />
      <ellipse cx="182" cy="470" rx="42" ry="26" fill="#7FA0A6" stroke="#4E6B72" strokeWidth="1.8" />
      {Array.from({ length: 16 }).map((_, i) => (
        <circle
          key={"tree-" + i}
          cx={108 + seeded(551, i) * 148}
          cy={392 + seeded(551, i + 90) * 162}
          r={4 + seeded(551, i + 180) * 3}
          fill="#6F7F5E"
          opacity="0.85"
        />
      ))}

      {/* city blocks */}
      {CITY_BLOCKS.map((b, i) => (
        <rect
          key={"b-" + i}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx="1.5"
          fill={b.tone > 0.72 ? "#CDBB9A" : b.tone > 0.4 ? "#D8C8A9" : "#C3B190"}
          stroke="#8B7A5E"
          strokeWidth="1.1"
          transform={
            "rotate(" + b.rot + " " + (b.x + b.w / 2) + " " + (b.y + b.h / 2) + ")"
          }
        />
      ))}

      {/* the river, over the grid, so the city reads as cut by it */}
      <path d={RIVER_PATH} fill="#7FA0A6" stroke="#4E6B72" strokeWidth="2.4" />
      <path d={RIVER_PATH} fill="url(#dy-map-hatch)" />

      {/* the bridge, with towers and cables */}
      <g>
        <line x1={bridgeC - 72} y1={bridgeY} x2={bridgeC + 72} y2={bridgeY} stroke="#2E2A28" strokeWidth="7" />
        <line
          x1={bridgeC - 72}
          y1={bridgeY}
          x2={bridgeC + 72}
          y2={bridgeY}
          stroke="#E4DAC4"
          strokeWidth="2"
          strokeDasharray="7 6"
        />
        {[-38, 38].map((dx) => (
          <g key={dx}>
            <line
              x1={bridgeC + dx}
              y1={bridgeY - 34}
              x2={bridgeC + dx}
              y2={bridgeY + 12}
              stroke="#2E2A28"
              strokeWidth="5"
            />
            <path
              d={
                "M " + (bridgeC + dx - 34) + " " + (bridgeY - 2) +
                " Q " + (bridgeC + dx) + " " + (bridgeY - 30) +
                " " + (bridgeC + dx + 34) + " " + (bridgeY - 2)
              }
              fill="none"
              stroke="#2E2A28"
              strokeWidth="2"
            />
          </g>
        ))}
      </g>

      {/* docks */}
      {[120, 400, 596].map((y, i) => (
        <rect key={"dock-" + i} x={riverCentreAt(y) - 62} y={y} width="24" height="7" fill="#8B7A5E" />
      ))}

      {/* compass rose */}
      <g transform="translate(908 92)">
        <circle r="34" fill="#EFE7D3" stroke="#7A2130" strokeWidth="2" />
        <path d="M0 -28 L7 0 L0 28 L-7 0 Z" fill="#7A2130" />
        <path d="M-28 0 L0 -7 L28 0 L0 7 Z" fill="#2E2A28" opacity="0.65" />
        <text
          y="-38"
          textAnchor="middle"
          fontSize="13"
          fontFamily={TYPE_FACE}
          fontWeight="700"
          fill="#2E2A28"
        >
          N
        </text>
      </g>

      {/* district labels, set like a printed map */}
      {[
        { x: 172, y: 120, t: "MIDTOWN" },
        { x: 182, y: 606, t: "THE PARKSIDE" },
        { x: 700, y: 130, t: "QUEENSWAY" },
        { x: 762, y: 470, t: "RIVER YARDS" },
        { x: 430, y: 622, t: "OLD DOCKS" },
      ].map((l) => (
        <text
          key={l.t}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          fontSize="15"
          letterSpacing="3.4"
          fontFamily={TYPE_FACE}
          fontWeight="700"
          fill="#6B5B44"
          opacity="0.8"
        >
          {l.t}
        </text>
      ))}

      {/* a drawn border so the map reads as a printed sheet, not a viewport */}
      <rect x="8" y="8" width={MAP_W - 16} height={MAP_H - 16} fill="none" stroke="#6B5B44" strokeWidth="3" />
      <rect x="16" y="16" width={MAP_W - 32} height={MAP_H - 32} fill="none" stroke="#6B5B44" strokeWidth="1" />
    </svg>
  );
}

/* -------------------------------------------------------------------------
   MARKERS AND FASTENERS

   The pins that geotag a log on the map, and the pin and tape that hold a
   clipping to the board. All are drawn at a fixed small size and never animate
   on their own; the card they sit on carries the motion.

   Every marker wears the thick white sticker outline the chapter uses to lift
   interactive graphics off the background.
   ------------------------------------------------------------------------- */

export type PinStyle = "spider" | "tack" | "web" | "mask";

export const PIN_STYLES: { id: PinStyle; label: string }[] = [
  { id: "spider", label: "Spider emblem" },
  { id: "tack", label: "Red map tack" },
  { id: "web", label: "Web node" },
  { id: "mask", label: "Mask marker" },
];

export function MapPin({ style, size = 34 }: { style: PinStyle; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 40 40",
    "aria-hidden": true,
    focusable: "false" as const,
  };

  if (style === "tack") {
    return (
      <svg {...common}>
        {/* the classic pushed-in map tack, seen slightly from above */}
        <ellipse cx="20" cy="33" rx="6" ry="2.4" fill="#170A0D" opacity="0.45" />
        <path d="M20 33 L21.4 19 H18.6 Z" fill="#8E8474" stroke="#2A2126" strokeWidth="1" />
        <circle cx="20" cy="14" r="11" fill="#B3202F" stroke="#FDF8F0" strokeWidth="3" />
        <circle cx="20" cy="14" r="11" fill="none" stroke="#2A0509" strokeWidth="1.2" />
        <circle cx="16.4" cy="10.4" r="3.2" fill="#FF7A86" opacity="0.75" />
      </svg>
    );
  }

  if (style === "web") {
    return (
      <svg {...common}>
        <circle cx="20" cy="20" r="14" fill="#2E0509" stroke="#FDF8F0" strokeWidth="3" />
        <g stroke="#ECA8B8" strokeWidth="1.3" fill="none">
          {[0, 45, 90, 135].map((a) => (
            <line
              key={a}
              x1={20 - 11 * Math.cos((a * Math.PI) / 180)}
              y1={20 - 11 * Math.sin((a * Math.PI) / 180)}
              x2={20 + 11 * Math.cos((a * Math.PI) / 180)}
              y2={20 + 11 * Math.sin((a * Math.PI) / 180)}
            />
          ))}
          <circle cx="20" cy="20" r="4.5" />
          <circle cx="20" cy="20" r="8.5" />
        </g>
      </svg>
    );
  }

  if (style === "mask") {
    return (
      <svg {...common}>
        <ellipse cx="20" cy="34" rx="6" ry="2.2" fill="#170A0D" opacity="0.4" />
        <path
          d="M20 5 C29 5 34 11 34 18 C34 26 27 33 20 33 C13 33 6 26 6 18 C6 11 11 5 20 5 Z"
          fill="#B3202F"
          stroke="#FDF8F0"
          strokeWidth="3"
        />
        <path d="M13 15 C15.5 12.5 18 12.5 18.6 15.5 C17 19 13.6 19.5 12.4 17.4 Z" fill="#FDF8F0" />
        <path d="M27 15 C24.5 12.5 22 12.5 21.4 15.5 C23 19 26.4 19.5 27.6 17.4 Z" fill="#FDF8F0" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <ellipse cx="20" cy="34" rx="6" ry="2.2" fill="#170A0D" opacity="0.4" />
      <circle cx="20" cy="19" r="13" fill="#2E0509" stroke="#FDF8F0" strokeWidth="3" />
      <ellipse cx="20" cy="19" rx="3.4" ry="4.6" fill="#ECA8B8" />
      <g stroke="#ECA8B8" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M20 15 L12 8 M20 15 L28 8 M20 18 L9 14 M20 18 L31 14" />
        <path d="M20 21 L9 25 M20 21 L31 25 M20 23 L12 30 M20 23 L28 30" />
      </g>
    </svg>
  );
}

/** The red push pin that holds a clipping to the board. */
export function PushPin({ size = 26, tilt = 0 }: { size?: number; tilt?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      focusable="false"
      style={{ transform: "rotate(" + tilt + "deg)" }}
    >
      <path d="M16 30 L17.2 17 H14.8 Z" fill="#8E8474" stroke="#2A2126" strokeWidth="0.9" />
      <circle cx="16" cy="12" r="9.5" fill="#B3202F" stroke="#2A0509" strokeWidth="1.6" />
      <path d="M9.5 8.5 A9.5 9.5 0 0 1 16 2.5" fill="none" stroke="#FF8A94" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------
   THE BUGLE MASTHEAD
   Used on the newspaper-clipping card style and on the case-file overlay.
   ------------------------------------------------------------------------- */

export function BugleMasthead({ edition }: { edition: string }) {
  return (
    <div className="dy-masthead">
      <span className="dy-masthead-name">DAILY BUGLE</span>
      <span className="dy-masthead-mark" aria-hidden>
        <svg width="15" height="15" viewBox="0 0 20 20" focusable="false">
          <circle cx="10" cy="10" r="9" fill="#B3202F" />
          <ellipse cx="10" cy="10" rx="2.4" ry="3.2" fill="#FDF8F0" />
          <g stroke="#FDF8F0" strokeWidth="1.1" strokeLinecap="round">
            <path d="M10 7 L5 3 M10 7 L15 3 M10 10 L3 7 M10 10 L17 7" />
            <path d="M10 12 L3 15 M10 12 L17 15 M10 13 L6 18 M10 13 L14 18" />
          </g>
        </svg>
      </span>
      <span className="dy-masthead-edition">{edition}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------
   HALFTONE COMIC PANEL

   Stands in for a photo on polaroid and newspaper cards when an entry has no
   media of its own. It is a drawn comic panel rather than a grey placeholder
   box, so an entry without a picture still looks like a page of the book.
   ------------------------------------------------------------------------- */

export function ComicPanel({ seed, label }: { seed: number; label: string }) {
  const variant = Math.floor(seeded(seed, 7) * 3);
  return (
    <div className={"dy-panel dy-panel-" + variant}>
      <span className="dy-panel-city" aria-hidden />
      <span className="dy-panel-burst" aria-hidden />
      <span className="dy-panel-label">{label}</span>
    </div>
  );
}
