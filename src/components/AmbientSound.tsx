"use client";

import { useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

export default function AmbientSound() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [enabled, setEnabled] = useState(false);

  const toggleSound = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (enabled) {
      audio.pause();
      setEnabled(false);
      return;
    }

    try {
      await audio.play();
      setEnabled(true);
    } catch (error) {
      console.error("Ambient music could not start:", error);
    }
  };

  return (
    <>
      <audio ref={audioRef} loop preload="none" src="/audio/ambient.mp3" />
      <button
        type="button"
        onClick={toggleSound}
        className="scrapbook-action fixed bottom-6 right-5 z-50 text-[#E0B1AE] hover:text-[#F2E6D2]"
        title={enabled ? "Turn ambient music off" : "Play ambient music"}
      >
        {enabled ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
      </button>
    </>
  );
}
