"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LetterJarScreen from "@/components/LetterJarScreen";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";
import { useChapterAccess } from "@/lib/hooks/useChapterAccess";

/* CH.05 - LOVE LETTER JAR
   The auth/identity resolution that used to live inline here (getUser, then
   profiles, then couples, then the partner's profile - four network round
   trips in series, before the chapter could draw anything) now lives in
   `useChapterAccess`, which resolves it once per tab and caches it. `from`
   carries the table-of-contents spread the reader opened this chapter from -
   see chapterReturn.ts. */

const LOADING_SHELL =
  "min-h-screen bg-[#181114] text-[#F2E6D2] grid place-items-center p-6 font-mono text-sm";

function LettersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const access = useChapterAccess();

  const backHref = tocReturnHref(searchParams?.get("from"), CHAPTER_SPREAD.letters);

  if (access.status === "checking") {
    return <main className={LOADING_SHELL}>Unsealing the letter jar...</main>;
  }

  if (access.status === "unlinked") {
    return <main className={LOADING_SHELL}>Link both universes before opening the letter jar.</main>;
  }

  return (
    <LetterJarScreen
      userId={access.identity.userId}
      coupleId={access.identity.coupleId!}
      myName={access.identity.myName}
      partnerId={access.identity.partnerId}
      partnerName={access.identity.partnerName}
      onBack={() => router.push(backHref)}
    />
  );
}

export default function LettersPage() {
  return (
    <Suspense fallback={<main className={LOADING_SHELL}>Unsealing the letter jar...</main>}>
      <LettersPageInner />
    </Suspense>
  );
}
