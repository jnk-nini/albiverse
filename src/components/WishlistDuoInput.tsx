"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, FlaskConical, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { playBondSnap, playPop, playThwip, type EntryMode, type Priority, hashString } from "@/lib/wishlistLab";

/* ============================================================================
   THE DYNAMIC DUO INPUT - "Snapshot" vs "Scientist" entry

   How a new find gets pinned to the R&D lab. Two sides of one card: Peter's
   camera (quick photo, developed like a Polaroid, details revealed with a
   tap-and-shake) and Gwen's notebook (a precise data form that unfurls like
   graph paper, with a background chemical-structure doodle that grows as you
   type, and a "molecular bond" snap on submit).

   Only used for CREATING a new item - editing an existing one stays on
   WishlistScreen's simpler blueprint-style edit form, unchanged. */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export interface WishlistDraft {
  title: string;
  description: string;
  price: string;
  link: string;
  image: string | null;
  entryMode: EntryMode;
  priority: Priority;
}

export default function WishlistDuoInput({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: WishlistDraft) => void;
}) {
  const [side, setSide] = useState<EntryMode>("snapshot");

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md"
      onClick={onClose}
    >
      <style>{`
        @keyframes wdi-develop {
          0% { filter: grayscale(1) blur(6px) brightness(0.5) contrast(1.3); }
          100% { filter: grayscale(0) blur(0) brightness(1) contrast(1); }
        }
        .wdi-developing { animation: wdi-develop 1.3s ease-out forwards; }
        @keyframes wdi-unfurl {
          0% { transform: scaleY(0.15); opacity: 0; }
          60% { transform: scaleY(1.04); opacity: 1; }
          100% { transform: scaleY(1); opacity: 1; }
        }
        .wdi-unfurl { transform-origin: top center; animation: wdi-unfurl 0.7s cubic-bezier(.2,.8,.3,1) forwards; }
        @keyframes wdi-helix-a { 0%,100% { transform: translateX(0); } 50% { transform: translateX(10px); } }
        @keyframes wdi-helix-b { 0%,100% { transform: translateX(10px); } 50% { transform: translateX(0); } }
        .wdi-helix-a { animation: wdi-helix-a 2.4s ease-in-out infinite; }
        .wdi-helix-b { animation: wdi-helix-b 2.4s ease-in-out infinite; }
        @keyframes wdi-glow { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
        .wdi-glow { animation: wdi-glow 1.8s ease-in-out infinite; }
        @keyframes wdi-shake-hint { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(-3deg); } 75% { transform: rotate(3deg); } }
        .wdi-shake-hint { animation: wdi-shake-hint 0.6s ease-in-out infinite; }
        @keyframes wdi-bond-a { 0% { transform: translate(-26px,0) scale(1); } 100% { transform: translate(0,0) scale(1.15); } }
        @keyframes wdi-bond-b { 0% { transform: translate(26px,0) scale(1); } 100% { transform: translate(0,0) scale(1.15); } }
        .wdi-bond-a { animation: wdi-bond-a 0.5s ease-in forwards; }
        .wdi-bond-b { animation: wdi-bond-b 0.5s ease-in forwards; }
        @keyframes wdi-stamp-in { 0% { transform: scale(2) rotate(-25deg); opacity: 0; } 100% { transform: scale(1) rotate(-12deg); opacity: 1; } }
        .wdi-stamp-in { animation: wdi-stamp-in 0.35s ease-out forwards; }
      `}</style>

      <div
        className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-lg border-4 border-[#261D24] bg-[#FAF6EE] shadow-[16px_16px_0_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-[#20161A] border-b-4 border-[#261D24] px-4 py-3">
          <p className="font-mono text-[10px] sm:text-xs font-black uppercase tracking-[0.25em] text-[#F2E6D2]">
            New Find — Choose Your Method
          </p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[#F2E6D2] hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* side switcher */}
        <div className="flex border-b-4 border-[#261D24]">
          <button
            type="button"
            onClick={() => setSide("snapshot")}
            className={`flex-1 py-3 font-mono text-[10px] sm:text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer transition ${
              side === "snapshot" ? "bg-[#7D2834] text-[#F2E6D2]" : "bg-[#F2E6D2] text-[#7D2834] hover:bg-white"
            }`}
          >
            <Camera className="w-4 h-4" /> Snapshot (Peter)
          </button>
          <button
            type="button"
            onClick={() => setSide("scientist")}
            className={`flex-1 py-3 font-mono text-[10px] sm:text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer transition border-l-4 border-[#261D24] ${
              side === "scientist" ? "bg-[#28455A] text-[#dcecfa]" : "bg-[#F2E6D2] text-[#28455A] hover:bg-white"
            }`}
          >
            <FlaskConical className="w-4 h-4" /> Scientist (Gwen)
          </button>
        </div>

        <div className="p-4 sm:p-6">
          {side === "snapshot" ? (
            <SnapshotSide busy={busy} onSubmit={onSubmit} />
          ) : (
            <ScientistSide busy={busy} onSubmit={onSubmit} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================ Snapshot side */

function SnapshotSide({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (draft: WishlistDraft) => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [developed, setDeveloped] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [listening, setListening] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAccelRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const motionCleanupRef = useRef<(() => void) | null>(null);

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => () => motionCleanupRef.current?.(), []);

  const handleFile = async (file: File | undefined) => {
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
    setImage(dataUrl);
    setDeveloped(false);
    setRevealed(false);
    playPop();
    window.setTimeout(() => setDeveloped(true), 50);
  };

  const armShakeListener = () => {
    if (revealed) return;
    setListening(true);

    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const prev = lastAccelRef.current;
      lastAccelRef.current = { x: a.x, y: a.y, z: a.z };
      if (!prev) return;
      const delta = Math.abs(a.x - prev.x) + Math.abs(a.y - prev.y) + Math.abs(a.z - prev.z);
      if (delta > 22) reveal();
    };

    const start = () => {
      window.addEventListener("devicemotion", onMotion);
      motionCleanupRef.current = () => window.removeEventListener("devicemotion", onMotion);
    };

    const RequestableDeviceMotionEvent = window.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof RequestableDeviceMotionEvent?.requestPermission === "function") {
      RequestableDeviceMotionEvent.requestPermission()
        .then((state) => {
          if (state === "granted") start();
        })
        .catch(() => {});
    } else if (typeof window.DeviceMotionEvent !== "undefined") {
      start();
    }
    // Desktop / denied-permission / no-motion-support: `listening` is still
    // true here, and onPolaroidTap treats a second tap as a manual reveal
    // regardless of whether real motion detection ever started - so the
    // flow never dead-ends off-device.
  };

  const reveal = () => {
    motionCleanupRef.current?.();
    setListening(false);
    setRevealed(true);
    playThwip();
  };

  const onPolaroidTap = () => {
    if (revealed) return;
    if (listening) {
      reveal();
    } else {
      armShakeListener();
    }
  };

  const canSubmit = image && developed && title.trim().length > 0;

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          handleFile(f);
        }}
      />

      {!image ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-16 flex flex-col items-center gap-3 border-4 border-dashed border-[#7D2834]/50 rounded-lg hover:border-[#7D2834] hover:bg-[#7D2834]/5 transition cursor-pointer"
        >
          <Camera className="w-10 h-10 text-[#7D2834]" strokeWidth={1.5} />
          <span className="font-marker text-xl text-[#7D2834]">*KA-CHINK!*</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-stone-600">
            Tap to take or choose a photo
          </span>
        </button>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={onPolaroidTap}
            className="polaroid-matte relative w-48 sm:w-56 p-3 pb-8 bg-white cursor-pointer"
            style={{ boxShadow: "6px 10px 18px rgba(0,0,0,0.4)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt="Captured find"
              className={`w-full aspect-square object-cover ${developed ? "wdi-developing" : ""}`}
            />
            {developed && !revealed && (
              <span
                className={`absolute -bottom-2 left-1/2 -translate-x-1/2 font-mono text-[8px] font-black uppercase tracking-widest text-[#7D2834] bg-[#F2E6D2] px-2 py-0.5 border border-[#7D2834]/50 whitespace-nowrap ${
                  listening ? "wdi-shake-hint" : ""
                }`}
              >
                {listening ? "shake! (or tap again)" : "tap + shake to develop"}
              </span>
            )}
          </button>

          {revealed && (
            <div className="w-full max-w-sm space-y-3 relative">
              <span className="wdi-stamp-in absolute -top-3 -right-2 z-10 select-none text-[10px] font-mono font-black uppercase tracking-widest text-[#7D2834] bg-[#F2E6D2] border-2 border-[#7D2834] rounded-full px-2 py-1 -rotate-12">
                🕸️ logged
              </span>
              <FieldHandwritten label="What is it?" value={title} onChange={setTitle} placeholder="Vintage camera strap…" autoFocus />
              <div className="grid grid-cols-2 gap-3">
                <FieldHandwritten label="Price" value={price} onChange={setPrice} placeholder="$45" />
                <FieldHandwritten label="URL" value={url} onChange={setUrl} placeholder="paste a link" />
              </div>
              <FieldHandwritten label="Note" value={note} onChange={setNote} placeholder="saw them staring at this for way too long" multiline />
            </div>
          )}

          {photoError && <p className="text-xs text-[#7D2834] font-mono">{photoError}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                setImage(null);
                setDeveloped(false);
                setRevealed(false);
              }}
              className="font-mono text-[10px] font-black uppercase text-stone-600 hover:text-[#7D2834] cursor-pointer"
            >
              Retake
            </button>
            <button
              type="button"
              disabled={!canSubmit || busy}
              onClick={() =>
                onSubmit({
                  title,
                  description: note,
                  price,
                  link: url,
                  image,
                  entryMode: "snapshot",
                  priority: "medium",
                })
              }
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#7D2834] hover:bg-[#5A2029] text-[#F2E6D2] text-xs font-mono font-black uppercase tracking-widest border-2 border-[#261D24] disabled:opacity-40 cursor-pointer"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              Pin to the Board
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldHandwritten({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="block font-mono text-[8px] font-black uppercase tracking-widest text-stone-500 mb-0.5">
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="w-full bg-transparent border-b-2 border-[#7D2834]/40 focus:border-[#7D2834] outline-none font-handwriting text-xl text-[#1A0D10] resize-none py-0.5"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full bg-transparent border-b-2 border-[#7D2834]/40 focus:border-[#7D2834] outline-none font-handwriting text-xl text-[#1A0D10] py-0.5"
        />
      )}
    </label>
  );
}

/* ============================================================ Scientist side */

function ChemDoodle({ seed, intensity }: { seed: string; intensity: number }) {
  const nodeCount = Math.max(3, Math.min(14, intensity));
  const nodes = Array.from({ length: nodeCount }, (_, i) => {
    const h1 = hashString(`${seed}:${i}:x`) % 1000;
    const h2 = hashString(`${seed}:${i}:y`) % 1000;
    return { x: 10 + (h1 / 1000) * 80, y: 10 + (h2 / 1000) * 80 };
  });
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.12]"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {nodes.map((n, i) =>
        i > 0 ? (
          <line
            key={`l-${i}`}
            x1={nodes[i - 1].x}
            y1={nodes[i - 1].y}
            x2={n.x}
            y2={n.y}
            stroke="#28455A"
            strokeWidth={0.4}
          />
        ) : null
      )}
      {nodes.map((n, i) => (
        <circle key={`c-${i}`} cx={n.x} cy={n.y} r={i % 3 === 0 ? 1.6 : 1} fill="#28455A" />
      ))}
    </svg>
  );
}

function ScientistSide({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (draft: WishlistDraft) => void;
}) {
  const [item, setItem] = useState("");
  const [logic, setLogic] = useState("");
  const [source, setSource] = useState("");
  const [price, setPrice] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [bonding, setBonding] = useState(false);

  const totalChars = item.length + logic.length + source.length;
  const seed = "wdi-scientist";
  const canSubmit = item.trim().length > 0;

  const submit = () => {
    if (!canSubmit || busy) return;
    setBonding(true);
    playBondSnap();
    window.setTimeout(() => {
      onSubmit({
        title: item,
        description: logic,
        price,
        link: source,
        image: null,
        entryMode: "scientist",
        priority,
      });
    }, 480);
  };

  return (
    <div className="wdi-unfurl relative rounded-lg border-2 border-[#28455A]/40 bg-[linear-gradient(#28455A0d_1px,transparent_1px),linear-gradient(90deg,#28455A0d_1px,transparent_1px)] [background-size:16px_16px] bg-[#f4f8fb] p-4 sm:p-6 overflow-hidden">
      <ChemDoodle seed={seed} intensity={totalChars / 6} />

      <div className="relative space-y-3">
        <SciField label="ITEM" value={item} onChange={setItem} placeholder="What did they mention wanting?" autoFocus />
        <SciField label="LOGIC (why they'll love it)" value={logic} onChange={setLogic} placeholder="Connects to the thing they keep talking about" multiline />
        <div className="grid grid-cols-2 gap-3">
          <SciField label="SOURCE" value={source} onChange={setSource} placeholder="link or store" />
          <SciField label="EST. COST" value={price} onChange={setPrice} placeholder="$—" />
        </div>
        <label className="block">
          <span className="block font-mono text-[8px] font-black uppercase tracking-widest text-[#28455A]/70 mb-1">
            PRIORITY
          </span>
          <div className="flex gap-2">
            {(["low", "medium", "high"] as Priority[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`px-3 py-1 rounded-full font-serif text-xs tracking-wide border cursor-pointer transition ${
                  priority === p
                    ? "bg-[#28455A] text-[#dcecfa] border-[#28455A]"
                    : "bg-white text-[#28455A] border-[#28455A]/40 hover:border-[#28455A]"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </label>
      </div>

      {/* DNA helix, bottom of the panel */}
      <div className="relative mt-5 h-10 flex items-center justify-center">
        <svg width="90" height="36" viewBox="0 0 90 36" className="wdi-glow">
          {Array.from({ length: 6 }).map((_, i) => (
            <line
              key={i}
              x1={10 + i * 14}
              y1={6}
              x2={20 + i * 14}
              y2={30}
              stroke="#28455A"
              strokeWidth={1}
              opacity={0.5}
            />
          ))}
          <path
            className="wdi-helix-a"
            d="M10,4 Q22,18 10,32"
            fill="none"
            stroke="#5A7D8C"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <path
            className="wdi-helix-b"
            d="M20,4 Q8,18 20,32"
            fill="none"
            stroke="#28455A"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className="relative flex items-center justify-center gap-3 mt-3">
        {bonding && (
          <>
            <span className="wdi-bond-a absolute w-3 h-3 rounded-full bg-[#5A7D8C]" />
            <span className="wdi-bond-b absolute w-3 h-3 rounded-full bg-[#28455A]" />
          </>
        )}
        <button
          type="button"
          disabled={!canSubmit || busy || bonding}
          onClick={submit}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#28455A] hover:bg-[#1c3245] text-[#dcecfa] text-xs font-mono font-black uppercase tracking-widest border-2 border-[#1a2c3a] disabled:opacity-40 cursor-pointer"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Lock In Entry
        </button>
      </div>
    </div>
  );
}

function SciField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="block relative z-10">
      <span className="block font-mono text-[8px] font-black uppercase tracking-widest text-[#28455A]/70 mb-1">
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="w-full bg-white/70 border border-[#28455A]/30 focus:border-[#28455A] outline-none font-serif text-sm text-[#12222e] resize-none px-2.5 py-1.5 rounded"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full bg-white/70 border border-[#28455A]/30 focus:border-[#28455A] outline-none font-serif text-sm text-[#12222e] px-2.5 py-1.5 rounded"
        />
      )}
    </label>
  );
}
