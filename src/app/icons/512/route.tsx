import { ImageResponse } from "next/og";
import { albiverseIconMark } from "@/lib/pwaIcon";

// Fixed-path PNG so manifest.ts has a stable URL to point at - see the 192
// route for why this can't just reuse the icon.tsx file convention's output.
const SIZE = 512;

export function GET() {
  return new ImageResponse(albiverseIconMark({ size: SIZE }), {
    width: SIZE,
    height: SIZE,
  });
}
