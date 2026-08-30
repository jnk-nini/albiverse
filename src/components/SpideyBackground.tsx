"use client";

export default function SpideyBackground() {
  return (
    /* `isolate` makes the blend group explicit and `contain: paint` tells the
       browser nothing in here can paint outside the viewport box, so the
       mix-blend-screen skyline below re-composites against this subtree only
       rather than inviting the whole document into the blend. */
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden z-0 select-none isolate"
      style={{ contain: "paint" }}
    >
      {/* Dark Ambient Vignette & Halftone Dots */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_15%,rgba(59,6,11,0.7)_0%,transparent_75%),radial-gradient(ellipse_at_80%_85%,rgba(34,3,6,0.85)_0%,transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(rgba(212,123,145,0.06)_1.5px,transparent_1.5px)] bg-[size:24px_24px]" />

      {/* Full skyline artwork */}
      <div className="absolute inset-0 opacity-90 animate-skyline-flicker">
        <img
          src="/images/nyc-skyline.webp"
          alt="Illustrated New York skyline"
          decoding="async"
          fetchPriority="low"
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
          <img 
            src="/images/peter.webp"
            decoding="async" 
            alt="Spider-Man" 
            className="w-28 h-40 object-contain drop-shadow-xl" 
            onError={(e) => {
              // Fallback placeholder icon if image is not yet placed in public/images
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          /> 
          <div className="hidden w-16 h-16 rounded-full bg-[#590910] border-2 border-[#ECA8B8] flex items-center justify-center text-3xl shadow-inner">
            🕷️
          </div>
          <span className="font-mono text-[10px] font-black tracking-widest text-[#ECA8B8] mt-1 bg-black/80 px-2 py-0.5 rounded border border-[#6E0D17]">
            PETER • 616
          </span>
        </div>
      </div>

      {/* RIGHT: Spider-Gwen (Gwen Stacy) Character Node */}
      <div className="hidden lg:block absolute -top-8 right-8 xl:right-16 animate-gwen-swing z-10">
        <div className="w-[3px] h-60 bg-gradient-to-b from-white to-[#D47B91]/50 mx-auto" />
        <div className="relative -mt-3 flex flex-col items-center drop-shadow-[6px_8px_0_rgba(9,12,16,.6)]">
          <img 
            src="/images/gwen.webp"
            decoding="async" 
            alt="Spider-Gwen" 
            className="w-28 h-40 object-contain drop-shadow-xl" 
            onError={(e) => {
              // Fallback placeholder icon if image is not yet placed in public/images
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          /> 
          <div className="hidden w-16 h-16 rounded-full bg-[#831843] border-2 border-white flex items-center justify-center text-3xl shadow-inner">
            🌸
          </div>
          <span className="font-mono text-[10px] font-black tracking-widest text-[#D47B91] mt-1 bg-black/80 px-2 py-0.5 rounded border border-[#831843]">
            GWEN • 65
          </span>
        </div>
      </div>
    </div>
  );
}