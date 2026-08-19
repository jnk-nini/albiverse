"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DiaryScreen from "@/components/DiaryScreen";
import { createClient } from "@/lib/supabase/client";

export default function DiaryPage() {
  const router = useRouter();
  const supabase = createClient();
  const [state, setState] = useState<{ userId: string; coupleId: string } | null>(null);
  const [message, setMessage] = useState("Loading your shared diary...");

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
        setMessage("Link both universes before opening the shared diary.");
        return;
      }

      setState({ userId: user.id, coupleId: profile.couple_id });
    };

    loadAccess();
  }, [router, supabase]);

  if (!state) {
    return <main className="min-h-screen bg-[#28313B] text-[#F2E6D2] grid place-items-center p-6 font-mono text-sm">{message}</main>;
  }

  return <DiaryScreen userId={state.userId} coupleId={state.coupleId} onBack={() => router.push("/?view=contents")} />;
}
