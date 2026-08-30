"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import SpideyBackground from "./SpideyBackground";
import {
  Calendar,
  Plus,
  Trash2,
  Edit3,
  Loader2,
  AlertCircle,
  Sparkles,
  ArrowLeft,
  X,
  Check,
  Zap,
  Bookmark,
} from "lucide-react";

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  notes?: string | null;
  reminder?: boolean;
  category?: string;
  custom_sticker?: string;
}

export interface CountdownsScreenProps {
  userId: string;
  coupleId: string;
  initialEvents?: CalendarEvent[];
  /* See ClockScreen: the spread the reader opened this chapter from. */
  backHref?: string;
}

export default function CountdownsScreen({
  userId,
  coupleId,
  initialEvents = [],
  backHref = "/?opened=true&spread=0",
}: CountdownsScreenProps) {
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [error, setError] = useState<string | null>(null);

  // Modal & Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState<string>("date");
  const [customSticker, setCustomSticker] = useState<string>("🕸️");
  const [reminder, setReminder] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");

  // Full-Screen Celebratory Popup State (Triggered on button click)
  const [activeCanonEvent, setActiveCanonEvent] = useState<CalendarEvent | null>(null);

  const [, setTick] = useState(0);
  const supabase = createClient();

  const playPopSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } catch {}
  };

  // Safe parse from database records
  const parseEvent = (ev: any): CalendarEvent => {
    let cat = ev.category || "date";
    let sticker = ev.custom_sticker || "🕸️";

    if (ev.location) {
      try {
        const parsed = JSON.parse(ev.location);
        if (parsed.category) cat = parsed.category;
        if (parsed.custom_sticker) sticker = parsed.custom_sticker;
      } catch {
        if (["date", "birthday", "trip", "anniversary", "movies", "custom"].includes(ev.location)) {
          cat = ev.location;
        }
      }
    }

    return {
      id: ev.id,
      title: ev.title,
      date: ev.starts_at || ev.date || "",
      notes: ev.notes || "",
      reminder: ev.reminder ?? (ev.reminder_at ? true : true),
      category: cat,
      custom_sticker: sticker,
    };
  };

  const fetchEvents = async () => {
    if (!coupleId) return;
    try {
      const { data, error: fetchErr } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("couple_id", coupleId);

      if (fetchErr) throw fetchErr;

      const normalized = (data || []).map(parseEvent);

      normalized.sort((a, b) => {
        const timeA = getNextTargetTimestamp(a.date);
        const timeB = getNextTargetTimestamp(b.date);
        return timeA - timeB;
      });

      setEvents(normalized);
    } catch (err: any) {
      console.error("Error loading events:", err.message);
      setError(err.message || "Failed to load canon events.");
    }
  };

  useEffect(() => {
    fetchEvents();

    const channel = supabase
      .channel(`calendar_events_sync_${coupleId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_events",
          filter: `couple_id=eq.${coupleId}`,
        },
        () => {
          fetchEvents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [coupleId, supabase]);

  // Live 1-second ticker for second-precision countdown updates
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleOpenCreate = () => {
    playPopSound();
    setEditingId(null);
    setTitle("");
    setDate("");
    setNotes("");
    setCategory("date");
    setCustomSticker("🕸️");
    setReminder(true);
    setError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (ev: CalendarEvent) => {
    playPopSound();
    setEditingId(ev.id);
    setTitle(ev.title);
    setDate(ev.date ? ev.date.substring(0, 16) : "");
    setNotes(ev.notes || "");
    setCategory(ev.category || "date");
    setCustomSticker(ev.custom_sticker || "🕸️");
    setReminder(ev.reminder ?? true);
    setError(null);
    setIsModalOpen(true);
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!coupleId) {
      setError("No couple ID found.");
      return;
    }

    if (!title.trim() || !date) {
      setError("Please provide a title and target date.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const formattedDate = new Date(date).toISOString();

      // Dual-write starts_at and date to guarantee compatibility
      const payload: any = {
        couple_id: coupleId,
        creator_id: userId,
        title: title.trim(),
        starts_at: formattedDate,
        date: formattedDate,
        notes: notes.trim() || "",
        category: category,
        custom_sticker: customSticker,
        location: JSON.stringify({ category, custom_sticker: customSticker }),
        reminder: reminder,
        reminder_at: reminder ? formattedDate : null,
      };

      if (editingId) {
        const { error: updateErr } = await supabase
          .from("calendar_events")
          .update(payload)
          .eq("id", editingId);

        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from("calendar_events")
          .insert(payload);

        if (insertErr) throw insertErr;
      }

      playPopSound();
      setIsModalOpen(false);
      setTitle("");
      setDate("");
      setNotes("");
      setEditingId(null);

      await fetchEvents();
    } catch (err: any) {
      console.error("Supabase Save Error:", err);
      setError(err.message || "Failed to save milestone.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm("Remove this Canon Event from our universe?")) return;
    try {
      setEvents((prev) => prev.filter((ev) => ev.id !== id));
      const { error: delErr } = await supabase
        .from("calendar_events")
        .delete()
        .eq("id", id);

      if (delErr) throw delErr;
    } catch (err: any) {
      setError(err.message || "Failed to delete event.");
      fetchEvents();
    }
  };

  const getNextTargetTimestamp = (targetDateStr: string) => {
    if (!targetDateStr) return 0;
    const now = new Date();
    const original = new Date(targetDateStr);

    let target = new Date(
      now.getFullYear(),
      original.getMonth(),
      original.getDate(),
      original.getHours(),
      original.getMinutes(),
      original.getSeconds()
    );

    // If already passed for this year by more than 24 hours, roll to next year
    if (now.getTime() - target.getTime() > 24 * 60 * 60 * 1000) {
      target.setFullYear(now.getFullYear() + 1);
    }

    return target.getTime();
  };

  // Exact-to-the-second countdown calculator with automatic reset
  const calculateCountdown = (targetDateStr: string) => {
    if (!targetDateStr) {
      return {
        isReached: false,
        isNextYear: false,
        targetYear: new Date().getFullYear(),
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
      };
    }

    const now = new Date();
    const originalTarget = new Date(targetDateStr);
    let targetYear = now.getFullYear();

    // Construct target with exact hours, minutes, and seconds
    let target = new Date(
      targetYear,
      originalTarget.getMonth(),
      originalTarget.getDate(),
      originalTarget.getHours(),
      originalTarget.getMinutes(),
      originalTarget.getSeconds()
    );

    const diff = target.getTime() - now.getTime();

    // Triggers reached ONLY when current time has actually arrived at or passed target
    let isReached = diff <= 0;
    let isNextYear = false;

    // If it has passed by more than 24 hours, automatically reset countdown to next year
    if (isReached) {
      const passedMs = Math.abs(diff);
      if (passedMs > 24 * 60 * 60 * 1000) {
        targetYear += 1;
        target.setFullYear(targetYear);
        isNextYear = true;
        isReached = false; // reset back to active countdown
      }
    }

    const remainingDiff = target.getTime() - now.getTime();
    const absDiff = Math.abs(remainingDiff);

    const days = Math.floor(absDiff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((absDiff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((absDiff / (1000 * 60)) % 60);
    const seconds = Math.floor((absDiff / 1000) % 60);

    return { isReached, isNextYear, targetYear, days, hours, minutes, seconds };
  };

  const getCategoryTheme = (cat?: string) => {
    switch (cat) {
      case "birthday":
        return {
          bg: "bg-[#EAD0C7]",
          tape: "tape-pink-solid",
          tag: "BIRTHDAY CANON",
          badge: "bg-[#781420] text-[#FAF4EB]",
          defaultSticker: "🎂",
        };
      case "trip":
        return {
          bg: "bg-[#BDD0C5]",
          tape: "tape-gold-solid",
          tag: "MULTIVERSE TRIP",
          badge: "bg-[#1E3A34] text-[#FAF4EB]",
          defaultSticker: "✈️",
        };
      case "anniversary":
        return {
          bg: "bg-[#D7A4A0]",
          tape: "tape-red-solid",
          tag: "CANON ANNIVERSARY",
          badge: "bg-[#450A10] text-[#FAF4EB]",
          defaultSticker: "💖",
        };
      case "holidays":
        return {
          bg: "bg-[#E6D5C3]",
          tape: "tape-red-solid",
          tag: "MOVIE PREMIERE",
          badge: "bg-[#5A1827] text-[#FAF4EB]",
          defaultSticker: "🎆",
        };
      case "custom":
        return {
          bg: "bg-[#EAD9A9]",
          tape: "tape-gold-solid",
          tag: "SPECIAL MILESTONE",
          badge: "bg-[#3A2A0A] text-[#FAF4EB]",
          defaultSticker: "✨",
        };
      case "date":
      default:
        return {
          bg: "bg-[#FAF6EE]",
          tape: "tape-pink-solid",
          tag: "CANON DATE",
          badge: "bg-[#261D24] text-[#FAF4EB]",
          defaultSticker: "🕸️",
        };
    }
  };

  const filteredEvents = useMemo(() => {
    if (activeFilter === "all") return events;
    return events.filter((ev) => (ev.category || "date") === activeFilter);
  }, [events, activeFilter]);

  const rotations = ["-rotate-2", "rotate-1", "-rotate-1", "rotate-2", "-rotate-3", "rotate-3"];

  return (
    <main className="min-h-screen w-full p-4 sm:p-8 lg:p-12 flex flex-col justify-between relative overflow-hidden select-none bg-[#191116] animate-toc-reveal">
      <SpideyBackground />

      <div className="fixed top-8 right-12 animate-crawl-h text-xl z-10 pointer-events-none">🕷️</div>
      <div className="fixed left-6 bottom-16 animate-crawl-v text-lg z-10 pointer-events-none">🕷️</div>

      {/* Top Navigation */}
      <header className="max-w-7xl mx-auto w-full z-30 flex items-center justify-between mb-6">
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#F2E6D2] hover:bg-[#FAF7F2] text-[#261D24] text-xs sm:text-sm font-mono font-black border-3 border-[#261D24] shadow-[5px_5px_0_#171B22] -rotate-2 hover:rotate-0 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5 text-[#7D2834]" strokeWidth={3} />
          <span className="tracking-widest uppercase">Table of Contents</span>
        </Link>

        <button
          onClick={handleOpenCreate}
          className="px-5 py-2.5 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] text-xs sm:text-sm font-mono font-black border-3 border-[#261D24] shadow-[5px_5px_0_#171B22] rotate-1 hover:rotate-0 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none flex items-center gap-2.5 cursor-pointer"
        >
          <Plus className="w-5 h-5 text-[#E0B1AE]" strokeWidth={3} />
          <span className="tracking-widest uppercase">Pin Canon Event</span>
        </button>
      </header>

      {/* Main Board */}
      <div className="flex-1 max-w-7xl mx-auto w-full z-20 flex flex-col">
        <div className="paper-sheet-solid p-6 sm:p-10 relative flex-1 border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.85)] flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b-3 border-dashed border-[#8A7550]">
              <div className="flex items-center gap-4">
                <div className="wax-seal-solid w-14 h-14 rounded-full flex items-center justify-center shrink-0 border-3 border-[#261D24] shadow-[4px_4px_0_#171B22]">
                  <Calendar className="w-7 h-7 text-[#F2E6D2]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-black uppercase tracking-widest text-[#7D2834] flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-[#7D2834]" /> CHAPTER 02 • MULTIVERSE TIMELINES
                    </span>
                    <span className="bg-[#EAD9A9] text-[#261D24] text-[10px] font-mono font-black px-2 py-0.5 border border-[#261D24] -rotate-2">
                      EARTH-65 × 616
                    </span>
                  </div>
                  <h1 className="font-marker text-3xl sm:text-5xl text-[#1A0D10] leading-none mt-1.5 drop-shadow-sm">
                    Canon Event Countdowns
                  </h1>
                </div>
              </div>

              <div className="text-left md:text-right bg-[#EFE4D6] p-3 border-2 border-[#261D24] shadow-[4px_4px_0_#171B22] rotate-1">
                <span className="text-[10px] font-mono font-bold text-stone-600 uppercase tracking-widest block">
                  TOTAL MILESTONES
                </span>
                <span className="font-mono text-base font-black text-[#7D2834] uppercase">
                  {events.length} ACTIVE CANONS
                </span>
              </div>
            </div>

            {/* Filter Chips */}
            <div className="flex flex-wrap items-center gap-2 my-5">
              <span className="font-mono text-xs font-black text-[#7D2834] uppercase mr-2 flex items-center gap-1">
                <Bookmark className="w-3.5 h-3.5" /> Filter by:
              </span>
              {[
                { id: "all", label: "All Canons 📌" },
                { id: "date", label: "Dates 🕸️" },
                { id: "birthday", label: "Birthdays 🎂" },
                { id: "trip", label: "Trips ✈️" },
                { id: "anniversary", label: "Anniversaries 💖" },
                { id: "movies", label: "Holidays 🎉" },
                { id: "custom", label: "Special ✨" },
              ].map((chip) => (
                <button
                  key={chip.id}
                  onClick={() => {
                    playPopSound();
                    setActiveFilter(chip.id);
                  }}
                  className={`px-3 py-1 font-mono text-xs font-black border-2 border-[#261D24] rounded transition cursor-pointer shadow-[2px_2px_0_#171B22] active:scale-95 ${
                    activeFilter === chip.id
                      ? "bg-[#7D2834] text-[#FAF4EB] -rotate-1"
                      : "bg-[#F2E6D2] text-[#261D24] hover:bg-white"
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {error && (
              <div className="my-4 p-4 rounded-lg bg-[#5A2029] text-[#F2E6D2] text-sm font-mono flex items-center gap-3 border-3 border-[#261D24] shadow-[5px_5px_0_#261D24]">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Cards Grid */}
            {filteredEvents.length === 0 ? (
              <div className="text-center py-20 my-auto">
                <div className="text-7xl mb-4 animate-bounce">📌🕸️</div>
                <p className="font-marker text-3xl text-[#7D2834]">
                  {activeFilter === "all"
                    ? "No canon events pinned to our universe yet!"
                    : "No events pinned under this filter yet!"}
                </p>
                <p className="font-handwriting text-2xl text-stone-700 mt-2">
                  Click “Pin Canon Event” above to stick our next milestone.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 my-6 items-start">
                {filteredEvents.map((ev, idx) => {
                  const theme = getCategoryTheme(ev.category);
                  const tiltClass = rotations[idx % rotations.length];
                  const countdown = calculateCountdown(ev.date);
                  const targetDateObj = new Date(ev.date);

                  return (
                    <div
                      key={ev.id}
                      className={`relative group ${tiltClass} hover:rotate-0 hover:-translate-y-2 transition duration-300`}
                    >
                      <div
                        className={`relative p-6 rounded-2xl border-4 border-[#261D24] shadow-[10px_12px_0_rgba(10,8,12,0.75)] ${theme.bg} text-[#1A0D10] overflow-hidden min-h-[270px] flex flex-col justify-between`}
                      >
                        <div
                          className={`absolute -top-3.5 left-1/2 -translate-x-1/2 w-28 h-6 ${theme.tape} -rotate-1 z-20 pointer-events-none`}
                        />

                        <div>
                          <div className="flex items-center justify-between pt-1 mb-3">
                            <span
                              className={`font-mono text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border border-[#261D24] shadow-xs ${theme.badge}`}
                            >
                              {theme.tag}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleOpenEdit(ev)}
                                className="p-1.5 hover:bg-black/15 rounded-lg transition cursor-pointer"
                                title="Edit Event"
                              >
                                <Edit3 className="w-4 h-4 text-[#261D24]" />
                              </button>
                              <button
                                onClick={() => handleDeleteEvent(ev.id)}
                                className="p-1.5 hover:bg-red-500/20 rounded-lg transition cursor-pointer"
                                title="Delete Event"
                              >
                                <Trash2 className="w-4 h-4 text-[#7D2834]" />
                              </button>
                            </div>
                          </div>

                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                              <h3 className="font-marker text-2xl text-[#1A0D10] leading-snug">
                                {ev.title}
                              </h3>
                              <span className="font-mono text-[11px] text-stone-700 font-bold block mt-0.5">
                                🗓️{" "}
                                {ev.date
                                  ? targetDateObj.toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                  : "No Date"}
                                {countdown.isNextYear && ` (${countdown.targetYear})`}
                              </span>
                            </div>
                            <span className="text-3xl select-none shrink-0 drop-shadow">
                              {ev.custom_sticker || theme.defaultSticker}
                            </span>
                          </div>

                          {ev.notes && (
                            <p className="font-handwriting text-xl text-stone-900 leading-snug my-3">
                              “{ev.notes}”
                            </p>
                          )}
                        </div>

                        {/* Live Countdown Clock / Trigger */}
                        <div className="bg-white/95 border-3 border-[#261D24] p-3 rounded-xl text-center mt-3 shadow-inner">
                          {countdown.isReached ? (
                            <button
                              onClick={() => {
                                playPopSound();
                                setActiveCanonEvent(ev);
                              }}
                              className="w-full animate-bounce py-2 px-3 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] rounded-xl border-2 border-[#261D24] shadow-[3px_3px_0_#171B24] cursor-pointer transition"
                            >
                              <span className="font-mono text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5">
                                <Zap className="w-4 h-4 text-[#E0B1AE] animate-pulse" />
                                CANON EVENT REACHED! [CELEBRATE 🌸]
                              </span>
                            </button>
                          ) : (
                            <div>
                              <span className="font-mono text-[9px] font-black uppercase tracking-widest text-[#7D2834] block mb-1.5">
                                {countdown.isNextYear
                                  ? `COUNTDOWN TO ${countdown.targetYear}:`
                                  : "TIME REMAINING TO CONVERGENCE:"}
                              </span>
                              <div className="grid grid-cols-4 gap-1.5 font-mono font-black text-xs text-[#261D24]">
                                <div className="bg-[#FAF7F2] p-1 rounded-lg border-2 border-[#261D24]">
                                  <span className="block text-lg font-black text-[#7D2834]">
                                    {countdown.days}
                                  </span>
                                  <span className="text-[8px] text-stone-600 uppercase font-bold">
                                    DAYS
                                  </span>
                                </div>
                                <div className="bg-[#FAF7F2] p-1 rounded-lg border-2 border-[#261D24]">
                                  <span className="block text-lg font-black text-[#7D2834]">
                                    {countdown.hours}
                                  </span>
                                  <span className="text-[8px] text-stone-600 uppercase font-bold">
                                    HRS
                                  </span>
                                </div>
                                <div className="bg-[#FAF7F2] p-1 rounded-lg border-2 border-[#261D24]">
                                  <span className="block text-lg font-black text-[#7D2834]">
                                    {countdown.minutes}
                                  </span>
                                  <span className="text-[8px] text-stone-600 uppercase font-bold">
                                    MIN
                                  </span>
                                </div>
                                <div className="bg-[#FAF7F2] p-1 rounded-lg border-2 border-[#261D24]">
                                  <span className="block text-lg font-black text-[#7D2834]">
                                    {countdown.seconds}
                                  </span>
                                  <span className="text-[8px] text-stone-600 uppercase font-bold">
                                    SEC
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="text-center pt-6 mt-6 border-t-3 border-dashed border-[#8A7550]">
            <p className="font-handwriting text-2xl sm:text-3xl text-[#5A2029]">
              “Every timeline, every milestone, pinned together across universes.”
            </p>
          </div>
        </div>
      </div>

      {/* Celebratory Animation Modal (Only on Button Click) */}
      {activeCanonEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in zoom-in duration-300">
          <div className="absolute inset-0 bg-[radial-gradient(#7D2834_2px,transparent_2px)] [background-size:28px_28px] opacity-40 pointer-events-none" />

          <div className="absolute top-12 left-12 text-6xl animate-bounce">🎂</div>
          <div className="absolute top-16 right-16 text-6xl animate-spin">🕸️</div>
          <div className="absolute bottom-16 left-20 text-6xl animate-pulse">💖</div>
          <div className="absolute bottom-20 right-20 text-6xl animate-bounce">🌸</div>

          <div className="paper-sheet-solid max-w-xl w-full p-8 sm:p-12 relative border-4 border-[#261D24] shadow-[20px_20px_0_#7D2834] text-center rotate-1 rounded-2xl">
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-[#7D2834] text-[#F2E6D2] px-6 py-2 border-3 border-[#261D24] font-mono text-sm font-black uppercase tracking-widest -rotate-2 shadow-[4px_4px_0_#171B22] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#ECA8B8]" />
              ⚠️ CANON EVENT REACHED! 🕷️
            </div>

            <div className="text-7xl my-6 animate-bounce">🎉⚡🕷️</div>

            <h2 className="font-marker text-3xl sm:text-5xl text-[#7D2834] leading-tight mb-3">
              {activeCanonEvent.title}
            </h2>

            <p className="font-handwriting text-2xl text-stone-900 mb-6">
              {activeCanonEvent.notes ||
                "The multiversal timeline converges today! This milestone has officially been reached across our shared universe."}
            </p>

            <div className="bg-[#EFE4D6] p-4 rounded-xl border-3 border-[#261D24] mb-8 shadow-inner">
              <span className="font-mono text-xs font-black uppercase tracking-wider text-[#7D2834] block">
                TIMELINE CONVERGENCE ACTIVE
              </span>
              <p className="font-mono text-xs text-stone-700 mt-1">
                Happy Canon Event Day! The counter will automatically roll over to next year after today.
              </p>
            </div>

            <button
              onClick={() => {
                playPopSound();
                setActiveCanonEvent(null);
              }}
              className="px-8 py-4 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] font-mono text-sm font-black border-3 border-[#261D24] shadow-[6px_6px_0_#171B24] uppercase tracking-widest transition cursor-pointer active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
            >
              CELEBRATE & CONTINUE TIMELINE 🚀
            </button>
          </div>
        </div>
      )}

      {/* Modal: Create & Edit */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in">
          <div className="paper-sheet-solid max-w-lg w-full p-6 sm:p-8 relative border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.95)] rounded-2xl">
            <div className="absolute -top-3.5 left-12 w-28 h-6 tape-pink-solid -rotate-2 pointer-events-none" />
            <div className="absolute -top-3.5 right-12 w-28 h-6 tape-red-solid rotate-2 pointer-events-none" />

            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute top-5 right-5 p-2 rounded-lg bg-[#EFE4D6] hover:bg-[#E2D2C0] border-2 border-[#261D24] transition cursor-pointer"
            >
              <X className="w-5 h-5 text-[#261D24]" />
            </button>

            <div className="flex items-center gap-3 mb-5 pb-3 border-b-3 border-dashed border-[#8A7550]">
              <span className="text-3xl">📌</span>
              <div>
                <h2 className="font-marker text-2xl sm:text-3xl text-[#261D24]">
                  {editingId ? "Edit Canon Event" : "Pin New Canon Event"}
                </h2>
                <span className="font-mono text-[10px] font-bold text-[#781420] uppercase">
                  Earth-65 × Earth-616 Milestone
                </span>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-[#5A2029] text-[#F2E6D2] text-xs font-mono border-2 border-[#261D24]">
                {error}
              </div>
            )}

            <form onSubmit={handleSaveEvent} className="space-y-4">
              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase tracking-wider mb-1">
                  Event Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Gwen's Birthday, Our Anniversary, Tokyo Trip"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full text-sm font-mono p-3 rounded-xl bg-white border-3 border-[#261D24] text-stone-900 outline-none shadow-inner"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono text-xs font-black text-[#7D2834] uppercase tracking-wider mb-1">
                    Canon Target Date *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full text-xs font-mono p-2.5 rounded-xl bg-white border-3 border-[#261D24] text-stone-900 outline-none shadow-inner"
                  />
                </div>

                <div>
                  <label className="block font-mono text-xs font-black text-[#7D2834] uppercase tracking-wider mb-1">
                    Category Tag
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full text-xs font-mono p-2.5 rounded-xl bg-white border-3 border-[#261D24] text-stone-900 outline-none shadow-inner"
                  >
                    <option value="date">Upcoming Date 🕸️</option>
                    <option value="birthday">Birthday 🎂</option>
                    <option value="trip">Multiverse Trip ✈️</option>
                    <option value="anniversary">Anniversary 💖</option>
                    <option value="movies">Special Holiday 🎊</option>
                    <option value="custom">Custom Milestone ✨</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase tracking-wider mb-1">
                  Choose Sticker
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {["🕸️", "🎂", "✈️", "💖", "🌸", "🍕", "🎬", "💌", "🌟", "🎸"].map((stk) => (
                    <button
                      key={stk}
                      type="button"
                      onClick={() => setCustomSticker(stk)}
                      className={`text-2xl p-1.5 rounded-lg border-2 transition cursor-pointer ${
                        customSticker === stk
                          ? "border-[#7D2834] bg-[#ECA8B8]/40 scale-110"
                          : "border-transparent hover:bg-stone-200"
                      }`}
                    >
                      {stk}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase tracking-wider mb-1">
                  Secret Scrapbook Note
                </label>
                <textarea
                  rows={2}
                  placeholder="Don't forget the flowers & special spots..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full text-sm font-handwriting text-xl p-2.5 rounded-xl bg-white border-3 border-[#261D24] text-stone-900 outline-none resize-none shadow-inner"
                />
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="reminder"
                  checked={reminder}
                  onChange={(e) => setReminder(e.target.checked)}
                  className="w-5 h-5 accent-[#7D0000] cursor-pointer"
                />
                <label
                  htmlFor="reminder"
                  className="font-mono text-xs font-bold text-[#1A0D10] cursor-pointer"
                >
                  Sync reminder across partner timeline
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t-3 border-dashed border-[#8A7550]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl bg-[#EFE4D6] hover:bg-[#E2D2C0] text-[#261D24] font-mono text-xs font-black border-3 border-[#261D24] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] font-mono text-xs font-black border-3 border-[#261D24] shadow-[4px_4px_0_#171B24] flex items-center gap-2 transition disabled:opacity-50 cursor-pointer active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>{editingId ? "Update Event" : "Pin Event"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer Stamp */}
      <footer className="max-w-md mx-auto text-center z-20 mt-6">
        <span className="font-mono text-xs font-black text-[#261D24] uppercase tracking-widest bg-[#EAD9A9] px-6 py-1.5 border-3 border-[#261D24] shadow-[4px_4px_0_#171B22] inline-block -rotate-1">
          EARTH-65 × EARTH-616 • CANON COUNTDOWNS
        </span>
      </footer>
    </main>
  );
}