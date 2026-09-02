"use client";

/* The one floating "now playing" control that survives every chapter. Shows
   mixtape mode only while a tape track is actually playing or buffering;
   otherwise falls back to ambient mode, so pausing a tape track hands
   control of the pill back to the background music instead of stranding the
   reader with a silent, un-dismissable "now playing" card. Hidden entirely
   on /soundtrack, which keeps its own full transport. */

import { useRef } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Disc3, Loader2, Music, Pause, Play, Upload } from "lucide-react";
import { useAmbientPlayer, useMixtapePlayer } from "./AudioPlayerProvider";

export default function NowPlayingPill() {
  const pathname = usePathname();
  const ambient = useAmbientPlayer();
  const mixtape = useMixtapePlayer();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (pathname?.startsWith("/soundtrack")) return null;
  if (!ambient.signedIn) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) ambient.upload(file);
  };

  /* Mixtape only takes over the pill while it is actually audible or loading -
     once paused, the pill hands control back to ambient rather than staying
     stuck on a silent "now playing" card with no way back to the background
     music from outside /soundtrack. */
  if (mixtape.currentTrackId && (mixtape.isPlaying || mixtape.isBuffering)) {
    return (
      <div className="fixed bottom-6 right-5 z-50 flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5 max-w-[260px] bg-[#2E0509] border-2 border-[#261D24] rounded-full pl-3 pr-1.5 py-1.5 shadow-[3px_3px_0_#171B22]">
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
        </div>
      </div>
    );
  }

  return (
    <>
      <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileChange} />

      <div className="fixed bottom-6 right-5 z-50 flex flex-col items-end gap-1.5">
        {ambient.error && (
          <span className="max-w-[220px] text-right font-mono text-[9px] font-bold text-[#F2E6D2] bg-[#5A2029] border border-[#261D24] px-2 py-1 rounded shadow-[2px_2px_0_#171B22]">
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
              <Music className="w-3.5 h-3.5 text-[#ECA8B8] mr-1" />
            </>
          )}
        </div>
      </div>
    </>
  );
}
