"use client";

import { useEffect, useState, useRef } from "react";

interface FlipDigitUnitProps {
  value: number;
  label: string;
  tilt: string;
  tagColor?: string;
}

export default function FlipDigitUnit({
  value,
  label,
  tilt,
  tagColor = "bg-[#EAD9A9]",
}: FlipDigitUnitProps) {
  const [currentVal, setCurrentVal] = useState(value);
  const [prevVal, setPrevVal] = useState(value);
  const [flipping, setFlipping] = useState(false);
  const flipTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (value !== currentVal) {
      setPrevVal(currentVal);
      setCurrentVal(value);
      setFlipping(true);

      if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
      flipTimerRef.current = setTimeout(() => {
        setFlipping(false);
      }, 450);
    }
  }, [value, currentVal]);

  const formatNum = (num: number) => String(num).padStart(2, "0");

  return (
    <div
      className={`flex flex-col items-center select-none ${tilt} transition-transform duration-200 hover:scale-105 hover:rotate-0 relative group`}
    >
      {/* Mini Spider Charm */}
      <span className="absolute -top-3.5 -right-2 text-xs group-hover:scale-125 transition pointer-events-none z-40">
        🕷️
      </span>

      {/* Solid Opaque 3D Mechanical Split-Flap Card */}
      <div className="relative w-16 sm:w-24 md:w-28 h-20 sm:h-28 md:h-32 bg-[#FAF7F2] rounded-xl border-3 border-[#261D24] shadow-[6px_8px_0_#171B22] flip-clock-unit overflow-hidden">
        
        {/* Top Half (Solid Parchment Layer) */}
        <div className="absolute inset-x-0 top-0 h-1/2 bg-[#F2E6D2] border-b-2 border-[#261D24] overflow-hidden flex items-end justify-center">
          <span className="font-mono font-black text-2xl sm:text-4xl md:text-5xl text-[#261D24] translate-y-1/2 leading-none">
            {formatNum(currentVal)}
          </span>
        </div>

        {/* Bottom Half (Solid Parchment Layer) */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[#FAF7F2] overflow-hidden flex items-start justify-center">
          <span className="font-mono font-black text-2xl sm:text-4xl md:text-5xl text-[#7D2834] -translate-y-1/2 leading-none">
            {formatNum(currentVal)}
          </span>
        </div>

        {/* Dynamic Split-Flap Animation Leaves */}
        {flipping && (
          <>
            {/* Top Leaf Falling Down */}
            <div className="absolute inset-x-0 top-0 h-1/2 bg-[#EADCC6] border-b-2 border-[#261D24] overflow-hidden flex items-end justify-center animate-flap-top z-20">
              <span className="font-mono font-black text-2xl sm:text-4xl md:text-5xl text-[#261D24] translate-y-1/2 leading-none">
                {formatNum(prevVal)}
              </span>
            </div>

            {/* Bottom Leaf Unfolding In */}
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[#FAF7F2] overflow-hidden flex items-start justify-center animate-flap-bottom z-20">
              <span className="font-mono font-black text-2xl sm:text-4xl md:text-5xl text-[#7D2834] -translate-y-1/2 leading-none">
                {formatNum(currentVal)}
              </span>
            </div>
          </>
        )}

        {/* Center Split Ink Line & Rivets */}
        <div className="absolute top-1/2 inset-x-0 h-[2px] bg-[#261D24] z-30 flex justify-between items-center px-1">
          <div className="w-2 h-2 rounded-full bg-[#7D2834] -translate-y-[1px] border border-[#261D24]" />
          <div className="w-2 h-2 rounded-full bg-[#7D2834] -translate-y-[1px] border border-[#261D24]" />
        </div>
      </div>

      {/* Stamped Washi Tape Label */}
      <span
        className={`mt-2.5 px-3 py-0.5 rounded-md ${tagColor} border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] font-mono text-[9px] sm:text-[11px] font-black tracking-widest text-[#261D24] uppercase`}
      >
        {label}
      </span>
    </div>
  );
}