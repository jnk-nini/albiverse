"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bug,
  Check,
  Clock,
  Feather,
  Flower2,
  Heart,
  Infinity as InfinityIcon,
  Lightbulb,
  Loader2,
  Lock,
  Pencil,
  Reply,
  Search,
  Shuffle,
  Sparkles,
  Star,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";

/* ============================================================================
   CH.05 - LOVE LETTER JAR

   One glass jar on a lamp-lit desk, packed with rolled letters. Every letter is
   a physical object: a paper, an ink, a ribbon knotted round the middle, a wax
   seal, a strip of washi tape, a postage stamp and any stickers the writer
   pressed onto it. Those choices are columns on `letters`, so a scroll looks
   the same in the jar, in the reader, and in the composer preview.

   Opening pulls the roll out of the jar and unfurls it in the middle of the
   screen; closing rolls it back up and drops it home, and the jar reacts both
   times. Nothing here is an image file, so there is no asset to 404.

   All of this chapter's CSS lives in the scoped <style> block near the bottom
   of this file, per the house convention, so the chapter stays self-contained.
   ========================================================================= */

/* ---------------------------------------------------------------- types --- */

interface Sticker {
  id: string;
  char: string;
  x: number; // percent of the paper's width
  y: number; // percent of the paper's height
  rot: number;
  scale: number;
}

interface Letter {
  id: string;
  couple_id: string;
  sender_id: string;
  receiver_id: string | null;
  title: string;
  body: string;
  theme_style: string;
  occasion: string | null;
  ink_color: string;
  font_style: string;
  ribbon_color: string;
  wax_color: string;
  seal_emblem: string;
  tape_style: string;
  stamp_style: string;
  stickers: Sticker[];
  reply_to_id: string | null;
  is_private: boolean;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

interface Mark {
  id: string;
  letter_id: string;
  user_id: string;
  opened_at: string | null;
  is_favorite: boolean;
}

interface LetterJarScreenProps {
  userId: string;
  coupleId: string;
  myName: string;
  partnerId: string | null;
  partnerName: string;
  onBack: () => void;
}

type Draft = {
  id: string | null;
  title: string;
  body: string;
  occasion: string;
  theme_style: string;
  ink_color: string;
  font_style: string;
  ribbon_color: string;
  wax_color: string;
  seal_emblem: string;
  tape_style: string;
  stamp_style: string;
  stickers: Sticker[];
  is_private: boolean;
  scheduled_for: string; // datetime-local value, empty when not scheduled
  reply_to_id: string | null;
};

type OpenPhase = "flying" | "unrolling" | "open" | "rolling" | "returning";
type JarFx = "in" | "out" | "shake" | null;
type FilterId = "all" | "theirs" | "mine" | "sealed" | "keepsakes" | "locked" | "private";

/* Must stay ONE string literal: Supabase types the response off the literal, so
   splitting it widens the row type to GenericStringError[]. */
const LETTER_COLUMNS =
  "id, couple_id, sender_id, receiver_id, title, body, theme_style, occasion, ink_color, font_style, ribbon_color, wax_color, seal_emblem, tape_style, stamp_style, stickers, reply_to_id, is_private, scheduled_for, created_at, updated_at";

/* ------------------------------------------------------- design tokens --- */

/* Papers. `bg` goes straight into the background shorthand, `ink` is the pen
   colour the paper defaults to, `edge` is the deckled border. */
const PAPERS = [
  {
    id: "parchment",
    label: "PARCHMENT",
    chip: "#F1E3C6",
    ink: "#4A3524",
    edge: "#C4A472",
    bg: "radial-gradient(circle at 18% 12%, rgba(178,138,88,.20), transparent 55%), radial-gradient(circle at 82% 88%, rgba(150,110,70,.18), transparent 52%), linear-gradient(#F8EFDC, #EEDFC0)",
  },
  {
    id: "kraft",
    label: "KRAFT",
    chip: "#D3BB94",
    ink: "#3A2716",
    edge: "#9C7F52",
    bg: "radial-gradient(rgba(70,45,25,.11) 1px, transparent 1px) 0 0/7px 7px, linear-gradient(#DDC8A4, #C9B084)",
  },
  {
    id: "grid",
    label: "GRID",
    chip: "#FAF5EB",
    ink: "#2C2130",
    edge: "#D2B9C0",
    bg: "linear-gradient(to right, rgba(217,136,158,.22) 1px, transparent 1px) 0 0/18px 18px, linear-gradient(to bottom, rgba(217,136,158,.22) 1px, transparent 1px) 0 0/18px 18px, linear-gradient(#FBF6EC,#F5EDE0)",
  },
  {
    id: "ruled",
    label: "RULED",
    chip: "#FBF7EF",
    ink: "#23304A",
    edge: "#BFC7D4",
    bg: "linear-gradient(to right, transparent 42px, rgba(150,30,45,.32) 42px, rgba(150,30,45,.32) 43px, transparent 43px), repeating-linear-gradient(transparent 0 27px, rgba(60,80,120,.20) 27px 28px), linear-gradient(#FCF8F1,#F6F0E5)",
  },
  {
    id: "music",
    label: "MUSIC SHEET",
    chip: "#EFE5D3",
    ink: "#2E0509",
    edge: "#C0AE8C",
    bg: "repeating-linear-gradient(transparent 0 11px, rgba(60,24,32,.24) 12px 13px), linear-gradient(#F2E9D8,#E8DCC4)",
  },
  {
    id: "rose",
    label: "ROSE",
    chip: "#F0D2D6",
    ink: "#5A2029",
    edge: "#CE9BA4",
    bg: "radial-gradient(circle at 75% 18%, rgba(255,255,255,.55), transparent 45%), linear-gradient(#F6DCE0, #E9C3CA)",
  },
  {
    id: "newsprint",
    label: "NEWSPRINT",
    chip: "#E4E0D4",
    ink: "#1A1A1A",
    edge: "#A9A493",
    bg: "radial-gradient(rgba(30,30,30,.16) 1.1px, transparent 1.2px) 0 0/6px 6px, linear-gradient(#E8E4D8,#DCD7C7)",
  },
  {
    id: "midnight",
    label: "MIDNIGHT",
    chip: "#241A2C",
    ink: "#F0E2C8",
    edge: "#4C3A55",
    bg: "radial-gradient(circle at 26% 22%, rgba(217,136,158,.22), transparent 55%), radial-gradient(circle at 78% 80%, rgba(120,20,32,.28), transparent 55%), linear-gradient(#2A1E30,#1B1420)",
  },
] as const;

const INKS = [
  "#3A2A22", "#1F2A44", "#6E1220", "#2F4536",
  "#4A2350", "#7A3E12", "#141018", "#F0E2C8",
];

const FONTS = [
  { id: "handwriting", label: "HANDWRITTEN", cls: "font-handwriting", size: "text-[25px] leading-[1.42]" },
  { id: "marker", label: "MARKER", cls: "font-marker", size: "text-[18px] leading-[1.65]" },
  { id: "mono", label: "TYPEWRITER", cls: "font-mono", size: "text-[13px] leading-[1.9]" },
] as const;

const RIBBONS = [
  "#B34B63", "#7D2834", "#C5A467", "#EFE3CC",
  "#8FAEAA", "#6E4B7A", "#2F3E5B", "#2A2126",
];

const WAXES = ["#8B121E", "#450A10", "#B4566C", "#A8823A", "#5C3468", "#25313F"];

const EMBLEMS = [
  { id: "spider", label: "SPIDER", Icon: Bug },
  { id: "heart", label: "HEART", Icon: Heart },
  { id: "star", label: "STAR", Icon: Star },
  { id: "rose", label: "BLOOM", Icon: Flower2 },
  { id: "forever", label: "FOREVER", Icon: InfinityIcon },
  { id: "thwip", label: "THWIP", Icon: Zap },
] as const;

const TAPES = [
  { id: "none", label: "NO TAPE", css: "" },
  { id: "pink", label: "PINK", css: "tape-pink-solid" },
  { id: "red", label: "CRIMSON", css: "tape-red-solid" },
  { id: "gold", label: "GOLD", css: "tape-gold-solid" },
  { id: "dotted", label: "DOTTED", css: "lj-tape-dotted" },
] as const;

const STAMPS = [
  { id: "none", label: "NO STAMP", tag: "", tone: "" },
  { id: "gwen", label: "EARTH-65", tag: "EARTH-65", tone: "#D9889E" },
  { id: "peter", label: "EARTH-616", tag: "EARTH-616", tone: "#7D2834" },
  { id: "heart", label: "SEALED", tag: "SEALED WITH LOVE", tone: "#B4566C" },
  { id: "web", label: "AIR MAIL", tag: "WEB AIR MAIL", tone: "#8FAEAA" },
] as const;

const STICKER_PALETTE = [
  "🕷️", "🕸️", "💗", "🤍", "🌷", "🌾", "🌙", "⭐",
  "✨", "📌", "🎀", "🧵", "🫧", "🍓", "☕", "🎧",
  "🪩", "💌", "🔥", "🐝", "🍯", "🌈", "💫", "🖤",
];

/* The classic jar prompts. One click writes the tag, it stays editable. */
const OCCASION_PRESETS = [
  "open when you miss me",
  "open when you need a smile",
  "open when you can't sleep",
  "open when you're proud of yourself",
  "open on a bad day",
  "open on our anniversary",
  "open when you need a push",
  "open when I'm far away",
];

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "EVERYTHING" },
  { id: "sealed", label: "STILL SEALED" },
  { id: "theirs", label: "FROM THEM" },
  { id: "mine", label: "FROM ME" },
  { id: "keepsakes", label: "KEEPSAKES" },
  { id: "locked", label: "TIME LOCKED" },
  { id: "private", label: "PRIVATE" },
];

const MAX_TITLE = 90;
const MAX_BODY = 6000;
const MAX_OCCASION = 60;
const MAX_STICKERS = 14;

/* -------------------------------------------------------------- helpers --- */

const paperOf = (id: string) => PAPERS.find((p) => p.id === id) ?? PAPERS[0];
const fontOf = (id: string) => FONTS.find((f) => f.id === id) ?? FONTS[0];
const tapeOf = (id: string) => TAPES.find((t) => t.id === id) ?? TAPES[0];
const stampOf = (id: string) => STAMPS.find((s) => s.id === id) ?? STAMPS[0];
const emblemOf = (id: string) => EMBLEMS.find((e) => e.id === id) ?? EMBLEMS[0];

/* Deterministic per-letter jitter. The same id always lands in the same spot,
   so the pile does not reshuffle itself on every render or refetch. */
function hashInt(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // final avalanche, otherwise short sequential ids land in a visible pattern
  h ^= h >>> 13;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 16;
  return Math.abs(h);
}
const rand01 = (seed: string, salt: number) => ((hashInt(seed + ":" + salt) % 10000) / 10000);
const randRange = (seed: string, salt: number, min: number, max: number) =>
  min + rand01(seed, salt) * (max - min);

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

function countdownTo(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "ready";
  const days = Math.floor(diff / 86400000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} to go`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs >= 1) return `${hrs} hour${hrs === 1 ? "" : "s"} to go`;
  const mins = Math.max(1, Math.floor(diff / 60000));
  return `${mins} min to go`;
}

function toDatetimeLocal(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeStickers(raw: unknown): Sticker[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .slice(0, MAX_STICKERS)
    .map((s, i) => ({
      id: typeof s.id === "string" ? s.id : `s${i}`,
      char: typeof s.char === "string" ? s.char.slice(0, 4) : "✨",
      x: typeof s.x === "number" ? s.x : 50,
      y: typeof s.y === "number" ? s.y : 50,
      rot: typeof s.rot === "number" ? s.rot : 0,
      scale: typeof s.scale === "number" ? s.scale : 1,
    }));
}

function emptyDraft(): Draft {
  return {
    id: null,
    title: "",
    body: "",
    occasion: "",
    theme_style: "parchment",
    ink_color: PAPERS[0].ink,
    font_style: "handwriting",
    ribbon_color: RIBBONS[0],
    wax_color: WAXES[0],
    seal_emblem: "spider",
    tape_style: "pink",
    stamp_style: "gwen",
    stickers: [],
    is_private: false,
    scheduled_for: "",
    reply_to_id: null,
  };
}

function draftFromLetter(l: Letter): Draft {
  return {
    id: l.id,
    title: l.title,
    body: l.body,
    occasion: l.occasion ?? "",
    theme_style: l.theme_style,
    ink_color: l.ink_color,
    font_style: l.font_style,
    ribbon_color: l.ribbon_color,
    wax_color: l.wax_color,
    seal_emblem: l.seal_emblem,
    tape_style: l.tape_style,
    stamp_style: l.stamp_style,
    stickers: l.stickers,
    is_private: l.is_private,
    scheduled_for: toDatetimeLocal(l.scheduled_for),
    reply_to_id: l.reply_to_id,
  };
}

/* ------------------------------------------------- jar packing geometry --- */

interface Slot {
  x: number;      // percent, centre
  y: number;      // percent, centre
  len: number;    // percent of jar width
  thick: number;  // percent of jar height
  rot: number;
  z: number;
}

/* Fills the jar from the floor up, oldest at the bottom, and squeezes the rows
   closer together as the pile grows so the letters always stay inside the
   glass instead of stacking out through the lid. */
function computeSlots(ids: string[]): Record<string, Slot> {
  const n = ids.length;
  const out: Record<string, Slot> = {};
  if (n === 0) return out;

  const cols = n <= 3 ? 2 : n <= 8 ? 3 : n <= 16 ? 4 : 5;
  const rows = Math.ceil(n / cols);

  const FLOOR = 91;
  const CEIL = 7;
  const cellW = 86 / cols;
  // Rows overlap rather than sitting in a grid, and the whole stack hugs the
  // floor, so the pile reads as letters dropped on top of each other and
  // settled by gravity instead of a shelf of them floating mid-jar.
  const rowStep = Math.min(11.5, (FLOOR - CEIL) / rows);

  ids.forEach((id, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const baseX = 7 + (col + 0.5) * cellW;
    const baseY = FLOOR - (row + 0.5) * rowStep;

    const len = cellW * randRange(id, 3, 1.2, 1.58);
    // keep the roll inside the glass: an unrotated one hanging half out of the
    // jar reads as a rendering bug, not as a letter pressed against the side
    const margin = Math.min(24, len / 2);

    out[id] = {
      x: Math.max(
        margin,
        Math.min(100 - margin, baseX + randRange(id, 1, -cellW * 0.3, cellW * 0.3))
      ),
      y: baseY + randRange(id, 2, -rowStep * 0.26, rowStep * 0.26),
      len,
      thick: Math.min(6.2, Math.max(3.6, rowStep * 0.42)),
      rot: randRange(id, 4, -46, 46),
      z: 10 + (rows - row) * 2 + (i % 3),
    };
  });

  return out;
}


/* ============================================================== component == */

export default function LetterJarScreen({
  userId,
  coupleId,
  myName,
  partnerId,
  partnerName,
  onBack,
}: LetterJarScreenProps) {
  const supabase = useMemo(() => createClient(), []);

  const [letters, setLetters] = useState<Letter[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [filter, setFilter] = useState<FilterId>("all");
  const [search, setSearch] = useState("");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<OpenPhase | null>(null);
  const [ready, setReady] = useState(false);
  const [flight, setFlight] = useState<{ dx: number; dy: number; k: number } | null>(null);

  const [hovered, setHovered] = useState<string | null>(null);
  const [jarFx, setJarFx] = useState<JarFx>(null);
  /* Only a letter that was still sealed gets the petal shower, so re-reading an
     old one stays quiet. */
  const [brokeSeal, setBrokeSeal] = useState(false);
  const [lightsOn, setLightsOn] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  const [stageH, setStageH] = useState(560);
  const [reduceMotion, setReduceMotion] = useState(false);
  /* Render must not read the wall clock directly, and a wax lock that expires
     while the jar is open should fall away on its own. One slow tick does both. */
  const [now, setNow] = useState(() => Date.now());

  const scrollRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const phaseTimers = useRef<number[]>([]);
  const fxTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const prevCount = useRef<number | null>(null);

  /* -------------------------------------------------------- environment --- */

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);

    // leaves room for the action bar, which is bottom-anchored under the scroll
    const resize = () => setStageH(Math.min(620, Math.max(300, window.innerHeight - 190)));
    resize();
    window.addEventListener("resize", resize);

    try {
      const stored = window.localStorage.getItem("albiverse_jar_lights");
      // localStorage does not exist until after mount, so the stored preference
      // can only be applied from here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "off") setLightsOn(false);
    } catch {
      /* private mode, keep the lights on */
    }

    const tick = window.setInterval(() => setNow(Date.now()), 30000);

    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("resize", resize);
      window.clearInterval(tick);
    };
  }, []);

  const toggleLights = () => {
    setLightsOn((on) => {
      const next = !on;
      try {
        window.localStorage.setItem("albiverse_jar_lights", next ? "on" : "off");
      } catch {
        /* nothing to persist to, the toggle still works for this visit */
      }
      return next;
    });
  };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }, []);

  const pulseJar = useCallback((kind: Exclude<JarFx, null>) => {
    setJarFx(kind);
    if (fxTimer.current) window.clearTimeout(fxTimer.current);
    fxTimer.current = window.setTimeout(() => setJarFx(null), kind === "shake" ? 900 : 1100);
  }, []);

  useEffect(
    () => () => {
      phaseTimers.current.forEach((t) => window.clearTimeout(t));
      if (fxTimer.current) window.clearTimeout(fxTimer.current);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );

  /* --------------------------------------------------------------- data --- */

  const fetchAll = useCallback(async () => {
    if (!coupleId) return;
    try {
      const [letterRes, markRes] = await Promise.all([
        supabase
          .from("letters")
          .select(LETTER_COLUMNS)
          .eq("couple_id", coupleId)
          .order("created_at", { ascending: true }),
        supabase
          .from("letter_marks")
          .select("id, letter_id, user_id, opened_at, is_favorite")
          .eq("couple_id", coupleId),
      ]);

      if (letterRes.error) throw letterRes.error;
      if (markRes.error) throw markRes.error;

      const rows = (letterRes.data ?? []) as unknown as Array<Record<string, unknown>>;
      setLetters(
        rows.map((r) => ({
          id: String(r.id),
          couple_id: String(r.couple_id),
          sender_id: String(r.sender_id),
          receiver_id: (r.receiver_id as string | null) ?? null,
          title: (r.title as string) || "Untitled",
          body: (r.body as string) || "",
          theme_style: (r.theme_style as string) || "parchment",
          occasion: (r.occasion as string | null) ?? null,
          ink_color: (r.ink_color as string) || "#3A2A22",
          font_style: (r.font_style as string) || "handwriting",
          ribbon_color: (r.ribbon_color as string) || RIBBONS[0],
          wax_color: (r.wax_color as string) || WAXES[0],
          seal_emblem: (r.seal_emblem as string) || "spider",
          tape_style: (r.tape_style as string) || "pink",
          stamp_style: (r.stamp_style as string) || "gwen",
          stickers: normalizeStickers(r.stickers),
          reply_to_id: (r.reply_to_id as string | null) ?? null,
          is_private: Boolean(r.is_private),
          scheduled_for: (r.scheduled_for as string | null) ?? null,
          created_at: String(r.created_at),
          updated_at: String(r.updated_at),
        }))
      );
      setMarks((markRes.data ?? []) as unknown as Mark[]);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the letter jar.");
    } finally {
      setLoading(false);
    }
  }, [coupleId, supabase]);

  useEffect(() => {
    // Same load-then-subscribe idiom the other chapters use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll();

    const channel = supabase
      .channel(`letters_${coupleId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "letters", filter: `couple_id=eq.${coupleId}` },
        () => fetchAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "letter_marks", filter: `couple_id=eq.${coupleId}` },
        () => fetchAll()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [coupleId, supabase, fetchAll]);

  /* A letter arriving from the other side should make the jar react too, not
     just one added from this device. */
  useEffect(() => {
    if (loading) return;
    if (prevCount.current !== null && letters.length > prevCount.current) {
      pulseJar("in");
    }
    prevCount.current = letters.length;
  }, [letters.length, loading, pulseJar]);

  /* ------------------------------------------------------ derived state --- */

  const myMarks = useMemo(() => {
    const map: Record<string, Mark> = {};
    marks.forEach((m) => {
      if (m.user_id === userId) map[m.letter_id] = m;
    });
    return map;
  }, [marks, userId]);

  const theirMarks = useMemo(() => {
    const map: Record<string, Mark> = {};
    marks.forEach((m) => {
      if (m.user_id !== userId) map[m.letter_id] = m;
    });
    return map;
  }, [marks, userId]);

  const isLocked = useCallback(
    (l: Letter) =>
      Boolean(l.scheduled_for) &&
      new Date(l.scheduled_for as string).getTime() > now &&
      l.sender_id !== userId,
    [userId, now]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return letters.filter((l) => {
      if (q) {
        const hay = `${l.title} ${l.occasion ?? ""} ${l.body}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      switch (filter) {
        case "theirs":
          return l.sender_id !== userId;
        case "mine":
          return l.sender_id === userId;
        case "sealed":
          return !myMarks[l.id]?.opened_at;
        case "keepsakes":
          return Boolean(myMarks[l.id]?.is_favorite);
        case "locked":
          return Boolean(l.scheduled_for) && new Date(l.scheduled_for as string).getTime() > now;
        case "private":
          return l.is_private;
        default:
          return true;
      }
    });
  }, [letters, filter, search, userId, myMarks, now]);

  const slots = useMemo(() => computeSlots(visible.map((l) => l.id)), [visible]);

  const stats = useMemo(() => {
    const sealed = letters.filter((l) => !myMarks[l.id]?.opened_at).length;
    const keepsakes = letters.filter((l) => myMarks[l.id]?.is_favorite).length;
    const locked = letters.filter(
      (l) => l.scheduled_for && new Date(l.scheduled_for).getTime() > now
    ).length;
    return { total: letters.length, sealed, opened: letters.length - sealed, keepsakes, locked };
  }, [letters, myMarks, now]);

  const active = activeId ? letters.find((l) => l.id === activeId) ?? null : null;

  const nameOf = useCallback(
    (senderId: string) => (senderId === userId ? myName : partnerName),
    [userId, myName, partnerName]
  );

  /* ------------------------------------------------- open / close a roll --- */

  const clearPhaseTimers = useCallback(() => {
    phaseTimers.current.forEach((t) => window.clearTimeout(t));
    phaseTimers.current = [];
  }, []);

  const markOpened = useCallback(
    async (letter: Letter) => {
      if (myMarks[letter.id]?.opened_at) return;
      const { error: markErr } = await supabase.from("letter_marks").upsert(
        {
          letter_id: letter.id,
          couple_id: coupleId,
          user_id: userId,
          opened_at: new Date().toISOString(),
        },
        { onConflict: "letter_id,user_id" }
      );
      if (markErr) {
        // Not fatal: the letter is open and readable either way.
        showToast("Opened, but the read receipt did not save.");
      }
    },
    [coupleId, supabase, userId, myMarks, showToast]
  );

  const openLetter = useCallback(
    (letter: Letter, originEl: HTMLElement | null) => {
      if (phase) return;

      if (isLocked(letter)) {
        pulseJar("shake");
        showToast(
          `Sealed until ${formatDate(letter.scheduled_for as string)}. ${countdownTo(letter.scheduled_for as string)}.`
        );
        return;
      }

      const target = {
        w: Math.min(560, window.innerWidth * 0.8),
        cx: window.innerWidth / 2,
        cy: window.innerHeight / 2,
      };

      if (originEl && !reduceMotion) {
        const r = originEl.getBoundingClientRect();
        setFlight({
          dx: r.left + r.width / 2 - target.cx,
          dy: r.top + r.height / 2 - target.cy,
          k: Math.max(0.08, Math.min(1, r.width / target.w)),
        });
      } else {
        setFlight({ dx: 0, dy: 0, k: 0.9 });
      }

      clearPhaseTimers();
      setReady(false);
      setBrokeSeal(!myMarks[letter.id]?.opened_at);
      setActiveId(letter.id);
      setPhase("flying");
      pulseJar("out");
      markOpened(letter);
    },
    [phase, isLocked, pulseJar, showToast, markOpened, reduceMotion, clearPhaseTimers, myMarks]
  );

  /* The sequence advances from here rather than from a chain of timers started
     inside the click handler. A CSS transition only runs if the browser painted
     the starting state first, and a timer set before React has even committed
     the stage can fire in the same frame as the mount, which makes the roll
     snap open with no animation at all. Waiting for a real frame fixes that;
     the timeout is the fallback for a backgrounded tab, where rAF never runs. */
  useEffect(() => {
    if (!phase) return;
    const step = (ms: number, next: () => void) => {
      const id = window.setTimeout(next, reduceMotion ? 0 : ms);
      phaseTimers.current.push(id);
      return () => window.clearTimeout(id);
    };

    switch (phase) {
      case "flying": {
        let inner = 0;
        const outer = requestAnimationFrame(() => {
          inner = requestAnimationFrame(() => setPhase("unrolling"));
        });
        const cancelFallback = step(220, () => setPhase("unrolling"));
        return () => {
          cancelAnimationFrame(outer);
          cancelAnimationFrame(inner);
          cancelFallback();
        };
      }
      case "unrolling":
        return step(620, () => setPhase("open"));
      case "open":
        return step(660, () => setReady(true));
      case "rolling":
        return step(620, () => {
          setPhase("returning");
          pulseJar("in");
        });
      case "returning":
        return step(600, () => {
          setPhase(null);
          setActiveId(null);
          setFlight(null);
        });
      default:
        return;
    }
  }, [phase, reduceMotion, pulseJar]);

  const closeLetter = useCallback(() => {
    if (!phase || phase === "rolling" || phase === "returning") return;
    clearPhaseTimers();
    setReady(false);
    setPhase("rolling");
  }, [phase, clearPhaseTimers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (composerOpen) return; // the composer owns Escape while it is up
      if (confirmDelete) {
        setConfirmDelete(null);
        return;
      }
      if (activeId) closeLetter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, closeLetter, composerOpen, confirmDelete]);

  /* ----------------------------------------------------------- actions ---- */

  const [runPickRandom] = useGuardedAction(() => {
    if (phase) return;
    const pool = visible.length ? visible : letters;
    const unread = pool.filter((l) => !myMarks[l.id]?.opened_at && !isLocked(l));
    const source = unread.length ? unread : pool.filter((l) => !isLocked(l));
    if (!source.length) {
      showToast("Nothing in the jar to draw yet.");
      return;
    }
    const pick = source[Math.floor(Math.random() * source.length)];
    pulseJar("shake");
    window.setTimeout(
      () => openLetter(pick, scrollRefs.current[pick.id] ?? null),
      reduceMotion ? 0 : 700
    );
  }, 900);

  const [runToggleKeepsake, keepsakeBusy] = useGuardedAction(async (letterId: string) => {
    const current = myMarks[letterId];
    const next = !current?.is_favorite;
    const { error: favErr } = await supabase.from("letter_marks").upsert(
      {
        letter_id: letterId,
        couple_id: coupleId,
        user_id: userId,
        is_favorite: next,
        ...(current?.opened_at ? {} : { opened_at: new Date().toISOString() }),
      },
      { onConflict: "letter_id,user_id" }
    );
    if (favErr) {
      showToast("Could not save that keepsake.");
      return;
    }
    showToast(next ? "Kept on the shelf." : "Taken off the shelf.");
    fetchAll();
  }, 400);

  const [runDelete, deleteBusy] = useGuardedAction(async (letterId: string) => {
    const { error: delErr } = await supabase
      .from("letters")
      .delete()
      .eq("id", letterId)
      .eq("couple_id", coupleId);

    if (delErr) {
      showToast("Could not take that one out of the jar.");
      return;
    }
    setConfirmDelete(null);
    if (activeId === letterId) {
      clearPhaseTimers();
      setReady(false);
      setPhase(null);
      setActiveId(null);
      setFlight(null);
    }
    pulseJar("out");
    showToast("Letter taken out of the jar.");
    prevCount.current = Math.max(0, (prevCount.current ?? 1) - 1);
    fetchAll();
  }, 600);

  /* ---------------------------------------------------------- composer ---- */

  const openComposer = (next: Draft) => {
    setDraft(next);
    setComposerOpen(true);
  };

  const startNewLetter = () => openComposer(emptyDraft());

  const startEdit = (l: Letter) => {
    if (l.sender_id !== userId) {
      showToast(`Only ${partnerName} can rewrite their own letter.`);
      return;
    }
    openComposer(draftFromLetter(l));
  };

  const startReply = (l: Letter) => {
    const base = emptyDraft();
    openComposer({
      ...base,
      title: l.title.toLowerCase().startsWith("re:") ? l.title : `Re: ${l.title}`,
      reply_to_id: l.id,
    });
  };

  const saveDraft = async () => {
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title) {
      showToast("Give the letter a title first.");
      return;
    }
    if (!body) {
      showToast("The paper is still blank.");
      return;
    }

    setSaving(true);
    const payload = {
      couple_id: coupleId,
      sender_id: userId,
      receiver_id: draft.is_private ? userId : partnerId,
      title: title.slice(0, MAX_TITLE),
      body: body.slice(0, MAX_BODY),
      occasion: draft.occasion.trim().slice(0, MAX_OCCASION) || null,
      theme_style: draft.theme_style,
      ink_color: draft.ink_color,
      font_style: draft.font_style,
      ribbon_color: draft.ribbon_color,
      wax_color: draft.wax_color,
      seal_emblem: draft.seal_emblem,
      tape_style: draft.tape_style,
      stamp_style: draft.stamp_style,
      stickers: draft.stickers.slice(0, MAX_STICKERS),
      reply_to_id: draft.reply_to_id,
      is_private: draft.is_private,
      scheduled_for: draft.scheduled_for ? new Date(draft.scheduled_for).toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const res = draft.id
      ? await supabase.from("letters").update(payload).eq("id", draft.id).eq("couple_id", coupleId)
      : await supabase.from("letters").insert(payload);

    setSaving(false);

    if (res.error) {
      showToast(
        draft.id
          ? "Could not save the rewrite."
          : "Could not roll that letter up. Try again."
      );
      return;
    }

    setComposerOpen(false);
    if (!draft.id) pulseJar("in");
    showToast(draft.id ? "Letter rewritten and re-rolled." : "Rolled up and dropped in the jar.");
    fetchAll();
  };

  const [runSave] = useGuardedAction(saveDraft, 700);

  /* ------------------------------------------------------------- render --- */

  const target = active ?? null;

  return (
    <main className={`lj-root ${lightsOn ? "lights-on" : "lights-off"}`}>
      <ScopedStyles />

      {/* ---------------------------------------------- ambient scenery --- */}
      <div className="lj-desk" aria-hidden />
      <div className="lj-lamp" aria-hidden />
      <div className="lj-vignette" aria-hidden />
      <FairyString bulbs={17} className="lj-string-top" />
      <FairyString bulbs={13} className="lj-string-second" />
      <div className="lj-spider-drop" aria-hidden>
        <span className="lj-spider-thread" />
        <span className="lj-spider-body">🕷️</span>
      </div>
      <WebCorner className="lj-web-tl" />
      <WebCorner className="lj-web-br" />

      {/* ------------------------------------------------------- header --- */}
      <header className="relative z-20 flex flex-wrap items-center gap-3 px-4 sm:px-8 pt-5 pb-2">
        <button onClick={onBack} className="lj-chip-btn" type="button">
          <ArrowLeft className="w-3.5 h-3.5" />
          BACK TO CONTENTS
        </button>

        <span className="postage-stamp -rotate-2 hidden sm:inline-block">CH. 05 • LETTER JAR</span>

        <div className="flex-1 min-w-[120px]" />

        <button
          onClick={toggleLights}
          className={`lj-chip-btn ${lightsOn ? "is-on" : ""}`}
          type="button"
          aria-pressed={lightsOn}
        >
          <Lightbulb className="w-3.5 h-3.5" />
          {lightsOn ? "LIGHTS ON" : "LIGHTS OFF"}
        </button>
      </header>

      <div className="relative z-20 px-4 sm:px-8">
        <h1 className="font-marker text-4xl sm:text-6xl text-[#F6E7D2] leading-none">
          Love Letter Jar
        </h1>
        <p className="font-handwriting text-2xl text-[#E0B1AE] mt-1">
          every note we ever rolled up, kept behind glass
        </p>
      </div>

      {/* --------------------------------------------------------- body --- */}
      <div className="relative z-20 grid gap-5 px-4 sm:px-8 pt-5 pb-14 lg:grid-cols-[268px_minmax(0,1fr)_286px]">
        {/* ============ LEFT RAIL: the writing desk ============ */}
        <aside className="flex flex-col gap-4 order-2 lg:order-1">
          <button onClick={startNewLetter} className="lj-write-btn group" type="button">
            <span className="lj-write-thwip">THWIP!</span>
            <Feather className="w-6 h-6" />
            <span className="text-left leading-tight">
              <span className="block font-marker text-2xl">Write a letter</span>
              <span className="block font-mono text-[9px] tracking-[.18em] opacity-80">
                ROLL IT UP AND DROP IT IN
              </span>
            </span>
          </button>

          <button onClick={() => runPickRandom()} className="lj-panel-btn" type="button">
            <Shuffle className="w-4 h-4" />
            <span>
              <span className="block font-marker text-lg leading-tight">Pick one for me</span>
              <span className="block font-mono text-[9px] tracking-[.16em] opacity-70">
                SHAKE THE JAR
              </span>
            </span>
          </button>

          <div className="lj-panel">
            <span className="lj-panel-title">FIND A LETTER</span>
            <div className="relative mt-2">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#7D2834]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="title, tag or words..."
                className="lj-input pl-8"
              />
            </div>

            <span className="lj-panel-title mt-4 block">THE PILE</span>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  type="button"
                  className={`lj-filter ${filter === f.id ? "is-active" : ""}`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {(search || filter !== "all") && (
              <p className="font-mono text-[10px] text-[#5A2029] mt-3">
                showing {visible.length} of {letters.length}
              </p>
            )}
          </div>

          <div className="lj-panel">
            <span className="lj-panel-title">THE COUNT</span>
            <ul className="mt-2 space-y-1.5">
              <StatRow label="in the jar" value={stats.total} />
              <StatRow label="still sealed" value={stats.sealed} />
              <StatRow label="read" value={stats.opened} />
              <StatRow label="keepsakes" value={stats.keepsakes} />
              {stats.locked > 0 && <StatRow label="time locked" value={stats.locked} />}
            </ul>
          </div>
        </aside>

        {/* ============ CENTRE: the jar ============ */}
        <section className="order-1 lg:order-2 flex flex-col items-center">
          {loading ? (
            <div className="lj-jar-loading">
              <Loader2 className="w-6 h-6 animate-spin text-[#E0B1AE]" />
              <p className="font-mono text-[11px] tracking-[.2em] text-[#E0B1AE] mt-3">
                UNSEALING THE JAR...
              </p>
            </div>
          ) : (
            <>
              <div className={`lj-jar-wrap ${jarFx ? `fx-${jarFx}` : ""}`}>
                {/* lid, twine and the heart tag */}
                <div className="lj-lid" aria-hidden />
                <div className="lj-neck" aria-hidden>
                  <span className="lj-neck-thread" />
                  <span className="lj-neck-thread second" />
                </div>
                <span className="lj-twine" aria-hidden />
                <span className="lj-bow" aria-hidden />
                <span className="lj-tag" aria-hidden>
                  <Heart className="w-3.5 h-3.5" />
                </span>

                {/* the glass */}
                <div className="lj-glass">
                  <span className="lj-glass-glow" aria-hidden />
                  <span className="lj-glass-shine" aria-hidden />
                  <span className="lj-glass-shine second" aria-hidden />

                  {/* fairy lights coiled inside */}
                  {lightsOn &&
                    Array.from({ length: 9 }).map((_, i) => (
                      <span
                        key={i}
                        className="lj-inner-bulb"
                        aria-hidden
                        style={{
                          left: `${12 + ((i * 37) % 76)}%`,
                          top: `${24 + ((i * 53) % 62)}%`,
                          animationDelay: `${(i % 5) * 0.32}s`,
                        }}
                      />
                    ))}

                  {/* the letters themselves */}
                  <div className="lj-field">
                    {visible.map((l) => {
                      const slot = slots[l.id];
                      if (!slot) return null;
                      const sealed = !myMarks[l.id]?.opened_at;
                      const locked = isLocked(l);
                      const isActive = activeId === l.id;
                      return (
                        <button
                          key={l.id}
                          ref={(el) => {
                            scrollRefs.current[l.id] = el;
                          }}
                          type="button"
                          onClick={(e) => openLetter(l, e.currentTarget)}
                          onMouseEnter={() => setHovered(l.id)}
                          onMouseLeave={() => setHovered((h) => (h === l.id ? null : h))}
                          onFocus={() => setHovered(l.id)}
                          onBlur={() => setHovered((h) => (h === l.id ? null : h))}
                          aria-label={`${sealed ? "Sealed letter" : "Letter"}: ${l.title}, from ${nameOf(l.sender_id)}`}
                          className={`lj-scroll ${sealed ? "is-sealed" : ""} ${locked ? "is-locked" : ""} ${
                            isActive ? "is-out" : ""
                          } ${myMarks[l.id]?.is_favorite ? "is-keepsake" : ""}`}
                          style={{
                            left: `${slot.x}%`,
                            top: `${slot.y}%`,
                            width: `${slot.len}%`,
                            height: `${slot.thick}%`,
                            zIndex: hovered === l.id ? 60 : slot.z,
                            ["--rot" as string]: `${slot.rot}deg`,
                            ["--ribbon" as string]: l.ribbon_color,
                            ["--wax" as string]: l.wax_color,
                            ["--paper" as string]: paperOf(l.theme_style).chip,
                            ["--paper-edge" as string]: paperOf(l.theme_style).edge,
                          }}
                        >
                          <span className="lj-scroll-tube" />
                          <span className="lj-scroll-cap left" />
                          <span className="lj-scroll-cap right" />
                          <span className="lj-scroll-ribbon" />
                          {sealed && <span className="lj-scroll-wax" />}
                          {locked && (
                            <span className="lj-scroll-lock">
                              <Lock className="w-2.5 h-2.5" strokeWidth={3} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {visible.length === 0 && (
                    <div className="lj-empty">
                      <Feather className="w-5 h-5 mx-auto" />
                      <p className="font-handwriting text-xl mt-1 leading-tight">
                        {letters.length === 0
                          ? "nothing rolled up yet"
                          : "nothing matches that"}
                      </p>
                      <p className="font-mono text-[9px] tracking-[.15em] mt-1 opacity-70">
                        {letters.length === 0 ? "WRITE THE FIRST ONE" : "TRY ANOTHER FILTER"}
                      </p>
                    </div>
                  )}
                </div>

                {/* the paper label pasted on the glass */}
                <div className="lj-label" aria-hidden>
                  <span className="font-marker text-base leading-none">Our Letters</span>
                  <span className="font-mono text-[8px] tracking-[.14em] mt-1 block opacity-80">
                    {stats.sealed} SEALED • {stats.opened} READ
                  </span>
                </div>

                {/* the effect that fires whenever the jar gains or loses one */}
                {jarFx && jarFx !== "shake" && (
                  <div className="lj-burst" aria-hidden>
                    {Array.from({ length: 12 }).map((_, i) => (
                      <span
                        key={i}
                        className="lj-spark"
                        style={{
                          ["--sx" as string]: `${Math.cos((i / 12) * Math.PI * 2) * 90}px`,
                          ["--sy" as string]: `${Math.sin((i / 12) * Math.PI * 2) * 90 - 20}px`,
                          animationDelay: `${i * 0.022}s`,
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* hover preview, outside the glass so it is never clipped */}
                {hovered && slots[hovered] && !phase && (
                  <HoverTag
                    letter={letters.find((l) => l.id === hovered) as Letter}
                    slot={slots[hovered]}
                    fromName={nameOf((letters.find((l) => l.id === hovered) as Letter).sender_id)}
                    sealed={!myMarks[hovered]?.opened_at}
                    locked={isLocked(letters.find((l) => l.id === hovered) as Letter)}
                  />
                )}
              </div>

              <p className="font-handwriting text-xl text-[#C9A9A2] mt-4 text-center max-w-sm">
                {stats.total === 0
                  ? "the glass is empty. Write the first one and it rolls itself up."
                  : stats.sealed > 0
                    ? `${stats.sealed} still sealed. Tap a roll to break the wax.`
                    : "every letter in here has been read at least once"}
              </p>
            </>
          )}

          {error && (
            <div className="paper-kraft-torn px-4 py-3 mt-4 max-w-sm rotate-1">
              <p className="font-mono text-[11px] text-[#4A1018] leading-relaxed">{error}</p>
            </div>
          )}
        </section>

        {/* ============ RIGHT RAIL: the shelf ============ */}
        <aside className="flex flex-col gap-4 order-3">
          <div className="lj-panel">
            <span className="lj-panel-title">THE KEEPSAKE SHELF</span>
            <div className="mt-2 space-y-1.5">
              {letters.filter((l) => myMarks[l.id]?.is_favorite).length === 0 ? (
                <p className="font-handwriting text-lg text-[#5A2029]/80 leading-tight">
                  star a letter and it lives up here
                </p>
              ) : (
                letters
                  .filter((l) => myMarks[l.id]?.is_favorite)
                  .slice(0, 6)
                  .map((l) => (
                    <IndexRow
                      key={l.id}
                      letter={l}
                      fromName={nameOf(l.sender_id)}
                      sealed={!myMarks[l.id]?.opened_at}
                      locked={isLocked(l)}
                      keepsake
                      onOpen={(el) => openLetter(l, el)}
                    />
                  ))
              )}
            </div>
          </div>

          <div className="lj-panel">
            <span className="lj-panel-title">EVERY LETTER</span>
            <div className="mt-2 space-y-1.5 max-h-[52vh] overflow-y-auto lj-scrollbar pr-1">
              {[...visible].reverse().map((l) => (
                <IndexRow
                  key={l.id}
                  letter={l}
                  fromName={nameOf(l.sender_id)}
                  sealed={!myMarks[l.id]?.opened_at}
                  locked={isLocked(l)}
                  keepsake={Boolean(myMarks[l.id]?.is_favorite)}
                  onOpen={(el) => openLetter(l, el)}
                />
              ))}
              {visible.length === 0 && (
                <p className="font-handwriting text-lg text-[#5A2029]/80">nothing here yet</p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ------------------------------------------------- the open scroll --- */}
      {target && phase && (
        <div className="lj-reader" role="dialog" aria-modal="true" aria-label={target.title}>
          <button className="lj-reader-scrim" onClick={closeLetter} aria-label="Close the letter" />

          <div
            className={`lj-stage phase-${phase}`}
            style={{
              height: stageH,
              ["--stage-h" as string]: `${stageH}px`,
              ["--fx" as string]: `${flight?.dx ?? 0}px`,
              ["--fy" as string]: `${flight?.dy ?? 0}px`,
              ["--fk" as string]: `${flight?.k ?? 0.2}`,
            }}
          >
            <span className="lj-rollbar top" style={{ ["--ribbon" as string]: target.ribbon_color }} />
            <span className="lj-rollbar bottom" style={{ ["--ribbon" as string]: target.ribbon_color }} />

            <div className="lj-paper-clip">
              <LetterPaper
                letter={target}
                fromName={nameOf(target.sender_id)}
                toName={
                  target.is_private
                    ? "kept to yourself"
                    : target.sender_id === userId
                      ? partnerName
                      : myName
                }
                replyTo={
                  target.reply_to_id
                    ? letters.find((l) => l.id === target.reply_to_id)?.title ?? null
                    : null
                }
              />
            </div>
          </div>

          {/* the action bar rides under the scroll, never on the paper */}
          {ready && (
            <div className="lj-actions">
              <div className="lj-receipt">
                {target.sender_id === userId ? (
                  theirMarks[target.id]?.opened_at ? (
                    <>
                      <Check className="w-3 h-3" />
                      {partnerName} opened this {formatRelative(theirMarks[target.id].opened_at as string)}
                    </>
                  ) : (
                    <>
                      <Clock className="w-3 h-3" />
                      {partnerName} has not opened this one yet
                    </>
                  )
                ) : (
                  <>
                    <Feather className="w-3 h-3" />
                    written {formatRelative(target.created_at)}
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={() => runToggleKeepsake(target.id)}
                  className={`lj-action ${myMarks[target.id]?.is_favorite ? "is-on" : ""}`}
                  type="button"
                  disabled={keepsakeBusy}
                >
                  <Star className="w-3.5 h-3.5" />
                  {myMarks[target.id]?.is_favorite ? "KEEPSAKE" : "KEEP"}
                </button>

                {!target.is_private && (
                  <button onClick={() => startReply(target)} className="lj-action" type="button">
                    <Reply className="w-3.5 h-3.5" />
                    REPLY
                  </button>
                )}

                {target.sender_id === userId && (
                  <button onClick={() => startEdit(target)} className="lj-action" type="button">
                    <Pencil className="w-3.5 h-3.5" />
                    REWRITE
                  </button>
                )}

                <button
                  onClick={() => setConfirmDelete(target.id)}
                  className="lj-action is-danger"
                  type="button"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  TAKE OUT
                </button>

                <button onClick={closeLetter} className="lj-action is-primary" type="button">
                  <X className="w-3.5 h-3.5" />
                  ROLL IT BACK UP
                </button>
              </div>
            </div>
          )}

          {/* a soft petal fall the first time a sealed letter is broken open */}
          {ready && brokeSeal && (
            <div className="lj-petals" aria-hidden>
              {Array.from({ length: 10 }).map((_, i) => (
                <span
                  key={i}
                  className="lj-petal"
                  style={{
                    left: `${8 + i * 9}%`,
                    animationDelay: `${i * 0.24}s`,
                    ["--drift" as string]: `${(i % 2 ? 1 : -1) * (18 + i * 4)}px`,
                  }}
                >
                  {i % 3 === 0 ? "🌸" : i % 3 === 1 ? "✨" : "🤍"}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* --------------------------------------------------- the composer --- */}
      {composerOpen && (
        <Composer
          draft={draft}
          setDraft={setDraft}
          myName={myName}
          partnerName={partnerName}
          saving={saving}
          replyToTitle={
            draft.reply_to_id
              ? letters.find((l) => l.id === draft.reply_to_id)?.title ?? null
              : null
          }
          onClose={() => setComposerOpen(false)}
          onSave={() => runSave()}
        />
      )}

      {/* ------------------------------------------------ delete confirm --- */}
      {confirmDelete && (
        <div className="lj-confirm-wrap" role="dialog" aria-modal="true">
          <button
            className="lj-reader-scrim"
            onClick={() => setConfirmDelete(null)}
            aria-label="Cancel"
          />
          <div className="lj-confirm">
            <span className="tape-red-solid absolute -top-3 left-8 w-20 h-5 -rotate-6" aria-hidden />
            <h3 className="font-marker text-2xl text-[#450A10]">Take it out for good?</h3>
            <p className="font-handwriting text-xl text-[#5A2029] mt-1 leading-snug">
              &ldquo;{letters.find((l) => l.id === confirmDelete)?.title}&rdquo; leaves the jar and
              there is no putting it back.
            </p>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => runDelete(confirmDelete)}
                className="lj-action is-danger"
                type="button"
                disabled={deleteBusy}
              >
                {deleteBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                YES, TAKE IT OUT
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                className="lj-action is-primary"
                type="button"
              >
                KEEP IT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- toaster --- */}
      {toast && (
        <div className="lj-toast" role="status">
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span>{toast}</span>
        </div>
      )}
    </main>
  );
}

/* ============================================================ sub-parts == */

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="font-handwriting text-lg text-[#5A2029]">{label}</span>
      <span className="flex-1 border-b border-dotted border-[#7D2834]/35 translate-y-[-3px]" />
      <span className="font-marker text-lg text-[#450A10]">{value}</span>
    </li>
  );
}

function FairyString({ bulbs, className }: { bulbs: number; className: string }) {
  return (
    <div className={`lj-string ${className}`} aria-hidden>
      <svg viewBox="0 0 1200 140" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <path d="M0 6 Q 300 122 600 66 T 1200 10" fill="none" stroke="#4A392C" strokeWidth="2.5" />
      </svg>
      {Array.from({ length: bulbs }).map((_, i) => {
        const t = i / (bulbs - 1);
        // rounded, or the server and the client serialise the float differently
        // and React reports a hydration mismatch on every bulb
        const x = (t * 100).toFixed(3);
        const y = (
          6 + Math.sin(t * Math.PI) * 58 + (t > 0.5 ? -14 * (t - 0.5) * 2 : 0)
        ).toFixed(2);
        return (
          <span
            key={i}
            className="lj-bulb"
            style={{
              left: `${x}%`,
              top: `${y}px`,
              ["--bulb" as string]:
                i % 3 === 0 ? "#FFD9A0" : i % 3 === 1 ? "#FFC1CE" : "#FFEBC4",
              animationDelay: `${(i % 6) * 0.26}s`,
            }}
          />
        );
      })}
    </div>
  );
}

function WebCorner({ className }: { className: string }) {
  return (
    <svg className={`lj-web ${className}`} viewBox="0 0 120 120" aria-hidden>
      {[22, 44, 66, 88, 110].map((r) => (
        <path
          key={r}
          d={`M0 ${r} Q ${r * 0.42} ${r * 0.42} ${r} 0`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      ))}
      {[0, 22.5, 45, 67.5, 90].map((a) => {
        const rad = (a * Math.PI) / 180;
        return (
          <line
            key={a}
            x1="0"
            y1="0"
            x2={Math.sin(rad) * 118}
            y2={Math.cos(rad) * 118}
            stroke="currentColor"
            strokeWidth="1.2"
          />
        );
      })}
    </svg>
  );
}

function HoverTag({
  letter,
  slot,
  fromName,
  sealed,
  locked,
}: {
  letter: Letter;
  slot: Slot;
  fromName: string;
  sealed: boolean;
  locked: boolean;
}) {
  return (
    <div
      className="lj-hovertag"
      style={{
        left: `${Math.min(88, Math.max(12, slot.x))}%`,
        top: `${slot.y}%`,
      }}
    >
      <span className="tape-gold-solid absolute -top-2.5 left-1/2 -translate-x-1/2 w-12 h-4 -rotate-3" />
      <span className="font-mono text-[9px] font-black tracking-[.16em] text-[#7D2834]">
        FROM {fromName.toUpperCase()}
      </span>
      <p className="font-marker text-base text-[#1A0D10] leading-tight mt-0.5">{letter.title}</p>
      {letter.occasion && (
        <p className="font-handwriting text-base text-[#5A2029] leading-tight">{letter.occasion}</p>
      )}
      <div className="flex items-center gap-1.5 mt-1.5 font-mono text-[9px] text-[#5A2029]">
        <span>{formatDate(letter.created_at)}</span>
        <span className="opacity-40">•</span>
        {locked ? (
          <span className="inline-flex items-center gap-1 text-[#7D2834] font-black">
            <Lock className="w-2.5 h-2.5" /> TIME LOCKED
          </span>
        ) : sealed ? (
          <span className="text-[#7D2834] font-black">STILL SEALED</span>
        ) : (
          <span className="opacity-70">READ</span>
        )}
      </div>
    </div>
  );
}

function IndexRow({
  letter,
  fromName,
  sealed,
  locked,
  keepsake,
  onOpen,
}: {
  letter: Letter;
  fromName: string;
  sealed: boolean;
  locked: boolean;
  keepsake: boolean;
  onOpen: (el: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget)}
      className={`lj-indexrow ${sealed ? "is-sealed" : ""}`}
      style={{ ["--ribbon" as string]: letter.ribbon_color }}
    >
      <span className="lj-indexrow-knot" />
      <span className="flex-1 min-w-0 text-left">
        <span className="block font-marker text-sm text-[#1A0D10] truncate">{letter.title}</span>
        <span className="block font-mono text-[9px] text-[#5A2029]/80 truncate">
          {fromName} • {formatDate(letter.created_at)}
        </span>
      </span>
      {keepsake && <Star className="w-3 h-3 text-[#A8823A] shrink-0" />}
      {locked ? (
        <Lock className="w-3 h-3 text-[#7D2834] shrink-0" />
      ) : sealed ? (
        <span className="lj-indexrow-dot" />
      ) : null}
    </button>
  );
}

/* --------------------------------------------------- the letter itself --- */

function LetterPaper({
  letter,
  fromName,
  toName,
  replyTo,
}: {
  letter: Letter;
  fromName: string;
  toName: string;
  replyTo: string | null;
}) {
  const paper = paperOf(letter.theme_style);
  const font = fontOf(letter.font_style);
  const tape = tapeOf(letter.tape_style);
  const stamp = stampOf(letter.stamp_style);
  const Emblem = emblemOf(letter.seal_emblem).Icon;

  return (
    <article
      className={`lj-paper lj-scrollbar ${stamp.tag ? "lj-has-stamp" : ""}`}
      style={{ background: paper.bg, borderColor: paper.edge, color: letter.ink_color }}
    >
      {tape.css && (
        <span className={`${tape.css} lj-paper-tape left`} aria-hidden />
      )}
      {tape.css && (
        <span className={`${tape.css} lj-paper-tape right`} aria-hidden />
      )}

      {stamp.tag && (
        <span className="lj-paper-stamp" style={{ borderColor: stamp.tone, color: stamp.tone }} aria-hidden>
          <span className="text-lg leading-none">🕸️</span>
          <span className="block font-mono text-[7px] font-black tracking-[.1em] mt-0.5">
            {stamp.tag}
          </span>
        </span>
      )}

      <div className="lj-paper-body">
        <div className="lj-paper-head">
          {letter.occasion && (
            <span className="lj-occasion-tag">{letter.occasion}</span>
          )}

          <h2 className="font-marker text-3xl sm:text-4xl leading-tight mt-1" style={{ color: letter.ink_color }}>
            {letter.title}
          </h2>

          <p className="font-mono text-[10px] tracking-[.15em] opacity-70 mt-1.5">
            FROM {fromName.toUpperCase()} • TO {toName.toUpperCase()} • {formatDate(letter.created_at).toUpperCase()}
          </p>

          {replyTo && (
            <p className="font-handwriting text-lg opacity-75 mt-1">in reply to &ldquo;{replyTo}&rdquo;</p>
          )}
        </div>

        <span className="block h-px my-4" style={{ background: `${letter.ink_color}33` }} />

        <div className={`${font.cls} ${font.size} whitespace-pre-wrap break-words`}>
          {letter.body}
        </div>

        <div className="lj-paper-sign flex items-end justify-between gap-4">
          <span className="font-handwriting text-2xl opacity-90">yours, {fromName}</span>
          <span
            className="lj-paper-seal"
            style={{ background: `radial-gradient(circle at 35% 32%, ${letter.wax_color}, #2b0407)` }}
            aria-hidden
          >
            <Emblem className="w-5 h-5" strokeWidth={2.2} />
          </span>
        </div>
      </div>

      {/* whatever the writer pressed onto the page */}
      {letter.stickers.map((s) => (
        <span
          key={s.id}
          className="lj-sticker"
          aria-hidden
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            transform: `translate(-50%, -50%) rotate(${s.rot}deg) scale(${s.scale})`,
          }}
        >
          {s.char}
        </span>
      ))}
    </article>
  );
}

/* -------------------------------------------------------- the composer --- */

type ComposerTab = "write" | "paper" | "ink" | "seal" | "trim" | "stickers" | "deliver";

const COMPOSER_TABS: { id: ComposerTab; label: string }[] = [
  { id: "write", label: "WRITE" },
  { id: "paper", label: "PAPER" },
  { id: "ink", label: "INK" },
  { id: "seal", label: "RIBBON & SEAL" },
  { id: "trim", label: "TAPE & STAMP" },
  { id: "stickers", label: "STICKERS" },
  { id: "deliver", label: "DELIVER" },
];

function Composer({
  draft,
  setDraft,
  myName,
  partnerName,
  saving,
  replyToTitle,
  onClose,
  onSave,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  myName: string;
  partnerName: string;
  saving: boolean;
  replyToTitle: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [tab, setTab] = useState<ComposerTab>("write");
  const [selected, setSelected] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<string | null>(null);
  /* Sticker ids come off a counter rather than a random seed so the same paste
     never renders two elements with the same key. Seeded past whatever the
     letter already carries when the composer opens. */
  const stickerSeq = useRef(draft.stickers.length + 1);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selected) setSelected(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, selected]);

  /* Stickers are dragged straight on the preview, so what you place is exactly
     what lands on the paper. */
  const moveSticker = useCallback(
    (clientX: number, clientY: number) => {
      const id = dragging.current;
      const el = previewRef.current;
      const box = el?.getBoundingClientRect();
      if (!id || !el || !box) return;
      /* Stickers are absolutely positioned against the paper's full scroll
         height, so the drop point has to be measured the same way or a sticker
         jumps as soon as the paper is scrolled. */
      const x = Math.max(3, Math.min(97, ((clientX - box.left) / el.clientWidth) * 100));
      const y = Math.max(
        2,
        Math.min(98, ((clientY - box.top + el.scrollTop) / el.scrollHeight) * 100)
      );
      setDraft((d) => ({
        ...d,
        stickers: d.stickers.map((s) => (s.id === id ? { ...s, x, y } : s)),
      }));
    },
    [setDraft]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      moveSticker(e.clientX, e.clientY);
    };
    const onUp = () => {
      dragging.current = null;
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [moveSticker]);

  const addSticker = (char: string) => {
    if (draft.stickers.length >= MAX_STICKERS) return;
    const n = stickerSeq.current++;
    const id = `s${n}`;
    // Walk each new sticker to its own spot instead of dropping them all on
    // top of each other, then let the writer drag it wherever they want.
    setDraft((d) => ({
      ...d,
      stickers: [
        ...d.stickers,
        {
          id,
          char,
          x: 18 + ((n * 37) % 61),
          y: 16 + ((n * 53) % 67),
          rot: ((n * 29) % 38) - 19,
          scale: 1,
        },
      ],
    }));
    setSelected(id);
  };

  const updateSelected = (patch: Partial<Sticker>) =>
    setDraft((d) => ({
      ...d,
      stickers: d.stickers.map((s) => (s.id === selected ? { ...s, ...patch } : s)),
    }));

  const removeSelected = () => {
    setDraft((d) => ({ ...d, stickers: d.stickers.filter((s) => s.id !== selected) }));
    setSelected(null);
  };

  const paper = paperOf(draft.theme_style);
  const font = fontOf(draft.font_style);
  const tape = tapeOf(draft.tape_style);
  const stamp = stampOf(draft.stamp_style);
  const Emblem = emblemOf(draft.seal_emblem).Icon;
  const selectedSticker = draft.stickers.find((s) => s.id === selected) ?? null;

  return (
    <div className="lj-composer" role="dialog" aria-modal="true" aria-label="Write a letter">
      <div className="lj-composer-head">
        <span className="postage-stamp -rotate-2">
          {draft.id ? "REWRITING" : "NEW LETTER"}
        </span>
        <h2 className="font-marker text-2xl sm:text-3xl text-[#F6E7D2]">
          {draft.id ? "Unroll and rewrite" : "Write it, roll it, drop it in"}
        </h2>
        <div className="flex-1" />
        <button onClick={onSave} className="lj-save-btn" type="button" disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {draft.id ? "SAVE THE REWRITE" : "SEAL IT AND DROP IT IN"}
        </button>
        <button onClick={onClose} className="lj-chip-btn" type="button">
          <X className="w-3.5 h-3.5" />
          CANCEL
        </button>
      </div>

      <div className="lj-composer-body">
        {/* -------- live preview: the exact paper that goes in the jar ---- */}
        <div className="lj-preview-stage">
          <span className="font-mono text-[9px] tracking-[.2em] text-[#C9A9A2] mb-2 block">
            HOW IT WILL LOOK WHEN THEY UNROLL IT
          </span>

          <div
            ref={previewRef}
            className={`lj-preview lj-scrollbar ${stamp.tag ? "lj-has-stamp" : ""}`}
            style={{ background: paper.bg, borderColor: paper.edge, color: draft.ink_color }}
            onPointerDown={() => setSelected(null)}
          >
            {tape.css && <span className={`${tape.css} lj-paper-tape left`} aria-hidden />}
            {tape.css && <span className={`${tape.css} lj-paper-tape right`} aria-hidden />}

            {stamp.tag && (
              <span
                className="lj-paper-stamp"
                style={{ borderColor: stamp.tone, color: stamp.tone }}
                aria-hidden
              >
                <span className="text-lg leading-none">🕸️</span>
                <span className="block font-mono text-[7px] font-black tracking-[.1em] mt-0.5">
                  {stamp.tag}
                </span>
              </span>
            )}

            <div className="lj-paper-body">
              <div className="lj-paper-head">
                {draft.occasion && <span className="lj-occasion-tag">{draft.occasion}</span>}

                <h3 className="font-marker text-3xl leading-tight mt-1">
                  {draft.title || "your title here"}
                </h3>

                <p className="font-mono text-[10px] tracking-[.15em] opacity-70 mt-1.5">
                  FROM {myName.toUpperCase()} • TO{" "}
                  {draft.is_private ? "YOURSELF" : partnerName.toUpperCase()}
                </p>

                {replyToTitle && (
                  <p className="font-handwriting text-lg opacity-75 mt-1">
                    in reply to &ldquo;{replyToTitle}&rdquo;
                  </p>
                )}
              </div>

              <span className="block h-px my-4" style={{ background: `${draft.ink_color}33` }} />

              <div className={`${font.cls} ${font.size} whitespace-pre-wrap break-words min-h-[80px]`}>
                {draft.body || "start writing and it appears here, in your ink, on your paper."}
              </div>

              <div className="lj-paper-sign flex items-end justify-between gap-4">
                <span className="font-handwriting text-2xl opacity-90">yours, {myName}</span>
                <span
                  className="lj-paper-seal"
                  style={{ background: `radial-gradient(circle at 35% 32%, ${draft.wax_color}, #2b0407)` }}
                  aria-hidden
                >
                  <Emblem className="w-5 h-5" strokeWidth={2.2} />
                </span>
              </div>
            </div>

            {draft.stickers.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`lj-sticker is-editable ${selected === s.id ? "is-selected" : ""}`}
                style={{
                  left: `${s.x}%`,
                  top: `${s.y}%`,
                  transform: `translate(-50%, -50%) rotate(${s.rot}deg) scale(${s.scale})`,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  dragging.current = s.id;
                  setSelected(s.id);
                }}
                aria-label={`Sticker ${s.char}`}
              >
                {s.char}
              </button>
            ))}
          </div>

          {selectedSticker && (
            <div className="lj-sticker-tools">
              <span className="font-mono text-[9px] tracking-[.14em]">{selectedSticker.char} SELECTED</span>
              <button type="button" onClick={() => updateSelected({ rot: selectedSticker.rot - 15 })}>
                ROTATE -
              </button>
              <button type="button" onClick={() => updateSelected({ rot: selectedSticker.rot + 15 })}>
                ROTATE +
              </button>
              <button
                type="button"
                onClick={() => updateSelected({ scale: Math.max(0.5, selectedSticker.scale - 0.15) })}
              >
                SMALLER
              </button>
              <button
                type="button"
                onClick={() => updateSelected({ scale: Math.min(2.6, selectedSticker.scale + 0.15) })}
              >
                BIGGER
              </button>
              <button type="button" className="is-danger" onClick={removeSelected}>
                REMOVE
              </button>
            </div>
          )}
        </div>

        {/* -------------------------- the customisation rail -------------- */}
        <div className="lj-rail">
          <div className="lj-tabs">
            {COMPOSER_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`lj-tab ${tab === t.id ? "is-active" : ""}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="lj-rail-body lj-scrollbar">
            {tab === "write" && (
              <>
                <Field label="TITLE">
                  <input
                    value={draft.title}
                    maxLength={MAX_TITLE}
                    onChange={(e) => set("title", e.target.value)}
                    placeholder="a name for this one"
                    className="lj-input"
                  />
                </Field>

                <Field label="THE LETTER">
                  <textarea
                    value={draft.body}
                    maxLength={MAX_BODY}
                    onChange={(e) => set("body", e.target.value)}
                    placeholder="say the thing you keep not saying out loud..."
                    rows={12}
                    className="lj-input font-handwriting text-xl leading-snug resize-y"
                  />
                  <span className="font-mono text-[9px] opacity-60 block text-right mt-1">
                    {draft.body.length} / {MAX_BODY}
                  </span>
                </Field>

                <Field label="HANDWRITING">
                  <div className="grid grid-cols-3 gap-1.5">
                    {FONTS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => set("font_style", f.id)}
                        className={`lj-opt ${draft.font_style === f.id ? "is-active" : ""} ${f.cls}`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </Field>
              </>
            )}

            {tab === "paper" && (
              <Field label="PICK THE PAPER">
                <div className="grid grid-cols-2 gap-2">
                  {PAPERS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        set("theme_style", p.id);
                        set("ink_color", p.ink);
                      }}
                      className={`lj-paper-opt ${draft.theme_style === p.id ? "is-active" : ""}`}
                      style={{ background: p.bg, borderColor: p.edge, color: p.ink }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="font-handwriting text-lg text-[#C9A9A2] mt-3 leading-snug">
                  picking a paper also sets its matching ink. change the ink after if you like.
                </p>
              </Field>
            )}

            {tab === "ink" && (
              <Field label="INK COLOUR">
                <div className="flex flex-wrap gap-2">
                  {INKS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => set("ink_color", c)}
                      className={`lj-swatch ${draft.ink_color === c ? "is-active" : ""}`}
                      style={{ background: c }}
                      aria-label={`Ink ${c}`}
                    />
                  ))}
                </div>
                <span className="lj-panel-title block mt-4 mb-1.5">OR MIX YOUR OWN</span>
                <input
                  type="color"
                  value={draft.ink_color}
                  onChange={(e) => set("ink_color", e.target.value)}
                  className="lj-color"
                />
              </Field>
            )}

            {tab === "seal" && (
              <>
                <Field label="RIBBON ROUND THE ROLL">
                  <div className="flex flex-wrap gap-2">
                    {RIBBONS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => set("ribbon_color", c)}
                        className={`lj-swatch ${draft.ribbon_color === c ? "is-active" : ""}`}
                        style={{ background: c }}
                        aria-label={`Ribbon ${c}`}
                      />
                    ))}
                  </div>
                </Field>

                <Field label="WAX COLOUR">
                  <div className="flex flex-wrap gap-2">
                    {WAXES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => set("wax_color", c)}
                        className={`lj-swatch ${draft.wax_color === c ? "is-active" : ""}`}
                        style={{ background: `radial-gradient(circle at 35% 32%, ${c}, #2b0407)` }}
                        aria-label={`Wax ${c}`}
                      />
                    ))}
                  </div>
                </Field>

                <Field label="WHAT IS PRESSED INTO IT">
                  <div className="grid grid-cols-3 gap-1.5">
                    {EMBLEMS.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => set("seal_emblem", e.id)}
                        className={`lj-opt flex flex-col items-center gap-1 ${
                          draft.seal_emblem === e.id ? "is-active" : ""
                        }`}
                      >
                        <e.Icon className="w-4 h-4" />
                        {e.label}
                      </button>
                    ))}
                  </div>
                </Field>
              </>
            )}

            {tab === "trim" && (
              <>
                <Field label="WASHI TAPE">
                  <div className="grid grid-cols-2 gap-1.5">
                    {TAPES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => set("tape_style", t.id)}
                        className={`lj-opt ${draft.tape_style === t.id ? "is-active" : ""}`}
                      >
                        {t.css && <span className={`${t.css} inline-block w-6 h-2.5 mr-1.5 align-middle`} />}
                        {t.label}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="POSTAGE STAMP">
                  <div className="grid grid-cols-2 gap-1.5">
                    {STAMPS.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => set("stamp_style", s.id)}
                        className={`lj-opt ${draft.stamp_style === s.id ? "is-active" : ""}`}
                        style={s.tone ? { borderColor: s.tone } : undefined}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </Field>
              </>
            )}

            {tab === "stickers" && (
              <>
                <Field label={`PRESS THEM ON (${draft.stickers.length}/${MAX_STICKERS})`}>
                  <div className="grid grid-cols-8 gap-1">
                    {STICKER_PALETTE.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => addSticker(c)}
                        className="lj-sticker-opt"
                        aria-label={`Add sticker ${c}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </Field>
                <p className="font-handwriting text-lg text-[#C9A9A2] leading-snug">
                  drag any sticker around on the paper to place it. tap one to rotate, resize or peel
                  it off.
                </p>
                {draft.stickers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft((d) => ({ ...d, stickers: [] }));
                      setSelected(null);
                    }}
                    className="lj-action is-danger mt-3"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    PEEL THEM ALL OFF
                  </button>
                )}
              </>
            )}

            {tab === "deliver" && (
              <>
                <Field label="OPEN WHEN... (THE KRAFT TAG)">
                  <input
                    value={draft.occasion}
                    maxLength={MAX_OCCASION}
                    onChange={(e) => set("occasion", e.target.value)}
                    placeholder="open when you miss me"
                    className="lj-input"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {OCCASION_PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => set("occasion", p)}
                        className={`lj-filter ${draft.occasion === p ? "is-active" : ""}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="TIME LOCK">
                  <input
                    type="datetime-local"
                    value={draft.scheduled_for}
                    onChange={(e) => set("scheduled_for", e.target.value)}
                    className="lj-input"
                  />
                  <p className="font-handwriting text-lg text-[#C9A9A2] mt-1.5 leading-snug">
                    {draft.scheduled_for
                      ? `${partnerName} cannot break the wax until then. You can always read your own.`
                      : "leave this empty and they can open it the moment it lands."}
                  </p>
                  {draft.scheduled_for && (
                    <button
                      type="button"
                      onClick={() => set("scheduled_for", "")}
                      className="lj-action mt-2"
                    >
                      <X className="w-3.5 h-3.5" />
                      REMOVE THE LOCK
                    </button>
                  )}
                </Field>

                <Field label="WHO CAN SEE IT">
                  <button
                    type="button"
                    onClick={() => set("is_private", !draft.is_private)}
                    className={`lj-toggle ${draft.is_private ? "is-on" : ""}`}
                  >
                    <span className="lj-toggle-knob" />
                    <span className="font-mono text-[10px] font-black tracking-[.14em]">
                      {draft.is_private ? "PRIVATE, ONLY YOU" : `SHARED WITH ${partnerName.toUpperCase()}`}
                    </span>
                  </button>
                  <p className="font-handwriting text-lg text-[#C9A9A2] mt-1.5 leading-snug">
                    a private letter never leaves your side of the jar, not even its title.
                  </p>
                </Field>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <span className="lj-panel-title block mb-1.5">{label}</span>
      {children}
    </div>
  );
}

/* =============================================================== styles == */
/* Chapter-scoped, per the house rule that a chapter carries its own CSS so it
   stays independently droppable. Motion is transform/opacity/clip-path only,
   so nothing here forces a per-frame repaint of the jar. */

function ScopedStyles() {
  return (
    <style>{`
      .lj-root {
        position: relative;
        min-height: 100vh;
        overflow-x: hidden;
        background:
          radial-gradient(ellipse at 50% -10%, #3A2129 0%, transparent 55%),
          linear-gradient(#1B1216 0%, #140D11 60%, #0F0A0D 100%);
        color: #F2E6D2;
      }

      /* ---------- desk, lamp, vignette ---------- */
      .lj-desk {
        position: absolute; inset: auto 0 0 0; height: 34vh; pointer-events: none;
        background:
          repeating-linear-gradient(92deg, rgba(0,0,0,.16) 0 2px, transparent 2px 26px),
          linear-gradient(#3A2419, #24160F);
        box-shadow: inset 0 14px 40px rgba(0,0,0,.7);
      }
      .lj-lamp {
        position: absolute; inset: 0; pointer-events: none;
        background: radial-gradient(ellipse 70% 46% at 50% 46%, rgba(255,196,128,.22), transparent 62%);
        transition: opacity .5s ease;
      }
      .lj-vignette {
        position: absolute; inset: 0; pointer-events: none;
        background: radial-gradient(ellipse at 50% 40%, transparent 42%, rgba(8,5,7,.72) 100%);
      }
      .lights-off .lj-lamp { opacity: .28; }
      .lights-off .lj-bulb, .lights-off .lj-inner-bulb { opacity: .12 !important; animation: none !important; }

      /* ---------- fairy lights ---------- */
      .lj-string { position: absolute; left: 0; right: 0; height: 130px; pointer-events: none; z-index: 5; }
      .lj-string-top { top: -6px; }
      .lj-string-second { top: 46px; opacity: .55; transform: scaleX(-1); }
      .lj-bulb {
        position: absolute; width: 9px; height: 9px; border-radius: 999px;
        background: var(--bulb);
        box-shadow: 0 0 12px 4px color-mix(in srgb, var(--bulb) 55%, transparent);
        animation: lj-twinkle 2.6s ease-in-out infinite;
      }
      @keyframes lj-twinkle { 0%,100% { opacity: .42; } 50% { opacity: 1; } }

      /* ---------- spider on a thread ---------- */
      .lj-spider-drop {
        position: absolute; top: 0; right: 12%; z-index: 6; pointer-events: none;
        display: flex; flex-direction: column; align-items: center;
        transform-origin: top center;
        animation: lj-swing 6.5s ease-in-out infinite;
      }
      .lj-spider-thread { width: 1px; height: 108px; background: linear-gradient(#6B5A50, #B9A79A); }
      .lj-spider-body { font-size: 22px; line-height: 1; margin-top: -2px; }
      @keyframes lj-swing { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }

      /* ---------- web corners ---------- */
      .lj-web { position: absolute; width: 190px; height: 190px; color: rgba(224,177,174,.16); pointer-events: none; z-index: 2; }
      .lj-web-tl { top: 84px; left: -14px; }
      .lj-web-br { bottom: -14px; right: -14px; transform: rotate(180deg); }

      /* ---------- chrome ---------- */
      .lj-chip-btn {
        display: inline-flex; align-items: center; gap: .4rem;
        font-family: 'Space Grotesk', monospace; font-size: 10px; font-weight: 900;
        letter-spacing: .14em; text-transform: uppercase;
        color: #2A1B20; background: #E8D9C1;
        border: 2px solid #261D24; box-shadow: 3px 3px 0 #0C0709;
        padding: .4rem .7rem; cursor: pointer;
        transition: transform .12s ease, background .2s ease;
      }
      .lj-chip-btn:hover { background: #F2E6D2; }
      .lj-chip-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #0C0709; }
      .lj-chip-btn.is-on { background: #EAD9A9; }

      .lj-panel {
        position: relative;
        background:
          radial-gradient(rgba(60,35,30,.07) .8px, transparent .8px) 0 0/8px 8px,
          linear-gradient(#F6EEDD, #EBDFC7);
        border: 3px solid #1C1317; border-radius: .6rem;
        box-shadow: 7px 8px 0 rgba(9,6,8,.75);
        padding: .85rem .9rem 1rem;
        color: #2A1B20;
      }
      .lj-panel-title {
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        letter-spacing: .2em; text-transform: uppercase; color: #7D2834;
      }

      .lj-write-btn {
        position: relative; display: flex; align-items: center; gap: .7rem;
        background: linear-gradient(#8C1826, #59101B);
        color: #FBF3E6; border: 3px solid #1C1317; border-radius: .6rem;
        box-shadow: 7px 8px 0 rgba(9,6,8,.8);
        padding: .95rem 1rem; cursor: pointer; text-align: left;
        transition: transform .14s cubic-bezier(.34,1.56,.64,1);
      }
      .lj-write-btn:hover { transform: translateY(-3px) rotate(-.6deg); }
      .lj-write-btn:active { transform: translate(2px,3px); box-shadow: 3px 3px 0 rgba(9,6,8,.8); }
      .lj-write-thwip {
        position: absolute; top: -12px; right: -10px; rotate: 12deg;
        font-family: 'Permanent Marker', cursive; font-size: 13px;
        background: #EAD9A9; color: #7D2834; padding: 1px 8px;
        border: 2px solid #1C1317; box-shadow: 2px 2px 0 #0C0709;
      }

      .lj-panel-btn {
        display: flex; align-items: center; gap: .6rem; text-align: left;
        background: #E8D9C1; color: #2A1B20;
        border: 3px solid #1C1317; border-radius: .6rem;
        box-shadow: 5px 6px 0 rgba(9,6,8,.7);
        padding: .7rem .85rem; cursor: pointer;
        transition: transform .14s ease, background .2s ease;
      }
      .lj-panel-btn:hover { background: #F4E9D6; transform: translateY(-2px); }
      .lj-panel-btn:active { transform: translate(2px,2px); box-shadow: 2px 2px 0 rgba(9,6,8,.7); }

      .lj-input {
        width: 100%; background: #FDF8EE; color: #2A1B20;
        border: 2px solid #7D2834; border-radius: .35rem;
        padding: .45rem .6rem;
        font-family: 'Space Grotesk', monospace; font-size: 12px;
        outline: none;
      }
      .lj-input:focus { border-color: #450A10; box-shadow: 0 0 0 3px rgba(217,136,158,.35); }
      .lj-input::placeholder { color: rgba(42,27,32,.42); }

      .lj-filter {
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        letter-spacing: .1em; text-transform: uppercase;
        padding: .28rem .5rem; cursor: pointer;
        border: 2px solid #7D2834; color: #7D2834; background: transparent;
        border-radius: .3rem; transition: background .18s ease, color .18s ease;
      }
      .lj-filter:hover { background: rgba(125,40,52,.12); }
      .lj-filter.is-active { background: #7D2834; color: #F6E7D2; }

      /* ---------- the jar ---------- */
      .lj-jar-loading {
        display: grid; place-items: center; text-align: center;
        width: clamp(250px, 80vw, 384px); height: clamp(330px, 50vh, 492px);
        border: 3px dashed rgba(224,177,174,.35); border-radius: 18px 18px 44px 44px;
      }

      .lj-jar-wrap {
        position: relative;
        width: clamp(250px, 80vw, 384px);
        height: clamp(330px, 50vh, 492px);
        margin-top: 52px;
        transform-origin: 50% 100%;
      }

      .lj-lid {
        position: absolute; left: 50%; translate: -50% 0; top: -30px;
        width: 78%; height: 28px; border-radius: 9px 9px 3px 3px;
        border: 3px solid #35251A;
        background:
          radial-gradient(rgba(90,60,30,.35) 1.2px, transparent 1.3px) 0 0/9px 9px,
          linear-gradient(180deg, #D9AF75, #A87C46);
        box-shadow: 0 6px 14px rgba(0,0,0,.55);
        z-index: 4;
      }
      .lj-neck {
        position: absolute; left: 50%; translate: -50% 0; top: -8px;
        width: 72%; height: 36px;
        border: 3px solid rgba(176,196,197,.75); border-bottom: 0;
        border-radius: 8px 8px 0 0;
        background: linear-gradient(115deg, rgba(226,236,233,.30), rgba(226,236,233,.10) 45%, rgba(226,236,233,.34));
        box-shadow: inset 0 -10px 18px rgba(0,0,0,.22);
        z-index: 3;
      }
      .lj-neck-thread {
        position: absolute; left: 6%; right: 6%; top: 9px; height: 2px;
        background: rgba(226,236,233,.20); border-radius: 999px;
      }
      .lj-neck-thread.second { top: 17px; }

      .lj-twine {
        position: absolute; left: 50%; translate: -50% 0; top: 14px;
        width: 76%; height: 6px; border-radius: 999px;
        background: repeating-linear-gradient(72deg, #B99B6E 0 3px, #8F764F 3px 6px);
        z-index: 6;
      }
      .lj-bow {
        position: absolute; left: 50%; translate: -50% 0; top: 8px;
        width: 16px; height: 16px; border-radius: 999px; background: #A8895C;
        border: 2px solid #6E5836; z-index: 7;
      }
      .lj-bow::before, .lj-bow::after {
        content: ""; position: absolute; top: 0px;
        width: 26px; height: 15px; border: 2px solid #6E5836;
        background: #B99B6E; border-radius: 60% 40% 45% 55%;
      }
      .lj-bow::before { right: 12px; rotate: -18deg; }
      .lj-bow::after { left: 12px; rotate: 18deg; }

      .lj-tag {
        position: absolute; left: calc(50% + 34px); top: 26px;
        width: 30px; height: 30px; rotate: 8deg;
        display: grid; place-items: center;
        background: #C9A778; color: #6B3E2A;
        border: 2px solid #8A6E4E; border-radius: 6px;
        box-shadow: 2px 3px 6px rgba(0,0,0,.5);
        z-index: 7;
      }
      .lj-tag::before {
        content: ""; position: absolute; top: -16px; left: 50%; translate: -50% 0;
        width: 1.5px; height: 16px; background: #B99B6E;
      }

      .lj-glass {
        position: absolute; inset: 24px 0 0 0;
        border: 3px solid rgba(159,179,180,.62);
        border-radius: 12px 12px 44px 44px;
        background: linear-gradient(112deg, rgba(226,236,233,.16), rgba(226,236,233,.05) 42%, rgba(226,236,233,.19));
        overflow: hidden;
        box-shadow: inset 0 -18px 40px rgba(0,0,0,.34), 0 24px 46px rgba(0,0,0,.6);
      }
      .lj-glass-glow {
        position: absolute; inset: 0;
        background: radial-gradient(ellipse at 50% 100%, rgba(255,196,128,.34), rgba(255,150,120,.12) 48%, transparent 74%);
        transition: opacity .45s ease;
      }
      .lights-off .lj-glass-glow { opacity: .22; }
      .lj-glass-shine {
        position: absolute; left: 13px; top: 14px; bottom: 40px; width: 8px;
        border-radius: 999px; background: rgba(255,255,255,.20);
      }
      .lj-glass-shine.second { left: auto; right: 16px; width: 4px; opacity: .55; }

      .lj-inner-bulb {
        position: absolute; width: 6px; height: 6px; border-radius: 999px;
        background: #FFD9A0; box-shadow: 0 0 10px 4px rgba(255,201,130,.5);
        animation: lj-twinkle 3.1s ease-in-out infinite;
        z-index: 8; pointer-events: none;
      }

      .lj-field { position: absolute; inset: 0; }

      /* ---------- one rolled letter ---------- */
      .lj-scroll {
        position: absolute; padding: 0; background: none; border: 0; cursor: pointer;
        translate: -50% -50%;
        transform: rotate(var(--rot));
        transition: transform .22s cubic-bezier(.34,1.56,.64,1), opacity .3s ease;
        min-width: 34px; min-height: 9px;
      }
      .lj-scroll:hover, .lj-scroll:focus-visible {
        transform: rotate(var(--rot)) scale(1.16) translateY(-3px);
        outline: none;
      }
      .lj-scroll.is-out { opacity: 0; pointer-events: none; }
      .lj-scroll-tube {
        position: absolute; inset: 0; border-radius: 999px;
        border: 1px solid var(--paper-edge);
        background: linear-gradient(180deg,
          color-mix(in srgb, var(--paper) 100%, white 12%) 0%,
          var(--paper) 42%,
          color-mix(in srgb, var(--paper) 78%, black 22%) 100%);
        box-shadow: 0 2px 4px rgba(0,0,0,.45);
      }
      .lj-scroll-cap {
        position: absolute; top: 0; bottom: 0; width: 22%; border-radius: 999px;
        background: repeating-radial-gradient(circle at 50% 50%,
          color-mix(in srgb, var(--paper) 84%, black 16%) 0 1px,
          var(--paper) 1px 2.4px);
        border: 1px solid var(--paper-edge);
      }
      .lj-scroll-cap.left { left: -1px; }
      .lj-scroll-cap.right { right: -1px; }
      .lj-scroll-ribbon {
        position: absolute; left: 42%; top: -12%; bottom: -12%; width: 13%;
        background: var(--ribbon); border-radius: 2px;
        box-shadow: inset 0 0 0 1px rgba(0,0,0,.22);
      }
      .lj-scroll-wax {
        position: absolute; left: 44%; top: 50%; translate: -50% -50%;
        width: 40%; max-width: 13px; aspect-ratio: 1; border-radius: 999px;
        background: radial-gradient(circle at 34% 32%, var(--wax), #2b0407);
        border: 1px solid rgba(0,0,0,.5);
      }
      .lj-scroll-lock {
        position: absolute; right: -6px; top: -7px;
        display: grid; place-items: center;
        width: 15px; height: 15px; border-radius: 999px;
        background: #EAD9A9; color: #7D2834; border: 1.5px solid #45140E;
      }
      .lj-scroll.is-sealed .lj-scroll-tube {
        box-shadow: 0 2px 4px rgba(0,0,0,.45), 0 0 12px 2px rgba(255,201,130,.34);
      }
      .lj-scroll.is-keepsake .lj-scroll-ribbon {
        background: linear-gradient(180deg, #E4C778, #A8823A);
      }

      /* ---------- hover preview ---------- */
      .lj-hovertag {
        position: absolute; translate: -50% calc(-100% - 18px);
        width: 190px; z-index: 90; pointer-events: none;
        background: linear-gradient(#F3E7CE, #E6D6B4);
        border: 2px solid #1C1317; border-radius: .4rem;
        box-shadow: 5px 6px 0 rgba(9,6,8,.72);
        padding: .55rem .6rem .5rem;
        animation: lj-tag-in .16s ease-out both;
      }
      .lj-hovertag::after {
        content: ""; position: absolute; left: 50%; bottom: -8px; translate: -50% 0;
        border: 7px solid transparent; border-top-color: #1C1317;
      }
      @keyframes lj-tag-in {
        from { opacity: 0; transform: translateY(5px) scale(.96); }
        to   { opacity: 1; transform: none; }
      }

      /* ---------- jar label + empty state ---------- */
      .lj-label {
        position: absolute; left: 50%; translate: -50% 0; bottom: 3.5%;
        text-align: center; padding: .35rem .8rem;
        background: linear-gradient(#F6EEDD, #E7D9BC); color: #3A2716;
        border: 1px solid #A98F63; border-radius: 3px;
        box-shadow: 0 3px 8px rgba(0,0,0,.4);
        rotate: -1.2deg; z-index: 20; pointer-events: none;
      }
      .lj-empty {
        position: absolute; left: 50%; top: 52%; translate: -50% -50%;
        text-align: center; color: #E8D9C1; opacity: .8; width: 78%;
      }

      /* ---------- jar reactions ---------- */
      .fx-in .lj-glass-glow { animation: lj-flare 1.1s ease-out; }
      .fx-out .lj-glass-glow { animation: lj-dim 1.1s ease-out; }
      .fx-in { animation: lj-jar-bump 1.1s cubic-bezier(.34,1.56,.64,1); }
      .fx-out { animation: lj-jar-settle 1.1s ease-out; }
      .fx-shake { animation: lj-jar-shake .9s cubic-bezier(.36,.07,.19,.97); }
      .fx-in .lj-lid { animation: lj-lid-bounce 1.1s cubic-bezier(.34,1.56,.64,1); }
      .fx-shake .lj-field { animation: lj-field-jiggle .9s ease-in-out; }

      @keyframes lj-flare {
        0% { opacity: 1; } 22% { opacity: 2.2; transform: scale(1.06); } 100% { opacity: 1; transform: none; }
      }
      @keyframes lj-dim {
        0% { opacity: 1; } 30% { opacity: .35; } 100% { opacity: 1; }
      }
      @keyframes lj-jar-bump {
        0% { transform: none; }
        26% { transform: translateY(4px) scale(1.045, .955); }
        52% { transform: translateY(-3px) scale(.975, 1.03); }
        78% { transform: scale(1.015, .99); }
        100% { transform: none; }
      }
      @keyframes lj-jar-settle {
        0% { transform: none; }
        30% { transform: translateY(-3px) scale(.985, 1.018); }
        62% { transform: translateY(2px) scale(1.012, .99); }
        100% { transform: none; }
      }
      @keyframes lj-jar-shake {
        0%,100% { transform: rotate(0deg); }
        12% { transform: rotate(-4.5deg); }
        28% { transform: rotate(4deg); }
        44% { transform: rotate(-3deg); }
        60% { transform: rotate(2.4deg); }
        78% { transform: rotate(-1.2deg); }
      }
      @keyframes lj-lid-bounce {
        0% { transform: none; } 24% { transform: translateY(-11px) rotate(-4deg); }
        56% { transform: translateY(2px) rotate(1.5deg); } 100% { transform: none; }
      }
      @keyframes lj-field-jiggle {
        0%,100% { transform: none; }
        20% { transform: translate(2px, -2px) rotate(.6deg); }
        45% { transform: translate(-2px, 1px) rotate(-.7deg); }
        70% { transform: translate(1px, -1px) rotate(.3deg); }
      }

      .lj-burst { position: absolute; left: 50%; top: 8%; z-index: 30; pointer-events: none; }
      .lj-spark {
        position: absolute; width: 7px; height: 7px; border-radius: 999px;
        background: #FFD9A0; box-shadow: 0 0 10px 3px rgba(255,201,130,.6);
        animation: lj-spark-out .95s cubic-bezier(.2,.9,.3,1) forwards;
      }
      @keyframes lj-spark-out {
        0% { transform: translate(0,0) scale(.4); opacity: 0; }
        18% { opacity: 1; }
        100% { transform: translate(var(--sx), var(--sy)) scale(.15); opacity: 0; }
      }

      /* ---------- the index rows ---------- */
      .lj-indexrow {
        display: flex; align-items: center; gap: .5rem; width: 100%;
        background: #F0E6D2; color: #2A1B20;
        border: 2px solid #261D24; border-radius: .3rem;
        box-shadow: 3px 3px 0 rgba(9,6,8,.5);
        padding: .35rem .5rem; cursor: pointer;
        transition: transform .14s ease, background .2s ease;
      }
      .lj-indexrow:hover { background: #FAF3E4; transform: translateX(2px); }
      .lj-indexrow:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 rgba(9,6,8,.5); }
      .lj-indexrow-knot {
        width: 5px; align-self: stretch; border-radius: 999px; background: var(--ribbon); flex: none;
      }
      .lj-indexrow-dot {
        width: 7px; height: 7px; border-radius: 999px; flex: none;
        background: #7D2834; box-shadow: 0 0 7px 2px rgba(255,201,130,.5);
      }

      /* ---------- the reader ---------- */
      .lj-reader {
        position: fixed; inset: 0; z-index: 120; display: grid; place-items: center;
        /* the action bar is anchored to the bottom, so the scroll centres in
           what is left rather than sliding underneath it */
        padding: 12px 12px 138px;
      }
      @media (min-width: 640px) { .lj-reader { padding-bottom: 118px; } }
      .lj-reader-scrim {
        position: absolute; inset: 0; width: 100%; height: 100%;
        background: rgba(10,6,8,.82); backdrop-filter: blur(5px);
        border: 0; cursor: pointer;
      }

      .lj-stage {
        position: relative; z-index: 2;
        width: min(560px, 88vw);
        transform-origin: 50% 50%;
        transition: transform .58s cubic-bezier(.2,.85,.3,1);
      }
      .lj-stage.phase-flying,
      .lj-stage.phase-returning {
        transform: translate(var(--fx), var(--fy)) scale(var(--fk)) rotate(-8deg);
      }
      .lj-stage.phase-unrolling,
      .lj-stage.phase-open,
      .lj-stage.phase-rolling { transform: none; }

      .lj-paper-clip {
        height: 100%; overflow: hidden;
        clip-path: inset(50% 0 50% 0 round 6px);
        transition: clip-path .6s cubic-bezier(.35,.9,.3,1);
      }
      .lj-stage.phase-open .lj-paper-clip { clip-path: inset(0 0 0 0 round 6px); }

      .lj-rollbar {
        position: absolute; left: -8px; right: -8px; height: 26px; z-index: 4;
        border-radius: 999px; pointer-events: none;
        background: linear-gradient(180deg, #F2E4C8 0%, #DCC69C 48%, #B99B6E 100%);
        border: 1px solid #8A6E4E;
        box-shadow: 0 4px 12px rgba(0,0,0,.55);
        transition: transform .6s cubic-bezier(.35,.9,.3,1);
      }
      .lj-rollbar::after {
        content: ""; position: absolute; left: 44%; top: -6px; bottom: -6px; width: 12%;
        background: var(--ribbon); border-radius: 2px; opacity: .9;
      }
      .lj-rollbar.top { top: -13px; transform: translateY(calc(var(--stage-h) / 2 - 13px)); }
      .lj-rollbar.bottom { bottom: -13px; transform: translateY(calc(var(--stage-h) / -2 + 13px)); }
      .lj-stage.phase-open .lj-rollbar { transform: translateY(0); }

      .lj-paper {
        position: relative; display: flex; flex-direction: column;
        height: 100%; overflow-y: auto; overflow-x: hidden;
        border: 2px solid; border-radius: 6px;
        padding: 2.4rem 1.9rem 2rem;
        box-shadow: inset 0 0 60px rgba(120,80,40,.16);
      }
      /* Sits ON the paper rather than over its top edge: the unroll clips the
         stage, so anything hanging past the edge is cut off mid-animation. */
      .lj-paper-tape {
        position: absolute; top: 14px; width: 66px; height: 17px; z-index: 20;
        opacity: .92;
      }
      .lj-paper-tape.left { left: -12px; rotate: -32deg; }
      .lj-paper-tape.right { right: -12px; rotate: 32deg; }
      .lj-tape-dotted {
        background-color: #EFE3CC;
        background-image: radial-gradient(rgba(125,40,52,.5) 1.4px, transparent 1.5px);
        background-size: 8px 8px;
        border-left: 3px dashed #fff; border-right: 3px dashed #fff;
        box-shadow: 0 4px 10px rgba(0,0,0,.5);
      }
      /* Reserves the stamp's column so a long title never runs under it. */
      .lj-has-stamp .lj-paper-head { padding-right: 72px; }
      .lj-paper-stamp {
        /* clears the corner tape, which now sits diagonally across the top */
        position: absolute; top: 46px; right: 16px; z-index: 15;
        width: 58px; text-align: center; rotate: 5deg;
        border: 2px dashed; border-radius: 3px;
        background: rgba(253,250,245,.9);
        padding: .3rem .2rem .25rem;
      }
      .lj-occasion-tag {
        display: inline-block;
        font-family: 'Caveat', cursive; font-size: 19px; line-height: 1;
        background: #C9A778; color: #4A2E1C;
        border: 1.5px solid #8A6E4E; border-radius: 4px;
        padding: .3rem .7rem; rotate: -1.5deg;
        box-shadow: 2px 3px 0 rgba(0,0,0,.28);
      }
      .lj-paper-seal {
        display: grid; place-items: center; flex: none;
        width: 52px; height: 52px; border-radius: 999px;
        color: rgba(255,255,255,.86);
        border: 3px solid rgba(28,2,4,.85);
        box-shadow: 0 8px 18px rgba(0,0,0,.6), inset 0 2px 5px rgba(255,255,255,.3);
        rotate: -6deg;
      }
      .lj-sticker {
        position: absolute; z-index: 25; font-size: 30px; line-height: 1;
        user-select: none; pointer-events: none;
        filter: drop-shadow(1px 2px 2px rgba(0,0,0,.35));
      }
      .lj-sticker.is-editable {
        pointer-events: auto; cursor: grab; background: none; border: 0; padding: 0;
        touch-action: none;
      }
      .lj-sticker.is-selected { outline: 2px dashed #7D2834; outline-offset: 3px; border-radius: 4px; }

      .lj-actions {
        position: absolute; left: 50%; translate: -50% 0; bottom: max(14px, 3vh);
        z-index: 5; display: flex; flex-direction: column; align-items: center; gap: .55rem;
        width: min(620px, 94vw);
        animation: lj-actions-in .3s ease-out both .1s;
      }
      /* Animates the translate property rather than transform: the bar is
         centred with translate: -50% 0, so a keyframe that touches transform
         instead leaves it double-shifted if the animation is interrupted. */
      @keyframes lj-actions-in {
        from { opacity: 0; translate: -50% 10px; }
        to   { opacity: 1; translate: -50% 0; }
      }
      .lj-receipt {
        display: inline-flex; align-items: center; gap: .35rem;
        font-family: 'Space Grotesk', monospace; font-size: 10px; letter-spacing: .1em;
        text-transform: uppercase; color: #E0B1AE;
        background: rgba(20,12,15,.7); border: 1px solid rgba(224,177,174,.3);
        padding: .25rem .6rem; border-radius: 999px;
      }
      .lj-action {
        display: inline-flex; align-items: center; gap: .35rem;
        font-family: 'Space Grotesk', monospace; font-size: 10px; font-weight: 900;
        letter-spacing: .12em; text-transform: uppercase;
        background: #E8D9C1; color: #2A1B20;
        border: 2px solid #261D24; box-shadow: 3px 3px 0 #0C0709;
        padding: .42rem .7rem; cursor: pointer; border-radius: .25rem;
        transition: transform .12s ease, background .2s ease;
      }
      .lj-action:hover { background: #F6EEDD; }
      .lj-action:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 #0C0709; }
      .lj-action:disabled { opacity: .55; cursor: not-allowed; }
      .lj-action.is-primary { background: #781420; color: #FBF3E6; }
      .lj-action.is-primary:hover { background: #8F1A28; }
      .lj-action.is-danger { background: #45140E; color: #F0C9C4; }
      .lj-action.is-danger:hover { background: #5C1B12; }
      .lj-action.is-on { background: #EAD9A9; }

      .lj-petals { position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; }
      .lj-petal {
        position: absolute; top: -40px; font-size: 20px;
        animation: lj-petal-fall 4.6s cubic-bezier(.35,.1,.6,1) forwards;
      }
      @keyframes lj-petal-fall {
        0% { transform: translateY(-40px) translateX(0) rotate(0deg); opacity: 0; }
        12% { opacity: .9; }
        100% { transform: translateY(105vh) translateX(var(--drift)) rotate(300deg); opacity: 0; }
      }

      /* ---------- confirm + toast ---------- */
      .lj-confirm-wrap { position: fixed; inset: 0; z-index: 140; display: grid; place-items: center; }
      .lj-confirm {
        position: relative; z-index: 2; width: min(400px, 90vw);
        background: linear-gradient(#F6EEDD, #E9DBC2);
        border: 3px solid #1C1317; border-radius: .6rem;
        box-shadow: 10px 12px 0 rgba(9,6,8,.8);
        padding: 1.4rem 1.3rem 1.2rem; rotate: -.8deg;
      }

      .lj-toast {
        position: fixed; left: 50%; translate: -50% 0; bottom: 22px; z-index: 200;
        display: inline-flex; align-items: center; gap: .5rem; max-width: 90vw;
        background: #EAD9A9; color: #2A1B20;
        border: 2px solid #261D24; box-shadow: 4px 4px 0 #0C0709;
        padding: .5rem .8rem; border-radius: .3rem;
        font-family: 'Space Grotesk', monospace; font-size: 11px; font-weight: 700;
        animation: lj-toast-in .24s cubic-bezier(.34,1.56,.64,1) both;
      }
      @keyframes lj-toast-in { from { opacity: 0; transform: translate(-50%, 14px); } to { opacity: 1; } }

      /* ---------- the composer ---------- */
      .lj-composer {
        position: fixed; inset: 0; z-index: 150; display: flex; flex-direction: column;
        background:
          radial-gradient(ellipse at 50% -10%, #3A2129 0%, transparent 55%),
          linear-gradient(#1B1216, #0F0A0D);
      }
      .lj-composer-head {
        display: flex; flex-wrap: wrap; align-items: center; gap: .6rem;
        padding: .9rem 1rem; border-bottom: 2px solid rgba(224,177,174,.18);
      }
      .lj-save-btn {
        display: inline-flex; align-items: center; gap: .45rem;
        font-family: 'Space Grotesk', monospace; font-size: 11px; font-weight: 900;
        letter-spacing: .12em; text-transform: uppercase;
        background: #781420; color: #FBF3E6;
        border: 2px solid #FAF4EB; box-shadow: 4px 4px 0 #0C0709;
        padding: .5rem .85rem; cursor: pointer; border-radius: .25rem;
      }
      .lj-save-btn:hover { background: #8F1A28; }
      .lj-save-btn:active { transform: translate(2px,2px); box-shadow: 2px 2px 0 #0C0709; }
      .lj-save-btn:disabled { opacity: .6; cursor: not-allowed; }

      .lj-composer-body {
        flex: 1; min-height: 0; display: grid; gap: 1rem;
        grid-template-columns: 1fr; padding: 1rem; overflow-y: auto;
      }
      @media (min-width: 1024px) {
        .lj-composer-body { grid-template-columns: minmax(0,1fr) 380px; overflow: hidden; }
      }

      .lj-preview-stage { min-height: 0; display: flex; flex-direction: column; }
      .lj-preview {
        position: relative; flex: 1 1 auto; min-height: 260px;
        display: flex; flex-direction: column;
        overflow-y: auto; overflow-x: hidden;
        border: 2px solid; border-radius: 6px;
        padding: 2.4rem 1.9rem 2rem;
        box-shadow: 12px 14px 0 rgba(9,6,8,.7), inset 0 0 60px rgba(120,80,40,.16);
        rotate: -.5deg;
      }

      .lj-sticker-tools {
        display: flex; flex-wrap: wrap; align-items: center; gap: .4rem;
        margin-top: .6rem; flex: none;
        color: #E0B1AE;
      }
      .lj-sticker-tools button {
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        letter-spacing: .1em; padding: .25rem .5rem; cursor: pointer;
        background: #E8D9C1; color: #2A1B20; border: 2px solid #261D24; border-radius: .2rem;
      }
      .lj-sticker-tools button:hover { background: #F6EEDD; }
      .lj-sticker-tools button.is-danger { background: #45140E; color: #F0C9C4; }

      .lj-rail { display: flex; flex-direction: column; min-height: 0; }
      .lj-tabs { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: .7rem; }
      .lj-tab {
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        letter-spacing: .1em; padding: .35rem .55rem; cursor: pointer;
        background: transparent; color: #C9A9A2;
        border: 2px solid rgba(224,177,174,.35); border-radius: .2rem;
        transition: background .18s ease, color .18s ease;
      }
      .lj-tab:hover { background: rgba(224,177,174,.12); }
      .lj-tab.is-active { background: #E8D9C1; color: #2A1B20; border-color: #E8D9C1; }

      .lj-rail-body {
        flex: 1; min-height: 0; overflow-y: auto; padding-right: .4rem;
      }

      .lj-opt {
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        letter-spacing: .08em; padding: .45rem .3rem; cursor: pointer; text-align: center;
        background: #E8D9C1; color: #2A1B20;
        border: 2px solid #261D24; border-radius: .25rem;
        transition: transform .12s ease;
      }
      .lj-opt:hover { transform: translateY(-2px); }
      .lj-opt.is-active { background: #781420; color: #FBF3E6; }

      .lj-paper-opt {
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        letter-spacing: .1em; padding: 1.2rem .3rem; cursor: pointer; text-align: center;
        border: 2px solid; border-radius: .3rem;
        box-shadow: 3px 3px 0 rgba(9,6,8,.6);
        transition: transform .14s ease;
      }
      .lj-paper-opt:hover { transform: translateY(-3px) rotate(-1deg); }
      .lj-paper-opt.is-active { outline: 3px solid #EAD9A9; outline-offset: 2px; }

      .lj-swatch {
        width: 30px; height: 30px; border-radius: 999px; cursor: pointer;
        border: 2px solid #261D24; box-shadow: 2px 2px 0 rgba(9,6,8,.6);
        transition: transform .14s cubic-bezier(.34,1.56,.64,1);
      }
      .lj-swatch:hover { transform: scale(1.14); }
      .lj-swatch.is-active { outline: 3px solid #EAD9A9; outline-offset: 2px; }

      .lj-color {
        width: 100%; height: 38px; padding: 0; cursor: pointer;
        background: #FDF8EE; border: 2px solid #7D2834; border-radius: .3rem;
      }

      .lj-sticker-opt {
        font-size: 19px; line-height: 1; padding: .3rem 0; cursor: pointer;
        background: #F0E6D2; border: 2px solid #261D24; border-radius: .2rem;
        transition: transform .12s cubic-bezier(.34,1.56,.64,1);
      }
      .lj-sticker-opt:hover { transform: scale(1.16) rotate(-6deg); }

      .lj-toggle {
        display: inline-flex; align-items: center; gap: .6rem; cursor: pointer;
        background: #E8D9C1; color: #2A1B20;
        border: 2px solid #261D24; border-radius: 999px;
        padding: .32rem .8rem .32rem .32rem;
        box-shadow: 3px 3px 0 rgba(9,6,8,.6);
      }
      .lj-toggle-knob {
        width: 20px; height: 20px; border-radius: 999px; background: #7D2834;
        transition: background .2s ease, transform .2s ease;
      }
      .lj-toggle.is-on { background: #EAD9A9; }
      .lj-toggle.is-on .lj-toggle-knob { background: #2F4536; transform: rotate(180deg) scale(1.05); }

      /* ---------- scrollbars ---------- */
      /* the sheet's own column, so the signature block can sit at the foot of
         the scroll instead of being stranded halfway up a long sheet */
      .lj-paper-body { position: relative; z-index: 10; flex: 1; display: flex; flex-direction: column; }
      .lj-paper-sign { margin-top: auto; padding-top: 2rem; }

      .lj-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(125,40,52,.55) transparent; }
      .lj-scrollbar::-webkit-scrollbar { width: 7px; }
      .lj-scrollbar::-webkit-scrollbar-thumb { background: rgba(125,40,52,.55); border-radius: 999px; }
      .lj-scrollbar::-webkit-scrollbar-track { background: transparent; }

      /* ---------- reduced motion ---------- */
      @media (prefers-reduced-motion: reduce) {
        .lj-stage, .lj-paper-clip, .lj-rollbar { transition: none !important; }
        .lj-stage.phase-flying, .lj-stage.phase-returning { transform: none !important; }
        .lj-paper-clip { clip-path: inset(0 0 0 0 round 6px) !important; }
        .lj-rollbar { transform: translateY(0) !important; }
        .lj-bulb, .lj-inner-bulb, .lj-spider-drop, .lj-petal { animation: none !important; }
      }
    `}</style>
  );
}
