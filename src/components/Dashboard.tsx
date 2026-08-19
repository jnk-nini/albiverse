"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Camera, Clock3, Heart, ListChecks, LogOut, Mail, Music2, NotebookPen, Sparkles, Star, Timer, Unlink, UserRound } from "lucide-react";
import SpideyBackground from "./SpideyBackground";
import AmbientSound from "./AmbientSound";

interface DashboardProps {
  user: any;
  profile: any;
  partner?: any;
  couple: any;
  onSignOut: () => void;
  onUnlinked?: () => void;
}

const featureCards = [
  { href: "/clock", title: "Our Live Clock", label: "ANNIVERSARY", description: "Days, hours, minutes, and seconds together.", icon: Clock3, color: "rose" },
  { href: "/countdowns", title: "Canon Events", label: "COUNTDOWNS", description: "Post-it notes for the days we are waiting for.", icon: Timer, color: "gold" },
  { href: "/timeline", title: "Red String Timeline", label: "MEMORIES", description: "Milestones tied together across every universe.", icon: Heart, color: "red" },
  { href: "/media", title: "Retro Digicam", label: "PHOTOS + VIDEOS", description: "Captured clips, captions, and memory notes.", icon: Camera, color: "mint" },
  { href: "/letters", title: "Letter Jar", label: "SCROLLS", description: "Rolled letters waiting to be opened.", icon: Mail, color: "gold" },
  { href: "/diary", title: "Spider Diary", label: "SHARED LOG", description: "Our handwritten pages, moods, and moments.", icon: NotebookPen, color: "rose" },
  { href: "/planner", title: "Web Planner", label: "CALENDAR", description: "Date nights, trips, reminders, and plans.", icon: CalendarDays, color: "mint" },
  { href: "/bucket-list", title: "Bucket List", label: "ADVENTURES", description: "Things we will do before the next dimension.", icon: ListChecks, color: "red" },
  { href: "/soundtrack", title: "Our Playlist", label: "SOUNDTRACK", description: "The songs that follow our story.", icon: Music2, color: "gold" },
  { href: "/wishlist", title: "Gift Wishlist", label: "SECRET IDEAS", description: "Private gifts, wishes, and little discoveries.", icon: Star, color: "rose" },
  { href: "/about-him", title: "About Him Portal", label: "PRIVATE PORTAL", description: "A separate owner-only world of surprises.", icon: UserRound, color: "mint" },
];

export default function Dashboard({ user, profile, partner, couple, onSignOut, onUnlinked }: DashboardProps) {
  const [opened, setOpened] = useState(() => typeof window !== "undefined" && sessionStorage.getItem("albiverse-book-open") === "true");
  const [opening, setOpening] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const supabase = require("@/lib/supabase/client").createClient();
  const partnerName = partner?.full_name || "your favorite person";

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "contents") {
      sessionStorage.setItem("albiverse-book-open", "true");
      setOpened(true);
    }
  }, []);

  const handleUnlink = async () => {
    if (!window.confirm("Unlink both scrapbook universes?")) return;
    setUnlinking(true);
    try {
      const ids = [couple?.partner_1_id, couple?.partner_2_id].filter(Boolean);
      const { error: profileError } = await supabase.from("profiles").update({ couple_id: null }).in("id", ids);
      if (profileError) throw profileError;
      const { error: coupleError } = await supabase.from("couples").delete().eq("id", couple.id);
      if (coupleError) throw coupleError;
      onUnlinked?.();
    } catch (error) {
      console.error("Could not unlink scrapbook:", error);
    } finally {
      setUnlinking(false);
    }
  };

  const openBook = () => {
    setOpening(true);
    window.setTimeout(() => {
      sessionStorage.setItem("albiverse-book-open", "true");
      setOpened(true);
      setOpening(false);
    }, 1700);
  };

  const showIntro = () => {
    sessionStorage.removeItem("albiverse-book-open");
    setOpened(false);
  };

  if (!opened) {
    return (
      <main className="min-h-screen relative overflow-hidden grid place-items-center p-6">
        <SpideyBackground />
        {opening && <BookOpeningEffect />}
        <div className="relative z-10 w-full max-w-2xl text-center">
          <div className="scrapbook-intro-cover paper-sheet-solid p-8 sm:p-16">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 tape-gold-solid w-44 h-7 rotate-2" />
            <Heart className="w-14 h-14 mx-auto text-[#7D2834] fill-[#BD7F89] sticker-burst" />
            <p className="font-mono text-[11px] tracking-[.35em] text-[#7D2834] mt-7">EARTH-65 × EARTH-616</p>
            <h1 className="font-marker text-6xl sm:text-8xl text-[#261D24] mt-4">Albiverse</h1>
            <p className="font-handwriting text-3xl sm:text-4xl text-[#5A2029] mt-5">A scrapbook for {partnerName} & me.</p>
            <div className="mt-10 flex justify-center">
              <button onClick={openBook} disabled={opening} className="scrapbook-open-button group">
                <span className="font-marker text-2xl">Open our story</span>
                <Sparkles className="w-6 h-6 group-hover:animate-spin" />
              </button>
            </div>
            <p className="font-mono text-[10px] tracking-widest text-[#7D2834] mt-8">PULL THE COVER • TURN THE PAGE</p>
          </div>
        </div>
        <AmbientSound />
      </main>
    );
  }

  return (
    <main className="min-h-screen relative overflow-hidden p-5 sm:p-8 lg:p-12">
      <SpideyBackground />
      <AmbientSound />
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-4 mb-10">
        <div>
          <p className="font-mono text-[11px] tracking-[.3em] text-[#E0B1AE]">THE SHARED SCRAPBOOK • {profile?.full_name || "PARTNER"} + {partnerName}</p>
          <h1 className="font-marker text-5xl sm:text-7xl text-[#F2E6D2] mt-2">Pick a chapter.</h1>
        </div>
        <div className="flex items-center gap-4 text-[#E0B1AE]">
          <button onClick={showIntro} className="scrapbook-action contents-control" title="Return to intro"><BookOpenIcon /><span>INTRO</span></button>
          <button onClick={handleUnlink} disabled={unlinking} className="scrapbook-action" title="Unlink partner"><Unlink className="w-6 h-6" /></button>
          <button onClick={onSignOut} className="scrapbook-action" title="Sign out"><LogOut className="w-6 h-6" /></button>
        </div>
      </header>

      <p className="relative z-20 text-[#E0B1AE] font-mono text-xs tracking-widest mb-5">LINKED TO {partnerName.toUpperCase()}</p>

      <section className="relative z-20 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-7 max-w-[1500px] mx-auto pb-10">
        {featureCards.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <Link key={feature.href} href={feature.href} className={`dashboard-feature-card feature-${feature.color}`} style={{ transform: `rotate(${index % 3 === 0 ? "-1.2deg" : index % 3 === 1 ? "1deg" : "-.3deg"})` }}>
              <div className="flex items-start justify-between gap-4">
                <span className="feature-stamp">{feature.label}</span>
                <Icon className="w-9 h-9 text-[#7D2834]" strokeWidth={1.6} />
              </div>
              <h2 className="font-marker text-3xl text-[#261D24] mt-10">{feature.title}</h2>
              <p className="font-handwriting text-2xl leading-tight text-[#5A2029] mt-3">{feature.description}</p>
              <span className="font-mono text-[10px] text-[#7D2834] block mt-8">OPEN PAGE →</span>
            </Link>
          );
        })}
      </section>
    </main>
  );
}

function BookOpenIcon() {
  return <span className="book-open-icon" aria-hidden="true">BOOK</span>;
}

function BookOpeningEffect() {
  const particles = Array.from({ length: 34 }, (_, index) => index);
  return (
    <div className="book-opening-effect" aria-hidden="true">
      <div className="book-opening-spread" />
      {particles.map((particle) => (
        <span key={particle} className={`opening-particle particle-${particle % 6}`} style={{ animationDelay: `${particle * 12}ms` }}>
          {particle % 3 === 0 ? "♥" : particle % 3 === 1 ? "✦" : "❀"}
        </span>
      ))}
    </div>
  );
}
