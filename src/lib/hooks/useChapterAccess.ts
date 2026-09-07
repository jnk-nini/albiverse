"use client";

/* ============================================================================
   CHAPTER ACCESS GATE

   Every chapter page used to resolve the reader from scratch, in series:
   `auth.getUser()`, await it; `select couple_id, full_name from profiles`,
   await that; `select partner_1_id, partner_2_id from couples`, await that;
   `select full_name from profiles` for the partner, await that. Four network
   round-trips stacked end to end before a single pixel of the chapter existed,
   and then the Screen mounted and fired its OWN query for the actual content.
   Repeated in full every time any chapter was opened. That is most of why
   chapters felt slow to open even when they held almost nothing.

   Three changes fix it:

   1. `getSession()` instead of `getUser()`. `getUser()` ALWAYS calls
      `/auth/v1/user` over the network to re-verify the token. `getSession()`
      reads the session out of the cookie the browser already has, with no
      request at all. For a client-side "is anyone signed in" gate that is the
      right call — this is not where security is enforced. Postgres RLS is,
      and it re-checks the JWT on every single query regardless of what this
      hook believes.

   2. The chapter unblocks as soon as the ids exist. Partner name resolution
      keeps going underneath and arrives a moment later, because nothing on
      screen needs it to draw the page.

   3. A per-tab cache of the whole resolved identity. The FIRST chapter of a
      session resolves it properly; every chapter after that starts from the
      cached value and revalidates in the background, so opening a chapter
      costs one query (the chapter's own data) instead of five.

   The house rule in CLAUDE.md — never trust a client-supplied couple_id — is
   still honoured: the value is always resolved from `profiles` for the signed
   in user, the cache is keyed to that user's id and discarded if the signed-in
   user changes, and it is only ever a head start on a lookup that still runs.
   A stale id cannot leak anything either, because RLS's `is_couple_member()`
   check would simply return no rows.
   ========================================================================= */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const CACHE_KEY = "albiverse.access";

export interface ChapterIdentity {
  userId: string;
  coupleId: string | null;
  myName: string;
  partnerId: string | null;
  partnerName: string;
}

export type ChapterAccess =
  | { status: "checking"; identity: null }
  | { status: "ready"; identity: ChapterIdentity }
  /* Signed in, but not linked to anyone — couple-shared chapters can't open. */
  | { status: "unlinked"; identity: ChapterIdentity };

const DEFAULT_PARTNER_NAME = "Your partner";

function readCache(): ChapterIdentity | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChapterIdentity;
    return typeof parsed?.userId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(value: ChapterIdentity) {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    /* private mode / blocked storage — the gate just resolves the slow way */
  }
}

export function clearChapterAccessCache() {
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Resolve who is reading and which couple's shelf they may open.
 *
 * @param requireCouple  Chapters backed by a shared table need a couple id and
 *   should report "unlinked" without one. The owner-only chapters (Ch.10's
 *   vault, Ch.11's dossier) pass `false` — they work perfectly well for
 *   someone who has not linked with anyone.
 */
export function useChapterAccess(requireCouple = true): ChapterAccess {
  const router = useRouter();
  const [access, setAccess] = useState<ChapterAccess>({ status: "checking", identity: null });

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const emit = (identity: ChapterIdentity) => {
      if (cancelled) return;
      setAccess(
        identity.coupleId || !requireCouple
          ? { status: "ready", identity }
          : { status: "unlinked", identity }
      );
    };

    const resolve = async () => {
      /* Reads the cookie the browser already holds — no network round-trip. */
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) {
        clearChapterAccessCache();
        router.replace("/");
        return;
      }

      /* Optimistic paint: if this tab already resolved this same reader
         earlier in the session, render from that immediately and confirm it
         underneath. */
      const cached = readCache();
      if (cached?.userId === user.id) emit(cached);

      const { data: profile } = await supabase
        .from("profiles")
        .select("couple_id, full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled) return;

      const identity: ChapterIdentity = {
        userId: user.id,
        coupleId: (profile?.couple_id as string | null) ?? null,
        myName: (profile?.full_name as string | null) || "Me",
        /* Carried over from the cache so a chapter that shows the partner's
           name doesn't flash the placeholder while it is re-confirmed. */
        partnerId: cached?.userId === user.id ? cached.partnerId : null,
        partnerName: cached?.userId === user.id ? cached.partnerName : DEFAULT_PARTNER_NAME,
      };

      /* Unblock the chapter here. Everything below is only the partner's
         display name, which no chapter needs in order to draw itself. */
      emit(identity);
      writeCache(identity);

      if (!identity.coupleId) return;

      const { data: couple } = await supabase
        .from("couples")
        .select("partner_1_id, partner_2_id")
        .eq("id", identity.coupleId)
        .maybeSingle();

      if (cancelled || !couple) return;

      const partnerId =
        (couple.partner_1_id === user.id ? couple.partner_2_id : couple.partner_1_id) ?? null;

      let partnerName = DEFAULT_PARTNER_NAME;
      if (partnerId) {
        const { data: partner } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", partnerId)
          .maybeSingle();
        if (partner?.full_name) partnerName = partner.full_name as string;
      }

      if (cancelled) return;

      const full: ChapterIdentity = { ...identity, partnerId, partnerName };
      emit(full);
      writeCache(full);
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [router, requireCouple]);

  return access;
}
