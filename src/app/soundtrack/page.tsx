"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SoundtrackScreen from "@/components/SoundtrackScreen";
import { createClient } from "@/lib/supabase/client";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";

/* CH.09 - SOUNDTRACK DECK
   Same shape as the other chapter routes: resolve the signed-in user and their
   couple client-side, bounce to "/" if there is no session, then hand the
   screen only the ids it is allowed to query with.

   Two query params matter here:
     from  the table-of-contents spread the reader opened this chapter from, so
           the torn ticket stub inside the chapter returns them to it
     tape  a mixtape's share_slug, set by the QR sticker, so a scanned code
           opens straight onto that tape */

const LOADING_SHELL =
  "min-h-screen bg-[#4B3524] text-[#FFE7C6] grid place-items-center p-6 font-mono text-sm";

function SoundtrackPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [state, setState] = useState<{
    userId: string;
    coupleId: string;
    myName: string;
    partnerName: string;
  } | null>(null);
  const [message, setMessage] = useState("Threading the tape onto the reels...");

  const backHref = tocReturnHref(searchParams?.get("from"), CHAPTER_SPREAD.soundtrack);
  const openSlug = searchParams?.get("tape") ?? null;

  useEffect(() => {
    const loadAccess = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/");
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("couple_id, full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (error || !profile?.couple_id) {
        setMessage("Link both universes before opening the soundtrack deck.");
        return;
      }

      const { data: couple } = await supabase
        .from("couples")
        .select("partner_1_id, partner_2_id")
        .eq("id", profile.couple_id)
        .maybeSingle();

      const partnerId =
        couple?.partner_1_id === user.id ? couple?.partner_2_id : couple?.partner_1_id;

      let partnerName = "Your partner";
      if (partnerId) {
        const { data: partner } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", partnerId)
          .maybeSingle();
        if (partner?.full_name) partnerName = partner.full_name;
      }

      setState({
        userId: user.id,
        coupleId: profile.couple_id,
        myName: profile.full_name || "Me",
        partnerName,
      });
    };

    loadAccess();
  }, [router, supabase]);

  if (!state) {
    return <main className={LOADING_SHELL}>{message}</main>;
  }

  return (
    <SoundtrackScreen
      userId={state.userId}
      coupleId={state.coupleId}
      myName={state.myName}
      partnerName={state.partnerName}
      openSlug={openSlug}
      onBack={() => router.push(backHref)}
    />
  );
}

export default function SoundtrackPage() {
  return (
    <Suspense
      fallback={<main className={LOADING_SHELL}>Threading the tape onto the reels...</main>}
    >
      <SoundtrackPageInner />
    </Suspense>
  );
}
