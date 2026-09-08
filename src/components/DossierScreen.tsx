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
  hashString,
  seeded,
  type StampId,
} from "./DossierArt";
import * as sfx from "@/lib/dossierAudio";

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

  if (Array.isArray(r.frontFields)) {
    return {
      portrait: typeof r.portrait === "string" ? r.portrait : null,
      frontFields: r.frontFields as IdentityField[],
      backFields: Array.isArray(r.backFields) ? (r.backFields as IdentityField[]) : DEFAULT_BACK_FIELDS,
    };
  }

  const carryOver = (fields: IdentityField[]) =>
    fields.map((f) => ({ ...f, value: typeof r[f.id] === "string" ? (r[f.id] as string) : "" }));

  return {
    portrait: typeof r.portrait === "string" ? r.portrait : null,
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

  /* The scan is what flips the card - clicking straight to the back would
     throw away the one bit of theatre this panel has. */
  const runScan = () => {
    if (scanning) return;
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
                onClick={() => fileRef.current?.click()}
                aria-label={identity.portrait ? "Replace the portrait" : "Add a portrait"}
                disabled={busy}
              >
                {identity.portrait ? (
                  <img src={identity.portrait} alt="" className="dsr-portrait-img" />
                ) : (
                  <span className="dsr-portrait-empty">
                    <ImageIcon className="w-6 h-6" aria-hidden />
                    <span>{busy ? "Developing…" : "Add photo"}</span>
                  </span>
                )}
                <span className="dsr-portrait-scan" aria-hidden />
              </button>

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

            <div className="dsr-fields">
              {identity.frontFields.map((f) => (
                <div key={f.id} className="dsr-field">
                  <div className="dsr-field-headrow">
                    <input
                      className="dsr-field-label-input"
                      value={f.label}
                      onChange={(e) => frontOps.rename(f.id, e.target.value)}
                      onBlur={onFlush}
                      placeholder="Field name"
                      maxLength={40}
                    />
                    <button
                      type="button"
                      className="dsr-field-x"
                      onClick={() => frontOps.remove(f.id)}
                      aria-label={"Remove " + (f.label || "field")}
                    >
                      <X className="w-3 h-3" aria-hidden />
                    </button>
                  </div>
                  <input
                    className="dsr-input"
                    value={f.value}
                    onChange={(e) => frontOps.setValue(f.id, e.target.value)}
                    onBlur={onFlush}
                    placeholder={f.placeholder ?? "Type it in"}
                    maxLength={200}
                  />
                </div>
              ))}
              <button type="button" className="dsr-field-add" onClick={frontOps.add}>
                <Plus className="w-3.5 h-3.5" aria-hidden /> Add field
              </button>
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

          <div className="dsr-back-fields">
            {identity.backFields.map((f) => (
              <div key={f.id} className="dsr-back-field">
                <div className="dsr-field-headrow">
                  <input
                    className="dsr-field-label-input"
                    value={f.label}
                    onChange={(e) => backOps.rename(f.id, e.target.value)}
                    onBlur={onFlush}
                    placeholder="Field name"
                    maxLength={40}
                  />
                  <button
                    type="button"
                    className="dsr-field-x"
                    onClick={() => backOps.remove(f.id)}
                    aria-label={"Remove " + (f.label || "field")}
                  >
                    <X className="w-3 h-3" aria-hidden />
                  </button>
                </div>
                <textarea
                  className="dsr-textarea"
                  rows={2}
                  value={f.value}
                  onChange={(e) => backOps.setValue(f.id, e.target.value)}
                  onBlur={onFlush}
                  placeholder={f.placeholder ?? "Type it in"}
                />
              </div>
            ))}
            <button type="button" className="dsr-field-add" onClick={backOps.add}>
              <Plus className="w-3.5 h-3.5" aria-hidden /> Add field
            </button>
          </div>

          <button type="button" className="dsr-flip-back" onClick={runScan}>
            <Fingerprint className="w-3.5 h-3.5" aria-hidden />
            Scan back to the front
          </button>
        </div>
      </div>
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
            return (
              <path
                key={l.id}
                d={d}
                className="dsr-strand"
                strokeWidth={width}
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
              (linkFrom === a.id ? " is-linking" : "")
            }
            style={
              {
                left: `${a.x}%`,
                top: `${a.y}%`,
                "--rot": `${a.rot}deg`,
              } as CSSProperties
            }
            onPointerDown={(e) => startDrag(e, a.id)}
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

            {notesForId === a.id && (
              <div
                className="dsr-artifact-notes"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <textarea
                  className="dsr-artifact-notes-text"
                  value={a.note}
                  onChange={(e) => setNote(a.id, e.target.value)}
                  onBlur={onFlush}
                  placeholder="Everything else about this one..."
                  rows={3}
                />
                <div className="dsr-artifact-tag-row">
                  <input
                    className="dsr-artifact-tag-input"
                    value={tagDrafts[a.id] ?? ""}
                    onChange={(e) => setTagDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag(a.id);
                      }
                    }}
                    placeholder="Add a tag, press Enter"
                    maxLength={24}
                  />
                  <button type="button" className="dsr-artifact-tag-add" onClick={() => addTag(a.id)}>
                    <Plus className="w-3 h-3" aria-hidden />
                  </button>
                </div>
              </div>
            )}
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
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingPinId = useRef<string | null>(null);

  const addPin = () => {
    const id = uid("pin");
    onChange((prev) => ({
      items: [...prev.items, { id, place: "New place", date: "", note: "", photo: null }],
    }));
    onFlush();
    setOpenId(id);
    sfx.dialClick();
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

  /* Scattered, not draggable - a stable position derived from the pin's own
     id, same seeded technique the corkboard uses for a freshly-added
     artifact's drop point. */
  const posFor = (id: string) => {
    const seed = hashString(id);
    const angle = seeded(seed, 1) * Math.PI * 2;
    const radius = 18 + seeded(seed, 2) * 74;
    return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
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

      <div className="dsr-radar-wrap">
        <RadarFace className="dsr-radar-face" />
        {travelogue.items.map((p) => {
          const pos = posFor(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={"dsr-radar-blip" + (openId === p.id ? " is-open" : "")}
              style={{ left: pos.x + "%", top: pos.y + "%" }}
              onClick={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
              aria-label={p.place || "Unnamed place"}
            >
              <span className="dsr-radar-blip-dot" aria-hidden />
              <span className="dsr-radar-blip-label">{p.place || "Unnamed"}</span>
            </button>
          );
        })}
        <button type="button" className="dsr-radar-add" onClick={addPin} aria-label="Add a place">
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

  const setField = (id: string, patch: Partial<SizingField>) =>
    onChange((prev) => ({ items: prev.items.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));

  const addField = () => {
    onChange((prev) => ({ items: [...prev.items, { id: uid("size"), part: "", value: "", unit: "" }] }));
    onFlush();
  };

  const removeField = (id: string) => {
    onChange((prev) => ({ items: prev.items.filter((f) => f.id !== id) }));
    onFlush();
  };

  return (
    <section className="dsr-panel dsr-sizing" aria-labelledby="dsr-sizing-head">
      <div className="dsr-panel-head">
        <h2 id="dsr-sizing-head" className="dsr-panel-title">
          Web-Shooter Sizing Blueprint
        </h2>
        <span className="dsr-panel-kicker">FOR WHEN YOU&apos;RE BUYING SOMETHING</span>
      </div>

      <div className="dsr-sizing-body">
        <VectorFigure highlight={highlight} className="dsr-sizing-figure" />

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
    timeCapsule.error;

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
    timeCapsule.saving;

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

      {loading ? (
        <p className="dsr-loading">Pulling the file&hellip;</p>
      ) : (
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
        </div>
      )}

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

.dsr-loading {
  position: relative;
  z-index: 10;
  text-align: center;
  font-family: var(--dsr-mono);
  font-size: 11px;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--dsr-dim);
  padding: 40px 0;
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

@keyframes dsr-scanline {
  from { transform: translateY(-8%); opacity: 0; }
  12%  { opacity: 1; }
  to   { transform: translateY(108%); opacity: 0; }
}
.dsr-scanline {
  position: absolute;
  left: 0;
  right: 0;
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
}
.dsr-field-x:hover { color: var(--dsr-accent); border-color: var(--dsr-accent); }
@media (hover: none) { .dsr-field-x { opacity: .9; } }

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
}

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
.dsr-artifact:focus-within .dsr-artifact-x { opacity: 1; }
@media (hover: none) { .dsr-artifact-x { opacity: 1; } }

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
.dsr-note-sheet:hover .dsr-note-x { opacity: 1; }
.dsr-note-x:hover { background: #C0293B; color: #FFF; }
@media (hover: none) { .dsr-note-x { opacity: .75; } }

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
.dsr-step:hover .dsr-step-x, .dsr-step:focus-within .dsr-step-x { opacity: 1; }
.dsr-step-x:hover { background: #C0293B; color: #FFF; }
@media (hover: none) { .dsr-step-x { opacity: .7; } }
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
}
.dsr-stamp-remove:hover { color: #FF5C6C; }

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
}
.dsr-quote-x:hover { color: #FF5C6C; }
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

.dsr-radar-wrap { position: relative; width: min(100%, 420px); aspect-ratio: 1; margin: 0 auto 18px; }
.dsr-radar-face { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; }
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
}
.dsr-capsule-x:hover { color: var(--dsr-accent); }
@media (hover: none) { .dsr-capsule-x { opacity: 1; } }

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
  position: fixed;
  right: 14px;
  bottom: 14px;
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
`;
