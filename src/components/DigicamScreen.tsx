"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Crop,
  Download,
  FlipHorizontal2,
  FlipVertical2,
  Heart,
  HelpCircle,
  GripVertical,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";
import {
  compressImage,
  formatBytes,
  playableMediaSrc,
  readFileAsDataUrl,
  relabelDataUrl,
  transcodeVideo,
  withGuessedType,
} from "@/lib/media/mediaPrep";

/* ============================================================================
   CH.04 - RETRO DIGICAM
   The whole chapter is built around the real camera photograph at
   /images/digicam-landscape.webp. Every control below is a transparent hit
   target pinned to the actual physical button in that photo (percentages in
   CAM were measured off the asset, not guessed), so the UI reads as the
   camera itself rather than a web toolbar floating on top of a picture.
   ========================================================================= */

interface DigicamItem {
  id: string;
  couple_id: string;
  uploader_id: string;
  media_type: "image" | "video";
  caption: string;
  notes: string;
  created_at: string;
  photo_scale: number | null;
  photo_x: number | null;
  photo_y: number | null;
  photo_rotation: number | null;
  photo_flip_h: boolean | null;
  photo_flip_v: boolean | null;
  filter: string | null;
  is_favorite: boolean | null;
  position: number | null;
}

interface DigicamScreenProps {
  userId: string;
  coupleId: string;
  onBack: () => void;
}

interface Frame {
  scale: number;
  x: number;
  y: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

/* What a file may weigh when it is PICKED. Photos are downscaled and clips
   re-encoded in the browser before they are stored, so these are only a sanity
   ceiling on what is worth reading into memory at all - not the size that ends
   up in the database. See src/lib/media/mediaPrep.ts. */
const MAX_IMAGE_PICK_BYTES = 40 * 1024 * 1024;
const MAX_VIDEO_PICK_BYTES = 300 * 1024 * 1024;

/* What may actually be STORED, after preparation. `digicam_media.url` has a
   35MB CHECK constraint in Postgres; staying well under it keeps the roll fast
   to load and leaves the constraint as a backstop rather than a tripwire. */
const MAX_STORED_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_STORED_VIDEO_BYTES = 26 * 1024 * 1024;

/* A clip is re-encoded when it is bigger than this, regardless of format -
   under it, the original is kept so a short clip isn't needlessly degraded. */
const VIDEO_TRANSCODE_THRESHOLD = 12 * 1024 * 1024;

/* Must stay ONE string literal. Supabase parses the column list at compile time
   from the literal type, so concatenating pieces widens it to `string` and the
   query comes back typed as GenericStringError[] instead of the row shape.

   PERFORMANCE: `url` is deliberately NOT in this list. It holds the entire
   photo or clip as base64 - on this account the five rows in the roll come to
   ~35MB - and selecting it here meant the chapter downloaded every frame in
   the roll at full size before it could draw anything at all. The metadata
   below is a couple of KB and arrives instantly; the media itself is fetched
   afterwards by `loadMediaFor`, current frame first. */
const SELECT_COLUMNS =
  "id, couple_id, uploader_id, media_type, caption, notes, created_at, photo_scale, photo_x, photo_y, photo_rotation, photo_flip_h, photo_flip_v, filter, is_favorite, position";

/* Film stocks. `css` goes straight into the CSS filter property on the photo,
   `chip` is the swatch colour used in the picker so each stock is identifiable
   before you apply it. */
/* Each stock is more than a `filter:` string now - `grain` and `vignette`
   (0-1) drive an overlay layered on top of the media (see .digicam-filmgrain
   / the vignette div next to the img/video), and `tint` is a soft-light
   colour wash. Plain contrast/saturate/hue-rotate reads as "an Instagram CSS
   filter"; grain + vignette + a colour cast is what actually reads as film
   stock, which is what Nini asked for over the original bare `css` combos. */
const FILTERS = [
  { id: "none", label: "NO FILTER", css: "none", chip: "#F2E6D2", grain: 0.05, vignette: 0.16, tint: null },
  { id: "flash", label: "FLASH ON", css: "brightness(1.16) contrast(1.05) saturate(0.9)", chip: "#FFF3D6", grain: 0.08, vignette: 0.4, tint: "rgba(255,244,214,0.12)" },
  { id: "y2k", label: "Y2K", css: "saturate(1.6) contrast(1.15) hue-rotate(-6deg) brightness(1.02)", chip: "#7FD8D2", grain: 0.14, vignette: 0.22, tint: "rgba(90,220,210,0.08)" },
  { id: "noir", label: "NOIR", css: "grayscale(1) contrast(1.35) brightness(0.92)", chip: "#B9B4B8", grain: 0.26, vignette: 0.55, tint: null },
  { id: "oldroll", label: "OLD ROLL", css: "sepia(0.5) contrast(1.06) saturate(1.05) brightness(0.98) hue-rotate(-6deg)", chip: "#C89B62", grain: 0.32, vignette: 0.48, tint: "rgba(200,155,98,0.16)" },
  { id: "faded", label: "FADED", css: "contrast(0.8) saturate(0.6) brightness(1.16) sepia(0.12)", chip: "#DCC9C4", grain: 0.2, vignette: 0.28, tint: "rgba(255,255,255,0.12)" },
  { id: "vivid", label: "VIVID", css: "saturate(1.7) contrast(1.18) brightness(1.02)", chip: "#FF5A7A", grain: 0.05, vignette: 0.18, tint: null },
  { id: "expired", label: "EXPIRED", css: "sepia(0.3) hue-rotate(-18deg) saturate(1.4) contrast(1.08)", chip: "#C4705A", grain: 0.38, vignette: 0.42, tint: "rgba(196,112,90,0.18)" },
  { id: "earth65", label: "EARTH-65", css: "saturate(1.3) hue-rotate(300deg) contrast(1.1) brightness(1.03)", chip: "#D9889E", grain: 0.16, vignette: 0.38, tint: "rgba(217,136,158,0.18)" },
  { id: "nightcam", label: "NIGHT CAM", css: "grayscale(1) sepia(1) hue-rotate(62deg) saturate(3) brightness(0.9)", chip: "#6BE07A", grain: 0.42, vignette: 0.6, tint: "rgba(107,224,122,0.12)" },
  { id: "negative", label: "NEGATIVE", css: "invert(1) hue-rotate(180deg) contrast(1.06)", chip: "#7FA8FF", grain: 0.06, vignette: 0.14, tint: null },
] as const;

const filterCss = (id: string | null) =>
  FILTERS.find((f) => f.id === (id ?? "none"))?.css ?? "none";
const filterLabel = (id: string | null) =>
  FILTERS.find((f) => f.id === (id ?? "none"))?.label ?? "NO FILTER";
const filterMeta = (id: string | null) => FILTERS.find((f) => f.id === (id ?? "none")) ?? FILTERS[0];

/* Geometry taken off /images/digicam-landscape.webp (1698x1080).
   `lcd` is NOT eyeballed: the chassis PNG has a real transparent hole where the
   screen is, and these are that hole's exact bounds, found by flood-filling the
   alpha channel inward from the border (hole bbox 111,184 -> 1163,981).
   Because the media sits BEHIND the chassis, the bezel overlaps its edges and
   the photo reads as being inside the camera instead of pasted on top. Any
   change to the chassis art means re-deriving these. */
const CAM = {
  lcd: { left: 6.54, top: 17.04, right: 31.45, bottom: 9.07 },
  buttons: {
    zoomOut: { left: 79.5, top: 14.2, size: 5.2 },
    zoomIn: { left: 89.0, top: 14.2, size: 5.2 },
    upload: { left: 79.0, top: 22.0, size: 4.4 },
    adjust: { left: 86.2, top: 22.0, size: 4.4 },
    help: { left: 91.2, top: 22.0, size: 4.2 },
    shuffle: { left: 82.2, top: 28.0, size: 5.2 },
    /* the camera's own flash key, reused for the film-stock picker */
    film: { left: 77.7, top: 34.6, size: 4.4 },
    menu: { left: 80.0, top: 45.8, size: 6.4 },
    dUp: { left: 85.2, top: 58.8, size: 5.6 },
    dLeft: { left: 79.8, top: 67.5, size: 5.6 },
    dRight: { left: 90.9, top: 67.5, size: 5.6 },
    dDown: { left: 85.2, top: 76.8, size: 5.6 },
    ok: { left: 85.4, top: 67.5, size: 5.9 },
    trash: { left: 80.0, top: 88.3, size: 5.6 },
    /* bare chassis to the right of the bin, so save sits with delete */
    save: { left: 90.2, top: 88.3, size: 5.6 },
  },
} as const;

const CHASSIS_RATIO = "1698 / 1080";

const DEFAULT_FRAME: Frame = { scale: 1, x: 0, y: 0, rotation: 0, flipH: false, flipV: false };

function frameOf(item: DigicamItem | undefined): Frame {
  if (!item) return DEFAULT_FRAME;
  return {
    scale: item.photo_scale ?? 1,
    x: item.photo_x ?? 0,
    y: item.photo_y ?? 0,
    rotation: item.photo_rotation ?? 0,
    flipH: item.photo_flip_h ?? false,
    flipV: item.photo_flip_v ?? false,
  };
}

/* Flip is folded into the scale so a mirrored photo still pans in the
   direction you drag. Matches how Chapter 3 frames its polaroids. */
function frameTransform(f: Frame): string {
  const sx = f.flipH ? -f.scale : f.scale;
  const sy = f.flipV ? -f.scale : f.scale;
  return `translate(${f.x}%, ${f.y}%) rotate(${f.rotation}deg) scale(${sx}, ${sy})`;
}

/* ---------------------------------------------------------------------------
   Optional custom art. Every one of these slots is allowed to be missing: if
   the file is not there the element removes itself and the CSS underneath is
   the finished look, never a broken icon or a hole in the layout. Drop files
   into public/images/digicam/ to fill them in. See the README in that folder.
   ------------------------------------------------------------------------ */
function OptionalAsset({
  src,
  alt = "",
  className = "",
  style,
}: {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [missing, setMissing] = useState(false);
  if (missing) return null;
  return (
    <img
      src={src}
      alt={alt}
      aria-hidden={alt === "" ? true : undefined}
      draggable={false}
      onError={() => setMissing(true)}
      className={`pointer-events-none select-none ${className}`}
      style={style}
    />
  );
}

/* ---------------------------------------------------------------------------
   A single physical button on the camera. These used to be bare transparent
   circles pinned over the photographed buttons, which meant there was nothing
   on screen that actually looked pressable. Each one is now a moulded key cap
   in its own right: domed silver face, ink outline, hard shadow underneath,
   and the icon for what it does printed on it. It lifts on hover, travels down
   onto its shadow on press, and turns pink while its panel is open. The
   handwritten tag still names the control on hover and focus.
   ------------------------------------------------------------------------ */
function CamButton({
  spot,
  label,
  onClick,
  disabled,
  active,
  busy,
  tone,
  tagSide = "left",
  children,
}: {
  spot: { left: number; top: number; size: number };
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  busy?: boolean;
  tone?: "danger";
  tagSide?: "left" | "right";
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={`digicam-key group absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer
        ${active ? "digicam-key-on" : ""}
        ${tone === "danger" ? "digicam-key-danger" : ""}
        disabled:opacity-30 disabled:pointer-events-none`}
      style={{ left: `${spot.left}%`, top: `${spot.top}%`, width: `${spot.size}%`, aspectRatio: "1" }}
    >
      <span className="digicam-key-body">
        <span className="digicam-key-icon">
          {busy ? <Loader2 className="animate-spin" /> : children}
        </span>
      </span>
      <span
        className={`digicam-tag pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap
          ${tagSide === "left" ? "right-[135%]" : "left-[135%]"}`}
      >
        {label}
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------------------
   Film strip contact sheet. Doubles as navigation and as the chapter's main
   piece of scrapbook furniture, so the page reads as a roll of film on a desk
   rather than a single floating widget.
   ------------------------------------------------------------------------ */
function FilmStrip({
  items,
  currentIndex,
  onJump,
  urlOf,
  onReorder,
  onReorderCommit,
  slideshowOn,
  onToggleSlideshow,
}: {
  items: DigicamItem[];
  currentIndex: number;
  onJump: (i: number) => void;
  /* Media bytes are fetched separately from row metadata, so the strip is
     handed a resolver rather than reading `item.url` (which no longer exists
     on the row). Returns "" while a frame's bytes are still in flight. */
  urlOf: (item: DigicamItem) => string;
  onReorder: (dragId: string, overId: string) => void;
  onReorderCommit: () => void;
  slideshowOn: boolean;
  onToggleSlideshow: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [thumbErrors, setThumbErrors] = useState<Set<string>>(new Set());

  /* Pointer Events rather than HTML5 drag-and-drop: native DnD barely works
     on touch, and every other drag interaction in this app (Timeline's crop
     pan, the Letter Jar pile, the Dossier corkboard) already uses Pointer
     Events for the same reason - one code path for mouse, touch and pen. A
     small movement threshold before a drag "starts" keeps a plain tap still
     working as jump-to-frame instead of every tap being swallowed as a
     zero-distance drag. */
  const dragIdRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handleFramePointerDown = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragIdRef.current = id;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleFramePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragIdRef.current || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (!draggingId && Math.hypot(dx, dy) < 6) return;
    if (!draggingId) setDraggingId(dragIdRef.current);

    const rail = stripRef.current;
    if (!rail) return;
    const frames = Array.from(rail.querySelectorAll<HTMLElement>("[data-frame-id]"));
    const overEl = frames.find((f) => {
      const r = f.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right;
    });
    const overId = overEl?.dataset.frameId;
    if (overId && overId !== dragIdRef.current) {
      onReorder(dragIdRef.current, overId);
    }
  };

  /* A ref, not the `draggingId` state: the browser fires `click` right after
     `pointerup`, and by then React has already committed the state update
     from endDrag() on a fresh render with a new click handler closure - a
     state read there would already see the reset value and the guard below
     would never fire. */
  const justDraggedRef = useRef(false);

  const endDrag = () => {
    const wasDragging = Boolean(draggingId);
    dragIdRef.current = null;
    dragStartRef.current = null;
    setDraggingId(null);
    if (wasDragging) {
      justDraggedRef.current = true;
      onReorderCommit();
    }
  };

  const handleFrameClick = (e: React.MouseEvent<HTMLButtonElement>, i: number) => {
    /* A drag that just ended shouldn't also fire the click that finishes a
       pointer gesture. */
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      e.preventDefault();
      return;
    }
    onJump(i);
  };

  useEffect(() => {
    /* Deliberately NOT el.scrollIntoView(): it walks up the ancestor chain
       looking for anything scrollable to satisfy `inline: "center"`, and
       `<main className="digicam-desk ... overflow-hidden">` counts as a
       scroll container even with no visible scrollbar - so it was also
       nudging the whole chassis sideways every time Next/Prev changed the
       frame. Scrolling only this strip's own rail keeps the shift local. */
    const container = stripRef.current;
    const el = container?.querySelector<HTMLElement>(`[data-frame="${currentIndex}"]`);
    if (!container || !el) return;
    const target = el.offsetLeft - (container.clientWidth - el.clientWidth) / 2;
    container.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [currentIndex]);

  if (!items.length) return null;

  /* w-max keeps the strip the width of the film actually on it, so a short roll
     does not stretch into a long empty rail. */
  return (
    <div className="film-strip relative mt-10 mx-auto max-w-full w-max">
      <div className="absolute -top-3 left-8 tape-pink-solid w-24 h-6 -rotate-3 z-20 pointer-events-none" />
      <div className="absolute -top-3 right-12 tape-gold-solid w-20 h-6 rotate-2 z-20 pointer-events-none" />

      <div ref={stripRef} className="film-strip-rail flex gap-3 overflow-x-auto px-5 py-6">
        {items.map((item, i) => {
          const f = frameOf(item);
          const isCurrent = i === currentIndex;
          return (
            <button
              key={item.id}
              data-frame={i}
              data-frame-id={item.id}
              type="button"
              onClick={(e) => handleFrameClick(e, i)}
              onPointerDown={(e) => handleFramePointerDown(e, item.id)}
              onPointerMove={handleFramePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              aria-label={`Frame ${i + 1}${item.caption ? `, ${item.caption}` : ""}. Press and drag to reorder.`}
              aria-current={isCurrent}
              className={`film-frame relative shrink-0 w-24 h-[72px] overflow-hidden cursor-grab touch-none
                ${isCurrent ? "film-frame-current" : ""}
                ${draggingId === item.id ? "film-frame-dragging" : ""}`}
            >
              {!urlOf(item) ? (
                /* Unexposed frame: the row is known, its bytes are still on the
                   way. Keeps the strip's length and paging stable instead of
                   letting frames pop into existence one by one. */
                <div className="absolute inset-0 bg-[#131417] flex items-center justify-center">
                  <span className="w-3 h-3 rounded-full border border-[#3c3238] border-t-[#ECA8B8] animate-spin" />
                </div>
              ) : item.media_type === "video" ? (
                thumbErrors.has(item.id) ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#131417] text-lg">
                    🎞️
                  </div>
                ) : (
                  <video
                    src={urlOf(item)}
                    muted
                    playsInline
                    preload="metadata"
                    onError={() => setThumbErrors((prev) => new Set(prev).add(item.id))}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ filter: filterCss(item.filter), transform: frameTransform(f) }}
                  />
                )
              ) : (
                <img
                  src={urlOf(item)}
                  alt=""
                  /* Every thumbnail here is the full-size photo as a base64 data
                     URL, so without these the strip decodes the whole gallery at
                     full resolution the moment the chapter mounts. */
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ filter: filterCss(item.filter), transform: frameTransform(f) }}
                />
              )}
              {item.is_favorite && (
                <Heart className="absolute top-1 right-1 w-3 h-3 fill-[#D9889E] text-[#17131A]" />
              )}
              <GripVertical className="absolute top-0.5 left-0.5 w-2.5 h-2.5 text-white/60 drop-shadow pointer-events-none" />
              <span className="absolute bottom-0 left-0 right-0 bg-[#17131A]/80 font-mono text-[7px] font-black text-[#ECA8B8] px-1 py-px text-left">
                {String(i + 1).padStart(2, "0")}
              </span>
            </button>
          );
        })}
      </div>

      <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 font-mono text-[9px] font-black uppercase tracking-widest text-[#261D24] bg-[#EAD9A9] px-3 py-0.5 border-2 border-[#261D24] shadow-[2px_2px_0_#17131A] -rotate-1">
        Contact sheet
      </span>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <span className="font-mono text-[8px] font-bold text-[#8faeaa] uppercase tracking-widest">
          Drag a frame to reorder
        </span>
        {items.length > 1 && (
          <button
            type="button"
            onClick={onToggleSlideshow}
            aria-pressed={slideshowOn}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border text-[9px] font-mono font-black uppercase tracking-widest cursor-pointer transition ${
              slideshowOn
                ? "bg-[#7D2834] border-[#261D24] text-[#F2E6D2]"
                : "bg-[#17131A] border-[#8faeaa]/40 text-[#ECA8B8] hover:bg-[#231C28]"
            }`}
          >
            {slideshowOn ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {slideshowOn ? "Stop slideshow" : "Auto slideshow"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function DigicamScreen({ userId, coupleId, onBack }: DigicamScreenProps) {
  const supabase = createClient();

  const [items, setItems] = useState<DigicamItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [chassisBroken, setChassisBroken] = useState(false);

  /* One panel open at a time keeps the LCD readable. */
  const [panel, setPanel] = useState<null | "edit" | "filter" | "adjust" | "help">(null);

  const [editCaption, setEditCaption] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [draftFrame, setDraftFrame] = useState<Frame>(DEFAULT_FRAME);
  const [draftFilter, setDraftFilter] = useState("none");

  const [flashing, setFlashing] = useState(false);
  const [glitching, setGlitching] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const lcdRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; ox: number; oy: number } | null>(null);

  /* The base64 media, fetched separately from the row metadata and keyed by
     row id. A missing entry means "not fetched yet", which the LCD renders as
     the loading state rather than as an empty frame. */
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const inflightMediaRef = useRef<Set<string>>(new Set());

  const loadMediaFor = useCallback(
    async (ids: string[]) => {
      const wanted = ids.filter((id) => id && !inflightMediaRef.current.has(id));
      if (wanted.length === 0) return;
      wanted.forEach((id) => inflightMediaRef.current.add(id));

      const { data, error: mediaError } = await supabase
        .from("digicam_media")
        .select("id, url")
        .eq("couple_id", coupleId)
        .in("id", wanted);

      if (mediaError) {
        wanted.forEach((id) => inflightMediaRef.current.delete(id));
        setError(mediaError.message);
        return;
      }

      setMediaUrls((prev) => {
        const next = { ...prev };
        for (const row of data ?? []) next[row.id as string] = row.url as string;
        return next;
      });
    },
    [coupleId, supabase]
  );

  const loadItems = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("digicam_media")
      .select(SELECT_COLUMNS)
      .eq("couple_id", coupleId)
      .order("position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (loadError) {
      setError(loadError.message);
    } else {
      const rows = (data ?? []) as DigicamItem[];
      setItems(rows);
      setCurrentIndex((i) => (rows.length ? Math.min(i, rows.length - 1) : 0));
      /* Anything whose bytes are already held stays cached; a Replace clears
         its own entry so the new media is refetched. */
      inflightMediaRef.current = new Set(
        [...inflightMediaRef.current].filter((id) => rows.some((r) => r.id === id))
      );
    }
    setLoading(false);
  }, [coupleId, supabase]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const currentItem = items[currentIndex];

  /* Fetch the frame on screen first, then its immediate neighbours so paging
     left/right is instant, and only then everything else in the roll. This is
     what turns "wait for 35MB, then see the chapter" into "see the chapter,
     then the current photo, then the rest". */
  useEffect(() => {
    if (items.length === 0) return;
    const near = [currentIndex, currentIndex + 1, currentIndex - 1]
      .filter((i) => i >= 0 && i < items.length)
      .map((i) => items[i].id);
    loadMediaFor(near);

    const rest = items.map((i) => i.id).filter((id) => !near.includes(id));
    if (rest.length === 0) return;
    const timer = window.setTimeout(() => loadMediaFor(rest), 400);
    return () => window.clearTimeout(timer);
  }, [items, currentIndex, loadMediaFor]);

  /** The stored bytes for a row, MIME-corrected, or "" while still loading. */
  const urlOf = useCallback(
    (item: DigicamItem | undefined) => (item ? playableMediaSrc(mediaUrls[item.id]) : ""),
    [mediaUrls]
  );
  const liveFrame = panel === "adjust" ? draftFrame : frameOf(currentItem);
  const liveFilter = panel === "filter" ? draftFilter : currentItem?.filter ?? "none";

  /* Some phone-recorded video (HEVC/.mov from iPhone especially) has no
     decoder on Chrome/Firefox/Windows/Android - the browser's own codec
     support, not something this app controls. <video> fails silently with
     no visible error unless we catch onError ourselves and say so plainly,
     rather than leaving a blank black rectangle where the clip should be. */
  const [videoErrorId, setVideoErrorId] = useState<string | null>(null);

  /* A short RGB split whenever the visible frame or stock changes. It marks the
     state transition, which is the only reason it exists. */
  const pulseGlitch = useCallback(() => {
    setGlitching(true);
    window.setTimeout(() => setGlitching(false), 260);
  }, []);

  const closePanel = useCallback(() => setPanel(null), []);

  const goTo = useCallback(
    (next: number) => {
      setPanel(null);
      setCurrentIndex((i) => {
        const clamped = Math.max(0, Math.min(items.length - 1, next));
        if (clamped !== i) pulseGlitch();
        return clamped;
      });
    },
    [items.length, pulseGlitch]
  );

  /* Deliberately NOT guarded. useGuardedAction exists to stop double-submits on
     network calls; these two only move a local index, and the 160ms cooldown it
     was imposing meant a quick second tap was silently swallowed, which is why
     the arrows felt laggy or dead. Local state changes should be instant. */
  const [slideshowOn, setSlideshowOn] = useState(false);

  const runPrev = useCallback(() => {
    setSlideshowOn(false);
    goTo(currentIndex - 1);
  }, [goTo, currentIndex]);
  const runNext = useCallback(() => {
    setSlideshowOn(false);
    goTo(currentIndex + 1);
  }, [goTo, currentIndex]);

  const shuffle = useCallback(() => {
    if (items.length < 2) return;
    let n = currentIndex;
    while (n === currentIndex) n = Math.floor(Math.random() * items.length);
    goTo(n);
  }, [currentIndex, items.length, goTo]);

  const jumpTo = useCallback(
    (i: number) => {
      setSlideshowOn(false);
      goTo(i);
    },
    [goTo]
  );

  const toggleSlideshow = useCallback(() => {
    setSlideshowOn((v) => !v);
  }, []);

  /* Auto slideshow: picks a new random frame every few seconds while on.
     Reuses shuffle() (which already avoids repeating the current frame)
     rather than a separate "next random" implementation. Any manual
     navigation (prev/next/jump/reorder) turns it off instead of fighting the
     reader's own input. Below two items there's simply nothing to rotate
     between - the toggle button itself is already hidden in that case (see
     its `items.length > 1` guard in FilmStrip below), so this just skips
     starting the interval rather than also flipping the boolean off: if the
     roll grows back to 2+ while still "on", the slideshow silently resumes
     instead of the reader having to press the button again. */
  useEffect(() => {
    if (!slideshowOn || items.length < 2) return;
    const id = window.setInterval(() => shuffle(), 3500);
    return () => window.clearInterval(id);
  }, [slideshowOn, items.length, shuffle]);

  /* ---- drag-to-reorder the contact sheet -------------------------------- */

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  /* Live-reorders local state as the reader drags a thumbnail over another -
     called on every pointermove while dragging, so it's a pure array splice
     with no network call. The currently-viewed frame is tracked by id
     through the move so the LCD doesn't jump to a different photo just
     because its position in the strip changed. */
  const reorderLocally = useCallback(
    (dragId: string, overId: string) => {
      const list = itemsRef.current;
      const from = list.findIndex((i) => i.id === dragId);
      const to = list.findIndex((i) => i.id === overId);
      if (from === -1 || to === -1 || from === to) return;
      const currentId = list[currentIndex]?.id;
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setItems(next);
      if (currentId) {
        const newIdx = next.findIndex((i) => i.id === currentId);
        if (newIdx !== -1 && newIdx !== currentIndex) setCurrentIndex(newIdx);
      }
    },
    [currentIndex]
  );

  /* Persists the order once the drag ends. Renumbers every row's `position`
     to its current index rather than diffing, since a roll is small (a
     handful to a few dozen frames) and this keeps the logic simple and
     always self-consistent even after several drags in a row. */
  const commitReorder = useCallback(async () => {
    const list = itemsRef.current;
    const results = await Promise.all(
      list.map((item, idx) =>
        item.position === idx
          ? Promise.resolve({ error: null })
          : supabase.from("digicam_media").update({ position: idx }).eq("id", item.id).eq("couple_id", coupleId)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) setError(failed.error.message);
  }, [supabase, coupleId]);

  /* ---- filters ---------------------------------------------------------- */

  const openFilters = useCallback(() => {
    if (!currentItem) return;
    setDraftFilter(currentItem.filter ?? "none");
    setPanel((p) => (p === "filter" ? null : "filter"));
  }, [currentItem]);

  const stepFilter = useCallback(
    (dir: 1 | -1) => {
      if (!currentItem) return;
      const base = panel === "filter" ? draftFilter : currentItem.filter ?? "none";
      const at = Math.max(0, FILTERS.findIndex((f) => f.id === base));
      const next = FILTERS[(at + dir + FILTERS.length) % FILTERS.length].id;
      setDraftFilter(next);
      setPanel("filter");
      pulseGlitch();
    },
    [currentItem, panel, draftFilter, pulseGlitch]
  );

  const [runSaveFilter, savingFilter] = useGuardedAction(async () => {
    if (!currentItem) return;
    const { error: e } = await supabase
      .from("digicam_media")
      .update({ filter: draftFilter, updated_at: new Date().toISOString() })
      .eq("id", currentItem.id)
      .eq("couple_id", coupleId);
    if (e) {
      setError(e.message);
      return;
    }
    setPanel(null);
    await loadItems();
  }, 200);

  /* ---- crop, rotate and flip -------------------------------------------- */

  const openAdjust = useCallback(() => {
    if (!currentItem) return;
    setDraftFrame(frameOf(currentItem));
    setPanel((p) => (p === "adjust" ? null : "adjust"));
  }, [currentItem]);

  const onLcdPointerDown = (e: React.PointerEvent) => {
    if (panel !== "adjust") return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      ox: draftFrame.x,
      oy: draftFrame.y,
    };
  };

  const onLcdPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const box = lcdRef.current?.getBoundingClientRect();
    if (!box) return;
    /* Pan in percent of the screen so the framing survives any chassis size. */
    setDraftFrame((f) => ({
      ...f,
      x: Math.max(-60, Math.min(60, d.ox + ((e.clientX - d.x) / box.width) * 100)),
      y: Math.max(-60, Math.min(60, d.oy + ((e.clientY - d.y) / box.height) * 100)),
    }));
  };

  const endLcdDrag = (e: React.PointerEvent) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  };

  const zoomBy = useCallback(
    (delta: number) => {
      if (!currentItem) return;
      if (panel !== "adjust") {
        setDraftFrame(frameOf(currentItem));
        setPanel("adjust");
      }
      setDraftFrame((f) => ({ ...f, scale: Math.max(0.5, Math.min(3, +(f.scale + delta).toFixed(2))) }));
    },
    [currentItem, panel]
  );

  const [runSaveFrame, savingFrame] = useGuardedAction(async () => {
    if (!currentItem) return;
    const { error: e } = await supabase
      .from("digicam_media")
      .update({
        photo_scale: draftFrame.scale,
        photo_x: draftFrame.x,
        photo_y: draftFrame.y,
        photo_rotation: draftFrame.rotation,
        photo_flip_h: draftFrame.flipH,
        photo_flip_v: draftFrame.flipV,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentItem.id)
      .eq("couple_id", coupleId);
    if (e) {
      setError(e.message);
      return;
    }
    setPanel(null);
    await loadItems();
  }, 200);

  /* ---- captions --------------------------------------------------------- */

  const openEdit = useCallback(() => {
    if (!currentItem) return;
    setEditCaption(currentItem.caption ?? "");
    setEditNotes(currentItem.notes ?? "");
    setPanel((p) => (p === "edit" ? null : "edit"));
  }, [currentItem]);

  const [runSaveEdit, savingEdit] = useGuardedAction(async () => {
    if (!currentItem) return;
    const { error: e } = await supabase
      .from("digicam_media")
      .update({
        caption: editCaption.trim(),
        notes: editNotes.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentItem.id)
      .eq("couple_id", coupleId);
    if (e) {
      setError(e.message);
      return;
    }
    setPanel(null);
    await loadItems();
  }, 200);

  /* ---- favourite, upload, delete, save ---------------------------------- */

  const [runFavorite] = useGuardedAction(async () => {
    if (!currentItem) return;
    const next = !(currentItem.is_favorite ?? false);
    setItems((rows) =>
      rows.map((r) => (r.id === currentItem.id ? { ...r, is_favorite: next } : r))
    );
    const { error: e } = await supabase
      .from("digicam_media")
      .update({ is_favorite: next, updated_at: new Date().toISOString() })
      .eq("id", currentItem.id)
      .eq("couple_id", coupleId);
    if (e) {
      setError(e.message);
      await loadItems();
    }
  }, 150);

  /* -------------------------------------------------------- media prep ----
     Everything picked for the roll goes through here before it is stored.
     Photos are downscaled (a 9MB phone photo becomes a few hundred KB, which
     is the difference between this chapter loading instantly and hanging on
     35MB of base64), and clips get their container MIME corrected and are
     re-encoded when they are too heavy.

     The MIME correction is the actual fix for "videos don't play": a clip
     from an iPhone is handed over as `video/quicktime`, which no desktop
     browser will touch even though the bytes inside are ordinary H.264/AAC.
     See src/lib/media/mediaPrep.ts for the evidence. */
  const [prepProgress, setPrepProgress] = useState<{ label: string; pct: number } | null>(null);
  const prepAbortRef = useRef<AbortController | null>(null);

  const cancelPrep = useCallback(() => {
    prepAbortRef.current?.abort();
  }, []);

  const prepareFile = useCallback(
    async (rawFile: File): Promise<{ dataUrl: string; isVideo: boolean } | null> => {
      setError(null);
      setUploadNotice(null);

      /* Some phone browsers hand back a video file with no `file.type` at
         all - the guess-from-extension fallback below is what makes those
         uploads recognisable instead of silently rejected as "not an image
         or video". */
      const file = withGuessedType(rawFile);
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) {
        setError("Only image or video files can go in the digicam roll.");
        return null;
      }

      const pickCap = isVideo ? MAX_VIDEO_PICK_BYTES : MAX_IMAGE_PICK_BYTES;
      if (file.size > pickCap) {
        setError(
          `That ${isVideo ? "clip" : "photo"} is ${formatBytes(file.size)} — too big to even open here. Keep it under ${formatBytes(pickCap)}.`
        );
        return null;
      }

      try {
        if (isImage) {
          setPrepProgress({ label: "Developing…", pct: 0 });
          const prepared = await compressImage(file, {
            maxEdge: 2048,
            targetBytes: MAX_STORED_IMAGE_BYTES,
          });
          if (prepared.bytes > MAX_STORED_IMAGE_BYTES * 3) {
            setError(
              `That photo is still ${formatBytes(prepared.bytes)} after optimising and won't fit on the roll. Try a smaller export.`
            );
            return null;
          }
          if (prepared.note) setUploadNotice(prepared.note);
          return { dataUrl: prepared.dataUrl, isVideo: false };
        }

        /* Small, already-portable clips are stored untouched (apart from the
           MIME label) so a short video isn't needlessly re-encoded. */
        if (file.size <= VIDEO_TRANSCODE_THRESHOLD) {
          setPrepProgress({ label: "Loading clip…", pct: 0 });
          const raw = await readFileAsDataUrl(file);
          const fixed = relabelDataUrl(raw, file.type);
          if (fixed.changed) {
            setUploadNotice(
              "This clip was labelled .mov, which most browsers refuse to open. It's been saved as MP4 so it plays everywhere — the video itself is untouched."
            );
          }
          return { dataUrl: fixed.dataUrl, isVideo: true };
        }

        const controller = new AbortController();
        prepAbortRef.current = controller;
        setPrepProgress({ label: "Re-encoding clip… (runs in real time)", pct: 0 });
        const result = await transcodeVideo(
          file,
          { maxEdge: 1280 },
          (fraction) =>
            setPrepProgress({
              label: "Re-encoding clip… (runs in real time)",
              pct: Math.round(fraction * 100),
            }),
          controller.signal
        );
        prepAbortRef.current = null;

        if (result.failed) {
          setError(result.failed);
          return null;
        }
        if (result.bytes > MAX_STORED_VIDEO_BYTES) {
          setError(
            `That clip is still ${formatBytes(result.bytes)} after re-encoding. Trim it shorter and try again.`
          );
          return null;
        }
        if (result.note) setUploadNotice(result.note);
        return { dataUrl: result.dataUrl, isVideo: true };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read that file.");
        return null;
      } finally {
        prepAbortRef.current = null;
        setPrepProgress(null);
      }
    },
    []
  );

  const [runUpload, uploading] = useGuardedAction(async (file: File) => {
    const prepared = await prepareFile(file);
    if (!prepared) return;
    const { dataUrl, isVideo } = prepared;

    const { error: insertError } = await supabase.from("digicam_media").insert({
      couple_id: coupleId,
      uploader_id: userId,
      url: dataUrl,
      media_type: isVideo ? "video" : "image",
      caption: "",
      notes: "",
      /* Appends to the end of the roll - matches the created_at-ordered
         behaviour this replaced, and stays correct alongside drag reorder
         since positions are re-numbered 0..n-1 after every reorder. */
      position: items.length,
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setFlashing(true);
    window.setTimeout(() => setFlashing(false), 620);
    await loadItems();
    setCurrentIndex(items.length);
    setPanel(null);
  }, 400);

  /* Picking several files at once queues them through the same guarded
     upload one at a time (never in parallel - video re-encoding runs a real
     MediaRecorder, and several running at once would contend for the same
     encoder and make everything slower, not faster). `uploadQueue` is what
     lets the banner say "2 of 5" instead of the picker just going quiet for
     a while, which was the "no indicator" complaint. */
  const [uploadQueue, setUploadQueue] = useState<{ index: number; total: number } | null>(null);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      if (files.length === 1) {
        await runUpload(files[0]);
        return;
      }
      for (let i = 0; i < files.length; i += 1) {
        setUploadQueue({ index: i + 1, total: files.length });
        // eslint-disable-next-line no-await-in-loop -- deliberately sequential, see comment above
        await runUpload(files[i]);
      }
      setUploadQueue(null);
    },
    [runUpload]
  );

  /* Replace swaps the raw media on the CURRENT slot in place - same row id,
     same caption/notes/favourite/filter, so it isn't just a delete+reupload
     that would lose everything else and shuffle its position in the roll.
     Framing (crop/zoom/rotate) resets to default: it was tuned for the old
     photo's composition and a new image is unlikely to match it. */
  const [runReplace, replacing] = useGuardedAction(async (file: File) => {
    if (!currentItem) return;
    const prepared = await prepareFile(file);
    if (!prepared) return;
    const { dataUrl, isVideo } = prepared;

    const { error: updateError } = await supabase
      .from("digicam_media")
      .update({
        url: dataUrl,
        media_type: isVideo ? "video" : "image",
        photo_scale: DEFAULT_FRAME.scale,
        photo_x: DEFAULT_FRAME.x,
        photo_y: DEFAULT_FRAME.y,
        photo_rotation: DEFAULT_FRAME.rotation,
        photo_flip_h: DEFAULT_FRAME.flipH,
        photo_flip_v: DEFAULT_FRAME.flipV,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentItem.id)
      .eq("couple_id", coupleId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    /* Same row id, new bytes - drop the cached media for it (and the stale
       "can't decode" flags) so the next render refetches instead of showing
       the photo that was just replaced. */
    setMediaUrls((prev) => {
      const next = { ...prev };
      delete next[currentItem.id];
      return next;
    });
    inflightMediaRef.current.delete(currentItem.id);
    setVideoErrorId((id) => (id === currentItem.id ? null : id));
    setDraftFrame(DEFAULT_FRAME);
    setFlashing(true);
    window.setTimeout(() => setFlashing(false), 620);
    setPanel(null);
    await loadItems();
  }, 400);

  const openReplacePicker = useCallback(() => replaceInputRef.current?.click(), []);

  const handleReplaceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) runReplace(file);
  };

  const [runDelete, deleting] = useGuardedAction(async () => {
    if (!currentItem) return;
    if (!confirm("Delete this snapshot for good?")) return;

    const { error: deleteError } = await supabase
      .from("digicam_media")
      .delete()
      .eq("id", currentItem.id)
      .eq("couple_id", coupleId);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setPanel(null);
    setCurrentIndex((i) => Math.max(0, i - 1));
    await loadItems();
  }, 300);

  const downloadCurrent = useCallback(() => {
    if (!currentItem) return;
    const href = urlOf(currentItem);
    if (!href) return; // bytes still loading
    const a = document.createElement("a");
    a.href = href;
    a.download = `albiverse-${String(currentIndex + 1).padStart(2, "0")}.${
      currentItem.media_type === "video" ? "mp4" : "jpg"
    }`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [currentItem, currentIndex, urlOf]);

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) uploadFiles(files);
  };

  /* Arrow keys walk the roll the way the D-pad does. Skipped while a text
     field has focus so typing a caption still works. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") runPrev();
      else if (e.key === "ArrowRight") runNext();
      else if (e.key === "ArrowUp") stepFilter(-1);
      else if (e.key === "ArrowDown") stepFilter(1);
      else if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runPrev, runNext, stepFilter, closePanel]);

  const favoriteCount = useMemo(() => items.filter((i) => i.is_favorite).length, [items]);

  const dust = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 7) * 1.6,
        dur: 16 + (i % 5) * 4,
        size: 2 + (i % 3),
      })),
    []
  );

  return (
    <>
      <style>{`
        /* ---- chapter surface -------------------------------------------
           A desk lit by one warm lamp. The pool of warm light sits behind the
           camera and the corners fall away to cool violet and steel, which is
           what gives the red chassis something to separate from. A single warm
           wash behind a red camera just makes red mud. */
        .digicam-desk {
          background-color: #0D0A0F;
          background-image:
            radial-gradient(ellipse 58% 44% at 50% 33%, rgba(186,74,84,0.24), transparent 72%),
            radial-gradient(circle at 4% 2%,  rgba(74,46,90,0.34), transparent 44%),
            radial-gradient(circle at 96% 98%, rgba(38,58,80,0.30), transparent 48%),
            radial-gradient(rgba(242,230,210,0.13) 1.2px, transparent 1.2px),
            repeating-linear-gradient(118deg, rgba(255,255,255,0.020) 0 2px, transparent 2px 8px);
          background-size: auto, auto, auto, 22px 22px, auto;
        }
        .digicam-vignette {
          background: radial-gradient(ellipse at center, transparent 38%, rgba(8,5,10,0.88) 100%);
        }
        /* Corner webbing, drawn with gradients rather than an image so a
           missing asset can never leave a hole in the composition. */
        .digicam-web {
          background-image:
            repeating-conic-gradient(from 0deg at 0% 0%, rgba(242,230,210,0.16) 0deg 0.4deg, transparent 0.4deg 11.25deg),
            repeating-radial-gradient(circle at 0% 0%, transparent 0 26px, rgba(242,230,210,0.14) 26px 27px);
        }

        /* ---- the camera's own buttons -----------------------------------
           Moulded key caps sitting on the chassis. A domed silver face (the
           highlight sits up and left, matching the lamp on the desk behind
           the camera), an ink outline in the same weight as the rest of the
           book, and a hard shadow directly underneath that the cap travels
           down onto when it is pressed. Everything is transform/box-shadow, so
           a press costs one composited frame. */
        .digicam-key {
          display: grid;
          place-items: center;
          border-radius: 9999px;
          background: none;
          border: 0;
          padding: 0;
        }
        .digicam-key-body {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          border-radius: 9999px;
          border: 2px solid #17131A;
          background: radial-gradient(
            circle at 34% 27%,
            #FFFEFA 0%, #F2EAE0 22%, #D5C8BE 52%, #A2948B 80%, #7B6D67 100%
          );
          box-shadow:
            0 3px 0 #17131A,
            0 6px 11px rgba(0,0,0,.55),
            inset 0 1.5px 1px rgba(255,255,255,.95),
            inset 0 -2px 4px rgba(0,0,0,.32);
          transition:
            transform .1s ease,
            box-shadow .1s ease,
            background .18s ease,
            border-color .18s ease;
        }
        .digicam-key-icon {
          display: grid;
          place-items: center;
          width: 100%;
          height: 100%;
          color: #1B1418;
        }
        .digicam-key-icon > svg {
          width: 50%;
          height: 50%;
          stroke-width: 2.6;
        }

        .digicam-key:hover:not(:disabled) .digicam-key-body {
          transform: translateY(-1.5px);
          box-shadow:
            0 4.5px 0 #17131A,
            0 9px 14px rgba(0,0,0,.6),
            0 0 12px rgba(236,168,184,.55),
            inset 0 1.5px 1px rgba(255,255,255,1),
            inset 0 -2px 4px rgba(0,0,0,.3);
        }
        .digicam-key:active:not(:disabled) .digicam-key-body {
          transform: translateY(3px);
          box-shadow:
            0 0 0 #17131A,
            0 1px 3px rgba(0,0,0,.55),
            inset 0 2px 5px rgba(0,0,0,.4);
        }
        .digicam-key:focus-visible { outline: none; }
        .digicam-key:focus-visible .digicam-key-body {
          outline: 3px solid #D9889E;
          outline-offset: 2px;
        }

        /* pressed-and-held: the key stays lit while its panel is open */
        .digicam-key-on .digicam-key-body {
          background: radial-gradient(
            circle at 34% 27%,
            #FFE4EC 0%, #F4B7C7 24%, #D9889E 58%, #A85268 84%, #7D2834 100%
          );
          box-shadow:
            0 3px 0 #4B141F,
            0 6px 11px rgba(0,0,0,.55),
            inset 0 1.5px 1px rgba(255,255,255,.8),
            inset 0 -2px 4px rgba(0,0,0,.3);
        }
        .digicam-key-danger .digicam-key-body {
          background: radial-gradient(
            circle at 34% 27%,
            #F2C4C4 0%, #C46E6E 26%, #8F3340 60%, #5F1B26 86%, #3E121A 100%
          );
          box-shadow:
            0 3px 0 #250A10,
            0 6px 11px rgba(0,0,0,.55),
            inset 0 1.5px 1px rgba(255,255,255,.55),
            inset 0 -2px 4px rgba(0,0,0,.35);
        }
        .digicam-key-danger .digicam-key-icon { color: #FCEDEF; }

        .digicam-tag {
          opacity: 0;
          transform: translateY(-50%) scale(0.9);
          transition: opacity .16s ease, transform .16s ease;
          background: #FAF4EB;
          color: #261D24;
          border: 2px solid #17131A;
          box-shadow: 2px 2px 0 #17131A;
          padding: 1px 7px;
          font-family: 'Space Grotesk', monospace;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .09em;
          text-transform: uppercase;
          border-radius: 2px;
        }
        .digicam-key:hover .digicam-tag,
        .digicam-key:focus-visible .digicam-tag { opacity: 1; transform: translateY(-50%) scale(1); }

        /* ---- LCD ------------------------------------------------------- */
        .digicam-scanlines {
          background: repeating-linear-gradient(
            0deg, rgba(0,0,0,0.20) 0 1px, transparent 1px 3px
          );
        }
        /* Film-stock grain: a tiled fractal-noise SVG blended over the media
           itself (not the LCD chrome), intensity set per-stock via opacity.
           This plus the vignette below is what makes a "film stock" read as
           a film stock rather than an Instagram-style colour filter. */
        .digicam-filmgrain {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          background-size: 180px 180px;
          mix-blend-mode: overlay;
        }
        .digicam-vignette-media {
          background: radial-gradient(ellipse at center, transparent 35%, var(--vig-color, rgba(0,0,0,0.4)) 100%);
        }
        .digicam-lcd-glare {
          background: linear-gradient(118deg, rgba(255,255,255,0.14) 0 18%, transparent 34%);
        }
        @keyframes digicamPowerSweep {
          0%   { transform: translateY(-110%); opacity: .85; }
          100% { transform: translateY(240%);  opacity: 0; }
        }
        .digicam-sweep { animation: digicamPowerSweep .45s ease-out; }

        @keyframes digicamRgbSplit {
          0%   { transform: translate(0,0);      filter: none; }
          28%  { transform: translate(-4px,1px); }
          58%  { transform: translate(3px,-1px); }
          100% { transform: translate(0,0);      filter: none; }
        }
        .digicam-glitch { animation: digicamRgbSplit .26s steps(3, end); }

        @keyframes digicamShutter {
          0%   { opacity: 0; }
          8%   { opacity: 1; }
          100% { opacity: 0; }
        }
        .digicam-flash { animation: digicamShutter .62s ease-out forwards; }

        /* ---- film strip ------------------------------------------------- */
        .film-strip {
          background:
            repeating-linear-gradient(90deg, #17131A 0 8px, transparent 8px 20px) top / 100% 9px repeat-x,
            repeating-linear-gradient(90deg, #17131A 0 8px, transparent 8px 20px) bottom / 100% 9px repeat-x,
            linear-gradient(180deg, #2A2026, #1B1419);
          border: 3px solid #17131A;
          box-shadow: 0 16px 34px rgba(0,0,0,.6), 8px 8px 0 rgba(0,0,0,.4);
          border-radius: 4px;
        }
        .film-strip-rail { scrollbar-width: thin; scrollbar-color: #7D2834 transparent; }
        .film-strip-rail::-webkit-scrollbar { height: 6px; }
        .film-strip-rail::-webkit-scrollbar-thumb { background: #7D2834; border-radius: 99px; }

        .film-frame {
          border: 2px solid #17131A;
          background: #0C090C;
          filter: saturate(.75) brightness(.8);
          transition: filter .18s ease, transform .18s ease, box-shadow .18s ease;
        }
        .film-frame:hover { filter: none; transform: translateY(-3px); }
        .film-frame-current {
          filter: none;
          transform: translateY(-4px);
          box-shadow: 0 0 0 3px #D9889E, 0 10px 18px rgba(0,0,0,.55);
        }
        .film-frame-dragging {
          filter: none;
          transform: scale(1.08) translateY(-6px);
          box-shadow: 0 0 0 3px #ECA8B8, 0 16px 26px rgba(0,0,0,.65);
          z-index: 30;
          opacity: .92;
        }

        /* ---- ambience ---------------------------------------------------- */
        @keyframes digicamDust {
          0%   { transform: translateY(12vh)  translateX(0);    opacity: 0; }
          14%  { opacity: .55; }
          86%  { opacity: .4; }
          100% { transform: translateY(-92vh) translateX(26px); opacity: 0; }
        }
        .digicam-dust { animation: digicamDust linear infinite; }

        @keyframes digicamBurstRing {
          0%   { transform: scale(.3); opacity: 0; }
          40%  { opacity: .8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .animate-digicam-burst-ring { animation: digicamBurstRing 1.8s ease-out infinite; }

        @keyframes digicamPolaroidSwing {
          0%   { transform: rotate(0deg) translateY(-40px); opacity: 0; }
          40%  { opacity: 1; }
          60%  { transform: rotate(10deg) translateY(0); }
          80%  { transform: rotate(-6deg); }
          100% { transform: rotate(2deg); opacity: 1; }
        }
        .animate-digicam-polaroid {
          animation: digicamPolaroidSwing 1.1s cubic-bezier(.34,1.56,.64,1) forwards;
          transform-origin: top center;
        }

        @keyframes digicamParticleFly {
          0%   { transform: translate(0,0) scale(.3) rotate(0deg); opacity: 0; }
          25%  { opacity: 1; }
          100% { transform: translate(var(--fly-x), var(--fly-y)) scale(1.5) rotate(360deg); opacity: 0; }
        }
        .animate-digicam-particle { animation: digicamParticleFly 1.4s cubic-bezier(.16,1,.3,1) forwards; }

        @keyframes digicamFlashPop {
          0%   { transform: scale(.2) rotate(-10deg); opacity: 0; }
          35%  { opacity: 1; }
          70%  { transform: scale(1.6) rotate(8deg); opacity: .95; }
          100% { transform: scale(2.4) rotate(20deg); opacity: 0; }
        }
        .animate-digicam-flash { animation: digicamFlashPop 1.3s cubic-bezier(.16,1,.3,1) forwards; }

        @keyframes digicamPanelIn {
          0%   { transform: translateY(10px) scale(.98); opacity: 0; }
          100% { transform: translateY(0)    scale(1);   opacity: 1; }
        }
        /* The screen-UI layer is pointer-events-none so clicks fall through to
           the media underneath; panels opt back in because they hold inputs. */
        .digicam-panel {
          animation: digicamPanelIn .22s cubic-bezier(.34,1.56,.64,1) forwards;
          pointer-events: auto;
        }

        @media (prefers-reduced-motion: reduce) {
          .digicam-dust,
          .animate-digicam-burst-ring,
          .animate-digicam-polaroid,
          .animate-digicam-particle,
          .animate-digicam-flash,
          .digicam-sweep,
          .digicam-glitch,
          .digicam-flash,
          .digicam-panel { animation: none !important; }
          .digicam-key-body, .film-frame, .digicam-tag { transition: none !important; }
        }
      `}</style>

      <main className="digicam-desk min-h-screen p-4 sm:p-8 flex flex-col items-center relative overflow-hidden select-none">
        {/* Ambience. Fixed and pointer-events-none so it never costs a repaint
            on the scrolling content or swallows a click. */}
        <div className="digicam-vignette fixed inset-0 z-0 pointer-events-none" />
        <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
          {dust.map((d, i) => (
            <span
              key={i}
              className="digicam-dust absolute bottom-0 rounded-full bg-[#ECA8B8]"
              style={{
                left: `${d.left}%`,
                width: d.size,
                height: d.size,
                animationDuration: `${d.dur}s`,
                animationDelay: `${d.delay}s`,
              }}
            />
          ))}
        </div>
        {/* Optional desk photo layered over the CSS surface. Absent by default. */}
        <OptionalAsset
          src="/images/digicam/backdrop.png"
          className="fixed inset-0 w-full h-full object-cover z-0 opacity-35 mix-blend-overlay"
        />
        <div className="digicam-web fixed top-0 left-0 w-64 h-64 z-0 pointer-events-none opacity-55" />
        <div className="digicam-web fixed top-0 right-0 w-64 h-64 z-0 pointer-events-none opacity-45 scale-x-[-1]" />
        <div className="fixed top-8 animate-crawl-h text-xl z-10 pointer-events-none">🕷️</div>
        <div className="fixed animate-crawl-d text-2xl z-10 pointer-events-none">🕷️</div>
        <div className="fixed left-4 animate-crawl-v text-lg z-10 pointer-events-none">🕷️</div>

        {loading ? (
          /* ---------------- loading ---------------- */
          <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/85 backdrop-blur-sm overflow-hidden">
            <div className="absolute w-[550px] h-[550px] sm:w-[850px] sm:h-[850px] rounded-full border-4 border-dashed border-[#D9889E] opacity-70 animate-digicam-burst-ring" />
            <div
              className="absolute w-[350px] h-[350px] sm:w-[550px] sm:h-[550px] rounded-full border-4 border-dotted border-[#ECA8B8]/60 opacity-60 animate-digicam-burst-ring"
              style={{ animationDelay: "0.4s" }}
            />
            <div className="absolute top-0 left-[15%] pointer-events-none animate-hanging-bounce">
              <div className="w-px h-28 bg-[#BD7F89] mx-auto border-l border-dashed border-white/60" />
              <div className="text-4xl -mt-1 text-center">🕷️</div>
            </div>
            <div
              className="absolute top-0 right-[18%] pointer-events-none animate-hanging-bounce"
              style={{ animationDelay: "-1.6s" }}
            >
              <div className="w-px h-36 bg-[#BD7F89] mx-auto border-l border-dashed border-white/60" />
              <div className="text-3xl -mt-1 text-center">🕷️</div>
            </div>
            <div className="absolute left-[10%] top-[22%] polaroid-matte w-24 sm:w-32 animate-digicam-polaroid">
              <div className="w-full aspect-square bg-linear-to-br from-[#7D2834] to-[#2E0509]" />
            </div>
            <div
              className="absolute right-[10%] top-[26%] polaroid-matte w-20 sm:w-28 animate-digicam-polaroid"
              style={{ animationDelay: "0.35s" }}
            >
              <div className="w-full aspect-square bg-linear-to-br from-[#D9889E] to-[#450A10]" />
            </div>
            {[
              { text: "📸", x: "-40vw", y: "-26vh" },
              { text: "⚡", x: "38vw", y: "-24vh" },
              { text: "✨", x: "-34vw", y: "28vh" },
              { text: "🕸️", x: "36vw", y: "24vh" },
              { text: "*SNAP!*", x: "0vw", y: "-38vh" },
              { text: "*FLASH*", x: "-24vw", y: "-10vh" },
              { text: "KA-CHINK!", x: "26vw", y: "12vh" },
              { text: "💫", x: "-20vw", y: "22vh" },
            ].map((p, idx) => (
              <span
                key={idx}
                style={
                  { "--fly-x": p.x, "--fly-y": p.y, animationDelay: `${idx * 0.06}s` } as React.CSSProperties
                }
                className="absolute font-marker text-2xl sm:text-4xl text-[#FAF4EB] drop-shadow-[0_0_14px_#781420] animate-digicam-particle pointer-events-none"
              >
                {p.text}
              </span>
            ))}
            <div className="relative z-10 flex flex-col items-center justify-center animate-comic-pop">
              <div className="bg-[#781420] border-4 border-[#FAF4EB] shadow-[10px_10px_0_#17131A] px-7 py-4 rounded-2xl -rotate-2 flex items-center gap-4">
                <span className="text-4xl animate-digicam-flash">📷</span>
                <div>
                  <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#ECA8B8] block">
                    CH.04 · RETRO DIGICAM
                  </span>
                  <h2 className="font-marker text-3xl sm:text-4xl text-[#FAF4EB] leading-tight">
                    *KA-CHINK!* 🕸️ DEVELOPING FILM...
                  </h2>
                </div>
                <span className="text-4xl animate-spin">🕷️</span>
              </div>
              <span className="font-handwriting text-2xl text-[#ECA8B8] mt-3 font-black drop-shadow-md">
                Web-slinging your snapshots into frame...
              </span>
            </div>
          </div>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <input
              ref={replaceInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={handleReplaceFileChange}
            />

            {/* ---------------- header ---------------- */}
            <header className="w-full max-w-5xl flex items-center justify-between gap-3 mb-6 z-20">
              <button
                onClick={onBack}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#F2E6D2] hover:bg-[#FAF7F2] text-[#261D24] text-xs font-mono font-black border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] -rotate-1 active:translate-y-px transition cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4 text-[#781420]" />
                <span>BACK</span>
              </button>

              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#ECA8B8] bg-[#2E0509] border-2 border-[#17131A] px-3 py-1 shadow-[2px_2px_0_#17131A] rotate-1 whitespace-nowrap">
                  {items.length} {items.length === 1 ? "frame" : "frames"}
                  {favoriteCount > 0 ? ` · ${favoriteCount} ♥` : ""}
                </span>
                {/* The chapter label is the first thing to go when the header
                    gets tight, since the masthead already names the chapter. */}
                <span className="hidden sm:inline font-mono text-[10px] font-black uppercase tracking-widest text-[#ECA8B8] whitespace-nowrap">
                  CH.04 · RETRO DIGICAM
                </span>
              </div>
            </header>

            {error && (
              <div
                role="alert"
                className="w-full max-w-xl mb-4 p-3 bg-[#5A2029] text-[#F2E6D2] text-xs font-mono flex items-center gap-2 border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] z-20"
              >
                <span className="flex-1">{error}</span>
                <button
                  onClick={() => setError(null)}
                  aria-label="Dismiss error"
                  className="cursor-pointer hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {uploadNotice && (
              <div
                role="status"
                className="w-full max-w-xl mb-4 p-3 bg-[#8A6B1E] text-[#FAF4EB] text-xs font-mono flex items-center gap-2 border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] z-20"
              >
                <span className="flex-1">{uploadNotice}</span>
                <button
                  onClick={() => setUploadNotice(null)}
                  aria-label="Dismiss notice"
                  className="cursor-pointer hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {uploadQueue && (
              <div
                role="status"
                className="w-full max-w-xl mb-4 p-3 bg-[#2E0509] text-[#F2E6D2] text-xs font-mono border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] z-20 flex items-center gap-2"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-[#ECA8B8]" />
                <span className="uppercase tracking-wider">
                  Uploading {uploadQueue.index} of {uploadQueue.total}…
                </span>
              </div>
            )}

            {/* Re-encoding a clip runs in real time, so it needs a visible
                progress read-out and a way out - a silent multi-minute freeze
                on a phone reads as a broken app. */}
            {prepProgress && (
              <div
                role="status"
                className="w-full max-w-xl mb-4 p-3 bg-[#2E0509] text-[#F2E6D2] text-xs font-mono border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] z-20"
              >
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-[#ECA8B8]" />
                  <span className="flex-1 uppercase tracking-wider">{prepProgress.label}</span>
                  <span className="tabular-nums text-[#ECA8B8]">{prepProgress.pct}%</span>
                  <button
                    onClick={cancelPrep}
                    className="ml-1 px-2 py-0.5 border border-[#E0B1AE]/50 rounded-sm text-[10px] uppercase tracking-wider hover:bg-[#450A10] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
                <div className="mt-2 h-1.5 bg-[#171B22] border border-[#261D24] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#7D2834] to-[#ECA8B8] transition-all duration-200"
                    style={{ width: `${prepProgress.pct}%` }}
                  />
                </div>
              </div>
            )}

            {/* ---------------- masthead ---------------- */}
            <div className="relative z-20 text-center mb-6 sm:mb-8">
              <h1 className="font-marker text-4xl sm:text-6xl text-[#F2E6D2] leading-[1.1] drop-shadow-[3px_4px_0_#781420]">
                The Digicam Roll
              </h1>
              <p className="font-handwriting text-xl sm:text-2xl text-[#ECA8B8] leading-relaxed pb-1 -rotate-1">
                every frame we bothered to keep
              </p>
            </div>

            {/* ---------------- the camera, taped into the scrapbook ---------------- */}
            <div className="relative w-full max-w-4xl z-20">
              {/* The cream page is what makes the camera read as pasted into the
                  book rather than floating on a dark screen. */}
              <div className="paper-sheet-solid relative px-4 py-8 sm:px-12 sm:py-12">
                <div className="absolute -top-3 left-10 tape-pink-solid w-24 h-6 -rotate-6 z-30 pointer-events-none" />
                <div className="absolute -top-3 right-16 tape-gold-solid w-20 h-6 rotate-5 z-30 pointer-events-none" />
                <div className="absolute -bottom-3 left-20 tape-gold-solid w-20 h-5 rotate-3 z-30 pointer-events-none" />
                <div className="absolute -bottom-3 right-12 tape-pink-solid w-24 h-5 -rotate-4 z-30 pointer-events-none" />

                <span className="postage-stamp absolute top-3 left-4 -rotate-6 z-20 pointer-events-none hidden sm:inline-block">
                  CH.04
                </span>
                <div className="wax-seal-solid absolute bottom-4 right-5 w-11 h-11 rotate-12 z-20 pointer-events-none hidden sm:grid place-items-center">
                  <span className="font-marker text-sm text-[#F2E6D2]">65</span>
                </div>

                {/* handwritten margin notes, the way a real page gets annotated */}
                <p className="hidden xl:block absolute left-3 top-1/3 -rotate-90 origin-left font-handwriting text-lg text-[#7D2834]/80 pointer-events-none whitespace-nowrap">
                  roll no. 04
                </p>
                <p className="hidden lg:block absolute right-6 top-6 font-handwriting text-lg text-[#7D2834]/75 rotate-3 pointer-events-none">
                  press the buttons ↓
                </p>

                <div
                  className="relative w-full max-w-3xl mx-auto"
                  style={{ aspectRatio: CHASSIS_RATIO }}
                >
                {/* ---- SCREEN WELL ----
                    Sits BEHIND the chassis art (z-0 vs z-10) and fills the
                    transparent hole in the PNG exactly, so the camera's own
                    bezel overlaps the media edges and the photo reads as being
                    inside the camera rather than pasted over it. */}
                <div
                  ref={lcdRef}
                  onPointerDown={onLcdPointerDown}
                  onPointerMove={onLcdPointerMove}
                  onPointerUp={endLcdDrag}
                  onPointerCancel={endLcdDrag}
                  className={`absolute z-0 overflow-hidden bg-[#0B0A0C] ${
                    panel === "adjust" ? "cursor-grab active:cursor-grabbing touch-none" : ""
                  }`}
                  style={{
                    left: `${CAM.lcd.left}%`,
                    top: `${CAM.lcd.top}%`,
                    right: `${CAM.lcd.right}%`,
                    bottom: `${CAM.lcd.bottom}%`,
                  }}
                >
                  {currentItem ? (
                    <>
                      <div
                        key={currentItem.id}
                        className={`absolute inset-0 ${glitching ? "digicam-glitch" : ""}`}
                      >
                        {!urlOf(currentItem) ? (
                          /* Metadata arrived, the frame's bytes have not yet.
                             A real camera says "loading" on its screen rather
                             than showing an empty slot, and an <img src=""> is
                             worse than useless - browsers treat it as a request
                             for the page itself. */
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#131417]">
                            <Loader2 className="w-5 h-5 animate-spin text-[#ECA8B8]" />
                            <p className="font-mono text-[8px] text-[#8faeaa] uppercase tracking-[0.2em]">
                              Reading frame…
                            </p>
                          </div>
                        ) : currentItem.media_type === "video" ? (
                          videoErrorId === currentItem.id ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 bg-[#131417]">
                              <span className="text-2xl">🎞️</span>
                              <p className="font-mono text-[9px] text-[#ECA8B8] uppercase tracking-wide leading-relaxed max-w-[28ch]">
                                This browser can&apos;t decode this clip
                              </p>
                              <p className="font-mono text-[8px] text-[#8faeaa] leading-relaxed max-w-[32ch]">
                                Rare now that .mov clips are relabelled on the way in — this one is
                                most likely HEVC, which Windows browsers have no decoder for. Use
                                Replace and upload it again from the phone that recorded it: it will be
                                re-encoded to MP4 on the way through.
                              </p>
                            </div>
                          ) : (
                            <video
                              key={currentItem.id}
                              src={urlOf(currentItem)}
                              controls={panel !== "adjust"}
                              playsInline
                              onError={() => setVideoErrorId(currentItem.id)}
                              className="absolute inset-0 w-full h-full object-contain"
                              style={{
                                filter: filterCss(liveFilter),
                                transform: frameTransform(liveFrame),
                              }}
                            />
                          )
                        ) : (
                          <img
                            src={urlOf(currentItem)}
                            alt={currentItem.caption || "Digicam snapshot"}
                            draggable={false}
                            className="absolute inset-0 w-full h-full object-contain"
                            style={{
                              filter: filterCss(liveFilter),
                              transform: frameTransform(liveFrame),
                            }}
                          />
                        )}
                      </div>

                      {/* Film-stock look: grain + vignette + colour tint,
                          layered over the media itself so a "stock" reads as
                          film rather than a plain CSS filter() tweak. */}
                      {videoErrorId !== currentItem.id && (
                        <div className="absolute inset-0 pointer-events-none" key={`stock-${currentItem.id}`}>
                          <div
                            className="digicam-filmgrain absolute inset-0"
                            style={{ opacity: filterMeta(liveFilter).grain }}
                          />
                          <div
                            className="digicam-vignette-media absolute inset-0"
                            style={
                              {
                                "--vig-color": `rgba(0,0,0,${filterMeta(liveFilter).vignette})`,
                              } as React.CSSProperties
                            }
                          />
                          {filterMeta(liveFilter).tint && (
                            <div
                              className="absolute inset-0"
                              style={{ background: filterMeta(liveFilter).tint!, mixBlendMode: "soft-light" }}
                            />
                          )}
                        </div>
                      )}

                      <div key={`sweep-${currentItem.id}`} className="absolute inset-0 pointer-events-none">
                        <div className="digicam-sweep absolute inset-x-0 h-1/3 bg-linear-to-b from-transparent via-[#ECA8B8]/25 to-transparent" />
                      </div>
                    </>
                  ) : (
                    /* empty state: says what the roll is and how to fill it */
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 bg-[#131417]">
                      <span className="text-3xl">📷</span>
                      <p className="font-marker text-lg text-[#ECA8B8] leading-tight">
                        The roll is empty
                      </p>
                      <p className="font-mono text-[9px] text-[#8faeaa] uppercase tracking-wide leading-relaxed max-w-[26ch]">
                        Press the index button on the camera to load your first frame
                      </p>
                      <button
                        onClick={openFilePicker}
                        disabled={uploading}
                        className="mt-1 inline-flex items-center gap-1.5 font-mono text-[9px] font-black uppercase tracking-widest bg-[#781420] text-[#FAF4EB] border-2 border-[#FAF4EB]/70 px-3 py-1.5 hover:bg-[#8f1a28] active:translate-y-px transition cursor-pointer disabled:opacity-50"
                      >
                        {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" strokeWidth={3} />}
                        Load film
                      </button>
                    </div>
                  )}

                  {/* screen furniture */}
                  <div className="digicam-scanlines absolute inset-0 pointer-events-none opacity-45" />
                  <div className="digicam-lcd-glare absolute inset-0 pointer-events-none" />

                </div>

                {/* ---- CHASSIS ----
                    Painted OVER the screen well. Its transparent screen hole is
                    what the media shows through, and pointer-events-none lets
                    every click reach the well and the controls underneath. */}
                {!chassisBroken ? (
                  <img
                    src="/images/digicam-landscape.webp"
                    alt="Retro digicam"
                    onError={() => setChassisBroken(true)}
                    className="absolute inset-0 z-10 w-full h-full object-contain pointer-events-none drop-shadow-[0_24px_40px_rgba(0,0,0,.6)]"
                    draggable={false}
                    decoding="async"
                  />
                ) : (
                  <div className="absolute inset-0 z-10 rounded-2xl border-4 border-[#17131A] shadow-[0_24px_40px_rgba(0,0,0,.6)] pointer-events-none" />
                )}

                {/* ---- SCREEN UI ----
                    Sits ABOVE the chassis, clipped to the same screen rect.
                    The media has to live UNDER the chassis so the bezel laps
                    over its edges, but that art has stickers baked into it
                    which were covering the caption and badges, so anything the
                    reader actually needs to read is layered back on top. */}
                <div
                  className="absolute z-20 overflow-hidden pointer-events-none"
                  style={{
                    left: `${CAM.lcd.left}%`,
                    top: `${CAM.lcd.top}%`,
                    right: `${CAM.lcd.right}%`,
                    bottom: `${CAM.lcd.bottom}%`,
                  }}
                >
                  {currentItem && (
                    <>
                      <span className="absolute top-1.5 left-2 font-mono text-[9px] font-black text-[#c9f2c0] bg-black/55 px-1.5 py-0.5 pointer-events-none">
                        {new Date(currentItem.created_at).toLocaleDateString()}
                      </span>
                      <span className="absolute top-1.5 right-2 font-mono text-[9px] font-black text-[#c9f2c0] bg-black/55 px-1.5 py-0.5 pointer-events-none">
                        {String(currentIndex + 1).padStart(2, "0")}/{String(items.length).padStart(2, "0")}
                      </span>
                      {(currentItem.filter ?? "none") !== "none" && panel !== "filter" && (
                        <span className="absolute bottom-1.5 right-2 font-mono text-[9px] font-black text-[#ECA8B8] bg-black/55 px-1.5 py-0.5 pointer-events-none">
                          {filterLabel(currentItem.filter)}
                        </span>
                      )}
                      {currentItem.is_favorite && (
                        <Heart className="absolute bottom-1.5 left-2 w-3.5 h-3.5 fill-[#D9889E] text-[#17131A] pointer-events-none" />
                      )}
                    </>
                  )}

                  {/* Every panel that used to live here (caption editor, film
                      stock picker, crop/adjust, control map) covered the
                      photo itself, which Nini flagged directly: "nothing
                      should be covering the screen of the digicam." They now
                      render in <PanelDrawer> below the whole camera instead -
                      see where CamButton controls end for that block. */}

                  {flashing && (
                    <div className="digicam-flash absolute inset-0 bg-white pointer-events-none z-30" />
                  )}
                </div>

                {/* ---- the controls, sitting on the camera itself ----
                    Every action in the chapter is one of these caps. There is
                    no separate toolbar underneath: the camera IS the control
                    surface, so each key has to carry its own icon and read as
                    something you can push. */}
                <CamButton
                  spot={CAM.buttons.zoomOut}
                  label="Zoom out"
                  onClick={() => zoomBy(-0.1)}
                  disabled={!currentItem}
                  tagSide="left"
                >
                  <ZoomOut />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.zoomIn}
                  label="Zoom in"
                  onClick={() => zoomBy(0.1)}
                  disabled={!currentItem}
                  tagSide="right"
                >
                  <ZoomIn />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.upload}
                  label="Load film"
                  onClick={openFilePicker}
                  busy={uploading}
                  tagSide="left"
                >
                  <Plus />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.adjust}
                  label="Crop and flip"
                  onClick={openAdjust}
                  disabled={!currentItem}
                  active={panel === "adjust"}
                  tagSide="left"
                >
                  <Crop />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.help}
                  label="Control map"
                  onClick={() => setPanel((p) => (p === "help" ? null : "help"))}
                  active={panel === "help"}
                  tagSide="right"
                >
                  <HelpCircle />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.shuffle}
                  label="Random frame"
                  onClick={shuffle}
                  disabled={items.length < 2}
                  tagSide="left"
                >
                  <Shuffle />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.film}
                  label="Film stock"
                  onClick={openFilters}
                  disabled={!currentItem}
                  active={panel === "filter"}
                  tagSide="left"
                >
                  <SlidersHorizontal />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.menu}
                  label="Caption"
                  onClick={openEdit}
                  disabled={!currentItem}
                  active={panel === "edit"}
                  tagSide="left"
                >
                  <Pencil />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.dUp}
                  label="Filter up"
                  onClick={() => stepFilter(-1)}
                  disabled={!currentItem}
                  tagSide="left"
                >
                  <ChevronUp />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.dLeft}
                  label="Previous"
                  onClick={() => runPrev()}
                  disabled={currentIndex <= 0}
                  tagSide="left"
                >
                  <ChevronLeft />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.dRight}
                  label="Next"
                  onClick={() => runNext()}
                  disabled={currentIndex >= items.length - 1}
                  tagSide="right"
                >
                  <ChevronRight />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.dDown}
                  label="Filter down"
                  onClick={() => stepFilter(1)}
                  disabled={!currentItem}
                  tagSide="left"
                >
                  <ChevronDown />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.ok}
                  label={currentItem?.is_favorite ? "Unfavourite" : "Favourite"}
                  onClick={() => runFavorite()}
                  disabled={!currentItem}
                  active={!!currentItem?.is_favorite}
                  tagSide="right"
                >
                  <Heart />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.trash}
                  label="Delete"
                  onClick={() => runDelete()}
                  disabled={!currentItem}
                  busy={deleting}
                  tone="danger"
                  tagSide="left"
                >
                  <Trash2 />
                </CamButton>
                <CamButton
                  spot={CAM.buttons.save}
                  label="Save frame"
                  onClick={downloadCurrent}
                  disabled={!currentItem}
                  tagSide="right"
                >
                  <Download />
                </CamButton>
                </div>
              </div>

              {/* ---- PANEL DRAWER ----
                  Everything that used to sit on top of the LCD (caption
                  editor, film stock picker, crop/adjust, control map) lives
                  here instead, below the whole camera, in normal document
                  flow - it can never cover the photo, on any screen size. */}
              {currentItem && !panel && (currentItem.caption || currentItem.notes) && (
                <div className="digicam-panel mt-4 sm:mt-6 bg-[#17131A] border-2 border-[#8faeaa]/40 rounded-lg px-3 py-2.5 max-w-3xl mx-auto">
                  {currentItem.caption && (
                    <p className="font-mono text-[10px] uppercase tracking-widest text-[#ECA8B8] truncate">
                      {currentItem.caption}
                    </p>
                  )}
                  {currentItem.notes && (
                    <p className="font-handwriting text-base text-[#F2E6D2]/90 leading-tight mt-0.5">
                      {currentItem.notes}
                    </p>
                  )}
                </div>
              )}

              {currentItem && panel === "edit" && (
                <div className="digicam-panel mt-4 sm:mt-6 bg-[#17131A] border-2 border-[#8faeaa]/40 rounded-lg p-3 sm:p-4 max-w-3xl mx-auto flex flex-col gap-2">
                  <label className="font-mono text-[9px] font-black uppercase tracking-widest text-[#ECA8B8]">
                    Caption
                  </label>
                  <input
                    value={editCaption}
                    onChange={(e) => setEditCaption(e.target.value)}
                    maxLength={120}
                    autoFocus
                    className="w-full bg-black/50 border border-[#8faeaa]/60 px-2 py-1.5 font-mono text-xs text-[#F2E6D2] outline-none focus:border-[#ECA8B8] rounded"
                  />
                  <label className="font-mono text-[9px] font-black uppercase tracking-widest text-[#ECA8B8]">
                    Notes
                  </label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={2}
                    maxLength={500}
                    className="w-full bg-black/50 border border-[#8faeaa]/60 px-2 py-1.5 font-mono text-xs text-[#F2E6D2] outline-none resize-none focus:border-[#ECA8B8] rounded"
                  />
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      disabled={replacing}
                      onClick={openReplacePicker}
                      title="Swap this slot's photo or clip for a different file"
                      className="inline-flex items-center gap-1.5 font-mono text-[10px] font-black uppercase text-[#8faeaa] hover:text-[#ECA8B8] px-2 py-1 border border-[#8faeaa]/60 hover:border-[#ECA8B8] disabled:opacity-50 cursor-pointer rounded"
                    >
                      {replacing ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      Replace
                    </button>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={closePanel}
                        className="font-mono text-[10px] font-black uppercase text-[#ECA8B8]/90 hover:text-[#ECA8B8] px-2 py-1 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={savingEdit}
                        onClick={() => runSaveEdit()}
                        className="inline-flex items-center gap-1.5 font-mono text-[10px] font-black uppercase bg-[#781420] text-[#F2E6D2] px-3 py-1.5 border border-[#FAF4EB]/50 hover:bg-[#8f1a28] active:translate-y-px disabled:opacity-50 cursor-pointer rounded"
                      >
                        {savingEdit ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Save className="w-3 h-3" />
                        )}
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {currentItem && panel === "filter" && (
                <div className="digicam-panel mt-4 sm:mt-6 bg-[#17131A] border-2 border-[#8faeaa]/40 rounded-lg p-3 sm:p-4 max-w-3xl mx-auto">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[9px] font-black uppercase tracking-widest text-[#ECA8B8]">
                      Film stock
                    </span>
                    <span className="font-mono text-[9px] font-black uppercase text-[#F2E6D2]">
                      {filterLabel(draftFilter)}
                    </span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1.5">
                    {FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          setDraftFilter(f.id);
                          pulseGlitch();
                        }}
                        aria-label={f.label}
                        aria-pressed={draftFilter === f.id}
                        title={f.label}
                        className={`shrink-0 w-8 h-8 rounded-full border-2 cursor-pointer transition
                          ${draftFilter === f.id
                            ? "border-[#ECA8B8] scale-110 shadow-[0_0_10px_rgba(236,168,184,.8)]"
                            : "border-[#17131A] hover:border-[#FAF4EB]"}`}
                        style={{ background: f.chip }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={closePanel}
                      className="font-mono text-[10px] font-black uppercase text-[#ECA8B8]/90 hover:text-[#ECA8B8] px-2 py-1 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={savingFilter}
                      onClick={() => runSaveFilter()}
                      className="inline-flex items-center gap-1.5 font-mono text-[10px] font-black uppercase bg-[#781420] text-[#F2E6D2] px-3 py-1.5 border border-[#FAF4EB]/50 hover:bg-[#8f1a28] active:translate-y-px disabled:opacity-50 cursor-pointer rounded"
                    >
                      {savingFilter ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Check className="w-3 h-3" />
                      )}
                      Apply
                    </button>
                  </div>
                </div>
              )}

              {currentItem && panel === "adjust" && (
                <div className="digicam-panel mt-4 sm:mt-6 bg-[#17131A] border-2 border-[#8faeaa]/40 rounded-lg p-3 sm:p-4 max-w-3xl mx-auto">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[9px] font-black uppercase tracking-widest text-[#ECA8B8]">
                      Drag the photo to crop
                    </span>
                    <span className="font-mono text-[9px] font-black text-[#F2E6D2]">
                      {Math.round(draftFrame.scale * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.01}
                    value={draftFrame.scale}
                    aria-label="Zoom"
                    onChange={(e) =>
                      setDraftFrame((f) => ({ ...f, scale: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-[#D9889E] cursor-pointer"
                  />
                  <div className="flex items-center justify-between gap-1 pt-2">
                    <div className="flex gap-1.5">
                      {[
                        {
                          key: "rot",
                          icon: <RotateCw className="w-3.5 h-3.5" />,
                          label: "Rotate 90 degrees",
                          on: draftFrame.rotation % 360 !== 0,
                          act: () =>
                            setDraftFrame((f) => ({ ...f, rotation: (f.rotation + 90) % 360 })),
                        },
                        {
                          key: "fh",
                          icon: <FlipHorizontal2 className="w-3.5 h-3.5" />,
                          label: "Flip horizontally",
                          on: draftFrame.flipH,
                          act: () => setDraftFrame((f) => ({ ...f, flipH: !f.flipH })),
                        },
                        {
                          key: "fv",
                          icon: <FlipVertical2 className="w-3.5 h-3.5" />,
                          label: "Flip vertically",
                          on: draftFrame.flipV,
                          act: () => setDraftFrame((f) => ({ ...f, flipV: !f.flipV })),
                        },
                        {
                          key: "reset",
                          icon: <span className="font-mono text-[10px] font-black">RESET</span>,
                          label: "Reset framing",
                          on: false,
                          act: () => setDraftFrame(DEFAULT_FRAME),
                        },
                      ].map((b) => (
                        <button
                          key={b.key}
                          type="button"
                          onClick={b.act}
                          aria-label={b.label}
                          aria-pressed={b.on}
                          title={b.label}
                          className={`inline-flex items-center justify-center h-8 px-2 border cursor-pointer transition active:translate-y-px rounded
                            ${b.on
                              ? "bg-[#D9889E] text-[#17131A] border-[#17131A]"
                              : "bg-black/50 text-[#F2E6D2] border-[#8faeaa]/60 hover:border-[#ECA8B8]"}`}
                        >
                          {b.icon}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={closePanel}
                        className="font-mono text-[10px] font-black uppercase text-[#ECA8B8]/90 hover:text-[#ECA8B8] px-2 py-1 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={savingFrame}
                        onClick={() => runSaveFrame()}
                        className="inline-flex items-center gap-1.5 font-mono text-[10px] font-black uppercase bg-[#781420] text-[#F2E6D2] px-3 py-1.5 border border-[#FAF4EB]/50 hover:bg-[#8f1a28] active:translate-y-px disabled:opacity-50 cursor-pointer rounded"
                      >
                        {savingFrame ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                        Keep crop
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {panel === "help" && (
                <div className="digicam-panel mt-4 sm:mt-6 bg-[#17131A] border-2 border-[#8faeaa]/40 rounded-lg p-3 sm:p-4 max-w-3xl mx-auto max-h-[60vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="font-marker text-lg text-[#ECA8B8]">Control map</span>
                    <button
                      type="button"
                      onClick={closePanel}
                      aria-label="Close control map"
                      className="text-[#ECA8B8] hover:text-white cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[10px] text-[#F2E6D2]">
                    {[
                      ["D-pad left / right", "Previous and next frame"],
                      ["D-pad up / down", "Cycle film stock"],
                      ["Heart (centre)", "Favourite this frame"],
                      ["Pencil (MENU)", "Caption, notes, and replace"],
                      ["Plus (top left)", "Load a new frame"],
                      ["Replace (in MENU)", "Swap this frame's photo/clip"],
                      ["Crop", "Crop, rotate, flip"],
                      ["Sliders", "Open the film stock picker"],
                      ["W / T rocker", "Zoom the crop out and in"],
                      ["Shuffle", "Jump to a random frame"],
                      ["Bin", "Delete this frame"],
                      ["Download", "Save this frame to your device"],
                      ["Question mark", "This map"],
                      ["Arrow keys", "Same as the D-pad"],
                      ["Esc", "Close any panel"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex flex-col leading-tight py-0.5">
                        <dt className="font-black uppercase tracking-wide text-[#ECA8B8]">{k}</dt>
                        <dd className="text-[#F2E6D2]/85">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {/* Desk furniture beside the page. Only from xl up, where the
                  margin is genuinely wide enough that it cannot crowd the
                  camera or force the page narrower. */}
              <div className="hidden xl:block absolute -left-36 top-10 -rotate-6 pointer-events-none">
                <div className="polaroid-matte w-28 shadow-[6px_8px_0_rgba(0,0,0,.45)]">
                  <div className="w-full aspect-square bg-linear-to-br from-[#7D2834] via-[#450A10] to-[#2E0509]" />
                  <p className="font-handwriting text-base text-[#261D24] text-center pt-1 leading-relaxed">
                    us, mostly
                  </p>
                </div>
                <div className="absolute -top-2 left-7 tape-gold-solid w-16 h-5 -rotate-12" />
              </div>

              <div className="hidden xl:block absolute -right-36 bottom-20 rotate-6 pointer-events-none">
                <div className="bg-[#EAD9A9] border-[3px] border-[#261D24] shadow-[5px_6px_0_#17131A] px-3 py-2 w-28 text-center">
                  <p className="font-mono text-[8px] font-black uppercase tracking-widest text-[#781420]">
                    Film 400
                  </p>
                  <p className="font-handwriting text-lg leading-relaxed pb-0.5 text-[#261D24]">
                    keep every frame
                  </p>
                </div>
                <div className="absolute -top-2 right-5 tape-pink-solid w-14 h-5 rotate-12" />
              </div>

              {/* Comic bursts, same language as the login screen so the chapter
                  reads as the same book. */}
              <div className="hidden lg:block absolute -left-10 bottom-24 -rotate-12 pointer-events-none z-30">
                <div className="bg-[#facc15] text-zinc-950 border-[3px] border-[#17131A] px-3 py-1.5 rounded-lg shadow-[4px_4px_0_#17131A]">
                  <span className="font-black text-lg tracking-tighter italic leading-[1.15] pb-0.5 inline-block">
                    *KA-CHINK!*
                  </span>
                </div>
              </div>
              <div className="hidden lg:block absolute -right-8 top-16 rotate-12 pointer-events-none z-30">
                <div className="bg-[#b91c1c] text-amber-100 border-[3px] border-[#17131A] px-3 py-1.5 rounded-lg shadow-[4px_4px_0_#17131A]">
                  <span className="font-black text-lg tracking-tighter italic">FLASH!</span>
                </div>
              </div>

              {/* Free sticker slots. Empty until you drop art in; see
                  public/images/digicam/README.md */}
              <OptionalAsset
                src="/images/digicam/sticker-a.png"
                className="hidden md:block absolute -top-8 left-6 w-24 -rotate-12 z-30 drop-shadow-[3px_5px_6px_rgba(0,0,0,.55)]"
              />
              <OptionalAsset
                src="/images/digicam/sticker-b.png"
                className="hidden md:block absolute -bottom-10 right-10 w-28 rotate-6 z-30 drop-shadow-[3px_5px_6px_rgba(0,0,0,.55)]"
              />
              <OptionalAsset
                src="/images/digicam/sticker-c.png"
                className="hidden lg:block absolute top-1/2 -right-16 w-20 -rotate-6 z-30 drop-shadow-[3px_5px_6px_rgba(0,0,0,.55)]"
              />
            </div>

            <FilmStrip
              items={items}
              currentIndex={currentIndex}
              onJump={jumpTo}
              urlOf={urlOf}
              onReorder={reorderLocally}
              onReorderCommit={commitReorder}
              slideshowOn={slideshowOn}
              onToggleSlideshow={toggleSlideshow}
            />

            <footer className="max-w-md mx-auto text-center z-20 mt-10 mb-4">
              <span className="font-mono text-[10px] font-black text-[#261D24] uppercase tracking-widest bg-[#EAD9A9] px-4 py-1 border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] inline-block -rotate-1">
                EARTH-65 × EARTH-616 · RETRO DIGICAM ROLL
              </span>
            </footer>
          </>
        )}
      </main>
    </>
  );
}
