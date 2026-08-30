"use client";

/* ================= CHAPTER 09 - SOUNDTRACK DECK =================
   Design read: a corkboard above a desk where two people keep their tapes.
   There is no navbar anywhere in this chapter. Everything you can do is a
   physical object you touch: a torn ticket stub leaves, a manila envelope
   takes files off your phone, a vinyl QR sticker shares, a blank cassette
   starts a new mixtape, and an existing cassette drops into a boombox.

   Dials: DESIGN_VARIANCE 9 / MOTION_INTENSITY 7 / VISUAL_DENSITY 6.

   Four stages, in the order the reader meets them:
     board     the corkboard hub
     creating  the fresh tape: slides in, gets taped, gets its name scribbled
     dropping  the boombox drop: the tape slides into the deck and it snaps shut
     player    the vinyl turntable, the tracklist, search, and the share cutting

   Audio comes from two places. Mainstream songs stream through the YouTube
   IFrame player (search runs server-side through /api/youtube/search so the key
   is never shipped to the browser). Personal recordings are uploaded as base64
   into mixtape_tracks.audio_data, the same no-Storage-bucket pattern the rest
   of the app uses, which is exactly why the track list query never selects that
   column: a tape of twenty bootlegs would be a fifty megabyte page load. The
   blob is fetched per track, on play, and cached for the session. */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Check,
  Copy,
  Disc3,
  Loader2,
  MoreHorizontal,
  Music,
  Pause,
  Play,
  Plus,
  Search,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";
import { encodeQr } from "@/lib/qr";
import {
  Boombox,
  Cassette,
  STICKER_EDGE,
  ManilaEnvelope,
  PolaroidViewfinder,
  PushPin,
  SHELL_STYLES,
  TAPE_COLORS,
  TicketStub,
  Tonearm,
  VinylQrSticker,
  VinylRecord,
} from "./SoundtrackArt";

/* ------------------------------------------------------------------ types */

interface SoundtrackScreenProps {
  userId: string;
  coupleId: string;
  myName: string;
  partnerName: string;
  onBack: () => void;
  /* share_slug from ?tape=, so a scanned code opens straight onto that tape */
  openSlug?: string | null;
}

type Mixtape = {
  id: string;
  couple_id: string;
  created_by: string;
  title: string;
  subtitle: string | null;
  liner_notes: string | null;
  label_color: string;
  shell_style: string;
  tape_rotation: number;
  share_slug: string;
  created_at: string;
};

type Track = {
  id: string;
  mixtape_id: string;
  couple_id: string;
  added_by: string;
  position: number;
  title: string;
  artist: string | null;
  source: "youtube" | "local";
  youtube_id: string | null;
  thumbnail_url: string | null;
  media_type: "audio" | "video";
  duration_seconds: number | null;
  liner_note: string | null;
  created_at: string;
};

type YoutubeHit = {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationSeconds: number | null;
};

type Stage = "board" | "creating" | "dropping" | "player";

/* A file read off the device but not yet filed onto a tape. */
type PendingUpload = {
  title: string;
  dataUrl: string;
  mediaType: "audio" | "video";
  duration: number | null;
};

/* Never select audio_data here. See the file header. */
const TRACK_COLUMNS =
  "id, mixtape_id, couple_id, added_by, position, title, artist, source, youtube_id, thumbnail_url, media_type, duration_seconds, liner_note, created_at";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

/* ------------------------------------------------------------- small utils */

function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Pull a video id out of anything a person might paste. */
function parseYoutubeId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/live\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = p.exec(trimmed);
    if (m) return m[1];
  }
  return null;
}

/** Strip the extension off an uploaded filename for a usable track title. */
function titleFromFile(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return base.replace(/[_-]+/g, " ").trim() || "Untitled bootleg";
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

/* A short mechanical clack, synthesised rather than shipped as an asset, so
   there is no audio file that can 404 the way the ambient track once did. */
function useClack() {
  const ctxRef = useRef<AudioContext | null>(null);
  return useCallback(() => {
    try {
      type WithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext ?? (window as WithWebkit).webkitAudioContext;
      if (!Ctor) return;
      const ctx = ctxRef.current ?? new Ctor();
      ctxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();

      const now = ctx.currentTime;
      const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
      }
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1800;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start(now);

      const thunk = ctx.createOscillator();
      thunk.type = "square";
      thunk.frequency.setValueAtTime(160, now);
      thunk.frequency.exponentialRampToValueAtTime(60, now + 0.07);
      const thunkGain = ctx.createGain();
      thunkGain.gain.setValueAtTime(0.14, now);
      thunkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      thunk.connect(thunkGain).connect(ctx.destination);
      thunk.start(now);
      thunk.stop(now + 0.1);
    } catch {
      /* audio is decoration here; a browser that refuses is not an error */
    }
  }, []);
}

/* --------------------------------------------------- YouTube IFrame loader */

type YtPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  loadVideoById: (id: string) => void;
  cueVideoById: (id: string) => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (v: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
};

type YtNamespace = {
  Player: new (
    el: HTMLElement | string,
    options: Record<string, unknown>
  ) => YtPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number };
};

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YtNamespace> | null = null;

function loadYoutubeApi(): Promise<YtNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<YtNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube player did not load."));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("Could not load the YouTube player."));
    document.head.appendChild(script);
  });
  return ytApiPromise;
}

/* ============================================================== the screen */

export default function SoundtrackScreen({
  userId,
  coupleId,
  myName,
  partnerName,
  onBack,
  openSlug,
}: SoundtrackScreenProps) {
  const supabase = useMemo(() => createClient(), []);
  const clack = useClack();

  /* ---------------------------------------------------------------- data */
  const [tapes, setTapes] = useState<Mixtape[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [stage, setStage] = useState<Stage>("board");
  const [activeTapeId, setActiveTapeId] = useState<string | null>(null);
  const [droppingTapeId, setDroppingTapeId] = useState<string | null>(null);

  /* ------------------------------------------------------------- playback */
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [volume, setVolume] = useState(80);
  const [ytReady, setYtReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  /* -------------------------------------------------------------- panels */
  const [showSearch, setShowSearch] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showTapeEditor, setShowTapeEditor] = useState(false);
  const [openTrackMenu, setOpenTrackMenu] = useState<string | null>(null);
  const [fileChooser, setFileChooser] = useState<PendingUpload[] | null>(null);

  /* ----------------------------------------------------------- new tape */
  const [draftTitle, setDraftTitle] = useState("");
  const [draftLabel, setDraftLabel] = useState("kraft");
  const [draftShell, setDraftShell] = useState("clear");
  const [createPhase, setCreatePhase] = useState<"sliding" | "taped" | "opening">("sliding");

  /* ----------------------------------------------------------- searching */
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<YoutubeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [apiConfigured, setApiConfigured] = useState(true);

  /* -------------------------------------------------------------- refs */
  const ytRef = useRef<YtPlayer | null>(null);
  const volumeRef = useRef(80);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seekTrackRef = useRef<HTMLDivElement | null>(null);
  const blobCacheRef = useRef<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mirrorRef = useRef<HTMLSpanElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);

  const activeTape = useMemo(
    () => tapes.find((t) => t.id === activeTapeId) ?? null,
    [tapes, activeTapeId]
  );
  const tapeTracks = useMemo(
    () =>
      tracks
        .filter((t) => t.mixtape_id === activeTapeId)
        .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)),
    [tracks, activeTapeId]
  );
  const currentTrack = useMemo(
    () => tapeTracks.find((t) => t.id === currentTrackId) ?? null,
    [tapeTracks, currentTrackId]
  );
  const currentIndex = currentTrack ? tapeTracks.indexOf(currentTrack) : -1;

  const trackCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tracks) map.set(t.mixtape_id, (map.get(t.mixtape_id) ?? 0) + 1);
    return map;
  }, [tracks]);

  const nameFor = useCallback(
    (id: string) => (id === userId ? myName : partnerName),
    [userId, myName, partnerName]
  );

  /* ------------------------------------------------------------ load data */

  const loadEverything = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [tapeRes, trackRes] = await Promise.all([
      supabase
        .from("mixtapes")
        .select("*")
        .eq("couple_id", coupleId)
        .order("created_at", { ascending: true }),
      supabase
        .from("mixtape_tracks")
        .select(TRACK_COLUMNS)
        .eq("couple_id", coupleId)
        .order("position", { ascending: true }),
    ]);

    if (tapeRes.error || trackRes.error) {
      setError("The board would not load. Check the connection and try again.");
      setLoading(false);
      return;
    }

    setTapes((tapeRes.data ?? []) as Mixtape[]);
    setTracks((trackRes.data ?? []) as unknown as Track[]);
    setLoading(false);
  }, [supabase, coupleId]);

  useEffect(() => {
    void loadEverything();
  }, [loadEverything]);

  /* Live updates. Both tables were added to the supabase_realtime publication
     in the same migration that created them, so these actually fire. */
  useEffect(() => {
    const channel = supabase
      .channel(`soundtrack_${coupleId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mixtapes", filter: `couple_id=eq.${coupleId}` },
        () => void loadEverything()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mixtape_tracks",
          filter: `couple_id=eq.${coupleId}`,
        },
        () => void loadEverything()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, coupleId, loadEverything]);

  /* A scanned QR code lands here with ?tape=<slug>. Once the tapes are in,
     drop that one straight into the boombox. */
  const consumedSlugRef = useRef(false);
  useEffect(() => {
    if (consumedSlugRef.current || loading || !openSlug) return;
    const match = tapes.find((t) => t.share_slug === openSlug);
    if (!match) return;
    consumedSlugRef.current = true;
    setActiveTapeId(match.id);
    setDroppingTapeId(match.id);
    setStage("dropping");
  }, [loading, openSlug, tapes]);

  /* --------------------------------------------------- transient messages */
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(id);
  }, [notice]);

  /* ------------------------------------------------------ the boombox drop */

  useEffect(() => {
    if (stage !== "dropping") return;
    clack();
    const id = window.setTimeout(() => {
      setStage("player");
      setDroppingTapeId(null);
    }, 1750);
    return () => window.clearTimeout(id);
  }, [stage, clack]);

  /* ----------------------------------------------------- the fresh tape */

  /* The phases have to advance across painted frames or the CSS transitions
     never run: an element that mounts and changes class in the same frame just
     snaps. Chapter 5 hit this exact thing. */
  useEffect(() => {
    if (stage !== "creating") return;
    setCreatePhase("sliding");
    let cancelled = false;
    const timers: number[] = [];

    const paint = () =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        requestAnimationFrame(() => requestAnimationFrame(finish));
        // a backgrounded tab never fires rAF, so do not wait on it forever
        timers.push(window.setTimeout(finish, 220));
      });

    void (async () => {
      await paint();
      if (cancelled) return;
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setCreatePhase("taped");
          clack();
          nameInputRef.current?.focus();
        }, 420)
      );
    })();

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [stage, clack]);

  /* The marker cursor rides the end of the typed title. Measured off a hidden
     mirror span and written straight onto the node as a custom property, so
     typing never re-renders anything. */
  useEffect(() => {
    if (stage !== "creating") return;
    const mirror = mirrorRef.current;
    const input = nameInputRef.current;
    if (!mirror || !input) return;
    const id = requestAnimationFrame(() => {
      const w = Math.min(mirror.offsetWidth, input.offsetWidth - 8);
      input.parentElement?.style.setProperty("--pen-x", `${Math.max(0, w)}px`);
    });
    return () => cancelAnimationFrame(id);
  }, [draftTitle, stage]);

  /* ------------------------------------------------------- the seek thread */

  /* The bead is moved with a transform, which needs the track width in px.
     Measured once and on resize, never per frame. */
  useEffect(() => {
    if (stage !== "player") return;
    const node = seekTrackRef.current;
    if (!node) return;
    const apply = () => node.style.setProperty("--st-track-w", `${node.clientWidth}`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(node);
    return () => ro.disconnect();
  }, [stage]);

  const writeProgress = useCallback((position: number, total: number) => {
    const node = seekTrackRef.current;
    if (!node) return;
    const fraction = total > 0 ? Math.min(1, Math.max(0, position / total)) : 0;
    node.style.setProperty("--st-progress", fraction.toFixed(4));
  }, []);

  /* One polling loop for both engines. 250ms is smooth enough for a bead on a
     thread and cheap enough to leave running. */
  useEffect(() => {
    if (stage !== "player" || !currentTrack) return;

    const tick = () => {
      let position = 0;
      let total = 0;
      if (currentTrack.source === "youtube") {
        const p = ytRef.current;
        if (!p) return;
        try {
          position = p.getCurrentTime();
          total = p.getDuration();
        } catch {
          return;
        }
      } else {
        const el = currentTrack.media_type === "video" ? videoRef.current : audioRef.current;
        if (!el) return;
        position = el.currentTime;
        total = Number.isFinite(el.duration) ? el.duration : 0;
      }
      writeProgress(position, total);
      setElapsed(position);
      setDuration(total);
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [stage, currentTrack, writeProgress]);

  useEffect(() => {
    return () => {
      try {
        ytRef.current?.destroy();
      } catch {
        /* the iframe may already be gone with the unmounted subtree */
      }
      ytRef.current = null;
    };
  }, []);

  useEffect(() => {
    volumeRef.current = volume;
    try {
      ytRef.current?.setVolume(volume);
    } catch {
      /* not ready yet */
    }
    if (audioRef.current) audioRef.current.volume = volume / 100;
    if (videoRef.current) videoRef.current.volume = volume / 100;
  }, [volume]);

  /* --------------------------------------------------------- play a track */

  const fetchBlob = useCallback(
    async (trackId: string): Promise<string | null> => {
      const cached = blobCacheRef.current.get(trackId);
      if (cached) return cached;
      const { data, error: blobError } = await supabase
        .from("mixtape_tracks")
        .select("audio_data")
        .eq("id", trackId)
        .eq("couple_id", coupleId)
        .maybeSingle();
      if (blobError || !data?.audio_data) return null;
      blobCacheRef.current.set(trackId, data.audio_data);
      return data.audio_data;
    },
    [supabase, coupleId]
  );

  const playTrack = useCallback(
    async (track: Track) => {
      setError(null);
      setCurrentTrackId(track.id);
      setElapsed(0);
      setDuration(track.duration_seconds ?? 0);
      writeProgress(0, track.duration_seconds ?? 0);

      if (track.source === "youtube") {
        if (audioRef.current) audioRef.current.pause();
        if (videoRef.current) videoRef.current.pause();
        const player = ytRef.current;
        /* `ytRef.current` is set the instant `new YT.Player(...)` returns, but
           its API methods (loadVideoById etc.) aren't wired up until `onReady`
           fires some time later - calling one before that throws a TypeError
           ("loadVideoById is not a function"), which used to abort this
           function before setIsPlaying ever ran. Local tracks never touched
           this branch, which is why only they appeared to work. Route through
           the same "wait for ready" queue the deferred effect already reads. */
        if (!player || !ytReady || !track.youtube_id) {
          setIsBuffering(true);
          return;
        }
        try {
          player.loadVideoById(track.youtube_id);
          player.setVolume(volumeRef.current);
          setIsPlaying(true);
        } catch {
          setIsBuffering(true);
        }
        return;
      }

      try {
        ytRef.current?.pauseVideo();
      } catch {
        /* nothing loaded yet */
      }

      setIsBuffering(true);
      const src = await fetchBlob(track.id);
      setIsBuffering(false);
      if (!src) {
        setError("That bootleg could not be found on the tape.");
        return;
      }
      const el = track.media_type === "video" ? videoRef.current : audioRef.current;
      if (!el) return;
      el.src = src;
      el.volume = volume / 100;
      try {
        await el.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
        setError("The browser blocked playback. Press play again.");
      }
    },
    [fetchBlob, volume, writeProgress, ytReady]
  );

  const togglePlay = useCallback(() => {
    if (!currentTrack) {
      const first = tapeTracks[0];
      if (first) void playTrack(first);
      return;
    }
    if (currentTrack.source === "youtube") {
      const player = ytRef.current;
      /* Same readiness gate as playTrack - a track can already be "current"
         while its player is still mid-buffering (e.g. the API was loading
         when it was first picked), and calling a method before onReady throws. */
      if (!player || !ytReady) return;
      try {
        if (isPlaying) {
          player.pauseVideo();
          setIsPlaying(false);
        } else {
          player.playVideo();
          setIsPlaying(true);
        }
      } catch {
        /* not actually ready yet; the queued-start effect will catch up */
      }
      return;
    }
    const el = currentTrack.media_type === "video" ? videoRef.current : audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      void el.play().then(
        () => setIsPlaying(true),
        () => setIsPlaying(false)
      );
    }
  }, [currentTrack, isPlaying, playTrack, tapeTracks, ytReady]);

  const skipTo = useCallback(
    (delta: number) => {
      if (tapeTracks.length === 0) return;
      const from = currentIndex >= 0 ? currentIndex : -1;
      const next = (from + delta + tapeTracks.length) % tapeTracks.length;
      void playTrack(tapeTracks[next]);
    },
    [currentIndex, playTrack, tapeTracks]
  );

  /* ------------------------------------------------- the YouTube player */

  /* Built lazily: a tape of nothing but local bootlegs never loads the iframe
     API at all. `ytReady` exists because a ref is not a reactive dependency,
     and something has to tell the "start what is queued" effect below that the
     player finally exists. */
  useEffect(() => {
    if (stage !== "player") return;
    if (!tapeTracks.some((t) => t.source === "youtube")) return;
    if (ytRef.current) return;

    let cancelled = false;
    void loadYoutubeApi()
      .then((YT) => {
        if (cancelled || !ytHostRef.current || ytRef.current) return;
        ytRef.current = new YT.Player(ytHostRef.current, {
          height: "100%",
          width: "100%",
          playerVars: {
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
          },
          events: {
            onReady: () => {
              ytRef.current?.setVolume(volumeRef.current);
              setYtReady(true);
            },
            onStateChange: (event: { data: number }) => {
              if (event.data === YT.PlayerState.ENDED) skipTo(1);
              setIsBuffering(event.data === YT.PlayerState.BUFFERING);
              if (event.data === YT.PlayerState.PLAYING) setIsPlaying(true);
              if (event.data === YT.PlayerState.PAUSED) setIsPlaying(false);
            },
            onError: () => {
              setError("That track would not play. It may be blocked from embedding.");
              setIsPlaying(false);
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setError("The YouTube player could not load.");
      });

    return () => {
      cancelled = true;
    };
  }, [stage, tapeTracks, skipTo]);

  /* A YouTube track can be picked before the iframe API has finished loading.
     When the player finally appears, start whatever is queued. */
  useEffect(() => {
    if (!ytReady || !isBuffering) return;
    if (!currentTrack || currentTrack.source !== "youtube" || !currentTrack.youtube_id) return;
    const player = ytRef.current;
    if (!player) return;
    player.loadVideoById(currentTrack.youtube_id);
    player.setVolume(volumeRef.current);
    setIsBuffering(false);
    setIsPlaying(true);
  }, [ytReady, isBuffering, currentTrack]);

  const seekToFraction = useCallback(
    (fraction: number) => {
      const clamped = Math.min(1, Math.max(0, fraction));
      if (!currentTrack) return;
      if (currentTrack.source === "youtube") {
        const player = ytRef.current;
        if (!player || !ytReady) return;
        try {
          const total = player.getDuration();
          if (!total) return;
          player.seekTo(total * clamped, true);
          writeProgress(total * clamped, total);
        } catch {
          /* not actually ready yet */
        }
        return;
      }
      const el = currentTrack.media_type === "video" ? videoRef.current : audioRef.current;
      if (!el || !Number.isFinite(el.duration)) return;
      el.currentTime = el.duration * clamped;
      writeProgress(el.currentTime, el.duration);
    },
    [currentTrack, writeProgress, ytReady]
  );

  const handleSeekPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const node = seekTrackRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0) return;
      seekToFraction((event.clientX - rect.left) / rect.width);
      node.classList.remove("st-seek-ping");
      // reading offsetWidth forces the class removal to land before it is re-added
      void node.offsetWidth;
      node.classList.add("st-seek-ping");
    },
    [seekToFraction]
  );

  /* -------------------------------------------------------------- writes */

  const [runCreateTape, creatingTape] = useGuardedAction(async () => {
    const title = draftTitle.trim() || "Untitled Mixtape";
    const { data, error: insertError } = await supabase
      .from("mixtapes")
      .insert({
        couple_id: coupleId,
        created_by: userId,
        title,
        label_color: draftLabel,
        shell_style: draftShell,
        tape_rotation: Math.round((Math.random() * 8 - 4) * 10) / 10,
      })
      .select("*")
      .single();

    if (insertError || !data) {
      setError("The tape would not save.");
      return;
    }

    const tape = data as Mixtape;
    setTapes((prev) => [...prev, tape]);
    setCreatePhase("opening");
    clack();
    setActiveTapeId(tape.id);
    setDraftTitle("");
    window.setTimeout(() => setStage("player"), 900);
  }, 700);

  const [runDeleteTape] = useGuardedAction(async (tapeId: string) => {
    if (!window.confirm("Throw this whole tape away? Every track on it goes too.")) return;
    const { error: deleteError } = await supabase
      .from("mixtapes")
      .delete()
      .eq("id", tapeId)
      .eq("couple_id", coupleId);
    if (deleteError) {
      setError("That tape would not come off the board.");
      return;
    }
    setTapes((prev) => prev.filter((t) => t.id !== tapeId));
    setTracks((prev) => prev.filter((t) => t.mixtape_id !== tapeId));
    setShowTapeEditor(false);
    setActiveTapeId(null);
    setCurrentTrackId(null);
    setIsPlaying(false);
    setStage("board");
  }, 700);

  const [runSaveTape] = useGuardedAction(
    async (patch: Partial<Pick<Mixtape, "title" | "subtitle" | "label_color" | "shell_style" | "liner_notes">>) => {
      if (!activeTape) return;
      const { error: updateError } = await supabase
        .from("mixtapes")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", activeTape.id)
        .eq("couple_id", coupleId);
      if (updateError) {
        setError("That change would not stick.");
        return;
      }
      setTapes((prev) => prev.map((t) => (t.id === activeTape.id ? { ...t, ...patch } : t)));
    },
    400
  );

  const addTrack = useCallback(
    async (
      payload: Omit<Track, "id" | "created_at" | "couple_id" | "added_by" | "mixtape_id" | "position"> & {
        audio_data?: string;
      },
      tapeId: string
    ) => {
      const position =
        tracks.filter((t) => t.mixtape_id === tapeId).reduce((max, t) => Math.max(max, t.position), -1) + 1;

      const { data, error: insertError } = await supabase
        .from("mixtape_tracks")
        .insert({ ...payload, mixtape_id: tapeId, couple_id: coupleId, added_by: userId, position })
        .select(TRACK_COLUMNS)
        .single();

      if (insertError || !data) {
        setError("That track would not go onto the tape.");
        return null;
      }
      const track = data as unknown as Track;
      setTracks((prev) => [...prev, track]);
      return track;
    },
    [supabase, coupleId, userId, tracks]
  );

  const [runAddFromYoutube] = useGuardedAction(async (hit: YoutubeHit) => {
    if (!activeTapeId) return;
    const track = await addTrack(
      {
        title: hit.title,
        artist: hit.channel,
        source: "youtube",
        youtube_id: hit.videoId,
        thumbnail_url: hit.thumbnail || null,
        media_type: "video",
        duration_seconds: hit.durationSeconds,
        liner_note: null,
      },
      activeTapeId
    );
    if (track) setNotice(`Added "${hit.title}" to the tape.`);
  }, 500);

  const [runDeleteTrack] = useGuardedAction(async (trackId: string) => {
    const { error: deleteError } = await supabase
      .from("mixtape_tracks")
      .delete()
      .eq("id", trackId)
      .eq("couple_id", coupleId);
    if (deleteError) {
      setError("That track would not come off the tape.");
      return;
    }
    blobCacheRef.current.delete(trackId);
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
    setOpenTrackMenu(null);
    if (currentTrackId === trackId) {
      setCurrentTrackId(null);
      setIsPlaying(false);
    }
  }, 500);

  const [runMoveTrack] = useGuardedAction(async (trackId: string, delta: number) => {
    const index = tapeTracks.findIndex((t) => t.id === trackId);
    const swapWith = index + delta;
    if (index < 0 || swapWith < 0 || swapWith >= tapeTracks.length) return;

    const a = tapeTracks[index];
    const b = tapeTracks[swapWith];
    setTracks((prev) =>
      prev.map((t) =>
        t.id === a.id ? { ...t, position: b.position } : t.id === b.id ? { ...t, position: a.position } : t
      )
    );

    const [resA, resB] = await Promise.all([
      supabase.from("mixtape_tracks").update({ position: b.position }).eq("id", a.id).eq("couple_id", coupleId),
      supabase.from("mixtape_tracks").update({ position: a.position }).eq("id", b.id).eq("couple_id", coupleId),
    ]);
    if (resA.error || resB.error) {
      setError("The running order would not save.");
      void loadEverything();
    }
  }, 350);

  /* ------------------------------------------------------ local bootlegs */

  const handleFilesPicked = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setError(null);
      setNotice("Reading files off your device...");

      const prepared: PendingUpload[] = [];
      for (const file of Array.from(fileList)) {
        const isVideo = file.type.startsWith("video/");
        const cap = isVideo ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
        if (file.size > cap) {
          setError(
            `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${
              cap / 1024 / 1024
            }MB, because files live in the database rather than a bucket.`
          );
          continue;
        }
        try {
          const dataUrl = await readAsDataUrl(file);
          prepared.push({
            title: titleFromFile(file.name),
            dataUrl,
            mediaType: isVideo ? "video" : "audio",
            duration: null,
          });
        } catch {
          setError(`"${file.name}" could not be read.`);
        }
      }

      setNotice(null);
      if (prepared.length === 0) return;

      /* Straight onto the open tape, or ask which one when we are on the board. */
      if (activeTapeId && stage === "player") {
        for (const item of prepared) {
          await addTrack(
            {
              title: item.title,
              artist: "Local bootleg",
              source: "local",
              youtube_id: null,
              thumbnail_url: null,
              media_type: item.mediaType,
              duration_seconds: item.duration,
              liner_note: null,
              audio_data: item.dataUrl,
            },
            activeTapeId
          );
        }
        setNotice(`Filed ${prepared.length} bootleg${prepared.length === 1 ? "" : "s"}.`);
        return;
      }
      setFileChooser(prepared);
    },
    [activeTapeId, addTrack, stage]
  );

  const [runFileToTape] = useGuardedAction(async (tapeId: string) => {
    const pending = fileChooser;
    if (!pending) return;
    setFileChooser(null);
    for (const item of pending) {
      await addTrack(
        {
          title: item.title,
          artist: "Local bootleg",
          source: "local",
          youtube_id: null,
          thumbnail_url: null,
          media_type: item.mediaType,
          duration_seconds: item.duration,
          liner_note: null,
          audio_data: item.dataUrl,
        },
        tapeId
      );
    }
    setActiveTapeId(tapeId);
    setDroppingTapeId(tapeId);
    setStage("dropping");
  }, 800);

  const [runFileToNewTape] = useGuardedAction(async () => {
    const pending = fileChooser;
    if (!pending) return;
    const { data, error: insertError } = await supabase
      .from("mixtapes")
      .insert({
        couple_id: coupleId,
        created_by: userId,
        title: "Local bootlegs",
        label_color: "ink",
        shell_style: "smoke",
        tape_rotation: Math.round((Math.random() * 8 - 4) * 10) / 10,
      })
      .select("*")
      .single();
    if (insertError || !data) {
      setError("A new tape could not be started.");
      return;
    }
    const tape = data as Mixtape;
    setTapes((prev) => [...prev, tape]);
    setFileChooser(null);
    for (const item of pending) {
      await addTrack(
        {
          title: item.title,
          artist: "Local bootleg",
          source: "local",
          youtube_id: null,
          thumbnail_url: null,
          media_type: item.mediaType,
          duration_seconds: item.duration,
          liner_note: null,
          audio_data: item.dataUrl,
        },
        tape.id
      );
    }
    setActiveTapeId(tape.id);
    setDroppingTapeId(tape.id);
    setStage("dropping");
  }, 900);

  /* ------------------------------------------------------------- search */

  useEffect(() => {
    if (!showSearch) return;
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setSearchNote(null);
      return;
    }

    /* A pasted link resolves to exactly one video, so skip the search quota. */
    const pastedId = parseYoutubeId(term);
    const controller = new AbortController();
    const id = window.setTimeout(async () => {
      setSearching(true);
      setSearchNote(null);
      try {
        const url = pastedId
          ? `/api/youtube/search?id=${encodeURIComponent(pastedId)}`
          : `/api/youtube/search?q=${encodeURIComponent(term)}`;
        const res = await fetch(url, { signal: controller.signal });
        const json = await res.json();
        setApiConfigured(json.configured !== false);
        setHits(json.results ?? []);
        const found = json.results ?? [];
        if (found.length > 0) setSearchNote(null);
        else if (json.message) setSearchNote(json.message);
        else if (json.error) setSearchNote(json.error);
        else setSearchNote(pastedId ? "That link could not be resolved." : "Nothing came back for that.");
      } catch (err) {
        if ((err as Error).name !== "AbortError") setSearchNote("The search could not run.");
      } finally {
        setSearching(false);
      }
    }, 450);

    return () => {
      controller.abort();
      window.clearTimeout(id);
    };
  }, [query, showSearch]);

  /* -------------------------------------------------------------- share */

  /* On the board there is no open tape yet, so the sticker shares the newest
     one. That is what a QR sticker sitting on a desk would point at. */
  const shareTape = useMemo(
    () => activeTape ?? tapes[tapes.length - 1] ?? null,
    [activeTape, tapes]
  );

  const shareUrl = useMemo(() => {
    if (!shareTape || typeof window === "undefined") return "";
    return `${window.location.origin}/soundtrack?tape=${shareTape.share_slug}`;
  }, [shareTape]);

  const qrMatrix = useMemo(() => {
    if (!shareUrl) return null;
    try {
      return encodeQr(shareUrl);
    } catch {
      return null;
    }
  }, [shareUrl]);

  const copyShareLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The clipboard is blocked here. Select the link and copy it by hand.");
    }
  }, [shareUrl]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    if (stage !== "player") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowRight" && e.shiftKey) {
        skipTo(1);
      } else if (e.code === "ArrowLeft" && e.shiftKey) {
        skipTo(-1);
      } else if (e.code === "Escape") {
        setShowSearch(false);
        setShowShare(false);
        setShowTapeEditor(false);
        setOpenTrackMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, togglePlay, skipTo]);

  /* ================================================================ views */

  const boardTapes = tapes;

  const leaveTape = () => {
    try {
      ytRef.current?.pauseVideo();
    } catch {
      /* nothing loaded */
    }
    audioRef.current?.pause();
    videoRef.current?.pause();
    setIsPlaying(false);
    setStage("board");
  };

  return (
    <main className="st-root">
      <style>{SOUNDTRACK_CSS}</style>

      {/* the board itself: cork, spider masks, halftone, a lamp from above */}
      <div className="st-cork" aria-hidden />
      <div className="st-cork-marks" aria-hidden />
      <div className="st-lamp" aria-hidden />

      {/* the only thing that is not an object: a live region for messages */}
      <div className="st-messages" role="status" aria-live="polite">
        {error && (
          <p className="st-toast st-toast-bad">
            <X className="w-3.5 h-3.5" strokeWidth={3} />
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="st-toast">
            <Check className="w-3.5 h-3.5" strokeWidth={3} />
            {notice}
          </p>
        )}
      </div>

      {loading && (
        <div className="st-loading">
          <Loader2 className="w-5 h-5 st-spin" strokeWidth={3} />
          <span>Pulling the tapes off the board...</span>
        </div>
      )}

      {/* ============================================ STAGE 1: THE CORKBOARD */}
      {!loading && stage === "board" && (
        <div className="st-board">
          <div className="st-board-head">
            <span className="st-kicker">Chapter 09</span>
            <h1 className="st-board-title">Soundtrack Deck</h1>
            <p className="st-board-sub">
              Every tape either of us ever made. Pick one up to play it.
            </p>
          </div>

          <div className="st-board-field">
            {/* the stack of existing tapes */}
            {boardTapes.length > 0 && (
              <div className="st-stack">
                {boardTapes.map((tape, i) => (
                  <button
                    key={tape.id}
                    type="button"
                    className="st-stack-item st-object"
                    style={
                      {
                        "--i": i,
                        "--rot": `${tape.tape_rotation}deg`,
                      } as CSSProperties
                    }
                    onClick={() => {
                      setActiveTapeId(tape.id);
                      setDroppingTapeId(tape.id);
                      setStage("dropping");
                    }}
                  >
                    <Cassette
                      title={tape.title}
                      owner={nameFor(tape.created_by)}
                      labelColor={tape.label_color}
                      shellStyle={tape.shell_style}
                    />
                    <span className="st-object-caption">
                      {trackCounts.get(tape.id) ?? 0} track
                      {(trackCounts.get(tape.id) ?? 0) === 1 ? "" : "s"}
                    </span>
                  </button>
                ))}
                <span className="st-stack-caption">Existing tapes</span>
              </div>
            )}

            {/* the blank tape */}
            <button
              type="button"
              className="st-create st-object"
              onClick={() => {
                setDraftTitle("");
                setStage("creating");
              }}
            >
              <PushPin tone="#C7343F" />
              <Cassette title="Scribble a name..." labelColor="bugle" shellStyle="clear" />
              <span className="st-object-caption">Create new</span>
            </button>

            {/* local files */}
            <button
              type="button"
              className="st-envelope-btn st-object"
              onClick={() => fileInputRef.current?.click()}
            >
              <ManilaEnvelope caption="Local Files" />
              <span className="st-object-caption">Upload MP3 or MP4</span>
            </button>

            {/* share */}
            <button
              type="button"
              className="st-share-btn st-object"
              onClick={() => {
                if (boardTapes.length === 0) {
                  setError("Make a tape first, then there is something to share.");
                  return;
                }
                setShowShare(true);
              }}
            >
              <VinylQrSticker matrix={qrMatrix} caption="MJPICKS QR" size={132} />
              <span className="st-object-caption">Share</span>
            </button>

            {/* the way out, twice, exactly like the reference board */}
            <button type="button" className="st-exit st-exit-top st-object" onClick={onBack}>
              <TicketStub primary="Exit" secondary="back to contents" />
            </button>
            <button type="button" className="st-exit st-exit-bottom st-object" onClick={onBack}>
              <TicketStub primary="Exit" secondary="table of contents" />
            </button>
          </div>

          {boardTapes.length === 0 && (
            <p className="st-board-empty">
              The board is bare. Pin the first tape up with the blank cassette.
            </p>
          )}
        </div>
      )}

      {/* ========================================== STAGE 2: THE FRESH TAPE */}
      {stage === "creating" && (
        <div className="st-create-stage">
          <button type="button" className="st-scrim" aria-label="Cancel" onClick={() => setStage("board")} />

          <div className={`st-fresh st-fresh-${createPhase}`}>
            <div className="st-fresh-tape">
              <Cassette
                title=""
                labelColor={draftLabel}
                shellStyle={draftShell}
                className="st-fresh-shell"
              />

              {/* the masking tape, slapped on */}
              <div className="st-fresh-tapelabel">
                <span ref={mirrorRef} className="st-mirror" aria-hidden>
                  {draftTitle || "For our coffee dates"}
                </span>
                <input
                  ref={nameInputRef}
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value.slice(0, 44))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runCreateTape();
                    if (e.key === "Escape") setStage("board");
                  }}
                  placeholder="For our coffee dates"
                  className="st-fresh-input"
                  aria-label="Name this mixtape"
                  maxLength={44}
                />
                <span className="st-fresh-pen" aria-hidden>
                  <svg viewBox="0 0 60 90" className="block w-full h-full">
                    <rect x="22" y="0" width="18" height="52" rx="4" fill="#3A3E45" />
                    <rect x="22" y="0" width="18" height="12" rx="3" fill="#6E747C" />
                    <path d="M22 52 L40 52 L34 76 L28 76 Z" fill="#2A2C31" />
                    <path d="M28 76 L34 76 L31 88 Z" fill="#16181C" />
                  </svg>
                </span>
              </div>

              {/* the panels that pop open onto the empty tracklist */}
              <span className="st-panel st-panel-left" aria-hidden />
              <span className="st-panel st-panel-right" aria-hidden />
              <div className="st-fresh-tracklist" aria-hidden>
                <span className="st-fresh-line" />
                <span className="st-fresh-line" />
                <span className="st-fresh-line" />
                <span className="st-fresh-line" />
              </div>
            </div>

            <div className="st-fresh-controls">
              <div className="st-swatch-row">
                <span className="st-swatch-label">Label</span>
                {Object.entries(TAPE_COLORS).map(([key, value]) => (
                  <button
                    key={key}
                    type="button"
                    title={value.name}
                    aria-label={value.name}
                    aria-pressed={draftLabel === key}
                    className={`st-swatch ${draftLabel === key ? "st-swatch-on" : ""}`}
                    style={{ background: value.tape }}
                    onClick={() => setDraftLabel(key)}
                  />
                ))}
              </div>
              <div className="st-swatch-row">
                <span className="st-swatch-label">Shell</span>
                {Object.entries(SHELL_STYLES).map(([key, value]) => (
                  <button
                    key={key}
                    type="button"
                    title={value.name}
                    aria-label={value.name}
                    aria-pressed={draftShell === key}
                    className={`st-swatch ${draftShell === key ? "st-swatch-on" : ""}`}
                    style={{ background: value.body }}
                    onClick={() => setDraftShell(key)}
                  />
                ))}
              </div>

              <div className="st-fresh-actions">
                <button type="button" className="st-ghost-btn" onClick={() => setStage("board")}>
                  Put it back
                </button>
                <button
                  type="button"
                  className="st-ink-btn"
                  onClick={() => void runCreateTape()}
                  disabled={creatingTape}
                >
                  {creatingTape ? <Loader2 className="w-4 h-4 st-spin" /> : <Plus className="w-4 h-4" />}
                  Pin it up
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================= STAGE 3: THE BOOMBOX DROP */}
      {stage === "dropping" && (
        <div className="st-drop-stage">
          <div className="st-drop-frame">
            <Boombox>
              {droppingTapeId && (
                <div className="st-drop-tape">
                  <Cassette
                    title={tapes.find((t) => t.id === droppingTapeId)?.title ?? ""}
                    labelColor={tapes.find((t) => t.id === droppingTapeId)?.label_color}
                    shellStyle={tapes.find((t) => t.id === droppingTapeId)?.shell_style}
                  />
                </div>
              )}
              <span className="st-drop-door" aria-hidden />
            </Boombox>
            <span className="st-clack" aria-hidden>
              clack
            </span>
          </div>
        </div>
      )}

      {/* ============================================== STAGE 4: THE PLAYER */}
      {stage === "player" && activeTape && (
        <div className="st-player">
          {/* left rail: the tracklist as cassette cards */}
          <section className="st-rail st-rail-left">
            <header className="st-rail-head">
              <span className="st-kicker">Side A</span>
              <h2 className="st-rail-title">{activeTape.title}</h2>
              <p className="st-rail-sub">
                {tapeTracks.length} track{tapeTracks.length === 1 ? "" : "s"} - made by{" "}
                {nameFor(activeTape.created_by)}
              </p>
            </header>

            <div className="st-tracklist">
              {tapeTracks.length === 0 && (
                <p className="st-empty-card">
                  Nothing on this side yet. Search for a song, or clip a local file to it.
                </p>
              )}

              {tapeTracks.map((track, index) => {
                const isCurrent = track.id === currentTrackId;
                return (
                  <article
                    key={track.id}
                    className={`st-track ${isCurrent ? "st-track-on" : ""} ${
                      openTrackMenu === track.id ? "st-track-menu-open" : ""
                    }`}
                    style={{ "--rot": `${(index % 2 === 0 ? -1 : 1) * (1 + (index % 3) * 0.6)}deg` } as CSSProperties}
                  >
                    <span className={`st-track-tape st-track-tape-${index % 3}`} aria-hidden />

                    <button type="button" className="st-track-main" onClick={() => void playTrack(track)}>
                      <span className="st-track-num">{String(index + 1).padStart(2, "0")}</span>
                      <span className="st-track-text">
                        <span className="st-track-title">{track.title}</span>
                        <span className="st-track-artist">
                          {track.artist || "Unknown artist"}
                          {track.source === "local" ? " - bootleg" : ""}
                        </span>
                      </span>
                      <span className="st-track-time">{formatClock(track.duration_seconds)}</span>
                    </button>

                    <button
                      type="button"
                      className="st-track-menu-btn"
                      aria-label={`Options for ${track.title}`}
                      aria-expanded={openTrackMenu === track.id}
                      onClick={() => setOpenTrackMenu(openTrackMenu === track.id ? null : track.id)}
                    >
                      <MoreHorizontal className="w-4 h-4" strokeWidth={3} />
                      <span>menu</span>
                    </button>

                    {openTrackMenu === track.id && (
                      <div className="st-track-menu">
                        <button type="button" onClick={() => void runMoveTrack(track.id, -1)} disabled={index === 0}>
                          Move up
                        </button>
                        <button
                          type="button"
                          onClick={() => void runMoveTrack(track.id, 1)}
                          disabled={index === tapeTracks.length - 1}
                        >
                          Move down
                        </button>
                        <button type="button" onClick={() => void playTrack(track)}>
                          Play now
                        </button>
                        <button
                          type="button"
                          className="st-track-menu-bad"
                          onClick={() => void runDeleteTrack(track.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={3} />
                          delete
                        </button>
                      </div>
                    )}

                    <span className="st-track-added">{nameFor(track.added_by)}</span>
                  </article>
                );
              })}
            </div>

            <div className="st-rail-actions">
              <button type="button" className="st-ink-btn" onClick={() => setShowSearch(true)}>
                <Plus className="w-4 h-4" strokeWidth={3} />
                add song
              </button>
              <button type="button" className="st-ghost-btn" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-4 h-4" strokeWidth={3} />
                local file
              </button>
            </div>
          </section>

          {/* centre: the turntable */}
          <section className="st-deck">
            <button type="button" className="st-search-strip" onClick={() => setShowSearch(true)}>
              <Search className="w-4 h-4" strokeWidth={3} />
              <span className="st-search-strip-label">Search for tunes</span>
              <span className="st-search-strip-sub">YouTube Data API</span>
              <span className="st-api-badge">API</span>
            </button>

            <div className="st-deck-plate">
              <div className="st-deck-record">
                <VinylRecord
                  title={activeTape.title}
                  subtitle={currentTrack?.title}
                  spinning={isPlaying}
                  labelColor={activeTape.label_color}
                />
                <Tonearm down={isPlaying || !!currentTrack} />
              </div>

              {/* woven progress thread */}
              <div className="st-seek-wrap">
                <span className="st-seek-time">{formatClock(elapsed)}</span>
                <div
                  ref={seekTrackRef}
                  className="st-seek"
                  role="slider"
                  tabIndex={0}
                  aria-label="Seek"
                  aria-valuemin={0}
                  aria-valuemax={Math.max(1, Math.round(duration))}
                  aria-valuenow={Math.round(elapsed)}
                  onPointerDown={handleSeekPointer}
                  onKeyDown={(e) => {
                    if (!duration) return;
                    if (e.key === "ArrowRight") seekToFraction((elapsed + 5) / duration);
                    if (e.key === "ArrowLeft") seekToFraction((elapsed - 5) / duration);
                  }}
                >
                  <span className="st-seek-thread" aria-hidden />
                  <span className="st-seek-done" aria-hidden />
                  <span className="st-seek-bead" aria-hidden>
                    <svg viewBox="0 0 40 30" className="block w-full h-full">
                      <path
                        d="M20 2 C31 2 37 10 37 17 C37 24 30 28 20 28 C10 28 3 24 3 17 C3 10 9 2 20 2 Z"
                        fill="#C7343F"
                        stroke="#FFFFFF"
                        strokeWidth="2.5"
                      />
                      <path d="M9 14 Q15 9 18 16 Q13 19 9 14 Z" fill="#FFFFFF" />
                      <path d="M31 14 Q25 9 22 16 Q27 19 31 14 Z" fill="#FFFFFF" />
                    </svg>
                  </span>
                </div>
                <span className="st-seek-time">{formatClock(duration)}</span>
              </div>

              {/* neomorphic rubber buttons */}
              <div className="st-controls">
                <button
                  type="button"
                  className="st-neo st-neo-sm"
                  onClick={() => skipTo(-1)}
                  aria-label="Previous track"
                >
                  <SkipBack className="w-5 h-5" strokeWidth={2.5} />
                </button>

                <button
                  type="button"
                  className={`st-neo st-neo-lg st-neo-primary ${isPlaying ? "st-neo-live" : ""}`}
                  onClick={togglePlay}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isBuffering ? (
                    <Loader2 className="w-7 h-7 st-spin" strokeWidth={2.5} />
                  ) : isPlaying ? (
                    <Pause className="w-7 h-7" strokeWidth={2.5} />
                  ) : (
                    <Play className="w-7 h-7" strokeWidth={2.5} />
                  )}
                </button>

                <button
                  type="button"
                  className="st-neo st-neo-sm"
                  onClick={() => skipTo(1)}
                  aria-label="Next track"
                >
                  <SkipForward className="w-5 h-5" strokeWidth={2.5} />
                </button>

                <label className="st-volume">
                  <Volume2 className="w-4 h-4" strokeWidth={2.5} />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    aria-label="Volume"
                  />
                </label>
              </div>

              <p className="st-now-playing">
                {currentTrack ? (
                  <>
                    <Music className="w-3.5 h-3.5" strokeWidth={3} />
                    {currentTrack.title}
                  </>
                ) : (
                  <>
                    <Disc3 className="w-3.5 h-3.5" strokeWidth={3} />
                    Drop the needle on any track
                  </>
                )}
              </p>
            </div>

            <button type="button" className="st-exit st-exit-deck st-object" onClick={leaveTape}>
              <TicketStub primary="Back to the board" secondary="all our tapes" />
            </button>
          </section>

          {/* right rail: the viewfinder and the share cutting */}
          <section className="st-rail st-rail-right">
            <PolaroidViewfinder
              caption={
                currentTrack?.source === "local" && currentTrack.media_type === "video"
                  ? "Home footage"
                  : currentTrack?.source === "youtube"
                    ? "Off the wire"
                    : "Viewfinder"
              }
              live={isPlaying}
            >
              {/* Both engines render here so the picture never lives offscreen. */}
              <div className={`st-yt ${currentTrack?.source === "youtube" ? "st-yt-on" : ""}`}>
                <div ref={ytHostRef} className="st-yt-host" />
              </div>
              <video
                ref={videoRef}
                className={`st-local-video ${
                  currentTrack?.source === "local" && currentTrack.media_type === "video" ? "st-local-on" : ""
                }`}
                playsInline
                onEnded={() => skipTo(1)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              {currentTrack?.source === "local" && currentTrack.media_type === "audio" && (
                <div className="st-audio-card">
                  <Disc3 className={`w-8 h-8 ${isPlaying ? "st-spin-slow" : ""}`} strokeWidth={2} />
                  <span>{currentTrack.title}</span>
                  <span className="st-audio-card-sub">audio bootleg</span>
                </div>
              )}
            </PolaroidViewfinder>

            <button type="button" className="st-bugle" onClick={() => setShowShare(true)}>
              <span className="st-bugle-tape" aria-hidden />
              <span className="st-bugle-masthead">The Daily Bugle</span>
              <span className="st-bugle-date">Late city final</span>
              <span className="st-bugle-headline">Share this mixtape</span>
              <span className="st-bugle-cols">
                <span>1. Link</span>
                <span>2. QR code</span>
              </span>
              <span className="st-bugle-cta">
                <Copy className="w-3.5 h-3.5" strokeWidth={3} />
                open the sharing menu
              </span>
            </button>

            <button type="button" className="st-liner" onClick={() => setShowTapeEditor(true)}>
              <span className="st-liner-kicker">Hidden tracks</span>
              <span className="st-liner-title">Liner notes</span>
              <span className="st-liner-body">
                {activeTape.liner_notes?.trim() || "Nothing written on the sleeve yet. Tap to add a note."}
              </span>
            </button>
          </section>

          <audio ref={audioRef} onEnded={() => skipTo(1)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
        </div>
      )}

      {stage === "player" && !activeTape && !loading && (
        <div className="st-board">
          <p className="st-board-empty">That tape is not on the board any more.</p>
          <div className="st-rail-actions" style={{ justifyContent: "center" }}>
            <button type="button" className="st-ink-btn" onClick={() => setStage("board")}>
              back to the board
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ the panels */}

      {showSearch && (
        <div className="st-sheet-wrap">
          <button type="button" className="st-scrim" aria-label="Close search" onClick={() => setShowSearch(false)} />
          <div className="st-sheet" role="dialog" aria-label="Search for tunes">
            <div className="st-sheet-head">
              <div>
                <span className="st-kicker">Search for tunes</span>
                <h3 className="st-sheet-title">The whole record shop</h3>
              </div>
              <button type="button" className="st-icon-btn" onClick={() => setShowSearch(false)} aria-label="Close">
                <X className="w-4 h-4" strokeWidth={3} />
              </button>
            </div>

            <label className="st-search-field">
              <Search className="w-4 h-4" strokeWidth={3} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Song, artist, or a pasted YouTube link"
                aria-label="Search for a song"
              />
              {searching && <Loader2 className="w-4 h-4 st-spin" strokeWidth={3} />}
            </label>

            {!apiConfigured && hits.length === 0 && (
              <p className="st-sheet-note">
                Free-text search is switched off until a YouTube API key is set. Paste a YouTube link
                into the box above and it will still resolve.
              </p>
            )}
            {searchNote && hits.length === 0 && <p className="st-sheet-note">{searchNote}</p>}

            <div className="st-hits">
              {hits.map((hit) => (
                <button
                  key={hit.videoId}
                  type="button"
                  className="st-hit"
                  onClick={() => void runAddFromYoutube(hit)}
                >
                  {hit.thumbnail ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={hit.thumbnail} alt="" className="st-hit-thumb" loading="lazy" decoding="async" />
                  ) : (
                    <span className="st-hit-thumb st-hit-thumb-blank" aria-hidden />
                  )}
                  <span className="st-hit-text">
                    <span className="st-hit-title">{hit.title}</span>
                    <span className="st-hit-channel">{hit.channel}</span>
                  </span>
                  <span className="st-hit-time">{formatClock(hit.durationSeconds)}</span>
                  <Plus className="w-4 h-4 shrink-0" strokeWidth={3} />
                </button>
              ))}
              {hits.length === 0 && !searching && query.trim().length >= 2 && !searchNote && (
                <p className="st-sheet-note">Nothing yet.</p>
              )}
              {query.trim().length < 2 && (
                <p className="st-sheet-note">Type at least two letters to start looking.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showShare && shareTape && (
        <div className="st-sheet-wrap">
          <button type="button" className="st-scrim" aria-label="Close sharing" onClick={() => setShowShare(false)} />
          <div className="st-share" role="dialog" aria-label="Share this mixtape">
            <span className="st-bugle-tape st-share-tape" aria-hidden />
            <button type="button" className="st-icon-btn st-share-close" onClick={() => setShowShare(false)} aria-label="Close">
              <X className="w-4 h-4" strokeWidth={3} />
            </button>

            <span className="st-bugle-masthead">The Daily Bugle</span>
            <span className="st-share-rule" aria-hidden />
            <h3 className="st-share-headline">Share this mixtape</h3>
            <p className="st-share-standfirst">
              {shareTape.title} - {trackCounts.get(shareTape.id) ?? 0} tracks, filed by{" "}
              {nameFor(shareTape.created_by)}.
            </p>

            <div className="st-share-body">
              <div className="st-share-col">
                <span className="st-share-num">1. Link</span>
                <code className="st-share-link">{shareUrl}</code>
                <button type="button" className="st-ink-btn" onClick={() => void copyShareLink()}>
                  {copied ? <Check className="w-4 h-4" strokeWidth={3} /> : <Copy className="w-4 h-4" strokeWidth={3} />}
                  {copied ? "copied" : "copy link"}
                </button>
              </div>

              <div className="st-share-col st-share-col-qr">
                <span className="st-share-num">2. QR code</span>
                <VinylQrSticker matrix={qrMatrix} caption="scan to listen" size={192} />
              </div>
            </div>

            <p className="st-share-foot">
              Only the two of you can open it. The link still asks for a sign-in.
            </p>
          </div>
        </div>
      )}

      {showTapeEditor && activeTape && (
        <div className="st-sheet-wrap">
          <button type="button" className="st-scrim" aria-label="Close" onClick={() => setShowTapeEditor(false)} />
          <div className="st-sheet" role="dialog" aria-label="Edit this tape">
            <div className="st-sheet-head">
              <div>
                <span className="st-kicker">Liner notes</span>
                <h3 className="st-sheet-title">About this tape</h3>
              </div>
              <button type="button" className="st-icon-btn" onClick={() => setShowTapeEditor(false)} aria-label="Close">
                <X className="w-4 h-4" strokeWidth={3} />
              </button>
            </div>

            <label className="st-field">
              <span>Title</span>
              <input
                defaultValue={activeTape.title}
                maxLength={44}
                onBlur={(e) => void runSaveTape({ title: e.target.value.trim() || "Untitled Mixtape" })}
              />
            </label>

            <label className="st-field">
              <span>Notes on the sleeve</span>
              <textarea
                rows={5}
                defaultValue={activeTape.liner_notes ?? ""}
                placeholder="What this tape is for, and who it is for."
                onBlur={(e) => void runSaveTape({ liner_notes: e.target.value })}
              />
            </label>

            <div className="st-swatch-row">
              <span className="st-swatch-label">Label</span>
              {Object.entries(TAPE_COLORS).map(([key, value]) => (
                <button
                  key={key}
                  type="button"
                  title={value.name}
                  aria-label={value.name}
                  aria-pressed={activeTape.label_color === key}
                  className={`st-swatch ${activeTape.label_color === key ? "st-swatch-on" : ""}`}
                  style={{ background: value.tape }}
                  onClick={() => void runSaveTape({ label_color: key })}
                />
              ))}
            </div>

            <div className="st-swatch-row">
              <span className="st-swatch-label">Shell</span>
              {Object.entries(SHELL_STYLES).map(([key, value]) => (
                <button
                  key={key}
                  type="button"
                  title={value.name}
                  aria-label={value.name}
                  aria-pressed={activeTape.shell_style === key}
                  className={`st-swatch ${activeTape.shell_style === key ? "st-swatch-on" : ""}`}
                  style={{ background: value.body }}
                  onClick={() => void runSaveTape({ shell_style: key })}
                />
              ))}
            </div>

            <button type="button" className="st-danger-btn" onClick={() => void runDeleteTape(activeTape.id)}>
              <Trash2 className="w-4 h-4" strokeWidth={3} />
              throw this tape away
            </button>
          </div>
        </div>
      )}

      {fileChooser && (
        <div className="st-sheet-wrap">
          <button type="button" className="st-scrim" aria-label="Cancel" onClick={() => setFileChooser(null)} />
          <div className="st-sheet" role="dialog" aria-label="File these bootlegs">
            <div className="st-sheet-head">
              <div>
                <span className="st-kicker">Local files</span>
                <h3 className="st-sheet-title">
                  Which tape do these {fileChooser.length} file{fileChooser.length === 1 ? "" : "s"} go on?
                </h3>
              </div>
              <button type="button" className="st-icon-btn" onClick={() => setFileChooser(null)} aria-label="Close">
                <X className="w-4 h-4" strokeWidth={3} />
              </button>
            </div>

            <div className="st-chooser">
              {tapes.map((tape) => (
                <button key={tape.id} type="button" className="st-chooser-item" onClick={() => void runFileToTape(tape.id)}>
                  <span className="st-chooser-dot" style={{ background: TAPE_COLORS[tape.label_color]?.tape }} />
                  <span>{tape.title}</span>
                  <span className="st-chooser-count">{trackCounts.get(tape.id) ?? 0}</span>
                </button>
              ))}
              <button type="button" className="st-chooser-item st-chooser-new" onClick={() => void runFileToNewTape()}>
                <Plus className="w-4 h-4" strokeWidth={3} />
                start a new tape for them
              </button>
            </div>
          </div>
        </div>
      )}

      {/* the picker itself, hidden behind the envelope */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/*"
        multiple
        className="st-file-input"
        onChange={(e) => {
          void handleFilesPicked(e.target.files);
          e.target.value = "";
        }}
      />
    </main>
  );
}

/* ================================================================== styles
   Kept as one string constant rather than inline in the JSX, the way Chapter 6
   does it. No backticks anywhere inside, including in comments: a stray one
   terminates the template literal and produces a wall of errors far from the
   real line. */

const SOUNDTRACK_CSS = `
.st-root {
  position: relative;
  min-height: 100svh;
  padding: 24px 16px 40px;
  color: #F4EADA;
  overflow-x: hidden;
  background: #4B3524;
}

/* ---------------------------------------------------------------- the board */

.st-cork {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-color: #A9713C;
  background-image:
    radial-gradient(rgba(70, 40, 16, .30) 1.1px, transparent 1.2px),
    radial-gradient(rgba(255, 214, 160, .22) 0.9px, transparent 1px),
    radial-gradient(rgba(52, 28, 10, .18) 2.2px, transparent 2.4px);
  background-size: 9px 9px, 13px 13px, 27px 27px;
  background-position: 0 0, 4px 6px, 11px 3px;
}
.st-cork-marks {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: .16;
  background-image:
    radial-gradient(circle at 12% 18%, rgba(20, 10, 6, .9) 0 2px, transparent 3px),
    repeating-conic-gradient(from 0deg at 50% 50%, rgba(24, 12, 6, .10) 0deg 8deg, transparent 8deg 16deg);
  background-size: 180px 180px, 420px 420px;
}
.st-lamp {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at 50% -10%, rgba(255, 226, 174, .34), transparent 62%),
    radial-gradient(ellipse at 50% 120%, rgba(20, 10, 6, .55), transparent 60%);
}

/* every object on the board wears the same die-cut sticker edge */
.st-object {
  position: relative;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  transition: transform .22s cubic-bezier(.34, 1.4, .64, 1);
}
.st-object:hover { transform: translateY(-5px) rotate(0deg) scale(1.02); }
.st-object:active { transform: translateY(-1px) scale(.99); }
.st-object:focus-visible { outline: 3px solid #FFD86B; outline-offset: 6px; }

.st-object-caption {
  display: block;
  margin: 8px auto 0;
  width: fit-content;
  padding: 3px 10px;
  background: #FBF6EC;
  color: #201319;
  border: 2px solid #201319;
  box-shadow: 3px 3px 0 rgba(16, 8, 10, .6);
  font-family: 'Caveat', cursive;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.1;
  transform: rotate(-2deg);
}

.st-board {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
}
.st-board-head { text-align: center; margin-bottom: 18px; }
.st-kicker {
  display: inline-block;
  font-family: 'Space Grotesk', monospace;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .24em;
  text-transform: uppercase;
  color: #FFD9A0;
}
.st-board-title {
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(34px, 6vw, 62px);
  line-height: .98;
  color: #FFF6E6;
  text-shadow: 4px 5px 0 rgba(24, 10, 6, .6);
}
.st-board-sub {
  font-family: 'Caveat', cursive;
  font-size: 22px;
  color: #FFE7C6;
  margin-top: 2px;
}

.st-board-field {
  position: relative;
  display: grid;
  gap: 26px;
  grid-template-columns: 1fr;
  grid-template-areas: 'stack' 'create' 'envelope' 'share';
  justify-items: center;
  padding: 18px 4px 48px;
}
@media (min-width: 900px) {
  .st-board-field {
    /* The right-hand padding is the gutter the two ticket stubs live in, so an
       absolutely positioned exit can never land on top of another object. */
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) minmax(0, .95fr);
    grid-template-areas:
      'stack create   share'
      'stack envelope share';
    grid-template-rows: auto auto;
    align-items: start;
    padding: 34px 176px 60px 4px;
  }
}
.st-stack { grid-area: stack; }
.st-create { grid-area: create; }
.st-envelope-btn { grid-area: envelope; }
.st-share-btn { grid-area: share; }

.st-stack { position: relative; width: min(330px, 86vw); padding-bottom: 30px; }
.st-stack-item {
  display: block;
  width: 100%;
  /* percentage margins resolve against the container WIDTH, so this scales
     with the tape instead of being a fixed pixel bite out of a fluid box */
  margin-top: -42%;
  transform: rotate(var(--rot, 0deg));
  z-index: calc(var(--i) + 1);
}
/* the buried tapes only need their label read, so the caption is hidden until
   the tape is lifted */
.st-stack-item .st-object-caption { opacity: 0; transition: opacity .18s ease-out; }
.st-stack-item:hover .st-object-caption,
.st-stack-item:focus-visible .st-object-caption,
.st-stack-item:last-of-type .st-object-caption { opacity: 1; }
.st-stack-item:first-of-type { margin-top: 0; }
.st-stack-item:hover { z-index: 40; }
.st-stack-caption {
  display: block;
  width: fit-content;
  margin: 14px auto 0;
  padding: 3px 12px;
  background: #FBF6EC;
  color: #201319;
  border: 2px solid #201319;
  box-shadow: 3px 3px 0 rgba(16, 8, 10, .6);
  font-family: 'Caveat', cursive;
  font-size: 21px;
  font-weight: 700;
  transform: rotate(-2deg);
}

.st-create { width: min(330px, 86vw); }
.st-create .st-pin {
  position: absolute;
  top: -16px;
  left: 50%;
  width: 34px;
  transform: translateX(-50%);
  z-index: 5;
  filter: drop-shadow(2px 4px 4px rgba(0, 0, 0, .5));
}
.st-envelope-btn { width: min(260px, 72vw); }
.st-share-btn { width: fit-content; }

.st-exit { position: absolute; }
.st-exit-top { top: 0; right: 4px; }
.st-exit-bottom { bottom: 8px; right: 10px; }
@media (max-width: 899px) {
  .st-exit-top { position: static; margin: 0 auto; display: block; }
  .st-exit-bottom { display: none; }
}
.st-exit-deck { position: static; margin: 18px auto 0; display: block; }

.st-board-empty {
  text-align: center;
  font-family: 'Caveat', cursive;
  font-size: 22px;
  color: #FFE7C6;
  padding-bottom: 30px;
}

/* ------------------------------------------------------------- the cassette */

.st-cassette { position: relative; container-type: inline-size; filter: ${STICKER_EDGE}; }
.st-cassette-label {
  position: absolute;
  left: 9%;
  right: 9%;
  top: 11%;
  height: 21%;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border: 2px solid rgba(40, 26, 18, .55);
  box-shadow: 0 3px 8px rgba(0, 0, 0, .32);
  overflow: hidden;
}
.st-cassette-label::before,
.st-cassette-label::after {
  content: '';
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 3px;
  background: repeating-linear-gradient(180deg, rgba(255,255,255,.5) 0 3px, transparent 3px 6px);
}
.st-cassette-label::before { left: 0; }
.st-cassette-label::after { right: 0; }
.st-cassette-title {
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(12px, 4.4cqw, 19px);
  line-height: 1.05;
  letter-spacing: .01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.st-owner-tag {
  position: absolute;
  right: -10px;
  bottom: 14%;
  padding: 2px 9px;
  background: #FBF6EC;
  color: #201319;
  border: 2px solid #201319;
  box-shadow: 3px 3px 0 rgba(16, 8, 10, .5);
  font-family: 'Space Grotesk', monospace;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: .1em;
  transform: rotate(-4deg);
}

@keyframes st-reel-turn { to { transform: rotate(360deg); } }
.st-reel { animation: st-reel-turn 2.6s linear infinite; will-change: transform; }

/* ------------------------------------------------------------ the ticket */

.st-ticket {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  gap: 8px;
  padding: 10px 16px 10px 22px;
  background:
    repeating-linear-gradient(90deg, rgba(120, 84, 40, .07) 0 6px, transparent 6px 12px),
    #EFE2C6;
  color: #2A1C10;
  border: 2px solid #6E5632;
  box-shadow: 4px 6px 0 rgba(20, 10, 6, .55);
  transform: rotate(-3deg);
  filter: ${STICKER_EDGE};
  /* the torn left edge */
  clip-path: polygon(
    3% 0%, 100% 0%, 100% 100%, 3% 100%,
    0% 92%, 3% 84%, 0% 76%, 3% 68%, 0% 60%, 3% 52%,
    0% 44%, 3% 36%, 0% 28%, 3% 20%, 0% 12%, 3% 4%
  );
}
.st-ticket-perf {
  position: absolute;
  left: 16px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: repeating-linear-gradient(180deg, rgba(110, 86, 50, .8) 0 4px, transparent 4px 8px);
}
.st-ticket-body { display: flex; flex-direction: column; text-align: left; }
.st-ticket-kicker {
  font-family: 'Space Grotesk', monospace;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .26em;
  text-transform: uppercase;
  color: #8A6B3C;
}
.st-ticket-primary {
  font-family: 'Permanent Marker', cursive;
  font-size: 22px;
  line-height: 1.05;
}
.st-ticket-secondary {
  font-family: 'Caveat', cursive;
  font-size: 16px;
  color: #5A452A;
}
.st-ticket-serial {
  align-self: center;
  font-family: 'Space Grotesk', monospace;
  font-size: 8px;
  letter-spacing: .18em;
  color: #8A6B3C;
  writing-mode: vertical-rl;
}

/* ----------------------------------------------------------- the envelope */

.st-envelope { position: relative; display: block; filter: ${STICKER_EDGE}; }
.st-envelope-caption {
  position: absolute;
  left: 50%;
  bottom: 16%;
  transform: translateX(-50%) rotate(-2deg);
  font-family: 'Caveat', cursive;
  font-size: 26px;
  font-weight: 700;
  color: #3B2A14;
}

/* ---------------------------------------------------------- the QR vinyl */

.st-qr-vinyl {
  position: relative;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 34%, #2C2C31, #0C0C0F 62%, #17171B);
  filter: ${STICKER_EDGE};
}
.st-qr-vinyl-grooves {
  position: absolute;
  inset: 6%;
  border-radius: 50%;
  background: repeating-radial-gradient(circle, rgba(255,255,255,.08) 0 1px, transparent 1px 4px);
  pointer-events: none;
}
.st-qr-plate {
  width: 51%;
  height: 51%;
  background: #FFFFFF;
  border: 2px solid #100B0D;
  display: grid;
  place-items: center;
  padding: 3px;
}
.st-qr-empty {
  font-family: 'Space Grotesk', monospace;
  font-size: 9px;
  font-weight: 900;
  color: #6A6A6A;
  text-transform: uppercase;
}
.st-qr-arc {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  font-family: 'Space Grotesk', monospace;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: #F6EEDC;
}
.st-qr-arc-top { top: 8.5%; }
.st-qr-arc-bottom { bottom: 8.5%; color: #C7343F; }

/* ------------------------------------------------------------ fresh tape */

.st-scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  border: 0;
  padding: 0;
  background: rgba(12, 7, 5, .72);
  backdrop-filter: blur(5px);
  cursor: pointer;
}
.st-create-stage, .st-drop-stage { position: fixed; inset: 0; z-index: 45; display: grid; place-items: center; }

.st-fresh {
  position: relative;
  z-index: 50;
  width: min(560px, 92vw);
  display: grid;
  gap: 18px;
  justify-items: center;
  transform: translateY(28px) scale(.72);
  opacity: 0;
  transition: transform .5s cubic-bezier(.22, .95, .3, 1), opacity .35s ease-out;
}
.st-fresh-taped, .st-fresh-opening { transform: translateY(0) scale(1); opacity: 1; }
.st-fresh-tape { position: relative; width: 100%; }

.st-fresh-tapelabel {
  position: absolute;
  left: 7%;
  right: 7%;
  top: 9%;
  height: 24%;
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: #EFE4C4;
  border: 2px solid rgba(60, 44, 24, .5);
  box-shadow: 0 4px 12px rgba(0, 0, 0, .4);
  transform: rotate(-8deg) scale(1.9);
  opacity: 0;
  transition: transform .28s cubic-bezier(.2, 1.7, .4, 1), opacity .2s ease-out;
}
.st-fresh-taped .st-fresh-tapelabel,
.st-fresh-opening .st-fresh-tapelabel { transform: rotate(-1deg) scale(1); opacity: 1; }

.st-fresh-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(15px, 3.6vw, 24px);
  color: #241A10;
}
.st-fresh-input::placeholder { color: rgba(36, 26, 16, .35); }
.st-mirror {
  position: absolute;
  left: 12px;
  visibility: hidden;
  white-space: pre;
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(15px, 3.6vw, 24px);
  pointer-events: none;
}
.st-fresh-pen {
  position: absolute;
  left: 12px;
  top: -34px;
  width: 26px;
  height: 40px;
  transform: translateX(var(--pen-x, 0px)) rotate(24deg);
  transition: transform .09s linear;
  pointer-events: none;
  filter: drop-shadow(2px 4px 3px rgba(0, 0, 0, .5));
}

.st-panel {
  position: absolute;
  top: 6%;
  bottom: 6%;
  width: 46%;
  /* clear plastic, not frosted: enough of a sheen to read as a case lid
     without greying out the label underneath */
  background: linear-gradient(118deg, rgba(255, 255, 255, .34) 0%, rgba(238, 244, 248, .12) 38%,
    rgba(255, 255, 255, .30) 62%, rgba(214, 222, 228, .16) 100%);
  border: 2px solid rgba(40, 30, 26, .28);
  box-shadow: inset 0 0 18px rgba(255, 255, 255, .35);
  transform-origin: center left;
  transition: transform .55s cubic-bezier(.2, .9, .3, 1), opacity .4s ease-out;
  pointer-events: none;
}
.st-panel-left { left: 2%; transform-origin: center right; }
.st-panel-right { right: 2%; }
.st-fresh-opening .st-panel-left { transform: perspective(900px) rotateY(-96deg); opacity: .25; }
.st-fresh-opening .st-panel-right { transform: perspective(900px) rotateY(96deg); opacity: .25; }

.st-fresh-tracklist {
  position: absolute;
  inset: 38% 13% 9%;
  display: grid;
  align-content: center;
  gap: 11px;
  padding: 14px 16px;
  background-color: #FBF5E7;
  background-image: radial-gradient(rgba(60, 35, 30, .08) .8px, transparent .9px);
  background-size: 7px 7px;
  border: 2px solid rgba(40, 30, 26, .5);
  box-shadow: 0 6px 16px rgba(0, 0, 0, .35);
  opacity: 0;
  transform: scale(.94);
  transition: opacity .4s ease-out .25s, transform .4s cubic-bezier(.2, 1.3, .4, 1) .25s;
  pointer-events: none;
}
.st-fresh-opening .st-fresh-tracklist { opacity: 1; transform: scale(1); }
.st-fresh-line { height: 7px; border-radius: 4px; background: rgba(28, 19, 23, .22); }
.st-fresh-line:nth-child(2) { width: 78%; }
.st-fresh-line:nth-child(3) { width: 62%; }
.st-fresh-line:nth-child(4) { width: 84%; }

.st-fresh-controls {
  width: 100%;
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  background: #F7F1E6;
  color: #201319;
  border: 3px solid #201319;
  box-shadow: 8px 9px 0 rgba(12, 7, 5, .6);
  transform: rotate(-.8deg);
}
.st-fresh-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px; }

.st-swatch-row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.st-swatch-label {
  font-family: 'Space Grotesk', monospace;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .2em;
  text-transform: uppercase;
  color: #6B4A2E;
  width: 46px;
}
.st-swatch {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid #201319;
  box-shadow: 2px 2px 0 rgba(16, 8, 10, .5);
  cursor: pointer;
  transition: transform .16s ease-out;
}
.st-swatch:hover { transform: scale(1.12); }
.st-swatch-on { outline: 3px solid #C7343F; outline-offset: 2px; }

/* --------------------------------------------------------- boombox drop */

.st-drop-stage { background: rgba(12, 7, 5, .82); backdrop-filter: blur(6px); }
.st-drop-frame { position: relative; width: min(760px, 92vw); }
.st-boombox { position: relative; filter: ${STICKER_EDGE}; animation: st-bb-in .6s cubic-bezier(.2, .95, .3, 1) both; }
@keyframes st-bb-in {
  from { transform: scale(.82) translateY(26px); opacity: 0; }
  to   { transform: scale(1) translateY(0); opacity: 1; }
}
.st-boombox-deck {
  position: absolute;
  left: 36.5%;
  top: 40%;
  width: 27%;
  height: 40%;
  overflow: hidden;
  border: 3px solid #23252A;
  border-radius: 4px;
  background: #101114;
}
.st-drop-tape {
  position: absolute;
  left: 6%;
  right: 6%;
  top: 12%;
  animation: st-tape-in 1.05s cubic-bezier(.3, .9, .35, 1) .35s both;
}
@keyframes st-tape-in {
  0%   { transform: translateY(-190%) scale(1.55); opacity: 0; }
  32%  { opacity: 1; }
  70%  { transform: translateY(0) scale(1); }
  82%  { transform: translateY(4%) scale(1); }
  100% { transform: translateY(0) scale(1); }
}
.st-drop-door {
  position: absolute;
  inset: 0;
  background: linear-gradient(160deg, rgba(190, 196, 204, .95), rgba(120, 126, 134, .95));
  border: 3px solid #23252A;
  transform-origin: bottom center;
  animation: st-door 1.7s cubic-bezier(.3, .9, .35, 1) both;
}
@keyframes st-door {
  0%, 62% { transform: perspective(700px) rotateX(-88deg); }
  84%     { transform: perspective(700px) rotateX(6deg); }
  100%    { transform: perspective(700px) rotateX(0deg); }
}
.st-clack {
  position: absolute;
  right: 6%;
  top: 34%;
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(20px, 4vw, 40px);
  color: #FFF6E6;
  text-shadow: 3px 4px 0 rgba(20, 10, 6, .7);
  animation: st-clack 1.1s ease-out 1.05s both;
  pointer-events: none;
}
@keyframes st-clack {
  0%   { transform: scale(.3) rotate(-16deg); opacity: 0; }
  30%  { transform: scale(1.18) rotate(-8deg); opacity: 1; }
  55%  { transform: scale(1) rotate(-8deg); opacity: 1; }
  100% { transform: scale(1.05) rotate(-6deg); opacity: 0; }
}

/* ------------------------------------------------------------- the player */

.st-player {
  position: relative;
  z-index: 1;
  max-width: 1380px;
  margin: 0 auto;
  display: grid;
  gap: 22px;
  grid-template-columns: 1fr;
}
@media (min-width: 1080px) {
  .st-player {
    grid-template-columns: minmax(0, 330px) minmax(0, 1fr) minmax(0, 320px);
    align-items: start;
  }
}

.st-rail { display: grid; gap: 16px; align-content: start; }
.st-rail-head {
  background: #F7F1E6;
  color: #201319;
  border: 3px solid #201319;
  box-shadow: 7px 8px 0 rgba(12, 7, 5, .6);
  padding: 12px 14px;
  transform: rotate(-1deg);
}
.st-rail-title { font-family: 'Permanent Marker', cursive; font-size: 26px; line-height: 1.05; }
.st-rail-sub { font-family: 'Caveat', cursive; font-size: 18px; color: #5A452A; }
.st-rail-head .st-kicker { color: #A03A44; }

.st-tracklist { display: grid; gap: 14px; }
.st-empty-card {
  padding: 16px;
  background: #FBF6EC;
  color: #4A382A;
  border: 2px dashed #9A7A50;
  font-family: 'Caveat', cursive;
  font-size: 20px;
  text-align: center;
}

.st-track {
  position: relative;
  padding: 22px 12px 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .55), rgba(226, 230, 234, .38)),
    #E4E8EC;
  color: #1D1418;
  border: 3px solid #FFFFFF;
  border-radius: 8px;
  box-shadow: 5px 7px 0 rgba(12, 7, 5, .55);
  transform: rotate(var(--rot, 0deg));
  transition: transform .2s cubic-bezier(.34, 1.4, .64, 1), box-shadow .2s ease-out;
  z-index: 1;
}
.st-track:hover { transform: rotate(0deg) translateY(-3px); box-shadow: 7px 10px 0 rgba(12, 7, 5, .55); }
.st-track-on { box-shadow: 0 0 0 3px #C7343F, 6px 9px 0 rgba(12, 7, 5, .55); }
.st-track-tape {
  position: absolute;
  top: -11px;
  left: 26px;
  width: 76px;
  height: 22px;
  transform: rotate(-6deg);
  box-shadow: 0 3px 8px rgba(0, 0, 0, .4);
}
.st-track-tape-0 { background: #6E86B8; border-left: 3px dashed rgba(255,255,255,.7); border-right: 3px dashed rgba(255,255,255,.7); }
.st-track-tape-1 { background: #C98F9C; border-left: 3px dashed rgba(255,255,255,.7); border-right: 3px dashed rgba(255,255,255,.7); }
.st-track-tape-2 { background: #B59350; border-left: 3px dashed rgba(255,255,255,.7); border-right: 3px dashed rgba(255,255,255,.7); }

.st-track-main {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  background: #FBF6EC;
  border: 2px solid #2A1F17;
  padding: 8px 10px;
  cursor: pointer;
  box-shadow: 3px 3px 0 rgba(16, 8, 10, .35);
}
.st-track-main:hover { background: #FFFDF7; }
.st-track-num {
  font-family: 'Space Grotesk', monospace;
  font-size: 11px;
  font-weight: 900;
  color: #A03A44;
}
.st-track-text { flex: 1; min-width: 0; display: grid; }
.st-track-title {
  font-family: 'Permanent Marker', cursive;
  font-size: 15px;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st-track-artist {
  font-family: 'Caveat', cursive;
  font-size: 16px;
  color: #5A452A;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st-track-time { font-family: 'Space Grotesk', monospace; font-size: 10px; font-weight: 900; color: #6B4A2E; }

.st-track-menu-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  padding: 4px 10px;
  background: #FBF6EC;
  color: #201319;
  border: 2px solid #201319;
  box-shadow: 2px 2px 0 rgba(16, 8, 10, .45);
  font-family: 'Space Grotesk', monospace;
  font-size: 10px;
  font-weight: 900;
  text-transform: lowercase;
  cursor: pointer;
}
.st-track-menu-btn:active { transform: translate(2px, 2px); box-shadow: none; }

.st-track-menu-open { z-index: 30; }
.st-track-menu {
  position: absolute;
  right: 8px;
  top: calc(100% - 10px);
  z-index: 30;
  display: grid;
  min-width: 148px;
  background: #FBF6EC;
  border: 3px solid #201319;
  box-shadow: 5px 6px 0 rgba(12, 7, 5, .6);
}
.st-track-menu button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 11px;
  background: none;
  border: 0;
  border-bottom: 1px dashed rgba(32, 19, 25, .3);
  font-family: 'Space Grotesk', monospace;
  font-size: 11px;
  font-weight: 800;
  color: #201319;
  text-align: left;
  cursor: pointer;
}
.st-track-menu button:last-child { border-bottom: 0; }
.st-track-menu button:hover:not(:disabled) { background: #F0E6D2; }
.st-track-menu button:disabled { opacity: .38; cursor: not-allowed; }
.st-track-menu-bad { color: #A61B27 !important; background: #F7DADD !important; }

.st-track-added {
  position: absolute;
  right: 10px;
  top: 7px;
  font-family: 'Space Grotesk', monospace;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: #A03A44;
}

.st-rail-actions { display: flex; gap: 10px; flex-wrap: wrap; }

/* ------------------------------------------------------------- the deck */

.st-deck { display: grid; gap: 16px; align-content: start; }

.st-search-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: #F0E7D3;
  color: #241A10;
  border: 3px solid #201319;
  box-shadow: 7px 8px 0 rgba(12, 7, 5, .6);
  transform: rotate(-.6deg);
  cursor: pointer;
  text-align: left;
}
.st-search-strip:hover { background: #F8F1E2; }
.st-search-strip-label { font-family: 'Permanent Marker', cursive; font-size: clamp(16px, 2.6vw, 24px); }
.st-search-strip-sub { font-family: 'Caveat', cursive; font-size: 18px; color: #6B4A2E; }
.st-api-badge {
  margin-left: auto;
  padding: 3px 10px;
  background: #2C4A86;
  color: #F4F7FF;
  border: 2px solid #FFFFFF;
  box-shadow: 3px 3px 0 rgba(12, 7, 5, .5);
  font-family: 'Space Grotesk', monospace;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .12em;
  transform: rotate(6deg);
}

.st-deck-plate {
  position: relative;
  padding: 22px 20px 20px;
  background-color: #F5EEE0;
  background-image:
    radial-gradient(rgba(60, 35, 30, .07) .8px, transparent .9px),
    linear-gradient(to right, rgba(0, 0, 0, .02) 1px, transparent 1px);
  background-size: 8px 8px, 24px 24px;
  color: #201319;
  border: 4px solid #FFFFFF;
  border-radius: 18px;
  box-shadow: 10px 12px 0 rgba(12, 7, 5, .6);
}

.st-deck-record { position: relative; width: min(430px, 78vw); margin: 0 auto; aspect-ratio: 1; }

.st-vinyl { position: absolute; inset: 0; display: grid; place-items: center; }
.st-vinyl-disc {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle at 36% 30%, #8E1B24, #4A0910 58%, #2A050A);
  box-shadow: inset 0 0 40px rgba(0, 0, 0, .7), 0 12px 26px rgba(0, 0, 0, .5);
}
.st-vinyl-grooves {
  position: absolute;
  inset: 4%;
  border-radius: 50%;
  background: repeating-radial-gradient(circle, rgba(255, 255, 255, .07) 0 1px, transparent 1px 5px);
}
.st-vinyl-sheen {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(from 210deg, transparent 0deg, rgba(255, 255, 255, .16) 22deg, transparent 60deg,
    transparent 180deg, rgba(255, 255, 255, .12) 208deg, transparent 250deg);
}
@keyframes st-spin-turn { to { transform: rotate(360deg); } }
.st-vinyl-spin .st-vinyl-disc { animation: st-spin-turn 2.2s linear infinite; will-change: transform; }

.st-vinyl-label {
  position: relative;
  z-index: 2;
  width: 40%;
  aspect-ratio: 1;
  border-radius: 50%;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 2px;
  padding: 10px;
  text-align: center;
  border: 3px solid rgba(32, 19, 25, .5);
  box-shadow: inset 0 0 18px rgba(0, 0, 0, .18);
}
.st-vinyl-label-title {
  font-family: 'Permanent Marker', cursive;
  font-size: clamp(11px, 2.4vw, 17px);
  line-height: 1.05;
  max-width: 92%;
}
.st-vinyl-label-sub {
  font-family: 'Caveat', cursive;
  font-size: clamp(11px, 1.8vw, 15px);
  line-height: 1.1;
  max-width: 92%;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  opacity: .82;
}
.st-vinyl-spindle {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #1B1216;
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, .35);
}

.st-tonearm {
  position: absolute;
  /* the pivot sits ON the deck plate, not floating off its corner */
  right: -4%;
  top: -2%;
  width: 46%;
  transform-origin: 78% 17%;
  transform: rotate(-16deg);
  transition: transform .7s cubic-bezier(.3, .9, .35, 1);
  filter: drop-shadow(3px 6px 6px rgba(0, 0, 0, .45));
  pointer-events: none;
}
.st-tonearm-down { transform: rotate(0deg); }

/* the woven seek thread */
.st-seek-wrap { display: flex; align-items: center; gap: 10px; margin-top: 18px; }
.st-seek-time {
  font-family: 'Space Grotesk', monospace;
  font-size: 10px;
  font-weight: 900;
  color: #6B4A2E;
  min-width: 38px;
  text-align: center;
}
.st-seek {
  position: relative;
  flex: 1;
  height: 26px;
  display: grid;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}
.st-seek:focus-visible { outline: 3px solid #C7343F; outline-offset: 4px; }
.st-seek-thread {
  position: absolute;
  left: 0;
  right: 0;
  height: 7px;
  border-radius: 4px;
  background:
    repeating-linear-gradient(58deg, #C7343F 0 5px, #FBF6EC 5px 10px);
  box-shadow: inset 0 0 0 1px rgba(40, 24, 16, .35), 0 1px 3px rgba(0, 0, 0, .35);
  opacity: .55;
}
.st-seek-done {
  position: absolute;
  left: 0;
  right: 0;
  height: 7px;
  border-radius: 4px;
  background: repeating-linear-gradient(58deg, #A6121D 0 5px, #FFFFFF 5px 10px);
  box-shadow: 0 0 10px rgba(199, 52, 63, .55);
  transform: scaleX(var(--st-progress, 0));
  transform-origin: left center;
}
.st-seek-bead {
  position: absolute;
  left: 0;
  width: 26px;
  height: 20px;
  margin-left: -13px;
  transform: translateX(calc(var(--st-progress, 0) * var(--st-track-w, 0) * 1px));
  filter: drop-shadow(0 0 6px rgba(199, 52, 63, .8));
  pointer-events: none;
}
@keyframes st-seek-ping {
  0%   { box-shadow: 0 0 0 0 rgba(199, 52, 63, .55); }
  100% { box-shadow: 0 0 0 22px rgba(199, 52, 63, 0); }
}
.st-seek-ping .st-seek-bead { animation: st-seek-ping .5s ease-out; border-radius: 50%; }

/* neomorphic rubber buttons */
.st-controls { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 16px; flex-wrap: wrap; }
.st-neo {
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #3B2A22;
  background: linear-gradient(145deg, #FDFAF3, #DCD2C0);
  border: 3px solid #FFFFFF;
  box-shadow: 4px 5px 0 rgba(12, 7, 5, .45), inset 2px 2px 4px rgba(255, 255, 255, .9),
    inset -3px -3px 6px rgba(120, 100, 78, .38);
  cursor: pointer;
  transition: transform .16s cubic-bezier(.34, 1.4, .64, 1), box-shadow .16s ease-out, color .16s ease-out;
}
.st-neo-sm { width: 52px; height: 52px; }
.st-neo-lg { width: 74px; height: 74px; }
.st-neo:hover {
  transform: translateY(-3px);
  box-shadow: 6px 8px 0 rgba(12, 7, 5, .45), inset 2px 2px 4px rgba(255, 255, 255, .9),
    inset -3px -3px 6px rgba(120, 100, 78, .38);
}
.st-neo:active { transform: translateY(1px); box-shadow: 2px 2px 0 rgba(12, 7, 5, .45); }
.st-neo-primary:hover {
  color: #A6121D;
  box-shadow: 6px 8px 0 rgba(12, 7, 5, .45), 0 0 20px 4px rgba(199, 52, 63, .55),
    inset 2px 2px 4px rgba(255, 255, 255, .9), inset -3px -3px 6px rgba(120, 100, 78, .38);
}
@keyframes st-icon-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.14); }
}
.st-neo-primary:hover svg { animation: st-icon-pulse 1s ease-in-out infinite; }
.st-neo-live { color: #A6121D; box-shadow: 4px 5px 0 rgba(12, 7, 5, .45), 0 0 16px 3px rgba(199, 52, 63, .45); }

.st-volume {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #EAE0CB;
  color: #3B2A22;
  border: 3px solid #FFFFFF;
  border-radius: 999px;
  box-shadow: 4px 5px 0 rgba(12, 7, 5, .45);
}
.st-volume input { width: 96px; accent-color: #C7343F; cursor: pointer; }

.st-now-playing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 12px;
  font-family: 'Space Grotesk', monospace;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: #6B4A2E;
}

/* -------------------------------------------------------- the viewfinder */

.st-viewfinder {
  position: relative;
  padding: 12px 12px 30px;
  background: #FCFAF7;
  border: 3px solid #FFFFFF;
  border-radius: 3px;
  box-shadow: 7px 9px 0 rgba(12, 7, 5, .6);
  transform: rotate(1.4deg);
}
.st-viewfinder-tape {
  position: absolute;
  top: -12px;
  left: 50%;
  width: 84px;
  height: 24px;
  transform: translateX(-50%) rotate(-4deg);
  background: #B59350;
  border-left: 3px dashed rgba(255, 255, 255, .75);
  border-right: 3px dashed rgba(255, 255, 255, .75);
  box-shadow: 0 3px 8px rgba(0, 0, 0, .45);
}
.st-viewfinder-window {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: #0D0B0F;
  border: 2px solid #201319;
}
.st-viewfinder-static { position: absolute; inset: 0; display: grid; place-items: center; }
.st-viewfinder-noise {
  position: absolute;
  inset: 0;
  opacity: .3;
  background-image:
    repeating-linear-gradient(0deg, rgba(255,255,255,.12) 0 1px, transparent 1px 3px),
    radial-gradient(rgba(255,255,255,.18) .7px, transparent .8px);
  background-size: auto, 4px 4px;
}
.st-viewfinder-nosignal {
  position: relative;
  font-family: 'Space Grotesk', monospace;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .24em;
  color: rgba(246, 238, 220, .6);
}
.st-viewfinder-rec {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #C7343F;
  box-shadow: 0 0 10px 3px rgba(199, 52, 63, .7);
  animation: st-rec 1.6s ease-in-out infinite;
}
@keyframes st-rec { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.st-viewfinder-caption {
  margin-top: 8px;
  text-align: center;
  font-family: 'Caveat', cursive;
  font-size: 20px;
  color: #3B2A22;
}

.st-yt, .st-local-video { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; pointer-events: none; }
.st-yt-on, .st-local-on { opacity: 1; pointer-events: auto; }
.st-yt-host { width: 100%; height: 100%; }
.st-yt-host iframe { width: 100%; height: 100%; border: 0; }
.st-local-video { object-fit: contain; background: #0D0B0F; }
.st-audio-card {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 4px;
  padding: 12px;
  text-align: center;
  color: #F6EEDC;
  background: radial-gradient(circle at 50% 40%, rgba(199, 52, 63, .28), transparent 65%), #0D0B0F;
  font-family: 'Caveat', cursive;
  font-size: 19px;
}
.st-audio-card-sub {
  font-family: 'Space Grotesk', monospace;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .2em;
  text-transform: uppercase;
  opacity: .65;
}

/* ---------------------------------------------------------- the newspaper */

.st-bugle, .st-liner {
  position: relative;
  display: grid;
  gap: 3px;
  padding: 16px 14px 14px;
  text-align: left;
  color: #241C14;
  background-color: #EFE8D6;
  background-image: radial-gradient(rgba(60, 40, 26, .10) .7px, transparent .8px);
  background-size: 5px 5px;
  border: 3px solid #FFFFFF;
  box-shadow: 7px 9px 0 rgba(12, 7, 5, .6);
  cursor: pointer;
  transform: rotate(-1.1deg);
  transition: transform .2s cubic-bezier(.34, 1.4, .64, 1);
}
.st-bugle:hover, .st-liner:hover { transform: rotate(0deg) translateY(-3px); }
.st-bugle-tape {
  position: absolute;
  top: -12px;
  left: 18px;
  width: 78px;
  height: 24px;
  transform: rotate(-8deg);
  background: #6E86B8;
  border-left: 3px dashed rgba(255, 255, 255, .75);
  border-right: 3px dashed rgba(255, 255, 255, .75);
  box-shadow: 0 3px 8px rgba(0, 0, 0, .45);
}
.st-bugle-masthead {
  font-family: 'Permanent Marker', cursive;
  font-size: 22px;
  letter-spacing: .01em;
  text-align: center;
  border-bottom: 3px solid #241C14;
  padding-bottom: 3px;
}
.st-bugle-date {
  font-family: 'Space Grotesk', monospace;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .2em;
  text-transform: uppercase;
  text-align: center;
  color: #6B5A44;
}
.st-bugle-headline {
  font-family: 'Space Grotesk', monospace;
  font-size: 19px;
  font-weight: 900;
  line-height: 1.05;
  text-transform: uppercase;
  margin-top: 6px;
}
.st-bugle-cols {
  display: flex;
  gap: 14px;
  font-family: 'Space Grotesk', monospace;
  font-size: 11px;
  font-weight: 800;
  color: #4A3A2A;
  margin-top: 4px;
}
.st-bugle-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-family: 'Caveat', cursive;
  font-size: 19px;
  color: #A03A44;
}

.st-liner { transform: rotate(1.2deg); background-color: #F7F1E6; }
.st-liner-kicker {
  font-family: 'Space Grotesk', monospace;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .22em;
  text-transform: uppercase;
  color: #A03A44;
}
.st-liner-title { font-family: 'Permanent Marker', cursive; font-size: 21px; }
.st-liner-body { font-family: 'Caveat', cursive; font-size: 19px; color: #4A3A2A; line-height: 1.25; }

/* ------------------------------------------------------------ the sheets */

.st-sheet-wrap { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; }
.st-sheet {
  position: relative;
  z-index: 62;
  width: min(620px, 94vw);
  max-height: min(84svh, 760px);
  overflow-y: auto;
  display: grid;
  gap: 14px;
  padding: 18px;
  background-color: #F7F1E6;
  background-image: radial-gradient(rgba(60, 35, 30, .07) .8px, transparent .9px);
  background-size: 8px 8px;
  color: #201319;
  border: 4px solid #FFFFFF;
  border-radius: 10px;
  box-shadow: 12px 14px 0 rgba(8, 5, 4, .68);
  animation: st-sheet-in .3s cubic-bezier(.2, 1.3, .4, 1) both;
}
@keyframes st-sheet-in {
  from { transform: translateY(16px) scale(.97); opacity: 0; }
  to   { transform: translateY(0) scale(1); opacity: 1; }
}
.st-sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.st-sheet-title { font-family: 'Permanent Marker', cursive; font-size: 25px; line-height: 1.05; }
.st-sheet .st-kicker { color: #A03A44; }
.st-sheet-note {
  font-family: 'Caveat', cursive;
  font-size: 19px;
  color: #5A452A;
  padding: 8px 10px;
  background: #EFE4C4;
  border: 2px dashed #9A7A50;
}

.st-search-field {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  background: #FBF6EC;
  border: 3px solid #201319;
  box-shadow: 4px 4px 0 rgba(16, 8, 10, .45);
}
.st-search-field input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  font-family: 'Space Grotesk', monospace;
  font-size: 14px;
  color: #201319;
}

.st-hits { display: grid; gap: 8px; }
.st-hit {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  text-align: left;
  background: #FBF6EC;
  border: 2px solid #2A1F17;
  box-shadow: 3px 3px 0 rgba(16, 8, 10, .35);
  cursor: pointer;
}
.st-hit:hover { background: #FFFDF7; transform: translateX(2px); }
.st-hit-thumb { width: 76px; height: 44px; object-fit: cover; border: 2px solid #2A1F17; flex-shrink: 0; }
.st-hit-thumb-blank { background: #D6C7AC; display: block; }
.st-hit-text { flex: 1; min-width: 0; display: grid; }
.st-hit-title {
  font-family: 'Space Grotesk', monospace;
  font-size: 13px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st-hit-channel { font-family: 'Caveat', cursive; font-size: 17px; color: #5A452A; }
.st-hit-time { font-family: 'Space Grotesk', monospace; font-size: 10px; font-weight: 900; color: #6B4A2E; }

.st-field { display: grid; gap: 5px; }
.st-field span {
  font-family: 'Space Grotesk', monospace;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .2em;
  text-transform: uppercase;
  color: #6B4A2E;
}
.st-field input, .st-field textarea {
  width: 100%;
  padding: 9px 11px;
  background: #FBF6EC;
  color: #201319;
  border: 3px solid #201319;
  box-shadow: 3px 3px 0 rgba(16, 8, 10, .4);
  font-family: 'Caveat', cursive;
  font-size: 20px;
  outline: none;
  resize: vertical;
}
.st-field input:focus, .st-field textarea:focus { box-shadow: 3px 3px 0 rgba(199, 52, 63, .55); }

.st-chooser { display: grid; gap: 8px; }
.st-chooser-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 13px;
  background: #FBF6EC;
  color: #201319;
  border: 3px solid #201319;
  box-shadow: 4px 4px 0 rgba(16, 8, 10, .4);
  font-family: 'Permanent Marker', cursive;
  font-size: 17px;
  cursor: pointer;
  text-align: left;
}
.st-chooser-item:hover { background: #FFFDF7; transform: translateX(2px); }
.st-chooser-dot { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #201319; flex-shrink: 0; }
.st-chooser-count { margin-left: auto; font-family: 'Space Grotesk', monospace; font-size: 11px; font-weight: 900; color: #6B4A2E; }
.st-chooser-new { background: #EFE4C4; font-size: 15px; }

/* --------------------------------------------------------- share cutting */

.st-share {
  position: relative;
  z-index: 62;
  width: min(680px, 94vw);
  max-height: min(88svh, 820px);
  overflow-y: auto;
  padding: 22px 20px 18px;
  background-color: #EFE8D6;
  background-image: radial-gradient(rgba(60, 40, 26, .10) .7px, transparent .8px);
  background-size: 5px 5px;
  color: #241C14;
  border: 4px solid #FFFFFF;
  box-shadow: 12px 14px 0 rgba(8, 5, 4, .68);
  transform: rotate(-.6deg);
  animation: st-sheet-in .3s cubic-bezier(.2, 1.3, .4, 1) both;
}
.st-share-tape { top: -14px; left: 26px; }
.st-share-close { position: absolute; top: 10px; right: 10px; }
.st-share .st-bugle-masthead { font-size: clamp(26px, 5vw, 42px); border-bottom: 0; }
.st-share-rule { display: block; height: 4px; background: #241C14; margin: 4px 0 10px; }
.st-share-headline {
  font-family: 'Space Grotesk', monospace;
  font-size: clamp(22px, 4.4vw, 38px);
  font-weight: 900;
  line-height: 1;
  text-transform: uppercase;
  text-align: center;
}
.st-share-standfirst {
  font-family: 'Caveat', cursive;
  font-size: 20px;
  text-align: center;
  color: #4A3A2A;
  margin-top: 4px;
}
.st-share-body {
  display: grid;
  gap: 18px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 2px solid rgba(36, 28, 20, .35);
}
@media (min-width: 660px) { .st-share-body { grid-template-columns: 1fr auto; align-items: start; } }
.st-share-col { display: grid; gap: 9px; align-content: start; }
.st-share-col-qr { justify-items: center; }
.st-share-num {
  font-family: 'Space Grotesk', monospace;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: .14em;
  text-transform: uppercase;
}
.st-share-link {
  display: block;
  padding: 9px 11px;
  background: #FBF6EC;
  border: 2px dashed #9A7A50;
  font-family: 'Space Grotesk', monospace;
  font-size: 12px;
  word-break: break-all;
  color: #2A1F17;
}
.st-share-foot {
  margin-top: 14px;
  font-family: 'Caveat', cursive;
  font-size: 18px;
  text-align: center;
  color: #5A452A;
}

/* ------------------------------------------------------------- controls */

.st-ink-btn, .st-ghost-btn, .st-danger-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 15px;
  font-family: 'Space Grotesk', monospace;
  font-size: 12px;
  font-weight: 900;
  text-transform: lowercase;
  letter-spacing: .04em;
  border: 3px solid #201319;
  box-shadow: 4px 4px 0 rgba(12, 7, 5, .55);
  cursor: pointer;
  transition: transform .14s ease-out, box-shadow .14s ease-out;
}
.st-ink-btn { background: #781420; color: #FDF6F0; }
.st-ink-btn:hover { background: #5A0F19; }
.st-ghost-btn { background: #F7F1E6; color: #201319; }
.st-ghost-btn:hover { background: #FFFDF7; }
.st-danger-btn { background: #F7DADD; color: #A61B27; border-color: #A61B27; justify-self: start; }
.st-ink-btn:active, .st-ghost-btn:active, .st-danger-btn:active { transform: translate(3px, 3px); box-shadow: none; }
.st-ink-btn:disabled { opacity: .6; cursor: not-allowed; }

.st-icon-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  background: #F7F1E6;
  color: #201319;
  border: 3px solid #201319;
  box-shadow: 3px 3px 0 rgba(12, 7, 5, .5);
  cursor: pointer;
  flex-shrink: 0;
}
.st-icon-btn:active { transform: translate(3px, 3px); box-shadow: none; }

.st-file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

/* ------------------------------------------------------------- messages */

.st-messages { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 80; display: grid; gap: 6px; }
.st-toast {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: min(560px, 92vw);
  padding: 8px 14px;
  background: #F7F1E6;
  color: #201319;
  border: 3px solid #201319;
  box-shadow: 5px 5px 0 rgba(12, 7, 5, .6);
  font-family: 'Space Grotesk', monospace;
  font-size: 11px;
  font-weight: 800;
}
.st-toast-bad { background: #F7DADD; color: #7A0D18; border-color: #7A0D18; }

.st-loading {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 50svh;
  font-family: 'Space Grotesk', monospace;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: #FFE7C6;
}
@keyframes st-spin-turn-2 { to { transform: rotate(360deg); } }
.st-spin { animation: st-spin-turn-2 .9s linear infinite; }
.st-spin-slow { animation: st-spin-turn-2 3.4s linear infinite; }

@media (prefers-reduced-motion: reduce) {
  .st-reel, .st-vinyl-spin .st-vinyl-disc, .st-spin, .st-spin-slow,
  .st-viewfinder-rec, .st-neo-primary:hover svg {
    animation: none !important;
  }
  .st-object, .st-track, .st-bugle, .st-liner, .st-neo { transition: none !important; }
}
`;
