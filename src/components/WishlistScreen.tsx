"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  ArrowLeft,
  Plus,
  X,
  Check,
  Loader2,
  AlertCircle,
  Trash2,
  Edit3,
  Link as LinkIcon,
  ImagePlus,
  Scale,
  Swords,
  Sparkles,
  Lock,
  PackageCheck,
  Undo2,
  Grid3x3,
  Layers,
  Pin as PinIcon,
  Atom,
  NotebookText,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";
import { playThwip, playPaperRip, playScratch, type EntryMode, type Priority } from "@/lib/wishlistLab";
import WishlistDuoInput from "@/components/WishlistDuoInput";
import WishlistBoard from "@/components/WishlistBoard";
import WishlistMatrix from "@/components/WishlistMatrix";
import WishlistFundTracker from "@/components/WishlistFundTracker";
import WishlistSnippets from "@/components/WishlistSnippets";

/* ============================================================================
   CH.10 - SECRET WISHLIST ("CLASSIFIED R&D")

   The creator's private surprise-planning lab. Backed by `partner_vault`
   (section_type='wishlist'), which is RLS-locked to owner_id = auth.uid()
   only - never couple_id. Nobody linked to this account, including a real
   partner, can ever see a row here. See page.tsx for the full rationale.

   Four modes, one screen:
   - CLASSIFIEDS: the main dashboard - clippings/polaroids on a corkboard,
     press-to-expand into...
   - the BLUEPRINT VIEWER: a frosted technical-glass detail/edit panel.
   - COMPARE: pick two items, tear one off in a comic-panel showdown - the
     loser is deprioritized, the winner promoted to Top Priority.
   - SORTER: drag items with a web-line trailing the cursor into
     Wants / Needs / Top Priority columns, with a THWIP snap on drop.
   - ARCHIVE: purchased items sit under a scratch-off foil stamped
     TOP SECRET / CLASSIFIED until you scrub them clear (every visit -
     nothing is persisted about what's been scratched).

   Deliberately gender-neutral throughout: this is framed as a web-slinger's
   R&D file, not "Peter's" anything, and the copy nods to both Gwen Stacy and
   Peter Parker rather than assuming which one the account belongs to. */

type WishlistCategory = "unsorted" | "wants" | "needs" | "top_priority";
type ClipType = "polaroid" | "clipping";

export interface WishlistItem {
  id: string;
  title: string;
  description: string;
  price: string;
  link: string;
  category: WishlistCategory;
  sortOrder: number;
  isPurchased: boolean;
  purchasedNote: string;
  purchasedAt: string | null;
  tilt: number;
  clipType: ClipType;
  image: string | null;
  createdAt: string;
  entryMode: EntryMode;
  priority: Priority;
}

interface WishlistScreenProps {
  userId: string;
  onBack: () => void;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const CATEGORY_META: Record<WishlistCategory, { label: string; color: string }> = {
  unsorted: { label: "Pending Prioritization", color: "#8A7550" },
  wants: { label: "Wants", color: "#5A7D8C" },
  needs: { label: "Needs", color: "#7D5A34" },
  top_priority: { label: "Top Priority", color: "#7D2834" },
};

const COMPARE_BUBBLES = [
  "CLASSIC STAFF PICK!",
  "SPIDER-VERSE DREAM GEAR!",
  "WEB-SLINGER APPROVED!",
  "CANON-CONFIRMED CHOICE!",
  "MULTIVERSE MUST-HAVE!",
];

function bubbleFor(id: string) {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return COMPARE_BUBBLES[sum % COMPARE_BUBBLES.length];
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/* Sound synths, insight/report templating, and the shared hash/typewriter
   helpers used across this chapter's sibling components now live in
   src/lib/wishlistLab.ts - see that file for why (shared AudioContext,
   shared "brain" behind the Board/Matrix insight text). */

/* --------------------------------------------------------- vault codec
   partner_vault is a generic owner-locked jsonb vault shared across future
   private features (see CLAUDE.md); this chapter owns section_type
   'wishlist' and keeps its own shape entirely inside content_json. */

function decodeRow(row: Record<string, unknown>): WishlistItem {
  const c = (row.content_json as Record<string, unknown>) || {};
  const cat = c.category as string;
  const category: WishlistCategory =
    cat === "wants" || cat === "needs" || cat === "top_priority" ? cat : "unsorted";
  const media = row.media_urls as string[] | null;
  return {
    id: row.id as string,
    title: (c.title as string) || "Untitled Find",
    description: (c.description as string) || "",
    price: (c.price as string) || "",
    link: (c.link as string) || "",
    category,
    sortOrder: typeof c.sortOrder === "number" ? (c.sortOrder as number) : 0,
    isPurchased: !!c.isPurchased,
    purchasedNote: (c.purchasedNote as string) || "",
    purchasedAt: (c.purchasedAt as string) || null,
    tilt: typeof c.tilt === "number" ? (c.tilt as number) : 0,
    clipType: c.clipType === "clipping" ? "clipping" : "polaroid",
    image: Array.isArray(media) && media[0] ? media[0] : null,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    entryMode: c.entryMode === "scientist" ? "scientist" : "snapshot",
    priority: c.priority === "low" || c.priority === "high" ? c.priority : "medium",
  };
}

function encodeContent(item: Partial<WishlistItem>) {
  return {
    title: item.title ?? "",
    description: item.description ?? "",
    price: item.price ?? "",
    link: item.link ?? "",
    category: item.category ?? "unsorted",
    sortOrder: item.sortOrder ?? 0,
    isPurchased: item.isPurchased ?? false,
    purchasedNote: item.purchasedNote ?? "",
    purchasedAt: item.purchasedAt ?? null,
    tilt: item.tilt ?? 0,
    clipType: item.clipType ?? "polaroid",
    entryMode: item.entryMode ?? "snapshot",
    priority: item.priority ?? "medium",
  };
}

type Mode = "classifieds" | "compare" | "sorter" | "board" | "matrix" | "snippets" | "archive";

export default function WishlistScreen({ userId, onBack }: WishlistScreenProps) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("classifieds");

  const [pressedId, setPressedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", price: "", link: "", image: null as string | null });
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [battleOpen, setBattleOpen] = useState(false);
  const [tearingId, setTearingId] = useState<string | null>(null);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [dustParticles, setDustParticles] = useState<{ id: number; x: number; y: number; rot: number }[]>([]);

  const fetchItems = useCallback(async () => {
    try {
      const { data, error: fetchErr } = await supabase
        .from("partner_vault")
        .select("*")
        .eq("owner_id", userId)
        .eq("section_type", "wishlist")
        .order("created_at", { ascending: false });
      if (fetchErr) throw fetchErr;
      setItems((data || []).map((row: Record<string, unknown>) => decodeRow(row)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the R&D lab.");
    } finally {
      setLoading(false);
    }
  }, [supabase, userId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const activeItems = useMemo(() => items.filter((i) => !i.isPurchased), [items]);
  const archivedItems = useMemo(
    () => items.filter((i) => i.isPurchased).sort((a, b) => (b.purchasedAt || "").localeCompare(a.purchasedAt || "")),
    [items]
  );

  /* "Partner Profile" score: a rough, cosmetic sense of how much dossier has
     accumulated (items + logged snippets), not a real analytics score.
     snippetCount is lifted from WishlistSnippets so this doesn't need its
     own duplicate query against wishlist_snippets.

     The old `Math.max(2, ...)` floor meant a brand-new, completely empty lab
     still read "2%", which looks like a bug (it says progress exists when
     nothing has been filed at all) rather than a nudge. An empty dossier is
     now honestly 0%; the floor only applies once there is genuinely at least
     one item or snippet, so a single entry can't round down to nothing. */
  const [snippetCount, setSnippetCount] = useState(0);
  const profilePct = useMemo(() => {
    const filed = items.length + snippetCount;
    if (filed === 0) return 0;
    return Math.max(2, Math.min(100, items.length * 8 + snippetCount * 4));
  }, [items.length, snippetCount]);

  /* ------------------------------------------------------------- CRUD */

  const [isDuoOpen, setIsDuoOpen] = useState(false);
  const openCreate = () => setIsDuoOpen(true);

  const openEdit = (item: WishlistItem) => {
    setEditingId(item.id);
    setForm({ title: item.title, description: item.description, price: item.price, link: item.link, image: item.image });
    setPhotoError(null);
    setIsModalOpen(true);
  };

  const handlePhotoChange = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    if (!file.type.startsWith("image/")) {
      setPhotoError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setPhotoError(`Keep the photo under ${MAX_IMAGE_BYTES / (1024 * 1024)}MB.`);
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setForm((f) => ({ ...f, image: dataUrl }));
  };

  const [runSave, isSaving] = useGuardedAction(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Give the find a name for the file.");
      return;
    }
    try {
      const existing = editingId ? items.find((i) => i.id === editingId) : null;
      const contentJson = encodeContent({
        title: form.title.trim(),
        description: form.description.trim(),
        price: form.price.trim(),
        link: form.link.trim(),
        category: existing?.category ?? "unsorted",
        sortOrder: existing?.sortOrder ?? 0,
        isPurchased: existing?.isPurchased ?? false,
        purchasedNote: existing?.purchasedNote ?? "",
        purchasedAt: existing?.purchasedAt ?? null,
        tilt: existing?.tilt ?? Math.round((Math.random() * 8 - 4) * 10) / 10,
        clipType: existing?.clipType ?? (Math.random() > 0.5 ? "polaroid" : "clipping"),
        entryMode: existing?.entryMode ?? "snapshot",
        priority: existing?.priority ?? "medium",
      });
      const mediaUrls = form.image ? [form.image] : [];

      if (editingId) {
        const { error: updateErr } = await supabase
          .from("partner_vault")
          .update({ content_json: contentJson, media_urls: mediaUrls })
          .eq("id", editingId)
          .eq("owner_id", userId);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase.from("partner_vault").insert({
          owner_id: userId,
          section_type: "wishlist",
          key_name: `wishlist_${crypto.randomUUID()}`,
          content_json: contentJson,
          media_urls: mediaUrls,
        });
        if (insertErr) throw insertErr;
      }
      setIsModalOpen(false);
      setEditingId(null);
      await fetchItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this file.");
    }
  }, 400);

  const [runCreateFromDuo, creatingFromDuo] = useGuardedAction(
    async (draft: {
      title: string;
      description: string;
      price: string;
      link: string;
      image: string | null;
      entryMode: EntryMode;
      priority: Priority;
    }) => {
      try {
        const contentJson = encodeContent({
          title: draft.title.trim(),
          description: draft.description.trim(),
          price: draft.price.trim(),
          link: draft.link.trim(),
          category: "unsorted",
          sortOrder: 0,
          isPurchased: false,
          purchasedNote: "",
          purchasedAt: null,
          tilt: Math.round((Math.random() * 8 - 4) * 10) / 10,
          clipType: draft.entryMode === "scientist" ? "clipping" : "polaroid",
          entryMode: draft.entryMode,
          priority: draft.priority,
        });
        const { error: insertErr } = await supabase.from("partner_vault").insert({
          owner_id: userId,
          section_type: "wishlist",
          key_name: `wishlist_${crypto.randomUUID()}`,
          content_json: contentJson,
          media_urls: draft.image ? [draft.image] : [],
        });
        if (insertErr) throw insertErr;
        setIsDuoOpen(false);
        await fetchItems();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not pin this find to the board.");
      }
    },
    400
  );

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [runDelete] = useGuardedAction(async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setConfirmDeleteId(null);
    if (expandedId === id) setExpandedId(null);
    const { error: delErr } = await supabase.from("partner_vault").delete().eq("id", id).eq("owner_id", userId);
    if (delErr) {
      setError(delErr.message);
      fetchItems();
    }
  });

  const patchItem = async (id: string, patch: Partial<WishlistItem>) => {
    const target = items.find((i) => i.id === id);
    if (!target) return;
    const merged = { ...target, ...patch };
    setItems((prev) => prev.map((i) => (i.id === id ? merged : i)));
    const { error: updateErr } = await supabase
      .from("partner_vault")
      .update({ content_json: encodeContent(merged), media_urls: merged.image ? [merged.image] : [] })
      .eq("id", id)
      .eq("owner_id", userId);
    if (updateErr) {
      setError(updateErr.message);
      fetchItems();
    }
  };

  const setCategory = (id: string, category: WishlistCategory) => {
    playThwip();
    patchItem(id, { category });
  };

  const [purchaseDraft, setPurchaseDraft] = useState<{ item: WishlistItem; note: string } | null>(null);
  const [runArchive] = useGuardedAction(async () => {
    if (!purchaseDraft) return;
    await patchItem(purchaseDraft.item.id, {
      isPurchased: true,
      purchasedNote: purchaseDraft.note.trim(),
      purchasedAt: new Date().toISOString(),
    });
    setPurchaseDraft(null);
    setExpandedId(null);
  });

  const [runUnarchive] = useGuardedAction(async (item: WishlistItem) => {
    await patchItem(item.id, { isPurchased: false, purchasedAt: null });
  });

  /* -------------------------------------------------------- interactions */

  const pressAndExpand = (id: string) => {
    setPressedId(id);
    setTimeout(() => {
      setPressedId(null);
      setExpandedId(id);
    }, 130);
  };

  const toggleCompareSelect = (id: string) => {
    setCompareSelection((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const startBattle = () => {
    if (compareSelection.length !== 2) return;
    setBattleOpen(true);
    setTearingId(null);
    setWinnerId(null);
  };

  const eliminate = (loserId: string, winnerCandidateId: string, originEl: HTMLElement | null) => {
    if (tearingId) return;
    playPaperRip();
    setTearingId(loserId);

    if (originEl) {
      const rect = originEl.getBoundingClientRect();
      const bits = Array.from({ length: 14 }).map((_, i) => ({
        id: Date.now() + i,
        x: rect.left + rect.width / 2 + (Math.random() * 160 - 80),
        y: rect.top + rect.height / 2 + (Math.random() * 160 - 80),
        rot: Math.random() * 360,
      }));
      setDustParticles((prev) => [...prev, ...bits]);
      setTimeout(() => {
        setDustParticles((prev) => prev.filter((p) => !bits.find((b) => b.id === p.id)));
      }, 900);
    }

    setTimeout(async () => {
      setWinnerId(winnerCandidateId);
      await patchItem(winnerCandidateId, { category: "top_priority" });
      await patchItem(loserId, { category: "wants" });
    }, 480);
  };

  const closeBattle = () => {
    setBattleOpen(false);
    setTearingId(null);
    setWinnerId(null);
    setCompareSelection([]);
  };

  /* ------------------------------------------------------------ sorter */

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null);
  const [hoverColumn, setHoverColumn] = useState<WishlistCategory | null>(null);
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const registerColumn = useCallback((key: string, el: HTMLDivElement | null) => {
    columnRefs.current[key] = el;
  }, []);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    e.preventDefault();
    const card = e.currentTarget.getBoundingClientRect();
    setDragId(id);
    setDragOrigin({ x: card.left + card.width / 2, y: card.top + card.height / 2 });
    setDragPos({ x: e.clientX, y: e.clientY });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!dragId) return;
    setDragPos({ x: e.clientX, y: e.clientY });
    let found: WishlistCategory | null = null;
    (Object.keys(columnRefs.current) as WishlistCategory[]).forEach((key) => {
      const el = columnRefs.current[key];
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        found = key;
      }
    });
    setHoverColumn(found);
  };

  const endDrag = () => {
    if (dragId && hoverColumn) {
      const target = items.find((i) => i.id === dragId);
      if (target && target.category !== hoverColumn) {
        setCategory(dragId, hoverColumn);
        setBounceId(dragId);
        setTimeout(() => setBounceId((b) => (b === dragId ? null : b)), 420);
      }
    }
    setDragId(null);
    setDragPos(null);
    setDragOrigin(null);
    setHoverColumn(null);
  };

  const [bounceId, setBounceId] = useState<string | null>(null);

  /* --------------------------------------------------------------- ui */

  const draggingItem = dragId ? items.find((i) => i.id === dragId) : null;

  return (
    <main className="min-h-screen w-full bg-[#1b1610] relative overflow-hidden">
      {/* aged paper backdrop texture */}
      <div
        className="absolute inset-0 opacity-70 pointer-events-none"
        style={{
          backgroundColor: "#e9dcc0",
          backgroundImage:
            "radial-gradient(rgba(90,60,30,0.10) 1px, transparent 1px), radial-gradient(rgba(120,20,32,0.05) 1px, transparent 1px)",
          backgroundSize: "6px 6px, 13px 13px",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/30 pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto p-4 sm:p-8">
        <header className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#F2E6D2] hover:bg-[#FAF7F2] text-[#261D24] text-xs sm:text-sm font-mono font-black border-3 border-[#261D24] shadow-[5px_5px_0_#171B22] -rotate-2 hover:rotate-0 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5 text-[#7D2834]" strokeWidth={3} />
            <span className="tracking-widest uppercase">Table of Contents</span>
          </button>
          <button
            onClick={openCreate}
            className="px-5 py-2.5 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] text-xs sm:text-sm font-mono font-black border-3 border-[#261D24] shadow-[5px_5px_0_#171B22] rotate-1 hover:rotate-0 transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none flex items-center gap-2.5 cursor-pointer"
          >
            <Plus className="w-5 h-5 text-[#E0B1AE]" strokeWidth={3} />
            <span className="tracking-widest uppercase">Pin New Find</span>
          </button>
        </header>

        <section className="relative border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.85)] overflow-hidden">
          {/* newspaper masthead */}
          <div className="bg-[#FAF6EE] border-b-4 border-[#261D24] px-5 sm:px-8 py-5 text-center relative">
            <span className="absolute top-3 left-6 text-lg opacity-40 hidden sm:inline">🕸️</span>
            <span className="absolute top-3 right-6 text-lg opacity-40 hidden sm:inline">🕸️</span>
            <p className="font-mono text-[10px] font-black uppercase tracking-[0.3em] text-[#7D2834] flex items-center justify-center gap-2">
              <Lock className="w-3 h-3" /> Private R&amp;D Lab · For Your Eyes Only
            </p>
            <h1 className="font-marker text-3xl sm:text-5xl text-[#1A0D10] mt-1 leading-none">
              Daily Bugle Classifieds
            </h1>
            <p className="font-handwriting text-2xl text-[#781420] mt-1">Gift Wishlist &amp; Surprise Vault</p>
            <p className="font-mono text-[10px] text-stone-600 mt-2 max-w-md mx-auto leading-relaxed">
              Not shared with your other half, not visible to your linked universe — this page belongs to
              whoever is signed in, the way a web-slinger keeps their own secret identity file.
            </p>
            <div className="mt-3 max-w-xs mx-auto text-left">
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-mono text-[8px] font-black uppercase tracking-[0.2em] text-[#7D2834]">
                  Partner Profile
                </span>
                <span className="font-handwriting text-base text-[#5A2029] leading-none">
                  {profilePct}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#e2d2ac] border border-[#261D24]/40 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#7D2834] to-[#5A7D8C] transition-all duration-500"
                  style={{ width: `${profilePct}%` }}
                />
              </div>
            </div>
          </div>

          {/* mode tabs */}
          <div className="bg-[#20161A] border-b-4 border-[#261D24] px-3 sm:px-6 flex flex-wrap gap-1.5 py-2.5">
            {(
              [
                { id: "classifieds", label: "Classifieds", icon: Grid3x3 },
                { id: "board", label: "Investigation Board", icon: PinIcon },
                { id: "matrix", label: "Synergy Matrix", icon: Atom },
                { id: "compare", label: "Comparison Tool", icon: Scale },
                { id: "sorter", label: "Web-Sling Sorter", icon: Layers },
                { id: "snippets", label: "Memory Snippets", icon: NotebookText },
                { id: "archive", label: `Archive (${archivedItems.length})`, icon: Lock },
              ] as { id: Mode; label: string; icon: typeof Grid3x3 }[]
            ).map((t) => {
              const Icon = t.icon;
              const activeTab = mode === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setMode(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 font-mono text-[10px] sm:text-[11px] font-black uppercase tracking-wider border-2 border-[#261D24] rounded-full cursor-pointer transition ${
                    activeTab ? "bg-[#7D2834] text-[#FAF4EB] scale-105" : "bg-[#F2E6D2] text-[#261D24] hover:bg-white"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </div>

          <div className="bg-[#FAF6EE] min-h-[60vh] p-5 sm:p-8">
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-[#5A2029] text-[#F2E6D2] text-xs font-mono flex items-center gap-2 border-2 border-[#261D24]">
                <AlertCircle className="w-4 h-4 shrink-0" /> <span>{error}</span>
              </div>
            )}

            {loading ? (
              <div className="py-24 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#7D2834]" />
              </div>
            ) : mode === "classifieds" ? (
              activeItems.length === 0 ? (
                <EmptyState onCreate={openCreate} />
              ) : (
                <div className="columns-2 sm:columns-3 lg:columns-4 gap-4 [column-fill:_balance]">
                  {activeItems.map((item) => (
                    <div key={item.id} className="break-inside-avoid mb-4">
                      <ClippingCard
                        item={item}
                        isPressed={pressedId === item.id}
                        onOpen={() => pressAndExpand(item.id)}
                      />
                    </div>
                  ))}
                </div>
              )
            ) : mode === "board" ? (
              <WishlistBoard userId={userId} />
            ) : mode === "matrix" ? (
              <WishlistMatrix items={activeItems} />
            ) : mode === "compare" ? (
              <CompareTray
                items={activeItems}
                selection={compareSelection}
                onToggle={toggleCompareSelect}
                onStart={startBattle}
              />
            ) : mode === "sorter" ? (
              <SorterBoard
                items={activeItems}
                registerColumn={registerColumn}
                dragId={dragId}
                hoverColumn={hoverColumn}
                bounceId={bounceId}
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onOpen={(id) => pressAndExpand(id)}
              />
            ) : mode === "snippets" ? (
              <WishlistSnippets userId={userId} onCountChange={setSnippetCount} />
            ) : (
              <ArchiveGrid items={archivedItems} onUnarchive={runUnarchive} />
            )}
          </div>

          <WishlistFundTracker items={items} userId={userId} />
        </section>
      </div>

      {isDuoOpen && (
        <WishlistDuoInput
          busy={creatingFromDuo}
          onClose={() => setIsDuoOpen(false)}
          onSubmit={(draft) => runCreateFromDuo(draft)}
        />
      )}

      {/* -------- floating drag ghost + web line (sorter mode) -------- */}
      {dragId && dragPos && dragOrigin && draggingItem && (
        <>
          <svg className="fixed inset-0 z-[70] pointer-events-none w-full h-full">
            <line
              x1={dragOrigin.x}
              y1={dragOrigin.y}
              x2={dragPos.x}
              y2={dragPos.y}
              stroke="#F1E2CB"
              strokeWidth={2}
              strokeDasharray="6 5"
              opacity={0.85}
            />
            <circle cx={dragOrigin.x} cy={dragOrigin.y} r={4} fill="#F1E2CB" />
          </svg>
          <div
            className="fixed z-[71] pointer-events-none w-24 h-24 -translate-x-1/2 -translate-y-1/2 rotate-3"
            style={{ left: dragPos.x, top: dragPos.y }}
          >
            <div className="polaroid-matte w-24 h-24 flex items-center justify-center text-[10px] font-mono font-black text-center px-1 leading-tight">
              {draggingItem.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draggingItem.image} alt="" className="w-full h-14 object-cover" />
              ) : (
                <span>{draggingItem.title}</span>
              )}
            </div>
          </div>
        </>
      )}

      {/* -------- tear dust particles -------- */}
      {dustParticles.map((p) => (
        <span
          key={p.id}
          className="fixed z-[85] pointer-events-none dust-shaving"
          style={{ left: p.x, top: p.y, transform: `rotate(${p.rot}deg)` }}
        >
          ▪
        </span>
      ))}

      {/* -------- add/edit modal -------- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="paper-sheet-solid max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 relative border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.95)] rounded-2xl">
            <div className="absolute -top-3.5 left-12 w-28 h-6 tape-pink-solid -rotate-2 pointer-events-none" />
            <div className="absolute -top-3.5 right-12 w-28 h-6 tape-red-solid rotate-2 pointer-events-none" />
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute top-5 right-5 p-2 rounded-lg bg-[#EFE4D6] hover:bg-[#E2D2C0] border-2 border-[#261D24] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5 pb-3 border-b-3 border-dashed border-[#8A7550]">
              <span className="text-3xl">📎</span>
              <h2 className="font-marker text-2xl sm:text-3xl text-[#261D24]">
                {editingId ? "Edit Classified" : "New Classified Clipping"}
              </h2>
            </div>

            <form onSubmit={runSave} className="space-y-4">
              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Item *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Leica M6 Camera"
                  className="w-full text-sm font-mono p-3 rounded-xl bg-white border-3 border-[#261D24] outline-none shadow-inner"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Est. Price</label>
                  <input
                    type="text"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    placeholder="$2,800 - $3,200"
                    className="w-full text-sm font-mono p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none shadow-inner"
                  />
                </div>
                <div>
                  <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Link</label>
                  <input
                    type="url"
                    value={form.link}
                    onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
                    placeholder="https://..."
                    className="w-full text-sm font-mono p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none shadow-inner"
                  />
                </div>
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">R&amp;D Notes</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Why this, sizing, color, where you saw it..."
                  className="w-full font-handwriting text-xl p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none resize-none shadow-inner"
                />
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Reference Photo</label>
                {form.image ? (
                  <div className="relative w-24 h-24">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={form.image} alt="" className="w-24 h-24 object-cover rounded-lg border-2 border-[#261D24]" />
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, image: null }))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#7D2834] text-white rounded-full flex items-center justify-center text-[10px] cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-24 h-24 border-2 border-dashed border-[#8A7550] rounded-lg flex items-center justify-center cursor-pointer hover:bg-stone-100"
                  >
                    <ImagePlus className="w-6 h-6 text-[#8A7550]" />
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePhotoChange(e.target.files?.[0])}
                />
                {photoError && <p className="text-[10px] font-mono text-[#7D2834] mt-1">{photoError}</p>}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t-3 border-dashed border-[#8A7550]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl bg-[#EFE4D6] hover:bg-[#E2D2C0] font-mono text-xs font-black border-3 border-[#261D24] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-6 py-2.5 rounded-xl bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] font-mono text-xs font-black border-3 border-[#261D24] shadow-[4px_4px_0_#171B24] flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingId ? "Update File" : "Pin It"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -------- blueprint detail viewer -------- */}
      {expandedId &&
        (() => {
          const item = items.find((i) => i.id === expandedId);
          if (!item) return null;
          return (
            <BlueprintViewer
              item={item}
              onClose={() => setExpandedId(null)}
              onEdit={() => {
                setExpandedId(null);
                openEdit(item);
              }}
              onDelete={() => setConfirmDeleteId(item.id)}
              confirmingDelete={confirmDeleteId === item.id}
              onConfirmDelete={() => runDelete(item.id)}
              onCancelDelete={() => setConfirmDeleteId(null)}
              onArchive={() => setPurchaseDraft({ item, note: "" })}
            />
          );
        })()}

      {/* -------- purchase / archive ritual -------- */}
      {purchaseDraft && (
        <div className="fixed inset-0 z-[65] flex items-start sm:items-center justify-center p-4 py-8 overflow-y-auto bg-black/85 backdrop-blur-md">
          <div className="paper-sheet-solid max-w-sm w-full max-h-[90vh] overflow-y-auto p-6 relative border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.95)] rounded-2xl">
            <button
              onClick={() => setPurchaseDraft(null)}
              className="absolute top-4 right-4 p-1.5 rounded-lg bg-[#EFE4D6] hover:bg-[#E2D2C0] border-2 border-[#261D24] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <h2 className="font-marker text-2xl text-[#261D24] mb-1 flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-[#7D2834]" /> Mark As Secured
            </h2>
            <p className="font-handwriting text-xl text-stone-700 mb-3">{purchaseDraft.item.title}</p>
            <textarea
              rows={2}
              value={purchaseDraft.note}
              onChange={(e) => setPurchaseDraft((d) => (d ? { ...d, note: e.target.value } : d))}
              placeholder="Where you got it, when it'll be given..."
              className="w-full font-handwriting text-xl p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none resize-none shadow-inner mb-4"
            />
            <button
              onClick={() => runArchive()}
              className="w-full px-6 py-3 bg-[#1A0D10] hover:bg-black text-[#FAF4EB] font-mono text-sm font-black border-3 border-[#261D24] shadow-[4px_4px_0_#171B24] flex items-center justify-center gap-2 cursor-pointer"
            >
              <Lock className="w-4 h-4" /> Seal Into Archive
            </button>
          </div>
        </div>
      )}

      {/* -------- comparison battle overlay -------- */}
      {battleOpen && compareSelection.length === 2 && (
        <BattleOverlay
          left={items.find((i) => i.id === compareSelection[0])!}
          right={items.find((i) => i.id === compareSelection[1])!}
          tearingId={tearingId}
          winnerId={winnerId}
          onEliminate={eliminate}
          onClose={closeBattle}
        />
      )}

      <style>{`
        @keyframes press-depress-kf {
          0% { transform: scale(1) translateY(0); }
          50% { transform: scale(0.93) translateY(3px); }
          100% { transform: scale(1) translateY(0); }
        }
        .press-depress { animation: press-depress-kf 0.15s ease; }

        @keyframes blueprint-in-kf {
          0% { opacity: 0; transform: scale(0.9) translateY(20px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .blueprint-in { animation: blueprint-in-kf 0.32s cubic-bezier(0.16,1,0.3,1); }

        @keyframes dust-fly-kf {
          0% { opacity: 1; transform: translate(0,0) rotate(0deg) scale(1); }
          100% { opacity: 0; transform: translate(${'var(--dx,0px)'}, 90px) rotate(220deg) scale(0.4); }
        }
        .dust-shaving {
          color: #c9c9c9;
          font-size: 14px;
          animation: dust-fly-kf 0.85s ease-out forwards;
        }

        @keyframes tear-away-left-kf {
          0% { transform: translateX(0) rotate(0deg); opacity: 1; }
          100% { transform: translateX(-140%) rotate(-35deg); opacity: 0; }
        }
        @keyframes tear-away-right-kf {
          0% { transform: translateX(0) rotate(0deg); opacity: 1; }
          100% { transform: translateX(140%) rotate(35deg); opacity: 0; }
        }
        .tear-left { animation: tear-away-left-kf 0.5s cubic-bezier(0.5,-0.3,0.7,0.3) forwards; }
        .tear-right { animation: tear-away-right-kf 0.5s cubic-bezier(0.5,-0.3,0.7,0.3) forwards; }

        @keyframes winner-expand-kf {
          0% { flex: 1; }
          100% { flex: 1 1 100%; transform: scale(1.02); }
        }
        .winner-expand { animation: winner-expand-kf 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards; }

        @keyframes web-snap-bounce-kf {
          0% { transform: scale(0.7) rotate(-6deg); }
          55% { transform: scale(1.14) rotate(4deg); }
          80% { transform: scale(0.95) rotate(-2deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        .web-snap-bounce { animation: web-snap-bounce-kf 0.42s cubic-bezier(0.34,1.56,0.64,1); }
      `}</style>
    </main>
  );
}

/* ============================================================= subviews */

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-20">
      <div className="text-6xl mb-3">🕵️‍♀️🕵️‍♂️</div>
      <p className="font-marker text-2xl text-[#7D2834]">This file is empty, agent.</p>
      <p className="font-handwriting text-xl text-stone-600 mt-1 mb-5">
        Pin your first classified find to start the wishlist.
      </p>
      <button
        onClick={onCreate}
        className="px-5 py-2.5 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] font-mono text-xs font-black border-3 border-[#261D24] shadow-[4px_4px_0_#171B24] cursor-pointer"
      >
        Open a New File
      </button>
    </div>
  );
}

function ClippingCard({ item, isPressed, onOpen }: { item: WishlistItem; isPressed: boolean; onOpen: () => void }) {
  const meta = CATEGORY_META[item.category];
  return (
    <button
      onClick={onOpen}
      style={{ transform: `rotate(${item.tilt}deg)` }}
      className={`block w-full text-left ${isPressed ? "press-depress" : ""} ${
        item.clipType === "polaroid" ? "polaroid-matte" : "paper-kraft-torn p-3"
      } cursor-pointer relative group`}
    >
      {item.category !== "unsorted" && (
        <span
          className="absolute -top-2 -right-2 z-10 px-2 py-0.5 rounded-full text-[8px] font-mono font-black uppercase text-white border-2 border-[#261D24] shadow-[2px_2px_0_#171B22]"
          style={{ backgroundColor: meta.color }}
        >
          {meta.label}
        </span>
      )}
      {item.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image} alt="" className="w-full h-32 object-cover" />
      ) : (
        <div className="w-full h-24 bg-[#EFE4D6] flex items-center justify-center text-3xl">📎</div>
      )}
      <div className={item.clipType === "polaroid" ? "pt-2" : "pt-1"}>
        <h4 className="font-marker text-lg text-[#1A0D10] leading-tight">{item.title}</h4>
        {item.price && <p className="font-mono text-[10px] font-black text-[#5A2029] mt-0.5">{item.price}</p>}
      </div>
      <span className="absolute top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[#8A7550] border border-[#261D24] opacity-70 group-hover:opacity-100" />
    </button>
  );
}

function BlueprintViewer({
  item,
  onClose,
  onEdit,
  onDelete,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
  onArchive,
}: {
  item: WishlistItem;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onArchive: () => void;
}) {
  const [trail, setTrail] = useState<{ id: number; x: number; y: number }[]>([]);
  const [pos, setPos] = useState({ x: 50, y: 40 });
  const draggingRef = useRef(false);
  const trailIdRef = useRef(0);

  const onImgPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onImgPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - box.left) / box.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - box.top) / box.height) * 100));
    trailIdRef.current += 1;
    setTrail((prev) => [...prev.slice(-4), { id: trailIdRef.current, x: pos.x, y: pos.y }]);
    setPos({ x, y });
  };
  const onImgPointerUp = () => {
    draggingRef.current = false;
    setTimeout(() => setTrail([]), 400);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md" onClick={onClose}>
      <div
        className="blueprint-in relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border-2 border-[#8fb8d6] p-6 sm:p-8"
        style={{
          background: "linear-gradient(160deg, rgba(20,45,70,0.92), rgba(10,25,45,0.96))",
          boxShadow: "0 0 0 1px rgba(143,184,214,0.35), 0 30px 60px rgba(0,0,0,0.7), inset 0 0 80px rgba(120,170,220,0.08)",
          color: "#dcecfa",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* corner registration marks, technical-drawing flavor */}
        {["top-2 left-2 border-t-2 border-l-2", "top-2 right-2 border-t-2 border-r-2", "bottom-2 left-2 border-b-2 border-l-2", "bottom-2 right-2 border-b-2 border-r-2"].map(
          (cls, i) => (
            <span key={i} className={`absolute ${cls} w-5 h-5 border-[#8fb8d6]/70 pointer-events-none`} />
          )
        )}

        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full bg-[#0c2033] hover:bg-[#123049] border border-[#8fb8d6]/60 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-[#8fb8d6]">
          Project: {item.title} — R&amp;D Analytics
        </p>
        <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-[#8fb8d6]/60 mb-4">
          P.P. &amp; G.S. R&amp;D — Confidential
        </p>

        <div
          className="relative w-full h-56 sm:h-64 border border-[#8fb8d6]/40 rounded bg-[#08192c] overflow-hidden mb-5 touch-none"
          onPointerMove={onImgPointerMove}
        >
          {trail.map((t) => (
            <div
              key={t.id}
              className="absolute w-16 h-16 -translate-x-1/2 -translate-y-1/2 rounded border border-[#8fb8d6]/40 opacity-25 pointer-events-none transition-opacity"
              style={{ left: `${t.x}%`, top: `${t.y}%` }}
            />
          ))}
          {item.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.image}
              onPointerDown={onImgPointerDown}
              onPointerUp={onImgPointerUp}
              alt=""
              draggable={false}
              className="absolute w-20 h-20 sm:w-28 sm:h-28 object-cover -translate-x-1/2 -translate-y-1/2 rounded border-2 border-[#8fb8d6] shadow-[0_0_20px_rgba(143,184,214,0.4)] cursor-grab active:cursor-grabbing select-none"
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-5xl opacity-40">📷</div>
          )}
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-50">
            <line x1="0" y1="20%" x2="100%" y2="20%" stroke="#8fb8d6" strokeWidth="0.5" strokeDasharray="3 3" />
            <line x1="0" y1="80%" x2="100%" y2="80%" stroke="#8fb8d6" strokeWidth="0.5" strokeDasharray="3 3" />
          </svg>
          <span className="absolute bottom-1.5 right-2 font-mono text-[8px] text-[#8fb8d6]/70">drag to reposition</span>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          <div className="border border-[#8fb8d6]/30 rounded p-3 bg-[#0c2033]/60">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#8fb8d6]/70 mb-1">Price Estimate</p>
            <p className="font-mono text-sm font-black">{item.price || "—"}</p>
          </div>
          <div className="border border-[#8fb8d6]/30 rounded p-3 bg-[#0c2033]/60">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#8fb8d6]/70 mb-1">Status</p>
            <p className="font-mono text-sm font-black">{CATEGORY_META[item.category].label}</p>
          </div>
        </div>

        {item.description && (
          <div className="border border-[#8fb8d6]/30 rounded p-3 bg-[#0c2033]/60 mb-5">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#8fb8d6]/70 mb-1">Field Notes</p>
            <p className="font-handwriting text-xl leading-snug">{item.description}</p>
          </div>
        )}

        {item.link && (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-xs font-black text-[#8fb8d6] underline mb-5"
          >
            <LinkIcon className="w-3.5 h-3.5" /> View Reference Source
          </a>
        )}

        <div className="flex flex-wrap gap-2.5 pt-4 border-t border-[#8fb8d6]/30">
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#123049] hover:bg-[#184061] border border-[#8fb8d6]/60 rounded font-mono text-xs font-black cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            onClick={onArchive}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1E3A34] hover:bg-[#16281f] border border-[#8fb8d6]/60 rounded font-mono text-xs font-black cursor-pointer"
          >
            <PackageCheck className="w-3.5 h-3.5" /> Mark Secured
          </button>
          {confirmingDelete ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={onConfirmDelete}
                className="px-4 py-2 bg-[#7D2834] hover:bg-[#5A2029] rounded font-mono text-xs font-black cursor-pointer animate-pulse"
              >
                Confirm Delete
              </button>
              <button onClick={onCancelDelete} className="px-3 py-2 bg-[#0c2033] rounded font-mono text-xs cursor-pointer">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#3a1010] hover:bg-[#5A2029] border border-[#8fb8d6]/60 rounded font-mono text-xs font-black cursor-pointer ml-auto"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete File
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CompareTray({
  items,
  selection,
  onToggle,
  onStart,
}: {
  items: WishlistItem[];
  selection: string[];
  onToggle: (id: string) => void;
  onStart: () => void;
}) {
  if (items.length < 2) {
    return (
      <div className="text-center py-16">
        <Swords className="w-10 h-10 mx-auto text-[#8A7550] mb-3" />
        <p className="font-marker text-2xl text-[#7D2834]">Need at least two files to settle a score.</p>
        <p className="font-handwriting text-xl text-stone-600 mt-1">Pin more finds first.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <p className="font-handwriting text-2xl text-[#5A2029]">Pick exactly two to send into the panel.</p>
        <button
          onClick={onStart}
          disabled={selection.length !== 2}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1A0D10] hover:bg-black disabled:opacity-30 disabled:cursor-not-allowed text-[#FAF4EB] font-mono text-xs font-black border-3 border-[#261D24] shadow-[4px_4px_0_#171B24] cursor-pointer"
        >
          <Swords className="w-4 h-4" /> Start Showdown ({selection.length}/2)
        </button>
      </div>
      <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((item) => {
          const selected = selection.includes(item.id);
          return (
            <button
              key={item.id}
              onClick={() => onToggle(item.id)}
              className={`text-left p-3 rounded-lg border-3 transition cursor-pointer ${
                selected ? "border-[#7D2834] bg-[#EAC7D6] scale-[1.02]" : "border-[#261D24]/30 bg-white hover:border-[#261D24]"
              }`}
            >
              {item.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image} alt="" className="w-full h-20 object-cover rounded mb-1.5" />
              ) : (
                <div className="w-full h-16 bg-[#EFE4D6] rounded mb-1.5 flex items-center justify-center text-2xl">📎</div>
              )}
              <p className="font-marker text-sm leading-tight">{item.title}</p>
              {item.price && <p className="font-mono text-[9px] text-[#5A2029]">{item.price}</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BattlePanel({
  item,
  side,
  tearing,
  isWinner,
  battleOver,
  onEliminate,
}: {
  item: WishlistItem;
  side: "left" | "right";
  tearing: boolean;
  isWinner: boolean;
  battleOver: boolean;
  onEliminate: (el: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragStartX = useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    dragStartX.current = e.clientX;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragStartX.current === null || battleOver) return;
    const dx = e.clientX - dragStartX.current;
    dragStartX.current = null;
    if ((side === "left" && dx < -90) || (side === "right" && dx > 90)) {
      onEliminate(ref.current);
    }
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className={`relative flex-1 min-w-0 flex flex-col items-center justify-center p-6 sm:p-8 border-4 border-[#261D24] comic-halftone select-none touch-none ${
        tearing ? (side === "left" ? "tear-left" : "tear-right") : ""
      } ${isWinner ? "winner-expand" : ""}`}
      style={{ background: side === "left" ? "#bdd0c5" : "#d7a4a0" }}
    >
      <span className="absolute top-3 left-3 font-mono text-[9px] font-black uppercase bg-white/80 px-2 py-1 border-2 border-[#261D24] rotate-[-4deg]">
        {bubbleFor(item.id)}
      </span>
      {item.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image} alt="" className="w-32 h-32 sm:w-40 sm:h-40 object-cover rounded border-4 border-[#261D24] shadow-[6px_6px_0_rgba(0,0,0,0.4)] mb-3" />
      ) : (
        <div className="w-32 h-32 sm:w-40 sm:h-40 bg-white/60 border-4 border-[#261D24] rounded flex items-center justify-center text-5xl mb-3">📎</div>
      )}
      <h3 className="font-marker text-2xl sm:text-3xl text-[#1A0D10] text-center">{item.title}</h3>
      {item.price && <p className="font-mono text-xs font-black text-[#5A2029] mt-1">{item.price}</p>}
      {!battleOver && (
        <button
          onClick={() => onEliminate(ref.current)}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-[#261D24] hover:bg-black text-white font-mono text-[10px] font-black uppercase rounded-full cursor-pointer"
        >
          <X className="w-3.5 h-3.5" /> Tear This One Away
        </button>
      )}
      {!battleOver && <p className="font-mono text-[8px] text-[#261D24]/60 mt-1.5">or swipe {side === "left" ? "left" : "right"}</p>}
    </div>
  );
}

function BattleOverlay({
  left,
  right,
  tearingId,
  winnerId,
  onEliminate,
  onClose,
}: {
  left: WishlistItem;
  right: WishlistItem;
  tearingId: string | null;
  winnerId: string | null;
  onEliminate: (loserId: string, winnerId: string, el: HTMLElement | null) => void;
  onClose: () => void;
}) {
  const battleOver = !!winnerId;
  return (
    <div className="fixed inset-0 z-[75] flex flex-col bg-black/95 p-4 sm:p-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-marker text-2xl sm:text-3xl text-[#FAF4EB]">Comic Panel Showdown</h2>
        <button onClick={onClose} className="p-2 bg-[#F2E6D2] rounded-full border-2 border-[#261D24] cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* The loser stays mounted while it tears - unmounting it the moment
          `tearingId` was set meant the tear-away keyframes never got a frame
          to run on. It's dropped once `winnerId` lands, which is timed to the
          end of that animation. */}
      <div className="flex-1 flex flex-col sm:flex-row gap-3 min-h-0">
        {(!winnerId || winnerId === left.id) && (
          <BattlePanel
            item={left}
            side="left"
            tearing={tearingId === left.id}
            isWinner={winnerId === left.id}
            battleOver={battleOver || !!tearingId}
            onEliminate={(el) => onEliminate(left.id, right.id, el)}
          />
        )}
        {(!winnerId || winnerId === right.id) && (
          <BattlePanel
            item={right}
            side="right"
            tearing={tearingId === right.id}
            isWinner={winnerId === right.id}
            battleOver={battleOver || !!tearingId}
            onEliminate={(el) => onEliminate(right.id, left.id, el)}
          />
        )}
      </div>
      {battleOver && (
        <div className="text-center mt-4">
          <p className="font-handwriting text-2xl text-[#E0B1AE] mb-3">Decision made — promoted to Top Priority.</p>
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-[#7D2834] text-[#F2E6D2] font-mono text-xs font-black border-3 border-[#261D24] cursor-pointer"
          >
            Close the File
          </button>
        </div>
      )}
      <style>{`
        .comic-halftone {
          background-image: radial-gradient(rgba(0,0,0,0.18) 1.4px, transparent 1.4px);
          background-size: 7px 7px;
        }
      `}</style>
    </div>
  );
}

function SorterBoard({
  items,
  registerColumn,
  dragId,
  hoverColumn,
  bounceId,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onOpen,
}: {
  items: WishlistItem[];
  registerColumn: (key: string, el: HTMLDivElement | null) => void;
  dragId: string | null;
  hoverColumn: WishlistCategory | null;
  bounceId: string | null;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, id: string) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onOpen: (id: string) => void;
}) {
  const pending = items.filter((i) => i.category === "unsorted");
  const columns: WishlistCategory[] = ["wants", "needs", "top_priority"];

  const Card = ({ item }: { item: WishlistItem }) => (
    <div
      onPointerDown={(e) => onPointerDown(e, item.id)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={() => {
        if (!dragId) onOpen(item.id);
      }}
      className={`polaroid-matte w-full text-left cursor-grab active:cursor-grabbing touch-none select-none mb-3 ${
        dragId === item.id ? "opacity-30" : ""
      } ${bounceId === item.id ? "web-snap-bounce" : ""}`}
    >
      {item.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image} alt="" className="w-full h-16 object-cover" />
      ) : (
        <div className="w-full h-14 bg-[#EFE4D6] flex items-center justify-center text-2xl">📎</div>
      )}
      <p className="font-marker text-sm leading-tight pt-1.5">{item.title}</p>
    </div>
  );

  return (
    <div onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div
        ref={(el) => registerColumn("unsorted", el)}
        className="mb-6 p-4 border-3 border-dashed border-[#8A7550] rounded-xl bg-[#F2E6D2]/60"
      >
        <p className="font-mono text-[10px] font-black uppercase tracking-widest text-[#7D2834] mb-3">
          Incoming — Pending Prioritization ({pending.length})
        </p>
        {pending.length === 0 ? (
          <p className="font-handwriting text-lg text-stone-500">Nothing new waiting to be sorted.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {pending.map((item) => (
              <Card key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {columns.map((col) => {
          const meta = CATEGORY_META[col];
          const colItems = items.filter((i) => i.category === col);
          const isHover = hoverColumn === col;
          return (
            <div
              key={col}
              ref={(el) => registerColumn(col, el)}
              className={`min-h-[220px] p-3.5 rounded-xl border-3 transition ${
                isHover ? "border-[#7D2834] bg-[#EAC7D6]/50 scale-[1.02]" : "border-[#261D24]/25 bg-white/60"
              }`}
            >
              <p
                className="font-mono text-[10px] font-black uppercase tracking-widest mb-3 px-2 py-1 rounded-full inline-block text-white"
                style={{ backgroundColor: meta.color }}
              >
                {meta.label} ({colItems.length})
              </p>
              {colItems.length === 0 ? (
                <p className="font-handwriting text-lg text-stone-400 mt-2">Drop something here</p>
              ) : (
                colItems.map((item) => <Card key={item.id} item={item} />)
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScratchCard({ item, onUnarchive }: { item: WishlistItem; onUnarchive: (item: WishlistItem) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [revealed, setRevealed] = useState(false);
  /* A ref, not state: a fast drag fires pointermove before React has
     re-rendered from the pointerdown, so a state flag reads stale and the
     first stroke of a scratch gets dropped. */
  const scratchingRef = useRef(false);
  const [dust, setDust] = useState<{ id: number; x: number; y: number }[]>([]);
  const lastSoundRef = useRef(0);
  const lastSampleRef = useRef(0);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#c9c9c9");
    grad.addColorStop(0.5, "#8f8f8f");
    grad.addColorStop(1, "#b8b8b8");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }

    ctx.save();
    ctx.translate(w / 2, h / 2 - 12);
    ctx.rotate(-0.12);
    ctx.font = "bold 20px monospace";
    ctx.fillStyle = "rgba(120,20,32,0.75)";
    ctx.textAlign = "center";
    ctx.fillText("TOP SECRET", 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(w / 2, h / 2 + 16);
    ctx.rotate(0.08);
    ctx.font = "bold 12px monospace";
    ctx.fillStyle = "rgba(30,30,30,0.6)";
    ctx.textAlign = "center";
    ctx.fillText("CLASSIFIED — SCRATCH TO REVEAL", 0, 0);
    ctx.restore();
  }, []);

  const scratchAt = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    /* Joining to the previous point matters: pointermove is sampled, so
       without the connecting stroke a quick swipe erases a dotted trail of
       separate circles instead of one continuous scratch. */
    const prev = lastPointRef.current;
    if (prev) {
      ctx.lineWidth = 44;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    lastPointRef.current = { x, y };
    ctx.globalCompositeOperation = "source-over";

    const now = Date.now();
    if (now - lastSoundRef.current > 90) {
      playScratch();
      lastSoundRef.current = now;
      const id = now;
      setDust((prev) => [...prev.slice(-8), { id, x: clientX, y: clientY }]);
      setTimeout(() => setDust((prev) => prev.filter((d) => d.id !== id)), 500);
    }

    /* Estimating how much foil is gone means reading the whole canvas back,
       which is far too expensive to do on every pointermove - sampled about
       four times a second instead, on a sparse stride through the alpha
       channel. */
    if (now - lastSampleRef.current > 250) {
      lastSampleRef.current = now;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let cleared = 0;
      let total = 0;
      for (let i = 3; i < imgData.length; i += 400) {
        total++;
        if (imgData[i] < 40) cleared++;
      }
      if (total > 0 && cleared / total > 0.45) setRevealed(true);
    }
  };

  /* The foil covers the WHOLE card, not just the photo - the item's name,
     note and date are the classified part, so leaving them legible under a
     covered picture would give the surprise away at a glance. */
  return (
    <div className="polaroid-matte relative overflow-hidden">
      <div className="w-full h-40 relative bg-[#EFE4D6]">
        {item.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-4xl">📎</div>
        )}
      </div>
      <div className="pt-2">
        <h4 className="font-marker text-lg text-[#1A0D10] leading-tight">{item.title}</h4>
        {item.purchasedNote && <p className="font-handwriting text-lg text-stone-700 mt-1">&ldquo;{item.purchasedNote}&rdquo;</p>}
        {item.purchasedAt && (
          <p className="font-mono text-[9px] text-stone-500 mt-1">
            Secured {new Date(item.purchasedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        )}
        <button
          onClick={() => onUnarchive(item)}
          className="mt-2 inline-flex items-center gap-1.5 font-mono text-[9px] font-black text-[#5A2029] underline cursor-pointer"
        >
          <Undo2 className="w-3 h-3" /> restore to active list
        </button>
      </div>

      {!revealed && (
        <canvas
          ref={canvasRef}
          width={280}
          height={330}
          className="absolute inset-0 w-full h-full cursor-pointer touch-none z-20"
          onPointerDown={(e) => {
            scratchingRef.current = true;
            lastPointRef.current = null;
            e.currentTarget.setPointerCapture(e.pointerId);
            scratchAt(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (scratchingRef.current) scratchAt(e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            scratchingRef.current = false;
            lastPointRef.current = null;
          }}
          onPointerCancel={() => {
            scratchingRef.current = false;
            lastPointRef.current = null;
          }}
        />
      )}
      {dust.map((d) => (
        <span
          key={d.id}
          className="fixed z-[90] pointer-events-none text-[10px]"
          style={{ left: d.x, top: d.y, color: "#d8d8d8", animation: "dust-fly-kf 0.5s ease-out forwards" }}
        >
          ✦
        </span>
      ))}
    </div>
  );
}

function ArchiveGrid({ items, onUnarchive }: { items: WishlistItem[]; onUnarchive: (item: WishlistItem) => void }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-20">
        <Lock className="w-10 h-10 mx-auto text-[#8A7550] mb-3" />
        <p className="font-marker text-2xl text-[#7D2834]">The vault is empty.</p>
        <p className="font-handwriting text-xl text-stone-600 mt-1">Mark a find as secured to archive it here.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <Sparkles className="w-4 h-4 text-[#7D2834]" />
        <p className="font-handwriting text-2xl text-[#5A2029]">Scratch each foil to peek — it covers back up next visit.</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-8">
        {items.map((item) => (
          <ScratchCard key={item.id} item={item} onUnarchive={onUnarchive} />
        ))}
      </div>
    </div>
  );
}
