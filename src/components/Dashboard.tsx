"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import SpideyBackground from "./SpideyBackground";
import { 
  Clock, 
  Calendar, 
  Compass, 
  Camera, 
  Mail, 
  BookHeart, 
  CheckSquare, 
  Disc, 
  Gift, 
  Lock, 
  Unlink, 
  LogOut, 
  ArrowRight, 
  Bookmark, 
  Feather, 
  ChevronLeft, 
  ChevronRight, 
  BookOpen, 
  UserCheck, 
  Sparkles
} from "lucide-react";

interface DashboardProps {
  user: any;
  profile: any;
  partner?: any;
  couple: any;
  onSignOut: () => void;
  onUnlinked?: () => void;
}

export default function Dashboard({
  user,
  profile,
  partner,
  couple,
  onSignOut,
  onUnlinked,
}: DashboardProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [isBookOpened, setIsBookOpened] = useState(false);
  const [isOpeningSequence, setIsOpeningSequence] = useState(false);
  const [isClosingSequence, setIsClosingSequence] = useState(false);
  const [isPageFlipSequence, setIsPageFlipSequence] = useState(false);
  const [pageFlipRect, setPageFlipRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [hasCoverImageError, setHasCoverImageError] = useState(false);
  
  // Track failed page images by page number
  const [pageImageErrors, setPageImageErrors] = useState<Record<number, boolean>>({});

  const [bloomPhase, setBloomPhase] = useState<"bursting" | "sliding-down" | null>(null);
  const [unlinking, setUnlinking] = useState(false);

  // Big & Fun Transition State for Live Clock Warp
  const [isWarpingToClock, setIsWarpingToClock] = useState(false);
  const [isWarpingToCountdowns, setIsWarpingToCountdowns] = useState(false);

  const [currentSpread, setCurrentSpread] = useState(0);
  const [flippingState, setFlippingState] = useState<"forward" | "backward" | null>(null);

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isDragging = useRef(false);
  const coverRef = useRef<HTMLDivElement>(null);

  const myName = profile?.full_name || "Gwen Stacy";
  const partnerName = partner?.full_name || "Peter Parker";

  

  useEffect(() => {
    const shouldOpen = searchParams?.get("view") === "toc" || sessionStorage.getItem("albiverse_book_opened") === "true";
    if (shouldOpen) {
      setIsBookOpened(true);
    }
  }, [searchParams]);

  const handleOpenBook = () => {
    setIsOpeningSequence(true);

    setTimeout(() => {
      const coverBounds = coverRef.current?.getBoundingClientRect();
      if (coverBounds) {
        setPageFlipRect({
          left: coverBounds.left,
          top: coverBounds.top,
          width: coverBounds.width,
          height: coverBounds.height,
        });
      }
      setIsPageFlipSequence(true);
    }, 550);

    setTimeout(() => {
      setBloomPhase("bursting");
    }, 590);

    setTimeout(() => {
      setIsBookOpened(true);
      sessionStorage.setItem("albiverse_book_opened", "true");
      setIsOpeningSequence(false);
    }, 1600);

    setTimeout(() => {
      setIsPageFlipSequence(false);
      setBloomPhase("sliding-down");
    }, 1450);

    setTimeout(() => {
      setIsPageFlipSequence(false);
      setBloomPhase("sliding-down");
    }, 1900);

    setTimeout(() => {
      setBloomPhase(null);
    }, 3000);
  };

  const handleCloseBook = () => {
    setIsClosingSequence(true);
    sessionStorage.removeItem("albiverse_book_opened");

    setTimeout(() => {
      setIsBookOpened(false);
    }, 450);

    setTimeout(() => {
      setIsClosingSequence(false);
    }, 1250);
  };

  const handleUnlink = async () => {
    if (!confirm("Are you sure you want to disconnect both universes?")) return;
    setUnlinking(true);
    if (onUnlinked) onUnlinked();
  };

  // Intercept Chapter 1 (Live Canon Clock) navigation for the big fun warp transition
  const handleGoToClock = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsWarpingToClock(true);

    setTimeout(() => {
      router.push("/clock");
    }, 1100);
  };
// Inside Dashboard.tsx

// 1. Prefetch the route in useEffect so the page loads instantly with zero lag
useEffect(() => {
  router.prefetch("/countdowns");
  router.prefetch("/clock");
}, [router]);

// 2. Updated Chapter 2 Navigation Handler
const handleGoToCountdowns = (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  setIsWarpingToCountdowns(true);

  // Prefetch again right on click to guarantee data/bundle readiness
  router.prefetch("/countdowns");

  setTimeout(() => {
    router.push("/countdowns");
  }, 1000);
};

  const features = [
    {
    title: "Live Canon Clock", 
    desc: "Multiverse timer & live anniversary counter", 
    href: "/clock", 
    tag: "CH. 01", 
    icon: Clock, 
    sticker: "⏰ 🕸️", 
    note: "Every second across dimensions", 
    onClick: handleGoToClock 
  },
  { 
    title: "Canon Countdowns", 
    desc: "Sticky milestone countdowns & birthdays", 
    href: "/countdowns", 
    tag: "CH. 02", 
    icon: Calendar, 
    sticker: "🎂 ✈️", 
    note: "Mark our future timelines",
    onClick: handleGoToCountdowns // <--- Added handler
  },
    { title: "Red String Timeline", desc: "Fate threads & milestone polaroids", href: "/timeline", tag: "CH. 03", icon: Compass, sticker: "🧵 📸", note: "Connected by destiny" },
    { title: "Retro Digicam", desc: "Instant snapshots & viewfinder clips", href: "/media", tag: "CH. 04", icon: Camera, sticker: "📷 ✨", note: "Earth-65 & 616 gallery" },
    { title: "Love Letter Jar", desc: "Folded scrolls & wax-sealed notes", href: "/letters", tag: "CH. 05", icon: Mail, sticker: "💌 📜", note: "Confidential unsealed letters" },
    { title: "Spider Diary", desc: "Daily mood entries & shared doodles", href: "/diary", tag: "CH. 06", icon: BookHeart, sticker: "🕷️ 📖", note: "Our private logbook" },
    { title: "Web Planner", desc: "Shared date schedules & reminders", href: "/planner", tag: "CH. 07", icon: CheckSquare, sticker: "📅 🎀", note: "Adventures on the docket" },
    { title: "Multiverse Bucket List", desc: "Adventures across dimensions to complete", href: "/bucket-list", tag: "CH. 08", icon: Sparkles, sticker: "🌟 🗺️", note: "Cross off our milestones" },
    { title: "Soundtrack Deck", desc: "Spinning vinyl & our special playlist", href: "/soundtrack", tag: "CH. 09", icon: Disc, sticker: "🎵 🌸", note: "Songs for our universe" },
    { title: "Secret Wishlist", desc: "Gift ideas & surprise drops (Vault)", href: "/wishlist", tag: "CH. 10", icon: Gift, sticker: "🎁 🔒", note: "Surprise vault items" },
    { title: "About Him Dossier", desc: "Confidential intel, sizes & favorites", href: "/about-him", tag: "CH. 11", icon: Lock, sticker: "📂 🕶️", note: "Classified Peter Parker Intel" },
  ];

  const totalSpreads = Math.ceil(features.length / 2);

  const handleNextPage = () => {
    if (currentSpread < totalSpreads - 1 && !flippingState) {
      setFlippingState("forward");
      setTimeout(() => {
        setCurrentSpread((prev) => prev + 1);
        setFlippingState(null);
      }, 950);
    }
  };

  const handlePrevPage = () => {
    if (currentSpread > 0 && !flippingState) {
      setFlippingState("backward");
      setTimeout(() => {
        setCurrentSpread((prev) => prev - 1);
        setFlippingState(null);
      }, 950);
    }
  };

  const onStart = (clientX: number, clientY: number) => {
    touchStartX.current = clientX;
    touchStartY.current = clientY;
    isDragging.current = true;
  };

  const onEnd = (clientX: number, clientY: number) => {
    if (!isDragging.current || touchStartX.current === null || touchStartY.current === null) return;
    const diffX = touchStartX.current - clientX;
    const diffY = touchStartY.current - clientY;

    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 40) {
      if (diffX > 0) handleNextPage();
      else handlePrevPage();
    }

    touchStartX.current = null;
    touchStartY.current = null;
    isDragging.current = false;
  };

  const curLeft = features[currentSpread * 2];
  const curRight = features[currentSpread * 2 + 1];
  const nextLeft = features[(currentSpread + 1) * 2];
  const nextRight = features[(currentSpread + 1) * 2 + 1];
  const prevLeft = features[(currentSpread - 1) * 2];
  const prevRight = features[(currentSpread - 1) * 2 + 1];

  const renderChapterContent = (item: typeof features[0] | undefined, pageNum: number) => {
    if (!item) {
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center h-full bg-[#FAF6EE] rounded-lg border border-[#261D24]/20">
          <span className="text-4xl mb-2">🌸🕸️</span>
          <h4 className="font-marker text-xl text-[#1A0D10]">End of Table of Contents</h4>
          <p className="font-handwriting text-lg text-stone-600 mt-1">
            Connected across every universe with {partnerName} ❤️
          </p>
        </div>
      );
    }

    const hasImageError = pageImageErrors[pageNum];

    return (
      <div className="h-full relative rounded-lg border border-[#261D24]/20 shadow-inner overflow-hidden flex flex-col justify-between p-4 sm:p-6 bg-[#FAF6EE]">
        {/* Page PNG Image from /public/images/scrapbook/page-[pageNum].png */}
        {!hasImageError && (
          <img
            src={`/images/scrapbook/page-${pageNum}.png`}
            alt={`Page ${pageNum}`}
            onError={() =>
              setPageImageErrors((prev) => ({ ...prev, [pageNum]: true }))
            }
            className="absolute inset-0 w-full h-full object-cover z-0 pointer-events-none"
          />
        )}

        {/* Dynamic Chapter Info & Buttons */}
        <div className="relative z-10 flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between border-b-2 border-dashed border-[#8A7550] pb-3 mb-4 bg-[#FAF6EE]/75 p-2 rounded backdrop-blur-xs">
              <span className="feature-stamp">{item.tag}</span>
              <span className="text-3xl">{item.sticker}</span>
            </div>

            <div className="bg-[#FAF6EE]/85 p-3 rounded backdrop-blur-xs shadow-xs">
              <h3 className="font-marker text-2xl sm:text-3xl text-[#1A0D10] mb-2">
                {item.title}
              </h3>
              <p className="font-handwriting text-xl text-stone-700 leading-snug">
                {item.desc}
              </p>
              <p className="font-mono text-[11px] text-[#781420] mt-3 italic">
                Note: {item.note}
              </p>
            </div>
          </div>

          <div className="pt-4 mt-6 border-t border-[#261D24]/20 flex items-center justify-between bg-[#FAF6EE]/80 p-2 rounded backdrop-blur-xs">
            <span className="font-mono text-[10px] text-stone-700 font-bold uppercase">PAGE {pageNum}</span>
            {item.onClick ? (
              <button
                onClick={item.onClick}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#781420] hover:bg-[#450A10] text-[#FDF6F0] font-mono text-xs font-black rounded border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] transition active:scale-95 cursor-pointer"
              >
                <span>OPEN ENTRY</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <Link
                href={item.href}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#781420] hover:bg-[#450A10] text-[#FDF6F0] font-mono text-xs font-black rounded border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] transition active:scale-95"
              >
                <span>OPEN ENTRY</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  };

  const burstParticles = [
    { x: "0vw", y: "0vh", scale: 1.5, delay: "0s", rot: "12deg", icon: "🌸", file: "flower-1.png", size: "w-60 h-60 sm:w-88 sm:h-88" },
    { x: "-4vw", y: "-4vh", scale: 1.4, delay: "0.01s", rot: "-25deg", icon: "🌺", file: "flower-2.png", size: "w-56 h-56 sm:w-80 sm:h-80" },
    { x: "5vw", y: "4vh", scale: 1.4, delay: "0.02s", rot: "35deg", icon: "🌹", file: "flower-3.png", size: "w-56 h-56 sm:w-80 sm:h-80" },
    { x: "-15vw", y: "-15vh", scale: 1.35, delay: "0.03s", rot: "-40deg", icon: "🌼", file: "flower-4.png", size: "w-52 h-52 sm:w-72 sm:h-72" },
    { x: "15vw", y: "-15vh", scale: 1.35, delay: "0.03s", rot: "45deg", icon: "🌻", file: "flower-5.png", size: "w-52 h-52 sm:w-72 sm:h-72" },
    { x: "-18vw", y: "14vh", scale: 1.35, delay: "0.04s", rot: "20deg", icon: "🌷", file: "flower-6.png", size: "w-52 h-52 sm:w-72 sm:h-72" },
    { x: "18vw", y: "15vh", scale: 1.35, delay: "0.04s", rot: "-30deg", icon: "💐", file: "flower-7.png", size: "w-52 h-52 sm:w-72 sm:h-72" },
    { x: "0vw", y: "-22vh", scale: 1.4, delay: "0.03s", rot: "10deg", icon: "🌸", file: "flower-1.png", size: "w-56 h-56 sm:w-76 sm:h-76" },
    { x: "0vw", y: "22vh", scale: 1.4, delay: "0.04s", rot: "-15deg", icon: "🌺", file: "flower-2.png", size: "w-56 h-56 sm:w-76 sm:h-76" },
    { x: "-24vw", y: "0vh", scale: 1.4, delay: "0.04s", rot: "30deg", icon: "🌹", file: "flower-3.png", size: "w-56 h-56 sm:w-76 sm:h-76" },
    { x: "24vw", y: "0vh", scale: 1.4, delay: "0.04s", rot: "-45deg", icon: "🌼", file: "flower-4.png", size: "w-56 h-56 sm:w-76 sm:h-76" },
    { x: "-32vw", y: "-28vh", scale: 1.45, delay: "0.05s", rot: "55deg", icon: "🌻", file: "flower-5.png", size: "w-60 h-60 sm:w-88 sm:h-88" },
    { x: "0vw", y: "-36vh", scale: 1.45, delay: "0.05s", rot: "-20deg", icon: "🌷", file: "flower-6.png", size: "w-64 h-64 sm:w-92 sm:h-92" },
    { x: "32vw", y: "-28vh", scale: 1.45, delay: "0.05s", rot: "-60deg", icon: "💐", file: "flower-7.png", size: "w-60 h-60 sm:w-88 sm:h-88" },
    { x: "-38vw", y: "0vh", scale: 1.5, delay: "0.06s", rot: "15deg", icon: "🌸", file: "flower-1.png", size: "w-68 h-68 sm:w-96 sm:h-96" },
    { x: "38vw", y: "0vh", scale: 1.5, delay: "0.06s", rot: "-35deg", icon: "🌺", file: "flower-2.png", size: "w-68 h-68 sm:w-96 sm:h-96" },
    { x: "-32vw", y: "28vh", scale: 1.45, delay: "0.06s", rot: "-40deg", icon: "🌹", file: "flower-3.png", size: "w-60 h-60 sm:w-88 sm:h-88" },
    { x: "0vw", y: "36vh", scale: 1.45, delay: "0.06s", rot: "45deg", icon: "🌼", file: "flower-4.png", size: "w-64 h-64 sm:w-92 sm:h-92" },
    { x: "32vw", y: "28vh", scale: 1.45, delay: "0.06s", rot: "25deg", icon: "🌻", file: "flower-5.png", size: "w-60 h-60 sm:w-88 sm:h-88" },
    { x: "-48vw", y: "-44vh", scale: 1.6, delay: "0.07s", rot: "-15deg", icon: "🌷", file: "flower-6.png", size: "w-72 h-72 sm:w-[420px] sm:h-[420px]" },
    { x: "48vw", y: "-44vh", scale: 1.6, delay: "0.07s", rot: "35deg", icon: "💐", file: "flower-7.png", size: "w-72 h-72 sm:w-[420px] sm:h-[420px]" },
    { x: "-48vw", y: "44vh", scale: 1.6, delay: "0.08s", rot: "50deg", icon: "🌸", file: "flower-1.png", size: "w-72 h-72 sm:w-[420px] sm:h-[420px]" },
    { x: "48vw", y: "44vh", scale: 1.6, delay: "0.08s", rot: "-45deg", icon: "🌺", file: "flower-2.png", size: "w-72 h-72 sm:w-[420px] sm:h-[420px]" },
    { x: "-54vw", y: "-15vh", scale: 1.55, delay: "0.07s", rot: "20deg", icon: "🌹", file: "flower-3.png", size: "w-68 h-68 sm:w-96 sm:h-96" },
    { x: "54vw", y: "-15vh", scale: 1.55, delay: "0.07s", rot: "-25deg", icon: "🌼", file: "flower-4.png", size: "w-68 h-68 sm:w-96 sm:h-96" },
    { x: "-54vw", y: "15vh", scale: 1.55, delay: "0.08s", rot: "-30deg", icon: "🌻", file: "flower-5.png", size: "w-68 h-68 sm:w-96 sm:h-96" },
    { x: "54vw", y: "15vh", scale: 1.55, delay: "0.08s", rot: "40deg", icon: "🌷", file: "flower-6.png", size: "w-68 h-68 sm:w-96 sm:h-96" },
    { x: "-35vw", y: "54vh", scale: 1.6, delay: "0.08s", rot: "-10deg", icon: "💐", file: "flower-7.png", size: "w-72 h-72 sm:w-[400px] sm:h-[400px]" },
    { x: "-12vw", y: "56vh", scale: 1.6, delay: "0.09s", rot: "25deg", icon: "🌸", file: "flower-1.png", size: "w-72 h-72 sm:w-[400px] sm:h-[400px]" },
    { x: "12vw", y: "56vh", scale: 1.6, delay: "0.09s", rot: "-35deg", icon: "🌺", file: "flower-2.png", size: "w-72 h-72 sm:w-[400px] sm:h-[400px]" },
    { x: "35vw", y: "54vh", scale: 1.6, delay: "0.08s", rot: "45deg", icon: "🌹", file: "flower-3.png", size: "w-72 h-72 sm:w-[400px] sm:h-[400px]" },
  ];

  return (
    <main className="min-h-screen p-3 sm:p-6 lg:p-8 flex flex-col justify-between relative overflow-hidden select-none bg-[#181114]">
      
      <SpideyBackground />

      <div className="fixed top-8 animate-crawl-h text-xl z-10 pointer-events-none">🕷️</div>
      <div className="fixed animate-crawl-d text-2xl z-10 pointer-events-none">🕷️</div>
      <div className="fixed left-4 animate-crawl-v text-lg z-10 pointer-events-none">🕷️</div>

      {/* Top Header */}
      <header className="max-w-6xl mx-auto w-full z-30 flex items-center justify-between">
        <div>
          {isBookOpened && (
            <button
              onClick={handleCloseBook}
              disabled={isClosingSequence}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#F2E6D2] hover:bg-[#FAF7F2] text-[#261D24] text-xs font-mono font-black border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] -rotate-1 transition cursor-pointer"
            >
              <Bookmark className="w-3.5 h-3.5 text-[#781420]" />
              <span>Close Journal</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleUnlink}
            disabled={unlinking}
            className="text-xs font-mono font-black text-[#E0B1AE] bg-[#3C1820] hover:bg-[#5A2029] px-3 py-1.5 border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] flex items-center gap-1.5 transition cursor-pointer"
          >
            <Unlink className="w-3.5 h-3.5" />
            <span>{unlinking ? "Unlinking..." : "Unlink"}</span>
          </button>
          <button
            onClick={onSignOut}
            className="text-xs font-mono font-black text-[#261D24] bg-[#F2E6D2] hover:bg-[#FAF7F2] px-3 py-1.5 border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] flex items-center gap-1.5 transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 text-[#781420]" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* ================= INTRO: FRONT SCRAPBOOK COVER ================= */}
      {(!isBookOpened || isClosingSequence) && (
        <div className="flex-1 flex items-center justify-center max-w-4xl mx-auto w-full py-8 z-20 journal-book-perspective">
          <div 
            ref={coverRef}
            onClick={!isOpeningSequence && !isClosingSequence ? handleOpenBook : undefined}
            className="relative cursor-pointer transition-transform duration-300 hover:scale-[1.01]"
          >
            <div className="absolute -top-4 left-16 tape-pink-solid w-36 h-7 -rotate-2 z-50 pointer-events-none" />
            <div className="absolute -top-4 right-16 tape-red-solid w-36 h-7 rotate-2 z-50 pointer-events-none" />

            {/* BASE STATIONARY CONTAINER */}
            <div className="relative w-[340px] sm:w-[480px] md:w-[560px] min-h-[620px] bg-[#2E0509] rounded-2xl border-4 border-[#17131A] shadow-[22px_24px_0_rgba(0,0,0,0.9)] p-5 sm:p-8 flex flex-col justify-between overflow-hidden">
              
              <div className="absolute left-1.5 inset-y-0 w-8 flex flex-col justify-around items-center py-4 z-40 pointer-events-none">
                {Array.from({ length: 14 }).map((_, i) => (
                  <div key={i} className="w-7 h-2.5 spiral-binder-ring border border-black/60" />
                ))}
              </div>

              <div className="ml-5 sm:ml-7 flex-1 bg-[#FAF6EE] border-3 border-[#261D24] p-5 sm:p-8 rounded-lg shadow-inner flex flex-col justify-between relative overflow-hidden z-0">
                <div className="text-center my-auto space-y-3">
                  <span className="text-5xl">🌸🕸️✨</span>
                  <h2 className="font-marker text-3xl text-[#1A0D10]">Albiverse Chronicles</h2>
                  <p className="font-handwriting text-xl text-[#781420]">Earth-65 × Earth-616</p>
                </div>
              </div>
            </div>

            {/* FRONT COVER */}
            <div className={`absolute inset-0 z-30 ${
              isOpeningSequence ? "animate-front-cover-swing-open pointer-events-none" : 
              isClosingSequence ? "animate-front-cover-swing-close pointer-events-none" : ""
            }`}>
              <div className="w-[340px] sm:w-[480px] md:w-[560px] min-h-[620px] bg-[#2E0509] rounded-2xl border-4 border-[#17131A] shadow-[22px_24px_0_rgba(0,0,0,0.9)] p-5 sm:p-8 flex flex-col justify-between overflow-hidden relative group">
                
                <div className="absolute left-1.5 inset-y-0 w-8 flex flex-col justify-around items-center py-4 z-40 pointer-events-none">
                  {Array.from({ length: 14 }).map((_, i) => (
                    <div key={i} className="w-7 h-2.5 spiral-binder-ring border border-black/60" />
                  ))}
                </div>

                {!hasCoverImageError ? (
                  <div className="ml-5 sm:ml-7 flex-1 border-3 border-[#261D24] rounded-lg shadow-inner relative overflow-hidden flex flex-col justify-between bg-[#1B0D12]">
                    <img 
                      src="/images/scrapbook/journal-cover.png" 
                      alt="Scrapbook Cover"
                      loading="eager"
                      fetchPriority="high"
                      decoding="async"
                      onError={() => setHasCoverImageError(true)}
                      className="absolute inset-0 w-full h-full object-cover z-0 transition-transform duration-500 group-hover:scale-105"
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 z-10 pointer-events-none" />

                    <div className="relative z-20 p-4 flex justify-between items-start">
                      <span className="postage-stamp bg-[#781420] text-[#F6EFE9] -rotate-2 shadow">
                        VOL. 616 × 65
                      </span>
                    </div>

                    <div className="relative z-20 p-4 sm:p-6 text-center flex flex-col items-center gap-3">
                      <div className="inline-block bg-[#FAF7F2]/90 backdrop-blur-xs px-3 py-1.5 border border-[#261D24] shadow-[3px_3px_0_#261D24] rotate-1">
                        <span className="font-mono text-[11px] font-black text-[#781420] uppercase tracking-wider block">
                          {myName} × {partnerName}
                        </span>
                      </div>

                      <div className="inline-flex items-center gap-2 px-6 py-3 bg-[#781420] group-hover:bg-[#450A10] text-[#F6EFE9] border-3 border-[#261D24] shadow-[5px_5px_0_#171B22] font-mono text-xs sm:text-sm font-black tracking-wider uppercase -rotate-1 group-hover:rotate-0 transition-all">
                        <Feather className="w-4 h-4 text-[#ECA8B8]" />
                        <span>Open Scrapbook</span>
                        <ArrowRight className="w-4 h-4 text-[#ECA8B8]" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="ml-5 sm:ml-7 flex-1 paper-grid-journal border-3 border-[#261D24] p-5 sm:p-8 rounded-lg shadow-inner flex flex-col justify-between relative overflow-hidden z-10 bg-opacity-95">
                    
                    <div className="absolute top-4 right-2 w-48 h-32 paper-music-sheet -rotate-3 border border-black/20 p-2 shadow-sm pointer-events-none opacity-85">
                      <div className="postage-stamp rotate-6">CAO DANG • № 616</div>
                      <span className="font-handwriting text-xs text-stone-700 block mt-1">
                        ♪ Sunflower in D Major
                      </span>
                    </div>

                    <div className="absolute top-24 left-3 w-52 sm:w-64 h-48 paper-kraft-torn rotate-2 p-3 z-10">
                      <span className="postage-stamp -rotate-3 bg-[#FAF4EB]">CANON EVENT</span>
                      <p className="font-handwriting text-xl text-[#2E0509] mt-2 font-bold leading-tight">
                        “A journey across a thousand universes begins with a single step.”
                      </p>
                    </div>

                    <div className="absolute bottom-24 right-4 z-20 rotate-12 flex flex-col items-center">
                      <div className="tape-gold-solid w-16 h-4 -rotate-6 mb-1" />
                      <div className="text-4xl">🌿🍂</div>
                      <span className="font-handwriting text-sm text-[#781420] font-bold">Earth-65 Flora</span>
                    </div>

                    <div className="absolute bottom-28 left-20 z-20 rotate-6 text-3xl">🎀</div>

                    <div className="text-center z-20 mt-1">
                      <span className="postage-stamp bg-[#781420] text-[#F6EFE9] -rotate-1 mb-1">
                        VOL. 616 × 65 • ALBIVERSE
                      </span>
                      <h1 className="font-marker text-3xl sm:text-5xl text-[#1A0D10] leading-none mt-2">
                        ALBIVERSE
                      </h1>
                      <p className="font-handwriting text-2xl text-[#781420] mt-1 font-bold">
                        The Scrapbook of Us
                      </p>
                    </div>

                    <div className="my-auto z-20 text-center py-6">
                      <div className="inline-block bg-[#FAF7F2] p-4 border-2 border-[#261D24] shadow-[4px_4px_0_#261D24] rotate-1">
                        <div className="text-3xl sm:text-4xl mb-1">🕷️❤️🌸</div>
                        <span className="font-mono text-xs font-black text-[#781420] uppercase tracking-wider block">
                          {myName} × {partnerName}
                        </span>
                        <span className="text-[10px] font-mono font-bold text-stone-600 uppercase block mt-1">
                          Account Linked to: <span className="text-[#781420] font-black">{partnerName}</span>
                        </span>
                      </div>
                    </div>

                    <div className="text-center z-20 pt-2">
                      <div className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#781420] hover:bg-[#450A10] text-[#F6EFE9] border-3 border-[#261D24] shadow-[5px_5px_0_#171B22] font-mono text-xs font-black tracking-wider uppercase -rotate-1 group-hover:rotate-0 transition">
                        <Feather className="w-4 h-4 text-[#ECA8B8]" />
                        <span>Open Scrapbook</span>
                        <ArrowRight className="w-4 h-4 text-[#ECA8B8]" />
                      </div>
                    </div>

                  </div>
                )}

              </div>
            </div>

          </div>
        </div>
      )}

      {/* ================= FLORAL CASCADE WITH 7 CUTOUTS ================= */}
      {bloomPhase && (
        <div 
          className={`fixed inset-0 z-50 pointer-events-none overflow-visible ${
            bloomPhase === "sliding-down" ? "animate-bloom-curtain-drop" : ""
          }`}
        >
          <div className="bloom-top-flowers" aria-hidden="true">
            {[
              { file: "flower-1.png", fallback: "🌸" },
              { file: "flower-2.png", fallback: "🌺" },
              { file: "flower-3.png", fallback: "🌹" },
              { file: "flower-4.png", fallback: "🌼" },
              { file: "flower-5.png", fallback: "🌻" },
              { file: "flower-6.png", fallback: "🌷" },
              { file: "flower-7.png", fallback: "💐" },
              { file: "flower-1.png", fallback: "🌸" },
            ].map((flower, index) => (
              <div key={index} className="relative w-20 h-20 sm:w-28 sm:h-28 flex items-center justify-center">
                <img
                  src={`/images/bloom/${flower.file}`}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    const fallbackSpan = e.currentTarget.nextElementSibling as HTMLElement;
                    if (fallbackSpan) fallbackSpan.style.display = "inline-block";
                  }}
                  className="w-full h-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
                />
                <span className="hidden text-6xl drop-shadow-[0_0_18px_#ECA8B8]">
                  {flower.fallback}
                </span>
              </div>
            ))}
          </div>

          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0 h-0 flex items-center justify-center">
            {burstParticles.map((flower, idx) => (
              <div
                key={idx}
                style={{
                  ['--dest-x' as any]: flower.x,
                  ['--dest-y' as any]: flower.y,
                  ['--dest-scale' as any]: flower.scale,
                  ['--dest-rot' as any]: flower.rot,
                  animationDelay: flower.delay,
                }}
                className={`absolute ${flower.size} flex items-center justify-center animate-bloom-particle pointer-events-none`}
              >
                <img
                  src={`/images/bloom/${flower.file}`}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    const fallbackSpan = e.currentTarget.nextElementSibling as HTMLElement;
                    if (fallbackSpan) fallbackSpan.style.display = "inline-block";
                  }}
                  className="w-full h-full object-contain drop-shadow-[0_12px_28px_rgba(0,0,0,0.65)] select-none"
                />
                <span className="hidden text-9xl drop-shadow-[0_0_24px_#ECA8B8]">
                  {flower.icon}
                </span>
              </div>
            ))}
          </div>

          {["A", "L", "B", "I", "V", "E", "R", "S", "E", "❤️", "🕷️"].map((char, idx) => (
            <div
              key={idx}
              style={{
                left: `${18 + (idx * 6.5)}%`,
                animationDelay: `${idx * 0.05}s`,
              }}
              className="absolute bottom-10 font-marker text-3xl sm:text-5xl text-[#FDF6F0] drop-shadow-[0_0_20px_#ECA8B8] animate-letter-float"
            >
              {char}
            </div>
          ))}
        </div>
      )}

      {isPageFlipSequence && (
        <div
          className="rapid-page-flip-overlay"
          aria-hidden="true"
          style={pageFlipRect ? {
            left: pageFlipRect.left,
            top: pageFlipRect.top,
            width: pageFlipRect.width,
            height: pageFlipRect.height,
          } : undefined}
        >
          <div className="rapid-page-underlay" />
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="rapid-page-leaf"
              style={{ animationDelay: `${index * 70}ms`, zIndex: 20 - index }}
            />
          ))}
        </div>
      )}

      {/* ================= TABLE OF CONTENTS: 3D BOOK SPREAD ================= */}
      {isBookOpened && !isClosingSequence && (
        <div 
          onMouseDown={(e) => onStart(e.clientX, e.clientY)}
          onMouseUp={(e) => onEnd(e.clientX, e.clientY)}
          onTouchStart={(e) => onStart(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchEnd={(e) => onEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY)}
          className="flex-1 max-w-5xl mx-auto w-full py-4 z-30 journal-book-perspective flex flex-col justify-center cursor-grab active:cursor-grabbing animate-toc-reveal"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 px-2">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-black text-[#ECA8B8] uppercase tracking-widest flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-[#D9889E]" /> SPREAD {currentSpread + 1} OF {totalSpreads}
              </span>

              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#2E0509] border border-[#781420] rounded-md shadow">
                <UserCheck className="w-3.5 h-3.5 text-[#ECA8B8]" />
                <span className="font-mono text-[10px] font-bold text-[#F8F4EB]">
                  LINKED: <span className="text-[#ECA8B8] font-black">{partnerName.toUpperCase()}</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 justify-between sm:justify-end">
              <span className="font-mono text-[10px] text-[#ECA8B8]/70 italic hidden md:inline">
                (Swipe left/right or click buttons to flip)
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrevPage}
                  disabled={currentSpread === 0 || !!flippingState}
                  className="px-3 py-1.5 bg-[#FAF4EB] text-[#261D24] border-2 border-[#261D24] shadow-[2px_2px_0_#261D24] disabled:opacity-40 disabled:pointer-events-none hover:bg-white transition cursor-pointer font-mono text-xs font-black flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> PREV
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={currentSpread === totalSpreads - 1 || !!flippingState}
                  className="px-3 py-1.5 bg-[#FAF4EB] text-[#261D24] border-2 border-[#261D24] shadow-[2px_2px_0_#261D24] disabled:opacity-40 disabled:pointer-events-none hover:bg-white transition cursor-pointer font-mono text-xs font-black flex items-center gap-1"
                >
                  NEXT <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Master 3D Spread Container */}
          <div className="paper-open-notebook-spread min-h-[460px] sm:min-h-[520px] p-4 sm:p-8 relative grid grid-cols-1 md:grid-cols-2 gap-6 overflow-hidden">
            
            <div className="hidden md:block absolute inset-y-0 left-1/2 -translate-x-1/2 w-12 book-gutter-crease pointer-events-none z-30" />

            {/* Base Left Page */}
            <div className="h-full relative z-0">
              {flippingState === "backward"
                ? renderChapterContent(prevLeft, (currentSpread - 1) * 2 + 1)
                : renderChapterContent(curLeft, currentSpread * 2 + 1)}
            </div>

            {/* Base Right Page */}
            <div className="h-full relative z-0">
              {flippingState === "forward"
                ? renderChapterContent(nextRight, (currentSpread + 1) * 2 + 2)
                : renderChapterContent(curRight, currentSpread * 2 + 2)}
            </div>

            {/* Dynamic Leaves */}
            {flippingState === "forward" && (
              <div className="hidden md:block absolute inset-y-0 right-0 w-1/2 p-4 sm:p-8 animate-fluid-flip-forward z-40">
                <div className="absolute inset-4 sm:inset-8 page-face-front">
                  {renderChapterContent(curRight, currentSpread * 2 + 2)}
                </div>
                <div className="absolute inset-4 sm:inset-8 page-face-back">
                  {renderChapterContent(nextLeft, (currentSpread + 1) * 2 + 1)}
                </div>
              </div>
            )}

            {flippingState === "backward" && (
              <div className="hidden md:block absolute inset-y-0 left-0 w-1/2 p-4 sm:p-8 animate-fluid-flip-backward z-40">
                <div className="absolute inset-4 sm:inset-8 page-face-front">
                  {renderChapterContent(curLeft, currentSpread * 2 + 1)}
                </div>
                <div className="absolute inset-4 sm:inset-8 page-face-back">
                  {renderChapterContent(prevRight, (currentSpread - 1) * 2 + 2)}
                </div>
              </div>
            )}

          </div>

          {/* Bottom Progress Bar */}
          <div className="flex items-center justify-center gap-2 mt-4">
            {Array.from({ length: totalSpreads }).map((_, i) => (
              <button
                key={i}
                onClick={() => {
                  if (i > currentSpread) handleNextPage();
                  else if (i < currentSpread) handlePrevPage();
                }}
                className={`h-2.5 rounded-full transition-all cursor-pointer border border-[#261D24] ${
                  currentSpread === i ? "w-8 bg-[#D9889E]" : "w-2.5 bg-[#FAF4EB]/60 hover:bg-[#FAF4EB]"
                }`}
                title={`Jump to Spread ${i + 1}`}
              />
            ))}
          </div>

        </div>
      )}

      {/* ================= BIG & FUN TIMELINE WARP OVERLAY ================= */}
      {isWarpingToClock && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none bg-black/60 backdrop-blur-xs overflow-hidden">
          {/* 1. Spider-Web Radial Burst in Background */}
          <div className="absolute w-[600px] h-[600px] sm:w-[900px] sm:h-[900px] rounded-full border-4 border-dashed border-[#D9889E] opacity-70 animate-web-sling-burst flex items-center justify-center">
            <span className="text-8xl sm:text-9xl opacity-80 select-none">🕸️</span>
          </div>

          {/* 2. Giant Multiverse Clock Gears Spinning */}
          <div className="absolute w-72 h-72 sm:w-96 sm:h-96 rounded-full border-8 border-dashed border-[#C5A467] opacity-60 animate-clock-gear-spin flex items-center justify-center">
            <div className="w-48 h-48 rounded-full border-4 border-dashed border-[#ECA8B8]" />
          </div>

          {/* 3. Flying Time Units & Comic Particles */}
          {[
            { text: "00", x: "-38vw", y: "-30vh" },
            { text: "60", x: "36vw", y: "-28vh" },
            { text: "12", x: "-32vw", y: "32vh" },
            { text: "616", x: "38vw", y: "26vh" },
            { text: "65", x: "0vw", y: "-40vh" },
            { text: "⏰", x: "-20vw", y: "-15vh" },
            { text: "🕷️", x: "25vw", y: "15vh" },
            { text: "✨", x: "-22vw", y: "24vh" },
          ].map((item, idx) => (
            <span
              key={idx}
              style={{
                "--fly-x": item.x,
                "--fly-y": item.y,
              } as React.CSSProperties}
              className="absolute font-marker text-3xl sm:text-5xl text-[#FAF4EB] drop-shadow-[0_0_12px_#781420] animate-digit-fly select-none"
            >
              {item.text}
            </span>
          ))}

          {/* 4. Comic Punch Pop Bubble in Center */}
          <div className="relative z-10 flex flex-col items-center justify-center animate-comic-pop">
            <div className="bg-[#781420] border-4 border-[#FAF4EB] shadow-[8px_8px_0_#17131A] px-6 py-3 rounded-2xl rotate-2 flex items-center gap-3">
              <span className="text-3xl animate-bounce">🕷️</span>
              <div>
                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#ECA8B8] block">
                  CANON TIMELINE PORTAL
                </span>
                <h2 className="font-marker text-3xl sm:text-4xl text-[#FAF4EB] leading-tight">
                  *THWIP!* 🕸️ WARPING TIME...
                </h2>
              </div>
              <span className="text-3xl animate-spin">⏰</span>
            </div>

            <span className="font-handwriting text-2xl text-[#ECA8B8] mt-3 font-black drop-shadow-md">
              Syncing seconds across dimensions...
            </span>
          </div>
        </div>
      )}

      {/* ================= CH. 02 COUNTDOWN & MILESTONE WARP OVERLAY ================= */}
      {isWarpingToCountdowns && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none bg-black/65 backdrop-blur-xs overflow-hidden">
          
          {/* 1. Giant Flipping Multiverse Calendar Grid Ring */}
          <div className="absolute w-[580px] h-[580px] sm:w-[860px] sm:h-[860px] rounded-full border-4 border-dashed border-[#D9889E]/60 opacity-80 animate-calendar-portal-spin flex items-center justify-center">
            <div className="w-[420px] h-[420px] sm:w-[620px] sm:h-[620px] rounded-full border-2 border-dotted border-[#FAF4EB]/40" />
          </div>

          {/* 2. Web Ropes & Sticky Post-it Ripping Effect */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-full h-1.5 bg-[#ECA8B8]/70 -rotate-12 transform scale-x-150 animate-web-sling-horizontal" />
            <div className="w-full h-1.5 bg-[#FAF4EB]/60 rotate-12 transform scale-x-150 animate-web-sling-horizontal" />
          </div>

          {/* 3. Floating Milestone Cards, Sticky Post-Its & Spider Stickers */}
          {[
            { text: "DAYS ⏳", x: "-36vw", y: "-28vh", rot: "-12deg", bg: "bg-[#EAD9A9] text-[#1A0D10]" },
            { text: "🎂 BIRTHDAY", x: "34vw", y: "-25vh", rot: "15deg", bg: "bg-[#D9889E] text-white" },
            { text: "CANON DATE 🕸️", x: "-30vw", y: "28vh", rot: "8deg", bg: "bg-[#FAF4EB] text-[#781420]" },
            { text: "✈️ TRIP", x: "36vw", y: "22vh", rot: "-18deg", bg: "bg-[#BDD0C5] text-[#1A0D10]" },
            { text: "💖 365 DAYS", x: "0vw", y: "-38vh", rot: "6deg", bg: "bg-[#781420] text-[#FAF4EB]" },
            { text: "🕸️ THWIP!", x: "-22vw", y: "-10vh", rot: "-20deg", bg: "bg-transparent text-4xl" },
            { text: "🕷️", x: "24vw", y: "12vh", rot: "30deg", bg: "bg-transparent text-5xl" },
            { text: "📌", x: "-18vw", y: "20vh", rot: "0deg", bg: "bg-transparent text-4xl" },
          ].map((item, idx) => (
            <div
              key={idx}
              style={{
                "--fly-x": item.x,
                "--fly-y": item.y,
                "--rot-dest": item.rot,
              } as React.CSSProperties}
              className={`absolute font-marker px-3 py-1.5 rounded border-2 border-[#261D24] shadow-[4px_4px_0_#17131A] select-none animate-milestone-fly ${item.bg}`}
            >
              {item.text}
            </div>
          ))}

          {/* 4. Comic Punch Pop Milestone Bubble */}
          <div className="relative z-10 flex flex-col items-center justify-center animate-comic-pop">
            <div className="bg-[#2E0509] border-4 border-[#FAF4EB] shadow-[10px_10px_0_#17131A] px-6 py-4 rounded-2xl -rotate-1 flex items-center gap-3">
              <span className="text-4xl animate-bounce">🎂</span>
              <div>
                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#D9889E] block">
                  MULTIVERSE COUNTDOWN SYNC
                </span>
                <h2 className="font-marker text-2xl sm:text-4xl text-[#FAF4EB] leading-tight">
                  *STICK!* 📌 TARGETING CANON EVENTS...
                </h2>
              </div>
              <span className="text-4xl animate-pulse">🕸️</span>
            </div>

            <span className="font-handwriting text-2xl text-[#ECA8B8] mt-3 font-black drop-shadow-md">
              Locking in dates across Earth-65 & Earth-616...
            </span>
          </div>
        </div>
      )}

      {/* Footer Tag */}
      <footer className="max-w-md mx-auto text-center z-20 mt-4">
        <span className="font-mono text-[10px] font-black text-[#261D24] uppercase tracking-widest bg-[#EAD9A9] px-4 py-1 border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] inline-block -rotate-1">
          EARTH-65 × EARTH-616 • PAPER JOURNAL EDITION
        </span>
      </footer>
    </main>
  );
}