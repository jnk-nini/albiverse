import type { ReactElement } from "react";

/* Shared mark for every generated PWA icon (favicon, apple-icon, manifest
   icons). Reuses the app's own established motif instead of new art - the
   login page's "Giant Spider Emblem" is the same 🕷️ emoji at large scale
   (src/app/page.tsx), on the ink/cream palette already used for the front
   cover (globals.css). ImageResponse (satori) only understands a flexbox
   subset with inline styles - no Tailwind, no external CSS. */

const INK = "#1A0D10";
const CREAM = "#FAF5EB";

type IconVariant =
  | "circle" // transparent canvas, ink badge + cream ring - favicon / "any" manifest icons
  | "circle-opaque" // cream canvas, ink badge - apple-touch-icon (must not be transparent)
  | "maskable"; // full-bleed ink square, no ring - Android adaptive icon

export function albiverseIconMark({
  size,
  variant = "circle",
}: {
  size: number;
  variant?: IconVariant;
}): ReactElement {
  if (variant === "maskable") {
    // Android crops a maskable icon to arbitrary shapes, so content must sit
    // inside the ~80% "safe zone" and the background must fill every edge.
    const emojiSize = Math.round(size * 0.42);
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: INK,
        }}
      >
        <span style={{ fontSize: emojiSize, display: "flex" }}>🕷️</span>
      </div>
    );
  }

  const ringWidth = Math.max(2, Math.round(size * 0.035));
  const badgeSize = Math.round(size * 0.86);
  const emojiSize = Math.round(size * 0.5);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: variant === "circle-opaque" ? CREAM : "transparent",
      }}
    >
      <div
        style={{
          width: badgeSize,
          height: badgeSize,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: INK,
          border: `${ringWidth}px solid ${CREAM}`,
        }}
      >
        <span style={{ fontSize: emojiSize, display: "flex" }}>🕷️</span>
      </div>
    </div>
  );
}
