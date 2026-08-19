"use client";

export default function SpideyBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 select-none">
      {/* Dark Ambient Vignette & Halftone Dots */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_15%,rgba(59,6,11,0.7)_0%,transparent_75%),radial-gradient(ellipse_at_80%_85%,rgba(34,3,6,0.85)_0%,transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(rgba(212,123,145,0.06)_1.5px,transparent_1.5px)] bg-[size:24px_24px]" />

      {/* Full skyline artwork. Keep it in one layer so the horizon cannot split in half. */}
      <div className="absolute inset-0 opacity-90 animate-skyline-flicker">
        <img
          src="/images/nyc-skyline.png"
          alt="Illustrated New York skyline"
          className="absolute inset-0 w-full h-full object-cover object-center mix-blend-screen opacity-65"
        />
      </div>

      {/* Spider-Web Corner Strands */}
      <svg className="animate-web-drift absolute -top-4 -left-4 w-[32rem] h-[32rem] opacity-35 text-[#E0B1AE]" viewBox="0 0 100 100" fill="none" stroke="currentColor">
        <path d="M0,0 Q50,10 100,0 M0,0 Q10,50 0,100 M0,0 L100,100 M0,0 Q35,35 75,75 M0,25 Q25,25 25,0 M0,50 Q50,50 50,0 M0,75 Q75,75 75,0" strokeWidth="1" />
      </svg>
      <svg className="animate-web-drift absolute -top-4 -right-4 w-[32rem] h-[32rem] opacity-35 text-[#8FAEAA] -scale-x-100" viewBox="0 0 100 100" fill="none" stroke="currentColor">
        <path d="M0,0 Q50,10 100,0 M0,0 Q10,50 0,100 M0,0 L100,100 M0,0 Q35,35 75,75 M0,25 Q25,25 25,0 M0,50 Q50,50 50,0 M0,75 Q75,75 75,0" strokeWidth="1" />
      </svg>

      {/* LEFT: Spider-Man (Peter Parker) Character Node */}
      <div className="hidden lg:block absolute -top-8 left-8 xl:left-16 animate-peter-swing z-10">
        <div className="w-[3px] h-52 bg-gradient-to-b from-white to-[#D47B91]/50 mx-auto" />
        <div className="relative -mt-3 flex flex-col items-center drop-shadow-[6px_8px_0_rgba(9,12,16,.6)]">
          {/* Note: If you have public/images/peter.png, uncomment the img below! */}
          <img src="/images/peter.png" alt="Spider-Man" className="w-28 h-40 object-contain drop-shadow-xl" /> 
          
          <span className="font-mono text-[10px] font-black tracking-widest text-[#ECA8B8] mt-1 bg-black/80 px-2 py-0.5 rounded border border-[#6E0D17]">
            PETER • 616
          </span>
        </div>
      </div>

      {/* RIGHT: Spider-Gwen (Gwen Stacy) Character Node */}
      <div className="hidden lg:block absolute -top-8 right-8 xl:right-16 animate-gwen-swing z-10">
        <div className="w-[3px] h-60 bg-gradient-to-b from-white to-[#D47B91]/50 mx-auto" />
        <div className="relative -mt-3 flex flex-col items-center drop-shadow-[6px_8px_0_rgba(9,12,16,.6)]">
          {/* Note: If you have public/images/gwen.png, uncomment the img below! */}
          <img src="/images/gwen.png" alt="Spider-Gwen" className="w-28 h-40 object-contain drop-shadow-xl"/> 
          <span className="font-mono text-[10px] font-black tracking-widest text-[#D47B91] mt-1 bg-black/80 px-2 py-0.5 rounded border border-[#831843]">
            GWEN • 65
          </span>
        </div>
      </div>
    </div>
  );
}