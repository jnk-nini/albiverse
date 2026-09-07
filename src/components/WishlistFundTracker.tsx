"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, GraduationCap } from "lucide-react";
import { parsePrice } from "@/lib/wishlistLab";
import type { WishlistItem } from "@/components/WishlistScreen";

/* ============================================================================
   SHARED FUND TRACKER - "Parker Tech Funds vs. Stacy Grants"

   A playful bottom-of-screen visualization, not a real budget tool. It looks
   at whether Snapshot-mode or Scientist-mode entries dominate the wishlist
   and leans the visual that direction - a heap of crumpled bills eaten by a
   cartoon camera on one side, clean ascending bars on the other.

   Tilt gently sways the whole strip via DeviceOrientation, gated behind a
   permission button (iOS requires a user gesture before that API can be
   read) - desktop and denied-permission just render static, no error. */

export default function WishlistFundTracker({ items }: { items: WishlistItem[] }) {
  const stats = useMemo(() => {
    let snapshotTotal = 0;
    let snapshotCount = 0;
    let scientistTotal = 0;
    let scientistCount = 0;
    for (const it of items) {
      const amount = parsePrice(it.price);
      if (it.entryMode === "scientist") {
        scientistTotal += amount;
        scientistCount += 1;
      } else {
        snapshotTotal += amount;
        snapshotCount += 1;
      }
    }
    const total = snapshotCount + scientistCount;
    return {
      snapshotTotal,
      snapshotCount,
      scientistTotal,
      scientistCount,
      snapshotShare: total ? snapshotCount / total : 0.5,
    };
  }, [items]);

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
      setTilt(Math.max(-10, Math.min(10, e.gamma / 4)));
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

  if (items.length === 0) return null;

  const snapshotWidthPct = Math.round(stats.snapshotShare * 100);

  return (
    <div className="border-t-4 border-[#261D24] bg-[#20161A] px-4 sm:px-6 py-4">
      <style>{`
        @keyframes wft-chomp { 0%,100% { transform: scaleX(1); } 50% { transform: scaleX(0.82); } }
        .wft-chomp { animation: wft-chomp 0.9s ease-in-out infinite; }
        @keyframes wft-rise { from { transform: scaleY(0.2); } to { transform: scaleY(1); } }
        .wft-rise { animation: wft-rise 0.6s ease-out forwards; transform-origin: bottom; }
        @keyframes wft-scroll { 0% { transform: translateY(0); } 100% { transform: translateY(-50%); } }
        .wft-scroll { animation: wft-scroll 3s linear infinite; }
      `}</style>

      <div className="flex items-center justify-between mb-2">
        <p className="font-mono text-[9px] font-black uppercase tracking-[0.2em] text-[#F2E6D2]/70">
          Shared Fund Tracker
        </p>
        {tiltAvailable && !tiltEnabled && (
          <button
            type="button"
            onClick={enableTilt}
            className="font-mono text-[8px] uppercase tracking-widest text-[#F2E6D2]/50 hover:text-[#F2E6D2] underline cursor-pointer"
          >
            Enable tilt
          </button>
        )}
      </div>

      <div
        className="flex rounded-lg overflow-hidden border-2 border-[#F2E6D2]/20 transition-transform duration-150"
        style={{ transform: `rotate(${tilt}deg)` }}
      >
        {/* Snapshot side */}
        <div
          className="relative bg-[#3a2418] px-3 py-3 flex items-center gap-2 min-w-[38%] transition-all duration-500"
          style={{ width: `${snapshotWidthPct}%` }}
        >
          <Camera className={`w-6 h-6 text-[#E0B1AE] shrink-0 ${stats.snapshotCount > 0 ? "wft-chomp" : ""}`} />
          <div className="min-w-0">
            <p className="font-mono text-[7px] font-black uppercase tracking-wider text-[#E0B1AE]/80 truncate">
              Peter&apos;s Daily Bugle Advance
            </p>
            <div className="flex items-end gap-0.5 h-6 mt-1">
              {Array.from({ length: Math.min(10, stats.snapshotCount) }).map((_, i) => (
                <span
                  key={i}
                  className="wft-rise w-1.5 rounded-sm bg-[#D9A9A4]"
                  style={{ height: `${30 + ((i * 17) % 70)}%`, animationDelay: `${i * 40}ms` }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Scientist side */}
        <div
          className="relative bg-[#16232e] px-3 py-3 flex items-center gap-2 min-w-[38%] flex-1 transition-all duration-500"
        >
          <GraduationCap className="w-6 h-6 text-[#8fb8d6] shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[7px] font-black uppercase tracking-wider text-[#8fb8d6]/80 truncate">
              Gwen&apos;s Academic Scholarship Grants
            </p>
            <div className="h-6 mt-1 overflow-hidden relative font-mono text-[7px] text-[#8fb8d6]/60 leading-3">
              <div className="wft-scroll">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i}>${(stats.scientistTotal + i * 3).toFixed(0)}.00 · n={stats.scientistCount}</div>
                ))}
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={`b-${i}`}>${(stats.scientistTotal + i * 3).toFixed(0)}.00 · n={stats.scientistCount}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
