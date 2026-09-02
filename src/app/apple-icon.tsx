import { ImageResponse } from "next/og";
import { albiverseIconMark } from "@/lib/pwaIcon";

// iOS requires an opaque apple-touch-icon - a transparent one renders on a
// black square on the home screen.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    albiverseIconMark({ size: size.width, variant: "circle-opaque" }),
    { ...size }
  );
}
