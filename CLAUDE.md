@AGENTS.md

# Albiverse — Project Instructions

You are an expert Next.js and Supabase developer building **Albiverse**, a private couples' app for two people only (Nini and her partner). Treat all content — photos, diary entries, letters, the vault — as sensitive personal/relationship data. Never expose one couple's data to anyone else, and never log or print row contents (media URLs are base64 blobs; diary/letters are private text).

## Theme
Earth-65 × Earth-616 (Spider-Gwen and Peter Parker). Moody, dark comic aesthetic with vintage scrapbook elements: polaroids, washi tape, halftone dots, bold ink borders, postage-stamp badges, hard offset drop shadows (`shadow-[Npx_Npx_0_#color]`). Fonts already wired in `layout.tsx`: `font-marker` (Permanent Marker — headings), `font-handwriting` (Caveat — casual/diary text), `font-mono` (Space Grotesk — labels, buttons, UI chrome). Never use generic corporate UI (no plain rounded cards, no default form styling, no sans-serif body text) — every screen should read as a page in a physical scrapbook/journal, consistent with the existing chapters.

## Data access rules (non-negotiable)
- Shared tables (`media_items`, `shared_diary`, `letters`, `calendar_events`, `bucket_list`) — every query MUST filter by `couple_id`. Postgres RLS already enforces this server-side via an `is_couple_member(couple_id)` helper, but filter client-side too; don't rely on RLS alone as the only place the rule is expressed.
- The private vault (`partner_vault`) is NOT couple-shared — filter by `owner_id`, not `couple_id`.
- Resolve `couple_id` from `profiles.couple_id` for the signed-in user server-side (or via `supabase.auth.getUser()` client-side); never trust a client-supplied couple_id for a query or mutation.

## Supabase project
- Project **albiverse**, ref `qapxhlwcvwmjvlqhmdho` (region ap-southeast-2). A second project in the same org, "commutayo" (`zhmdqtljfblhersbkzox`), is unrelated — don't touch it, and confirm the ref before running any migration or destructive query.
- `.env.local` already points the app at this project. Use the Supabase MCP tools directly for schema/RLS/query work; prefer `list_tables`/`execute_sql` (read-only) before ever reaching for `apply_migration`.
- No Supabase Storage buckets exist yet. Media (`media_items.url`) is stored as base64 data URLs directly in a `text` column — that's the established pattern already used by Chapter 3 and Chapter 4, not a bug to silently "fix". If a real Storage bucket is ever introduced, that's a deliberate migration to propose, not an assumption to make.

## Working conventions
- **Ask before `git commit` or `git push`, every single time** — no standing approval, even if a prior push was fine. This app holds private personal content the user wants to review before it's recorded in git history.
- Follow the existing chapter pattern: `src/app/<chapter>/page.tsx` (usually a Server Component that resolves the user/couple via Supabase and redirects to `/` if unauthenticated) renders a `src/components/<Chapter>Screen.tsx` client component that owns its own Supabase CRUD, realtime subscription, and local UI state. See `TimelineScreen.tsx`, `DiaryScreen.tsx`, `DigicamScreen.tsx` for the reference shape.
- Reuse existing scrapbook CSS utilities from `globals.css` (`.paper-sheet-solid`, `.tape-*-solid`, `.postage-stamp`, `.polaroid-matte`, `.wax-seal-solid`, `.spiral-binder-ring`, `.timeline-horizontal-scroll`, `font-marker`/`font-handwriting`) rather than inventing near-duplicates. For chapter-specific animations/effects, add a scoped `<style>{\`...\`}</style>` block inside the component itself (see `AuthPage.tsx`, `DigicamScreen.tsx`) instead of editing `globals.css` — keeps chapters independently droppable without cross-file coupling.
- Tape/sticker/camera/decorative graphics need pure-CSS fallbacks (solid-color classes, dashed borders, CSS shapes) or an `onError` swap to a CSS placeholder — never let a missing PNG break the layout (see `ScrapbookSlot.tsx` for the `onError` pattern).
- This is a customized Next.js fork — read `node_modules/next/dist/docs/` for the area you're touching before assuming stock Next.js behavior, per `AGENTS.md`.
- When a task gives an explicit, narrow file allowlist (e.g. "only create these two files"), treat it literally: don't touch other files even to fix something adjacent — flag it instead of fixing it.
