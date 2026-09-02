"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Bug,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Feather,
  Flower2,
  Heart,
  Infinity as InfinityIcon,
  KeyRound,
  Lightbulb,
  Moon,
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
import {
  CandleJar,
  CorkLid,
  DriedBunch,
  FairyString,
  HeartTag,
  JarLabel,
  LaceDoily,
  LetterJarDefs,
  PAPERS,
  PAPER_EDGES,
  PATINAS,
  RIBBONS,
  RIBBON_STYLES,
  SPRIGS,
  STAMPS,
  STICKER_PALETTE,
  SprigMark,
  ScrollGlyph,
  SpiderOnThread,
  StampMark,
  TAPES,
  TiedBundle,
  TwineBow,
  WAXES,
  WAX_SHAPES,
  WaxEnvelope,
  WebCorner,
  FONTS,
  INKS,
  OCCASION_PRESETS,
  fontOf,
  paperOf,
  sprigOf,
  stampOf,
  tapeOf,
} from "./LetterJarArt";

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
  paper_edge: string;
  paper_patina: string;
  ribbon_style: string;
  wax_shape: string;
  sprig: string;
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
  paper_edge: string;
  paper_patina: string;
  ribbon_style: string;
  wax_shape: string;
  sprig: string;
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
  "id, couple_id, sender_id, receiver_id, title, body, theme_style, occasion, ink_color, font_style, ribbon_color, wax_color, seal_emblem, tape_style, stamp_style, paper_edge, paper_patina, ribbon_style, wax_shape, sprig, stickers, reply_to_id, is_private, scheduled_for, created_at, updated_at";

/* ------------------------------------------------------- design tokens --- */
/* The materials themselves (papers, edges, patinas, ribbons, waxes, stamps,
   tapes, sprigs, stickers) live in ./LetterJarArt so this file can stay about
   data and behaviour. Only the tables that need a lucide icon stay here. */

const EMBLEMS = [
  { id: "spider", label: "SPIDER", Icon: Bug },
  { id: "heart", label: "HEART", Icon: Heart },
  { id: "star", label: "STAR", Icon: Star },
  { id: "rose", label: "BLOOM", Icon: Flower2 },
  { id: "forever", label: "FOREVER", Icon: InfinityIcon },
  { id: "thwip", label: "THWIP", Icon: Zap },
  { id: "key", label: "KEY", Icon: KeyRound },
  { id: "moon", label: "MOON", Icon: Moon },
] as const;

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
    paper_edge: "deckle",
    paper_patina: "aged",
    ribbon_style: "satin",
    wax_shape: "round",
    sprig: "none",
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
    paper_edge: l.paper_edge,
    paper_patina: l.paper_patina,
    ribbon_style: l.ribbon_style,
    wax_shape: l.wax_shape,
    sprig: l.sprig,
    stickers: l.stickers,
    is_private: l.is_private,
    scheduled_for: toDatetimeLocal(l.scheduled_for),
    reply_to_id: l.reply_to_id,
  };
}

const KEY_HINTS = [
  { key: "N", what: "write a letter" },
  { key: "R", what: "pick one for me" },
  { key: "/", what: "search the jar" },
  { key: "L", what: "candle on or off" },
  { key: "esc", what: "close what is open" },
];

/* ------------------------------------------------- jar packing geometry --- */

/* Warm bulbs threaded down through the pile, following the wire drawn in the
   glass. Fixed positions rather than random ones so they never jump. */
const JAR_BULBS = [
  { x: 16, y: 15, delay: 0 },
  { x: 62, y: 24, delay: 0.4 },
  { x: 30, y: 36, delay: 0.9 },
  { x: 74, y: 46, delay: 1.3 },
  { x: 22, y: 55, delay: 0.2 },
  { x: 58, y: 63, delay: 1.7 },
  { x: 36, y: 72, delay: 0.7 },
  { x: 72, y: 80, delay: 1.1 },
  { x: 20, y: 86, delay: 1.5 },
];

/* Kept in step with `.lj-jar-wrap { aspect-ratio }` and `.lj-glass { inset }`.
   Slots are positioned inside `.lj-field`, which fills the glass rather than the
   whole jar, so width-to-height conversions use the glass's aspect and not the
   jar's. Getting this wrong stretches the rolled ends into ovals. */
const JAR_ASPECT = 0.74;
const GLASS_TOP = 0.106;
const FIELD_ASPECT = JAR_ASPECT / (1 - GLASS_TOP);
/* the ScrollGlyph viewBox, drawn with preserveAspectRatio="none" */
const SCROLL_RATIO = 220 / 64;

/* All in percentages of the glass. */
/* The pile rests clear of the jar's own label, which is pinned across the
   bottom of the glass. Resting it on the true floor put the oldest letters
   behind the label. */
const PILE_FLOOR = 85;   // where the bottom of the pile rests
const PILE_HEAD = 4;     // breathing room below the neck
const PILE_WALL = 2;     // how close a roll may come to the glass
const ROLL_MIN = 12;     // a roll narrower than this stops reading as a letter
const ROLL_MAX = 46;
const MAX_COLS = 6;

interface Slot {
  x: number;      // percent of the glass width, centre
  y: number;      // percent of the glass height, centre
  len: number;    // percent of the glass width
  thick: number;  // percent of the glass height
  rot: number;
  z: number;
  half: number;   // half the rotated height, so the pile can be scrolled to it
}

interface Pack {
  slots: Record<string, Slot>;
  /* How far the pile sticks up past the top of the glass, in glass-height
     percent. The field is translated down by up to this much to dig through
     it, which is what keeps the jar unbounded: rows are never squeezed
     together to make a large pile fit, they just go off the top and the
     reader scrolls to them. */
  overflow: number;
}

const EMPTY_PACK: Pack = { slots: {}, overflow: 0 };

/* Packs the letters into the jar from the floor up, oldest at the bottom.
   Every roll is fully inside the glass, no roll is ever covered by one sitting
   lower than it, and the pile is allowed to grow taller than the jar. */
function computeSlots(ids: string[]): Pack {
  const n = ids.length;
  if (n === 0) return EMPTY_PACK;

  const cols = Math.min(MAX_COLS, Math.max(1, Math.round(Math.sqrt(n * 1.2))));
  const rows = Math.ceil(n / cols);
  const usable = 100 - PILE_WALL * 2;
  const cellW = usable / cols;

  /* pass 1: how big each roll is, and how tall each row ends up */
  const built = ids.map((id, i) => {
    const row = Math.floor(i / cols);
    const rowFrac = rows === 1 ? 1 : row / (rows - 1);
    const len = Math.min(ROLL_MAX, Math.max(ROLL_MIN, cellW * randRange(id, 3, 0.98, 1.28)));
    const thick = (len * FIELD_ASPECT) / SCROLL_RATIO;
    /* Rolls at the bottom have been pressed flat by the ones on top; the loose
       ones near the surface can sit at more of an angle. */
    const rot = randRange(id, 4, -34, 34) * (0.35 + 0.65 * rowFrac);

    const rad = (rot * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    /* the rotated bounding box, which is what actually has to clear the glass */
    const halfW = (len / 2) * cos + (thick / (2 * FIELD_ASPECT)) * sin;
    const halfH = ((len * FIELD_ASPECT) / 2) * sin + (thick / 2) * cos;
    return { id, i, row, len, thick, rot, halfW, halfH };
  });

  const rowHalf: number[] = [];
  built.forEach((b) => {
    rowHalf[b.row] = Math.max(rowHalf[b.row] ?? 0, b.halfH);
  });

  /* pass 2: stack the rows, each one resting on the one below with a little
     overlap so it reads as a settled pile rather than a set of shelves */
  const rowY: number[] = [];
  for (let r = 0; r < rows; r++) {
    rowY[r] =
      r === 0
        ? PILE_FLOOR - rowHalf[0]
        : rowY[r - 1] - (rowHalf[r - 1] + rowHalf[r]) * 0.78;
  }

  const slots: Record<string, Slot> = {};
  built.forEach((b) => {
    /* A short final row is centred. Left-aligning it stranded the last letter
       on its own against the glass, which is what made a fourth letter look
       like a rendering fault rather than part of the pile. */
    const inRow = Math.min(cols, n - b.row * cols);
    const offset = ((cols - inRow) * cellW) / 2;
    const col = b.i % cols;
    /* Alternate rows sit half a roll across from each other. Without this the
       columns line up and the pile reads as brickwork instead of letters that
       fell where they fell. */
    const stagger = b.row % 2 === 1 ? cellW * 0.3 : 0;
    const baseX = PILE_WALL + offset + stagger + (col + 0.5) * cellW;

    const jitterX = randRange(b.id, 1, -cellW * 0.24, cellW * 0.24);
    const jitterY = randRange(b.id, 2, -rowHalf[b.row] * 0.3, rowHalf[b.row] * 0.3);

    const lo = PILE_WALL + b.halfW;
    const hi = 100 - PILE_WALL - b.halfW;

    slots[b.id] = {
      x: hi <= lo ? 50 : Math.max(lo, Math.min(hi, baseX + jitterX)),
      y: rowY[b.row] + jitterY,
      len: b.len,
      thick: b.thick,
      rot: b.rot,
      /* Strictly increasing, so a letter can never be hidden behind one that
         sits lower in the pile, and the newest always lands on top. */
      z: 10 + b.i,
      half: b.halfH,
    };
  });

  const top = Math.min(...built.map((b) => (slots[b.id]?.y ?? 0) - b.halfH));
  return { slots, overflow: Math.max(0, PILE_HEAD - top) };
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
  /* Real viewport pixels for the currently-hovered in-jar letter's own DOM
     node (see the effect below, keyed off `hovered`) - JarHoverTag portals
     into document.body and positions off this instead of a jar-relative
     percentage, so it is never clipped by .lj-glass's overflow:hidden. */
  const [hoverAnchor, setHoverAnchor] = useState<{ x: number; y: number } | null>(null);
  const [jarFx, setJarFx] = useState<JarFx>(null);
  /* Only a letter that was still sealed gets the petal shower, so re-reading an
     old one stays quiet. */
  const [brokeSeal, setBrokeSeal] = useState(false);
  /* The shortcut handler is mounted before these actions are declared, so it
     reaches them through refs kept current below rather than re-subscribing on
     every render. */
  const startNewLetterRef = useRef<() => void>(() => {});
  const pickRandomRef = useRef<() => void>(() => {});
  const toggleLightsRef = useRef<() => void>(() => {});

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

  /* Optional character art in the far background. If either file is missing the
     scene just loses a silhouette. */
  const [artError, setArtError] = useState({ gwen: false, peter: false });

  const rootRef = useRef<HTMLElement>(null);
  const parallaxRaf = useRef(0);
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

  /* The room drifts very slightly against the pointer. Writes CSS variables on
     the root rather than going through state, so moving the mouse never causes
     a React render, and it is throttled to one frame. */
  const handleParallax = useCallback(
    (e: React.PointerEvent) => {
      if (reduceMotion || parallaxRaf.current) return;
      const el = rootRef.current;
      if (!el) return;
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;
      parallaxRaf.current = requestAnimationFrame(() => {
        parallaxRaf.current = 0;
        el.style.setProperty("--mx", x.toFixed(3));
        el.style.setProperty("--my", y.toFixed(3));
      });
    },
    [reduceMotion]
  );

  useEffect(
    () => () => {
      if (parallaxRaf.current) cancelAnimationFrame(parallaxRaf.current);
    },
    []
  );

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
          paper_edge: (r.paper_edge as string) || "deckle",
          paper_patina: (r.paper_patina as string) || "aged",
          ribbon_style: (r.ribbon_style as string) || "satin",
          wax_shape: (r.wax_shape as string) || "round",
          sprig: (r.sprig as string) || "none",
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

  const pack = useMemo(() => computeSlots(visible.map((l) => l.id)), [visible]);
  const slots = pack.slots;

  /* ------------------------------------------- digging through the pile --- */
  /* How far the pile has been pushed down, in glass-height percent. 0 shows the
     bottom of the pile (the oldest letters); pack.overflow shows the very top.
     Anything past what the glass can hold is reachable this way, so the jar
     takes as many letters as they care to write. */
  const [dig, setDig] = useState(0);
  const digRef = useRef(0);
  const digRaf = useRef(0);
  const glassRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggedRef = useRef(false);

  /* digRef.current updates synchronously so hit-testing/keyboard nav always
     read the latest value, but the React state commit (which re-renders the
     whole, unbounded letter pile) is coalesced to at most once per animation
     frame - a drag or wheel gesture used to call setDig on every native
     pointermove/wheel event, which on a high-poll-rate device is far more
     often than the screen can even repaint. Same technique as handleParallax
     above, just applied to state that other logic still needs to read. */
  const setDigClamped = useCallback(
    (next: number) => {
      const v = Math.max(0, Math.min(pack.overflow, next));
      digRef.current = v;
      if (digRaf.current) return;
      digRaf.current = requestAnimationFrame(() => {
        digRaf.current = 0;
        setDig(digRef.current);
      });
    },
    [pack.overflow]
  );

  useEffect(
    () => () => {
      if (digRaf.current) cancelAnimationFrame(digRaf.current);
    },
    []
  );

  /* A shorter pile after a filter change must not leave the view stranded
     somewhere above the letters. */
  useEffect(() => {
    if (digRef.current > pack.overflow) setDigClamped(pack.overflow);
  }, [pack.overflow, setDigClamped]);

  /* Wheel has to be bound by hand: React's onWheel is passive, so it cannot
     stop the page from scrolling away underneath the jar. */
  useEffect(() => {
    const el = glassRef.current;
    if (!el || pack.overflow <= 0.5) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setDigClamped(digRef.current + Math.sign(e.deltaY) * -6);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pack.overflow, setDigClamped]);

  /* Scrolls a letter into the glass, so tabbing through the pile or jumping to
     one from the index can never land on something out of sight. */
  const revealSlot = useCallback(
    (slot: Slot | undefined) => {
      if (!slot || pack.overflow <= 0.5) return;
      const top = slot.y - slot.half + digRef.current;
      const bottom = slot.y + slot.half + digRef.current;
      if (top < PILE_HEAD) setDigClamped(digRef.current + (PILE_HEAD - top));
      else if (bottom > PILE_FLOOR) setDigClamped(digRef.current - (bottom - PILE_FLOOR));
    },
    [pack.overflow, setDigClamped]
  );

  /* Where the sealed letters are sitting, as a fraction down the whole pile, so
     the depth rail can show that there is something unread further up. */
  const digMarks = useMemo(() => {
    if (pack.overflow <= 0.5) return [];
    return visible
      .filter((l) => !myMarks[l.id]?.opened_at && slots[l.id])
      .map((l) => {
        const s = slots[l.id];
        const d = Math.max(0, Math.min(pack.overflow, PILE_HEAD - (s.y - s.half)));
        return { id: l.id, at: 100 - (d / pack.overflow) * 100 };
      });
  }, [visible, myMarks, slots, pack.overflow]);

  const stats = useMemo(() => {
    const sealed = letters.filter((l) => !myMarks[l.id]?.opened_at).length;
    const keepsakes = letters.filter((l) => myMarks[l.id]?.is_favorite).length;
    const locked = letters.filter(
      (l) => l.scheduled_for && new Date(l.scheduled_for).getTime() > now
    ).length;
    return { total: letters.length, sealed, opened: letters.length - sealed, keepsakes, locked };
  }, [letters, myMarks, now]);

  const keepsakes = useMemo(
    () => letters.filter((l) => myMarks[l.id]?.is_favorite),
    [letters, myMarks]
  );

  /* The most recent letter the other one wrote that has not been opened yet.
     It gets a flag on it, so the one thing you would actually be sad to miss
     is never just another roll in the pile. Letters load oldest first. */
  const newestUnreadId = useMemo(() => {
    for (let i = letters.length - 1; i >= 0; i--) {
      const l = letters[i];
      if (l.sender_id === userId) continue;
      if (myMarks[l.id]?.opened_at) continue;
      if (isLocked(l)) continue;
      return l.id;
    }
    return null;
  }, [letters, myMarks, userId, isLocked]);

  /* On the first paint of a full jar, dig straight to that letter. Otherwise a
     tall pile opens on its oldest letters and the new one sits out of sight
     above the glass. */
  const didReveal = useRef(false);
  useEffect(() => {
    if (didReveal.current || loading || pack.overflow <= 0.5) return;
    if (!newestUnreadId || !slots[newestUnreadId]) return;
    didReveal.current = true;
    revealSlot(slots[newestUnreadId]);
  }, [loading, pack.overflow, newestUnreadId, slots, revealSlot]);

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

  /* Single-key shortcuts for the things worth reaching for without the mouse.
     They stay out of the way of any field being typed into, and of the reader
     and composer while either is up. */
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (composerOpen || activeId || confirmDelete) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

      switch (e.key) {
        case "n":
          e.preventDefault();
          startNewLetterRef.current();
          break;
        case "r":
          e.preventDefault();
          pickRandomRef.current();
          break;
        case "l":
          e.preventDefault();
          toggleLightsRef.current();
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "[":
          e.preventDefault();
          setDigClamped(digRef.current - 14);
          break;
        case "]":
          e.preventDefault();
          setDigClamped(digRef.current + 14);
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, composerOpen, confirmDelete, setDigClamped]);

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

  /* keeps the shortcut handler pointed at the current closures */
  useEffect(() => {
    startNewLetterRef.current = startNewLetter;
    pickRandomRef.current = () => runPickRandom();
    toggleLightsRef.current = toggleLights;
  });

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
      paper_edge: draft.paper_edge,
      paper_patina: draft.paper_patina,
      ribbon_style: draft.ribbon_style,
      wax_shape: draft.wax_shape,
      sprig: draft.sprig,
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

  /* Soft out-of-focus lights and drifting dust. Both are index-derived rather
     than random so they are stable across renders and identical on the server. */
  const bokeh = useMemo(
    () =>
      Array.from({ length: 22 }).map((_, i) => ({
        x: (i * 37) % 100,
        y: (i * 61) % 96,
        size: 26 + ((i * 29) % 74),
        delay: ((i * 13) % 90) / 10,
        dur: 14 + ((i * 7) % 12),
        warm: i % 3 !== 0,
        depth: 1 + (i % 3),
      })),
    []
  );

  const motes = useMemo(
    () =>
      Array.from({ length: 34 }).map((_, i) => ({
        x: (i * 53) % 100,
        y: (i * 71) % 100,
        delay: ((i * 17) % 120) / 10,
        dur: 9 + ((i * 5) % 11),
        size: 1.5 + ((i * 3) % 4) * 0.6,
      })),
    []
  );

  /* The three most recent rolls, tipped out onto the desk beside the jar. The
     letters load oldest first, so the newest are at the end. */
  const loose = useMemo(() => visible.slice(-3), [visible]);

  /* Measures the hovered in-jar letter's real on-screen position for
     JarHoverTag's portal. Loose rolls (outside the glass) keep their own
     separate, purely CSS-anchored tag and are excluded here. */
  useLayoutEffect(() => {
    if (!hovered || loose.some((l) => l.id === hovered)) {
      setHoverAnchor(null);
      return;
    }
    const el = scrollRefs.current[hovered];
    if (!el) {
      setHoverAnchor(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setHoverAnchor({ x: rect.left + rect.width / 2, y: rect.top });
  }, [hovered, loose]);

  return (
    <main
      ref={rootRef}
      onPointerMove={handleParallax}
      className={`lj-root ${lightsOn ? "lights-on" : "lights-off"}`}
    >
      <ScopedStyles />
      <LetterJarDefs />

      {/* ============================================ the room behind it all */}
      <div className="lj-bg" aria-hidden>
        <div className="lj-bg-wall" />
        <div className="lj-bg-paper" />
        <div className="lj-bg-window" />
        <span className="lj-bg-rain" />
        <div className="lj-bg-beam" />

        {/* the room's own furniture, so the wall is not a flat colour field */}
        <span className="lj-bg-rail" />
        <span className="lj-bg-skirt" />
        <div className="lj-bg-shelf" />
        <span className="lj-bg-shelf-jar" />
        <span className="lj-bg-shelf-book" />
        <span className="lj-bg-shelf-book second" />

        {/* two crooked frames, hung off the picture rail */}
        <span className="lj-bg-frame lj-bg-frame-a">
          <span className="lj-bg-frame-mat" />
          <span className="lj-bg-frame-wire" />
        </span>
        <span className="lj-bg-frame lj-bg-frame-b">
          <span className="lj-bg-frame-mat" />
          <span className="lj-bg-frame-wire" />
        </span>

        {/* the lamp that is doing all the lighting in here */}
        <span className="lj-bg-lamp">
          <span className="lj-bg-lamp-flex" />
          <span className="lj-bg-lamp-shade" />
          <span className="lj-bg-lamp-bulb" />
          <span className="lj-bg-lampcone" />
        </span>

        {/* Gwen and Peter swinging far back in the dark. Optional art: if the
            file is missing the scene simply loses two silhouettes. */}
        {!artError.gwen && (
          <img
            src="/images/gwen.webp"
            alt=""
            className="lj-swinger lj-swinger-gwen"
            onError={() => setArtError((e) => ({ ...e, gwen: true }))}
          />
        )}
        {!artError.peter && (
          <img
            src="/images/peter.webp"
            alt=""
            className="lj-swinger lj-swinger-peter"
            onError={() => setArtError((e) => ({ ...e, peter: true }))}
          />
        )}

        <div className="lj-bokeh">
          {bokeh.map((b, i) => (
            <span
              key={i}
              className="lj-bokeh-dot"
              style={{
                left: `${b.x}%`,
                top: `${b.y}%`,
                width: b.size,
                height: b.size,
                animationDelay: `${b.delay}s`,
                animationDuration: `${b.dur}s`,
                ["--depth" as string]: b.depth,
                background: b.warm
                  ? "radial-gradient(circle, rgba(255,206,140,.55), rgba(255,180,110,.12) 55%, transparent 72%)"
                  : "radial-gradient(circle, rgba(255,182,200,.45), rgba(220,150,175,.10) 55%, transparent 72%)",
              }}
            />
          ))}
        </div>

        <div className="lj-motes">
          {motes.map((m, i) => (
            <span
              key={i}
              className="lj-mote"
              style={{
                left: `${m.x}%`,
                top: `${m.y}%`,
                width: m.size,
                height: m.size,
                animationDelay: `${m.delay}s`,
                animationDuration: `${m.dur}s`,
              }}
            />
          ))}
        </div>

        <WebCorner className="lj-web lj-web-tl" />
        <WebCorner className="lj-web lj-web-tr" />
        <WebCorner className="lj-web lj-web-bl" />

        <FairyString bulbs={19} className="lj-string-a" />
        <FairyString bulbs={15} className="lj-string-b" depth={1.8} />
        <FairyString bulbs={11} className="lj-string-c" depth={2.7} />

        <SpiderOnThread className="lj-spider-a" threadLength={150} />
        <SpiderOnThread className="lj-spider-b" threadLength={92} />

        <div className="lj-vignette" />
      </div>

      {/* ==================================================== the top bar === */}
      <header className="lj-topbar">
        <button onClick={onBack} className="lj-chip-btn" type="button">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">BACK TO CONTENTS</span>
          <span className="sm:hidden">BACK</span>
        </button>

        <span className="lj-chapter-stamp">CH. 05</span>

        <div className="lj-titleblock">
          <h1 className="font-marker text-2xl sm:text-4xl leading-none text-[#F6E7D2]">
            Love Letter Jar
          </h1>
          <p className="font-handwriting text-lg sm:text-xl text-[#E0B1AE] leading-none mt-0.5">
            every note we ever rolled up, kept behind glass
          </p>
        </div>

        <div className="flex-1" />

        <button
          onClick={toggleLights}
          className={`lj-chip-btn ${lightsOn ? "is-on" : ""}`}
          type="button"
          aria-pressed={lightsOn}
        >
          <Lightbulb className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{lightsOn ? "LIGHTS ON" : "LIGHTS OFF"}</span>
        </button>
      </header>

      {/* ======================================================= the room === */}
      <div className="lj-columns">
        {/* ------------------------------ left: the writing desk collage --- */}
        <aside className="lj-rail lj-rail-l">
          <button onClick={startNewLetter} className="lj-write-card" type="button">
            {/* Everything that has to be clipped to the envelope's rounded
                corners lives in here. The badge and the seal sit outside it so
                they are not sliced off by the overflow. */}
            <span className="lj-write-paper" aria-hidden>
              <span className="lj-write-flap" />
              <span className="lj-write-rules" />
            </span>

            <span className="lj-write-thwip" aria-hidden>THWIP!</span>
            <span className="lj-write-seal" aria-hidden>
              <Feather className="w-4 h-4" />
            </span>

            <span className="lj-write-text">
              <span className="block font-marker text-2xl leading-none">Write a letter</span>
              <span className="block font-mono text-[9px] tracking-[.18em] opacity-85 mt-1.5">
                ROLL IT UP AND DROP IT IN
              </span>
            </span>
          </button>

          <button onClick={() => runPickRandom()} className="lj-draw-tag" type="button">
            <span className="lj-draw-hole" />
            <Shuffle className="w-4 h-4 shrink-0" />
            <span className="text-left leading-tight">
              <span className="block font-marker text-lg leading-none">Pick one for me</span>
              <span className="block font-mono text-[8px] tracking-[.16em] opacity-70 mt-1">
                SHAKE THE JAR
              </span>
            </span>
          </button>

          <div className="lj-card lj-card-find">
            <span className="lj-tape-strip lj-tape-strip-a" aria-hidden />
            <span className="lj-card-title">FIND A LETTER</span>
            <div className="lj-search mt-2">
              <Search className="lj-search-icon w-3.5 h-3.5" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="title, tag or words..."
                className="lj-input"
                aria-label="Search the letters"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="lj-search-clear"
                  aria-label="Clear the search"
                >
                  <X className="w-3 h-3" strokeWidth={3} />
                </button>
              )}
            </div>

            <span className="lj-card-title mt-4 block">THE PILE</span>
            <div className="lj-filter-row">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  type="button"
                  className={`lj-filter ${filter === f.id ? "is-active" : ""}`}
                >
                  <span className="lj-filter-hole" />
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

          <div className="lj-card lj-card-count">
            <span className="lj-pin" aria-hidden />
            <span className="lj-card-title">THE COUNT</span>
            <div className="lj-count-grid">
              <CountChip label="in the jar" value={stats.total} tone="cream" />
              <CountChip label="sealed" value={stats.sealed} tone="wax" />
              <CountChip label="read" value={stats.opened} tone="sage" />
              <CountChip label="keepsakes" value={stats.keepsakes} tone="gold" />
              {stats.locked > 0 && <CountChip label="locked" value={stats.locked} tone="ink" />}
            </div>
          </div>

          {/* a scrap of paper pinned up with the shortcuts on it */}
          <div className="lj-keys">
            <span className="lj-card-title">WITHOUT THE MOUSE</span>
            <ul className="lj-keys-list">
              {KEY_HINTS.map((k) => (
                <li key={k.key}>
                  <kbd className="lj-kbd">{k.key}</kbd>
                  <span>{k.what}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* ------------------------------------- centre: the jar, the hero --- */}
        <section className="lj-scene">
          <span className="lj-ghost" aria-hidden>
            LETTERS
          </span>

          {loading ? (
            <div className="lj-jar-loading">
              <Loader2 className="w-6 h-6 animate-spin text-[#E0B1AE]" />
              <p className="font-mono text-[11px] tracking-[.2em] text-[#E0B1AE] mt-3">
                UNSEALING THE JAR...
              </p>
            </div>
          ) : (
            <div className="lj-scene-inner">
              {/* the surface everything is standing on */}
              <div className="lj-board" aria-hidden>
                <span className="lj-board-grain" />
                <span className="lj-board-edge" />
              </div>
              <div className="lj-cloth" aria-hidden />
              <LaceDoily className="lj-doily" />

              {/* the objects around the jar */}
              <DriedBunch className="lj-bunch lj-bunch-l" lean={-17} count={8} />
              <DriedBunch
                className="lj-bunch lj-bunch-r"
                lean={15}
                count={7}
                tone="#DED3B4"
                stem="#7E8A62"
              />
              {/* Everything standing on the desk does something. Leaving them as
                  scenery made the room read as a painted backdrop, and it wasted
                  the most reachable targets on the screen. */}
              <Prop
                className="lj-prop lj-prop-candle"
                label={lightsOn ? "Blow the candle out" : "Light the candle"}
                onClick={toggleLights}
              >
                <CandleJar className="lj-candle" />
              </Prop>

              <Prop
                className="lj-prop lj-prop-envelope"
                label="Start a new letter"
                onClick={startNewLetter}
              >
                <WaxEnvelope className="lj-envelope" wax="#7D2834" />
              </Prop>

              <Prop
                className="lj-prop lj-prop-bundle"
                label={`The keepsakes${stats.keepsakes ? ` (${stats.keepsakes})` : ""}`}
                onClick={() => setFilter(filter === "keepsakes" ? "all" : "keepsakes")}
              >
                <TiedBundle className="lj-bundle" />
                {stats.keepsakes > 0 && (
                  <span className="lj-prop-count font-mono">{stats.keepsakes}</span>
                )}
              </Prop>

              {/* The three newest letters, spilled out beside the jar. These are
                  real letters, so they open like any roll in the glass. */}
              {loose.map((l, i) => (
                <button
                  key={l.id}
                  type="button"
                  className={`lj-loose lj-loose-${i + 1} ${
                    !myMarks[l.id]?.opened_at ? "is-sealed" : ""
                  }`}
                  onClick={(e) => openLetter(l, e.currentTarget)}
                  onMouseEnter={() => setHovered(l.id)}
                  onMouseLeave={() => setHovered((h) => (h === l.id ? null : h))}
                  onFocus={() => setHovered(l.id)}
                  onBlur={() => setHovered((h) => (h === l.id ? null : h))}
                  aria-label={`${
                    !myMarks[l.id]?.opened_at ? "Sealed letter" : "Letter"
                  }: ${l.title}, from ${nameOf(l.sender_id)}`}
                >
                  <ScrollGlyph
                    paperId={l.theme_style}
                    ribbon={l.ribbon_color}
                    ribbonStyle={l.ribbon_style}
                    wax={l.wax_color}
                    waxShape={l.wax_shape}
                    sprig={l.sprig}
                    sealed={!myMarks[l.id]?.opened_at}
                    className="w-full h-full"
                  />
                  {/* Anchored to this button itself (left:50%/top:0%), not to
                      a jar-glass slot percentage - this letter isn't inside
                      the glass. */}
                  {hovered === l.id && !phase && (
                    <HoverTag
                      letter={l}
                      left={50}
                      top={0}
                      fromName={nameOf(l.sender_id)}
                      sealed={!myMarks[l.id]?.opened_at}
                      locked={isLocked(l)}
                    />
                  )}
                </button>
              ))}

              {/* ------------------------------------------- the jar --- */}
              <div className={`lj-jar-wrap ${jarFx ? `fx-${jarFx}` : ""}`}>
                <span className="lj-jar-cast" aria-hidden />

                <Prop
                  className="lj-prop lj-prop-lid"
                  label="Shake the jar"
                  onClick={() => runPickRandom()}
                >
                  <CorkLid className="lj-lid-art" />
                </Prop>
                <div className="lj-neck" aria-hidden>
                  <span className="lj-neck-thread" />
                  <span className="lj-neck-thread second" />
                  <span className="lj-neck-lip" />
                </div>

                <div className="lj-glass" ref={glassRef}>
                  <span className="lj-glass-back" aria-hidden />
                  <span className="lj-glass-glow" aria-hidden />

                  {lightsOn && (
                    <svg className="lj-innerwire" viewBox="0 0 200 300" aria-hidden preserveAspectRatio="none">
                      <path
                        d="M28 40 C 120 78, 60 120, 150 150 C 60 186, 140 220, 40 258"
                        fill="none"
                        stroke="#6B5A44"
                        strokeWidth="2"
                        opacity="0.55"
                      />
                    </svg>
                  )}
                  {lightsOn &&
                    JAR_BULBS.map((b, i) => (
                      <span
                        key={i}
                        className="lj-inner-bulb"
                        aria-hidden
                        style={{
                          left: `${b.x}%`,
                          top: `${b.y}%`,
                          animationDelay: `${b.delay}s`,
                        }}
                      />
                    ))}

                  <div
                    className={`lj-field ${dragging ? "is-dragging" : ""}`}
                    style={{ ["--pile" as string]: `${dig}%` }}
                    onPointerDown={(e) => {
                      if (pack.overflow <= 0.5) return;
                      const startY = e.clientY;
                      const startDig = digRef.current;
                      const h = glassRef.current?.getBoundingClientRect().height ?? 1;
                      const el = e.currentTarget;
                      let moved = false;
                      const move = (ev: PointerEvent) => {
                        const d = ev.clientY - startY;
                        if (!moved && Math.abs(d) > 4) {
                          moved = true;
                          setDragging(true);
                          el.setPointerCapture(ev.pointerId);
                        }
                        if (moved) setDigClamped(startDig + (d / h) * 100);
                      };
                      const up = () => {
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", up);
                        setDragging(false);
                        /* A drag must not also count as opening whatever was
                           under the finger when it started. The click lands
                           right after pointerup, so the guard is dropped on the
                           next frame rather than immediately. */
                        if (moved) {
                          draggedRef.current = true;
                          window.setTimeout(() => {
                            draggedRef.current = false;
                          }, 0);
                        }
                      };
                      window.addEventListener("pointermove", move);
                      window.addEventListener("pointerup", up);
                    }}
                  >
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
                          onClick={(e) => {
                            if (draggedRef.current) return;
                            openLetter(l, e.currentTarget);
                          }}
                          onMouseEnter={() => setHovered(l.id)}
                          onMouseLeave={() => setHovered((h) => (h === l.id ? null : h))}
                          onFocus={() => {
                            setHovered(l.id);
                            revealSlot(slot);
                          }}
                          onBlur={() => setHovered((h) => (h === l.id ? null : h))}
                          aria-label={`${sealed ? "Sealed letter" : "Letter"}: ${l.title}, from ${nameOf(l.sender_id)}`}
                          className={`lj-scroll ${sealed ? "is-sealed" : ""} ${locked ? "is-locked" : ""} ${
                            isActive ? "is-out" : ""
                          } ${myMarks[l.id]?.is_favorite ? "is-keepsake" : ""} ${
                            l.id === newestUnreadId ? "is-newest" : ""
                          }`}
                          style={{
                            left: `${slot.x}%`,
                            top: `${slot.y}%`,
                            width: `${slot.len}%`,
                            height: `${slot.thick}%`,
                            zIndex:
                              hovered === l.id ? 60 : l.id === newestUnreadId ? 55 : slot.z,
                            ["--rot" as string]: `${slot.rot}deg`,
                          }}
                        >
                          <ScrollGlyph
                            paperId={l.theme_style}
                            ribbon={myMarks[l.id]?.is_favorite ? "#D9B45E" : l.ribbon_color}
                            ribbonStyle={l.ribbon_style}
                            wax={l.wax_color}
                            waxShape={l.wax_shape}
                            sprig={l.sprig}
                            sealed={sealed}
                            className="lj-scroll-svg"
                          />
                          {locked && (
                            <span className="lj-scroll-lock">
                              <Lock className="w-2.5 h-2.5" strokeWidth={3} />
                            </span>
                          )}
                          {l.id === newestUnreadId && !locked && (
                            <span className="lj-scroll-new font-mono" aria-hidden>
                              NEW
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
                        {letters.length === 0 ? "nothing rolled up yet" : "nothing matches that"}
                      </p>
                      <p className="font-mono text-[9px] tracking-[.15em] mt-1 opacity-70">
                        {letters.length === 0 ? "WRITE THE FIRST ONE" : "TRY ANOTHER FILTER"}
                      </p>
                    </div>
                  )}

                  {/* Hints that the pile carries on past the glass. Without
                      these a full jar looks like the whole collection. */}
                  {pack.overflow > 0.5 && dig < pack.overflow - 0.5 && (
                    <span className="lj-more top" aria-hidden />
                  )}
                  {pack.overflow > 0.5 && dig > 0.5 && (
                    <span className="lj-more bottom" aria-hidden />
                  )}

                  {/* the glass itself, laid over whatever is inside it */}
                  <span className="lj-glass-sheen" aria-hidden />
                  <span className="lj-glass-sheen second" aria-hidden />
                  <span className="lj-glass-curve" aria-hidden />
                  <span className="lj-glass-floor" aria-hidden />
                </div>

                {/* ------------------------------------ digging control --- */}
                {pack.overflow > 0.5 && (
                  <div className="lj-dig" role="group" aria-label="Dig through the pile">
                    <button
                      type="button"
                      className="lj-dig-btn"
                      onClick={() => setDigClamped(digRef.current + 14)}
                      disabled={dig >= pack.overflow - 0.5}
                      aria-label="Look higher up the pile"
                      title="Higher up the pile"
                    >
                      <ChevronUp className="w-3.5 h-3.5" strokeWidth={3} />
                    </button>

                    <div className="lj-dig-rail">
                      <span
                        className="lj-dig-thumb"
                        style={{ top: `${100 - (dig / pack.overflow) * 100}%` }}
                        aria-hidden
                      />
                      {digMarks.map((m) => (
                        <span
                          key={m.id}
                          className="lj-dig-mark"
                          style={{ top: `${m.at}%` }}
                          aria-hidden
                        />
                      ))}
                    </div>

                    <button
                      type="button"
                      className="lj-dig-btn"
                      onClick={() => setDigClamped(digRef.current - 14)}
                      disabled={dig <= 0.5}
                      aria-label="Look lower down the pile"
                      title="Lower down the pile"
                    >
                      <ChevronDown className="w-3.5 h-3.5" strokeWidth={3} />
                    </button>

                    <span className="lj-dig-hint font-mono">DIG</span>
                  </div>
                )}

                <TwineBow className="lj-twine" />
                <HeartTag className="lj-hangtag" />
                <JarLabel
                  className="lj-label"
                  title="Our Letters"
                  line={`${stats.sealed} SEALED  ${stats.opened} READ`}
                />

                {jarFx && jarFx !== "shake" && (
                  <div className="lj-burst" aria-hidden>
                    {Array.from({ length: 16 }).map((_, i) => (
                      <span
                        key={i}
                        className="lj-spark"
                        style={{
                          ["--sx" as string]: `${Math.cos((i / 16) * Math.PI * 2) * 120}px`,
                          ["--sy" as string]: `${Math.sin((i / 16) * Math.PI * 2) * 120 - 30}px`,
                          animationDelay: `${i * 0.018}s`,
                        }}
                      />
                    ))}
                    <span className="lj-shockwave" />
                  </div>
                )}

                {/* Portalled into document.body (see JarHoverTag) so it always
                    floats fully above the letter, uncropped, exactly like the
                    ones over lower letters - .lj-glass clips overflow to
                    contain the pile, which cut this off whenever a letter's
                    real on-screen position didn't leave 150-190px of clear
                    space above it inside the glass itself. Loose rolls
                    (outside the glass, on the desk) keep their own
                    percentage-anchored tag - unrelated, unaffected. */}
                {hoverAnchor && !phase && (() => {
                  /* `hovered` can outlive the letter it points to - e.g. the
                     list changes out from under an in-progress hover - so
                     this has to actually check, not just assert the type
                     away and crash on a missing letter's .sender_id. */
                  const hoveredLetter = letters.find((l) => l.id === hovered);
                  if (!hoveredLetter) return null;
                  return (
                    <JarHoverTag
                      letter={hoveredLetter}
                      anchor={hoverAnchor}
                      fromName={nameOf(hoveredLetter.sender_id)}
                      sealed={!myMarks[hovered as string]?.opened_at}
                      locked={isLocked(hoveredLetter)}
                    />
                  );
                })()}
              </div>
            </div>
          )}

          <p className="lj-scene-caption">
            {stats.total === 0
              ? "the glass is empty. Write the first one and it rolls itself up."
              : stats.sealed > 0
                ? `${stats.sealed} still sealed. Tap a roll to break the wax.`
                : "every letter in here has been read at least once"}
          </p>

          {error && (
            <div className="lj-error-note">
              <p className="font-mono text-[11px] leading-relaxed">{error}</p>
            </div>
          )}
        </section>

        {/* ---------------------------------- right: the shelf and index --- */}
        <aside className="lj-rail lj-rail-r">
          <div className="lj-card lj-card-shelf">
            <span className="lj-tape-strip lj-tape-strip-b" aria-hidden />
            <span className="lj-card-title">THE KEEPSAKE SHELF</span>

            {keepsakes.length === 0 ? (
              <p className="font-handwriting text-lg text-[#5A2029]/80 leading-tight mt-2">
                star a letter and it stands up here
              </p>
            ) : (
              <div className="lj-shelf">
                <div className="lj-shelf-row">
                  {keepsakes.slice(0, 5).map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={(e) => openLetter(l, e.currentTarget)}
                      className="lj-standing"
                      title={l.title}
                      aria-label={`Keepsake: ${l.title}`}
                    >
                      <ScrollGlyph
                        paperId={l.theme_style}
                        ribbon="#D9B45E"
                        ribbonStyle={l.ribbon_style}
                        wax={l.wax_color}
                        waxShape={l.wax_shape}
                        sprig={l.sprig}
                        sealed={!myMarks[l.id]?.opened_at}
                        className="lj-standing-svg"
                      />
                    </button>
                  ))}
                </div>
                <span className="lj-shelf-plank" aria-hidden />
              </div>
            )}
          </div>

          <div className="lj-card lj-card-index">
            <span className="lj-spiral" aria-hidden>
              {Array.from({ length: 9 }).map((_, i) => (
                <span key={i} className="spiral-binder-ring lj-ring" />
              ))}
            </span>
            <span className="lj-card-title">EVERY LETTER</span>
            <div className="lj-index-list lj-scrollbar">
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
          {ready && <div className="lj-reader-rays" aria-hidden />}

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
            <span className="lj-rollbar top" style={{ ["--ribbon" as string]: target.ribbon_color }}>
              <span className="lj-rollbar-face" />
              <span className="lj-rollbar-tie" />
            </span>
            <span className="lj-rollbar bottom" style={{ ["--ribbon" as string]: target.ribbon_color }}>
              <span className="lj-rollbar-face" />
              <span className="lj-rollbar-tie" />
            </span>

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

          {ready && brokeSeal && (
            <div className="lj-petals" aria-hidden>
              {Array.from({ length: 14 }).map((_, i) => (
                <span
                  key={i}
                  className="lj-petal"
                  style={{
                    left: `${5 + i * 6.8}%`,
                    animationDelay: `${i * 0.2}s`,
                    ["--drift" as string]: `${(i % 2 ? 1 : -1) * (18 + i * 4)}px`,
                    ["--spin" as string]: `${(i % 2 ? 1 : -1) * 320}deg`,
                  }}
                >
                  {i % 4 === 0 ? "🌸" : i % 4 === 1 ? "✨" : i % 4 === 2 ? "🤍" : "🌾"}
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

/* A count as a little enamel chip rather than another line in a list, so the
   panel reads as a set of objects instead of a stack of rows. */
/* Turns one of the drawn objects on the desk into a real control: a button with
   no chrome of its own, a hand-lettered tag on hover, and a press that pushes
   the object into the desk rather than moving a box around it. */
function Prop({
  className,
  label,
  onClick,
  children,
}: {
  className: string;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={className} onClick={onClick} aria-label={label}>
      {children}
      <span className="lj-prop-tag font-mono" aria-hidden>
        {label}
      </span>
    </button>
  );
}

function CountChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={`lj-chip lj-chip-${tone}`}>
      <span className="font-marker text-xl leading-none">{value}</span>
      <span className="font-mono text-[8px] tracking-[.12em] uppercase opacity-80 mt-0.5">
        {label}
      </span>
    </span>
  );
}

function HoverTagBody({
  letter,
  fromName,
  sealed,
  locked,
}: {
  letter: Letter;
  fromName: string;
  sealed: boolean;
  locked: boolean;
}) {
  return (
    <>
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
    </>
  );
}

/* Used only for the loose rolls beside the jar - anchored as a plain
   percentage position inside that letter's own (non-clipping) button. */
function HoverTag({
  letter,
  left,
  top,
  fromName,
  sealed,
  locked,
}: {
  letter: Letter;
  left: number;
  top: number;
  fromName: string;
  sealed: boolean;
  locked: boolean;
}) {
  return (
    <div
      className="lj-hovertag"
      style={{
        left: `${Math.min(86, Math.max(14, left))}%`,
        top: `${top}%`,
      }}
    >
      <span className="lj-hovertag-string" aria-hidden />
      <span className="lj-hovertag-hole" aria-hidden />
      <HoverTagBody letter={letter} fromName={fromName} sealed={sealed} locked={locked} />
    </div>
  );
}

/* Used for letters inside the glass. The glass clips overflow to contain the
   pile, so a tag anchored with jar-relative percentages gets clipped whenever
   it floats above a letter near the top - there just isn't 150-190px of
   uncropped room above it in there. Portalled straight into document.body and
   positioned in real viewport pixels (measured off the letter's own DOM node,
   via scrollRefs) instead, so it always renders fully on top of everything,
   above the letter, exactly like the ones over lower letters already do. */
function JarHoverTag({
  letter,
  anchor,
  fromName,
  sealed,
  locked,
}: {
  letter: Letter;
  anchor: { x: number; y: number };
  fromName: string;
  sealed: boolean;
  locked: boolean;
}) {
  return createPortal(
    <div
      className="lj-hovertag lj-hovertag-fixed"
      style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
    >
      <span className="lj-hovertag-string" aria-hidden />
      <span className="lj-hovertag-hole" aria-hidden />
      <HoverTagBody letter={letter} fromName={fromName} sealed={sealed} locked={locked} />
    </div>,
    document.body
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
  const paper = paperOf(letter.theme_style);
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget)}
      className={`lj-indexrow ${sealed ? "is-sealed" : ""}`}
      style={{
        ["--ribbon" as string]: letter.ribbon_color,
        ["--swatch" as string]: paper.chip,
      }}
    >
      <span className="lj-indexrow-knot" />
      <span className="lj-indexrow-swatch" />
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

/* The sheet is built in layers the way a real one is: the stock underneath, a
   turbulence grain over it, the patina (foxing, coffee, ink) above that, then
   the edge treatment, and only then the writing. */
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
      className={`lj-paper edge-${letter.paper_edge} patina-${letter.paper_patina} ${
        stamp.tag ? "lj-has-stamp" : ""
      }`}
      style={{
        background: paper.base,
        color: letter.ink_color,
        ["--sheet" as string]: paper.chip,
        ["--sheet-edge" as string]: paper.edge,
      }}
    >
      <span className="lj-paper-grain" aria-hidden />
      <span className="lj-paper-patina" aria-hidden />
      <span className="lj-paper-fold" aria-hidden />
      <span className="lj-paper-edge" aria-hidden />

      {tape.css && <span className={`${tape.css} lj-paper-tape left`} aria-hidden />}
      {tape.css && <span className={`${tape.css} lj-paper-tape right`} aria-hidden />}

      <StampMark id={letter.stamp_style} className="lj-paper-stamp" />

      <div className="lj-paper-well lj-scrollbar">
      <div className="lj-paper-body">
        <div className="lj-paper-head">
          {letter.occasion && <span className="lj-occasion-tag">{letter.occasion}</span>}

          <h2
            className="font-marker text-3xl sm:text-4xl leading-tight mt-1"
            style={{ color: letter.ink_color }}
          >
            {letter.title}
          </h2>

          <p className="font-mono text-[10px] tracking-[.15em] opacity-70 mt-1.5">
            FROM {fromName.toUpperCase()} • TO {toName.toUpperCase()} •{" "}
            {formatDate(letter.created_at).toUpperCase()}
          </p>

          {replyTo && (
            <p className="font-handwriting text-lg opacity-75 mt-1">
              in reply to &ldquo;{replyTo}&rdquo;
            </p>
          )}
        </div>

        {/* a rule drawn by hand, not a border */}
        <svg className="lj-rule" viewBox="0 0 400 8" preserveAspectRatio="none" aria-hidden>
          <path
            d="M2 5 C 60 2, 120 7, 190 4 C 260 1, 330 6, 398 3"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.32"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>

        <div className={`${font.cls} ${font.size} whitespace-pre-wrap break-words`}>
          {letter.body}
        </div>

        <div className="lj-paper-sign flex items-end justify-between gap-4">
          <span className="font-handwriting text-2xl opacity-90">yours, {fromName}</span>
          <span
            className={`lj-paper-seal wax-${letter.wax_shape}`}
            style={{ ["--wax" as string]: letter.wax_color }}
            aria-hidden
          >
            <span className="lj-paper-seal-face">
              <Emblem className="w-5 h-5" strokeWidth={2.2} />
            </span>
          </span>
        </div>
      </div>

      </div>

      {/* a pressed stem tucked into the corner of the sheet */}
      {letter.sprig !== "none" && (
        <svg className="lj-paper-sprig" viewBox="0 0 60 40" aria-hidden>
          <SprigMark def={sprigOf(letter.sprig)} x={8} y={30} />
        </svg>
      )}

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
  { id: "seal", label: "TIE & SEAL" },
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
    // Co-prime strides walk each new sticker to its own spot instead of
    // dropping them all on top of each other.
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
        <span className="lj-chapter-stamp">{draft.id ? "REWRITING" : "NEW LETTER"}</span>
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
        {/* -------- live preview: the exact sheet that goes in the jar ---- */}
        <div className="lj-preview-stage">
          <span className="font-mono text-[9px] tracking-[.2em] text-[#C9A9A2] mb-2 block">
            HOW IT WILL LOOK WHEN THEY UNROLL IT
          </span>

          <div className="lj-preview-frame">
            <div
              ref={previewRef}
              className={`lj-preview lj-paper edge-${draft.paper_edge} patina-${draft.paper_patina} ${
                stamp.tag ? "lj-has-stamp" : ""
              }`}
              style={{
                background: paper.base,
                color: draft.ink_color,
                ["--sheet" as string]: paper.chip,
                ["--sheet-edge" as string]: paper.edge,
              }}
              onPointerDown={() => setSelected(null)}
            >
              <span className="lj-paper-grain" aria-hidden />
              <span className="lj-paper-patina" aria-hidden />
              <span className="lj-paper-fold" aria-hidden />
              <span className="lj-paper-edge" aria-hidden />

              {tape.css && <span className={`${tape.css} lj-paper-tape left`} aria-hidden />}
              {tape.css && <span className={`${tape.css} lj-paper-tape right`} aria-hidden />}

              <StampMark id={draft.stamp_style} className="lj-paper-stamp" />

              <div className="lj-paper-well lj-scrollbar">
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

                <svg className="lj-rule" viewBox="0 0 400 8" preserveAspectRatio="none" aria-hidden>
                  <path
                    d="M2 5 C 60 2, 120 7, 190 4 C 260 1, 330 6, 398 3"
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.32"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>

                <div className={`${font.cls} ${font.size} whitespace-pre-wrap break-words min-h-[80px]`}>
                  {draft.body || "start writing and it appears here, in your ink, on your paper."}
                </div>

                <div className="lj-paper-sign flex items-end justify-between gap-4">
                  <span className="font-handwriting text-2xl opacity-90">yours, {myName}</span>
                  <span
                    className={`lj-paper-seal wax-${draft.wax_shape}`}
                    style={{ ["--wax" as string]: draft.wax_color }}
                    aria-hidden
                  >
                    <span className="lj-paper-seal-face">
                      <Emblem className="w-5 h-5" strokeWidth={2.2} />
                    </span>
                  </span>
                </div>
              </div>

              </div>

              {draft.sprig !== "none" && (
                <svg className="lj-paper-sprig" viewBox="0 0 60 40" aria-hidden>
                  <SprigMark def={sprigOf(draft.sprig)} x={8} y={30} />
                </svg>
              )}

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

            {/* how the same letter will look once it is rolled up */}
            <div className="lj-roll-preview" aria-hidden>
              <span className="font-mono text-[8px] tracking-[.18em] block mb-1 opacity-70">
                ROLLED UP
              </span>
              <ScrollGlyph
                paperId={draft.theme_style}
                ribbon={draft.ribbon_color}
                ribbonStyle={draft.ribbon_style}
                wax={draft.wax_color}
                waxShape={draft.wax_shape}
                sprig={draft.sprig}
                sealed
                className="lj-roll-preview-svg"
              />
            </div>
          </div>

          {selectedSticker && (
            <div className="lj-sticker-tools">
              <span className="font-mono text-[9px] tracking-[.14em]">
                {selectedSticker.char} SELECTED
              </span>
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
        <div className="lj-rail-panel">
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
              <>
                <Field label="THE STOCK">
                  <div className="lj-paper-grid">
                    {PAPERS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          set("theme_style", p.id);
                          set("ink_color", p.ink);
                        }}
                        className={`lj-paper-opt edge-${draft.paper_edge} ${
                          draft.theme_style === p.id ? "is-active" : ""
                        }`}
                        style={{
                          background: p.base,
                          color: p.ink,
                          ["--sheet" as string]: p.chip,
                          ["--sheet-edge" as string]: p.edge,
                        }}
                      >
                        <span className="lj-paper-grain" aria-hidden />
                        <span className="lj-paper-edge" aria-hidden />
                        <span className="relative z-10">{p.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="font-handwriting text-lg text-[#C9A9A2] mt-3 leading-snug">
                    picking a stock also sets its matching ink. change the ink after if you like.
                  </p>
                </Field>

                <Field label="HOW THE EDGE IS FINISHED">
                  <div className="grid grid-cols-2 gap-1.5">
                    {PAPER_EDGES.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => set("paper_edge", e.id)}
                        className={`lj-opt lj-opt-tall ${draft.paper_edge === e.id ? "is-active" : ""}`}
                      >
                        <span className="block">{e.label}</span>
                        <span className="block font-handwriting text-base normal-case tracking-normal opacity-75 mt-0.5">
                          {e.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="HOW IT HAS AGED">
                  <div className="grid grid-cols-2 gap-1.5">
                    {PATINAS.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => set("paper_patina", e.id)}
                        className={`lj-opt lj-opt-tall ${draft.paper_patina === e.id ? "is-active" : ""}`}
                      >
                        <span className="block">{e.label}</span>
                        <span className="block font-handwriting text-base normal-case tracking-normal opacity-75 mt-0.5">
                          {e.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </Field>
              </>
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
                <span className="lj-card-title block mt-4 mb-1.5">OR MIX YOUR OWN</span>
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
                  <div className="grid grid-cols-2 gap-1.5 mt-2.5">
                    {RIBBON_STYLES.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => set("ribbon_style", r.id)}
                        className={`lj-opt lj-opt-tall ${draft.ribbon_style === r.id ? "is-active" : ""}`}
                      >
                        <span className="block">{r.label}</span>
                        <span className="block font-handwriting text-base normal-case tracking-normal opacity-75 mt-0.5">
                          {r.hint}
                        </span>
                      </button>
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
                  <div className="grid grid-cols-2 gap-1.5 mt-2.5">
                    {WAX_SHAPES.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => set("wax_shape", w.id)}
                        className={`lj-opt lj-opt-tall ${draft.wax_shape === w.id ? "is-active" : ""}`}
                      >
                        <span className="block">{w.label}</span>
                        <span className="block font-handwriting text-base normal-case tracking-normal opacity-75 mt-0.5">
                          {w.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="WHAT IS PRESSED INTO IT">
                  <div className="grid grid-cols-4 gap-1.5">
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

                <Field label="TUCKED UNDER THE RIBBON">
                  <div className="grid grid-cols-3 gap-1.5">
                    {SPRIGS.map((sp) => (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={() => set("sprig", sp.id)}
                        className={`lj-opt ${draft.sprig === sp.id ? "is-active" : ""}`}
                      >
                        {sp.label}
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
                        {t.css && (
                          <span className={`${t.css} inline-block w-6 h-2.5 mr-1.5 align-middle`} />
                        )}
                        {t.label}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="POSTAGE STAMP">
                  <div className="lj-stamp-grid">
                    {STAMPS.map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => set("stamp_style", st.id)}
                        className={`lj-stamp-opt ${draft.stamp_style === st.id ? "is-active" : ""}`}
                        aria-label={st.label}
                      >
                        {st.tag ? (
                          <StampMark id={st.id} className="w-full h-auto" />
                        ) : (
                          <span className="lj-stamp-none">NONE</span>
                        )}
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
                  <div className="lj-filter-row mt-2">
                    {OCCASION_PRESETS.map((pr) => (
                      <button
                        key={pr}
                        type="button"
                        onClick={() => set("occasion", pr)}
                        className={`lj-filter ${draft.occasion === pr ? "is-active" : ""}`}
                      >
                        <span className="lj-filter-hole" />
                        {pr}
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
      <span className="lj-card-title block mb-1.5">{label}</span>
      {children}
    </div>
  );
}

/* =============================================================== styles == */
/* Chapter-scoped, per the house rule that a chapter carries its own CSS so it
   stays independently droppable. Rules of the room:
     - motion is transform, opacity and clip-path only, so nothing forces a
       per-frame repaint;
     - SVG filters appear only on static elements (paper edges), never on
       anything that animates;
     - the grain is one data-URI turbulence tile the browser rasterises once. */

function ScopedStyles() {
  return (
    <style>{`
      .lj-root {
        --lj-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)'/%3E%3C/svg%3E");
        --mx: 0; --my: 0;
        position: relative;
        min-height: 100svh;
        overflow-x: hidden;
        background: #0C0709;
        color: #F2E6D2;
      }

      /* ======================================================== the room === */
      .lj-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }

      .lj-bg-wall {
        position: absolute; inset: -4%;
        background:
          repeating-linear-gradient(90deg, rgba(255,255,255,.018) 0 2px, transparent 2px 46px),
          radial-gradient(ellipse 80% 60% at 50% 8%, #4A2C33 0%, transparent 62%),
          linear-gradient(#241519 0%, #180F13 46%, #0D080A 100%);
        transform: translate3d(calc(var(--mx) * -8px), calc(var(--my) * -6px), 0);
      }
      .lj-bg-paper {
        position: absolute; inset: 0;
        background-image: var(--lj-grain);
        opacity: .10;
        mix-blend-mode: overlay;
      }
      .lj-bg-window {
        position: absolute; left: 4%; top: -6%; width: 30%; height: 62%;
        background:
          linear-gradient(180deg, rgba(255,214,164,.16), rgba(255,180,140,.04) 60%, transparent),
          repeating-linear-gradient(90deg, transparent 0 46%, rgba(20,12,14,.5) 46% 48%, transparent 48%);
        transform: skewY(6deg) translate3d(calc(var(--mx) * -14px), 0, 0);
        filter: none;
      }
      .lj-bg-beam {
        position: absolute; left: 2%; top: -20%; width: 46%; height: 130%;
        background: linear-gradient(163deg, rgba(255,206,150,.13), transparent 46%);
        transform: translate3d(calc(var(--mx) * -20px), calc(var(--my) * -10px), 0);
      }
      .lj-bg-shelf {
        position: absolute; right: -4%; top: 16%; width: 44%; height: 16px;
        background: linear-gradient(#40291B, #21140D);
        box-shadow: 0 16px 34px rgba(0,0,0,.7);
        transform: rotate(-1.2deg) translate3d(calc(var(--mx) * 10px), calc(var(--my) * 5px), 0);
      }

      /* ------------------------------------------------ the rest of the room */
      /* Rain running down the window. One repeating gradient shifted on the Y
         axis, so the whole effect is a single compositor-side transform. */
      .lj-bg-rain {
        position: absolute; left: 4%; top: -6%; width: 30%; height: 62%;
        opacity: .5;
        background: repeating-linear-gradient(
          188deg,
          transparent 0 12px,
          rgba(214,232,240,.16) 12px 13px,
          transparent 13px 34px
        );
        transform: skewY(6deg) translate3d(calc(var(--mx) * -14px), 0, 0);
        animation: lj-rain 2.6s linear infinite;
      }
      @keyframes lj-rain {
        to { transform: skewY(6deg) translate3d(calc(var(--mx) * -14px), 34px, 0); }
      }
      .lights-off .lj-bg-rain { opacity: .26; }

      /* a picture rail and a skirting board, which is most of what stops a wall
         reading as a flat colour field */
      .lj-bg-rail {
        position: absolute; left: 0; right: 0; top: 13%; height: 7px;
        background: linear-gradient(#4A3122, #26170F 60%, #150C09);
        box-shadow: 0 5px 14px rgba(0,0,0,.55);
        opacity: .85;
      }
      .lj-bg-skirt {
        position: absolute; left: 0; right: 0; bottom: 0; height: 74px;
        background:
          linear-gradient(#2B1A1E 0 6px, transparent 6px),
          linear-gradient(180deg, #241519, #150D10 70%, #0C0709);
        box-shadow: 0 -12px 30px rgba(0,0,0,.5);
      }

      /* whatever is standing on the shelf */
      .lj-bg-shelf-jar {
        position: absolute; right: 9%; top: calc(16% - 42px);
        width: 30px; height: 44px; border-radius: 4px 4px 8px 8px;
        background: linear-gradient(112deg, rgba(206,226,222,.16), rgba(160,186,182,.05) 46%, rgba(206,226,222,.18));
        box-shadow: inset 0 -10px 14px rgba(0,0,0,.3);
        border: 1px solid rgba(178,198,197,.2);
        transform: rotate(-1.2deg) translate3d(calc(var(--mx) * 10px), calc(var(--my) * 5px), 0);
      }
      .lj-bg-shelf-book {
        position: absolute; right: 20%; top: calc(16% - 54px);
        width: 13px; height: 56px; border-radius: 2px;
        background: linear-gradient(#5A2029, #35121A);
        transform: rotate(-1.2deg) translate3d(calc(var(--mx) * 10px), calc(var(--my) * 5px), 0);
      }
      .lj-bg-shelf-book.second {
        right: calc(20% + 16px); height: 48px; top: calc(16% - 46px);
        background: linear-gradient(#4A3A22, #281D10);
      }

      /* two frames, hung crooked off the rail */
      .lj-bg-frame {
        position: absolute; border: 5px solid #3A2A1C; border-radius: 2px;
        background: #150E11;
        box-shadow: 0 14px 26px rgba(0,0,0,.6), inset 0 0 0 2px rgba(0,0,0,.5);
      }
      .lj-bg-frame-mat {
        position: absolute; inset: 5px;
        background:
          repeating-linear-gradient(52deg, rgba(255,255,255,.03) 0 3px, transparent 3px 7px),
          linear-gradient(150deg, #3E2B31, #1E1418 70%);
      }
      .lj-bg-frame-wire {
        position: absolute; left: 50%; bottom: 100%; translate: -50% 0;
        width: 1px; height: 34px;
        background: linear-gradient(rgba(120,96,70,.7), rgba(120,96,70,.25));
      }
      .lj-bg-frame-a {
        left: 41%; top: calc(13% + 34px); width: 96px; height: 122px;
        rotate: -2.4deg;
        transform: translate3d(calc(var(--mx) * -6px), calc(var(--my) * -4px), 0);
      }
      .lj-bg-frame-b {
        left: 53%; top: calc(13% + 52px); width: 74px; height: 62px;
        rotate: 3deg;
        transform: translate3d(calc(var(--mx) * -8px), calc(var(--my) * -5px), 0);
      }

      /* the lamp doing the lighting, and the pool it throws */
      .lj-bg-lamp {
        position: absolute; right: 22%; top: 0; width: 86px; height: 190px;
        transform: translate3d(calc(var(--mx) * 12px), 0, 0);
      }
      .lj-bg-lamp-flex {
        position: absolute; left: 50%; top: 0; translate: -50% 0;
        width: 3px; height: 118px;
        background: linear-gradient(rgba(90,72,54,.5), #3A2A1C);
      }
      .lj-bg-lamp-shade {
        position: absolute; left: 50%; top: 112px; translate: -50% 0;
        width: 86px; height: 48px;
        background: linear-gradient(168deg, #5E3A22, #33200F 70%);
        border-radius: 6px 6px 46% 46% / 6px 6px 22% 22%;
        clip-path: polygon(34% 0, 66% 0, 100% 100%, 0 100%);
        box-shadow: 0 10px 26px rgba(0,0,0,.6);
      }
      .lj-bg-lamp-bulb {
        position: absolute; left: 50%; top: 154px; translate: -50% 0;
        width: 22px; height: 22px; border-radius: 999px;
        background: radial-gradient(circle at 40% 34%, #FFF2CE, #FFC078 62%, rgba(200,130,60,.4));
        box-shadow: 0 0 26px 10px rgba(255,196,128,.45);
        transition: opacity .45s ease;
      }
      /* Was a sibling of .lj-bg-lamp, positioned with its own independent
         right%/top offsets instead of anchoring to the bulb - the two only
         lined up by coincidence at one viewport width and drifted apart
         (the light visibly not coming from the bulb) at every other width.
         Now a child of .lj-bg-lamp, centered on the bulb via left:50%. */
      .lj-bg-lampcone {
        position: absolute; left: 50%; top: 154px; translate: -50% 0;
        width: 46vw; height: 62vh; max-width: 640px; max-height: 760px;
        background: linear-gradient(184deg, rgba(255,206,150,.14), rgba(255,186,120,.04) 42%, transparent 70%);
        clip-path: polygon(46% 0, 54% 0, 100% 100%, 0 100%);
        transition: opacity .45s ease;
      }
      .lights-off .lj-bg-lamp-bulb { opacity: .22; box-shadow: none; }
      .lights-off .lj-bg-lampcone { opacity: .12; }

      @media (max-width: 1023px) {
        .lj-bg-frame, .lj-bg-lamp, .lj-bg-lampcone,
        .lj-bg-shelf-jar, .lj-bg-shelf-book { display: none; }
      }
      @media (prefers-reduced-motion: reduce) { .lj-bg-rain { animation: none; } }

      .lj-swinger {
        position: absolute; width: 190px; opacity: .12;
        filter: brightness(0.35) contrast(1.3);
        transform-origin: top center;
      }
      .lj-swinger-gwen {
        left: 6%; top: -3%;
        animation: lj-swing-far 13s ease-in-out infinite;
      }
      .lj-swinger-peter {
        right: 8%; top: -6%; width: 165px; opacity: .10;
        animation: lj-swing-far 17s ease-in-out infinite reverse;
      }
      @keyframes lj-swing-far {
        0%, 100% { transform: rotate(-7deg) translateY(0); }
        50% { transform: rotate(7deg) translateY(14px); }
      }

      .lj-bokeh { position: absolute; inset: 0; }
      .lj-bokeh-dot {
        position: absolute; border-radius: 999px;
        animation-name: lj-bokeh-drift;
        animation-timing-function: ease-in-out;
        animation-iteration-count: infinite;
        transform: translate3d(calc(var(--mx) * var(--depth) * 8px), calc(var(--my) * var(--depth) * 6px), 0);
      }
      @keyframes lj-bokeh-drift {
        0%, 100% { opacity: .22; transform: translate3d(0, 0, 0) scale(1); }
        50% { opacity: .62; transform: translate3d(14px, -22px, 0) scale(1.16); }
      }

      .lj-motes { position: absolute; inset: 0; }
      .lj-mote {
        position: absolute; border-radius: 999px; background: #FFE3B8;
        box-shadow: 0 0 6px 2px rgba(255,214,150,.55);
        animation-name: lj-mote-rise;
        animation-timing-function: linear;
        animation-iteration-count: infinite;
      }
      @keyframes lj-mote-rise {
        0% { opacity: 0; transform: translate3d(0, 20px, 0); }
        18% { opacity: .85; }
        76% { opacity: .5; }
        100% { opacity: 0; transform: translate3d(26px, -120px, 0); }
      }

      .lj-web { position: absolute; color: rgba(224,177,174,.15); width: 230px; height: 230px; }
      .lj-web-tl { top: 64px; left: -18px; }
      .lj-web-tr { top: 40px; right: -18px; transform: scaleX(-1); }
      .lj-web-bl { bottom: -20px; left: -22px; transform: scaleY(-1); }

      .lj-string { position: absolute; left: -4%; right: -4%; height: 150px; }
      .lj-string-wire { position: absolute; inset: 0; width: 100%; height: 100%; }
      .lj-string-a { top: -10px; transform: translate3d(calc(var(--mx) * 12px), 0, 0); }
      .lj-string-b { top: 54px; transform: scaleX(-1) translate3d(calc(var(--mx) * 7px), 0, 0); }
      .lj-string-c { top: 128px; transform: translate3d(calc(var(--mx) * 4px), 0, 0); }

      .lj-bulb-holder { position: absolute; display: block; }
      .lj-bulb-cap {
        position: absolute; left: 50%; translate: -50% 0; top: -5px;
        width: 6px; height: 6px; border-radius: 1px;
        background: linear-gradient(#7C6A52, #4A3D2E);
      }
      .lj-bulb {
        display: block; width: 10px; height: 12px;
        border-radius: 50% 50% 55% 55% / 42% 42% 60% 60%;
        background: radial-gradient(circle at 38% 30%, #fff, var(--bulb) 58%, rgba(0,0,0,.2));
        box-shadow: 0 0 14px 5px color-mix(in srgb, var(--bulb) 52%, transparent);
        animation: lj-twinkle 2.8s ease-in-out infinite;
      }
      @keyframes lj-twinkle { 0%, 100% { opacity: .38; } 50% { opacity: 1; } }

      .lj-spider-drop, .lj-spider-a, .lj-spider-b {
        position: absolute; display: flex; flex-direction: column; align-items: center;
        transform-origin: top center;
      }
      .lj-spider-a { top: 0; right: 14%; animation: lj-swing 7s ease-in-out infinite; }
      .lj-spider-b { top: 0; left: 22%; animation: lj-swing 9.5s ease-in-out infinite reverse; }
      .lj-thread { width: 1px; background: linear-gradient(rgba(150,130,120,.1), #BCA79A); display: block; }
      .lj-spider-svg { width: 26px; height: 24px; margin-top: -1px; }
      .lj-spider-b .lj-spider-svg { width: 17px; height: 16px; }
      @keyframes lj-swing { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }

      .lj-vignette {
        position: absolute; inset: 0;
        background: radial-gradient(ellipse 76% 62% at 50% 52%, transparent 34%, rgba(6,4,5,.82) 100%);
      }

      .lights-off .lj-bulb, .lights-off .lj-inner-bulb { opacity: .10 !important; animation: none !important; }
      .lights-off .lj-bokeh-dot { opacity: .1 !important; }
      .lights-off .lj-bg-beam, .lights-off .lj-bg-window { opacity: .3; }

      /* ======================================================= the top bar = */
      .lj-topbar {
        position: relative; z-index: 30;
        display: flex; align-items: center; flex-wrap: wrap; gap: .55rem;
        padding: .7rem 1rem .5rem;
      }
      .lj-titleblock { line-height: 1; margin-left: .35rem; }
      @media (max-width: 640px) { .lj-titleblock { flex-basis: 100%; margin-left: 0; } }

      .lj-chip-btn {
        display: inline-flex; align-items: center; gap: .4rem;
        font-family: 'Space Grotesk', monospace; font-size: 10px; font-weight: 900;
        letter-spacing: .14em; text-transform: uppercase;
        color: #2A1B20; background: linear-gradient(#F0E4CC, #DECBAA);
        border: 2px solid #261D24; box-shadow: 3px 3px 0 #0C0709;
        padding: .4rem .7rem; cursor: pointer; border-radius: 3px;
        transition: transform .12s ease, background .2s ease;
      }
      .lj-chip-btn:hover { background: linear-gradient(#F8F0DE, #E8D8BC); }
      .lj-chip-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #0C0709; }
      .lj-chip-btn.is-on { background: linear-gradient(#F2DFA6, #DFC684); }

      .lj-chapter-stamp {
        display: inline-block; padding: .3rem .6rem;
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        letter-spacing: .2em; color: #7D2834;
        background: #FBF4E6; border: 2px dashed #7D2834; border-radius: 3px;
        rotate: -2.5deg; box-shadow: 2px 2px 0 rgba(0,0,0,.35);
      }

      /* ========================================================= the room == */
      .lj-columns {
        position: relative; z-index: 20;
        display: grid; gap: 1rem;
        padding: 0 1rem 2rem;
      }
      .lj-rail { display: flex; flex-direction: column; gap: .85rem; }

      @media (min-width: 1120px) {
        .lj-root { height: 100svh; overflow: hidden; }
        .lj-columns {
          grid-template-columns: 292px minmax(0, 1fr) 302px;
          height: calc(100svh - 78px);
          padding-bottom: 1rem;
        }
        .lj-rail { overflow-y: auto; overflow-x: hidden; padding: 4px 6px 12px 4px; min-height: 0; }
        .lj-scene { min-height: 0; }
      }
      @media (max-width: 1119px) {
        .lj-scene { order: -1; }
      }

      /* ========================================================= the scene = */
      .lj-scene {
        position: relative;
        display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
      }
      .lj-scene-inner {
        position: relative; flex: 1; min-height: 0;
        width: 100%;
        display: flex; align-items: flex-end; justify-content: center;
        padding-bottom: 8%;
      }
      @media (max-width: 1119px) {
        .lj-scene-inner { min-height: 62svh; }
      }
      /* Below the three-column layout the jar fills nearly the whole width, so
         the tall props would read as being inside the glass rather than beside
         it. The low, wide ones stay; the standing bunches step out. */
      @media (max-width: 1023px) {
        .lj-bunch { display: none; }
        .lj-prop-envelope { width: 128px; left: -2%; }
        .lj-prop-bundle { width: 118px; right: -3%; }
        .lj-prop-candle { width: 66px; right: 6%; }
        .lj-loose-1, .lj-loose-2, .lj-loose-3 { display: none; }
      }

      .lj-ghost {
        position: absolute; left: 50%; top: 6%; translate: -50% 0;
        font-family: 'Permanent Marker', cursive;
        font-size: clamp(70px, 15vw, 190px); line-height: .8;
        letter-spacing: .04em;
        color: transparent;
        -webkit-text-stroke: 2px rgba(224,177,174,.10);
        pointer-events: none; user-select: none; z-index: 1;
        animation: lj-ghost-breathe 9s ease-in-out infinite;
      }
      @keyframes lj-ghost-breathe {
        0%, 100% { opacity: .7; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.02); }
      }

      .lj-scene-caption {
        position: relative; z-index: 4;
        font-family: 'Caveat', cursive; font-size: 21px; color: #C9A9A2;
        text-align: center; max-width: 26rem; margin: .5rem auto 0;
      }
      .lj-error-note {
        position: relative; z-index: 4; margin-top: .6rem; rotate: 1deg;
        background: #D8C29D; color: #4A1018;
        border: 1px dashed rgba(60,24,32,.5); padding: .5rem .8rem;
        box-shadow: 4px 6px 14px rgba(0,0,0,.45);
      }

      /* ------------------------------------------- the surface and props -- */
      .lj-board {
        position: absolute; left: 50%; translate: -50% 0; bottom: 4%;
        width: min(96%, 780px); height: 78px; border-radius: 10px 10px 16px 16px;
        background: linear-gradient(178deg, #6E4A2C 0%, #573820 42%, #3E2716 100%);
        box-shadow: 0 26px 44px rgba(0,0,0,.72), inset 0 2px 0 rgba(255,214,164,.22);
        z-index: 1;
      }
      .lj-board-grain {
        position: absolute; inset: 0; border-radius: inherit; overflow: hidden;
        background:
          repeating-linear-gradient(92deg, rgba(0,0,0,.16) 0 2px, transparent 2px 22px),
          repeating-linear-gradient(88deg, rgba(255,220,170,.05) 0 1px, transparent 1px 40px);
      }
      .lj-board-edge {
        position: absolute; left: 2%; right: 2%; top: -5px; height: 8px; border-radius: 999px;
        background: linear-gradient(#8A6038, #6A4526);
      }
      .lj-cloth {
        position: absolute; left: 50%; translate: -50% 0; bottom: -2%;
        width: min(104%, 900px); height: 120px; z-index: 0;
        background:
          repeating-linear-gradient(96deg, rgba(0,0,0,.10) 0 8px, transparent 8px 26px),
          linear-gradient(178deg, #B8AC94 0%, #8E836E 60%, #5F5747 100%);
        border-radius: 40% 46% 12% 14% / 60% 54% 20% 22%;
        opacity: .5;
        box-shadow: 0 -8px 30px rgba(0,0,0,.5);
      }
      .lj-doily {
        position: absolute; left: 50%; translate: -50% 0; bottom: 3%;
        width: min(90%, 620px); height: auto; z-index: 2; opacity: .8;
      }

      .lj-bunch { position: absolute; bottom: 5%; width: 250px; height: 330px; z-index: 3; opacity: .95; }
      .lj-bunch-l { left: -1%; transform: translate3d(calc(var(--mx) * 6px), 0, 0); }
      .lj-bunch-r { right: -2%; width: 224px; height: 300px; transform: scaleX(-1) translate3d(calc(var(--mx) * -5px), 0, 0); }

      /* ------------------------------------------ the desk, as controls --- */
      /* The props are buttons with no chrome. All of the pressed feedback is on
         the drawn object, so the desk still reads as a photographed still life
         rather than a toolbar. */
      .lj-prop {
        position: absolute; padding: 0; border: 0; background: none;
        cursor: pointer; line-height: 0;
        transition: transform .18s cubic-bezier(.34,1.56,.64,1);
      }
      .lj-prop > svg { display: block; width: 100%; height: auto; }
      .lj-prop:hover { transform: translateY(-3px); }
      .lj-prop:active { transform: translateY(1px) scale(.985); }
      .lj-prop:focus-visible {
        outline: 2px dashed #EAD9A9; outline-offset: 5px; border-radius: 4px;
        transform: translateY(-3px);
      }

      .lj-prop-tag {
        position: absolute; left: 50%; bottom: calc(100% + 10px);
        translate: -50% 0; z-index: 40; pointer-events: none;
        white-space: nowrap; line-height: 1.2;
        font-size: 8px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase;
        color: #3A2716; background: linear-gradient(#F3E7CE, #E3D2AC);
        padding: 3px 7px; border: 1.5px solid #1C1317;
        box-shadow: 2px 2px 0 rgba(9,6,8,.7);
        rotate: -2deg;
        opacity: 0; transform: translateY(4px);
        transition: opacity .15s ease, transform .15s ease;
      }
      .lj-prop:hover .lj-prop-tag,
      .lj-prop:focus-visible .lj-prop-tag { opacity: 1; transform: none; }

      .lj-prop-count {
        position: absolute; right: -6px; top: -8px; z-index: 30;
        display: grid; place-items: center; min-width: 18px; height: 18px;
        padding: 0 4px; border-radius: 999px;
        font-size: 9px; font-weight: 900; line-height: 1;
        color: #2C1A06; background: radial-gradient(circle at 34% 30%, #F0CE86, #C79333 74%);
        border: 1.5px solid #2A1B20;
      }

      .lj-prop-candle { right: 13%; bottom: 8%; width: 92px; z-index: 6; }
      .lj-prop-envelope { left: 5%; bottom: 4.5%; width: 186px; z-index: 6; rotate: -7deg; }
      .lj-prop-bundle { right: 3%; bottom: 3.5%; width: 172px; z-index: 5; rotate: 5deg; }

      .lj-flame { transform-origin: 55px 62px; animation: lj-flicker 2.6s ease-in-out infinite; }
      @keyframes lj-flicker {
        0%, 100% { transform: scale(1, 1) translateX(0); opacity: .95; }
        22% { transform: scale(.94, 1.08) translateX(-1px); opacity: 1; }
        48% { transform: scale(1.05, .95) translateX(1.5px); opacity: .88; }
        73% { transform: scale(.97, 1.05) translateX(-.5px); opacity: 1; }
      }
      .lights-off .lj-flame { opacity: .55; }

      /* The three newest letters, tipped out onto the desk. They open like any
         roll in the jar, so they get the same lift and the same sealed glow. */
      .lj-loose {
        position: absolute; z-index: 7; display: block;
        padding: 0; border: 0; background: none; cursor: pointer;
        transition: transform .2s cubic-bezier(.34,1.56,.64,1);
      }
      .lj-loose > svg { display: block; width: 100%; height: 100%; }
      .lj-loose:hover, .lj-loose:focus-visible {
        transform: translateY(-5px) scale(1.06); outline: none; z-index: 30;
      }
      .lj-loose:active { transform: translateY(0) scale(1.01); }
      .lj-loose.is-sealed > svg { filter: drop-shadow(0 0 7px rgba(255,201,130,.42)); }
      .lj-loose-1 { left: 24%; bottom: 5.5%; width: 122px; height: 36px; rotate: -9deg; }
      .lj-loose-2 { left: 33%; bottom: 3.5%; width: 104px; height: 30px; rotate: 6deg; }
      .lj-loose-3 { right: 26%; bottom: 6%; width: 96px; height: 28px; rotate: -14deg; }

      /* =========================================================== the jar = */
      .lj-jar-wrap {
        position: relative; z-index: 10;
        height: min(67vh, 570px);
        aspect-ratio: 0.74;
        transform-origin: 50% 100%;
        transform: translate3d(calc(var(--mx) * -3px), 0, 0);
      }
      @media (max-width: 1119px) { .lj-jar-wrap { height: min(56svh, 470px); } }

      .lj-jar-loading {
        display: grid; place-items: center; text-align: center;
        height: min(67vh, 570px); aspect-ratio: 0.74; margin: auto;
        border: 3px dashed rgba(224,177,174,.3); border-radius: 18px 18px 44px 44px;
      }

      .lj-jar-cast {
        position: absolute; left: 50%; translate: -50% 0; bottom: -22px;
        width: 118%; height: 46px; border-radius: 50%;
        background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,.7), transparent 68%);
      }

      .lj-prop-lid {
        position: absolute; left: 50%; translate: -50% 0; top: -3.6%;
        width: 78%; height: 10.5%;
        z-index: 6;
      }
      .lj-prop-lid > svg { height: 100%; filter: drop-shadow(0 6px 10px rgba(0,0,0,.55)); }
      .lj-prop-lid .lj-prop-tag { bottom: calc(100% + 4px); }
      .lj-neck {
        position: absolute; left: 50%; translate: -50% 0; top: 2.4%;
        width: 70%; height: 10.4%;
        border: 3px solid rgba(186,206,205,.58); border-bottom: 0;
        border-radius: 9px 9px 0 0;
        background: linear-gradient(112deg, rgba(226,236,233,.26), rgba(226,236,233,.07) 44%, rgba(226,236,233,.30));
        box-shadow: inset 0 -12px 20px rgba(0,0,0,.26);
        z-index: 3;
      }
      .lj-neck-thread {
        position: absolute; left: 5%; right: 5%; top: 26%; height: 2px; border-radius: 999px;
        background: rgba(226,236,233,.22);
      }
      .lj-neck-thread.second { top: 52%; }
      .lj-neck-lip {
        position: absolute; left: -4%; right: -4%; top: -3px; height: 7px; border-radius: 999px;
        background: linear-gradient(rgba(240,248,246,.5), rgba(150,175,172,.3));
      }

      .lj-glass {
        position: absolute; inset: 10.6% 0 0 0;
        border: 3px solid rgba(178,198,197,.55);
        border-radius: 14px 14px 46px 46px;
        overflow: hidden;
        box-shadow:
          inset 0 -24px 46px rgba(0,0,0,.34),
          inset 0 12px 26px rgba(255,255,255,.10),
          0 30px 54px rgba(0,0,0,.65);
      }
      .lj-glass-back {
        position: absolute; inset: 0;
        background: linear-gradient(112deg, rgba(214,232,229,.16), rgba(180,206,202,.04) 42%, rgba(214,232,229,.20));
      }
      .lj-glass-glow {
        position: absolute; inset: 0;
        background:
          radial-gradient(ellipse 70% 46% at 50% 100%, rgba(255,196,128,.40), transparent 72%),
          radial-gradient(ellipse 46% 30% at 50% 62%, rgba(255,168,120,.16), transparent 74%);
        transition: opacity .45s ease;
        animation: lj-jar-breathe 6s ease-in-out infinite;
      }
      @keyframes lj-jar-breathe { 0%, 100% { opacity: .86; } 50% { opacity: 1; } }
      .lights-off .lj-glass-glow { opacity: .2; animation: none; }

      .lj-glass-sheen {
        position: absolute; left: 6%; top: 4%; bottom: 14%; width: 9px; z-index: 22;
        border-radius: 999px;
        background: linear-gradient(rgba(255,255,255,.34), rgba(255,255,255,.06));
        pointer-events: none;
      }
      .lj-glass-sheen.second { left: auto; right: 9%; width: 4px; top: 10%; bottom: 26%; opacity: .5; }
      .lj-glass-curve {
        position: absolute; inset: 0; z-index: 21; pointer-events: none; border-radius: inherit;
        background: linear-gradient(100deg,
          rgba(255,255,255,.14) 0%, transparent 16%,
          transparent 78%, rgba(255,255,255,.10) 96%);
      }
      .lj-glass-floor {
        position: absolute; left: 6%; right: 6%; bottom: 3%; height: 20px; z-index: 20;
        border-radius: 50%; pointer-events: none;
        background: radial-gradient(ellipse at 50% 40%, rgba(226,240,236,.26), transparent 70%);
        box-shadow: inset 0 3px 8px rgba(255,255,255,.18);
      }

      .lj-innerwire { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 8; }
      .lj-inner-bulb {
        position: absolute; width: 7px; height: 8px; z-index: 9; pointer-events: none;
        border-radius: 50% 50% 55% 55% / 42% 42% 60% 60%;
        background: radial-gradient(circle at 36% 30%, #fff, #FFD08A 60%, rgba(180,120,40,.6));
        box-shadow: 0 0 14px 5px rgba(255,201,130,.5);
        animation: lj-twinkle 3.2s ease-in-out infinite;
      }

      /* The pile is never squeezed to fit. When there are more letters than the
         glass can show at once it simply grows out through the top, and the
         field slides down so the reader can dig up to them. The --pile variable
         is a percentage of the field's own height, which is also what the slot
         positions are measured in, so the two stay in step. */
      .lj-field {
        position: absolute; inset: 0; z-index: 10;
        transform: translate3d(0, var(--pile, 0%), 0);
        transition: transform .42s cubic-bezier(.22,.61,.36,1);
        /* Without this, a touch drag on this element is up for grabs between
           the browser's own page-scroll gesture and our pointermove handler -
           on a real phone the browser usually wins, so digging through the
           pile silently does nothing. Mouse/pointer dragging never needed it,
           which is why this only showed up on a touchscreen. */
        touch-action: none;
      }
      .lj-field.is-dragging { transition: none; }
      @media (prefers-reduced-motion: reduce) { .lj-field { transition: none; } }

      /* ------------------------------------------------ one rolled letter -- */
      .lj-scroll {
        position: absolute; padding: 0; background: none; border: 0; cursor: pointer;
        translate: -50% -50%;
        transform: rotate(var(--rot));
        transition: transform .22s cubic-bezier(.34,1.56,.64,1), opacity .3s ease;
        min-width: 30px;
      }
      .lj-scroll-svg { display: block; width: 100%; height: 100%; }
      .lj-scroll:hover, .lj-scroll:focus-visible {
        transform: rotate(var(--rot)) scale(1.2) translateY(-4px);
        outline: none;
      }
      .lj-scroll.is-out { opacity: 0; pointer-events: none; }
      .lj-scroll.is-sealed .lj-scroll-svg { filter: drop-shadow(0 0 7px rgba(255,201,130,.42)); }
      .lj-scroll.is-keepsake .lj-scroll-svg { filter: drop-shadow(0 0 8px rgba(226,182,96,.55)); }
      /* The newest thing they wrote that you have not read. Everything else in
         the jar is a pile; this one is an event. */
      .lj-scroll.is-newest .lj-scroll-svg {
        filter: drop-shadow(0 0 10px rgba(255,201,130,.85));
        animation: lj-newest 2.4s ease-in-out infinite;
      }
      @keyframes lj-newest {
        0%, 100% { opacity: 1; transform: none; }
        50% { opacity: .92; transform: translateY(-2px); }
      }
      .lj-scroll-new {
        position: absolute; left: 50%; bottom: calc(100% + 6px); translate: -50% 0;
        z-index: 6; pointer-events: none; white-space: nowrap;
        font-size: 8px; font-weight: 900; letter-spacing: .18em; line-height: 1;
        padding: 3px 6px; rotate: -6deg;
        color: #2C1A06; background: linear-gradient(#FFD98A, #E0A63F);
        border: 1.5px solid #2A1B20;
        box-shadow: 2px 2px 0 rgba(9,6,8,.7);
      }
      @media (prefers-reduced-motion: reduce) {
        .lj-scroll.is-newest .lj-scroll-svg { animation: none; }
      }

      .lj-scroll-lock {
        position: absolute; right: -7px; top: -8px; z-index: 4;
        display: grid; place-items: center;
        width: 16px; height: 16px; border-radius: 999px;
        background: #EAD9A9; color: #7D2834; border: 1.5px solid #45140E;
      }

      /* ------------------------------------- the pile carries on past here -- */
      .lj-more {
        position: absolute; left: 0; right: 0; height: 42px; z-index: 22;
        pointer-events: none;
      }
      .lj-more.top {
        top: 0;
        background: linear-gradient(rgba(10,6,8,.72), transparent);
      }
      .lj-more.bottom {
        bottom: 0;
        background: linear-gradient(transparent, rgba(10,6,8,.62));
      }

      /* ------------------------------------------------ digging control ---- */
      .lj-dig {
        position: absolute; right: -30px; top: 18%; bottom: 20%; z-index: 30;
        display: flex; flex-direction: column; align-items: center; gap: 6px;
      }
      .lj-dig-btn {
        display: grid; place-items: center; flex: 0 0 auto;
        width: 22px; height: 22px; cursor: pointer;
        color: #F2DDC2; background: linear-gradient(#4A1119, #2A0A0F);
        border: 2px solid #12080B; border-radius: 4px;
        box-shadow: 2px 2px 0 rgba(9,6,8,.8);
        transition: transform .13s ease, background .18s ease;
      }
      .lj-dig-btn:hover:not(:disabled) { transform: translateY(-1px); background: linear-gradient(#6E1A26, #3A0D14); }
      .lj-dig-btn:active:not(:disabled) { transform: translate(1px, 1px); box-shadow: none; }
      .lj-dig-btn:disabled { opacity: .3; cursor: default; }
      .lj-dig-btn:focus-visible { outline: 2px solid #EAD9A9; outline-offset: 2px; }

      .lj-dig-rail {
        position: relative; flex: 1 1 auto; width: 5px; border-radius: 999px;
        background: rgba(226,236,233,.14);
        box-shadow: inset 0 0 0 1px rgba(9,6,8,.5);
      }
      .lj-dig-thumb {
        position: absolute; left: 50%; translate: -50% -50%;
        width: 11px; height: 26px; border-radius: 999px;
        background: linear-gradient(#EAD9A9, #C9A972);
        border: 1.5px solid #2A1B20;
        transition: top .42s cubic-bezier(.22,.61,.36,1);
      }
      /* an unread letter sitting at that depth in the pile */
      .lj-dig-mark {
        position: absolute; left: 50%; translate: -50% -50%;
        width: 7px; height: 7px; border-radius: 999px;
        background: #FFC98A;
        box-shadow: 0 0 6px rgba(255,201,138,.9);
      }
      .lj-dig-hint {
        font-size: 7px; font-weight: 900; letter-spacing: .2em;
        color: rgba(224,177,174,.6);
      }
      @media (prefers-reduced-motion: reduce) { .lj-dig-thumb { transition: none; } }
      @media (max-width: 1119px) { .lj-dig { right: -26px; } }

      /* ---------------------------------------------------- hover preview -- */
      .lj-hovertag {
        position: absolute; translate: -50% calc(-100% - 24px);
        width: 198px; z-index: 90; pointer-events: none;
        background:
          radial-gradient(rgba(60,35,30,.06) .8px, transparent .8px) 0 0/7px 7px,
          linear-gradient(#F3E7CE, #E3D2AC);
        border: 2px solid #1C1317; border-radius: 4px 4px 6px 6px;
        box-shadow: 5px 7px 0 rgba(9,6,8,.7);
        padding: .8rem .6rem .5rem;
        animation: lj-tag-in .16s ease-out both;
      }
      .lj-hovertag::after {
        content: ""; position: absolute; left: 50%; bottom: -8px; translate: -50% 0;
        border: 7px solid transparent; border-top-color: #1C1317;
      }
      .lj-hovertag-string {
        position: absolute; left: 50%; translate: -50% 0; top: -18px;
        width: 1.5px; height: 18px; background: #B99B6E;
      }
      .lj-hovertag-hole {
        position: absolute; left: 50%; translate: -50% 0; top: 5px;
        width: 8px; height: 8px; border-radius: 999px;
        background: #241A20; box-shadow: inset 0 1px 2px rgba(0,0,0,.8);
      }
      /* Portalled straight into document.body (see JarHoverTag) so it always
         floats fully above the letter with no clipping ancestor in the way -
         left/top are real viewport pixels here, not a percentage of anything,
         so position:fixed with no translate-based anchor conversion needed
         beyond the same "float above by my own height" translate. */
      .lj-hovertag-fixed { position: fixed; z-index: 200; }
      @keyframes lj-tag-in {
        from { opacity: 0; transform: translateY(6px) scale(.95); }
        to { opacity: 1; transform: none; }
      }

      /* --------------------------------------------------------- the label - */
      .lj-label {
        position: absolute; left: 50%; translate: -50% 0; bottom: 5%;
        z-index: 24; pointer-events: none; rotate: -1.4deg;
      }
      .lj-label-sheet {
        display: block; text-align: center; padding: .5rem 1.1rem;
        color: #3A2716;
        background:
          radial-gradient(rgba(90,60,30,.07) .8px, transparent .8px) 0 0/7px 7px,
          linear-gradient(#F7F0DF, #E6D8BB);
        border-radius: 2px;
        box-shadow: 0 4px 10px rgba(0,0,0,.45), inset 0 0 20px rgba(150,110,60,.16);
        clip-path: polygon(
          0% 6%, 3% 0%, 22% 4%, 46% 0%, 71% 5%, 96% 1%, 100% 8%,
          99% 44%, 100% 92%, 95% 100%, 72% 96%, 48% 100%, 24% 95%, 4% 99%, 0% 90%
        );
      }
      .lj-label-rule {
        display: block; height: 1px; margin: 3px auto; width: 62%;
        background: rgba(80,50,20,.35);
      }

      /* ------------------------------------------------- the jar reacting -- */
      .fx-in .lj-glass-glow { animation: lj-flare 1.1s ease-out; }
      .fx-out .lj-glass-glow { animation: lj-dim 1.1s ease-out; }
      .fx-in { animation: lj-jar-bump 1.1s cubic-bezier(.34,1.56,.64,1); }
      .fx-out { animation: lj-jar-settle 1.1s ease-out; }
      .fx-shake { animation: lj-jar-shake .9s cubic-bezier(.36,.07,.19,.97); }
      .fx-in .lj-prop-lid { animation: lj-lid-bounce 1.1s cubic-bezier(.34,1.56,.64,1); }
      .fx-in .lj-twine, .fx-in .lj-hangtag { animation: lj-tag-swing 1.3s cubic-bezier(.34,1.56,.64,1); }
      .fx-shake .lj-field { animation: lj-field-jiggle .9s ease-in-out; }
      .fx-shake .lj-hangtag { animation: lj-tag-swing .9s ease-in-out; }

      @keyframes lj-flare { 0% { opacity: 1; } 20% { opacity: 1; transform: scale(1.1); } 100% { opacity: 1; transform: none; } }
      @keyframes lj-dim { 0% { opacity: 1; } 30% { opacity: .3; } 100% { opacity: 1; } }
      @keyframes lj-jar-bump {
        0% { transform: none; }
        26% { transform: translateY(5px) scale(1.05, .95); }
        52% { transform: translateY(-4px) scale(.97, 1.035); }
        78% { transform: scale(1.018, .988); }
        100% { transform: none; }
      }
      @keyframes lj-jar-settle {
        0% { transform: none; }
        30% { transform: translateY(-4px) scale(.982, 1.022); }
        62% { transform: translateY(3px) scale(1.014, .99); }
        100% { transform: none; }
      }
      @keyframes lj-jar-shake {
        0%, 100% { transform: rotate(0deg); }
        12% { transform: rotate(-5deg); }
        28% { transform: rotate(4.4deg); }
        44% { transform: rotate(-3.2deg); }
        60% { transform: rotate(2.6deg); }
        78% { transform: rotate(-1.3deg); }
      }
      @keyframes lj-lid-bounce {
        0% { transform: none; } 24% { transform: translateY(-14px) rotate(-4deg); }
        56% { transform: translateY(3px) rotate(1.6deg); } 100% { transform: none; }
      }
      @keyframes lj-tag-swing {
        0%, 100% { transform: rotate(0deg); }
        25% { transform: rotate(-11deg); }
        55% { transform: rotate(8deg); }
        80% { transform: rotate(-3deg); }
      }
      /* The pile offset has to be carried through every frame. Animating a bare
         transform here would drop the field back to the bottom of the pile for
         the length of the shake and snap it back afterwards. */
      @keyframes lj-field-jiggle {
        0%, 100% { transform: translate3d(0, var(--pile, 0%), 0); }
        20% { transform: translate3d(0, var(--pile, 0%), 0) translate(2px, -3px) rotate(.7deg); }
        45% { transform: translate3d(0, var(--pile, 0%), 0) translate(-3px, 1px) rotate(-.8deg); }
        70% { transform: translate3d(0, var(--pile, 0%), 0) translate(2px, -1px) rotate(.4deg); }
      }

      .lj-twine {
        position: absolute; left: 50%; translate: -50% 0; top: 6.4%;
        width: 84%; height: auto; z-index: 8; pointer-events: none;
        transform-origin: 50% 20%;
        filter: drop-shadow(0 3px 4px rgba(0,0,0,.5));
      }
      .lj-hangtag {
        position: absolute; left: 63%; top: 9.4%;
        width: 19%; height: auto; z-index: 9; pointer-events: none;
        transform-origin: 50% 0;
        filter: drop-shadow(0 4px 6px rgba(0,0,0,.55));
        animation: lj-tag-idle 8s ease-in-out infinite;
      }
      @keyframes lj-tag-idle { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(3deg); } }

      .lj-burst { position: absolute; left: 50%; top: 6%; z-index: 30; pointer-events: none; }
      .lj-spark {
        position: absolute; width: 8px; height: 8px; border-radius: 999px;
        background: #FFD9A0; box-shadow: 0 0 12px 4px rgba(255,201,130,.65);
        animation: lj-spark-out 1s cubic-bezier(.2,.9,.3,1) forwards;
      }
      @keyframes lj-spark-out {
        0% { transform: translate(0,0) scale(.4); opacity: 0; }
        18% { opacity: 1; }
        100% { transform: translate(var(--sx), var(--sy)) scale(.12); opacity: 0; }
      }
      .lj-shockwave {
        position: absolute; left: -70px; top: -70px; width: 140px; height: 140px;
        border-radius: 999px; border: 2px solid rgba(255,214,150,.6);
        animation: lj-shock 1s cubic-bezier(.2,.9,.3,1) forwards;
      }
      @keyframes lj-shock {
        0% { transform: scale(.2); opacity: .9; }
        100% { transform: scale(2.6); opacity: 0; }
      }

      .lj-empty {
        position: absolute; left: 50%; top: 48%; translate: -50% -50%;
        text-align: center; color: #E8D9C1; opacity: .82; width: 78%; z-index: 12;
      }

      /* ==================================================== the rail cards = */
      .lj-card {
        position: relative;
        background:
          radial-gradient(rgba(60,35,30,.06) .8px, transparent .8px) 0 0/8px 8px,
          linear-gradient(#F6EEDD, #E7DAC0);
        border: 3px solid #1C1317; border-radius: .55rem;
        box-shadow: 7px 9px 0 rgba(9,6,8,.72);
        padding: .9rem .9rem 1rem;
        color: #2A1B20;
      }
      .lj-card-find { rotate: -1.1deg; }
      .lj-card-count { rotate: .8deg; margin-left: 6%; width: 94%; }
      .lj-card-shelf { rotate: 1deg; }
      .lj-card-index { rotate: -.7deg; padding-top: 1.5rem; }
      .lj-card-title {
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        letter-spacing: .2em; text-transform: uppercase; color: #7D2834;
      }
      .lj-tape-strip {
        position: absolute; width: 72px; height: 22px; z-index: 4;
        background: repeating-linear-gradient(102deg, rgba(217,136,158,.85) 0 6px, rgba(198,116,140,.85) 6px 12px);
        box-shadow: 0 3px 8px rgba(0,0,0,.45);
      }
      .lj-tape-strip-a { top: -11px; left: 16px; rotate: -8deg; }
      .lj-tape-strip-b { top: -11px; right: 20px; rotate: 7deg; }
      .lj-pin {
        position: absolute; top: -9px; left: 50%; translate: -50% 0; z-index: 4;
        width: 16px; height: 16px; border-radius: 999px;
        background: radial-gradient(circle at 34% 30%, #FF8FA6, #8C1E32 70%);
        box-shadow: 0 3px 6px rgba(0,0,0,.6), inset 0 1px 2px rgba(255,255,255,.5);
      }

      /* The write button, built like a sealed envelope. The card itself does not
         clip: the flap is clipped by .lj-write-paper instead, which leaves the
         badge and the wax seal free to overhang the edges the way a real sticker
         and a real blob of wax would. */
      .lj-write-card {
        position: relative; overflow: visible; text-align: left; cursor: pointer;
        display: block; width: 100%;
        padding: 1.15rem 4.4rem 1.2rem 1rem;
        color: #FBF3E6;
        background: linear-gradient(158deg, #96182A 0%, #6A1120 55%, #45090F 100%);
        border: 3px solid #1C1317; border-radius: .55rem;
        box-shadow: 7px 9px 0 rgba(9,6,8,.8);
        rotate: -1.4deg;
        transition: transform .16s cubic-bezier(.34,1.56,.64,1), box-shadow .16s ease;
      }
      .lj-write-card:hover { transform: translateY(-4px); }
      .lj-write-card:focus-visible {
        outline: none; transform: translateY(-4px);
        box-shadow: 7px 9px 0 rgba(9,6,8,.8), 0 0 0 3px rgba(234,217,169,.85);
      }
      .lj-write-card:active { transform: translate(2px, 3px); box-shadow: 3px 4px 0 rgba(9,6,8,.8); }

      .lj-write-paper {
        position: absolute; inset: 0; z-index: 0;
        overflow: hidden; border-radius: .3rem; pointer-events: none;
      }
      /* the two back flaps, folded in from the sides */
      .lj-write-paper::before, .lj-write-paper::after {
        content: ""; position: absolute; inset: 0;
        background: linear-gradient(#7E1526, #4E0B14);
        opacity: .5;
      }
      .lj-write-paper::before { clip-path: polygon(0 0, 46% 50%, 0 100%); }
      .lj-write-paper::after { clip-path: polygon(100% 0, 54% 50%, 100% 100%); }
      /* the front flap, folded down from the top */
      .lj-write-flap {
        position: absolute; inset: 0 0 auto 0; height: 62%;
        background: linear-gradient(#BC2A3E, #85182A 70%, #6C1122);
        clip-path: polygon(0 0, 100% 0, 50% 100%);
        opacity: .92;
      }
      .lj-write-flap::after {
        content: ""; position: absolute; inset: 0;
        background: linear-gradient(#FFD8B8, transparent 4px);
        opacity: .16;
        clip-path: polygon(0 0, 100% 0, 50% 100%);
      }
      /* faint address rules, so the lower half reads as an envelope face */
      .lj-write-rules {
        position: absolute; left: 1rem; right: 4.4rem; bottom: .85rem; height: 26px;
        background: repeating-linear-gradient(
          180deg, rgba(255,240,222,.16) 0 1px, transparent 1px 9px
        );
        opacity: .5;
      }

      .lj-write-text { position: relative; z-index: 3; display: block; }

      .lj-write-seal {
        position: absolute; right: 10px; top: 50%; translate: 0 -50%; z-index: 4;
        display: grid; place-items: center; width: 44px; height: 44px;
        border-radius: 46% 54% 51% 49% / 52% 48% 55% 45%;
        background: radial-gradient(circle at 34% 30%, #E9BC6B, #8A5A18 72%);
        border: 2px solid rgba(28,2,4,.6); color: #2C1A06;
        box-shadow: 0 5px 12px rgba(0,0,0,.6), inset 0 2px 5px rgba(255,255,255,.4);
        transition: transform .18s cubic-bezier(.34,1.56,.64,1);
      }
      .lj-write-card:hover .lj-write-seal { transform: rotate(-9deg) scale(1.06); }

      .lj-write-thwip {
        position: absolute; top: -11px; right: -10px; z-index: 5; rotate: 12deg;
        font-family: 'Permanent Marker', cursive; font-size: 13px; line-height: 1.25;
        background: #EAD9A9; color: #7D2834; padding: 1px 8px;
        border: 2px solid #1C1317; box-shadow: 2px 2px 0 #0C0709;
        transition: transform .18s cubic-bezier(.34,1.56,.64,1);
      }
      .lj-write-card:hover .lj-write-thwip { transform: scale(1.1) rotate(-4deg); }

      /* the random draw, as a luggage tag on a string */
      .lj-draw-tag {
        position: relative; display: flex; align-items: center; gap: .55rem;
        width: 86%; margin-left: 10%; padding: .6rem .8rem .6rem 1.5rem;
        cursor: pointer; text-align: left; rotate: 1.6deg;
        color: #2A1B20;
        background: linear-gradient(#E4D3AE, #CFBB92);
        border: 2px solid #1C1317;
        border-radius: 4px 10px 10px 4px;
        box-shadow: 5px 6px 0 rgba(9,6,8,.66);
        clip-path: polygon(0 26%, 8% 0, 100% 0, 100% 100%, 8% 100%, 0 74%);
        transition: transform .14s ease;
      }
      .lj-draw-tag:hover { transform: translateY(-2px) rotate(-.6deg); }
      .lj-draw-tag:active { transform: translate(2px, 2px); }
      .lj-draw-hole {
        position: absolute; left: 9px; top: 50%; translate: 0 -50%;
        width: 9px; height: 9px; border-radius: 999px;
        background: #221A1E; box-shadow: inset 0 1px 2px rgba(0,0,0,.9);
      }

      .lj-input {
        width: 100%; background: #FDF8EE; color: #2A1B20;
        border: 2px solid #7D2834; border-radius: .3rem;
        padding: .45rem .6rem;
        font-family: 'Space Grotesk', monospace; font-size: 12px;
        outline: none;
      }
      .lj-input:focus { border-color: #450A10; box-shadow: 0 0 0 3px rgba(217,136,158,.35); }
      .lj-input::placeholder { color: rgba(42,27,32,.42); }

      /* This block is injected after the Tailwind sheet, so the .lj-input padding
         shorthand wins over a pl-8 utility and the icon lands on top of the
         text. The inset has to be declared here, next to the shorthand. */
      .lj-search { position: relative; }
      .lj-search .lj-input { padding-left: 2.1rem; padding-right: 1.9rem; }
      .lj-search-icon {
        position: absolute; left: .62rem; top: 50%; translate: 0 -50%;
        z-index: 2; pointer-events: none; color: #7D2834;
      }
      .lj-search-clear {
        position: absolute; right: .4rem; top: 50%; translate: 0 -50%;
        z-index: 2; display: grid; place-items: center;
        width: 18px; height: 18px; border-radius: 999px; cursor: pointer;
        color: #7D2834; background: rgba(125,40,52,.12); border: 0;
        transition: background .15s ease;
      }
      .lj-search-clear:hover { background: rgba(125,40,52,.26); }

      /* the shortcut scrap, torn off a notepad and pinned to the rail */
      .lj-keys {
        position: relative; margin-left: 4%; width: 92%; rotate: -.9deg;
        padding: .7rem .8rem .8rem;
        color: #2A1B20;
        background:
          repeating-linear-gradient(180deg, transparent 0 17px, rgba(125,40,52,.10) 17px 18px),
          linear-gradient(#F2E6CB, #E3D2AB);
        box-shadow: 5px 6px 0 rgba(9,6,8,.6);
        clip-path: polygon(
          0 0, 100% 0, 100% 96%, 92% 100%, 78% 96%, 62% 100%,
          46% 96%, 30% 100%, 15% 96%, 0 100%
        );
      }
      .lj-keys-list {
        list-style: none; margin: .45rem 0 0; padding: 0;
        display: flex; flex-direction: column; gap: .3rem;
      }
      .lj-keys-list li {
        display: flex; align-items: center; gap: .45rem;
        font-family: 'Caveat', cursive; font-size: 15px; line-height: 1.1;
        color: #4A2129;
      }
      .lj-kbd {
        flex: 0 0 auto; min-width: 26px; text-align: center;
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        padding: 2px 5px; border-radius: 3px;
        color: #F6E7D2; background: linear-gradient(#5A1520, #340A11);
        border: 1.5px solid #1C1317;
        box-shadow: 0 2px 0 rgba(9,6,8,.7);
      }

      .lj-filter-row { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .5rem; }
      .lj-filter {
        position: relative; padding: .3rem .5rem .3rem 1rem; cursor: pointer;
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        letter-spacing: .08em; text-transform: uppercase;
        color: #6A2029; background: linear-gradient(#EFE0BF, #DFCCA4);
        border: 1.5px solid #8A6640; border-radius: 2px 5px 5px 2px;
        clip-path: polygon(0 30%, 9% 0, 100% 0, 100% 100%, 9% 100%, 0 70%);
        transition: background .18s ease, color .18s ease, transform .12s ease;
      }
      .lj-filter:hover { transform: translateY(-1px); }
      .lj-filter.is-active { background: linear-gradient(#8E1B2A, #61101B); color: #FBF3E6; border-color: #3A0A10; }
      .lj-filter-hole {
        position: absolute; left: 5px; top: 50%; translate: 0 -50%;
        width: 5px; height: 5px; border-radius: 999px; background: rgba(30,20,24,.75);
      }

      .lj-count-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; margin-top: .6rem; }
      .lj-chip {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: .5rem .3rem; border-radius: .35rem;
        border: 2px solid #1C1317; box-shadow: 3px 3px 0 rgba(9,6,8,.45);
      }
      .lj-chip-cream { background: linear-gradient(#F7EFDC, #E4D5B4); color: #3A2716; }
      .lj-chip-wax { background: linear-gradient(#9C2032, #5F0F1B); color: #FBE9DF; }
      .lj-chip-sage { background: linear-gradient(#BCCDB4, #94A98C); color: #22301F; }
      .lj-chip-gold { background: linear-gradient(#E3C57E, #B08F3E); color: #3A2A08; }
      .lj-chip-ink { background: linear-gradient(#3C4A66, #232C44); color: #DDE5F2; }

      /* the keepsake shelf, with the letters standing up on a plank */
      .lj-shelf { position: relative; margin-top: .7rem; padding-bottom: 14px; }
      .lj-shelf-row { display: flex; align-items: flex-end; justify-content: center; gap: .35rem; height: 74px; }
      .lj-standing {
        width: 26px; height: 70px; padding: 0; border: 0; background: none; cursor: pointer;
        transition: transform .16s cubic-bezier(.34,1.56,.64,1);
      }
      .lj-standing:nth-child(2n) { transform: rotate(4deg); }
      .lj-standing:nth-child(3n) { transform: rotate(-5deg); }
      .lj-standing:hover { transform: translateY(-6px) rotate(0deg) scale(1.08); }
      .lj-standing-svg {
        display: block; width: 70px; height: 26px;
        transform: rotate(-90deg) translate(-22px, 22px);
        transform-origin: top left;
        filter: drop-shadow(0 3px 4px rgba(0,0,0,.5));
      }
      .lj-shelf-plank {
        position: absolute; left: -4%; right: -4%; bottom: 0; height: 12px; border-radius: 3px;
        background: linear-gradient(#7A5330, #4A2F19);
        box-shadow: 0 6px 12px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,214,164,.3);
      }

      .lj-spiral {
        position: absolute; left: 0; right: 0; top: -9px;
        display: flex; justify-content: space-around; padding: 0 12px; z-index: 5;
      }
      .lj-ring { width: 9px; height: 18px; }

      .lj-index-list {
        margin-top: .55rem; display: flex; flex-direction: column; gap: .35rem;
        max-height: 44vh; overflow-y: auto; padding-right: .3rem;
      }
      .lj-indexrow {
        display: flex; align-items: center; gap: .45rem; width: 100%;
        background: linear-gradient(#F3E9D5, #E5D7B9); color: #2A1B20;
        border: 2px solid #261D24; border-radius: .25rem;
        box-shadow: 3px 3px 0 rgba(9,6,8,.45);
        padding: .32rem .45rem; cursor: pointer;
        transition: transform .14s ease, background .2s ease;
      }
      .lj-indexrow:hover { background: linear-gradient(#FBF4E4, #EEE1C6); transform: translateX(3px); }
      .lj-indexrow:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 rgba(9,6,8,.45); }
      .lj-indexrow-knot { width: 5px; align-self: stretch; border-radius: 999px; background: var(--ribbon); flex: none; }
      .lj-indexrow-swatch {
        width: 13px; height: 17px; flex: none; border-radius: 1px;
        background: var(--swatch); border: 1px solid rgba(60,40,20,.4);
        box-shadow: 1px 1px 0 rgba(0,0,0,.25);
      }
      .lj-indexrow-dot {
        width: 7px; height: 7px; border-radius: 999px; flex: none;
        background: #7D2834; box-shadow: 0 0 7px 2px rgba(255,201,130,.5);
      }

      /* ======================================================== the reader = */
      .lj-reader {
        position: fixed; inset: 0; z-index: 120; display: grid; place-items: center;
        padding: 12px 12px 138px;
      }
      @media (min-width: 640px) { .lj-reader { padding-bottom: 118px; } }
      .lj-reader-scrim {
        position: absolute; inset: 0; width: 100%; height: 100%;
        background: rgba(10,6,8,.86); backdrop-filter: blur(5px);
        border: 0; cursor: pointer;
      }
      .lj-reader-rays {
        position: absolute; inset: 0; pointer-events: none;
        background:
          conic-gradient(from 200deg at 50% 50%,
            transparent 0deg, rgba(255,206,150,.10) 18deg, transparent 40deg,
            transparent 160deg, rgba(255,206,150,.08) 182deg, transparent 208deg,
            transparent 300deg, rgba(255,182,200,.07) 322deg, transparent 344deg);
        animation: lj-rays 26s linear infinite;
      }
      @keyframes lj-rays { to { transform: rotate(360deg); } }

      .lj-stage {
        position: relative; z-index: 2;
        width: min(580px, 90vw);
        transform-origin: 50% 50%;
        transition: transform .58s cubic-bezier(.2,.85,.3,1);
      }
      .lj-stage.phase-flying, .lj-stage.phase-returning {
        transform: translate(var(--fx), var(--fy)) scale(var(--fk)) rotate(-8deg);
      }
      .lj-stage.phase-unrolling, .lj-stage.phase-open, .lj-stage.phase-rolling { transform: none; }

      .lj-paper-clip {
        height: 100%; overflow: hidden;
        clip-path: inset(50% 0 50% 0 round 6px);
        transition: clip-path .6s cubic-bezier(.35,.9,.3,1);
      }
      .lj-stage.phase-open .lj-paper-clip { clip-path: inset(0 0 0 0 round 6px); }

      .lj-rollbar {
        position: absolute; left: -10px; right: -10px; height: 28px; z-index: 4;
        pointer-events: none;
        transition: transform .6s cubic-bezier(.35,.9,.3,1);
      }
      .lj-rollbar-face {
        position: absolute; inset: 0; border-radius: 999px;
        background: linear-gradient(180deg, #FBF2DE 0%, #EADCBB 30%, #C9AE7E 72%, #9C8253 100%);
        border: 1px solid #8A6E4E;
        box-shadow: 0 5px 14px rgba(0,0,0,.6), inset 0 -3px 6px rgba(0,0,0,.2);
      }
      .lj-rollbar-face::before {
        content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 16px;
        border-radius: 999px;
        background: repeating-radial-gradient(circle at 50% 50%, rgba(0,0,0,.16) 0 1px, transparent 1px 3px);
      }
      .lj-rollbar-face::after {
        content: ""; position: absolute; right: 0; top: 0; bottom: 0; width: 16px;
        border-radius: 999px;
        background: repeating-radial-gradient(circle at 50% 50%, rgba(0,0,0,.16) 0 1px, transparent 1px 3px);
      }
      .lj-rollbar-tie {
        position: absolute; left: 44%; top: -7px; bottom: -7px; width: 12%;
        background: var(--ribbon); border-radius: 3px; opacity: .95;
        box-shadow: inset 0 0 0 1px rgba(0,0,0,.25), 0 2px 5px rgba(0,0,0,.4);
      }
      .lj-rollbar.top { top: -14px; transform: translateY(calc(var(--stage-h) / 2 - 14px)); }
      .lj-rollbar.bottom { bottom: -14px; transform: translateY(calc(var(--stage-h) / -2 + 14px)); }
      .lj-stage.phase-open .lj-rollbar { transform: translateY(0); }

      /* ======================================================== the sheet == */
      /* The sheet is a fixed frame; only the well inside it scrolls, so the
         grain, patina, edge, tape and stamp stay put on a long letter instead
         of sliding away with the text. */
      .lj-paper {
        position: relative; height: 100%; overflow: hidden;
        border-radius: 5px;
        box-shadow: inset 0 0 70px rgba(120,80,40,.14);
      }
      .lj-paper-well {
        position: relative; z-index: 10;
        height: 100%; overflow-y: auto; overflow-x: hidden;
        display: flex; flex-direction: column;
        padding: 2.4rem 1.9rem 2rem;
      }
      .lj-paper-grain {
        position: absolute; inset: 0; z-index: 2; pointer-events: none;
        background-image: var(--lj-grain);
        opacity: .17; mix-blend-mode: multiply;
      }
      /* No crease lines. The earlier version drew a hard 1%-wide dark/light band
         down the sheet and another across it, which read as a printed cross
         sitting on top of the words rather than as a fold. This is now only a
         soft directional sheen, so the paper still catches the lamp without
         anything drawn across the text. */
      .lj-paper-fold {
        position: absolute; inset: 0; z-index: 3; pointer-events: none;
        background:
          linear-gradient(168deg, rgba(255,255,255,.10) 0%, transparent 34%),
          radial-gradient(ellipse 120% 80% at 50% -10%, rgba(255,244,214,.10), transparent 62%),
          radial-gradient(ellipse 90% 60% at 50% 112%, rgba(72,44,20,.10), transparent 60%);
      }
      .lj-paper-patina { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
      .patina-aged .lj-paper-patina {
        background:
          radial-gradient(circle 5px at 18% 22%, rgba(140,96,44,.28), transparent 70%),
          radial-gradient(circle 3px at 74% 36%, rgba(140,96,44,.24), transparent 70%),
          radial-gradient(circle 7px at 42% 78%, rgba(140,96,44,.20), transparent 72%),
          radial-gradient(circle 4px at 86% 66%, rgba(140,96,44,.22), transparent 70%),
          radial-gradient(circle 3px at 28% 58%, rgba(140,96,44,.20), transparent 70%),
          linear-gradient(160deg, rgba(150,104,50,.20), transparent 26%, transparent 74%, rgba(150,104,50,.24));
      }
      .patina-coffee .lj-paper-patina {
        background:
          radial-gradient(circle at 76% 20%, transparent 34px, rgba(118,68,24,.46) 35px, rgba(118,68,24,.46) 42px, transparent 43px),
          radial-gradient(circle at 22% 74%, transparent 22px, rgba(118,68,24,.40) 23px, rgba(118,68,24,.40) 28px, transparent 29px),
          radial-gradient(ellipse 60px 26px at 40% 12%, rgba(126,78,32,.14), transparent 70%),
          radial-gradient(ellipse 40px 20px at 88% 84%, rgba(126,78,32,.16), transparent 70%);
      }
      .patina-inked .lj-paper-patina {
        background:
          radial-gradient(circle 3.5px at 82% 18%, rgba(24,20,30,.62), transparent 72%),
          radial-gradient(circle 2px at 87% 24%, rgba(24,20,30,.55), transparent 72%),
          radial-gradient(circle 1.4px at 78% 27%, rgba(24,20,30,.5), transparent 72%),
          radial-gradient(circle 2.6px at 16% 84%, rgba(24,20,30,.5), transparent 72%),
          radial-gradient(circle 1.6px at 22% 88%, rgba(24,20,30,.45), transparent 72%);
      }

      /* The edge treatment is a ring drawn inside the sheet and pushed about by
         one shared turbulence filter, so the boundary is ragged instead of
         geometric. It is a static element, so the filter costs one rasterise. */
      /* The ring is a BORDER, not a masked padding box. The usual
         two-layer mask-composite recipe composites away to nothing in Chrome
         here, whereas a plain border is real paint the displacement filter can
         push around, which is what makes the edge ragged. */
      .lj-paper-edge {
        position: absolute; inset: 0; z-index: 6; pointer-events: none; border-radius: 5px;
      }
      .edge-clean .lj-paper-edge { box-shadow: inset 0 0 0 1.5px var(--sheet-edge); }
      .edge-deckle .lj-paper-edge {
        border: 10px solid rgba(255,255,255,.66);
        filter: url(#lj-rough);
        opacity: .62;
      }
      .edge-torn .lj-paper-edge {
        border: 13px solid var(--sheet-edge);
        filter: url(#lj-scorch);
        opacity: .6;
      }
      .edge-torn .lj-paper-edge::after {
        content: ""; position: absolute; inset: -5px;
        border: 7px solid rgba(255,255,255,.4); border-radius: 5px;
      }
      .edge-burnt .lj-paper-edge {
        border: 15px solid #241004;
        filter: url(#lj-scorch);
        opacity: .96;
      }
      /* the warm singe that always sits just inside the char line */
      .edge-burnt .lj-paper-edge::after {
        content: ""; position: absolute; inset: -6px;
        border: 11px solid rgba(158,76,22,.55); border-radius: 5px;
      }
      .lj-paper.edge-burnt {
        box-shadow: inset 0 0 64px 16px rgba(104,48,12,.5), inset 0 0 0 2px rgba(30,14,4,.55);
      }
      .lj-paper.edge-torn { box-shadow: inset 0 0 50px 8px rgba(120,84,40,.24); }

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
      .lj-tape-lace {
        background-color: rgba(250,244,235,.82);
        background-image:
          radial-gradient(circle 3px at 6px 0, transparent 96%, rgba(250,244,235,.82) 100%),
          radial-gradient(circle 3px at 6px 100%, transparent 96%, rgba(250,244,235,.82) 100%),
          radial-gradient(rgba(190,160,140,.5) 1.2px, transparent 1.3px);
        background-size: 12px 100%, 12px 100%, 7px 7px;
        box-shadow: 0 4px 10px rgba(0,0,0,.4);
      }
      .lj-tape-striped {
        background: repeating-linear-gradient(114deg, #E4D3AE 0 6px, #B44E64 6px 12px);
        border-left: 3px dashed rgba(255,255,255,.7); border-right: 3px dashed rgba(255,255,255,.7);
        box-shadow: 0 4px 10px rgba(0,0,0,.5);
      }
      .lj-tape-kraft {
        background:
          repeating-linear-gradient(0deg, rgba(120,86,44,.16) 0 1px, transparent 1px 4px),
          linear-gradient(#CDAF83, #B99765);
        border-left: 2px dashed rgba(255,255,255,.45); border-right: 2px dashed rgba(255,255,255,.45);
        box-shadow: 0 4px 10px rgba(0,0,0,.5);
      }

      .lj-has-stamp .lj-paper-head { padding-right: 76px; }
      .lj-paper-stamp {
        position: absolute; top: 20px; right: 16px; z-index: 15;
        width: 58px; height: auto; rotate: 5deg;
        filter: drop-shadow(1px 3px 3px rgba(0,0,0,.4));
      }

      .lj-paper-body { position: relative; z-index: 10; flex: 1; display: flex; flex-direction: column; min-height: 100%; }
      .lj-paper-sign { margin-top: auto; padding-top: 2rem; }
      .lj-rule { display: block; width: 100%; height: 8px; margin: 1rem 0 1.1rem; }

      .lj-occasion-tag {
        display: inline-block; position: relative;
        font-family: 'Caveat', cursive; font-size: 19px; line-height: 1;
        background: linear-gradient(#D2B183, #BE9A67); color: #4A2E1C;
        border: 1.5px solid #8A6E4E; border-radius: 3px;
        padding: .32rem .7rem .32rem 1.1rem; rotate: -1.5deg;
        box-shadow: 2px 3px 0 rgba(0,0,0,.28);
        clip-path: polygon(0 32%, 8% 0, 100% 0, 100% 100%, 8% 100%, 0 68%);
      }
      .lj-occasion-tag::before {
        content: ""; position: absolute; left: 5px; top: 50%; translate: 0 -50%;
        width: 5px; height: 5px; border-radius: 999px; background: rgba(40,26,14,.7);
      }

      .lj-paper-seal {
        position: relative; display: grid; place-items: center; flex: none;
        width: 58px; height: 58px;
        background: radial-gradient(circle at 34% 30%, color-mix(in srgb, var(--wax) 76%, #fff 24%), var(--wax) 46%, #2b0407 100%);
        box-shadow: 0 9px 18px rgba(0,0,0,.6), inset 0 2px 6px rgba(255,255,255,.34), inset 0 -4px 8px rgba(0,0,0,.5);
        rotate: -6deg;
      }
      .lj-paper-seal-face { color: rgba(255,255,255,.82); display: grid; place-items: center; }
      .wax-round { border-radius: 999px; }
      .wax-oval { border-radius: 999px; width: 68px; height: 52px; }
      .wax-blob { border-radius: 46% 54% 38% 62% / 54% 42% 58% 46%; }
      .wax-drip { border-radius: 50% 50% 44% 56% / 50% 50% 62% 38%; }
      .wax-drip::after {
        content: ""; position: absolute; left: 52%; bottom: -13px; translate: -50% 0;
        width: 12px; height: 20px; border-radius: 0 0 999px 999px;
        background: linear-gradient(var(--wax), #2b0407);
      }

      .lj-paper-sprig { position: absolute; left: 10px; bottom: 10px; width: 92px; height: 62px; z-index: 8; opacity: .85; }

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

      /* ------------------------------------------------------ the actions -- */
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
        to { opacity: 1; translate: -50% 0; }
      }
      .lj-receipt {
        display: inline-flex; align-items: center; gap: .35rem;
        font-family: 'Space Grotesk', monospace; font-size: 10px; letter-spacing: .1em;
        text-transform: uppercase; color: #E0B1AE;
        background: rgba(20,12,15,.72); border: 1px solid rgba(224,177,174,.3);
        padding: .25rem .6rem; border-radius: 999px;
      }
      .lj-action {
        display: inline-flex; align-items: center; gap: .35rem;
        font-family: 'Space Grotesk', monospace; font-size: 10px; font-weight: 900;
        letter-spacing: .12em; text-transform: uppercase;
        background: linear-gradient(#F0E4CC, #DECBAA); color: #2A1B20;
        border: 2px solid #261D24; box-shadow: 3px 3px 0 #0C0709;
        padding: .42rem .7rem; cursor: pointer; border-radius: .2rem;
        transition: transform .12s ease, background .2s ease;
      }
      .lj-action:hover { background: linear-gradient(#F9F1E0, #E9DABE); }
      .lj-action:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 #0C0709; }
      .lj-action:disabled { opacity: .55; cursor: not-allowed; }
      .lj-action.is-primary { background: linear-gradient(#8E1B2A, #61101B); color: #FBF3E6; }
      .lj-action.is-danger { background: linear-gradient(#5A1A12, #37100A); color: #F0C9C4; }
      .lj-action.is-on { background: linear-gradient(#F2DFA6, #DBBF74); }

      .lj-petals { position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; }
      .lj-petal {
        position: absolute; top: -40px; font-size: 20px;
        animation: lj-petal-fall 4.6s cubic-bezier(.35,.1,.6,1) forwards;
      }
      @keyframes lj-petal-fall {
        0% { transform: translateY(-40px) translateX(0) rotate(0deg); opacity: 0; }
        12% { opacity: .95; }
        100% { transform: translateY(105vh) translateX(var(--drift)) rotate(var(--spin)); opacity: 0; }
      }

      /* ================================================ confirm and toast == */
      .lj-confirm-wrap { position: fixed; inset: 0; z-index: 140; display: grid; place-items: center; }
      .lj-confirm {
        position: relative; z-index: 2; width: min(400px, 90vw);
        background:
          radial-gradient(rgba(60,35,30,.06) .8px, transparent .8px) 0 0/8px 8px,
          linear-gradient(#F6EEDD, #E7DAC0);
        border: 3px solid #1C1317; border-radius: .55rem;
        box-shadow: 10px 12px 0 rgba(9,6,8,.8);
        padding: 1.4rem 1.3rem 1.2rem; rotate: -.8deg;
      }
      .lj-toast {
        position: fixed; left: 50%; translate: -50% 0; bottom: 22px; z-index: 200;
        display: inline-flex; align-items: center; gap: .5rem; max-width: 90vw;
        background: linear-gradient(#F2DFA6, #DFC684); color: #2A1B20;
        border: 2px solid #261D24; box-shadow: 4px 4px 0 #0C0709;
        padding: .5rem .8rem; border-radius: .25rem;
        font-family: 'Space Grotesk', monospace; font-size: 11px; font-weight: 700;
        animation: lj-toast-in .24s cubic-bezier(.34,1.56,.64,1) both;
      }
      @keyframes lj-toast-in { from { opacity: 0; translate: -50% 14px; } to { opacity: 1; translate: -50% 0; } }

      /* ===================================================== the composer == */
      .lj-composer {
        position: fixed; inset: 0; z-index: 150; display: flex; flex-direction: column;
        background:
          radial-gradient(ellipse 80% 60% at 50% -6%, #40252C 0%, transparent 60%),
          linear-gradient(#1B1216, #0C0709);
      }
      .lj-composer-head {
        display: flex; flex-wrap: wrap; align-items: center; gap: .6rem;
        padding: .9rem 1rem; border-bottom: 2px solid rgba(224,177,174,.18);
      }
      .lj-save-btn {
        display: inline-flex; align-items: center; gap: .45rem;
        font-family: 'Space Grotesk', monospace; font-size: 11px; font-weight: 900;
        letter-spacing: .12em; text-transform: uppercase;
        background: linear-gradient(#8E1B2A, #61101B); color: #FBF3E6;
        border: 2px solid #FAF4EB; box-shadow: 4px 4px 0 #0C0709;
        padding: .5rem .85rem; cursor: pointer; border-radius: .2rem;
      }
      .lj-save-btn:active { transform: translate(2px,2px); box-shadow: 2px 2px 0 #0C0709; }
      .lj-save-btn:disabled { opacity: .6; cursor: not-allowed; }

      .lj-composer-body {
        flex: 1; min-height: 0; display: grid; gap: 1rem;
        grid-template-columns: 1fr; padding: 1rem; overflow-y: auto;
      }
      @media (min-width: 1024px) {
        .lj-composer-body { grid-template-columns: minmax(0,1fr) 392px; overflow: hidden; }
      }

      .lj-preview-stage { min-height: 0; display: flex; flex-direction: column; }
      .lj-preview-frame { position: relative; flex: 1; min-height: 0; display: flex; }
      .lj-preview {
        flex: 1; min-height: 300px;
        box-shadow: 14px 16px 0 rgba(9,6,8,.66), inset 0 0 70px rgba(120,80,40,.14);
        rotate: -.5deg;
      }
      .lj-preview .lj-paper-well { min-height: 300px; }
      .lj-roll-preview {
        position: absolute; right: 14px; bottom: 14px; z-index: 30;
        width: 172px; text-align: center; color: #6A5348; pointer-events: none;
      }
      .lj-roll-preview-svg {
        display: block; width: 172px; height: 50px;
        filter: drop-shadow(0 6px 10px rgba(0,0,0,.6));
      }

      .lj-sticker-tools {
        display: flex; flex-wrap: wrap; align-items: center; gap: .4rem;
        margin-top: .6rem; flex: none; color: #E0B1AE;
      }
      .lj-sticker-tools button {
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        letter-spacing: .1em; padding: .25rem .5rem; cursor: pointer;
        background: #E8D9C1; color: #2A1B20; border: 2px solid #261D24; border-radius: .2rem;
      }
      .lj-sticker-tools button.is-danger { background: #45140E; color: #F0C9C4; }

      .lj-rail-panel { display: flex; flex-direction: column; min-height: 0; }
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
      .lj-rail-body { flex: 1; min-height: 0; overflow-y: auto; padding-right: .4rem; }

      .lj-opt {
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        letter-spacing: .08em; padding: .45rem .3rem; cursor: pointer; text-align: center;
        background: linear-gradient(#EFE2C8, #DCC9A6); color: #2A1B20;
        border: 2px solid #261D24; border-radius: .2rem;
        transition: transform .12s ease;
      }
      .lj-opt:hover { transform: translateY(-2px); }
      .lj-opt.is-active { background: linear-gradient(#8E1B2A, #61101B); color: #FBF3E6; }
      .lj-opt-tall { padding: .5rem .4rem; line-height: 1.15; }

      .lj-paper-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .45rem; }
      .lj-paper-opt {
        position: relative; overflow: hidden;
        font-family: 'Space Grotesk', monospace; font-size: 8px; font-weight: 900;
        letter-spacing: .08em; padding: 1.5rem .2rem; cursor: pointer; text-align: center;
        border: 2px solid rgba(30,20,24,.55); border-radius: .2rem;
        box-shadow: 3px 3px 0 rgba(9,6,8,.55);
        transition: transform .14s ease;
      }
      .lj-paper-opt:hover { transform: translateY(-3px) rotate(-1.2deg); }
      .lj-paper-opt.is-active { outline: 3px solid #EAD9A9; outline-offset: 2px; }

      .lj-stamp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: .45rem; }
      .lj-stamp-opt {
        padding: .25rem; cursor: pointer; border-radius: .2rem;
        background: rgba(240,228,204,.10); border: 2px solid rgba(224,177,174,.28);
        transition: transform .14s ease;
      }
      .lj-stamp-opt:hover { transform: translateY(-3px); }
      .lj-stamp-opt.is-active { border-color: #EAD9A9; background: rgba(234,217,169,.22); }
      .lj-stamp-none {
        display: grid; place-items: center; height: 56px;
        font-family: 'Space Grotesk', monospace; font-size: 9px; font-weight: 900;
        color: #C9A9A2;
      }

      .lj-swatch {
        width: 30px; height: 30px; border-radius: 999px; cursor: pointer;
        border: 2px solid #261D24; box-shadow: 2px 2px 0 rgba(9,6,8,.6);
        transition: transform .14s cubic-bezier(.34,1.56,.64,1);
      }
      .lj-swatch:hover { transform: scale(1.16); }
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
      .lj-sticker-opt:hover { transform: scale(1.18) rotate(-7deg); }

      .lj-toggle {
        display: inline-flex; align-items: center; gap: .6rem; cursor: pointer;
        background: linear-gradient(#EFE2C8, #DCC9A6); color: #2A1B20;
        border: 2px solid #261D24; border-radius: 999px;
        padding: .32rem .8rem .32rem .32rem;
        box-shadow: 3px 3px 0 rgba(9,6,8,.6);
      }
      .lj-toggle-knob {
        width: 20px; height: 20px; border-radius: 999px; background: #7D2834;
        transition: background .2s ease, transform .2s ease;
      }
      .lj-toggle.is-on { background: linear-gradient(#F2DFA6, #DFC684); }
      .lj-toggle.is-on .lj-toggle-knob { background: #2F4536; transform: rotate(180deg) scale(1.05); }

      /* ========================================================= scrollbars */
      .lj-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(125,40,52,.55) transparent; }
      .lj-scrollbar::-webkit-scrollbar { width: 7px; }
      .lj-scrollbar::-webkit-scrollbar-thumb { background: rgba(125,40,52,.55); border-radius: 999px; }
      .lj-scrollbar::-webkit-scrollbar-track { background: transparent; }
      .lj-rail::-webkit-scrollbar, .lj-index-list::-webkit-scrollbar { width: 7px; }
      .lj-rail::-webkit-scrollbar-thumb, .lj-index-list::-webkit-scrollbar-thumb {
        background: rgba(125,40,52,.5); border-radius: 999px;
      }

      /* =================================================== reduced motion == */
      @media (prefers-reduced-motion: reduce) {
        .lj-stage, .lj-paper-clip, .lj-rollbar { transition: none !important; }
        .lj-stage.phase-flying, .lj-stage.phase-returning { transform: none !important; }
        .lj-paper-clip { clip-path: inset(0 0 0 0 round 6px) !important; }
        .lj-rollbar { transform: translateY(0) !important; }
        .lj-bulb, .lj-inner-bulb, .lj-spider-a, .lj-spider-b, .lj-petal,
        .lj-bokeh-dot, .lj-mote, .lj-flame, .lj-ghost, .lj-hangtag,
        .lj-swinger, .lj-glass-glow, .lj-reader-rays { animation: none !important; }
      }
    `}</style>
  );
}
