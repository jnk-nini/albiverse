"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Save,
  X,
  AlertCircle,
  Loader2,
  Grid2x2Plus,
  Menu,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";

interface DigicamItem {
  id: string;
  couple_id: string;
  uploader_id: string;
  url: string;
  media_type: "image" | "video";
  caption: string;
  notes: string;
  created_at: string;
}

interface DigicamScreenProps {
  userId: string;
  coupleId: string;
  onBack: () => void;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20MB

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export default function DigicamScreen({ userId, coupleId, onBack }: DigicamScreenProps) {
  const supabase = createClient();

  const [items, setItems] = useState<DigicamItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editCaption, setEditCaption] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadItems = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("digicam_media")
      .select("id, couple_id, uploader_id, url, media_type, caption, notes, created_at")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: true });

    if (loadError) {
      setError(loadError.message);
    } else {
      const rows = (data ?? []) as DigicamItem[];
      setItems(rows);
      setCurrentIndex(rows.length ? rows.length - 1 : 0);
    }
    setLoading(false);
  }, [coupleId, supabase]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const currentItem = items[currentIndex];

  const [runPrev] = useGuardedAction(() => {
    setIsEditing(false);
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, 250);

  const [runNext] = useGuardedAction(() => {
    setIsEditing(false);
    setCurrentIndex((i) => Math.min(items.length - 1, i + 1));
  }, 250);

  const [runUpload, uploading] = useGuardedAction(async (file: File) => {
    setError(null);
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");

    if (!isVideo && !isImage) {
      setError("Only image or video files can go in the digicam roll.");
      return;
    }
    const cap = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > cap) {
      setError(`That file is too big — keep ${isVideo ? "clips" : "photos"} under ${cap / (1024 * 1024)}MB.`);
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    const { error: insertError } = await supabase.from("digicam_media").insert({
      couple_id: coupleId,
      uploader_id: userId,
      url: dataUrl,
      media_type: isVideo ? "video" : "image",
      caption: "",
      notes: "",
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }
    await loadItems();
  }, 800);

  const [runDelete, deleting] = useGuardedAction(async () => {
    if (!currentItem) return;
    if (!confirm("Delete this snapshot for good?")) return;

    const { error: deleteError } = await supabase.from("digicam_media").delete().eq("id", currentItem.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setIsEditing(false);
    await loadItems();
  }, 500);

  const openEdit = () => {
    if (!currentItem) return;
    setEditCaption(currentItem.caption ?? "");
    setEditNotes(currentItem.notes ?? "");
    setIsEditing((v) => !v);
  };

  const [runSaveEdit, saving] = useGuardedAction(async () => {
    if (!currentItem) return;
    const { error: updateError } = await supabase
      .from("digicam_media")
      .update({
        caption: editCaption.trim(),
        notes: editNotes.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentItem.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setIsEditing(false);
    await loadItems();
  }, 500);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) runUpload(file);
  };

  return (
    <>
      <style>{`
        @keyframes digicamFlashPop {
          0% { transform: scale(0.2) rotate(-10deg); opacity: 0; }
          35% { opacity: 1; }
          70% { transform: scale(1.6) rotate(8deg); opacity: 0.95; }
          100% { transform: scale(2.4) rotate(20deg); opacity: 0; }
        }
        .animate-digicam-flash { animation: digicamFlashPop 1.3s cubic-bezier(0.16,1,0.3,1) forwards; }

        @keyframes digicamParticleFly {
          0% { transform: translate(0,0) scale(0.3) rotate(0deg); opacity: 0; }
          25% { opacity: 1; }
          100% { transform: translate(var(--fly-x), var(--fly-y)) scale(1.5) rotate(360deg); opacity: 0; }
        }
        .animate-digicam-particle { animation: digicamParticleFly 1.4s cubic-bezier(0.16,1,0.3,1) forwards; }

        @keyframes digicamPolaroidSwing {
          0% { transform: rotate(0deg) translateY(-40px); opacity: 0; }
          40% { opacity: 1; }
          60% { transform: rotate(10deg) translateY(0); }
          80% { transform: rotate(-6deg); }
          100% { transform: rotate(2deg); opacity: 1; }
        }
        .animate-digicam-polaroid { animation: digicamPolaroidSwing 1.1s cubic-bezier(0.34,1.56,0.64,1) forwards; transform-origin: top center; }

        @keyframes digicamBurstRing {
          0% { transform: scale(0.3); opacity: 0; }
          40% { opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .animate-digicam-burst-ring { animation: digicamBurstRing 1.8s ease-out infinite; }

        .digicam-y2k-popup {
          animation: y2kPopupIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards;
        }
        @keyframes y2kPopupIn {
          0% { transform: translateY(14px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      <main className="min-h-screen bg-[#181114] p-4 sm:p-8 flex flex-col items-center relative overflow-hidden select-none">
        <div className="fixed top-8 animate-crawl-h text-xl z-10 pointer-events-none">🕷️</div>
        <div className="fixed animate-crawl-d text-2xl z-10 pointer-events-none">🕷️</div>
        <div className="fixed left-4 animate-crawl-v text-lg z-10 pointer-events-none">🕷️</div>

        {/* ================= CH.04 MASSIVE SPIDEY-THEMED LOADING SCREEN ================= */}
        {loading ? (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm overflow-hidden">
            {/* Radial bursts */}
            <div className="absolute w-[550px] h-[550px] sm:w-[850px] sm:h-[850px] rounded-full border-4 border-dashed border-[#D9889E] opacity-70 animate-digicam-burst-ring" />
            <div className="absolute w-[350px] h-[350px] sm:w-[550px] sm:h-[550px] rounded-full border-4 border-dotted border-[#ECA8B8]/60 opacity-60 animate-digicam-burst-ring" style={{ animationDelay: "0.4s" }} />

            {/* Hanging spider */}
            <div className="absolute top-0 left-[15%] pointer-events-none animate-hanging-bounce">
              <div className="w-[2px] h-28 bg-[#BD7F89] mx-auto border-l border-dashed border-white/60" />
              <div className="text-4xl -mt-1 text-center">🕷️</div>
            </div>
            <div className="absolute top-0 right-[18%] pointer-events-none animate-hanging-bounce" style={{ animationDelay: "-1.6s" }}>
              <div className="w-[2px] h-36 bg-[#BD7F89] mx-auto border-l border-dashed border-white/60" />
              <div className="text-3xl -mt-1 text-center">🕷️</div>
            </div>

            {/* Patrol bot */}
            <div className="absolute top-16 animate-spiderbot-patrol text-3xl pointer-events-none">🤖🕸️</div>

            {/* Web-slinging polaroids */}
            <div className="absolute left-[10%] top-[22%] polaroid-matte w-24 sm:w-32 animate-digicam-polaroid" style={{ animationDelay: "0.15s" }}>
              <div className="w-full aspect-square bg-gradient-to-br from-[#7D2834] to-[#2E0509]" />
            </div>
            <div className="absolute right-[10%] top-[26%] polaroid-matte w-20 sm:w-28 animate-digicam-polaroid" style={{ animationDelay: "0.35s" }}>
              <div className="w-full aspect-square bg-gradient-to-br from-[#D9889E] to-[#450A10]" />
            </div>

            {/* Flying flash / snap particles */}
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
                style={{ "--fly-x": p.x, "--fly-y": p.y, animationDelay: `${idx * 0.06}s` } as React.CSSProperties}
                className="absolute font-marker text-2xl sm:text-4xl text-[#FAF4EB] drop-shadow-[0_0_14px_#781420] animate-digicam-particle select-none pointer-events-none"
              >
                {p.text}
              </span>
            ))}

            {/* Central comic pop bubble */}
            <div className="relative z-10 flex flex-col items-center justify-center animate-comic-pop">
              <div className="bg-[#781420] border-4 border-[#FAF4EB] shadow-[10px_10px_0_#17131A] px-7 py-4 rounded-2xl -rotate-2 flex items-center gap-4">
                <span className="text-4xl animate-digicam-flash">📷</span>
                <div>
                  <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#ECA8B8] block">
                    CH.04 • RETRO DIGICAM
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
              className="hidden"
              onChange={handleFileChange}
            />

            <header className="w-full max-w-md flex items-center justify-between mb-5 z-20">
              <button
                onClick={onBack}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#F2E6D2] hover:bg-[#FAF7F2] text-[#261D24] text-xs font-mono font-black border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] -rotate-1 transition cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4 text-[#781420]" />
                <span>BACK</span>
              </button>
              <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#ECA8B8]">
                CH.04 • RETRO DIGICAM
              </span>
            </header>

            {error && (
              <div className="w-full max-w-md mb-4 p-3 rounded bg-[#5A2029] text-[#F2E6D2] text-xs font-mono flex items-center gap-2 border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] z-20">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="flex-1">{error}</span>
                <button onClick={() => setError(null)} className="cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* ================= DIGICAM CHASSIS (real PNG asset) ================= */}
            <div className="relative w-full max-w-[380px] z-20" style={{ aspectRatio: "1080 / 1698" }}>
              <img
                src="/images/digicam.png"
                alt="Retro digicam"
                className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                draggable={false}
              />

              {/* Photo/video content, inset within the LCD screen area of the PNG */}
              <div
                className="absolute overflow-hidden rounded-sm bg-black"
                style={{ left: "9.5%", right: "14%", top: "13.5%", bottom: "40.5%" }}
              >
                {currentItem ? (
                  currentItem.media_type === "video" ? (
                    <video
                      src={currentItem.url}
                      controls
                      className="absolute inset-0 w-full h-full object-cover bg-black"
                    />
                  ) : (
                    <img
                      src={currentItem.url}
                      alt={currentItem.caption || "Digicam snapshot"}
                      className="absolute inset-0 w-full h-full object-cover bg-black"
                    />
                  )
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center px-3 bg-[#1b1d21]">
                    <span className="text-2xl">📷</span>
                    <span className="font-mono text-[9px] text-[#8faeaa] uppercase tracking-wide leading-tight">
                      No snapshots — tap the gallery button
                    </span>
                  </div>
                )}

                {items.length > 0 && (
                  <span className="absolute top-1 right-1.5 font-mono text-[8px] font-black text-[#c9f2c0] bg-black/50 px-1 py-0.5 rounded">
                    {currentIndex + 1}/{items.length}
                  </span>
                )}
                {currentItem && (
                  <span className="absolute top-1 left-1.5 font-mono text-[8px] font-black text-[#c9f2c0] bg-black/50 px-1 py-0.5 rounded">
                    {new Date(currentItem.created_at).toLocaleDateString()}
                  </span>
                )}

                {/* Y2K caption/notes pop-up, contained inside the LCD screen */}
                {currentItem && (currentItem.caption || currentItem.notes || isEditing) && (
                  <div className="digicam-y2k-popup absolute left-1 right-1 bottom-1 bg-black/85 border border-[#8faeaa]/50 rounded backdrop-blur-xs">
                    {!isEditing ? (
                      <div className="px-2 py-1.5">
                        {currentItem.caption && (
                          <p className="font-mono text-[8px] uppercase tracking-widest text-[#ECA8B8] truncate">
                            {currentItem.caption}
                          </p>
                        )}
                        {currentItem.notes && (
                          <p className="font-handwriting text-xs text-[#F2E6D2]/90 leading-tight line-clamp-2">
                            {currentItem.notes}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="p-2 flex flex-col gap-1.5">
                        <input
                          value={editCaption}
                          onChange={(e) => setEditCaption(e.target.value)}
                          placeholder="Caption..."
                          maxLength={120}
                          className="w-full bg-black/40 border border-[#8faeaa]/50 rounded px-1.5 py-1 font-mono text-[9px] text-[#F2E6D2] outline-none focus:border-[#ECA8B8]"
                        />
                        <textarea
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          placeholder="Notes..."
                          rows={2}
                          maxLength={500}
                          className="w-full bg-black/40 border border-[#8faeaa]/50 rounded px-1.5 py-1 font-mono text-[9px] text-[#F2E6D2] outline-none resize-none focus:border-[#ECA8B8]"
                        />
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setIsEditing(false)}
                            className="font-mono text-[8px] uppercase text-[#ECA8B8]/80 px-1.5 py-0.5 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => runSaveEdit()}
                            className="inline-flex items-center gap-1 font-mono text-[8px] font-black uppercase bg-[#781420] text-[#F2E6D2] px-1.5 py-1 rounded disabled:opacity-50 cursor-pointer"
                          >
                            {saving ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />}
                            Save
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ============ Controls mapped onto the PNG's physical buttons ============ */}

              {/* Delete — trash icon, top-left of the button cluster */}
              <button
                onClick={() => runDelete()}
                disabled={!currentItem || deleting}
                title="Delete"
                className="absolute w-[9.5%] aspect-square rounded-full -translate-x-1/2 -translate-y-1/2 flex items-center justify-center text-white bg-black/35 hover:bg-black/55 shadow-[0_0_0_1.5px_rgba(255,255,255,0.4)] active:scale-90 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                style={{ left: "10.5%", top: "79%" }}
              >
                {deleting ? <Loader2 className="w-[50%] h-[50%] animate-spin" /> : <Trash2 className="w-[50%] h-[50%]" />}
              </button>

              {/* Edit — MENU button */}
              <button
                onClick={openEdit}
                disabled={!currentItem}
                title="Edit caption & notes"
                className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center text-white bg-black/35 hover:bg-black/55 shadow-[0_0_0_1.5px_rgba(255,255,255,0.4)] active:scale-90 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer rounded-full"
                style={{ left: "56.5%", top: "79.5%", width: "13%", aspectRatio: "2/1" }}
              >
                <Menu className="w-[40%] h-[40%]" />
              </button>

              {/* Upload — grid/index button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Add a snapshot"
                className="absolute w-[9%] aspect-square rounded-full -translate-x-1/2 -translate-y-1/2 flex items-center justify-center text-white bg-black/35 hover:bg-black/55 shadow-[0_0_0_1.5px_rgba(255,255,255,0.4)] active:scale-90 transition disabled:opacity-60 cursor-pointer"
                style={{ left: "77%", top: "80.5%" }}
              >
                {uploading ? <Loader2 className="w-[50%] h-[50%] animate-spin" /> : <Grid2x2Plus className="w-[50%] h-[50%]" />}
              </button>

              {/* Previous — left D-pad arrow */}
              <button
                onClick={() => runPrev()}
                disabled={currentIndex <= 0}
                title="Previous"
                className="absolute w-[10.5%] aspect-square rounded-full -translate-x-1/2 -translate-y-1/2 flex items-center justify-center text-white bg-black/35 hover:bg-black/55 shadow-[0_0_0_1.5px_rgba(255,255,255,0.4)] active:scale-90 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                style={{ left: "23.5%", top: "86.5%" }}
              >
                <ChevronLeft className="w-[55%] h-[55%]" strokeWidth={3} />
              </button>

              {/* Next — right D-pad arrow */}
              <button
                onClick={() => runNext()}
                disabled={currentIndex >= items.length - 1}
                title="Next"
                className="absolute w-[10.5%] aspect-square rounded-full -translate-x-1/2 -translate-y-1/2 flex items-center justify-center text-white bg-black/35 hover:bg-black/55 shadow-[0_0_0_1.5px_rgba(255,255,255,0.4)] active:scale-90 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                style={{ left: "42.5%", top: "86.5%" }}
              >
                <ChevronRight className="w-[55%] h-[55%]" strokeWidth={3} />
              </button>
            </div>

            <footer className="max-w-md mx-auto text-center z-20 mt-6">
              <span className="font-mono text-[10px] font-black text-[#261D24] uppercase tracking-widest bg-[#EAD9A9] px-4 py-1 border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] inline-block -rotate-1">
                EARTH-65 × EARTH-616 • RETRO DIGICAM ROLL
              </span>
            </footer>
          </>
        )}
      </main>
    </>
  );
}
