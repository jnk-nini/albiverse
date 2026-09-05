"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WishlistScreen from "@/components/WishlistScreen";
import { createClient } from "@/lib/supabase/client";
import { CHAPTER_SPREAD, tocReturnHref } from "@/lib/nav/chapterReturn";

/* CH.10 - SECRET WISHLIST
   Unlike every other chapter, this one is deliberately NOT couple-scoped.
   It reads/writes `partner_vault` (section_type='wishlist'), which is
   RLS-locked to `owner_id = auth.uid()` only - no couple_id anywhere in the
   query, no couple membership check, no realtime broadcast to a partner
   channel. Whoever is signed in sees only their own secret R&D lab, whether
   or not they're even linked to anyone. See CLAUDE.md's "partner_vault is
   NOT couple-shared" rule and albiverse-partner-swap memory for why this
   table exists the way it does. */

const LOADING_SHELL =
  "min-h-screen bg-[#14181A] text-[#F1E2CB] grid place-items-center p-6 font-mono text-sm";

function WishlistPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [userId, setUserId] = useState<string | null>(null);

  const backHref = tocReturnHref(searchParams?.get("from"), CHAPTER_SPREAD.wishlist);

  useEffect(() => {
    const loadAccess = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/");
        return;
      }
      setUserId(user.id);
    };
    loadAccess();
  }, [router, supabase]);

  if (!userId) {
    return <main className={LOADING_SHELL}>Unlocking the classified R&amp;D lab...</main>;
  }

  return <WishlistScreen userId={userId} onBack={() => router.push(backHref)} />;
}

export default function WishlistPage() {
  return (
    <Suspense fallback={<main className={LOADING_SHELL}>Unlocking the classified R&D lab...</main>}>
      <WishlistPageInner />
    </Suspense>
  );
}
