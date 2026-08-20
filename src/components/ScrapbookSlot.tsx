// src/components/ScrapbookSlot.tsx
"use client";

import { useState } from "react";

interface ScrapbookSlotProps {
  src: string;
  label: string;
  width?: string;
  height?: string;
  className?: string;
  rotation?: string;
}

export function ScrapbookSlot({
  src,
  label,
  width = "w-24",
  height = "h-24",
  className = "",
  rotation = "rotate-0",
}: ScrapbookSlotProps) {
  const [hasError, setHasError] = useState(false);

  return (
    <div className={`absolute select-none pointer-events-none ${rotation} ${className}`}>
      {!hasError ? (
        <img
          src={src}
          alt={label}
          onError={() => setHasError(true)}
          className={`${width} ${height} object-contain drop-shadow-[2px_6px_10px_rgba(0,0,0,0.35)]`}
        />
      ) : (
        /* Wireframe Placeholder Slot */
        <div
          className={`${width} ${height} border-2 border-dashed border-[#781420]/60 bg-[#FAF6EE]/90 rounded-md flex flex-col items-center justify-center p-1.5 text-center shadow-xs backdrop-blur-xs`}
        >
          <span className="font-mono text-[9px] font-black text-[#781420] leading-tight uppercase">
            [Slot: {label}]
          </span>
          <span className="font-mono text-[8px] text-stone-500 mt-0.5 break-all">
            {src.split("/").pop()}
          </span>
        </div>
      )}
    </div>
  );
}