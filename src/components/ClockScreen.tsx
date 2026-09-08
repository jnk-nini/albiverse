"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import FlipDigitUnit from "./FlipDigitUnit";
import { 
  Heart, 
  Sparkles, 
  ArrowLeft, 
  Calendar, 
  Check, 
  Edit3, 
  Loader2,
  AlertCircle 
} from "lucide-react";

interface ClockScreenProps {
  userId: string;
  coupleId: string;
  initialAnniversary?: string | null;
  /* Where BACK goes. The route resolves it from the `?from=` spread the table
     of contents handed over, so leaving lands on the page you opened from. */
  backHref?: string;
}

interface TimeBreakdown {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isUpcoming: boolean;
}

export default function ClockScreen({
  userId,
  coupleId,
  initialAnniversary,
  backHref = "/?opened=true&spread=0",
}: ClockScreenProps) {
  const [anniversaryDate, setAnniversaryDate] = useState<string>(
    initialAnniversary ? initialAnniversary.substring(0, 10) : "2024-01-01"
  );
  const [fullTimestamp, setFullTimestamp] = useState<string>(
    initialAnniversary || new Date().toISOString()
  );

  const [timeUnits, setTimeUnits] = useState<TimeBreakdown>({
    years: 0,
    months: 0,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    isUpcoming: false,
  });

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialAnniversary);
  const [screenSpiders, setScreenSpiders] = useState<{ id: number; x: number; y: number; emoji: string }[]>([]);

  const supabase = createClient();

  useEffect(() => {
    async function loadCoupleData() {
      if (!coupleId) return;
      try {
        const { data, error: fetchErr } = await supabase
          .from("couples")
          .select("anniversary_timestamp")
          .eq("id", coupleId)
          .single();

        if (fetchErr) throw fetchErr;
        if (data?.anniversary_timestamp) {
          setFullTimestamp(data.anniversary_timestamp);
          setAnniversaryDate(data.anniversary_timestamp.substring(0, 10));
        }
      } catch (err: any) {
        setError(err.message || "Failed to load timeline.");
      } finally {
        setLoading(false);
      }
    }

    if (!initialAnniversary) {
      loadCoupleData();
    }
  }, [coupleId, initialAnniversary, supabase]);

  // Live Timer updating every second
  useEffect(() => {
    const updateCounter = () => {
      const start = new Date(fullTimestamp);
      const now = new Date();

      // The anniversary can be set in the future (not canon yet). Diffing
      // start-now unconditionally assumes start is always in the past, which
      // sends days/months negative and makes the borrow-a-month-below wrap
      // around into a bogus "11 months" instead of counting down to it - so
      // always diff the earlier date from the later one, and remember which
      // direction it went.
      const isUpcoming = start.getTime() > now.getTime();
      const earlier = isUpcoming ? now : start;
      const later = isUpcoming ? start : now;

      let years = later.getFullYear() - earlier.getFullYear();
      let months = later.getMonth() - earlier.getMonth();
      let days = later.getDate() - earlier.getDate();
      let hours = later.getHours() - earlier.getHours();
      let minutes = later.getMinutes() - earlier.getMinutes();
      let seconds = later.getSeconds() - earlier.getSeconds();

      if (seconds < 0) {
        seconds += 60;
        minutes -= 1;
      }
      if (minutes < 0) {
        minutes += 60;
        hours -= 1;
      }
      if (hours < 0) {
        hours += 24;
        days -= 1;
      }
      if (days < 0) {
        const prevMonth = new Date(later.getFullYear(), later.getMonth(), 0);
        days += prevMonth.getDate();
        months -= 1;
      }
      if (months < 0) {
        months += 12;
        years -= 1;
      }

      setTimeUnits({
        years: Math.max(0, years),
        months: Math.max(0, months),
        days: Math.max(0, days),
        hours: Math.max(0, hours),
        minutes: Math.max(0, minutes),
        seconds: Math.max(0, seconds),
        isUpcoming,
      });
    };

    updateCounter();
    const interval = setInterval(updateCounter, 1000);
    return () => clearInterval(interval);
  }, [fullTimestamp]);

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const emojis = ["🕷️", "🕸️", "✨", "🎀"];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    const newSpider = { id: Date.now(), x, y, emoji: randomEmoji };

    setScreenSpiders((prev) => [...prev.slice(-8), newSpider]);
    setTimeout(() => {
      setScreenSpiders((prev) => prev.filter((s) => s.id !== newSpider.id));
    }, 1200);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      // anniversaryDate is a plain "YYYY-MM-DD" from <input type="date">.
      // new Date("YYYY-MM-DD") parses that as UTC midnight, not local midnight -
      // appending a bare time makes the Date constructor treat it as local
      // instead, so the picked calendar day survives regardless of timezone.
      const isoTimestamp = new Date(`${anniversaryDate}T00:00:00`).toISOString();
      const { error: updateErr } = await supabase
        .from("couples")
        .update({ anniversary_timestamp: isoTimestamp })
        .eq("id", coupleId);

      if (updateErr) throw updateErr;

      setFullTimestamp(isoTimestamp);
      setIsEditing(false);
    } catch (err: any) {
      setError(err.message || "Failed to update anniversary date.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-[#28313B]">
        <div className="paper-sheet-solid p-6 flex items-center gap-3 border-3 border-[#261D24] shadow-[8px_8px_0_#171B22]">
          <Loader2 className="w-5 h-5 animate-spin text-[#7D2834]" />
          <span className="font-mono text-xs font-black uppercase text-[#261D24]">
            Opening Multiverse Page...
          </span>
        </div>
      </main>
    );
  }

  return (
    <main 
      onClick={handleStageClick}
      className="min-h-screen p-3 sm:p-6 lg:p-8 flex flex-col justify-between relative overflow-hidden select-none bg-[#28313B]"
    >
      {/* Cute Crawling Spiders across the Screen */}
      <div className="fixed top-8 animate-crawl-h text-xl z-20 pointer-events-none">🕷️</div>
      <div className="fixed animate-crawl-d text-2xl z-20 pointer-events-none">🕷️</div>
      <div className="fixed left-4 animate-crawl-v text-lg z-20 pointer-events-none">🕷️</div>
      <div className="fixed right-6 animate-crawl-v text-xl z-20 pointer-events-none" style={{ animationDelay: "-8s" }}>🕷️</div>

      {/* Hanging Spiders with Threads */}
      <div className="fixed top-0 left-16 sm:left-28 z-20 pointer-events-none animate-hanging-bounce">
        <div className="w-[2px] h-28 bg-[#BD7F89] mx-auto border-l border-dashed border-white/60" />
        <div className="text-xl -mt-1 text-center">🕷️</div>
      </div>
      <div className="fixed top-0 right-16 sm:right-32 z-20 pointer-events-none animate-hanging-bounce" style={{ animationDelay: "-1.8s" }}>
        <div className="w-[2px] h-36 bg-[#BD7F89] mx-auto border-l border-dashed border-white/60" />
        <div className="text-xl -mt-1 text-center">🕷️</div>
      </div>

      {/* Top Paper Bookmark Navigation */}
      <header className="max-w-5xl mx-auto w-full z-30 flex items-center justify-between">
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#F2E6D2] hover:bg-[#FAF7F2] text-[#261D24] text-xs font-mono font-black border-3 border-[#261D24] shadow-[4px_4px_0_#171B22] -rotate-2 hover:rotate-0 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-[#7D2834]" strokeWidth={3} />
          <span className="tracking-wider uppercase">Table of Contents</span>
        </Link>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(!isEditing);
          }}
          className="px-4 py-2 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] text-xs font-mono font-black border-3 border-[#261D24] shadow-[4px_4px_0_#171B22] rotate-1 hover:rotate-0 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none flex items-center gap-2 cursor-pointer"
        >
          <Edit3 className="w-3.5 h-3.5 text-[#E0B1AE]" strokeWidth={2.5} />
          <span className="tracking-wider uppercase">{isEditing ? "Close Editor" : "Edit Anniversary"}</span>
        </button>
      </header>

      {/* Main Big Scrapbook Page Portal Turn Animation */}
      <div className="flex-1 flex items-center justify-center max-w-5xl mx-auto w-full py-6 z-20 animate-book-portal">
        <div className="relative w-full">
          
          {/* Masking Tapes */}
          <div className="absolute -top-3.5 left-10 tape-pink-solid w-32 h-6 -rotate-3 z-30 pointer-events-none" />
          <div className="absolute -top-3.5 right-10 tape-red-solid w-32 h-6 rotate-3 z-30 pointer-events-none" />

          {/* Timeline Patrol Badge */}
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-40 bg-[#FAF7F2] border-2 border-[#261D24] px-3.5 py-0.5 shadow-[3px_3px_0_#261D24] font-mono text-[10px] font-black text-[#7D2834] flex items-center gap-1.5 -rotate-1">
            <span>🕷️</span>
            <span>TIMELINE PATROL</span>
          </div>

          {/* Solid Paper Sheet */}
          <div className="paper-sheet-solid p-6 sm:p-10 relative overflow-hidden">
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b-2 border-dashed border-[#8A7550]">
              <div className="flex items-center gap-3.5">
                <div className="wax-seal-solid w-12 h-12 rounded-full flex items-center justify-center shrink-0">
                  <Heart className="w-6 h-6 text-[#F2E6D2] fill-[#F2E6D2] animate-pulse" />
                </div>

                <div>
                  <span className="text-[10px] font-mono font-black uppercase tracking-widest text-[#7D2834] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#7D2834]" /> CANON TIMELINE RECORD
                  </span>
                  <h1 className="font-marker text-2xl sm:text-4xl text-[#1A0D10] leading-none mt-1">
                    Multiverse Canon Clock
                  </h1>
                </div>
              </div>

              <div className="text-left sm:text-right">
                <span className="text-[10px] font-mono font-bold text-stone-600 uppercase tracking-widest block">
                  ORIGIN TIMESTAMP
                </span>
                <span className="font-mono text-sm sm:text-base font-black text-[#7D2834] bg-[#EFE4D6] px-2 py-0.5 border border-[#261D24] inline-block mt-0.5">
                  {anniversaryDate}
                </span>
              </div>
            </div>

            {/* Date Editor */}
            {isEditing && (
              <form 
                onSubmit={handleSave} 
                onClick={(e) => e.stopPropagation()}
                className="my-6 p-4 rounded-xl bg-[#EFE4D6] border-2 border-[#261D24] shadow-[4px_4px_0_#261D24] flex flex-wrap items-center gap-3 animate-in fade-in"
              >
                <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                  <Calendar className="w-4 h-4 text-[#7D2834]" />
                  <input
                    type="date"
                    required
                    value={anniversaryDate}
                    onChange={(e) => setAnniversaryDate(e.target.value)}
                    className="w-full text-xs font-mono p-2 rounded bg-white border-2 border-[#261D24] text-stone-900 outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] text-xs font-bold border-2 border-[#261D24] shadow-[2px_2px_0_#261D24] active:shadow-none active:translate-x-[1px] active:translate-y-[1px] flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Save Origin Date</span>
                </button>
              </form>
            )}

            {error && (
              <div className="my-4 p-3 rounded-lg bg-[#5A2029] text-[#F2E6D2] text-xs font-mono flex items-center gap-2 border-2 border-[#261D24] shadow-[3px_3px_0_#261D24]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {timeUnits.isUpcoming && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EAD9A9] border-2 border-[#261D24] font-mono text-[10px] font-black uppercase tracking-widest text-[#5A4A1F] shadow-[2px_2px_0_#261D24]">
                <Sparkles className="w-3 h-3" /> Not canon yet — counting down
              </div>
            )}

            {/* 3D Vertical Split-Flap Clock Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 sm:gap-4 my-8 justify-items-center relative">
              <FlipDigitUnit value={timeUnits.years} label="YEARS" tilt="-rotate-2" tagColor="bg-[#EAD0C7]" />
              <FlipDigitUnit value={timeUnits.months} label="MONTHS" tilt="rotate-1" tagColor="bg-[#EAD9A9]" />
              <FlipDigitUnit value={timeUnits.days} label="DAYS" tilt="-rotate-1" tagColor="bg-[#BDD0C5]" />
              <FlipDigitUnit value={timeUnits.hours} label="HOURS" tilt="rotate-2" tagColor="bg-[#D7A4A0]" />
              <FlipDigitUnit value={timeUnits.minutes} label="MINS" tilt="-rotate-2" tagColor="bg-[#EAD9A9]" />
              <FlipDigitUnit value={timeUnits.seconds} label="SECS" tilt="rotate-1" tagColor="bg-[#EAD0C7]" />
            </div>

            {/* Footer Quote */}
            <div className="text-center pt-5 border-t-2 border-dashed border-[#8A7550]">
              <p className="font-handwriting text-2xl sm:text-3xl text-[#5A2029] leading-snug">
                “In every single universe, timeline, and dimension... I will always love you.”
              </p>
              <span className="block font-mono text-[9px] font-bold text-stone-500 uppercase tracking-widest mt-1">
                (Tap anywhere to spawn cute spiders & web charms 🕷️✨)
              </span>
            </div>

          </div>
        </div>
      </div>

      {/* Screen Click Particle Sparks */}
      {screenSpiders.map((spider) => (
        <div
          key={spider.id}
          style={{ left: spider.x, top: spider.y }}
          className="absolute pointer-events-none z-50 animate-ping text-2xl"
        >
          {spider.emoji}
        </div>
      ))}

      {/* Footer Tag */}
      <footer className="max-w-md mx-auto text-center z-20">
        <span className="font-mono text-[10px] font-black text-[#261D24] uppercase tracking-widest bg-[#EAD9A9] px-4 py-1 border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] inline-block -rotate-1">
          EARTH-65 × EARTH-616 • CANON TIMELINE
        </span>
      </footer>
    </main>
  );
}