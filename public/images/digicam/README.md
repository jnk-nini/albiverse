# Chapter 4 custom art

Every slot here is optional. If a file is missing the chapter still renders its
finished CSS look, so you can drop art in one piece at a time and nothing ever
breaks. Add a file, refresh, and it appears. Delete it and the CSS comes back.

All slots want **transparent PNG** (or WebP). Nothing here is a fixed size, but
the listed dimensions are what the layout is tuned for.

## The camera itself

| File | Used for | Size |
|---|---|---|
| `../digicam-landscape.webp` | The camera chassis the app actually loads. **The one required asset.** | 1698 x 1080 source, served at 1400px |
| `../digicam-landscape.png` | Lossless intermediate the .webp is built from. Not loaded by the app. | 1698 x 1080 |
| `../digicam.png` | The original portrait source. Kept only so the landscape one can be regenerated. Not used by the app. | 1080 x 1698 |

`digicam-landscape.png` was generated from your original by rotating it 90
degrees counter-clockwise, so the Nikon wordmark sits horizontal, `MENU` is
upright, the `W/T` rocker is top-right and the `OK` D-pad is on the right, which
is how a real compact camera back is laid out.

**The screen is a real transparent hole in the PNG**, and the photo is rendered
*behind* the chassis so the camera's own bezel and stickers lap over its edges.
That is what makes the media look like it is inside the camera. The hole's exact
bounds live in `CAM.lcd` and were derived from the alpha channel, not measured
by eye.

**If you ever replace the camera photo**, the on-screen controls are pinned to
the buttons by percentage in the `CAM` constant at the top of
`src/components/DigicamScreen.tsx`, and `CAM.lcd` must match the new screen
hole. A different camera photo means re-deriving all of it, otherwise the
buttons sit in the wrong places and the photo spills onto the bezel.

## Optional decoration slots

Drop these into **this folder** (`public/images/digicam/`):

| File | Where it lands | Suggested size |
|---|---|---|
| `backdrop.png` | Full-bleed desk surface behind everything. Blended over the CSS background at 35% so texture reads without fighting the camera. Good for: a real desk photo, crumpled paper, a fabric scan. | 1920 x 1200, seamless-ish |
| `sticker-a.png` | Top-left of the scrapbook page, tilted left. | ~400px wide |
| `sticker-b.png` | Bottom-right of the page, tilted right. | ~450px wide |
| `sticker-c.png` | Right edge, vertically centred. Desktop only. | ~340px wide |

Sticker slots are for whatever you want stuck on the page: pressed flowers,
ticket stubs, a photo-booth strip, hand-drawn doodles, stamps.

## Making them look real, not pasted

A few things that do most of the work:

- **Cut them out on a transparent background.** A white box around a sticker is
  the single biggest giveaway.
- **Leave the paper edge in.** Scanned stickers, tape and stubs look real
  because they have a slightly torn or fibrous edge. Do not cut perfectly along
  the artwork.
- **Scan or photograph rather than generate flat vector art.** Real paper has
  grain, uneven ink and a faint shadow baked in, which is what the rest of the
  chapter is imitating in CSS.
- **Slight imperfection reads as handmade.** Off-centre, slightly crushed, a bit
  overexposed. The layout already tilts each slot a few degrees, so supply the
  art straight and let the page do the rotation.
- **Keep them under about 400KB each.** They load on every visit to the chapter.

## Where the rest of the chapter's art lives

- `public/images/bloom/flower-*.png` - the flower burst used by the dashboard
- `public/images/scrapbook/Journal-cover.png` - the book cover
- `public/images/gwen.png`, `peter.png`, `nyc-skyline.png` - used elsewhere

The tape, postage stamp, wax seal, polaroid frames, film-strip sprockets and
spider webs in Chapter 4 are all pure CSS (`globals.css` plus the scoped block
inside `DigicamScreen.tsx`). They need no files and will never 404.
