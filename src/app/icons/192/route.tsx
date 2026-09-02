import { ImageResponse } from "next/og";
import { albiverseIconMark } from "@/lib/pwaIcon";

// Fixed-path PNG so manifest.ts has a stable URL to point at - the icon/
// apple-icon file conventions serve theirs behind a generated hash query
// string, which manifest.json's static icons array can't reference.
const SIZE = 192;

export function GET() {
  return new ImageResponse(albiverseIconMark({ size: SIZE }), {
    width: SIZE,
    height: SIZE,
  });
}
