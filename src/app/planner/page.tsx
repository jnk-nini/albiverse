"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PlannerScreen from "@/components/PlannerScreen";
import { createClient } from "@/lib/supabase/client";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";

/* CH.07 - WEB PLANNER
   Same shape as every other chapter route: resolve the signed-in user and
   their couple client-side, bounce to "/" if there is no session, then hand
   the screen only the ids it needs. `from` carries the table-of-contents
   spread the reader opened this chapter from - see chapterReturn.ts. */

const LOADING_SHELL =
  "min-h-screen bg-[#191116] text-[#F1E2CB] grid place-items-center p-6 font-mono text-sm";

function PlannerPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [state, setState] = useState<{
    userId: string;
    coupleId: string;
    partnerId: string | null;
    myName: string;
    partnerName: string;
  } | null>(null);
  const [message, setMessage] = useState("Unrolling the shared calendar...");

  const backHref = tocReturnHref(searchParams?.get("from"), CHAPTER_SPREAD.planner);

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
        setMessage("Link both universes before opening the shared calendar.");
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
        partnerId: partnerId || null,
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
    <PlannerScreen
      userId={state.userId}
      coupleId={state.coupleId}
      partnerId={state.partnerId}
      myName={state.myName}
      partnerName={state.partnerName}
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
