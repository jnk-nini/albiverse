"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LetterJarScreen from "@/components/LetterJarScreen";
import { createClient } from "@/lib/supabase/client";

/* CH.05 - LOVE LETTER JAR
   Same shape as the other chapter routes: resolve the signed-in user and their
   couple client-side, bounce to "/" if there is no session, then hand the screen
   only the ids it is allowed to query with.

   The one addition is `from`: the table of contents passes the spread the reader
   was looking at when they opened this chapter, so BACK returns them to that
   exact spread instead of the first page of the book. */

const LETTERS_SPREAD = 2; // Ch.05 lives on the third spread, used when `from` is absent

function LettersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [state, setState] = useState<{
    userId: string;
    coupleId: string;
    myName: string;
    partnerId: string | null;
    partnerName: string;
  } | null>(null);
  const [message, setMessage] = useState("Unsealing the letter jar...");

  const fromParam = searchParams?.get("from");
  const parsedFrom = fromParam === null || fromParam === undefined ? NaN : parseInt(fromParam, 10);
  const backSpread = Number.isNaN(parsedFrom) ? LETTERS_SPREAD : Math.max(0, parsedFrom);

  useEffect(() => {
    const loadAccess = async () => {
      const { data: { user } } = await supabase.auth.getUser();
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
        setMessage("Link both universes before opening the letter jar.");
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
        partnerId: partnerId ?? null,
        partnerName,
      });
    };

    loadAccess();
  }, [router, supabase]);

  if (!state) {
    return (
      <main className="min-h-screen bg-[#181114] text-[#F2E6D2] grid place-items-center p-6 font-mono text-sm">
        {message}
      </main>
    );
  }

  return (
    <LetterJarScreen
      userId={state.userId}
      coupleId={state.coupleId}
      myName={state.myName}
      partnerId={state.partnerId}
      partnerName={state.partnerName}
      onBack={() => router.push(`/?opened=true&spread=${backSpread}`)}
    />
  );
}

export default function LettersPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#181114] text-[#F2E6D2] grid place-items-center p-6 font-mono text-sm">
          Unsealing the letter jar...
        </main>
      }
    >
      <LettersPageInner />
    </Suspense>
  );
}
