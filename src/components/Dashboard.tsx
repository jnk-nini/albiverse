"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import SpideyBackground from "./SpideyBackground";
import { Typewriter } from "./DiaryArt";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/media/mediaPrep";
import { clearChapterAccessCache } from "@/lib/hooks/useChapterAccess";
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
  Loader2,
  RotateCcw,
  Copy,
  Check,
  X
} from "lucide-react";

/* The size a cover photo may be when PICKED. It is downscaled before it is
   stored, so this only bounds what gets read into memory. */
const COVER_MAX_IMAGE_BYTES = 40 * 1024 * 1024;

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

  // undefined = no local override yet, defer to couple?.cover_image_data
  // null      = explicitly reset to default this session
  // string    = freshly uploaded base64 data URL
  const [coverOverride, setCoverOverride] = useState<string | null | undefined>(undefined);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
  const coverFileInputRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);

  // Track failed page images by page number
  const [pageImageErrors, setPageImageErrors] = useState<Record<number, boolean>>({});

  const [bloomPhase, setBloomPhase] = useState<"bursting" | "sliding-down" | null>(null);
  const openTimersRef = useRef<number[]>([]);

  // Big & Fun Transition State for Live Clock Warp
  const [isWarpingToClock, setIsWarpingToClock] = useState(false);
  const [isWarpingToCountdowns, setIsWarpingToCountdowns] = useState(false);
  const [isWarpingToPlanner, setIsWarpingToPlanner] = useState(false);
  const [isWarpingToBucketList, setIsWarpingToBucketList] = useState(false);
  const [isWarpingToWishlist, setIsWarpingToWishlist] = useState(false);
  const [plannerBadgeCount, setPlannerBadgeCount] = useState(0);

  const [currentSpread, setCurrentSpread] = useState(0);
  const [flippingState, setFlippingState] = useState<"forward" | "backward" | null>(null);
  const [showFastNav, setShowFastNav] = useState(false);

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isDragging = useRef(false);
  const coverRef = useRef<HTMLDivElement>(null);

  const myName = profile?.full_name || "Gwen Stacy";
  const partnerName = partner?.full_name || "Peter Parker";

  /* A couple row can sit with one seat empty: either it was created that way,
     or the person in it walked away (Unlink clears profiles.couple_id but
     leaves the couples row alone). The person still holding the row never sees
     CoupleConnect - that screen only renders for a profile with NO couple_id -
     so without this banner there is nowhere in the app to read your own invite
     code, and no sign that the seat is waiting to be filled.

     Guarded on the column actually being present, because page.tsx renders a
     minimal fallback `couple` object while the real row is still in flight;
     without this check the banner flashes on every load. */
  const partnerSeatOpen =
    !!couple &&
    Object.prototype.hasOwnProperty.call(couple, "partner_1_id") &&
    (!couple.partner_1_id || !couple.partner_2_id);
  const [seatCodeCopied, setSeatCodeCopied] = useState(false);

  const coupleId = couple?.id as string | undefined;
  /* No shared static default image on purpose - the original placeholder,
     /images/scrapbook/Journal-cover.webp, turned out to be a real photo of
     Nini and her partner, which meant every couple who hadn't uploaded their
     own cover yet (i.e. every new signup on the now-public app) was shown a
     stranger's personal photo by default. The hand-drawn CSS placeholder
     below (no photo, just paper/type) is the real default now; a couple's
     own upload is the only way a photo ever appears here. */
  const effectiveCoverImageData =
    coverOverride !== undefined ? coverOverride : (couple?.cover_image_data ?? null);

  

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

  /* Clean break, not a delete: this only clears both profiles' couple_id
     (via profiles_unlink_participant, an RLS policy that already existed for
     exactly this and was simply never called from the UI before now) - the
     couples row and every piece of shared content under it (media, letters,
     diary, mixtapes...) is left completely untouched. If the same two people
     ever link to each other again, CoupleConnect.tsx's re-link check finds
     that old couples row by partner-id pair and reattaches it instead of
     creating a blank one, so the content comes back. A brand-new pairing
     with someone else, though, always starts fresh - it has no way to find
     (and shouldn't get access to) a couple it was never part of. */
  const handleUnlink = async () => {
    if (!confirm("Are you sure you want to disconnect both universes? Your shared scrapbook will stay saved in case you two link again later.")) return;
    await runUnlink();
  };

  const [runUnlink, unlinking] = useGuardedAction(async () => {
    const myId = (profile?.id ?? user?.id) as string | undefined;
    const partnerId = partner?.id as string | undefined;
    const ids = [myId, partnerId].filter(Boolean) as string[];
    if (ids.length === 0) return;

    const { error } = await supabase.from("profiles").update({ couple_id: null }).in("id", ids);
    if (error) {
      alert(`Could not unlink: ${error.message}`);
      return;
    }

    /* couple_id just changed for both partners - the per-tab chapter cache
       still holds the old one. */
    clearChapterAccessCache();
    if (onUnlinked) onUnlinked();
  }, 500);

  const [runCoverUpload, coverUploading] = useGuardedAction(async (file: File) => {
    if (!coupleId) return;
    setCoverUploadError(null);

    if (!file.type.startsWith("image/")) {
      setCoverUploadError("Please choose an image file.");
      return;
    }
    if (file.size > COVER_MAX_IMAGE_BYTES) {
      setCoverUploadError(`Keep the cover photo under ${COVER_MAX_IMAGE_BYTES / (1024 * 1024)}MB.`);
      return;
    }

    /* The cover is the very first thing the app has to paint, and it used to be
       stored at whatever size the phone produced - the existing one on this
       account is 9.5MB of base64. Downscaling to book-cover size makes it a few
       hundred KB with no visible difference at the size it is displayed. */
    const prepared = await compressImage(file, { maxEdge: 1600, targetBytes: 900_000 });
    const dataUrl = prepared.dataUrl;
    const { error } = await supabase
      .from("couples")
      .update({ cover_image_data: dataUrl })
      .eq("id", coupleId);

    if (error) {
      setCoverUploadError(error.message);
      return;
    }

    setCoverOverride(dataUrl);
    setHasCoverImageError(false);
  }, 800);

  const [runCoverReset, coverResetting] = useGuardedAction(async () => {
    if (!coupleId) return;
    setCoverUploadError(null);

    const { error } = await supabase
      .from("couples")
      .update({ cover_image_data: null })
      .eq("id", coupleId);

    if (error) {
      setCoverUploadError(error.message);
      return;
    }

    setCoverOverride(null);
    setHasCoverImageError(false);
  }, 500);

  const handleCoverFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void runCoverUpload(file);
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
      router.push(`/clock?from=${currentSpread}`);
    }, 1100);
  };
// Inside Dashboard.tsx

// 1. Prefetch the route in useEffect so the page loads instantly with zero lag
useEffect(() => {
  router.prefetch("/countdowns");
  router.prefetch("/clock");
  router.prefetch("/letters");
  router.prefetch("/diary");
  router.prefetch("/soundtrack");
  // NOTE: /planner and /bucket-list are deliberately NOT eagerly prefetched
  // here. In dev mode, router.prefetch() triggers on-demand compilation of
  // the target route - these two are brand new and heavy, so prefetching
  // them on every Dashboard mount (i.e. every app load) was forcing Next.js
  // to compile both in the background before the reader ever asked for
  // them, which is what made the whole app feel slower to load right after
  // they were added. Each chapter's own click handler (handleOpenPlanner/
  // handleOpenBucketList, below) still prefetches right when it's opened,
  // which is plenty of lead time given the ~1.2s warp animation before the
  // actual navigation happens.
}, [router]);

// Spider-Sense badge for the Ch.07 tile: counts canon events still waiting
// on a confirmation stamp or landing today, couple-scoped and realtime.
useEffect(() => {
  if (!couple?.id) return;
  let active = true;
  const loadBadge = async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const { count } = await supabase
      .from("calendar_events")
      .select("id", { count: "exact", head: true })
      .eq("couple_id", couple.id)
      .or(
        `and(rsvp_required.eq.true,confirmed_at.is.null),and(starts_at.gte.${todayStart.toISOString()},starts_at.lt.${todayEnd.toISOString()})`
      );
    if (active) setPlannerBadgeCount(count || 0);
  };
  loadBadge();
  const channel = supabase
    .channel(`dashboard_planner_badge_${couple.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "calendar_events", filter: `couple_id=eq.${couple.id}` }, loadBadge)
    .subscribe();
  return () => {
    active = false;
    supabase.removeChannel(channel);
  };
}, [couple?.id, supabase]);

// 2. Updated Chapter 2 Navigation Handler
const handleGoToCountdowns = (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  setIsWarpingToCountdowns(true);

  // Prefetch again right on click to guarantee data/bundle readiness
  router.prefetch("/countdowns");

  setTimeout(() => {
    router.push(`/countdowns?from=${currentSpread}`);
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
      router.push(`/timeline?from=${currentSpread}`);
    }, 1150);
  };

  // Chapter 5 Love Letter Jar Warp State
  const [isWarpingLetters, setIsWarpingLetters] = useState(false);

  /* The spread the reader is on travels with them into the chapter, so BACK
     from the jar drops them onto this exact page of the contents instead of
     the front of the book. */
  const handleOpenLetters = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsWarpingLetters(true);
    router.prefetch("/letters");

    setTimeout(() => {
      router.push(`/letters?from=${currentSpread}`);
    }, 1250);
  };

  // Chapter 6 Spider Diary Warp State
  const [isWarpingDiary, setIsWarpingDiary] = useState(false);

  /* Ch.06 carries the reader's spread out with them the same way Ch.05 does, so
     BACK from the diary lands on this page of the contents rather than page one. */
  const handleOpenDiary = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsWarpingDiary(true);
    router.prefetch("/diary");

    setTimeout(() => {
      router.push(`/diary?from=${currentSpread}`);
    }, 1250);
  };

  // Chapter 9 Soundtrack Deck Warp State
  const [isWarpingSoundtrack, setIsWarpingSoundtrack] = useState(false);

  /* Same contract as Ch.05/Ch.06: the spread travels with the reader so the
     torn ticket stub inside the chapter brings them back to this page. */
  const handleOpenSoundtrack = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsWarpingSoundtrack(true);
    router.prefetch("/soundtrack");

    setTimeout(() => {
      router.push(`/soundtrack?from=${currentSpread}`);
    }, 1250);
  };

  // Chapter 7 Web Planner Warp State
  const handleOpenPlanner = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsWarpingToPlanner(true);
    router.prefetch("/planner");

    setTimeout(() => {
      router.push(`/planner?from=${currentSpread}`);
    }, 1200);
  };

  // Chapter 8 Multiverse Bucket List Warp State
  const handleOpenBucketList = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsWarpingToBucketList(true);
    router.prefetch("/bucket-list");

    setTimeout(() => {
      router.push(`/bucket-list?from=${currentSpread}`);
    }, 1200);
  };

  // Chapter 10 Secret Wishlist Warp State. This chapter is deliberately NOT
  // couple-scoped (see src/app/wishlist/page.tsx and CLAUDE.md's
  // partner_vault rule) - the tile is visible to both signed-in accounts on
  // this couple, but each account's data is private to itself, invisible to
  // whoever they're linked with.
  const handleOpenWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsWarpingToWishlist(true);
    router.prefetch("/wishlist");

    setTimeout(() => {
      router.push(`/wishlist?from=${currentSpread}`);
    }, 1200);
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
    { title: "Love Letter Jar", desc: "Folded scrolls & wax-sealed notes", href: "/letters", tag: "CH. 05", icon: Mail, note: "Confidential unsealed letters", onClick: handleOpenLetters },
    { title: "Spider Diary", desc: "Typed field logs, pinned to the board", href: "/diary", tag: "CH. 06", icon: BookHeart, note: "Our private logbook", onClick: handleOpenDiary },
    { title: "Web Planner", desc: "Shared date schedules & reminders", href: "/planner", tag: "CH. 07", icon: CheckSquare, note: "Adventures on the docket", onClick: handleOpenPlanner, badgeCount: plannerBadgeCount },
    { title: "Multiverse Bucket List", desc: "Adventures across dimensions to complete", href: "/bucket-list", tag: "CH. 08", icon: Sparkles, note: "Cross off our milestones", onClick: handleOpenBucketList },
    { title: "Soundtrack Deck", desc: "Spinning vinyl & our special playlist", href: "/soundtrack", tag: "CH. 09", icon: Disc, note: "Songs for our universe", onClick: handleOpenSoundtrack },
    { title: "Secret Wishlist", desc: "A private R&D lab for surprise gift plans, just yours", href: "/wishlist", tag: "CH. 10", icon: Gift, note: "Owner-only — not shared, ever", onClick: handleOpenWishlist },
    { title: "Partner Dossier", desc: "Confidential intel, sizes & favorites", href: "/dossier", tag: "CH. 11", icon: Lock, note: "Classified intel on your other half" },
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
            /* Returning the same object lets React bail out of the re-render.
               Building a fresh one unconditionally re-rendered the whole
               contents tree mid page-flip every time a page-art 404 landed. */
            onError={() =>
              setPageImageErrors((prev) => (prev[pageNum] ? prev : { ...prev, [pageNum]: true }))
            }
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
            <span className="toc-medallion shrink-0 relative">
              <Icon className="w-5 h-5" strokeWidth={2} />
              {(item as { badgeCount?: number }).badgeCount != null && (item as { badgeCount?: number }).badgeCount! > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#7D2834] border-2 border-[#FAF4EB] text-[#FAF4EB] text-[9px] font-mono font-black flex items-center justify-center animate-pulse">
                  {(item as { badgeCount?: number }).badgeCount}
                </span>
              )}
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
              /* `from` is the spread this page sits on, so the chapter's own
                 BACK control can return the reader to it. Derived from the page
                 number rather than `currentSpread` so the leaves rendered
                 during a flip carry their own spread, not the one being left. */
              <Link
                href={`${item.href}?from=${Math.floor((pageNum - 1) / 2)}`}
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
          {/* Hidden while a seat is empty: there is nobody on the other side to
              unlink from, and pressing it in that state would clear your OWN
              couple_id and leave you locked out of a scrapbook you still own,
              with no partner code left to type your way back in. */}
          {!partnerSeatOpen && (
            <button
              onClick={handleUnlink}
              disabled={unlinking}
              className="text-xs font-mono font-black text-[#E0B1AE] bg-[#3C1820] hover:bg-[#5A2029] px-3 py-1.5 border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] flex items-center gap-1.5 transition cursor-pointer"
            >
              <Unlink className="w-3.5 h-3.5" />
              <span>{unlinking ? "Unlinking..." : "Unlink"}</span>
            </button>
          )}
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

      {/* ============= OPEN SEAT: WAITING FOR THE OTHER HALF ============= */}
      {partnerSeatOpen && !isBookOpened && (
        <div className="max-w-6xl mx-auto w-full z-30 mt-3">
          <div className="relative paper-sheet-solid px-4 py-3 sm:px-6 sm:py-4 -rotate-[0.4deg] shadow-[6px_6px_0_#171B22]">
            <div className="absolute -top-3 left-8 tape-red-solid w-28 h-6 rotate-2 pointer-events-none" />

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-[#7a1f34]">
                  One seat still empty
                </p>
                <p className="font-handwriting text-lg sm:text-xl leading-tight text-[#1a0d10]">
                  Give them this frequency. They sign up, type it in, and every page in
                  here is theirs too &mdash; nothing you&apos;ve made gets lost.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-2xl sm:text-3xl font-black tracking-[0.22em] text-[#1a0d10] bg-[#F5E7C8] border-[2.5px] border-[#261D24] px-3 py-1.5 shadow-[3px_3px_0_#171B22]">
                  {profile?.invite_code || "------"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(profile?.invite_code ?? "");
                    setSeatCodeCopied(true);
                    window.setTimeout(() => setSeatCodeCopied(false), 2000);
                  }}
                  aria-label="Copy your invite code"
                  className="p-2.5 bg-[#2E0509] hover:bg-[#450A10] text-[#ECA8B8] border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] transition cursor-pointer"
                >
                  {seatCodeCopied ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

                {!hasCoverImageError && effectiveCoverImageData ? (
                  <div className="ml-5 sm:ml-7 flex-1 border-3 border-[#261D24] rounded-lg shadow-inner relative overflow-hidden flex flex-col justify-between bg-[#1B0D12]">
                    <img
                      src={effectiveCoverImageData}
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

                {/* Cover photo controls sit above whichever branch is
                   showing (real photo or the CSS placeholder) so the
                   "add a photo" trigger is always available - not just once
                   a couple already has a custom cover. */}
                <div className="absolute top-4 right-4 z-40 flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        coverFileInputRef.current?.click();
                      }}
                      disabled={coverUploading}
                      title="Change cover photo"
                      className="w-9 h-9 rounded-full bg-[#FAF7F2] hover:bg-white text-[#261D24] border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] flex items-center justify-center transition cursor-pointer disabled:opacity-60 disabled:pointer-events-none"
                    >
                      {coverUploading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Camera className="w-4 h-4" />
                      )}
                    </button>
                    {effectiveCoverImageData && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void runCoverReset();
                        }}
                        disabled={coverResetting}
                        title="Reset to default cover"
                        className="w-7 h-7 rounded-full bg-[#3C1820] hover:bg-[#5A2029] text-[#E0B1AE] border-2 border-[#261D24] shadow-[2px_2px_0_#171B22] flex items-center justify-center transition cursor-pointer disabled:opacity-60 disabled:pointer-events-none"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {coverUploadError && (
                    <span className="max-w-[140px] text-right font-mono text-[9px] font-bold text-[#F2E6D2] bg-[#5A2029] border border-[#261D24] px-2 py-1 shadow-[2px_2px_0_#171B22]">
                      {coverUploadError}
                    </span>
                  )}
                </div>

                <input
                  ref={coverFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onClick={(e) => e.stopPropagation()}
                  onChange={handleCoverFileChange}
                />

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
          <div className="paper-open-notebook-spread min-h-[460px] sm:min-h-[520px] p-4 sm:p-8 relative grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">

            <div className="hidden md:block absolute inset-y-0 left-1/2 -translate-x-1/2 w-12 book-gutter-crease pointer-events-none z-30" />

            {/* Mobile-only spiral notebook binding: below md the two chapters
                stack instead of sitting side by side, so there's no hardcover
                spine to sell the "book" read - a wire coil along the top edge
                (the same .spiral-binder-ring used on the closed cover, just
                rotated 90deg into a row instead of a column) ties the stack
                together as one bound notepad instead of two loose cards. */}
            <div
              className="flex md:hidden items-center justify-center gap-2.5 absolute -top-3 left-0 right-0 z-30 pointer-events-none px-8"
              aria-hidden
            >
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="w-7 h-2.5 spiral-binder-ring border border-black/60 rotate-90 shrink-0" />
              ))}
            </div>

            {/* Base Left Page */}
            <div className="h-full relative z-0">
              {/* Fold shadow where the mobile stack "turns" into the second
                  page beneath it - hidden on desktop, where the two pages sit
                  side by side with the real gutter crease between them instead. */}
              <div className="md:hidden absolute -bottom-2.5 inset-x-3 h-3 bg-gradient-to-b from-black/25 to-transparent blur-[2px] pointer-events-none z-20" aria-hidden />
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



      {/* ================= CH. 05 LOVE LETTER JAR WARP OVERLAY =================
          The other chapters throw their particles outward. This one pulls them
          IN: every scroll on screen is sucked into the jar's mouth, the cork
          pops, the fairy lights come up, and the jar fills with warm light.
          Its CSS lives here rather than in globals.css because nothing else in
          the app uses it. */}
      {isWarpingLetters && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0E0709]/92 backdrop-blur-md overflow-hidden pointer-events-none">
          <style>{`
            @keyframes jarwarp-rise {
              0%   { transform: translateY(70vh) scale(0.55) rotate(-9deg); opacity: 0; }
              45%  { transform: translateY(0) scale(1.06) rotate(2deg); opacity: 1; }
              62%  { transform: translateY(0) scale(0.95) rotate(-1.5deg); }
              78%  { transform: translateY(0) scale(1.03) rotate(0.8deg); }
              100% { transform: translateY(0) scale(1) rotate(0deg); opacity: 1; }
            }
            @keyframes jarwarp-cork {
              0%   { transform: translateY(0) rotate(0deg); }
              38%  { transform: translateY(0) rotate(0deg); }
              58%  { transform: translateY(-120px) rotate(-38deg); }
              100% { transform: translateY(-260px) rotate(-150deg); opacity: 0; }
            }
            @keyframes jarwarp-fill {
              0%, 40% { opacity: 0; transform: scaleY(0.1); }
              70%     { opacity: 0.85; transform: scaleY(0.72); }
              100%    { opacity: 1; transform: scaleY(1); }
            }
            @keyframes jarwarp-suck {
              0%   { transform: translate(var(--fly-x), var(--fly-y)) rotate(var(--fly-rot)) scale(1.15); opacity: 0; }
              18%  { opacity: 1; }
              100% { transform: translate(0, -20px) rotate(0deg) scale(0.16); opacity: 0; }
            }
            @keyframes jarwarp-twinkle {
              0%, 100% { opacity: 0.35; }
              50%      { opacity: 1; }
            }
            @keyframes jarwarp-sway {
              0%, 100% { transform: rotate(-1.6deg); }
              50%      { transform: rotate(1.6deg); }
            }
            .jarwarp-jar   { animation: jarwarp-rise 1.25s cubic-bezier(0.2, 0.9, 0.3, 1) forwards; }
            .jarwarp-cork  { animation: jarwarp-cork 1.25s cubic-bezier(0.3, 0.8, 0.4, 1) forwards; }
            .jarwarp-fill  { animation: jarwarp-fill 1.25s ease-out forwards; transform-origin: bottom center; }
            .jarwarp-note  { animation: jarwarp-suck 1.1s cubic-bezier(0.55, 0, 0.35, 1) forwards; }
            .jarwarp-bulb  { animation: jarwarp-twinkle 1.4s ease-in-out infinite; }
            .jarwarp-string{ animation: jarwarp-sway 3s ease-in-out infinite; transform-origin: top center; }
          `}</style>

          {/* 1. Fairy lights strung across the top of the frame */}
          <div className="jarwarp-string absolute top-0 left-0 right-0 h-40">
            <svg viewBox="0 0 1200 160" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
              <path d="M0 12 Q 300 128 600 74 T 1200 18" fill="none" stroke="#5A4638" strokeWidth="3" />
            </svg>
            {Array.from({ length: 15 }).map((_, i) => {
              const t = i / 14;
              // sampled off the same quadratic droop the wire is drawn with
              const x = t * 100;
              const y = 12 + Math.sin(t * Math.PI) * 62 + (t > 0.5 ? -18 * (t - 0.5) * 2 : 0);
              return (
                <span
                  key={i}
                  className="jarwarp-bulb absolute w-2.5 h-2.5 rounded-full"
                  style={{
                    left: `${x}%`,
                    top: `${y}px`,
                    background: i % 3 === 0 ? "#FFD9A0" : i % 3 === 1 ? "#FFC1CE" : "#FFEBC4",
                    boxShadow: `0 0 12px 4px ${i % 3 === 1 ? "rgba(255,177,198,.55)" : "rgba(255,201,130,.55)"}`,
                    animationDelay: `${(i % 5) * 0.18}s`,
                  }}
                />
              );
            })}
          </div>

          {/* 2. The jar itself, rising into frame and filling with warm light */}
          <div className="jarwarp-jar relative w-[188px] h-[248px] sm:w-[228px] sm:h-[300px] -translate-y-10">
            {/* cork, popping off the top */}
            <div className="jarwarp-cork absolute left-1/2 -translate-x-1/2 -top-8 w-[74px] h-[34px] sm:w-[92px] sm:h-[40px] rounded-[10px] border-[3px] border-[#3A2A1C] bg-[linear-gradient(180deg,#D9AF75,#A87C46)]" />

            {/* glass body */}
            <div className="absolute inset-0 rounded-b-[34px] rounded-t-[16px] border-[3px] border-[#9FB3B4]/70 bg-[linear-gradient(115deg,rgba(226,236,233,.20),rgba(226,236,233,.06)_40%,rgba(226,236,233,.24))] overflow-hidden">
              {/* the light filling up from the bottom */}
              <div className="jarwarp-fill absolute inset-x-0 bottom-0 h-full bg-[radial-gradient(ellipse_at_50%_100%,rgba(255,200,130,.85),rgba(255,150,120,.35)_45%,transparent_75%)]" />
              {/* a few scrolls already settled at the bottom */}
              {[
                { l: "12%", b: "8%", w: "58%", r: "-14deg" },
                { l: "34%", b: "18%", w: "52%", r: "22deg" },
                { l: "8%",  b: "28%", w: "48%", r: "6deg" },
                { l: "40%", b: "38%", w: "46%", r: "-26deg" },
              ].map((s, i) => (
                <span
                  key={i}
                  className="absolute h-3 rounded-full border border-[#8A6E4E]/70 bg-[linear-gradient(180deg,#F6EBD6,#D9C29C)]"
                  style={{ left: s.l, bottom: s.b, width: s.w, transform: `rotate(${s.r})` }}
                />
              ))}
              {/* glass highlight */}
              <span className="absolute left-3 top-4 bottom-8 w-2 rounded-full bg-white/25" />
            </div>

            {/* twine bow and kraft heart tag, straight off the reference jar */}
            <span className="absolute left-1/2 -translate-x-1/2 top-1.5 w-[86%] h-1.5 rounded-full bg-[#B99B6E]" />
            <span className="absolute left-1/2 -translate-x-1/2 top-6 w-8 h-8 rotate-12 border-2 border-[#8A6E4E] bg-[#C9A778] rounded-[6px] grid place-items-center text-[13px]">
              🤎
            </span>
          </div>

          {/* 3. Scrolls, tags and hearts rushing into the jar's mouth */}
          {[
            { text: "📜", x: "-42vw", y: "-30vh", rot: "-24deg" },
            { text: "💌", x: "40vw", y: "-26vh", rot: "18deg" },
            { text: "📜", x: "-34vw", y: "30vh", rot: "34deg" },
            { text: "🕸️", x: "38vw", y: "26vh", rot: "-12deg" },
            { text: "🏷️", x: "0vw", y: "-42vh", rot: "10deg" },
            { text: "🤍", x: "-22vw", y: "-16vh", rot: "-30deg" },
            { text: "🕷️", x: "26vw", y: "14vh", rot: "26deg" },
            { text: "🌾", x: "-26vw", y: "20vh", rot: "16deg" },
            { text: "📜", x: "46vw", y: "2vh", rot: "-40deg" },
            { text: "💗", x: "-46vw", y: "4vh", rot: "20deg" },
          ].map((item, idx) => (
            <span
              key={idx}
              style={{
                "--fly-x": item.x,
                "--fly-y": item.y,
                "--fly-rot": item.rot,
                animationDelay: `${idx * 0.055}s`,
              } as React.CSSProperties}
              className="jarwarp-note absolute text-4xl sm:text-5xl select-none"
            >
              {item.text}
            </span>
          ))}

          {/* 4. Comic bubble, parked under the jar so it never covers it */}
          <div className="absolute bottom-[13vh] left-1/2 -translate-x-1/2 flex flex-col items-center animate-comic-pop">
            <div className="bg-[#450A10] border-4 border-[#FAF4EB] shadow-[10px_10px_0_#17131A] px-6 py-4 rounded-2xl -rotate-1 flex items-center gap-4">
              <span className="text-4xl animate-bounce">🫙</span>
              <div>
                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#E0B1AE] block">
                  CHAPTER 05 • LOVE LETTER JAR
                </span>
                <h2 className="font-marker text-2xl sm:text-4xl text-[#FAF4EB] leading-tight">
                  *POP!* 📜 UNCORKING THE JAR...
                </h2>
              </div>
              <span className="text-4xl animate-pulse">🕯️</span>
            </div>

            <span className="font-handwriting text-2xl text-[#E0B1AE] mt-3 font-black drop-shadow-md">
              Gathering every note we ever rolled up...
            </span>
          </div>
        </div>
      )}

      {/* ================= CH. 06 SPIDER DIARY WARP OVERLAY =================
          The chapter is a typewriter and a corkboard, so its loading screen is
          the machine coming up onto the desk, a sheet feeding out of the platen,
          and the headline striking itself out one character at a time while the
          clippings fly in to be filed.

          All of it is transform, opacity and clip-path. The typing is a stepped
          clip-path rather than an animated width, which would relayout the line
          on every character. */}
      {isWarpingDiary && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#100A0C]/94 backdrop-blur-md overflow-hidden pointer-events-none">
          <style>{`
            @keyframes dywarp-rise {
              0%   { transform: translateY(78vh) scale(0.7); opacity: 0; }
              46%  { transform: translateY(0) scale(1.05); opacity: 1; }
              64%  { transform: translateY(0) scale(0.97); }
              82%  { transform: translateY(0) scale(1.02); }
              100% { transform: translateY(0) scale(1); opacity: 1; }
            }
            @keyframes dywarp-feed {
              0%, 22% { transform: scaleY(0.04) translateY(38%); opacity: 0; }
              40%     { opacity: 1; }
              100%    { transform: scaleY(1) translateY(0); opacity: 1; }
            }
            @keyframes dywarp-type {
              0%, 42% { clip-path: inset(0 100% 0 0); }
              100%    { clip-path: inset(0 0 0 0); }
            }
            @keyframes dywarp-bars {
              0%, 100% { transform: translateY(0); }
              50%      { transform: translateY(-6px); }
            }
            @keyframes dywarp-file {
              0%   { transform: translate(var(--fly-x), var(--fly-y)) rotate(var(--fly-rot)) scale(1.2); opacity: 0; }
              20%  { opacity: 1; }
              100% { transform: translate(0, 6vh) rotate(0deg) scale(0.2); opacity: 0; }
            }
            @keyframes dywarp-bell {
              0%, 62% { transform: rotate(0deg); }
              72%     { transform: rotate(-26deg); }
              84%     { transform: rotate(18deg); }
              100%    { transform: rotate(0deg); }
            }
            .dywarp-machine { animation: dywarp-rise 1.25s cubic-bezier(0.2, 0.9, 0.3, 1) forwards; }
            .dywarp-sheet   { animation: dywarp-feed 1.25s cubic-bezier(0.2, 0.9, 0.3, 1) forwards; transform-origin: bottom center; }
            .dywarp-typed   { animation: dywarp-type 1.15s steps(13, end) forwards; }
            .dywarp-machine .dy-tw-bars { transform-box: fill-box; transform-origin: bottom center; animation: dywarp-bars 150ms ease-in-out infinite; }
            .dywarp-clip    { animation: dywarp-file 1.15s cubic-bezier(0.55, 0, 0.35, 1) forwards; }
            .dywarp-bell    { display: inline-block; animation: dywarp-bell 1.25s ease-out forwards; transform-origin: center; }
          `}</style>

          {/* grid paper behind everything, so the screen reads as the board */}
          <div
            className="absolute inset-0 opacity-[0.13]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg,#ECA8B8 0 1px,transparent 1px 32px),repeating-linear-gradient(90deg,#ECA8B8 0 1px,transparent 1px 32px)",
            }}
          />

          {/* the machine, with the sheet rolling up out of its platen */}
          <div className="dywarp-machine relative w-[min(560px,88vw)] translate-y-6">
            <div className="dywarp-sheet relative mx-auto w-[74%] border border-[#C9BEAA] border-b-0 bg-[#FCF8F1] px-5 pt-5 pb-10 shadow-[0_18px_38px_rgba(0,0,0,.55)]">
              <span className="block border-t-2 border-dashed border-[#B9AC96]" />
              <p className="mt-3 font-mono text-[9px] font-black uppercase tracking-[0.22em] text-[#8A7A62]">
                Field log
              </p>
              <p className="dywarp-typed mt-1 whitespace-nowrap font-mono text-lg sm:text-2xl font-black uppercase tracking-tight text-[#1C1317]">
                TODAY&apos;S LOG_
              </p>
              <span className="mt-3 block h-[3px] w-2/3 bg-[#1C1317]" />
              <span className="mt-2 block h-[6px] w-full bg-[#1C1317]/15" />
              <span className="mt-1.5 block h-[6px] w-5/6 bg-[#1C1317]/15" />
            </div>

            <div className="relative -mt-8">
              <Typewriter className="block w-full h-auto" />
            </div>
          </div>

          {/* clippings, pins and caption boxes rushing in to be filed */}
          {[
            { text: "\u{1F5DE}\uFE0F", x: "-44vw", y: "-30vh", rot: "-22deg" },
            { text: "\u{1F4CC}", x: "42vw", y: "-26vh", rot: "16deg" },
            { text: "\u{1F4F0}", x: "-34vw", y: "28vh", rot: "30deg" },
            { text: "\u{1F577}\uFE0F", x: "38vw", y: "24vh", rot: "-14deg" },
            { text: "\u{1F4DD}", x: "0vw", y: "-42vh", rot: "9deg" },
            { text: "\u{1F4CD}", x: "-22vw", y: "-15vh", rot: "-28deg" },
            { text: "\u{1F5FA}\uFE0F", x: "26vw", y: "13vh", rot: "24deg" },
            { text: "\u{1F4CE}", x: "-27vw", y: "19vh", rot: "14deg" },
            { text: "\u{1F4F8}", x: "47vw", y: "2vh", rot: "-38deg" },
            { text: "\u{1F58B}\uFE0F", x: "-47vw", y: "3vh", rot: "18deg" },
          ].map((item, idx) => (
            <span
              key={idx}
              style={
                {
                  "--fly-x": item.x,
                  "--fly-y": item.y,
                  "--fly-rot": item.rot,
                  animationDelay: `${idx * 0.05}s`,
                } as React.CSSProperties
              }
              className="dywarp-clip absolute text-4xl sm:text-5xl select-none"
            >
              {item.text}
            </span>
          ))}

          {/* comic bubble, parked under the machine so it never covers it */}
          <div className="absolute bottom-[7vh] left-1/2 -translate-x-1/2 flex flex-col items-center animate-comic-pop">
            <div className="bg-[#450A10] border-4 border-[#FAF4EB] shadow-[10px_10px_0_#17131A] px-6 py-4 rounded-2xl -rotate-1 flex items-center gap-4">
              <span className="dywarp-bell text-4xl">&#128276;</span>
              <div>
                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#E0B1AE] block">
                  CHAPTER 06 &bull; SPIDER DIARY
                </span>
                <h2 className="font-marker text-2xl sm:text-4xl text-[#FAF4EB] leading-tight">
                  *CLACK!* FEEDING THE SHEET...
                </h2>
              </div>
              <span className="text-4xl animate-pulse">&#128393;</span>
            </div>

            <span className="font-handwriting text-2xl text-[#E0B1AE] mt-3 font-black drop-shadow-md">
              Pinning every day we bothered to write down...
            </span>
          </div>
        </div>
      )}

      {/* ================= CH. 09 SOUNDTRACK DECK WARP OVERLAY =================
          The chapter is a corkboard of cassettes and a turntable, so its
          loading screen is the record dropping onto the platter: the vinyl
          rises into frame, the tonearm swings down onto it, the record starts
          turning, and every tape and note on screen is pulled into the spindle.

          All transform and opacity. The grooves are a static repeating
          gradient on the disc, so the whole record spins as one composited
          layer instead of being repainted every frame. */}
      {isWarpingSoundtrack && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#160C08]/94 backdrop-blur-md overflow-hidden pointer-events-none">
          <style>{`
            @keyframes stwarp-rise {
              0%   { transform: translateY(64vh) scale(0.6) rotate(-14deg); opacity: 0; }
              44%  { transform: translateY(0) scale(1.07) rotate(3deg); opacity: 1; }
              62%  { transform: translateY(0) scale(0.96) rotate(-1deg); }
              80%  { transform: translateY(0) scale(1.02) rotate(0.5deg); }
              100% { transform: translateY(0) scale(1) rotate(0deg); opacity: 1; }
            }
            @keyframes stwarp-spin { to { transform: rotate(360deg); } }
            @keyframes stwarp-arm {
              0%, 46% { transform: rotate(-30deg); }
              74%     { transform: rotate(4deg); }
              88%     { transform: rotate(-2deg); }
              100%    { transform: rotate(0deg); }
            }
            @keyframes stwarp-suck {
              0%   { transform: translate(var(--fly-x), var(--fly-y)) rotate(var(--fly-rot)) scale(1.15); opacity: 0; }
              18%  { opacity: 1; }
              100% { transform: translate(0, -12px) rotate(0deg) scale(0.14); opacity: 0; }
            }
            @keyframes stwarp-wave {
              0%, 100% { transform: scaleY(0.35); }
              50%      { transform: scaleY(1); }
            }
            .stwarp-deck  { animation: stwarp-rise 1.25s cubic-bezier(0.2, 0.9, 0.3, 1) forwards; }
            .stwarp-disc  { animation: stwarp-spin 1.9s linear infinite; will-change: transform; }
            .stwarp-arm   { animation: stwarp-arm 1.25s cubic-bezier(0.3, 0.9, 0.35, 1) forwards; transform-origin: 82% 16%; }
            .stwarp-note  { animation: stwarp-suck 1.1s cubic-bezier(0.55, 0, 0.35, 1) forwards; }
            .stwarp-bar   { animation: stwarp-wave 0.7s ease-in-out infinite; transform-origin: bottom center; }
          `}</style>

          {/* the corkboard, so the screen is already the place we are going */}
          <div
            className="absolute inset-0 opacity-[0.22]"
            style={{
              backgroundColor: "#8A5A2E",
              backgroundImage:
                "radial-gradient(rgba(60,32,12,.5) 1.1px, transparent 1.2px), radial-gradient(rgba(255,214,160,.3) .9px, transparent 1px)",
              backgroundSize: "9px 9px, 13px 13px",
            }}
          />

          {/* the deck: a paper plate with the record dropping onto it */}
          <div className="stwarp-deck relative w-[min(360px,78vw)] -translate-y-6">
            <div className="relative aspect-square rounded-[18px] border-4 border-[#FAF4EB] bg-[#F5EEE0] shadow-[10px_12px_0_rgba(8,5,4,.7)] p-5">
              <div className="relative w-full h-full">
                {/* the record */}
                <div
                  className="stwarp-disc absolute inset-0 rounded-full"
                  style={{
                    background: "radial-gradient(circle at 36% 30%, #8E1B24, #4A0910 58%, #2A050A)",
                    boxShadow: "inset 0 0 40px rgba(0,0,0,.7)",
                  }}
                >
                  <span
                    className="absolute inset-[6%] rounded-full"
                    style={{
                      backgroundImage:
                        "repeating-radial-gradient(circle, rgba(255,255,255,.08) 0 1px, transparent 1px 5px)",
                    }}
                  />
                </div>

                {/* the centre label */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[42%] aspect-square rounded-full bg-[#E8DCBE] border-[3px] border-[#2B2119]/60 grid place-content-center text-center px-2">
                  <span className="font-mono text-[8px] font-black uppercase tracking-[.18em] text-[#7A2530]">
                    Mixtape
                  </span>
                  <span className="font-marker text-[#2B2119] text-sm leading-tight">
                    OUR SOUNDTRACK
                  </span>
                  <span className="mx-auto mt-1 block w-2 h-2 rounded-full bg-[#1B1216]" />
                </div>
              </div>

              {/* the tonearm, swinging down onto the record */}
              <div className="stwarp-arm absolute -right-6 -top-4 w-[46%]">
                <svg viewBox="0 0 240 300" className="block w-full h-auto">
                  <circle cx="188" cy="52" r="38" fill="#B9BEC4" stroke="#4A4E55" strokeWidth="4" />
                  <circle cx="188" cy="52" r="16" fill="#7C828A" stroke="#3B3E44" strokeWidth="3" />
                  <g transform="rotate(24 188 70)">
                    <rect x="182" y="70" width="12" height="150" rx="6" fill="#C7CBD1" stroke="#4A4E55" strokeWidth="3" />
                    <rect x="168" y="212" width="40" height="30" rx="5" fill="#2A2C31" stroke="#14161A" strokeWidth="3" />
                    <rect x="192" y="216" width="10" height="8" rx="2" fill="#C7343F" />
                  </g>
                </svg>
              </div>
            </div>

            {/* a level meter across the bottom of the plate */}
            <div className="mt-4 flex items-end justify-center gap-1.5 h-8">
              {Array.from({ length: 13 }).map((_, i) => (
                <span
                  key={i}
                  className="stwarp-bar w-2 rounded-sm bg-[#C7343F]"
                  style={{ height: `${14 + (i % 5) * 6}px`, animationDelay: `${(i % 6) * 0.09}s` }}
                />
              ))}
            </div>
          </div>

          {/* tapes, notes and hearts pulled into the spindle */}
          {[
            { text: "\u{1F4FC}", x: "-43vw", y: "-30vh", rot: "-22deg" },
            { text: "\u{1F3A7}", x: "41vw", y: "-27vh", rot: "17deg" },
            { text: "\u{1F3B5}", x: "-34vw", y: "29vh", rot: "31deg" },
            { text: "\u{1F577}\uFE0F", x: "38vw", y: "25vh", rot: "-13deg" },
            { text: "\u{1F3AB}", x: "0vw", y: "-42vh", rot: "9deg" },
            { text: "\u{1F4BF}", x: "-22vw", y: "-16vh", rot: "-28deg" },
            { text: "\u{1F3B6}", x: "26vw", y: "14vh", rot: "25deg" },
            { text: "\u{1F4CE}", x: "-27vw", y: "20vh", rot: "15deg" },
            { text: "\u{1F5A4}", x: "47vw", y: "2vh", rot: "-38deg" },
            { text: "\u{1F4FB}", x: "-47vw", y: "4vh", rot: "19deg" },
          ].map((item, idx) => (
            <span
              key={idx}
              style={
                {
                  "--fly-x": item.x,
                  "--fly-y": item.y,
                  "--fly-rot": item.rot,
                  animationDelay: `${idx * 0.05}s`,
                } as React.CSSProperties
              }
              className="stwarp-note absolute text-4xl sm:text-5xl select-none"
            >
              {item.text}
            </span>
          ))}

          {/* comic bubble, parked under the deck so it never covers it */}
          <div className="absolute bottom-[6vh] left-1/2 -translate-x-1/2 flex flex-col items-center animate-comic-pop">
            <div className="bg-[#450A10] border-4 border-[#FAF4EB] shadow-[10px_10px_0_#17131A] px-6 py-4 rounded-2xl -rotate-1 flex items-center gap-4">
              <span className="text-4xl animate-bounce">&#128191;</span>
              <div>
                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#E0B1AE] block">
                  CHAPTER 09 &bull; SOUNDTRACK DECK
                </span>
                <h2 className="font-marker text-2xl sm:text-4xl text-[#FAF4EB] leading-tight">
                  *CLACK!* DROPPING THE NEEDLE...
                </h2>
              </div>
              <span className="text-4xl animate-pulse">&#127911;</span>
            </div>

            <span className="font-handwriting text-2xl text-[#E0B1AE] mt-3 font-black drop-shadow-md">
              Every song we ever sent each other at 2am...
            </span>
          </div>
        </div>
      )}

      {/* ================= CH. 07 WEB PLANNER WARP OVERLAY =================
          A spider-web clock face rises and spins up out of the frame while
          little date-square cards fly in toward it like a rolodex being
          shuffled, landing on a "syncing the shared timeline" caption. */}
      {isWarpingToPlanner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#150A0D]/93 backdrop-blur-md overflow-hidden pointer-events-none">
          <style>{`
            @keyframes plnwarp-rise {
              0%   { transform: translateY(60vh) scale(0.55) rotate(-10deg); opacity: 0; }
              46%  { transform: translateY(0) scale(1.08) rotate(3deg); opacity: 1; }
              64%  { transform: translateY(0) scale(0.96) rotate(-1.5deg); }
              82%  { transform: translateY(0) scale(1.02) rotate(0.6deg); }
              100% { transform: translateY(0) scale(1) rotate(0deg); opacity: 1; }
            }
            @keyframes plnwarp-spin-ring { to { transform: rotate(360deg); } }
            @keyframes plnwarp-hour { to { transform: rotate(390deg); } }
            @keyframes plnwarp-minute { to { transform: rotate(750deg); } }
            @keyframes plnwarp-card-fly {
              0%   { transform: translate(var(--fly-x), var(--fly-y)) rotate(var(--fly-rot)) scale(1.1); opacity: 0; }
              20%  { opacity: 1; }
              100% { transform: translate(0, 0) rotate(0deg) scale(0.18); opacity: 0; }
            }
            .plnwarp-clock { animation: plnwarp-rise 1.3s cubic-bezier(0.2,0.9,0.3,1) forwards; }
            .plnwarp-ring  { animation: plnwarp-spin-ring 4s linear infinite; }
            .plnwarp-hour  { animation: plnwarp-hour 1.3s ease-in-out forwards; transform-origin: bottom center; }
            .plnwarp-minute{ animation: plnwarp-minute 1.3s ease-in-out forwards; transform-origin: bottom center; }
            .plnwarp-card  { animation: plnwarp-card-fly 1.05s cubic-bezier(0.55,0,0.35,1) forwards; }
          `}</style>

          <div className="plnwarp-clock relative w-[190px] h-[190px] sm:w-[260px] sm:h-[260px] -translate-y-6">
            <div className="plnwarp-ring absolute inset-0 rounded-full border-4 border-dashed border-[#D9889E]/70" />
            <div className="absolute inset-3 rounded-full border-[3px] border-[#EAD9A9] bg-[radial-gradient(circle,rgba(122,31,52,0.4),rgba(20,10,13,0.9))] flex items-center justify-center overflow-hidden">
              <span className="absolute text-5xl opacity-70">🕸️</span>
              <div className="plnwarp-hour absolute bottom-1/2 left-1/2 w-1.5 h-14 sm:h-20 -ml-0.75 bg-[#FAF4EB] rounded-full" />
              <div className="plnwarp-minute absolute bottom-1/2 left-1/2 w-1 h-20 sm:h-28 -ml-0.5 bg-[#D9889E] rounded-full" />
              <span className="absolute w-3 h-3 rounded-full bg-[#7D2834] border-2 border-[#FAF4EB]" />
            </div>
          </div>

          {[
            { text: "📆", x: "-40vw", y: "-28vh", rot: "-20deg" },
            { text: "🗓️", x: "38vw", y: "-24vh", rot: "16deg" },
            { text: "📌", x: "-32vw", y: "28vh", rot: "30deg" },
            { text: "🕸️", x: "36vw", y: "24vh", rot: "-14deg" },
            { text: "⏰", x: "0vw", y: "-40vh", rot: "8deg" },
            { text: "💕", x: "-24vw", y: "-14vh", rot: "-26deg" },
            { text: "✅", x: "26vw", y: "12vh", rot: "22deg" },
          ].map((item, idx) => (
            <span
              key={idx}
              style={{ "--fly-x": item.x, "--fly-y": item.y, "--fly-rot": item.rot, animationDelay: `${idx * 0.06}s` } as React.CSSProperties}
              className="plnwarp-card absolute text-4xl sm:text-5xl select-none"
            >
              {item.text}
            </span>
          ))}

          <div className="absolute bottom-[12vh] left-1/2 -translate-x-1/2 flex flex-col items-center animate-comic-pop">
            <div className="bg-[#450A10] border-4 border-[#FAF4EB] shadow-[10px_10px_0_#17131A] px-6 py-4 rounded-2xl -rotate-1 flex items-center gap-4">
              <span className="text-4xl animate-bounce">🕸️</span>
              <div>
                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#E0B1AE] block">
                  CHAPTER 07 • WEB PLANNER
                </span>
                <h2 className="font-marker text-2xl sm:text-4xl text-[#FAF4EB] leading-tight">SYNCING CANON TIMELINE...</h2>
              </div>
              <span className="text-4xl animate-pulse">📌</span>
            </div>
          </div>
        </div>
      )}

      {/* ================= CH. 08 MULTIVERSE BUCKET LIST WARP OVERLAY =================
          A giant rubber stamp slams "APPROVED" down onto a torn ticket stub,
          then adventure icons burst outward from the impact point. */}
      {isWarpingToBucketList && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0B1210]/93 backdrop-blur-md overflow-hidden pointer-events-none">
          <style>{`
            @keyframes blwarp-stamp-drop {
              0%   { transform: translateY(-60vh) rotate(-16deg) scale(1.2); opacity: 0; }
              55%  { transform: translateY(-60vh) rotate(-16deg) scale(1.2); opacity: 1; }
              72%  { transform: translateY(0) rotate(-4deg) scale(1); opacity: 1; }
              82%  { transform: translateY(-16px) rotate(-6deg) scale(1.02); }
              100% { transform: translateY(0) rotate(-4deg) scale(1); opacity: 1; }
            }
            @keyframes blwarp-ticket-in {
              0%, 60% { transform: scale(0.7); opacity: 0; }
              85%     { transform: scale(1.05); opacity: 1; }
              100%    { transform: scale(1); opacity: 1; }
            }
            @keyframes blwarp-ink-mark { 0%, 74% { opacity: 0; transform: scale(0.5); } 100% { opacity: 1; transform: scale(1); } }
            @keyframes blwarp-confetti {
              0%   { transform: translate(0,0) rotate(0deg) scale(0.3); opacity: 0; }
              12%  { opacity: 1; }
              100% { transform: translate(var(--fly-x), var(--fly-y)) rotate(var(--fly-rot)) scale(1.1); opacity: 0; }
            }
            .blwarp-stamp    { animation: blwarp-stamp-drop 1.15s cubic-bezier(0.34,1.2,0.4,1) forwards; }
            .blwarp-ticket   { animation: blwarp-ticket-in 1.15s ease-out forwards; }
            .blwarp-inkmark  { animation: blwarp-ink-mark 1.15s ease-out forwards; }
            .blwarp-confetti-piece { animation: blwarp-confetti 0.9s cubic-bezier(0.2,0.9,0.3,1) forwards; animation-delay: 0.75s; opacity: 0; }
          `}</style>

          <div className="blwarp-ticket relative w-[240px] sm:w-[320px] bg-[#EFE4D6] border-3 border-[#261D24] rounded-xl p-6 shadow-[12px_12px_0_rgba(0,0,0,0.7)] -rotate-2">
            <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[#0B1210]" />
            <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[#0B1210]" />
            <p className="font-mono text-[10px] font-black uppercase text-[#5A2029] tracking-widest text-center">Multiverse Boarding Pass</p>
            <p className="font-marker text-2xl text-[#1A0D10] text-center mt-1">Next Adventure</p>
            <div className="blwarp-inkmark absolute inset-0 flex items-center justify-center">
              <span className="font-marker text-3xl sm:text-4xl text-[#7D2834] border-4 border-[#7D2834] rounded-lg px-4 py-1 -rotate-12 bg-[#EFE4D6]/90">
                APPROVED
              </span>
            </div>
          </div>

          <div className="blwarp-stamp absolute w-24 h-32 sm:w-28 sm:h-36 -translate-y-10">
            <div className="w-full h-20 sm:h-24 bg-[#3A2A22] rounded-t-xl border-3 border-[#1A0D10]" />
            <div className="w-14 sm:w-16 h-12 sm:h-14 mx-auto bg-[#5A2029] border-3 border-[#1A0D10] rounded-b-lg" />
          </div>

          {["✈️", "📷", "💍", "⛰️", "🍜", "🌀"].map((icon, i) => {
            const angle = (i / 6) * Math.PI * 2;
            const fx = `${Math.cos(angle) * 32}vw`;
            const fy = `${Math.sin(angle) * 26}vh`;
            return (
              <span
                key={icon}
                style={{ "--fly-x": fx, "--fly-y": fy, "--fly-rot": `${i * 40 - 100}deg` } as React.CSSProperties}
                className="blwarp-confetti-piece absolute text-4xl select-none"
              >
                {icon}
              </span>
            );
          })}

          <div className="absolute bottom-[10vh] left-1/2 -translate-x-1/2 flex flex-col items-center animate-comic-pop">
            <div className="bg-[#0B1210] border-4 border-[#FAF4EB] shadow-[10px_10px_0_#171B22] px-6 py-4 rounded-2xl rotate-1 flex items-center gap-4">
              <span className="text-4xl animate-bounce">🌀</span>
              <div>
                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#9FD8C4] block">
                  CHAPTER 08 • MULTIVERSE BUCKET LIST
                </span>
                <h2 className="font-marker text-2xl sm:text-4xl text-[#FAF4EB] leading-tight">*THUNK!* LOADING QUESTS...</h2>
              </div>
              <span className="text-4xl animate-pulse">🏆</span>
            </div>
          </div>
        </div>
      )}

      {/* Chapter 10 Secret Wishlist Warp - a case file dropping onto the desk
          and getting stamped CLASSIFIED, matching the R&D-lab framing of the
          chapter itself. */}
      {isWarpingToWishlist && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0B1210]/93 backdrop-blur-md overflow-hidden pointer-events-none">
          <style>{`
            @keyframes wlwarp-file-drop {
              0%   { transform: translateY(-70vh) rotate(10deg) scale(1.1); opacity: 0; }
              50%  { transform: translateY(-70vh) rotate(10deg) scale(1.1); opacity: 1; }
              75%  { transform: translateY(0) rotate(-2deg) scale(1); opacity: 1; }
              100% { transform: translateY(0) rotate(-2deg) scale(1); opacity: 1; }
            }
            @keyframes wlwarp-stamp-slam {
              0%, 70%  { opacity: 0; transform: scale(2.4) rotate(-8deg); }
              82%      { opacity: 1; transform: scale(0.92) rotate(-8deg); }
              90%      { transform: scale(1.05) rotate(-8deg); }
              100%     { opacity: 1; transform: scale(1) rotate(-8deg); }
            }
            .wlwarp-file  { animation: wlwarp-file-drop 1.1s cubic-bezier(0.34,1.2,0.4,1) forwards; }
            .wlwarp-stamp { animation: wlwarp-stamp-slam 1.1s ease-out forwards; }
          `}</style>

          <div className="wlwarp-file relative w-[240px] sm:w-[300px] bg-[#EFE4D6] border-3 border-[#261D24] rounded-lg p-6 shadow-[12px_12px_0_rgba(0,0,0,0.7)]">
            <p className="font-mono text-[10px] font-black uppercase text-[#5A2029] tracking-widest text-center">Case File</p>
            <p className="font-marker text-2xl text-[#1A0D10] text-center mt-1">Secret Wishlist</p>
            <div className="wlwarp-stamp absolute inset-0 flex items-center justify-center">
              <span className="font-marker text-2xl sm:text-3xl text-[#7D2834] border-4 border-[#7D2834] rounded-lg px-4 py-1 bg-[#EFE4D6]/90">
                CLASSIFIED
              </span>
            </div>
          </div>

          <div className="absolute bottom-[10vh] left-1/2 -translate-x-1/2 flex flex-col items-center animate-comic-pop">
            <div className="bg-[#0B1210] border-4 border-[#FAF4EB] shadow-[10px_10px_0_#171B22] px-6 py-4 rounded-2xl -rotate-1 flex items-center gap-4">
              <span className="text-4xl">🔒</span>
              <div>
                <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#9FD8C4] block">
                  CHAPTER 10 • FOR YOUR EYES ONLY
                </span>
                <h2 className="font-marker text-2xl sm:text-4xl text-[#FAF4EB] leading-tight">UNLOCKING R&amp;D LAB...</h2>
              </div>
            </div>
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