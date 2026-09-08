"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Check,
  CornerDownLeft,
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  Keyboard,
  Link as LinkIcon,
  MapPin as MapPinIcon,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";
import { useCachedDraft } from "@/lib/hooks/useCachedDraft";
import {
  canBrowserPlay,
  compressImage,
  dataUrlBytes,
  formatBytes,
  normaliseMediaMime,
  playableMediaSrc,
  readFileAsDataUrl,
  relabelDataUrl,
  transcodeVideo,
} from "@/lib/media/mediaPrep";
import {
  BugleMasthead,
  ComicPanel,
  MapPin,
  PIN_STYLES,
  PatrolMap,
  PushPin,
  Typewriter,
  hashString,
  seeded,
  seededPick,
  tornClipPath,
  type PinStyle,
} from "./DiaryArt";

/* ============================================================================
   CH.06 - SPIDER DIARY
   ----------------------------------------------------------------------------
   Design read: this chapter is a patrol log. Not a feed, not a notes app. It is
   a wall of physical evidence, written on a machine that leaves ink, pinned to a
   board, and plotted on a map. Three rooms, one desk.

   Dials, declared before generating: DESIGN_VARIANCE 9 / MOTION_INTENSITY 6 /
   VISUAL_DENSITY 7. The collage is deliberately asymmetric and busy, but the
   reader's own words are always the highest-contrast thing on screen.

   Layer scale (the only z-indexes used in this file):
     0  drawn backdrop         20 bottom console
     10 chapter content        30 case-file overlay
                               40 grain, pointer-events-none

   Data rule: every read and write below filters on couple_id. Postgres RLS
   enforces the same thing server side, but the rule is expressed here too.
   ========================================================================== */

/* Anything pinned to a log that is not the prose. Stored as one jsonb array on
   the row (shared_diary.attachments); `url` is either a real link or, for a
   file picked off the device, a base64 data URL - this project has no Storage
   bucket, so that is the house pattern (see CLAUDE.md). */
export type AttachmentKind = "link" | "image" | "video" | "audio" | "file";

export interface DiaryAttachment {
  id: string;
  kind: AttachmentKind;
  url: string;
  title: string;
  note?: string;
  mime?: string;
  size?: number;
}

interface DiaryEntry {
  id: string;
  couple_id: string;
  author_id: string;
  title: string;
  content: string;
  mood: string | null;
  location: string | null;
  weather: string | null;
  media_urls: string[] | null;
  attachments: DiaryAttachment[] | null;
  card_style: string | null;
  pin_x: number | null;
  pin_y: number | null;
  pin_style: string | null;
  created_at: string;
  updated_at: string;
}

/* A mood or a condition. Editable per couple - see the diary_tags table. */
interface DiaryTag {
  id: string;
  kind: "mood" | "condition";
  slug: string;
  label: string;
  mark: string | null;
  sort_order: number;
}

interface DiaryScreenProps {
  userId: string;
  coupleId: string;
  myName: string;
  partnerName: string;
  onBack: () => void;
}

type ChapterView = "write" | "logs" | "map";
type ClippingStyle = "newspaper" | "bugle" | "sticky" | "polaroid";

const CLIPPING_STYLES: { id: ClippingStyle; label: string; hint: string }[] = [
  { id: "newspaper", label: "Torn clipping", hint: "Tabloid headline, two columns" },
  { id: "bugle", label: "Bugle cutting", hint: "Masthead across the top" },
  { id: "sticky", label: "Sticky note", hint: "Taped up, handwritten" },
  { id: "polaroid", label: "Polaroid", hint: "Photo first, caption under" },
];

const ALL_STYLES: readonly ClippingStyle[] = ["newspaper", "bugle", "sticky", "polaroid"];

/* Moods are still a vocabulary rather than free text - that is what lets the
   log feed filter and colour-code them - but the vocabulary is now the
   couple's own, kept in `diary_tags` and editable from the job ticket. These
   are only the starting set, written once when a couple opens the chapter for
   the first time; after that they are ordinary rows that can be renamed or
   torn up like any other. */
const SEED_MOODS: { slug: string; label: string; mark: string }[] = [
  { slug: "wired", label: "Wired", mark: "⚡" },
  { slug: "soft", label: "Soft", mark: "\u{1F90D}" },
  { slug: "wrecked", label: "Wrecked", mark: "\u{1F573}️" },
  { slug: "giddy", label: "Giddy", mark: "✨" },
  { slug: "homesick", label: "Homesick", mark: "\u{1F5A4}" },
  { slug: "steady", label: "Steady", mark: "\u{1F578}️" },
  { slug: "restless", label: "Restless", mark: "\u{1F300}" },
  { slug: "smug", label: "Smug", mark: "\u{1F60F}" },
];

const SEED_CONDITIONS: { slug: string; label: string }[] = [
  { slug: "clear", label: "Clear skies" },
  { slug: "rain", label: "Rain on the mask" },
  { slug: "fog", label: "Fog over the river" },
  { slug: "snow", label: "Snow" },
  { slug: "heat", label: "Heatwave" },
  { slug: "night", label: "Dead of night" },
];

/* Entries store the slug, not the tag's row id, so tearing up a mood never
   rewrites or orphans a log - it just stops resolving. When that happens the
   card shows the slug back, tidied up, rather than silently dropping the fact
   that the entry was tagged at all. */
function orphanTag(slug: string, kind: "mood" | "condition"): DiaryTag {
  return {
    id: "orphan:" + kind + ":" + slug,
    kind,
    slug,
    label: slug.charAt(0).toUpperCase() + slug.slice(1).replace(/[-_]+/g, " "),
    mark: kind === "mood" ? "•" : null,
    sort_order: 9999,
  };
}

function findTag(tags: DiaryTag[], kind: "mood" | "condition", slug: string | null) {
  if (!slug) return null;
  return tags.find((t) => t.kind === kind && t.slug === slug) ?? orphanTag(slug, kind);
}

/** "Rain on the mask" -> "rain-on-the-mask". Kept short enough for the column. */
function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "tag"
  );
}

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/** "MARCH 15", the caption-box format from the reference boards. */
function captionDate(iso: string): string {
  const d = new Date(iso);
  return MONTHS[d.getMonth()] + " " + d.getDate();
}

function longDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Bugle-style edition line. Deliberately not a round number. */
function editionLine(iso: string): string {
  const d = new Date(iso);
  return "NO. " + (1400 + (d.getDate() * 7 + d.getMonth() * 13)) + " / " + captionDate(iso);
}

/* Censor bars standing in for a log's prose on the board. Deliberately drawn
   rather than a blur of the real text: a blur can be undone with a screenshot
   and a filter, and more to the point it still shows the SHAPE of what was
   written. These carry no information at all beyond roughly how long the entry
   is, which is the point - the board should tell you a log exists without
   telling you what happened.

   Widths come off the entry's own seed, so a given log always wears the same
   pattern and re-rendering the board never reshuffles the ink. */
const RedactionBars = memo(function RedactionBars({
  seed,
  length,
}: {
  seed: number;
  length: number;
}) {
  const lines = Math.max(3, Math.min(7, Math.round(length / 90) + 2));

  return (
    <span className="dy-redact-stack" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => {
        const last = i === lines - 1;
        const width = last
          ? 28 + seeded(seed, 40 + i) * 30
          : 74 + seeded(seed, 40 + i) * 26;
        return (
          <span
            key={i}
            className="dy-redact-bar"
            style={{ width: Math.min(100, width).toFixed(1) + "%" }}
          />
        );
      })}
    </span>
  );
});

/* ==========================================================================
   COMPOSER
   The write view owns its own state so a keystroke re-renders the sheet and
   nothing else. It is remounted with a key when the reader switches between a
   new log and editing an existing one, which is how the fields get prefilled
   without a synchronising effect.
   ========================================================================== */

interface DraftValues {
  title: string;
  content: string;
  mood: string | null;
  location: string;
  weather: string | null;
  cardStyle: ClippingStyle;
  pinX: number | null;
  pinY: number | null;
  pinStyle: PinStyle;
  attachments: DiaryAttachment[];
}

const EMPTY_DRAFT: DraftValues = {
  title: "",
  content: "",
  mood: null,
  location: "",
  weather: null,
  cardStyle: "newspaper",
  pinX: null,
  pinY: null,
  pinStyle: "spider",
  attachments: [],
};

/* Picked-file ceilings, before preparation. Images are downscaled and clips are
   re-encoded on the way in (see mediaPrep), so these bound what gets read into
   memory rather than what lands in the row - the row itself is bounded by the
   shared_diary_attachments_size_guardrail CHECK. */
const MAX_PICK_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PICK_VIDEO_BYTES = 60 * 1024 * 1024;
const MAX_PICK_AUDIO_BYTES = 20 * 1024 * 1024;

/* What one log is allowed to carry once everything is prepared. Deliberately
   well under the 30MB database guardrail so a save never bounces off Postgres
   with a constraint error the writer cannot act on. */
const MAX_ATTACHMENT_BYTES_TOTAL = 22 * 1024 * 1024;
const MAX_ATTACHMENTS = 12;

function attachmentBytes(list: DiaryAttachment[]): number {
  return list.reduce((sum, a) => sum + (a.size ?? a.url.length), 0);
}

/** A pasted link only counts as one if it is http(s) - no javascript: hrefs. */
function normaliseLink(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : "https://" + trimmed;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** "youtube.com/watch?v=..." -> "youtube.com", for the link chip's label. */
function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

const newAttachmentId = () =>
  "att_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** The photo a clipping shows: first image attachment, else the legacy column. */
function coverPhotoOf(entry: {
  attachments: DiaryAttachment[] | null;
  media_urls: string[] | null;
}): string | null {
  const img = (entry.attachments ?? []).find((a) => a.kind === "image");
  if (img) return img.url;
  return entry.media_urls && entry.media_urls.length > 0 ? entry.media_urls[0] : null;
}

function Composer({
  initial,
  editing,
  saving,
  errorText,
  draftScope,
  moods,
  conditions,
  onAddTag,
  onDeleteTag,
  tagError,
  onSubmit,
  onCancelEdit,
}: {
  initial: DraftValues;
  editing: boolean;
  saving: boolean;
  errorText: string | null;
  /* localStorage key for the crash-proof draft. Null disables caching. */
  draftScope: string | null;
  moods: DiaryTag[];
  conditions: DiaryTag[];
  onAddTag: (kind: "mood" | "condition", label: string, mark: string) => Promise<void>;
  onDeleteTag: (tag: DiaryTag) => Promise<void>;
  tagError: string | null;
  onSubmit: (draft: DraftValues) => void;
  onCancelEdit: () => void;
}) {
  /* Was plain useState. A half-written log now survives a refresh, an
     accidental swipe-back, or the PWA shell reloading a backgrounded tab -
     which on a phone is the most common way writing gets lost. Attachments are
     dropped from the cached copy if the draft is too big for localStorage;
     `restoredPruned` is how the writer gets told that happened. */
  const {
    draft,
    setDraft,
    restored,
    restoredPruned,
    discard: discardCachedDraft,
    commit: commitCachedDraft,
    dismissRestored,
  } = useCachedDraft<DraftValues>(draftScope, initial, {
    isEmpty: (d) =>
      !d.title.trim() && !d.content.trim() && !d.location.trim() && d.attachments.length === 0,
    prune: (d) => ({ ...d, attachments: d.attachments.filter((a) => a.kind === "link") }),
  });

  const [showPinMap, setShowPinMap] = useState(initial.pinX !== null);
  const [touched, setTouched] = useState(false);

  /* Tag composer + attachment tray state */
  const [tagKindOpen, setTagKindOpen] = useState<"mood" | "condition" | null>(null);
  const [newTagLabel, setNewTagLabel] = useState("");
  const [newTagMark, setNewTagMark] = useState("");
  const [addingTag, setAddingTag] = useState(false);

  const [linkValue, setLinkValue] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [attachBusy, setAttachBusy] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const machineRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const strikeFlip = useRef(false);
  const rollRaf = useRef<number | null>(null);

  const set = <K extends keyof DraftValues>(key: K, value: DraftValues[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  /* One keystroke kicks the type bars. Two alternating class names restart the
     animation without a forced reflow; toggling one class off and on again
     needs a synchronous layout read per keypress, which is exactly the kind of
     thing that makes typing feel heavy. */
  const strike = useCallback(() => {
    const el = machineRef.current;
    if (!el) return;
    strikeFlip.current = !strikeFlip.current;
    el.classList.toggle("dy-strike-a", strikeFlip.current);
    el.classList.toggle("dy-strike-b", !strikeFlip.current);
  }, []);

  /* The platen turns as the sheet scrolls. Written straight onto the node
     inside one rAF, never through React state. */
  const handleBodyScroll = useCallback(() => {
    if (rollRaf.current !== null) return;
    rollRaf.current = requestAnimationFrame(() => {
      rollRaf.current = null;
      const ta = bodyRef.current;
      const el = machineRef.current;
      if (!ta || !el) return;
      el.style.setProperty("--dy-roll", String(ta.scrollTop * 0.35) + "deg");
    });
  }, []);

  useEffect(
    () => () => {
      if (rollRaf.current !== null) cancelAnimationFrame(rollRaf.current);
    },
    []
  );

  const titleMissing = touched && !draft.title.trim();
  const bodyMissing = touched && !draft.content.trim();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!draft.title.trim() || !draft.content.trim()) return;
    /* Drop the localStorage copy on the way out. If the write itself fails the
       parent keeps the composer mounted with the same values on screen, so
       nothing is lost - and the next keystroke starts caching again. */
    commitCachedDraft();
    onSubmit(draft);
  };

  /* ------------------------------ vocabulary ------------------------------ */

  const submitNewTag = async () => {
    if (!tagKindOpen) return;
    const label = newTagLabel.trim();
    if (!label) return;
    setAddingTag(true);
    try {
      await onAddTag(tagKindOpen, label, newTagMark.trim());
      setNewTagLabel("");
      setNewTagMark("");
      setTagKindOpen(null);
    } finally {
      setAddingTag(false);
    }
  };

  /* Tearing up a tag that this draft is currently wearing would leave the draft
     pointing at a slug nothing resolves, so clear the selection too. */
  const removeTag = async (tag: DiaryTag) => {
    await onDeleteTag(tag);
    setDraft((d) => {
      if (tag.kind === "mood" && d.mood === tag.slug) return { ...d, mood: null };
      if (tag.kind === "condition" && d.weather === tag.slug) return { ...d, weather: null };
      return d;
    });
  };

  /* ------------------------------ attachments ------------------------------ */

  const addAttachment = (att: DiaryAttachment): boolean => {
    if (draft.attachments.length >= MAX_ATTACHMENTS) {
      setAttachError("A log holds " + MAX_ATTACHMENTS + " pieces of evidence at most.");
      return false;
    }
    const nextBytes = attachmentBytes(draft.attachments) + (att.size ?? att.url.length);
    if (nextBytes > MAX_ATTACHMENT_BYTES_TOTAL) {
      setAttachError(
        "That would push this log past " +
          formatBytes(MAX_ATTACHMENT_BYTES_TOTAL) +
          " of evidence. Remove something first, or file it as a link."
      );
      return false;
    }
    setAttachError(null);
    setDraft((d) => ({ ...d, attachments: [...d.attachments, att] }));
    return true;
  };

  const addLink = () => {
    const url = normaliseLink(linkValue);
    if (!url) {
      setAttachError("That does not look like a web address.");
      return;
    }
    const ok = addAttachment({
      id: newAttachmentId(),
      kind: "link",
      url,
      title: linkTitle.trim() || linkHost(url),
      size: url.length,
    });
    if (ok) {
      setLinkValue("");
      setLinkTitle("");
    }
  };

  /* Files are prepared in the browser before they are ever stored: photos are
     downscaled and re-encoded, clips are re-labelled (and re-encoded only when
     they are genuinely too big or undecodable). All of it is local work on a
     file the writer picked - no API route, no metered service, nothing new to
     rate-limit. */
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachError(null);

    for (const file of Array.from(files)) {
      setAttachBusy(file.name);
      try {
        if (file.type.startsWith("image/")) {
          if (file.size > MAX_PICK_IMAGE_BYTES) {
            setAttachError(file.name + " is over " + formatBytes(MAX_PICK_IMAGE_BYTES) + ".");
            continue;
          }
          const prepared = await compressImage(file, { maxEdge: 1800, targetBytes: 1_200_000 });
          addAttachment({
            id: newAttachmentId(),
            kind: "image",
            url: prepared.dataUrl,
            title: file.name,
            mime: "image/jpeg",
            size: dataUrlBytes(prepared.dataUrl),
          });
        } else if (file.type.startsWith("video/")) {
          if (file.size > MAX_PICK_VIDEO_BYTES) {
            setAttachError(file.name + " is over " + formatBytes(MAX_PICK_VIDEO_BYTES) + ".");
            continue;
          }
          const raw = await readFileAsDataUrl(file);
          const { dataUrl } = relabelDataUrl(raw, file.type);
          let finalUrl = dataUrl;

          /* Only re-encode when it has to be done: transcoding runs in real
             time, so a 60s clip costs 60s of the writer's life. */
          const tooBig = dataUrlBytes(dataUrl) > MAX_ATTACHMENT_BYTES_TOTAL / 2;
          const playable = await canBrowserPlay(file);
          if (tooBig || !playable) {
            const out = await transcodeVideo(file, { maxEdge: 960 });
            finalUrl = out.dataUrl;
          }

          addAttachment({
            id: newAttachmentId(),
            kind: "video",
            url: finalUrl,
            title: file.name,
            mime: normaliseMediaMime(file.type),
            size: dataUrlBytes(finalUrl),
          });
        } else if (file.type.startsWith("audio/")) {
          if (file.size > MAX_PICK_AUDIO_BYTES) {
            setAttachError(file.name + " is over " + formatBytes(MAX_PICK_AUDIO_BYTES) + ".");
            continue;
          }
          const dataUrl = await readFileAsDataUrl(file);
          addAttachment({
            id: newAttachmentId(),
            kind: "audio",
            url: dataUrl,
            title: file.name,
            mime: file.type,
            size: dataUrlBytes(dataUrl),
          });
        } else {
          setAttachError(
            "Photos, clips and audio can be pinned to a log. Anything else, paste a link to it."
          );
        }
      } catch (err) {
        setAttachError(
          err instanceof Error ? err.message : "That file could not be pinned to the log."
        );
      } finally {
        setAttachBusy(null);
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (id: string) => {
    setAttachError(null);
    setDraft((d) => ({ ...d, attachments: d.attachments.filter((a) => a.id !== id) }));
  };

  const usedBytes = attachmentBytes(draft.attachments);

  const placePin = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    setDraft((d) => ({ ...d, pinX: x, pinY: y }));
  };

  return (
    <form className="dy-write" onSubmit={submit} noValidate>
      {/* ---------- the desk: a sheet rolling out of the machine ---------- */}
      <div className="dy-desk">
        <div className="dy-sheet">
          <span className="dy-sheet-perf" aria-hidden />

          <div className="dy-sheet-head">
            <span>FIELD LOG</span>
            <span>{longDate(new Date().toISOString())}</span>
          </div>

          <label className="dy-field-label" htmlFor="dy-title">
            Headline
          </label>
          <input
            id="dy-title"
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            onKeyDown={strike}
            className="dy-headline-input"
            placeholder="The Bridge Battle"
            maxLength={90}
            autoComplete="off"
          />
          {titleMissing && <p className="dy-inline-error">Give the log a headline before filing it.</p>}

          <label className="dy-field-label" htmlFor="dy-body">
            The log
          </label>
          <textarea
            id="dy-body"
            ref={bodyRef}
            value={draft.content}
            onChange={(e) => set("content", e.target.value)}
            onKeyDown={strike}
            onScroll={handleBodyScroll}
            rows={4}
            className="dy-body-input"
            placeholder="What happened today, in your own words."
          />
          {bodyMissing && <p className="dy-inline-error">The sheet is still blank.</p>}

          <div className="dy-sheet-foot">
            <span>{draft.content.length} characters struck</span>
            <span className="dy-bell" aria-hidden>
              <CornerDownLeft className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>

        <div className="dy-machine" ref={machineRef}>
          <Typewriter className="dy-machine-art" />
        </div>
      </div>

      {/* ---------- the job ticket: everything that is not the prose ---------- */}
      <aside className="dy-ticket">
        <span className="dy-clip-bar" aria-hidden />

        <h2 className="dy-ticket-title">Filing details</h2>

        {restored && (
          <div className="dy-restored" role="status">
            <span className="dy-restored-mark" aria-hidden>
              <RotateCcw className="w-3.5 h-3.5" />
            </span>
            <div className="dy-restored-body">
              <strong>Picked up where you left off.</strong>
              {restoredPruned
                ? " Your words came back, but the attachments were too heavy to keep on the desk — pin them again."
                : " This log was still on the roller from last time."}
            </div>
            <div className="dy-restored-actions">
              <button type="button" className="dy-mini-btn" onClick={dismissRestored}>
                Keep it
              </button>
              <button type="button" className="dy-mini-btn" onClick={discardCachedDraft}>
                Start fresh
              </button>
            </div>
          </div>
        )}

        <fieldset className="dy-set">
          <legend className="dy-field-label">Mood</legend>
          <div className="dy-chips">
            {moods.map((m) => (
              <span key={m.id} className="dy-chip-wrap">
                <button
                  type="button"
                  onClick={() => set("mood", draft.mood === m.slug ? null : m.slug)}
                  className="dy-chip"
                  data-on={draft.mood === m.slug}
                >
                  {m.mark && <span aria-hidden>{m.mark}</span>}
                  {m.label}
                </button>
                <button
                  type="button"
                  className="dy-chip-x"
                  onClick={() => removeTag(m)}
                  aria-label={"Tear up the " + m.label + " mood"}
                  title={"Tear up “" + m.label + "”"}
                >
                  <X className="w-2.5 h-2.5" aria-hidden />
                </button>
              </span>
            ))}

            <button
              type="button"
              className="dy-chip dy-chip-add"
              onClick={() => setTagKindOpen(tagKindOpen === "mood" ? null : "mood")}
              aria-expanded={tagKindOpen === "mood"}
            >
              <Plus className="w-3 h-3" aria-hidden />
              New mood
            </button>
          </div>

          {tagKindOpen === "mood" && (
            <div className="dy-tag-new">
              <input
                value={newTagMark}
                onChange={(e) => setNewTagMark(e.target.value.slice(0, 4))}
                className="dy-text-input dy-tag-mark"
                placeholder="🕸"
                aria-label="Mood symbol"
              />
              <input
                value={newTagLabel}
                onChange={(e) => setNewTagLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitNewTag();
                  }
                }}
                className="dy-text-input"
                placeholder="Name it. Seasick, maybe."
                maxLength={40}
                aria-label="Mood name"
              />
              <button
                type="button"
                className="dy-mini-btn"
                onClick={() => void submitNewTag()}
                disabled={addingTag || !newTagLabel.trim()}
              >
                {addingTag ? "Adding..." : "Add"}
              </button>
            </div>
          )}
        </fieldset>

        <fieldset className="dy-set">
          <legend className="dy-field-label">Conditions</legend>
          <div className="dy-chips">
            {conditions.map((c) => (
              <span key={c.id} className="dy-chip-wrap">
                <button
                  type="button"
                  onClick={() => set("weather", draft.weather === c.slug ? null : c.slug)}
                  className="dy-chip"
                  data-on={draft.weather === c.slug}
                >
                  {c.label}
                </button>
                <button
                  type="button"
                  className="dy-chip-x"
                  onClick={() => removeTag(c)}
                  aria-label={"Tear up the " + c.label + " condition"}
                  title={"Tear up “" + c.label + "”"}
                >
                  <X className="w-2.5 h-2.5" aria-hidden />
                </button>
              </span>
            ))}

            <button
              type="button"
              className="dy-chip dy-chip-add"
              onClick={() => setTagKindOpen(tagKindOpen === "condition" ? null : "condition")}
              aria-expanded={tagKindOpen === "condition"}
            >
              <Plus className="w-3 h-3" aria-hidden />
              New condition
            </button>
          </div>

          {tagKindOpen === "condition" && (
            <div className="dy-tag-new">
              <input
                value={newTagLabel}
                onChange={(e) => setNewTagLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitNewTag();
                  }
                }}
                className="dy-text-input"
                placeholder="Thunder over the bay"
                maxLength={40}
                aria-label="Condition name"
              />
              <button
                type="button"
                className="dy-mini-btn"
                onClick={() => void submitNewTag()}
                disabled={addingTag || !newTagLabel.trim()}
              >
                {addingTag ? "Adding..." : "Add"}
              </button>
            </div>
          )}
        </fieldset>

        {tagError && <p className="dy-form-error">{tagError}</p>}

        {/* ------------------------------ evidence ------------------------------ */}
        <div className="dy-set">
          <div className="dy-set-row">
            <span className="dy-field-label">Evidence</span>
            <span className="dy-set-meter">
              {draft.attachments.length}/{MAX_ATTACHMENTS} &middot; {formatBytes(usedBytes)}
            </span>
          </div>

          {draft.attachments.length > 0 && (
            <ul className="dy-evidence">
              {draft.attachments.map((a) => (
                <li key={a.id} className="dy-evidence-item" data-kind={a.kind}>
                  <span className="dy-evidence-mark" aria-hidden>
                    {a.kind === "link" ? (
                      <LinkIcon className="w-3.5 h-3.5" />
                    ) : a.kind === "image" ? (
                      <ImageIcon className="w-3.5 h-3.5" />
                    ) : a.kind === "video" ? (
                      <Film className="w-3.5 h-3.5" />
                    ) : (
                      <Mic className="w-3.5 h-3.5" />
                    )}
                  </span>

                  {a.kind === "image" ? (
                    <img src={a.url} alt="" className="dy-evidence-thumb" />
                  ) : null}

                  <span className="dy-evidence-name" title={a.title}>
                    {a.title}
                  </span>
                  <span className="dy-evidence-size">
                    {a.kind === "link" ? linkHost(a.url) : formatBytes(a.size ?? a.url.length)}
                  </span>

                  <button
                    type="button"
                    className="dy-chip-x"
                    onClick={() => removeAttachment(a.id)}
                    aria-label={"Unpin " + a.title}
                  >
                    <X className="w-2.5 h-2.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="dy-attach-link">
            <input
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
              className="dy-text-input"
              placeholder="Paste a link — a song, a map, a photo album"
              inputMode="url"
              aria-label="Link address"
            />
            <input
              value={linkTitle}
              onChange={(e) => setLinkTitle(e.target.value)}
              className="dy-text-input dy-attach-caption"
              placeholder="Call it something"
              maxLength={60}
              aria-label="Link label"
            />
            <button type="button" className="dy-mini-btn" onClick={addLink} disabled={!linkValue.trim()}>
              Pin link
            </button>
          </div>

          <div className="dy-attach-file">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*"
              multiple
              className="sr-only"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <button
              type="button"
              className="dy-mini-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={attachBusy !== null}
            >
              <Paperclip className="w-3.5 h-3.5" aria-hidden />
              {attachBusy ? "Preparing " + attachBusy + "…" : "Attach a photo, clip or voice note"}
            </button>
          </div>

          {attachError && <p className="dy-inline-error">{attachError}</p>}
        </div>

        <div className="dy-set">
          <label className="dy-field-label" htmlFor="dy-where">
            Where
          </label>
          <input
            id="dy-where"
            value={draft.location}
            onChange={(e) => set("location", e.target.value)}
            className="dy-text-input"
            placeholder="The rooftop on Ashby"
            maxLength={80}
            autoComplete="off"
          />
        </div>

        <div className="dy-set">
          <span className="dy-field-label">Clipping style</span>
          <div className="dy-style-grid">
            {CLIPPING_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => set("cardStyle", s.id)}
                className="dy-style-pick"
                data-on={draft.cardStyle === s.id}
                title={s.hint}
              >
                <span className={"dy-style-mini dy-mini-" + s.id} aria-hidden />
                <span className="dy-style-name">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="dy-set">
          <div className="dy-set-row">
            <span className="dy-field-label">Patrol pin</span>
            <button type="button" className="dy-mini-btn" onClick={() => setShowPinMap((v) => !v)}>
              {showPinMap ? "Hide map" : draft.pinX === null ? "Drop a pin" : "Move pin"}
            </button>
          </div>

          {draft.pinX !== null && (
            <p className="dy-set-note">
              Pinned. Tap the map again to move it, or clear it below.
            </p>
          )}

          {showPinMap && (
            <>
              <div className="dy-minimap" onClick={placePin} role="presentation">
                <PatrolMap className="dy-minimap-art" />
                {draft.pinX !== null && draft.pinY !== null && (
                  <span
                    className="dy-minimap-pin"
                    style={{ left: draft.pinX * 100 + "%", top: draft.pinY * 100 + "%" }}
                  >
                    <MapPin style={draft.pinStyle} size={26} />
                  </span>
                )}
              </div>

              <div className="dy-chips dy-chips-tight">
                {PIN_STYLES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => set("pinStyle", p.id)}
                    className="dy-pin-pick"
                    data-on={draft.pinStyle === p.id}
                    title={p.label}
                    aria-label={p.label}
                  >
                    <MapPin style={p.id} size={22} />
                  </button>
                ))}
                {draft.pinX !== null && (
                  <button
                    type="button"
                    className="dy-mini-btn"
                    onClick={() => setDraft((d) => ({ ...d, pinX: null, pinY: null }))}
                  >
                    Clear pin
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {errorText && <p className="dy-form-error">{errorText}</p>}

        <div className="dy-ticket-actions">
          <button type="submit" className="dy-file-btn" disabled={saving}>
            {saving ? "FILING..." : editing ? "UPDATE LOG" : "FILE IT"}
          </button>
          {editing && (
            <button type="button" className="dy-ghost-btn" onClick={onCancelEdit}>
              Cancel edit
            </button>
          )}
        </div>
      </aside>
    </form>
  );
}

/* ==========================================================================
   THE CHAPTER
   ========================================================================== */

export default function DiaryScreen({
  userId,
  coupleId,
  myName,
  partnerName,
  onBack,
}: DiaryScreenProps) {
  const supabase = useMemo(() => createClient(), []);

  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [view, setView] = useState<ChapterView>("logs");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftSeed, setDraftSeed] = useState<DraftValues>(EMPTY_DRAFT);

  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState<"all" | "me" | "them">("all");
  const [moodFilter, setMoodFilter] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [placingId, setPlacingId] = useState<string | null>(null);

  /* Which clippings the reader has chosen to un-redact on the board. A log is
     covered by default so walking past the board never spoils what is in it -
     see the redaction bars in renderClipping. */
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [revealAll, setRevealAll] = useState(false);

  const [tags, setTags] = useState<DiaryTag[]>([]);
  const [tagError, setTagError] = useState<string | null>(null);

  /* -------------------------------- data -------------------------------- */

  const loadEntries = useCallback(async () => {
    const { data, error } = await supabase
      .from("shared_diary")
      .select(
        "id, couple_id, author_id, title, content, mood, location, weather, media_urls, attachments, card_style, pin_x, pin_y, pin_style, created_at, updated_at"
      )
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false });

    if (error) setLoadError(error.message);
    else {
      setEntries((data ?? []) as DiaryEntry[]);
      setLoadError(null);
    }
    setLoading(false);
  }, [coupleId, supabase]);

  /* The mood/condition vocabulary. Seeded once per couple from SEED_MOODS /
     SEED_CONDITIONS the first time the chapter is opened; after that these are
     ordinary rows the couple owns and can rewrite. The seed insert is
     `upsert ... ignoreDuplicates` against the (couple_id, kind, slug) unique
     key, so both partners opening the chapter at the same moment cannot
     produce a doubled vocabulary. */
  const loadTags = useCallback(async () => {
    const { data, error } = await supabase
      .from("diary_tags")
      .select("id, kind, slug, label, mark, sort_order")
      .eq("couple_id", coupleId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      setTagError(error.message);
      return;
    }

    if ((data ?? []).length > 0) {
      setTags(data as DiaryTag[]);
      setTagError(null);
      return;
    }

    const seed = [
      ...SEED_MOODS.map((m, i) => ({
        couple_id: coupleId,
        kind: "mood",
        slug: m.slug,
        label: m.label,
        mark: m.mark,
        sort_order: i,
        created_by: userId,
      })),
      ...SEED_CONDITIONS.map((c, i) => ({
        couple_id: coupleId,
        kind: "condition",
        slug: c.slug,
        label: c.label,
        mark: null,
        sort_order: i,
        created_by: userId,
      })),
    ];

    const { error: seedErr } = await supabase
      .from("diary_tags")
      .upsert(seed, { onConflict: "couple_id,kind,slug", ignoreDuplicates: true });

    if (seedErr) {
      setTagError(seedErr.message);
      return;
    }

    const { data: seeded } = await supabase
      .from("diary_tags")
      .select("id, kind, slug, label, mark, sort_order")
      .eq("couple_id", coupleId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    setTags((seeded ?? []) as DiaryTag[]);
    setTagError(null);
  }, [coupleId, supabase, userId]);

  const addTag = useCallback(
    async (kind: "mood" | "condition", label: string, mark: string) => {
      const slug = slugify(label);
      if (tags.some((t) => t.kind === kind && t.slug === slug)) {
        setTagError("There is already a " + kind + " called that.");
        return;
      }
      const highest = tags
        .filter((t) => t.kind === kind)
        .reduce((max, t) => Math.max(max, t.sort_order), -1);

      const { data, error } = await supabase
        .from("diary_tags")
        .insert({
          couple_id: coupleId,
          kind,
          slug,
          label: label.trim().slice(0, 40),
          mark: kind === "mood" ? mark.slice(0, 8) || "•" : null,
          sort_order: highest + 1,
          created_by: userId,
        })
        .select("id, kind, slug, label, mark, sort_order")
        .single();

      if (error) {
        setTagError(error.message);
        return;
      }
      setTagError(null);
      setTags((list) => [...list, data as DiaryTag]);
    },
    [coupleId, supabase, tags, userId]
  );

  const deleteTag = useCallback(
    async (tag: DiaryTag) => {
      /* An orphan is a slug on an entry with no row behind it - there is
         nothing to delete, and no row id to delete it by. */
      if (tag.id.startsWith("orphan:")) return;

      setTags((list) => list.filter((t) => t.id !== tag.id));
      const { error } = await supabase
        .from("diary_tags")
        .delete()
        .eq("id", tag.id)
        .eq("couple_id", coupleId);

      if (error) {
        setTagError(error.message);
        await loadTags();
      }
    },
    [coupleId, loadTags, supabase]
  );

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  /* Live board. shared_diary was added to the supabase_realtime publication for
     this chapter, so a log written on one phone lands on the other board without
     a refresh. Realtime still applies RLS per subscriber. */
  useEffect(() => {
    const channel = supabase
      .channel("shared_diary_" + coupleId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shared_diary",
          filter: "couple_id=eq." + coupleId,
        },
        () => {
          loadEntries();
        }
      )
      /* Same channel carries the vocabulary, so a mood added on one phone
         appears as a chip on the other without a refresh. */
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "diary_tags",
          filter: "couple_id=eq." + coupleId,
        },
        () => {
          loadTags();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [coupleId, loadEntries, loadTags, supabase]);

  const saveDraft = async (draft: DraftValues) => {
    setSaving(true);
    setFormError(null);

    const values = {
      couple_id: coupleId,
      author_id: userId,
      title: draft.title.trim(),
      content: draft.content.trim(),
      mood: draft.mood,
      location: draft.location.trim() || null,
      weather: draft.weather,
      card_style: draft.cardStyle,
      pin_x: draft.pinX,
      pin_y: draft.pinY,
      pin_style: draft.pinX === null ? null : draft.pinStyle,
      attachments: draft.attachments,
      updated_at: new Date().toISOString(),
    };

    /* Belt and braces against the shared_diary_attachments_size_guardrail
       CHECK: the composer already bounds this, but a draft restored from an
       older localStorage copy could in principle arrive over the line, and a
       raw Postgres constraint error is not something a writer can act on. */
    if (attachmentBytes(draft.attachments) > MAX_ATTACHMENT_BYTES_TOTAL) {
      setFormError(
        "This log is carrying more than " +
          formatBytes(MAX_ATTACHMENT_BYTES_TOTAL) +
          " of evidence. Unpin something and file it again."
      );
      setSaving(false);
      return;
    }

    const result = editingId
      ? await supabase.from("shared_diary").update(values).eq("id", editingId).eq("couple_id", coupleId)
      : await supabase.from("shared_diary").insert(values);

    if (result.error) {
      setFormError(result.error.message);
      setSaving(false);
      return;
    }

    await loadEntries();
    setEditingId(null);
    setDraftSeed(EMPTY_DRAFT);
    setSaving(false);
    setView("logs");
  };

  const [runSave] = useGuardedAction(saveDraft, 700);

  const deleteEntry = async (id: string) => {
    const { error } = await supabase
      .from("shared_diary")
      .delete()
      .eq("id", id)
      .eq("couple_id", coupleId);

    if (error) {
      setLoadError(error.message);
      return;
    }
    setEntries((rows) => rows.filter((r) => r.id !== id));
    setConfirmDeleteId(null);
    setOpenId(null);
    if (editingId === id) {
      setEditingId(null);
      setDraftSeed(EMPTY_DRAFT);
    }
  };

  const [runDelete, deleting] = useGuardedAction(deleteEntry, 700);

  const movePin = async (id: string, x: number, y: number, style: PinStyle) => {
    setEntries((rows) =>
      rows.map((r) => (r.id === id ? { ...r, pin_x: x, pin_y: y, pin_style: style } : r))
    );
    const { error } = await supabase
      .from("shared_diary")
      .update({ pin_x: x, pin_y: y, pin_style: style, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("couple_id", coupleId);

    if (error) {
      setLoadError(error.message);
      await loadEntries();
    }
  };

  const [runMovePin] = useGuardedAction(movePin, 400);

  /* ------------------------------ interaction ------------------------------ */

  const startEdit = (entry: DiaryEntry) => {
    setDraftSeed({
      title: entry.title,
      content: entry.content,
      mood: entry.mood,
      location: entry.location ?? "",
      weather: entry.weather,
      cardStyle: (entry.card_style as ClippingStyle) ?? "newspaper",
      pinX: entry.pin_x,
      pinY: entry.pin_y,
      pinStyle: (entry.pin_style as PinStyle) ?? "spider",
      /* Legacy rows written before attachments existed carry their photo in
         media_urls; surface it as a real attachment so editing one does not
         quietly drop the picture. */
      attachments:
        entry.attachments && entry.attachments.length > 0
          ? entry.attachments
          : (entry.media_urls ?? []).map((url, i) => ({
              id: "legacy_" + entry.id + "_" + i,
              kind: "image" as const,
              url,
              title: "Photo " + (i + 1),
              size: url.length,
            })),
    });
    setEditingId(entry.id);
    setFormError(null);
    setOpenId(null);
    setView("write");
  };

  const startNew = () => {
    setEditingId(null);
    setDraftSeed(EMPTY_DRAFT);
    setFormError(null);
    setView("write");
  };

  /* Escape closes whatever is on top, innermost first. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmDeleteId) setConfirmDeleteId(null);
      else if (openId) setOpenId(null);
      else if (activePinId) setActivePinId(null);
      else if (placingId) setPlacingId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDeleteId, openId, activePinId, placingId]);

  /* -------------------------------- derived -------------------------------- */

  /* One pass over the rows produces every per-card visual constant. Doing it in
     render would re-roll nothing (the seeds are stable) but would re-allocate a
     style object per card on every keystroke in the search box. */
  const decorated = useMemo(
    () =>
      entries.map((entry) => {
        const seed = hashString(entry.id);
        return {
          entry,
          seed,
          tilt: (seeded(seed, 3) - 0.5) * 3.6,
          fastener: seeded(seed, 4) > 0.46 ? ("pin" as const) : ("tape" as const),
          pinTilt: (seeded(seed, 5) - 0.5) * 44,
          tapeShift: 18 + seeded(seed, 8) * 44,
          style: ((entry.card_style as ClippingStyle) ??
            seededPick(seed, 6, ALL_STYLES)) as ClippingStyle,
          torn: tornClipPath(seed),
        };
      }),
    [entries]
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return decorated.filter(({ entry }) => {
      if (author === "me" && entry.author_id !== userId) return false;
      if (author === "them" && entry.author_id === userId) return false;
      if (moodFilter && entry.mood !== moodFilter) return false;
      if (!needle) return true;
      return (
        entry.title.toLowerCase().includes(needle) ||
        entry.content.toLowerCase().includes(needle) ||
        (entry.location ?? "").toLowerCase().includes(needle)
      );
    });
  }, [decorated, query, author, moodFilter, userId]);

  const pinned = useMemo(
    () =>
      entries
        .filter((e) => e.pin_x !== null && e.pin_y !== null)
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [entries]
  );

  const unpinned = useMemo(() => entries.filter((e) => e.pin_x === null), [entries]);

  const routePoints = useMemo(
    () => pinned.map((e) => (e.pin_x as number) * 100 + "," + (e.pin_y as number) * 100).join(" "),
    [pinned]
  );

  const openEntry = openId ? entries.find((e) => e.id === openId) ?? null : null;
  const activePin = activePinId ? entries.find((e) => e.id === activePinId) ?? null : null;
  const nameOf = (authorId: string) => (authorId === userId ? myName : partnerName);
  const filtersOn = query.trim() !== "" || author !== "all" || moodFilter !== null;

  const moods = useMemo(() => tags.filter((t) => t.kind === "mood"), [tags]);
  const conditions = useMemo(() => tags.filter((t) => t.kind === "condition"), [tags]);
  const moodOf = useCallback((slug: string | null) => findTag(tags, "mood", slug), [tags]);
  const conditionOf = useCallback(
    (slug: string | null) => findTag(tags, "condition", slug),
    [tags]
  );

  const isRevealed = (id: string) => revealAll || revealed[id] === true;

  /* -------------------------------- clippings -------------------------------- */

  const renderClipping = (item: (typeof decorated)[number]) => {
    const { entry, seed, tilt, fastener, pinTilt, tapeShift, style, torn } = item;
    const mood = moodOf(entry.mood);
    const photo = coverPhotoOf(entry);
    const attachCount = (entry.attachments ?? []).length;

    /* A board full of legible logs spoils every one of them from across the
       room. Clippings are censored by default - the headline, the date and the
       mood still read, but the prose is under ink bars and any photo is behind
       frosted evidence tape until someone actually asks for it. */
    const open = isRevealed(entry.id);

    const prose = (cls: string) =>
      open ? (
        <p className={cls}>{entry.content}</p>
      ) : (
        <p className={cls + " dy-redacted"} title="Redacted. Reveal or open the log to read it.">
          <span className="sr-only">This log is redacted. Open it to read it.</span>
          <RedactionBars seed={seed} length={entry.content.length} />
        </p>
      );

    const plate = (node: React.ReactNode) =>
      open ? (
        node
      ) : (
        <span className="dy-classified">
          {node}
          <span className="dy-classified-stamp" aria-hidden>
            CLASSIFIED
          </span>
        </span>
      );

    const captions = (
      <div className="dy-captions">
        <span className="dy-caption">{captionDate(entry.created_at)}</span>
        {mood && (
          <span className="dy-caption dy-caption-mood">
            {mood.mark && <span aria-hidden>{mood.mark}</span>}
            {mood.label}
          </span>
        )}
      </div>
    );

    const footer = (
      <div className="dy-clip-foot">
        <span className="dy-stamp" title={nameOf(entry.author_id)}>
          {nameOf(entry.author_id).charAt(0).toUpperCase()}
        </span>
        <span className="dy-clip-time">{clockTime(entry.created_at)}</span>
        {entry.pin_x !== null && (
          <span className="dy-clip-geo">
            <MapPinIcon className="w-3 h-3" aria-hidden />
            {entry.location || "Plotted"}
          </span>
        )}
        {attachCount > 0 && (
          <span className="dy-clip-geo" title={attachCount + " attached"}>
            <Paperclip className="w-3 h-3" aria-hidden />
            {attachCount}
          </span>
        )}
        <span className="dy-clip-tools">
          <button
            type="button"
            className="dy-tool dy-tool-peek"
            data-on={open}
            onClick={(e) => {
              e.stopPropagation();
              setRevealed((r) => ({ ...r, [entry.id]: !isRevealed(entry.id) }));
              /* Un-redacting one card while "reveal all" is on has to turn the
                 blanket switch off, or the toggle silently does nothing. */
              if (revealAll) {
                setRevealAll(false);
                setRevealed((r) => {
                  const next: Record<string, boolean> = {};
                  entries.forEach((row) => {
                    next[row.id] = row.id === entry.id ? false : true;
                  });
                  return { ...r, ...next };
                });
              }
            }}
            aria-label={open ? "Redact " + entry.title : "Reveal " + entry.title}
            aria-pressed={open}
          >
            {open ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            className="dy-tool"
            onClick={(e) => {
              e.stopPropagation();
              startEdit(entry);
            }}
            aria-label={"Edit " + entry.title}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="dy-tool"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDeleteId(entry.id);
            }}
            aria-label={"Delete " + entry.title}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>
    );

    let body: React.ReactNode = null;

    if (style === "newspaper") {
      body = (
        <div className="dy-news" style={{ clipPath: torn }}>
          <div className="dy-news-kicker">FIELD REPORT</div>
          <h3 className="dy-news-head">{entry.title}</h3>
          <div className="dy-news-rule" />
          {plate(
            photo ? (
              <img src={photo} alt="" className="dy-news-photo" loading="lazy" decoding="async" />
            ) : (
              <ComicPanel seed={seed} label={entry.location || "On patrol"} />
            )
          )}
          {prose("dy-news-body")}
        </div>
      );
    } else if (style === "bugle") {
      body = (
        <div className="dy-bugle" style={{ clipPath: torn }}>
          <BugleMasthead edition={editionLine(entry.created_at)} />
          <h3 className="dy-bugle-head">{entry.title}</h3>
          {prose("dy-bugle-body")}
        </div>
      );
    } else if (style === "sticky") {
      body = (
        <div className="dy-sticky" data-hue={Math.floor(seeded(seed, 9) * 3)}>
          <h3 className="dy-sticky-head">{entry.title}</h3>
          {prose("dy-sticky-body")}
        </div>
      );
    } else {
      body = (
        <div className="dy-polaroid">
          <div className="dy-polaroid-window">
            {plate(
              photo ? (
                <img
                  src={photo}
                  alt=""
                  className="dy-polaroid-photo"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <ComicPanel seed={seed} label={entry.location || "Undeveloped"} />
              )
            )}
          </div>
          <h3 className="dy-polaroid-head">{entry.title}</h3>
          {prose("dy-polaroid-body")}
        </div>
      );
    }

    return (
      <article
        key={entry.id}
        className="dy-clip"
        data-style={style}
        data-open={open}
        style={{ "--tilt": tilt.toFixed(2) + "deg" } as React.CSSProperties}
      >
        {fastener === "pin" ? (
          <span className="dy-fasten-pin" aria-hidden>
            <PushPin size={26} tilt={pinTilt} />
          </span>
        ) : (
          <span
            className="dy-fasten-tape"
            aria-hidden
            style={
              {
                left: tapeShift + "%",
                "--tape-rot": (pinTilt / 6).toFixed(1) + "deg",
              } as React.CSSProperties
            }
          />
        )}

        <button type="button" className="dy-clip-open" onClick={() => setOpenId(entry.id)}>
          <span className="sr-only">Open the log titled {entry.title}</span>
        </button>

        {captions}
        {body}
        {footer}
      </article>
    );
  };

  /* ================================ render ================================ */

  return (
    <main className="dy-root">
      {/* Backdrop: cardboard, grid paper, halftone and vignette, stacked as
          background layers on ONE fixed element rather than four. Each extra
          full-viewport layer is another surface the compositor has to blend on
          every paint, and none of them ever move independently. */}
      <div className="dy-bg" aria-hidden />

      <div className="dy-shell">
        <header className="dy-header">
          <button onClick={onBack} className="dy-back">
            <ArrowLeft className="w-4 h-4" aria-hidden />
            BACK TO CONTENTS
          </button>

          <div className="dy-title-block">
            <span className="dy-chapter-stamp">CH. 06</span>
            <h1 className="dy-title">Spider Diary</h1>
            <p className="dy-subtitle">
              Everything the two of us wrote down, torn out and pinned up.
            </p>
          </div>

          <div className="dy-counter" aria-live="polite">
            <span className="dy-counter-num">{entries.length}</span>
            <span className="dy-counter-label">
              {entries.length === 1 ? "log filed" : "logs filed"}
            </span>
          </div>
        </header>

        <section className="dy-stage">
          {/* ------------------------------ WRITE ------------------------------ */}
          {view === "write" && (
            <Composer
              key={editingId ?? "new"}
              initial={draftSeed}
              editing={editingId !== null}
              saving={saving}
              errorText={formError}
              /* Scoped to the person AND the thing being written, so a
                 half-written new log and a half-finished edit of an old one
                 never overwrite each other, and two accounts sharing a browser
                 never see each other's drafts. */
              draftScope={userId + ":diary:" + (editingId ?? "new")}
              moods={moods}
              conditions={conditions}
              onAddTag={addTag}
              onDeleteTag={deleteTag}
              tagError={tagError}
              onSubmit={runSave}
              onCancelEdit={() => {
                setEditingId(null);
                setDraftSeed(EMPTY_DRAFT);
                setView("logs");
              }}
            />
          )}

          {/* ------------------------------- LOGS ------------------------------- */}
          {view === "logs" && (
            <div className="dy-logs">
              <div className="dy-toolbar">
                <div className="dy-search">
                  <label htmlFor="dy-search" className="sr-only">
                    Search the logs
                  </label>
                  <Search className="dy-search-icon w-4 h-4" aria-hidden />
                  <input
                    id="dy-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="dy-search-input"
                    placeholder="Search headlines, words, places"
                    type="search"
                    autoComplete="off"
                  />
                </div>

                <div className="dy-seg" role="group" aria-label="Filter by who wrote it">
                  {(
                    [
                      ["all", "Both of us"],
                      ["me", myName],
                      ["them", partnerName],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className="dy-seg-btn"
                      data-on={author === value}
                      onClick={() => setAuthor(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="dy-mood-rail">
                  {moods.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="dy-chip"
                      data-on={moodFilter === m.slug}
                      onClick={() => setMoodFilter(moodFilter === m.slug ? null : m.slug)}
                    >
                      {m.mark && <span aria-hidden>{m.mark}</span>}
                      {m.label}
                    </button>
                  ))}

                  {/* The board is redacted by default so glancing at it never
                      spoils a log. This lifts every bar at once. */}
                  <button
                    type="button"
                    className="dy-chip dy-chip-reveal"
                    data-on={revealAll}
                    onClick={() => {
                      setRevealAll((v) => !v);
                      if (revealAll) setRevealed({});
                    }}
                    aria-pressed={revealAll}
                  >
                    {revealAll ? (
                      <EyeOff className="w-3 h-3" aria-hidden />
                    ) : (
                      <Eye className="w-3 h-3" aria-hidden />
                    )}
                    {revealAll ? "Redact all" : "Reveal all"}
                  </button>
                </div>
              </div>

              {loadError && (
                <p className="dy-form-error dy-form-error-wide">
                  The board could not be loaded. {loadError}
                </p>
              )}

              {loading && (
                <div className="dy-board" aria-hidden>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="dy-skeleton" style={{ animationDelay: i * 0.11 + "s" }}>
                      <span className="dy-skeleton-pin" />
                      <span className="dy-skeleton-cap" />
                      <span className="dy-skeleton-head" />
                      <span className="dy-skeleton-line" />
                      <span className="dy-skeleton-line dy-skeleton-short" />
                      <span className="dy-skeleton-line" />
                    </div>
                  ))}
                </div>
              )}

              {!loading && visible.length === 0 && (
                <div className="dy-empty">
                  <span className="dy-empty-pin" aria-hidden>
                    <PushPin size={30} tilt={-12} />
                  </span>
                  {filtersOn ? (
                    <>
                      <h2 className="dy-empty-head">Nothing on the board matches that</h2>
                      <p className="dy-empty-body">
                        Try a different word, or put the filters back to both of us.
                      </p>
                      <button
                        type="button"
                        className="dy-file-btn dy-file-btn-inline"
                        onClick={() => {
                          setQuery("");
                          setAuthor("all");
                          setMoodFilter(null);
                        }}
                      >
                        CLEAR FILTERS
                      </button>
                    </>
                  ) : (
                    <>
                      <h2 className="dy-empty-head">The board is bare</h2>
                      <p className="dy-empty-body">
                        Roll a sheet into the machine and write the first one. Even a bad day is
                        worth a clipping.
                      </p>
                      <button type="button" className="dy-file-btn dy-file-btn-inline" onClick={startNew}>
                        WRITE THE FIRST LOG
                      </button>
                    </>
                  )}
                </div>
              )}

              {!loading && visible.length > 0 && (
                <div className="dy-board">{visible.map(renderClipping)}</div>
              )}
            </div>
          )}

          {/* -------------------------------- MAP -------------------------------- */}
          {view === "map" && (
            <div className="dy-map-view">
              <div className="dy-mapboard">
                <span className="dy-tape-corner dy-tape-tl" aria-hidden />
                <span className="dy-tape-corner dy-tape-tr" aria-hidden />
                <span className="dy-tape-corner dy-tape-bl" aria-hidden />
                <span className="dy-tape-corner dy-tape-br" aria-hidden />

                {placingId && (
                  <p className="dy-place-banner">
                    Click the map to pin
                    <strong> {entries.find((e) => e.id === placingId)?.title ?? "this log"}</strong>
                    <button type="button" className="dy-mini-btn" onClick={() => setPlacingId(null)}>
                      Cancel
                    </button>
                  </p>
                )}

                <div
                  className="dy-mapframe"
                  data-placing={placingId !== null}
                  onClick={(event) => {
                    if (!placingId) return;
                    const box = event.currentTarget.getBoundingClientRect();
                    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
                    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
                    const target = entries.find((e) => e.id === placingId);
                    runMovePin(placingId, x, y, (target?.pin_style as PinStyle) ?? "spider");
                    setPlacingId(null);
                  }}
                >
                  <PatrolMap className="dy-mapart" />

                  {/* the patrol route: the pinned logs in the order they happened */}
                  {pinned.length > 1 && (
                    <svg
                      className="dy-route"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      aria-hidden
                    >
                      <polyline
                        points={routePoints}
                        fill="none"
                        stroke="#9E1B2B"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        opacity="0.55"
                      />
                      <polyline
                        points={routePoints}
                        fill="none"
                        stroke="#FF8A94"
                        strokeWidth="0.8"
                        strokeDasharray="3 5"
                        vectorEffect="non-scaling-stroke"
                        opacity="0.45"
                      />
                    </svg>
                  )}

                  {pinned.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="dy-mappin"
                      data-on={activePinId === entry.id}
                      style={{
                        left: (entry.pin_x as number) * 100 + "%",
                        top: (entry.pin_y as number) * 100 + "%",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActivePinId(activePinId === entry.id ? null : entry.id);
                      }}
                      aria-label={entry.title + ", " + captionDate(entry.created_at)}
                    >
                      <MapPin style={(entry.pin_style as PinStyle) ?? "spider"} size={34} />
                    </button>
                  ))}

                  {activePin && activePin.pin_x !== null && activePin.pin_y !== null && (
                    <div
                      className="dy-pin-card"
                      style={{
                        left: activePin.pin_x * 100 + "%",
                        top: activePin.pin_y * 100 + "%",
                      }}
                      data-flip-x={activePin.pin_x > 0.62}
                      data-flip-y={activePin.pin_y > 0.62}
                    >
                      <span className="dy-caption">{captionDate(activePin.created_at)}</span>
                      <h3 className="dy-pin-card-head">{activePin.title}</h3>
                      {activePin.location && <p className="dy-pin-card-where">{activePin.location}</p>}
                      <p className="dy-pin-card-body">{activePin.content}</p>
                      <div className="dy-pin-card-actions">
                        <button type="button" className="dy-mini-btn" onClick={() => setOpenId(activePin.id)}>
                          Open log
                        </button>
                        <button
                          type="button"
                          className="dy-mini-btn"
                          onClick={() => {
                            setPlacingId(activePin.id);
                            setActivePinId(null);
                          }}
                        >
                          Move pin
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <aside className="dy-mapside">
                <h2 className="dy-side-head">The route</h2>
                <p className="dy-side-note">
                  {pinned.length === 0
                    ? "No logs plotted yet. Pin one and the string starts to run."
                    : pinned.length +
                      (pinned.length === 1 ? " stop on the board." : " stops, strung in order.")}
                </p>

                <h3 className="dy-side-sub">Markers</h3>
                <ul className="dy-legend">
                  {PIN_STYLES.map((p) => (
                    <li key={p.id}>
                      <MapPin style={p.id} size={22} />
                      {p.label}
                    </li>
                  ))}
                </ul>

                <h3 className="dy-side-sub">Not plotted yet</h3>
                {unpinned.length === 0 ? (
                  <p className="dy-side-note">Every log has a place on the map.</p>
                ) : (
                  <ul className="dy-unplotted">
                    {unpinned.slice(0, 12).map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className="dy-unplotted-btn"
                          data-on={placingId === entry.id}
                          onClick={() => setPlacingId(placingId === entry.id ? null : entry.id)}
                        >
                          <span className="dy-unplotted-date">{captionDate(entry.created_at)}</span>
                          <span className="dy-unplotted-title">{entry.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            </div>
          )}
        </section>
      </div>

      {/* ------------------------------- CONSOLE ------------------------------- */}
      <nav className="dy-console" aria-label="Chapter views">
        <button
          type="button"
          className="dy-console-btn"
          data-on={view === "write"}
          onClick={startNew}
        >
          <span className="dy-console-badge">
            <Keyboard className="w-5 h-5" aria-hidden />
          </span>
          New Entry
        </button>

        <button
          type="button"
          className="dy-console-btn dy-console-btn-hero"
          data-on={view === "logs"}
          onClick={() => setView("logs")}
        >
          <span className="dy-console-badge dy-console-badge-hero">
            <MapPin style="mask" size={34} />
          </span>
          Logs
        </button>

        <button
          type="button"
          className="dy-console-btn"
          data-on={view === "map"}
          onClick={() => setView("map")}
        >
          <span className="dy-console-badge">
            <Building2 className="w-5 h-5" aria-hidden />
          </span>
          Map
        </button>
      </nav>

      {/* ------------------------------ CASE FILE ------------------------------ */}
      {openEntry && (
        <div
          className="dy-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={openEntry.title}
          /* Clicking any empty space around the folder closes it. The scrim
             below catches most of that, but the overlay is also the scrolling
             box - on a long log its padding column sits outside the scrim's
             stacking position, and those clicks used to land on nothing. */
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpenId(null);
          }}
        >
          <button type="button" className="dy-overlay-scrim" onClick={() => setOpenId(null)}>
            <span className="sr-only">Close the log</span>
          </button>

          <div className="dy-folder">
            <span className="dy-folder-tab">{captionDate(openEntry.created_at)}</span>

            <button type="button" className="dy-folder-close" onClick={() => setOpenId(null)} autoFocus>
              <X className="w-4 h-4" aria-hidden />
              <span className="sr-only">Close</span>
            </button>

            <div className="dy-folder-paper">
              <div className="dy-sheet-head">
                <span>FIELD LOG</span>
                <span>{longDate(openEntry.created_at)}</span>
              </div>

              <h2 className="dy-folder-head">{openEntry.title}</h2>

              <div className="dy-folder-stamps">
                <span className="dy-stamp dy-stamp-wide">{nameOf(openEntry.author_id)}</span>
                {moodOf(openEntry.mood) && (
                  <span className="dy-caption dy-caption-mood">
                    {moodOf(openEntry.mood)?.mark && (
                      <span aria-hidden>{moodOf(openEntry.mood)?.mark}</span>
                    )}
                    {moodOf(openEntry.mood)?.label}
                  </span>
                )}
                {conditionOf(openEntry.weather) && (
                  <span className="dy-ink-stamp">{conditionOf(openEntry.weather)?.label}</span>
                )}
                {openEntry.location && (
                  <span className="dy-ink-stamp">
                    <MapPinIcon className="w-3 h-3" aria-hidden />
                    {openEntry.location}
                  </span>
                )}
              </div>

              <p className="dy-folder-body">{openEntry.content}</p>

              {(() => {
                /* Legacy rows kept their single photo in media_urls; show it
                   here as evidence so nothing written before attachments
                   existed silently disappears from the file. */
                const attached: DiaryAttachment[] =
                  openEntry.attachments && openEntry.attachments.length > 0
                    ? openEntry.attachments
                    : (openEntry.media_urls ?? []).map((url, i) => ({
                        id: "legacy_" + openEntry.id + "_" + i,
                        kind: "image" as const,
                        url,
                        title: "Photo " + (i + 1),
                      }));

                if (attached.length === 0) return null;

                return (
                  <section className="dy-exhibits">
                    <h3 className="dy-exhibits-head">Evidence attached</h3>
                    <ul className="dy-exhibit-list">
                      {attached.map((a) => (
                        <li key={a.id} className="dy-exhibit" data-kind={a.kind}>
                          {a.kind === "image" && (
                            <img
                              src={a.url}
                              alt={a.title}
                              className="dy-exhibit-img"
                              loading="lazy"
                              decoding="async"
                            />
                          )}

                          {a.kind === "video" && (
                            /* playableMediaSrc rewrites the MIME label of an
                               iPhone clip on the way out - see mediaPrep. */
                            <video
                              src={playableMediaSrc(a.url)}
                              className="dy-exhibit-video"
                              controls
                              preload="metadata"
                              playsInline
                            />
                          )}

                          {a.kind === "audio" && (
                            <audio src={a.url} className="dy-exhibit-audio" controls preload="none" />
                          )}

                          {a.kind === "link" ? (
                            <a
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="dy-exhibit-link"
                            >
                              <LinkIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                              <span className="dy-exhibit-name">{a.title}</span>
                              <span className="dy-exhibit-host">{linkHost(a.url)}</span>
                            </a>
                          ) : (
                            <span className="dy-exhibit-cap">{a.title}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })()}

              {openEntry.pin_x !== null && openEntry.pin_y !== null && (
                <div className="dy-folder-map">
                  <PatrolMap className="dy-folder-map-art" />
                  <span
                    className="dy-minimap-pin"
                    style={{
                      left: openEntry.pin_x * 100 + "%",
                      top: openEntry.pin_y * 100 + "%",
                    }}
                  >
                    <MapPin style={(openEntry.pin_style as PinStyle) ?? "spider"} size={26} />
                  </span>
                </div>
              )}

              <div className="dy-folder-actions">
                <button type="button" className="dy-file-btn" onClick={() => startEdit(openEntry)}>
                  <Pencil className="w-3.5 h-3.5" aria-hidden />
                  EDIT LOG
                </button>
                <button
                  type="button"
                  className="dy-ghost-btn"
                  onClick={() => setConfirmDeleteId(openEntry.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------- DELETE CONFIRMATION ------------------------- */}
      {confirmDeleteId && (
        <div
          className="dy-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Delete this log"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmDeleteId(null);
          }}
        >
          <button type="button" className="dy-overlay-scrim" onClick={() => setConfirmDeleteId(null)}>
            <span className="sr-only">Keep the log</span>
          </button>
          <div className="dy-confirm">
            <h2 className="dy-confirm-head">Tear this one off the board?</h2>
            <p className="dy-confirm-body">
              {entries.find((e) => e.id === confirmDeleteId)?.title}
            </p>
            <p className="dy-confirm-note">This cannot be undone, for either of you.</p>
            <div className="dy-confirm-actions">
              <button
                type="button"
                className="dy-file-btn"
                disabled={deleting}
                onClick={() => runDelete(confirmDeleteId)}
              >
                {deleting ? "TEARING..." : "YES, TEAR IT OFF"}
              </button>
              <button type="button" className="dy-ghost-btn" onClick={() => setConfirmDeleteId(null)}>
                <Check className="w-3.5 h-3.5" aria-hidden />
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="dy-grain" aria-hidden />

      <style>{DIARY_CSS}</style>
    </main>
  );
}

/* ==========================================================================
   SCOPED STYLES

   Chapter-local, per the house rule: a chapter's CSS lives with the chapter so
   it can be dropped in or out without touching globals.css. Held in a plain
   string constant rather than inline in the JSX so a stray backtick in a
   comment cannot silently terminate the template literal.

   Motion budget: transform, opacity and clip-path only. No animated filters, no
   animated layout properties. Everything collapses under reduced motion via the
   app-wide rule in globals.css, and the two ambient loops here are additionally
   gated below.
   ========================================================================== */

const DIARY_CSS = `
.dy-root {
  --dy-ink: #1C1317;
  --dy-crimson: #7D1220;
  --dy-crimson-lift: #A0182B;
  --dy-board: #1A1013;
  --dy-paper: #F7F1E6;
  --dy-news: #E9E1CE;
  --dy-kraft: #C9A87C;
  --dy-caption: #F2C14E;
  --dy-sticker: #FDF8F0;
  --dy-mint: #8FAEAA;
  --dy-type: 'Courier New', Courier, 'Nimbus Mono PS', monospace;

  position: relative;
  min-height: 100vh;
  min-height: 100svh;
  color: var(--dy-ink);
  overflow-x: hidden;
  padding-bottom: 134px;
}

/* ---------------------------------------------------------------- backdrop */

.dy-bg,
.dy-grain {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

/* First listed paints on top. The old per-element opacities are baked into the
   colours here: the grid was 0.4 alpha at 0.16 element opacity, the halftone
   0.14 at 0.5. */
.dy-bg {
  z-index: 0;
  background:
    radial-gradient(ellipse at 50% 8%, rgba(125, 18, 32, 0.30) 0%, transparent 62%),
    radial-gradient(ellipse at 50% 100%, rgba(6, 3, 4, 0.85) 0%, transparent 60%),
    radial-gradient(rgba(212, 123, 145, 0.07) 1.6px, transparent 1.7px) 0 0 / 15px 15px,
    repeating-linear-gradient(0deg, rgba(236, 168, 184, 0.064) 0 1px, transparent 1px 30px),
    repeating-linear-gradient(90deg, rgba(236, 168, 184, 0.064) 0 1px, transparent 1px 30px),
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.16) 0 2px, transparent 2px 13px),
    linear-gradient(168deg, #241519 0%, #1A1013 46%, #120A0D 100%);
}

/* Grain sits on a fixed, inert layer only, never on a scrolling container.
   Deliberately NOT mix-blend-mode: a blended full-viewport layer has to
   re-composite against everything underneath it on every paint, which is a
   permanent tax on a screen that scrolls. A flat low-opacity wash reads the
   same over this palette and composites once. */
.dy-grain {
  z-index: 40;
  opacity: 0.16;
  background-image: radial-gradient(rgba(255, 255, 255, 0.42) 0.5px, transparent 0.6px);
  background-size: 3px 3px;
}

.dy-shell {
  position: relative;
  z-index: 10;
  max-width: 1360px;
  margin: 0 auto;
  padding: 22px 16px 0;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ----------------------------------------------------------------- header */

.dy-header {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  margin-bottom: 26px;
}

@media (min-width: 900px) {
  .dy-header {
    grid-template-columns: auto 1fr auto;
    align-items: end;
    column-gap: 26px;
  }
}

.dy-back {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  background: var(--dy-paper);
  color: var(--dy-ink);
  border: 2px solid var(--dy-ink);
  box-shadow: 3px 3px 0 #0B0709;
  font-family: var(--dy-type);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  transform: rotate(-1.4deg);
  transition: transform 140ms ease, background-color 140ms ease;
  cursor: pointer;
}

.dy-back:hover { background: #FFFDF8; transform: rotate(-1.4deg) translateY(-2px); }
.dy-back:active { transform: rotate(-1.4deg) translateY(1px) scale(0.985); }

.dy-title-block { position: relative; }

.dy-chapter-stamp {
  display: inline-block;
  padding: 3px 9px;
  background: var(--dy-crimson);
  color: var(--dy-sticker);
  border: 2px solid var(--dy-ink);
  font-family: var(--dy-type);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.24em;
  transform: rotate(-2deg);
}

.dy-title {
  margin: 8px 0 2px;
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(2.4rem, 6vw, 4rem);
  line-height: 0.92;
  color: var(--dy-sticker);
  text-shadow: 4px 4px 0 rgba(125, 18, 32, 0.85);
}

.dy-subtitle {
  font-family: 'Caveat', cursive;
  font-size: 1.35rem;
  color: #E7B6C1;
}

.dy-counter {
  justify-self: start;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 14px;
  background: var(--dy-caption);
  border: 3px solid var(--dy-ink);
  box-shadow: 4px 4px 0 #0B0709;
  transform: rotate(1.6deg);
}

@media (min-width: 900px) { .dy-counter { justify-self: end; } }

.dy-counter-num {
  font-family: 'Permanent Marker', cursive;
  font-size: 1.7rem;
  line-height: 1;
}

.dy-counter-label {
  font-family: var(--dy-type);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

/* ------------------------------------------------------------ write view */

.dy-write {
  display: grid;
  grid-template-columns: 1fr;
  gap: 26px;
  align-items: start;
}

@media (min-width: 1080px) {
  /* Pin the desk in place: the write view gets a viewport-tied height (170px
     covers .dy-shell's top padding plus the .dy-header block above it) and
     clips at that box, so only .dy-ticket's own overflow scrolls, never the
     typewriter itself. */
  .dy-write {
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 34px;
    height: calc(100svh - 170px);
    overflow: hidden;
  }
}

.dy-desk { position: relative; padding-bottom: 8px; }

@media (min-width: 1080px) {
  /* .dy-write clips .dy-desk to a fixed viewport-tied height (see above), on
     the assumption the desk's own content never needs more room than that.
     It sometimes did: the sheet's headline + label rows + textarea could run
     tall enough that the machine art below it - drawn AFTER the sheet in
     normal flow - got its bottom edge clipped off by that overflow:hidden,
     which is exactly the typewriter's keyboard (always the lowest part of
     the illustration). Making the desk a flex column with the machine
     flex: 0 0 auto guarantees the machine always renders at its full
     natural height; the sheet becomes the one that scrolls internally
     (.dy-body-input already caps its own height above, so this is a rare
     backstop, not the everyday case) instead of pushing the machine out of
     the clipped box. */
  .dy-desk {
    display: flex;
    flex-direction: column;
    /* Same calc .dy-write and .dy-ticket already use, rather than height:100%
       - a grid item stretches to its row by default, but pinning the exact
       value directly here doesn't depend on that default staying true. */
    height: calc(100svh - 170px);
    min-height: 0;
  }
  .dy-sheet {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .dy-machine {
    flex: 0 0 auto;
  }
}

/* The sheet, rolling upward out of the platen. Its lower edge is deliberately
   tucked under the machine, which is drawn on top of it. */
.dy-sheet {
  position: relative;
  z-index: 1;
  background:
    linear-gradient(102deg, rgba(0, 0, 0, 0.05) 0%, transparent 22%, transparent 78%, rgba(0, 0, 0, 0.05) 100%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.85) 0%, transparent 26%),
    radial-gradient(rgba(140, 120, 96, 0.09) 0.6px, transparent 0.7px) 0 0 / 4px 4px,
    #FCF8F1;
  border: 1px solid #C9BEAA;
  border-bottom: none;
  box-shadow:
    0 -2px 0 rgba(255, 255, 255, 0.7) inset,
    0 26px 44px rgba(0, 0, 0, 0.5);
  padding: 22px clamp(18px, 4vw, 44px) 58px;
  margin: 0 auto -56px;
  max-width: 508px;
}

/* Soft fold sheens, not printed lines. A hard band here reads as a cross
   drawn over the words rather than a crease in the paper. */
.dy-sheet::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg, transparent 30%, rgba(120, 104, 84, 0.10) 38%, rgba(255, 255, 255, 0.55) 40%, transparent 48%),
    linear-gradient(90deg, transparent 46%, rgba(120, 104, 84, 0.07) 50%, rgba(255, 255, 255, 0.45) 51%, transparent 55%);
}

.dy-sheet-perf {
  position: absolute;
  left: 5%;
  right: 5%;
  top: 14px;
  height: 0;
  border-top: 2px dashed #B9AC96;
}

.dy-sheet-head,
.dy-sheet-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  font-family: var(--dy-type);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8A7A62;
}

.dy-sheet-head { margin-bottom: 14px; }
.dy-sheet-foot { margin-top: 12px; }

.dy-bell {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 2px solid #B9AC96;
  border-radius: 50%;
  color: #8A7A62;
}

.dy-field-label {
  display: block;
  margin-bottom: 5px;
  font-family: var(--dy-type);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--dy-crimson);
}

.dy-headline-input,
.dy-body-input,
.dy-text-input,
.dy-search-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: var(--dy-ink);
  font-family: var(--dy-type);
}

.dy-headline-input {
  font-size: clamp(1.35rem, 3.4vw, 1.95rem);
  font-weight: 700;
  letter-spacing: -0.01em;
  text-transform: uppercase;
  border-bottom: 2px solid #CBBFA8;
  padding: 4px 0 8px;
  margin-bottom: 14px;
}

.dy-headline-input::placeholder,
.dy-body-input::placeholder,
.dy-text-input::placeholder,
.dy-search-input::placeholder {
  color: #A2947D;
  opacity: 1;
}

.dy-headline-input:focus-visible,
.dy-body-input:focus-visible,
.dy-text-input:focus-visible,
.dy-search-input:focus-visible {
  outline: 2px solid var(--dy-crimson);
  outline-offset: 3px;
}

.dy-body-input {
  font-size: 1rem;
  line-height: 1.68;
  resize: vertical;
  min-height: 126px;
  border: 2px dashed #CBBFA8;
  padding: 12px 14px;
}

@media (min-width: 1080px) {
  /* A long entry (or a manual vertical resize-drag) should scroll within the
     writing surface itself, not grow .dy-desk past the pinned .dy-write
     height above and push the typewriter art out of its clipped box. */
  .dy-body-input {
    max-height: 320px;
    overflow-y: auto;
  }
}

.dy-inline-error {
  margin: 6px 0 14px;
  font-family: var(--dy-type);
  font-size: 11px;
  font-weight: 700;
  color: #96131F;
}

/* The machine. .dy-machine-art is the drawing; the two strike classes are what
   the keystroke handler swaps between. */
.dy-machine {
  position: relative;
  z-index: 2;
  max-width: 470px;
  margin: 0 auto;
  filter: drop-shadow(0 22px 26px rgba(0, 0, 0, 0.55));
}

.dy-machine-art { display: block; width: 100%; height: auto; }

.dy-machine .dy-tw-roller {
  transform-box: fill-box;
  transform-origin: center;
  rotate: var(--dy-roll, 0deg);
}

.dy-machine .dy-tw-bars {
  transform-box: fill-box;
  transform-origin: bottom center;
}

@keyframes dy-typebar-kick {
  0%   { transform: translateY(0) scaleY(1); }
  38%  { transform: translateY(-5px) scaleY(1.08); }
  100% { transform: translateY(0) scaleY(1); }
}

.dy-strike-a .dy-tw-bars,
.dy-strike-b .dy-tw-bars {
  animation: dy-typebar-kick 150ms ease-out;
}

/* ------------------------------------------------------------ job ticket */

.dy-ticket {
  position: relative;
  background:
    repeating-linear-gradient(96deg, rgba(120, 92, 58, 0.05) 0 6px, transparent 6px 14px),
    linear-gradient(172deg, #D8BB8E, #BE9A68 60%, #B0894F);
  background-color: var(--dy-kraft);
  border: 3px solid var(--dy-ink);
  box-shadow: 8px 9px 0 rgba(6, 3, 4, 0.75);
  padding: 30px 20px 22px;
  transform: rotate(0.7deg);
}

@media (min-width: 1080px) {
  /* The one pane allowed to scroll: bounded to the same height .dy-write is
     clipped to, so the desk/typewriter beside it never moves. */
  .dy-ticket {
    height: calc(100svh - 170px);
    overflow-y: auto;
  }
}

.dy-clip-bar {
  position: absolute;
  top: -13px;
  left: 50%;
  translate: -50% 0;
  width: 92px;
  height: 24px;
  background: linear-gradient(180deg, #C6CBCE, #7E868B);
  border: 3px solid #2A2126;
  border-radius: 4px;
}

.dy-clip-bar::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 5px;
  translate: -50% 0;
  width: 54px;
  height: 6px;
  background: #555C61;
  border-radius: 3px;
}

.dy-ticket-title {
  font-family: 'Permanent Marker', cursive;
  font-size: 1.5rem;
  color: #33210F;
  margin-bottom: 16px;
}

.dy-set { margin-bottom: 18px; border: none; padding: 0; }
.dy-set-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }

.dy-set-note {
  margin-top: 6px;
  font-family: 'Caveat', cursive;
  font-size: 1.05rem;
  color: #4B341A;
}

.dy-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.dy-chips-tight { margin-top: 8px; align-items: center; }

.dy-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  background: #F6EEDF;
  color: #33210F;
  border: 2px solid var(--dy-ink);
  font-family: var(--dy-type);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: transform 120ms ease, background-color 120ms ease, color 120ms ease;
}

.dy-chip:hover { background: #FFFBF2; transform: translateY(-1px); }
.dy-chip:active { transform: translateY(1px) scale(0.97); }
.dy-chip[data-on="true"] {
  background: var(--dy-crimson);
  color: var(--dy-sticker);
  box-shadow: 2px 2px 0 #0B0709;
}

/* ------------------------------------------- editable vocabulary chips --- */

/* The tear-off X rides on the chip's own corner rather than sitting beside it,
   so a rail of eight moods does not double in width just to be editable. */
.dy-chip-wrap { position: relative; display: inline-flex; }
.dy-chip-wrap .dy-chip { padding-right: 16px; }

.dy-chip-x {
  position: absolute;
  top: -6px;
  right: -6px;
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  background: var(--dy-ink);
  color: #F6EEDF;
  border: 2px solid #F6EEDF;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0;
  transform: scale(0.7);
  transition: opacity 120ms ease, transform 120ms ease, background-color 120ms ease;
}

.dy-chip-wrap:hover .dy-chip-x,
.dy-chip-wrap:focus-within .dy-chip-x,
.dy-evidence-item:hover .dy-chip-x,
.dy-evidence-item:focus-within .dy-chip-x { opacity: 1; transform: scale(1); }

/* Touch has no hover, so on a phone the tear-off would never appear at all. */
@media (hover: none) {
  .dy-chip-wrap .dy-chip-x,
  .dy-evidence-item .dy-chip-x { opacity: 1; transform: scale(1); }
}

.dy-chip-x:hover { background: var(--dy-crimson); }
.dy-chip-x:focus-visible { outline: 2px solid var(--dy-caption); outline-offset: 1px; }

.dy-chip-add {
  border-style: dashed;
  background: transparent;
  color: #F1E2C6;
}
.dy-chip-add:hover { background: rgba(246, 238, 223, 0.14); }

.dy-tag-new {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}
.dy-tag-new .dy-text-input { flex: 1 1 140px; min-width: 0; }
.dy-tag-mark { flex: 0 0 56px; text-align: center; }

.dy-chip-reveal { margin-left: auto; border-style: dashed; }

/* --------------------------------------------- restored-draft notice ---- */

.dy-restored {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 10px;
  margin-bottom: 12px;
  padding: 9px 11px;
  background: #F0DBA8;
  border: 2px solid var(--dy-ink);
  box-shadow: 3px 3px 0 #0B0709;
  color: #33210F;
  font-family: var(--dy-type);
  font-size: 10.5px;
  line-height: 1.5;
}
.dy-restored-mark { display: grid; place-items: center; color: var(--dy-crimson); }
.dy-restored-body strong { display: block; font-size: 11px; letter-spacing: 0.04em; }
.dy-restored-actions { grid-column: 2; display: flex; gap: 6px; }

/* ------------------------------------------------ the evidence tray ----- */

.dy-set-meter {
  font-family: var(--dy-type);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: #C9B190;
}

.dy-evidence { display: grid; gap: 6px; margin: 8px 0; padding: 0; list-style: none; }

.dy-evidence-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 7px;
  background: #F6EEDF;
  border: 2px solid var(--dy-ink);
  color: #33210F;
  font-family: var(--dy-type);
  font-size: 10px;
}
.dy-evidence-item[data-kind="link"] { background: #E7EEF3; }

.dy-evidence-mark { display: grid; place-items: center; color: var(--dy-crimson); }
.dy-evidence-thumb { width: 26px; height: 26px; object-fit: cover; border: 1.5px solid var(--dy-ink); }
.dy-evidence-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dy-evidence-size { flex: 0 0 auto; opacity: 0.7; font-size: 9px; }

.dy-attach-link { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.dy-attach-link .dy-text-input { flex: 1 1 100%; min-width: 0; }
.dy-attach-link .dy-attach-caption { flex: 1 1 120px; }
.dy-attach-file { margin-top: 6px; }

/* ------------------------------------------------------- redaction ------ */

/* A clipping keeps its full height when censored - the bars occupy the same
   run of lines the prose would - so revealing one does not make the whole
   masonry column jump and re-flow under the reader's cursor. */
.dy-redacted { display: block; }

.dy-redact-stack { display: block; padding: 2px 0; }

.dy-redact-bar {
  display: block;
  height: 0.72em;
  margin: 0 0 0.42em;
  background: #14100F;
  /* Slightly ragged ends, like a marker pen rather than a filled rectangle. */
  clip-path: polygon(0.6% 8%, 99.4% 0%, 100% 92%, 0% 100%);
  opacity: 0.88;
}

.dy-clip[data-open="false"] .dy-redact-bar { animation: dy-ink-in 240ms ease-out both; }
.dy-clip[data-open="false"] .dy-redact-bar:nth-child(2) { animation-delay: 30ms; }
.dy-clip[data-open="false"] .dy-redact-bar:nth-child(3) { animation-delay: 60ms; }
.dy-clip[data-open="false"] .dy-redact-bar:nth-child(4) { animation-delay: 90ms; }
.dy-clip[data-open="false"] .dy-redact-bar:nth-child(5) { animation-delay: 120ms; }

@keyframes dy-ink-in {
  0%   { transform: scaleX(0); transform-origin: left center; opacity: 0.5; }
  100% { transform: scaleX(1); transform-origin: left center; opacity: 0.88; }
}

/* Photos are spoilers too. Frosted rather than removed, so the card still
   reads as "there is a picture in here" without showing what it is. */
.dy-classified { position: relative; display: block; overflow: hidden; }
.dy-classified > img,
.dy-classified > svg { filter: blur(13px) saturate(0.45) contrast(1.1); transform: scale(1.12); }

.dy-classified-stamp {
  position: absolute;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  rotate: -8deg;
  padding: 3px 10px;
  border: 2.5px solid var(--dy-crimson);
  color: var(--dy-crimson);
  background: rgba(20, 16, 15, 0.42);
  font-family: var(--dy-type);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.22em;
  white-space: nowrap;
}

.dy-tool-peek[data-on="true"] { background: var(--dy-crimson); color: var(--dy-sticker); }

@media (prefers-reduced-motion: reduce) {
  .dy-clip[data-open="false"] .dy-redact-bar { animation: none; }
}

/* ------------------------------------------- exhibits in the case file --- */

.dy-exhibits { margin-top: 16px; }

.dy-exhibits-head {
  margin: 0 0 8px;
  font-family: var(--dy-type);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #5A3A1C;
  border-bottom: 2px solid rgba(51, 33, 15, 0.35);
  padding-bottom: 4px;
}

.dy-exhibit-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dy-exhibit {
  padding: 6px 6px 8px;
  background: #F6EEDF;
  border: 2px solid var(--dy-ink);
  box-shadow: 3px 3px 0 rgba(3, 2, 2, 0.55);
  rotate: -0.5deg;
}
.dy-exhibit:nth-child(even) { rotate: 0.7deg; }
.dy-exhibit[data-kind="link"] { grid-column: 1 / -1; rotate: 0deg; }

.dy-exhibit-img,
.dy-exhibit-video { display: block; width: 100%; height: auto; border: 1.5px solid var(--dy-ink); }
.dy-exhibit-audio { display: block; width: 100%; }

.dy-exhibit-cap {
  display: block;
  margin-top: 5px;
  font-family: 'Caveat', cursive;
  font-size: 13px;
  line-height: 1.25;
  color: #33210F;
  overflow-wrap: anywhere;
}

.dy-exhibit-link {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #22384A;
  font-family: var(--dy-type);
  font-size: 11px;
  text-decoration: none;
}
.dy-exhibit-link:hover { text-decoration: underline; }
.dy-exhibit-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.dy-exhibit-host { flex: 0 0 auto; opacity: 0.65; font-size: 9.5px; }

.dy-text-input {
  padding: 8px 10px;
  background: #F6EEDF;
  border: 2px solid var(--dy-ink);
  font-size: 0.9rem;
}

.dy-style-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }

.dy-style-pick {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px;
  background: #F6EEDF;
  border: 2px solid var(--dy-ink);
  cursor: pointer;
  text-align: left;
  transition: transform 120ms ease, background-color 120ms ease;
}

.dy-style-pick:hover { transform: translateY(-2px); }
.dy-style-pick:active { transform: translateY(1px) scale(0.985); }
.dy-style-pick[data-on="true"] { background: var(--dy-caption); box-shadow: 3px 3px 0 #0B0709; }

.dy-style-name {
  font-family: var(--dy-type);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #33210F;
}

/* Miniature previews of each clipping style, so the picker shows the thing
   itself instead of four identical words. */
.dy-style-mini {
  display: block;
  height: 34px;
  border: 1px solid #8A7358;
  background: #FBF6EA;
}

.dy-mini-newspaper {
  background:
    linear-gradient(#33210F 0 0) 4px 6px / 24px 3px no-repeat,
    repeating-linear-gradient(180deg, rgba(51, 33, 15, 0.5) 0 1px, transparent 1px 4px) 4px 14px / 18px 16px no-repeat,
    repeating-linear-gradient(180deg, rgba(51, 33, 15, 0.5) 0 1px, transparent 1px 4px) 26px 14px / 18px 16px no-repeat,
    #FBF6EA;
}

.dy-mini-bugle {
  background:
    linear-gradient(#1C1317 0 0) 0 0 / 100% 9px no-repeat,
    repeating-linear-gradient(180deg, rgba(51, 33, 15, 0.5) 0 1px, transparent 1px 4px) 5px 14px / 80% 16px no-repeat,
    #FBF6EA;
}

.dy-mini-sticky {
  background:
    linear-gradient(#D9C7A0 0 0) 30% -3px / 34% 8px no-repeat,
    #F3D778;
}

.dy-mini-polaroid {
  background:
    linear-gradient(150deg, #6E7F86, #35434B) 4px 4px / calc(100% - 8px) 20px no-repeat,
    #FDFBF7;
}

.dy-pin-pick {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  background: #F6EEDF;
  border: 2px solid var(--dy-ink);
  cursor: pointer;
  transition: transform 120ms ease;
}

.dy-pin-pick:hover { transform: translateY(-2px); }
.dy-pin-pick[data-on="true"] { background: var(--dy-caption); box-shadow: 2px 2px 0 #0B0709; }

.dy-minimap {
  position: relative;
  margin-top: 8px;
  aspect-ratio: 1000 / 680;
  border: 2px solid var(--dy-ink);
  cursor: crosshair;
  overflow: hidden;
}

.dy-minimap-art { display: block; width: 100%; height: 100%; }

.dy-minimap-pin {
  position: absolute;
  translate: -50% -86%;
  pointer-events: none;
}

.dy-mini-btn {
  padding: 4px 9px;
  background: #33210F;
  color: #F6EEDF;
  border: 2px solid var(--dy-ink);
  font-family: var(--dy-type);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 120ms ease, background-color 120ms ease;
}

.dy-mini-btn:hover { background: var(--dy-crimson); }
.dy-mini-btn:active { transform: translateY(1px) scale(0.97); }

.dy-ticket-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }

.dy-file-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 12px 18px;
  background: var(--dy-crimson);
  color: var(--dy-sticker);
  border: 3px solid var(--dy-ink);
  box-shadow: 5px 5px 0 #0B0709;
  font-family: var(--dy-type);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
  white-space: nowrap;
  cursor: pointer;
  transition: transform 130ms ease, background-color 130ms ease;
}

.dy-file-btn:hover { background: var(--dy-crimson-lift); transform: translateY(-2px); }
.dy-file-btn:active { transform: translateY(2px); box-shadow: 2px 2px 0 #0B0709; }
.dy-file-btn:disabled { opacity: 0.62; cursor: progress; transform: none; }
.dy-file-btn-inline { margin-top: 16px; }

.dy-ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  background: #F6EEDF;
  color: #33210F;
  border: 3px solid var(--dy-ink);
  font-family: var(--dy-type);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: transform 130ms ease, background-color 130ms ease;
}

.dy-ghost-btn:hover { background: #FFFBF2; transform: translateY(-2px); }
.dy-ghost-btn:active { transform: translateY(1px) scale(0.985); }

.dy-form-error {
  margin-top: 12px;
  padding: 9px 11px;
  background: #FBE3E5;
  border-left: 5px solid #96131F;
  font-family: var(--dy-type);
  font-size: 11px;
  font-weight: 700;
  color: #6A0D16;
}

.dy-form-error-wide { margin: 0 0 18px; }

/* -------------------------------------------------------------- logs view */

.dy-toolbar {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 22px;
  background: linear-gradient(180deg, #C9A87C, #B58F5E);
  border: 3px solid var(--dy-ink);
  box-shadow: 6px 7px 0 rgba(6, 3, 4, 0.7);
}

@media (min-width: 900px) {
  .dy-toolbar { grid-template-columns: minmax(220px, 320px) auto; align-items: center; }
  .dy-mood-rail { grid-column: 1 / -1; }
}

.dy-search { position: relative; display: flex; align-items: center; }

.dy-search-icon {
  position: absolute;
  left: 9px;
  color: #6A5233;
  pointer-events: none;
}

.dy-search-input {
  padding: 9px 10px 9px 32px;
  background: #F6EEDF;
  border: 2px solid var(--dy-ink);
  font-size: 0.9rem;
}

.dy-seg { display: flex; flex-wrap: wrap; gap: 0; justify-self: start; }

@media (min-width: 900px) { .dy-seg { justify-self: end; } }

.dy-seg-btn {
  padding: 8px 13px;
  background: #F6EEDF;
  color: #33210F;
  border: 2px solid var(--dy-ink);
  margin-left: -2px;
  font-family: var(--dy-type);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 120ms ease, transform 120ms ease;
}

.dy-seg-btn:first-child { margin-left: 0; }
.dy-seg-btn:hover { background: #FFFBF2; }
.dy-seg-btn:active { transform: translateY(1px); }
.dy-seg-btn[data-on="true"] { background: var(--dy-crimson); color: var(--dy-sticker); }

.dy-mood-rail {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 3px;
  scrollbar-width: thin;
  scrollbar-color: #7D1220 transparent;
}

.dy-mood-rail .dy-chip { flex: 0 0 auto; }

/* Masonry via columns. Cheap, reflows well, and gives the uneven bulletin-board
   rhythm a row grid cannot. */
.dy-board { columns: 1; column-gap: 22px; }

@media (min-width: 720px) { .dy-board { columns: 2; } }
@media (min-width: 1180px) { .dy-board { columns: 3; } }

.dy-clip {
  position: relative;
  break-inside: avoid;
  margin: 0 0 26px;
  padding-top: 16px;
  transform: rotate(var(--tilt, 0deg));
  transition: transform 190ms cubic-bezier(0.2, 0.9, 0.3, 1);
}

.dy-clip:hover,
.dy-clip:focus-within { transform: rotate(0deg) translateY(-5px); z-index: 2; }

/* The whole clipping is clickable, but the click target is a real button laid
   over the card rather than a click handler on a div, so it keyboard-focuses
   and announces itself. The tools in the footer sit above it. */
.dy-clip-open {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: none;
  border: none;
  cursor: pointer;
}

.dy-clip-open:focus-visible { outline: 3px solid var(--dy-caption); outline-offset: 2px; }

.dy-fasten-pin {
  position: absolute;
  z-index: 3;
  top: 0;
  left: 50%;
  translate: -50% 0;
  pointer-events: none;
}

.dy-fasten-tape {
  position: absolute;
  z-index: 3;
  top: 4px;
  width: 84px;
  height: 26px;
  translate: -50% 0;
  rotate: var(--tape-rot, 0deg);
  background:
    repeating-linear-gradient(120deg, rgba(255, 255, 255, 0.28) 0 6px, transparent 6px 12px),
    rgba(190, 62, 78, 0.72);
  border-left: 1px dashed rgba(255, 255, 255, 0.5);
  border-right: 1px dashed rgba(255, 255, 255, 0.5);
  pointer-events: none;
}

.dy-captions {
  position: relative;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: -9px;
  padding-left: 10px;
  pointer-events: none;
}

.dy-caption {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--dy-caption);
  color: var(--dy-ink);
  border: 2px solid var(--dy-ink);
  box-shadow: 2px 2px 0 rgba(6, 3, 4, 0.6);
  font-family: var(--dy-type);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.dy-caption-mood { background: #F0DBA8; }

/* ---- clipping: torn newspaper ---- */

.dy-news {
  padding: 20px 18px 16px;
  background:
    radial-gradient(rgba(120, 100, 74, 0.10) 0.6px, transparent 0.7px) 0 0 / 4px 4px,
    linear-gradient(178deg, #EFE8D6, #E2D8C0);
  box-shadow: 5px 6px 0 rgba(6, 3, 4, 0.55);
}

.dy-news-kicker {
  font-family: var(--dy-type);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: var(--dy-crimson);
  margin-bottom: 5px;
}

.dy-news-head {
  font-family: var(--dy-type);
  font-size: clamp(1.25rem, 2.3vw, 1.7rem);
  font-weight: 700;
  line-height: 1.02;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  color: var(--dy-ink);
}

.dy-news-rule { height: 3px; background: var(--dy-ink); margin: 9px 0 12px; }

.dy-news-photo,
.dy-polaroid-photo {
  display: block;
  width: 100%;
  height: auto;
  border: 2px solid var(--dy-ink);
  margin-bottom: 11px;
}

/* Left aligned, single column. Justified Courier in a masonry column is about
   twelve characters wide and tears itself apart with word gaps; the newsprint
   read comes from the kicker, the heavy headline, the rule and the halftone. */
.dy-news-body {
  font-family: var(--dy-type);
  font-size: 0.83rem;
  line-height: 1.6;
  color: #2A2126;
  white-space: pre-wrap;
}

/* ---- clipping: Bugle cutting ---- */

.dy-bugle {
  padding: 0 0 16px;
  background: linear-gradient(178deg, #EAE0C7, #DCD0B2);
  box-shadow: 5px 6px 0 rgba(6, 3, 4, 0.55);
}

.dy-masthead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--dy-ink);
  color: #FBF6EA;
}

.dy-masthead-name {
  font-family: var(--dy-type);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.dy-masthead-mark { display: inline-flex; }

.dy-masthead-edition {
  margin-left: auto;
  font-family: var(--dy-type);
  font-size: 8.5px;
  letter-spacing: 0.12em;
  opacity: 0.85;
}

.dy-bugle-head {
  padding: 13px 14px 0;
  font-family: var(--dy-type);
  font-size: clamp(1.2rem, 2.2vw, 1.55rem);
  font-weight: 700;
  line-height: 1.05;
  text-transform: uppercase;
  color: var(--dy-ink);
}

.dy-bugle-body {
  padding: 10px 14px 0;
  font-family: var(--dy-type);
  font-size: 0.83rem;
  line-height: 1.55;
  color: #2A2126;
  white-space: pre-wrap;
  border-top: 1px solid rgba(42, 33, 38, 0.3);
  margin-top: 10px;
  padding-top: 10px;
}

/* ---- clipping: sticky note ---- */

.dy-sticky {
  padding: 22px 18px 18px;
  box-shadow: 5px 7px 0 rgba(6, 3, 4, 0.5);
  background: #F3D778;
}

.dy-sticky[data-hue="1"] { background: #EFAFBC; }
.dy-sticky[data-hue="2"] { background: #B8D2C6; }

.dy-sticky-head {
  font-family: 'Permanent Marker', cursive;
  font-size: 1.3rem;
  line-height: 1.08;
  color: #2A2126;
  margin-bottom: 7px;
}

.dy-sticky-body {
  font-family: 'Caveat', cursive;
  font-size: 1.28rem;
  line-height: 1.32;
  color: #33262B;
  white-space: pre-wrap;
}

/* ---- clipping: polaroid ---- */

.dy-polaroid {
  padding: 12px 12px 16px;
  background: #FDFBF7;
  box-shadow: 6px 8px 0 rgba(6, 3, 4, 0.55);
}

.dy-polaroid-window {
  background: #1C1317;
  border: 2px solid var(--dy-ink);
  margin-bottom: 11px;
}

.dy-polaroid-photo { margin-bottom: 0; border: none; }

.dy-polaroid-head {
  font-family: 'Permanent Marker', cursive;
  font-size: 1.16rem;
  line-height: 1.1;
  color: #2A2126;
}

.dy-polaroid-body {
  margin-top: 5px;
  font-family: 'Caveat', cursive;
  font-size: 1.2rem;
  line-height: 1.3;
  color: #4A3B41;
  white-space: pre-wrap;
}

/* ---- the drawn comic panel that stands in for a photo ---- */

.dy-panel {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border: 2px solid var(--dy-ink);
  margin-bottom: 11px;
  background: linear-gradient(178deg, #4E6472 0%, #22323E 56%, #131C24 100%);
}

.dy-panel-1 { background: linear-gradient(178deg, #7A4450 0%, #3E2029 56%, #170D12 100%); }
.dy-panel-2 { background: linear-gradient(178deg, #6E6040 0%, #3A3220 56%, #16130D 100%); }

/* Halftone over the sky only, fading out before it reaches the buildings. A
   dot field across the whole panel is what made this read as a swatch. */
.dy-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(255, 255, 255, 0.16) 1px, transparent 1.2px);
  background-size: 5px 5px;
  mask-image: linear-gradient(180deg, #000 0%, transparent 52%);
}

/* Speed rays out of the top right, the way an action panel is inked. */
.dy-panel-burst {
  position: absolute;
  inset: 0;
  background: repeating-conic-gradient(
    from 196deg at 80% 6%,
    rgba(255, 255, 255, 0.07) 0deg 2.6deg,
    transparent 2.6deg 10deg
  );
  mask-image: linear-gradient(180deg, #000 0%, transparent 62%);
}

/* A skyline with buildings of genuinely different widths and heights, each one
   its own no-repeat layer anchored to the floor of the panel. */
.dy-panel-city {
  position: absolute;
  inset: auto 0 0 0;
  height: 100%;
  background:
    linear-gradient(#0D1319 0 0) 2% 100% / 9% 34% no-repeat,
    linear-gradient(#111922 0 0) 13% 100% / 7% 21% no-repeat,
    linear-gradient(#0D1319 0 0) 22% 100% / 11% 44% no-repeat,
    linear-gradient(#111922 0 0) 34% 100% / 6% 17% no-repeat,
    linear-gradient(#0A1016 0 0) 41% 100% / 13% 54% no-repeat,
    linear-gradient(#111922 0 0) 55% 100% / 8% 28% no-repeat,
    linear-gradient(#0D1319 0 0) 64% 100% / 10% 39% no-repeat,
    linear-gradient(#111922 0 0) 75% 100% / 7% 23% no-repeat,
    linear-gradient(#0A1016 0 0) 83% 100% / 12% 48% no-repeat,
    linear-gradient(#111922 0 0) 96% 100% / 8% 30% no-repeat;
}

.dy-panel-label {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 3px 7px;
  background: var(--dy-caption);
  border: 2px solid var(--dy-ink);
  font-family: var(--dy-type);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--dy-ink);
  max-width: calc(100% - 16px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- clipping footer ---- */

.dy-clip-foot {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 7px;
  padding: 0 4px;
  font-family: var(--dy-type);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #E7B6C1;
  pointer-events: none;
}

.dy-stamp {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  background: var(--dy-crimson);
  color: var(--dy-sticker);
  border: 2px solid var(--dy-sticker);
  outline: 2px solid var(--dy-ink);
  font-size: 11px;
}

.dy-stamp-wide {
  width: auto;
  padding: 4px 9px;
  font-family: var(--dy-type);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.dy-clip-geo { display: inline-flex; align-items: center; gap: 3px; opacity: 0.85; }

.dy-clip-tools { margin-left: auto; display: flex; gap: 5px; pointer-events: auto; }

.dy-tool {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  background: rgba(246, 238, 223, 0.9);
  color: #33210F;
  border: 2px solid var(--dy-ink);
  cursor: pointer;
  transition: transform 120ms ease, background-color 120ms ease;
}

.dy-tool:hover { background: var(--dy-caption); transform: translateY(-2px); }
.dy-tool:active { transform: translateY(1px) scale(0.94); }

/* Tools stay hidden until the card is hovered on pointer devices, and are
   always present on touch, where there is no hover to reveal them. */
@media (hover: hover) {
  .dy-clip-tools { opacity: 0; transition: opacity 150ms ease; }
  .dy-clip:hover .dy-clip-tools,
  .dy-clip:focus-within .dy-clip-tools { opacity: 1; }
}

/* -------------------------------------------------- loading and empty */

.dy-skeleton {
  position: relative;
  break-inside: avoid;
  margin: 0 0 26px;
  padding: 26px 16px 18px;
  background: rgba(246, 238, 223, 0.14);
  border: 2px dashed rgba(246, 238, 223, 0.3);
  animation: dy-breathe 1.9s ease-in-out infinite;
}

.dy-skeleton:nth-child(2) { min-height: 210px; }
.dy-skeleton:nth-child(3) { min-height: 150px; }
.dy-skeleton:nth-child(5) { min-height: 240px; }

@keyframes dy-breathe {
  0%, 100% { opacity: 0.42; }
  50%      { opacity: 0.78; }
}

.dy-skeleton-pin,
.dy-skeleton-cap,
.dy-skeleton-head,
.dy-skeleton-line {
  display: block;
  background: rgba(246, 238, 223, 0.4);
}

.dy-skeleton-pin {
  position: absolute;
  top: -9px;
  left: 50%;
  translate: -50% 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(190, 62, 78, 0.6);
}

.dy-skeleton-cap { width: 82px; height: 17px; margin-bottom: 12px; }
.dy-skeleton-head { width: 74%; height: 24px; margin-bottom: 12px; }
.dy-skeleton-line { width: 100%; height: 10px; margin-bottom: 8px; }
.dy-skeleton-short { width: 62%; }

.dy-empty {
  position: relative;
  max-width: 520px;
  margin: 26px auto;
  padding: 42px 26px 32px;
  text-align: center;
  background:
    radial-gradient(rgba(120, 100, 74, 0.10) 0.6px, transparent 0.7px) 0 0 / 4px 4px,
    #F4EDDD;
  border: 2px solid var(--dy-ink);
  box-shadow: 8px 9px 0 rgba(6, 3, 4, 0.65);
  transform: rotate(-1.1deg);
}

.dy-empty-pin { position: absolute; top: -14px; left: 50%; translate: -50% 0; }

.dy-empty-head {
  font-family: 'Permanent Marker', cursive;
  font-size: 1.7rem;
  color: var(--dy-ink);
}

.dy-empty-body {
  margin-top: 8px;
  font-family: 'Caveat', cursive;
  font-size: 1.3rem;
  line-height: 1.35;
  color: #4A3B41;
}

/* --------------------------------------------------------------- map view */

.dy-map-view { display: grid; grid-template-columns: 1fr; gap: 22px; }

@media (min-width: 1080px) {
  .dy-map-view { grid-template-columns: minmax(0, 1fr) 300px; gap: 26px; align-items: start; }
}

.dy-mapboard {
  position: relative;
  padding: 16px;
  background:
    repeating-linear-gradient(94deg, rgba(0, 0, 0, 0.12) 0 3px, transparent 3px 15px),
    linear-gradient(170deg, #8A6A47, #6B4F35);
  border: 3px solid var(--dy-ink);
  box-shadow: 9px 10px 0 rgba(6, 3, 4, 0.7);
}

.dy-tape-corner {
  position: absolute;
  width: 74px;
  height: 24px;
  background:
    repeating-linear-gradient(120deg, rgba(255, 255, 255, 0.3) 0 6px, transparent 6px 12px),
    rgba(240, 232, 214, 0.62);
  border-left: 1px dashed rgba(255, 255, 255, 0.55);
  border-right: 1px dashed rgba(255, 255, 255, 0.55);
  pointer-events: none;
  z-index: 2;
}

.dy-tape-tl { top: -10px; left: -14px; rotate: -38deg; }
.dy-tape-tr { top: -10px; right: -14px; rotate: 38deg; }
.dy-tape-bl { bottom: -10px; left: -14px; rotate: 38deg; }
.dy-tape-br { bottom: -10px; right: -14px; rotate: -38deg; }

.dy-place-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 9px 12px;
  background: var(--dy-caption);
  border: 2px solid var(--dy-ink);
  font-family: var(--dy-type);
  font-size: 11px;
  font-weight: 700;
  color: var(--dy-ink);
}

.dy-mapframe {
  position: relative;
  aspect-ratio: 1000 / 680;
  border: 2px solid var(--dy-ink);
  overflow: hidden;
}

.dy-mapframe[data-placing="true"] { cursor: crosshair; outline: 3px dashed var(--dy-caption); outline-offset: -6px; }

.dy-mapart { display: block; width: 100%; height: 100%; }

.dy-route { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

.dy-mappin {
  position: absolute;
  translate: -50% -86%;
  background: none;
  border: none;
  padding: 0;
  line-height: 0;
  cursor: pointer;
  transition: transform 150ms cubic-bezier(0.2, 0.9, 0.3, 1);
}

.dy-mappin:hover { transform: scale(1.18) translateY(-3px); }
.dy-mappin:active { transform: scale(1.02); }
.dy-mappin[data-on="true"] { transform: scale(1.22) translateY(-4px); }
.dy-mappin:focus-visible { outline: 3px solid var(--dy-caption); outline-offset: 2px; }

.dy-pin-card {
  position: absolute;
  z-index: 3;
  width: min(260px, 62vw);
  translate: 14px -100%;
  padding: 12px 13px 11px;
  background:
    radial-gradient(rgba(120, 100, 74, 0.10) 0.6px, transparent 0.7px) 0 0 / 4px 4px,
    #F4EDDD;
  border: 2px solid var(--dy-ink);
  box-shadow: 5px 6px 0 rgba(6, 3, 4, 0.65);
}

.dy-pin-card[data-flip-x="true"] { translate: calc(-100% - 14px) -100%; }
.dy-pin-card[data-flip-y="true"] { translate: 14px 8px; }
.dy-pin-card[data-flip-x="true"][data-flip-y="true"] { translate: calc(-100% - 14px) 8px; }

.dy-pin-card-head {
  margin-top: 7px;
  font-family: 'Permanent Marker', cursive;
  font-size: 1.05rem;
  line-height: 1.12;
  color: var(--dy-ink);
}

.dy-pin-card-where {
  font-family: var(--dy-type);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--dy-crimson);
  margin-top: 3px;
}

.dy-pin-card-body {
  margin-top: 6px;
  font-family: 'Caveat', cursive;
  font-size: 1.06rem;
  line-height: 1.28;
  color: #3B2E33;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dy-pin-card-actions { display: flex; gap: 6px; margin-top: 10px; }

.dy-mapside {
  padding: 18px 16px;
  background: linear-gradient(172deg, #D8BB8E, #B0894F);
  border: 3px solid var(--dy-ink);
  box-shadow: 7px 8px 0 rgba(6, 3, 4, 0.7);
  transform: rotate(-0.6deg);
}

.dy-side-head {
  font-family: 'Permanent Marker', cursive;
  font-size: 1.4rem;
  color: #33210F;
}

.dy-side-sub {
  margin-top: 18px;
  margin-bottom: 7px;
  font-family: var(--dy-type);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--dy-crimson);
}

.dy-side-note {
  margin-top: 5px;
  font-family: 'Caveat', cursive;
  font-size: 1.14rem;
  line-height: 1.3;
  color: #402C14;
}

.dy-legend { display: grid; gap: 5px; }

.dy-legend li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--dy-type);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #33210F;
}

.dy-unplotted { display: grid; gap: 6px; max-height: 260px; overflow-y: auto; }

.dy-unplotted-btn {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 7px 9px;
  text-align: left;
  background: #F6EEDF;
  border: 2px solid var(--dy-ink);
  cursor: pointer;
  transition: transform 120ms ease, background-color 120ms ease;
}

.dy-unplotted-btn:hover { background: #FFFBF2; transform: translateX(2px); }
.dy-unplotted-btn:active { transform: translateX(0) scale(0.99); }
.dy-unplotted-btn[data-on="true"] { background: var(--dy-caption); box-shadow: 3px 3px 0 #0B0709; }

.dy-unplotted-date {
  font-family: var(--dy-type);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--dy-crimson);
}

.dy-unplotted-title {
  font-family: 'Permanent Marker', cursive;
  font-size: 0.95rem;
  line-height: 1.14;
  color: #2A2126;
}

/* --------------------------------------------------------------- console */

.dy-console {
  position: fixed;
  z-index: 20;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-items: end;
  gap: 4px;
  padding: 12px 10px 14px;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.16) 0 3px, transparent 3px 16px),
    linear-gradient(180deg, #A87F52, #7C5A38);
  border-top: 3px solid var(--dy-ink);
  box-shadow: 0 -8px 22px rgba(0, 0, 0, 0.6);
}

/* the torn top edge of the cardboard strip */
.dy-console::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -9px;
  height: 10px;
  background: repeating-linear-gradient(96deg, #A87F52 0 9px, transparent 9px 17px);
}

.dy-console-btn {
  display: grid;
  justify-items: center;
  gap: 5px;
  padding: 4px 2px;
  background: none;
  border: none;
  color: #F1E2CB;
  font-family: var(--dy-type);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 150ms cubic-bezier(0.2, 0.9, 0.3, 1), color 150ms ease;
}

.dy-console-btn:hover { transform: translateY(-3px); color: #FFF7EA; }
.dy-console-btn:active { transform: translateY(1px) scale(0.97); }
.dy-console-btn[data-on="true"] { color: #FFF7EA; }

/* The sticker outline: a thick white cut-line around every console emblem, with
   an ink keyline outside it so it reads on the pale cardboard too. */
.dy-console-badge {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--dy-crimson);
  color: var(--dy-sticker);
  border: 3px solid var(--dy-sticker);
  outline: 2px solid var(--dy-ink);
  box-shadow: 3px 4px 0 rgba(6, 3, 4, 0.7);
  transition: background-color 150ms ease;
}

.dy-console-badge-hero {
  width: 58px;
  height: 58px;
  background: #2E0509;
}

.dy-console-btn[data-on="true"] .dy-console-badge { background: var(--dy-crimson-lift); }
.dy-console-btn[data-on="true"] .dy-console-badge-hero { background: var(--dy-crimson); }
.dy-console-btn:focus-visible .dy-console-badge { outline: 3px solid var(--dy-caption); }

/* --------------------------------------------------------------- overlays */

.dy-overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 18px;
  overflow-y: auto;
  /* No transform/filter/perspective anywhere on this element or the scrim
     below will stop being viewport-fixed and the bug returns. */
}

/* Was position:absolute. Inside .dy-overlay, which is the scrolling box,
   an absolutely positioned child is laid out against the padding box and then
   SCROLLS WITH THE CONTENT - so on a long log the dark backdrop slid up out of
   view after a few hundred pixels and the page showed through behind the
   folder. Fixed positioning pins it to the viewport instead, which is what it
   always looked like it was doing at short lengths. */
.dy-overlay-scrim {
  position: fixed;
  inset: 0;
  background: rgba(9, 5, 7, 0.82);
  border: none;
  cursor: pointer;
}

@keyframes dy-folder-in {
  0%   { opacity: 0; transform: translateY(16px) scale(0.965) rotate(-0.8deg); }
  100% { opacity: 1; transform: translateY(0) scale(1) rotate(-0.4deg); }
}

.dy-folder,
.dy-confirm {
  position: relative;
  width: min(720px, 100%);
  margin: auto;
  padding: 26px 20px 20px;
  background: linear-gradient(172deg, #D9BC90, #BE9A66);
  border: 3px solid var(--dy-ink);
  box-shadow: 12px 14px 0 rgba(3, 2, 2, 0.8);
  animation: dy-folder-in 260ms cubic-bezier(0.2, 0.9, 0.3, 1) both;
}

.dy-confirm { width: min(460px, 100%); text-align: center; }

.dy-folder-tab {
  position: absolute;
  top: -22px;
  left: 26px;
  padding: 5px 16px 6px;
  background: #D9BC90;
  border: 3px solid var(--dy-ink);
  border-bottom: none;
  font-family: var(--dy-type);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: #33210F;
}

.dy-folder-close {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  background: var(--dy-crimson);
  color: var(--dy-sticker);
  border: 2px solid var(--dy-sticker);
  outline: 2px solid var(--dy-ink);
  cursor: pointer;
  transition: transform 130ms ease, background-color 130ms ease;
}

.dy-folder-close:hover { background: var(--dy-crimson-lift); transform: rotate(90deg); }

.dy-folder-paper {
  padding: 22px clamp(16px, 4vw, 34px) 24px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.7) 0%, transparent 18%),
    radial-gradient(rgba(140, 120, 96, 0.09) 0.6px, transparent 0.7px) 0 0 / 4px 4px,
    #FCF8F1;
  border: 1px solid #C9BEAA;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
}

.dy-folder-head {
  font-family: var(--dy-type);
  font-size: clamp(1.5rem, 4vw, 2.2rem);
  font-weight: 700;
  line-height: 1.02;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  color: var(--dy-ink);
}

.dy-folder-stamps { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 16px; }

.dy-ink-stamp {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border: 2px solid var(--dy-crimson);
  color: var(--dy-crimson);
  font-family: var(--dy-type);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  transform: rotate(-1.2deg);
}

.dy-folder-body {
  font-family: var(--dy-type);
  font-size: 0.96rem;
  line-height: 1.72;
  color: #241C20;
  white-space: pre-wrap;
  border-top: 2px solid rgba(42, 33, 38, 0.25);
  padding-top: 16px;
}

.dy-folder-map {
  position: relative;
  margin-top: 18px;
  aspect-ratio: 1000 / 680;
  max-height: 240px;
  border: 2px solid var(--dy-ink);
  overflow: hidden;
}

.dy-folder-map-art { display: block; width: 100%; height: 100%; }

.dy-folder-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }

.dy-confirm-head {
  font-family: 'Permanent Marker', cursive;
  font-size: 1.55rem;
  color: #2A1608;
}

.dy-confirm-body {
  margin-top: 8px;
  font-family: var(--dy-type);
  font-size: 0.95rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #33210F;
}

.dy-confirm-note {
  margin-top: 6px;
  font-family: 'Caveat', cursive;
  font-size: 1.15rem;
  color: #4B341A;
}

.dy-confirm-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 18px; }

/* ------------------------------------------------------- reduced motion */

@media (prefers-reduced-motion: reduce) {
  .dy-skeleton { animation: none; opacity: 0.6; }
  .dy-folder,
  .dy-confirm { animation: none; }
  .dy-clip:hover,
  .dy-clip:focus-within { transform: rotate(var(--tilt, 0deg)); }
  .dy-strike-a .dy-tw-bars,
  .dy-strike-b .dy-tw-bars { animation: none; }
}
`;
