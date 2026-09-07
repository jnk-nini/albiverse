"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Camera,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";
import { parsePrice, playBondSnap, playPop } from "@/lib/wishlistLab";
import type { WishlistItem } from "@/components/WishlistScreen";

/* ============================================================================
   SHARED FUND TRACKER - "Parker Tech Funds vs. Stacy Grants"

   This used to be a purely decorative strip: a coin pile and a bar chart whose
   sizes came from how many wishlist entries happened to be filed in Snapshot
   vs Scientist mode. Nothing to press, nothing to change, and the numbers on
   it were not money anyone had actually put aside.

   It is now a real (if playful) savings tracker. You can set a goal, log what
   you have squirrelled away toward it, and watch the split fill up. The two
   sides keep their personas — money you tuck away is either a "Bugle advance"
   or a "scholarship grant" — but the amounts are yours now, not a side effect
   of how you happened to enter a wishlist item.

   DATA: `partner_vault`, section_type `wishlist_fund`, keyed by `owner_id`
   like every other part of Ch.10. No migration: partner_vault is a
   schema-less jsonb vault with no CHECK on section_type, and the goal lives
   in one singleton row while each deposit is its own row. Nothing here writes
   a blob, opens an API route, or calls anything metered, so it adds no cost
   or abuse surface. Everything is inside the existing owner-only RLS policy
   (`auth.uid() = owner_id`), which is what actually keeps it private.

   Tilt sways the strip via DeviceOrientation, gated behind a permission
   button (iOS requires a user gesture before that API can be read) — desktop
   and denied-permission just render static, no error. */

const GOAL_KEY = "wishlist_fund_goal_singleton";

type Side = "snapshot" | "scientist";

interface Deposit {
  id: string;
  amount: number;
  side: Side;
  note: string;
  createdAt: string;
}

interface FundGoal {
  label: string;
  target: number;
}

function decodeDeposit(row: Record<string, unknown>): Deposit {
  const c = (row.content_json as Record<string, unknown>) || {};
  const amount = Number(c.amount);
  return {
    id: row.id as string,
    amount: Number.isFinite(amount) ? amount : 0,
    side: c.side === "scientist" ? "scientist" : "snapshot",
    note: (c.note as string) || "",
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

function money(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: n % 1 === 0 ? 0 : 2 });
}

export default function WishlistFundTracker({
  items,
  userId,
}: {
  items: WishlistItem[];
  userId: string;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [goal, setGoal] = useState<FundGoal | null>(null);
  const [goalRowId, setGoalRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState(false);
  const [composing, setComposing] = useState<Side | null>(null);
  const [amountDraft, setAmountDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalLabelDraft, setGoalLabelDraft] = useState("");
  const [goalTargetDraft, setGoalTargetDraft] = useState("");

  const fetchFund = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("partner_vault")
      .select("*")
      .eq("owner_id", userId)
      .in("section_type", ["wishlist_fund", "wishlist_fund_goal"])
      .order("created_at", { ascending: false });

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const rows = data || [];
    const goalRow = rows.find((r) => r.section_type === "wishlist_fund_goal");
    if (goalRow) {
      const c = (goalRow.content_json as Record<string, unknown>) || {};
      const target = Number(c.target);
      setGoalRowId(goalRow.id as string);
      setGoal({
        label: (c.label as string) || "Our next surprise",
        target: Number.isFinite(target) && target > 0 ? target : 0,
      });
    } else {
      setGoalRowId(null);
      setGoal(null);
    }

    setDeposits(rows.filter((r) => r.section_type === "wishlist_fund").map(decodeDeposit));
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    fetchFund();
  }, [fetchFund]);

  /* ------------------------------------------------------------- totals --- */

  const stats = useMemo(() => {
    let snapshot = 0;
    let scientist = 0;
    for (const d of deposits) {
      if (d.side === "scientist") scientist += d.amount;
      else snapshot += d.amount;
    }
    const saved = snapshot + scientist;

    /* What the still-unbought wishlist is estimated to cost, so the goal has a
       sensible suggested target even before one is set by hand. */
    const wishlistEstimate = items
      .filter((i) => !i.isPurchased)
      .reduce((sum, i) => sum + parsePrice(i.price), 0);

    const target = goal?.target || 0;
    return {
      snapshot,
      scientist,
      saved,
      wishlistEstimate,
      target,
      remaining: Math.max(0, target - saved),
      pct: target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0,
      /* Split of the bar between the two personas; an empty fund sits evenly. */
      snapshotShare: saved > 0 ? snapshot / saved : 0.5,
    };
  }, [deposits, items, goal]);

  /* -------------------------------------------------------------- writes --- */

  const [runDeposit, depositing] = useGuardedAction(async (side: Side) => {
    const amount = Number(amountDraft.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter an amount above zero.");
      return;
    }
    setError(null);
    playPop();

    const { error: insertError } = await supabase.from("partner_vault").insert({
      owner_id: userId,
      section_type: "wishlist_fund",
      key_name: `fund_${crypto.randomUUID()}`,
      content_json: { amount, side, note: noteDraft.trim().slice(0, 120) },
      media_urls: [],
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setAmountDraft("");
    setNoteDraft("");
    setComposing(null);
    await fetchFund();
  }, 300);

  const [runDeleteDeposit] = useGuardedAction(async (id: string) => {
    setDeposits((prev) => prev.filter((d) => d.id !== id));
    const { error: delError } = await supabase
      .from("partner_vault")
      .delete()
      .eq("id", id)
      .eq("owner_id", userId);
    if (delError) {
      setError(delError.message);
      await fetchFund();
    }
  }, 200);

  const [runSaveGoal, savingGoal] = useGuardedAction(async () => {
    const target = Number(goalTargetDraft.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(target) || target <= 0) {
      setError("Give the goal an amount above zero.");
      return;
    }
    setError(null);
    const content = { label: goalLabelDraft.trim().slice(0, 60) || "Our next surprise", target };

    const { error: writeError } = goalRowId
      ? await supabase
          .from("partner_vault")
          .update({ content_json: content })
          .eq("id", goalRowId)
          .eq("owner_id", userId)
      : await supabase.from("partner_vault").insert({
          owner_id: userId,
          section_type: "wishlist_fund_goal",
          key_name: GOAL_KEY,
          content_json: content,
          media_urls: [],
        });

    if (writeError) {
      setError(writeError.message);
      return;
    }
    playBondSnap();
    setEditingGoal(false);
    await fetchFund();
  }, 300);

  const openGoalEditor = () => {
    setGoalLabelDraft(goal?.label ?? "");
    setGoalTargetDraft(
      goal?.target ? String(goal.target) : stats.wishlistEstimate ? String(Math.round(stats.wishlistEstimate)) : ""
    );
    setEditingGoal(true);
    setExpanded(true);
  };

  /* ---------------------------------------------------------------- tilt --- */

  const [tilt, setTilt] = useState(0);
  const [tiltEnabled, setTiltEnabled] = useState(false);
  const [tiltAvailable, setTiltAvailable] = useState(false);

  useEffect(() => {
    setTiltAvailable(typeof window !== "undefined" && "DeviceOrientationEvent" in window);
  }, []);

  useEffect(() => {
    if (!tiltEnabled) return;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null) return;
      setTilt(Math.max(-6, Math.min(6, e.gamma / 6)));
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [tiltEnabled]);

  const enableTilt = () => {
    const RequestableOrientationEvent = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof RequestableOrientationEvent?.requestPermission === "function") {
      RequestableOrientationEvent.requestPermission()
        .then((state) => setTiltEnabled(state === "granted"))
        .catch(() => {});
    } else {
      setTiltEnabled(true);
    }
  };

  /* -------------------------------------------------------------- render --- */

  const snapshotWidthPct = Math.round(stats.snapshotShare * 100);

  return (
    <div className="border-t-4 border-[#261D24] bg-[#20161A] px-3 sm:px-6 py-3 sm:py-4">
      <style>{`
        @keyframes wft-chomp { 0%,100% { transform: scaleX(1); } 50% { transform: scaleX(0.82); } }
        .wft-chomp { animation: wft-chomp 0.9s ease-in-out infinite; }
        @keyframes wft-rise { from { transform: scaleY(0.2); } to { transform: scaleY(1); } }
        .wft-rise { animation: wft-rise 0.6s ease-out forwards; transform-origin: bottom; }
        @keyframes wft-fill { from { width: 0; } }
        .wft-fill { animation: wft-fill 0.8s cubic-bezier(.2,.8,.3,1); }
      `}</style>

      {/* ---------------- header row ---------------- */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex items-center gap-2 min-w-0 cursor-pointer group"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#F2E6D2]/60 shrink-0" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-[#F2E6D2]/60 shrink-0" />
          )}
          <span className="font-mono text-[9px] font-black uppercase tracking-[0.2em] text-[#F2E6D2]/70 group-hover:text-[#F2E6D2] truncate">
            Shared Fund Tracker
          </span>
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin text-[#F2E6D2]/40 shrink-0" />
          ) : (
            <span className="font-handwriting text-lg text-[#ECA8B8] leading-none shrink-0">
              ${money(stats.saved)}
              {stats.target > 0 && (
                <span className="text-[#F2E6D2]/40"> / ${money(stats.target)}</span>
              )}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2 shrink-0">
          {tiltAvailable && !tiltEnabled && (
            <button
              type="button"
              onClick={enableTilt}
              className="font-mono text-[8px] uppercase tracking-widest text-[#F2E6D2]/40 hover:text-[#F2E6D2] underline cursor-pointer hidden sm:inline"
            >
              Tilt
            </button>
          )}
          <button
            type="button"
            onClick={openGoalEditor}
            title={goal ? "Change the goal" : "Set a goal"}
            className="inline-flex items-center gap-1 px-2 py-1 border border-[#F2E6D2]/25 rounded-sm font-mono text-[8px] font-black uppercase tracking-widest text-[#F2E6D2]/70 hover:text-[#F2E6D2] hover:border-[#F2E6D2]/60 cursor-pointer"
          >
            {goal ? <Pencil className="w-3 h-3" /> : <Target className="w-3 h-3" />}
            <span className="hidden sm:inline">{goal ? "Goal" : "Set goal"}</span>
          </button>
        </div>
      </div>

      {/* ---------------- goal progress ---------------- */}
      {goal && stats.target > 0 && (
        <div className="mb-2">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="font-handwriting text-base text-[#F2E6D2]/90 truncate">{goal.label}</span>
            <span className="font-mono text-[8px] uppercase tracking-widest text-[#F2E6D2]/50 shrink-0">
              {stats.remaining > 0 ? `$${money(stats.remaining)} to go` : "Funded 🎉"}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[#171B22] border border-[#F2E6D2]/15 overflow-hidden">
            <div
              className="wft-fill h-full bg-gradient-to-r from-[#7D2834] via-[#D9A9A4] to-[#8fb8d6] transition-all duration-500"
              style={{ width: `${stats.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* ---------------- the two-sided strip ---------------- */}
      <div
        className="flex rounded-lg overflow-hidden border-2 border-[#F2E6D2]/20 transition-transform duration-150"
        style={{ transform: `rotate(${tilt}deg)` }}
      >
        {/* Snapshot side */}
        <button
          type="button"
          onClick={() => {
            setComposing("snapshot");
            setExpanded(true);
          }}
          className="relative bg-[#3a2418] hover:bg-[#4a2e1f] pl-3 pr-6 py-3 flex items-center gap-2 min-w-[38%] transition-all duration-500 text-left cursor-pointer"
          style={{ width: `${snapshotWidthPct}%` }}
        >
          <Camera
            className={`w-6 h-6 text-[#E0B1AE] shrink-0 ${stats.snapshot > 0 ? "wft-chomp" : ""}`}
          />
          <div className="min-w-0">
            <p className="font-mono text-[7px] font-black uppercase tracking-wider text-[#E0B1AE]/80 truncate">
              Peter&apos;s Daily Bugle Advance
            </p>
            <p className="font-handwriting text-lg text-[#F2E6D2] leading-none mt-0.5">
              ${money(stats.snapshot)}
            </p>
            <div className="flex items-end gap-0.5 h-3 mt-1">
              {Array.from({ length: Math.min(10, deposits.filter((d) => d.side === "snapshot").length) }).map(
                (_, i) => (
                  <span
                    key={i}
                    className="wft-rise w-1.5 rounded-sm bg-[#D9A9A4]"
                    style={{ height: `${30 + ((i * 17) % 70)}%`, animationDelay: `${i * 40}ms` }}
                  />
                )
              )}
            </div>
          </div>
          <Plus className="w-3.5 h-3.5 text-[#E0B1AE]/50 absolute top-1.5 right-1.5" />
        </button>

        {/* Scientist side */}
        <button
          type="button"
          onClick={() => {
            setComposing("scientist");
            setExpanded(true);
          }}
          className="relative bg-[#16232e] hover:bg-[#1d2f3d] pl-3 pr-6 py-3 flex items-center gap-2 min-w-[38%] flex-1 transition-all duration-500 text-left cursor-pointer"
        >
          <GraduationCap className="w-6 h-6 text-[#8fb8d6] shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[7px] font-black uppercase tracking-wider text-[#8fb8d6]/80 truncate">
              Gwen&apos;s Academic Scholarship Grants
            </p>
            <p className="font-handwriting text-lg text-[#F2E6D2] leading-none mt-0.5">
              ${money(stats.scientist)}
            </p>
            <p className="font-mono text-[7px] text-[#8fb8d6]/60 mt-1">
              n={deposits.filter((d) => d.side === "scientist").length}
            </p>
          </div>
          <Plus className="w-3.5 h-3.5 text-[#8fb8d6]/50 absolute top-1.5 right-1.5" />
        </button>
      </div>

      {!expanded && !loading && deposits.length === 0 && (
        <p className="font-mono text-[8px] uppercase tracking-widest text-[#F2E6D2]/35 mt-2 text-center">
          Tap a side to put something aside
        </p>
      )}

      {/* ---------------- expanded panel ---------------- */}
      {expanded && (
        <div className="mt-3 border-t border-[#F2E6D2]/15 pt-3">
          {error && (
            <p className="mb-2 font-mono text-[9px] text-[#ffb4b4] bg-[#4a1119] border border-[#7D2834] px-2 py-1.5 rounded">
              {error}
            </p>
          )}

          {/* goal editor */}
          {editingGoal && (
            <div className="mb-3 p-3 bg-[#171B22] border border-[#F2E6D2]/15 rounded">
              <p className="font-mono text-[8px] font-black uppercase tracking-[0.2em] text-[#F2E6D2]/60 mb-2">
                What are you saving toward?
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={goalLabelDraft}
                  onChange={(e) => setGoalLabelDraft(e.target.value)}
                  placeholder="Anniversary trip"
                  maxLength={60}
                  className="flex-1 bg-[#20161A] border border-[#F2E6D2]/25 focus:border-[#ECA8B8] outline-none px-2.5 py-2 font-handwriting text-lg text-[#F2E6D2] rounded"
                />
                <input
                  value={goalTargetDraft}
                  onChange={(e) => setGoalTargetDraft(e.target.value)}
                  inputMode="decimal"
                  placeholder="500"
                  className="sm:w-28 bg-[#20161A] border border-[#F2E6D2]/25 focus:border-[#ECA8B8] outline-none px-2.5 py-2 font-mono text-sm text-[#F2E6D2] rounded"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => runSaveGoal()}
                    disabled={savingGoal}
                    className="flex-1 sm:flex-none px-3 py-2 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] font-mono text-[10px] font-black uppercase tracking-wider border border-[#261D24] disabled:opacity-40 cursor-pointer rounded"
                  >
                    {savingGoal ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingGoal(false)}
                    className="px-2 py-2 text-[#F2E6D2]/50 hover:text-[#F2E6D2] cursor-pointer"
                    aria-label="Cancel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {stats.wishlistEstimate > 0 && (
                <p className="font-mono text-[8px] text-[#F2E6D2]/40 mt-2">
                  Everything still on the wishlist adds up to about $
                  {money(Math.round(stats.wishlistEstimate))}.
                </p>
              )}
            </div>
          )}

          {/* deposit composer */}
          {composing && (
            <div
              className={`mb-3 p-3 border rounded ${
                composing === "snapshot"
                  ? "bg-[#2a1911] border-[#E0B1AE]/30"
                  : "bg-[#111c25] border-[#8fb8d6]/30"
              }`}
            >
              <p className="font-mono text-[8px] font-black uppercase tracking-[0.2em] text-[#F2E6D2]/60 mb-2">
                {composing === "snapshot" ? "Add to the Bugle advance" : "Add to the scholarship grants"}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={amountDraft}
                  onChange={(e) => setAmountDraft(e.target.value)}
                  inputMode="decimal"
                  autoFocus
                  placeholder="25"
                  className="sm:w-28 bg-[#20161A] border border-[#F2E6D2]/25 focus:border-[#ECA8B8] outline-none px-2.5 py-2 font-mono text-sm text-[#F2E6D2] rounded"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runDeposit(composing);
                  }}
                />
                <input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Skipped takeaway this week"
                  maxLength={120}
                  className="flex-1 bg-[#20161A] border border-[#F2E6D2]/25 focus:border-[#ECA8B8] outline-none px-2.5 py-2 font-handwriting text-lg text-[#F2E6D2] rounded"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runDeposit(composing);
                  }}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => runDeposit(composing)}
                    disabled={depositing || !amountDraft.trim()}
                    className="flex-1 sm:flex-none px-3 py-2 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] font-mono text-[10px] font-black uppercase tracking-wider border border-[#261D24] disabled:opacity-40 cursor-pointer rounded"
                  >
                    {depositing ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : "Stash it"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposing(null)}
                    className="px-2 py-2 text-[#F2E6D2]/50 hover:text-[#F2E6D2] cursor-pointer"
                    aria-label="Cancel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ledger */}
          {loading ? (
            <div className="py-6 text-center">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-[#ECA8B8]" />
            </div>
          ) : deposits.length === 0 ? (
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#F2E6D2]/35 text-center py-4">
              Nothing stashed yet — tap either side above to start
            </p>
          ) : (
            <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
              {deposits.map((d) => (
                <div
                  key={d.id}
                  className="group flex items-center gap-2 px-2.5 py-1.5 rounded bg-[#171B22] border-l-2"
                  style={{ borderLeftColor: d.side === "snapshot" ? "#D9A9A4" : "#8fb8d6" }}
                >
                  <span className="text-sm leading-none shrink-0">
                    {d.side === "snapshot" ? "📷" : "🎓"}
                  </span>
                  <span className="font-mono text-xs font-black text-[#F2E6D2] shrink-0 tabular-nums">
                    ${money(d.amount)}
                  </span>
                  <span className="font-handwriting text-base text-[#F2E6D2]/70 truncate flex-1 min-w-0">
                    {d.note || "—"}
                  </span>
                  <span className="font-mono text-[8px] text-[#F2E6D2]/35 shrink-0 hidden sm:inline">
                    {new Date(d.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => runDeleteDeposit(d.id)}
                    aria-label="Remove this deposit"
                    className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 text-[#F2E6D2]/50 hover:text-[#ECA8B8] transition cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
