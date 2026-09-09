/* ============================================================================
   BASE64 BLOB CACHE  (IndexedDB)

   Every photo, video and audio track in this app lives in Postgres as a
   base64 data URL in a `text` column (see CLAUDE.md - deliberate, not a bug).
   That has one expensive consequence: a database row is not a Storage object,
   so nothing is ever CDN-cached. Every time a chapter re-mounts, every blob it
   shows is downloaded again, in full, forever.

   That is what put this project over its Supabase egress quota: ~161MB of
   base64 in the database, re-read on every visit. The cover photo alone is
   9.3MB and the book cover is re-mounted every single time you press BACK out
   of a chapter.

   This is the cache that stops that. Blobs are keyed by row id and stamped
   with a `version` - normally the row's `updated_at` - so a replaced photo
   invalidates itself the moment the new timestamp lands. A hit costs zero
   network.

   Everything here is best-effort by design. IndexedDB is unavailable in some
   private-browsing modes and can be switched off entirely, and a full disk
   throws on write. Every path below degrades to "no cache" rather than
   throwing into the caller, because a missing cache must never be able to
   stop a photo from loading - it just makes it cost what it costs today.
   ========================================================================== */

const DB_NAME = "albiverse-blobs";
const DB_VERSION = 1;
const STORE = "blobs";

/** Rough ceiling on cached rows. Eviction is oldest-write-first. */
const MAX_ENTRIES = 160;

/* Above the largest DB-side CHECK constraint (35MB on digicam_media.url), so
   a legitimate row is always cacheable and only something pathological is
   skipped. */
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;

interface BlobRecord {
  key: string;
  version: string;
  value: string;
  savedAt: number;
}

/** Reference to a cached blob: which row, and which revision of it. */
export interface BlobRef {
  key: string;
  /** Usually `updated_at`. Any change invalidates the entry. */
  version: string;
}

/* One connection for the tab, opened lazily. A rejected promise is cached as
   `null` so a browser that refuses IndexedDB is asked exactly once instead of
   on every photo. */
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }

      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "key" });
          store.createIndex("savedAt", "savedAt");
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      /* Firefox fires this instead of onerror when storage is blocked. */
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore | null {
  try {
    return db.transaction(STORE, mode).objectStore(STORE);
  } catch {
    return null;
  }
}

/**
 * Look up many blobs at once.
 *
 * Batched deliberately: a timeline or gallery asks for a whole screenful of
 * photos in one go, and one transaction for twenty rows is dramatically
 * cheaper than twenty transactions. Anything missing, or stamped with a
 * different version than the caller asked for, is simply absent from the
 * returned map - the caller then fetches exactly those from the database.
 */
export async function readBlobs(refs: BlobRef[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (refs.length === 0) return out;

  const db = await openDb();
  if (!db) return out;

  const store = tx(db, "readonly");
  if (!store) return out;

  await Promise.all(
    refs.map(
      (ref) =>
        new Promise<void>((resolve) => {
          try {
            const req = store.get(ref.key);
            req.onsuccess = () => {
              const rec = req.result as BlobRecord | undefined;
              /* A version mismatch is a miss, not a stale hit: the row was
                 edited (or replaced) since this copy was stored. */
              if (rec && rec.version === ref.version && typeof rec.value === "string") {
                out.set(ref.key, rec.value);
              }
              resolve();
            };
            req.onerror = () => resolve();
          } catch {
            resolve();
          }
        })
    )
  );

  return out;
}

/** Convenience wrapper for a single blob. */
export async function readBlob(key: string, version: string): Promise<string | null> {
  const found = await readBlobs([{ key, version }]);
  return found.get(key) ?? null;
}

/**
 * Store blobs, evicting the oldest entries once the store grows past
 * MAX_ENTRIES.
 *
 * A quota failure clears the whole store rather than propagating: the cache is
 * an optimisation, and an app that cannot show a photo because its cache is
 * full would be strictly worse than one with no cache at all.
 */
export async function writeBlobs(
  entries: { key: string; version: string; value: string }[]
): Promise<void> {
  const worth = entries.filter(
    (e) => e.value && e.value.length > 0 && e.value.length <= MAX_ENTRY_BYTES
  );
  if (worth.length === 0) return;

  const db = await openDb();
  if (!db) return;

  const store = tx(db, "readwrite");
  if (!store) return;

  const savedAt = Date.now();
  let quotaHit = false;

  await Promise.all(
    worth.map(
      (e) =>
        new Promise<void>((resolve) => {
          try {
            const req = store.put({ key: e.key, version: e.version, value: e.value, savedAt });
            req.onsuccess = () => resolve();
            req.onerror = () => {
              quotaHit = true;
              /* Swallow it at the request level so one oversized row cannot
                 abort the whole transaction and lose its siblings. */
              req.transaction?.abort?.();
              resolve();
            };
          } catch {
            resolve();
          }
        })
    )
  );

  if (quotaHit) {
    await clearBlobs();
    return;
  }

  await evict(db);
}

/** Convenience wrapper for a single blob. */
export async function writeBlob(key: string, version: string, value: string): Promise<void> {
  return writeBlobs([{ key, version, value }]);
}

/** Forget one row, e.g. after it is deleted. */
export async function dropBlob(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const store = tx(db, "readwrite");
  if (!store) return;
  try {
    store.delete(key);
  } catch {
    /* nothing to do - a cache that will not forget is not a correctness
       problem, only a space one, and eviction will get to it. */
  }
}

/** Drop everything. Used on quota failure and when a session ends. */
export async function clearBlobs(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const store = tx(db, "readwrite");
  if (!store) return;
  try {
    store.clear();
  } catch {
    /* best effort */
  }
}

/** Trim the store back to MAX_ENTRIES, oldest write first. */
function evict(db: IDBDatabase): Promise<void> {
  return new Promise<void>((resolve) => {
    const store = tx(db, "readwrite");
    if (!store) {
      resolve();
      return;
    }

    try {
      const countReq = store.count();
      countReq.onerror = () => resolve();
      countReq.onsuccess = () => {
        const excess = countReq.result - MAX_ENTRIES;
        if (excess <= 0) {
          resolve();
          return;
        }

        let removed = 0;
        const cursorReq = store.index("savedAt").openCursor();
        cursorReq.onerror = () => resolve();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || removed >= excess) {
            resolve();
            return;
          }
          cursor.delete();
          removed += 1;
          cursor.continue();
        };
      };
    } catch {
      resolve();
    }
  });
}

/* --------------------------------------------------------------- key help --

   Namespaced so two tables can never collide on a shared uuid, and so a
   cached row is obviously attributable when reading the store by hand in
   devtools. */

export const blobKey = {
  timelinePhoto: (id: string) => "media_items:" + id,
  digicamMedia: (id: string) => "digicam_media:" + id,
  mixtapeTrack: (id: string) => "mixtape_tracks:" + id,
  coupleCover: (coupleId: string) => "couples:cover:" + coupleId,
  coupleAmbient: (coupleId: string) => "couples:ambient:" + coupleId,
};

/* A row whose `updated_at` is null (older rows predate the column being
   maintained) still needs a stable stamp, or every read would miss. */
export function versionOf(row: { updated_at?: string | null; created_at?: string | null }): string {
  return row.updated_at ?? row.created_at ?? "v0";
}
