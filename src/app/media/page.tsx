"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DigicamScreen from "@/components/DigicamScreen";
import ChapterLoadingScreen from "@/components/ChapterLoadingScreen";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";
import { useChapterAccess } from "@/lib/hooks/useChapterAccess";

/* CH.04 - RETRO DIGICAM
   The auth/identity resolution that used to live inline here (getUser, then
   profiles, then couples, then the partner's profile - four network round
   trips in series, before the chapter could draw anything) now lives in
   `useChapterAccess`, which resolves it once per tab and caches it. `from`
   carries the table-of-contents spread the reader opened this chapter from -
   see chapterReturn.ts. */

function MediaPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const access = useChapterAccess();

  const backHref = tocReturnHref(searchParams?.get("from"), CHAPTER_SPREAD.media);

  if (access.status === "checking") {
    return (
      <ChapterLoadingScreen
        chapter="Chapter 04 · Retro Digicam"
        title="Developing the film..."
        message="Web-slinging your snapshots into frame."
      />
    );
  }

  if (access.status === "unlinked") {
    return (
      <ChapterLoadingScreen
        chapter="Chapter 04 · Retro Digicam"
        title="Camera's locked"
        message="Link both universes before opening the digicam."
      />
    );
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
    <Suspense
      fallback={
        <ChapterLoadingScreen
          chapter="Chapter 04 · Retro Digicam"
          title="Developing the film..."
          message="Web-slinging your snapshots into frame."
        />
      }
    >
      <MediaPageInner />
    </Suspense>
  );
}
