"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

/* ============================================================================
   CRASH-PROOF DRAFTS
   ----------------------------------------------------------------------------
   Every composer in this app (a diary log, a letter, a wishlist note) used to
   hold its half-written text in React state and nowhere else. A refresh, an
   accidental back-swipe, a phone deciding to reload a backgrounded PWA tab, or
   a dropped connection mid-save all threw the whole thing away.

   This keeps a rolling copy in localStorage as you type and hands it back on
   the next mount. Deliberately localStorage and not the database:

     - it costs nothing (the standing cost/DDoS guardrail: an autosave that
       wrote to Supabase on every keystroke would be the single chattiest
       writer in the app, on a free-tier project),
     - it survives a refresh, which is the actual thing being protected
       against, and
     - a half-written private letter never leaves the device it was typed on.

   The trade-off is that a draft does not follow you between devices. That is
   the right call here: this is a rescue net, not a sync feature.
   ========================================================================== */

const PREFIX = "albiverse:draft:v1:";

/* Drafts are a rescue net, not an archive - anything older than this is stale
   enough that silently reviving it would be more confusing than helpful. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/* localStorage is a ~5MB-per-origin budget shared with everything else the app
   keeps there. Diary and letter drafts can carry base64 attachments, which
   blow straight past that, so anything over this cap is stored in its pruned
   form (text kept, heavy media dropped) rather than not at all. */
const MAX_BYTES = 1_500_000;

type Stored<T> = {
  at: number;
  value: T;
  /* True when the saved copy is the pruned one - the caller can tell the
     writer their words came back but their attachments need re-adding. */
  pruned?: boolean;
};

function storageKey(scope: string) {
  return PREFIX + scope;
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    /* Private mode, disabled site data, or a browser that throws on access.
       A draft cache is a convenience - never let it break the composer. */
    return null;
  }
}

function safeSet(key: string, raw: string): boolean {
  try {
    window.localStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/** Drop every saved draft for a user - used when signing out. */
export function clearAllDrafts(scopePrefix?: string) {
  try {
    const full = PREFIX + (scopePrefix ?? "");
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(full)) doomed.push(k);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* nothing to do */
  }
}

/** Read a saved draft without mounting the hook (e.g. to show a "you have an
    unfinished log" badge somewhere else in a chapter). */
export function peekDraft<T extends object>(scope: string): T | null {
  const raw = safeGet(storageKey(scope));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Stored<T>;
    if (!parsed || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

export interface CachedDraftOptions<T extends object> {
  /* Called before writing when the serialised draft is too big for
     localStorage. Return a lighter version (typically the same object with
     base64 attachments stripped). Returning null skips saving entirely. */
  prune?: (value: T) => T | null;
  /* A draft that is indistinguishable from a blank form is not worth keeping,
     and restoring one would show a "restored" notice for nothing. */
  isEmpty?: (value: T) => boolean;
  debounceMs?: number;
  /* Set false to park the cache without unmounting (e.g. while a modal that
     owns the draft is closed). */
  enabled?: boolean;
}

export interface CachedDraft<T extends object> {
  draft: T;
  setDraft: Dispatch<SetStateAction<T>>;
  /** True when this mount hydrated from a saved draft rather than `initial`. */
  restored: boolean;
  /** True when the restored copy had its attachments stripped to fit. */
  restoredPruned: boolean;
  /** Throw the saved draft away and reset the form to `initial`. */
  discard: () => void;
  /** Saved successfully - drop the cache but leave the form alone. */
  commit: () => void;
  /** Stop showing the "restored" notice without touching the draft. */
  dismissRestored: () => void;
}

/**
 * Drop-in replacement for `useState` in a composer, with the value mirrored
 * into localStorage so a refresh cannot eat someone's writing.
 *
 * `scope` should identify both the person and the thing being edited, e.g.
 * `` `${userId}:diary:${editingId ?? "new"}` `` - so two half-written entries
 * never overwrite each other, and one account never sees another's draft on a
 * shared browser. Pass null to disable caching for this mount.
 */
/* Reading localStorage and the wall clock. Lives at module scope, and is
   called from a lazy useState initialiser, so it runs exactly once per mount
   and never as part of a re-render. */
function hydrate<T extends object>(
  key: string | null,
  enabled: boolean,
  initial: T
): { value: T; restored: boolean; pruned: boolean } {
  const blank = { value: initial, restored: false, pruned: false };
  if (!key || !enabled || typeof window === "undefined") return blank;

  const raw = safeGet(key);
  if (!raw) return blank;

  try {
    const parsed = JSON.parse(raw) as Stored<T>;
    if (!parsed || typeof parsed.at !== "number") return blank;
    if (Date.now() - parsed.at > MAX_AGE_MS) {
      safeRemove(key);
      return blank;
    }
    /* Spread over `initial` rather than replacing it, so a draft saved before
       a field was added to the form still produces a complete value. */
    return { value: { ...initial, ...parsed.value }, restored: true, pruned: Boolean(parsed.pruned) };
  } catch {
    safeRemove(key);
    return blank;
  }
}

export function useCachedDraft<T extends object>(
  scope: string | null,
  initial: T,
  options: CachedDraftOptions<T> = {}
): CachedDraft<T> {
  const { prune, isEmpty, debounceMs = 600, enabled = true } = options;

  const key = scope ? storageKey(scope) : null;

  /* `scope` is read once, on mount. A caller that switches between two
     different drafts is expected to remount with a React `key` (that is what
     DiaryScreen's Composer already does to prefill a different entry), which
     also gives each draft its own clean form state. */

  /* Touching localStorage and the clock in a lazy initialiser is the point of
     this hook: the restored text has to be in the FIRST painted frame.
     Otherwise the writer sees an empty form, starts typing into it, and their
     restored words either clobber what they just typed or lose to it. The
     initialiser runs exactly once per mount. */
  const [inner, setInner] = useState(() => hydrate<T>(key, enabled, initial));

  /* Both refs are only ever WRITTEN in an effect and READ inside a timer or an
     event handler - never during render. */
  const optsRef = useRef({ prune, isEmpty });
  useEffect(() => {
    optsRef.current = { prune, isEmpty };
  }, [prune, isEmpty]);

  const initialRef = useRef(initial);
  useEffect(() => {
    initialRef.current = initial;
  }, [initial]);

  /* Suppress one write-back after commit()/discard(), or the debounced save
     already in flight rewrites the key that was just cleared. */
  const suppressRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const draft = inner.value;

  const setDraft = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setInner((prev) => ({
      ...prev,
      value:
        typeof action === "function" ? (action as (p: T) => T)(prev.value) : action,
    }));
  }, []);

  /* Write the draft back, pruning if it will not fit. Shared by the debounced
     save and the synchronous flush on the way out. */
  const persist = useCallback(
    (value: T, target: string) => {
      const { isEmpty: emptyFn, prune: pruneFn } = optsRef.current;

      if (emptyFn?.(value)) {
        safeRemove(target);
        return;
      }

      const raw = JSON.stringify({ at: Date.now(), value } satisfies Stored<T>);
      if (raw.length <= MAX_BYTES && safeSet(target, raw)) return;

      /* Too big, or the quota refused it. Try again without the heavy parts -
         losing someone's photos is far better than losing their words. */
      const lighter = pruneFn?.(value);
      if (lighter == null) return;

      const light = JSON.stringify({ at: Date.now(), value: lighter, pruned: true });
      if (light.length > MAX_BYTES) return;
      safeSet(target, light);
    },
    []
  );

  useEffect(() => {
    if (!key || !enabled || typeof window === "undefined") return;
    if (suppressRef.current) {
      suppressRef.current = false;
      return;
    }

    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => persist(draft, key), debounceMs);

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [draft, key, enabled, debounceMs, persist]);

  /* A refresh inside the debounce window would otherwise eat the last few
     hundred milliseconds of typing - the words someone is most likely to be
     mid-thought on. `pagehide` rather than `unload` because that is the one
     iOS Safari and PWA shells fire reliably; `visibilitychange` additionally
     covers being app-switched away and then killed, which never fires
     pagehide at all. */
  useEffect(() => {
    if (!key || !enabled || typeof window === "undefined") return;

    const flush = () => persist(draft, key);
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [draft, key, enabled, persist]);

  const commit = useCallback(() => {
    suppressRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (key) safeRemove(key);
    setInner((prev) => ({ ...prev, restored: false, pruned: false }));
  }, [key]);

  const discard = useCallback(() => {
    suppressRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (key) safeRemove(key);
    setInner({ value: initialRef.current, restored: false, pruned: false });
  }, [key]);

  const dismissRestored = useCallback(() => {
    setInner((prev) => ({ ...prev, restored: false, pruned: false }));
  }, []);

  return {
    draft,
    setDraft,
    restored: inner.restored,
    restoredPruned: inner.pruned,
    discard,
    commit,
    dismissRestored,
  };
}
