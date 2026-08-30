/* ================= WHERE "BACK" GOES =================
   Every chapter is opened from a spread of the table of contents, and every
   chapter's BACK control has to land on that same spread again. Before this,
   each chapter hardcoded its own guess ("/", "/?opened=true", "spread=1"), so
   leaving a chapter you had reached from the fast-travel index dumped you at
   the front of the book.

   The table of contents now hands every chapter the spread it was opened from
   as `?from=<n>`. This module is the single place that reads it back. */

/* The book is a spread per two chapters; `Dashboard` derives the same number
   from its own feature list. Kept here as the clamp so a hand-typed or stale
   `from` cannot scroll the book past its last page. */
export const TOTAL_TOC_SPREADS = 6;

/* The spread each chapter sits on, used when `from` is missing entirely, e.g.
   someone lands on /soundtrack from a bookmark. Keys are route segments. */
export const CHAPTER_SPREAD: Record<string, number> = {
  clock: 0,
  countdowns: 0,
  timeline: 1,
  media: 1,
  letters: 2,
  diary: 2,
  planner: 3,
  "bucket-list": 3,
  soundtrack: 4,
  wishlist: 4,
  "about-him": 5,
};

/** Normalise whatever arrived as `?from=` into a spread index we can trust. */
export function resolveSpread(from: unknown, fallbackSpread: number): number {
  const raw = Array.isArray(from) ? from[0] : from;
  const parsed = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  const spread = Number.isNaN(parsed) ? fallbackSpread : parsed;
  return Math.max(0, Math.min(TOTAL_TOC_SPREADS - 1, spread));
}

/**
 * The href a chapter's BACK control should point at.
 * `opened=true` keeps the book open instead of replaying the cover animation.
 */
export function tocReturnHref(from: unknown, fallbackSpread: number): string {
  return `/?opened=true&spread=${resolveSpread(from, fallbackSpread)}`;
}
