"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, BookHeart, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface DiaryEntry {
  id: string;
  couple_id: string;
  author_id: string;
  title: string;
  content: string;
  mood: string | null;
  created_at: string;
  updated_at: string;
}

interface DiaryScreenProps {
  userId: string;
  coupleId: string;
  onBack: () => void;
}

export default function DiaryScreen({ userId, coupleId, onBack }: DiaryScreenProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mood, setMood] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = async () => {
    const { data, error: loadError } = await supabase
      .from("shared_diary")
      .select("id, couple_id, author_id, title, content, mood, created_at, updated_at")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false });

    if (loadError) {
      setError(loadError.message);
    } else {
      setEntries(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadEntries();
  }, [coupleId]);

  const resetForm = () => {
    setSelectedId(null);
    setTitle("");
    setContent("");
    setMood("");
  };

  const selectEntry = (entry: DiaryEntry) => {
    setSelectedId(entry.id);
    setTitle(entry.title);
    setContent(entry.content);
    setMood(entry.mood ?? "");
  };

  const saveEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setSaving(true);
    setError(null);
    const values = {
      couple_id: coupleId,
      author_id: userId,
      title: title.trim(),
      content: content.trim(),
      mood: mood.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const result = selectedId
      ? await supabase.from("shared_diary").update(values).eq("id", selectedId)
      : await supabase.from("shared_diary").insert(values);

    if (result.error) {
      setError(result.error.message);
    } else {
      await loadEntries();
      resetForm();
    }
    setSaving(false);
  };

  const deleteEntry = async (id: string) => {
    const { error: deleteError } = await supabase.from("shared_diary").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setEntries((current) => current.filter((entry) => entry.id !== id));
    if (selectedId === id) resetForm();
  };

  return (
    <main className="min-h-screen bg-[#28313B] p-5 sm:p-10 text-[#261D24]">
      <div className="max-w-7xl mx-auto">
        <button onClick={onBack} className="mb-8 flex items-center gap-2 text-[#E0B1AE] font-mono text-xs hover:text-[#F2E6D2]">
          <ArrowLeft className="w-4 h-4" /> BACK TO SCRAPBOOK
        </button>

        <section className="paper-sheet-solid p-6 sm:p-10 min-h-[80vh]">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
            <div>
              <span className="font-mono text-[11px] tracking-[.25em] text-[#7D2834]">SHARED DIARY • LIVE ARCHIVE</span>
              <h1 className="font-marker text-5xl sm:text-7xl mt-2">Our Pages</h1>
              <p className="font-handwriting text-2xl text-[#5A2029] mt-2">A real diary for the two of you.</p>
            </div>
            <button onClick={resetForm} className="flex items-center gap-2 bg-[#7D2834] text-[#F2E6D2] px-4 py-3 font-mono text-xs font-bold shadow-[5px_6px_0_#261D24]">
              <Plus className="w-4 h-4" /> NEW ENTRY
            </button>
          </div>

          {error && <p className="mb-5 border-l-4 border-[#7D2834] bg-[#E0B1AE] p-3 font-mono text-xs">{error}</p>}

          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] gap-8">
            <div className="space-y-4">
              {loading && <p className="font-mono text-xs">Loading pages...</p>}
              {!loading && entries.length === 0 && <p className="font-handwriting text-3xl text-[#5A2029]">Your first page is waiting.</p>}
              {entries.map((entry, index) => (
                <article key={entry.id} className="bg-[#E8D9C1] border-2 border-[#261D24] p-5 shadow-[7px_8px_0_rgba(38,29,36,.35)]" style={{ transform: `rotate(${index % 2 ? "1deg" : "-1deg"})` }}>
                  <div className="flex items-start justify-between gap-3">
                    <button onClick={() => selectEntry(entry)} className="text-left flex-1">
                      <p className="font-mono text-[10px] text-[#7D2834]">{new Date(entry.created_at).toLocaleDateString()}</p>
                      <h2 className="font-marker text-2xl mt-1">{entry.title}</h2>
                      <p className="font-handwriting text-xl text-[#5A2029] mt-2 line-clamp-2">{entry.content}</p>
                    </button>
                    <div className="flex gap-2">
                      <button onClick={() => selectEntry(entry)} title="Edit entry" className="text-[#7D2834]"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => deleteEntry(entry.id)} title="Delete entry" className="text-[#7D2834]"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <form onSubmit={saveEntry} className="bg-[#F2E6D2] border-4 border-[#261D24] p-5 shadow-[9px_10px_0_rgba(38,29,36,.4)] rotate-1">
              <BookHeart className="w-9 h-9 text-[#7D2834] mb-4" />
              <label className="font-mono text-[10px] font-bold text-[#7D2834]">PAGE TITLE</label>
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full bg-transparent border-b-2 border-[#C5A467] py-2 outline-none font-marker text-2xl mb-5" placeholder="A tiny chapter..." />
              <label className="font-mono text-[10px] font-bold text-[#7D2834]">MOOD</label>
              <input value={mood} onChange={(event) => setMood(event.target.value)} className="w-full bg-transparent border-b-2 border-[#C5A467] py-2 outline-none font-handwriting text-xl mb-5" placeholder="soft, chaotic, sunny..." />
              <label className="font-mono text-[10px] font-bold text-[#7D2834]">ENTRY</label>
              <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={10} className="w-full bg-transparent border-2 border-dashed border-[#C5A467] p-3 outline-none font-handwriting text-xl resize-none mt-2" placeholder="Dear diary..." />
              <button disabled={saving} className="mt-5 w-full bg-[#7D2834] text-[#F2E6D2] py-3 font-mono text-xs font-bold shadow-[5px_6px_0_#261D24]">{saving ? "SAVING..." : selectedId ? "UPDATE PAGE" : "SAVE PAGE"}</button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
