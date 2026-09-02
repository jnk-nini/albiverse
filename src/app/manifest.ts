import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Albiverse",
    short_name: "Albiverse",
    description: "A shared Spider-Man & Gwen vintage scrapbook universe.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF5EB",
    theme_color: "#1A0D10",
    icons: [
      {
        src: "/icons/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/512-maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
