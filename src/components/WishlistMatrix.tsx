"use client";

import { useMemo, useState } from "react";
import { Loader2, Radar, X } from "lucide-react";
import { hashString, playHum, playPop, synergyReport, useTypewriter } from "@/lib/wishlistLab";
import type { WishlistItem } from "@/components/WishlistScreen";

/* ============================================================================
   THE SMART SYNERGY MATRIX - cross-referencing gifts

   Every active wishlist item floats as a node around a pulsing central
   "nucleus", faintly tethered to it. Tapping two or more nodes fires a
   templated cross-reference (see src/lib/wishlistLab.ts's synergyReport) -
   a "SYNERGY REPORT" suggesting why the picks go together or what a blended
   gift could look like. No real analysis happens here; it's a deterministic,
   free text generator dressed as one, per the cost-guardrail conversation
   that ruled out a real LLM call for this. */

export default function WishlistMatrix({ items }: { items: WishlistItem[] }) {
  const nodes = useMemo(
    () =>
      items.map((item, i) => {
        const angle = (i / Math.max(1, items.length)) * Math.PI * 2 + (hashString(item.id) % 100) / 100;
        const radius = 30 + (hashString(`${item.id}:r`) % 12);
        return {
          id: item.id,
          title: item.title,
          x: 50 + Math.cos(angle) * radius,
          y: 50 + Math.sin(angle) * radius,
          delay: (hashString(`${item.id}:d`) % 30) / 10,
        };
      }),
    [items]
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  const toggleNode = (id: string) => {
    if (analyzing) return;
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const runAnalysis = () => {
    if (selected.length < 2) return;
    setAnalyzing(true);
    playHum(0.9);
    window.setTimeout(() => {
      playPop();
      const labels = selected.map((id) => items.find((i) => i.id === id)?.title ?? "");
      setReport(synergyReport(labels));
      setAnalyzing(false);
    }, 900);
  };

  const typedReport = useTypewriter(report ?? "", 14);

  if (items.length === 0) {
    return (
      <div className="py-24 text-center">
        <Radar className="w-8 h-8 mx-auto text-[#7D2834]/50 mb-2" />
        <p className="font-marker text-lg text-[#7D2834]/70">Nothing to cross-reference yet</p>
        <p className="font-mono text-[9px] text-stone-500 uppercase tracking-widest mt-1">
          Pin a few finds first, then come back here
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[65vh] min-h-[420px] rounded-lg overflow-hidden bg-[#0d1620] border-2 border-[#28455A]/40">
      <style>{`
        @keyframes wsm-float { 0%,100% { transform: translate(-50%,-50%) translateY(0); } 50% { transform: translate(-50%,-50%) translateY(-6px); } }
        .wsm-float { animation: wsm-float 3.6s ease-in-out infinite; }
        @keyframes wsm-nucleus { 0%,100% { transform: translate(-50%,-50%) scale(1); opacity: 0.9; } 50% { transform: translate(-50%,-50%) scale(1.15); opacity: 1; } }
        .wsm-nucleus { animation: wsm-nucleus 2.4s ease-in-out infinite; }
      `}</style>

      {/* faint tethers + active analysis beams */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {nodes.map((n) => (
          <line
            key={n.id}
            x1="50%"
            y1="50%"
            x2={`${n.x}%`}
            y2={`${n.y}%`}
            stroke={selected.includes(n.id) ? "#8fb8d6" : "#28455A"}
            strokeWidth={selected.includes(n.id) && analyzing ? 3 : 1}
            opacity={selected.includes(n.id) ? 0.9 : 0.35}
          />
        ))}
      </svg>

      {/* nucleus */}
      <div className="wsm-nucleus absolute left-1/2 top-1/2 w-10 h-10 rounded-full bg-gradient-to-br from-[#8fb8d6] to-[#28455A] shadow-[0_0_24px_6px_rgba(143,184,214,0.35)]" />

      {nodes.map((n) => {
        const isSelected = selected.includes(n.id);
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => toggleNode(n.id)}
            className="wsm-float absolute flex items-center justify-center text-center px-1.5 cursor-pointer"
            style={{
              left: `${n.x}%`,
              top: `${n.y}%`,
              animationDelay: `${n.delay}s`,
              width: 68,
              height: 68,
            }}
          >
            <span
              className={`w-full h-full rounded-full flex items-center justify-center p-1.5 border-2 transition ${
                isSelected
                  ? "bg-[#8fb8d6] border-[#dcecfa] text-[#0d1620] scale-110"
                  : "bg-[#16232e] border-[#28455A] text-[#8fb8d6] hover:border-[#8fb8d6]"
              }`}
            >
              <span className="font-mono text-[8px] leading-tight font-black line-clamp-3">{n.title}</span>
            </span>
          </button>
        );
      })}

      {selected.length >= 2 && !analyzing && (
        <button
          type="button"
          onClick={runAnalysis}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 px-4 py-2 bg-[#8fb8d6] hover:bg-[#a9cbe6] text-[#0d1620] text-[10px] font-mono font-black uppercase tracking-widest rounded-full cursor-pointer"
        >
          <Radar className="w-3.5 h-3.5" /> Analyze {selected.length} nodes
        </button>
      )}
      {analyzing && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 px-4 py-2 bg-[#16232e] text-[#8fb8d6] text-[10px] font-mono font-black uppercase tracking-widest rounded-full">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Computing synergy…
        </div>
      )}

      {report && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/70"
          onClick={() => {
            setReport(null);
            setSelected([]);
          }}
        >
          <div
            className="max-w-sm w-full p-5 relative"
            style={{
              background: "repeating-linear-gradient(#f4f8fb, #f4f8fb 23px, #dbe6ee 24px)",
              boxShadow: "8px 8px 0 rgba(0,0,0,0.5)",
              border: "3px solid #28455A",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setReport(null);
                setSelected([]);
              }}
              className="absolute top-2 right-2 text-[#28455A] hover:text-[#12222e] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <p className="font-serif text-sm text-[#12222e] leading-relaxed whitespace-pre-line min-h-[6rem]">
              {typedReport}
              <span className="animate-pulse">▍</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
