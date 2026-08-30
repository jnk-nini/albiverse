"use client";

/* ================= CH.09 SOUNDTRACK DECK - THE DRAWN OBJECTS =================
   Every control in this chapter is a physical thing on a corkboard, so every
   control has to be drawn. This file holds the props: the cassette shell, the
   boombox, the turntable and its record, the torn ticket stub, the manila
   envelope, the vinyl QR sticker, the polaroid viewfinder and the neomorphic
   rubber buttons.

   Two rules run through all of it:
   - Every object wears the same thick white die-cut sticker edge, drawn as a
     `filter: drop-shadow()` outline on a static element (never on anything that
     animates, per the app's performance notes).
   - Nothing here loads an image. A missing PNG cannot break this chapter
     because there are no PNGs. */

import type { CSSProperties, ReactNode } from "react";

/* The sticker die-cut. Four offset shadows read as a continuous outline at the
   sizes used here, and cost one rasterisation on a static element. */
export const STICKER_EDGE =
  "drop-shadow(0 0 0 #FFFFFF) drop-shadow(2px 0 0 #FFFFFF) drop-shadow(-2px 0 0 #FFFFFF) drop-shadow(0 2px 0 #FFFFFF) drop-shadow(0 -2px 0 #FFFFFF) drop-shadow(3px 5px 5px rgba(0,0,0,.55))";

export const TAPE_COLORS: Record<string, { tape: string; ink: string; name: string }> = {
  kraft: { tape: "#E8DCBE", ink: "#2B2119", name: "Kraft" },
  crimson: { tape: "#E9BFC4", ink: "#4A0C14", name: "Crimson" },
  gwen: { tape: "#D9E6F2", ink: "#16283C", name: "Earth-65" },
  mint: { tape: "#CFE0DA", ink: "#1B3630", name: "Web mint" },
  bugle: { tape: "#F3ECDA", ink: "#241C14", name: "Newsprint" },
  ink: { tape: "#3A3038", ink: "#F6EEDC", name: "Midnight" },
};

export const SHELL_STYLES: Record<string, { body: string; window: string; name: string }> = {
  clear: { body: "rgba(228,232,236,0.82)", window: "rgba(58,48,44,0.55)", name: "Clear" },
  smoke: { body: "rgba(122,118,126,0.85)", window: "rgba(30,26,30,0.7)", name: "Smoke" },
  cream: { body: "rgba(242,232,212,0.92)", window: "rgba(74,58,44,0.55)", name: "Cream" },
  red: { body: "rgba(158,54,60,0.9)", window: "rgba(40,10,14,0.65)", name: "Crimson" },
};

/* ---------------------------------------------------------------- cassette */

export function Cassette({
  title,
  owner,
  labelColor = "kraft",
  shellStyle = "clear",
  spinning = false,
  className = "",
  style,
}: {
  title: string;
  owner?: string;
  labelColor?: string;
  shellStyle?: string;
  /* reels turn while this tape is the one playing */
  spinning?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const label = TAPE_COLORS[labelColor] ?? TAPE_COLORS.kraft;
  const shell = SHELL_STYLES[shellStyle] ?? SHELL_STYLES.clear;

  return (
    <div className={`st-cassette ${className}`} style={style}>
      <svg viewBox="0 0 320 200" className="block w-full h-auto" aria-hidden>
        <defs>
          <linearGradient id={`st-shell-${shellStyle}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={shell.body} />
            <stop offset="52%" stopColor="rgba(255,255,255,0.24)" />
            <stop offset="100%" stopColor={shell.body} />
          </linearGradient>
        </defs>

        {/* shell */}
        <rect x="4" y="4" width="312" height="192" rx="9" fill={`url(#st-shell-${shellStyle})`} />
        <rect
          x="4"
          y="4"
          width="312"
          height="192"
          rx="9"
          fill="none"
          stroke="rgba(28,19,23,.62)"
          strokeWidth="3"
        />

        {/* screws */}
        {[
          [18, 18],
          [302, 18],
          [18, 182],
          [302, 182],
        ].map(([cx, cy], i) => (
          <g key={i}>
            <circle cx={cx} cy={cy} r="5.5" fill="rgba(28,19,23,.35)" />
            <circle cx={cx} cy={cy} r="2.4" fill="rgba(255,255,255,.5)" />
          </g>
        ))}

        {/* window with the spool of tape behind it */}
        <rect x="52" y="66" width="216" height="72" rx="6" fill={shell.window} />
        <rect
          x="52"
          y="66"
          width="216"
          height="72"
          rx="6"
          fill="none"
          stroke="rgba(28,19,23,.5)"
          strokeWidth="2"
        />
        <path d="M84 118 Q160 96 236 118 L236 138 L84 138 Z" fill="rgba(48,30,24,.62)" />

        {/* hubs */}
        {[104, 216].map((cx) => (
          <g key={cx} className={spinning ? "st-reel" : undefined} style={{ transformOrigin: `${cx}px 102px` }}>
            <circle cx={cx} cy="102" r="27" fill="rgba(250,246,238,.9)" stroke="rgba(28,19,23,.5)" strokeWidth="2" />
            <circle cx={cx} cy="102" r="14" fill="#C4A06A" stroke="rgba(28,19,23,.5)" strokeWidth="2" />
            {Array.from({ length: 6 }).map((_, i) => {
              const a = (i / 6) * Math.PI * 2;
              return (
                <rect
                  key={i}
                  x={cx - 1.8}
                  y={102 - 15}
                  width="3.6"
                  height="7"
                  fill="rgba(28,19,23,.6)"
                  transform={`rotate(${(a * 180) / Math.PI} ${cx} 102)`}
                />
              );
            })}
          </g>
        ))}

        {/* bottom lip and the pinch-roller cutouts */}
        <rect x="86" y="160" width="148" height="22" rx="4" fill="rgba(28,19,23,.16)" />
        {[104, 132, 188, 216].map((cx) => (
          <rect key={cx} x={cx - 7} y="165" width="14" height="12" rx="2" fill="rgba(28,19,23,.42)" />
        ))}
      </svg>

      {/* the paper label, taped across the top of the shell */}
      <div
        className="st-cassette-label"
        style={{ background: label.tape, color: label.ink }}
      >
        <span className="st-cassette-title">{title}</span>
      </div>

      {owner && <span className="st-owner-tag">{owner}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------- boombox */

export function Boombox({ children }: { children?: ReactNode }) {
  return (
    <div className="st-boombox">
      <svg viewBox="0 0 900 480" className="block w-full h-auto" aria-hidden>
        <defs>
          <linearGradient id="st-bb-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C9CCD1" />
            <stop offset="38%" stopColor="#9CA1A8" />
            <stop offset="100%" stopColor="#6E747C" />
          </linearGradient>
          <radialGradient id="st-bb-cone" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#3A3B40" />
            <stop offset="70%" stopColor="#17181C" />
            <stop offset="100%" stopColor="#0B0C0F" />
          </radialGradient>
          <pattern id="st-bb-mesh" width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="3.5" cy="3.5" r="1.5" fill="rgba(255,255,255,.10)" />
          </pattern>
        </defs>

        {/* carry handle */}
        <path
          d="M300 44 Q450 6 600 44"
          fill="none"
          stroke="#2A2C31"
          strokeWidth="18"
          strokeLinecap="round"
        />
        <path d="M300 44 Q450 6 600 44" fill="none" stroke="#4C5057" strokeWidth="8" strokeLinecap="round" />

        {/* chassis */}
        <rect x="26" y="60" width="848" height="392" rx="18" fill="url(#st-bb-body)" />
        <rect
          x="26"
          y="60"
          width="848"
          height="392"
          rx="18"
          fill="none"
          stroke="#23252A"
          strokeWidth="5"
        />

        {/* tuner strip */}
        <rect x="86" y="92" width="728" height="72" rx="8" fill="#15161A" stroke="#33363C" strokeWidth="3" />
        {Array.from({ length: 22 }).map((_, i) => (
          <rect key={i} x={112 + i * 32} y="118" width="2" height={i % 4 === 0 ? 20 : 12} fill="#7E848C" />
        ))}
        <rect x="470" y="104" width="4" height="50" fill="#C7343F" />
        <text x="112" y="112" fill="#6E747C" fontSize="12" fontFamily="monospace">
          FM
        </text>
        <text x="756" y="112" fill="#6E747C" fontSize="12" fontFamily="monospace">
          MHz
        </text>

        {/* speakers */}
        {[168, 732].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="300" r="112" fill="url(#st-bb-cone)" stroke="#23252A" strokeWidth="5" />
            <circle cx={cx} cy="300" r="112" fill="url(#st-bb-mesh)" />
            <circle cx={cx} cy="300" r="34" fill="#26282D" stroke="#111214" strokeWidth="3" />
          </g>
        ))}

        {/* knobs */}
        {[300, 352, 404, 456, 508, 560].map((cx, i) => (
          <rect
            key={cx}
            x={cx - 14}
            y="74"
            width="28"
            height="16"
            rx="4"
            fill={i === 5 ? "#B23540" : "#3B3E44"}
            stroke="#23252A"
            strokeWidth="2"
          />
        ))}

        {/* transport keys */}
        {Array.from({ length: 6 }).map((_, i) => (
          <g key={i}>
            <rect
              x={330 + i * 40}
              y="384"
              width="34"
              height="42"
              rx="4"
              fill="#B9BEC4"
              stroke="#4A4E55"
              strokeWidth="2"
            />
            <rect x={338 + i * 40} y="400" width="18" height="4" rx="2" fill="#3D4046" />
          </g>
        ))}
      </svg>

      {/* the deck door: a real DOM box so a real cassette can slide into it */}
      <div className="st-boombox-deck">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- turntable */

export function VinylRecord({
  title,
  subtitle,
  spinning,
  labelColor = "kraft",
}: {
  title: string;
  subtitle?: string;
  spinning: boolean;
  labelColor?: string;
}) {
  const label = TAPE_COLORS[labelColor] ?? TAPE_COLORS.kraft;
  return (
    <div className={`st-vinyl ${spinning ? "st-vinyl-spin" : ""}`}>
      <div className="st-vinyl-disc">
        <div className="st-vinyl-grooves" aria-hidden />
        <div className="st-vinyl-sheen" aria-hidden />
      </div>
      {/* the centre label counter-rotates so the writing stays readable */}
      <div className="st-vinyl-label" style={{ background: label.tape, color: label.ink }}>
        <span className="st-vinyl-label-title">{title}</span>
        {subtitle && <span className="st-vinyl-label-sub">{subtitle}</span>}
        <span className="st-vinyl-spindle" aria-hidden />
      </div>
    </div>
  );
}

export function Tonearm({ down }: { down: boolean }) {
  return (
    <div className={`st-tonearm ${down ? "st-tonearm-down" : ""}`} aria-hidden>
      <svg viewBox="0 0 240 300" className="block w-full h-auto">
        <circle cx="188" cy="52" r="40" fill="#B9BEC4" stroke="#4A4E55" strokeWidth="4" />
        <circle cx="188" cy="52" r="17" fill="#7C828A" stroke="#3B3E44" strokeWidth="3" />
        <rect
          x="182"
          y="70"
          width="12"
          height="150"
          rx="6"
          fill="#C7CBD1"
          stroke="#4A4E55"
          strokeWidth="3"
          transform="rotate(24 188 70)"
        />
        <g transform="rotate(24 188 70)">
          <rect x="168" y="212" width="40" height="30" rx="5" fill="#2A2C31" stroke="#14161A" strokeWidth="3" />
          <rect x="176" y="238" width="6" height="14" fill="#8E949C" />
          <rect x="192" y="216" width="10" height="8" rx="2" fill="#C7343F" />
        </g>
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------- ticket */

export function TicketStub({
  primary,
  secondary,
}: {
  primary: string;
  secondary?: string;
}) {
  return (
    <span className="st-ticket">
      <span className="st-ticket-perf" aria-hidden />
      <span className="st-ticket-body">
        <span className="st-ticket-kicker">Concert ticket</span>
        <span className="st-ticket-primary">{primary}</span>
        {secondary && <span className="st-ticket-secondary">{secondary}</span>}
      </span>
      <span className="st-ticket-serial" aria-hidden>
        1 6 0 1 1 2 7
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------- envelope */

export function ManilaEnvelope({ caption }: { caption: string }) {
  return (
    <span className="st-envelope">
      <svg viewBox="0 0 260 180" className="block w-full h-auto" aria-hidden>
        <rect x="6" y="6" width="248" height="168" rx="6" fill="#D8C39B" stroke="#7A6440" strokeWidth="4" />
        {/* the flap, folded down */}
        <path d="M6 20 L130 96 L254 20" fill="none" stroke="#7A6440" strokeWidth="4" />
        <path d="M6 20 L130 96 L254 20 L254 6 L6 6 Z" fill="#C9B387" stroke="#7A6440" strokeWidth="3" />
        {/* age stains, so it reads as distressed rather than new */}
        <ellipse cx="52" cy="146" rx="30" ry="18" fill="rgba(88,64,34,.16)" />
        <ellipse cx="212" cy="52" rx="24" ry="14" fill="rgba(88,64,34,.13)" />
        <path d="M18 168 Q60 152 96 170" fill="none" stroke="rgba(88,64,34,.28)" strokeWidth="3" />
        {/* the paperclip, clipped over the top-left corner rather than sitting
            in the middle of the envelope where it reads as a printed shape */}
        <g transform="translate(34 -4) scale(0.62)">
          <path
            d="M18 6 L18 62 a11 11 0 0 0 22 0 L40 20 a17 17 0 0 0 -34 0 L6 70"
            fill="none"
            stroke="#9AA0A8"
            strokeWidth="7"
            strokeLinecap="round"
          />
        </g>
      </svg>
      <span className="st-envelope-caption">{caption}</span>
    </span>
  );
}

/* ---------------------------------------------------------------- QR vinyl */

export function VinylQrSticker({
  matrix,
  caption,
  size = 148,
}: {
  matrix: boolean[][] | null;
  caption: string;
  size?: number;
}) {
  const n = matrix?.length ?? 0;
  return (
    <span className="st-qr-vinyl" style={{ width: size, height: size }}>
      <span className="st-qr-vinyl-grooves" aria-hidden />
      <span className="st-qr-arc st-qr-arc-top" aria-hidden>
        SCAN TO LISTEN
      </span>
      <span className="st-qr-plate">
        {matrix ? (
          <svg viewBox={`0 0 ${n} ${n}`} className="block w-full h-full" role="img" aria-label={caption}>
            <rect width={n} height={n} fill="#FFFFFF" />
            {matrix.map((row, r) =>
              row.map((dark, c) =>
                dark ? <rect key={`${r}-${c}`} x={c} y={r} width="1.02" height="1.02" fill="#100B0D" /> : null
              )
            )}
          </svg>
        ) : (
          <span className="st-qr-empty">no code</span>
        )}
      </span>
      <span className="st-qr-arc st-qr-arc-bottom" aria-hidden>
        {caption}
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------- polaroid */

export function PolaroidViewfinder({
  caption,
  children,
  live,
}: {
  caption: string;
  children?: ReactNode;
  live?: boolean;
}) {
  return (
    <div className="st-viewfinder">
      <span className="st-viewfinder-tape" aria-hidden />
      <div className="st-viewfinder-window">
        {children ?? (
          <div className="st-viewfinder-static" aria-hidden>
            <span className="st-viewfinder-noise" />
            <span className="st-viewfinder-nosignal">NO SIGNAL</span>
          </div>
        )}
        {live && <span className="st-viewfinder-rec" aria-hidden />}
      </div>
      <p className="st-viewfinder-caption">{caption}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- push pin */

export function PushPin({ tone = "#C7343F" }: { tone?: string }) {
  return (
    <svg viewBox="0 0 40 46" className="st-pin" aria-hidden>
      <path d="M20 44 L18.6 24 L21.4 24 Z" fill="#6B6F76" />
      <ellipse cx="20" cy="16" rx="15" ry="14" fill={tone} />
      <ellipse cx="15" cy="11" rx="5" ry="4" fill="rgba(255,255,255,.55)" />
      <ellipse cx="20" cy="25" rx="15" ry="5" fill="rgba(0,0,0,.28)" />
    </svg>
  );
}
