"use client";

/* ================= GLOBAL AUDIO PLAYER =================
   One provider, mounted once above everything in app/layout.tsx, owns every
   sound the app can make: the ambient background loop (formerly its own
   component, mounted only on the Dashboard) and the Chapter 09 mixtape deck
   (formerly all local state inside SoundtrackScreen). Both used to die the
   moment their owning screen unmounted; now they persist across navigation.

   Two channels, mutually exclusive: starting one pauses whichever backend of
   the other is actually live (its <audio>, its <video>, or its YouTube
   iframe). `activeChannel` tracks which one most recently started.

   Queue ownership: this engine never queries mixtape_tracks itself. Every
   `play()`/`skip()` call is handed the queue to use, by whichever screen
   currently has a tape open. If the reader opens a *different* tape while a
   background track plays, the next skip/repeat/shuffle still walks the OLD
   queue - a deliberate, accepted staleness rather than a realtime
   subscription this engine doesn't need.

   Visual placement: SoundtrackScreen registers a slot <div> (via
   `registerVisualSlot`) while its player view is mounted; the shared <video>
   and YouTube host <div> portal into it. On every other page - or when no
   tape is open - the same nodes portal into a permanently mounted, visually
   clipped fallback here, so audio/video keeps running with nowhere to show a
   frame. `display:none` is avoided on purpose: some browsers throttle or
   stop media inside a zero-size/display:none subtree. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { Disc3 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { blobKey, readBlob, writeBlob } from "@/lib/media/blobCache";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";
import NowPlayingPill from "./NowPlayingPill";

/* ------------------------------------------------------------------ types */

/* Ported verbatim from SoundtrackScreen's old `Track` type. Exported so
   SoundtrackScreen (and anything else that talks to the mixtape channel) can
   import it by value-compatible structural typing instead of keeping a
   second, drifting copy. */
export type MixtapeTrack = {
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

type RepeatMode = "off" | "all" | "one";

interface AmbientPlayerApi {
  playing: boolean;
  trackName: string | null;
  hasCustomTrack: boolean;
  hasTrackError: boolean;
  error: string | null;
  uploading: boolean;
  coupleId: string | undefined;
  /* True once a signed-in user is known. The pill hides its controls
     entirely while this is false, since the provider must do nothing while
     logged out even though it is mounted above the login screen. */
  signedIn: boolean;
  togglePlay: () => void;
  upload: (file: File) => void;
}

interface MixtapePlayerApi {
  currentTrackId: string | null;
  currentTrack: MixtapeTrack | null;
  currentTapeId: string | null;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  setVolume: Dispatch<SetStateAction<number>>;
  elapsed: number;
  duration: number;
  repeatMode: RepeatMode;
  setRepeatMode: Dispatch<SetStateAction<RepeatMode>>;
  shuffleOn: boolean;
  setShuffleOn: Dispatch<SetStateAction<boolean>>;
  error: string | null;
  ytReady: boolean;
  /* Which channel most recently started playback - "mixtape" whenever this
     channel is the one actually audible. Mostly informational; the pill's
     own display priority is driven by currentTrackId, not this. */
  activeChannel: "ambient" | "mixtape" | null;
  play: (track: MixtapeTrack, queue: MixtapeTrack[], tapeId: string) => void;
  togglePlay: () => void;
  skip: (delta: number) => void;
  seekToFraction: (fraction: number) => void;
  /* Stops playback and drops the current track if it belongs to `trackId` /
     `tapeId` - called when SoundtrackScreen deletes the thing that is
     currently playing, since it can no longer be fetched or resumed. */
  forgetTrack: (trackId: string) => void;
  stopPlaybackForTape: (tapeId: string) => void;
  /* SoundtrackScreen calls this with a ref while its player view is mounted,
     and with null on unmount. See file header. */
  registerVisualSlot: (node: HTMLDivElement | null) => void;
  /* Builds the YouTube iframe player eagerly, before any track is actually
     picked. Safe to call repeatedly - ensureYtPlayer itself no-ops once a
     player exists or is already building. SoundtrackScreen calls this as
     soon as the board mounts with a YouTube track in view, so the player is
     already `ytReady` by the time the user's first tap needs a synchronous
     `loadVideoById`/`playVideo` call (mobile autoplay-gesture requirement -
     see Chapter 9 memory notes). */
  warmUp: () => void;
}

/* ------------------------------------------------------------- YT loader */
/* Moved here near-verbatim from SoundtrackScreen - it never depended on the
   component, only on `window`/`document`. */

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

/* ---------------------------------------------------------------- context */

const AmbientContext = createContext<AmbientPlayerApi | null>(null);
const MixtapeContext = createContext<MixtapePlayerApi | null>(null);

export function useAmbientPlayer(): AmbientPlayerApi {
  const ctx = useContext(AmbientContext);
  if (!ctx) throw new Error("useAmbientPlayer must be used within AudioPlayerProvider");
  return ctx;
}

export function useMixtapePlayer(): MixtapePlayerApi {
  const ctx = useContext(MixtapeContext);
  if (!ctx) throw new Error("useMixtapePlayer must be used within AudioPlayerProvider");
  return ctx;
}

/* -------------------------------------------------------------- constants */

const AMBIENT_MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15MB

/* ============================================================== provider */

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);

  /* -------------------------------------------------------- who is this */
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [coupleId, setCoupleId] = useState<string | undefined>(undefined);

  /* --------------------------------------------------- shared arbitration */
  const [activeChannel, setActiveChannel] = useState<"ambient" | "mixtape" | null>(null);

  /* Pulled up ahead of both channels' sections: ambientTogglePlayRun (in the
     ambient section, right below) needs to call pauseMixtapePlayback, and the
     project's stricter hook-ordering lint (aimed at the React Compiler) does
     not allow a forward reference even though it would be perfectly safe at
     runtime as an ordinary closure. The rest of the mixtape channel's refs
     and state are declared further down, in their own section. */
  const ytRef = useRef<YtPlayer | null>(null);
  const mixtapeAudioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const pauseMixtapePlayback = useCallback(() => {
    try {
      ytRef.current?.pauseVideo();
    } catch {
      /* nothing loaded yet */
    }
    mixtapeAudioRef.current?.pause();
    videoRef.current?.pause();
    setIsPlaying(false);
  }, []);

  /* ===================================================== ambient channel */

  const ambientAudioRef = useRef<HTMLAudioElement | null>(null);
  const ambientCustomTrackLoaded = useRef(false);

  const [ambientPlaying, setAmbientPlaying] = useState(false);
  const [ambientTrackName, setAmbientTrackName] = useState<string | null>(null);
  const [ambientHasCustomTrack, setAmbientHasCustomTrack] = useState(false);
  const [ambientHasTrackError, setAmbientHasTrackError] = useState(false);
  const [ambientError, setAmbientError] = useState<string | null>(null);

  const pauseAmbientPlayback = useCallback(() => {
    ambientAudioRef.current?.pause();
    setAmbientPlaying(false);
  }, []);

  /* The <audio> element's `src` is set imperatively only, never through a
     React prop - see the race this avoids in loadCustomTrack/ambientUploadRun
     below. This just seeds the default track once, on mount. */
  useEffect(() => {
    if (ambientAudioRef.current) ambientAudioRef.current.src = "/audio/ambient.mp3";
  }, []);

  /* Only the track NAME is fetched on login; the base64 blob itself is
     fetched the first time Play is actually pressed. See loadCustomTrack. */
  useEffect(() => {
    if (!coupleId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("couples")
        .select("ambient_audio_name")
        .eq("id", coupleId)
        .maybeSingle();
      if (cancelled) return;
      if (data?.ambient_audio_name) {
        setAmbientTrackName(data.ambient_audio_name);
        setAmbientHasCustomTrack(true);
        setAmbientHasTrackError(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coupleId, supabase]);

  const loadCustomTrack = useCallback(async (): Promise<string | null> => {
    if (!coupleId || !ambientHasCustomTrack || ambientCustomTrackLoaded.current) return null;
    ambientCustomTrackLoaded.current = true;

    /* EGRESS: a whole base64 MP3 (3MB on this account), re-downloaded the
       first time Play was pressed in every single session. `couples` has no
       updated_at, but the track NAME is already fetched by the cheap query on
       login and changes whenever the track does - so it works as the version
       stamp, and swapping tracks invalidates this by itself. */
    const key = blobKey.coupleAmbient(coupleId);
    const version = ambientTrackName ?? "unnamed";

    const cached = await readBlob(key, version);
    if (cached) return cached;

    const { data } = await supabase
      .from("couples")
      .select("ambient_audio_data")
      .eq("id", coupleId)
      .maybeSingle();

    if (!data?.ambient_audio_data) return null;
    void writeBlob(key, version, data.ambient_audio_data);
    return data.ambient_audio_data;
  }, [coupleId, ambientHasCustomTrack, ambientTrackName, supabase]);

  const [ambientTogglePlayRun] = useGuardedAction(async () => {
    const audio = ambientAudioRef.current;
    if (!audio || ambientHasTrackError) return;

    if (ambientPlaying) {
      audio.pause();
      setAmbientPlaying(false);
      return;
    }

    pauseMixtapePlayback();
    setActiveChannel("ambient");

    try {
      const lazySrc = await loadCustomTrack();
      if (lazySrc) {
        audio.src = lazySrc;
        audio.load();
      }
      await audio.play();
      setAmbientPlaying(true);
    } catch (err) {
      console.error("Ambient music could not start:", err);
    }
  }, 400);

  const [ambientUploadRun, ambientUploading] = useGuardedAction(async (file: File) => {
    if (!coupleId) return;
    setAmbientError(null);

    if (!file.type.startsWith("audio/")) {
      setAmbientError("Please choose an audio file (MP3).");
      return;
    }
    if (file.size > AMBIENT_MAX_AUDIO_BYTES) {
      setAmbientError(`Keep background tracks under ${AMBIENT_MAX_AUDIO_BYTES / (1024 * 1024)}MB.`);
      return;
    }

    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
      reader.readAsDataURL(file);
    });

    const { error: saveError } = await supabase
      .from("couples")
      .update({ ambient_audio_data: dataUrl, ambient_audio_name: file.name })
      .eq("id", coupleId);

    if (saveError) {
      setAmbientError(saveError.message);
      return;
    }

    const wasPlaying = ambientPlaying;
    setAmbientHasTrackError(false);
    setAmbientTrackName(file.name);
    setAmbientHasCustomTrack(true);
    ambientCustomTrackLoaded.current = true; // we already hold the bytes we just uploaded
    /* Seed the cache with what we just uploaded, keyed by the new name, so no
       later session re-downloads bytes this device already has. */
    void writeBlob(blobKey.coupleAmbient(coupleId), file.name, dataUrl);

    /* Imperative, same as the play button - no React re-render is involved in
       setting the source, so there's nothing to wait a frame for. */
    const audio = ambientAudioRef.current;
    if (audio) {
      audio.src = dataUrl;
      audio.load();
      if (wasPlaying) {
        try {
          await audio.play();
          setAmbientPlaying(true);
        } catch {
          setAmbientPlaying(false);
        }
      }
    }
  }, 800);

  /* ===================================================== mixtape channel */

  const ytBuildingRef = useRef(false);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const blobCacheRef = useRef<Map<string, string>>(new Map());
  const volumeRef = useRef(80);

  const [currentTrack, setCurrentTrack] = useState<MixtapeTrack | null>(null);
  const [currentTapeId, setCurrentTapeId] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [volume, setVolume] = useState(80);
  const [ytReady, setYtReady] = useState(false);
  const [pendingYoutubeId, setPendingYoutubeId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [shuffleOn, setShuffleOn] = useState(false);
  const [mixtapeError, setMixtapeError] = useState<string | null>(null);

  /* The last queue handed to play()/skip(). Deliberately not derived from any
     live query - see the file header on queue ownership. */
  const queueRef = useRef<MixtapeTrack[]>([]);

  const fetchBlob = useCallback(
    async (trackId: string): Promise<string | null> => {
      const cached = blobCacheRef.current.get(trackId);
      if (cached) return cached;
      if (!coupleId) return null;

      /* EGRESS: the in-memory cache above dies with the page. `audio_data` is
         written once at insert and never updated (no edit path touches it),
         so the row id alone is a sound version stamp and a track survives
         across sessions instead of being re-downloaded on every replay. */
      const key = blobKey.mixtapeTrack(trackId);
      const persisted = await readBlob(key, "insert-only");
      if (persisted) {
        blobCacheRef.current.set(trackId, persisted);
        return persisted;
      }

      const { data, error: blobError } = await supabase
        .from("mixtape_tracks")
        .select("audio_data")
        .eq("id", trackId)
        .eq("couple_id", coupleId)
        .maybeSingle();
      if (blobError || !data?.audio_data) return null;
      blobCacheRef.current.set(trackId, data.audio_data);
      void writeBlob(key, "insert-only", data.audio_data);
      return data.audio_data;
    },
    [supabase, coupleId]
  );

  const handleTrackEndedRef = useRef<() => void>(() => {});

  /* Built lazily, on first YouTube play, and NEVER torn down afterward - a
     deliberate simplification vs. the old per-tape destroy/recreate. */
  const ensureYtPlayer = useCallback(() => {
    if (ytRef.current || ytBuildingRef.current) return;
    ytBuildingRef.current = true;
    void loadYoutubeApi()
      .then((YT) => {
        if (ytRef.current || !ytHostRef.current) return;
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
              if (event.data === YT.PlayerState.ENDED) handleTrackEndedRef.current();
              setIsBuffering(event.data === YT.PlayerState.BUFFERING);
              if (event.data === YT.PlayerState.PLAYING) setIsPlaying(true);
              if (event.data === YT.PlayerState.PAUSED) setIsPlaying(false);
            },
            onError: () => {
              setMixtapeError("That track would not play. It may be blocked from embedding.");
              setIsPlaying(false);
            },
          },
        });
      })
      .catch(() => {
        setMixtapeError("The YouTube player could not load.");
      })
      .finally(() => {
        ytBuildingRef.current = false;
      });
  }, []);

  const play = useCallback(
    (track: MixtapeTrack, queue: MixtapeTrack[], tapeId: string) => {
      pauseAmbientPlayback();
      setActiveChannel("mixtape");

      queueRef.current = queue;
      setCurrentTapeId(tapeId);
      setMixtapeError(null);
      setCurrentTrack(track);
      setElapsed(0);
      setDuration(track.duration_seconds ?? 0);

      if (track.source === "youtube") {
        mixtapeAudioRef.current?.pause();
        videoRef.current?.pause();
        if (!ytRef.current) ensureYtPlayer();
        const player = ytRef.current;
        if (!player || !ytReady || !track.youtube_id) {
          setPendingYoutubeId(track.youtube_id ?? null);
          setIsBuffering(true);
          return;
        }
        try {
          player.loadVideoById(track.youtube_id);
          player.setVolume(volumeRef.current);
          setIsPlaying(true);
          setPendingYoutubeId(null);
        } catch {
          setPendingYoutubeId(track.youtube_id);
          setIsBuffering(true);
        }
        return;
      }

      try {
        ytRef.current?.pauseVideo();
      } catch {
        /* nothing loaded yet */
      }
      /* Switching straight from a local audio bootleg to a local video (or
         back) must stop whichever of the two was actually playing, not just
         the YT player - otherwise the old element keeps making sound until
         its src is reassigned out from under it. */
      mixtapeAudioRef.current?.pause();
      videoRef.current?.pause();

      setIsBuffering(true);
      void (async () => {
        const src = await fetchBlob(track.id);
        setIsBuffering(false);
        if (!src) {
          setMixtapeError("That bootleg could not be found on the tape.");
          return;
        }
        const el = track.media_type === "video" ? videoRef.current : mixtapeAudioRef.current;
        if (!el) return;
        el.src = src;
        el.volume = volumeRef.current / 100;
        try {
          await el.play();
          setIsPlaying(true);
        } catch {
          setIsPlaying(false);
          setMixtapeError("The browser blocked playback. Press play again.");
        }
      })();
    },
    [pauseAmbientPlayback, ensureYtPlayer, ytReady, fetchBlob]
  );

  const mixtapeTogglePlay = useCallback(() => {
    if (!currentTrack) return;
    const willPlay = !isPlaying;
    if (willPlay) {
      pauseAmbientPlayback();
      setActiveChannel("mixtape");
    }

    if (currentTrack.source === "youtube") {
      const player = ytRef.current;
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
    const el = currentTrack.media_type === "video" ? videoRef.current : mixtapeAudioRef.current;
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
  }, [currentTrack, isPlaying, ytReady, pauseAmbientPlayback]);

  const pickShuffledIndex = useCallback((queue: MixtapeTrack[], excludeIndex: number) => {
    if (queue.length <= 1) return excludeIndex < 0 ? 0 : excludeIndex;
    let idx = Math.floor(Math.random() * queue.length);
    while (idx === excludeIndex) idx = Math.floor(Math.random() * queue.length);
    return idx;
  }, []);

  const skip = useCallback(
    (delta: number) => {
      const queue = queueRef.current;
      if (queue.length === 0) return;
      const from = currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : -1;
      const tapeId = currentTapeId ?? queue[0].mixtape_id;

      if (repeatMode === "one" && from >= 0) {
        play(queue[from], queue, tapeId);
        return;
      }
      if (shuffleOn) {
        play(queue[pickShuffledIndex(queue, from)], queue, tapeId);
        return;
      }
      const next = (from + delta + queue.length) % queue.length;
      play(queue[next], queue, tapeId);
    },
    [currentTrack, currentTapeId, pickShuffledIndex, play, repeatMode, shuffleOn]
  );

  const handleTrackEnded = useCallback(() => {
    const queue = queueRef.current;
    if (queue.length === 0) return;
    const from = currentTrack ? Math.max(0, queue.findIndex((t) => t.id === currentTrack.id)) : 0;
    const tapeId = currentTapeId ?? queue[0].mixtape_id;

    if (repeatMode === "one") {
      play(queue[from], queue, tapeId);
      return;
    }
    if (shuffleOn) {
      if (queue.length === 1 && repeatMode !== "all") {
        setIsPlaying(false);
        return;
      }
      play(queue[pickShuffledIndex(queue, from)], queue, tapeId);
      return;
    }
    const isLast = from === queue.length - 1;
    if (isLast && repeatMode !== "all") {
      setIsPlaying(false);
      return;
    }
    play(queue[(from + 1) % queue.length], queue, tapeId);
  }, [currentTrack, currentTapeId, pickShuffledIndex, play, repeatMode, shuffleOn]);

  /* Read inside the YouTube player's onStateChange, which is wired up once
     when the player is built and would otherwise keep calling a stale
     closure forever. */
  useEffect(() => {
    handleTrackEndedRef.current = handleTrackEnded;
  }, [handleTrackEnded]);

  /* A YouTube track can be picked before the iframe API has finished loading.
     This effect runs the queued load once the player is actually ready. Keys
     ONLY on ytReady/pendingYoutubeId - never on isBuffering, which also flips
     true on every ordinary BUFFERING event during normal playback. */
  useEffect(() => {
    if (!ytReady || !pendingYoutubeId) return;
    const player = ytRef.current;
    if (!player) return;
    try {
      player.loadVideoById(pendingYoutubeId);
      player.setVolume(volumeRef.current);
      setIsPlaying(true);
      setIsBuffering(false);
      setPendingYoutubeId(null);
    } catch {
      /* still not truly callable; stays queued */
    }
  }, [ytReady, pendingYoutubeId]);

  useEffect(() => {
    volumeRef.current = volume;
    try {
      ytRef.current?.setVolume(volume);
    } catch {
      /* not ready yet */
    }
    if (mixtapeAudioRef.current) mixtapeAudioRef.current.volume = volume / 100;
    if (videoRef.current) videoRef.current.volume = volume / 100;
  }, [volume]);

  /* One polling loop for both local engines and YouTube, whenever anything
     is loaded - regardless of which page is currently mounted. */
  useEffect(() => {
    if (!currentTrack) return;
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
        const el = currentTrack.media_type === "video" ? videoRef.current : mixtapeAudioRef.current;
        if (!el) return;
        position = el.currentTime;
        total = Number.isFinite(el.duration) ? el.duration : 0;
      }
      setElapsed(position);
      setDuration(total);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [currentTrack]);

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
          setElapsed(total * clamped);
          setDuration(total);
        } catch {
          /* not actually ready yet */
        }
        return;
      }
      const el = currentTrack.media_type === "video" ? videoRef.current : mixtapeAudioRef.current;
      if (!el || !Number.isFinite(el.duration)) return;
      el.currentTime = el.duration * clamped;
      setElapsed(el.currentTime);
      setDuration(el.duration);
    },
    [currentTrack, ytReady]
  );

  const forgetTrack = useCallback(
    (trackId: string) => {
      blobCacheRef.current.delete(trackId);
      if (currentTrack?.id === trackId) {
        pauseMixtapePlayback();
        setCurrentTrack(null);
      }
    },
    [currentTrack, pauseMixtapePlayback]
  );

  const stopPlaybackForTape = useCallback(
    (tapeId: string) => {
      if (currentTrack?.mixtape_id === tapeId || currentTapeId === tapeId) {
        pauseMixtapePlayback();
        setCurrentTrack(null);
        setCurrentTapeId(null);
      }
    },
    [currentTrack, currentTapeId, pauseMixtapePlayback]
  );

  /* -------------------------------------------------------- visual slot */

  /* The <video>/YouTube-host DOM lives inside `mediaHostEl`, a raw node
     appended to <body> exactly ONCE and NEVER physically moved again -
     confirmed experimentally that re-parenting a live <iframe> via
     appendChild reloads it in this browser (its own JS context resets), so
     the previous "appendChild the shared host into whichever container is
     current" fix worked for plain <video>/<audio> elements (which do survive
     a DOM move) but silently reloaded/killed every YouTube-backed track the
     instant the reader left `/soundtrack`, because the YT iframe got moved
     right along with it. Nothing here is ever re-parented again: this stays
     `position: fixed` at all times and is only ever repositioned/resized via
     inline style to visually sit inside SoundtrackScreen's viewfinder slot
     when one is registered - CSS alone, no DOM move, so nothing inside it
     (video OR iframe) ever reloads. */
  /* Two handles on the SAME node, deliberately: `mediaHostElRef` is what every
     effect below mutates (`.style.*` writes) - this file's stricter lint
     (react-hooks/immutability) forbids mutating a value returned from
     useState directly, and separately forbids reading a ref's `.current`
     during render (react-hooks/refs). `mediaHostEl` (state) exists purely so
     the JSX below has something render-safe to read for the portal target;
     nothing ever writes to `mediaHostEl.style` - only ever to
     `mediaHostElRef.current.style`, inside effects. */
  const mediaHostElRef = useRef<HTMLDivElement | null>(null);
  const [mediaHostEl, setMediaHostEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement("div");
    el.style.position = "fixed";
    el.style.top = "0px";
    el.style.left = "0px";
    el.style.width = "1px";
    el.style.height = "1px";
    el.style.overflow = "hidden";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    el.style.zIndex = "20";
    document.body.appendChild(el);
    mediaHostElRef.current = el;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- must start null on server AND the client's first render (see hydration note in reference memory); the node itself is created post-mount, which is the sanctioned case for an effect calling setState
    setMediaHostEl(el);
    return () => {
      el.remove();
      mediaHostElRef.current = null;
    };
  }, []);

  const [visualSlot, setVisualSlot] = useState<HTMLDivElement | null>(null);
  const registerVisualSlot = useCallback((node: HTMLDivElement | null) => {
    setVisualSlot(node);
  }, []);

  /* SoundtrackScreen's `.st-viewfinder` rotates the whole polaroid card
     (including this window) by this exact amount - see that class in
     SoundtrackScreen's own <style> block. `getBoundingClientRect()` gives a
     rotated element's axis-aligned BOUNDING box (larger than its true size),
     but its center point still coincides with the true rotated rect's
     center, and `offsetWidth`/`offsetHeight` give the true, un-rotated
     layout size (transform never affects layout). Center + true size +
     re-applying the same rotation reproduces the slot's exact rotated
     rectangle - keep this constant in sync if that CSS value ever changes. */
  const VIEWFINDER_ROTATION_DEG = 1.4;

  useEffect(() => {
    const host = mediaHostElRef.current;
    if (!host) return;

    if (!visualSlot) {
      host.style.transform = "none";
      host.style.top = "0px";
      host.style.left = "0px";
      host.style.width = "1px";
      host.style.height = "1px";
      host.style.opacity = "0";
      return;
    }

    const sync = () => {
      const rect = visualSlot.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const trueWidth = visualSlot.offsetWidth;
      const trueHeight = visualSlot.offsetHeight;
      host.style.left = `${centerX - trueWidth / 2}px`;
      host.style.top = `${centerY - trueHeight / 2}px`;
      host.style.width = `${trueWidth}px`;
      host.style.height = `${trueHeight}px`;
      host.style.transform = `rotate(${VIEWFINDER_ROTATION_DEG}deg)`;
      host.style.opacity = "1";
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(visualSlot);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, { capture: true, passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, { capture: true });
    };
  }, [mediaHostEl, visualSlot]);

  /* -------------------------------------------------------- auth / couple */

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setUserId(undefined);
        setCoupleId(undefined);
        return;
      }
      setUserId(user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("couple_id")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setCoupleId(profile?.couple_id ?? undefined);
    };

    void resolve();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        pauseAmbientPlayback();
        pauseMixtapePlayback();
        setActiveChannel(null);
        setUserId(undefined);
        setCoupleId(undefined);
        return;
      }
      void resolve();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  /* ------------------------------------------------------------- context */

  const ambientApi = useMemo<AmbientPlayerApi>(
    () => ({
      playing: ambientPlaying,
      trackName: ambientTrackName,
      hasCustomTrack: ambientHasCustomTrack,
      hasTrackError: ambientHasTrackError,
      error: ambientError,
      uploading: ambientUploading,
      coupleId,
      signedIn: Boolean(userId),
      togglePlay: ambientTogglePlayRun,
      upload: ambientUploadRun,
    }),
    [
      ambientPlaying,
      ambientTrackName,
      ambientHasCustomTrack,
      ambientHasTrackError,
      ambientError,
      ambientUploading,
      coupleId,
      userId,
      ambientTogglePlayRun,
      ambientUploadRun,
    ]
  );

  const mixtapeApi = useMemo<MixtapePlayerApi>(
    () => ({
      currentTrackId: currentTrack?.id ?? null,
      currentTrack,
      currentTapeId,
      isPlaying,
      isBuffering,
      volume,
      setVolume,
      elapsed,
      duration,
      repeatMode,
      setRepeatMode,
      shuffleOn,
      setShuffleOn,
      error: mixtapeError,
      ytReady,
      activeChannel,
      play,
      togglePlay: mixtapeTogglePlay,
      skip,
      seekToFraction,
      forgetTrack,
      stopPlaybackForTape,
      registerVisualSlot,
      warmUp: ensureYtPlayer,
    }),
    [
      currentTrack,
      currentTapeId,
      isPlaying,
      isBuffering,
      volume,
      elapsed,
      duration,
      repeatMode,
      shuffleOn,
      mixtapeError,
      ytReady,
      activeChannel,
      play,
      mixtapeTogglePlay,
      skip,
      seekToFraction,
      forgetTrack,
      stopPlaybackForTape,
      registerVisualSlot,
      ensureYtPlayer,
    ]
  );

  const visualContent = (
    <>
      <div className={`st-yt ${currentTrack?.source === "youtube" ? "st-yt-on" : ""}`}>
        <div ref={ytHostRef} className="st-yt-host" />
      </div>
      <video
        ref={videoRef}
        className={`st-local-video ${
          currentTrack?.source === "local" && currentTrack.media_type === "video" ? "st-local-on" : ""
        }`}
        playsInline
        onEnded={handleTrackEnded}
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
    </>
  );

  return (
    <AmbientContext.Provider value={ambientApi}>
      <MixtapeContext.Provider value={mixtapeApi}>
        {children}

        <audio
          ref={ambientAudioRef}
          loop
          preload="none"
          onError={() => {
            setAmbientHasTrackError(true);
            setAmbientPlaying(false);
          }}
        />
        <audio
          ref={mixtapeAudioRef}
          onEnded={handleTrackEnded}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />

        {mediaHostEl && createPortal(visualContent, mediaHostEl)}

        <NowPlayingPill />
      </MixtapeContext.Provider>
    </AmbientContext.Provider>
  );
}
