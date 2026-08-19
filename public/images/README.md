# Albiverse image assets

Place visual assets for the comic scrapbook background in this folder:

- `peter.png`: transparent Peter Parker / Spider-Man character art.
- `gwen.png`: transparent Gwen Stacy / Spider-Gwen character art.
- `nyc-skyline.png`: wide skyline artwork used along the bottom of the stage.

Use transparent PNGs for the hanging characters so the web and swing animation remain visible. Keep the skyline wide (recommended 2400px or wider) and avoid baking a background color into it.

For future feature media, keep files separated by purpose:

- `memories/` for scrapbook photos and short videos
- `letters/` for scanned paper textures and seals
- `music/` for locally uploaded audio artwork
- `vault/` for private visual assets

Reference public assets in components with paths such as `/images/peter.png`; do not import files from outside `public/` at runtime.