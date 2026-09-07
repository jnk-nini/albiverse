"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DigicamScreen from "@/components/DigicamScreen";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";
import { useChapterAccess } from "@/lib/hooks/useChapterAccess";

/* CH.04 - RETRO DIGICAM
   The auth/identity resolution that used to live inline here (getUser, then
   profiles, then couples, then the partner's profile - four network round
   trips in series, before the chapter could draw anything) now lives in
   `useChapterAccess`, which resolves it once per tab and caches it. `from`
   carries the table-of-contents spread the reader opened this chapter from -
   see chapterReturn.ts. */

const LOADING_SHELL =
  "min-h-screen bg-[#181114] text-[#F2E6D2] grid place-items-center p-6 font-mono text-sm";

function MediaPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const access = useChapterAccess();

  const backHref = tocReturnHref(searchParams?.get("from"), CHAPTER_SPREAD.media);

  if (access.status === "checking") {
    return <main className={LOADING_SHELL}>Loading your digicam...</main>;
  }

  if (access.status === "unlinked") {
    return <main className={LOADING_SHELL}>Link both universes before opening the digicam.</main>;
  }

  return (
    <DigicamScreen
      userId={access.identity.userId}
      coupleId={access.identity.coupleId!}
      onBack={() => router.push(backHref)}
    />
  );
}

export default function MediaPage() {
  return (
    <Suspense fallback={<main className={LOADING_SHELL}>Loading your digicam...</main>}>
      <MediaPageInner />
    </Suspense>
  );
}
