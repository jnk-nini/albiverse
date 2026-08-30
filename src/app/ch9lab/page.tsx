"use client";

/* THROWAWAY VISUAL LAB - not a real route, delete before finishing.
   Renders the chapter 9 board + player transport with fake data and no
   Supabase, using the real art components and the real exported CSS, so the
   corkboard-notes layout and the new shuffle/repeat buttons can be seen
   without needing a logged-in session. */

import { useState, type CSSProperties } from "react";
import {
  Cassette,
  ManilaEnvelope,
  PushPin,
  TicketStub,
  VinylQrSticker,
  VinylRecord,
  Tonearm,
} from "@/components/SoundtrackArt";
import { SOUNDTRACK_CSS } from "@/components/SoundtrackScreen";
import {
  Clock,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
} from "lucide-react";

const fakeTapes = [
  { id: "1", title: "Summer 2024", created_by: "me", label_color: "kraft", shell_style: "clear", tape_rotation: -6 },
  { id: "2", title: "Late Nights", created_by: "them", label_color: "crimson", shell_style: "smoke", tape_rotation: 4 },
  { id: "3", title: "Web Warriors", created_by: "me", label_color: "gwen", shell_style: "cream", tape_rotation: -3 },
];

const fakeTracks = [
  { id: "t1", mixtape_id: "1", title: "Radio Silence", artist: "The Static Hours", duration_seconds: 210, created_at: "2026-08-01" },
  { id: "t2", mixtape_id: "1", title: "Neon Bridge", artist: "Ana Ruiz", duration_seconds: 185, created_at: "2026-08-02" },
  { id: "t3", mixtape_id: "2", title: "Ceiling Fan", artist: null, duration_seconds: 240, created_at: "2026-08-15" },
  { id: "t4", mixtape_id: "3", title: "Spider Sense", artist: "Web Slingers", duration_seconds: 200, created_at: "2026-08-30" },
];

const totalRuntimeSeconds = fakeTracks.reduce((s, t) => s + t.duration_seconds, 0);
const latestTrack = fakeTracks.reduce((a, b) => (b.created_at > a.created_at ? b : a));

function formatRuntime(totalSeconds: number): string {
  if (!totalSeconds) return "0m";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function Ch9Lab() {
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <main className="st-root">
      <style>{SOUNDTRACK_CSS}</style>
      <div className="st-cork" aria-hidden />
      <div className="st-cork-marks" aria-hidden />
      <div className="st-lamp" aria-hidden />

      <div className="st-board">
        <div className="st-board-head">
          <span className="st-kicker">Chapter 09 (LAB)</span>
          <h1 className="st-board-title">Soundtrack Deck</h1>
          <p className="st-board-sub">Every tape either of us ever made. Pick one up to play it.</p>
        </div>

        <div className="st-board-field">
          <div className="st-leftcol">
            <div className="st-stack">
              {fakeTapes.map((tape, i) => (
                <button
                  key={tape.id}
                  type="button"
                  className="st-stack-item st-object"
                  style={{ "--i": i, "--rot": `${tape.tape_rotation}deg` } as CSSProperties}
                >
                  <Cassette title={tape.title} owner={tape.created_by} labelColor={tape.label_color} shellStyle={tape.shell_style} />
                  <span className="st-object-caption">2 tracks</span>
                </button>
              ))}
              <span className="st-stack-caption">Existing tapes</span>
            </div>

            <div className="st-board-notes">
              <div className="st-tape-log">
                <span className="st-bugle-tape" aria-hidden />
                <span className="st-liner-kicker">
                  <ListMusic className="w-3 h-3" strokeWidth={3} />
                  Tape log
                </span>
                <span className="st-tape-log-row">
                  <strong>{fakeTapes.length}</strong> tapes
                </span>
                <span className="st-tape-log-row">
                  <strong>{fakeTracks.length}</strong> tracks filed
                </span>
                <span className="st-tape-log-row">
                  <Clock className="w-3.5 h-3.5" strokeWidth={2.5} />
                  {formatRuntime(totalRuntimeSeconds)} of tape banked
                </span>
              </div>

              <button type="button" className="st-fresh-track">
                <span className="st-bugle-tape" aria-hidden />
                <span className="st-liner-kicker">
                  <Sparkles className="w-3 h-3" strokeWidth={3} />
                  Fresh off the tape
                </span>
                <span className="st-fresh-track-title">{latestTrack.title}</span>
                <span className="st-fresh-track-sub">
                  {latestTrack.artist ? `${latestTrack.artist} — ` : ""}
                  {fakeTapes.find((t) => t.id === latestTrack.mixtape_id)?.title}
                </span>
                <span className="st-bugle-cta">
                  <Play className="w-3.5 h-3.5" strokeWidth={3} />
                  play it
                </span>
              </button>
            </div>
          </div>

          <button type="button" className="st-create st-object">
            <PushPin tone="#C7343F" />
            <Cassette title="Scribble a name..." labelColor="bugle" shellStyle="clear" />
            <span className="st-object-caption">Create new</span>
          </button>

          <button type="button" className="st-envelope-btn st-object">
            <ManilaEnvelope caption="Local Files" />
            <span className="st-object-caption">Upload MP3 or MP4</span>
          </button>

          <button type="button" className="st-share-btn st-object">
            <VinylQrSticker matrix={null} caption="MJPICKS QR" size={132} />
            <span className="st-object-caption">Share</span>
          </button>

          <button type="button" className="st-exit st-exit-top st-object">
            <TicketStub primary="Exit" secondary="back to contents" />
          </button>
        </div>
      </div>

      <div style={{ marginTop: 80, padding: 40 }}>
        <p style={{ color: "#fff", fontFamily: "monospace", marginBottom: 16 }}>
          --- player transport row (isolated) ---
        </p>
        <div className="st-deck-plate" style={{ maxWidth: 420, margin: "0 auto" }}>
          <div className="st-deck-record">
            <VinylRecord title="Summer 2024" subtitle="Radio Silence" spinning={isPlaying} labelColor="kraft" />
            <Tonearm down={isPlaying} />
          </div>

          <div className="st-controls">
            <button
              type="button"
              className={`st-neo st-neo-xs ${shuffleOn ? "st-neo-active" : ""}`}
              onClick={() => setShuffleOn((v) => !v)}
              aria-label="Shuffle"
            >
              <Shuffle className="w-4 h-4" strokeWidth={2.5} />
            </button>

            <button type="button" className="st-neo st-neo-sm" aria-label="Previous track">
              <SkipBack className="w-5 h-5" strokeWidth={2.5} />
            </button>

            <button
              type="button"
              className={`st-neo st-neo-lg st-neo-primary ${isPlaying ? "st-neo-live" : ""}`}
              onClick={() => setIsPlaying((v) => !v)}
              aria-label="Play"
            >
              {isPlaying ? <Pause className="w-7 h-7" strokeWidth={2.5} /> : <Play className="w-7 h-7" strokeWidth={2.5} />}
            </button>

            <button type="button" className="st-neo st-neo-sm" aria-label="Next track">
              <SkipForward className="w-5 h-5" strokeWidth={2.5} />
            </button>

            <button
              type="button"
              className={`st-neo st-neo-xs ${repeatMode !== "off" ? "st-neo-active" : ""}`}
              onClick={() => setRepeatMode((m) => (m === "off" ? "all" : m === "all" ? "one" : "off"))}
              aria-label="Repeat"
            >
              {repeatMode === "one" ? <Repeat1 className="w-4 h-4" strokeWidth={2.5} /> : <Repeat className="w-4 h-4" strokeWidth={2.5} />}
            </button>

            <label className="st-volume">
              <Volume2 className="w-4 h-4" strokeWidth={2.5} />
              <input type="range" min={0} max={100} defaultValue={80} />
            </label>
          </div>
        </div>
      </div>
    </main>
  );
}
