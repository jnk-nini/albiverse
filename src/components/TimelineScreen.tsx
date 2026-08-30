"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
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
  UploadCloud, 
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
  notes?: string;
  photo_scale?: number;
  photo_x?: number;
  photo_y?: number;
  photo_rotation?: number;
  photo_flip_h?: boolean;
  photo_flip_v?: boolean;
}

interface TimelineScreenProps {
  userId: string;
  coupleId: string;
  initialMemories?: PolaroidMemory[];
}

export default function TimelineScreen({
  userId,
  coupleId,
  initialMemories = [],
}: TimelineScreenProps) {
  const [memories, setMemories] = useState<PolaroidMemory[]>(initialMemories);
  const [loading, setLoading] = useState(initialMemories.length === 0);
  const [error, setError] = useState<string | null>(null);

  // Multiverse entry loading overlay
  const [isSpideyLoading, setIsSpideyLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formImagePreview, setFormImagePreview] = useState<string>("");
  const [formCaption, setFormCaption] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsSpideyLoading(false);
    }, 1100);
    return () => clearTimeout(timer);
  }, []);

  const fetchMemories = async () => {
    if (!coupleId) return;
    try {
      /* Explicit columns, not "*". `file_url` is a legacy duplicate of `url`
         that has always been written together with it (verified byte-identical
         on every row), so selecting both doubled the base64 payload of every
         photo for no benefit. Writes still populate both columns; only this
         read drops the copy, and the mapper below already falls through to
         `url` when `file_url` is absent. */
      const { data, error: fetchErr } = await supabase
        .from("media_items")
        .select(
          "id, url, caption, notes, created_at, photo_scale, photo_x, photo_y, photo_rotation, photo_flip_h, photo_flip_v"
        )
        .eq("couple_id", coupleId)
        .order("created_at", { ascending: true });

      if (fetchErr) throw fetchErr;

      const normalized: PolaroidMemory[] = (data || []).map((item: any) => ({
        id: item.id,
        url: item.file_url || item.url || "https://images.unsplash.com/photo-1518199266791-5375a83190b7?w=800&q=80",
        caption: item.caption || "Multiverse Memory",
        date: item.created_at
          ? new Date(item.created_at).toLocaleDateString([], {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "CANON",
        notes: item.notes || "",
        photo_scale: item.photo_scale ?? 1.0,
        photo_x: item.photo_x ?? 0,
        photo_y: item.photo_y ?? 0,
        photo_rotation: item.photo_rotation ?? 0,
        photo_flip_h: item.photo_flip_h ?? false,
        photo_flip_v: item.photo_flip_v ?? false,
      }));

      setMemories(normalized);
    } catch (err: any) {
      setError(err.message || "Failed to load timeline polaroids.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();

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
        () => fetchMemories()
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

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("Please choose a photo smaller than 10MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setFormImagePreview(event.target.result as string);
        setPhotoScale(1.0);
        setPhotoX(0);
        setPhotoY(0);
        setPhotoRotation(0);
        setPhotoFlipH(false);
        setPhotoFlipV(false);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleOpenCreate = () => {
    setEditingId(null);
    setFormImagePreview("");
    setFormCaption("");
    setFormNotes("");
    setPhotoScale(1.0);
    setPhotoX(0);
    setPhotoY(0);
    setPhotoRotation(0);
    setPhotoFlipH(false);
    setPhotoFlipV(false);
    setError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (m: PolaroidMemory, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(m.id);
    setFormImagePreview(m.url);
    setFormCaption(m.caption);
    setFormNotes(m.notes || "");
    setPhotoScale(m.photo_scale ?? 1.0);
    setPhotoX(m.photo_x ?? 0);
    setPhotoY(m.photo_y ?? 0);
    setPhotoRotation(m.photo_rotation ?? 0);
    setPhotoFlipH(m.photo_flip_h ?? false);
    setPhotoFlipV(m.photo_flip_v ?? false);
    setError(null);
    setIsModalOpen(true);
  };

  // Drag & Pan Handlers
  const handleMouseDownCrop = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingImage(true);
    dragStartPos.current = {
      x: e.clientX,
      y: e.clientY,
      startX: photoX,
      startY: photoY,
    };
  };

  const handleMouseMoveCrop = (e: React.MouseEvent) => {
    if (!isDraggingImage || !dragStartPos.current) return;
    const deltaX = e.clientX - dragStartPos.current.x;
    const deltaY = e.clientY - dragStartPos.current.y;
    setPhotoX(Math.max(-100, Math.min(100, dragStartPos.current.startX + deltaX / 2.5)));
    setPhotoY(Math.max(-100, Math.min(100, dragStartPos.current.startY + deltaY / 2.5)));
  };

  const handleMouseUpCrop = () => {
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
        caption: formCaption.trim() || "Timeline Memory ❤️",
        notes: formNotes.trim() || "",
        photo_scale: photoScale,
        photo_x: photoX,
        photo_y: photoY,
        photo_rotation: photoRotation,
        photo_flip_h: photoFlipH,
        photo_flip_v: photoFlipV,
      };

      if (editingId) {
        const { error: updateErr } = await supabase
          .from("media_items")
          .update(payload)
          .eq("id", editingId);

        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from("media_items")
          .insert(payload);

        if (insertErr) throw insertErr;
      }

      setIsModalOpen(false);
      setFormImagePreview("");
      setFormCaption("");
      setFormNotes("");
      setEditingId(null);
      await fetchMemories();
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
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (err: any) {
      setError(err.message || "Failed to delete polaroid.");
    }
  };

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
          href="/?opened=true&page=3&spread=1"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#F2E6D2] hover:bg-[#FAF7F2] text-[#261D24] text-xs sm:text-sm font-mono font-black border-3 border-[#261D24] shadow-[5px_5px_0_#171B22] -rotate-2 hover:rotate-0 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5 text-[#7D2834]" strokeWidth={3} />
          <span className="tracking-widest uppercase">Table of Contents (Page 3)</span>
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
                        className={`relative shrink-0 w-[290px] sm:w-[325px] ${tiltClass} hover:rotate-0 hover:-translate-y-2 transition duration-300`}
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
                                  <img
                                    src={m.url}
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
                                    className="w-full h-full object-contain pointer-events-none transition-transform duration-200"
                                  />
                                </div>

                                <div className="px-1 min-h-[48px] flex items-center justify-center text-center">
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
                        onMouseDown={handleMouseDownCrop}
                        onMouseMove={handleMouseMoveCrop}
                        onMouseUp={handleMouseUpCrop}
                        onMouseLeave={handleMouseUpCrop}
                        className={`relative w-64 h-64 aspect-square rounded bg-[#1A0D10] border-2 border-[#261D24] overflow-hidden select-none flex items-center justify-center ${
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
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] font-mono text-xs font-black border-3 border-[#261D24] shadow-[4px_4px_0_#171B24] flex items-center gap-2 transition disabled:opacity-50 cursor-pointer active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>{editingId ? "Update Polaroid" : "Pin to String"}</span>
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
    </main>
  );
}