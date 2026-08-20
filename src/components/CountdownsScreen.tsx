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
}

export default function CountdownsScreen({
  userId,
  coupleId,
  initialEvents = [],
}: CountdownsScreenProps) {
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal & Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [reminder, setReminder] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");

  // Big Full-Screen Canon Event Trigger Modal State
  const [activeCanonEvent, setActiveCanonEvent] = useState<CalendarEvent | null>(null);

  const [, setTick] = useState(0);
  const supabase = createClient();

  // Sound effect
  const playPopSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
    } catch {}
  };

  const checkIsCanonToday = (targetDateStr: string) => {
    if (!targetDateStr) return false;
    const now = new Date();
    const originalTarget = new Date(targetDateStr);
    return (
      now.getDate() === originalTarget.getDate() &&
      now.getMonth() === originalTarget.getMonth()
    );
  };

  const fetchEvents = async () => {
    if (!coupleId) return;

    try {
      const { data, error: fetchErr } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("couple_id", coupleId);

      if (fetchErr) throw fetchErr;

      const normalized: CalendarEvent[] = (data || []).map((ev: any) => ({
        id: ev.id,
        title: ev.title,
        date: ev.date || ev.starts_at || "",
        notes: ev.notes || "",
        reminder: ev.reminder ?? true,
        category: ev.category || "date",
        custom_sticker: ev.custom_sticker || "🕸️",
      }));

      // Sort ascending by date
      normalized.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      setEvents(normalized);

      const todayEvent = normalized.find((ev) => checkIsCanonToday(ev.date));
      if (todayEvent && !activeCanonEvent) {
        setActiveCanonEvent(todayEvent);
      }
    } catch (err: any) {
      console.error("Error loading events:", err.message);
      setError(err.message || "Failed to load canon events.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();

    const channel = supabase
      .channel(`calendar_events_channel_${coupleId}`)
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

  // Live second countdown ticker
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
    setReminder(ev.reminder ?? true);
    setError(null);
    setIsModalOpen(true);
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!coupleId) {
      setError("Error: No active couple ID found.");
      return;
    }

    if (!title.trim() || !date) {
      setError("Please fill in both a title and a target date.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const formattedDate = new Date(date).toISOString();

      const payload: any = {
        couple_id: coupleId,
        creator_id: userId,
        title: title.trim(),
        date: formattedDate,
        starts_at: formattedDate,
        notes: notes.trim() || "",
        reminder: reminder,
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
      setError(err.message || "Failed to save canon event.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm("Are you sure you want to erase this canon event from the timeline?")) return;
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

  const calculateCountdown = (targetDateStr: string) => {
    if (!targetDateStr) return { isCanonReached: false, days: 0, hours: 0, minutes: 0, seconds: 0 };

    const now = new Date();
    const originalTarget = new Date(targetDateStr);

    let targetYear = now.getFullYear();
    const target = new Date(
      targetYear,
      originalTarget.getMonth(),
      originalTarget.getDate(),
      originalTarget.getHours(),
      originalTarget.getMinutes(),
      originalTarget.getSeconds()
    );

    const isToday = checkIsCanonToday(targetDateStr);

    if (isToday) {
      const diffToday = target.getTime() - now.getTime();
      if (diffToday > 0) {
        const hours = Math.floor((diffToday / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((diffToday / (1000 * 60)) % 60);
        const seconds = Math.floor((diffToday / 1000) % 60);
        return { isCanonReached: false, days: 0, hours, minutes, seconds };
      } else {
        return { isCanonReached: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
      }
    }

    if (target.getTime() < now.getTime()) {
      targetYear += 1;
      target.setFullYear(targetYear);
    }

    const diff = target.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    return { isCanonReached: false, days, hours, minutes, seconds };
  };

  const postItColors = [
    "bg-[#EAD9A9] text-[#1A0D10]",
    "bg-[#EAD0C7] text-[#1A0D10]",
    "bg-[#BDD0C5] text-[#1A0D10]",
    "bg-[#D7A4A0] text-[#1A0D10]",
  ];

  const rotations = ["-rotate-2", "rotate-1", "-rotate-1", "rotate-2"];

  return (
    <main className="min-h-screen w-full p-4 sm:p-8 lg:p-12 flex flex-col justify-between relative overflow-hidden select-none bg-[#191116] animate-toc-reveal">
      {/* Spider-Verse Ambient Backdrop */}
      <SpideyBackground />

      <div className="fixed top-8 animate-crawl-h text-xl z-10 pointer-events-none">
        🕷️
      </div>
      <div className="fixed animate-crawl-d text-2xl z-10 pointer-events-none">
        🕷️
      </div>

      {/* Top Navigation Bar: Working TOC Link */}
      <header className="max-w-7xl mx-auto w-full z-30 flex items-center justify-between mb-6">
        <Link
          href="/?opened=true"
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
          <span className="tracking-widest uppercase">Add Canon Event</span>
        </button>
      </header>

      {/* Main Full-Screen Content Board */}
      <div className="flex-1 max-w-7xl mx-auto w-full z-20 flex flex-col">
        <div className="paper-sheet-solid p-6 sm:p-12 relative flex-1 border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.8)] flex flex-col justify-between">
          <div>
            {/* Header Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b-3 border-dashed border-[#8A7550]">
              <div className="flex items-center gap-4">
                <div className="wax-seal-solid w-14 h-14 rounded-full flex items-center justify-center shrink-0 border-3 border-[#261D24] shadow-[4px_4px_0_#171B22]">
                  <Calendar className="w-7 h-7 text-[#F2E6D2]" />
                </div>
                <div>
                  <span className="text-xs font-mono font-black uppercase tracking-widest text-[#7D2834] flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#7D2834]" /> EARTH-65 × EARTH-616 TIMELINE
                  </span>
                  <h1 className="font-marker text-3xl sm:text-5xl text-[#1A0D10] leading-none mt-1.5 drop-shadow-sm">
                    Canon Event Countdowns
                  </h1>
                </div>
              </div>

              <div className="text-left sm:text-right bg-[#EFE4D6] p-3 border-2 border-[#261D24] shadow-[4px_4px_0_#171B22] rotate-1">
                <span className="text-[10px] font-mono font-bold text-stone-600 uppercase tracking-widest block">
                  TOTAL MILESTONES
                </span>
                <span className="font-mono text-base font-black text-[#7D2834] uppercase">
                  {events.length} ACTIVE CANONS
                </span>
              </div>
            </div>

            {error && (
              <div className="my-6 p-4 rounded-lg bg-[#5A2029] text-[#F2E6D2] text-sm font-mono flex items-center gap-3 border-3 border-[#261D24] shadow-[5px_5px_0_#261D24]">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Grid Layout */}
            {events.length === 0 ? (
              <div className="text-center py-24 my-auto">
                <div className="text-7xl mb-4 animate-bounce">📅🕷️</div>
                <p className="font-marker text-3xl text-[#7D2834]">
                  No canon events scheduled on the board yet!
                </p>
                <p className="font-handwriting text-xl text-stone-700 mt-2">
                  Click “Add Canon Event” above to pin your first big countdown across time.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 my-8">
                {events.map((ev, idx) => {
                  const colorClass = postItColors[idx % postItColors.length];
                  const tiltClass = rotations[idx % rotations.length];
                  const countdown = calculateCountdown(ev.date);

                  return (
                    <div
                      key={ev.id}
                      className={`relative group ${tiltClass} hover:rotate-0 hover:-translate-y-2 transition duration-300`}
                    >
                      <div
                        className={`relative p-6 sm:p-7 rounded-xl border-4 border-[#261D24] shadow-[10px_12px_0_rgba(10,8,12,0.7)] ${colorClass} overflow-hidden min-h-[260px] flex flex-col justify-between`}
                      >
                        {/* Push Pin Decor */}
                        <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                          <img
                            src="/images/scrapbook/push-pin.png"
                            alt="Push Pin"
                            className="w-9 h-9 object-contain drop-shadow-lg"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              e.currentTarget.nextElementSibling?.classList.remove("hidden");
                            }}
                          />
                          <span className="hidden text-2xl drop-shadow">📌</span>
                        </div>

                        <div>
                          <div className="flex items-center justify-between pt-2 mb-3">
                            <span className="font-mono text-xs font-black uppercase tracking-wider bg-black/10 px-2.5 py-1 rounded border border-black/20">
                              {ev.date
                                ? new Date(ev.date).toLocaleDateString([], {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })
                                : "No Date"}
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

                          <h3 className="font-marker text-2xl text-[#261D24] leading-snug mb-2">
                            {ev.title}
                          </h3>

                          {ev.notes && (
                            <p className="font-handwriting text-xl text-stone-900 leading-snug mb-4">
                              {ev.notes}
                            </p>
                          )}
                        </div>

                        {/* Live Countdown Clock Box */}
                        <div className="bg-white/95 border-3 border-[#261D24] p-3.5 rounded-lg text-center mt-3 shadow-inner">
                          {countdown.isCanonReached ? (
                            <button
                              onClick={() => setActiveCanonEvent(ev)}
                              className="w-full animate-bounce py-1.5 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] rounded-lg border-2 border-[#261D24] shadow-[3px_3px_0_#171B24] cursor-pointer transition"
                            >
                              <span className="font-mono text-xs font-black uppercase tracking-wider block">
                                ⚡ CANON EVENT TODAY! [CLICK TO VIEW]
                              </span>
                            </button>
                          ) : (
                            <div className="grid grid-cols-4 gap-1.5 font-mono font-black text-sm text-[#261D24]">
                              <div className="bg-[#FAF7F2] p-1.5 rounded border-2 border-[#261D24]">
                                <span className="block text-lg sm:text-xl">{countdown.days}</span>
                                <span className="text-[9px] text-stone-600">DAYS</span>
                              </div>
                              <div className="bg-[#FAF7F2] p-1.5 rounded border-2 border-[#261D24]">
                                <span className="block text-lg sm:text-xl">{countdown.hours}</span>
                                <span className="text-[9px] text-stone-600">HRS</span>
                              </div>
                              <div className="bg-[#FAF7F2] p-1.5 rounded border-2 border-[#261D24]">
                                <span className="block text-lg sm:text-xl">{countdown.minutes}</span>
                                <span className="text-[9px] text-stone-600">MIN</span>
                              </div>
                              <div className="bg-[#FAF7F2] p-1.5 rounded border-2 border-[#261D24]">
                                <span className="block text-lg sm:text-xl">{countdown.seconds}</span>
                                <span className="text-[9px] text-stone-600">SEC</span>
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

          <div className="text-center pt-8 mt-6 border-t-3 border-dashed border-[#8A7550]">
            <p className="font-handwriting text-2xl sm:text-3xl text-[#5A2029]">
              “Some canon events are meant to be counted down to together across the multiverse.”
            </p>
          </div>
        </div>
      </div>

      {/* FULL-SCREEN CANON EVENT TRIGGER MODAL */}
      {activeCanonEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in zoom-in duration-300">
          <div className="paper-sheet-solid max-w-xl w-full p-8 sm:p-12 relative border-4 border-[#261D24] shadow-[20px_20px_0_#7D2834] text-center rotate-1">
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[#7D2834] text-[#F2E6D2] px-6 py-2 border-3 border-[#261D24] font-mono text-sm font-black uppercase tracking-widest -rotate-2 shadow-[4px_4px_0_#171B22]">
              ⚠️ ALARM: CANON EVENT TRIGGERED! 🕷️
            </div>

            <div className="text-7xl my-6 animate-bounce">⚡⏰🕸️</div>

            <h2 className="font-marker text-3xl sm:text-5xl text-[#7D2834] leading-tight mb-3">
              {activeCanonEvent.title}
            </h2>

            <p className="font-handwriting text-2xl text-stone-900 mb-6">
              {activeCanonEvent.notes ||
                "The multiversal timeline converges today! This milestone has officially been reached across dimensions."}
            </p>

            <button
              onClick={() => setActiveCanonEvent(null)}
              className="px-8 py-4 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] font-mono text-sm font-black border-3 border-[#261D24] shadow-[6px_6px_0_#171B24] uppercase tracking-widest transition cursor-pointer active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
            >
              ACCEPT & RESTART TIMELINE 🚀
            </button>
          </div>
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="paper-sheet-solid max-w-lg w-full p-8 relative border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.9)]">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute top-5 right-5 p-2 rounded-lg bg-[#EFE4D6] hover:bg-[#E2D2C0] border-2 border-[#261D24] transition cursor-pointer"
            >
              <X className="w-5 h-5 text-[#261D24]" />
            </button>

            <div className="flex items-center gap-3 mb-6 pb-3 border-b-3 border-dashed border-[#8A7550]">
              <Calendar className="w-6 h-6 text-[#7D2834]" />
              <h2 className="font-marker text-2xl text-[#261D24]">
                {editingId ? "Edit Canon Event" : "Pin New Canon Event"}
              </h2>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-[#5A2029] text-[#F2E6D2] text-xs font-mono border-2 border-[#261D24]">
                {error}
              </div>
            )}

            <form onSubmit={handleSaveEvent} className="space-y-5">
              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase tracking-wider mb-1.5">
                  Event Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Spidey's Birthday / Multiverse Anniversary"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full text-sm font-mono p-3 rounded-xl bg-white border-3 border-[#261D24] text-stone-900 outline-none shadow-inner"
                />
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase tracking-wider mb-1.5">
                  Target Date & Time *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full text-sm font-mono p-3 rounded-xl bg-white border-3 border-[#261D24] text-stone-900 outline-none shadow-inner"
                />
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase tracking-wider mb-1.5">
                  Notes / Details
                </label>
                <textarea
                  rows={3}
                  placeholder="Add secret notes or memories..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full text-sm font-mono p-3 rounded-xl bg-white border-3 border-[#261D24] text-stone-900 outline-none resize-none shadow-inner"
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

      {/* Footer Tag */}
      <footer className="max-w-md mx-auto text-center z-20 mt-6">
        <span className="font-mono text-xs font-black text-[#261D24] uppercase tracking-widest bg-[#EAD9A9] px-6 py-1.5 border-3 border-[#261D24] shadow-[4px_4px_0_#171B22] inline-block -rotate-1">
          EARTH-65 × EARTH-616 • CANON COUNTDOWNS
        </span>
      </footer>
    </main>
  );
}