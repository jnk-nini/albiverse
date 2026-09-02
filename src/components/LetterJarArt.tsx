"use client";

import { memo } from "react";

/* ============================================================================
   CH.05 - LOVE LETTER JAR: MATERIALS AND DRAWN OBJECTS

   Everything in this file is the chapter's art department. It holds the
   material tables (what a paper, an edge, a ribbon, a wax actually look like)
   and the drawn objects that dress the desk. `LetterJarScreen.tsx` keeps the
   data and the interaction; nothing here talks to Supabase or holds state.

   Nothing here loads an image file either, so there is no asset to 404. The
   paper grain is a data-URI turbulence pattern rendered once by the browser,
   and the torn and scorched edges are one shared SVG filter applied only to
   static elements, never to anything that animates.
   ========================================================================= */

/* ------------------------------------------------------------- materials --- */

export interface Paper {
  id: string;
  label: string;
  chip: string;
  ink: string;
  edge: string;
  /* the sheet: cloud, wash and stain layers stacked into one background */
  base: string;
  /* the rolled-up version of the same stock, used by the scroll glyph */
  roll: { base: string; light: string; dark: string; edge: string };
}

export const PAPERS: Paper[] = [
  {
    id: "parchment",
    label: "PARCHMENT",
    chip: "#EFDFBE",
    ink: "#4A3524",
    edge: "#C2A06C",
    base:
      "radial-gradient(ellipse 60% 40% at 18% 12%, rgba(176,132,72,.20), transparent 70%)," +
      "radial-gradient(ellipse 55% 45% at 84% 82%, rgba(146,104,58,.22), transparent 72%)," +
      "radial-gradient(ellipse 40% 30% at 62% 34%, rgba(214,186,132,.35), transparent 70%)," +
      "linear-gradient(168deg, #F9F0DA 0%, #F2E5C6 44%, #E7D5B0 100%)",
    roll: { base: "#F2E5C6", light: "#FBF4E4", dark: "#C9AE7E", edge: "#A9884F" },
  },
  {
    id: "kraft",
    label: "KRAFT",
    chip: "#CDAF83",
    ink: "#3A2716",
    edge: "#96794B",
    base:
      "radial-gradient(ellipse 50% 40% at 26% 22%, rgba(90,58,28,.14), transparent 72%)," +
      "radial-gradient(ellipse 45% 35% at 78% 74%, rgba(60,36,16,.16), transparent 70%)," +
      "linear-gradient(172deg, #DFC9A2 0%, #CFB489 50%, #BFA277 100%)",
    roll: { base: "#CFB489", light: "#E6D3B0", dark: "#9B7F52", edge: "#7A6039" },
  },
  {
    id: "mulberry",
    label: "MULBERRY",
    chip: "#F0E8D6",
    ink: "#403222",
    edge: "#C9B694",
    base:
      "repeating-linear-gradient(64deg, rgba(150,124,84,.10) 0 1px, transparent 1px 9px)," +
      "repeating-linear-gradient(-52deg, rgba(150,124,84,.08) 0 1px, transparent 1px 13px)," +
      "radial-gradient(ellipse 60% 40% at 70% 20%, rgba(255,255,255,.5), transparent 70%)," +
      "linear-gradient(160deg, #F6EFE0 0%, #EDE2CC 100%)",
    roll: { base: "#EDE2CC", light: "#FBF6EA", dark: "#C6B491", edge: "#A08C66" },
  },
  {
    id: "linen",
    label: "LINEN",
    chip: "#F3EDE1",
    ink: "#33302B",
    edge: "#C4BAA8",
    base:
      "repeating-linear-gradient(90deg, rgba(120,110,92,.07) 0 1px, transparent 1px 4px)," +
      "repeating-linear-gradient(0deg, rgba(120,110,92,.07) 0 1px, transparent 1px 4px)," +
      "linear-gradient(165deg, #F8F3E9 0%, #EFE7D8 100%)",
    roll: { base: "#EFE7D8", light: "#FBF7EF", dark: "#C8BEAB", edge: "#A79C87" },
  },
  {
    id: "vellum",
    label: "VELLUM",
    chip: "#FBF6E9",
    ink: "#3B3128",
    edge: "#D6C9AC",
    base:
      "radial-gradient(ellipse 70% 50% at 40% 26%, rgba(255,255,255,.75), transparent 76%)," +
      "linear-gradient(158deg, #FCF8EE 0%, #F4EDDC 100%)",
    roll: { base: "#F7F1E2", light: "#FFFCF6", dark: "#D3C7AC", edge: "#B4A588" },
  },
  {
    id: "ruled",
    label: "RULED",
    chip: "#FAF6EE",
    ink: "#23304A",
    edge: "#BCC4D1",
    base:
      "linear-gradient(to right, transparent 44px, rgba(150,30,45,.30) 44px, rgba(150,30,45,.30) 45px, transparent 45px)," +
      "repeating-linear-gradient(transparent 0 27px, rgba(60,80,120,.20) 27px 28px)," +
      "linear-gradient(#FCF9F2, #F4EEE2)",
    roll: { base: "#F6F0E4", light: "#FDFBF5", dark: "#CFC7B6", edge: "#ADA491" },
  },
  {
    id: "grid",
    label: "GRID",
    chip: "#FAF5EB",
    ink: "#2C2130",
    edge: "#D2B9C0",
    base:
      "linear-gradient(to right, rgba(217,136,158,.24) 1px, transparent 1px) 0 0/19px 19px," +
      "linear-gradient(to bottom, rgba(217,136,158,.24) 1px, transparent 1px) 0 0/19px 19px," +
      "linear-gradient(#FCF7ED, #F4ECDF)",
    roll: { base: "#F6EFE2", light: "#FDFAF3", dark: "#D2C6B4", edge: "#B3A692" },
  },
  {
    id: "music",
    label: "MUSIC SHEET",
    chip: "#EFE5D3",
    ink: "#2E0509",
    edge: "#BCA985",
    base:
      "repeating-linear-gradient(transparent 0 11px, rgba(60,24,32,.22) 12px 13px)," +
      "radial-gradient(ellipse 60% 40% at 30% 80%, rgba(140,96,52,.16), transparent 72%)," +
      "linear-gradient(#F3EADA, #E7DBC2)",
    roll: { base: "#EBE0C8", light: "#F7F0E1", dark: "#C4B594", edge: "#A2916E" },
  },
  {
    id: "rose",
    label: "ROSE",
    chip: "#EED0D5",
    ink: "#5A2029",
    edge: "#CB98A1",
    base:
      "radial-gradient(ellipse 60% 45% at 74% 16%, rgba(255,255,255,.62), transparent 70%)," +
      "radial-gradient(ellipse 50% 40% at 18% 84%, rgba(180,86,108,.18), transparent 72%)," +
      "linear-gradient(164deg, #F7DEE2 0%, #EAC4CB 100%)",
    roll: { base: "#EFCDD3", light: "#FAE7EA", dark: "#C79AA3", edge: "#A87984" },
  },
  {
    id: "sage",
    label: "SAGE",
    chip: "#D8E0D2",
    ink: "#2C3A2C",
    edge: "#9FB098",
    base:
      "radial-gradient(ellipse 60% 45% at 70% 20%, rgba(255,255,255,.55), transparent 72%)," +
      "linear-gradient(162deg, #E6EDDF 0%, #D2DDCA 100%)",
    roll: { base: "#DCE5D4", light: "#F0F4EC", dark: "#AEBBA6", edge: "#8C9C84" },
  },
  {
    id: "newsprint",
    label: "NEWSPRINT",
    chip: "#E3DFD2",
    ink: "#1A1A1A",
    edge: "#A9A493",
    base:
      "radial-gradient(rgba(30,30,30,.15) 1.1px, transparent 1.2px) 0 0/6px 6px," +
      "linear-gradient(#EAE6DA, #DBD5C4)",
    roll: { base: "#E2DDCE", light: "#F0EDE3", dark: "#B6AF9C", edge: "#948C79" },
  },
  {
    id: "indigo",
    label: "INDIGO",
    chip: "#2B3550",
    ink: "#E8DFC8",
    edge: "#4C5A7C",
    base:
      "radial-gradient(ellipse 55% 45% at 24% 20%, rgba(120,150,210,.22), transparent 72%)," +
      "radial-gradient(ellipse 50% 40% at 80% 80%, rgba(40,58,100,.5), transparent 70%)," +
      "linear-gradient(160deg, #35405E 0%, #232C44 100%)",
    roll: { base: "#2E3950", light: "#485573", dark: "#1A2133", edge: "#151B29" },
  },
  {
    id: "midnight",
    label: "MIDNIGHT",
    chip: "#241A2C",
    ink: "#F0E2C8",
    edge: "#4C3A55",
    base:
      "radial-gradient(ellipse 55% 45% at 26% 22%, rgba(217,136,158,.24), transparent 70%)," +
      "radial-gradient(ellipse 50% 40% at 78% 80%, rgba(120,20,32,.30), transparent 70%)," +
      "linear-gradient(160deg, #2E2136 0%, #1A1420 100%)",
    roll: { base: "#2A1F32", light: "#43334F", dark: "#170F1D", edge: "#0F0A14" },
  },
  {
    id: "ember",
    label: "EMBER",
    chip: "#E9C7A0",
    ink: "#4A1D12",
    edge: "#B07C50",
    base:
      "radial-gradient(ellipse 60% 45% at 30% 78%, rgba(190,96,40,.26), transparent 72%)," +
      "radial-gradient(ellipse 50% 40% at 76% 18%, rgba(255,222,180,.55), transparent 70%)," +
      "linear-gradient(166deg, #F6DDBE 0%, #E7C094 100%)",
    roll: { base: "#EDCCA2", light: "#F9E6CD", dark: "#C09765", edge: "#9C7745" },
  },
];

export interface EdgeStyle {
  id: string;
  label: string;
  hint: string;
}

export const PAPER_EDGES: EdgeStyle[] = [
  { id: "deckle", label: "DECKLE", hint: "soft handmade tear" },
  { id: "burnt", label: "BURNT", hint: "scorched all the way round" },
  { id: "torn", label: "TORN", hint: "ripped out in a hurry" },
  { id: "clean", label: "TRIMMED", hint: "cut straight" },
];

export const PATINAS: EdgeStyle[] = [
  { id: "crisp", label: "CRISP", hint: "brand new" },
  { id: "aged", label: "AGED", hint: "yellowed and foxed" },
  { id: "coffee", label: "COFFEE", hint: "rings and splashes" },
  { id: "inked", label: "INK SPATTER", hint: "a pen that misbehaved" },
];

export const RIBBON_STYLES: EdgeStyle[] = [
  { id: "satin", label: "SATIN", hint: "glossy, with a sheen" },
  { id: "twine", label: "TWINE", hint: "rough garden string" },
  { id: "velvet", label: "VELVET", hint: "deep and matte" },
  { id: "lace", label: "LACE", hint: "scalloped trim" },
];

export const WAX_SHAPES: EdgeStyle[] = [
  { id: "round", label: "ROUND", hint: "pressed evenly" },
  { id: "blob", label: "SPILLED", hint: "poured a bit fast" },
  { id: "oval", label: "OVAL", hint: "an old signet" },
  { id: "drip", label: "DRIPPING", hint: "still running" },
];

export interface SprigDef {
  id: string;
  label: string;
  stem: string;
  bloom: string;
  kind: "cluster" | "spike" | "frond" | "bud";
}

export const SPRIGS: SprigDef[] = [
  { id: "none", label: "NOTHING", stem: "", bloom: "", kind: "cluster" },
  { id: "babysbreath", label: "BABY'S BREATH", stem: "#8E9A72", bloom: "#F6F0E2", kind: "cluster" },
  { id: "lavender", label: "LAVENDER", stem: "#7C8A63", bloom: "#9B84C4", kind: "spike" },
  { id: "rosebud", label: "DRIED ROSE", stem: "#7A7350", bloom: "#A63E52", kind: "bud" },
  { id: "fern", label: "FERN", stem: "#6E7F58", bloom: "#8CA06E", kind: "frond" },
  { id: "wheat", label: "WHEAT", stem: "#A8894F", bloom: "#D7B570", kind: "spike" },
];

export const INKS = [
  "#3A2A22", "#1F2A44", "#6E1220", "#2F4536",
  "#4A2350", "#7A3E12", "#141018", "#0F3A46",
  "#7D2834", "#2B3550", "#5C4A1F", "#F0E2C8",
];

export const RIBBONS = [
  "#B34B63", "#7D2834", "#C5A467", "#EFE3CC",
  "#8FAEAA", "#6E4B7A", "#2F3E5B", "#2A2126",
  "#D9889E", "#A8823A", "#6E7F58", "#450A10",
];

export const WAXES = [
  "#8B121E", "#450A10", "#B4566C", "#A8823A",
  "#5C3468", "#25313F", "#2F4536", "#7A3E12",
  "#D9889E", "#1B1420",
];

export const FONTS = [
  { id: "handwriting", label: "HANDWRITTEN", cls: "font-handwriting", size: "text-[25px] leading-[1.42]" },
  { id: "marker", label: "MARKER", cls: "font-marker", size: "text-[18px] leading-[1.65]" },
  { id: "mono", label: "TYPEWRITER", cls: "font-mono", size: "text-[13px] leading-[1.9]" },
] as const;

export const TAPES = [
  { id: "none", label: "NO TAPE", css: "" },
  { id: "pink", label: "PINK", css: "tape-pink-solid" },
  { id: "red", label: "CRIMSON", css: "tape-red-solid" },
  { id: "gold", label: "GOLD", css: "tape-gold-solid" },
  { id: "dotted", label: "DOTTED", css: "lj-tape-dotted" },
  { id: "lace", label: "LACE", css: "lj-tape-lace" },
  { id: "striped", label: "STRIPED", css: "lj-tape-striped" },
  { id: "kraft", label: "KRAFT", css: "lj-tape-kraft" },
] as const;

export const STAMPS = [
  { id: "none", label: "NO STAMP", tag: "", tone: "", glyph: "" },
  { id: "gwen", label: "EARTH-65", tag: "EARTH-65", tone: "#B4566C", glyph: "web" },
  { id: "peter", label: "EARTH-616", tag: "EARTH-616", tone: "#7D2834", glyph: "spider" },
  { id: "heart", label: "SEALED", tag: "SEALED WITH LOVE", tone: "#A8446A", glyph: "heart" },
  { id: "web", label: "AIR MAIL", tag: "WEB AIR MAIL", tone: "#5E7C78", glyph: "web" },
  { id: "canon", label: "CANON EVENT", tag: "CANON EVENT", tone: "#8A6A2C", glyph: "star" },
  { id: "moon", label: "NIGHT POST", tag: "NIGHT POST", tone: "#4C5A7C", glyph: "moon" },
  { id: "bloom", label: "FLOWER POST", tag: "FLOWER POST", tone: "#6E7F58", glyph: "bloom" },
] as const;

export const STICKER_PALETTE = [
  "🕷️", "🕸️", "💗", "🤍", "🌷", "🌾", "🌙", "⭐",
  "✨", "📌", "🎀", "🧵", "🫧", "🍓", "☕", "🎧",
  "🪩", "💌", "🔥", "🐝", "🍯", "🌈", "💫", "🖤",
  "🌻", "🍂", "🕯️", "📎", "🪡", "🫀", "🧿", "🎬",
  "🍰", "🥀", "📻", "🗝️", "🪞", "🧺", "🌊", "☁️",
];

export const OCCASION_PRESETS = [
  "open when you miss me",
  "open when you need a smile",
  "open when you can't sleep",
  "open when you're proud of yourself",
  "open on a bad day",
  "open on our anniversary",
  "open when you need a push",
  "open when I'm far away",
  "open when the city is loud",
  "open when you forget",
];

/* ------------------------------------------------------------- lookups --- */

export const paperOf = (id: string) => PAPERS.find((p) => p.id === id) ?? PAPERS[0];
export const fontOf = (id: string) => FONTS.find((f) => f.id === id) ?? FONTS[0];
export const tapeOf = (id: string) => TAPES.find((t) => t.id === id) ?? TAPES[0];
export const stampOf = (id: string) => STAMPS.find((s) => s.id === id) ?? STAMPS[0];
export const sprigOf = (id: string) => SPRIGS.find((s) => s.id === id) ?? SPRIGS[0];
export const edgeOf = (id: string) => PAPER_EDGES.find((e) => e.id === id) ?? PAPER_EDGES[0];
export const patinaOf = (id: string) => PATINAS.find((p) => p.id === id) ?? PATINAS[1];
export const ribbonStyleOf = (id: string) =>
  RIBBON_STYLES.find((r) => r.id === id) ?? RIBBON_STYLES[0];
export const waxShapeOf = (id: string) => WAX_SHAPES.find((w) => w.id === id) ?? WAX_SHAPES[0];

/* ====================================================== shared svg defs === */
/* Rendered once at the top of the chapter. Every gradient here is deliberately
   colour-agnostic (white and black at low alpha) so the same three gradients
   can shade a scroll of any paper stock without needing an id per letter. */

export function LetterJarDefs() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" style={{ position: "absolute" }}>
      <defs>
        {/* the roll read as a cylinder: lit along the top, shadowed underneath */}
        <linearGradient id="lj-cyl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.62" />
          <stop offset="22%" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="52%" stopColor="#000" stopOpacity="0" />
          <stop offset="82%" stopColor="#000" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.36" />
        </linearGradient>

        {/* a satin sheen that runs across the ribbon */}
        <linearGradient id="lj-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="34%" stopColor="#fff" stopOpacity="0.52" />
          <stop offset="56%" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.28" />
        </linearGradient>

        {/* wax catches the light at the top left and pools dark at the rim */}
        <radialGradient id="lj-waxlight" cx="0.34" cy="0.30" r="0.78">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="42%" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>

        <radialGradient id="lj-glasslight" cx="0.3" cy="0.18" r="0.9">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.34" />
          <stop offset="45%" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.14" />
        </radialGradient>

        {/* one displacement filter, reused by every torn and scorched edge */}
        <filter id="lj-rough" x="-12%" y="-12%" width="124%" height="124%">
          <feTurbulence type="fractalNoise" baseFrequency="0.019 0.052" numOctaves="3" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="8" xChannelSelector="R" yChannelSelector="G" />
        </filter>

        <filter id="lj-scorch" x="-16%" y="-16%" width="132%" height="132%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03 0.07" numOctaves="4" seed="19" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="G" />
        </filter>

        {/* punched perforations, so a stamp is a real stamp shape */}
        <mask id="lj-perf" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="120">
          <rect x="4" y="4" width="92" height="112" fill="#fff" rx="2" />
          {Array.from({ length: 8 }).map((_, i) => (
            <g key={"x" + i}>
              <circle cx={4 + i * 13.2} cy="4" r="4.2" fill="#000" />
              <circle cx={4 + i * 13.2} cy="116" r="4.2" fill="#000" />
            </g>
          ))}
          {Array.from({ length: 9 }).map((_, i) => (
            <g key={"y" + i}>
              <circle cx="4" cy={4 + i * 14} r="4.2" fill="#000" />
              <circle cx="96" cy={4 + i * 14} r="4.2" fill="#000" />
            </g>
          ))}
        </mask>
      </defs>
    </svg>
  );
}

/* ======================================================== the rolled letter */

interface ScrollGlyphProps {
  paperId: string;
  ribbon: string;
  ribbonStyle: string;
  wax: string;
  waxShape: string;
  sprig: string;
  sealed: boolean;
  className?: string;
}

/* One rolled-up letter, drawn rather than stacked out of divs: the paper has a
   deckled top and bottom edge, the ends show the spiral of the roll with the
   outermost turn lifting away, and the tie is a real knot with two tails. The
   viewBox is 220x64, and every caller keeps that aspect so nothing stretches. */
function ScrollGlyphBase({
  paperId,
  ribbon,
  ribbonStyle,
  wax,
  waxShape,
  sprig,
  sealed,
  className,
}: ScrollGlyphProps) {
  const roll = paperOf(paperId).roll;
  const sp = sprigOf(sprig);

  return (
    <svg
      viewBox="0 0 220 64"
      preserveAspectRatio="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      {/* the shadow it casts on whatever it is lying on */}
      <ellipse cx="112" cy="56" rx="92" ry="6.5" fill="#000" opacity="0.30" />

      {/* the body of the roll, with a hand-torn top and bottom edge */}
      <path
        d="M20 15 C 60 11, 96 17, 132 13 C 162 10, 186 16, 200 14
           L200 50 C 184 52, 160 47, 130 51 C 98 55, 62 49, 20 52 Z"
        fill={roll.base}
      />
      <path
        d="M20 15 C 60 11, 96 17, 132 13 C 162 10, 186 16, 200 14
           L200 50 C 184 52, 160 47, 130 51 C 98 55, 62 49, 20 52 Z"
        fill="url(#lj-cyl)"
      />

      {/* paper fibres running the length of the roll */}
      <g stroke={roll.dark} strokeWidth="0.8" opacity="0.26" fill="none">
        <path d="M26 24 C 70 21, 130 27, 196 23" />
        <path d="M26 33 C 78 36, 128 30, 196 34" />
        <path d="M26 42 C 66 39, 138 45, 196 41" />
      </g>

      {/* left end: the spiral of the roll, outermost turn lifting off */}
      <g>
        <ellipse cx="20" cy="33.5" rx="9" ry="19" fill={roll.dark} />
        <ellipse cx="20" cy="33.5" rx="9" ry="19" fill="url(#lj-cyl)" opacity="0.7" />
        <ellipse cx="20.5" cy="33.5" rx="6" ry="13.2" fill="none" stroke={roll.edge} strokeWidth="1.1" opacity="0.85" />
        <ellipse cx="21" cy="33.5" rx="3.4" ry="7.6" fill="none" stroke={roll.edge} strokeWidth="1" opacity="0.7" />
        <ellipse cx="21.4" cy="33.5" rx="1.4" ry="3" fill={roll.light} opacity="0.55" />
        <path d="M20 14.6 C 12 15, 8 21, 10 27" fill="none" stroke={roll.edge} strokeWidth="1.4" strokeLinecap="round" />
      </g>

      {/* right end */}
      <g>
        <ellipse cx="200" cy="32" rx="8.6" ry="18.6" fill={roll.dark} />
        <ellipse cx="200" cy="32" rx="8.6" ry="18.6" fill="url(#lj-cyl)" opacity="0.7" />
        <ellipse cx="199.6" cy="32" rx="5.7" ry="12.8" fill="none" stroke={roll.edge} strokeWidth="1.1" opacity="0.85" />
        <ellipse cx="199.2" cy="32" rx="3.2" ry="7.2" fill="none" stroke={roll.edge} strokeWidth="1" opacity="0.7" />
        <ellipse cx="198.8" cy="32" rx="1.3" ry="2.8" fill={roll.light} opacity="0.55" />
        <path d="M200 13.6 C 208 14, 212 20, 210 26" fill="none" stroke={roll.edge} strokeWidth="1.4" strokeLinecap="round" />
      </g>

      {/* a dried stem tucked under the tie */}
      {sp.id !== "none" && <SprigMark def={sp} x={96} y={30} />}

      {/* the tie: a band round the middle, a knot, and two tails */}
      <g>
        <path
          d="M96 12 C 100 24, 100 40, 96 53 L118 53 C 114 40, 114 24, 118 12 Z"
          fill={ribbon}
        />
        {ribbonStyle === "satin" && (
          <path d="M96 12 C 100 24, 100 40, 96 53 L118 53 C 114 40, 114 24, 118 12 Z" fill="url(#lj-sheen)" />
        )}
        {ribbonStyle === "twine" && (
          <g stroke="#000" strokeOpacity="0.28" strokeWidth="1.6">
            <path d="M95 16 L119 22" />
            <path d="M95 24 L119 30" />
            <path d="M95 32 L119 38" />
            <path d="M95 40 L119 46" />
          </g>
        )}
        {ribbonStyle === "velvet" && (
          <path
            d="M96 12 C 100 24, 100 40, 96 53 L118 53 C 114 40, 114 24, 118 12 Z"
            fill="#000"
            opacity="0.22"
          />
        )}
        {ribbonStyle === "lace" && (
          <g fill="#fff" opacity="0.55">
            <circle cx="101" cy="19" r="1.7" />
            <circle cx="112" cy="25" r="1.7" />
            <circle cx="101" cy="33" r="1.7" />
            <circle cx="112" cy="41" r="1.7" />
            <circle cx="101" cy="47" r="1.7" />
          </g>
        )}

        {/* the knot, and the two loose ends hanging off it */}
        <path
          d="M118 28 C 132 22, 142 26, 150 18 C 146 30, 140 33, 132 34 C 140 38, 146 44, 148 52 C 138 46, 128 40, 118 38 Z"
          fill={ribbon}
        />
        <path
          d="M118 28 C 132 22, 142 26, 150 18 C 146 30, 140 33, 132 34 C 140 38, 146 44, 148 52 C 138 46, 128 40, 118 38 Z"
          fill="#000"
          opacity="0.16"
        />
        <ellipse cx="117" cy="33" rx="6.5" ry="6" fill={ribbon} />
        <ellipse cx="117" cy="33" rx="6.5" ry="6" fill="url(#lj-waxlight)" opacity="0.45" />
      </g>

      {/* the wax, only while the letter has not been broken open */}
      {sealed && <WaxMark shape={waxShape} color={wax} cx={117} cy={33} r={9.4} />}
    </svg>
  );
}

/* The jar renders every letter the couple has ever written as its own live
   SVG node (see LetterJarScreen's `visible.map`) - memoized so dragging
   through the pile (which re-renders that whole list on every animation
   frame, see setDigClamped) doesn't also re-diff every unchanged scroll. */
export const ScrollGlyph = memo(ScrollGlyphBase);

/* ------------------------------------------------------------------ wax --- */

export function WaxMark({
  shape,
  color,
  cx,
  cy,
  r,
}: {
  shape: string;
  color: string;
  cx: number;
  cy: number;
  r: number;
}) {
  const body =
    shape === "oval" ? (
      <ellipse cx={cx} cy={cy} rx={r * 1.18} ry={r * 0.82} />
    ) : shape === "blob" ? (
      <path
        d={`M${cx - r} ${cy - r * 0.3}
            C ${cx - r * 1.1} ${cy - r} , ${cx - r * 0.2} ${cy - r * 1.25}, ${cx + r * 0.35} ${cy - r * 0.95}
            C ${cx + r * 1.15} ${cy - r * 0.7}, ${cx + r * 1.2} ${cy + r * 0.35}, ${cx + r * 0.55} ${cy + r * 0.85}
            C ${cx - r * 0.1} ${cy + r * 1.3}, ${cx - r * 0.95} ${cy + r * 0.7}, ${cx - r} ${cy - r * 0.3} Z`}
      />
    ) : (
      <circle cx={cx} cy={cy} r={r} />
    );

  return (
    <g>
      {shape === "drip" && (
        <g fill={color}>
          <path d={`M${cx - 2} ${cy + r * 0.6} q2 ${r * 1.5} 4 0 z`} />
          <circle cx={cx + 1} cy={cy + r * 1.7} r={r * 0.28} />
        </g>
      )}
      <g fill={color}>{body}</g>
      <g fill="url(#lj-waxlight)">{body}</g>
      <g fill="none" stroke="#000" strokeOpacity="0.45" strokeWidth="0.9">
        {body}
      </g>
    </g>
  );
}

/* ---------------------------------------------------------------- sprig --- */

export function SprigMark({ def, x, y }: { def: SprigDef; x: number; y: number }) {
  if (def.id === "none") return null;

  if (def.kind === "spike") {
    return (
      <g transform={`translate(${x} ${y}) rotate(-24)`}>
        <path d="M0 0 L34 -4" stroke={def.stem} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        {Array.from({ length: 7 }).map((_, i) => (
          <ellipse
            key={i}
            cx={16 + i * 3}
            cy={-2.4 - i * 0.4 + (i % 2 ? 2.4 : -2.4)}
            rx="2.1"
            ry="1.5"
            fill={def.bloom}
            opacity={0.9}
          />
        ))}
      </g>
    );
  }

  if (def.kind === "frond") {
    return (
      <g transform={`translate(${x} ${y}) rotate(-18)`}>
        <path d="M0 0 C 14 -6, 26 -8, 36 -6" stroke={def.stem} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        {Array.from({ length: 8 }).map((_, i) => (
          <path
            key={i}
            d={`M${8 + i * 3.6} ${-2 - i * 0.5} l${i % 2 ? 3 : -3} ${i % 2 ? -4.5 : 4.5}`}
            stroke={def.bloom}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        ))}
      </g>
    );
  }

  if (def.kind === "bud") {
    return (
      <g transform={`translate(${x} ${y}) rotate(-20)`}>
        <path d="M0 0 L28 -5" stroke={def.stem} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path
          d="M28 -5 c 5 -5, 11 -3, 10 3 c -1 6, -8 8, -11 4 z"
          fill={def.bloom}
        />
        <path d="M30 -3 c 3 -3, 6 -2, 6 1" stroke="#000" strokeOpacity="0.25" strokeWidth="0.8" fill="none" />
        <path d="M14 -2 l-3 5" stroke={def.stem} strokeWidth="1.2" strokeLinecap="round" />
      </g>
    );
  }

  return (
    <g transform={`translate(${x} ${y}) rotate(-22)`}>
      <path d="M0 0 C 12 -4, 22 -9, 32 -8" stroke={def.stem} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M14 -5 l 5 -7 M22 -8 l 3 -8 M8 -3 l -2 -7" stroke={def.stem} strokeWidth="1" strokeLinecap="round" />
      {[
        [19, -13], [25, -17], [6, -11], [32, -9], [13, -6], [28, -12], [10, -14],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={i % 3 === 0 ? 2.4 : 1.7} fill={def.bloom} opacity="0.95" />
      ))}
    </g>
  );
}

/* ---------------------------------------------------------------- stamp --- */

const STAMP_GLYPHS: Record<string, React.ReactNode> = {
  web: (
    <g stroke="currentColor" strokeWidth="2.4" fill="none" opacity="0.85">
      {[16, 28, 40].map((r) => (
        <path key={r} d={`M50 ${52 - r} A ${r} ${r} 0 0 1 ${50 + r} 52 A ${r} ${r} 0 0 1 50 ${52 + r}`} />
      ))}
      <path d="M50 8 L50 96 M6 52 L94 52 M19 21 L81 83 M81 21 L19 83" />
    </g>
  ),
  spider: (
    <g stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round">
      <ellipse cx="50" cy="54" rx="13" ry="17" fill="currentColor" stroke="none" />
      <circle cx="50" cy="33" r="8" fill="currentColor" stroke="none" />
      <path d="M37 42 L14 26 M37 52 L10 48 M37 62 L14 76 M37 70 L22 90" />
      <path d="M63 42 L86 26 M63 52 L90 48 M63 62 L86 76 M63 70 L78 90" />
    </g>
  ),
  heart: (
    <path
      d="M50 88 C 8 60, 12 24, 34 24 C 44 24, 50 32, 50 38 C 50 32, 56 24, 66 24 C 88 24, 92 60, 50 88 Z"
      fill="currentColor"
    />
  ),
  star: (
    <path
      d="M50 12 L61 40 L92 43 L68 62 L76 92 L50 75 L24 92 L32 62 L8 43 L39 40 Z"
      fill="currentColor"
    />
  ),
  moon: (
    <path
      d="M64 14 A 40 40 0 1 0 64 90 A 32 32 0 1 1 64 14 Z"
      fill="currentColor"
    />
  ),
  bloom: (
    <g fill="currentColor">
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <ellipse key={a} cx="50" cy="30" rx="10" ry="18" transform={`rotate(${a} 50 52)`} opacity="0.85" />
      ))}
      <circle cx="50" cy="52" r="8" />
    </g>
  ),
};

export function StampMark({ id, className }: { id: string; className?: string }) {
  const stamp = stampOf(id);
  if (!stamp.tag) return null;

  return (
    <svg viewBox="0 0 100 120" className={className} aria-hidden focusable="false" style={{ color: stamp.tone }}>
      <g mask="url(#lj-perf)">
        <rect x="4" y="4" width="92" height="112" fill="#FDF9F0" />
        <rect x="4" y="4" width="92" height="112" fill="currentColor" opacity="0.10" />
        <rect x="10" y="10" width="80" height="100" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.5" />
        <g transform="translate(0 -6) scale(0.66) translate(26 18)">{STAMP_GLYPHS[stamp.glyph]}</g>
        <text
          x="50"
          y="106"
          textAnchor="middle"
          fill="currentColor"
          fontSize="9.5"
          fontFamily="'Space Grotesk', monospace"
          fontWeight="700"
          letterSpacing="0.6"
        >
          {stamp.tag.length > 13 ? stamp.tag.slice(0, 13) : stamp.tag}
        </text>
      </g>
      {/* the postmark, struck slightly off-centre the way a real one is */}
      <g opacity="0.42" stroke="#2A1B20" strokeWidth="1.6" fill="none" transform="rotate(-13 62 34)">
        <circle cx="62" cy="34" r="21" />
        <circle cx="62" cy="34" r="15" />
        <path d="M41 28 L83 28 M41 40 L83 40" />
      </g>
    </svg>
  );
}

/* ================================================= the jar's own furniture = */

/* Cork, seen slightly from above: the top face is a flattened ellipse and the
   body below it is the band you actually see through the glass. */
export function CorkLid({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 78" className={className} aria-hidden focusable="false" preserveAspectRatio="none">
      <defs>
        <linearGradient id="lj-corkbody" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8A6134" />
          <stop offset="18%" stopColor="#C79A62" />
          <stop offset="46%" stopColor="#DDB77E" />
          <stop offset="74%" stopColor="#B98B51" />
          <stop offset="100%" stopColor="#7E5730" />
        </linearGradient>
      </defs>
      <path d="M10 22 L210 22 L202 70 Q110 80 18 70 Z" fill="url(#lj-corkbody)" />
      <ellipse cx="110" cy="22" rx="100" ry="17" fill="#D3A96F" />
      <ellipse cx="110" cy="20" rx="100" ry="17" fill="#E2BC85" />
      <ellipse cx="110" cy="20" rx="86" ry="12.5" fill="#C99A5E" opacity="0.55" />
      {/* cork speckle */}
      <g fill="#7A5326" opacity="0.42">
        {[
          [64, 17, 2.4], [92, 24, 1.7], [128, 15, 2.1], [156, 23, 1.5], [110, 27, 1.9],
          [78, 28, 1.3], [142, 29, 1.6], [46, 24, 1.4], [172, 17, 1.8], [104, 12, 1.5],
          [58, 48, 2.2], [88, 58, 1.6], [126, 52, 2], [160, 60, 1.5], [104, 44, 1.7],
          [36, 40, 1.5], [186, 44, 1.6], [72, 66, 1.4], [148, 40, 1.3], [116, 66, 1.5],
        ].map(([cx, cy, r], i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={r} ry={r * 0.7} />
        ))}
      </g>
      <path d="M10 22 L210 22" stroke="#5F3F1D" strokeWidth="2" opacity="0.5" />
      <path d="M18 70 Q110 80 202 70" stroke="#4E3317" strokeWidth="2.5" fill="none" opacity="0.6" />
      <ellipse cx="76" cy="18" rx="26" ry="7" fill="#fff" opacity="0.20" />
    </svg>
  );
}

/* Twine wrapped twice round the neck, finished in a bow with two loops and two
   tails, drawn the way the reference jar is tied. */
export function TwineBow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 58" className={className} aria-hidden focusable="false">
      {/* two wraps round the neck */}
      <g stroke="#B99B6E" strokeWidth="4.5" fill="none" strokeLinecap="round">
        <path d="M4 16 Q130 25 256 16" />
        <path d="M4 25 Q130 34 256 25" />
      </g>
      <g stroke="#8E7248" strokeWidth="1.2" fill="none" opacity="0.6">
        <path d="M4 14 Q130 23 256 14" strokeDasharray="3 5" />
        <path d="M4 27 Q130 36 256 27" strokeDasharray="3 5" />
      </g>

      {/* the two loops */}
      <path d="M126 27 C 102 12, 74 16, 77 30 C 80 44, 110 38, 126 31 Z"
        fill="#C7A672" stroke="#8E7248" strokeWidth="1.5" />
      <path d="M134 27 C 158 12, 186 16, 183 30 C 180 44, 150 38, 134 31 Z"
        fill="#C7A672" stroke="#8E7248" strokeWidth="1.5" />
      <path d="M126 27 C 112 23, 92 24, 84 30" stroke="#8E7248" strokeWidth="1" fill="none" opacity="0.7" />
      <path d="M134 27 C 148 23, 168 24, 176 30" stroke="#8E7248" strokeWidth="1" fill="none" opacity="0.7" />

      {/* the loose ends */}
      <path d="M125 33 C 118 42, 110 48, 100 54" stroke="#B99B6E" strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <path d="M136 33 C 143 43, 149 49, 160 56" stroke="#B99B6E" strokeWidth="3.6" fill="none" strokeLinecap="round" />

      {/* the knot */}
      <ellipse cx="130" cy="29" rx="9" ry="7" fill="#D2B180" stroke="#8E7248" strokeWidth="1.6" />
      <path d="M124 27 Q130 32 136 27" stroke="#8E7248" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

/* The scalloped kraft tag with the little wooden heart, straight off the
   reference jar, hanging from the twine on its own length of string. */
export function HeartTag({ className }: { className?: string }) {
  const scallop = Array.from({ length: 22 }).map((_, i) => {
    const a = (i / 22) * Math.PI * 2;
    const r = 30;
    return `${44 + Math.cos(a) * r} ${46 + Math.sin(a) * r}`;
  });

  return (
    <svg viewBox="0 0 88 108" className={className} aria-hidden focusable="false">
      <path d="M44 0 L44 14" stroke="#B99B6E" strokeWidth="2" />
      <circle cx="44" cy="46" r="33" fill="#C6A272" />
      <polygon points={scallop.join(" ")} fill="#D2B183" />
      <circle cx="44" cy="46" r="26" fill="none" stroke="#9C7B4C" strokeWidth="1" opacity="0.55" />
      <circle cx="44" cy="22" r="3.4" fill="#8A6B40" />
      <path
        d="M44 62 C 26 48, 28 34, 37 34 C 41 34, 44 38, 44 41 C 44 38, 47 34, 51 34 C 60 34, 62 48, 44 62 Z"
        fill="#C99A5E"
        stroke="#8A6B40"
        strokeWidth="1.4"
      />
      <path d="M38 40 C 38 37, 40 36, 42 37" stroke="#F0DCBC" strokeWidth="1.2" fill="none" opacity="0.8" />
    </svg>
  );
}

/* The paper label pasted on the glass, with a genuinely ragged edge. */
export function JarLabel({
  title,
  line,
  className,
}: {
  title: string;
  line: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="lj-label-sheet">
        <span className="lj-label-rule" />
        <span className="font-marker text-[15px] leading-none block">{title}</span>
        <span className="font-mono text-[8px] tracking-[.16em] mt-1 block opacity-75">{line}</span>
        <span className="lj-label-rule" />
      </span>
    </div>
  );
}

/* ==================================================== objects on the desk == */

/* A bunch of dried stems leaning against something, as in the reference photos.
   `lean` tips the whole bunch so it can rest on the jar or the board. */
export function DriedBunch({
  className,
  lean = -12,
  tone = "#CBC3A8",
  stem = "#8B8A63",
  count = 13,
}: {
  className?: string;
  lean?: number;
  tone?: string;
  stem?: string;
  count?: number;
}) {
  return (
    <svg viewBox="0 0 160 220" className={className} aria-hidden focusable="false">
      <g transform={`rotate(${lean} 80 210)`}>
        {Array.from({ length: count }).map((_, i) => {
          const spread = (i - (count - 1) / 2) * 9;
          const top = 40 + (i % 3) * 22;
          return (
            <g key={i}>
              <path
                d={`M80 212 C ${80 + spread * 0.5} 150, ${80 + spread} 100, ${80 + spread * 1.5} ${top}`}
                stroke={stem}
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                opacity="0.9"
              />
              {Array.from({ length: 7 }).map((__, j) => {
                const t = 0.34 + j * 0.11;
                const x = 80 + spread * (0.5 + t);
                const y = 212 - (212 - top) * t;
                return (
                  <g key={j}>
                    <circle cx={x} cy={y} r={2.6} fill={tone} opacity="0.95" />
                    <circle cx={x + 5} cy={y - 6} r={1.9} fill={tone} opacity="0.8" />
                    <circle cx={x - 5} cy={y - 3} r={1.7} fill={tone} opacity="0.7" />
                  </g>
                );
              })}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/* A kraft envelope lying on the board with a broken wax seal. */
export function WaxEnvelope({ className, wax = "#8B121E" }: { className?: string; wax?: string }) {
  return (
    <svg viewBox="0 0 220 150" className={className} aria-hidden focusable="false">
      <path d="M6 26 L214 20 L212 140 L8 144 Z" fill="#E0CBA4" />
      <path d="M6 26 L214 20 L212 140 L8 144 Z" fill="url(#lj-cyl)" opacity="0.45" />
      <path d="M6 26 L110 92 L214 20 L214 30 L110 102 L6 36 Z" fill="#CBB185" />
      <path d="M6 26 L110 92 L214 20" fill="none" stroke="#A88C5C" strokeWidth="1.6" />
      <path d="M8 144 L92 84 M212 140 L128 82" stroke="#A88C5C" strokeWidth="1.2" opacity="0.6" />
      <g opacity="0.5" stroke="#7C6134" strokeWidth="1.1">
        <path d="M34 112 L120 108" />
        <path d="M34 122 L96 119" />
      </g>
      <WaxMark shape="blob" color={wax} cx={112} cy={92} r={17} />
      <path d="M6 26 L214 20" stroke="#8A6E42" strokeWidth="1.4" opacity="0.6" />
    </svg>
  );
}

/* Three letters stacked and tied crosswise with twine. */
export function TiedBundle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 210 120" className={className} aria-hidden focusable="false">
      <g>
        <rect x="10" y="52" width="190" height="46" rx="3" fill="#D6C09A" transform="rotate(-3 105 75)" />
        <rect x="14" y="40" width="184" height="46" rx="3" fill="#E7D6B4" transform="rotate(1.5 105 63)" />
        <rect x="8" y="28" width="188" height="46" rx="3" fill="#F2E5C6" transform="rotate(-1 105 51)" />
        <g opacity="0.45" stroke="#9C8355" strokeWidth="1.1" transform="rotate(-1 105 51)">
          <path d="M26 42 L120 40" />
          <path d="M26 52 L96 50" />
          <path d="M26 62 L138 60" />
        </g>
      </g>
      <g stroke="#B99B6E" strokeWidth="6" fill="none" strokeLinecap="round">
        <path d="M74 22 Q78 62 72 104" />
        <path d="M6 46 Q104 40 202 50" />
      </g>
      <ellipse cx="74" cy="46" rx="10" ry="8" fill="#D2B180" stroke="#8E7248" strokeWidth="1.6" />
      <path d="M74 54 C 66 72, 58 82, 46 92" stroke="#B99B6E" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M80 52 C 92 70, 96 82, 108 94" stroke="#B99B6E" strokeWidth="4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* A candle in a glass, with a flame that never sits still. */
export function CandleJar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 110 190" className={className} aria-hidden focusable="false">
      <g className="lj-flame">
        <ellipse cx="55" cy="46" rx="16" ry="26" fill="#FFB74D" opacity="0.30" />
        <path d="M55 20 C 66 38, 66 54, 55 62 C 44 54, 44 38, 55 20 Z" fill="#FFCE7A" />
        <path d="M55 30 C 61 42, 61 52, 55 58 C 49 52, 49 42, 55 30 Z" fill="#FFF3D0" />
      </g>
      <path d="M55 62 L55 74" stroke="#3A2A1C" strokeWidth="2.4" />
      <rect x="18" y="74" width="74" height="98" rx="10" fill="#E8DFC8" opacity="0.30" />
      <rect x="18" y="74" width="74" height="98" rx="10" fill="url(#lj-glasslight)" />
      <rect x="22" y="96" width="66" height="72" rx="6" fill="#F4E7C8" opacity="0.85" />
      <ellipse cx="55" cy="96" rx="33" ry="7" fill="#FBF2DC" />
      <ellipse cx="55" cy="96" rx="12" ry="3" fill="#D9C69A" />
      <rect x="18" y="74" width="74" height="98" rx="10" fill="none" stroke="#B9AE93" strokeWidth="2" opacity="0.7" />
      <rect x="26" y="86" width="7" height="76" rx="4" fill="#fff" opacity="0.22" />
      <ellipse cx="55" cy="176" rx="46" ry="8" fill="#FFB74D" opacity="0.16" />
    </svg>
  );
}

/* A lace doily under the jar, as in the reference photograph. */
export function LaceDoily({ className }: { className?: string }) {
  const petals = Array.from({ length: 28 });
  return (
    <svg viewBox="0 0 400 140" className={className} aria-hidden focusable="false">
      <g opacity="0.5">
        <ellipse cx="200" cy="70" rx="186" ry="58" fill="#EDE4D2" opacity="0.35" />
        {petals.map((_, i) => {
          const a = (i / petals.length) * Math.PI * 2;
          return (
            <ellipse
              key={i}
              cx={200 + Math.cos(a) * 176}
              cy={70 + Math.sin(a) * 54}
              rx="13"
              ry="8"
              fill="#EFE7D6"
              opacity="0.5"
            />
          );
        })}
        <ellipse cx="200" cy="70" rx="150" ry="45" fill="none" stroke="#DCD0B8" strokeWidth="2" strokeDasharray="5 7" />
        <ellipse cx="200" cy="70" rx="112" ry="33" fill="none" stroke="#DCD0B8" strokeWidth="1.6" strokeDasharray="3 6" />
      </g>
    </svg>
  );
}

/* ----------------------------------------------- spider-verse furniture --- */

export function SpiderOnThread({ className, threadLength = 120 }: { className?: string; threadLength?: number }) {
  return (
    <div className={className} aria-hidden>
      <span className="lj-thread" style={{ height: threadLength }} />
      <svg viewBox="0 0 60 54" className="lj-spider-svg">
        <g stroke="#1B1218" strokeWidth="3.4" fill="none" strokeLinecap="round">
          <path d="M22 22 L6 8 M22 27 L2 24 M22 32 L6 44 M23 36 L12 50" />
          <path d="M38 22 L54 8 M38 27 L58 24 M38 32 L54 44 M37 36 L48 50" />
        </g>
        <ellipse cx="30" cy="32" rx="11" ry="13" fill="#1B1218" />
        <circle cx="30" cy="18" r="7.5" fill="#241A20" />
        <circle cx="27" cy="16" r="1.8" fill="#E0B1AE" />
        <circle cx="33" cy="16" r="1.8" fill="#E0B1AE" />
        <path d="M30 26 L30 40" stroke="#7D2834" strokeWidth="2.2" opacity="0.8" />
      </svg>
    </div>
  );
}

export function WebCorner({ className, rings = 5 }: { className?: string; rings?: number }) {
  return (
    <svg className={className} viewBox="0 0 140 140" aria-hidden focusable="false">
      {Array.from({ length: rings }).map((_, i) => {
        const r = 26 + i * 26;
        return (
          <path
            key={r}
            d={`M0 ${r} Q ${r * 0.44} ${r * 0.44} ${r} 0`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
        );
      })}
      {[0, 18, 36, 54, 72, 90].map((a) => {
        const rad = (a * Math.PI) / 180;
        return (
          <line
            key={a}
            x1="0"
            y1="0"
            x2={Math.sin(rad) * 150}
            y2={Math.cos(rad) * 150}
            stroke="currentColor"
            strokeWidth="1.1"
          />
        );
      })}
      {/* dew caught on the strands */}
      {[[26, 40], [64, 52], [40, 88], [92, 34], [58, 108]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2.2" fill="currentColor" opacity="0.75" />
      ))}
    </svg>
  );
}

/* A swagged string of warm bulbs. `depth` shifts it back in the scene. */
export function FairyString({
  bulbs,
  className,
  depth = 1,
}: {
  bulbs: number;
  className?: string;
  depth?: number;
}) {
  return (
    <div className={`lj-string ${className ?? ""}`} aria-hidden style={{ opacity: 1 / depth }}>
      <svg viewBox="0 0 1200 150" preserveAspectRatio="none" className="lj-string-wire">
        <path d="M0 4 Q 300 128 600 68 T 1200 8" fill="none" stroke="#4A392C" strokeWidth="2.5" />
      </svg>
      {Array.from({ length: bulbs }).map((_, i) => {
        const t = i / (bulbs - 1);
        const x = (t * 100).toFixed(3);
        // sampled off the same quadratic droop the wire is drawn with, and
        // rounded so the server and the client serialise it identically
        const y = (4 + Math.sin(t * Math.PI) * 60 + (t > 0.5 ? -14 * (t - 0.5) * 2 : 0)).toFixed(2);
        return (
          <span key={i} className="lj-bulb-holder" style={{ left: `${x}%`, top: `${y}px` }}>
            <span className="lj-bulb-cap" />
            <span
              className="lj-bulb"
              style={{
                ["--bulb" as string]:
                  i % 3 === 0 ? "#FFD9A0" : i % 3 === 1 ? "#FFC1CE" : "#FFEBC4",
                animationDelay: `${(i % 7) * 0.29}s`,
              }}
            />
          </span>
        );
      })}
    </div>
  );
}
