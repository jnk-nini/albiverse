"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BucketListScreen from "@/components/BucketListScreen";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";
import { useChapterAccess } from "@/lib/hooks/useChapterAccess";

/* CH.08 - MULTIVERSE BUCKET LIST
   The auth/identity resolution that used to live inline here (getUser, then
   profiles, then couples, then the partner's profile - four network round
   trips in series, before the chapter could draw anything) now lives in
   `useChapterAccess`, which resolves it once per tab and caches it. `from`
   carries the table-of-contents spread the reader opened this chapter from -
   see chapterReturn.ts. */

const LOADING_SHELL =
  "min-h-screen bg-[#14181A] text-[#F1E2CB] grid place-items-center p-6 font-mono text-sm";

function BucketListPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const access = useChapterAccess();

  const backHref = tocReturnHref(searchParams?.get("from"), CHAPTER_SPREAD["bucket-list"]);

  if (access.status === "checking") {
    return <main className={LOADING_SHELL}>Pinning the corkboard to the wall...</main>;
  }

  if (access.status === "unlinked") {
    return <main className={LOADING_SHELL}>Link both universes before opening the shared bucket list.</main>;
  }

  return (
    <BucketListScreen
      userId={access.identity.userId}
      coupleId={access.identity.coupleId!}
      myName={access.identity.myName}
      partnerName={access.identity.partnerName}
      onBack={() => router.push(backHref)}
    />
  );
}

export default function BucketListPage() {
  return (
    <Suspense fallback={<main className={LOADING_SHELL}>Pinning the corkboard to the wall...</main>}>
      <BucketListPageInner />
    </Suspense>
  );
}
