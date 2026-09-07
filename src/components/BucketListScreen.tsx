"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Edit3,
  X,
  Check,
  Loader2,
  AlertCircle,
  Sparkles,
  Trophy,
  Camera,
  ImagePlus,
  Shuffle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";

/* ============================================================================
   CH.08 - MULTIVERSE BUCKET LIST

   A corkboard of shared goals against `bucket_list`, categorized and grouped
   into yearly tabs (plus a "Someday" pile for anything with no target year).

   Twist #1 - MULTIVERSE ROULETTE: "Spin the Web" picks a random incomplete
   item from whatever's currently filtered, for the classic couple stalemate
   of "what should we actually do next."

   Twist #2 - COMPLETION RITUAL: checking an item off opens a small flow for
   a photo + one-line reflection, then a full-screen "COLLAPSED INTO CANON!"
   burst (a deliberate callback to Ch.07's language) before the card moves
   into a permanent, always-visible Hall of Fame instead of just graying out.

   Twist #3 - WEB PROGRESS: completion-per-tab is drawn as an 8-spoke web
   filling in thread by thread instead of a plain progress bar.

   All chapter-specific CSS lives in the scoped <style> block near the
   bottom, per house convention. */

interface BucketItem {
  id: string;
  couple_id: string;
  creator_id: string;
  title: string;
  description: string;
  category: string;
  is_completed: boolean;
  target_year: number | null;
  hype_rating: number;
  completed_at: string | null;
  completed_note: string | null;
  photo_urls: string[];
  cover_emoji: string | null;
  color: string | null;
  created_at: string;
}

interface BucketListScreenProps {
  userId: string;
  coupleId: string;
  myName: string;
  partnerName: string;
  onBack: () => void;
}

const CATEGORY_PRESETS = [
  { value: "Travel", emoji: "✈️", bg: "bg-[#BDD0C5]", tape: "tape-gold-solid" },
  { value: "Food", emoji: "🍜", bg: "bg-[#EAD0C7]", tape: "tape-pink-solid" },
  { value: "Adventure", emoji: "🪂", bg: "bg-[#D3DCE0]", tape: "tape-gold-solid" },
  { value: "Romance", emoji: "💕", bg: "bg-[#D7A4A0]", tape: "tape-red-solid" },
  { value: "Home", emoji: "🏠", bg: "bg-[#EAD9A9]", tape: "tape-gold-solid" },
  { value: "Skills", emoji: "🎯", bg: "bg-[#E6D5C3]", tape: "tape-pink-solid" },
  { value: "Milestone", emoji: "🌟", bg: "bg-[#EAD9A9]", tape: "tape-gold-solid" },
  { value: "Crazy Ideas", emoji: "🌀", bg: "bg-[#EAC7D6]", tape: "tape-red-solid" },
] as const;

function categoryTheme(value?: string | null) {
  return CATEGORY_PRESETS.find((c) => c.value === value) ?? { value: value || "Other", emoji: "🌀", bg: "bg-[#F2E6D2]", tape: "tape-gold-solid" };
}

const COVER_EMOJI_CHOICES = ["🌀", "✈️", "🍜", "🪂", "💕", "🏠", "🎯", "🌟", "🎡", "🏔️", "🎸", "📸", "🎢", "🍿", "🌊", "🕸️"];
const TAPE_CHOICES = ["tape-pink-solid", "tape-red-solid", "tape-gold-solid"];
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const CARD_ROTATIONS = ["-rotate-2", "rotate-1", "-rotate-1", "rotate-2", "-rotate-3", "rotate-3"];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function WebProgress({ pct, label }: { pct: number; label: string }) {
  const spokes = 8;
  const filled = Math.round(pct * spokes);
  const cx = 20;
  const cy = 20;
  const r = 16;
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 40 40" className="w-10 h-10 shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#8A7550" strokeWidth="1" strokeDasharray="2 2" opacity={0.4} />
        <circle cx={cx} cy={cy} r={r * 0.6} fill="none" stroke="#8A7550" strokeWidth="1" strokeDasharray="1.5 2" opacity={0.3} />
        {Array.from({ length: spokes }).map((_, i) => {
          const angle = (i * (Math.PI * 2)) / spokes - Math.PI / 2;
          const x2 = cx + Math.cos(angle) * r;
          const y2 = cy + Math.sin(angle) * r;
          const isFilled = i < filled;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={x2}
              y2={y2}
              stroke={isFilled ? "#7D2834" : "#8A7550"}
              strokeWidth={isFilled ? 1.8 : 1}
              strokeDasharray={isFilled ? undefined : "2 2"}
              opacity={isFilled ? 1 : 0.35}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={2.5} fill="#7D2834" />
      </svg>
      <span className="font-mono text-[10px] font-black text-[#5A2029] uppercase">{label}</span>
    </div>
  );
}

export default function BucketListScreen({ userId, coupleId, myName, partnerName, onBack }: BucketListScreenProps) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<BucketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<string>("All");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [showHallOfFame, setShowHallOfFame] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BucketItem | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "Travel" as string,
    customCategory: "",
    useCustomCategory: false,
    targetYear: "" as string, // "" = someday
    hypeRating: 3,
    coverEmoji: "🌀",
    color: "tape-gold-solid",
    photos: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [completionDraft, setCompletionDraft] = useState<{ item: BucketItem; note: string; photo: string | null } | null>(null);
  const [collapseBurst, setCollapseBurst] = useState<BucketItem | null>(null);

  const [isSpinning, setIsSpinning] = useState(false);
  const [rouletteResult, setRouletteResult] = useState<BucketItem | null>(null);

  const fetchItems = async () => {
    if (!coupleId) return;
    try {
      const { data, error: fetchErr } = await supabase.from("bucket_list").select("*").eq("couple_id", coupleId);
      if (fetchErr) throw fetchErr;
      const normalized = (data || []).map((row: Record<string, unknown>) => ({
        ...row,
        photo_urls: Array.isArray(row.photo_urls) ? row.photo_urls : [],
      })) as BucketItem[];
      setItems(normalized);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load the bucket list.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    const channel = supabase
      .channel(`bucket_list_${coupleId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bucket_list", filter: `couple_id=eq.${coupleId}` }, () => fetchItems())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coupleId, supabase]);

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const set = new Set<number>([currentYear, currentYear + 1]);
    items.forEach((i) => {
      if (i.target_year) set.add(i.target_year);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [items]);

  const tabs = useMemo(() => ["All", ...years.map(String), "Someday"], [years]);

  const activeItems = useMemo(() => items.filter((i) => !i.is_completed), [items]);
  const hallOfFame = useMemo(
    () => items.filter((i) => i.is_completed).sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || "")),
    [items]
  );

  const tabFiltered = useMemo(() => {
    let list = activeItems;
    if (activeTab === "Someday") list = list.filter((i) => !i.target_year);
    else if (activeTab !== "All") list = list.filter((i) => i.target_year === Number(activeTab));
    if (activeCategory !== "all") list = list.filter((i) => i.category === activeCategory);
    return list;
  }, [activeItems, activeTab, activeCategory]);

  const tabProgress = useMemo(() => {
    let list = items;
    if (activeTab === "Someday") list = list.filter((i) => !i.target_year);
    else if (activeTab !== "All") list = list.filter((i) => i.target_year === Number(activeTab));
    if (activeCategory !== "all") list = list.filter((i) => i.category === activeCategory);
    const total = list.length;
    const done = list.filter((i) => i.is_completed).length;
    return { total, done, pct: total ? done / total : 0 };
  }, [items, activeTab, activeCategory]);

  /* --------------------------------------------------------------- crud */

  const openCreate = () => {
    setEditingItem(null);
    setForm({
      title: "",
      description: "",
      category: "Travel",
      customCategory: "",
      useCustomCategory: false,
      targetYear: activeTab !== "All" && activeTab !== "Someday" ? activeTab : "",
      hypeRating: 3,
      coverEmoji: "🌀",
      color: "tape-gold-solid",
      photos: [],
    });
    setPhotoError(null);
    setIsModalOpen(true);
  };

  const openEdit = (item: BucketItem) => {
    const preset = CATEGORY_PRESETS.find((c) => c.value === item.category);
    setEditingItem(item);
    setForm({
      title: item.title,
      description: item.description || "",
      category: preset ? preset.value : "Travel",
      customCategory: preset ? "" : item.category,
      useCustomCategory: !preset,
      targetYear: item.target_year ? String(item.target_year) : "",
      hypeRating: item.hype_rating || 3,
      coverEmoji: item.cover_emoji || "🌀",
      color: item.color || "tape-gold-solid",
      photos: item.photo_urls || [],
    });
    setPhotoError(null);
    setIsModalOpen(true);
  };

  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files) return;
    setPhotoError(null);
    const remaining = MAX_PHOTOS - form.photos.length;
    if (remaining <= 0) {
      setPhotoError(`Up to ${MAX_PHOTOS} photos per adventure.`);
      return;
    }
    const toAdd = Array.from(files).slice(0, remaining);
    for (const file of toAdd) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_PHOTO_BYTES) {
        setPhotoError(`Keep each photo under ${MAX_PHOTO_BYTES / (1024 * 1024)}MB.`);
        continue;
      }
      const dataUrl = await readFileAsDataUrl(file);
      setForm((f) => ({ ...f, photos: [...f.photos, dataUrl] }));
    }
  };

  const [runSave, isSaving] = useGuardedAction(async (e: React.FormEvent) => {
    e.preventDefault();
    const category = form.useCustomCategory ? form.customCategory.trim() || "Crazy Ideas" : form.category;
    if (!form.title.trim()) {
      setError("Give the adventure a title.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim(),
        category,
        target_year: form.targetYear ? Number(form.targetYear) : null,
        hype_rating: form.hypeRating,
        cover_emoji: form.coverEmoji,
        color: form.color,
        photo_urls: form.photos,
      };

      if (editingItem) {
        const { error: updateErr } = await supabase.from("bucket_list").update(payload).eq("id", editingItem.id);
        if (updateErr) throw updateErr;
      } else {
        payload.couple_id = coupleId;
        payload.creator_id = userId;
        const { error: insertErr } = await supabase.from("bucket_list").insert(payload);
        if (insertErr) throw insertErr;
      }
      setIsModalOpen(false);
      setEditingItem(null);
      await fetchItems();
    } catch (err: any) {
      setError(err.message || "Could not save this adventure.");
    } finally {
      setSaving(false);
    }
  });

  const [runDelete] = useGuardedAction(async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setConfirmDeleteId(null);
    const { error: delErr } = await supabase.from("bucket_list").delete().eq("id", id);
    if (delErr) {
      setError(delErr.message);
      fetchItems();
    }
  });

  const [runCompletion] = useGuardedAction(async () => {
    if (!completionDraft) return;
    const { item, note, photo } = completionDraft;
    const photos = photo ? [...item.photo_urls, photo] : item.photo_urls;
    const { error: err } = await supabase
      .from("bucket_list")
      .update({ is_completed: true, completed_at: new Date().toISOString(), completed_note: note.trim() || null, photo_urls: photos })
      .eq("id", item.id);
    if (err) {
      setError(err.message);
    } else {
      setCollapseBurst(item);
    }
    setCompletionDraft(null);
  });

  const [runReopen] = useGuardedAction(async (item: BucketItem) => {
    const { error: err } = await supabase
      .from("bucket_list")
      .update({ is_completed: false, completed_at: null })
      .eq("id", item.id);
    if (err) setError(err.message);
  });

  const spinTheWeb = () => {
    if (tabFiltered.length === 0) return;
    setIsSpinning(true);
    setRouletteResult(null);
    setTimeout(() => {
      const pick = tabFiltered[Math.floor(Math.random() * tabFiltered.length)];
      setRouletteResult(pick);
      setIsSpinning(false);
    }, 1100);
  };

  /* ---------------------------------------------------------- rendering */

  const ItemCard = ({ item, idx }: { item: BucketItem; idx: number }) => {
    const theme = categoryTheme(item.category);
    const tape = item.color || theme.tape;
    const isDeletePending = confirmDeleteId === item.id;
    const tilt = CARD_ROTATIONS[idx % CARD_ROTATIONS.length];
    return (
      <div
        className={`group relative border-3 border-[#261D24] rounded-[28px] pt-9 pb-4 px-4 ${theme.bg} shadow-[8px_8px_0_rgba(23,19,26,0.5)] transition-all duration-300 ${tilt} hover:rotate-0 hover:-translate-y-1.5 hover:shadow-[10px_10px_0_rgba(23,19,26,0.55)]`}
      >
        {/* torn category flag, pinned like a little sticker tab */}
        <span
          className={`absolute -top-3 left-1/2 -translate-x-1/2 w-max whitespace-nowrap px-3 py-1 ${tape} rounded-full text-[9px] font-mono font-black uppercase tracking-wider text-[#1A0D10] border-2 border-[#261D24] shadow-[2px_2px_0_#171B22] z-10`}
        >
          {item.category}
        </span>

        {/* edit/delete tucked away until you hover, so the card reads clean by default */}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
          <button onClick={() => openEdit(item)} className="p-1.5 bg-white/80 hover:bg-white rounded-full border border-[#261D24]/30 transition cursor-pointer">
            <Edit3 className="w-3 h-3 text-[#261D24]" />
          </button>
          {isDeletePending ? (
            <button onClick={() => runDelete(item.id)} className="px-2 py-1 bg-[#7D2834] text-[#FAF4EB] rounded-full text-[8px] font-mono font-black cursor-pointer animate-pulse">
              SURE?
            </button>
          ) : (
            <button
              onClick={() => setConfirmDeleteId(item.id)}
              onBlur={() => setTimeout(() => setConfirmDeleteId((c) => (c === item.id ? null : c)), 2500)}
              className="p-1.5 bg-white/80 hover:bg-red-100 rounded-full border border-[#261D24]/30 transition cursor-pointer"
            >
              <Trash2 className="w-3 h-3 text-[#7D2834]" />
            </button>
          )}
        </div>

        {/* the big cute icon badge - the focal point, like the reference moodboard */}
        <div className="flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-full bg-[#FAF6EE] border-3 border-[#261D24] flex items-center justify-center text-4xl shadow-[3px_3px_0_rgba(23,19,26,0.4)] mb-2.5 group-hover:scale-105 transition-transform">
            {item.cover_emoji || theme.emoji}
          </div>
          <h4 className="font-marker text-xl text-[#1A0D10] leading-tight">{item.title}</h4>
          {item.description && (
            <p className="font-handwriting text-lg text-stone-800 mt-1 leading-snug line-clamp-2">{item.description}</p>
          )}
          {item.target_year && (
            <span className="mt-1.5 inline-block font-mono text-[9px] font-black text-[#5A2029] bg-white/60 px-2 py-0.5 rounded-full border border-[#261D24]/20">
              🎯 {item.target_year}
            </span>
          )}
        </div>

        {item.photo_urls.length > 0 && (
          <div className="flex justify-center gap-1.5 mt-3">
            {item.photo_urls.slice(0, 3).map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt=""
                className={`w-11 h-11 object-cover rounded-lg border-2 border-[#261D24] shadow-[2px_2px_0_rgba(23,19,26,0.4)] ${i % 2 ? "rotate-3" : "-rotate-3"}`}
              />
            ))}
          </div>
        )}

        <p className="text-center font-mono text-[9px] text-stone-500 mt-2">added by {item.creator_id === userId ? myName : partnerName}</p>

        <div className="flex items-center justify-between mt-3 pt-3 border-t-2 border-dashed border-[#8A7550]/70">
          <div className="flex gap-0.5" title={`Hype: ${item.hype_rating}/5`}>
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className={i < item.hype_rating ? "opacity-100" : "opacity-25 grayscale"}>
                🕸️
              </span>
            ))}
          </div>
          <button
            onClick={() => setCompletionDraft({ item, note: "", photo: null })}
            className="px-3 py-1.5 bg-[#1E3A34] hover:bg-[#16281f] text-[#FAF4EB] rounded-full font-mono text-[10px] font-black uppercase flex items-center gap-1.5 cursor-pointer transition"
          >
            <Check className="w-3.5 h-3.5" /> Done
          </button>
        </div>
      </div>
    );
  };

  return (
    <main className="min-h-screen w-full p-4 sm:p-8 lg:p-12 bg-[#14181A] relative overflow-hidden animate-toc-reveal">
      <div className="absolute inset-0 bg-[radial-gradient(#242e2c_1.5px,transparent_1.5px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

      <div className="max-w-6xl mx-auto relative z-10">
        <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
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
            <span className="tracking-widest uppercase">New Adventure</span>
          </button>
        </header>

        <section className="paper-sheet-solid p-6 sm:p-10 relative border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.85)] overflow-hidden">
          {/* scattered stickers - CSS/emoji only, no image weight */}
          <span className="absolute top-6 right-8 text-2xl opacity-30 -rotate-12 pointer-events-none select-none hidden sm:inline">🕷️</span>
          <span className="absolute top-24 left-10 text-xl opacity-25 rotate-12 pointer-events-none select-none hidden sm:inline">✨</span>
          <span className="absolute bottom-8 right-20 text-2xl opacity-20 rotate-6 pointer-events-none select-none hidden sm:inline">🕸️</span>
          <span className="absolute top-10 left-1/4 text-lg opacity-20 -rotate-6 pointer-events-none select-none hidden md:inline">💫</span>

          <div className="flex flex-col items-center text-center gap-4 pb-6 border-b-3 border-dashed border-[#8A7550] relative">
            <div className="relative inline-block -rotate-1 mt-2">
              <span className="absolute -top-3 -left-7 w-16 h-6 tape-pink-solid rotate-6 z-10" />
              <span className="absolute -top-3 -right-7 w-16 h-6 tape-gold-solid -rotate-6 z-10" />
              <h1
                className="font-marker text-4xl sm:text-6xl text-[#1A0D10] leading-none px-2"
                style={{ WebkitTextStroke: "1.2px #261D24", textShadow: "3px 3px 0 rgba(23,19,26,0.25)" }}
              >
                Multiverse Bucket List
              </h1>
            </div>
            <span className="postage-stamp -rotate-1">CHAPTER 08 · SHARED GOALS</span>
            <div className="bg-[#7D2834] text-[#FAF4EB] font-mono text-[11px] sm:text-xs font-black uppercase tracking-widest px-6 py-2 rounded-full border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] rotate-1 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5" /> pick your next adventure together <Sparkles className="w-3.5 h-3.5" />
            </div>
            <WebProgress pct={tabProgress.pct} label={`${tabProgress.done}/${tabProgress.total} complete`} />
          </div>

          {error && (
            <div className="my-3 p-3 rounded-lg bg-[#5A2029] text-[#F2E6D2] text-xs font-mono flex items-center gap-2 border-2 border-[#261D24]">
              <AlertCircle className="w-4 h-4 shrink-0" /> <span>{error}</span>
            </div>
          )}

          {/* Year tabs */}
          <div className="flex flex-wrap gap-1.5 mt-4">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-1.5 font-mono text-[10px] font-black border-2 border-[#261D24] rounded-t-lg cursor-pointer transition ${activeTab === t ? "bg-[#7D2834] text-[#FAF4EB] -translate-y-0.5" : "bg-[#EFE4D6] hover:bg-white"}`}
              >
                {t === "Someday" ? "🌙 Someday" : t}
              </button>
            ))}
          </div>

          {/* Category chips + roulette */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3 pb-4 border-b-3 border-dashed border-[#8A7550]">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-3 py-1 font-mono text-[10px] font-black border-2 border-[#261D24] rounded-full cursor-pointer transition ${activeCategory === "all" ? "bg-[#7D2834] text-[#FAF4EB] scale-105" : "bg-[#F2E6D2] hover:bg-white"}`}
            >
              All
            </button>
            {CATEGORY_PRESETS.map((c) => (
              <button
                key={c.value}
                onClick={() => setActiveCategory(c.value)}
                className={`px-3 py-1 font-mono text-[10px] font-black border-2 border-[#261D24] rounded-full cursor-pointer transition ${activeCategory === c.value ? "bg-[#7D2834] text-[#FAF4EB] scale-105" : "bg-[#F2E6D2] hover:bg-white"}`}
              >
                {c.emoji} {c.value}
              </button>
            ))}
            <button
              onClick={spinTheWeb}
              disabled={tabFiltered.length === 0}
              className="ml-auto px-3.5 py-1.5 bg-[#1A0D10] hover:bg-black text-[#FAF4EB] rounded-full font-mono text-[10px] font-black uppercase flex items-center gap-1.5 cursor-pointer transition disabled:opacity-40 border-2 border-[#261D24] shadow-[2px_2px_0_#171B22]"
            >
              <Shuffle className="w-3.5 h-3.5" /> Spin the Web
            </button>
          </div>

          {loading ? (
            <div className="py-24 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#7D2834]" />
            </div>
          ) : tabFiltered.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-6xl mb-3">🕸️🌀</div>
              <p className="font-marker text-2xl text-[#7D2834]">Nothing pinned here yet!</p>
              <p className="font-handwriting text-xl text-stone-600 mt-1">Add your next multiverse adventure above.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-8 my-6">
              {tabFiltered.map((item, idx) => (
                <ItemCard key={item.id} item={item} idx={idx} />
              ))}
            </div>
          )}

          {/* Hall of Fame */}
          {hallOfFame.length > 0 && (
            <div className="mt-6 pt-6 border-t-3 border-dashed border-[#8A7550]">
              <button onClick={() => setShowHallOfFame((s) => !s)} className="flex items-center gap-2 font-marker text-2xl text-[#7D2834] cursor-pointer">
                <Trophy className="w-6 h-6" /> Hall of Fame ({hallOfFame.length})
                {showHallOfFame ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
              {showHallOfFame && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-8 mt-6">
                  {hallOfFame.map((item, idx) => (
                    <div
                      key={item.id}
                      className={`relative border-3 border-[#261D24] rounded-[28px] pt-9 pb-4 px-4 bg-[#EAD9A9] shadow-[8px_8px_0_rgba(23,19,26,0.5)] ${CARD_ROTATIONS[idx % CARD_ROTATIONS.length]} hover:rotate-0 transition duration-300`}
                    >
                      <div className="absolute -top-4 -right-3 w-11 h-11 rounded-full bg-[#7D2834] border-3 border-[#261D24] flex items-center justify-center text-xl shadow-[3px_3px_0_#171B22] z-10">
                        🏅
                      </div>
                      <div className="flex flex-col items-center text-center">
                        <div className="w-16 h-16 rounded-full bg-[#FAF6EE] border-3 border-[#261D24] flex items-center justify-center text-3xl shadow-[3px_3px_0_rgba(23,19,26,0.4)] mb-2">
                          {item.cover_emoji}
                        </div>
                        <span className="font-mono text-[9px] font-black uppercase text-[#5A2029]">{item.category}</span>
                        <h4 className="font-marker text-lg text-[#1A0D10] mt-0.5">{item.title}</h4>
                        {item.completed_note && <p className="font-handwriting text-lg text-stone-800 mt-1 leading-snug">&ldquo;{item.completed_note}&rdquo;</p>}
                      </div>
                      {item.photo_urls.length > 0 && (
                        <div className="flex justify-center gap-1.5 mt-3">
                          {item.photo_urls.slice(0, 3).map((url, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={url} alt="" className={`w-11 h-11 object-cover rounded-lg border-2 border-[#261D24] shrink-0 ${i % 2 ? "rotate-3" : "-rotate-3"}`} />
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-3 pt-3 border-t-2 border-dashed border-[#8A7550]/70">
                        <span className="font-mono text-[9px] text-stone-600">
                          {item.completed_at && new Date(item.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                        <button onClick={() => runReopen(item)} className="font-mono text-[9px] font-black text-[#5A2029] underline cursor-pointer">
                          reopen
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="text-center pt-6 mt-6 border-t-3 border-dashed border-[#8A7550]">
            <p className="font-handwriting text-2xl sm:text-3xl text-[#5A2029]">&ldquo;Every dimension has an adventure waiting for us.&rdquo;</p>
          </div>
        </section>
      </div>

      {/* Add/Edit modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="paper-sheet-solid max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 relative border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.95)] rounded-2xl">
            <div className="absolute -top-3.5 left-12 w-28 h-6 tape-pink-solid -rotate-2 pointer-events-none" />
            <div className="absolute -top-3.5 right-12 w-28 h-6 tape-red-solid rotate-2 pointer-events-none" />
            <button type="button" onClick={() => setIsModalOpen(false)} className="absolute top-5 right-5 p-2 rounded-lg bg-[#EFE4D6] hover:bg-[#E2D2C0] border-2 border-[#261D24] cursor-pointer">
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5 pb-3 border-b-3 border-dashed border-[#8A7550]">
              <span className="text-3xl">🌀</span>
              <h2 className="font-marker text-2xl sm:text-3xl text-[#261D24]">{editingItem ? "Edit Adventure" : "Pin New Adventure"}</h2>
            </div>

            <form onSubmit={runSave} className="space-y-4">
              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Title *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Watch the sunrise from a mountain"
                  className="w-full text-sm font-mono p-3 rounded-xl bg-white border-3 border-[#261D24] outline-none shadow-inner"
                />
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Category</label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_PRESETS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, category: c.value, useCustomCategory: false }))}
                      className={`px-2.5 py-1 font-mono text-[10px] font-black border-2 border-[#261D24] rounded cursor-pointer transition ${!form.useCustomCategory && form.category === c.value ? "bg-[#7D2834] text-[#FAF4EB]" : "bg-white hover:bg-stone-100"}`}
                    >
                      {c.emoji} {c.value}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, useCustomCategory: true }))}
                    className={`px-2.5 py-1 font-mono text-[10px] font-black border-2 border-[#261D24] rounded cursor-pointer transition ${form.useCustomCategory ? "bg-[#7D2834] text-[#FAF4EB]" : "bg-white hover:bg-stone-100"}`}
                  >
                    + Custom
                  </button>
                </div>
                {form.useCustomCategory && (
                  <input
                    type="text"
                    value={form.customCategory}
                    onChange={(e) => setForm((f) => ({ ...f, customCategory: e.target.value }))}
                    placeholder="Name your own category"
                    className="w-full mt-2 text-sm font-mono p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none shadow-inner"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Target Year</label>
                  <select
                    value={form.targetYear}
                    onChange={(e) => setForm((f) => ({ ...f, targetYear: e.target.value }))}
                    className="w-full text-xs font-mono p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none shadow-inner"
                  >
                    <option value="">🌙 Someday</option>
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Hype Level</label>
                  <div className="flex gap-1 pt-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, hypeRating: i + 1 }))}
                        className={`text-xl cursor-pointer transition ${i < form.hypeRating ? "opacity-100 scale-110" : "opacity-25 grayscale"}`}
                      >
                        🕸️
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Description</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full font-handwriting text-xl p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none resize-none shadow-inner"
                />
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Cover Emoji</label>
                <div className="flex flex-wrap gap-1.5">
                  {COVER_EMOJI_CHOICES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, coverEmoji: s }))}
                      className={`text-xl p-1.5 rounded-lg border-2 cursor-pointer transition ${form.coverEmoji === s ? "border-[#7D2834] bg-[#ECA8B8]/40 scale-110" : "border-transparent hover:bg-stone-200"}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Tape Color</label>
                <div className="flex gap-2">
                  {TAPE_CHOICES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, color: t }))}
                      className={`w-10 h-6 rounded ${t} border-2 cursor-pointer ${form.color === t ? "border-[#261D24] scale-110" : "border-transparent"} transition`}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">
                  Photos ({form.photos.length}/{MAX_PHOTOS})
                </label>
                <div className="flex flex-wrap gap-2">
                  {form.photos.map((url, i) => (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="w-16 h-16 object-cover rounded-lg border-2 border-[#261D24]" />
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, photos: f.photos.filter((_, idx) => idx !== i) }))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#7D2834] text-white rounded-full flex items-center justify-center text-[10px] cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {form.photos.length < MAX_PHOTOS && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-16 h-16 border-2 border-dashed border-[#8A7550] rounded-lg flex items-center justify-center cursor-pointer hover:bg-stone-100"
                    >
                      <ImagePlus className="w-6 h-6 text-[#8A7550]" />
                    </button>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePhotoUpload(e.target.files)} />
                {photoError && <p className="text-[10px] font-mono text-[#7D2834] mt-1">{photoError}</p>}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t-3 border-dashed border-[#8A7550]">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 rounded-xl bg-[#EFE4D6] hover:bg-[#E2D2C0] font-mono text-xs font-black border-3 border-[#261D24] cursor-pointer">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || isSaving}
                  className="px-6 py-2.5 rounded-xl bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] font-mono text-xs font-black border-3 border-[#261D24] shadow-[4px_4px_0_#171B24] flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingItem ? "Update" : "Pin It"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Completion ritual modal */}
      {completionDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="paper-sheet-solid max-w-md w-full p-6 sm:p-8 relative border-4 border-[#261D24] shadow-[16px_16px_0_rgba(0,0,0,0.95)] rounded-2xl">
            <button onClick={() => setCompletionDraft(null)} className="absolute top-5 right-5 p-2 rounded-lg bg-[#EFE4D6] hover:bg-[#E2D2C0] border-2 border-[#261D24] cursor-pointer">
              <X className="w-5 h-5" />
            </button>
            <h2 className="font-marker text-2xl sm:text-3xl text-[#261D24] mb-1">🏅 Completion Ritual</h2>
            <p className="font-handwriting text-xl text-stone-700 mb-4">{completionDraft.item.title}</p>

            <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">A quick reflection</label>
            <textarea
              rows={2}
              value={completionDraft.note}
              onChange={(e) => setCompletionDraft((d) => (d ? { ...d, note: e.target.value } : d))}
              placeholder="How was it?"
              className="w-full font-handwriting text-xl p-2.5 rounded-xl bg-white border-3 border-[#261D24] outline-none resize-none shadow-inner mb-4"
            />

            <label className="block font-mono text-xs font-black text-[#7D2834] uppercase mb-1">Proof photo (optional)</label>
            {completionDraft.photo ? (
              <div className="relative w-20 h-20 mb-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={completionDraft.photo} alt="" className="w-20 h-20 object-cover rounded-lg border-2 border-[#261D24]" />
                <button
                  onClick={() => setCompletionDraft((d) => (d ? { ...d, photo: null } : d))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#7D2834] text-white rounded-full flex items-center justify-center text-[10px] cursor-pointer"
                >
                  ×
                </button>
              </div>
            ) : (
              <label className="w-20 h-20 border-2 border-dashed border-[#8A7550] rounded-lg flex items-center justify-center cursor-pointer hover:bg-stone-100 mb-4">
                <Camera className="w-6 h-6 text-[#8A7550]" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > MAX_PHOTO_BYTES) {
                      setError(`Keep the photo under ${MAX_PHOTO_BYTES / (1024 * 1024)}MB.`);
                      return;
                    }
                    const dataUrl = await readFileAsDataUrl(file);
                    setCompletionDraft((d) => (d ? { ...d, photo: dataUrl } : d));
                  }}
                />
              </label>
            )}

            <button
              onClick={() => runCompletion()}
              className="w-full px-6 py-3 bg-[#1E3A34] hover:bg-[#16281f] text-[#FAF4EB] font-mono text-sm font-black border-3 border-[#261D24] shadow-[4px_4px_0_#171B24] flex items-center justify-center gap-2 cursor-pointer"
            >
              <Trophy className="w-4 h-4" /> Collapse Into Canon
            </button>
          </div>
        </div>
      )}

      {/* Completion burst */}
      {collapseBurst && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md" onClick={() => setCollapseBurst(null)}>
          <div className="collapse-burst text-center">
            <div className="text-7xl mb-4">🏆🕸️✨</div>
            <h2 className="font-marker text-4xl sm:text-6xl text-[#FAF4EB]">COLLAPSED INTO CANON!</h2>
            <p className="font-handwriting text-2xl text-[#E0B1AE] mt-2">{collapseBurst.title} is officially done.</p>
            <button onClick={() => setCollapseBurst(null)} className="mt-6 px-6 py-3 bg-[#7D2834] text-[#F2E6D2] font-mono text-sm font-black border-3 border-[#261D24] cursor-pointer">
              TO THE HALL OF FAME 🏅
            </button>
          </div>
        </div>
      )}

      {/* Roulette overlay */}
      {(isSpinning || rouletteResult) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md" onClick={() => !isSpinning && setRouletteResult(null)}>
          {isSpinning ? (
            <div className="text-center">
              <div className="web-spin text-8xl">🕸️</div>
              <p className="font-marker text-2xl text-[#FAF4EB] mt-4">Spinning the multiverse...</p>
            </div>
          ) : (
            rouletteResult && (
              <div className="roulette-reveal text-center max-w-sm" onClick={(e) => e.stopPropagation()}>
                <p className="font-mono text-xs font-black uppercase text-[#E0B1AE] tracking-widest mb-2">The multiverse has chosen</p>
                <div className={`border-4 border-[#261D24] rounded-2xl p-6 ${categoryTheme(rouletteResult.category).bg} shadow-[10px_10px_0_rgba(0,0,0,0.7)]`}>
                  <span className="text-5xl">{rouletteResult.cover_emoji || categoryTheme(rouletteResult.category).emoji}</span>
                  <h3 className="font-marker text-3xl text-[#1A0D10] mt-2">{rouletteResult.title}</h3>
                  {rouletteResult.description && <p className="font-handwriting text-lg text-stone-800 mt-1">{rouletteResult.description}</p>}
                </div>
                <div className="flex gap-3 mt-5 justify-center">
                  <button onClick={spinTheWeb} className="px-4 py-2.5 bg-[#EFE4D6] border-2 border-[#261D24] rounded-lg font-mono text-xs font-black cursor-pointer">
                    Spin Again
                  </button>
                  <button onClick={() => setRouletteResult(null)} className="px-4 py-2.5 bg-[#7D2834] text-[#FAF4EB] border-2 border-[#261D24] rounded-lg font-mono text-xs font-black cursor-pointer">
                    Let&apos;s Do It 🚀
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      <style>{`
        @keyframes web-spin-kf { from { transform: rotate(0deg) scale(1); } to { transform: rotate(360deg) scale(1.15); } }
        .web-spin { animation: web-spin-kf 1.1s linear infinite; display: inline-block; }

        @keyframes roulette-reveal-kf {
          0% { transform: scale(0.4) rotate(-12deg); opacity: 0; }
          60% { transform: scale(1.08) rotate(3deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        .roulette-reveal { animation: roulette-reveal-kf 0.5s cubic-bezier(0.34,1.56,0.64,1); }

        @keyframes collapse-burst-kf {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .collapse-burst { animation: collapse-burst-kf 0.55s cubic-bezier(0.34,1.56,0.64,1); }
      `}</style>
    </main>
  );
}
