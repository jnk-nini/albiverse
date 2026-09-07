"use client";

/* The one floating "now playing" control that survives every chapter. Shows
   mixtape mode only while a tape track is actually playing or buffering;
   otherwise falls back to ambient mode, so pausing a tape track hands
   control of the pill back to the background music instead of stranding the
   reader with a silent, un-dismissable "now playing" card. Hidden entirely
   on /soundtrack, which keeps its own full transport.

   COLLAPSING: the pill used to be a permanently-expanded bar pinned over the
   bottom-right corner, which on a phone sat on top of whatever chapter
   content happened to be there (the wishlist fund tracker, the digicam's
   controls, the last row of a masonry grid). It now collapses to a single
   small handle - a "record tab" taped to the edge of the page - and
   remembers that choice per device in localStorage. Collapsed is the default
   on phone-width screens, expanded on desktop, decided once on first mount
   so it never fights a choice the reader has already made. */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Disc3, Loader2, Music, Pause, Play, Upload } from "lucide-react";
import { useAmbientPlayer, useMixtapePlayer } from "./AudioPlayerProvider";

const COLLAPSE_KEY = "albiverse.pill.collapsed";

/* Phones get the handle by default; a wide screen has room for the full pill.
   Only consulted when there is no stored preference yet. */
const MOBILE_QUERY = "(max-width: 640px)";

export default function NowPlayingPill() {
  const pathname = usePathname();
  const ambient = useAmbientPlayer();
  const mixtape = useMixtapePlayer();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* `null` until the stored preference has been read - rendering either state
     before that would flash the wrong one on every navigation. */
  const [collapsed, setCollapsed] = useState<boolean | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(COLLAPSE_KEY);
    } catch {
      /* private mode / blocked storage - fall through to the screen-size default */
    }
    if (stored === "1" || stored === "0") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage and matchMedia only exist on the client, and reading them during render (or in a useState initializer) is exactly the hydration mismatch documented in AudioPlayerProvider; post-mount is the sanctioned case
      setCollapsed(stored === "1");
      return;
    }
    setCollapsed(window.matchMedia(MOBILE_QUERY).matches);
  }, []);

  const setCollapsedPersisted = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* nothing to do - the pill still works, it just won't remember */
    }
  }, []);

  if (pathname?.startsWith("/soundtrack")) return null;
  if (!ambient.signedIn) return null;
  if (collapsed === null) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) ambient.upload(file);
  };

  /* Mixtape only takes over the pill while it is actually audible or loading -
     once paused, the pill hands control back to ambient rather than staying
     stuck on a silent "now playing" card with no way back to the background
     music from outside /soundtrack. */
  const mixtapeLive = Boolean(mixtape.currentTrackId && (mixtape.isPlaying || mixtape.isBuffering));
  const anythingPlaying = mixtapeLive ? mixtape.isPlaying : ambient.playing;

  /* `pb-[env(safe-area-inset-bottom)]` keeps the control clear of the iOS home
     indicator when the app is running installed, where there is no browser
     chrome underneath it. */
  const shellClass =
    "fixed z-50 flex flex-col items-end gap-1.5 right-3 sm:right-5 bottom-3 sm:bottom-6 " +
    "[padding-bottom:env(safe-area-inset-bottom)]";

  if (collapsed) {
    return (
      <div className={shellClass}>
        <button
          type="button"
          onClick={() => setCollapsedPersisted(false)}
          title={
            mixtapeLive
              ? `Now playing: ${mixtape.currentTrack?.title ?? "a tape"}`
              : "Open the music controls"
          }
          aria-label="Open the music controls"
          aria-expanded={false}
          className="relative w-11 h-11 flex items-center justify-center rounded-full bg-[#2E0509] border-2 border-[#261D24] shadow-[3px_3px_0_#171B22] text-[#E0B1AE] hover:text-[#F2E6D2] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition cursor-pointer"
        >
          {mixtapeLive ? (
            <Disc3
              className={`w-5 h-5 ${mixtape.isPlaying ? "animate-spin" : ""}`}
              style={{ animationDuration: "3s" }}
            />
          ) : (
            <Music className="w-5 h-5" />
          )}

          {/* A small ink dot instead of a full label, so the handle still says
              "something is playing" without taking any more room. */}
          {anythingPlaying && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#ECA8B8] border border-[#261D24] animate-pulse" />
          )}
        </button>
      </div>
    );
  }

  const collapseButton = (
    <button
      type="button"
      onClick={() => setCollapsedPersisted(true)}
      title="Hide the music controls"
      aria-label="Hide the music controls"
      aria-expanded
      className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-[#E0B1AE] hover:text-[#F2E6D2] hover:bg-[#450A10] cursor-pointer transition"
    >
      <ChevronRight className="w-4 h-4" />
    </button>
  );

  if (mixtapeLive) {
    return (
      <div className={shellClass}>
        <div className="flex items-center gap-1.5 max-w-[min(260px,calc(100vw-1.5rem))] bg-[#2E0509] border-2 border-[#261D24] rounded-full pl-3 pr-1.5 py-1.5 shadow-[3px_3px_0_#171B22]">
          <Disc3
            className={`w-4 h-4 text-[#ECA8B8] shrink-0 ${mixtape.isPlaying ? "animate-spin" : ""}`}
            style={{ animationDuration: "3s" }}
          />
          <span className="font-mono text-[10px] font-bold text-[#F2E6D2] truncate">
            {mixtape.currentTrack?.title ?? "Now playing"}
          </span>

          <button
            type="button"
            onClick={() => mixtape.togglePlay()}
            title={mixtape.isPlaying ? "Pause" : "Play"}
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-[#E0B1AE] hover:text-[#F2E6D2] hover:bg-[#450A10] cursor-pointer transition"
          >
            {mixtape.isBuffering ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mixtape.isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>

          <span className="w-px h-4 bg-[#261D24]" />

          <Link
            href="/soundtrack"
            title="Open the soundtrack deck"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-[#E0B1AE] hover:text-[#F2E6D2] hover:bg-[#450A10] cursor-pointer transition"
          >
            <Music className="w-4 h-4" />
          </Link>

          <span className="w-px h-4 bg-[#261D24]" />

          {collapseButton}
        </div>
      </div>
    );
  }

  return (
    <>
      <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileChange} />

      <div className={shellClass}>
        {ambient.error && (
          <span className="max-w-[min(220px,calc(100vw-1.5rem))] text-right font-mono text-[9px] font-bold text-[#F2E6D2] bg-[#5A2029] border border-[#261D24] px-2 py-1 rounded shadow-[2px_2px_0_#171B22]">
            {ambient.error}
          </span>
        )}

        <div className="flex items-center gap-1.5 bg-[#2E0509] border-2 border-[#261D24] rounded-full px-1.5 py-1.5 shadow-[3px_3px_0_#171B22]">
          <button
            type="button"
            onClick={() => ambient.togglePlay()}
            disabled={ambient.hasTrackError}
            title={
              ambient.trackName
                ? `${ambient.playing ? "Pause" : "Play"} ${ambient.trackName}`
                : ambient.playing
                  ? "Pause ambient music"
                  : "Play ambient music"
            }
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#E0B1AE] hover:text-[#F2E6D2] hover:bg-[#450A10] disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition"
          >
            {ambient.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <span className="w-px h-4 bg-[#261D24]" />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={ambient.uploading || !ambient.coupleId}
            title="Upload a custom background track"
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#E0B1AE] hover:text-[#F2E6D2] hover:bg-[#450A10] disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition"
          >
            {ambient.uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          </button>

          {ambient.trackName && (
            <>
              <span className="w-px h-4 bg-[#261D24]" />
              <Music className="w-3.5 h-3.5 text-[#ECA8B8]" />
            </>
          )}

          <span className="w-px h-4 bg-[#261D24]" />

          {collapseButton}
        </div>
      </div>
    </>
  );
}
