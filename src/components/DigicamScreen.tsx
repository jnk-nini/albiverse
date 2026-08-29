"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import SpideyBackground from "./SpideyBackground";
import {
  ArrowLeft,
  Aperture,
  Trash2,
  Save,
  X,
  Loader2,
  AlertCircle,
  ZoomIn,
  ZoomOut,
  Move,
  RotateCcw,
  Film,
  Video,
  BatteryFull,
  Sparkles,
  Plus,
  ImageOff,
} from "lucide-react";

export interface DigicamMediaItem {
  id: string;
  url: string;
  caption: string;
  notes: string;
  media_type: string;
  created_at: string;
}

interface DigicamScreenProps {
  userId: string;
  coupleId: string;
  initialItems: DigicamMediaItem[];
}

type FilterMode = "none" | "retro" | "bw" | "glitch";

const FILTERS: { id: FilterMode; label: string; css: string }[] = [
  { id: "none", label: "NORMAL", css: "none" },
  { id: "retro", label: "RETRO-CAM", css: "sepia(0.55) saturate(1.6) contrast(1.15) brightness(0.96) hue-rotate(-6deg)" },
  { id: "bw", label: "B&W HI-CON", css: "grayscale(1) contrast(1.7) brightness(1.06)" },
  { id: "glitch", label: "GLITCH", css: "none" },
];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

function formatStamp(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `'${String(d.getFullYear()).slice(2)}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DigicamScreen({ userId, coupleId, initialItems }: DigicamScreenProps) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const [items, setItems] = useState<DigicamMediaItem[]>(initialItems);
  const [loading, setLoading] = useState(initialItems.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null);

  const [filterMode, setFilterMode] = useState<FilterMode>("none");
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(50);
  const [panY, setPanY] = useState(50);
  const [isDragging, setIsDragging] = useState(false);

  const [captureMode, setCaptureMode] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<"image" | "video">("image");
  const [captionDraft, setCaptionDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 950);
    return () => clearTimeout(t);
  }, []);

  const fetchItems = useCallback(async () => {
    const { data, error: fetchErr } = await supabase
      .from("media_items")
      .select("id, url, caption, notes, media_type, created_at")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false });

    if (fetchErr) {
      setError(fetchErr.message);
    } else {
      setItems((data as DigicamMediaItem[]) ?? []);
    }
    setLoading(false);
  }, [coupleId, supabase]);

  useEffect(() => {
    fetchItems();

    const channel = supabase
      .channel(`digicam_${coupleId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "media_items", filter: `couple_id=eq.${coupleId}` },
        () => fetchItems()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [coupleId, supabase, fetchItems]);

  // Self-healing selection: falls back to the newest item whenever the
  // explicitly selected id no longer exists in the list (e.g. after a delete),
  // without needing an effect to reconcile stray state.
  const fallbackId = items[0]?.id ?? null;
  const effectiveSelectedId = captureMode ? null : items.some((i) => i.id === selectedId) ? selectedId : fallbackId;
  const selectedItem = items.find((i) => i.id === effectiveSelectedId) ?? null;

  // Reset transient framing (pan/zoom) whenever the viewed shot changes.
  // Intentional: syncs local view state to a derived selection, not a render-time computable value.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZoom(1);
    setPanX(50);
    setPanY(50);
  }, [effectiveSelectedId, captureMode]);

  // Sync editable draft fields from the viewed shot. Deliberately keyed on
  // effectiveSelectedId/captureMode only (not `items`/`selectedItem`) so a
  // realtime refetch never clobbers text the user is mid-typing.
  useEffect(() => {
    if (!captureMode && selectedItem) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCaptionDraft(selectedItem.caption);
      setNotesDraft(selectedItem.notes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSelectedId, captureMode]);

  const openFilePicker = () => {
    setError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (!isVideo && !isImage) {
      setError("Only image or video files can be loaded into the digicam.");
      return;
    }

    const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > limit) {
      setError(`File too big for the memory card (max ${isVideo ? "20MB per clip" : "8MB per photo"}).`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === "string") {
        setPendingUrl(ev.target.result);
        setPendingType(isVideo ? "video" : "image");
        setCaptionDraft("");
        setNotesDraft("");
        setCaptureMode(true);
        setError(null);
      }
    };
    reader.onerror = () => setError("Couldn't read that file from your device.");
    reader.readAsDataURL(file);
  };

  const cancelCapture = () => {
    setCaptureMode(false);
    setPendingUrl(null);
  };

  const saveCapture = async () => {
    if (!pendingUrl) return;
    setSaving(true);
    setError(null);

    const { data, error: insertErr } = await supabase
      .from("media_items")
      .insert({
        couple_id: coupleId,
        uploader_id: userId,
        url: pendingUrl,
        media_type: pendingType,
        caption: captionDraft.trim() || "Untitled Shot",
        notes: notesDraft.trim(),
      })
      .select("id, url, caption, notes, media_type, created_at")
      .single();

    if (insertErr || !data) {
      setError(insertErr?.message || "Failed to save this shot.");
      setSaving(false);
      return;
    }

    const saved = data as DigicamMediaItem;
    setItems((prev) => [saved, ...prev]);
    setSelectedId(saved.id);
    setCaptureMode(false);
    setPendingUrl(null);
    setSaving(false);
  };

  const saveEdits = async () => {
    if (!selectedItem) return;
    setSaving(true);
    setError(null);
    const nextCaption = captionDraft.trim() || "Untitled Shot";
    const nextNotes = notesDraft.trim();

    const { error: updateErr } = await supabase
      .from("media_items")
      .update({ caption: nextCaption, notes: nextNotes })
      .eq("id", selectedItem.id);

    if (updateErr) {
      setError(updateErr.message);
    } else {
      setItems((prev) => prev.map((i) => (i.id === selectedItem.id ? { ...i, caption: nextCaption, notes: nextNotes } : i)));
    }
    setSaving(false);
  };

  const deleteSelected = async () => {
    if (!selectedItem) return;
    if (!confirm("Erase this shot from the memory card? This can't be undone.")) return;
    setDeleting(true);
    setError(null);

    const { error: deleteErr } = await supabase.from("media_items").delete().eq("id", selectedItem.id);
    if (deleteErr) {
      setError(deleteErr.message);
    } else {
      setItems((prev) => prev.filter((i) => i.id !== selectedItem.id));
    }
    setDeleting(false);
  };

  const beginDrag = (clientX: number, clientY: number) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragState.current = { x: clientX, y: clientY, panX, panY };
  };

  const moveDrag = (clientX: number, clientY: number) => {
    if (!isDragging || !dragState.current || !screenRef.current) return;
    const rect = screenRef.current.getBoundingClientRect();
    const dxPct = ((clientX - dragState.current.x) / rect.width) * 100;
    const dyPct = ((clientY - dragState.current.y) / rect.height) * 100;
    setPanX(Math.min(100, Math.max(0, dragState.current.panX - dxPct)));
    setPanY(Math.min(100, Math.max(0, dragState.current.panY - dyPct)));
  };

  const endDrag = () => {
    setIsDragging(false);
    dragState.current = null;
  };

  const resetFraming = () => {
    setZoom(1);
    setPanX(50);
    setPanY(50);
  };

  const selectItem = (id: string) => {
    setCaptureMode(false);
    setPendingUrl(null);
    setSelectedId(id);
  };

  const frameIndex = selectedItem ? items.findIndex((i) => i.id === selectedItem.id) + 1 : 0;
  const activeFilter = FILTERS.find((f) => f.id === filterMode)!;
  const displayUrl = captureMode ? pendingUrl : selectedItem?.url ?? null;
  const displayType: string = captureMode ? pendingType : selectedItem?.media_type ?? "image";
  const isDirty = !captureMode && !!selectedItem && (captionDraft !== selectedItem.caption || notesDraft !== selectedItem.notes);

  return (
    <>
      <style>{`
        @keyframes digicamRecBlink { 0%, 45% { opacity: 1; } 50%, 95% { opacity: 0.15; } 100% { opacity: 1; } }
        .animate-rec-blink { animation: digicamRecBlink 1.4s steps(1, end) infinite; }

        @keyframes digicamCrtBoot {
          0% { opacity: 1; }
          55% { opacity: 1; }
          70% { opacity: 0.15; }
          82% { opacity: 0.85; }
          100% { opacity: 0; visibility: hidden; }
        }
        .animate-crt-boot { animation: digicamCrtBoot 1s ease-out forwards; }

        .digicam-scanlines {
          background-image: repeating-linear-gradient(
            to bottom,
            rgba(0,0,0,0.18) 0px,
            rgba(0,0,0,0.18) 1px,
            transparent 2px,
            transparent 3px
          );
          mix-blend-mode: multiply;
        }

        .digicam-halftone {
          background-image: radial-gradient(rgba(236,168,184,0.12) 1px, transparent 1px);
          background-size: 10px 10px;
        }

        @keyframes digicamGlitchA {
          0%, 100% { clip-path: inset(0 0 0 0); }
          12% { clip-path: inset(8% 0 68% 0); }
          28% { clip-path: inset(55% 0 4% 0); }
          46% { clip-path: inset(20% 0 45% 0); }
          64% { clip-path: inset(78% 0 3% 0); }
          82% { clip-path: inset(3% 0 82% 0); }
        }
        .animate-glitch-a { animation: digicamGlitchA 2.6s steps(1, end) infinite; }

        @keyframes digicamGlitchB {
          0%, 100% { clip-path: inset(0 0 0 0); }
          15% { clip-path: inset(40% 0 20% 0); }
          33% { clip-path: inset(5% 0 75% 0); }
          50% { clip-path: inset(70% 0 8% 0); }
          70% { clip-path: inset(15% 0 60% 0); }
          88% { clip-path: inset(60% 0 15% 0); }
        }
        .animate-glitch-b { animation: digicamGlitchB 3.1s steps(1, end) infinite; }
      `}</style>

      <main className="min-h-screen p-4 sm:p-8 relative overflow-hidden bg-[#14100d] text-[#FAF4EB]">
        <SpideyBackground />
        <div className="digicam-halftone absolute inset-0 z-0 pointer-events-none opacity-40" />

        <header className="relative z-30 max-w-5xl mx-auto w-full flex items-center justify-between mb-6 sm:mb-8 gap-3 flex-wrap">
          <Link
            href="/?view=toc"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#F2E6D2] hover:bg-[#FAF7F2] text-[#261D24] text-xs font-mono font-black border-3 border-[#261D24] shadow-[5px_5px_0_#171B22] -rotate-1 hover:rotate-0 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-[#781420]" strokeWidth={3} />
            <span className="tracking-widest uppercase">Table of Contents</span>
          </Link>

          <div className="flex items-center gap-2">
            <span className="postage-stamp bg-[#781420] text-[#F6EFE9] -rotate-1">CH. 04 • DIGICAM</span>
            <span className="hidden sm:inline-flex items-center gap-1.5 bg-[#2E0509] border border-[#781420] rounded px-2.5 py-1 font-mono text-[10px] font-bold text-[#F8F4EB]">
              <Sparkles className="w-3 h-3 text-[#ECA8B8]" /> EARTH-65 × 616
            </span>
          </div>
        </header>

        <div className="relative z-20 max-w-5xl mx-auto w-full mb-6 sm:mb-8">
          <span className="font-mono text-[11px] tracking-[.25em] text-[#ECA8B8]">RETRO DIGICAM • DIGITAL DIARY</span>
          <h1 className="font-marker text-4xl sm:text-6xl text-[#FAF4EB] mt-1">Snapshots &amp; Static</h1>
          <p className="font-handwriting text-2xl text-[#E0B1AE] mt-1">Frame it, filter it, keep it forever.</p>
        </div>

        <div className="relative z-20 max-w-5xl mx-auto w-full grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr] items-start">
          {/* ================= CAMERA DEVICE ================= */}
          <div className="relative mx-auto w-full max-w-[420px]">
            <div className="absolute -top-3 left-10 w-24 h-6 tape-gold-solid -rotate-3 z-30 pointer-events-none" />
            <div className="absolute -top-3 right-10 w-24 h-6 tape-pink-solid rotate-3 z-30 pointer-events-none" />

            <div className="relative bg-gradient-to-b from-[#d8dbe0] via-[#aeb3ba] to-[#82868f] border-4 border-[#261D24] rounded-[28px] shadow-[14px_16px_0_rgba(0,0,0,0.75)] p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="font-mono text-[10px] font-black tracking-[0.2em] text-[#3a3d42]">ALBI-CAM 2000</span>
                <span className="font-mono text-[9px] font-black tracking-[0.15em] text-[#3a3d42]/70">65×616</span>
              </div>

              <div className="bg-[#1b1d21] rounded-xl p-2.5 border-2 border-[#0c0d0f] shadow-inner">
                <div
                  ref={screenRef}
                  onMouseDown={(e) => beginDrag(e.clientX, e.clientY)}
                  onMouseMove={(e) => moveDrag(e.clientX, e.clientY)}
                  onMouseUp={endDrag}
                  onMouseLeave={endDrag}
                  onTouchStart={(e) => beginDrag(e.touches[0].clientX, e.touches[0].clientY)}
                  onTouchMove={(e) => moveDrag(e.touches[0].clientX, e.touches[0].clientY)}
                  onTouchEnd={endDrag}
                  className={`relative w-full aspect-[4/3] overflow-hidden rounded-md bg-[#0f1511] select-none ${
                    zoom > 1 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : ""
                  }`}
                >
                  <div className="digicam-scanlines absolute inset-0 z-20 pointer-events-none" />
                  <div className="absolute inset-0 z-10 pointer-events-none bg-[#8fd9a8]/5 mix-blend-overlay" />

                  {[
                    "top-2 left-2 border-t-2 border-l-2",
                    "top-2 right-2 border-t-2 border-r-2",
                    "bottom-2 left-2 border-b-2 border-l-2",
                    "bottom-2 right-2 border-b-2 border-r-2",
                  ].map((pos) => (
                    <div key={pos} className={`absolute ${pos} w-4 h-4 border-[#8fd9a8]/70 z-20 pointer-events-none`} />
                  ))}

                  <div className="absolute top-1.5 inset-x-2 z-30 flex items-center justify-between pointer-events-none">
                    <span className="flex items-center gap-1 font-mono text-[9px] font-black text-[#ff5f5f] drop-shadow-[0_0_4px_rgba(0,0,0,0.8)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ff5f5f] animate-rec-blink" /> REC
                    </span>
                    <BatteryFull className="w-3.5 h-3.5 text-[#8fd9a8] drop-shadow-[0_0_4px_rgba(0,0,0,0.8)]" />
                  </div>

                  <div className="absolute inset-0 z-0">
                    {!displayUrl ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-6">
                        <ImageOff className="w-8 h-8 text-[#4b564f]" />
                        <p className="font-mono text-[10px] font-black text-[#6b766e] uppercase tracking-wider">No Memory Card Data</p>
                        <p className="font-mono text-[9px] text-[#4b564f]">Press the shutter to import a shot</p>
                      </div>
                    ) : filterMode === "glitch" ? (
                      <GlitchMedia url={displayUrl} type={displayType} zoom={zoom} panX={panX} panY={panY} />
                    ) : displayType === "video" ? (
                      <video
                        src={displayUrl}
                        controls
                        playsInline
                        style={{
                          objectFit: "cover",
                          objectPosition: `${panX}% ${panY}%`,
                          transform: `scale(${zoom})`,
                          filter: activeFilter.css,
                        }}
                        className="w-full h-full transition-transform duration-150"
                      />
                    ) : (
                      <img
                        src={displayUrl}
                        alt={captureMode ? "New capture preview" : selectedItem?.caption || "Digicam shot"}
                        draggable={false}
                        style={{
                          objectFit: "cover",
                          objectPosition: `${panX}% ${panY}%`,
                          transform: `scale(${zoom})`,
                          filter: activeFilter.css,
                        }}
                        className="w-full h-full transition-transform duration-150"
                      />
                    )}
                  </div>

                  {displayUrl && (
                    <div className="absolute bottom-1.5 inset-x-2 z-30 flex items-end justify-between pointer-events-none">
                      <span className="font-mono text-[9px] font-black text-[#8fd9a8] drop-shadow-[0_0_4px_rgba(0,0,0,0.8)]">
                        {captureMode ? "NEW" : `IMG ${String(frameIndex).padStart(3, "0")}/${String(items.length).padStart(3, "0")}`}
                      </span>
                      <span className="font-mono text-[9px] font-black text-[#ffb84d] drop-shadow-[0_0_4px_rgba(0,0,0,0.8)]">
                        {captureMode ? "LIVE" : selectedItem ? formatStamp(selectedItem.created_at) : ""}
                      </span>
                    </div>
                  )}

                  {booting && <div className="absolute inset-0 z-40 bg-[#0f1511] animate-crt-boot" />}
                </div>
              </div>

              {displayUrl && (
                <div className="mt-3 flex items-center justify-between gap-2 bg-[#3a3d42] rounded-lg px-3 py-2 border-2 border-[#1c1d20]">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(1, +(z - 0.2).toFixed(2)))}
                    title="Zoom out"
                    className="p-1.5 rounded bg-[#202225] text-[#d8dbe0] hover:bg-[#101113] cursor-pointer"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="range"
                    min="1"
                    max="2.5"
                    step="0.05"
                    value={zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    className="flex-1 accent-[#8fd9a8] cursor-pointer"
                    aria-label="Zoom"
                  />
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.2).toFixed(2)))}
                    title="Zoom in"
                    className="p-1.5 rounded bg-[#202225] text-[#d8dbe0] hover:bg-[#101113] cursor-pointer"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={resetFraming}
                    title="Reset framing"
                    className="p-1.5 rounded bg-[#202225] text-[#d8dbe0] hover:bg-[#101113] cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {displayUrl && zoom > 1 && (
                <p className="mt-1.5 text-center font-mono text-[9px] text-[#e8e9eb] flex items-center justify-center gap-1">
                  <Move className="w-3 h-3" /> DRAG SCREEN TO PAN
                </p>
              )}

              <div className="mt-3 grid grid-cols-4 gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilterMode(f.id)}
                    aria-pressed={filterMode === f.id}
                    className={`py-1.5 rounded font-mono text-[8px] sm:text-[9px] font-black uppercase tracking-tight border-2 transition cursor-pointer ${
                      filterMode === f.id
                        ? "bg-[#781420] text-[#FAF4EB] border-[#261D24]"
                        : "bg-[#202225] text-[#9aa0a8] border-[#101113] hover:bg-[#2b2d31]"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-center gap-4">
                <input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleFileChange} className="hidden" />
                {!captureMode ? (
                  <button
                    type="button"
                    onClick={openFilePicker}
                    title="Import a photo or clip"
                    className="group relative w-16 h-16 rounded-full bg-[#e0433f] border-4 border-[#261D24] shadow-[5px_5px_0_#171B22] flex items-center justify-center hover:brightness-110 active:scale-95 active:shadow-none transition cursor-pointer"
                  >
                    <Aperture className="w-7 h-7 text-[#FAF4EB]" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={cancelCapture}
                      disabled={saving}
                      className="px-4 py-2.5 bg-[#202225] text-[#d8dbe0] border-2 border-[#101113] rounded font-mono text-xs font-black uppercase flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" /> Discard
                    </button>
                    <button
                      type="button"
                      onClick={saveCapture}
                      disabled={saving}
                      className="px-5 py-2.5 bg-[#781420] hover:bg-[#450A10] text-[#FAF4EB] border-2 border-[#261D24] rounded shadow-[3px_3px_0_#171B22] font-mono text-xs font-black uppercase flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save Shot
                    </button>
                  </>
                )}
              </div>
              {!captureMode && (
                <p className="mt-2 text-center font-mono text-[9px] text-[#e8e9eb]">
                  Shutter imports a photo or clip (image ≤8MB, video ≤20MB)
                </p>
              )}
            </div>
          </div>

          {/* ================= INFO + FILMSTRIP ================= */}
          <div className="space-y-6">
            <div className="polaroid-matte relative rotate-1 max-w-lg mx-auto lg:mx-0">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-20 h-5 tape-red-solid -rotate-2 pointer-events-none" />
              {captureMode || selectedItem ? (
                <div className="space-y-3">
                  <label className="block font-mono text-[10px] font-black text-[#7D2834] uppercase tracking-wider">Caption</label>
                  <input
                    value={captionDraft}
                    onChange={(e) => setCaptionDraft(e.target.value)}
                    placeholder="Caption this shot..."
                    className="w-full font-handwriting text-2xl text-[#1a0d10] bg-transparent border-b-2 border-[#C5A467] outline-none py-1"
                  />
                  <label className="block font-mono text-[10px] font-black text-[#7D2834] uppercase tracking-wider pt-2">Notes</label>
                  <textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    rows={3}
                    placeholder="Add a note on the back..."
                    className="w-full font-handwriting text-xl text-[#1a0d10] bg-transparent border-2 border-dashed border-[#C5A467] rounded p-2 outline-none resize-none"
                  />

                  <div className="flex items-center gap-2 pt-2">
                    {!captureMode && (
                      <>
                        <button
                          type="button"
                          onClick={saveEdits}
                          disabled={!isDirty || saving}
                          className="px-3.5 py-2 bg-[#7D2834] disabled:opacity-40 hover:bg-[#5A2029] text-[#F2E6D2] border-2 border-[#261D24] rounded font-mono text-[10px] font-black uppercase flex items-center gap-1.5 cursor-pointer"
                        >
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
                        </button>
                        <button
                          type="button"
                          onClick={deleteSelected}
                          disabled={deleting}
                          className="px-3.5 py-2 bg-[#3C1820] hover:bg-[#5A2029] text-[#E0B1AE] border-2 border-[#261D24] rounded font-mono text-[10px] font-black uppercase flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <p className="font-handwriting text-2xl text-stone-600 text-center py-6">Nothing loaded yet — take your first shot!</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] font-black text-[#ECA8B8] uppercase tracking-widest flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5" /> Camera Roll ({items.length})
                </span>
                <button
                  type="button"
                  onClick={openFilePicker}
                  className="flex items-center gap-1 text-[10px] font-mono font-black text-[#ECA8B8] hover:text-[#FAF4EB] cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Import
                </button>
              </div>

              {loading ? (
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map((n) => (
                    <div key={n} className="w-20 h-20 rounded bg-[#2b2231]/60 animate-pulse shrink-0" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <p className="font-mono text-[10px] text-[#8a7a80]">Empty roll. Your shots will line up here like a filmstrip.</p>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-2 timeline-horizontal-scroll">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectItem(item.id)}
                      title={item.caption || "Untitled shot"}
                      className={`relative shrink-0 w-20 h-20 rounded overflow-hidden border-2 transition cursor-pointer ${
                        effectiveSelectedId === item.id
                          ? "border-[#ECA8B8] shadow-[0_0_0_2px_#781420]"
                          : "border-[#261D24] opacity-80 hover:opacity-100"
                      }`}
                    >
                      {item.media_type === "video" ? (
                        <video src={item.url} muted playsInline preload="metadata" className="w-full h-full object-cover pointer-events-none" />
                      ) : (
                        <img src={item.url} alt={item.caption || "shot"} className="w-full h-full object-cover pointer-events-none" />
                      )}
                      {item.media_type === "video" && (
                        <span className="absolute bottom-0.5 right-0.5 bg-black/70 rounded p-0.5 pointer-events-none">
                          <Video className="w-2.5 h-2.5 text-white" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-[#5A2029] text-[#F2E6D2] text-xs font-mono flex items-center gap-2 border-2 border-[#261D24]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        <footer className="relative z-20 max-w-md mx-auto text-center mt-10">
          <span className="font-mono text-[10px] font-black text-[#261D24] uppercase tracking-widest bg-[#EAD9A9] px-4 py-1 border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] inline-block -rotate-1">
            EARTH-65 × EARTH-616 • RETRO DIGICAM ROLL
          </span>
        </footer>
      </main>
    </>
  );
}

function GlitchMedia({ url, type, zoom, panX, panY }: { url: string; type: string; zoom: number; panX: number; panY: number }) {
  const pos = `${panX}% ${panY}%`;
  const baseStyle: React.CSSProperties = { objectFit: "cover", objectPosition: pos, transform: `scale(${zoom})` };

  if (type === "video") {
    return (
      <div className="relative w-full h-full overflow-hidden bg-black">
        <video
          src={url}
          muted
          autoPlay
          loop
          playsInline
          style={{ ...baseStyle, filter: "contrast(1.25) saturate(0.4) brightness(0.95) hue-rotate(-8deg)" }}
          className="absolute inset-0 w-full h-full animate-glitch-a"
        />
        <div className="digicam-scanlines absolute inset-0 pointer-events-none opacity-70" />
      </div>
    );
  }

  const bgStyle = (extraFilter: string, opacity: number): React.CSSProperties => ({
    backgroundImage: `url(${url})`,
    backgroundSize: "cover",
    backgroundPosition: pos,
    transform: `scale(${zoom})`,
    filter: extraFilter,
    mixBlendMode: "screen",
    opacity,
  });

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      <img
        src={url}
        alt=""
        draggable={false}
        style={{ ...baseStyle, filter: "contrast(1.15) saturate(0.6) brightness(0.95)" }}
        className="absolute inset-0 w-full h-full"
      />
      <div className="absolute inset-0 animate-glitch-a pointer-events-none" style={bgStyle("hue-rotate(-40deg) saturate(4)", 0.55)} />
      <div className="absolute inset-0 animate-glitch-b pointer-events-none" style={bgStyle("hue-rotate(150deg) saturate(4)", 0.4)} />
      <div className="digicam-scanlines absolute inset-0 pointer-events-none opacity-70" />
    </div>
  );
}
