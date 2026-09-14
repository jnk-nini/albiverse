"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2, Newspaper, PenLine, Plus, Sparkles, Waypoints, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";
import {
  investigationInsight,
  playPop,
  playThwip,
  useTypewriter,
  type WishlistClue,
  type WishlistEdge,
} from "@/lib/wishlistLab";
import { compressImage, dataUrlToBlob, readFileAsDataUrl as blobToDataUrl } from "@/lib/media/mediaPrep";
import {
  getStorageBlob,
  isStorageRef,
  removeFromStorage,
  storagePathOf,
  toStorageRef,
  uploadToStorage,
  vaultObjectPath,
} from "@/lib/media/storage";

/* ============================================================================
   THE INVESTIGATION BOARD - "Cracking the Partner's Code"

   A detective corkboard: diverse clue cards (photo snippets, torn magazine
   ads, handwritten observations, quick diagrams) pinned wherever you drop
   them, wired together with a draggable red String Synergy Matrix. Once
   enough strings connect, a pulsing matrix appears at the board's center and
   the two most-connected clues generate a templated "GIFT IDEA INSIGHT".

   Storage: two more partner_vault sections alongside 'wishlist' - 'wishlist_
   clues' (one row per clue) and 'wishlist_connections' (one singleton row
   holding the edge list). Same owner-only RLS, no migration needed - see
   WishlistScreen.tsx's note on partner_vault being schema-less jsonb. */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const EDGES_KEY = "wishlist_connections_singleton";
const INSIGHT_THRESHOLD = 2;

function decodeClue(row: Record<string, unknown>): WishlistClue {
  const c = (row.content_json as Record<string, unknown>) || {};
  const media = row.media_urls as string[] | null;
  return {
    id: row.id as string,
    type: (c.type as WishlistClue["type"]) || "note",
    text: (c.text as string) || "",
    image: Array.isArray(media) && media[0] ? media[0] : null,
    x: typeof c.x === "number" ? (c.x as number) : 45,
    y: typeof c.y === "number" ? (c.y as number) : 40,
    rotation: typeof c.rotation === "number" ? (c.rotation as number) : 0,
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

const CLUE_CHROME: Record<WishlistClue["type"], { icon: typeof PenLine; bg: string; label: string }> = {
  photo: { icon: Camera, bg: "#efe6d8", label: "Photo" },
  clipping: { icon: Newspaper, bg: "#e9dcc0", label: "Clipping" },
  note: { icon: PenLine, bg: "#fdf3d9", label: "Note" },
  diagram: { icon: ImageIcon, bg: "#e3ece8", label: "Diagram" },
};

export default function WishlistBoard({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [clues, setClues] = useState<WishlistClue[]>([]);
  const [edges, setEdges] = useState<WishlistEdge[]>([]);
  const [edgesRowId, setEdgesRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const boardRef = useRef<HTMLDivElement>(null);
  const clueRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /* Storage-backed clue photos ("storage:<path>" refs) resolved to a
     displayable data URL, keyed by the raw ref string. Clue images are never
     edited after creation, so `clues` itself never needs the resolved value -
     only the board-pin render does, via `displayClues` below. */
  const [photoSrcCache, setPhotoSrcCache] = useState<Record<string, string>>({});
  const resolvingPhotos = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pending: string[] = [];
    for (const clue of clues) {
      if (clue.image && isStorageRef(clue.image) && !resolvingPhotos.current.has(clue.image)) {
        pending.push(clue.image);
      }
    }
    if (pending.length === 0) return;
    pending.forEach((ref) => resolvingPhotos.current.add(ref));

    void Promise.all(
      pending.map(async (ref) => {
        try {
          const blob = await getStorageBlob(supabase, storagePathOf(ref));
          return { ref, dataUrl: await blobToDataUrl(blob) };
        } catch {
          return { ref, dataUrl: "" };
        }
      })
    ).then((resolved) => {
      setPhotoSrcCache((prev) => {
        const next = { ...prev };
        for (const r of resolved) if (r.dataUrl) next[r.ref] = r.dataUrl;
        return next;
      });
    });
  }, [clues, supabase]);

  const displayClues = useMemo(
    () =>
      clues.map((c) =>
        c.image && isStorageRef(c.image) ? { ...c, image: photoSrcCache[c.image] || null } : c
      ),
    [clues, photoSrcCache]
  );

  const load = useCallback(async () => {
    const [clueRes, edgeRes] = await Promise.all([
      supabase
        .from("partner_vault")
        .select("*")
        .eq("owner_id", userId)
        .eq("section_type", "wishlist_clues")
        .order("created_at", { ascending: true }),
      supabase
        .from("partner_vault")
        .select("*")
        .eq("owner_id", userId)
        .eq("section_type", "wishlist_connections")
        .eq("key_name", EDGES_KEY)
        .maybeSingle(),
    ]);
    if (clueRes.data) setClues(clueRes.data.map(decodeClue));
    if (edgeRes.data) {
      setEdgesRowId(edgeRes.data.id as string);
      const c = (edgeRes.data.content_json as Record<string, unknown>) || {};
      setEdges(Array.isArray(c.edges) ? (c.edges as WishlistEdge[]) : []);
    }
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const persistEdges = async (next: WishlistEdge[]) => {
    setEdges(next);
    if (edgesRowId) {
      await supabase
        .from("partner_vault")
        .update({ content_json: { edges: next } })
        .eq("id", edgesRowId)
        .eq("owner_id", userId);
    } else {
      const { data } = await supabase
        .from("partner_vault")
        .insert({
          owner_id: userId,
          section_type: "wishlist_connections",
          key_name: EDGES_KEY,
          content_json: { edges: next },
          media_urls: [],
        })
        .select()
        .single();
      if (data) setEdgesRowId(data.id as string);
    }
  };

  /* ---------------------------------------------------------- add clue */

  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [composerType, setComposerType] = useState<WishlistClue["type"] | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);

  const onBoardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    longPressStart.current = { x: e.clientX, y: e.clientY };
    longPressTimer.current = window.setTimeout(() => {
      const box = boardRef.current?.getBoundingClientRect();
      if (!box) return;
      setAddMenu({
        x: ((e.clientX - box.left) / box.width) * 100,
        y: ((e.clientY - box.top) / box.height) * 100,
      });
    }, 480);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const [runAddClue, addingClue] = useGuardedAction(
    async (payload: { type: WishlistClue["type"]; text: string; image: string | null }) => {
      if (!addMenu) return;
      let ref: string | null = null;
      if (payload.image) {
        const blob = await dataUrlToBlob(payload.image);
        const path = await uploadToStorage(supabase, vaultObjectPath(userId, "wishlist-board", "clue.jpg"), blob);
        ref = toStorageRef(path);
      }
      const { data, error } = await supabase
        .from("partner_vault")
        .insert({
          owner_id: userId,
          section_type: "wishlist_clues",
          key_name: `clue_${crypto.randomUUID()}`,
          content_json: {
            type: payload.type,
            text: payload.text,
            x: addMenu.x,
            y: addMenu.y,
            rotation: Math.round((Math.random() * 10 - 5) * 10) / 10,
          },
          media_urls: ref ? [ref] : [],
        })
        .select()
        .single();
      if (error && ref) void removeFromStorage(supabase, storagePathOf(ref));
      if (data) setClues((prev) => [...prev, decodeClue(data)]);
      setComposerType(null);
      setAddMenu(null);
    },
    300
  );

  const deleteClue = async (id: string) => {
    const target = clues.find((c) => c.id === id);
    setClues((prev) => prev.filter((c) => c.id !== id));
    await persistEdges(edges.filter((e) => e.a !== id && e.b !== id));
    await supabase.from("partner_vault").delete().eq("id", id).eq("owner_id", userId);
    if (isStorageRef(target?.image)) void removeFromStorage(supabase, storagePathOf(target!.image!));
  };

  /* -------------------------------------------------------- drag to pin */

  const [dragId, setDragId] = useState<string | null>(null);

  const startDragClue = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragId(id);
  };

  const onBoardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = boardRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = Math.max(2, Math.min(94, ((e.clientX - box.left) / box.width) * 100));
    const py = Math.max(2, Math.min(90, ((e.clientY - box.top) / box.height) * 100));

    if (dragId) {
      setClues((prev) => prev.map((c) => (c.id === dragId ? { ...c, x: px, y: py } : c)));
    } else if (connectingFrom) {
      setConnectLinePos({ x: e.clientX - box.left, y: e.clientY - box.top });
    } else if (longPressStart.current) {
      const dx = e.clientX - longPressStart.current.x;
      const dy = e.clientY - longPressStart.current.y;
      if (Math.hypot(dx, dy) > 8) cancelLongPress();
    }
  };

  const onBoardPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    cancelLongPress();
    if (dragId) {
      const target = clues.find((c) => c.id === dragId);
      setDragId(null);
      if (target) {
        await supabase
          .from("partner_vault")
          .update({ content_json: { type: target.type, text: target.text, x: target.x, y: target.y, rotation: target.rotation } })
          .eq("id", target.id)
          .eq("owner_id", userId);
      }
      return;
    }
    if (connectingFrom) {
      const hit = Object.entries(clueRefs.current).find(([id, el]) => {
        if (!el || id === connectingFrom) return false;
        const r = el.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      if (hit) {
        const [targetId] = hit;
        const exists = edges.some(
          (edge) => (edge.a === connectingFrom && edge.b === targetId) || (edge.a === targetId && edge.b === connectingFrom)
        );
        if (!exists) {
          playThwip();
          await persistEdges([...edges, { a: connectingFrom, b: targetId }]);
        }
      }
      setConnectingFrom(null);
      setConnectLinePos(null);
    }
  };

  /* --------------------------------------------------------- stringing */

  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectLinePos, setConnectLinePos] = useState<{ x: number; y: number } | null>(null);

  const startConnecting = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setConnectingFrom(id);
    const box = boardRef.current?.getBoundingClientRect();
    if (box) setConnectLinePos({ x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const connectedIds = useMemo(() => {
    const s = new Set<string>();
    edges.forEach((e) => {
      s.add(e.a);
      s.add(e.b);
    });
    return s;
  }, [edges]);

  const centerOf = (id: string) => {
    const c = clues.find((cl) => cl.id === id);
    return c ? { x: c.x, y: c.y } : { x: 50, y: 50 };
  };

  /* ---------------------------------------------------------- insight */

  const insightText = useMemo(
    () => (edges.length >= INSIGHT_THRESHOLD ? investigationInsight(clues, edges) : null),
    [clues, edges]
  );
  const [seenInsight, setSeenInsight] = useState<string | null>(null);
  const [showInsight, setShowInsight] = useState(false);

  useEffect(() => {
    if (insightText && insightText !== seenInsight) {
      setSeenInsight(insightText);
      setShowInsight(true);
      playPop();
    }
  }, [insightText, seenInsight]);

  const typedInsight = useTypewriter(showInsight ? insightText ?? "" : "", 14);

  return (
    <div
      ref={boardRef}
      className="relative w-full min-h-[70vh] rounded-lg overflow-hidden select-none touch-none"
      style={{
        backgroundColor: "#6b4a30",
        backgroundImage:
          "radial-gradient(rgba(0,0,0,0.25) 1px, transparent 1px), linear-gradient(160deg, rgba(0,0,0,0.15), transparent 60%)",
        backgroundSize: "5px 5px, auto",
      }}
      onPointerDown={onBoardPointerDown}
      onPointerMove={onBoardPointerMove}
      onPointerUp={onBoardPointerUp}
      onPointerLeave={cancelLongPress}
    >
      <style>{`
        @keyframes wib-ring { 0% { transform: scale(0.6); opacity: 0.9; } 100% { transform: scale(2.4); opacity: 0; } }
        .wib-ring { animation: wib-ring 2.2s ease-out infinite; }
        @keyframes wib-glow { 0%,100% { box-shadow: 0 0 0 rgba(224,177,174,0); } 50% { box-shadow: 0 0 16px 3px rgba(224,177,174,0.55); } }
        .wib-glow { animation: wib-glow 1.6s ease-in-out infinite; }
        @keyframes wib-pop { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        .wib-pop { animation: wib-pop 0.3s ease-out forwards; }
      `}</style>

      {clues.length === 0 && !addMenu && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 pointer-events-none">
          <Waypoints className="w-8 h-8 text-[#F2E6D2]/50" />
          <p className="font-marker text-lg text-[#F2E6D2]/70">The board is empty</p>
          <p className="font-mono text-[9px] text-[#F2E6D2]/40 uppercase tracking-wide max-w-[30ch]">
            Long-press anywhere to pin your first clue
          </p>
        </div>
      )}

      {/* connections */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
        {edges.map((edge, i) => {
          const a = centerOf(edge.a);
          const b = centerOf(edge.b);
          return (
            <line
              key={i}
              x1={`${a.x}%`}
              y1={`${a.y}%`}
              x2={`${b.x}%`}
              y2={`${b.y}%`}
              stroke="#B23A46"
              strokeWidth={2}
              opacity={0.75}
            />
          );
        })}
        {connectingFrom && connectLinePos && (
          <line
            x1={`${centerOf(connectingFrom).x}%`}
            y1={`${centerOf(connectingFrom).y}%`}
            x2={connectLinePos.x}
            y2={connectLinePos.y}
            stroke="#F2E6D2"
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        )}
      </svg>

      {/* disconnect control - a small button at each string's midpoint, so
          connecting (drag from the red nub) and disconnecting (tap this) are
          both one deliberate action rather than the string being permanent
          once drawn. */}
      {edges.map((edge, i) => {
        const a = centerOf(edge.a);
        const b = centerOf(edge.b);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        return (
          <button
            key={`disconnect-${edge.a}-${edge.b}`}
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => persistEdges(edges.filter((_, idx) => idx !== i))}
            aria-label="Remove this connection"
            title="Remove this connection"
            className="absolute z-[15] w-5 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#20161A] border border-[#F2E6D2]/60 text-[#F2E6D2]/70 hover:bg-[#B23A46] hover:text-[#F2E6D2] hover:border-[#F2E6D2] hover:scale-125 flex items-center justify-center cursor-pointer transition"
            style={{ left: `${midX}%`, top: `${midY}%` }}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        );
      })}

      {/* central pulsing matrix once enough strings connect */}
      {edges.length >= 3 && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-0 pointer-events-none">
          {[0, 0.7, 1.4].map((delay) => (
            <span
              key={delay}
              className="wib-ring absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full border-2 border-[#E0B1AE]"
              style={{ animationDelay: `${delay}s` }}
            />
          ))}
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[#E0B1AE] opacity-80" />
        </div>
      )}

      {/* clue cards */}
      {displayClues.map((clue) => {
        const chrome = CLUE_CHROME[clue.type];
        const Icon = chrome.icon;
        return (
          <div
            key={clue.id}
            ref={(el) => {
              clueRefs.current[clue.id] = el;
            }}
            className={`group absolute z-20 w-28 sm:w-32 p-2 shadow-[3px_4px_8px_rgba(0,0,0,0.5)] cursor-grab active:cursor-grabbing ${
              connectedIds.has(clue.id) ? "wib-glow" : ""
            }`}
            style={{
              left: `${clue.x}%`,
              top: `${clue.y}%`,
              transform: `translate(-50%,-50%) rotate(${clue.rotation}deg)`,
              backgroundColor: chrome.bg,
            }}
            onPointerDown={(e) => startDragClue(e, clue.id)}
          >
            <div className="flex items-center gap-1 mb-1">
              <Icon className="w-3 h-3 text-[#5A2029]" />
              <span className="font-mono text-[7px] font-black uppercase tracking-widest text-[#5A2029]/70">
                {chrome.label}
              </span>
              {/* Visible by default and merely emphasised on hover: gating it
                  purely on group-hover made it unreachable on any touch
                  device, since no hover state ever fires there. */}
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => deleteClue(clue.id)}
                aria-label="Remove this clue"
                className="ml-auto opacity-60 group-hover:opacity-100 focus-visible:opacity-100 text-[#5A2029]/70 hover:text-[#5A2029] cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {clue.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clue.image} alt="" className="w-full aspect-square object-cover mb-1" draggable={false} />
            )}
            {clue.text && (
              <p className="font-handwriting text-sm leading-tight text-[#2a1418] line-clamp-3">{clue.text}</p>
            )}
            {/* connector nub */}
            <button
              type="button"
              aria-label="Drag a string from this clue"
              onPointerDown={(e) => startConnecting(e, clue.id)}
              className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#B23A46] border-2 border-[#F2E6D2] cursor-crosshair"
            />
          </div>
        );
      })}

      {/* add-clue radial menu */}
      {addMenu && !composerType && (
        <div
          className="absolute z-30 wib-pop"
          style={{ left: `${addMenu.x}%`, top: `${addMenu.y}%`, transform: "translate(-50%,-50%)" }}
        >
          <div className="flex flex-col gap-1 bg-[#20161A] border-2 border-[#F2E6D2]/40 rounded-lg p-1.5 shadow-xl">
            {(Object.keys(CLUE_CHROME) as WishlistClue["type"][]).map((t) => {
              const Icon = CLUE_CHROME[t].icon;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setComposerType(t)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded font-mono text-[9px] font-black uppercase tracking-wide text-[#F2E6D2] hover:bg-[#F2E6D2]/10 cursor-pointer"
                >
                  <Icon className="w-3.5 h-3.5" /> {CLUE_CHROME[t].label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setAddMenu(null)}
              className="px-2.5 py-1 font-mono text-[8px] uppercase text-[#F2E6D2]/50 hover:text-[#F2E6D2] cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {composerType && (
        <ClueComposer
          type={composerType}
          busy={addingClue}
          onCancel={() => {
            setComposerType(null);
            setAddMenu(null);
          }}
          onSave={(text, image) => runAddClue({ type: composerType, text, image })}
        />
      )}

      {/* GIFT IDEA INSIGHT */}
      {showInsight && insightText && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/70" onClick={() => setShowInsight(false)}>
          <div
            className="wib-pop max-w-sm w-full bg-[#FAF6EE] border-4 border-[#261D24] shadow-[10px_10px_0_rgba(0,0,0,0.7)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="flex items-center gap-2 font-mono text-[10px] font-black uppercase tracking-widest text-[#7D2834] mb-2">
              <Sparkles className="w-3.5 h-3.5" /> Gift Idea Insight
            </p>
            <p className="font-handwriting text-xl text-[#1A0D10] leading-snug whitespace-pre-line min-h-[4.5rem]">
              {typedInsight}
              <span className="animate-pulse">▍</span>
            </p>
            <button
              type="button"
              onClick={() => setShowInsight(false)}
              className="mt-3 w-full py-1.5 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] font-mono text-[10px] font-black uppercase tracking-widest cursor-pointer"
            >
              Close file
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() =>
          // Scattered rather than dead-center every time - clicking this
          // repeatedly used to stack every new clue exactly on top of the
          // last one, making them indistinguishable and hard to grab.
          setAddMenu({ x: 25 + Math.random() * 50, y: 20 + Math.random() * 50 })
        }
        className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1.5 px-3 py-2 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] text-[10px] font-mono font-black uppercase tracking-widest border-2 border-[#261D24] cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5" /> Add Clue
      </button>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Loader2 className="w-6 h-6 animate-spin text-[#F2E6D2]" />
        </div>
      )}
    </div>
  );
}

function ClueComposer({
  type,
  busy,
  onCancel,
  onSave,
}: {
  type: WishlistClue["type"];
  busy: boolean;
  onCancel: () => void;
  onSave: (text: string, image: string | null) => void;
}) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsPhoto = type === "photo" || type === "diagram";

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`Keep it under ${MAX_IMAGE_BYTES / (1024 * 1024)}MB.`);
      return;
    }
    setError(null);
    const prepared = await compressImage(file, { maxEdge: 1000, targetBytes: 350_000 });
    setImage(prepared.dataUrl);
  };

  const canSave = needsPhoto ? !!image : text.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/70" onClick={onCancel}>
      <div
        className="w-full max-w-sm bg-[#FAF6EE] border-4 border-[#261D24] shadow-[10px_10px_0_rgba(0,0,0,0.7)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-mono text-[10px] font-black uppercase tracking-widest text-[#7D2834] mb-3">
          Add {CLUE_CHROME[type].label}
        </p>
        {needsPhoto ? (
          <label className="block border-2 border-dashed border-[#7D2834]/50 rounded p-4 text-center cursor-pointer hover:border-[#7D2834]">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="w-full aspect-square object-cover" />
            ) : (
              <span className="font-mono text-[10px] uppercase text-stone-500">Tap to choose a photo</span>
            )}
          </label>
        ) : null}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            type === "note"
              ? "Mentioned they needed a new sweater…"
              : type === "clipping"
                ? "Circled this in a magazine…"
                : "Optional caption…"
          }
          rows={3}
          maxLength={200}
          className="w-full mt-3 bg-white border-2 border-[#261D24]/30 focus:border-[#261D24] outline-none px-2.5 py-2 font-handwriting text-lg text-[#1A0D10] rounded resize-none"
        />
        {error && <p className="text-xs text-[#7D2834] font-mono mt-1">{error}</p>}
        <div className="flex items-center justify-end gap-3 mt-3">
          <button
            type="button"
            onClick={onCancel}
            className="font-mono text-[9px] font-black uppercase text-stone-600 hover:text-[#7D2834] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave || busy}
            onClick={() => onSave(text.trim(), image)}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] text-[10px] font-mono font-black uppercase border-2 border-[#261D24] disabled:opacity-40 cursor-pointer"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Pin it
          </button>
        </div>
      </div>
    </div>
  );
}
