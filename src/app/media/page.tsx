"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DigicamScreen from "@/components/DigicamScreen";
import { createClient } from "@/lib/supabase/client";
import { CHAPTER_SPREAD } from "@/lib/nav/chapterReturn";
import { useTocReturn } from "@/lib/nav/useTocReturn";

/* CH.04 - RETRO DIGICAM
   `from` carries the table-of-contents spread the reader was looking at when
   they opened this chapter, so BACK returns them to that exact spread instead
   of a hardcoded guess at where the chapter lives. */

const LOADING_SHELL =
  "min-h-screen bg-[#181114] text-[#F2E6D2] grid place-items-center p-6 font-mono text-sm";

function MediaPageInner() {
  const router = useRouter();
  const supabase = createClient();
  const backHref = useTocReturn(CHAPTER_SPREAD.media);
  const [state, setState] = useState<{ userId: string; coupleId: string } | null>(null);
  const [message, setMessage] = useState("Loading your digicam...");

  useEffect(() => {
    const loadAccess = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/");
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("couple_id")
        .eq("id", user.id)
        .maybeSingle();

      if (error || !profile?.couple_id) {
        setMessage("Link both universes before opening the digicam.");
        return;
      }

      setState({ userId: user.id, coupleId: profile.couple_id });
    };

    loadAccess();
  }, [router, supabase]);

  if (!state) {
    return <main className={LOADING_SHELL}>{message}</main>;
  }

  return (
    <DigicamScreen
      userId={state.userId}
      coupleId={state.coupleId}
      onBack={() => router.push(backHref)}
    />
  );
}

export default function MediaPage() {
  return (
    <Suspense fallback={<main className={LOADING_SHELL}>Loading your digicam...</main>}>
      <MediaPageInner />
    </Suspense>
  );
}
