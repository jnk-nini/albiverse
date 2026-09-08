/* Shared loading screen for chapters that didn't have one worth looking at.
   Ch.01-03 (clock/countdowns/timeline) are server components with no
   client-side "checking" state at all - Next only shows something here if a
   route segment has its own loading.tsx, which none of them did, so
   navigating to them was a blank hold with zero feedback until the server
   finished. Ch.04's client-side equivalent existed but was plain mono text
   on a flat background, matching nothing else in the app. One themed screen
   for all four instead of four different guesses. */

export default function ChapterLoadingScreen({
  chapter,
  title,
  message,
}: {
  chapter: string;
  title: string;
  message: string;
}) {
  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-[#191116] text-[#FAF4EB] p-6 overflow-hidden relative">
      <div className="absolute inset-0 pointer-events-none opacity-[0.07]" style={{
        backgroundImage: "radial-gradient(#FAF4EB 1.4px, transparent 1.6px)",
        backgroundSize: "20px 20px",
      }} />

      <div className="relative z-10 flex flex-col items-center text-center gap-5 max-w-sm">
        <div className="relative w-20 h-20 flex items-center justify-center">
          <span className="absolute inset-0 rounded-full border-4 border-dashed border-[#7D2834] animate-spin" style={{ animationDuration: "3.2s" }} />
          <span className="absolute inset-2 rounded-full border-2 border-dotted border-[#E0B1AE] opacity-70 animate-spin" style={{ animationDuration: "2s", animationDirection: "reverse" }} />
          <span className="text-3xl animate-pulse">🕸️</span>
        </div>

        <div>
          <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#E0B1AE] block mb-1">
            {chapter}
          </span>
          <h1 className="font-marker text-2xl sm:text-3xl text-[#FAF4EB] leading-tight">
            {title}
          </h1>
        </div>

        <p className="font-handwriting text-xl text-[#E0B1AE]">{message}</p>
      </div>
    </main>
  );
}
