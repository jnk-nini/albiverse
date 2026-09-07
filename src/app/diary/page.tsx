"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DiaryScreen from "@/components/DiaryScreen";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";
import { useChapterAccess } from "@/lib/hooks/useChapterAccess";

/* CH.06 - SPIDER DIARY
   The auth/identity resolution that used to live inline here (getUser, then
   profiles, then couples, then the partner's profile - four network round
   trips in series, before the chapter could draw anything) now lives in
   `useChapterAccess`, which resolves it once per tab and caches it. `from`
   carries the table-of-contents spread the reader opened this chapter from -
   see chapterReturn.ts. */

const LOADING_SHELL =
  "min-h-screen bg-[#1A1013] text-[#F1E2CB] grid place-items-center p-6 font-mono text-sm";

function DiaryPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const access = useChapterAccess();

  const backHref = tocReturnHref(searchParams?.get("from"), CHAPTER_SPREAD.diary);

  if (access.status === "checking") {
    return <main className={LOADING_SHELL}>Rolling a sheet into the machine...</main>;
  }

  if (access.status === "unlinked") {
    return <main className={LOADING_SHELL}>Link both universes before opening the shared diary.</main>;
  }

  return (
    <DiaryScreen
      userId={access.identity.userId}
      coupleId={access.identity.coupleId!}
      myName={access.identity.myName}
      partnerName={access.identity.partnerName}
      onBack={() => router.push(backHref)}
    />
  );
}

export default function DiaryPage() {
  return (
    <Suspense fallback={<main className={LOADING_SHELL}>Rolling a sheet into the machine...</main>}>
      <DiaryPageInner />
    </Suspense>
  );
}
