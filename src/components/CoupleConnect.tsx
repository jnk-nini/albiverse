"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Copy, HeartHandshake, Sparkles, Check, ShieldAlert, Zap } from "lucide-react";

interface CoupleConnectProps {
  userId: string;
  myInviteCode: string;
  onConnected: () => void;
}

export default function CoupleConnect({ userId, myInviteCode, onConnected }: CoupleConnectProps) {
  const [partnerCode, setPartnerCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  const handleCopy = () => {
    navigator.clipboard.writeText(myInviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLinkPartner = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const cleanCode = partnerCode.trim().toUpperCase();

      if (cleanCode === myInviteCode) {
        throw new Error("You cannot link with your own invite code!");
      }

      // 1. Search for partner by code
      const { data: partnerProfile, error: partnerErr } = await supabase
        .from("profiles")
        .select("id, couple_id")
        .eq("invite_code", cleanCode)
        .maybeSingle();

      if (partnerErr || !partnerProfile) {
        throw new Error("Dimension mismatch: Invalid partner code. Please verify.");
      }

      if (partnerProfile.couple_id) {
        throw new Error("This Spider-Hero is already connected to another universe!");
      }

      /* 2. If these two were ever linked before and unlinked (Dashboard's
         "Unlink" only clears couple_id, it never touches this table - see
         Dashboard.tsx), reattach that same couple row instead of creating a
         blank one, so their old shared scrapbook comes back instead of being
         replaced. A pairing that's never existed between these two still
         creates a fresh row exactly as before. */
      const { data: existingCouple, error: existingErr } = await supabase
        .from("couples")
        .select("id")
        .or(
          `and(partner_1_id.eq.${userId},partner_2_id.eq.${partnerProfile.id}),and(partner_1_id.eq.${partnerProfile.id},partner_2_id.eq.${userId})`
        )
        .maybeSingle();
      if (existingErr) throw existingErr;

      let coupleId: string;
      if (existingCouple) {
        coupleId = existingCouple.id;
      } else {
        const { data: newCouple, error: coupleErr } = await supabase
          .from("couples")
          .insert({
            partner_1_id: userId,
            partner_2_id: partnerProfile.id,
          })
          .select()
          .single();

        if (coupleErr || !newCouple) throw coupleErr;
        coupleId = newCouple.id;
      }

      // 3. Update both users with the shared couple ID
      const { error: profileUpdateError } = await supabase
        .from("profiles")
        .update({ couple_id: coupleId })
        .in("id", [userId, partnerProfile.id]);
      if (profileUpdateError) throw profileUpdateError;

      onConnected();
    } catch (err: any) {
      setError(err.message || "Spider-sense tingling: Failed to link universes.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full max-w-md z-10">
      
      {/* Comic Washi Tape Badge */}
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 tape-red-solid w-44 h-7 rounded-sm rotate-1 z-20 flex items-center justify-center">
        <span className="text-[9px] font-black tracking-widest text-pink-100 uppercase">
          DIMENSIONAL SYNC
        </span>
      </div>

      {/* Main Glass Box */}
      <div className="paper-sheet-solid p-8 shadow-2xl relative">
        
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-red-950/80 text-pink-300 mb-3 border border-pink-400/30 shadow-[0_0_15px_rgba(244,114,182,0.3)]">
            <HeartHandshake className="w-7 h-7 text-pink-400" />
          </div>
          
          <h2 className="text-2xl font-black text-[#1a0d10] flex items-center justify-center gap-2">
            Link Your Universe
            <Sparkles className="w-5 h-5 text-pink-400 animate-pulse" />
          </h2>
          <p className="text-xs text-[#7a1f34] mt-1 font-medium">
            Connect your scrapbook with your partner across the multiverse.
          </p>
        </div>

        {/* Secret Invite Code Card */}
        <div className="p-4 rounded-2xl bg-black/60 border border-pink-400/30 mb-6 text-center shadow-inner">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-pink-300 flex items-center justify-center gap-1.5 mb-1">
            <Zap className="w-3 h-3 text-pink-400" /> Your Secret Web Frequency
          </span>
          
          <div className="flex items-center justify-center gap-3 my-2">
            <span className="text-3xl font-black tracking-[0.25em] text-white font-mono drop-shadow-[0_0_10px_rgba(244,114,182,0.6)]">
              {myInviteCode || "------"}
            </span>
            <button
              onClick={handleCopy}
              className="p-2 rounded-xl bg-red-950/80 hover:bg-red-900 border border-pink-400/40 text-pink-200 transition active:scale-95 cursor-pointer"
              title="Copy Frequency Code"
            >
              {copied ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4 text-pink-300" />
              )}
            </button>
          </div>
          
          <p className="text-[11px] text-pink-100 font-medium">
            Share this code with your partner so they can join your story.
          </p>
        </div>

        {/* Enter Partner Code Form */}
        <form onSubmit={handleLinkPartner} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#7a1f34] text-center mb-1.5">
              Or Enter Partner&apos;s Web Code
            </label>
            <input
              type="text"
              required
              maxLength={6}
              value={partnerCode}
              onChange={(e) => setPartnerCode(e.target.value.toUpperCase())}
              placeholder="ENTER 6-DIGIT CODE"
              className="w-full text-center tracking-[0.2em] font-mono font-black text-xl py-3 rounded-xl bg-black/50 border border-pink-400/40 focus:border-red-500 focus:ring-2 focus:ring-red-700/40 outline-none text-white placeholder:text-pink-200/25 placeholder:tracking-normal placeholder:font-sans placeholder:text-xs transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading || partnerCode.length < 6}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-red-800 via-rose-900 to-red-800 hover:from-red-700 hover:to-rose-800 text-pink-50 font-bold tracking-wide shadow-[0_0_20px_rgba(185,28,28,0.5)] transition duration-200 active:scale-[0.98] disabled:opacity-40 text-sm cursor-pointer border border-pink-400/40 flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-pink-300" />
            {loading ? "Aligning Dimensions..." : "Connect Scrapbooks"}
          </button>
        </form>

        {/* Error Alert */}
        {error && (
          <div className="mt-4 p-3 rounded-xl bg-red-950/90 border border-red-500/50 text-xs text-pink-200 text-center font-medium flex items-center justify-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 text-pink-400" />
            {error}
          </div>
        )}

      </div>
    </div>
  );
}