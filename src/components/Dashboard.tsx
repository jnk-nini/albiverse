"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import SpideyBackground from "./SpideyBackground";
import AmbientSound from "./AmbientSound";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";
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
  Sparkles,
  List,
  X
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
  const openTimersRef = useRef<number[]>([]);
  const [unlinking, setUnlinking] = useState(false);

  // Big & Fun Transition State for Live Clock Warp
  const [isWarpingToClock, setIsWarpingToClock] = useState(false);
  const [isWarpingToCountdowns, setIsWarpingToCountdowns] = useState(false);

  const [currentSpread, setCurrentSpread] = useState(0);
  const [flippingState, setFlippingState] = useState<"forward" | "backward" | null>(null);
  const [showFastNav, setShowFastNav] = useState(false);

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isDragging = useRef(false);
  const coverRef = useRef<HTMLDivElement>(null);

  const myName = profile?.full_name || "Gwen Stacy";
  const partnerName = partner?.full_name || "Peter Parker";

  

  useEffect(() => {
    const shouldOpen =
      searchParams?.get("view") === "toc" ||
      searchParams?.get("opened") === "true" ||
      sessionStorage.getItem("albiverse_book_opened") === "true";
    if (shouldOpen) {
      setIsBookOpened(true);
      sessionStorage.setItem("albiverse_book_opened", "true");
    }

    const spreadParam = searchParams?.get("spread");
    if (spreadParam !== null && spreadParam !== undefined) {
      const parsed = parseInt(spreadParam, 10);
      if (!Number.isNaN(parsed)) {
        setCurrentSpread(Math.max(0, Math.min(totalSpreads - 1, parsed)));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /* Opening sequence, in order. Each step has one owner and one timer, so the
     phases cannot overlap or fire twice the way they used to.

       0ms    cover starts swinging open, container shifts right
       520ms  rapid page-flip leaves over the book
       600ms  BURSTING     the flowers explode outward and cover the screen
       1500ms the screen is covered; swap the book to its opened state behind
       1780ms SLIDING-DOWN the whole bouquet falls away, revealing the TOC
       3100ms teardown                                                      */
  const handleOpenBook = () => {
    if (isOpeningSequence || isClosingSequence) return;
    setIsOpeningSequence(true);

    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

    at(520, () => {
      const b = coverRef.current?.getBoundingClientRect();
      if (b) {
        setPageFlipRect({ left: b.left, top: b.top, width: b.width, height: b.height });
      }
      setIsPageFlipSequence(true);
    });

    at(600, () => setBloomPhase("bursting"));

    at(1500, () => {
      setIsPageFlipSequence(false);
      setIsBookOpened(true);
      sessionStorage.setItem("albiverse_book_opened", "true");
      setIsOpeningSequence(false);
    });

    at(1780, () => setBloomPhase("sliding-down"));

    at(3100, () => setBloomPhase(null));

    openTimersRef.current = timers;
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

  const [runSignOut, signingOut] = useGuardedAction(onSignOut, 600);

  const [runJumpToSpread] = useGuardedAction((spreadIndex: number) => {
    setFlippingState(null);
    setCurrentSpread(spreadIndex);
    setShowFastNav(false);
  }, 300);

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

  // Chapter 3 Timeline Warp State
  // (spread/opened deep-link parsing now lives in the unified useEffect above)
  const [isWarpingTimeline, setIsWarpingTimeline] = useState(false);

  const handleOpenTimeline = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsWarpingTimeline(true);

    // Play full Spider-Verse warp animation, then push route
    setTimeout(() => {
      router.push("/timeline");
    }, 1150);
  };

  const features = [
    {
    title: "Live Canon Clock", 
    desc: "Multiverse timer & live anniversary counter", 
    href: "/clock", 
    tag: "CH. 01", 
    icon: Clock, 
    note: "Every second across dimensions", 
    onClick: handleGoToClock 
  },
  { 
    title: "Canon Countdowns", 
    desc: "Sticky milestone countdowns & birthdays", 
    href: "/countdowns", 
    tag: "CH. 02", 
    icon: Calendar, 
    note: "Mark our future timelines",
    onClick: handleGoToCountdowns // <--- Added handler
  },
    { title: "Red String Timeline", desc: "Fate threads & milestone polaroids", href: "/timeline", tag: "CH. 03", icon: Compass, note: "Connected by destiny", onClick: handleOpenTimeline },
    { title: "Retro Digicam", desc: "Instant snapshots & viewfinder clips", href: "/media", tag: "CH. 04", icon: Camera, note: "Earth-65 & 616 gallery" },
    { title: "Love Letter Jar", desc: "Folded scrolls & wax-sealed notes", href: "/letters", tag: "CH. 05", icon: Mail, note: "Confidential unsealed letters" },
    { title: "Spider Diary", desc: "Daily mood entries & shared doodles", href: "/diary", tag: "CH. 06", icon: BookHeart, note: "Our private logbook" },
    { title: "Web Planner", desc: "Shared date schedules & reminders", href: "/planner", tag: "CH. 07", icon: CheckSquare, note: "Adventures on the docket" },
    { title: "Multiverse Bucket List", desc: "Adventures across dimensions to complete", href: "/bucket-list", tag: "CH. 08", icon: Sparkles, note: "Cross off our milestones" },
    { title: "Soundtrack Deck", desc: "Spinning vinyl & our special playlist", href: "/soundtrack", tag: "CH. 09", icon: Disc, note: "Songs for our universe" },
    { title: "Secret Wishlist", desc: "Gift ideas & surprise drops (Vault)", href: "/wishlist", tag: "CH. 10", icon: Gift, note: "Surprise vault items" },
    { title: "About Him Dossier", desc: "Confidential intel, sizes & favorites", href: "/about-him", tag: "CH. 11", icon: Lock, note: "Classified Peter Parker Intel" },
  ];

  const totalSpreads = Math.ceil(features.length / 2);

  const handleNextPage = () => {
    if (currentSpread < totalSpreads - 1 && !flippingState) {
      setFlippingState("forward");
      setTimeout(() => {
        setCurrentSpread((prev) => prev + 1);
        setFlippingState(null);
      }, 820);
    }
  };

  const handlePrevPage = () => {
    if (currentSpread > 0 && !flippingState) {
      setFlippingState("backward");
      setTimeout(() => {
        setCurrentSpread((prev) => prev - 1);
        setFlippingState(null);
      }, 820);
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
        <div className="toc-page h-full flex flex-col items-center justify-center p-6 text-center">
          <span className="toc-numeral" aria-hidden>fin</span>
          <div className="relative z-10">
            <div className="toc-medallion mx-auto mb-3">
              <Feather className="w-5 h-5" strokeWidth={2} />
            </div>
            <h4 className="font-marker text-xl text-[#1A0D10]">End of the contents</h4>
            <p className="font-handwriting text-lg text-stone-600 mt-1 leading-relaxed">
              the rest is still being written with {partnerName}
            </p>
            <div className="w-16 h-px bg-[#781420]/40 mx-auto mt-4" />
          </div>
        </div>
      );
    }

    const hasImageError = pageImageErrors[pageNum];
    const Icon = item.icon;
    const chapterNo = item.tag.replace(/[^0-9]/g, "");

    return (
      <div className="toc-page h-full relative overflow-hidden flex flex-col p-4 sm:p-5">
        {/* Optional hand-made page art. Absent by default; the CSS page is the
            finished look, so a missing file changes nothing. */}
        {!hasImageError && (
          <img
            src={`/images/scrapbook/page-${pageNum}.png`}
            alt=""
            aria-hidden
            onError={() => setPageImageErrors((prev) => ({ ...prev, [pageNum]: true }))}
            className="absolute inset-0 w-full h-full object-cover z-0 pointer-events-none opacity-90"
          />
        )}

        {/* the chapter number, ghosted into the paper */}
        <span className="toc-numeral" aria-hidden>{chapterNo}</span>

        {/* a strip of tape holding the page down */}
        <span
          className="absolute -top-2 right-9 tape-pink-solid w-16 h-5 rotate-6 z-20 pointer-events-none"
          aria-hidden
        />

        <div className="relative z-10 flex flex-col h-full pl-7">
          {/* header: stamp, rule, medallion */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="feature-stamp">{item.tag}</span>
              <p className="font-mono text-[9px] font-black uppercase tracking-[0.22em] text-[#8A7550] mt-2">
                Albiverse
              </p>
            </div>
            <span className="toc-medallion shrink-0">
              <Icon className="w-5 h-5" strokeWidth={2} />
            </span>
          </div>

          <div className="h-px bg-[#8A7550]/45 my-3" />

          {/* the entry itself */}
          <h3 className="font-marker text-2xl sm:text-3xl text-[#1A0D10] leading-tight">
            {item.title}
          </h3>
          <p className="font-handwriting text-xl text-stone-700 leading-snug mt-1">
            {item.desc}
          </p>

          {/* pinned index card carrying the note */}
          <div className="toc-note-card mt-4 px-3 pt-3 pb-2.5 -rotate-1">
            <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[#781420]/70 mb-1">
              Note
            </p>
            <p className="font-handwriting text-lg text-[#3A2A22] leading-snug">
              {item.note}
            </p>
          </div>

          {/* footer */}
          <div className="mt-auto pt-4 flex items-end justify-between gap-2">
            <div className="flex flex-col">
              <span className="font-mono text-[9px] text-stone-500 font-bold uppercase tracking-[0.18em]">
                Page {pageNum}
              </span>
              <span className="w-8 h-px bg-[#781420]/35 mt-1" />
            </div>
            {item.onClick ? (
              <button
                onClick={item.onClick}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#781420] hover:bg-[#450A10] text-[#FDF6F0] font-mono text-xs font-black border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] transition active:translate-y-px cursor-pointer"
              >
                <span>OPEN ENTRY</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <Link
                href={item.href}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#781420] hover:bg-[#450A10] text-[#FDF6F0] font-mono text-xs font-black border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] transition active:translate-y-px"
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

  /* The original bouquet burst. Every entry is one flower cutout flying from
     the middle of the screen out to its own spot; there is no veil behind
     them, so the thing that covers the screen IS the flowers.

     BASE is the original hand-placed spread. FILL is a staggered lattice laid
     under it that closes the gaps, because these are cutouts: two flowers
     whose boxes overlap can still leave a hole between their petals, and a
     hole is a place you can read the page through before the reveal.

     Sizes are `max(rem, vw)` rather than fixed pixels. Fixed pixels covered a
     laptop and left dark holes all over a 1920-wide screen, since the same
     flower is a smaller share of a bigger viewport. Checked at 1920x1080,
     1440x900 and 390x844. */
  const burstParticles = useMemo(() => {
    const MID = "max(11rem, 19vw)";
    const BIG = "max(13rem, 22vw)";

    const BASE = [
      { x: "0vw", y: "0vh", scale: 1.5, delay: "0s", rot: "12deg", icon: "\u{1F338}", file: "flower-1.webp", size: MID },
      { x: "-4vw", y: "-4vh", scale: 1.4, delay: "0.01s", rot: "-25deg", icon: "\u{1F33A}", file: "flower-2.webp", size: MID },
      { x: "5vw", y: "4vh", scale: 1.4, delay: "0.02s", rot: "35deg", icon: "\u{1F339}", file: "flower-3.webp", size: MID },
      { x: "-15vw", y: "-15vh", scale: 1.35, delay: "0.03s", rot: "-40deg", icon: "\u{1F33C}", file: "flower-4.webp", size: MID },
      { x: "15vw", y: "-15vh", scale: 1.35, delay: "0.03s", rot: "45deg", icon: "\u{1F33B}", file: "flower-5.webp", size: MID },
      { x: "-18vw", y: "14vh", scale: 1.35, delay: "0.04s", rot: "20deg", icon: "\u{1F337}", file: "flower-6.webp", size: MID },
      { x: "18vw", y: "15vh", scale: 1.35, delay: "0.04s", rot: "-30deg", icon: "\u{1F490}", file: "flower-7.webp", size: MID },
      { x: "0vw", y: "-22vh", scale: 1.4, delay: "0.03s", rot: "10deg", icon: "\u{1F338}", file: "flower-1.webp", size: MID },
      { x: "0vw", y: "22vh", scale: 1.4, delay: "0.04s", rot: "-15deg", icon: "\u{1F33A}", file: "flower-2.webp", size: MID },
      { x: "-24vw", y: "0vh", scale: 1.4, delay: "0.04s", rot: "30deg", icon: "\u{1F339}", file: "flower-3.webp", size: MID },
      { x: "24vw", y: "0vh", scale: 1.4, delay: "0.04s", rot: "-45deg", icon: "\u{1F33C}", file: "flower-4.webp", size: MID },
      { x: "-32vw", y: "-28vh", scale: 1.45, delay: "0.05s", rot: "55deg", icon: "\u{1F33B}", file: "flower-5.webp", size: MID },
      { x: "0vw", y: "-36vh", scale: 1.45, delay: "0.05s", rot: "-20deg", icon: "\u{1F337}", file: "flower-6.webp", size: BIG },
      { x: "32vw", y: "-28vh", scale: 1.45, delay: "0.05s", rot: "-60deg", icon: "\u{1F490}", file: "flower-7.webp", size: MID },
      { x: "-38vw", y: "0vh", scale: 1.5, delay: "0.06s", rot: "15deg", icon: "\u{1F338}", file: "flower-1.webp", size: BIG },
      { x: "38vw", y: "0vh", scale: 1.5, delay: "0.06s", rot: "-35deg", icon: "\u{1F33A}", file: "flower-2.webp", size: BIG },
      { x: "-32vw", y: "28vh", scale: 1.45, delay: "0.06s", rot: "-40deg", icon: "\u{1F339}", file: "flower-3.webp", size: MID },
      { x: "0vw", y: "36vh", scale: 1.45, delay: "0.06s", rot: "45deg", icon: "\u{1F33C}", file: "flower-4.webp", size: BIG },
      { x: "32vw", y: "28vh", scale: 1.45, delay: "0.06s", rot: "25deg", icon: "\u{1F33B}", file: "flower-5.webp", size: MID },
      { x: "-48vw", y: "-44vh", scale: 1.6, delay: "0.07s", rot: "-15deg", icon: "\u{1F337}", file: "flower-6.webp", size: BIG },
      { x: "48vw", y: "-44vh", scale: 1.6, delay: "0.07s", rot: "35deg", icon: "\u{1F490}", file: "flower-7.webp", size: BIG },
      { x: "-48vw", y: "44vh", scale: 1.6, delay: "0.08s", rot: "50deg", icon: "\u{1F338}", file: "flower-1.webp", size: BIG },
      { x: "48vw", y: "44vh", scale: 1.6, delay: "0.08s", rot: "-45deg", icon: "\u{1F33A}", file: "flower-2.webp", size: BIG },
      { x: "-54vw", y: "-15vh", scale: 1.55, delay: "0.07s", rot: "20deg", icon: "\u{1F339}", file: "flower-3.webp", size: BIG },
      { x: "54vw", y: "-15vh", scale: 1.55, delay: "0.07s", rot: "-25deg", icon: "\u{1F33C}", file: "flower-4.webp", size: BIG },
      { x: "-54vw", y: "15vh", scale: 1.55, delay: "0.08s", rot: "-30deg", icon: "\u{1F33B}", file: "flower-5.webp", size: BIG },
      { x: "54vw", y: "15vh", scale: 1.55, delay: "0.08s", rot: "40deg", icon: "\u{1F337}", file: "flower-6.webp", size: BIG },
      { x: "-35vw", y: "54vh", scale: 1.6, delay: "0.08s", rot: "-10deg", icon: "\u{1F490}", file: "flower-7.webp", size: BIG },
      { x: "-12vw", y: "56vh", scale: 1.6, delay: "0.09s", rot: "25deg", icon: "\u{1F338}", file: "flower-1.webp", size: BIG },
      { x: "12vw", y: "56vh", scale: 1.6, delay: "0.09s", rot: "-35deg", icon: "\u{1F33A}", file: "flower-2.webp", size: BIG },
      { x: "35vw", y: "54vh", scale: 1.6, delay: "0.08s", rot: "45deg", icon: "\u{1F339}", file: "flower-3.webp", size: BIG },
    ];

    const ICONS = ["\u{1F338}", "\u{1F33A}", "\u{1F339}", "\u{1F33C}", "\u{1F33B}", "\u{1F337}", "\u{1F490}"];
    const COLS = [-56, -40, -24, -8, 8, 24, 40, 56];
    const ROWS = [-48, -24, 0, 24, 48];
    const FILL = COLS.flatMap((cx, ci) =>
      ROWS.map((ry, ri) => {
        const n = ci * ROWS.length + ri;
        // half-step stagger per column, so the lattice never reads as a grid
        const y = ry + (ci % 2 ? 7 : -7);
        return {
          x: `${cx}vw`,
          y: `${y}vh`,
          scale: 1.62,
          delay: `${(0.02 + (n % 5) * 0.014).toFixed(3)}s`,
          rot: `${((n * 53) % 100) - 50}deg`,
          icon: ICONS[n % 7],
          file: `flower-${(n % 7) + 1}.webp`,
          size: n % 3 === 0 ? BIG : MID,
        };
      })
    );

    return [...FILL, ...BASE];
  }, []);

  /* Cancel any in-flight opening timers if the dashboard goes away mid-sequence. */
  useEffect(() => () => openTimersRef.current.forEach(clearTimeout), []);

  /* Decode every bloom image up front. Without this the browser is fetching
     and decoding the art *during* the burst, which is what made the bloom
     stall halfway through. */
  useEffect(() => {
    const files = Array.from({ length: 7 }, (_, n) => `/images/bloom/flower-${n + 1}.webp`);
    Promise.all(
      files.map(
        (src) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.src = src;
            const done = () => resolve();
            if (img.decode) img.decode().then(done, done);
            else {
              img.onload = done;
              img.onerror = done;
            }
          })
      )
    );
  }, []);

  return (
    <main className="min-h-screen p-3 sm:p-6 lg:p-8 flex flex-col justify-between relative overflow-hidden select-none bg-[#181114]">
      
      <SpideyBackground />
      <AmbientSound coupleId={couple?.id} />

      <div className="fixed top-8 animate-crawl-h text-xl z-10 pointer-events-none">🕷️</div>
      <div className="fixed animate-crawl-d text-2xl z-10 pointer-events-none">🕷️</div>
      <div className="fixed left-4 animate-crawl-v text-lg z-10 pointer-events-none">🕷️</div>

      {/* Top Header */}
      <header className="max-w-6xl mx-auto w-full z-30 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {isBookOpened && (
            <>
              <button
                onClick={handleCloseBook}
                disabled={isClosingSequence}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#F2E6D2] hover:bg-[#FAF7F2] text-[#261D24] text-xs font-mono font-black border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] -rotate-1 transition cursor-pointer"
              >
                <Bookmark className="w-3.5 h-3.5 text-[#781420]" />
                <span>Close Journal</span>
              </button>
              {!isClosingSequence && (
                <button
                  onClick={() => setShowFastNav((v) => !v)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#2E0509] hover:bg-[#450A10] text-[#ECA8B8] text-xs font-mono font-black border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] rotate-1 transition cursor-pointer"
                >
                  <List className="w-3.5 h-3.5" />
                  <span>Index</span>
                </button>
              )}
            </>
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
            onClick={() => runSignOut()}
            disabled={signingOut}
            className="text-xs font-mono font-black text-[#261D24] bg-[#F2E6D2] hover:bg-[#FAF7F2] px-3 py-1.5 border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] flex items-center gap-1.5 transition cursor-pointer disabled:opacity-60 disabled:pointer-events-none"
          >
            <LogOut className="w-3.5 h-3.5 text-[#781420]" />
            <span>{signingOut ? "Signing Out..." : "Sign Out"}</span>
          </button>
        </div>
      </header>

      {/* ================= INTRO: FRONT SCRAPBOOK COVER ================= */}
      {(!isBookOpened || isClosingSequence) && (
        <div className="flex-1 flex items-center justify-center max-w-4xl mx-auto w-full py-8 z-20 journal-book-perspective">
          <div
            ref={coverRef}
            onClick={!isOpeningSequence && !isClosingSequence ? handleOpenBook : undefined}
            className={`relative cursor-pointer transition-transform duration-300 hover:scale-[1.01] ${
              isOpeningSequence ? "animate-book-shift-open" : isClosingSequence ? "animate-book-shift-close" : ""
            }`}
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
                      src="/images/scrapbook/Journal-cover.webp" 
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

      {/* ================= FLORAL CASCADE WITH 7 CUTOUTS =================
          No veil, no wash: the flower cutouts themselves are what covers the
          screen, and the whole layer slides off together to reveal the TOC. */}
      {bloomPhase && (
        <div
          className={`fixed inset-0 z-50 pointer-events-none overflow-visible ${
            bloomPhase === "sliding-down" ? "animate-bloom-curtain-drop" : ""
          }`}
        >
          <div className="bloom-top-flowers" aria-hidden="true">
            {[
              { file: "flower-1.webp", fallback: "\u{1F338}" },
              { file: "flower-2.webp", fallback: "\u{1F33A}" },
              { file: "flower-3.webp", fallback: "\u{1F339}" },
              { file: "flower-4.webp", fallback: "\u{1F33C}" },
              { file: "flower-5.webp", fallback: "\u{1F33B}" },
              { file: "flower-6.webp", fallback: "\u{1F337}" },
              { file: "flower-7.webp", fallback: "\u{1F490}" },
              { file: "flower-1.webp", fallback: "\u{1F338}" },
            ].map((flower, index) => (
              <div key={index} className="relative w-20 h-20 sm:w-28 sm:h-28 flex items-center justify-center">
                <img
                  src={`/images/bloom/${flower.file}`}
                  alt=""
                  draggable={false}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    const fallbackSpan = e.currentTarget.nextElementSibling as HTMLElement;
                    if (fallbackSpan) fallbackSpan.style.display = "inline-block";
                  }}
                  className="w-full h-full object-contain"
                />
                <span className="hidden text-6xl">{flower.fallback}</span>
              </div>
            ))}
          </div>

          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0 h-0 flex items-center justify-center">
            {burstParticles.map((flower, idx) => (
              <div
                key={idx}
                style={{
                  ["--dest-x" as any]: flower.x,
                  ["--dest-y" as any]: flower.y,
                  ["--dest-scale" as any]: flower.scale,
                  ["--dest-rot" as any]: flower.rot,
                  width: flower.size,
                  height: flower.size,
                  animationDelay: flower.delay,
                }}
                className="absolute flex items-center justify-center animate-bloom-particle pointer-events-none"
              >
                {/* No per-flower drop-shadow. It is a filter, and a filter on
                    fifty-odd animated nodes repaints every frame, which is
                    what used to make the bloom stutter halfway through. */}
                <img
                  src={`/images/bloom/${flower.file}`}
                  alt=""
                  draggable={false}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    const fallbackSpan = e.currentTarget.nextElementSibling as HTMLElement;
                    if (fallbackSpan) fallbackSpan.style.display = "inline-block";
                  }}
                  className="w-full h-full object-contain select-none"
                />
                <span className="hidden text-9xl">{flower.icon}</span>
              </div>
            ))}
          </div>

          {["A", "L", "B", "I", "V", "E", "R", "S", "E", "\u2764\uFE0F", "\u{1F577}\uFE0F"].map((char, idx) => (
            <div
              key={idx}
              style={{
                left: `${18 + idx * 6.5}%`,
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

          {/* Master 3D Spread Container
              NOTE: deliberately no `overflow-hidden` here — clipping an ancestor
              inside a `transform-style: preserve-3d` context breaks the mid-flip
              "read-through" to the base layer (the leaf goes edge-on and the
              browser can't fall back to the page behind it), which is what was
              causing the blank-page flash / stiff stop-motion look. The base
              pages underneath (z-0) already swap to the destination content the
              instant a flip starts, so removing the clip lets that show through
              continuously as the leaf turns. */}
          <div className="paper-open-notebook-spread min-h-[460px] sm:min-h-[520px] p-4 sm:p-8 relative grid grid-cols-1 md:grid-cols-2 gap-6">
            
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

            {/* Dynamic Leaves.
                The geometry here has to match the base pages EXACTLY or the
                leaf jumps sideways the instant a flip starts and again when it
                lands, which is most of what made the old turn look wonky.
                The spread is `p-4 sm:p-8` with `gap-6`, so a page runs from the
                outer padding edge to half the gap (12px) short of the spine.
                The leaf therefore hinges ON the spine (left-1/2 / right-1/2)
                and its faces sit 12px in from it — which puts the face exactly
                over the base page it covers, and exactly over the opposite
                page once it has turned 180deg. */}
            {flippingState === "forward" && (
              <div className="hidden md:block absolute top-4 bottom-4 sm:top-8 sm:bottom-8 left-1/2 right-4 sm:right-8 flip-leaf flip-leaf-forward z-40">
                <div className="absolute inset-y-0 left-3 right-0 page-face-front">
                  {renderChapterContent(curRight, currentSpread * 2 + 2)}
                </div>
                <div className="absolute inset-y-0 left-3 right-0 page-face-back">
                  {renderChapterContent(nextLeft, (currentSpread + 1) * 2 + 1)}
                </div>
              </div>
            )}

            {flippingState === "backward" && (
              <div className="hidden md:block absolute top-4 bottom-4 sm:top-8 sm:bottom-8 left-4 sm:left-8 right-1/2 flip-leaf flip-leaf-backward z-40">
                <div className="absolute inset-y-0 left-0 right-3 page-face-front">
                  {renderChapterContent(curLeft, currentSpread * 2 + 1)}
                </div>
                <div className="absolute inset-y-0 left-0 right-3 page-face-back">
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

      {/* ================= UNIVERSAL FAST-TRAVEL INDEX ================= */}
      {showFastNav && isBookOpened && !isClosingSequence && (
        <div
          className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowFastNav(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="paper-sheet-solid max-w-lg w-full max-h-[75vh] overflow-y-auto p-5 sm:p-7"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-marker text-2xl sm:text-3xl text-[#1A0D10]">Jump to a Chapter</h3>
              <button onClick={() => setShowFastNav(false)} className="text-[#7D2834] cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-2.5">
              {features.map((item, index) => {
                const Icon = item.icon;
                const spreadIndex = Math.floor(index / 2);
                return (
                  <button
                    key={item.tag}
                    onClick={() => runJumpToSpread(spreadIndex)}
                    className={`flex items-center gap-2.5 text-left border-2 border-[#261D24] px-3 py-2.5 shadow-[3px_3px_0_rgba(38,29,36,.4)] transition cursor-pointer ${
                      spreadIndex === currentSpread ? "bg-[#F2E6D2]" : "bg-[#E8D9C1] hover:bg-[#F2E6D2]"
                    }`}
                  >
                    <Icon className="w-4 h-4 text-[#7D2834] shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block font-mono text-[9px] font-black text-[#7D2834]">{item.tag}</span>
                      <span className="block font-marker text-sm text-[#1A0D10] truncate">{item.title}</span>
                    </span>
                  </button>
                );
              })}
            </div>
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

      {/* ================= CHAPTER 3 RED STRING TIMELINE WARP OVERLAY ================= */}
            {isWarpingTimeline && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md overflow-hidden animate-in fade-in duration-300">
                
                {/* 1. Giant Winding Red Web String Radial Burst */}
                <div className="absolute w-[600px] h-[600px] sm:w-[900px] sm:h-[900px] rounded-full border-6 border-dashed border-[#7D2834] opacity-80 animate-red-string-burst flex items-center justify-center pointer-events-none">
                  <span className="text-9xl opacity-90 select-none">🧵</span>
                </div>

                {/* 2. Rotating Multiverse Timeline Portal */}
                <div className="absolute w-72 h-72 sm:w-96 sm:h-96 rounded-full border-8 border-dotted border-[#E0B1AE] opacity-60 animate-timeline-portal-spin flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-48 rounded-full border-4 border-dashed border-[#C5A467]" />
                </div>

                {/* 3. Flying Spider-Verse Timeline Particles & Polaroids */}
                {[
                  { text: "📸", x: "-38vw", y: "-28vh" },
                  { text: "🧵", x: "36vw", y: "-26vh" },
                  { text: "💌", x: "-32vw", y: "30vh" },
                  { text: "🕷️", x: "38vw", y: "24vh" },
                  { text: "616", x: "0vw", y: "-40vh" },
                  { text: "65", x: "-22vw", y: "-15vh" },
                  { text: "✨", x: "25vw", y: "15vh" },
                  { text: "❤️", x: "-20vw", y: "24vh" },
                ].map((item, idx) => (
                  <span
                    key={idx}
                    style={{
                      "--fly-x": item.x,
                      "--fly-y": item.y,
                    } as React.CSSProperties}
                    className="absolute font-marker text-3xl sm:text-5xl text-[#FAF4EB] drop-shadow-[0_0_15px_#7D2834] animate-timeline-particle select-none pointer-events-none"
                  >
                    {item.text}
                  </span>
                ))}

                {/* 4. Comic Punch Pop Bubble in Center */}
                <div className="relative z-10 flex flex-col items-center justify-center animate-comic-pop">
                  <div className="bg-[#7D2834] border-4 border-[#FAF4EB] shadow-[10px_10px_0_#17131A] px-7 py-4 rounded-2xl rotate-2 flex items-center gap-4">
                    <span className="text-4xl animate-bounce">🧵</span>
                    <div>
                      <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#E0B1AE] block">
                        CHAPTER 03 • RED STRING OF FATE
                      </span>
                      <h2 className="font-marker text-3xl sm:text-4xl text-[#FAF4EB] leading-tight">
                        *THWIP!* 🕸️ CONNECTING TIMELINES...
                      </h2>
                    </div>
                    <span className="text-4xl animate-spin">📸</span>
                  </div>

                  <span className="font-handwriting text-2xl text-[#E0B1AE] mt-3 font-black drop-shadow-md">
                    Weaving polaroids across dimensions...
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