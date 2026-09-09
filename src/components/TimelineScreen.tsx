"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { blobKey, dropBlob, readBlobs, writeBlobs } from "@/lib/media/blobCache";
import { compressImage } from "@/lib/media/mediaPrep";
import SpideyBackground from "./SpideyBackground";
import { 
  ArrowLeft, 
  Plus, 
  Trash2, 
  Edit3, 
  Loader2, 
  AlertCircle, 
  Sparkles, 
  X, 
  Check, 
  Heart, 
  Camera, 
  RotateCw, 
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  Move,
  FlipHorizontal,
  FlipVertical
} from "lucide-react";

export interface PolaroidMemory {
  id: string;
  url: string;
  caption: string;
  date: string;
  /* Raw ISO (YYYY-MM-DD) backing the editable date input - `date` above stays
     the pretty display string so the card rendering never has to reformat. */
  rawDate: string;
  notes?: string;
  photo_scale?: number;
  photo_x?: number;
  photo_y?: number;
  photo_rotation?: number;
  photo_flip_h?: boolean;
  photo_flip_v?: boolean;
  /* Not rendered - the blob cache's version stamp for this row's photo. */
  updatedAt?: string;
}

/* PERFORMANCE: `url` is deliberately NOT in this list. It holds the whole
   photo as a base64 data URL (no Storage bucket exists - see CLAUDE.md), and
   on this account that averages ~3MB per polaroid. Selecting it here meant
   nothing at all could be drawn until every photo in the gallery had come
   down the wire. The metadata below is a couple of KB for the whole timeline
   and arrives effectively instantly; the photo bytes are then fetched
   separately by `loadPhotos()` so the polaroids develop into their frames.

   This is the same two-stage load Ch.04 Digicam already uses. */
const MEMORY_SELECT_COLUMNS =
  "id, caption, notes, memory_date, created_at, updated_at, photo_scale, photo_x, photo_y, photo_rotation, photo_flip_h, photo_flip_v";

/* How many photos to pull in the first burst. The rest follow immediately
   after, so a long timeline still fills in without one giant request. */
const PHOTO_BATCH = 3;

function normalizeMemory(item: any): PolaroidMemory {
  const rawDate: string = item.memory_date || (item.created_at ? new Date(item.created_at).toISOString().slice(0, 10) : "");
  return {
    id: item.id,
    /* Empty when the row came from the metadata-only select. Realtime
       payloads DO carry the full row, so those arrive with bytes attached
       and get harvested into `photoUrls` below. */
    url: item.file_url || item.url || "",
    caption: item.caption || "Multiverse Memory",
    date: rawDate
      ? new Date(`${rawDate}T00:00:00`).toLocaleDateString([], {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "CANON",
    rawDate,
    notes: item.notes || "",
    photo_scale: item.photo_scale ?? 1.0,
    photo_x: item.photo_x ?? 0,
    photo_y: item.photo_y ?? 0,
    photo_rotation: item.photo_rotation ?? 0,
    photo_flip_h: item.photo_flip_h ?? false,
    photo_flip_v: item.photo_flip_v ?? false,
    updatedAt: item.updated_at ?? item.created_at ?? "v0",
  };
}

interface TimelineScreenProps {
  userId: string;
  coupleId: string;
  initialMemories?: PolaroidMemory[];
  /* See ClockScreen: the spread the reader opened this chapter from. */
  backHref?: string;
}

export default function TimelineScreen({
  userId,
  coupleId,
  initialMemories = [],
  backHref = "/?opened=true&spread=1",
}: TimelineScreenProps) {
  const [memories, setMemories] = useState<PolaroidMemory[]>(initialMemories);
  const [loading, setLoading] = useState(initialMemories.length === 0);
  const [error, setError] = useState<string | null>(null);

  /* Photo bytes, keyed by row id, filled in after the metadata lands. Kept
     out of `memories` so a photo arriving never re-sorts or re-renders the
     whole timeline structure. */
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formImagePreview, setFormImagePreview] = useState<string>("");
  const [formCaption, setFormCaption] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formDate, setFormDate] = useState("");
  const [saving, setSaving] = useState(false);
  /* Canvas downscale runs off the main data path; block submit while it does
     so a photo can't be saved half-prepared. */
  const [preparingPhoto, setPreparingPhoto] = useState(false);

  // Photo Transformation Controls
  const [photoScale, setPhotoScale] = useState<number>(1.0);
  const [photoX, setPhotoX] = useState<number>(0);
  const [photoY, setPhotoY] = useState<number>(0);
  const [photoRotation, setPhotoRotation] = useState<number>(0);
  const [photoFlipH, setPhotoFlipH] = useState<boolean>(false);
  const [photoFlipV, setPhotoFlipV] = useState<boolean>(false);

  // Drag-to-pan handlers
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const dragStartPos = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({});

  const supabase = createClient();

  /* The entry overlay used to sit for a flat 1100ms no matter how fast the
     data arrived, so it was pure added latency on top of the load. Now it is
     a floor, not a duration: it clears as soon as the metadata is in, and the
     floor only exists so the animation doesn't flash on a warm cache.

     Derived, not stored - whether the overlay shows is entirely a function of
     these two, so keeping a third piece of state in sync with an effect would
     only add a render and a way to be wrong. */
  const [entryFloorPassed, setEntryFloorPassed] = useState(false);
  const isSpideyLoading = !entryFloorPassed || loading;

  useEffect(() => {
    const timer = setTimeout(() => setEntryFloorPassed(true), 420);
    return () => clearTimeout(timer);
  }, []);

  const sortByDate = (list: PolaroidMemory[]) =>
    [...list].sort((a, b) => a.rawDate.localeCompare(b.rawDate));

  /* Pull the actual photo bytes for a set of rows and merge them in. Split
     into batches so the first few polaroids can develop while the rest are
     still in flight, rather than the whole gallery landing at once. */
  const loadPhotos = async (ids: string[], versions: Map<string, string>) => {
    if (ids.length === 0) return;
    try {
      /* EGRESS: these blobs are ~3MB each and a database row is never
         CDN-cached, so every visit used to re-download the whole gallery.
         Anything already held at the same `updated_at` costs nothing now. */
      const cached = await readBlobs(
        ids.map((id) => ({ key: blobKey.timelinePhoto(id), version: versions.get(id) ?? "v0" }))
      );

      if (cached.size > 0) {
        setPhotoUrls((prev) => {
          const next = { ...prev };
          for (const id of ids) {
            const hit = cached.get(blobKey.timelinePhoto(id));
            if (hit) next[id] = hit;
          }
          return next;
        });
      }

      const missing = ids.filter((id) => !cached.has(blobKey.timelinePhoto(id)));
      if (missing.length === 0) return;

      /* `url` only. `file_url` is a legacy duplicate that has always been
         written alongside it - verified on every row: neither is ever null
         and the two never differ - so asking for both would send every
         photo's base64 down the wire twice. Writes still populate both. */
      const { data, error: photoErr } = await supabase
        .from("media_items")
        .select("id, url")
        .in("id", missing);

      if (photoErr) throw photoErr;

      setPhotoUrls((prev) => {
        const next = { ...prev };
        for (const row of data || []) {
          const bytes = (row as any).url;
          if (bytes) next[(row as any).id] = bytes;
        }
        return next;
      });

      void writeBlobs(
        (data || [])
          .filter((row) => typeof (row as any).url === "string")
          .map((row) => ({
            key: blobKey.timelinePhoto((row as any).id),
            version: versions.get((row as any).id) ?? "v0",
            value: (row as any).url as string,
          }))
      );
    } catch {
      /* A photo that won't load is not worth blocking the chapter over - the
         frame keeps its "developing" state and the caption/notes still read.
         The metadata fetch owns the visible error banner. */
    }
  };

  const fetchMemories = async () => {
    if (!coupleId) return;
    try {
      /* Metadata only - see MEMORY_SELECT_COLUMNS. This is the query that
         gates first paint, and it is now tiny. */
      const { data, error: fetchErr } = await supabase
        .from("media_items")
        .select(MEMORY_SELECT_COLUMNS)
        .eq("couple_id", coupleId)
        .order("memory_date", { ascending: true });

      if (fetchErr) throw fetchErr;

      const rows = sortByDate((data || []).map(normalizeMemory));
      setMemories(rows);
      setLoading(false);

      /* Photos come after the frames are already on screen. The leftmost ones
         are awaited so the polaroids you are actually looking at fill in
         first; the rest trail in behind, in small batches rather than one
         enormous request - a single query for the tail would be tens of MB of
         JSON arriving in one lump, so nothing would appear until all of it
         landed. */
      const ids = rows.map((m) => m.id);
      const versions = new Map(rows.map((m) => [m.id, m.updatedAt ?? "v0"]));
      await loadPhotos(ids.slice(0, PHOTO_BATCH), versions);
      void (async () => {
        for (let i = PHOTO_BATCH; i < ids.length; i += PHOTO_BATCH) {
          await loadPhotos(ids.slice(i, i + PHOTO_BATCH), versions);
        }
      })();
    } catch (err: any) {
      setError(err.message || "Failed to load timeline polaroids.");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();

    /* Own writes (insert/update/delete below) already patch `memories`
       locally the instant Supabase confirms them, so this subscription only
       has to react to the PARTNER's changes. Rather than re-running
       fetchMemories() (which re-downloads every polaroid's base64 photo on
       every single edit - the exact "takes too long to reflect" bug), patch
       state directly from the realtime payload, which already carries the
       full new row for insert/update. */
    const channel = supabase
      .channel(`media_items_${coupleId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "media_items",
          filter: `couple_id=eq.${coupleId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const deletedId = (payload.old as any)?.id;
            if (deletedId) {
              setMemories((prev) => prev.filter((m) => m.id !== deletedId));
              setPhotoUrls((prev) => {
                if (!(deletedId in prev)) return prev;
                const next = { ...prev };
                delete next[deletedId];
                return next;
              });
            }
            return;
          }

          const row = normalizeMemory(payload.new);
          setMemories((prev) => {
            const exists = prev.some((m) => m.id === row.id);
            const next = exists ? prev.map((m) => (m.id === row.id ? row : m)) : [...prev, row];
            return sortByDate(next);
          });

          /* The payload usually carries the whole row, bytes included - but a
             polaroid is a multi-MB base64 string and Realtime drops records
             over its size limit rather than delivering them, so this must not
             assume the photo came with it. Take the bytes when they are there,
             fetch them when they are not. */
          if (row.url) {
            setPhotoUrls((prev) => ({ ...prev, [row.id]: row.url }));
          } else {
            void loadPhotos([row.id], new Map([[row.id, row.updatedAt ?? "v0"]]));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [coupleId, supabase]);

  const toggleFlip = (id: string) => {
    setFlippedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const scrollTimeline = (direction: "left" | "right") => {
    if (!timelineScrollRef.current) return;
    const scrollAmount = 360;
    timelineScrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    /* The pick limit bounds the raw file; compressImage() below bounds what
       actually lands in Postgres. Before this, a phone photo went in at full
       size - the existing rows average ~3MB each, which is exactly why this
       chapter was slow to load. Same treatment Ch.04 Digicam already gives
       its uploads. */
    if (file.size > 40 * 1024 * 1024) {
      setError("Please choose a photo smaller than 40MB.");
      return;
    }

    setError(null);
    setPreparingPhoto(true);
    try {
      const prepared = await compressImage(file, { maxEdge: 1600, targetBytes: 900_000 });
      setFormImagePreview(prepared.dataUrl);
      setPhotoScale(1.0);
      setPhotoX(0);
      setPhotoY(0);
      setPhotoRotation(0);
      setPhotoFlipH(false);
      setPhotoFlipV(false);
      /* compressImage reports HEIC-it-couldn't-decode this way; surface it
         rather than silently storing something that may not render. */
      if (prepared.note && !prepared.processed) setError(prepared.note);
    } catch {
      setError("Couldn't read that photo. Try a different one?");
    } finally {
      setPreparingPhoto(false);
    }
  };

  const handleOpenCreate = () => {
    setEditingId(null);
    setFormImagePreview("");
    setFormCaption("");
    setFormNotes("");
    setFormDate(new Date().toISOString().slice(0, 10));
    setPhotoScale(1.0);
    setPhotoX(0);
    setPhotoY(0);
    setPhotoRotation(0);
    setPhotoFlipH(false);
    setPhotoFlipV(false);
    setError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = async (m: PolaroidMemory, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(m.id);
    /* The photo may not have been fetched yet (metadata-first load). Open the
       editor straight away with whatever is on hand, and fill the preview in
       when the bytes land - the crop tool needs the real image. */
    const current = urlOf(m);
    setFormImagePreview(current);
    setFormCaption(m.caption);
    setFormNotes(m.notes || "");
    setFormDate(m.rawDate || new Date().toISOString().slice(0, 10));
    setPhotoScale(m.photo_scale ?? 1.0);
    setPhotoX(m.photo_x ?? 0);
    setPhotoY(m.photo_y ?? 0);
    setPhotoRotation(m.photo_rotation ?? 0);
    setPhotoFlipH(m.photo_flip_h ?? false);
    setPhotoFlipV(m.photo_flip_v ?? false);
    setError(null);
    setIsModalOpen(true);

    /* Modal is already up by here; the preview fills in behind it. */
    if (!current) {
      const { data } = await supabase.from("media_items").select("id, url").eq("id", m.id).single();
      const bytes = (data as any)?.url || "";
      if (bytes) {
        setPhotoUrls((prev) => ({ ...prev, [m.id]: bytes }));
        setFormImagePreview((prev) => (prev ? prev : bytes));
      }
    }
  };

  // Drag & Pan Handlers (Pointer Events cover mouse, touch and pen in one path)
  const handlePointerDownCrop = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDraggingImage(true);
    dragStartPos.current = {
      x: e.clientX,
      y: e.clientY,
      startX: photoX,
      startY: photoY,
    };
  };

  const handlePointerMoveCrop = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingImage || !dragStartPos.current) return;
    const deltaX = e.clientX - dragStartPos.current.x;
    const deltaY = e.clientY - dragStartPos.current.y;
    setPhotoX(Math.max(-100, Math.min(100, dragStartPos.current.startX + deltaX / 2.5)));
    setPhotoY(Math.max(-100, Math.min(100, dragStartPos.current.startY + deltaY / 2.5)));
  };

  const handlePointerUpCrop = () => {
    setIsDraggingImage(false);
    dragStartPos.current = null;
  };

  const handleSaveMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formImagePreview) {
      setError("Please pick an image from your device photos or files.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload: any = {
        couple_id: coupleId,
        uploaded_by: userId,
        uploader_id: userId,
        media_type: "image",
        file_url: formImagePreview,
        url: formImagePreview,
        /* Load-bearing: `updated_at` is the version stamp the blob cache keys
           on, and this payload can carry NEW bytes for an existing row. There
           is no trigger maintaining it (checked - this schema has no triggers
           at all), so without this line a replaced photo would keep the old
           stamp and every other device would go on serving the old photo out
           of its cache indefinitely. */
        updated_at: new Date().toISOString(),
        caption: formCaption.trim() || "Timeline Memory ❤️",
        notes: formNotes.trim() || "",
        memory_date: formDate || new Date().toISOString().slice(0, 10),
        photo_scale: photoScale,
        photo_x: photoX,
        photo_y: photoY,
        photo_rotation: photoRotation,
        photo_flip_h: photoFlipH,
        photo_flip_v: photoFlipV,
      };

      /* .select().single() hands back the saved row in the same round trip,
         so the polaroid can be patched into state immediately instead of
         re-fetching (and re-downloading every OTHER photo's base64 blob)
         after every save - that refetch was the "takes too long to reflect"
         bug. */
      if (editingId) {
        const { data: saved, error: updateErr } = await supabase
          .from("media_items")
          .update(payload)
          .eq("id", editingId)
          .select(MEMORY_SELECT_COLUMNS)
          .single();

        if (updateErr) throw updateErr;
        const row = normalizeMemory(saved);
        /* The saved row comes back metadata-only, but the bytes we just sent
           are right here - seed both caches so the card doesn't have to
           re-download its own photo, this mount or any later one. */
        setPhotoUrls((prev) => ({ ...prev, [row.id]: formImagePreview }));
        void writeBlobs([
          {
            key: blobKey.timelinePhoto(row.id),
            version: row.updatedAt ?? "v0",
            value: formImagePreview,
          },
        ]);
        setMemories((prev) => sortByDate(prev.map((m) => (m.id === row.id ? row : m))));
      } else {
        const { data: saved, error: insertErr } = await supabase
          .from("media_items")
          .insert(payload)
          .select(MEMORY_SELECT_COLUMNS)
          .single();

        if (insertErr) throw insertErr;
        const row = normalizeMemory(saved);
        setPhotoUrls((prev) => ({ ...prev, [row.id]: formImagePreview }));
        void writeBlobs([
          {
            key: blobKey.timelinePhoto(row.id),
            version: row.updatedAt ?? "v0",
            value: formImagePreview,
          },
        ]);
        setMemories((prev) => sortByDate([...prev, row]));
      }

      setIsModalOpen(false);
      setFormImagePreview("");
      setFormCaption("");
      setFormNotes("");
      setEditingId(null);
    } catch (err: any) {
      setError(err.message || "Failed to pin memory to the timeline.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Erase this polaroid from your multiverse string?")) return;

    try {
      const { error: delErr } = await supabase
        .from("media_items")
        .delete()
        .eq("id", id);

      if (delErr) throw delErr;
      /* The row is gone - free the cache slot rather than waiting for
         eviction to notice. */
      void dropBlob(blobKey.timelinePhoto(id));
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (err: any) {
      setError(err.message || "Failed to delete polaroid.");
    }
  };

  /* Photo bytes for a row, or "" while they are still in flight. Never feed
     "" to an <img src> - browsers treat an empty src as a request for the
     page itself, which is why the caller branches on this instead. */
  const urlOf = (m: PolaroidMemory) => photoUrls[m.id] || m.url || "";

  const getTransformStyle = (
    scale: number = 1.0,
    x: number = 0,
    y: number = 0,
    rotation: number = 0,
    flipH: boolean = false,
    flipV: boolean = false
  ) => {
    const scaleX = flipH ? -scale : scale;
    const scaleY = flipV ? -scale : scale;
    return `translate(${x}%, ${y}%) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`;
  };

  const rotations = ["-rotate-2", "rotate-2", "-rotate-3", "rotate-1", "-rotate-1", "rotate-3"];

  return (
    <main className="min-h-screen w-full p-4 sm:p-8 lg:p-10 flex flex-col justify-between relative overflow-hidden select-none bg-[#191116] text-[#FAF4EB]">
      <SpideyBackground />

      <div className="fixed top-8 right-16 animate-crawl-h text-xl z-10 pointer-events-none">🕷️</div>
      <div className="fixed left-6 bottom-20 animate-crawl-v text-lg z-10 pointer-events-none">🕷️</div>

      {/* Multiverse Entry Overlay */}
      {isSpideyLoading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0e0a0d] backdrop-blur-md overflow-hidden animate-in fade-in duration-300">
          <div className="absolute w-[600px] h-[600px] sm:w-[850px] sm:h-[850px] rounded-full border-6 border-dashed border-[#7D2834] opacity-70 animate-red-string-burst flex items-center justify-center pointer-events-none">
            <span className="text-8xl opacity-80 select-none">🧵</span>
          </div>

          <div className="absolute w-72 h-72 sm:w-96 sm:h-96 rounded-full border-8 border-dotted border-[#E0B1AE] opacity-50 animate-timeline-portal-spin flex items-center justify-center pointer-events-none">
            <div className="w-48 h-48 rounded-full border-4 border-dashed border-[#C5A467]" />
          </div>

          <div className="relative z-10 flex flex-col items-center justify-center animate-comic-pop">
            <div className="bg-[#7D2834] border-4 border-[#FAF4EB] shadow-[10px_10px_0_#17131A] px-7 py-4 rounded-2xl rotate-2 flex items-center gap-4">
              <span className="text-4xl animate-bounce">🧵</span>
              <div>
                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#E0B1AE] block">
                  CHAPTER 03 • RED STRING OF FATE
                </span>
                <h2 className="font-marker text-2xl sm:text-4xl text-[#FAF4EB] leading-tight">
                  *THWIP!* 🕸️ WEAVING TIMELINES...
                </h2>
              </div>
              <span className="text-4xl animate-spin">📸</span>
            </div>

            <span className="font-handwriting text-2xl text-[#E0B1AE] mt-3 font-black drop-shadow-md">
              Tracing our path through infinite dimensions...
            </span>
          </div>
        </div>
      )}

      {/* Top Header Navigation */}
      <header className="max-w-7xl mx-auto w-full z-30 flex items-center justify-between mb-6">
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#F2E6D2] hover:bg-[#FAF7F2] text-[#261D24] text-xs sm:text-sm font-mono font-black border-3 border-[#261D24] shadow-[5px_5px_0_#171B22] -rotate-2 hover:rotate-0 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5 text-[#7D2834]" strokeWidth={3} />
          <span className="tracking-widest uppercase">Table of Contents</span>
        </Link>

        <div className="flex items-center gap-3">
          {memories.length > 2 && (
            <div className="hidden sm:flex items-center gap-1.5 bg-[#F2E6D2] p-1 border-3 border-[#261D24] shadow-[4px_4px_0_#171B22]">
              <button
                onClick={() => scrollTimeline("left")}
                className="p-1.5 hover:bg-stone-300 rounded text-[#261D24] transition cursor-pointer"
                title="Scroll Left"
              >
                <ChevronLeft className="w-4 h-4 font-black" />
              </button>
              <span className="text-[10px] font-mono font-black text-[#261D24] px-1.5 uppercase">
                SCROLL TRACK
              </span>
              <button
                onClick={() => scrollTimeline("right")}
                className="p-1.5 hover:bg-stone-300 rounded text-[#261D24] transition cursor-pointer"
                title="Scroll Right"
              >
                <ChevronRight className="w-4 h-4 font-black" />
              </button>
            </div>
          )}

          <button
            onClick={handleOpenCreate}
            className="px-5 py-2.5 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] text-xs sm:text-sm font-mono font-black border-3 border-[#261D24] shadow-[5px_5px_0_#171B22] rotate-1 hover:rotate-0 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none flex items-center gap-2.5 cursor-pointer"
          >
            <Plus className="w-5 h-5 text-[#E0B1AE]" strokeWidth={3} />
            <span className="tracking-widest uppercase">Pin Polaroid</span>
          </button>
        </div>
      </header>

      {/* Main Board Container */}
      <div className="flex-1 max-w-7xl mx-auto w-full z-20 flex flex-col">
        <div className="paper-sheet-solid p-6 sm:p-10 relative flex-1 border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.85)] flex flex-col justify-between overflow-hidden">
          
          <div className="absolute -top-3.5 left-1/4 w-32 h-6 tape-pink-solid -rotate-1 pointer-events-none" />
          <div className="absolute -top-3.5 right-1/4 w-32 h-6 tape-gold-solid rotate-2 pointer-events-none" />

          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b-3 border-dashed border-[#8A7550]">
              <div className="flex items-center gap-4">
                <div className="wax-seal-solid w-14 h-14 rounded-full flex items-center justify-center shrink-0 border-3 border-[#261D24] shadow-[4px_4px_0_#171B22] hover:rotate-12 transition">
                  <Heart className="w-7 h-7 text-[#F2E6D2] fill-[#F2E6D2]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-black uppercase tracking-widest text-[#7D2834] flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-[#7D2834]" /> CHAPTER 03 • THE RED STRING OF FATE
                    </span>
                    <span className="bg-[#EAD9A9] text-[#261D24] text-[10px] font-mono font-black px-2 py-0.5 border border-[#261D24] -rotate-2">
                      FATE CORD
                    </span>
                  </div>
                  <h1 className="font-marker text-3xl sm:text-5xl text-[#1A0D10] leading-none mt-1.5">
                    Our Red String Timeline
                  </h1>
                </div>
              </div>

              <div className="text-left sm:text-right bg-[#EFE4D6] p-3 border-2 border-[#261D24] shadow-[4px_4px_0_#171B22] -rotate-1">
                <span className="text-[10px] font-mono font-bold text-stone-600 uppercase tracking-widest block">
                  MEMORIES PINNED
                </span>
                <span className="font-mono text-base font-black text-[#7D2834] uppercase">
                  {memories.length} POLAROIDS CONNECTED
                </span>
              </div>
            </div>

            {error && (
              <div className="my-5 p-4 rounded-lg bg-[#5A2029] text-[#F2E6D2] text-sm font-mono flex items-center gap-3 border-3 border-[#261D24] shadow-[5px_5px_0_#261D24]">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Horizontal Continuous Timeline Track */}
            {loading ? (
              <div className="flex items-center gap-8 my-10 overflow-hidden">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="w-80 h-[480px] bg-[#EFE4D6]/50 border-3 border-dashed border-[#8A7550] rounded-xl animate-pulse shrink-0" />
                ))}
              </div>
            ) : memories.length === 0 ? (
              <div className="text-center py-20 my-auto">
                <div className="text-7xl mb-4 animate-bounce">🧵🕸️📸</div>
                <p className="font-marker text-3xl text-[#7D2834]">No memories connected to the string yet!</p>
                <p className="font-handwriting text-2xl text-stone-700 mt-2">
                  Tap “Pin Polaroid” above to upload and adjust your first photo memory.
                </p>
              </div>
            ) : (
              <div className="relative my-6 pt-12 pb-6">
                
                {/* Woven Thread Catenary Curves */}
                <div className="absolute top-[28px] left-0 right-0 h-16 pointer-events-none z-10 overflow-hidden animate-yarn-sway">
                  <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1000 50">
                    <path
                      d="M 0,15 Q 125,38 250,15 Q 375,42 500,15 Q 625,38 750,15 Q 875,44 1000,15"
                      fill="none"
                      stroke="#4A000A"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 0,15 Q 125,38 250,15 Q 375,42 500,15 Q 625,38 750,15 Q 875,44 1000,15"
                      fill="none"
                      stroke="#8C1424"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 0,15 Q 125,38 250,15 Q 375,42 500,15 Q 625,38 750,15 Q 875,44 1000,15"
                      fill="none"
                      stroke="#FFAEB9"
                      strokeWidth="1.2"
                      strokeDasharray="4 8"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>

                <div
                  ref={timelineScrollRef}
                  className="timeline-horizontal-scroll flex items-start gap-12 sm:gap-16 pt-8 pb-6 px-4 relative z-20"
                >
                  {memories.map((m, idx) => {
                    const tiltClass = rotations[idx % rotations.length];
                    const isFlipped = !!flippedCards[m.id];

                    return (
                      <div
                        key={m.id}
                        className={`relative shrink-0 w-[310px] sm:w-[325px] ${tiltClass} hover:rotate-0 hover:-translate-y-2 transition duration-300`}
                      >
                        {/* Clothespin Rig */}
                        <div className="absolute -top-9 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center pointer-events-none">
                          <div className="w-3.5 h-3.5 rounded-full bg-[#8C1424] border-2 border-white shadow-md -mb-1 z-10" />
                          <div className="w-4 h-11 bg-[#C29D75] border-2 border-[#4A321A] rounded-xs shadow-lg flex flex-col justify-between py-1 relative">
                            <div className="w-full h-1 bg-[#8B6540]" />
                            <div className="w-full h-2 bg-[#3D2512] rounded-full my-auto" />
                            <div className="w-full h-1 bg-[#8B6540]" />
                          </div>
                          <div className="w-0.5 h-5 bg-[#8C1424] -mt-1 rounded-full opacity-90" />
                        </div>

                        {/* Washi Tape Strip */}
                        <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-24 h-5 z-30 pointer-events-none">
                          <div className="w-full h-full bg-[#D7A4A0] border-l-2 border-r-2 border-white/80 shadow-md rotate-1" />
                        </div>

                        {/* 3D Flippable Polaroid Card Frame */}
                        <div 
                          onClick={() => toggleFlip(m.id)}
                          className="perspective-1200 w-full min-h-[485px] cursor-pointer mt-4"
                        >
                          <div
                            className={`relative w-full h-full min-h-[485px] duration-700 preserve-3d transition-transform ${
                              isFlipped ? "rotate-y-180" : ""
                            }`}
                          >
                            {/* FRONT OF POLAROID */}
                            <div className="absolute inset-0 w-full h-full bg-[#FAF7F2] p-4 sm:p-5 rounded-lg border-4 border-[#261D24] shadow-[10px_14px_0_rgba(10,8,12,0.75)] flex flex-col justify-between backface-hidden">
                              <div>
                                <div className="flex items-center justify-between pb-2 mb-1">
                                  <span className="font-mono text-[10px] font-black uppercase tracking-wider bg-[#EFE4D6] px-2 py-0.5 rounded border border-[#261D24] text-[#1A0D10]">
                                    {m.date}
                                  </span>
                                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      onClick={(e) => handleOpenEdit(m, e)}
                                      className="p-1.5 hover:bg-black/10 rounded-md text-[#261D24] transition cursor-pointer"
                                      title="Edit & Adjust Photo"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => handleDelete(m.id, e)}
                                      className="p-1.5 hover:bg-red-500/20 rounded-md text-[#7D2834] transition cursor-pointer"
                                      title="Delete Polaroid"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {/* Picture Frame: Perfect 1:1 Aspect Ratio Box */}
                                <div className="w-full aspect-square rounded bg-[#1A0D10] border-2 border-[#261D24] overflow-hidden relative shadow-inner mb-3 flex items-center justify-center">
                                  {urlOf(m) ? (
                                    <img
                                      src={urlOf(m)}
                                      alt={m.caption}
                                      loading="lazy"
                                      decoding="async"
                                      style={{
                                        transform: getTransformStyle(
                                          m.photo_scale ?? 1.0,
                                          m.photo_x ?? 0,
                                          m.photo_y ?? 0,
                                          m.photo_rotation ?? 0,
                                          m.photo_flip_h ?? false,
                                          m.photo_flip_v ?? false
                                        ),
                                        transformOrigin: "center center",
                                      }}
                                      className="w-full h-full object-contain pointer-events-none transition-transform duration-200 animate-polaroid-develop"
                                    />
                                  ) : (
                                    /* Bytes still in flight. A polaroid that
                                       hasn't developed yet is the honest
                                       metaphor here, so the frame says so
                                       rather than sitting empty. */
                                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[#241A20] animate-pulse">
                                      <span className="text-3xl opacity-70 select-none">🧪</span>
                                      <span className="font-mono text-[9px] font-black uppercase tracking-widest text-[#E0B1AE]/70">
                                        Developing…
                                      </span>
                                    </div>
                                  )}
                                </div>

                                <div className="px-1 min-h-[28px] sm:min-h-[48px] py-1 flex items-center justify-center text-center">
                                  <p className="font-handwriting text-2xl text-[#1A0D10] leading-snug line-clamp-2 break-words">
                                    {m.caption}
                                  </p>
                                </div>
                              </div>

                              <div className="pt-1 text-center font-mono text-[9px] text-stone-500 uppercase tracking-widest flex items-center justify-center gap-1">
                                <RotateCw className="w-3 h-3 text-[#7D2834]" />
                                <span>TAP POLAROID TO FLIP</span>
                              </div>
                            </div>

                            {/* BACK OF POLAROID */}
                            <div className="absolute inset-0 w-full h-full bg-[#FAF4EB] p-5 rounded-lg border-4 border-[#261D24] shadow-[10px_14px_0_rgba(10,8,12,0.75)] flex flex-col justify-between rotate-y-180 backface-hidden">
                              <div>
                                <div className="flex items-center justify-between pb-3 border-b-2 border-dashed border-[#8A7550]">
                                  <span className="font-mono text-[11px] font-black text-[#7D2834] uppercase flex items-center gap-1.5">
                                    <span>💌</span> SECRET MEMORY LOG
                                  </span>
                                  <span className="font-mono text-[10px] font-black text-stone-700 uppercase bg-[#EAD9A9] px-2 py-0.5 border border-[#261D24]">
                                    EARTH-65 × 616
                                  </span>
                                </div>

                                <div className="pt-6 px-2">
                                  <p className="font-handwriting text-2xl text-stone-900 leading-relaxed break-words">
                                    "{m.notes || "Across every universe, time loops, and rooftop talks... this memory is forever etched in our multiverse timeline."}"
                                  </p>
                                </div>
                              </div>

                              <div>
                                <div className="text-right font-mono text-[10px] font-black text-[#7D2834] uppercase tracking-widest pb-3 border-b-2 border-dashed border-[#8A7550]">
                                  CANON MOMENT • {m.date}
                                </div>
                                <div className="w-full pt-2 text-center font-mono text-[9px] text-stone-500 uppercase tracking-widest flex items-center justify-center gap-1">
                                  <RotateCw className="w-3 h-3 text-[#7D2834]" />
                                  <span>TAP TO FLIP BACK TO PHOTO</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 mt-4 border-t-3 border-dashed border-[#8A7550]">
            <p className="font-handwriting text-2xl sm:text-3xl text-[#5A2029]">
              “An invisible red thread connects those who are destined to meet, regardless of time, place, or dimension.”
            </p>
            {memories.length > 2 && (
              <span className="font-mono text-[10px] font-black text-[#261D24] uppercase tracking-wider bg-[#EAD0C7] px-3 py-1 border-2 border-[#261D24] shadow-[2px_2px_0_#171B22] -rotate-1 shrink-0">
                ⇠ SWIPE / SCROLL HORIZONTALLY TO EXPLORE ⇢
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Upload & Synchronized 1:1 Image Adjuster Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="paper-sheet-solid max-w-lg w-full p-6 sm:p-8 relative border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.9)] max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute top-5 right-5 p-2 rounded-lg bg-[#EFE4D6] hover:bg-[#E2D2C0] border-2 border-[#261D24] transition cursor-pointer"
            >
              <X className="w-5 h-5 text-[#261D24]" />
            </button>

            <div className="flex items-center gap-3 mb-5 pb-3 border-b-3 border-dashed border-[#8A7550]">
              <Camera className="w-6 h-6 text-[#7D2834]" />
              <h2 className="font-marker text-2xl text-[#261D24]">
                {editingId ? "Adjust Polaroid Memory" : "Pin Memory from Device"}
              </h2>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-[#5A2029] text-[#F2E6D2] text-xs font-mono border-2 border-[#261D24]">
                {error}
              </div>
            )}

            <form onSubmit={handleSaveMemory} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-mono text-xs font-black text-[#7D2834] uppercase tracking-wider">
                    Photo Alignment & Fit *
                  </label>
                  {formImagePreview && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[11px] font-mono text-[#7D2834] font-bold underline cursor-pointer hover:text-black"
                    >
                      Change Photo
                    </button>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageFileChange}
                  className="hidden"
                />

                {formImagePreview ? (
                  <div className="space-y-3">
                    {/* Synchronized 1:1 Aspect Ratio Viewport (Exactly matches polaroid frame) */}
                    <div className="bg-[#FAF7F2] p-3 rounded-xl border-3 border-[#261D24] shadow-inner flex flex-col items-center">
                      <span className="font-mono text-[9px] font-black text-stone-500 uppercase tracking-widest mb-1.5">
                        POLAROID LIVE FRAME (1:1 WHAT YOU SEE IS WHAT YOU GET)
                      </span>

                      <div
                        onPointerDown={handlePointerDownCrop}
                        onPointerMove={handlePointerMoveCrop}
                        onPointerUp={handlePointerUpCrop}
                        onPointerCancel={handlePointerUpCrop}
                        className={`relative w-64 h-64 aspect-square rounded bg-[#1A0D10] border-2 border-[#261D24] overflow-hidden select-none touch-none flex items-center justify-center ${
                          isDraggingImage ? "cursor-grabbing" : "cursor-grab"
                        }`}
                      >
                        <img
                          src={formImagePreview}
                          alt="Preview"
                          draggable={false}
                          style={{
                            transform: getTransformStyle(
                              photoScale,
                              photoX,
                              photoY,
                              photoRotation,
                              photoFlipH,
                              photoFlipV
                            ),
                            transformOrigin: "center center",
                          }}
                          className="w-full h-full object-contain pointer-events-none transition-transform duration-75"
                        />

                        <div className="absolute inset-0 pointer-events-none border border-white/20 rounded flex items-center justify-center">
                          <span className="font-mono text-[8px] font-bold text-white/70 bg-black/60 px-1.5 py-0.5 rounded opacity-0 hover:opacity-100 transition">
                            DRAG TO PAN
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Transformation Toolbar (Rotate & Flip) */}
                    <div className="flex items-center justify-between gap-2 bg-[#FAF7F2] p-2.5 rounded-xl border-2 border-[#261D24]">
                      <span className="font-mono text-[10px] font-black text-[#261D24] uppercase">
                        TRANSFORMS:
                      </span>
                      
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPhotoRotation((prev) => (prev + 90) % 360)}
                          className="px-2.5 py-1 bg-[#EFE4D6] hover:bg-[#E2D2C0] text-[#261D24] border border-[#261D24] rounded text-xs font-mono font-bold flex items-center gap-1 cursor-pointer"
                          title="Rotate 90° Clockwise"
                        >
                          <RotateCw className="w-3.5 h-3.5 text-[#7D2834]" />
                          <span>{photoRotation}°</span>
                        </button>
                        
                        <button
                          type="button"
                          onClick={() => setPhotoFlipH((prev) => !prev)}
                          className={`px-2.5 py-1 border border-[#261D24] rounded text-xs font-mono font-bold flex items-center gap-1 cursor-pointer transition ${
                            photoFlipH ? "bg-[#7D2834] text-white" : "bg-[#EFE4D6] text-[#261D24] hover:bg-[#E2D2C0]"
                          }`}
                          title="Flip Horizontally (Mirror)"
                        >
                          <FlipHorizontal className="w-3.5 h-3.5" />
                          <span>FLIP H</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setPhotoFlipV((prev) => !prev)}
                          className={`px-2.5 py-1 border border-[#261D24] rounded text-xs font-mono font-bold flex items-center gap-1 cursor-pointer transition ${
                            photoFlipV ? "bg-[#7D2834] text-white" : "bg-[#EFE4D6] text-[#261D24] hover:bg-[#E2D2C0]"
                          }`}
                          title="Flip Vertically"
                        >
                          <FlipVertical className="w-3.5 h-3.5" />
                          <span>FLIP V</span>
                        </button>
                      </div>
                    </div>

                    {/* Sliders: Zoom & Pan Adjustment */}
                    <div className="bg-[#FAF7F2] p-3 rounded-xl border-2 border-[#261D24] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] font-black text-[#261D24] flex items-center gap-1 uppercase">
                          <ZoomIn className="w-3.5 h-3.5 text-[#7D2834]" /> Zoom ({photoScale.toFixed(1)}x)
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoScale(1.0);
                            setPhotoX(0);
                            setPhotoY(0);
                            setPhotoRotation(0);
                            setPhotoFlipH(false);
                            setPhotoFlipV(false);
                          }}
                          className="text-[10px] font-mono text-[#7D2834] underline font-bold cursor-pointer"
                        >
                          Reset All
                        </button>
                      </div>

                      <input
                        type="range"
                        min="0.5"
                        max="3.0"
                        step="0.05"
                        value={photoScale}
                        onChange={(e) => setPhotoScale(parseFloat(e.target.value))}
                        className="w-full accent-[#7D2834] cursor-pointer"
                      />

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div>
                          <label className="text-[10px] font-mono font-bold text-stone-600 uppercase flex items-center gap-1">
                            <Move className="w-3 h-3" /> Horizontal Pan
                          </label>
                          <input
                            type="range"
                            min="-100"
                            max="100"
                            step="1"
                            value={photoX}
                            onChange={(e) => setPhotoX(parseFloat(e.target.value))}
                            className="w-full accent-[#7D2834] cursor-pointer"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-mono font-bold text-stone-600 uppercase flex items-center gap-1">
                            <Move className="w-3 h-3" /> Vertical Pan
                          </label>
                          <input
                            type="range"
                            min="-100"
                            max="100"
                            step="1"
                            value={photoY}
                            onChange={(e) => setPhotoY(parseFloat(e.target.value))}
                            className="w-full accent-[#7D2834] cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-36 rounded-xl border-3 border-dashed border-[#8A7550] bg-[#FAF7F2] hover:bg-[#F2E6D2] flex flex-col items-center justify-center gap-2 text-stone-700 transition cursor-pointer"
                  >
                    <ImageIcon className="w-8 h-8 text-[#7D2834]" />
                    <span className="font-mono text-xs font-black uppercase text-[#7D2834]">
                      Choose from Gallery / Photos
                    </span>
                    <span className="text-[10px] font-mono text-stone-500">
                      Supports mobile camera roll & desktop images
                    </span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono text-xs font-black text-[#7D2834] uppercase tracking-wider mb-1.5">
                    Polaroid Front Caption
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Sunset rooftop talks ✨"
                    value={formCaption}
                    onChange={(e) => setFormCaption(e.target.value)}
                    className="w-full text-sm font-mono p-3 rounded-xl bg-white border-3 border-[#261D24] text-stone-900 outline-none shadow-inner"
                  />
                </div>

                <div>
                  <label className="block font-mono text-xs font-black text-[#7D2834] uppercase tracking-wider mb-1.5">
                    Memory Date
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full text-sm font-mono p-3 rounded-xl bg-white border-3 border-[#261D24] text-stone-900 outline-none shadow-inner"
                  />
                </div>
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase tracking-wider mb-1.5">
                  Back of Polaroid (Secret Note)
                </label>
                <textarea
                  rows={3}
                  placeholder="Write a message written on the back of the photo..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full text-sm font-mono p-3 rounded-xl bg-white border-3 border-[#261D24] text-stone-900 outline-none resize-none shadow-inner"
                />
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
                  disabled={saving || preparingPhoto}
                  className="px-6 py-2.5 rounded-xl bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] font-mono text-xs font-black border-3 border-[#261D24] shadow-[4px_4px_0_#171B24] flex items-center gap-2 transition disabled:opacity-50 cursor-pointer active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
                >
                  {saving || preparingPhoto ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>{preparingPhoto ? "Optimising…" : editingId ? "Update Polaroid" : "Pin to String"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer Tag */}
      <footer className="max-w-md mx-auto text-center z-20 mt-6">
        <span className="font-mono text-xs font-black text-[#261D24] uppercase tracking-widest bg-[#EAD0C7] px-6 py-1.5 border-3 border-[#261D24] shadow-[4px_4px_0_#171B22] inline-block rotate-1">
          EARTH-65 × EARTH-616 • RED STRING TIMELINE
        </span>
      </footer>

      {/* Chapter-scoped CSS, per house convention (see CLAUDE.md) - kept here
          rather than in globals.css so this chapter stays self-contained. */}
      <style>{`
        /* A photo arriving after its frame is already on screen would
           otherwise pop in hard. This fades it up the way a polaroid
           actually develops. */
        @keyframes polaroidDevelop {
          from { opacity: 0; filter: contrast(0.5) brightness(1.35) saturate(0.4); }
          to   { opacity: 1; filter: none; }
        }
        .animate-polaroid-develop {
          animation: polaroidDevelop 420ms ease-out both;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-polaroid-develop { animation: none; }
        }
      `}</style>
    </main>
  );
}