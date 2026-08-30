"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DiaryScreen from "@/components/DiaryScreen";
import { createClient } from "@/lib/supabase/client";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";

/* CH.06 - SPIDER DIARY
   Same shape as the other chapter routes: resolve the signed-in user and their
   couple client-side, bounce to "/" if there is no session, then hand the screen
   only the ids it is allowed to query with.

   `from` carries the table-of-contents spread the reader was looking at when
   they opened this chapter, so BACK returns them to that exact spread instead of
   the front of the book. Chapter 5 does the same thing, and the two chapters
   share a spread, so leaving the jar and leaving the diary land in one place. */

const LOADING_SHELL =
  "min-h-screen bg-[#1A1013] text-[#F1E2CB] grid place-items-center p-6 font-mono text-sm";

function DiaryPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [state, setState] = useState<{
    userId: string;
    coupleId: string;
    myName: string;
    partnerName: string;
  } | null>(null);
  const [message, setMessage] = useState("Rolling a sheet into the machine...");

  const backHref = tocReturnHref(searchParams?.get("from"), CHAPTER_SPREAD.diary);

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
        setMessage("Link both universes before opening the shared diary.");
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
    <DiaryScreen
      userId={state.userId}
      coupleId={state.coupleId}
      myName={state.myName}
      partnerName={state.partnerName}
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
