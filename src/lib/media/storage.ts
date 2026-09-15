/* ============================================================================
   SUPABASE STORAGE — the replacement for base64-in-Postgres

   Every blob used to live as a base64 `data:` URL in a Postgres text column
   (see mediaPrep.ts's header for why that was ever the plan). That doesn't
   scale past one couple's real usage: Postgres rows are never CDN-cached, and
   the free-tier DB size cap (500MB) and combined bandwidth cap (10GB/mo) are
   shared across every couple that ever signs up.

   New uploads go to the private `albiverse-media` Storage bucket instead.
   RLS on `storage.objects` reuses the same `is_couple_member()` check every
   other table already uses — see the `create_albiverse_media_bucket` /
   `albiverse_media_bucket_rls` migrations. Old base64 rows are untouched and
   keep working (see `resolveMediaSrc` below) — this is additive, not a
   backfill.
   ========================================================================== */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readBlob, writeBlob } from "./blobCache";
import { readFileAsDataUrl } from "./mediaPrep";

export const MEDIA_BUCKET = "albiverse-media";

/* Several columns this app writes to are bare strings or string arrays with
   no room for a parallel "is this a Storage path" column (`bucket_list.
   photo_urls`, `partner_vault.media_urls`, and any base64 field embedded
   inline inside a jsonb blob like `content_json`). A Storage-backed value in
   one of those fields is self-describing instead: literally the string
   `"storage:" + path`, checked with `isStorageRef`/read with `storagePathOf`.
   A legacy base64 `data:` URL or a real http(s) link never starts with this
   prefix, so the check is unambiguous. */
export const STORAGE_REF_PREFIX = "storage:";
/* Deliberately NOT typed as a `s is string` predicate: TS narrows the FALSE
   branch of such a guard by excluding `string` from the input type, which
   collapses `p` to `never` at every `isStorageRef(p) || ...` call site where
   `p` was already known to be a plain `string` (every caller so far). */
export const isStorageRef = (s: string | null | undefined): boolean =>
  typeof s === "string" && s.startsWith(STORAGE_REF_PREFIX);
export const storagePathOf = (ref: string): string => ref.slice(STORAGE_REF_PREFIX.length);
export const toStorageRef = (path: string): string => STORAGE_REF_PREFIX + path;

/** `couple/<coupleId>/<feature>/<filename>` — readable/writable by either partner. */
export function coupleObjectPath(coupleId: string, feature: string, filename: string): string {
  return `couple/${coupleId}/${feature}/${randomisedName(filename)}`;
}

/** `vault/<ownerId>/<feature>/<filename>` — readable/writable only by that owner. */
export function vaultObjectPath(ownerId: string, feature: string, filename: string): string {
  return `vault/${ownerId}/${feature}/${randomisedName(filename)}`;
}

/* A collision-proof name that still carries the original extension, so the
   bucket's `allowed_mime_types` + browsers' own extension sniffing both keep
   working. */
function randomisedName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot === -1 ? "" : filename.slice(dot); // includes the dot
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${id}${ext}`;
}

/**
 * Upload a Blob/File to Storage and return the object path to save on the row.
 * Throws on failure — callers already handle Supabase errors the same way
 * for every other insert/update in this app.
 */
export async function uploadToStorage(
  supabase: SupabaseClient,
  path: string,
  data: Blob,
  contentType?: string
): Promise<string> {
  /* Every path this app writes starts "couple/<id>/..." or "vault/<id>/...".
     Checking here, once, covers every upload site in the app automatically
     instead of needing a quota check duplicated at each of them. */
  const [prefix, id] = path.split("/");
  if (prefix === "couple" || prefix === "vault") {
    await assertWithinQuota(supabase, prefix, id, data.size);
  }

  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, data, { contentType: contentType || data.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}

/** Download an object's bytes. RLS enforces the couple/vault check automatically. */
export async function getStorageBlob(supabase: SupabaseClient, path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) throw error ?? new Error("Empty download.");
  return data;
}

/** Best-effort delete — same "never block the UI on cleanup" spirit as blobCache's dropBlob. */
export async function removeFromStorage(supabase: SupabaseClient, path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await supabase.storage.from(MEDIA_BUCKET).remove([path]);
  } catch {
    /* A leaked object costs storage quota, not correctness — never let
       cleanup failure block a delete the user is waiting on. */
  }
}

/**
 * The `src` a component should render, whether this row is Storage-backed or
 * still a legacy base64 row.
 *
 * - `storagePath` set → cache hit returns instantly; a miss downloads the
 *   object once, converts it to a data URL (so every existing `<img>`/
 *   `<video>`/`<audio src>` call site needs zero changes), and caches it
 *   under the same key/version scheme every chapter already uses.
 * - `storagePath` absent → the row predates this migration; hand back the
 *   base64 field exactly like before. No forced backfill.
 */
export async function resolveMediaSrc(
  supabase: SupabaseClient,
  opts: {
    storagePath: string | null | undefined;
    base64: string | null | undefined;
    cacheKey: string;
    version: string;
  }
): Promise<string> {
  const { storagePath, base64, cacheKey, version } = opts;
  if (!storagePath) return base64 ?? "";

  const cached = await readBlob(cacheKey, version);
  if (cached) return cached;

  const blob = await getStorageBlob(supabase, storagePath);
  const dataUrl = await readFileAsDataUrl(blob);
  await writeBlob(cacheKey, version, dataUrl);
  return dataUrl;
}

/* Shared 1GB free-tier bucket, split across however many couples sign up.
   40MB/couple keeps room for ~25 active couples before the pool is gone -
   generous enough for a real digicam roll + a few timeline photos + one
   video, tight enough that no single account (or a burst of throwaway
   signups) can eat the whole shared quota by itself. Tune freely; this is a
   soft product knob, not a security boundary — the hard boundary is the
   bucket's own 50MB per-file cap and Supabase's real 1GB ceiling. */
export const COUPLE_STORAGE_QUOTA_BYTES = 40 * 1024 * 1024;
export const VAULT_STORAGE_QUOTA_BYTES = 20 * 1024 * 1024;

/**
 * Total bytes a couple (or vault owner) currently has in Storage, via the
 * `storage_bytes_used` RPC (SECURITY DEFINER, but gated to only ever return
 * the caller's own couple/vault usage — see the `storage_bytes_used_rpc`
 * migration). A failed call fails OPEN (returns 0) — a quota check that
 * cannot run must never be able to block every upload in the app.
 */
export async function storageBytesUsed(
  supabase: SupabaseClient,
  prefix: "couple" | "vault",
  id: string
): Promise<number> {
  const { data, error } = await supabase.rpc("storage_bytes_used", { p_prefix: prefix, p_id: id });
  if (error || typeof data !== "number") return 0;
  return data;
}

/**
 * Throws a friendly, actionable error when uploading `addBytes` more would
 * push this couple/vault over its quota. Call before `uploadToStorage()` in
 * every upload path.
 */
export async function assertWithinQuota(
  supabase: SupabaseClient,
  prefix: "couple" | "vault",
  id: string,
  addBytes: number
): Promise<void> {
  const cap = prefix === "couple" ? COUPLE_STORAGE_QUOTA_BYTES : VAULT_STORAGE_QUOTA_BYTES;
  const used = await storageBytesUsed(supabase, prefix, id);
  if (used + addBytes > cap) {
    const usedMb = (used / (1024 * 1024)).toFixed(1);
    const capMb = (cap / (1024 * 1024)).toFixed(0);
    throw new Error(
      `Storage is full for ${prefix === "couple" ? "this couple" : "your vault"} (${usedMb}MB of ${capMb}MB used). Delete something first, or ask about a bigger allowance.`
    );
  }
}
