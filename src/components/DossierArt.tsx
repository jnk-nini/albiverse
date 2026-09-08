"use client";

import { memo } from "react";

/* ============================================================================
   CH.11 — DRAWN OBJECTS
   ----------------------------------------------------------------------------
   Every physical thing in the dossier: the pin holding the badge down, the
   thumbprint scanner, the notepad quirks are torn from, the manila tabs, the
   rubber stamps, the radar face.

   All SVG, all inline, all currentColor-or-prop driven. Nothing here loads an
   image, so nothing here can 404 into a broken layout - the house rule for
   decorative art in this project.

   Seeded helpers are deliberately imported from DiaryArt rather than copied:
   the two chapters want the same stable-per-id randomness, and there is no
   reason for two implementations of it to drift apart.
   ========================================================================== */

export { hashString, seeded, seededPick, tornClipPath } from "./DiaryArt";

/* --------------------------------------------------------------- filters -- */

/**
 * Shared SVG filter definitions. Mounted ONCE per chapter, near the root.
 *
 * The halftone is a real screen-print simulation, not a dot image: a frequency
 * turbulence is pushed through a steep transfer function to threshold it into
 * dots, then those dots modulate the source. `feColorMatrix` splits the colour
 * channels apart first so the dots land in the CMYK-ish registration offset a
 * cheap four-colour press actually produces.
 */
export const DossierDefs = memo(function DossierDefs() {
  return (
    <svg
      aria-hidden
      focusable="false"
      style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}
    >
      <defs>
        {/* Four-colour halftone print, applied to the portrait on hover. */}
        <filter id="dsr-halftone" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="1" result="grain" />
          <feColorMatrix in="grain" type="saturate" values="0" result="mono" />
          <feComponentTransfer in="mono" result="dots">
            {/* A near-vertical ramp turns smooth noise into hard dots. */}
            <feFuncA type="discrete" tableValues="0 0 0 1 1" />
          </feComponentTransfer>
          <feComposite in="SourceGraphic" in2="dots" operator="in" result="printed" />
          <feBlend in="printed" in2="SourceGraphic" mode="multiply" />
        </filter>

        {/* Magenta/cyan registration slip - the classic misprint look. */}
        <filter id="dsr-aberration" x="-8%" y="-8%" width="116%" height="116%">
          <feOffset in="SourceGraphic" dx="-2.2" dy="0" result="l" />
          <feColorMatrix
            in="l"
            type="matrix"
            values="1 0 0 0 0
                    0 0 0 0 0
                    0 0 1 0 0
                    0 0 0 1 0"
            result="mag"
          />
          <feOffset in="SourceGraphic" dx="2.2" dy="0" result="r" />
          <feColorMatrix
            in="r"
            type="matrix"
            values="0 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0 0 0 1 0"
            result="cyan"
          />
          <feBlend in="mag" in2="cyan" mode="screen" result="split" />
          <feBlend in="SourceGraphic" in2="split" mode="multiply" />
        </filter>

        {/* Paper fibre, used flat on the manila folders. */}
        <filter id="dsr-fibre" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" result="f" />
          <feColorMatrix in="f" type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.055" />
          </feComponentTransfer>
        </filter>

        <linearGradient id="dsr-chrome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E8EDF2" />
          <stop offset="45%" stopColor="#9AA6B2" />
          <stop offset="55%" stopColor="#6E7A87" />
          <stop offset="100%" stopColor="#C3CDD6" />
        </linearGradient>
      </defs>
    </svg>
  );
});

/* ------------------------------------------------------------ the badge --- */

/** The safety pin that actually holds the hero badge to the canvas. */
export const SafetyPin = memo(function SafetyPin({
  className,
  size = 54,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size * 0.42}
      viewBox="0 0 120 50"
      fill="none"
      aria-hidden
    >
      {/* The bar behind the fabric, drawn first so the clasp overlaps it. */}
      <path
        d="M18 30 C 30 6, 92 6, 104 26"
        stroke="url(#dsr-chrome)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M18 30 C 30 10, 92 10, 104 26"
        stroke="rgba(255,255,255,.5)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Coil */}
      <circle cx="18" cy="33" r="9" stroke="url(#dsr-chrome)" strokeWidth="4.5" />
      <circle cx="18" cy="33" r="3.4" fill="#1B2027" />
      {/* Clasp */}
      <path
        d="M96 20 h14 a5 5 0 0 1 5 5 v8 a5 5 0 0 1 -5 5 h-14 z"
        fill="url(#dsr-chrome)"
        stroke="#38414C"
        strokeWidth="1.4"
      />
      <path d="M28 38 H100" stroke="url(#dsr-chrome)" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
});

/**
 * The neomorphic thumbprint scanner. The ridges are concentric arcs rather
 * than a photo of a fingerprint, so it stays crisp at any size and reads as a
 * schematic - which is what the rest of this chapter is.
 */
export const ThumbScanner = memo(function ThumbScanner({
  size = 62,
  active = false,
}: {
  size?: number;
  active?: boolean;
}) {
  const ridges = [
    "M32 12 C 18 12, 12 26, 12 36 C 12 46, 15 52, 18 56",
    "M32 18 C 22 18, 18 28, 18 37 C 18 45, 20 50, 22 54",
    "M32 24 C 26 24, 24 30, 24 38 C 24 44, 25 49, 27 52",
    "M32 30 C 30 30, 30 33, 30 38 C 30 43, 30 47, 31 50",
    "M32 12 C 46 12, 52 26, 52 36 C 52 46, 49 52, 46 56",
    "M32 18 C 42 18, 46 28, 46 37 C 46 45, 44 50, 42 54",
    "M32 24 C 38 24, 40 30, 40 38 C 40 44, 39 49, 37 52",
  ];

  return (
    <svg width={size} height={size} viewBox="0 0 64 68" fill="none" aria-hidden>
      <rect
        x="1.5"
        y="1.5"
        width="61"
        height="65"
        rx="14"
        fill="#161B21"
        stroke={active ? "#3FE0F0" : "#2B333D"}
        strokeWidth="2"
      />
      {/* The two-tone inner bevel is what makes it read as a raised key. */}
      <rect x="4" y="4" width="56" height="60" rx="12" fill="none" stroke="rgba(255,255,255,.09)" />
      <rect
        x="4"
        y="5.5"
        width="56"
        height="59"
        rx="12"
        fill="none"
        stroke="rgba(0,0,0,.55)"
        strokeDasharray="60 200"
        strokeDashoffset="-95"
      />
      <g
        stroke={active ? "#7FF3FF" : "#5A6672"}
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      >
        {ridges.map((d, i) => (
          <path key={i} d={d} opacity={active ? 0.95 : 0.7} />
        ))}
      </g>
    </svg>
  );
});

/* --------------------------------------------------------- the corkboard -- */

/** A pushpin for the evidence board. Distinct from Ch.06's - this one is domed. */
export const EvidencePin = memo(function EvidencePin({
  color = "#D7263D",
  size = 22,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <ellipse cx="16" cy="27" rx="7" ry="2.6" fill="rgba(0,0,0,.45)" />
      <circle cx="16" cy="14" r="10" fill={color} />
      <circle cx="16" cy="14" r="10" fill="none" stroke="rgba(0,0,0,.55)" strokeWidth="1.6" />
      <ellipse cx="12.4" cy="10.2" rx="3.4" ry="2.4" fill="rgba(255,255,255,.55)" />
      <path d="M16 23 l1.6 5.6 -3.2 0 z" fill="#8C8F95" />
    </svg>
  );
});

/* ------------------------------------------------------------- notepad ---- */

/** The pad a new quirk is torn off. The perforation is a real dashed edge. */
export const Notepad = memo(function Notepad({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 120" fill="none" aria-hidden>
      <rect x="6" y="14" width="148" height="100" rx="4" fill="#C9BCA4" />
      <rect x="9" y="10" width="142" height="100" rx="4" fill="#E4D9C0" />
      <rect x="12" y="6" width="136" height="100" rx="4" fill="#F6EFDD" stroke="#2A2018" strokeWidth="2" />
      {/* binding */}
      <rect x="12" y="6" width="136" height="15" fill="#7C2833" stroke="#2A2018" strokeWidth="2" />
      {[30, 55, 80, 105, 130].map((x) => (
        <circle key={x} cx={x} cy="13.5" r="2.6" fill="#2A2018" opacity=".55" />
      ))}
      <path d="M12 27 H148" stroke="#2A2018" strokeWidth="1.4" strokeDasharray="3 4" opacity=".55" />
      {[42, 56, 70, 84].map((y) => (
        <path key={y} d={`M24 ${y} H136`} stroke="#B9A98B" strokeWidth="1.4" />
      ))}
    </svg>
  );
});

/* -------------------------------------------------------- rubber stamps ---- */

export type StampId = "accomplished" | "code-red" | "handle-care" | "verified";

export const STAMPS: { id: StampId; label: string; color: string }[] = [
  { id: "accomplished", label: "MISSION ACCOMPLISHED", color: "#1F7A4D" },
  { id: "code-red", label: "CODE RED", color: "#B3172A" },
  { id: "handle-care", label: "HANDLE WITH CARE", color: "#B9761C" },
  { id: "verified", label: "VERIFIED", color: "#2C5A8C" },
];

/**
 * An inked rubber stamp. The ink is intentionally imperfect: a fibre filter
 * eats into the edges so it reads as pigment pressed into paper rather than a
 * vector outline sitting on top of it.
 */
export const RubberStamp = memo(function RubberStamp({
  label,
  color,
  rotate = 0,
  scale = 1,
}: {
  label: string;
  color: string;
  rotate?: number;
  scale?: number;
}) {
  const w = Math.max(150, label.length * 10.5);
  return (
    <svg
      width={w * scale}
      height={54 * scale}
      viewBox={`0 0 ${w} 54`}
      fill="none"
      aria-hidden
      style={{ rotate: `${rotate}deg` }}
    >
      <g opacity="0.82">
        <rect
          x="4"
          y="4"
          width={w - 8}
          height="46"
          rx="3"
          fill="none"
          stroke={color}
          strokeWidth="4"
        />
        <rect
          x="10"
          y="10"
          width={w - 20}
          height="34"
          rx="2"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          opacity=".7"
        />
        <text
          x={w / 2}
          y="34"
          textAnchor="middle"
          fill={color}
          fontFamily="'Courier New', monospace"
          fontWeight="700"
          fontSize="17"
          letterSpacing="1.6"
        >
          {label}
        </text>
      </g>
    </svg>
  );
});

/* ----------------------------------------------------------- radar face ---- */

/** The travelogue's radar dish face: rings, crosshairs and blueprint grid. */
export const RadarFace = memo(function RadarFace({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 400" fill="none" aria-hidden>
      <defs>
        <radialGradient id="dsr-radar-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0B2A2E" />
          <stop offset="100%" stopColor="#061418" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="196" fill="url(#dsr-radar-glow)" />
      {/* blueprint grid, clipped to the dish by the circle mask below */}
      <mask id="dsr-radar-mask">
        <circle cx="200" cy="200" r="196" fill="#fff" />
      </mask>
      <g mask="url(#dsr-radar-mask)" stroke="#1C5E63" strokeWidth="0.8" opacity=".55">
        {Array.from({ length: 21 }).map((_, i) => (
          <path key={"v" + i} d={`M${i * 20} 0 V400`} />
        ))}
        {Array.from({ length: 21 }).map((_, i) => (
          <path key={"h" + i} d={`M0 ${i * 20} H400`} />
        ))}
      </g>
      {[60, 110, 160, 196].map((r) => (
        <circle key={r} cx="200" cy="200" r={r} stroke="#2E8B8F" strokeWidth="1.2" opacity=".7" />
      ))}
      <path d="M200 4 V396 M4 200 H396" stroke="#2E8B8F" strokeWidth="1.2" opacity=".7" />
      <path
        d="M200 30 v-16 M200 386 v16 M30 200 h-16 M386 200 h16"
        stroke="#5FE7D8"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
});

/* ------------------------------------------------------- vector body map -- */

/**
 * The sizing schematic's silhouette. Deliberately a neutral technical figure,
 * not a gendered body: this chapter is written for whichever partner is being
 * catalogued, so the drawing has to work either way. Each `data-part` region
 * is highlighted by the caliper interaction.
 */
export const VectorFigure = memo(function VectorFigure({
  highlight,
  className,
}: {
  highlight: string | null;
  className?: string;
}) {
  const on = (part: string) => (highlight === part ? "#3FE0F0" : "#3D5460");
  const w = (part: string) => (highlight === part ? 3 : 1.6);

  return (
    <svg className={className} viewBox="0 0 160 320" fill="none" aria-hidden>
      {/* head + torso, never highlighted - context only */}
      <circle cx="80" cy="34" r="20" stroke="#3D5460" strokeWidth="1.6" />
      <path
        d="M80 54 L80 176 M52 76 C 52 62, 108 62, 108 76 L108 168 C 108 178, 52 178, 52 168 Z"
        stroke="#3D5460"
        strokeWidth="1.6"
      />

      {/* jacket fit spans the whole torso */}
      <path
        d="M48 72 C 44 100, 44 146, 50 176 L110 176 C 116 146, 116 100, 112 72"
        stroke={on("jacket")}
        strokeWidth={w("jacket")}
        strokeDasharray={highlight === "jacket" ? "0" : "5 5"}
      />

      {/* arms, with the wrist band picked out */}
      <path d="M52 78 L28 150 M108 78 L132 150" stroke="#3D5460" strokeWidth="1.6" />
      <path
        d="M24 150 a7 7 0 0 0 8 0"
        stroke={on("wrist")}
        strokeWidth={w("wrist") + 1}
        strokeLinecap="round"
      />
      <circle cx="28" cy="152" r="9" stroke={on("wrist")} strokeWidth={w("wrist")} />

      {/* ring finger */}
      <circle cx="132" cy="158" r="5.5" stroke={on("ring")} strokeWidth={w("ring") + 0.6} />
      <path d="M132 150 L132 168" stroke="#3D5460" strokeWidth="1.6" />

      {/* legs + feet */}
      <path d="M64 176 L60 282 M96 176 L100 282" stroke="#3D5460" strokeWidth="1.6" />
      <path
        d="M50 296 L74 296 L74 284 L58 284 Z M110 296 L86 296 L86 284 L102 284 Z"
        stroke={on("shoe")}
        strokeWidth={w("shoe")}
      />
    </svg>
  );
});

/* --------------------------------------------------------- hazard stripe -- */

export const HazardStripe = memo(function HazardStripe({ className }: { className?: string }) {
  return (
    <span
      className={className}
      aria-hidden
      style={{
        background:
          "repeating-linear-gradient(45deg, #E8B71A 0 14px, #14100F 14px 28px)",
      }}
    />
  );
});

/* --------------------------------------------------------- spider emblem -- */

/** The little inverted spider that triggers upside-down mode. */
export const SpiderMark = memo(function SpiderMark({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <ellipse cx="16" cy="18" rx="5" ry="7" fill="currentColor" />
      <circle cx="16" cy="10" r="3.6" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M11 13 L3 8 M11 17 L2 16 M11 21 L3 26 M12 24 L8 30" />
        <path d="M21 13 L29 8 M21 17 L30 16 M21 21 L29 26 M20 24 L24 30" />
      </g>
    </svg>
  );
});
