"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PlannerScreen from "@/components/PlannerScreen";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";
import { useChapterAccess } from "@/lib/hooks/useChapterAccess";

/* CH.07 - WEB PLANNER
   The auth/identity resolution that used to live inline here (getUser, then
   profiles, then couples, then the partner's profile - four network round
   trips in series, before the chapter could draw anything) now lives in
   `useChapterAccess`, which resolves it once per tab and caches it. `from`
   carries the table-of-contents spread the reader opened this chapter from -
   see chapterReturn.ts. */

const LOADING_SHELL =
  "min-h-screen bg-[#191116] text-[#F1E2CB] grid place-items-center p-6 font-mono text-sm";

function PlannerPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const access = useChapterAccess();

  const backHref = tocReturnHref(searchParams?.get("from"), CHAPTER_SPREAD.planner);

  if (access.status === "checking") {
    return <main className={LOADING_SHELL}>Unrolling the shared calendar...</main>;
  }

  if (access.status === "unlinked") {
    return <main className={LOADING_SHELL}>Link both universes before opening the shared calendar.</main>;
  }

  return (
    <PlannerScreen
      userId={access.identity.userId}
      coupleId={access.identity.coupleId!}
      partnerId={access.identity.partnerId}
      myName={access.identity.myName}
      partnerName={access.identity.partnerName}
      onBack={() => router.push(backHref)}
    />
  );
}

export default function PlannerPage() {
  return (
    <Suspense fallback={<main className={LOADING_SHELL}>Unrolling the shared calendar...</main>}>
      <PlannerPageInner />
    </Suspense>
  );
}
