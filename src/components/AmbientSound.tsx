"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Upload, Loader2, Music } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGuardedAction } from "@/lib/hooks/useGuardedAction";

interface AmbientSoundProps {
  coupleId?: string;
}

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15MB

export default function AmbientSound({ coupleId }: AmbientSoundProps) {
  const supabase = createClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [playing, setPlaying] = useState(false);
  const [trackSrc, setTrackSrc] = useState("/audio/ambient.mp3");
  const [trackName, setTrackName] = useState<string | null>(null);
  const [hasCustomTrack, setHasCustomTrack] = useState(false);
  const [hasTrackError, setHasTrackError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* The custom track is stored as a base64 data URL in Postgres, and a normal
     one runs to several megabytes. This component is mounted on the dashboard,
     so fetching the audio on mount meant every single visit to the home screen
     downloaded that blob before the reader had touched anything.

     Only the track NAME is fetched up front, which is all the idle UI shows.
     The audio itself is fetched the first time Play is pressed. */
  const customTrackLoaded = useRef(false);

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
        setTrackName(data.ambient_audio_name);
        setHasCustomTrack(true);
        setHasTrackError(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [coupleId, supabase]);

  /* Pulls the base64 audio down the first time it is actually needed. Returns
     the data URL so the caller can put it straight onto the element: going
     through state alone would not update the DOM until after the next commit,
     and play() has to happen inside the same user gesture. */
  const loadCustomTrack = async (): Promise<string | null> => {
    if (!coupleId || !hasCustomTrack || customTrackLoaded.current) return null;
    customTrackLoaded.current = true;

    const { data } = await supabase
      .from("couples")
      .select("ambient_audio_data")
      .eq("id", coupleId)
      .maybeSingle();

    if (!data?.ambient_audio_data) return null;
    setTrackSrc(data.ambient_audio_data);
    return data.ambient_audio_data;
  };

  const [togglePlay] = useGuardedAction(async () => {
    const audio = audioRef.current;
    if (!audio || hasTrackError) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }

    try {
      const lazySrc = await loadCustomTrack();
      if (lazySrc) {
        audio.src = lazySrc;
        audio.load();
      }
      await audio.play();
      setPlaying(true);
    } catch (err) {
      console.error("Ambient music could not start:", err);
    }
  }, 400);

  const [runUpload, uploading] = useGuardedAction(async (file: File) => {
    if (!coupleId) return;
    setError(null);

    if (!file.type.startsWith("audio/")) {
      setError("Please choose an audio file (MP3).");
      return;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      setError(`Keep background tracks under ${MAX_AUDIO_BYTES / (1024 * 1024)}MB.`);
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
      setError(saveError.message);
      return;
    }

    const wasPlaying = playing;
    setHasTrackError(false);
    setTrackSrc(dataUrl);
    setTrackName(file.name);
    setHasCustomTrack(true);
    customTrackLoaded.current = true; // we already hold the bytes we just uploaded

    requestAnimationFrame(async () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.load();
      if (wasPlaying) {
        try {
          await audio.play();
          setPlaying(true);
        } catch {
          setPlaying(false);
        }
      }
    });
  }, 800);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) runUpload(file);
  };

  return (
    <>
      <audio
        ref={audioRef}
        loop
        preload="none"
        src={trackSrc}
        onError={() => {
          setHasTrackError(true);
          setPlaying(false);
        }}
      />
      <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileChange} />

      <div className="fixed bottom-6 right-5 z-50 flex flex-col items-end gap-1.5">
        {error && (
          <span className="max-w-[220px] text-right font-mono text-[9px] font-bold text-[#F2E6D2] bg-[#5A2029] border border-[#261D24] px-2 py-1 rounded shadow-[2px_2px_0_#171B22]">
            {error}
          </span>
        )}

        <div className="flex items-center gap-1.5 bg-[#2E0509] border-2 border-[#261D24] rounded-full px-1.5 py-1.5 shadow-[3px_3px_0_#171B22]">
          <button
            type="button"
            onClick={() => togglePlay()}
            disabled={hasTrackError}
            title={trackName ? `${playing ? "Pause" : "Play"} ${trackName}` : playing ? "Pause ambient music" : "Play ambient music"}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#E0B1AE] hover:text-[#F2E6D2] hover:bg-[#450A10] disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <span className="w-px h-4 bg-[#261D24]" />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !coupleId}
            title="Upload a custom background track"
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#E0B1AE] hover:text-[#F2E6D2] hover:bg-[#450A10] disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          </button>

          {trackName && (
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
