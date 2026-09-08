"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Atom, Loader2, Send, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";
import { playBam, playThwip, type WishlistSnippet } from "@/lib/wishlistLab";

/* ============================================================================
   MEMORY SNIPPETS - fleeting clues, not full wishlist entries

   A rapid-fire log for the small things a partner drops in passing ("needs a
   new sweater", "mentioned their charger is dying") - too slight to be a
   whole wishlist item, but worth keeping. Two logging styles matching the
   chapter's two personas: a quick THWIP (web-shot graphic + triangle-sweep
   sound) or a precise BAM (academic tag + a sharp double-click sound).

   Backed by its own partner_vault section_type ('wishlist_snippets') so it
   doesn't muddy the wishlist item shape - same owner-only RLS as everything
   else in this table, no migration needed (see WishlistScreen.tsx's own
   note on partner_vault being a schema-less jsonb vault). */

function decodeSnippet(row: Record<string, unknown>): WishlistSnippet {
  const c = (row.content_json as Record<string, unknown>) || {};
  return {
    id: row.id as string,
    text: (c.text as string) || "",
    style: c.style === "academic" ? "academic" : "web",
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

export default function WishlistSnippets({
  userId,
  onCountChange,
}: {
  userId: string;
  onCountChange: (count: number) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [snippets, setSnippets] = useState<WishlistSnippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [webShotPlaying, setWebShotPlaying] = useState(false);
  const [bamFlash, setBamFlash] = useState(false);

  const fetchSnippets = useCallback(async () => {
    const { data, error } = await supabase
      .from("partner_vault")
      .select("*")
      .eq("owner_id", userId)
      .eq("section_type", "wishlist_snippets")
      .order("created_at", { ascending: false });
    if (!error) setSnippets((data || []).map(decodeSnippet));
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    fetchSnippets();
  }, [fetchSnippets]);

  useEffect(() => {
    onCountChange(snippets.length);
  }, [snippets.length, onCountChange]);

  const [runLog, logging] = useGuardedAction(async (style: "web" | "academic") => {
    const text = draft.trim();
    if (!text) return;

    if (style === "web") {
      playThwip();
      setWebShotPlaying(true);
      window.setTimeout(() => setWebShotPlaying(false), 500);
    } else {
      playBam();
      setBamFlash(true);
      window.setTimeout(() => setBamFlash(false), 350);
    }

    setDraft("");
    const { error } = await supabase.from("partner_vault").insert({
      owner_id: userId,
      section_type: "wishlist_snippets",
      key_name: `snippet_${crypto.randomUUID()}`,
      content_json: { text, style },
      media_urls: [],
    });
    if (!error) await fetchSnippets();
  }, 250);

  const [runDelete] = useGuardedAction(async (id: string) => {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
    await supabase.from("partner_vault").delete().eq("id", id).eq("owner_id", userId);
  }, 150);

  return (
    <div className="max-w-2xl mx-auto">
      <style>{`
        @keyframes wsn-web-shot {
          0% { transform: scaleX(0); opacity: 1; }
          70% { transform: scaleX(1); opacity: 1; }
          100% { transform: scaleX(1); opacity: 0; }
        }
        .wsn-web-shot { animation: wsn-web-shot 0.5s ease-out forwards; transform-origin: left center; }
        @keyframes wsn-bam-flash {
          0% { transform: scale(0.6) rotate(-8deg); opacity: 0; }
          40% { transform: scale(1.15) rotate(-8deg); opacity: 1; }
          100% { transform: scale(1) rotate(-8deg); opacity: 0; }
        }
        .wsn-bam-flash { animation: wsn-bam-flash 0.35s ease-out forwards; }
        .wl-snippet-delete { opacity: 0; }
        .group:hover .wl-snippet-delete { opacity: 1; }
        @media (hover: none) {
          .wl-snippet-delete { opacity: 1; }
        }
      `}</style>

      <p className="font-marker text-2xl text-[#7D2834] text-center mb-1">Field Notes</p>
      <p className="font-mono text-[9px] text-stone-500 text-center uppercase tracking-widest mb-4">
        Log a clue the moment you notice it
      </p>

      <div className="relative flex items-start gap-2 mb-6">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="They mentioned their charger keeps dying…"
          maxLength={200}
          rows={2}
          className="flex-1 bg-white border-2 border-[#261D24]/30 focus:border-[#261D24] focus:outline-none px-3 py-2 font-handwriting text-lg text-[#1A0D10] rounded resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              runLog("web");
            }
          }}
        />
        <button
          type="button"
          disabled={!draft.trim() || logging}
          onClick={() => runLog("web")}
          title="Log with a THWIP (Spidey observation)"
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] text-[10px] font-mono font-black uppercase border-2 border-[#261D24] disabled:opacity-40 cursor-pointer"
        >
          {logging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Thwip
        </button>
        <button
          type="button"
          disabled={!draft.trim() || logging}
          onClick={() => runLog("academic")}
          title="Log with a BAM (academic tag)"
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#28455A] hover:bg-[#1c3245] text-[#dcecfa] text-[10px] font-mono font-black uppercase border-2 border-[#1a2c3a] disabled:opacity-40 cursor-pointer"
        >
          <Atom className="w-3.5 h-3.5" />
          Bam
        </button>

        {webShotPlaying && (
          <svg className="absolute -top-3 left-0 w-full h-4 pointer-events-none" preserveAspectRatio="none">
            <line x1="0" y1="8" x2="100%" y2="8" stroke="#7D2834" strokeWidth={2} strokeDasharray="4 3" className="wsn-web-shot" />
          </svg>
        )}
        {bamFlash && (
          <span className="wsn-bam-flash absolute -top-6 right-16 font-marker text-2xl text-[#28455A] pointer-events-none select-none">
            BAM!
          </span>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-[#7D2834]" />
        </div>
      ) : snippets.length === 0 ? (
        <p className="text-center font-mono text-xs text-stone-500 py-10">
          No field notes yet — log the next small thing they mention.
        </p>
      ) : (
        <div className="space-y-2.5">
          {snippets.map((s) => (
            <div
              key={s.id}
              className={`group flex items-start gap-2.5 px-3.5 py-2.5 rounded ${
                s.style === "web"
                  ? "bg-[#f2e6d2] border-l-4 border-[#7D2834]"
                  : "bg-[#eef4f9] border-l-4 border-[#28455A]"
              }`}
            >
              <span className="text-base leading-none mt-0.5">{s.style === "web" ? "🕸️" : "⚛️"}</span>
              <div className="min-w-0 flex-1">
                <p
                  className={
                    s.style === "web"
                      ? "font-handwriting text-lg text-[#3a1f24] leading-tight"
                      : "font-serif text-sm text-[#12222e] leading-snug"
                  }
                >
                  {s.text}
                </p>
                <p className="font-mono text-[8px] uppercase tracking-widest text-stone-500 mt-0.5">
                  {new Date(s.createdAt).toLocaleDateString()} ·{" "}
                  {s.style === "web" ? "Spidey Observation" : "Academic Note"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => runDelete(s.id)}
                aria-label="Delete note"
                className="wl-snippet-delete text-stone-400 hover:text-[#7D2834] transition cursor-pointer shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
