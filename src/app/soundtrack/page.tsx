"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SoundtrackScreen from "@/components/SoundtrackScreen";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";
import { useChapterAccess } from "@/lib/hooks/useChapterAccess";

/* CH.09 - SOUNDTRACK DECK
   `tape` carries a mixtape's share_slug, set by the QR sticker, so a scanned
   code opens straight onto that tape.
   The auth/identity resolution that used to live inline here (getUser, then
   profiles, then couples, then the partner's profile - four network round
   trips in series, before the chapter could draw anything) now lives in
   `useChapterAccess`, which resolves it once per tab and caches it. `from`
   carries the table-of-contents spread the reader opened this chapter from -
   see chapterReturn.ts. */

const LOADING_SHELL =
  "min-h-screen bg-[#4B3524] text-[#FFE7C6] grid place-items-center p-6 font-mono text-sm";

function SoundtrackPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const access = useChapterAccess();

  const backHref = tocReturnHref(searchParams?.get("from"), CHAPTER_SPREAD.soundtrack);
  const openSlug = searchParams?.get("tape") ?? null;

  if (access.status === "checking") {
    return <main className={LOADING_SHELL}>Threading the tape onto the reels...</main>;
  }

  if (access.status === "unlinked") {
    return <main className={LOADING_SHELL}>Link both universes before opening the soundtrack deck.</main>;
  }

  return (
    <SoundtrackScreen
      userId={access.identity.userId}
      coupleId={access.identity.coupleId!}
      myName={access.identity.myName}
      partnerName={access.identity.partnerName}
      openSlug={openSlug}
      onBack={() => router.push(backHref)}
    />
  );
}

export default function SoundtrackPage() {
  return (
    <Suspense fallback={<main className={LOADING_SHELL}>Threading the tape onto the reels...</main>}>
      <SoundtrackPageInner />
    </Suspense>
  );
}
