"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeft,
  Fingerprint,
  Image as ImageIcon,
  Link2,
  Plus,
  StickyNote,
  Trash2,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { compressImage, dataUrlBytes, formatBytes, readFileAsDataUrl } from "@/lib/media/mediaPrep";
import {
  DossierDefs,
  EvidencePin,
  HazardStripe,
  Notepad,
  RadarFace,
  RubberStamp,
  SafetyPin,
  SpiderMark,
  STAMPS,
  ThumbScanner,
  VectorFigure,
  FIGURE_VIEWBOX,
  hashString,
  resolveFigurePart,
  seeded,
  type StampId,
} from "./DossierArt";
import { createPortal } from "react-dom";
import * as sfx from "@/lib/dossierAudio";
import {
  INTERVIEW_VOLUMES,
  TOTAL_PROMPTS,
  volumeOfPrompt,
  type InterviewPrompt,
} from "@/lib/dossierInterview";

/* ============================================================================
   CH.11 — CLASSIFIED PERSONNEL DOSSIER: SUBJECT EARTH-65
   ----------------------------------------------------------------------------
   The last chapter, and the only one that is a file ON someone rather than a
   record of the two of you together. Dates, playlists and wishes already have
   their own chapters, so this one stays strictly on identity, psychology,
   quirks, and what to do when things go wrong.

   DATA RULE — this chapter is OWNER-ONLY, not couple-shared. Every read and
   write filters on `owner_id`, never `couple_id`, against `partner_vault`
   (section_type = 'dossier'), the same private table Ch.10 uses. Postgres RLS
   enforces owner_id = auth.uid() as well, but the rule is expressed here too.
   It works whether or not the reader is linked to anybody.

   STORAGE SHAPE — one row per PANEL, not per item: key_name is 'identity',
   'corkboard', 'quirks' and so on, with the panel's whole shape inside
   content_json. Fewer round trips than a row per sticky note, and the unique
   index on (owner_id, section_type, key_name) makes each panel a real upsert
   so a double-tap cannot fork it. Writes are debounced (see usePanel) because
   dragging a polaroid across the corkboard would otherwise be one write per
   pointermove - the single most expensive thing this chapter could do to a
   free-tier database.

   COST/ABUSE — no API route, no external service, no metered call anywhere in
   this chapter. Photos are downscaled in the browser before they are stored
   and every blob column it touches is bounded by a CHECK constraint
   (partner_vault_content_size_guardrail). Sound is synthesised, not fetched.

   Layer scale (the only z-indexes in this file):
      0  backdrop            40 modals / lightbox
     10  panels              50 web-shooter cursor
     30  chapter chrome      60 toasts
   ========================================================================== */

const SECTION_TYPE = "dossier";

/* --------------------------------------------------------------- types ---- */

/* A field is a label+value pair the reader can add, rename or delete -
   nothing about identity is a fixed set of keys anymore. `id` is stable
   across renames so a saved value never gets orphaned by a relabel. */
interface IdentityField {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
}

interface Identity {
  portrait: string | null;
  /* Pan/zoom applied to the portrait inside its fixed 3:4 frame - object-fit:
     cover alone always auto-centre-crops with no way to choose which part of
     the photo stays visible. Same idea as Timeline's photo_scale/x/y. */
  portraitScale: number;
  portraitX: number;
  portraitY: number;
  frontFields: IdentityField[];
  /* The classified backside. */
  backFields: IdentityField[];
}

/* Seeded defaults, not a schema - every id below is also an add/rename/
   delete-able row like any field a reader creates themselves. Ids match the
   old fixed keys on purpose: migrateIdentity() below uses them to carry a
   pre-existing saved dossier's values into the new shape untouched. */
const DEFAULT_FRONT_FIELDS: IdentityField[] = [
  { id: "legalName", label: "Legal name", value: "", placeholder: "The one on the paperwork" },
  { id: "codename", label: "Multiversal codename", value: "", placeholder: "Spider-Something" },
  { id: "bloodType", label: "Blood type", value: "", placeholder: "O+" },
  { id: "height", label: "Height", value: "", placeholder: "5'7\"" },
  { id: "coffeeRatio", label: "Coffee : milk", value: "", placeholder: "Exactly 1 : 3, no negotiation" },
  { id: "mbti", label: "MBTI", value: "", placeholder: "INFP" },
  { id: "sun", label: "Sun", value: "", placeholder: "Virgo" },
  { id: "moon", label: "Moon", value: "", placeholder: "Pisces" },
  { id: "rising", label: "Rising", value: "", placeholder: "Scorpio" },
  { id: "affiliation", label: "Current affiliation", value: "", placeholder: "Mine, mostly" },
];

const DEFAULT_BACK_FIELDS: IdentityField[] = [
  { id: "nicknames", label: "Secret nicknames", value: "", placeholder: "The ones nobody else is allowed to use" },
  {
    id: "insideJokes",
    label: "Inside jokes, in shorthand",
    value: "",
    placeholder: "Two words that would make no sense to anyone else",
  },
  {
    id: "emergencyContact",
    label: "Emergency contact frequency",
    value: "",
    placeholder: "Who to call, and what to say first",
  },
];

const EMPTY_IDENTITY: Identity = {
  portrait: null,
  portraitScale: 1,
  portraitX: 0,
  portraitY: 0,
  frontFields: DEFAULT_FRONT_FIELDS,
  backFields: DEFAULT_BACK_FIELDS,
};

/* A dossier saved before this rewrite has the old flat shape
   ({legalName: "...", codename: "...", ...}) instead of frontFields/
   backFields arrays - reading it with a plain fallback-merge would silently
   drop every value the reader already typed in. Detect the old shape and
   carry each value into the matching seeded field instead. */
function migrateIdentity(raw: unknown, fallback: Identity): Identity {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;

  const num = (v: unknown, fallbackNum: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallbackNum);

  if (Array.isArray(r.frontFields)) {
    return {
      portrait: typeof r.portrait === "string" ? r.portrait : null,
      portraitScale: num(r.portraitScale, 1),
      portraitX: num(r.portraitX, 0),
      portraitY: num(r.portraitY, 0),
      frontFields: r.frontFields as IdentityField[],
      backFields: Array.isArray(r.backFields) ? (r.backFields as IdentityField[]) : DEFAULT_BACK_FIELDS,
    };
  }

  const carryOver = (fields: IdentityField[]) =>
    fields.map((f) => ({ ...f, value: typeof r[f.id] === "string" ? (r[f.id] as string) : "" }));

  return {
    portrait: typeof r.portrait === "string" ? r.portrait : null,
    portraitScale: num(r.portraitScale, 1),
    portraitX: num(r.portraitX, 0),
    portraitY: num(r.portraitY, 0),
    frontFields: carryOver(DEFAULT_FRONT_FIELDS),
    backFields: carryOver(DEFAULT_BACK_FIELDS),
  };
}

interface Vibe {
  battery: number;
  tag: string;
  danger: boolean;
  chaos: boolean;
  updatedAt: string | null;
}

const EMPTY_VIBE: Vibe = {
  battery: 70,
  tag: "",
  danger: false,
  chaos: false,
  updatedAt: null,
};

/* Suggestions, not a fixed list - the field is free text underneath. */
const VIBE_TAGS = [
  "Overstimulated",
  "Craving fries",
  "Hyperfocusing",
  "Needs a hug",
  "Running on spite",
  "Quietly thriving",
  "Touch starved",
  "Plotting something",
];

type ArtifactKind = "polaroid" | "note" | "ticket" | "flower" | "memo";

interface Artifact {
  id: string;
  kind: ArtifactKind;
  url: string | null;
  title: string;
  note: string;
  /* Freeform categorisation - the 5 pin kinds stay closed (they're real
     drawn art), but tags let a pin carry any label the reader wants. */
  tags: string[];
  x: number;
  y: number;
  rot: number;
}

interface WebLink {
  id: string;
  a: string;
  b: string;
}

interface Corkboard {
  items: Artifact[];
  links: WebLink[];
}

const EMPTY_CORKBOARD: Corkboard = { items: [], links: [] };

interface Quirk {
  id: string;
  text: string;
  category: string;
  hue: number;
}

/* Suggestions, not a fixed list - same free-text-plus-datalist pattern as
   VIBE_TAGS, so a custom category is a first-class option, not a fallback. */
const QUIRK_CATEGORIES = ["Food law", "Morning ritual", "Tell", "Obsession", "Rule"];

interface Quirks {
  items: Quirk[];
}

const EMPTY_QUIRKS: Quirks = { items: [] };

interface StampMark {
  id: string;
  stamp: StampId;
  x: number;
  y: number;
  rot: number;
}

/* A step is a PROMPT plus the ANSWER to it, not one editable string. An
   earlier version seeded the prompts as the textarea's value, which meant the
   first thing anyone had to do was delete the question before they could
   answer it. */
interface ProtocolStep {
  prompt: string;
  answer: string;
}

interface Protocol {
  id: string;
  tab: string;
  title: string;
  steps: ProtocolStep[];
  stamps: StampMark[];
}

interface Protocols {
  items: Protocol[];
}

/* Three protocols exist by default because a blank "add your first crisis
   plan" screen is a terrible prompt - it is much easier to edit someone
   else's guess than to invent the categories yourself. */
const SEED_PROTOCOLS: Protocol[] = [
  {
    id: "hangry",
    tab: "HANGRY",
    title: "Protocol 1 — The Hangry Matrix",
    steps: [
      { prompt: "Safe foods that never miss", answer: "" },
      { prompt: "Do NOT bring up", answer: "" },
      { prompt: "Proximity warning — how close is too close", answer: "" },
    ],
    stamps: [],
  },
  {
    id: "deescalate",
    tab: "DE-ESC",
    title: "Protocol 2 — De-escalation",
    steps: [
      { prompt: "How they want conflict handled", answer: "" },
      { prompt: "How much space, and for how long", answer: "" },
      { prompt: "The thing that actually reassures them", answer: "" },
    ],
    stamps: [],
  },
  {
    id: "meltdown",
    tab: "MELTDOWN",
    title: "Protocol 3 — Meltdown / Sickness",
    steps: [
      { prompt: "Comfort show queue", answer: "" },
      { prompt: "Room temperature, lights, noise", answer: "" },
      { prompt: "Physical touch — yes, no, or ask first", answer: "" },
    ],
    stamps: [],
  },
];

const EMPTY_PROTOCOLS: Protocols = { items: SEED_PROTOCOLS };

const uid = (prefix: string) =>
  prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* Photos on the corkboard are downscaled hard: they are shown at roughly
   polaroid size and there can be dozens on one board, all sharing the panel's
   12MB content_json ceiling. */
const MAX_PICK_BYTES = 25 * 1024 * 1024;
const PANEL_SOFT_LIMIT = 9 * 1024 * 1024;

/* ============================================================================
   SECTIONS 6-10 — TYPES
   ========================================================================== */

interface Quote {
  id: string;
  text: string;
  source: string;
  date: string;
}

interface QuoteStripData {
  items: Quote[];
}

const EMPTY_QUOTE_STRIP: QuoteStripData = { items: [] };

interface TravelPin {
  id: string;
  place: string;
  date: string;
  note: string;
  photo: string | null;
  /* Percent coordinates within the radar's square wrapper, always clamped to
     land inside the dish - a stored position, not derived, since a
     press-and-hold on the dish drops the pin exactly where pressed. */
  x: number;
  y: number;
}

/* Half the dish's radius, in percent of the square wrap - a point further
   than this from centre would render outside the circular RadarFace, or a
   blip's label would clip past its rim. */
const RADAR_MAX_R = 42;

function clampToRadar(px: number, py: number) {
  const dx = px - 50;
  const dy = py - 50;
  const dist = Math.hypot(dx, dy);
  if (dist <= RADAR_MAX_R || dist === 0) return { x: px, y: py };
  const scale = RADAR_MAX_R / dist;
  return { x: 50 + dx * scale, y: 50 + dy * scale };
}

function randomRadarPoint(seedKey: string) {
  const seed = hashString(seedKey);
  const angle = seeded(seed, 1) * Math.PI * 2;
  const r = 10 + seeded(seed, 2) * (RADAR_MAX_R - 10);
  return { x: 50 + Math.cos(angle) * r, y: 50 + Math.sin(angle) * r };
}

interface Travelogue {
  items: TravelPin[];
}

const EMPTY_TRAVELOGUE: Travelogue = { items: [] };

interface SizingField {
  id: string;
  part: string;
  value: string;
  unit: string;
  /* Where this measurement is pinned on the figure, in VectorFigure's viewBox
     units (160x320). Absent means it has no pin yet - the four defaults below
     are named regions the figure already knows how to light up, so they only
     get coordinates if someone deliberately places them. */
  x?: number;
  y?: number;
}

/* Ids matching VectorFigure's `data-part` highlight names light the figure up
   when a field is focused - a custom field added later just won't match one,
   which is a harmless no-op, not an error. */
const DEFAULT_SIZING_FIELDS: SizingField[] = [
  { id: "jacket", part: "jacket", value: "", unit: "" },
  { id: "wrist", part: "wrist", value: "", unit: "" },
  { id: "ring", part: "ring", value: "", unit: "" },
  { id: "shoe", part: "shoe", value: "", unit: "" },
];

interface SizingBlueprintData {
  items: SizingField[];
}

const EMPTY_SIZING: SizingBlueprintData = { items: DEFAULT_SIZING_FIELDS };

type PeeveSeverity = "peeve" | "redflag" | "greenflag";

interface PeeveItem {
  id: string;
  text: string;
  severity: PeeveSeverity;
}

interface PeeveIndexData {
  items: PeeveItem[];
}

const EMPTY_PEEVE_INDEX: PeeveIndexData = { items: [] };

interface CapsuleEntry {
  id: string;
  message: string;
  photo: string | null;
  sealedUntil: string;
  opened: boolean;
}

interface TimeCapsuleData {
  items: CapsuleEntry[];
}

const EMPTY_TIME_CAPSULE: TimeCapsuleData = { items: [] };

/* ============================================================================
   SECTION 11 — THE FIELD INTERVIEW (types)

   The 269-prompt profile questionnaire, keyed by prompt id. Answers live in a
   flat map rather than per-volume rows so progress, search and the "ask me
   one" draw can all read the whole interview without six round trips.
   ========================================================================== */

/** A question the couple wrote themselves, living alongside the catalogue. */
interface CustomPrompt {
  id: string;
  /** Which volume it was filed under. */
  volume: string;
  q: string;
  long: boolean;
}

/** The running record of polygraph tests. Written once per completed test. */
interface PolygraphRecord {
  /** Tests taken all the way to a verdict. */
  tests: number;
  /** Best truth rating so far, 0-100. */
  best: number;
  /** The most recent rating, and when it was filed. */
  last: number | null;
  lastAt: string | null;
}

interface InterviewData {
  /** prompt id -> answer. Absent or "" both mean unanswered. */
  answers: Record<string, string>;
  /** Prompt ids the reader starred, surfaced in the highlights strip. */
  pinned: string[];
  /** Their own questions. Ids are prefixed so they cannot collide with the catalogue. */
  custom: CustomPrompt[];
  polygraph: PolygraphRecord;
}

const EMPTY_POLYGRAPH: PolygraphRecord = { tests: 0, best: 0, last: null, lastAt: null };

const EMPTY_INTERVIEW: InterviewData = {
  answers: {},
  pinned: [],
  custom: [],
  polygraph: EMPTY_POLYGRAPH,
};

/* Older saved panels predate `pinned`, `custom` and `polygraph`; spreading an
   undefined over the fallback would break every .includes()/.map() below.
   Panels saved with the short-lived per-volume `order` key still load - the
   key is simply not read any more, so their prompts come back in catalogue
   order. */
function migrateInterview(raw: unknown, fallback: InterviewData): InterviewData {
  const r = (raw ?? {}) as Partial<InterviewData>;
  const pg = (r.polygraph ?? {}) as Partial<PolygraphRecord>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    answers: r.answers && typeof r.answers === "object" ? r.answers : fallback.answers,
    pinned: Array.isArray(r.pinned) ? r.pinned : fallback.pinned,
    custom: Array.isArray(r.custom) ? r.custom : fallback.custom,
    polygraph: {
      tests: num(pg.tests, 0),
      best: num(pg.best, 0),
      last: typeof pg.last === "number" && Number.isFinite(pg.last) ? pg.last : null,
      lastAt: typeof pg.lastAt === "string" ? pg.lastAt : null,
    },
  };
}

/* ============================================================================
   FULL-SCREEN OVERLAYS
   ========================================================================== */

/**
 * Renders an overlay up at the chapter root instead of where it was written.
 *
 * `position: fixed` does NOT reach the viewport from inside a panel: every
 * `.dsr-panel` sets `backdrop-filter`, and a backdrop-filter makes an element
 * a containing block for its fixed-position descendants. An overlay written
 * inside a panel therefore anchors to that panel — measured at y = -6032 on a
 * long page, i.e. scrolled far off the top of the screen.
 *
 * The host is `.dsr-root` rather than `<body>` on purpose: it is not a
 * containing block (verified), and it carries the chapter's CSS custom
 * properties, which a portal to <body> would leave behind — the overlay would
 * lose its accent colour and every var()-driven style with it.
 */
function ChapterOverlay({ children }: { children: React.ReactNode }) {
  /* Lazy initialiser, not an effect: these overlays only ever mount in
     response to a user action, so the document and .dsr-root both exist by
     the time this first renders, and there is no SSR pass to mismatch. */
  const [host] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".dsr-root")
  );
  /* No host (SSR, or the chapter root somehow absent): fall back to rendering
     in place, which is the old behaviour rather than a blank screen. */
  if (!host) return <>{children}</>;
  return createPortal(children, host);
}

/* ============================================================================
   PANEL PERSISTENCE
   ========================================================================== */

type PanelState<T> = {
  value: T;
  /** Replace the panel. Persisted on a debounce. */
  update: (next: T | ((prev: T) => T)) => void;
  /** Persist immediately - for a change that must not be lost to a navigation. */
  flush: () => void;
  loading: boolean;
  error: string | null;
  saving: boolean;
};

/**
 * One row of `partner_vault` as a piece of React state.
 *
 * Writes are debounced hard on purpose. Dragging one polaroid across the
 * corkboard fires a pointermove per frame; without this, that is sixty writes
 * a second of a multi-megabyte jsonb blob to a free-tier Postgres. The local
 * state updates instantly either way, so nothing feels slower for it.
 */
function usePanel<T extends object>(
  userId: string,
  key: string,
  fallback: T,
  debounceMs = 900,
  /* Only needed when a panel's saved shape can predate a later schema change
     (see migrateIdentity) - everything else can leave this undefined and
     keep the plain fallback-merge below. */
  migrate?: (raw: unknown, fallback: T) => T
): PanelState<T> {
  const supabase = useMemo(() => createClient(), []);
  const [value, setValue] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<number | null>(null);
  const pending = useRef<T | null>(null);
  /* Nothing may be written before the first read comes back, or an empty
     fallback would overwrite a real panel on a slow connection. */
  const ready = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: readErr } = await supabase
        .from("partner_vault")
        .select("content_json")
        .eq("owner_id", userId)
        .eq("section_type", SECTION_TYPE)
        .eq("key_name", key)
        .maybeSingle();

      if (!alive) return;

      if (readErr) setError(readErr.message);
      else if (data?.content_json) {
        setValue(migrate ? migrate(data.content_json, fallback) : { ...fallback, ...(data.content_json as T) });
      }
      ready.current = true;
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
    /* `fallback` is a module-level constant at every call site; including it
       would re-run the read on every render for the object-literal cases. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, userId, key]);

  const write = useCallback(
    async (next: T) => {
      if (!ready.current) return;
      setSaving(true);

      const payload = JSON.stringify(next);
      if (payload.length > PANEL_SOFT_LIMIT) {
        setError(
          "This panel is holding more than " +
            formatBytes(PANEL_SOFT_LIMIT) +
            ". Remove a photo or two before adding more."
        );
        setSaving(false);
        return;
      }

      const { error: writeErr } = await supabase.from("partner_vault").upsert(
        {
          owner_id: userId,
          section_type: SECTION_TYPE,
          key_name: key,
          content_json: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,section_type,key_name" }
      );

      setSaving(false);
      setError(writeErr ? writeErr.message : null);
    },
    [supabase, userId, key]
  );

  const schedule = useCallback(
    (next: T) => {
      pending.current = next;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const queued = pending.current;
        pending.current = null;
        if (queued) void write(queued);
      }, debounceMs);
    },
    [write, debounceMs]
  );

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        schedule(resolved);
        return resolved;
      });
    },
    [schedule]
  );

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const queued = pending.current;
    pending.current = null;
    if (queued) void write(queued);
  }, [write]);

  /* A debounced write that has not fired yet must not be lost to a tab close
     or a chapter exit - that is the same class of bug the draft cache exists
     to prevent, one layer down. */
  useEffect(() => {
    const onHide = () => {
      if (pending.current) void write(pending.current);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [write]);

  return { value, update, flush, loading, error, saving };
}

/* ============================================================================
   1. HERO IDENTIFICATION CARD
   ========================================================================== */

type FieldListKey = "frontFields" | "backFields";

/**
 * One label + value row on the ID card.
 *
 * In re-file mode the WHOLE row is the drag handle, not a small grip: these
 * tiles are 140px wide and a 19px grip is a miserable target on a phone. The
 * inputs go inert for the same reason - a drag that starts on a text field
 * would drop a caret in the middle of somebody's name instead of picking the
 * card up. The nudge buttons stay, because a drag is unreachable by keyboard.
 */
const IdentityFieldRow = memo(function IdentityFieldRow({
  field,
  index,
  total,
  listKey,
  multiline,
  arranging,
  dragging,
  onValue,
  onLabel,
  onRemove,
  onFlush,
  onNudge,
  onDragStart,
}: {
  field: IdentityField;
  index: number;
  total: number;
  listKey: FieldListKey;
  multiline?: boolean;
  arranging: boolean;
  dragging: boolean;
  onValue: (id: string, value: string) => void;
  onLabel: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onFlush: () => void;
  onNudge: (listKey: FieldListKey, id: string, dir: -1 | 1) => void;
  onDragStart: (listKey: FieldListKey, id: string, e: ReactPointerEvent) => void;
}) {
  const name = field.label || "field";
  return (
    <div
      data-field={field.id}
      data-field-list={listKey}
      className={
        (multiline ? "dsr-field dsr-back-field" : "dsr-field") +
        (arranging ? " is-arranging" : "") +
        (dragging ? " is-dragging" : "")
      }
      onPointerDown={arranging ? (e) => onDragStart(listKey, field.id, e) : undefined}
    >
      {arranging && (
        <span className="dsr-field-ord" aria-hidden>
          {index + 1}
        </span>
      )}

      <div className="dsr-field-headrow">
        <input
          className="dsr-field-label-input"
          value={field.label}
          onChange={(e) => onLabel(field.id, e.target.value)}
          onBlur={onFlush}
          placeholder="Field name"
          maxLength={40}
          readOnly={arranging}
          tabIndex={arranging ? -1 : undefined}
        />
        {arranging ? (
          <span className="dsr-field-grip" aria-hidden>
            &#10303;
          </span>
        ) : (
          <button
            type="button"
            className="dsr-field-x"
            onClick={() => onRemove(field.id)}
            aria-label={"Remove " + name}
          >
            <X className="w-3 h-3" aria-hidden />
          </button>
        )}
      </div>

      {multiline ? (
        <textarea
          className="dsr-textarea"
          rows={2}
          value={field.value}
          onChange={(e) => onValue(field.id, e.target.value)}
          onBlur={onFlush}
          placeholder={field.placeholder ?? "Type it in"}
          readOnly={arranging}
          tabIndex={arranging ? -1 : undefined}
        />
      ) : (
        <input
          className="dsr-input"
          value={field.value}
          onChange={(e) => onValue(field.id, e.target.value)}
          onBlur={onFlush}
          placeholder={field.placeholder ?? "Type it in"}
          maxLength={200}
          readOnly={arranging}
          tabIndex={arranging ? -1 : undefined}
        />
      )}

      {arranging && (
        <div className="dsr-field-movers">
          {/* stopPropagation, or pressing a nudge button also starts a drag
              on the row underneath it. */}
          <button
            type="button"
            className="dsr-field-move"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onNudge(listKey, field.id, -1)}
            disabled={index === 0}
            aria-label={"Move " + name + " earlier"}
            title="Move earlier"
          >
            {multiline ? "↑" : "←"}
          </button>
          <button
            type="button"
            className="dsr-field-move"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onNudge(listKey, field.id, 1)}
            disabled={index === total - 1}
            aria-label={"Move " + name + " later"}
            title="Move later"
          >
            {multiline ? "↓" : "→"}
          </button>
        </div>
      )}
    </div>
  );
});

const HeroBadge = memo(function HeroBadge({
  identity,
  onChange,
  onFlush,
}: {
  identity: Identity;
  onChange: (next: Identity | ((p: Identity) => Identity)) => void;
  onFlush: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* object-fit: cover alone always auto-centre-crops the portrait with no
     say in which part of the photo actually stays visible - this is the pan
     (portraitX/Y, -100..100) + zoom (portraitScale) adjuster that lets the
     reader choose, same idea as Timeline's polaroid framing tool. Draft
     state so dragging the preview doesn't write on every pointermove. */
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [draftScale, setDraftScale] = useState(1);
  const [draftX, setDraftX] = useState(0);
  const [draftY, setDraftY] = useState(0);
  const [isDraggingPortrait, setIsDraggingPortrait] = useState(false);
  const portraitDragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  const openAdjust = () => {
    setDraftScale(identity.portraitScale);
    setDraftX(identity.portraitX);
    setDraftY(identity.portraitY);
    setAdjustOpen(true);
  };

  const saveAdjust = () => {
    onChange((prev) => ({ ...prev, portraitScale: draftScale, portraitX: draftX, portraitY: draftY }));
    onFlush();
    setAdjustOpen(false);
  };

  const portraitTransform = (scale: number, x: number, y: number) =>
    `translate(${x}%, ${y}%) scale(${scale})`;

  const handlePortraitPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDraggingPortrait(true);
    portraitDragRef.current = { x: e.clientX, y: e.clientY, startX: draftX, startY: draftY };
  };
  const handlePortraitPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingPortrait || !portraitDragRef.current) return;
    const dx = e.clientX - portraitDragRef.current.x;
    const dy = e.clientY - portraitDragRef.current.y;
    setDraftX(Math.max(-100, Math.min(100, portraitDragRef.current.startX + dx / 2)));
    setDraftY(Math.max(-100, Math.min(100, portraitDragRef.current.startY + dy / 2)));
  };
  const handlePortraitPointerUp = () => {
    setIsDraggingPortrait(false);
    portraitDragRef.current = null;
  };

  /* The scan is what flips the card - clicking straight to the back would
     throw away the one bit of theatre this panel has. */
  const runScan = () => {
    if (scanning) return;
    /* Re-filing is a per-face mode; carrying it across the flip would land
       you on the back of the card with its rows already loose. */
    setArranging(false);
    setScanning(true);
    sfx.scan();
    window.setTimeout(() => {
      sfx.cardFlip();
      setFlipped((f) => !f);
    }, 430);
    window.setTimeout(() => setScanning(false), 780);
  };

  const pickPortrait = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    if (!file.type.startsWith("image/")) {
      setPhotoError("That needs to be an image.");
      return;
    }
    if (file.size > MAX_PICK_BYTES) {
      setPhotoError("Pick something under " + formatBytes(MAX_PICK_BYTES) + ".");
      return;
    }
    setBusy(true);
    try {
      const prepared = await compressImage(file, { maxEdge: 900, targetBytes: 420_000 });
      onChange((prev) => ({ ...prev, portrait: prepared.dataUrl }));
      onFlush();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "That photo could not be filed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /* Shared add/rename/remove/edit ops for whichever field list (front or
     back) is being rendered - the two panels are identical apart from which
     key of Identity they touch. */
  const makeFieldOps = (listKey: "frontFields" | "backFields") => ({
    setValue: (id: string, value: string) =>
      onChange((prev) => ({
        ...prev,
        [listKey]: prev[listKey].map((f) => (f.id === id ? { ...f, value } : f)),
      })),
    rename: (id: string, label: string) =>
      onChange((prev) => ({
        ...prev,
        [listKey]: prev[listKey].map((f) => (f.id === id ? { ...f, label } : f)),
      })),
    add: () => {
      onChange((prev) => ({
        ...prev,
        [listKey]: [...prev[listKey], { id: uid("field"), label: "New field", value: "" }],
      }));
      onFlush();
    },
    remove: (id: string) => {
      onChange((prev) => ({ ...prev, [listKey]: prev[listKey].filter((f) => f.id !== id) }));
      onFlush();
      sfx.glitch();
    },
  });
  const frontOps = makeFieldOps("frontFields");
  const backOps = makeFieldOps("backFields");

  /* ------------------------------------------------------------ re-filing */

  /* One flag for both faces - only one of them is ever on screen - and the
     drag is keyed by the list it started in, so a pointer wandering onto the
     other face's rows can never splice a field across. */
  const [arranging, setArranging] = useState(false);
  const [dragField, setDragField] = useState<{ list: FieldListKey; id: string } | null>(null);
  const dragFieldRef = useRef<{ list: FieldListKey; id: string } | null>(null);

  const moveField = useCallback(
    (listKey: FieldListKey, id: string, toIndex: number) => {
      onChange((prev) => {
        const list = prev[listKey];
        const from = list.findIndex((f) => f.id === id);
        const to = Math.max(0, Math.min(list.length - 1, toIndex));
        if (from < 0 || from === to) return prev;
        const next = list.slice();
        next.splice(to, 0, next.splice(from, 1)[0]);
        return { ...prev, [listKey]: next };
      });
    },
    [onChange]
  );

  const nudgeField = useCallback(
    (listKey: FieldListKey, id: string, dir: -1 | 1) => {
      const from = identity[listKey].findIndex((f) => f.id === id);
      if (from < 0) return;
      sfx.dialClick();
      moveField(listKey, id, from + dir);
      onFlush();
    },
    [identity, moveField, onFlush]
  );

  const startFieldDrag = useCallback((listKey: FieldListKey, id: string, e: ReactPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragFieldRef.current = { list: listKey, id };
    setDragField({ list: listKey, id });
    sfx.dialClick();
  }, []);

  /* Pointer events cover mouse, touch and pen in one path, matching the rest
     of the app. The row sets touch-action:none in CSS or a drag on a phone
     scrolls the page instead of moving anything - the trap the letter jar
     pile hit. */
  useEffect(() => {
    if (!dragField) return;

    const onPointerMove = (e: PointerEvent) => {
      const held = dragFieldRef.current;
      if (!held) return;
      const row = (
        document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      )?.closest?.("[data-field]") as HTMLElement | null;
      const overId = row?.dataset.field;
      if (!overId || overId === held.id || row?.dataset.fieldList !== held.list) return;
      const to = identity[held.list].findIndex((f) => f.id === overId);
      if (to >= 0) moveField(held.list, held.id, to);
    };

    const onPointerUp = () => {
      dragFieldRef.current = null;
      setDragField(null);
      sfx.webSnap();
      onFlush();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dragField, identity, moveField, onFlush]);

  const toggleArranging = () => {
    sfx.dialClick();
    setArranging((a) => !a);
  };

  const arrangeBar = (
    <div className="dsr-fields-tools">
      <button
        type="button"
        className={"dsr-arrange-btn" + (arranging ? " is-on" : "")}
        aria-pressed={arranging}
        onClick={toggleArranging}
      >
        {arranging ? "✓ Done re-filing" : "⠿ Re-file"}
      </button>
      {arranging && (
        <span className="dsr-arrange-hint">Drag a field anywhere in the card</span>
      )}
    </div>
  );

  return (
    <section className="dsr-panel dsr-badge-panel" aria-labelledby="dsr-badge-head">
      <SafetyPin className="dsr-badge-pin" size={64} />
      <span className="dsr-washi dsr-washi-a" aria-hidden />
      <span className="dsr-washi dsr-washi-b" aria-hidden />

      <div className={"dsr-badge" + (flipped ? " is-flipped" : "")}>
        {/* ------------------------------------------------- front ------- */}
        <div className="dsr-badge-face dsr-badge-front">
          <header className="dsr-badge-head">
            <span className="dsr-badge-org">EARTH-616 FIELD REGISTRY</span>
            <h2 id="dsr-badge-head" className="dsr-badge-title">
              Personnel Dossier
            </h2>
            <span className="dsr-badge-sub">SUBJECT: EARTH-65</span>
          </header>

          <div className="dsr-badge-body">
            <div className="dsr-portrait-col">
              <button
                type="button"
                className="dsr-portrait"
                onClick={() => (identity.portrait ? openAdjust() : fileRef.current?.click())}
                aria-label={identity.portrait ? "Adjust the portrait" : "Add a portrait"}
                disabled={busy}
              >
                {identity.portrait ? (
                  <img
                    src={identity.portrait}
                    alt=""
                    className="dsr-portrait-img"
                    style={{
                      transform: portraitTransform(identity.portraitScale, identity.portraitX, identity.portraitY),
                    }}
                  />
                ) : (
                  <span className="dsr-portrait-empty">
                    <ImageIcon className="w-6 h-6" aria-hidden />
                    <span>{busy ? "Developing…" : "Add photo"}</span>
                  </span>
                )}
                <span className="dsr-portrait-scan" aria-hidden />
              </button>
              {identity.portrait && (
                <button type="button" className="dsr-portrait-replace" onClick={() => fileRef.current?.click()}>
                  Replace photo
                </button>
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => void pickPortrait(e.target.files?.[0])}
              />

              <button
                type="button"
                className={"dsr-scanner" + (scanning ? " is-scanning" : "")}
                onClick={runScan}
                aria-label="Run the biometric scan"
                aria-pressed={flipped}
              >
                <ThumbScanner active={scanning} size={54} />
                <span className="dsr-scanner-label">
                  {scanning ? "SCANNING" : flipped ? "FRONT" : "SCAN"}
                </span>
              </button>
            </div>

            <div className="dsr-fields-col">
              {arrangeBar}
              <div className={"dsr-fields" + (arranging ? " is-arranging" : "")}>
                {identity.frontFields.map((f, i) => (
                  <IdentityFieldRow
                    key={f.id}
                    field={f}
                    index={i}
                    total={identity.frontFields.length}
                    listKey="frontFields"
                    arranging={arranging}
                    dragging={dragField?.id === f.id}
                    onValue={frontOps.setValue}
                    onLabel={frontOps.rename}
                    onRemove={frontOps.remove}
                    onFlush={onFlush}
                    onNudge={nudgeField}
                    onDragStart={startFieldDrag}
                  />
                ))}
                {/* Adding a field mid-re-file would drop a new row into an
                    order you are in the middle of setting. */}
                {!arranging && (
                  <button type="button" className="dsr-field-add" onClick={frontOps.add}>
                    <Plus className="w-3.5 h-3.5" aria-hidden /> Add field
                  </button>
                )}
              </div>
            </div>
          </div>

          {photoError && <p className="dsr-error">{photoError}</p>}

          {scanning && <span className="dsr-scanline" aria-hidden />}
        </div>

        {/* ------------------------------------------------- back -------- */}
        <div className="dsr-badge-face dsr-badge-back">
          <header className="dsr-badge-head">
            <span className="dsr-badge-org dsr-badge-org-alt">CLASSIFIED BACKSIDE</span>
            <h3 className="dsr-badge-title">Not for the file room</h3>
          </header>

          <div className="dsr-fields-col">
            {arrangeBar}
            <div className={"dsr-back-fields" + (arranging ? " is-arranging" : "")}>
              {identity.backFields.map((f, i) => (
                <IdentityFieldRow
                  key={f.id}
                  field={f}
                  index={i}
                  total={identity.backFields.length}
                  listKey="backFields"
                  multiline
                  arranging={arranging}
                  dragging={dragField?.id === f.id}
                  onValue={backOps.setValue}
                  onLabel={backOps.rename}
                  onRemove={backOps.remove}
                  onFlush={onFlush}
                  onNudge={nudgeField}
                  onDragStart={startFieldDrag}
                />
              ))}
              {!arranging && (
                <button type="button" className="dsr-field-add" onClick={backOps.add}>
                  <Plus className="w-3.5 h-3.5" aria-hidden /> Add field
                </button>
              )}
            </div>
          </div>

          <button type="button" className="dsr-flip-back" onClick={runScan}>
            <Fingerprint className="w-3.5 h-3.5" aria-hidden />
            Scan back to the front
          </button>
        </div>
      </div>

      {adjustOpen && (
        <ChapterOverlay>
        <div className="dsr-lightbox" role="dialog" aria-modal="true" aria-label="Adjust the portrait">
          <div className="dsr-portrait-adjust-sheet">
            <h3 className="dsr-notes-sheet-head">Adjust the portrait</h3>
            <div
              className="dsr-portrait-adjust-frame"
              onPointerDown={handlePortraitPointerDown}
              onPointerMove={handlePortraitPointerMove}
              onPointerUp={handlePortraitPointerUp}
              onPointerCancel={handlePortraitPointerUp}
            >
              {identity.portrait && (
                <img
                  src={identity.portrait}
                  alt=""
                  className="dsr-portrait-adjust-img"
                  draggable={false}
                  style={{ transform: portraitTransform(draftScale, draftX, draftY) }}
                />
              )}
            </div>
            <p className="dsr-portrait-adjust-hint">Drag the photo to reposition it</p>

            <label className="dsr-portrait-adjust-zoom">
              <span>Zoom</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={draftScale}
                onChange={(e) => setDraftScale(parseFloat(e.target.value))}
              />
            </label>

            <div className="dsr-portrait-adjust-actions">
              <button
                type="button"
                className="dsr-tool-btn"
                onClick={() => {
                  setDraftScale(1);
                  setDraftX(0);
                  setDraftY(0);
                }}
              >
                Reset
              </button>
              <button type="button" className="dsr-tool-btn" onClick={() => setAdjustOpen(false)}>
                Cancel
              </button>
              <button type="button" className="dsr-tool-btn" data-on="true" onClick={saveAdjust}>
                Save
              </button>
            </div>
          </div>
        </div>
        </ChapterOverlay>
      )}
    </section>
  );
});

/* ============================================================================
   2. SPIDEY-SENSE LIVE VIBE RADAR
   ========================================================================== */

const VibeRadar = memo(function VibeRadar({
  vibe,
  onChange,
  onFlush,
  onChaos,
}: {
  vibe: Vibe;
  onChange: (next: Vibe | ((p: Vibe) => Vibe)) => void;
  onFlush: () => void;
  onChaos: () => void;
}) {
  const set = <K extends keyof Vibe>(key: K, v: Vibe[K]) =>
    onChange((prev) => ({ ...prev, [key]: v, updatedAt: new Date().toISOString() }));

  const reading =
    vibe.battery > 75
      ? "Wired and dangerous"
      : vibe.battery > 45
        ? "Holding steady"
        : vibe.battery > 18
          ? "Running low"
          : "Empty. Handle gently.";

  return (
    <section className="dsr-panel dsr-vibe" aria-labelledby="dsr-vibe-head">
      <div className="dsr-panel-head">
        <h2 id="dsr-vibe-head" className="dsr-panel-title">
          Spidey-Sense
        </h2>
        <span className="dsr-panel-kicker">LIVE VIBE READING</span>
      </div>

      <div className="dsr-gauge">
        <div className="dsr-gauge-dial" role="img" aria-label={"Social battery " + vibe.battery + "%"}>
          <svg viewBox="0 0 120 120" className="dsr-gauge-svg" aria-hidden>
            <circle cx="60" cy="60" r="52" className="dsr-gauge-track" />
            <circle
              cx="60"
              cy="60"
              r="52"
              className="dsr-gauge-fill"
              style={{
                /* 327 is the circumference of r=52, rounded down so the cap
                   never overshoots its own start at 100%. */
                strokeDasharray: 327,
                strokeDashoffset: 327 - (327 * vibe.battery) / 100,
              }}
            />
          </svg>
          <span className="dsr-gauge-num">{vibe.battery}</span>
          <span className="dsr-gauge-unit">%</span>
        </div>

        <div className="dsr-gauge-controls">
          <label className="dsr-field-label" htmlFor="dsr-battery">
            Social battery
          </label>
          <input
            id="dsr-battery"
            type="range"
            min={0}
            max={100}
            value={vibe.battery}
            className="dsr-slider"
            onChange={(e) => set("battery", Number(e.target.value))}
            onPointerUp={onFlush}
            onKeyUp={onFlush}
          />
          <p className="dsr-gauge-read">{reading}</p>

          <label className="dsr-field-label" htmlFor="dsr-tag">
            Right now they are
          </label>
          <input
            id="dsr-tag"
            className="dsr-input"
            value={vibe.tag}
            onChange={(e) => set("tag", e.target.value)}
            onBlur={onFlush}
            placeholder="Overstimulated, craving fries, plotting…"
            maxLength={60}
            list="dsr-vibe-tags"
          />
          <datalist id="dsr-vibe-tags">
            {VIBE_TAGS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          <div className="dsr-toggles">
            <button
              type="button"
              className="dsr-toggle"
              data-on={vibe.danger}
              onClick={() => {
                set("danger", !vibe.danger);
                onFlush();
              }}
              aria-pressed={vibe.danger}
            >
              <Zap className="w-3.5 h-3.5" aria-hidden />
              Danger level
            </button>

            <button
              type="button"
              className="dsr-toggle dsr-toggle-chaos"
              data-on={vibe.chaos}
              onClick={() => {
                const next = !vibe.chaos;
                set("chaos", next);
                onFlush();
                if (next) onChaos();
              }}
              aria-pressed={vibe.chaos}
            >
              CHAOS MODE
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});

/* ============================================================================
   3. DRAGGABLE WEB-STRING EVIDENCE CORKBOARD
   ========================================================================== */

const ARTIFACT_KINDS: { id: ArtifactKind; label: string; hint: string }[] = [
  { id: "polaroid", label: "Polaroid", hint: "A photo, pinned" },
  { id: "note", label: "Napkin note", hint: "Something handwritten, scanned or typed" },
  { id: "ticket", label: "Ticket stub", hint: "Proof you were both there" },
  { id: "flower", label: "Pressed flower", hint: "Kept from somewhere" },
  { id: "memo", label: "Voice memo", hint: "A recording" },
];

/**
 * The web strand between two pinned artifacts.
 *
 * The sag is not decoration - it carries the information. A strand between two
 * items that are close together has slack, so it hangs; pull them apart and
 * that slack is spent, the curve flattens and the line thins out as it goes
 * taut. `settle` is the spring left over from a drag that just ended, which
 * makes it bounce rather than stopping dead.
 */
function strandPath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  settle: number
): { d: string; width: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy) || 1;

  /* Slack runs out at SPAN; past that the strand is simply stretched. */
  const SPAN = 46;
  const slack = Math.max(0, SPAN - dist) / SPAN;
  const sag = slack * 9 + 2 + settle;

  /* The control point hangs perpendicular to the strand, biased downwards so
     gravity reads correctly at any angle. */
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const nx = -dy / dist;
  const ny = dx / dist;
  const down = ny < 0 ? -1 : 1;

  const cx = mx + nx * sag * down;
  const cy = my + ny * sag * down + sag * 0.55;

  return {
    d: `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`,
    width: Math.max(0.28, 1.15 - (dist / SPAN) * 0.6),
  };
}

function Corkboard({
  board,
  onChange,
  onFlush,
  onGlitch,
  flipped,
}: {
  board: Corkboard;
  onChange: (next: Corkboard | ((p: Corkboard) => Corkboard)) => void;
  onFlush: () => void;
  onGlitch: () => void;
  flipped: boolean;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<ArtifactKind>("polaroid");

  const [dragId, setDragId] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notesForId, setNotesForId] = useState<string | null>(null);
  /* The board's one micro-interaction: hovering a pin lights up every strand
     running to it (and dims the rest), so the web actually reads as a case
     map instead of decoration - the whole point of a detective corkboard. */
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});

  /* Spring left over from the last drag, per link. Lives in a ref and is
     rendered through a version counter, so sixty frames of settling never
     become sixty state commits carrying the whole board. */
  const settleRef = useRef<Record<string, { x: number; v: number }>>({});
  /* Only the resolved offsets reach React - a map of a few numbers, committed
     once per frame. The velocities never leave the ref, and the board itself
     is never part of this state, so a settling strand does not re-commit
     megabytes of base64 sixty times a second. */
  const [settleMap, setSettleMap] = useState<Record<string, number>>({});
  const settleRaf = useRef<number | null>(null);

  const runSettle = useCallback(() => {
    if (settleRaf.current !== null) return;
    const step = () => {
      const springs = settleRef.current;
      let alive = false;
      for (const id of Object.keys(springs)) {
        const s = springs[id];
        /* Critically-ish damped: pulls back to zero, overshoots once. */
        s.v += -s.x * 0.28;
        s.v *= 0.82;
        s.x += s.v;
        if (Math.abs(s.x) < 0.05 && Math.abs(s.v) < 0.05) delete springs[id];
        else alive = true;
      }
      const snapshot: Record<string, number> = {};
      for (const id of Object.keys(springs)) snapshot[id] = springs[id].x;
      setSettleMap(snapshot);

      settleRaf.current = alive ? requestAnimationFrame(step) : null;
    };
    settleRaf.current = requestAnimationFrame(step);
  }, []);

  useEffect(
    () => () => {
      if (settleRaf.current !== null) cancelAnimationFrame(settleRaf.current);
    },
    []
  );

  const byId = useMemo(() => {
    const map: Record<string, Artifact> = {};
    board.items.forEach((a) => (map[a.id] = a));
    return map;
  }, [board.items]);

  /* ------------------------------------------------------------ dragging -- */

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (linking) return;
    const box = boardRef.current?.getBoundingClientRect();
    if (!box) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    setDragId(id);

    const item = byId[id];
    const startX = e.clientX;
    const startY = e.clientY;
    const originX = item.x;
    const originY = item.y;

    const move = (ev: PointerEvent) => {
      /* Upside-down mode rotates the whole chapter 180 degrees, so the pointer
         and the layout disagree about which way is up. Negating the delta is
         what makes a dragged pin follow the cursor instead of fleeing it -
         this is the "inverted gravity" the flip promises. */
      const sign = flipped ? -1 : 1;
      const dx = ((ev.clientX - startX) / box.width) * 100 * sign;
      const dy = ((ev.clientY - startY) / box.height) * 100 * sign;

      onChange((prev) => ({
        ...prev,
        items: prev.items.map((a) =>
          a.id === id
            ? {
                ...a,
                x: Math.max(2, Math.min(94, originX + dx)),
                y: Math.max(2, Math.min(92, originY + dy)),
              }
            : a
        ),
      }));
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragId(null);

      /* Kick every strand touching this pin so it bounces to a stop. */
      board.links
        .filter((l) => l.a === id || l.b === id)
        .forEach((l) => {
          settleRef.current[l.id] = { x: 5.5, v: 0 };
        });
      runSettle();
      onFlush();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* --------------------------------------------------------- adding items -- */

  const addArtifact = (kind: ArtifactKind, url: string | null, title: string) => {
    const id = uid("art");
    const seed = hashString(id);
    onChange((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id,
          kind,
          url,
          title,
          note: "",
          tags: [],
          /* Dropped into the middle third rather than a corner, so a new pin
             is never hidden behind the toolbar or off the short edge. */
          x: 26 + seeded(seed, 1) * 44,
          y: 20 + seeded(seed, 2) * 46,
          rot: (seeded(seed, 3) - 0.5) * 14,
        },
      ],
    }));
    onFlush();
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_PICK_BYTES) {
      setError("Under " + formatBytes(MAX_PICK_BYTES) + ", please.");
      return;
    }
    setBusy(true);
    try {
      const kind = pendingKind.current;
      if (kind === "memo") {
        if (!file.type.startsWith("audio/")) {
          setError("A voice memo needs to be an audio file.");
          return;
        }
        const dataUrl = await readFileAsDataUrl(file);
        if (dataUrlBytes(dataUrl) > 4 * 1024 * 1024) {
          setError("Keep voice memos short - under about 4MB.");
          return;
        }
        addArtifact("memo", dataUrl, file.name);
      } else {
        if (!file.type.startsWith("image/")) {
          setError("That needs to be an image.");
          return;
        }
        const prepared = await compressImage(file, { maxEdge: 1100, targetBytes: 340_000 });
        addArtifact(kind, prepared.dataUrl, file.name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be pinned up.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeArtifact = (id: string) => {
    onGlitch();
    onChange((prev) => ({
      items: prev.items.filter((a) => a.id !== id),
      /* A strand with nothing on one end is not a strand. */
      links: prev.links.filter((l) => l.a !== id && l.b !== id),
    }));
    onFlush();
    if (lightboxId === id) setLightboxId(null);
  };

  const setNote = (id: string, note: string) => {
    onChange((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === id ? { ...it, note } : it)),
    }));
  };

  const addTag = (id: string) => {
    const draft = (tagDrafts[id] ?? "").trim();
    if (!draft) return;
    onChange((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.id === id && !(it.tags ?? []).includes(draft)
          ? { ...it, tags: [...(it.tags ?? []), draft] }
          : it
      ),
    }));
    onFlush();
    setTagDrafts((prev) => ({ ...prev, [id]: "" }));
  };

  const removeTag = (id: string, tag: string) => {
    onChange((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.id === id ? { ...it, tags: (it.tags ?? []).filter((t) => t !== tag) } : it
      ),
    }));
    onFlush();
  };

  /* ---------------------------------------------------------- web strands -- */

  const tapArtifact = (id: string) => {
    if (!linking) return;
    if (linkFrom === null) {
      setLinkFrom(id);
      sfx.dialClick();
      return;
    }
    if (linkFrom === id) {
      setLinkFrom(null);
      return;
    }

    const exists = board.links.some(
      (l) => (l.a === linkFrom && l.b === id) || (l.a === id && l.b === linkFrom)
    );
    if (!exists) {
      const linkId = uid("web");
      onChange((prev) => ({ ...prev, links: [...prev.links, { id: linkId, a: linkFrom, b: id }] }));
      settleRef.current[linkId] = { x: 7, v: 0 };
      runSettle();
      sfx.thwip();
      onFlush();
    }
    setLinkFrom(null);
  };

  const cutStrand = (id: string) => {
    sfx.webSnap();
    onChange((prev) => ({ ...prev, links: prev.links.filter((l) => l.id !== id) }));
    onFlush();
  };

  const lightboxItem = lightboxId ? byId[lightboxId] : null;
  const notesItem = notesForId ? byId[notesForId] : null;

  return (
    <section className="dsr-panel dsr-cork-panel" aria-labelledby="dsr-cork-head">
      <div className="dsr-panel-head">
        <h2 id="dsr-cork-head" className="dsr-panel-title">
          Evidence Board
        </h2>
        <span className="dsr-panel-kicker">DRAG ANYTHING • LINK ANYTHING</span>
      </div>

      <div className="dsr-cork-tools">
        <button
          type="button"
          className="dsr-tool-btn"
          data-on={adding}
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
        >
          <Plus className="w-3.5 h-3.5" aria-hidden />
          Pin something up
        </button>

        <button
          type="button"
          className="dsr-tool-btn dsr-tool-web"
          data-on={linking}
          onClick={() => {
            setLinking((v) => !v);
            setLinkFrom(null);
          }}
          aria-pressed={linking}
        >
          <Link2 className="w-3.5 h-3.5" aria-hidden />
          {linking ? (linkFrom ? "Now tap the other one" : "Tap two to connect") : "Web-line"}
        </button>

        <span className="dsr-cork-count">
          {board.items.length} pinned &middot; {board.links.length}{" "}
          {board.links.length === 1 ? "strand" : "strands"}
        </span>
      </div>

      {adding && (
        <div className="dsr-kind-row">
          {ARTIFACT_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              className="dsr-kind"
              title={k.hint}
              disabled={busy}
              onClick={() => {
                if (k.id === "ticket" || k.id === "flower") {
                  /* These two are drawn, not photographed - they exist to be
                     labelled, so there is nothing to upload. */
                  addArtifact(k.id, null, k.label);
                  sfx.dialClick();
                  return;
                }
                pendingKind.current = k.id;
                fileRef.current?.setAttribute(
                  "accept",
                  k.id === "memo" ? "audio/*" : "image/*"
                );
                fileRef.current?.click();
              }}
            >
              {k.label}
            </button>
          ))}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
        </div>
      )}

      {(error || busy) && (
        <p className={error ? "dsr-error" : "dsr-note"}>{error ?? "Preparing…"}</p>
      )}

      <div ref={boardRef} className="dsr-cork" data-linking={linking}>
        {/* Strands are drawn under the artifacts so a pin always sits on top of
            its own web, the way it would on a real board. */}
        <svg className="dsr-web" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {board.links.map((l) => {
            const a = byId[l.a];
            const b = byId[l.b];
            if (!a || !b) return null;
            const settle = settleMap[l.id] ?? 0;
            const { d, width } = strandPath(a.x, a.y, b.x, b.y, settle);
            const touches = hoveredId !== null && (l.a === hoveredId || l.b === hoveredId);
            return (
              <path
                key={l.id}
                d={d}
                className={
                  "dsr-strand" +
                  (touches ? " is-lit" : hoveredId !== null ? " is-dimmed" : "")
                }
                strokeWidth={touches ? width * 1.6 : width}
                /* Percentage space is distorted by preserveAspectRatio=none;
                   this keeps the stroke an even weight anyway. */
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {/* Cutting a strand needs a real hit target, and an SVG hairline is not
            one. These sit on top as wide invisible buttons. */}
        {board.links.map((l) => {
          const a = byId[l.a];
          const b = byId[l.b];
          if (!a || !b) return null;
          return (
            <button
              key={"cut-" + l.id}
              type="button"
              className="dsr-strand-cut"
              style={{ left: `${(a.x + b.x) / 2}%`, top: `${(a.y + b.y) / 2}%` }}
              onClick={() => cutStrand(l.id)}
              aria-label="Cut this web strand"
              title="Cut this strand"
            >
              <X className="w-3 h-3" aria-hidden />
            </button>
          );
        })}

        {board.items.map((a) => (
          <div
            key={a.id}
            className={
              "dsr-artifact dsr-artifact-" +
              a.kind +
              (dragId === a.id ? " is-dragging" : "") +
              (linkFrom === a.id ? " is-linking" : "") +
              (hoveredId === a.id ? " is-hovered" : "")
            }
            style={
              {
                left: `${a.x}%`,
                top: `${a.y}%`,
                "--rot": `${a.rot}deg`,
              } as CSSProperties
            }
            onPointerDown={(e) => startDrag(e, a.id)}
            onPointerEnter={() => setHoveredId(a.id)}
            onPointerLeave={() => setHoveredId((cur) => (cur === a.id ? null : cur))}
            onClick={() => tapArtifact(a.id)}
            onDoubleClick={() => {
              if (a.kind === "polaroid" && a.url) {
                sfx.shutter();
                setLightboxId(a.id);
              }
            }}
          >
            <EvidencePin
              color={a.kind === "polaroid" ? "#D7263D" : "#2C7FB8"}
              size={20}
            />

            {a.url && a.kind === "memo" ? (
              <audio className="dsr-memo-player" src={a.url} controls preload="none" />
            ) : a.url ? (
              <img src={a.url} alt={a.title} className="dsr-artifact-img" draggable={false} />
            ) : (
              <span className={"dsr-artifact-drawn dsr-drawn-" + a.kind} aria-hidden />
            )}

            <input
              className="dsr-artifact-cap"
              value={a.title}
              placeholder="Label it"
              maxLength={60}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) =>
                onChange((prev) => ({
                  ...prev,
                  items: prev.items.map((it) =>
                    it.id === a.id ? { ...it, title: e.target.value } : it
                  ),
                }))
              }
              onBlur={onFlush}
            />

            {(a.tags ?? []).length > 0 && (
              <div className="dsr-artifact-tags" onPointerDown={(e) => e.stopPropagation()}>
                {(a.tags ?? []).map((t) => (
                  <span key={t} className="dsr-artifact-tag">
                    {t}
                    <button
                      type="button"
                      onClick={() => removeTag(a.id, t)}
                      aria-label={"Remove tag " + t}
                    >
                      <X className="w-2.5 h-2.5" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <button
              type="button"
              className={"dsr-artifact-notes-btn" + (notesForId === a.id ? " is-open" : "")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setNotesForId((cur) => (cur === a.id ? null : a.id))}
              aria-label={notesForId === a.id ? "Close notes" : "Add notes and tags"}
              aria-expanded={notesForId === a.id}
            >
              <StickyNote className="w-3 h-3" aria-hidden />
            </button>

            <button
              type="button"
              className="dsr-artifact-x"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => removeArtifact(a.id)}
              aria-label={"Take " + (a.title || "this") + " off the board"}
            >
              <Trash2 className="w-3 h-3" aria-hidden />
            </button>

          </div>
        ))}

        {board.items.length === 0 && (
          <p className="dsr-cork-empty">
            Nothing pinned yet. Photos, notes, stubs, a pressed flower — put one up and start
            drawing lines between them.
          </p>
        )}
      </div>

      {/* --------------------------------------------- slide projector ---- */}
      {lightboxItem?.url && (
        <ChapterOverlay>
        <div
          className="dsr-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightboxItem.title}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              sfx.shutter();
              setLightboxId(null);
            }
          }}
        >
          <div className="dsr-slide">
            <div className="dsr-slide-frame">
              <img src={lightboxItem.url} alt={lightboxItem.title} className="dsr-slide-img" />
            </div>
            <p className="dsr-slide-cap">{lightboxItem.title}</p>
            <button
              type="button"
              className="dsr-slide-close"
              onClick={() => {
                sfx.shutter();
                setLightboxId(null);
              }}
            >
              <X className="w-4 h-4" aria-hidden />
              <span className="sr-only">Close</span>
            </button>
          </div>
        </div>
        </ChapterOverlay>
      )}

      {/* --------------------------------------------- evidence notes ----
          Used to expand INSIDE the pinned artifact card itself (max 152px
          wide, and the corkboard clips overflow so its drag bounds/edges
          stay contained) - on a card pinned anywhere near an edge, an
          expanded note routinely got clipped by that overflow:hidden, or
          just didn't have room to lay out inside a card that narrow on a
          phone. Same fixed-overlay pattern as the slide projector above:
          rendered outside the clipped corkboard entirely, sized off the
          viewport instead of the pin. */}
      {notesItem && (
        <ChapterOverlay>
        <div
          className="dsr-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={"Notes for " + (notesItem.title || "this pin")}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNotesForId(null);
          }}
        >
          <div className="dsr-notes-sheet">
            <div className="dsr-notes-sheet-head">
              <StickyNote className="w-4 h-4" aria-hidden />
              <span>{notesItem.title || "Untitled pin"}</span>
            </div>
            <textarea
              className="dsr-artifact-notes-text"
              value={notesItem.note}
              onChange={(e) => setNote(notesItem.id, e.target.value)}
              onBlur={onFlush}
              placeholder="Everything else about this one..."
              rows={5}
              autoFocus
            />
            <div className="dsr-artifact-tag-row">
              <input
                className="dsr-artifact-tag-input"
                value={tagDrafts[notesItem.id] ?? ""}
                onChange={(e) => setTagDrafts((prev) => ({ ...prev, [notesItem.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(notesItem.id);
                  }
                }}
                placeholder="Add a tag, press Enter"
                maxLength={24}
              />
              <button type="button" className="dsr-artifact-tag-add" onClick={() => addTag(notesItem.id)}>
                <Plus className="w-3 h-3" aria-hidden />
              </button>
            </div>
            {(notesItem.tags ?? []).length > 0 && (
              <div className="dsr-artifact-tags">
                {(notesItem.tags ?? []).map((t) => (
                  <span key={t} className="dsr-artifact-tag">
                    {t}
                    <button type="button" onClick={() => removeTag(notesItem.id, t)} aria-label={"Remove tag " + t}>
                      <X className="w-2.5 h-2.5" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              className="dsr-slide-close"
              onClick={() => setNotesForId(null)}
              aria-label="Close notes"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>
        </div>
        </ChapterOverlay>
      )}
    </section>
  );
}

/* ============================================================================
   4. THE QUIRK & HABIT MATRIX
   ========================================================================== */

function QuirkMatrix({
  quirks,
  onChange,
  onFlush,
  onGlitch,
}: {
  quirks: Quirks;
  onChange: (next: Quirks | ((p: Quirks) => Quirks)) => void;
  onFlush: () => void;
  onGlitch: () => void;
}) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState(QUIRK_CATEGORIES[0]);
  const [tearing, setTearing] = useState(false);

  const add = () => {
    const body = text.trim();
    if (!body) return;

    /* The tear animation runs before the note exists, so the sheet is visibly
       coming off the pad rather than appearing already attached to the board. */
    setTearing(true);
    sfx.paperTear();

    window.setTimeout(() => {
      const id = uid("quirk");
      onChange((prev) => ({
        items: [
          ...prev.items,
          { id, text: body, category, hue: Math.floor(seeded(hashString(id), 4) * 4) },
        ],
      }));
      onFlush();
      setText("");
      setTearing(false);
    }, 420);
  };

  const remove = (id: string) => {
    onGlitch();
    onChange((prev) => ({ items: prev.items.filter((q) => q.id !== id) }));
    onFlush();
  };

  return (
    <section className="dsr-panel dsr-quirks" aria-labelledby="dsr-quirk-head">
      <div className="dsr-panel-head">
        <h2 id="dsr-quirk-head" className="dsr-panel-title">
          Quirks &amp; Habits
        </h2>
        <span className="dsr-panel-kicker">THE RULES NOBODY WROTE DOWN</span>
      </div>

      <div className="dsr-pad-row">
        <div className={"dsr-pad" + (tearing ? " is-tearing" : "")}>
          <Notepad className="dsr-pad-art" />
          <span className="dsr-pad-sheet" aria-hidden />
        </div>

        <div className="dsr-pad-form">
          <label className="dsr-field-label" htmlFor="dsr-quirk-text">
            Tear off a new one
          </label>
          <textarea
            id="dsr-quirk-text"
            className="dsr-textarea"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Refuses warm drinks. Picks every bell pepper out."
            maxLength={180}
          />
          <div className="dsr-pad-actions">
            <input
              className="dsr-input dsr-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="What kind of quirk"
              placeholder="Category"
              maxLength={30}
              list="dsr-quirk-categories"
            />
            <datalist id="dsr-quirk-categories">
              {QUIRK_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <button
              type="button"
              className="dsr-tool-btn"
              onClick={add}
              disabled={!text.trim() || tearing}
            >
              {tearing ? "Tearing…" : "Tear it off"}
            </button>
          </div>
        </div>
      </div>

      <ul className="dsr-notes">
        {quirks.items.map((q) => (
          <li key={q.id} className="dsr-note-sheet" data-hue={q.hue}>
            <span className="dsr-note-cat">{q.category}</span>
            <p className="dsr-note-text">{q.text}</p>
            <span className="dsr-note-curl" aria-hidden />
            <button
              type="button"
              className="dsr-note-x"
              onClick={() => remove(q.id)}
              aria-label={"Screw up and bin: " + q.text.slice(0, 40)}
            >
              <X className="w-3 h-3" aria-hidden />
            </button>
          </li>
        ))}

        {quirks.items.length === 0 && (
          <li className="dsr-note-empty">
            Nothing here yet. Start with the pettiest one you can think of — those are always the
            most accurate.
          </li>
        )}
      </ul>
    </section>
  );
}

/* ============================================================================
   5. EMERGENCY CARE MANUAL & CRISIS PROTOCOLS
   ========================================================================== */

function ProtocolFolder({
  protocols,
  onChange,
  onFlush,
}: {
  protocols: Protocols;
  onChange: (next: Protocols | ((p: Protocols) => Protocols)) => void;
  onFlush: () => void;
}) {
  const [activeId, setActiveId] = useState(protocols.items[0]?.id ?? "");
  const [heldStamp, setHeldStamp] = useState<StampId | null>(null);
  const [splatter, setSplatter] = useState<{ x: number; y: number; key: number } | null>(null);
  /* A protocol holds several steps and stamps - deleting one is heavier than
     deleting a step, so it arms on the first tap and only fires on a second
     tap within 3s, rather than either an instant delete or a blocking modal
     (nothing else in this chapter uses a modal confirm). */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const active =
    protocols.items.find((p) => p.id === activeId) ?? protocols.items[0] ?? null;

  const setStep = (protoId: string, index: number, patch: Partial<ProtocolStep>) =>
    onChange((prev) => ({
      items: prev.items.map((p) =>
        p.id === protoId
          ? { ...p, steps: p.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }
          : p
      ),
    }));

  const addStep = (protoId: string) => {
    onChange((prev) => ({
      items: prev.items.map((p) =>
        p.id === protoId ? { ...p, steps: [...p.steps, { prompt: "", answer: "" }] } : p
      ),
    }));
    onFlush();
  };

  const removeStep = (protoId: string, index: number) => {
    onChange((prev) => ({
      items: prev.items.map((p) =>
        p.id === protoId ? { ...p, steps: p.steps.filter((_, i) => i !== index) } : p
      ),
    }));
    onFlush();
  };

  const addProtocol = () => {
    const id = uid("protocol");
    const fresh: Protocol = {
      id,
      tab: "NEW",
      title: "New protocol",
      steps: [{ prompt: "", answer: "" }],
      stamps: [],
    };
    onChange((prev) => ({ items: [...prev.items, fresh] }));
    onFlush();
    setActiveId(id);
    sfx.dialClick();
  };

  const removeProtocol = (id: string) => {
    sfx.glitch();
    const next = protocols.items.filter((p) => p.id !== id);
    onChange({ items: next });
    onFlush();
    setActiveId(next[0]?.id ?? "");
  };

  const renameProtocol = (protoId: string, patch: Partial<Pick<Protocol, "tab" | "title">>) =>
    onChange((prev) => ({
      items: prev.items.map((p) => (p.id === protoId ? { ...p, ...patch } : p)),
    }));

  const removeStamp = (protoId: string, stampId: string) => {
    onChange((prev) => ({
      items: prev.items.map((p) =>
        p.id === protoId ? { ...p, stamps: p.stamps.filter((s) => s.id !== stampId) } : p
      ),
    }));
    onFlush();
  };

  const dropStamp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!heldStamp || !active) return;
    const box = sheetRef.current?.getBoundingClientRect();
    if (!box) return;

    const x = ((e.clientX - box.left) / box.width) * 100;
    const y = ((e.clientY - box.top) / box.height) * 100;

    sfx.stamp();
    setSplatter({ x, y, key: Date.now() });
    window.setTimeout(() => setSplatter(null), 700);

    onChange((prev) => ({
      items: prev.items.map((p) =>
        p.id === active.id
          ? {
              ...p,
              stamps: [
                ...p.stamps,
                { id: uid("stamp"), stamp: heldStamp, x, y, rot: (Math.random() - 0.5) * 22 },
              ],
            }
          : p
      ),
    }));
    onFlush();
    setHeldStamp(null);
  };

  return (
    <section className="dsr-panel dsr-protocols" aria-labelledby="dsr-proto-head">
      <div className="dsr-panel-head">
        <h2 id="dsr-proto-head" className="dsr-panel-title">
          In Case of Emergency
        </h2>
        <span className="dsr-panel-kicker">PROTOCOLS • KEEP IN THE FOLDER</span>
      </div>

      <div className="dsr-folder">
        <div className="dsr-tabs" role="tablist" aria-label="Protocols">
          {protocols.items.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === active?.id}
              className="dsr-tab"
              data-on={p.id === active?.id}
              onClick={() => {
                setActiveId(p.id);
                sfx.dialClick();
              }}
            >
              {p.tab || "UNTITLED"}
            </button>
          ))}
          <button
            type="button"
            className="dsr-tab dsr-tab-add"
            onClick={addProtocol}
            aria-label="Add a new protocol"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>

        {!active ? (
          <div className="dsr-sheet dsr-sheet-empty">
            <p>No protocols yet. Add one for whatever situation needs a plan.</p>
            <button type="button" className="dsr-tool-btn" onClick={addProtocol}>
              <Plus className="w-3.5 h-3.5" aria-hidden />
              New protocol
            </button>
          </div>
        ) : (
        <div
          ref={sheetRef}
          className={"dsr-sheet" + (heldStamp ? " is-stamping" : "")}
          onClick={dropStamp}
          role="tabpanel"
        >
          <div className="dsr-sheet-headrow" onClick={(e) => e.stopPropagation()}>
            <div className="dsr-sheet-heading">
              <input
                className="dsr-tab-label-input"
                value={active.tab}
                onChange={(e) => renameProtocol(active.id, { tab: e.target.value.toUpperCase().slice(0, 12) })}
                onBlur={onFlush}
                placeholder="TAB"
                maxLength={12}
                aria-label="Tab label"
              />
              <input
                className="dsr-sheet-title-input"
                value={active.title}
                onChange={(e) => renameProtocol(active.id, { title: e.target.value })}
                onBlur={onFlush}
                placeholder="Protocol title"
                maxLength={80}
                aria-label="Protocol title"
              />
            </div>
            <button
              type="button"
              className={"dsr-tool-btn dsr-proto-delete" + (confirmDeleteId === active.id ? " is-armed" : "")}
              onClick={() => {
                if (confirmDeleteId === active.id) {
                  removeProtocol(active.id);
                  setConfirmDeleteId(null);
                } else {
                  setConfirmDeleteId(active.id);
                  window.setTimeout(
                    () => setConfirmDeleteId((cur) => (cur === active.id ? null : cur)),
                    3000
                  );
                }
              }}
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden />
              {confirmDeleteId === active.id ? "Sure? Tap again" : "Delete"}
            </button>
          </div>

          <ol className="dsr-steps">
            {active.steps.map((s, i) => (
              <li key={i} className="dsr-step">
                <input
                  className="dsr-step-prompt"
                  value={s.prompt}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setStep(active.id, i, { prompt: e.target.value })}
                  onBlur={onFlush}
                  placeholder="What is the question?"
                  maxLength={90}
                  aria-label={"Step " + (i + 1) + " prompt"}
                />
                <textarea
                  className="dsr-step-input"
                  rows={2}
                  value={s.answer}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setStep(active.id, i, { answer: e.target.value })}
                  onBlur={onFlush}
                  placeholder="Write exactly what to do."
                  aria-label={s.prompt || "Step " + (i + 1)}
                />
                <button
                  type="button"
                  className="dsr-step-x"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeStep(active.id, i);
                  }}
                  aria-label={"Remove step " + (i + 1)}
                >
                  <X className="w-3 h-3" aria-hidden />
                </button>
              </li>
            ))}
          </ol>

          <button
            type="button"
            className="dsr-tool-btn dsr-step-add"
            onClick={(e) => {
              e.stopPropagation();
              addStep(active.id);
            }}
          >
            <Plus className="w-3.5 h-3.5" aria-hidden />
            Another step
          </button>

          {active.stamps.map((s) => {
            const def = STAMPS.find((d) => d.id === s.stamp);
            if (!def) return null;
            return (
              <span
                key={s.id}
                className="dsr-stamp-mark"
                style={{ left: `${s.x}%`, top: `${s.y}%` }}
              >
                <RubberStamp label={def.label} color={def.color} rotate={s.rot} scale={0.62} />
                <button
                  type="button"
                  className="dsr-stamp-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeStamp(active.id, s.id);
                  }}
                  aria-label={"Remove " + def.label + " stamp"}
                >
                  <X className="w-2.5 h-2.5" aria-hidden />
                </button>
              </span>
            );
          })}

          {splatter && (
            <span
              key={splatter.key}
              className="dsr-splatter"
              style={{ left: `${splatter.x}%`, top: `${splatter.y}%` }}
              aria-hidden
            >
              {Array.from({ length: 9 }).map((_, i) => (
                <span
                  key={i}
                  className="dsr-splat-dot"
                  style={
                    {
                      "--sx": `${Math.cos((i / 9) * Math.PI * 2) * (14 + (i % 4) * 9)}px`,
                      "--sy": `${Math.sin((i / 9) * Math.PI * 2) * (14 + (i % 3) * 11)}px`,
                    } as CSSProperties
                  }
                />
              ))}
            </span>
          )}
        </div>
        )}
      </div>

      <div className="dsr-stamp-tray">
        <span className="dsr-field-label">Stamp tray</span>
        <div className="dsr-stamp-row">
          {STAMPS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="dsr-stamp-pick"
              data-on={heldStamp === s.id}
              onClick={() => setHeldStamp((h) => (h === s.id ? null : s.id))}
              aria-pressed={heldStamp === s.id}
            >
              <RubberStamp label={s.label} color={s.color} scale={0.44} />
            </button>
          ))}
        </div>
        <p className="dsr-note">
          {heldStamp
            ? "Now click anywhere on the document to slam it down."
            : "Pick one up, then click the page."}
        </p>
      </div>
    </section>
  );
}

/* ============================================================================
   6. QUOTE STRIP
   ========================================================================== */

function QuoteStrip({
  quotes,
  onChange,
  onFlush,
  onGlitch,
}: {
  quotes: QuoteStripData;
  onChange: (next: QuoteStripData | ((p: QuoteStripData) => QuoteStripData)) => void;
  onFlush: () => void;
  onGlitch: () => void;
}) {
  const addQuote = () => {
    onChange((prev) => ({
      items: [...prev.items, { id: uid("quote"), text: "", source: "", date: "" }],
    }));
    onFlush();
  };

  const setField = (id: string, patch: Partial<Quote>) =>
    onChange((prev) => ({ items: prev.items.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));

  const remove = (id: string) => {
    onGlitch();
    onChange((prev) => ({ items: prev.items.filter((q) => q.id !== id) }));
    onFlush();
  };

  return (
    <section className="dsr-panel dsr-quotes" aria-labelledby="dsr-quotes-head">
      <div className="dsr-panel-head">
        <h2 id="dsr-quotes-head" className="dsr-panel-title">
          Things They Actually Said
        </h2>
        <span className="dsr-panel-kicker">QUOTE STRIP • VERBATIM</span>
      </div>

      <div className="dsr-quote-strip">
        {quotes.items.map((q) => (
          <div key={q.id} className="dsr-quote-card">
            <span className="dsr-quote-mark" aria-hidden>
              &ldquo;
            </span>
            <textarea
              className="dsr-quote-text"
              rows={3}
              value={q.text}
              onChange={(e) => setField(q.id, { text: e.target.value })}
              onBlur={onFlush}
              placeholder="What they said, word for word"
              maxLength={240}
            />
            <div className="dsr-quote-meta">
              <input
                className="dsr-quote-source"
                value={q.source}
                onChange={(e) => setField(q.id, { source: e.target.value })}
                onBlur={onFlush}
                placeholder="Where / when"
                maxLength={60}
              />
              <input
                className="dsr-quote-date"
                type="date"
                value={q.date}
                onChange={(e) => setField(q.id, { date: e.target.value })}
                onBlur={onFlush}
              />
            </div>
            <button
              type="button"
              className="dsr-quote-x"
              onClick={() => remove(q.id)}
              aria-label="Remove this quote"
            >
              <X className="w-3 h-3" aria-hidden />
            </button>
          </div>
        ))}

        <button type="button" className="dsr-quote-add" onClick={addQuote}>
          <Plus className="w-4 h-4" aria-hidden />
          Pin a quote
        </button>
      </div>

      {quotes.items.length === 0 && (
        <p className="dsr-note">Nothing pinned yet. The first one is always the best one.</p>
      )}
    </section>
  );
}

/* ============================================================================
   7. DIMENSIONAL TRAVELOGUE
   ========================================================================== */

function Travelogue({
  travelogue,
  onChange,
  onFlush,
  onGlitch,
}: {
  travelogue: Travelogue;
  onChange: (next: Travelogue | ((p: Travelogue) => Travelogue)) => void;
  onFlush: () => void;
  onGlitch: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [charging, setCharging] = useState<{ x: number; y: number; key: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingPinId = useRef<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<number | null>(null);
  const holdStart = useRef<{ x: number; y: number } | null>(null);

  const commitPin = useCallback(
    (x: number, y: number) => {
      const id = uid("pin");
      onChange((prev) => ({
        items: [...prev.items, { id, place: "New place", date: "", note: "", photo: null, x, y }],
      }));
      onFlush();
      setOpenId(id);
      sfx.stamp();
    },
    [onChange, onFlush]
  );

  const addPin = () => {
    const id = uid("pin");
    const pos = randomRadarPoint(id);
    onChange((prev) => ({
      items: [...prev.items, { id, place: "New place", date: "", note: "", photo: null, ...pos }],
    }));
    onFlush();
    setOpenId(id);
    sfx.dialClick();
  };

  /* Press and hold anywhere on the dish to drop a pin exactly there - a
     radial "charging" ring tracks the hold so it reads as deliberate, not
     accidental. Cancels on release-early, drifting the pointer, or leaving
     the dish, same shape as the chapter's own upside-down-mode hold. */
  const beginHoldPin = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    const pos = clampToRadar(px, py);
    holdStart.current = pos;
    setCharging({ ...pos, key: Date.now() });
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      commitPin(pos.x, pos.y);
      setCharging(null);
    }, 650);
  };

  const cancelHoldPin = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    holdStart.current = null;
    setCharging(null);
  };

  const driftCancelHoldPin = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const start = holdStart.current;
    if (!rect || !start) return;
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    if (Math.hypot(px - start.x, py - start.y) > 4) cancelHoldPin();
  };

  const setField = (id: string, patch: Partial<TravelPin>) =>
    onChange((prev) => ({ items: prev.items.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));

  const removePin = (id: string) => {
    onGlitch();
    onChange((prev) => ({ items: prev.items.filter((p) => p.id !== id) }));
    onFlush();
    if (openId === id) setOpenId(null);
  };

  const pickPhoto = async (file: File | undefined) => {
    const id = pendingPinId.current;
    if (!file || !id) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("That needs to be an image.");
      return;
    }
    if (file.size > MAX_PICK_BYTES) {
      setError("Under " + formatBytes(MAX_PICK_BYTES) + ", please.");
      return;
    }
    setBusy(true);
    try {
      const prepared = await compressImage(file, { maxEdge: 900, targetBytes: 320_000 });
      setField(id, { photo: prepared.dataUrl });
      onFlush();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That photo could not be filed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const active = travelogue.items.find((p) => p.id === openId) ?? null;

  return (
    <section className="dsr-panel dsr-travelogue" aria-labelledby="dsr-travel-head">
      <div className="dsr-panel-head">
        <h2 id="dsr-travel-head" className="dsr-panel-title">
          Dimensional Travelogue
        </h2>
        <span className="dsr-panel-kicker">EVERYWHERE WE&apos;VE BEEN</span>
      </div>

      <p className="dsr-note dsr-radar-hint">Hold anywhere on the dish to drop a pin there.</p>

      <div
        ref={wrapRef}
        className="dsr-radar-wrap"
        onPointerDown={beginHoldPin}
        onPointerMove={driftCancelHoldPin}
        onPointerUp={cancelHoldPin}
        onPointerLeave={cancelHoldPin}
        onPointerCancel={cancelHoldPin}
      >
        <RadarFace className="dsr-radar-face" />
        <span className="dsr-radar-sweep" aria-hidden />

        {travelogue.items.map((p) => (
          <button
            key={p.id}
            type="button"
            className={"dsr-radar-blip" + (openId === p.id ? " is-open" : "")}
            style={{ left: p.x + "%", top: p.y + "%" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
            aria-label={p.place || "Unnamed place"}
          >
            <span className="dsr-radar-blip-dot" aria-hidden />
            <span className="dsr-radar-blip-label">{p.place || "Unnamed"}</span>
          </button>
        ))}

        {charging && (
          <span
            key={charging.key}
            className="dsr-radar-charge"
            style={{ left: charging.x + "%", top: charging.y + "%" }}
            aria-hidden
          />
        )}

        <button
          type="button"
          className="dsr-radar-add"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={addPin}
          aria-label="Add a place at a random spot"
        >
          <Plus className="w-4 h-4" aria-hidden />
        </button>
      </div>

      {active && (
        <div className="dsr-travel-detail">
          <div className="dsr-travel-detail-row">
            <input
              className="dsr-input"
              value={active.place}
              onChange={(e) => setField(active.id, { place: e.target.value })}
              onBlur={onFlush}
              placeholder="Where"
              maxLength={60}
            />
            <input
              className="dsr-input"
              type="date"
              value={active.date}
              onChange={(e) => setField(active.id, { date: e.target.value })}
              onBlur={onFlush}
            />
          </div>
          <textarea
            className="dsr-textarea"
            rows={3}
            value={active.note}
            onChange={(e) => setField(active.id, { note: e.target.value })}
            onBlur={onFlush}
            placeholder="What happened there"
            maxLength={400}
          />
          <div className="dsr-travel-photo-row">
            <button
              type="button"
              className="dsr-tool-btn"
              onClick={() => {
                pendingPinId.current = active.id;
                fileRef.current?.click();
              }}
              disabled={busy}
            >
              <ImageIcon className="w-3.5 h-3.5" aria-hidden />
              {active.photo ? "Replace photo" : busy ? "Developing…" : "Add photo"}
            </button>
            {active.photo && <img src={active.photo} alt="" className="dsr-travel-photo" />}
            <button
              type="button"
              className="dsr-tool-btn dsr-travel-remove"
              onClick={() => removePin(active.id)}
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden />
              Remove
            </button>
          </div>
          {error && <p className="dsr-error">{error}</p>}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => void pickPhoto(e.target.files?.[0])}
      />

      {travelogue.items.length === 0 && (
        <p className="dsr-note">No pins on the dish yet. Add the first place.</p>
      )}
    </section>
  );
}

/* ============================================================================
   8. WEB-SHOOTER SIZING BLUEPRINT
   ========================================================================== */

const FIGURE_PART_LABELS: Record<"jacket" | "wrist" | "ring" | "shoe", string> = {
  jacket: "Jacket",
  wrist: "Wrist",
  ring: "Ring",
  shoe: "Shoe",
};

function SizingBlueprint({
  sizing,
  onChange,
  onFlush,
}: {
  sizing: SizingBlueprintData;
  onChange: (next: SizingBlueprintData | ((p: SizingBlueprintData) => SizingBlueprintData)) => void;
  onFlush: () => void;
}) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const fieldInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const pendingFocusRef = useRef<string | null>(null);
  /* The measurement waiting to be pinned. While this is set the whole figure
     is a target and the next click on it drops the marker. */
  const [placingId, setPlacingId] = useState<string | null>(null);

  const setField = (id: string, patch: Partial<SizingField>) =>
    onChange((prev) => ({ items: prev.items.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));

  /* A new measurement goes straight into placing mode, so "add" and "put it
     where I mean" are one gesture rather than two unrelated ones. */
  const addField = () => {
    const id = uid("size");
    pendingFocusRef.current = id;
    onChange((prev) => ({ items: [...prev.items, { id, part: "", value: "", unit: "" }] }));
    onFlush();
    setPlacingId(id);
  };

  const removeField = (id: string) => {
    onChange((prev) => ({ items: prev.items.filter((f) => f.id !== id) }));
    if (placingId === id) setPlacingId(null);
    onFlush();
  };

  /* Drop the pin wherever they clicked, in viewBox units. Clamped so a click
     right on the edge cannot park a marker half outside the drawing. */
  const placePin = (x: number, y: number) => {
    if (!placingId) return;
    sfx.stamp();
    const cx = Math.max(8, Math.min(FIGURE_VIEWBOX.w - 8, x));
    const cy = Math.max(8, Math.min(FIGURE_VIEWBOX.h - 8, y));
    setField(placingId, { x: cx, y: cy });
    onFlush();
    const id = placingId;
    setPlacingId(null);
    fieldInputRefs.current[id]?.focus();
  };

  const pins = useMemo(
    () =>
      sizing.items
        .filter((f) => typeof f.x === "number" && typeof f.y === "number")
        .map((f) => ({
          id: f.id,
          label: f.part,
          x: f.x as number,
          y: f.y as number,
          active: highlight === f.part && Boolean(f.part),
        })),
    [sizing.items, highlight]
  );

  /* Makes the mannequin an actual control instead of a passive readout that
     only ever reacted to whichever field you happened to already be in:
     clicking a region jumps straight to its measurement, creating one first
     if it doesn't exist yet. */
  const handlePartClick = (part: "jacket" | "wrist" | "ring" | "shoe") => {
    const existing = sizing.items.find((f) => resolveFigurePart(f.part) === part);
    if (existing) {
      setHighlight(part);
      fieldInputRefs.current[existing.id]?.focus();
      return;
    }
    const id = uid("size");
    pendingFocusRef.current = id;
    onChange((prev) => ({
      items: [...prev.items, { id, part: FIGURE_PART_LABELS[part], value: "", unit: "" }],
    }));
    onFlush();
  };

  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    if (sizing.items.some((f) => f.id === id)) {
      pendingFocusRef.current = null;
      fieldInputRefs.current[id]?.focus();
    }
  }, [sizing.items]);

  return (
    <section className="dsr-panel dsr-sizing" aria-labelledby="dsr-sizing-head">
      <div className="dsr-panel-head">
        <h2 id="dsr-sizing-head" className="dsr-panel-title">
          Web-Shooter Sizing Blueprint
        </h2>
        <span className="dsr-panel-kicker">FOR WHEN YOU&apos;RE BUYING SOMETHING</span>
      </div>

      {placingId && (
        <p className="dsr-sizing-placing" role="status">
          Tap anywhere on the figure to pin{" "}
          <strong>{sizing.items.find((f) => f.id === placingId)?.part || "this measurement"}</strong> there.
          <button type="button" className="dsr-sizing-placing-x" onClick={() => setPlacingId(null)}>
            cancel
          </button>
        </p>
      )}

      <div className="dsr-sizing-body">
        <VectorFigure
          highlight={highlight}
          onPartClick={handlePartClick}
          pins={pins}
          placing={Boolean(placingId)}
          onCanvasClick={placePin}
          onPinClick={(id) => {
            const f = sizing.items.find((i) => i.id === id);
            if (f) setHighlight(f.part);
            fieldInputRefs.current[id]?.focus();
          }}
          className={
            "dsr-sizing-figure dsr-sizing-figure-interactive" +
            (placingId ? " is-placing" : "")
          }
        />

        <div className="dsr-sizing-fields">
          {sizing.items.map((f) => (
            <div
              key={f.id}
              className="dsr-sizing-field"
              onFocus={() => setHighlight(f.part)}
              onBlur={(e) => {
                onFlush();
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setHighlight(null);
              }}
            >
              <input
                ref={(el) => {
                  fieldInputRefs.current[f.id] = el;
                }}
                className="dsr-field-label-input"
                value={f.part}
                onChange={(e) => setField(f.id, { part: e.target.value })}
                placeholder="Measurement"
                maxLength={30}
              />
              <div className="dsr-sizing-value-row">
                <input
                  className="dsr-input"
                  value={f.value}
                  onChange={(e) => setField(f.id, { value: e.target.value })}
                  placeholder="Size"
                  maxLength={20}
                />
                <input
                  className="dsr-input dsr-sizing-unit"
                  value={f.unit}
                  onChange={(e) => setField(f.id, { unit: e.target.value })}
                  placeholder="Unit"
                  maxLength={12}
                />
                <button
                  type="button"
                  className={
                    "dsr-sizing-pinbtn" +
                    (placingId === f.id ? " is-placing" : "") +
                    (typeof f.x === "number" ? " is-pinned" : "")
                  }
                  onClick={() => setPlacingId((p) => (p === f.id ? null : f.id))}
                  aria-pressed={placingId === f.id}
                  aria-label={
                    (typeof f.x === "number" ? "Move the pin for " : "Pin ") +
                    (f.part || "this measurement") +
                    " on the figure"
                  }
                  title={typeof f.x === "number" ? "Move pin" : "Pin on the figure"}
                >
                  📍
                </button>
                <button
                  type="button"
                  className="dsr-field-x"
                  onClick={() => removeField(f.id)}
                  aria-label={"Remove " + (f.part || "measurement")}
                >
                  <X className="w-3 h-3" aria-hidden />
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="dsr-field-add" onClick={addField}>
            <Plus className="w-3.5 h-3.5" aria-hidden /> Add measurement
          </button>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
   9. PET PEEVE / RED-FLAG INDEX
   ========================================================================== */

const PEEVE_SEVERITIES: { id: PeeveSeverity; label: string }[] = [
  { id: "peeve", label: "Pet peeve" },
  { id: "redflag", label: "Red flag" },
  { id: "greenflag", label: "Green flag" },
];

function PeeveIndex({
  peeves,
  onChange,
  onFlush,
  onGlitch,
}: {
  peeves: PeeveIndexData;
  onChange: (next: PeeveIndexData | ((p: PeeveIndexData) => PeeveIndexData)) => void;
  onFlush: () => void;
  onGlitch: () => void;
}) {
  const addItem = (severity: PeeveSeverity) => {
    onChange((prev) => ({ items: [...prev.items, { id: uid("peeve"), text: "", severity }] }));
    onFlush();
  };

  const setText = (id: string, text: string) =>
    onChange((prev) => ({ items: prev.items.map((p) => (p.id === id ? { ...p, text } : p)) }));

  const remove = (id: string) => {
    onGlitch();
    onChange((prev) => ({ items: prev.items.filter((p) => p.id !== id) }));
    onFlush();
  };

  return (
    <section className="dsr-panel dsr-peeves" aria-labelledby="dsr-peeve-head">
      <div className="dsr-panel-head">
        <h2 id="dsr-peeve-head" className="dsr-panel-title">
          Pet Peeve &amp; Flag Index
        </h2>
        <span className="dsr-panel-kicker">READ BEFORE YOU STEP ON ONE</span>
      </div>

      <div className="dsr-peeve-add-row">
        {PEEVE_SEVERITIES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={"dsr-tool-btn dsr-peeve-add dsr-peeve-add-" + s.id}
            onClick={() => addItem(s.id)}
          >
            <Plus className="w-3.5 h-3.5" aria-hidden />
            {s.label}
          </button>
        ))}
      </div>

      <ul className="dsr-peeve-list">
        {peeves.items.map((p) => (
          <li key={p.id} className={"dsr-peeve-item dsr-peeve-" + p.severity}>
            {p.severity === "redflag" && <HazardStripe className="dsr-peeve-hazard" />}
            <span className="dsr-peeve-tag">{PEEVE_SEVERITIES.find((s) => s.id === p.severity)?.label}</span>
            <textarea
              className="dsr-peeve-text"
              rows={2}
              value={p.text}
              onChange={(e) => setText(p.id, e.target.value)}
              onBlur={onFlush}
              placeholder="What it is, exactly"
              maxLength={200}
            />
            <button
              type="button"
              className="dsr-field-x"
              onClick={() => remove(p.id)}
              aria-label="Remove this item"
            >
              <X className="w-3 h-3" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      {peeves.items.length === 0 && (
        <p className="dsr-note">Nothing catalogued yet. Add a peeve, a red flag, or a green one.</p>
      )}
    </section>
  );
}

/* ============================================================================
   10. "IN ANY UNIVERSE" TIME CAPSULE
   ========================================================================== */

function TimeCapsule({
  capsule,
  onChange,
  onFlush,
  onGlitch,
}: {
  capsule: TimeCapsuleData;
  onChange: (next: TimeCapsuleData | ((p: TimeCapsuleData) => TimeCapsuleData)) => void;
  onFlush: () => void;
  onGlitch: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftPhoto, setDraftPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [breaking, setBreaking] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* `Date.now()` cannot be called during render (react-hooks/purity) - a
     ticking "now" kept in state, same shape as ClockScreen/CountdownsScreen's
     live counters, is what lets a capsule flip from sealed to unlockable
     while the page is open without reading the clock mid-render. A capsule
     unlocking a few seconds late is invisible; 30s is coarse on purpose. */
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  /* sealedUntil is a bare "YYYY-MM-DD" from <input type="date">. A date-only
     string parses as UTC midnight, not local midnight - appending a bare
     time makes the Date constructor read it as local instead, so the seal
     lifts at local midnight on the chosen day regardless of timezone. */
  const isSealed = (entry: CapsuleEntry) =>
    !!entry.sealedUntil && new Date(entry.sealedUntil + "T00:00:00").getTime() > now;

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("That needs to be an image.");
      return;
    }
    if (file.size > MAX_PICK_BYTES) {
      setError("Under " + formatBytes(MAX_PICK_BYTES) + ", please.");
      return;
    }
    setBusy(true);
    try {
      const prepared = await compressImage(file, { maxEdge: 900, targetBytes: 320_000 });
      setDraftPhoto(prepared.dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That photo could not be filed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const commitCapsule = () => {
    if (!draftMessage.trim()) return;
    onChange((prev) => ({
      items: [
        ...prev.items,
        {
          id: uid("capsule"),
          message: draftMessage.trim(),
          photo: draftPhoto,
          sealedUntil: draftDate,
          opened: !draftDate,
        },
      ],
    }));
    onFlush();
    sfx.stamp();
    setComposing(false);
    setDraftMessage("");
    setDraftDate("");
    setDraftPhoto(null);
  };

  /* The "web-slice ritual" - breaking a seal snaps a web strand (the same
     sound the corkboard uses for exactly that) and clip-path tears the sealed
     face away before the message is committed as opened. */
  const breakSeal = (id: string) => {
    sfx.webSnap();
    setBreaking(id);
    window.setTimeout(() => {
      onChange((prev) => ({ items: prev.items.map((c) => (c.id === id ? { ...c, opened: true } : c)) }));
      onFlush();
      setBreaking(null);
    }, 500);
  };

  const removeCapsule = (id: string) => {
    onGlitch();
    onChange((prev) => ({ items: prev.items.filter((c) => c.id !== id) }));
    onFlush();
  };

  return (
    <section className="dsr-panel dsr-capsule" aria-labelledby="dsr-capsule-head">
      <div className="dsr-panel-head">
        <h2 id="dsr-capsule-head" className="dsr-panel-title">
          In Any Universe
        </h2>
        <span className="dsr-panel-kicker">TIME CAPSULE • SEAL IT SHUT</span>
      </div>

      <div className="dsr-capsule-grid">
        {capsule.items.map((c) => {
          const sealed = isSealed(c);
          return (
            <div
              key={c.id}
              className={"dsr-capsule-card" + (sealed ? " is-sealed" : "") + (breaking === c.id ? " is-breaking" : "")}
            >
              {sealed ? (
                <button
                  type="button"
                  className="dsr-capsule-sealed-face"
                  disabled
                  aria-label={"Sealed until " + c.sealedUntil}
                >
                  <SpiderMark className="dsr-capsule-web" size={30} />
                  <span>Sealed until {c.sealedUntil}</span>
                </button>
              ) : !c.opened ? (
                <button type="button" className="dsr-capsule-sealed-face dsr-capsule-ready" onClick={() => breakSeal(c.id)}>
                  <SpiderMark className="dsr-capsule-web" size={30} />
                  <span>Ready. Tap to break the seal.</span>
                </button>
              ) : (
                <div className="dsr-capsule-open">
                  {c.photo && <img src={c.photo} alt="" className="dsr-capsule-photo" />}
                  <p className="dsr-capsule-message">{c.message}</p>
                  {c.sealedUntil && <span className="dsr-capsule-unsealed-note">Opened after {c.sealedUntil}</span>}
                </div>
              )}
              <button
                type="button"
                className="dsr-capsule-x"
                onClick={() => removeCapsule(c.id)}
                aria-label="Discard this capsule"
              >
                <Trash2 className="w-3 h-3" aria-hidden />
              </button>
            </div>
          );
        })}

        {!composing ? (
          <button type="button" className="dsr-capsule-new" onClick={() => setComposing(true)}>
            <Plus className="w-4 h-4" aria-hidden />
            Seal something away
          </button>
        ) : (
          <div className="dsr-capsule-composer">
            <textarea
              className="dsr-textarea"
              rows={3}
              value={draftMessage}
              onChange={(e) => setDraftMessage(e.target.value)}
              placeholder="Something for whoever opens this"
              maxLength={500}
              autoFocus
            />
            <div className="dsr-capsule-composer-row">
              <label className="dsr-field-label" htmlFor="dsr-capsule-date">
                Open on / after
              </label>
              <input
                id="dsr-capsule-date"
                className="dsr-input"
                type="date"
                value={draftDate}
                onChange={(e) => setDraftDate(e.target.value)}
              />
            </div>
            <div className="dsr-capsule-composer-row">
              <button type="button" className="dsr-tool-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                <ImageIcon className="w-3.5 h-3.5" aria-hidden />
                {draftPhoto ? "Replace photo" : busy ? "Developing…" : "Add a photo"}
              </button>
              {draftPhoto && <img src={draftPhoto} alt="" className="dsr-travel-photo" />}
            </div>
            {error && <p className="dsr-error">{error}</p>}
            <div className="dsr-capsule-composer-actions">
              <button type="button" className="dsr-tool-btn" onClick={commitCapsule} disabled={!draftMessage.trim()}>
                Seal it
              </button>
              <button
                type="button"
                className="dsr-tool-btn"
                onClick={() => {
                  setComposing(false);
                  setDraftMessage("");
                  setDraftDate("");
                  setDraftPhoto(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => void pickPhoto(e.target.files?.[0])}
      />
    </section>
  );
}

/* ============================================================================
   11. THE FIELD INTERVIEW

   The whole "A Little World About Them" questionnaire, rendered as the case
   file's interview transcript: six numbered volumes of index cards behind
   divider tabs, in the source document's own running order.

   269 prompts is a wall if you present it as a form, so it deliberately is
   not one:

   - THE POLYGRAPH is the reason to come back to a questionnaire you have
     already filled in. It reads out a question that is on record, takes YOUR
     guess at what they said, then puts the two statements side by side and
     rules on it. Every answer in the file becomes a question about how well
     you were listening.
   - INTERVIEW MODE deals the questions one at a time as a full-screen deck,
     which is how this actually gets filled in - together, out loud.
   - QUIZ MODE covers the answers already on record, in place.
   - Any volume takes THEIR OWN QUESTIONS, because no stock list covers a
     specific person.
   ========================================================================== */

/** A catalogue prompt or one they wrote themselves, once resolved for display. */
type LivePrompt = InterviewPrompt & { custom?: boolean };

/* Each volume gets its own ink so six stacks of index cards do not read as
   one undifferentiated wall. Presentation only - kept out of the data module. */
const VOLUME_INK: Record<string, string> = {
  who: "#3FE0F0",
  fav: "#FFC93F",
  per: "#FF3DC8",
  mem: "#8BE06B",
  drm: "#7B6BF0",
  us: "#FF6B6B",
};

/** A volume's prompts: catalogue entries first, then their own questions. */
function resolveVolumePrompts(volId: string, custom: CustomPrompt[]): LivePrompt[] {
  const catalogue = INTERVIEW_VOLUMES.find((v) => v.id === volId)?.prompts ?? [];
  const theirs: LivePrompt[] = custom
    .filter((c) => c.volume === volId)
    .map((c) => ({ id: c.id, q: c.q, long: c.long, custom: true }));
  return [...catalogue, ...theirs];
}

/** Which volume a prompt belongs to - catalogue or one of theirs. */
function volumeIdOf(promptId: string, custom: CustomPrompt[]): string | undefined {
  return volumeOfPrompt(promptId)?.id ?? custom.find((c) => c.id === promptId)?.volume;
}

/* ============================================================================
   THE POLYGRAPH

   Everything else in this chapter collects answers. This is the only thing
   that spends them: it picks questions THEY have already answered, asks YOU
   to state what they said, and rules on the two statements together.
   ========================================================================== */

/* Words carrying no signal when two people phrase the same answer differently
   - "his mum" against "mum" should not read as half a miss. */
const PG_STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "to", "in", "on", "at", "it", "is", "was", "be",
  "i", "im", "my", "me", "we", "our", "us", "you", "your", "he", "she", "they",
  "him", "her", "his", "hers", "them", "their", "that", "this", "with", "for",
  "or", "but", "so", "if", "as", "by", "from", "just", "really", "very", "too",
  "probably", "maybe", "always", "usually", "when", "then", "than", "about",
]);

function pgNormalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pgTokens(text: string): string[] {
  return pgNormalise(text)
    .split(" ")
    .filter((w) => w.length > 0 && !PG_STOPWORDS.has(w));
}

function pgBigrams(text: string): Set<string> {
  const flat = pgNormalise(text).replace(/\s/g, "");
  const out = new Set<string>();
  for (let i = 0; i < flat.length - 1; i += 1) out.add(flat.slice(i, i + 2));
  return out;
}

function pgDice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  a.forEach((x) => {
    if (b.has(x)) hit += 1;
  });
  return (2 * hit) / (a.size + b.size);
}

/**
 * How close a statement is to what is on record, 0..1.
 *
 * Word overlap is the honest signal for a sentence, but it collapses to 0 or
 * 1 on one-word answers ("pancakes" against "pancake"), so character bigrams
 * carry those instead and the better of the two wins. The machine only ever
 * SUGGESTS a verdict: no ratio knows that "his mum's" and "mama dell" are the
 * same answer, so the reader always gets to overrule it.
 */
function pgSimilarity(guess: string, truth: string): number {
  const g = pgTokens(guess);
  const t = pgTokens(truth);
  if (g.length === 0 || t.length === 0) return 0;
  const byWord = pgDice(new Set(g), new Set(t));
  const byShape = pgDice(pgBigrams(guess), pgBigrams(truth));
  return Math.min(1, Math.max(byWord, byShape * 0.92));
}

/** Where the machine stops calling it a match. */
const PG_MATCH = 0.5;

/** How many questions one test runs, when there are that many on record. */
const PG_ROUNDS = 7;

const PG_VERDICTS: { min: number; head: string; line: string }[] = [
  {
    min: 100,
    head: "TOTAL CONSISTENCY",
    line: "Every statement checks out. Either you know this person, or you wrote their answers for them.",
  },
  {
    min: 80,
    head: "CLEARED",
    line: "Earth-616 has no further questions. Whatever you have been doing, keep doing it.",
  },
  {
    min: 60,
    head: "MOSTLY CONSISTENT",
    line: "A solid file with a couple of smudged pages. You know the shape of them.",
  },
  {
    min: 40,
    head: "INCONCLUSIVE",
    line: "Recommend further surveillance. Out loud, together, preferably tonight.",
  },
  {
    min: 20,
    head: "DECEPTION DETECTED",
    line: "The machine is not impressed. Good news: every answer you missed is right there in the file.",
  },
  {
    min: 0,
    head: "FLAT LINE",
    line: "Nothing checked out. Either a very bad night, or you have been dating a stranger.",
  },
];

function pgVerdict(pct: number) {
  return PG_VERDICTS.find((v) => pct >= v.min) ?? PG_VERDICTS[PG_VERDICTS.length - 1];
}

/* One deterministic sweep of chart paper per channel, generated once at
   module load rather than per render - and with no Math.random in them, so
   the server and the client draw the same line. Two channels, because one
   wobbling line reads as a heart monitor and two read as a polygraph. */
function pgTrace(fn: (x: number) => number): string {
  const pts: string[] = [];
  for (let x = 0; x <= 600; x += 5) pts.push(x + "," + fn(x).toFixed(1));
  return pts.join(" ");
}

const PG_TRACE_A = pgTrace(
  (x) => 20 + Math.sin(x / 43) * 7.5 + Math.sin(x / 17.3) * 3.6 + Math.sin(x / 6.1) * 1.6
);
const PG_TRACE_B = pgTrace(
  (x) => 44 + Math.sin(x / 29 + 1.4) * 5.2 + Math.sin(x / 9.7) * 2.8 + Math.sin(x / 3.9) * 1.1
);

/** One question inside a running test. */
interface PgRound {
  prompt: LivePrompt;
  /** What is on record, captured when the test was dealt. */
  truth: string;
  /** What the reader said it was. */
  guess: string;
  /** null until the tape has been read. */
  verdict: "match" | "miss" | null;
  /** The machine's reading, 0..1. */
  score: number;
}

function PolygraphTest({
  seed,
  previousBest,
  isStarred,
  onStar,
  onJump,
  onFinish,
  onClose,
}: {
  seed: PgRound[];
  previousBest: number;
  isStarred: (id: string) => boolean;
  onStar: (id: string) => void;
  onJump: (id: string) => void;
  onFinish: (pct: number) => void;
  onClose: () => void;
}) {
  /* The hand is dealt once, on open. Re-deriving it from props mid-run would
     re-shuffle the questions under the reader every time an answer saved. */
  const [rounds, setRounds] = useState<PgRound[]>(seed);
  /* Snapshot, not the live prop: finishing the test writes the new best into
     the panel in the same commit that shows the tape, so comparing against
     the prop would always be comparing the score against itself and the
     "new best" line could never appear. */
  const [bestBefore] = useState(previousBest);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"ask" | "read" | "done">("ask");

  /* The needle only reacts to activity - a flat trace while somebody is
     typing their statement is the one thing a polygraph would never do. */
  const [hot, setHot] = useState(false);
  const hotTimer = useRef<number | null>(null);
  const pulseFor = useCallback((ms: number) => {
    setHot(true);
    if (hotTimer.current) window.clearTimeout(hotTimer.current);
    hotTimer.current = window.setTimeout(() => setHot(false), ms);
  }, []);
  useEffect(
    () => () => {
      if (hotTimer.current) window.clearTimeout(hotTimer.current);
    },
    []
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const round = rounds[idx];
  const matches = rounds.reduce((n, r) => n + (r.verdict === "match" ? 1 : 0), 0);
  const pct = rounds.length ? Math.round((matches / rounds.length) * 100) : 0;

  const setGuess = (value: string) => {
    pulseFor(460);
    setRounds((rs) => rs.map((r, i) => (i === idx ? { ...r, guess: value } : r)));
  };

  /* Reading the tape is the whole beat: the needle spikes, the recorded
     answer comes up underneath yours, and the machine rules on it. */
  const readTape = (skipped: boolean) => {
    if (phase !== "ask") return;
    const guess = skipped ? "" : round.guess.trim();
    const score = guess ? pgSimilarity(guess, round.truth) : 0;
    const verdict: "match" | "miss" = score >= PG_MATCH ? "match" : "miss";
    setRounds((rs) =>
      rs.map((r, i) => (i === idx ? { ...r, guess: skipped ? "" : r.guess, score, verdict } : r))
    );
    setPhase("read");
    pulseFor(900);
    sfx.stamp();
    if (verdict === "miss") window.setTimeout(() => sfx.glitch(), 170);
  };

  /* The machine is confident, not right. "His mum's" and "mama dell" are the
     same answer and no ratio will ever know that, so the reader overrules. */
  const overrule = () => {
    sfx.dialClick();
    setRounds((rs) =>
      rs.map((r, i) => (i === idx ? { ...r, verdict: r.verdict === "match" ? "miss" : "match" } : r))
    );
  };

  const advance = () => {
    if (idx + 1 < rounds.length) {
      sfx.cardFlip();
      setIdx(idx + 1);
      setPhase("ask");
      return;
    }
    setPhase("done");
    if (pct >= 80) sfx.bloom();
    else if (pct < 40) sfx.alarm();
    else sfx.paperTear();
    onFinish(pct);
  };

  const misses = rounds.filter((r) => r.verdict === "miss");
  const verdict = pgVerdict(pct);
  const ink = VOLUME_INK[volumeOfPrompt(round?.prompt.id ?? "")?.id ?? ""] ?? "#FF3DC8";
  /* Derived, not timed: a pulse ticking on its own would re-render the whole
     overlay several times a second for a decorative number. */
  const bpm = 68 + (hot ? 34 : 0) + ((idx * 7) % 9);

  return (
    <ChapterOverlay>
      <div
        className="dsr-pg"
        role="dialog"
        aria-modal="true"
        aria-label="Polygraph test"
        style={{ "--iv-ink": ink } as CSSProperties}
      >
        <div className="dsr-pg-sheet">
          <div className="dsr-pg-head">
            <span className="dsr-panel-kicker">
              EARTH-616 VERIFICATION UNIT &middot;{" "}
              {phase === "done" ? "TAPE COMPLETE" : "STATEMENT " + (idx + 1) + " / " + rounds.length}
            </span>
            <button
              type="button"
              className="dsr-iv-spotlight-x"
              onClick={onClose}
              aria-label="Abandon the test"
            >
              &#10005;
            </button>
          </div>

          {/* the machine itself */}
          <div className={"dsr-pg-chart" + (hot ? " is-hot" : "")}>
            <svg className="dsr-pg-svg" viewBox="0 0 600 60" preserveAspectRatio="none" aria-hidden>
              <g className="dsr-pg-roll">
                <polyline className="dsr-pg-line" points={PG_TRACE_A} />
                <polyline className="dsr-pg-line" points={PG_TRACE_A} transform="translate(600 0)" />
                <polyline className="dsr-pg-line dsr-pg-line-b" points={PG_TRACE_B} />
                <polyline
                  className="dsr-pg-line dsr-pg-line-b"
                  points={PG_TRACE_B}
                  transform="translate(600 0)"
                />
              </g>
            </svg>
            <span className="dsr-pg-pen" aria-hidden />
            <span className="dsr-pg-bpm" aria-hidden>
              {bpm} BPM
            </span>
          </div>

          {phase === "done" ? (
            /* ------------------------------------------------ the tape --- */
            <div className="dsr-pg-result">
              <div className="dsr-pg-score">
                <span className="dsr-pg-score-num">{pct}%</span>
                <span className="dsr-pg-score-lab">
                  TRUTH RATING &middot; {matches} OF {rounds.length}
                </span>
              </div>

              <div className={"dsr-pg-verdict" + (pct >= 60 ? " is-good" : "")}>
                <strong>{verdict.head}</strong>
                <span>{verdict.line}</span>
              </div>

              {pct > bestBefore && (
                <p className="dsr-pg-record">&#9733; New personal best on file.</p>
              )}

              {misses.length > 0 && (
                <div className="dsr-pg-misses">
                  <span className="dsr-field-label">Statements that did not check out</span>
                  {misses.map((r) => (
                    <button
                      key={r.prompt.id}
                      type="button"
                      className="dsr-pg-miss"
                      onClick={() => onJump(r.prompt.id)}
                    >
                      <span className="dsr-pg-miss-q">{r.prompt.q}</span>
                      <span className="dsr-pg-miss-a">On record: {r.truth.trim() || "—"}</span>
                      <span className="dsr-pg-miss-go">open the file &rarr;</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="dsr-pg-foot">
                <button type="button" className="dsr-tool-btn dsr-iv-primary" onClick={onClose}>
                  Close the file
                </button>
              </div>
            </div>
          ) : (
            round && (
              <>
                <div className="dsr-pg-qrow">
                  <span className="dsr-pg-vol" aria-hidden>
                    {volumeOfPrompt(round.prompt.id)?.roman ?? "✴"}
                  </span>
                  <p className="dsr-pg-q">{round.prompt.q}</p>
                </div>

                <label className="dsr-field-label" htmlFor="dsr-pg-guess">
                  Your statement &mdash; what did they say?
                </label>
                <textarea
                  id="dsr-pg-guess"
                  className="dsr-textarea dsr-pg-input"
                  rows={2}
                  value={round.guess}
                  placeholder="Say it out loud first. No peeking."
                  onChange={(e) => setGuess(e.target.value)}
                  readOnly={phase === "read"}
                />

                {phase === "read" && (
                  <div className={"dsr-pg-tape" + (round.verdict === "match" ? " is-match" : "")}>
                    <div className="dsr-pg-stamp" aria-hidden>
                      <RubberStamp
                        label={round.verdict === "match" ? "CONSISTENT" : "DECEPTION"}
                        color={round.verdict === "match" ? "#3BD17A" : "#FF5A5A"}
                        rotate={-7}
                        scale={0.7}
                      />
                    </div>

                    <span className="dsr-field-label">On record</span>
                    <p className="dsr-pg-truth">{round.truth.trim() || "—"}</p>

                    <p className="dsr-pg-reading">
                      MACHINE READS {Math.round(round.score * 100)}% CONSISTENT
                      <span className="dsr-pg-reading-note">
                        {round.verdict === "match"
                          ? " · close enough to call it"
                          : " · not close enough to call it"}
                      </span>
                    </p>

                    <div className="dsr-pg-overrule">
                      <button type="button" className="dsr-tool-btn" onClick={overrule}>
                        {round.verdict === "match"
                          ? "✖ No, I had that wrong"
                          : "✔ No, that was right"}
                      </button>
                      {round.verdict === "miss" && (
                        <button
                          type="button"
                          className={
                            "dsr-tool-btn" + (isStarred(round.prompt.id) ? " dsr-iv-primary" : "")
                          }
                          onClick={() => onStar(round.prompt.id)}
                        >
                          {isStarred(round.prompt.id) ? "★ Starred" : "☆ Star for later"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="dsr-pg-foot">
                  {phase === "ask" ? (
                    <>
                      <button type="button" className="dsr-tool-btn" onClick={() => readTape(true)}>
                        No idea
                      </button>
                      <button
                        type="button"
                        className="dsr-tool-btn dsr-iv-primary"
                        onClick={() => readTape(false)}
                        disabled={!round.guess.trim()}
                      >
                        Run verification
                      </button>
                    </>
                  ) : (
                    <button type="button" className="dsr-tool-btn dsr-iv-primary" onClick={advance}>
                      {idx + 1 < rounds.length ? "Next statement →" : "Read the tape"}
                    </button>
                  )}
                </div>

                <div className="dsr-pg-pips" aria-hidden>
                  {rounds.map((r, i) => (
                    <span
                      key={r.prompt.id}
                      className={
                        "dsr-pg-pip" +
                        (r.verdict === "match" ? " is-match" : "") +
                        (r.verdict === "miss" ? " is-miss" : "") +
                        (i === idx ? " is-now" : "")
                      }
                    />
                  ))}
                </div>
              </>
            )
          )}
        </div>
      </div>
    </ChapterOverlay>
  );
}

/* Each card owns its own render. Without memo, one keystroke re-renders every
   card in the volume (79 of them in Their Favorites), which is exactly the
   kind of typing lag that shows up first on a phone. */
const InterviewCard = memo(function InterviewCard({
  prompt,
  value,
  pinned,
  ink,
  spotlit,
  quiz,
  revealed,
  onSet,
  onCommit,
  onTogglePin,
  onReveal,
  onDelete,
}: {
  prompt: LivePrompt;
  value: string;
  pinned: boolean;
  ink: string;
  spotlit?: boolean;
  quiz?: boolean;
  revealed?: boolean;
  onSet: (id: string, value: string) => void;
  onCommit: () => void;
  onTogglePin: (id: string) => void;
  onReveal?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const filled = value.trim().length > 0;
  const inputId = "dsr-iv-" + prompt.id;
  /* In quiz mode an answer already on record stays hidden until you say it
     out loud and tap to check. A blank one has nothing to hide. */
  const hidden = Boolean(quiz && filled && !revealed);

  return (
    <div
      data-prompt={prompt.id}
      className={
        "dsr-iv-card" +
        (filled ? " is-filled" : "") +
        (spotlit ? " is-spotlit" : "") +
        (prompt.custom ? " is-custom" : "")
      }
      style={{ "--iv-ink": ink } as CSSProperties}
    >
      <div className="dsr-iv-cardhead">
        <label className="dsr-iv-q" htmlFor={inputId}>
          {prompt.q}
          {prompt.custom && <span className="dsr-iv-ours">OURS</span>}
        </label>
        <button
          type="button"
          className={"dsr-iv-pin" + (pinned ? " is-on" : "")}
          onClick={() => onTogglePin(prompt.id)}
          aria-pressed={pinned}
          aria-label={(pinned ? "Unpin " : "Pin ") + prompt.q}
          title={pinned ? "Unpin" : "Pin to highlights"}
        >
          {pinned ? "★" : "☆"}
        </button>
      </div>

      {hidden ? (
        <button type="button" className="dsr-iv-cover" onClick={() => onReveal?.(prompt.id)}>
          <span className="dsr-iv-cover-tag">ON RECORD</span>
          <span className="dsr-iv-cover-hint">say it, then tap to check</span>
        </button>
      ) : prompt.long ? (
        <textarea
          id={inputId}
          className="dsr-textarea dsr-iv-input"
          rows={2}
          value={value}
          placeholder="—"
          onChange={(e) => onSet(prompt.id, e.target.value)}
          onBlur={onCommit}
        />
      ) : (
        <input
          id={inputId}
          className="dsr-input dsr-iv-input"
          value={value}
          placeholder="—"
          onChange={(e) => onSet(prompt.id, e.target.value)}
          onBlur={onCommit}
        />
      )}

      {onDelete && prompt.custom && (
        <div className="dsr-iv-cardfoot">
          <button
            type="button"
            className="dsr-iv-del"
            onClick={() => onDelete(prompt.id)}
            aria-label={"Delete our question: " + prompt.q}
          >
            delete
          </button>
        </div>
      )}
    </div>
  );
});

function FieldInterview({
  interview,
  loading,
  onChange,
  onFlush,
  onGlitch,
}: {
  interview: InterviewData;
  loading: boolean;
  onChange: (next: InterviewData | ((p: InterviewData) => InterviewData)) => void;
  onFlush: () => void;
  onGlitch: () => void;
}) {
  const [volId, setVolId] = useState(INTERVIEW_VOLUMES[0].id);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"all" | "filled" | "blank">("all");
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [quiz, setQuiz] = useState(false);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [newQ, setNewQ] = useState("");
  const [deckOpen, setDeckOpen] = useState(false);
  const [deckIdx, setDeckIdx] = useState(0);
  const [deckAll, setDeckAll] = useState(false);
  const [pgSeed, setPgSeed] = useState<PgRound[] | null>(null);
  const [pgNotice, setPgNotice] = useState<string | null>(null);

  const answers = interview.answers;
  const ink = VOLUME_INK[volId] ?? "#3FE0F0";

  const volume = useMemo(
    () => INTERVIEW_VOLUMES.find((v) => v.id === volId) ?? INTERVIEW_VOLUMES[0],
    [volId]
  );

  /* Every prompt in play, catalogue + theirs, so the counts, the deck and the
     polygraph cover their own questions too rather than silently ignoring
     them. */
  const livePrompts = useMemo(() => {
    const out: LivePrompt[] = [];
    for (const v of INTERVIEW_VOLUMES) out.push(...resolveVolumePrompts(v.id, interview.custom));
    return out;
  }, [interview.custom]);

  const isFilled = useCallback((id: string) => (answers[id] ?? "").trim().length > 0, [answers]);

  const answeredCount = useMemo(
    () => livePrompts.reduce((n, p) => n + (isFilled(p.id) ? 1 : 0), 0),
    [livePrompts, isFilled]
  );
  const totalCount = livePrompts.length;

  const volumePrompts = useMemo(
    () => resolveVolumePrompts(volId, interview.custom),
    [volId, interview.custom]
  );

  const volumeCounts = useMemo(() => {
    const out: Record<string, { done: number; total: number }> = {};
    for (const v of INTERVIEW_VOLUMES) {
      const ps = resolveVolumePrompts(v.id, interview.custom);
      out[v.id] = { done: ps.reduce((n, p) => n + (isFilled(p.id) ? 1 : 0), 0), total: ps.length };
    }
    return out;
  }, [interview.custom, isFilled]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return volumePrompts.filter((p) => {
      if (q && !p.q.toLowerCase().includes(q)) return false;
      if (mode === "filled" && !isFilled(p.id)) return false;
      if (mode === "blank" && isFilled(p.id)) return false;
      return true;
    });
  }, [volumePrompts, query, mode, isFilled]);

  const promptById = useMemo(() => {
    const m = new Map<string, LivePrompt>();
    for (const p of livePrompts) m.set(p.id, p);
    return m;
  }, [livePrompts]);

  const pinnedPrompts = useMemo(
    () => interview.pinned.map((id) => promptById.get(id)).filter((p): p is LivePrompt => Boolean(p)),
    [interview.pinned, promptById]
  );

  /* Stable across renders so InterviewCard's memo actually holds. */
  const setAnswer = useCallback(
    (id: string, next: string) => {
      onChange((prev) => ({ ...prev, answers: { ...prev.answers, [id]: next } }));
    },
    [onChange]
  );

  const togglePin = useCallback(
    (id: string) => {
      sfx.dialClick();
      onChange((prev) => ({
        ...prev,
        pinned: prev.pinned.includes(id) ? prev.pinned.filter((p) => p !== id) : [...prev.pinned, id],
      }));
      onFlush();
    },
    [onChange, onFlush]
  );

  const reveal = useCallback((id: string) => {
    sfx.cardFlip();
    setRevealed((r) => (r.includes(id) ? r : [...r, id]));
  }, []);

  /** Bring one prompt to the front: its own volume, unfiltered, spotlit. */
  const jumpTo = useCallback(
    (id: string) => {
      const vol = volumeIdOf(id, interview.custom);
      if (vol) setVolId(vol);
      setQuery("");
      setMode("all");
      setSpotlight(id);
    },
    [interview.custom]
  );

  /* ------------------------------------------------------ their questions */

  const addOwnQuestion = () => {
    const q = newQ.trim();
    if (!q) return;
    sfx.paperTear();
    const id = uid("cus");
    onChange((prev) => ({
      ...prev,
      custom: [...prev.custom, { id, volume: volId, q, long: q.length > 46 || q.endsWith("?") }],
    }));
    onFlush();
    setNewQ("");
    setSpotlight(id);
  };

  const deleteOwnQuestion = useCallback(
    (id: string) => {
      onGlitch();
      onChange((prev) => {
        const answers2 = { ...prev.answers };
        delete answers2[id];
        return {
          ...prev,
          answers: answers2,
          custom: prev.custom.filter((c) => c.id !== id),
          pinned: prev.pinned.filter((p) => p !== id),
        };
      });
      onFlush();
    },
    [onChange, onFlush, onGlitch]
  );

  /* ----------------------------------------------------------- polygraph */

  const onRecord = useMemo(() => livePrompts.filter((p) => isFilled(p.id)), [livePrompts, isFilled]);

  const startPolygraph = () => {
    if (onRecord.length < 3) {
      sfx.alarm();
      setPgNotice(
        "The machine needs at least three answers on record before it can test you on them. Deal yourself a hand first."
      );
      return;
    }
    /* Fisher-Yates over a copy: taking the head of a sort-by-random draw is
       biased, and a biased draw shows up as the same questions every night. */
    const pool = onRecord.slice();
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setPgNotice(null);
    sfx.scan();
    setPgSeed(
      pool.slice(0, Math.min(PG_ROUNDS, pool.length)).map((prompt) => ({
        prompt,
        truth: answers[prompt.id] ?? "",
        guess: "",
        verdict: null,
        score: 0,
      }))
    );
  };

  /* One write, at the end of a test - not per round. This panel is the
     largest row in the vault, and a debounced save per question would push
     the whole answer map up the wire seven times for a game. */
  const finishPolygraph = useCallback(
    (finalPct: number) => {
      onChange((prev) => ({
        ...prev,
        polygraph: {
          tests: prev.polygraph.tests + 1,
          best: Math.max(prev.polygraph.best, finalPct),
          last: finalPct,
          lastAt: new Date().toISOString(),
        },
      }));
      onFlush();
    },
    [onChange, onFlush]
  );

  /* --------------------------------------------------------------- deck */

  const deckList = useMemo(
    () => (deckAll ? livePrompts : volumePrompts),
    [deckAll, livePrompts, volumePrompts]
  );

  const openDeck = (all: boolean) => {
    const list = all ? livePrompts : volumePrompts;
    if (list.length === 0) return;
    /* Open on the first thing not yet answered - being handed a question you
       have already done is the fastest way to make this feel like a form. */
    const firstBlank = list.findIndex((p) => !isFilled(p.id));
    sfx.paperTear();
    setDeckAll(all);
    setDeckIdx(firstBlank >= 0 ? firstBlank : 0);
    setDeckOpen(true);
  };

  const deckStep = (dir: -1 | 1) => {
    sfx.cardFlip();
    setDeckIdx((i) => {
      const n = deckList.length;
      return n === 0 ? 0 : (i + dir + n) % n;
    });
  };

  const deckShuffle = () => {
    if (deckList.length === 0) return;
    sfx.paperTear();
    setDeckIdx(Math.floor(Math.random() * deckList.length));
  };

  const deckNextBlank = () => {
    const n = deckList.length;
    if (n === 0) return;
    for (let step = 1; step <= n; step += 1) {
      const idx = (deckIdx + step) % n;
      if (!isFilled(deckList[idx].id)) {
        sfx.cardFlip();
        setDeckIdx(idx);
        return;
      }
    }
    sfx.bloom();
  };

  const closeDeck = () => {
    setDeckOpen(false);
    onFlush();
  };

  /* Escape closes the deck; arrows page it. */
  useEffect(() => {
    if (!deckOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "TEXTAREA";
      if (e.key === "Escape") closeDeck();
      if (!typing && e.key === "ArrowRight") deckStep(1);
      if (!typing && e.key === "ArrowLeft") deckStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckOpen, deckList.length]);

  /* ------------------------------------------------------------ draw one */

  const drawCard = () => {
    const blanks = livePrompts.filter((p) => !isFilled(p.id));
    if (blanks.length === 0) {
      sfx.bloom();
      setSpotlight(null);
      return;
    }
    const pick = blanks[Math.floor(Math.random() * blanks.length)];
    sfx.paperTear();
    jumpTo(pick.id);
  };

  const spotlitPrompt = spotlight ? promptById.get(spotlight) : undefined;
  const pct = totalCount ? Math.round((answeredCount / totalCount) * 100) : 0;
  const deckPrompt = deckList[deckIdx];
  const pgRecord = interview.polygraph;

  return (
    <section className="dsr-panel dsr-interview" aria-labelledby="dsr-iv-head">
      <div className="dsr-panel-head">
        <h2 id="dsr-iv-head" className="dsr-panel-title">
          The Field Interview
        </h2>
        <span className="dsr-panel-kicker">SUBJECT PROFILE &middot; VOLS. I&ndash;VI</span>
      </div>

      <p className="dsr-iv-lede">
        {TOTAL_PROMPTS} questions about one person, and room for your own. Nobody
        fills this in one sitting &mdash; that is the point. Deal yourself a hand
        when you are together, and once there is something on record, let the
        machine test how much of it you were actually listening to.
      </p>

      {/* Until the panel is read, every tally below would read zero, which is
          indistinguishable from "you have answered nothing". Show nothing
          rather than something false. */}
      {loading ? (
        <p className="dsr-iv-loading" role="status">
          Retrieving transcript&hellip;
        </p>
      ) : (
        <>
          <div className="dsr-iv-meter">
            <div className="dsr-iv-meter-bar">
              <span className="dsr-iv-meter-fill" style={{ width: pct + "%" }} />
            </div>
            <span className="dsr-iv-meter-read">
              {answeredCount} / {totalCount} ON RECORD &middot; {pct}%
            </span>
          </div>

          {/* The polygraph is the headline, so it gets its own plate on the
              sheet rather than becoming a fifth identical button in the row
              underneath it. */}
          <div className="dsr-pg-callout">
            <div className="dsr-pg-callout-text">
              <span className="dsr-pg-callout-kicker">EARTH-616 VERIFICATION UNIT</span>
              <h3 className="dsr-pg-callout-title">The Polygraph</h3>
              <p className="dsr-pg-callout-lede">
                {PG_ROUNDS} questions they have already answered. You state what you
                think they said, the machine puts the two statements side by side, and
                somebody gets stamped.
              </p>
              {pgRecord.tests > 0 && (
                <p className="dsr-pg-callout-record">
                  {pgRecord.tests} TEST{pgRecord.tests === 1 ? "" : "S"} ON FILE &middot; BEST{" "}
                  {pgRecord.best}% &middot; LAST {pgRecord.last}%
                </p>
              )}
            </div>
            <button type="button" className="dsr-pg-callout-btn" onClick={startPolygraph}>
              <span className="dsr-pg-callout-btn-dot" aria-hidden />
              Hook me up
            </button>
          </div>
          {pgNotice && <p className="dsr-error">{pgNotice}</p>}

          {/* the other ways to play this */}
          <div className="dsr-iv-modesbar">
            <button type="button" className="dsr-tool-btn dsr-iv-primary" onClick={() => openDeck(false)}>
              🎴 Interview mode
            </button>
            <button type="button" className="dsr-tool-btn" onClick={() => openDeck(true)}>
              ♾️ All volumes
            </button>
            <button type="button" className="dsr-tool-btn" onClick={drawCard}>
              🎲 Draw a blank one
            </button>
            <button
              type="button"
              className={"dsr-tool-btn dsr-iv-quiztoggle" + (quiz ? " is-on" : "")}
              aria-pressed={quiz}
              onClick={() => {
                sfx.dialClick();
                setQuiz((q) => !q);
                setRevealed([]);
              }}
            >
              {quiz ? "🙈 Quiz mode on" : "🧠 Quiz me"}
            </button>
          </div>

          {quiz && (
            <p className="dsr-iv-quiznote">
              Answers already on record are covered. Say yours out loud first, then tap
              the card to check.
            </p>
          )}

          {pinnedPrompts.length > 0 && (
            <div className="dsr-iv-highlights">
              <span className="dsr-field-label">Starred</span>
              <div className="dsr-iv-highlight-row">
                {pinnedPrompts.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className="dsr-iv-highlight"
                    onClick={() => jumpTo(p.id)}
                  >
                    <span className="dsr-iv-highlight-q">{p.q}</span>
                    <span className="dsr-iv-highlight-a">
                      {(answers[p.id] ?? "").trim() || "still blank"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* volume dividers */}
          <div className="dsr-iv-tabs" role="tablist" aria-label="Interview volumes">
            {INTERVIEW_VOLUMES.map((v) => {
              const c = volumeCounts[v.id];
              const done = c && c.total > 0 && c.done === c.total;
              return (
                <button
                  key={v.id}
                  role="tab"
                  type="button"
                  aria-selected={v.id === volId}
                  className={"dsr-tool-btn dsr-iv-tab" + (v.id === volId ? " is-on" : "")}
                  style={{ "--iv-ink": VOLUME_INK[v.id] } as CSSProperties}
                  onClick={() => {
                    sfx.dialClick();
                    setVolId(v.id);
                    setSpotlight(null);
                  }}
                >
                  <span className="dsr-iv-tab-mark" aria-hidden>
                    {v.mark}
                  </span>
                  <span className="dsr-iv-tab-text">
                    <span className="dsr-iv-tab-roman">{v.roman}</span>
                    <span className="dsr-iv-tab-title">{v.title}</span>
                  </span>
                  <span className={"dsr-iv-tab-count" + (done ? " is-done" : "")}>
                    {done ? "✓ ALL" : (c ? c.done + "/" + c.total : "")}
                  </span>
                </button>
              );
            })}
          </div>

          {/* controls */}
          <div className="dsr-iv-controls">
            <input
              className="dsr-input dsr-iv-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={"Search " + volume.title + "…"}
              aria-label={"Search prompts in " + volume.title}
            />
            <div className="dsr-iv-modes" role="group" aria-label="Filter prompts">
              {(["all", "filled", "blank"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={"dsr-tool-btn dsr-iv-mode" + (mode === m ? " is-on" : "")}
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                >
                  {m === "all" ? "All" : m === "filled" ? "On record" : "Blank"}
                </button>
              ))}
            </div>
          </div>

          {/* spotlight */}
          {spotlitPrompt && (
            <div className="dsr-iv-spotlight" style={{ "--iv-ink": ink } as CSSProperties}>
              <div className="dsr-iv-spotlight-head">
                <span className="dsr-panel-kicker">ONE QUESTION &middot; ANSWER IT TOGETHER</span>
                <button
                  type="button"
                  className="dsr-iv-spotlight-x"
                  onClick={() => setSpotlight(null)}
                  aria-label="Dismiss this card"
                >
                  ✕
                </button>
              </div>
              <InterviewCard
                prompt={spotlitPrompt}
                value={answers[spotlitPrompt.id] ?? ""}
                pinned={interview.pinned.includes(spotlitPrompt.id)}
                ink={ink}
                spotlit
                onSet={setAnswer}
                onCommit={onFlush}
                onTogglePin={togglePin}
              />
            </div>
          )}

          {/* the volume itself */}
          <div className="dsr-iv-volhead" style={{ "--iv-ink": ink } as CSSProperties}>
            <span className="dsr-iv-volroman">{volume.roman}</span>
            <div className="dsr-iv-volheadtext">
              <h3 className="dsr-iv-voltitle">{volume.title}</h3>
              <span className="dsr-panel-kicker">{volume.kicker}</span>
            </div>
          </div>

          {/* their own question */}
          <div className="dsr-iv-addrow">
            <input
              className="dsr-input dsr-iv-addinput"
              value={newQ}
              onChange={(e) => setNewQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOwnQuestion();
                }
              }}
              placeholder={"Add your own question to " + volume.title + "…"}
              aria-label={"Add your own question to " + volume.title}
            />
            <button
              type="button"
              className="dsr-tool-btn"
              onClick={addOwnQuestion}
              disabled={!newQ.trim()}
            >
              + Add
            </button>
          </div>

          {visible.length === 0 ? (
            <p className="dsr-iv-empty">
              {mode === "blank"
                ? "Every prompt in this volume is on record. All of it."
                : mode === "filled"
                  ? "Nothing answered in this volume yet — deal yourself a hand and start it."
                  : "No prompt here matches that search."}
            </p>
          ) : (
            <div className="dsr-iv-grid">
              {visible.map((p) => (
                <InterviewCard
                  key={p.id}
                  prompt={p}
                  value={answers[p.id] ?? ""}
                  pinned={interview.pinned.includes(p.id)}
                  ink={ink}
                  quiz={quiz}
                  revealed={revealed.includes(p.id)}
                  onSet={setAnswer}
                  onCommit={onFlush}
                  onTogglePin={togglePin}
                  onReveal={reveal}
                  onDelete={deleteOwnQuestion}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* --------------------------------------------------- the polygraph */}
      {pgSeed && (
        <PolygraphTest
          seed={pgSeed}
          previousBest={pgRecord.best}
          isStarred={(id) => interview.pinned.includes(id)}
          onStar={togglePin}
          onJump={(id) => {
            setPgSeed(null);
            jumpTo(id);
          }}
          onFinish={finishPolygraph}
          onClose={() => setPgSeed(null)}
        />
      )}

      {/* ------------------------------------------------------- the deck */}
      {deckOpen && deckPrompt && (
        <ChapterOverlay>
        <div className="dsr-iv-deck" role="dialog" aria-modal="true" aria-label="Interview mode">
          <div
            className="dsr-iv-deck-card"
            style={
              {
                "--iv-ink":
                  VOLUME_INK[
                    (volumeOfPrompt(deckPrompt.id) ?? { id: volId }).id ?? volId
                  ] ?? ink,
              } as CSSProperties
            }
          >
            <div className="dsr-iv-deck-head">
              <span className="dsr-panel-kicker">
                {deckAll ? "ALL VOLUMES" : volume.title.toUpperCase()} &middot;{" "}
                {deckIdx + 1} / {deckList.length}
              </span>
              <button
                type="button"
                className="dsr-iv-spotlight-x"
                onClick={closeDeck}
                aria-label="Close interview mode"
              >
                ✕
              </button>
            </div>

            <p className="dsr-iv-deck-q">{deckPrompt.q}</p>

            <textarea
              className="dsr-textarea dsr-iv-deck-input"
              rows={4}
              value={answers[deckPrompt.id] ?? ""}
              placeholder="Say it out loud, then write it down…"
              onChange={(e) => setAnswer(deckPrompt.id, e.target.value)}
              onBlur={onFlush}
            />

            <div className="dsr-iv-deck-foot">
              <button type="button" className="dsr-tool-btn" onClick={() => deckStep(-1)}>
                ← Back
              </button>
              <button type="button" className="dsr-tool-btn" onClick={deckShuffle}>
                🔀 Shuffle
              </button>
              <button type="button" className="dsr-tool-btn" onClick={deckNextBlank}>
                ⏭ Next blank
              </button>
              <button type="button" className="dsr-tool-btn dsr-iv-primary" onClick={() => deckStep(1)}>
                Next →
              </button>
            </div>
          </div>
        </div>
        </ChapterOverlay>
      )}
    </section>
  );
}

/* ============================================================================
   THE CHAPTER
   ========================================================================== */

interface DossierScreenProps {
  userId: string;
  onBack: () => void;
}

export default function DossierScreen({ userId, onBack }: DossierScreenProps) {
  const identity = usePanel<Identity>(userId, "identity", EMPTY_IDENTITY, 900, migrateIdentity);
  const vibe = usePanel<Vibe>(userId, "vibe", EMPTY_VIBE);
  const corkboard = usePanel<Corkboard>(userId, "corkboard", EMPTY_CORKBOARD, 700);
  const quirks = usePanel<Quirks>(userId, "quirks", EMPTY_QUIRKS);
  const protocols = usePanel<Protocols>(userId, "protocols", EMPTY_PROTOCOLS);
  const quoteStrip = usePanel<QuoteStripData>(userId, "quotes", EMPTY_QUOTE_STRIP);
  const travelogue = usePanel<Travelogue>(userId, "travelogue", EMPTY_TRAVELOGUE, 700);
  const sizing = usePanel<SizingBlueprintData>(userId, "sizing", EMPTY_SIZING);
  const peeveIndex = usePanel<PeeveIndexData>(userId, "peeves", EMPTY_PEEVE_INDEX);
  const timeCapsule = usePanel<TimeCapsuleData>(userId, "capsule", EMPTY_TIME_CAPSULE);
  /* Longer debounce than the rest: this panel is typed into continuously, and
     every keystroke would otherwise queue a rewrite of the whole interview. */
  const interview = usePanel<InterviewData>(userId, "interview", EMPTY_INTERVIEW, 1100, migrateInterview);

  const rootRef = useRef<HTMLElement>(null);
  const [muted, setMutedState] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [chaos, setChaos] = useState(false);
  const [glitching, setGlitching] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  /* Read on mount, not during render: the audio module reads localStorage,
     which does not exist on the server. */
  useEffect(() => {
    setMutedState(sfx.isMuted());
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const on = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  /* ------------------------------------------------------ dimension glitch */

  /* A cancelled form, a deleted note, a card dropped: the colour registration
     slips for a moment, like a comic printed slightly out of alignment. */
  const glitch = useCallback(() => {
    sfx.glitch();
    setGlitching(true);
    window.setTimeout(() => setGlitching(false), 340);
  }, []);

  /* ----------------------------------------------------------- theme bleed */

  /* The chapter's ambient colour follows the vibe reading: electric magenta
     when they are hyped, indigo when they are drained, hazard yellow when the
     danger flag is up. Written as CSS custom properties straight onto the root
     node, so dragging the battery slider repaints the whole chapter without
     re-rendering a single panel. */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const b = vibe.value.battery;
    const accent = vibe.value.danger
      ? "#F2C14E"
      : b > 72
        ? "#FF3DC8"
        : b > 42
          ? "#3FE0F0"
          : "#7B6BF0";
    const wash = vibe.value.danger
      ? "rgba(242,193,78,.16)"
      : b > 72
        ? "rgba(255,61,200,.15)"
        : b > 42
          ? "rgba(63,224,240,.11)"
          : "rgba(123,107,240,.16)";

    el.style.setProperty("--dsr-accent", accent);
    el.style.setProperty("--dsr-wash", wash);
  }, [vibe.value.battery, vibe.value.danger]);

  /* -------------------------------------------------------- chaos spikes -- */

  const fireChaos = useCallback(() => {
    sfx.alarm();
    setChaos(true);
    window.setTimeout(() => setChaos(false), 900);
  }, []);

  /* ----------------------------------------------- upside-down kiss mode -- */

  /* Held, not clicked: three seconds on the little spider in the corner. A
     click would be far too easy to hit by accident for something that turns
     the entire chapter over. */
  const holdTimer = useRef<number | null>(null);
  const holdRaf = useRef<number | null>(null);

  const endHold = useCallback(() => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    if (holdRaf.current !== null) cancelAnimationFrame(holdRaf.current);
    holdTimer.current = null;
    holdRaf.current = null;
    setHoldProgress(0);
  }, []);

  const beginHold = () => {
    /* whoosh() only fires 3s from now, inside the timeout below - priming the
       context synchronously here, inside the real pointerdown gesture, is
       what lets that delayed sound actually play on mobile Safari. */
    sfx.primeAudio();
    const started = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - started) / 3000);
      setHoldProgress(p);
      if (p < 1) holdRaf.current = requestAnimationFrame(tick);
    };
    holdRaf.current = requestAnimationFrame(tick);

    holdTimer.current = window.setTimeout(() => {
      sfx.whoosh();
      setFlipped((f) => !f);
      setHoldProgress(0);
    }, 3000);
  };

  useEffect(() => endHold, [endHold]);

  /* ---------------------------------------------- thwip-and-stick cursor -- */

  /* A web reticle that shoots a thread at whatever is under the pointer.
     Written straight onto the SVG nodes inside one rAF and never through React
     state - this runs on every pointermove, and a re-render per frame would
     make the whole chapter feel like treacle.

     Skipped on touch (there is no hover to draw from) and under
     prefers-reduced-motion. */
  const cursorRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (reduceMotion || typeof window === "undefined") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const svg = cursorRef.current;
    if (!svg) return;

    const dot = svg.querySelector<SVGCircleElement>(".dsr-cursor-dot");
    const line = svg.querySelector<SVGLineElement>(".dsr-cursor-line");
    const ring = svg.querySelector<SVGCircleElement>(".dsr-cursor-ring");
    if (!dot || !line || !ring) return;

    let px = -100;
    let py = -100;
    let anchor: { x: number; y: number } | null = null;
    let raf: number | null = null;

    const paint = () => {
      raf = null;
      dot.setAttribute("cx", String(px));
      dot.setAttribute("cy", String(py));
      ring.setAttribute("cx", String(px));
      ring.setAttribute("cy", String(py));

      if (anchor) {
        line.setAttribute("x1", String(px));
        line.setAttribute("y1", String(py));
        line.setAttribute("x2", String(anchor.x));
        line.setAttribute("y2", String(anchor.y));
        line.setAttribute("opacity", "0.5");
        ring.setAttribute("r", "13");
      } else {
        line.setAttribute("opacity", "0");
        ring.setAttribute("r", "9");
      }
    };

    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;

      const target = e.target as Element | null;
      const stick = target?.closest?.("button, a, input, textarea, select, .dsr-artifact");
      if (stick) {
        const r = stick.getBoundingClientRect();
        anchor = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      } else {
        anchor = null;
      }

      if (raf === null) raf = requestAnimationFrame(paint);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [reduceMotion]);

  /* ----------------------------------------------------------- leaving --- */

  /* Anything still sitting in a debounce timer is written before the chapter
     unmounts, so walking out mid-edit never costs a change. */
  const leave = () => {
    identity.flush();
    vibe.flush();
    corkboard.flush();
    quirks.flush();
    protocols.flush();
    quoteStrip.flush();
    travelogue.flush();
    sizing.flush();
    peeveIndex.flush();
    timeCapsule.flush();
    interview.flush();
    sfx.stopAmbient();
    onBack();
  };

  const loading =
    identity.loading ||
    vibe.loading ||
    corkboard.loading ||
    quirks.loading ||
    protocols.loading ||
    quoteStrip.loading ||
    travelogue.loading ||
    sizing.loading ||
    peeveIndex.loading ||
    timeCapsule.loading;

  const panelError =
    identity.error ??
    vibe.error ??
    corkboard.error ??
    quirks.error ??
    protocols.error ??
    quoteStrip.error ??
    travelogue.error ??
    sizing.error ??
    peeveIndex.error ??
    timeCapsule.error ??
    interview.error;

  const busySaving =
    identity.saving ||
    vibe.saving ||
    corkboard.saving ||
    quirks.saving ||
    protocols.saving ||
    quoteStrip.saving ||
    travelogue.saving ||
    sizing.saving ||
    peeveIndex.saving ||
    timeCapsule.saving ||
    interview.saving;

  /* A full takeover, not just a spinner in the content area - the same
     "gate the whole chapter behind something on-theme" convention every
     other chapter's first paint uses, sized to match how much visual
     identity this one actually has. */
  if (loading) {
    return (
      <main className="dsr-root dsr-boot-root">
        <style>{DOSSIER_CSS}</style>
        <DossierDefs />
        <div className="dsr-bg" aria-hidden />
        <div className="dsr-grid" aria-hidden />
        <div className="dsr-boot">
          <ThumbScanner active size={92} />
          <p className="dsr-boot-title">Decrypting file&hellip;</p>
          <p className="dsr-boot-sub">CLASSIFIED &middot; SUBJECT: EARTH-65</p>
          <div className="dsr-boot-bar" aria-hidden>
            <span />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      ref={rootRef}
      className={
        "dsr-root" +
        (flipped ? " is-flipped" : "") +
        (glitching ? " is-glitching" : "") +
        (chaos ? " is-chaos" : "")
      }
    >
      <style>{DOSSIER_CSS}</style>
      <DossierDefs />

      <div className="dsr-bg" aria-hidden />
      <div className="dsr-grid" aria-hidden />

      <header className="dsr-chrome">
        <button type="button" className="dsr-back" onClick={leave}>
          <ArrowLeft className="w-4 h-4" aria-hidden />
          Back to the book
        </button>

        <div className="dsr-chrome-right">
          {busySaving && <span className="dsr-saving">FILING&hellip;</span>}
          <button
            type="button"
            className="dsr-icon-btn"
            onClick={() => {
              const next = !muted;
              sfx.setMuted(next);
              setMutedState(next);
              if (!next) sfx.dialClick();
            }}
            aria-pressed={muted}
            aria-label={muted ? "Turn sound on" : "Turn sound off"}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <div className="dsr-title-block">
        <span className="dsr-eyebrow">CLASSIFIED &middot; PERSONNEL DOSSIER</span>
        <h1 className="dsr-title">Subject: Earth-65</h1>
        <p className="dsr-lede">
          Everything worth knowing that isn&apos;t a date, a song or a wish &mdash; those already
          have chapters of their own. This one is just them.
        </p>
      </div>

      {panelError && (
        <p className="dsr-error dsr-error-wide" role="alert">
          {panelError}
        </p>
      )}

      <div className="dsr-stack">
          <HeroBadge identity={identity.value} onChange={identity.update} onFlush={identity.flush} />

          <VibeRadar
            vibe={vibe.value}
            onChange={vibe.update}
            onFlush={vibe.flush}
            onChaos={fireChaos}
          />

          <Corkboard
            board={corkboard.value}
            onChange={corkboard.update}
            onFlush={corkboard.flush}
            onGlitch={glitch}
            flipped={flipped}
          />

          <QuirkMatrix
            quirks={quirks.value}
            onChange={quirks.update}
            onFlush={quirks.flush}
            onGlitch={glitch}
          />

          <ProtocolFolder
            protocols={protocols.value}
            onChange={protocols.update}
            onFlush={protocols.flush}
          />

          <QuoteStrip
            quotes={quoteStrip.value}
            onChange={quoteStrip.update}
            onFlush={quoteStrip.flush}
            onGlitch={glitch}
          />

          <Travelogue
            travelogue={travelogue.value}
            onChange={travelogue.update}
            onFlush={travelogue.flush}
            onGlitch={glitch}
          />

          <SizingBlueprint sizing={sizing.value} onChange={sizing.update} onFlush={sizing.flush} />

          <PeeveIndex
            peeves={peeveIndex.value}
            onChange={peeveIndex.update}
            onFlush={peeveIndex.flush}
            onGlitch={glitch}
          />

          <TimeCapsule
            capsule={timeCapsule.value}
            onChange={timeCapsule.update}
            onFlush={timeCapsule.flush}
            onGlitch={glitch}
          />

          {/* Deliberately NOT part of the chapter-wide `loading` gate above:
              it is the largest panel and the last section on the page, so
              waiting on it would delay everything above it for nothing. It
              reports its own retrieval state instead. */}
          <FieldInterview
            interview={interview.value}
            loading={interview.loading}
            onChange={interview.update}
            onFlush={interview.flush}
            onGlitch={glitch}
          />
        </div>

      {chaos && (
        <div className="dsr-spikes" aria-hidden>
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              className="dsr-spike"
              style={
                { "--a": `${(i / 14) * 360}deg`, animationDelay: `${i * 0.012}s` } as CSSProperties
              }
            />
          ))}
          <span className="dsr-thwip-word">THWIP!</span>
        </div>
      )}

      <button
        type="button"
        className="dsr-flip-spider"
        onPointerDown={beginHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        aria-label="Hold for three seconds to turn the dossier upside down"
        title="Hold me"
      >
        <SpiderMark size={22} />
        <span className="dsr-flip-ring" style={{ "--p": holdProgress } as CSSProperties} aria-hidden />
      </button>

      <svg className="dsr-cursor" ref={cursorRef} aria-hidden>
        <line className="dsr-cursor-line" x1="0" y1="0" x2="0" y2="0" opacity="0" />
        <circle className="dsr-cursor-ring" cx="-100" cy="-100" r="9" />
        <circle className="dsr-cursor-dot" cx="-100" cy="-100" r="2.4" />
      </svg>
    </main>
  );
}

/* ============================================================================
   SCOPED STYLES
   ----------------------------------------------------------------------------
   Kept in this file rather than globals.css, per the house rule: a chapter
   should be droppable on its own without dragging shared CSS behind it.

   NOTE FOR ANY FUTURE EDIT: this is a template literal. A single backtick
   anywhere inside it silently terminates the string and produces a wall of
   TypeScript errors nowhere near the real line. Do not quote CSS property
   names in backticks in these comments.
   ========================================================================== */

const DOSSIER_CSS = `
.dsr-root {
  --dsr-ink: #0D1116;
  --dsr-ink-2: #151B23;
  --dsr-line: #26313C;
  --dsr-manila: #D8C69B;
  --dsr-manila-2: #C4AE7E;
  --dsr-paper: #F0E7D2;
  --dsr-cyan: #3FE0F0;
  --dsr-magenta: #FF3DC8;
  --dsr-text: #E7EDF3;
  --dsr-dim: #93A3B2;
  --dsr-accent: #3FE0F0;
  --dsr-wash: rgba(63, 224, 240, .11);
  --dsr-mono: 'Courier New', Courier, monospace;

  position: relative;
  min-height: 100vh;
  min-height: 100svh;
  padding: 0 clamp(12px, 3vw, 34px) 120px;
  color: var(--dsr-text);
  overflow-x: hidden;
  transition: rotate 780ms cubic-bezier(.5, 0, .2, 1);
}

/* Upside-down kiss mode. The whole chapter turns over; drag handlers negate
   their deltas to match (see startDrag) so pins still follow the cursor. */
.dsr-root.is-flipped { rotate: 180deg; }

/* Registration slip - the two colour plates pull apart for a moment. */
@keyframes dsr-registration {
  0%   { transform: translate(0, 0); filter: none; }
  25%  { transform: translate(-3px, 1px); filter: url(#dsr-aberration); }
  55%  { transform: translate(4px, -2px); }
  100% { transform: translate(0, 0); filter: none; }
}
.dsr-root.is-glitching .dsr-stack { animation: dsr-registration 340ms steps(4, end); }

@keyframes dsr-shake {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-7px, 3px); }
  40% { transform: translate(6px, -4px); }
  60% { transform: translate(-4px, -2px); }
  80% { transform: translate(3px, 4px); }
}
.dsr-root.is-chaos .dsr-stack { animation: dsr-shake 420ms ease-in-out 2; }

/* ------------------------------------------------------------- backdrop -- */

.dsr-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(120% 90% at 50% -10%, var(--dsr-wash), transparent 62%),
    radial-gradient(80% 60% at 100% 100%, rgba(255,61,200,.07), transparent 60%),
    linear-gradient(#0A0E13, #10161D 55%, #0A0E13);
  transition: background 600ms ease;
}

/* Drafting gridlines plus a comic halftone, on ONE element - each additional
   full-viewport layer is another surface the compositor blends every paint. */
.dsr-grid {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: .5;
  background-image:
    radial-gradient(rgba(255,255,255,.055) 1px, transparent 1px),
    linear-gradient(rgba(63,224,240,.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(63,224,240,.06) 1px, transparent 1px);
  background-size: 5px 5px, 44px 44px, 44px 44px;
}

/* --------------------------------------------------------------- chrome -- */

.dsr-chrome {
  position: relative;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 0 10px;
}

.dsr-chrome-right { display: flex; align-items: center; gap: 10px; }

.dsr-back, .dsr-icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  background: rgba(21, 27, 35, .82);
  border: 1.5px solid var(--dsr-line);
  border-radius: 10px;
  color: var(--dsr-text);
  font-family: var(--dsr-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: border-color 140ms ease, color 140ms ease, transform 120ms ease;
}
.dsr-back:hover, .dsr-icon-btn:hover { border-color: var(--dsr-accent); color: var(--dsr-accent); }
.dsr-back:active, .dsr-icon-btn:active { transform: translateY(1px); }
.dsr-icon-btn { padding: 9px; }

.dsr-saving {
  font-family: var(--dsr-mono);
  font-size: 10px;
  letter-spacing: .18em;
  color: var(--dsr-accent);
  animation: dsr-pulse 1.1s ease-in-out infinite;
}
@keyframes dsr-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }

.dsr-title-block { position: relative; z-index: 10; max-width: 780px; margin: 10px auto 26px; text-align: center; }

.dsr-eyebrow {
  display: inline-block;
  padding: 4px 12px;
  border: 1.5px solid var(--dsr-accent);
  border-radius: 999px;
  font-family: var(--dsr-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .24em;
  color: var(--dsr-accent);
}

.dsr-title {
  margin: 10px 0 6px;
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(2rem, 6vw, 3.4rem);
  line-height: 1;
  color: #FFF;
  text-shadow: 3px 3px 0 rgba(255,61,200,.55), -3px -2px 0 rgba(63,224,240,.45);
}

.dsr-lede {
  margin: 0 auto;
  max-width: 56ch;
  font-family: 'Caveat', cursive;
  font-size: 1.25rem;
  line-height: 1.35;
  color: var(--dsr-dim);
}

.dsr-boot-root { display: grid; place-items: center; min-height: 100svh; }
.dsr-boot {
  position: relative;
  z-index: 10;
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 40px;
}
.dsr-boot-title {
  margin: 4px 0 0;
  font-family: 'Permanent Marker', cursive;
  font-size: 1.4rem;
  color: var(--dsr-text);
  letter-spacing: .02em;
}
.dsr-boot-sub {
  margin: 0;
  font-family: var(--dsr-mono);
  font-size: 10px;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--dsr-dim);
}
.dsr-boot-bar {
  width: min(220px, 60vw);
  height: 4px;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(255, 255, 255, .08);
  border: 1px solid var(--dsr-line);
}
.dsr-boot-bar span {
  display: block;
  height: 100%;
  width: 40%;
  border-radius: 4px;
  background: var(--dsr-accent);
  animation: dsr-boot-sweep 1.1s ease-in-out infinite;
}
@keyframes dsr-boot-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}
@media (prefers-reduced-motion: reduce) {
  .dsr-boot-bar span { animation: none; width: 100%; transform: none; }
}

/* ---------------------------------------------------------------- panels -- */

.dsr-stack {
  position: relative;
  z-index: 10;
  display: grid;
  gap: clamp(22px, 4vw, 40px);
  max-width: 1080px;
  margin: 0 auto;
}

/* Frosted HUD glass. The border glow is the accent, so every panel picks up
   the vibe reading without any of them knowing about it. */
.dsr-panel {
  position: relative;
  padding: clamp(16px, 3vw, 26px);
  background: rgba(19, 25, 32, .74);
  border: 1.5px solid var(--dsr-line);
  border-radius: 16px;
  backdrop-filter: blur(9px);
  box-shadow:
    0 0 0 1px rgba(255,255,255,.03) inset,
    0 18px 44px rgba(0,0,0,.45),
    0 0 28px -14px var(--dsr-accent);
  transition: box-shadow 500ms ease;
}

/* .dsr-stack is a grid, so every panel is a grid item and defaults to
   min-width:auto - it will not shrink below its widest content. Any panel
   holding something that does not wrap (a horizontally scrolling strip, a
   wide table, a long unbroken string) therefore inflates past the viewport,
   and .dsr-root's overflow-x:hidden means that shows up as content silently
   sliced off the right edge on a phone rather than as a scrollbar. Releasing
   it here covers every panel, present and future. */
.dsr-panel { min-width: 0; }

.dsr-panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1.5px solid var(--dsr-line);
}

.dsr-panel-title {
  margin: 0;
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(1.25rem, 3vw, 1.7rem);
  color: #FFF;
}

.dsr-panel-kicker {
  font-family: var(--dsr-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .2em;
  color: var(--dsr-accent);
}

.dsr-field-label {
  display: block;
  font-family: var(--dsr-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--dsr-dim);
  margin-bottom: 4px;
}

.dsr-input, .dsr-textarea, .dsr-select {
  width: 100%;
  padding: 8px 10px;
  background: rgba(9, 13, 18, .72);
  border: 1.5px solid var(--dsr-line);
  border-radius: 8px;
  color: var(--dsr-text);
  font-family: var(--dsr-mono);
  font-size: 12.5px;
  outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.dsr-textarea { resize: vertical; line-height: 1.45; }
.dsr-input:focus, .dsr-textarea:focus, .dsr-select:focus {
  border-color: var(--dsr-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsr-accent) 22%, transparent);
}
.dsr-input::placeholder, .dsr-textarea::placeholder { color: rgba(147,163,178,.45); }

.dsr-tool-btn, .dsr-toggle, .dsr-kind, .dsr-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  background: rgba(21, 27, 35, .9);
  border: 1.5px solid var(--dsr-line);
  border-radius: 9px;
  color: var(--dsr-text);
  font-family: var(--dsr-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 120ms ease, border-color 140ms ease, background-color 140ms ease;
}
.dsr-tool-btn:hover, .dsr-toggle:hover, .dsr-kind:hover, .dsr-tab:hover {
  border-color: var(--dsr-accent);
  transform: translateY(-1px);
}
.dsr-tool-btn:active { transform: translateY(1px); }
.dsr-tool-btn:disabled { opacity: .45; cursor: not-allowed; transform: none; }

.dsr-tool-btn[data-on="true"], .dsr-toggle[data-on="true"], .dsr-tab[data-on="true"] {
  background: var(--dsr-accent);
  border-color: var(--dsr-accent);
  color: #080C11;
}

.dsr-error, .dsr-note {
  margin: 8px 0 0;
  font-family: var(--dsr-mono);
  font-size: 10.5px;
  letter-spacing: .04em;
}
.dsr-error { color: #FF8DA8; }
.dsr-note { color: var(--dsr-dim); }
.dsr-error-wide { position: relative; z-index: 10; max-width: 1080px; margin: 0 auto 16px; text-align: center; }

/* =============================================== 1. HERO IDENTIFICATION === */

.dsr-badge-panel { padding-top: 34px; overflow: visible; }

.dsr-badge-pin {
  position: absolute;
  top: -20px;
  left: 50%;
  translate: -50% 0;
  z-index: 4;
  filter: drop-shadow(0 6px 8px rgba(0,0,0,.6));
}

/* Translucent washi, not opaque tape - the HUD reads through it. */
.dsr-washi {
  position: absolute;
  width: 108px;
  height: 26px;
  z-index: 3;
  background: repeating-linear-gradient(
    -50deg,
    rgba(255,61,200,.30) 0 7px,
    rgba(63,224,240,.24) 7px 14px
  );
  border-left: 1px dashed rgba(255,255,255,.25);
  border-right: 1px dashed rgba(255,255,255,.25);
  pointer-events: none;
}
.dsr-washi-a { top: -11px; left: 8%; rotate: -7deg; }
.dsr-washi-b { top: -9px; right: 9%; rotate: 6deg; }

/* The flip. perspective on the shell, preserve-3d on the card, and NO
   backface-visibility on the wrapper - putting it there is what breaks a 3D
   flip mid-turn (learned the hard way on the table-of-contents page flip). */
.dsr-badge { position: relative; perspective: 1600px; }

.dsr-badge-face {
  transition: transform 620ms cubic-bezier(.4, .05, .2, 1);
  transform-style: preserve-3d;
  backface-visibility: hidden;
}

.dsr-badge-front { transform: rotateY(0deg); }
.dsr-badge-back {
  position: absolute;
  inset: 0;
  transform: rotateY(180deg);
  background: linear-gradient(160deg, #1A1219, #241722);
  border: 1.5px solid rgba(255,61,200,.4);
  border-radius: 12px;
  padding: 16px;
  overflow: auto;
}
.dsr-badge.is-flipped .dsr-badge-front { transform: rotateY(-180deg); }
.dsr-badge.is-flipped .dsr-badge-back { transform: rotateY(0deg); }

.dsr-badge-head { text-align: center; margin-bottom: 14px; }
.dsr-badge-org {
  font-family: var(--dsr-mono);
  font-size: 9px;
  letter-spacing: .26em;
  color: var(--dsr-cyan);
}
.dsr-badge-org-alt { color: var(--dsr-magenta); }
.dsr-badge-title {
  margin: 4px 0 2px;
  font-family: 'Permanent Marker', cursive;
  font-size: 1.5rem;
  color: #FFF;
}
.dsr-badge-sub {
  font-family: var(--dsr-mono);
  font-size: 10px;
  letter-spacing: .2em;
  color: var(--dsr-dim);
}

.dsr-badge-body { display: grid; grid-template-columns: 1fr; gap: 18px; }
@media (min-width: 720px) { .dsr-badge-body { grid-template-columns: 190px 1fr; } }

.dsr-portrait-col { display: grid; gap: 12px; justify-items: center; }

.dsr-portrait {
  position: relative;
  width: 100%;
  max-width: 190px;
  aspect-ratio: 3 / 4;
  padding: 0;
  overflow: hidden;
  background: rgba(9,13,18,.8);
  border: 1.5px solid var(--dsr-line);
  border-radius: 10px;
  cursor: pointer;
}
.dsr-portrait-img { width: 100%; height: 100%; object-fit: cover; display: block; transition: filter 220ms ease; }

/* Four-colour halftone plus a registration slip, on hover only - the filters
   are expensive enough that leaving them on permanently would cost every
   scroll frame. */
.dsr-portrait:hover .dsr-portrait-img { filter: url(#dsr-halftone) url(#dsr-aberration) contrast(1.15); }

.dsr-portrait-empty {
  display: grid;
  place-items: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  color: var(--dsr-dim);
  font-family: var(--dsr-mono);
  font-size: 10px;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.dsr-portrait-scan {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(rgba(0,0,0,.16) 0 1px, transparent 1px 3px);
  opacity: .5;
}

.dsr-portrait-replace {
  font-family: var(--dsr-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--dsr-dim);
  background: none;
  border: none;
  text-decoration: underline;
  cursor: pointer;
}
.dsr-portrait-replace:hover { color: var(--dsr-cyan); }

.dsr-portrait-adjust-sheet {
  position: relative;
  width: min(300px, 88vw);
  display: grid;
  gap: 10px;
  padding: 16px;
  background: var(--dsr-paper);
  border: 1px solid rgba(0,0,0,.35);
  box-shadow: 0 24px 60px rgba(0,0,0,.6);
  border-radius: 4px;
  color: #2A2119;
}
.dsr-portrait-adjust-frame {
  position: relative;
  width: 100%;
  max-width: 220px;
  aspect-ratio: 3 / 4;
  margin: 0 auto;
  overflow: hidden;
  border-radius: 8px;
  border: 1.5px solid rgba(0,0,0,.35);
  background: #14100F;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.dsr-portrait-adjust-frame:active { cursor: grabbing; }
.dsr-portrait-adjust-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  transition: transform 60ms linear;
}
.dsr-portrait-adjust-hint {
  text-align: center;
  font-family: var(--dsr-mono);
  font-size: 9px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: rgba(42,33,25,.6);
  margin: 0;
}
.dsr-portrait-adjust-zoom {
  display: grid;
  gap: 4px;
  font-family: var(--dsr-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.dsr-portrait-adjust-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
.dsr-portrait-adjust-sheet .dsr-tool-btn {
  background: rgba(0,0,0,.06);
  border-color: rgba(0,0,0,.3);
  color: #2A2119;
}

.dsr-scanner {
  display: grid;
  place-items: center;
  gap: 3px;
  padding: 6px 10px 8px;
  background: linear-gradient(#1A212A, #10161D);
  border: 1.5px solid var(--dsr-line);
  border-radius: 16px;
  box-shadow: 0 6px 0 rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.08);
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 160ms ease;
}
.dsr-scanner:hover { border-color: var(--dsr-cyan); }
.dsr-scanner:active, .dsr-scanner.is-scanning { transform: translateY(4px); box-shadow: 0 2px 0 rgba(0,0,0,.5); }
.dsr-scanner-label {
  font-family: var(--dsr-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .2em;
  color: var(--dsr-cyan);
}

/* 'top' in the keyframes, not transform: translateY() - percentages on
   transform resolve against the SCANLINE's own 42px height (a ~45px total
   travel), while percentages on 'top' resolve against the containing block
   (.dsr-badge-front, made one by its own transform: rotateY()), i.e. the
   full card. The line also had no base 'top' at all, so with no animation
   running its static position fell wherever it landed in normal flow -
   after the head/body/error blocks, right near the bottom of the card. Both
   together are why the scan only ever swept a sliver near the bottom
   instead of the whole dossier card. */
@keyframes dsr-scanline {
  from { top: -8%; opacity: 0; }
  12%  { opacity: 1; }
  to   { top: 108%; opacity: 0; }
}
.dsr-scanline {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 42px;
  pointer-events: none;
  background: linear-gradient(transparent, rgba(63,224,240,.5), transparent);
  box-shadow: 0 0 26px rgba(63,224,240,.7);
  animation: dsr-scanline 430ms linear both;
}

.dsr-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 0; }
.dsr-field { margin: 0; }

.dsr-field-headrow { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.dsr-field-label-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  border-bottom: 1px dashed var(--dsr-line);
  padding: 0 0 2px;
  font-family: var(--dsr-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--dsr-dim);
  outline: none;
}
.dsr-field-label-input:focus { color: var(--dsr-text); border-bottom-color: var(--dsr-accent); }
.dsr-field-x {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  border-radius: 5px;
  border: 1px solid var(--dsr-line);
  background: rgba(21, 27, 35, .7);
  color: var(--dsr-dim);
  cursor: pointer;
  opacity: 0;
  transition: opacity 130ms ease, color 130ms ease, border-color 130ms ease;
}
.dsr-field-x:hover { color: var(--dsr-accent); border-color: var(--dsr-accent); }
/* Hidden until the row it belongs to is actually being touched - hovered,
   tapped into (focus-within), or pressed (active covers a touch that hasn't
   lifted yet) - so a form full of fields doesn't read as a wall of x's. */
.dsr-field:hover .dsr-field-x, .dsr-field:focus-within .dsr-field-x, .dsr-field:active .dsr-field-x,
.dsr-sizing-field:hover .dsr-field-x, .dsr-sizing-field:focus-within .dsr-field-x, .dsr-sizing-field:active .dsr-field-x,
.dsr-peeve-item:hover .dsr-field-x, .dsr-peeve-item:focus-within .dsr-field-x, .dsr-peeve-item:active .dsr-field-x {
  opacity: 1;
}

.dsr-field-add {
  grid-column: 1 / -1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(21, 27, 35, .55);
  border: 1.5px dashed var(--dsr-line);
  border-radius: 8px;
  color: var(--dsr-dim);
  font-family: var(--dsr-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .08em;
  cursor: pointer;
}
.dsr-field-add:hover { color: var(--dsr-accent); border-color: var(--dsr-accent); }

.dsr-back-fields { display: grid; gap: 10px; }
.dsr-back-field { display: grid; }
.dsr-flip-back { margin-top: 12px; }

/* re-filing the card ---------------------------------------------------- */

.dsr-fields-col { min-width: 0; }

.dsr-fields-tools {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  margin: 0 0 9px;
}

.dsr-arrange-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 5px 11px;
  background: rgba(21, 27, 35, .9);
  border: 1.5px dashed var(--dsr-line);
  border-radius: 8px;
  color: var(--dsr-dim);
  font-family: var(--dsr-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease, background-color 140ms ease;
}
.dsr-arrange-btn:hover { color: var(--dsr-accent); border-color: var(--dsr-accent); }
.dsr-arrange-btn.is-on {
  background: var(--dsr-accent);
  border-style: solid;
  border-color: var(--dsr-accent);
  color: #080C11;
}

.dsr-arrange-hint {
  font-family: var(--dsr-mono);
  font-size: 9px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--dsr-dim);
}

/* A loose card sits slightly off-square, the way a photo does when it is not
   glued down yet. */
@keyframes dsr-loose {
  0%, 100% { rotate: -.55deg; }
  50%      { rotate: .55deg; }
}

.dsr-field.is-arranging {
  position: relative;
  padding: 9px 9px 7px;
  border: 1.5px dashed rgba(63, 224, 240, .55);
  border-radius: 10px;
  background: rgba(63, 224, 240, .06);
  cursor: grab;
  /* Without this a drag on a phone scrolls the page instead of moving the
     card - the same trap the letter jar pile hit. */
  touch-action: none;
  animation: dsr-loose 2.6s ease-in-out infinite;
}
.dsr-field.is-arranging:nth-child(even) { animation-delay: -1.3s; }
.dsr-field.is-arranging:nth-child(3n) { animation-duration: 3.1s; }
/* The row itself is the handle, so nothing inside it may take the pointer -
   a drag that lands in a text field drops a caret instead of lifting the
   card. */
.dsr-field.is-arranging .dsr-input,
.dsr-field.is-arranging .dsr-textarea,
.dsr-field.is-arranging .dsr-field-label-input { pointer-events: none; }
.dsr-field.is-arranging .dsr-input,
.dsr-field.is-arranging .dsr-textarea { border-color: rgba(63, 224, 240, .3); }

.dsr-field.is-dragging {
  border-style: solid;
  border-color: var(--dsr-accent);
  background: rgba(63, 224, 240, .14);
  box-shadow: 0 12px 26px -12px var(--dsr-accent);
  cursor: grabbing;
  animation: none;
  rotate: 1.6deg;
  z-index: 4;
}
/* A drag must not select the label text it passes over. */
.dsr-fields.is-arranging, .dsr-back-fields.is-arranging { user-select: none; }

.dsr-field-ord {
  position: absolute;
  top: -9px;
  left: -7px;
  width: 19px;
  height: 19px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--dsr-accent);
  color: #080C11;
  font-family: var(--dsr-mono);
  font-size: 9px;
  font-weight: 700;
  box-shadow: 0 2px 0 rgba(0, 0, 0, .5);
}

.dsr-field-grip {
  flex-shrink: 0;
  color: rgba(63, 224, 240, .7);
  font-size: 13px;
  line-height: 1;
}

.dsr-field-movers { display: flex; gap: 5px; margin-top: 7px; }
.dsr-field-move {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(9, 13, 18, .65);
  border: 1.5px solid var(--dsr-line);
  border-radius: 7px;
  color: var(--dsr-text);
  font-size: 12px;
  cursor: pointer;
}
.dsr-field-move:hover:not(:disabled) { color: var(--dsr-accent); border-color: var(--dsr-accent); }
.dsr-field-move:disabled { opacity: .3; cursor: not-allowed; }

@media (max-width: 480px) {
  .dsr-field-move { width: 40px; height: 40px; }
}

@media (prefers-reduced-motion: reduce) {
  .dsr-field.is-arranging { animation: none; }
  .dsr-field.is-dragging { rotate: none; }
}

/* ==================================================== 2. SPIDEY-SENSE ==== */

.dsr-gauge { display: grid; grid-template-columns: 1fr; gap: 20px; align-items: center; }
@media (min-width: 640px) { .dsr-gauge { grid-template-columns: 168px 1fr; } }

.dsr-gauge-dial { position: relative; display: grid; place-items: center; }
.dsr-gauge-svg { width: 100%; max-width: 168px; transform: rotate(-90deg); }
.dsr-gauge-track { fill: none; stroke: rgba(255,255,255,.07); stroke-width: 10; }
.dsr-gauge-fill {
  fill: none;
  stroke: var(--dsr-accent);
  stroke-width: 10;
  stroke-linecap: round;
  filter: drop-shadow(0 0 8px var(--dsr-accent));
  transition: stroke-dashoffset 220ms ease, stroke 400ms ease;
}
.dsr-gauge-num {
  position: absolute;
  font-family: 'Permanent Marker', cursive;
  font-size: 2.4rem;
  color: #FFF;
  translate: -8px 0;
}
.dsr-gauge-unit {
  position: absolute;
  font-family: var(--dsr-mono);
  font-size: 12px;
  color: var(--dsr-accent);
  translate: 30px 6px;
}

.dsr-gauge-controls { display: grid; gap: 6px; }
.dsr-gauge-read {
  margin: 0 0 6px;
  font-family: 'Caveat', cursive;
  font-size: 1.2rem;
  color: var(--dsr-accent);
}

.dsr-slider { width: 100%; accent-color: var(--dsr-accent); cursor: pointer; }

.dsr-toggles { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.dsr-toggle-chaos[data-on="true"] { background: var(--dsr-magenta); border-color: var(--dsr-magenta); }

/* Comic alarm lines radiating from the panel on chaos. */
.dsr-spikes {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: grid;
  place-items: center;
  pointer-events: none;
}
.dsr-spike {
  position: absolute;
  width: 3px;
  height: 46vmax;
  background: linear-gradient(var(--dsr-magenta), transparent 62%);
  transform-origin: 50% 0;
  rotate: var(--a);
  animation: dsr-spike-out 420ms ease-out both;
  opacity: .8;
}
@keyframes dsr-spike-out {
  from { scale: 1 0; opacity: 1; }
  to   { scale: 1 1; opacity: 0; }
}
.dsr-thwip-word {
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(3rem, 14vw, 8rem);
  color: #FFF;
  text-shadow: 6px 6px 0 var(--dsr-magenta), -5px -4px 0 var(--dsr-cyan);
  animation: dsr-word-pop 700ms cubic-bezier(.2,1.5,.4,1) both;
}
@keyframes dsr-word-pop {
  0% { scale: .3; rotate: -14deg; opacity: 0; }
  55% { scale: 1.12; rotate: 4deg; opacity: 1; }
  100% { scale: 1; rotate: -2deg; opacity: 0; }
}

/* ================================================== 3. EVIDENCE BOARD ==== */

.dsr-cork-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.dsr-cork-count {
  margin-left: auto;
  font-family: var(--dsr-mono);
  font-size: 10px;
  letter-spacing: .1em;
  color: var(--dsr-dim);
}
.dsr-kind-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }

.dsr-cork {
  position: relative;
  min-height: 460px;
  height: 62vh;
  max-height: 640px;
  overflow: hidden;
  border: 3px solid #4A3520;
  border-radius: 8px;
  touch-action: none;
  background-color: #B98F5E;
  background-image:
    radial-gradient(rgba(88,58,30,.55) 1.1px, transparent 1.2px),
    radial-gradient(rgba(255,225,180,.28) .9px, transparent 1px),
    linear-gradient(rgba(40,70,110,.10) 1px, transparent 1px),
    linear-gradient(90deg, rgba(40,70,110,.10) 1px, transparent 1px);
  background-size: 7px 7px, 11px 11px, 34px 34px, 34px 34px;
  box-shadow: inset 0 0 70px rgba(60,36,14,.6);
}
.dsr-cork[data-linking="true"] { cursor: crosshair; }

.dsr-web { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.dsr-strand {
  fill: none;
  stroke: #E23A46;
  stroke-linecap: round;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.5));
  transition: stroke 160ms ease, opacity 160ms ease, filter 160ms ease;
}
.dsr-strand.is-lit { stroke: #FF6B7A; filter: drop-shadow(0 0 4px rgba(255, 61, 200, .8)); }
.dsr-strand.is-dimmed { opacity: .22; }

.dsr-strand-cut {
  position: absolute;
  translate: -50% -50%;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(12,16,20,.8);
  border: 1.5px solid #E23A46;
  color: #FF9AA2;
  opacity: 0;
  cursor: pointer;
  transition: opacity 140ms ease, transform 140ms ease;
}
.dsr-cork:hover .dsr-strand-cut { opacity: .55; }
.dsr-strand-cut:hover { opacity: 1; transform: scale(1.15); }
@media (hover: none) { .dsr-strand-cut { opacity: .8; } }

.dsr-artifact {
  position: absolute;
  translate: -50% -50%;
  rotate: var(--rot, 0deg);
  width: clamp(112px, 15vw, 152px);
  padding: 8px 8px 6px;
  background: var(--dsr-paper);
  border: 1px solid rgba(0,0,0,.35);
  box-shadow: 4px 6px 12px rgba(0,0,0,.42);
  cursor: grab;
  touch-action: none;
  user-select: none;
  transition: box-shadow 140ms ease, scale 140ms ease;
}
.dsr-artifact > svg:first-child {
  position: absolute;
  top: -11px;
  left: 50%;
  translate: -50% 0;
  pointer-events: none;
}
.dsr-artifact.is-dragging { cursor: grabbing; scale: 1.04; box-shadow: 10px 16px 26px rgba(0,0,0,.55); z-index: 5; }
.dsr-artifact.is-linking { outline: 2.5px solid var(--dsr-cyan); outline-offset: 3px; }
/* Picked-up-off-the-board feel, and it's what makes the strand highlight
   above legible - you can tell which pin you're about to trace a case from. */
.dsr-artifact.is-hovered:not(.is-dragging) {
  scale: 1.07;
  box-shadow: 6px 11px 20px rgba(0,0,0,.55);
  z-index: 6;
}

.dsr-artifact-img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; background: #2A2119; }
.dsr-artifact-note .dsr-artifact-img,
.dsr-artifact-memo .dsr-artifact-img { aspect-ratio: 4 / 3; }

.dsr-artifact-drawn { display: block; width: 100%; aspect-ratio: 4 / 3; }
.dsr-drawn-ticket {
  background:
    linear-gradient(90deg, transparent 0 6px, rgba(0,0,0,.28) 6px 7px, transparent 7px),
    repeating-linear-gradient(#E8DCC0 0 9px, #DDCEAC 9px 10px);
  border: 1px dashed rgba(0,0,0,.4);
}
.dsr-drawn-flower {
  background:
    radial-gradient(circle at 50% 46%, #B45D8A 0 9%, transparent 10%),
    radial-gradient(circle at 34% 34%, #E5A9C6 0 13%, transparent 14%),
    radial-gradient(circle at 66% 34%, #E5A9C6 0 13%, transparent 14%),
    radial-gradient(circle at 34% 60%, #E5A9C6 0 13%, transparent 14%),
    radial-gradient(circle at 66% 60%, #E5A9C6 0 13%, transparent 14%),
    linear-gradient(#F3ECD9, #E4DAC0);
}

.dsr-memo-player { width: 100%; height: 34px; }

.dsr-artifact-cap {
  width: 100%;
  margin-top: 5px;
  padding: 2px 3px;
  background: transparent;
  border: none;
  border-bottom: 1px dashed rgba(0,0,0,.25);
  color: #2A2119;
  font-family: 'Caveat', cursive;
  font-size: 15px;
  outline: none;
}
.dsr-artifact-cap:focus { border-bottom-color: var(--dsr-magenta); }

.dsr-artifact-x {
  position: absolute;
  top: -9px;
  right: -9px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  background: #14100F;
  border: 1.5px solid var(--dsr-paper);
  border-radius: 50%;
  color: #FF9AA2;
  opacity: 0;
  cursor: pointer;
  transition: opacity 130ms ease;
}
.dsr-artifact:hover .dsr-artifact-x,
.dsr-artifact:focus-within .dsr-artifact-x,
.dsr-artifact:active .dsr-artifact-x { opacity: 1; }

.dsr-artifact-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.dsr-artifact-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px 1px 7px;
  background: rgba(0, 0, 0, .08);
  border: 1px solid rgba(0, 0, 0, .2);
  border-radius: 999px;
  color: #2A2119;
  font-family: var(--dsr-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: .04em;
}
.dsr-artifact-tag button { display: inline-flex; color: rgba(0, 0, 0, .45); cursor: pointer; }
.dsr-artifact-tag button:hover { color: var(--dsr-magenta); }

.dsr-artifact-notes-btn {
  position: absolute;
  top: -9px;
  left: -9px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  background: #14100F;
  border: 1.5px solid var(--dsr-paper);
  border-radius: 50%;
  color: #9AD1FF;
  opacity: 0;
  cursor: pointer;
  transition: opacity 130ms ease;
}
.dsr-artifact:focus-within .dsr-artifact-notes-btn,
.dsr-artifact-notes-btn.is-open { opacity: 1; }
@media (hover: none) { .dsr-artifact-notes-btn { opacity: 1; } }

.dsr-artifact-notes {
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px dashed rgba(0, 0, 0, .25);
  display: grid;
  gap: 6px;
  cursor: default;
}
.dsr-artifact-notes-text {
  width: 100%;
  resize: vertical;
  padding: 4px 5px;
  background: rgba(255, 255, 255, .55);
  border: 1px solid rgba(0, 0, 0, .2);
  border-radius: 4px;
  color: #2A2119;
  font-family: var(--dsr-mono);
  font-size: 10px;
  line-height: 1.4;
  outline: none;
}
.dsr-artifact-notes-text:focus { border-color: var(--dsr-magenta); }
.dsr-artifact-tag-row { display: flex; gap: 4px; }
.dsr-artifact-tag-input {
  flex: 1;
  min-width: 0;
  padding: 4px 5px;
  background: rgba(255, 255, 255, .55);
  border: 1px solid rgba(0, 0, 0, .2);
  border-radius: 4px;
  color: #2A2119;
  font-family: var(--dsr-mono);
  font-size: 10px;
  outline: none;
}
.dsr-artifact-tag-input:focus { border-color: var(--dsr-magenta); }
.dsr-artifact-tag-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  background: rgba(0, 0, 0, .08);
  border: 1px solid rgba(0, 0, 0, .2);
  border-radius: 4px;
  color: #2A2119;
  cursor: pointer;
}
.dsr-artifact-tag-add:hover { color: var(--dsr-magenta); border-color: var(--dsr-magenta); }

.dsr-cork-empty {
  position: absolute;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  max-width: 40ch;
  text-align: center;
  font-family: 'Caveat', cursive;
  font-size: 1.3rem;
  line-height: 1.3;
  color: rgba(46,28,12,.72);
}

/* Slide projector. */
.dsr-lightbox {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(4, 6, 9, .93);
  animation: dsr-fade 180ms ease-out both;
}
@keyframes dsr-fade { from { opacity: 0; } to { opacity: 1; } }

.dsr-slide { position: relative; max-width: min(880px, 92vw); }
.dsr-slide-frame {
  padding: 16px 16px 52px;
  background: #E9E3D4;
  border: 12px solid #14171C;
  box-shadow: 0 0 0 2px #3A424C, 0 40px 90px rgba(0,0,0,.75);
}
.dsr-slide-img { display: block; width: 100%; max-height: 66vh; object-fit: contain; background: #1A1A1A; }
.dsr-slide-cap {
  margin: 12px 0 0;
  text-align: center;
  font-family: 'Caveat', cursive;
  font-size: 1.4rem;
  color: #E9E3D4;
}
.dsr-notes-sheet {
  position: relative;
  width: min(340px, 88vw);
  max-height: 82vh;
  overflow-y: auto;
  display: grid;
  gap: 8px;
  padding: 16px;
  background: var(--dsr-paper);
  border: 1px solid rgba(0,0,0,.35);
  box-shadow: 0 24px 60px rgba(0,0,0,.6);
  border-radius: 4px;
}
.dsr-notes-sheet-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Caveat', cursive;
  font-size: 1.2rem;
  color: #2A2119;
  padding-right: 20px;
}
.dsr-notes-sheet .dsr-artifact-notes-text { font-size: 13px; }

.dsr-slide-close {
  position: absolute;
  top: -14px;
  right: -14px;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  background: var(--dsr-magenta);
  border: 2px solid #14171C;
  border-radius: 50%;
  color: #14171C;
  cursor: pointer;
}

/* ================================================= 4. QUIRK MATRIX ======= */

.dsr-pad-row { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 18px; }
@media (min-width: 640px) { .dsr-pad-row { grid-template-columns: 180px 1fr; } }

.dsr-pad { position: relative; }
.dsr-pad-art { width: 100%; height: auto; }

/* The sheet that flies off the pad when a quirk is added. */
.dsr-pad-sheet {
  position: absolute;
  left: 14%;
  top: 22%;
  width: 72%;
  height: 56%;
  background: #FFF8E6;
  border: 1px solid rgba(0,0,0,.3);
  opacity: 0;
  pointer-events: none;
}
.dsr-pad.is-tearing .dsr-pad-sheet { animation: dsr-tear 420ms cubic-bezier(.3,.9,.4,1) both; }
@keyframes dsr-tear {
  0%   { opacity: 1; transform: translate(0,0) rotate(0deg); clip-path: inset(0 0 0 0); }
  45%  { opacity: 1; transform: translate(18px, -12px) rotate(9deg); }
  100% { opacity: 0; transform: translate(150px, 90px) rotate(24deg); }
}

.dsr-pad-form { display: grid; gap: 6px; align-content: start; }
.dsr-pad-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.dsr-select { width: auto; min-width: 140px; }

.dsr-notes { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; margin: 0; padding: 0; list-style: none; }

.dsr-note-sheet {
  position: relative;
  padding: 14px 12px 20px;
  min-height: 128px;
  background: #FBE38A;
  color: #2A2119;
  box-shadow: 3px 5px 10px rgba(0,0,0,.35);
  rotate: -1.6deg;
  transition: transform 180ms ease, box-shadow 180ms ease, rotate 180ms ease;
}
.dsr-note-sheet[data-hue="1"] { background: #A8E6C4; rotate: 2.1deg; }
.dsr-note-sheet[data-hue="2"] { background: #F7B7C8; rotate: -2.6deg; }
.dsr-note-sheet[data-hue="3"] { background: #A9CDF5; rotate: 1.3deg; }

.dsr-note-sheet:hover { transform: translateY(-4px); box-shadow: 6px 12px 20px rgba(0,0,0,.42); rotate: 0deg; }

/* The corner peel. A gradient wedge plus a soft shadow reads as paper lifting
   far better than any transform on the note itself would. */
.dsr-note-curl {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 0 0 0 0;
  border-color: transparent transparent rgba(0,0,0,.22) transparent;
  transition: border-width 200ms ease;
}
.dsr-note-sheet:hover .dsr-note-curl {
  border-width: 0 0 26px 26px;
  border-color: transparent transparent rgba(255,255,255,.85) rgba(0,0,0,.22);
  filter: drop-shadow(-3px -3px 4px rgba(0,0,0,.3));
}

.dsr-note-cat {
  display: inline-block;
  margin-bottom: 6px;
  padding: 2px 7px;
  background: rgba(0,0,0,.14);
  font-family: var(--dsr-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
}
.dsr-note-text { margin: 0; font-family: 'Caveat', cursive; font-size: 1.15rem; line-height: 1.25; overflow-wrap: anywhere; }

.dsr-note-x {
  position: absolute;
  top: 5px;
  right: 5px;
  display: grid;
  place-items: center;
  width: 19px;
  height: 19px;
  background: rgba(0,0,0,.18);
  border: none;
  border-radius: 50%;
  color: #2A2119;
  opacity: 0;
  cursor: pointer;
  transition: opacity 130ms ease, background-color 130ms ease;
}
.dsr-note-sheet:hover .dsr-note-x,
.dsr-note-sheet:active .dsr-note-x { opacity: 1; }
.dsr-note-x:hover { background: #C0293B; color: #FFF; }

.dsr-note-empty {
  grid-column: 1 / -1;
  padding: 24px;
  text-align: center;
  font-family: 'Caveat', cursive;
  font-size: 1.2rem;
  color: var(--dsr-dim);
}

/* ==================================================== 5. PROTOCOLS ======= */

.dsr-folder { position: relative; }

.dsr-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding-left: 10px; }
.dsr-tab {
  border-radius: 8px 8px 0 0;
  border-bottom: none;
  background: var(--dsr-manila-2);
  border-color: #6B5A38;
  color: #2A2119;
  translate: 0 2px;
}
.dsr-tab[data-on="true"] { background: var(--dsr-manila); color: #1C1712; translate: 0 0; }
.dsr-tab-add { padding: 7px 10px; }

.dsr-sheet {
  position: relative;
  padding: clamp(16px, 3vw, 26px);
  background: var(--dsr-manila);
  border: 2px solid #6B5A38;
  border-radius: 0 10px 10px 10px;
  color: #2A2119;
  box-shadow: 0 14px 30px rgba(0,0,0,.45), inset 0 0 60px rgba(120,92,44,.28);
  overflow: hidden;
}
.dsr-sheet.is-stamping { cursor: crosshair; }

.dsr-sheet-title {
  margin: 0 0 14px;
  font-family: 'Permanent Marker', cursive;
  font-size: 1.25rem;
  color: #1C1712;
}

.dsr-sheet-empty {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 32px 16px;
  text-align: center;
  color: rgba(28, 23, 18, .72);
  font-family: var(--dsr-mono);
  font-size: 12px;
}

.dsr-sheet-headrow {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin: 0 0 14px;
}
.dsr-sheet-heading { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.dsr-tab-label-input {
  width: fit-content;
  max-width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px dashed rgba(28, 23, 18, .3);
  padding: 0 0 2px;
  font-family: var(--dsr-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .16em;
  color: rgba(28, 23, 18, .6);
  outline: none;
}
.dsr-tab-label-input:focus { border-bottom-color: var(--dsr-magenta); color: #1C1712; }
.dsr-sheet-title-input {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px dashed rgba(28, 23, 18, 0);
  padding: 0 0 2px;
  font-family: 'Permanent Marker', cursive;
  font-size: 1.25rem;
  color: #1C1712;
  outline: none;
}
.dsr-sheet-title-input:focus { border-bottom-color: rgba(28, 23, 18, .3); }
.dsr-proto-delete { flex-shrink: 0; background: rgba(28, 23, 18, .86); color: var(--dsr-manila); border-color: #6B5A38; }
.dsr-proto-delete.is-armed { background: var(--dsr-magenta); border-color: var(--dsr-magenta); color: #1C1712; }

.dsr-steps { display: grid; gap: 14px; margin: 0 0 12px; padding-left: 20px; }
.dsr-step { position: relative; }
.dsr-step::marker { font-family: var(--dsr-mono); font-weight: 700; color: #7C6534; }

/* The prompt reads as a printed field label but is still editable, so the
   protocol can be rewritten to fit whoever it is about. */
.dsr-step-prompt {
  width: calc(100% - 26px);
  margin-bottom: 3px;
  padding: 1px 2px;
  background: transparent;
  border: none;
  border-bottom: 1px dotted rgba(90,72,40,.55);
  color: #6A5528;
  font-family: var(--dsr-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .13em;
  text-transform: uppercase;
  outline: none;
}
.dsr-step-prompt:focus { border-bottom-color: #7C2833; color: #3A2B14; }

.dsr-step-x {
  position: absolute;
  top: -2px;
  right: 0;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: rgba(60,44,20,.5);
  opacity: 0;
  cursor: pointer;
  transition: opacity 140ms ease, background-color 140ms ease, color 140ms ease;
}
.dsr-step:hover .dsr-step-x, .dsr-step:focus-within .dsr-step-x, .dsr-step:active .dsr-step-x { opacity: 1; }
.dsr-step-x:hover { background: #C0293B; color: #FFF; }
.dsr-step-input {
  width: 100%;
  padding: 7px 9px;
  background: rgba(255,252,242,.66);
  border: 1px solid rgba(90,72,40,.5);
  border-radius: 5px;
  color: #241D14;
  font-family: 'Caveat', cursive;
  font-size: 1.12rem;
  line-height: 1.3;
  resize: vertical;
  outline: none;
}
.dsr-step-input:focus { border-color: #7C2833; box-shadow: 0 0 0 3px rgba(124,40,51,.18); }

.dsr-step-add { background: rgba(28,23,18,.86); color: var(--dsr-manila); border-color: #6B5A38; }

.dsr-stamp-mark { position: absolute; translate: -50% -50%; pointer-events: none; mix-blend-mode: multiply; }
.dsr-stamp-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  background: #1C1712;
  border: 1.5px solid var(--dsr-manila);
  border-radius: 50%;
  color: #FF9AA2;
  pointer-events: auto;
  mix-blend-mode: normal;
  cursor: pointer;
  opacity: 0;
  transition: opacity 130ms ease;
}
/* .dsr-stamp-mark (the parent) is pointer-events:none so the sheet below it
   stays clickable for placing more stamps - that also means the parent can
   never register :hover, so this has to reveal on its own hitbox instead. */
.dsr-stamp-remove:hover,
.dsr-stamp-remove:active,
.dsr-stamp-remove:focus-visible { opacity: 1; color: #FF5C6C; }

.dsr-splatter { position: absolute; translate: -50% -50%; pointer-events: none; }
.dsr-splat-dot {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(40,20,20,.65);
  animation: dsr-splat 620ms cubic-bezier(.2,.9,.3,1) both;
}
@keyframes dsr-splat {
  from { transform: translate(0, 0) scale(.3); opacity: 1; }
  to   { transform: translate(var(--sx), var(--sy)) scale(1); opacity: 0; }
}

.dsr-stamp-tray { margin-top: 16px; }
.dsr-stamp-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0; }
.dsr-stamp-pick {
  padding: 4px 6px;
  background: rgba(21,27,35,.9);
  border: 1.5px solid var(--dsr-line);
  border-radius: 8px;
  cursor: pointer;
  transition: transform 120ms ease, border-color 140ms ease;
}
.dsr-stamp-pick:hover { transform: translateY(-2px) rotate(-1.5deg); border-color: var(--dsr-accent); }
.dsr-stamp-pick[data-on="true"] { border-color: var(--dsr-magenta); box-shadow: 0 0 18px -4px var(--dsr-magenta); }

/* =================================================== 6. QUOTE STRIP ====== */

.dsr-quote-strip { display: flex; gap: 16px; overflow-x: auto; padding: 6px 4px 16px; scroll-snap-type: x proximity; }
.dsr-quote-card {
  position: relative;
  flex: 0 0 220px;
  scroll-snap-align: start;
  padding: 20px 14px 14px;
  background: var(--dsr-paper);
  border: 1px solid rgba(0, 0, 0, .35);
  border-radius: 4px;
  box-shadow: 3px 5px 10px rgba(0, 0, 0, .4);
  color: #2A2119;
  rotate: -1deg;
}
.dsr-quote-card:nth-child(even) { rotate: 1deg; }
.dsr-quote-mark {
  position: absolute;
  top: -8px;
  left: 8px;
  font-family: 'Permanent Marker', cursive;
  font-size: 2.4rem;
  color: rgba(0, 0, 0, .18);
  line-height: 1;
}
.dsr-quote-text {
  width: 100%;
  min-height: 70px;
  resize: vertical;
  background: transparent;
  border: none;
  color: #2A2119;
  font-family: 'Caveat', cursive;
  font-size: 17px;
  line-height: 1.3;
  outline: none;
}
.dsr-quote-meta { display: grid; gap: 4px; margin-top: 6px; }
.dsr-quote-source, .dsr-quote-date {
  background: transparent;
  border: none;
  border-bottom: 1px dashed rgba(0, 0, 0, .25);
  padding: 2px 0;
  color: #5A4A3A;
  font-family: var(--dsr-mono);
  font-size: 10px;
  outline: none;
}
.dsr-quote-source:focus, .dsr-quote-date:focus { border-bottom-color: var(--dsr-magenta); }
.dsr-quote-x {
  position: absolute;
  top: -8px;
  right: -8px;
  display: grid;
  place-items: center;
  width: 19px;
  height: 19px;
  background: #14100F;
  border: 1.5px solid var(--dsr-paper);
  border-radius: 50%;
  color: #FF9AA2;
  cursor: pointer;
  opacity: 0;
  transition: opacity 130ms ease, color 130ms ease;
}
.dsr-quote-x:hover { color: #FF5C6C; }
.dsr-quote-card:hover .dsr-quote-x,
.dsr-quote-card:focus-within .dsr-quote-x,
.dsr-quote-card:active .dsr-quote-x { opacity: 1; }
.dsr-quote-add {
  flex: 0 0 140px;
  display: grid;
  place-items: center;
  gap: 6px;
  border: 1.5px dashed var(--dsr-line);
  border-radius: 6px;
  background: rgba(21, 27, 35, .55);
  color: var(--dsr-dim);
  font-family: var(--dsr-mono);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.dsr-quote-add:hover { color: var(--dsr-accent); border-color: var(--dsr-accent); }

/* ============================================ 7. DIMENSIONAL TRAVELOGUE == */

.dsr-radar-hint { text-align: center; margin: -4px 0 10px; }
.dsr-radar-wrap {
  position: relative;
  width: min(100%, 420px);
  aspect-ratio: 1;
  margin: 0 auto 18px;
  touch-action: none;
  cursor: crosshair;
}
.dsr-radar-face { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; }
.dsr-radar-sweep {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
  background: conic-gradient(from 0deg, rgba(95, 231, 216, .38), transparent 30%, transparent 100%);
  mix-blend-mode: screen;
  animation: dsr-radar-spin 4.5s linear infinite;
}
@keyframes dsr-radar-spin { to { transform: rotate(360deg); } }
.dsr-radar-charge {
  position: absolute;
  translate: -50% -50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #5FE7D8;
  pointer-events: none;
  animation: dsr-radar-charge 650ms ease forwards;
}
@keyframes dsr-radar-charge {
  0% { width: 10px; height: 10px; opacity: .95; border-width: 3px; }
  100% { width: 60px; height: 60px; opacity: 0; border-width: 1px; }
}
@media (prefers-reduced-motion: reduce) {
  .dsr-radar-sweep { animation: none; opacity: .3; }
  .dsr-radar-charge { animation: none; opacity: .7; }
}
.dsr-radar-blip {
  position: absolute;
  translate: -50% -50%;
  display: grid;
  justify-items: center;
  gap: 2px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
}
.dsr-radar-blip-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #5FE7D8;
  box-shadow: 0 0 0 4px rgba(95, 231, 216, .22), 0 0 10px rgba(95, 231, 216, .7);
}
.dsr-radar-blip.is-open .dsr-radar-blip-dot {
  background: var(--dsr-accent);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--dsr-accent) 30%, transparent);
}
.dsr-radar-blip-label {
  font-family: var(--dsr-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: .04em;
  color: #B7EFE9;
  background: rgba(6, 20, 24, .75);
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsr-radar-add {
  position: absolute;
  bottom: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(6, 20, 24, .85);
  border: 1.5px solid #2E8B8F;
  color: #5FE7D8;
  cursor: pointer;
}
.dsr-radar-add:hover { border-color: #5FE7D8; }

.dsr-travel-detail { display: grid; gap: 10px; padding-top: 14px; border-top: 1px dashed var(--dsr-line); }
.dsr-travel-detail-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
.dsr-travel-photo-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsr-travel-photo { width: 54px; height: 54px; object-fit: cover; border-radius: 6px; border: 1.5px solid var(--dsr-line); }
.dsr-travel-remove { margin-left: auto; }

/* ======================================= 8. WEB-SHOOTER SIZING BLUEPRINT = */

.dsr-sizing-body { display: grid; grid-template-columns: 1fr; gap: 20px; align-items: start; }
@media (min-width: 640px) { .dsr-sizing-body { grid-template-columns: 140px 1fr; } }
.dsr-sizing-figure { width: 100%; max-width: 140px; margin: 0 auto; }
.dsr-sizing-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; align-content: start; }
.dsr-sizing-field { display: grid; gap: 4px; }
.dsr-sizing-value-row { display: flex; gap: 6px; align-items: center; }
.dsr-sizing-value-row .dsr-input { min-width: 0; }
.dsr-sizing-unit { max-width: 64px; flex-shrink: 0; }

/* =========================================== 9. PET PEEVE / FLAG INDEX == */

.dsr-peeve-add-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.dsr-peeve-add-peeve { border-color: #E8B71A; color: #E8B71A; }
.dsr-peeve-add-redflag { border-color: #E23B4E; color: #FF8A97; }
.dsr-peeve-add-greenflag { border-color: #35B37E; color: #8CE8C0; }

.dsr-peeve-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.dsr-peeve-item {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 6px 10px;
  padding: 10px 32px 10px 14px;
  background: rgba(21, 27, 35, .75);
  border: 1.5px solid var(--dsr-line);
  border-left-width: 5px;
  border-radius: 8px;
}
.dsr-peeve-peeve { border-left-color: #E8B71A; }
.dsr-peeve-redflag { border-left-color: #E23B4E; }
.dsr-peeve-greenflag { border-left-color: #35B37E; }
.dsr-peeve-hazard { position: absolute; inset: 0; opacity: .08; border-radius: 7px; pointer-events: none; }
.dsr-peeve-tag {
  flex: 0 0 100%;
  font-family: var(--dsr-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--dsr-dim);
}
.dsr-peeve-text {
  flex: 1;
  min-width: 140px;
  resize: vertical;
  background: transparent;
  border: none;
  color: var(--dsr-text);
  font-family: var(--dsr-mono);
  font-size: 12px;
  line-height: 1.4;
  outline: none;
}
.dsr-peeve-item .dsr-field-x { position: absolute; top: 8px; right: 8px; }

/* ======================================= 10. "IN ANY UNIVERSE" CAPSULE == */

.dsr-capsule-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px; }
.dsr-capsule-card {
  position: relative;
  min-height: 150px;
  border-radius: 10px;
  overflow: hidden;
  border: 1.5px solid var(--dsr-line);
  background: rgba(21, 27, 35, .8);
}
.dsr-capsule-sealed-face {
  width: 100%;
  height: 100%;
  min-height: 150px;
  display: grid;
  place-items: center;
  gap: 8px;
  padding: 14px;
  background: radial-gradient(circle at 50% 30%, rgba(63, 224, 240, .14), transparent 70%);
  border: none;
  color: var(--dsr-dim);
  font-family: var(--dsr-mono);
  font-size: 10.5px;
  font-weight: 700;
  text-align: center;
  cursor: default;
}
.dsr-capsule-ready { cursor: pointer; color: var(--dsr-accent); }
.dsr-capsule-ready:hover { background: radial-gradient(circle at 50% 30%, rgba(63, 224, 240, .24), transparent 70%); }
.dsr-capsule-web { opacity: .8; }
.dsr-capsule-card.is-breaking .dsr-capsule-sealed-face { animation: dsr-capsule-tear 500ms ease forwards; }
@keyframes dsr-capsule-tear {
  0% { clip-path: inset(0 0 0 0); opacity: 1; }
  100% { clip-path: inset(0 0 100% 0); opacity: 0; }
}
.dsr-capsule-open { padding: 12px; display: grid; gap: 8px; }
.dsr-capsule-photo { width: 100%; height: 90px; object-fit: cover; border-radius: 6px; }
.dsr-capsule-message { margin: 0; font-family: 'Caveat', cursive; font-size: 16px; line-height: 1.35; color: var(--dsr-text); }
.dsr-capsule-unsealed-note { font-family: var(--dsr-mono); font-size: 8.5px; color: var(--dsr-dim); }
.dsr-capsule-x {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  background: rgba(0, 0, 0, .5);
  border: 1px solid var(--dsr-line);
  border-radius: 50%;
  color: var(--dsr-dim);
  cursor: pointer;
  opacity: 0;
  transition: opacity 130ms ease, color 130ms ease;
}
.dsr-capsule-x:hover { color: var(--dsr-accent); }
.dsr-capsule-card:hover .dsr-capsule-x,
.dsr-capsule-card:focus-within .dsr-capsule-x,
.dsr-capsule-card:active .dsr-capsule-x { opacity: 1; }

.dsr-capsule-new {
  min-height: 150px;
  display: grid;
  place-items: center;
  gap: 6px;
  border: 1.5px dashed var(--dsr-line);
  border-radius: 10px;
  background: rgba(21, 27, 35, .4);
  color: var(--dsr-dim);
  font-family: var(--dsr-mono);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.dsr-capsule-new:hover { color: var(--dsr-accent); border-color: var(--dsr-accent); }

.dsr-capsule-composer {
  grid-column: 1 / -1;
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1.5px solid var(--dsr-line);
  border-radius: 10px;
  background: rgba(21, 27, 35, .85);
}
.dsr-capsule-composer-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsr-capsule-composer-actions { display: flex; gap: 8px; }

/* ================================================ ATMOSPHERE / EGGS ====== */

.dsr-flip-spider {
  /* Bottom-LEFT on purpose - the global now-playing pill (NowPlayingPill.tsx)
     is fixed to bottom-right on every chapter it isn't hidden on, dossier
     included, and used to sit directly on top of this button. */
  position: fixed;
  left: max(14px, env(safe-area-inset-left));
  bottom: max(14px, env(safe-area-inset-bottom));
  z-index: 30;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  background: rgba(13,17,22,.85);
  border: 1.5px solid var(--dsr-line);
  border-radius: 50%;
  color: var(--dsr-dim);
  cursor: pointer;
  touch-action: none;
  transition: color 160ms ease, border-color 160ms ease;
}
.dsr-flip-spider:hover { color: var(--dsr-magenta); border-color: var(--dsr-magenta); }

/* The hold timer, drawn as a filling ring via conic-gradient. */
.dsr-flip-ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  pointer-events: none;
  background: conic-gradient(var(--dsr-magenta) calc(var(--p, 0) * 360deg), transparent 0);
  mask: radial-gradient(circle, transparent 0 61%, #000 63%);
  -webkit-mask: radial-gradient(circle, transparent 0 61%, #000 63%);
}

/* Web-shooter reticle. Fixed, never interactive, and only ever written to
   from a rAF - it must not be able to swallow a click. */
.dsr-cursor {
  position: fixed;
  inset: 0;
  z-index: 50;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.dsr-cursor-line { stroke: var(--dsr-accent); stroke-width: 1; stroke-dasharray: 3 4; }
.dsr-cursor-ring { fill: none; stroke: var(--dsr-accent); stroke-width: 1.2; opacity: .5; transition: r 140ms ease; }
.dsr-cursor-dot { fill: var(--dsr-accent); }

@media (hover: none), (pointer: coarse) { .dsr-cursor { display: none; } }

@media (prefers-reduced-motion: reduce) {
  .dsr-root,
  .dsr-badge-face,
  .dsr-artifact,
  .dsr-note-sheet { transition: none; }
  .dsr-scanline,
  .dsr-spike,
  .dsr-thwip-word,
  .dsr-splat-dot,
  .dsr-pad.is-tearing .dsr-pad-sheet,
  .dsr-root.is-glitching .dsr-stack,
  .dsr-root.is-chaos .dsr-stack { animation: none; }
  .dsr-cursor { display: none; }
}

/* ------------------------------------ 8b. sizing blueprint, free pins --- */

.dsr-sizing-placing {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 0 12px;
  padding: 9px 12px;
  background: color-mix(in srgb, var(--dsr-accent) 12%, rgba(9, 13, 18, .7));
  border: 1.5px dashed var(--dsr-accent);
  border-radius: 10px;
  font-family: var(--dsr-mono);
  font-size: 11px;
  color: var(--dsr-text);
}
.dsr-sizing-placing strong { color: var(--dsr-accent); }

.dsr-sizing-placing-x {
  margin-left: auto;
  background: none;
  border: 1.5px solid var(--dsr-line);
  border-radius: 7px;
  padding: 5px 10px;
  font-family: var(--dsr-mono);
  font-size: 9px;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--dsr-dim);
  cursor: pointer;
}
.dsr-sizing-placing-x:hover { color: var(--dsr-text); border-color: var(--dsr-accent); }

/* While placing, the figure itself is the control - say so. */
.dsr-sizing-figure.is-placing {
  outline: 1.5px dashed var(--dsr-accent);
  outline-offset: 6px;
  border-radius: 8px;
}

.dsr-sizing-pinbtn {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(9, 13, 18, .6);
  border: 1.5px solid var(--dsr-line);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  /* An unpinned measurement's marker is dimmed until it has somewhere to be. */
  filter: grayscale(1);
  opacity: .55;
  transition: opacity 140ms ease, border-color 140ms ease, filter 140ms ease;
}
.dsr-sizing-pinbtn:hover { opacity: 1; border-color: var(--dsr-accent); }
.dsr-sizing-pinbtn.is-pinned { filter: none; opacity: 1; }
.dsr-sizing-pinbtn.is-placing {
  filter: none;
  opacity: 1;
  border-color: var(--dsr-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsr-accent) 22%, transparent);
}

/* ------------------------------------------------- 11. field interview -- */

/* .dsr-stack is a grid, so its items default to min-width:auto and refuse to
   shrink below their max-content width. This panel's tab strip is six tabs
   wide (~1110px) and its highlight strip scrolls, so without this the whole
   section stayed ~1110px on a 375px phone - and because .dsr-root sets
   overflow-x:hidden, that did not even show as a scrollbar. It was silently
   guillotined off the right edge. Every horizontally-scrolling child needs
   the same release or it re-inflates the parent it lives in. */
.dsr-interview { min-width: 0; }
.dsr-iv-tabs,
.dsr-iv-highlight-row,
.dsr-iv-highlights,
.dsr-iv-controls,
.dsr-iv-meter,
.dsr-iv-grid { min-width: 0; }

.dsr-iv-lede {
  margin: 0 0 16px;
  max-width: 62ch;
  font-family: var(--dsr-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsr-dim);
}

.dsr-iv-loading {
  margin: 0;
  padding: 18px 0;
  font-family: var(--dsr-mono);
  font-size: 11px;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--dsr-dim);
}

/* progress ------------------------------------------------------------- */

.dsr-iv-meter {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.dsr-iv-meter-bar {
  position: relative;
  flex: 1 1 200px;
  height: 8px;
  min-width: 140px;
  background: rgba(9, 13, 18, .8);
  border: 1.5px solid var(--dsr-line);
  border-radius: 999px;
  overflow: hidden;
}

.dsr-iv-meter-fill {
  display: block;
  height: 100%;
  background: var(--dsr-accent);
  box-shadow: 0 0 14px -2px var(--dsr-accent);
  transition: width 420ms cubic-bezier(.2, .8, .2, 1);
}

.dsr-iv-meter-read {
  font-family: var(--dsr-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .18em;
  color: var(--dsr-accent);
  white-space: nowrap;
}

/* starred highlights --------------------------------------------------- */

.dsr-iv-highlights { margin-bottom: 18px; }

.dsr-iv-highlight-row {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 6px;
  scrollbar-width: thin;
}

.dsr-iv-highlight {
  flex: 0 0 auto;
  max-width: 240px;
  text-align: left;
  padding: 8px 12px;
  background: rgba(21, 27, 35, .92);
  border: 1.5px solid var(--dsr-accent);
  border-radius: 10px;
  cursor: pointer;
  transition: transform 140ms ease, box-shadow 140ms ease;
}
.dsr-iv-highlight:hover { transform: translateY(-2px); box-shadow: 0 6px 18px -8px var(--dsr-accent); }

.dsr-iv-highlight-q {
  display: block;
  font-family: var(--dsr-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--dsr-accent);
  margin-bottom: 3px;
}

.dsr-iv-highlight-a {
  display: block;
  font-family: 'Caveat', cursive;
  font-size: 17px;
  line-height: 1.25;
  color: var(--dsr-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* volume dividers ------------------------------------------------------ */

.dsr-iv-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 8px;
  margin-bottom: 14px;
  scrollbar-width: thin;
}

/* Built on .dsr-tool-btn, NOT .dsr-tab - despite the name, .dsr-tab is the
   protocol folder's manila index tab (it repaints background, colour and
   border further up this sheet), so borrowing it here put dark folder-brown
   text on a dark panel. Background and colour are restated explicitly so a
   future rule up there cannot bleed into this section either. */
.dsr-iv-tab {
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  /* File-divider silhouette: square shoulders at the bottom, tabbed top. */
  border-radius: 10px 10px 4px 4px;
  min-height: 44px;
  background: rgba(21, 27, 35, .9);
  color: var(--dsr-text);
  border: 1.5px solid var(--dsr-line);
}
.dsr-iv-tab.is-on {
  border-color: var(--dsr-accent);
  background: color-mix(in srgb, var(--dsr-accent) 16%, rgba(21, 27, 35, .95));
  color: var(--dsr-text);
  box-shadow: 0 -3px 0 0 var(--dsr-accent) inset;
}

.dsr-iv-tab-mark { font-size: 14px; line-height: 1; }

.dsr-iv-tab-text { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.15; }

.dsr-iv-tab-roman {
  font-family: var(--dsr-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: .2em;
  color: var(--dsr-accent);
}

.dsr-iv-tab-title {
  font-family: var(--dsr-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--dsr-text);
  white-space: nowrap;
}

.dsr-iv-tab-count {
  font-family: var(--dsr-mono);
  font-size: 8.5px;
  font-weight: 700;
  color: var(--dsr-dim);
  padding-left: 2px;
}

/* controls ------------------------------------------------------------- */

.dsr-iv-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 16px;
}

.dsr-iv-search { flex: 1 1 200px; min-width: 0; }

.dsr-iv-modes { display: flex; gap: 4px; }

.dsr-iv-mode {
  min-height: 40px;
  font-size: 10.5px;
  background: rgba(21, 27, 35, .9);
  color: var(--dsr-text);
  border: 1.5px solid var(--dsr-line);
  border-radius: 9px;
}
.dsr-iv-mode.is-on {
  border-color: var(--dsr-accent);
  color: var(--dsr-accent);
  background: color-mix(in srgb, var(--dsr-accent) 14%, rgba(21, 27, 35, .95));
}

.dsr-iv-draw { min-height: 40px; white-space: nowrap; }

/* the drawn card ------------------------------------------------------- */

.dsr-iv-spotlight {
  margin-bottom: 18px;
  padding: 12px;
  border: 1.5px dashed var(--dsr-accent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--dsr-accent) 8%, rgba(9, 13, 18, .6));
  animation: dsrDrawIn 300ms cubic-bezier(.2, .8, .2, 1) both;
}

@keyframes dsrDrawIn {
  from { opacity: 0; transform: translateY(-8px) rotate(-.6deg); }
  to   { opacity: 1; transform: none; }
}

.dsr-iv-spotlight-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.dsr-iv-spotlight-x {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1.5px solid var(--dsr-line);
  border-radius: 8px;
  color: var(--dsr-dim);
  cursor: pointer;
  font-size: 12px;
}
.dsr-iv-spotlight-x:hover { color: var(--dsr-text); border-color: var(--dsr-accent); }

/* volume heading ------------------------------------------------------- */

.dsr-iv-volhead {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  padding-top: 6px;
  border-top: 1.5px solid var(--dsr-line);
}

.dsr-iv-volroman {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  font-family: 'Permanent Marker', cursive;
  font-size: 17px;
  color: var(--dsr-accent);
  border: 1.5px solid var(--dsr-accent);
  border-radius: 50%;
}

.dsr-iv-voltitle {
  margin: 0;
  font-family: 'Permanent Marker', cursive;
  font-size: 1.15rem;
  color: #FFF;
  line-height: 1.1;
}

.dsr-iv-empty {
  margin: 0;
  padding: 22px 4px;
  font-family: 'Caveat', cursive;
  font-size: 19px;
  color: var(--dsr-dim);
}

/* the cards ------------------------------------------------------------ */

.dsr-iv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr));
  gap: 10px;
}

.dsr-iv-card {
  position: relative;
  padding: 10px 12px;
  background: rgba(9, 13, 18, .5);
  border: 1.5px solid var(--dsr-line);
  /* Ruled left edge, like the margin line on an index card. */
  border-left-width: 3px;
  border-radius: 10px;
  transition: border-color 160ms ease, background 160ms ease;
}
.dsr-iv-card:focus-within { border-color: var(--dsr-accent); }
.dsr-iv-card.is-filled {
  border-left-color: var(--dsr-accent);
  background: rgba(21, 27, 35, .72);
}
.dsr-iv-card.is-spotlit { border-color: var(--dsr-accent); background: rgba(21, 27, 35, .85); }

.dsr-iv-cardhead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.dsr-iv-q {
  font-family: var(--dsr-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .13em;
  text-transform: uppercase;
  color: var(--dsr-dim);
  line-height: 1.45;
  cursor: pointer;
}
.dsr-iv-card.is-filled .dsr-iv-q { color: var(--dsr-accent); }

.dsr-iv-pin {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  margin: -4px -4px 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 8px;
  color: rgba(147, 163, 178, .5);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: color 140ms ease, transform 140ms ease;
}
.dsr-iv-pin:hover { color: var(--dsr-accent); transform: scale(1.15); }
.dsr-iv-pin.is-on { color: var(--dsr-accent); }

/* The answer reads as handwriting on the card, not as form input. */
.dsr-iv-input {
  font-family: 'Caveat', cursive;
  font-size: 18px;
  line-height: 1.35;
  padding: 5px 8px;
}
.dsr-iv-input::placeholder { font-family: var(--dsr-mono); font-size: 12px; }

/* the play bar --------------------------------------------------------- */

.dsr-iv-modesbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.dsr-iv-modesbar .dsr-tool-btn { min-height: 42px; }

.dsr-iv-primary {
  background: color-mix(in srgb, var(--dsr-accent) 20%, rgba(21, 27, 35, .95));
  border-color: var(--dsr-accent);
  color: var(--dsr-text);
}

.dsr-iv-quiztoggle.is-on {
  background: color-mix(in srgb, var(--dsr-accent) 22%, rgba(21, 27, 35, .95));
  border-color: var(--dsr-accent);
  color: var(--dsr-accent);
}

.dsr-iv-quiznote,
.dsr-iv-note {
  margin: -6px 0 14px;
  font-family: var(--dsr-mono);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--dsr-dim);
}
.dsr-iv-note { margin: 12px 0 0; }

/* volume ink: each divider carries its own colour so six stacks of index
   cards do not read as one wall. */
.dsr-iv-tab.is-on {
  border-color: var(--iv-ink, var(--dsr-accent));
  background: color-mix(in srgb, var(--iv-ink, var(--dsr-accent)) 16%, rgba(21, 27, 35, .95));
  box-shadow: 0 -3px 0 0 var(--iv-ink, var(--dsr-accent)) inset;
}
.dsr-iv-tab.is-on .dsr-iv-tab-roman { color: var(--iv-ink, var(--dsr-accent)); }
.dsr-iv-tab-count.is-done { color: var(--iv-ink, var(--dsr-accent)); }

/* their own questions -------------------------------------------------- */

.dsr-iv-addrow {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.dsr-iv-addinput { flex: 1 1 auto; min-width: 0; }
.dsr-iv-addrow .dsr-tool-btn { min-height: 40px; white-space: nowrap; }

.dsr-iv-ours {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 5px;
  border: 1px solid var(--iv-ink, var(--dsr-accent));
  border-radius: 999px;
  font-size: 7.5px;
  letter-spacing: .12em;
  color: var(--iv-ink, var(--dsr-accent));
  vertical-align: middle;
}

.dsr-iv-volheadtext { min-width: 0; }

.dsr-iv-cardfoot {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}

.dsr-iv-del {
  margin-left: auto;
  background: none;
  border: none;
  font-family: var(--dsr-mono);
  font-size: 9px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: rgba(255, 107, 107, .75);
  cursor: pointer;
}
.dsr-iv-del:hover { color: #FF6B6B; text-decoration: underline; }

.dsr-iv-card.is-custom { border-style: dashed; }

/* quiz cover ----------------------------------------------------------- */

.dsr-iv-cover {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 9px 10px;
  background: repeating-linear-gradient(
    45deg,
    rgba(9, 13, 18, .85),
    rgba(9, 13, 18, .85) 6px,
    rgba(30, 40, 50, .85) 6px,
    rgba(30, 40, 50, .85) 12px
  );
  border: 1.5px solid var(--iv-ink, var(--dsr-accent));
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
}
.dsr-iv-cover:hover { background: rgba(21, 27, 35, .9); }

.dsr-iv-cover-tag {
  font-family: var(--dsr-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .18em;
  color: var(--iv-ink, var(--dsr-accent));
}
.dsr-iv-cover-hint {
  font-family: 'Caveat', cursive;
  font-size: 15px;
  color: var(--dsr-dim);
}

/* interview mode (the deck) -------------------------------------------- */

.dsr-iv-deck {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(5, 8, 11, .88);
  backdrop-filter: blur(6px);
  animation: dsrDrawIn 240ms ease-out both;
}

.dsr-iv-deck-card {
  width: min(560px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  /* Pairing overflow-y:auto with the default visible x gives a stray
     horizontal scrollbar along the bottom of the card. */
  overflow-x: hidden;
  box-sizing: border-box;
  padding: clamp(16px, 4vw, 26px);
  background: rgba(19, 25, 32, .96);
  border: 2px solid var(--iv-ink, var(--dsr-accent));
  border-radius: 18px;
  box-shadow: 0 30px 70px rgba(0, 0, 0, .6), 0 0 40px -18px var(--iv-ink, var(--dsr-accent));
}

.dsr-iv-deck-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 14px;
}

.dsr-iv-deck-q {
  margin: 0 0 16px;
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(1.2rem, 4.5vw, 1.75rem);
  line-height: 1.25;
  color: #FFF;
}

.dsr-iv-deck-input {
  font-family: 'Caveat', cursive;
  font-size: 21px;
  line-height: 1.4;
  margin-bottom: 14px;
  box-sizing: border-box;
  overflow-x: hidden;
}

.dsr-iv-deck-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dsr-iv-deck-foot .dsr-tool-btn { flex: 1 1 auto; justify-content: center; min-height: 44px; }

/* the polygraph -------------------------------------------------------- */

.dsr-pg-callout {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin: 14px 0 4px;
  padding: 15px 17px;
  background:
    repeating-linear-gradient(90deg, rgba(255, 61, 200, .07) 0 1px, transparent 1px 13px),
    linear-gradient(140deg, rgba(255, 61, 200, .14), rgba(9, 13, 18, .9) 62%);
  border: 1.5px solid rgba(255, 61, 200, .45);
  border-radius: 14px;
  box-shadow: inset 0 0 34px -18px #FF3DC8;
}

.dsr-pg-callout-text { flex: 1 1 240px; min-width: 0; }

.dsr-pg-callout-kicker {
  display: block;
  font-family: var(--dsr-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: .22em;
  text-transform: uppercase;
  color: rgba(255, 61, 200, .85);
}

.dsr-pg-callout-title {
  margin: 3px 0 5px;
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(1.15rem, 3.4vw, 1.45rem);
  line-height: 1.1;
  color: #FFF;
}

.dsr-pg-callout-lede {
  margin: 0;
  font-family: 'Caveat', cursive;
  font-size: 17px;
  line-height: 1.35;
  color: var(--dsr-text);
}

.dsr-pg-callout-record {
  margin: 7px 0 0;
  font-family: var(--dsr-mono);
  font-size: 9px;
  letter-spacing: .14em;
  color: var(--dsr-dim);
}

.dsr-pg-callout-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-height: 46px;
  padding: 11px 18px;
  background: #FF3DC8;
  border: 2px solid #FF3DC8;
  border-radius: 11px;
  color: #0B0E13;
  font-family: var(--dsr-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 4px 4px 0 rgba(0, 0, 0, .55);
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.dsr-pg-callout-btn:hover { transform: translate(-1px, -1px); box-shadow: 6px 6px 0 rgba(0, 0, 0, .55); }
.dsr-pg-callout-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 rgba(0, 0, 0, .55); }

/* The idle lamp on the front of the machine. */
@keyframes dsr-pg-lamp {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 3px rgba(11, 14, 19, .35); }
  50%      { opacity: .35; box-shadow: 0 0 0 6px rgba(11, 14, 19, .18); }
}
.dsr-pg-callout-btn-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #0B0E13;
  animation: dsr-pg-lamp 1.9s ease-in-out infinite;
}

/* the test itself ------------------------------------------------------- */

.dsr-pg {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(5, 8, 11, .9);
  backdrop-filter: blur(6px);
  animation: dsrDrawIn 240ms ease-out both;
}

.dsr-pg-sheet {
  width: min(560px, 100%);
  max-height: 92vh;
  overflow-y: auto;
  /* Pairing overflow-y:auto with the default visible x gives a stray
     horizontal scrollbar along the bottom of the sheet. */
  overflow-x: hidden;
  box-sizing: border-box;
  padding: clamp(15px, 4vw, 24px);
  background: rgba(19, 25, 32, .97);
  border: 2px solid rgba(255, 61, 200, .55);
  border-radius: 18px;
  box-shadow: 0 30px 70px rgba(0, 0, 0, .65), 0 0 40px -16px #FF3DC8;
}

.dsr-pg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

/* chart paper: a magenta grid the pens run across */
.dsr-pg-chart {
  position: relative;
  height: 62px;
  margin-bottom: 16px;
  overflow: hidden;
  border: 1.5px solid rgba(255, 61, 200, .34);
  border-radius: 9px;
  background:
    repeating-linear-gradient(90deg, rgba(255, 61, 200, .16) 0 1px, transparent 1px 15px),
    repeating-linear-gradient(0deg, rgba(255, 61, 200, .12) 0 1px, transparent 1px 12px),
    #0B0E13;
}

.dsr-pg-svg {
  display: block;
  width: 100%;
  height: 100%;
  /* The amplitude, not the speed, is what reads as "the subject reacted". */
  transform: scaleY(1);
  transform-origin: center;
  transition: transform 240ms ease;
}
.dsr-pg-chart.is-hot .dsr-pg-svg { transform: scaleY(2.15); }

@keyframes dsr-pg-roll { to { transform: translateX(-600px); } }
/* Two copies of each trace sit end to end, so a -600 unit roll loops with no
   seam. CSS transforms on an SVG child work in user units, which is why this
   matches the viewBox width exactly. */
.dsr-pg-roll { animation: dsr-pg-roll 7s linear infinite; }
.dsr-pg-chart.is-hot .dsr-pg-roll { animation-duration: 2.4s; }

.dsr-pg-line { fill: none; stroke: #FF3DC8; stroke-width: 1.4; opacity: .9; }
.dsr-pg-line-b { stroke: #3FE0F0; stroke-width: 1.1; opacity: .72; }

/* the pen head, parked where the trace is being written */
.dsr-pg-pen {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 22%;
  width: 2px;
  background: rgba(255, 255, 255, .82);
  box-shadow: 0 0 10px 2px rgba(255, 61, 200, .7);
}

.dsr-pg-bpm {
  position: absolute;
  top: 5px;
  right: 8px;
  font-family: var(--dsr-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: .16em;
  color: rgba(255, 61, 200, .9);
}

.dsr-pg-qrow { display: flex; gap: 11px; margin-bottom: 14px; }

.dsr-pg-vol {
  flex: 0 0 auto;
  font-family: var(--dsr-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .1em;
  color: var(--iv-ink, #FF3DC8);
  padding-top: 4px;
}

.dsr-pg-q {
  margin: 0;
  min-width: 0;
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(1.1rem, 4.2vw, 1.5rem);
  line-height: 1.25;
  color: #FFF;
}

.dsr-pg-input {
  margin: 5px 0 14px;
  font-family: 'Caveat', cursive;
  font-size: 20px;
  line-height: 1.4;
  box-sizing: border-box;
  overflow-x: hidden;
}

/* the read-out ---------------------------------------------------------- */

@keyframes dsr-pg-slam {
  0%   { transform: scale(2.2) rotate(-16deg); opacity: 0; }
  55%  { transform: scale(.93) rotate(-5deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}

.dsr-pg-tape {
  position: relative;
  margin-bottom: 14px;
  padding: 13px 14px 12px;
  border: 1.5px dashed rgba(255, 90, 90, .55);
  border-radius: 11px;
  background: rgba(255, 90, 90, .07);
  animation: dsrDrawIn 220ms ease-out both;
}
.dsr-pg-tape.is-match {
  border-color: rgba(59, 209, 122, .55);
  background: rgba(59, 209, 122, .07);
}

.dsr-pg-stamp {
  position: absolute;
  top: -20px;
  right: 6px;
  pointer-events: none;
  /* The slam opens at 2.2x. Growing from the centre would push the stamp
     ~65px past the sheet's right edge for a third of a second, and the sheet
     clips its own x-overflow - so it lands half-cut. Pinning the origin to
     its own right edge makes it grow inward instead. */
  transform-origin: 100% 50%;
  animation: dsr-pg-slam 340ms cubic-bezier(.2, 1.4, .4, 1) both;
}

.dsr-pg-truth {
  margin: 3px 0 9px;
  font-family: 'Caveat', cursive;
  font-size: 21px;
  line-height: 1.35;
  color: #FFF;
  overflow-wrap: anywhere;
}

.dsr-pg-reading {
  margin: 0 0 10px;
  font-family: var(--dsr-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .14em;
  color: var(--dsr-dim);
}
.dsr-pg-reading-note { font-weight: 400; letter-spacing: .08em; text-transform: none; }

.dsr-pg-overrule { display: flex; flex-wrap: wrap; gap: 8px; }
.dsr-pg-overrule .dsr-tool-btn { flex: 1 1 auto; justify-content: center; min-height: 42px; }

.dsr-pg-foot { display: flex; flex-wrap: wrap; gap: 8px; }
.dsr-pg-foot .dsr-tool-btn { flex: 1 1 auto; justify-content: center; min-height: 44px; }

/* how far through the tape you are */
.dsr-pg-pips { display: flex; gap: 6px; justify-content: center; margin-top: 14px; }
.dsr-pg-pip {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--dsr-line);
  background: rgba(9, 13, 18, .8);
}
.dsr-pg-pip.is-match { background: #3BD17A; border-color: #3BD17A; }
.dsr-pg-pip.is-miss { background: #FF5A5A; border-color: #FF5A5A; }
.dsr-pg-pip.is-now { box-shadow: 0 0 0 3px rgba(255, 61, 200, .3); border-color: #FF3DC8; }

/* the final tape -------------------------------------------------------- */

.dsr-pg-score { text-align: center; margin-bottom: 14px; }

.dsr-pg-score-num {
  display: block;
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(2.6rem, 12vw, 3.6rem);
  line-height: 1;
  color: #FF3DC8;
  text-shadow: 3px 3px 0 rgba(0, 0, 0, .5);
}

.dsr-pg-score-lab {
  display: block;
  margin-top: 5px;
  font-family: var(--dsr-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .2em;
  color: var(--dsr-dim);
}

.dsr-pg-verdict {
  padding: 12px 14px;
  margin-bottom: 12px;
  border: 1.5px solid rgba(255, 90, 90, .5);
  border-radius: 11px;
  background: rgba(255, 90, 90, .07);
}
.dsr-pg-verdict.is-good { border-color: rgba(59, 209, 122, .5); background: rgba(59, 209, 122, .07); }
.dsr-pg-verdict strong {
  display: block;
  margin-bottom: 5px;
  font-family: var(--dsr-mono);
  font-size: 11px;
  letter-spacing: .2em;
  color: #FFF;
}
.dsr-pg-verdict span {
  font-family: 'Caveat', cursive;
  font-size: 19px;
  line-height: 1.35;
  color: var(--dsr-text);
}

.dsr-pg-record {
  margin: 0 0 12px;
  font-family: var(--dsr-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .16em;
  color: #FFC93F;
  text-align: center;
}

.dsr-pg-misses { display: grid; gap: 8px; margin-bottom: 14px; }

.dsr-pg-miss {
  display: grid;
  gap: 3px;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  background: rgba(9, 13, 18, .6);
  border: 1.5px solid var(--dsr-line);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 140ms ease;
}
.dsr-pg-miss:hover { border-color: #FF3DC8; }

.dsr-pg-miss-q {
  font-family: var(--dsr-mono);
  font-size: 10px;
  letter-spacing: .04em;
  color: var(--dsr-text);
  overflow-wrap: anywhere;
}
.dsr-pg-miss-a {
  font-family: 'Caveat', cursive;
  font-size: 18px;
  color: var(--dsr-dim);
  overflow-wrap: anywhere;
}
.dsr-pg-miss-go {
  font-family: var(--dsr-mono);
  font-size: 8.5px;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: rgba(255, 61, 200, .8);
}

@media (max-width: 480px) {
  .dsr-pg-callout-btn { flex: 1 1 100%; justify-content: center; }
  .dsr-pg-overrule .dsr-tool-btn, .dsr-pg-foot .dsr-tool-btn { flex: 1 1 100%; }
  .dsr-pg-stamp { top: -16px; right: 2px; }
}

@media (prefers-reduced-motion: reduce) {
  .dsr-pg, .dsr-pg-tape { animation: none; }
  .dsr-pg-roll, .dsr-pg-callout-btn-dot { animation: none; }
  .dsr-pg-stamp { animation: none; }
  .dsr-pg-svg { transition: none; }
}

@media (max-width: 480px) {
  .dsr-iv-grid { grid-template-columns: 1fr; }
  .dsr-iv-controls > * { flex: 1 1 100%; }
  .dsr-iv-modesbar .dsr-tool-btn { flex: 1 1 100%; justify-content: center; }
  .dsr-iv-addrow { flex-wrap: wrap; }
  .dsr-iv-addrow .dsr-tool-btn { width: 100%; justify-content: center; }
}

@media (prefers-reduced-motion: reduce) {
  .dsr-iv-spotlight, .dsr-iv-deck { animation: none; }
  .dsr-iv-meter-fill { transition: none; }
  .dsr-iv-pin:hover { transform: none; }
}
`;
