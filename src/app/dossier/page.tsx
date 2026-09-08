"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DossierScreen from "@/components/DossierScreen";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";
import { useChapterAccess } from "@/lib/hooks/useChapterAccess";

/* CH.11 - CLASSIFIED PERSONNEL DOSSIER: SUBJECT EARTH-65
   ----------------------------------------------------------------------------
   Deliberately gender-neutral: this chapter used to be "About Him" (route
   /about-him, "Classified Peter Parker Intel"), which only reads right for one
   of the two people who use this app. Whoever is signed in keeps a private
   file on their other half, so the copy addresses "your partner" rather than
   naming a side of the couple.

   Like Ch.10, and unlike every couple-shared chapter, this reads and writes
   `partner_vault` (section_type='dossier') filtered by `owner_id` only - no
   couple_id anywhere, no membership check, no partner channel. Hence
   `useChapterAccess(false)`: it resolves the reader without demanding they be
   linked to anyone, so the dossier works before a pairing exists and survives
   an unlink. See CLAUDE.md's "partner_vault is NOT couple-shared" rule. */

const LOADING_SHELL =
  "min-h-screen bg-[#0A0E13] text-[#E7EDF3] grid place-items-center p-6 font-mono text-sm";

function DossierPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const access = useChapterAccess(false);

  const backHref = tocReturnHref(searchParams?.get("from"), CHAPTER_SPREAD.dossier);

  if (access.status === "checking") {
    return <main className={LOADING_SHELL}>Unsealing the classified file...</main>;
  }

  return <DossierScreen userId={access.identity.userId} onBack={() => router.push(backHref)} />;
}

export default function DossierPage() {
  return (
    <Suspense fallback={<main className={LOADING_SHELL}>Unsealing the classified file...</main>}>
      <DossierPageInner />
    </Suspense>
  );
}
