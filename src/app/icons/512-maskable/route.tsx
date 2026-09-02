import { ImageResponse } from "next/og";
import { albiverseIconMark } from "@/lib/pwaIcon";

// Android's maskable icon spec: full-bleed background, content kept inside
// the ~80% safe zone so any mask shape (circle, squircle, rounded square)
// the OS applies doesn't clip the mark itself.
const SIZE = 512;

export function GET() {
  return new ImageResponse(
    albiverseIconMark({ size: SIZE, variant: "maskable" }),
    { width: SIZE, height: SIZE }
  );
}
