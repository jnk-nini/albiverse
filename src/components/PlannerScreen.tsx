"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Edit3,
  X,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  MapPin,
  Bell,
  BellOff,
  Repeat,
  List as ListIcon,
  Grid3x3,
  AlertCircle,
  Shuffle,
  CalendarDays,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";

/* ============================================================================
   CH.07 - WEB PLANNER (CANON EVENTS)

   A real day-by-day shared calendar on top of the SAME `calendar_events`
   table Ch.02 (Canon Countdowns) already uses for its milestone-countdown
   wall - confirmed by reading CountdownsScreen.tsx before building this.
   Both chapters read/write the same rows and stay in realtime sync; this
   chapter is deliberately the everyday scheduling view (month grid + agenda)
   rather than another countdown wall. Interop rules followed here:
     - Always dual-write `starts_at` AND the legacy `date` column, exactly
       like CountdownsScreen.tsx does, so either chapter can read either
       column.
     - `category`/`custom_sticker` are real columns (not the abandoned
       `location` JSON hack Countdowns has as a fallback) - `location` here
       is used honestly, as an actual place string.
     - Categories reuse Countdowns' existing values (date/birthday/trip/
       anniversary/movies/custom) plus new ones added for this chapter
       (appointment/milestone/everyday/surprise) that Countdowns simply
       doesn't know about and safely ignores.

   Twist #1 - CANON CONFIRMATION: reuses the previously-unused
   `rsvp_required` flag. An event flagged this way starts as a dashed
   "pending canon" variant; the non-creator partner stamps it into canon or
   proposes a different date, which the creator can accept or dismiss.
   Plain events skip this and are auto-canon, like every Countdowns entry.

   Twist #2 - SPIDER-SENSE: the nearest upcoming canon event gets a live
   pulsing countdown badge in the header, plus a one-time full-screen swing-in
   burst the first time the app is opened on the day it lands.

   All chapter-specific CSS lives in the scoped <style> block near the
   bottom, per house convention. */

/* ------------------------------------------------------------------ types */

interface CanonEvent {
  id: string;
  couple_id: string;
  creator_id: string;
  title: string;
  notes: string | null;
  starts_at: string | null;
  date: string | null;
  ends_at: string | null;
  location: string | null;
  category: string | null;
  custom_sticker: string | null;
  reminder: boolean | null;
  reminder_at: string | null;
  rsvp_required: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  variant_proposed_start: string | null;
  variant_proposed_by: string | null;
  variant_note: string | null;
  recurrence: "none" | "weekly" | "monthly" | "yearly";
  created_at: string;
}

interface PlannerScreenProps {
  userId: string;
  coupleId: string;
  partnerId: string | null;
  myName: string;
  partnerName: string;
  onBack: () => void;
}

/* --------------------------------------------------------------- presets */

const CATEGORY_PRESETS = [
  { value: "date", label: "Date Night", emoji: "💕", tape: "tape-pink-solid", badge: "bg-[#261D24] text-[#FAF4EB]", bg: "bg-[#FAF6EE]" },
  { value: "anniversary", label: "Anniversary", emoji: "💍", tape: "tape-red-solid", badge: "bg-[#450A10] text-[#FAF4EB]", bg: "bg-[#D7A4A0]" },
  { value: "birthday", label: "Birthday", emoji: "🎂", tape: "tape-gold-solid", badge: "bg-[#781420] text-[#FAF4EB]", bg: "bg-[#EAD0C7]" },
  { value: "trip", label: "Trip", emoji: "✈️", tape: "tape-gold-solid", badge: "bg-[#1E3A34] text-[#FAF4EB]", bg: "bg-[#BDD0C5]" },
  { value: "movies", label: "Movie Night", emoji: "🎬", tape: "tape-red-solid", badge: "bg-[#5A1827] text-[#FAF4EB]", bg: "bg-[#E6D5C3]" },
  { value: "appointment", label: "Appointment", emoji: "🏥", tape: "tape-pink-solid", badge: "bg-[#1E3A34] text-[#FAF4EB]", bg: "bg-[#D3DCE0]" },
  { value: "milestone", label: "Milestone", emoji: "⭐", tape: "tape-gold-solid", badge: "bg-[#3A2A0A] text-[#FAF4EB]", bg: "bg-[#EAD9A9]" },
  { value: "everyday", label: "Everyday", emoji: "🕸️", tape: "tape-pink-solid", badge: "bg-[#261D24] text-[#FAF4EB]", bg: "bg-[#F2E6D2]" },
  { value: "surprise", label: "Surprise", emoji: "🎁", tape: "tape-red-solid", badge: "bg-[#450A10] text-[#FAF4EB]", bg: "bg-[#EAC7D6]" },
  { value: "custom", label: "Custom", emoji: "✨", tape: "tape-gold-solid", badge: "bg-[#3A2A0A] text-[#FAF4EB]", bg: "bg-[#EAD9A9]" },
] as const;

function categoryTheme(value?: string | null) {
  return CATEGORY_PRESETS.find((c) => c.value === value) ?? CATEGORY_PRESETS[0];
}

const STICKER_CHOICES = ["🕸️", "💕", "💍", "🎂", "✈️", "🎬", "🏥", "⭐", "🎁", "✨", "🌸", "🍕", "🎸", "📸", "🌙", "☕"];

const REMINDER_OFFSETS = [
  { value: 0, label: "At the time" },
  { value: 15, label: "15 min before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
];

/* ------------------------------------------------------------- date math */

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function dayKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toLocalInputValue(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function eventStart(ev: CanonEvent): Date | null {
  const raw = ev.starts_at || ev.date;
  return raw ? new Date(raw) : null;
}
function buildMonthGrid(year: number, month: number) {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === month });
  }
  return cells;
}
function recurrenceEchoesInRange(ev: CanonEvent, rangeStart: Date, rangeEnd: Date): Date[] {
  if (!ev.recurrence || ev.recurrence === "none") return [];
  const base = eventStart(ev);
  if (!base) return [];
  const echoes: Date[] = [];
  const cursor = new Date(base);
  const advance = () => {
    if (ev.recurrence === "weekly") cursor.setDate(cursor.getDate() + 7);
    else if (ev.recurrence === "monthly") cursor.setMonth(cursor.getMonth() + 1);
    else if (ev.recurrence === "yearly") cursor.setFullYear(cursor.getFullYear() + 1);
  };
  let guard = 0;
  while (cursor < rangeStart && guard < 800) {
    advance();
    guard++;
  }
  while (cursor <= rangeEnd && guard < 1600) {
    if (cursor.getTime() !== base.getTime()) echoes.push(new Date(cursor));
    advance();
    guard++;
  }
  return echoes;
}
function canonStatus(ev: CanonEvent): "auto" | "pending" | "confirmed" {
  if (!ev.rsvp_required) return "auto";
  return ev.confirmed_at ? "confirmed" : "pending";
}
function formatCountdown(ms: number) {
  const abs = Math.max(0, ms);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs / 3600000) % 24);
  const minutes = Math.floor((abs / 60000) % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/* ================================================================= main */

export default function PlannerScreen({
  userId,
  coupleId,
  partnerId,
  myName,
  partnerName,
  onBack,
}: PlannerScreenProps) {
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<CanonEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"month" | "agenda">("month");
  const [cursorMonth, setCursorMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [activeFilter, setActiveFilter] = useState("all");
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [showPast, setShowPast] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CanonEvent | null>(null);
  const [form, setForm] = useState({
    title: "",
    notes: "",
    start: "",
    end: "",
    location: "",
    category: "date" as string,
    sticker: "🕸️",
    reminderOn: true,
    reminderMinutes: 60,
    rsvpRequired: false,
    recurrence: "none" as CanonEvent["recurrence"],
  });
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [variantDraft, setVariantDraft] = useState<{ eventId: string; date: string; note: string } | null>(null);
  const [stampedId, setStampedId] = useState<string | null>(null);
  const [celebrationEvent, setCelebrationEvent] = useState<CanonEvent | null>(null);

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const fetchEvents = async () => {
    if (!coupleId) return;
    try {
      const { data, error: fetchErr } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("couple_id", coupleId);
      if (fetchErr) throw fetchErr;
      setEvents((data as CanonEvent[]) || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load the shared calendar.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    const channel = supabase
      .channel(`planner_calendar_events_${coupleId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calendar_events", filter: `couple_id=eq.${coupleId}` },
        () => fetchEvents()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coupleId, supabase]);

  /* ---------------------------------------------------------- day index */

  const cells = useMemo(() => buildMonthGrid(cursorMonth.year, cursorMonth.month), [cursorMonth]);

  const filteredEvents = useMemo(
    () => (activeFilter === "all" ? events : events.filter((ev) => (ev.category || "date") === activeFilter)),
    [events, activeFilter]
  );

  const dayIndex = useMemo(() => {
    const map = new Map<string, { real: CanonEvent[]; echoes: { event: CanonEvent; date: Date }[] }>();
    const ensure = (key: string) => {
      if (!map.has(key)) map.set(key, { real: [], echoes: [] });
      return map.get(key)!;
    };
    const rangeStart = cells[0].date;
    const rangeEnd = cells[cells.length - 1].date;
    for (const ev of filteredEvents) {
      const start = eventStart(ev);
      if (start) ensure(dayKey(start)).real.push(ev);
      for (const echoDate of recurrenceEchoesInRange(ev, rangeStart, rangeEnd)) {
        ensure(dayKey(echoDate)).echoes.push({ event: ev, date: echoDate });
      }
    }
    return map;
  }, [filteredEvents, cells]);

  /* ------------------------------------------------------- spider-sense */

  const spiderSenseEvent = useMemo(() => {
    const now = Date.now();
    const upcoming = events
      .map((ev) => ({ ev, t: eventStart(ev)?.getTime() ?? -1 }))
      .filter((x) => x.t >= now - 5 * 60 * 1000 && canonStatus(x.ev) !== "pending")
      .sort((a, b) => a.t - b.t);
    return upcoming[0]?.ev ?? null;
  }, [events]);

  const spiderSenseMs = spiderSenseEvent ? (eventStart(spiderSenseEvent)?.getTime() ?? 0) - Date.now() : 0;
  const spiderSenseUrgency: "slow" | "medium" | "urgent" =
    spiderSenseMs < 86400000 ? "urgent" : spiderSenseMs < 7 * 86400000 ? "medium" : "slow";

  useEffect(() => {
    if (!spiderSenseEvent) return;
    const start = eventStart(spiderSenseEvent);
    if (!start) return;
    const today = new Date();
    if (dayKey(start) !== dayKey(today)) return;
    const flag = `planner_celebrated_${spiderSenseEvent.id}_${dayKey(today)}`;
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(flag)) return;
    sessionStorage.setItem(flag, "1");
    setCelebrationEvent(spiderSenseEvent);
  }, [spiderSenseEvent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* --------------------------------------------------------------- crud */

  const nameFor = (id: string | null) => {
    if (!id) return "someone";
    if (id === userId) return "You";
    if (id === partnerId) return partnerName;
    return "Partner";
  };

  const openCreate = (presetDate?: Date) => {
    const base = presetDate ? new Date(presetDate) : new Date();
    if (presetDate) base.setHours(19, 0, 0, 0);
    setEditingEvent(null);
    setForm({
      title: "",
      notes: "",
      start: toLocalInputValue(base),
      end: "",
      location: "",
      category: "date",
      sticker: "🕸️",
      reminderOn: true,
      reminderMinutes: 60,
      rsvpRequired: false,
      recurrence: "none",
    });
    setIsModalOpen(true);
  };

  const openEdit = (ev: CanonEvent) => {
    const start = eventStart(ev);
    setEditingEvent(ev);
    setForm({
      title: ev.title,
      notes: ev.notes || "",
      start: start ? toLocalInputValue(start) : "",
      end: ev.ends_at ? toLocalInputValue(new Date(ev.ends_at)) : "",
      location: ev.location || "",
      category: ev.category || "date",
      sticker: ev.custom_sticker || "🕸️",
      reminderOn: ev.reminder ?? true,
      reminderMinutes: 60,
      rsvpRequired: ev.rsvp_required,
      recurrence: ev.recurrence || "none",
    });
    setIsModalOpen(true);
  };

  const [runSave, isSaving] = useGuardedAction(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.start) {
      setError("Give the event a title and a date.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const startIso = new Date(form.start).toISOString();
      const endIso = form.end ? new Date(form.end).toISOString() : null;
      const reminderAtIso = form.reminderOn
        ? new Date(new Date(form.start).getTime() - form.reminderMinutes * 60000).toISOString()
        : null;

      const startChanged = editingEvent ? eventStart(editingEvent)?.toISOString() !== startIso : false;
      const shouldReopenCanon = editingEvent?.rsvp_required && startChanged && editingEvent.confirmed_at;

      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        notes: form.notes.trim(),
        starts_at: startIso,
        date: startIso,
        ends_at: endIso,
        location: form.location.trim() || null,
        category: form.category,
        custom_sticker: form.sticker,
        reminder: form.reminderOn,
        reminder_at: reminderAtIso,
        rsvp_required: form.rsvpRequired,
        recurrence: form.recurrence,
      };

      if (shouldReopenCanon) {
        payload.confirmed_by = null;
        payload.confirmed_at = null;
        payload.variant_proposed_start = null;
        payload.variant_proposed_by = null;
        payload.variant_note = null;
      }

      if (editingEvent) {
        const { error: updateErr } = await supabase.from("calendar_events").update(payload).eq("id", editingEvent.id);
        if (updateErr) throw updateErr;
      } else {
        payload.couple_id = coupleId;
        payload.creator_id = userId;
        const { error: insertErr } = await supabase.from("calendar_events").insert(payload);
        if (insertErr) throw insertErr;
      }

      setIsModalOpen(false);
      setEditingEvent(null);
      await fetchEvents();
    } catch (err: any) {
      setError(err.message || "Could not save this canon event.");
    } finally {
      setSaving(false);
    }
  });

  const [runDelete] = useGuardedAction(async (id: string) => {
    setEvents((prev) => prev.filter((ev) => ev.id !== id));
    setConfirmDeleteId(null);
    const { error: delErr } = await supabase.from("calendar_events").delete().eq("id", id);
    if (delErr) {
      setError(delErr.message);
      fetchEvents();
    }
  });

  const [runConfirmCanon] = useGuardedAction(async (ev: CanonEvent) => {
    setStampedId(ev.id);
    setTimeout(() => setStampedId(null), 700);
    const { error: err } = await supabase
      .from("calendar_events")
      .update({ confirmed_by: userId, confirmed_at: new Date().toISOString() })
      .eq("id", ev.id);
    if (err) setError(err.message);
  });

  const [runProposeVariant] = useGuardedAction(async () => {
    if (!variantDraft || !variantDraft.date) return;
    const { error: err } = await supabase
      .from("calendar_events")
      .update({
        variant_proposed_start: new Date(variantDraft.date).toISOString(),
        variant_proposed_by: userId,
        variant_note: variantDraft.note.trim() || null,
      })
      .eq("id", variantDraft.eventId);
    if (err) setError(err.message);
    setVariantDraft(null);
  });

  const [runAcceptVariant] = useGuardedAction(async (ev: CanonEvent) => {
    if (!ev.variant_proposed_start) return;
    setStampedId(ev.id);
    setTimeout(() => setStampedId(null), 700);
    const { error: err } = await supabase
      .from("calendar_events")
      .update({
        starts_at: ev.variant_proposed_start,
        date: ev.variant_proposed_start,
        confirmed_by: userId,
        confirmed_at: new Date().toISOString(),
        variant_proposed_start: null,
        variant_proposed_by: null,
        variant_note: null,
      })
      .eq("id", ev.id);
    if (err) setError(err.message);
  });

  const [runDismissVariant] = useGuardedAction(async (ev: CanonEvent) => {
    const { error: err } = await supabase
      .from("calendar_events")
      .update({ variant_proposed_start: null, variant_proposed_by: null, variant_note: null })
      .eq("id", ev.id);
    if (err) setError(err.message);
  });

  /* --------------------------------------------------------------- misc */

  const monthLabel = new Date(cursorMonth.year, cursorMonth.month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const today = new Date();
  const isToday = (d: Date) => dayKey(d) === dayKey(today);

  const upcomingAgenda = useMemo(() => {
    const now = Date.now();
    return filteredEvents
      .filter((ev) => (eventStart(ev)?.getTime() ?? 0) >= now - 60000)
      .sort((a, b) => (eventStart(a)?.getTime() ?? 0) - (eventStart(b)?.getTime() ?? 0));
  }, [filteredEvents]);

  const pastAgenda = useMemo(() => {
    const now = Date.now();
    return filteredEvents
      .filter((ev) => (eventStart(ev)?.getTime() ?? 0) < now - 60000)
      .sort((a, b) => (eventStart(b)?.getTime() ?? 0) - (eventStart(a)?.getTime() ?? 0));
  }, [filteredEvents]);

  /* ---------------------------------------------------------- rendering */

  const EventCard = ({ ev, compact = false }: { ev: CanonEvent; compact?: boolean }) => {
    const theme = categoryTheme(ev.category);
    const start = eventStart(ev);
    const status = canonStatus(ev);
    const isCreator = ev.creator_id === userId;
    const isDeletePending = confirmDeleteId === ev.id;
    const isVariantDraftOpen = variantDraft?.eventId === ev.id;

    return (
      <div
        className={`relative border-3 border-[#261D24] rounded-xl p-4 shadow-[6px_6px_0_rgba(23,19,26,0.55)] transition ${theme.bg ?? "bg-[#FAF6EE]"} ${
          status === "pending" ? "border-dashed opacity-90" : ""
        } ${stampedId === ev.id ? "stamp-slam" : ""}`}
      >
        <span className={`absolute -top-3 left-6 w-16 h-4 ${theme.tape} ${status === "pending" ? "opacity-60" : ""} -rotate-1 z-10 pointer-events-none`} />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`font-mono text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border border-[#261D24] ${theme.badge}`}>
                {theme.label}
              </span>
              {ev.recurrence !== "none" && (
                <span className="font-mono text-[9px] font-black uppercase text-[#5A2029] flex items-center gap-0.5">
                  <Repeat className="w-3 h-3" /> {ev.recurrence}
                </span>
              )}
              {status === "pending" && (
                <span className="font-mono text-[9px] font-black uppercase text-[#7D2834] border border-dashed border-[#7D2834] px-1.5 rounded">
                  variant · pending canon
                </span>
              )}
              {status === "confirmed" && (
                <span className="font-mono text-[9px] font-black uppercase text-[#1E3A34] flex items-center gap-0.5">
                  <Check className="w-3 h-3" /> confirmed canon
                </span>
              )}
            </div>
            <h4 className="font-marker text-xl text-[#1A0D10] leading-tight mt-1 flex items-center gap-2">
              <span>{ev.custom_sticker || theme.emoji}</span>
              <span className="truncate">{ev.title}</span>
            </h4>
            <p className="font-mono text-[11px] text-stone-700 font-bold mt-0.5">
              {start?.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              {ev.ends_at && ` – ${new Date(ev.ends_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`}
            </p>
            {ev.location && (
              <p className="font-mono text-[10px] text-stone-600 mt-0.5 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {ev.location}
              </p>
            )}
            {!compact && ev.notes && <p className="font-handwriting text-lg text-stone-800 mt-1.5 leading-snug">&ldquo;{ev.notes}&rdquo;</p>}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="flex gap-1">
              <button onClick={() => openEdit(ev)} className="p-1.5 hover:bg-black/10 rounded-lg transition cursor-pointer" title="Edit">
                <Edit3 className="w-3.5 h-3.5 text-[#261D24]" />
              </button>
              {isDeletePending ? (
                <button
                  onClick={() => runDelete(ev.id)}
                  className="px-2 py-1 bg-[#7D2834] text-[#FAF4EB] rounded-lg text-[9px] font-mono font-black cursor-pointer animate-pulse"
                >
                  CONFIRM?
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(ev.id)}
                  onBlur={() => setTimeout(() => setConfirmDeleteId((c) => (c === ev.id ? null : c)), 2500)}
                  className="p-1.5 hover:bg-red-500/20 rounded-lg transition cursor-pointer"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5 text-[#7D2834]" />
                </button>
              )}
            </div>
            {ev.reminder ? <Bell className="w-3.5 h-3.5 text-[#7D2834]" /> : <BellOff className="w-3.5 h-3.5 text-stone-400" />}
          </div>
        </div>

        {/* Canon Confirmation controls */}
        {status === "pending" && !ev.variant_proposed_start && (
          <div className="mt-3 pt-3 border-t-2 border-dashed border-[#8A7550] flex flex-wrap items-center gap-2">
            {isCreator ? (
              <span className="font-mono text-[10px] text-stone-600">⏳ Waiting for {partnerName} to confirm canon...</span>
            ) : (
              <>
                <button
                  onClick={() => runConfirmCanon(ev)}
                  className="px-3 py-1.5 bg-[#1E3A34] text-[#FAF4EB] rounded-lg font-mono text-[10px] font-black uppercase tracking-wide flex items-center gap-1.5 cursor-pointer hover:bg-[#16281f] transition"
                >
                  <Check className="w-3.5 h-3.5" /> Confirm Canon
                </button>
                {isVariantDraftOpen ? null : (
                  <button
                    onClick={() => setVariantDraft({ eventId: ev.id, date: form.start, note: "" })}
                    className="px-3 py-1.5 bg-[#EFE4D6] text-[#261D24] rounded-lg font-mono text-[10px] font-black uppercase tracking-wide flex items-center gap-1.5 cursor-pointer border-2 border-[#261D24] hover:bg-white transition"
                  >
                    <Shuffle className="w-3.5 h-3.5" /> Propose Variant
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {isVariantDraftOpen && (
          <div className="mt-3 p-3 bg-white/70 rounded-lg border-2 border-dashed border-[#7D2834] space-y-2">
            <p className="font-mono text-[10px] font-black text-[#7D2834] uppercase">Suggest a different timeline</p>
            <input
              type="datetime-local"
              value={variantDraft?.date || ""}
              onChange={(e) => setVariantDraft((d) => (d ? { ...d, date: e.target.value } : d))}
              className="w-full text-xs font-mono p-2 rounded-lg bg-white border-2 border-[#261D24]"
            />
            <input
              type="text"
              placeholder="Reason (optional)"
              value={variantDraft?.note || ""}
              onChange={(e) => setVariantDraft((d) => (d ? { ...d, note: e.target.value } : d))}
              className="w-full text-xs font-mono p-2 rounded-lg bg-white border-2 border-[#261D24]"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setVariantDraft(null)} className="px-2.5 py-1 text-[10px] font-mono font-black cursor-pointer">
                Cancel
              </button>
              <button
                onClick={() => runProposeVariant()}
                className="px-3 py-1.5 bg-[#7D2834] text-[#FAF4EB] rounded-lg font-mono text-[10px] font-black cursor-pointer"
              >
                Send Variant
              </button>
            </div>
          </div>
        )}

        {ev.variant_proposed_start && (
          <div className="mt-3 p-3 bg-[#FFF8E8] rounded-lg border-2 border-dashed border-[#B59350] space-y-1.5">
            <p className="font-mono text-[10px] font-black text-[#5A2029] uppercase">
              🔀 {nameFor(ev.variant_proposed_by)} proposed: {new Date(ev.variant_proposed_start).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
            {ev.variant_note && <p className="font-handwriting text-base text-stone-700">&ldquo;{ev.variant_note}&rdquo;</p>}
            {isCreator && ev.variant_proposed_by !== userId && (
              <div className="flex gap-2 pt-1">
                <button onClick={() => runAcceptVariant(ev)} className="px-2.5 py-1 bg-[#1E3A34] text-[#FAF4EB] rounded-lg text-[10px] font-mono font-black cursor-pointer">
                  Accept
                </button>
                <button onClick={() => runDismissVariant(ev)} className="px-2.5 py-1 bg-[#EFE4D6] border-2 border-[#261D24] rounded-lg text-[10px] font-mono font-black cursor-pointer">
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        {status === "confirmed" && ev.confirmed_by && (
          <p className="mt-2 font-mono text-[9px] text-stone-500">stamped by {nameFor(ev.confirmed_by)}</p>
        )}
      </div>
    );
  };

  return (
    <main className="min-h-screen w-full p-4 sm:p-8 lg:p-12 bg-[#191116] relative overflow-hidden animate-toc-reveal">
      <div className="absolute inset-0 bg-[radial-gradient(#2A1D22_1.5px,transparent_1.5px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Header */}
        <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#F2E6D2] hover:bg-[#FAF7F2] text-[#261D24] text-xs sm:text-sm font-mono font-black border-3 border-[#261D24] shadow-[5px_5px_0_#171B22] -rotate-2 hover:rotate-0 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5 text-[#7D2834]" strokeWidth={3} />
            <span className="tracking-widest uppercase">Table of Contents</span>
          </button>
          <button
            onClick={() => openCreate()}
            className="px-5 py-2.5 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] text-xs sm:text-sm font-mono font-black border-3 border-[#261D24] shadow-[5px_5px_0_#171B22] rotate-1 hover:rotate-0 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none flex items-center gap-2.5 cursor-pointer"
          >
            <Plus className="w-5 h-5 text-[#E0B1AE]" strokeWidth={3} />
            <span className="tracking-widest uppercase">New Canon Event</span>
          </button>
        </header>

        <section className="paper-sheet-solid p-6 sm:p-10 relative border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.85)]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b-3 border-dashed border-[#8A7550]">
            <div className="flex items-center gap-4">
              <div className="wax-seal-solid w-14 h-14 rounded-full flex items-center justify-center shrink-0 border-3 border-[#261D24] shadow-[4px_4px_0_#171B22]">
                <CalendarDays className="w-7 h-7 text-[#F2E6D2]" />
              </div>
              <div>
                <span className="text-xs font-mono font-black uppercase tracking-widest text-[#7D2834] flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" /> CHAPTER 07 · CANON EVENTS
                </span>
                <h1 className="font-marker text-3xl sm:text-5xl text-[#1A0D10] leading-none mt-1.5">Web Planner</h1>
                <p className="font-mono text-[10px] text-stone-500 mt-1">{myName} &amp; {partnerName}</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 bg-[#EFE4D6] p-1 border-2 border-[#261D24] rounded-xl shadow-[3px_3px_0_#171B22]">
              <button
                onClick={() => setView("month")}
                className={`px-3 py-1.5 rounded-lg font-mono text-[10px] font-black uppercase flex items-center gap-1.5 cursor-pointer transition ${view === "month" ? "bg-[#7D2834] text-[#FAF4EB]" : "text-[#261D24]"}`}
              >
                <Grid3x3 className="w-3.5 h-3.5" /> Month
              </button>
              <button
                onClick={() => setView("agenda")}
                className={`px-3 py-1.5 rounded-lg font-mono text-[10px] font-black uppercase flex items-center gap-1.5 cursor-pointer transition ${view === "agenda" ? "bg-[#7D2834] text-[#FAF4EB]" : "text-[#261D24]"}`}
              >
                <ListIcon className="w-3.5 h-3.5" /> Agenda
              </button>
            </div>
          </div>

          {/* Spider-Sense banner */}
          {spiderSenseEvent && (
            <div className="my-4 relative overflow-hidden rounded-xl border-3 border-[#261D24] bg-[#1A0D10] p-4 flex items-center gap-4">
              <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
                <span className={`spidersense-ring spidersense-${spiderSenseUrgency}`} />
                <span className={`spidersense-ring spidersense-${spiderSenseUrgency}`} style={{ animationDelay: "0.6s" }} />
                <span className="text-2xl relative z-10">🕸️</span>
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[9px] font-black uppercase tracking-widest text-[#E0B1AE]">Spider-Sense Tingling</p>
                <p className="font-marker text-lg sm:text-xl text-[#FAF4EB] truncate">
                  {spiderSenseEvent.custom_sticker} {spiderSenseEvent.title} in {formatCountdown(spiderSenseMs)}
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="my-3 p-3 rounded-lg bg-[#5A2029] text-[#F2E6D2] text-xs font-mono flex items-center gap-2 border-2 border-[#261D24]">
              <AlertCircle className="w-4 h-4 shrink-0" /> <span>{error}</span>
            </div>
          )}

          {/* Category filter */}
          <div className="flex flex-wrap gap-1.5 my-4">
            <button
              onClick={() => setActiveFilter("all")}
              className={`px-2.5 py-1 font-mono text-[10px] font-black border-2 border-[#261D24] rounded cursor-pointer transition ${activeFilter === "all" ? "bg-[#7D2834] text-[#FAF4EB]" : "bg-[#F2E6D2] hover:bg-white"}`}
            >
              All
            </button>
            {CATEGORY_PRESETS.map((c) => (
              <button
                key={c.value}
                onClick={() => setActiveFilter(c.value)}
                className={`px-2.5 py-1 font-mono text-[10px] font-black border-2 border-[#261D24] rounded cursor-pointer transition ${activeFilter === c.value ? "bg-[#7D2834] text-[#FAF4EB]" : "bg-[#F2E6D2] hover:bg-white"}`}
              >
                {c.emoji} {c.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="py-24 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#7D2834]" />
            </div>
          ) : view === "month" ? (
            <>
              <div className="flex items-center justify-between my-3">
                <button onClick={() => setCursorMonth((m) => (m.month === 0 ? { year: m.year - 1, month: 11 } : { year: m.year, month: m.month - 1 }))} className="p-2 border-2 border-[#261D24] rounded-lg bg-[#F2E6D2] hover:bg-white cursor-pointer">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-3">
                  <h3 className="font-marker text-2xl text-[#1A0D10]">{monthLabel}</h3>
                  <button
                    onClick={() => setCursorMonth({ year: today.getFullYear(), month: today.getMonth() })}
                    className="px-2.5 py-1 font-mono text-[10px] font-black border-2 border-[#261D24] rounded bg-[#EAD9A9] hover:bg-white cursor-pointer"
                  >
                    Today
                  </button>
                </div>
                <button onClick={() => setCursorMonth((m) => (m.month === 11 ? { year: m.year + 1, month: 0 } : { year: m.year, month: m.month + 1 }))} className="p-2 border-2 border-[#261D24] rounded-lg bg-[#F2E6D2] hover:bg-white cursor-pointer">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="text-center font-mono text-[9px] sm:text-[10px] font-black text-[#7D2834] uppercase py-1">
                    {d}
                  </div>
                ))}
                {cells.map(({ date, inMonth }) => {
                  const key = dayKey(date);
                  const bucket = dayIndex.get(key);
                  const realCount = bucket?.real.length || 0;
                  const echoCount = bucket?.echoes.length || 0;
                  const total = realCount + echoCount;
                  const firstReal = bucket?.real[0];
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDay(date)}
                      className={`relative min-h-[52px] sm:min-h-[74px] p-1 sm:p-1.5 border-2 rounded-lg text-left transition cursor-pointer ${
                        inMonth ? "border-[#261D24] bg-[#FAF6EE]" : "border-[#8A7550]/30 bg-[#EFE4D6]/40 opacity-50"
                      } ${isToday(date) ? "ring-2 ring-[#7D2834] ring-offset-1" : ""} hover:bg-white`}
                    >
                      <span className={`font-mono text-[10px] sm:text-xs font-black ${isToday(date) ? "text-[#7D2834]" : "text-[#261D24]"}`}>{date.getDate()}</span>
                      {total > 0 && (
                        <div className="mt-0.5 flex flex-col gap-0.5">
                          {firstReal && (
                            <span className="hidden sm:block truncate text-[9px] font-mono font-bold text-[#5A2029]">
                              {firstReal.custom_sticker} {firstReal.title}
                            </span>
                          )}
                          <span className="flex gap-0.5 sm:hidden">
                            {Array.from({ length: Math.min(total, 4) }).map((_, i) => (
                              <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#7D2834]" />
                            ))}
                          </span>
                          {total > 1 && <span className="hidden sm:block text-[8px] font-mono text-stone-500">+{total - 1} more</span>}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="space-y-4 my-4">
              {upcomingAgenda.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-6xl mb-3">🕸️📅</div>
                  <p className="font-marker text-2xl text-[#7D2834]">No canon events on the docket yet!</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {upcomingAgenda.map((ev) => (
                    <EventCard key={ev.id} ev={ev} />
                  ))}
                </div>
              )}
              {pastAgenda.length > 0 && (
                <div className="pt-4 border-t-2 border-dashed border-[#8A7550]">
                  <button onClick={() => setShowPast((s) => !s)} className="font-mono text-[10px] font-black text-[#7D2834] uppercase cursor-pointer">
                    {showPast ? "Hide" : "Show"} {pastAgenda.length} past event{pastAgenda.length === 1 ? "" : "s"}
                  </button>
                  {showPast && (
                    <div className="grid sm:grid-cols-2 gap-4 mt-3 opacity-70">
                      {pastAgenda.map((ev) => (
                        <EventCard key={ev.id} ev={ev} compact />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="text-center pt-6 mt-6 border-t-3 border-dashed border-[#8A7550]">
            <p className="font-handwriting text-2xl sm:text-3xl text-[#5A2029]">
              &ldquo;Every plan we make together becomes canon.&rdquo;
            </p>
          </div>
        </section>
      </div>

      {/* Day sheet */}
      {selectedDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs" onClick={() => setSelectedDay(null)}>
          <div className="paper-sheet-solid max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 relative border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.9)] rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 w-24 h-6 tape-gold-solid -rotate-1 pointer-events-none" />
            <button onClick={() => setSelectedDay(null)} className="absolute top-4 right-4 p-1.5 bg-[#EFE4D6] hover:bg-white border-2 border-[#261D24] rounded-lg cursor-pointer">
              <X className="w-4 h-4" />
            </button>
            <h3 className="font-marker text-2xl text-[#261D24] mb-1">
              {selectedDay.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </h3>
            <button
              onClick={() => {
                openCreate(selectedDay);
                setSelectedDay(null);
              }}
              className="mb-4 px-3 py-1.5 bg-[#7D2834] text-[#FAF4EB] rounded-lg font-mono text-[10px] font-black uppercase flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add event for this day
            </button>
            <div className="space-y-3">
              {(dayIndex.get(dayKey(selectedDay))?.real || []).map((ev) => (
                <EventCard key={ev.id} ev={ev} compact />
              ))}
              {(dayIndex.get(dayKey(selectedDay))?.echoes || []).map(({ event }, i) => (
                <div key={i} className="border-2 border-dashed border-[#8A7550] rounded-lg p-3 opacity-70">
                  <p className="font-mono text-[9px] font-black uppercase text-[#8A7550]">↻ echo of a repeating event</p>
                  <p className="font-marker text-lg">{event.custom_sticker} {event.title}</p>
                </div>
              ))}
              {(dayIndex.get(dayKey(selectedDay))?.real.length || 0) === 0 && (dayIndex.get(dayKey(selectedDay))?.echoes.length || 0) === 0 && (
                <p className="font-handwriting text-xl text-stone-600 text-center py-6">Nothing pinned to this day yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="paper-sheet-solid max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 relative border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.95)] rounded-2xl">
            <div className="absolute -top-3.5 left-12 w-28 h-6 tape-pink-solid -rotate-2 pointer-events-none" />
            <div className="absolute -top-3.5 right-12 w-28 h-6 tape-red-solid rotate-2 pointer-events-none" />
            <button type="button" onClick={() => setIsModalOpen(false)} className="absolute top-5 right-5 p-2 rounded-lg bg-[#EFE4D6] hover:bg-[#E2D2C0] border-2 border-[#261D24] cursor-pointer">
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5 pb-3 border-b-3 border-dashed border-[#8A7550]">
              <span className="text-3xl">📌</span>
              <h2 className="font-marker text-2xl sm:text-3xl text-[#261D24]">{editingEvent ? "Edit Canon Event" : "Pin New Canon Event"}</h2>
            </div>

            <form onSubmit={runSave} className="space-y-4">
              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Title *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Rooftop date night"
                  className="w-full text-sm font-mono p-3 rounded-xl bg-white border-3 border-[#261D24] outline-none shadow-inner"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Starts *</label>
                  <input
                    type="datetime-local"
                    required
                    value={form.start}
                    onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
                    className="w-full text-xs font-mono p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none shadow-inner"
                  />
                </div>
                <div>
                  <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Ends (optional)</label>
                  <input
                    type="datetime-local"
                    value={form.end}
                    onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
                    className="w-full text-xs font-mono p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none shadow-inner"
                  />
                </div>
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Category</label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_PRESETS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, category: c.value, sticker: f.sticker === "🕸️" ? c.emoji : f.sticker }))}
                      className={`px-2.5 py-1 font-mono text-[10px] font-black border-2 border-[#261D24] rounded cursor-pointer transition ${form.category === c.value ? "bg-[#7D2834] text-[#FAF4EB]" : "bg-white hover:bg-stone-100"}`}
                    >
                      {c.emoji} {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Sticker</label>
                <div className="flex flex-wrap gap-1.5">
                  {STICKER_CHOICES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, sticker: s }))}
                      className={`text-xl p-1.5 rounded-lg border-2 cursor-pointer transition ${form.sticker === s ? "border-[#7D2834] bg-[#ECA8B8]/40 scale-110" : "border-transparent hover:bg-stone-200"}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="Optional"
                  className="w-full text-sm font-mono p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none shadow-inner"
                />
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full font-handwriting text-xl p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none resize-none shadow-inner"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Repeats</label>
                  <select
                    value={form.recurrence}
                    onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value as CanonEvent["recurrence"] }))}
                    className="w-full text-xs font-mono p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none shadow-inner"
                  >
                    <option value="none">Doesn&apos;t repeat</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Reminder</label>
                  <select
                    disabled={!form.reminderOn}
                    value={form.reminderMinutes}
                    onChange={(e) => setForm((f) => ({ ...f, reminderMinutes: Number(e.target.value) }))}
                    className="w-full text-xs font-mono p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none shadow-inner disabled:opacity-40"
                  >
                    {REMINDER_OFFSETS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={form.reminderOn} onChange={(e) => setForm((f) => ({ ...f, reminderOn: e.target.checked }))} className="w-5 h-5 accent-[#7D0000] cursor-pointer" />
                  <span className="font-mono text-xs font-bold">Set a reminder</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={form.rsvpRequired} onChange={(e) => setForm((f) => ({ ...f, rsvpRequired: e.target.checked }))} className="w-5 h-5 accent-[#7D0000] cursor-pointer" />
                  <span className="font-mono text-xs font-bold">Needs {partnerName}&apos;s Canon Confirmation before it&apos;s locked in</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t-3 border-dashed border-[#8A7550]">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 rounded-xl bg-[#EFE4D6] hover:bg-[#E2D2C0] font-mono text-xs font-black border-3 border-[#261D24] cursor-pointer">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || isSaving}
                  className="px-6 py-2.5 rounded-xl bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] font-mono text-xs font-black border-3 border-[#261D24] shadow-[4px_4px_0_#171B24] flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingEvent ? "Update Event" : "Pin Event"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Spider-sense celebration burst */}
      {celebrationEvent && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md" onClick={() => setCelebrationEvent(null)}>
          <div className="swing-in-burst text-center">
            <div className="text-7xl mb-4">🕸️⚡🕷️</div>
            <h2 className="font-marker text-4xl sm:text-6xl text-[#FAF4EB]">Today&apos;s the day!</h2>
            <p className="font-handwriting text-2xl text-[#E0B1AE] mt-2">{celebrationEvent.custom_sticker} {celebrationEvent.title}</p>
            <button onClick={() => setCelebrationEvent(null)} className="mt-6 px-6 py-3 bg-[#7D2834] text-[#F2E6D2] font-mono text-sm font-black border-3 border-[#261D24] cursor-pointer">
              LET&apos;S GO 🚀
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes stamp-slam-kf {
          0% { transform: scale(1.4) rotate(-8deg); }
          55% { transform: scale(0.94) rotate(2deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        .stamp-slam { animation: stamp-slam-kf 0.45s cubic-bezier(0.34,1.56,0.64,1); }

        @keyframes spidersense-pulse-slow { 0% { transform: scale(0.6); opacity: 0.7; } 100% { transform: scale(1.8); opacity: 0; } }
        @keyframes spidersense-pulse-medium { 0% { transform: scale(0.6); opacity: 0.8; } 100% { transform: scale(1.9); opacity: 0; } }
        @keyframes spidersense-pulse-urgent { 0% { transform: scale(0.6); opacity: 1; } 100% { transform: scale(2.1); opacity: 0; } }
        .spidersense-ring {
          position: absolute; inset: 0; border-radius: 9999px; border: 2px dashed #D9889E;
        }
        .spidersense-slow { animation: spidersense-pulse-slow 3.2s ease-out infinite; }
        .spidersense-medium { animation: spidersense-pulse-medium 1.8s ease-out infinite; border-color: #EAD9A9; }
        .spidersense-urgent { animation: spidersense-pulse-urgent 0.9s ease-out infinite; border-color: #E04B4B; }

        @keyframes swing-in-kf {
          0% { transform: translateX(-120vw) rotate(-25deg); opacity: 0; }
          60% { transform: translateX(4vw) rotate(4deg); opacity: 1; }
          100% { transform: translateX(0) rotate(0deg); opacity: 1; }
        }
        .swing-in-burst { animation: swing-in-kf 0.8s cubic-bezier(0.2,0.9,0.3,1) forwards; }
      `}</style>
    </main>
  );
}
