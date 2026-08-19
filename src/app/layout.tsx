import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Albiverse | Across Every Universe",
  description: "A shared Spider-Man & Gwen vintage scrapbook universe.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Permanent+Marker&family=Space+Grotesk:wght@500;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}