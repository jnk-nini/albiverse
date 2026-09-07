/* ============================================================================
   SHARED MEDIA PREP — make any photo or clip actually work in this app

   Albiverse stores media as base64 `data:` URLs in text columns (no Storage
   bucket, no server-side processing — see CLAUDE.md). That means whatever the
   browser is handed at upload time is byte-for-byte what every other device
   has to render later, so all the fixing has to happen client-side, before
   the insert. Three separate problems live here:

   1. THE MIME BUG (this was the real "videos don't play" cause).
      A clip picked from an iPhone arrives as `video/quicktime`. NO desktop
      browser claims support for that MIME type — `canPlayType('video/quicktime')`
      returns "" in Chrome/Edge/Firefox — so `<video>` refuses the data URL
      outright with "Unable to load URL due to content type", WITHOUT EVER
      LOOKING AT THE BYTES.

      The bytes are usually fine: the clip already in this app's digicam roll
      is `avc1` (H.264) + `mp4a` (AAC), which every browser plays. It is only
      the label that is wrong. Verified empirically in Chromium: identical
      bytes play as `data:video/mp4` and fail as `data:video/quicktime`, and
      a known-good `isom`-branded MP4 ALSO fails once relabelled quicktime —
      so the container brand is irrelevant, it is purely MIME dispatch.
      `.mov` is ISO base media format like `.mp4`; the same demuxer reads both.

      => `playableMediaSrc()` rewrites the label at RENDER time (so clips
         already in the database start working with no migration), and
         `normaliseMediaMime()` fixes it at UPLOAD time for new ones.

   2. OVERSIZE PHOTOS. A modern phone photo is 3–12MB, and base64 inflates it
      by a further ~33%, so the raw file both bounces off the upload cap and,
      when it does fit, makes every later page load drag. `compressImage()`
      downscales and re-encodes to JPEG, which typically turns a 9MB photo
      into ~400KB with no visible difference at screen size.

   3. OVERSIZE / UNPLAYABLE CLIPS. `transcodeVideo()` re-encodes in the
      browser via MediaRecorder — free, no server, no ffmpeg.wasm. It is only
      reached when a clip is too big or genuinely won't decode, because it
      runs in real time (a 60s clip takes ~60s) and re-encoding always costs
      some quality. Where MediaRecorder can emit H.264 MP4 it does, which is
      the one format that plays everywhere including older iOS.

   Everything here is pure client-side work on a file the user picked. It adds
   no API route, no external service and no metered call, so it carries no new
   cost/abuse surface (see the standing guardrail rule).
   ========================================================================== */

/* ---------------------------------------------------------------- MIME ---- */

/* Containers whose declared MIME no browser accepts, but whose bytes are the
   same ISO base media format `video/mp4` already decodes. Relabelling is
   strictly non-worse: if the payload really is undecodable the element fails
   exactly as it did before, and the caller's onError fallback still shows. */
const VIDEO_MIME_REMAP: Record<string, string> = {
  "video/quicktime": "video/mp4",
  "video/x-quicktime": "video/mp4",
  "video/x-m4v": "video/mp4",
  "video/m4v": "video/mp4",
  "video/3gpp": "video/mp4",
  "video/3gpp2": "video/mp4",
  "video/mpeg4": "video/mp4",
  "video/x-matroska": "video/webm",
};

/** The MIME a clip should be STORED under, given whatever the picker reported. */
export function normaliseMediaMime(mime: string): string {
  const key = (mime || "").split(";")[0].trim().toLowerCase();
  return VIDEO_MIME_REMAP[key] ?? mime;
}

/**
 * The `src` a `<video>`/`<img>` should actually be given.
 *
 * Rewrites only the MIME segment of a base64 data URL, leaving the payload
 * untouched — so rows already saved with `data:video/quicktime;base64,...`
 * play immediately without rewriting 25MB of base64 in the database.
 * Anything that isn't a base64 data URL is returned unchanged.
 */
export function playableMediaSrc(url: string | null | undefined): string {
  if (!url) return "";
  if (!url.startsWith("data:")) return url;

  const comma = url.indexOf(",");
  if (comma === -1) return url;

  const header = url.slice(5, comma); // e.g. `video/quicktime;base64`
  const semi = header.indexOf(";");
  const mime = (semi === -1 ? header : header.slice(0, semi)).trim().toLowerCase();
  const params = semi === -1 ? "" : header.slice(semi);

  const remapped = VIDEO_MIME_REMAP[mime];
  if (!remapped) return url;

  return `data:${remapped}${params}${url.slice(comma)}`;
}

/**
 * Same rewrite as `playableMediaSrc`, but for the STORE path, and it reports
 * whether anything changed so the caller can explain it to the reader once.
 */
export function relabelDataUrl(dataUrl: string, originalMime: string): { dataUrl: string; changed: boolean } {
  const fixed = playableMediaSrc(dataUrl);
  return { dataUrl: fixed, changed: fixed !== dataUrl || normaliseMediaMime(originalMime) !== originalMime };
}

/** True when the MIME is one this app had to relabel to make it playable. */
export function wasMimeRemapped(url: string | null | undefined): boolean {
  if (!url || !url.startsWith("data:")) return false;
  const mime = url.slice(5, url.indexOf(";") === -1 ? url.indexOf(",") : url.indexOf(";")).trim().toLowerCase();
  return Boolean(VIDEO_MIME_REMAP[mime]);
}

/* -------------------------------------------------------------- helpers --- */

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

/** Bytes the base64 payload of a data URL will occupy in a Postgres text column. */
export function dataUrlBytes(dataUrl: string): number {
  return dataUrl.length;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/* --------------------------------------------------------------- images --- */

export interface ImagePrepOptions {
  /** Longest edge, in CSS pixels, after downscaling. */
  maxEdge?: number;
  /** Initial JPEG quality; stepped down if the result is still over budget. */
  quality?: number;
  /** Target size of the resulting data URL string, in bytes. */
  targetBytes?: number;
}

export interface PreparedMedia {
  dataUrl: string;
  bytes: number;
  /** Human-readable summary of what happened, or null if nothing was changed. */
  note: string | null;
  /** Whether the file was re-encoded rather than passed through untouched. */
  processed: boolean;
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  /* `imageOrientation: "from-image"` applies the EXIF rotation phones write,
     so a portrait photo doesn't come out sideways once it hits the canvas. */
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* Safari <15 and any format the bitmap decoder rejects fall through to
         the <img> path below, which handles orientation itself. */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    /* Revoked on the next tick so the decoded image is safe to draw. */
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function canvasToDataUrl(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Downscale + re-encode a photo so it fits comfortably in a text column and
 * loads fast later. Returns the original untouched if it is already small
 * enough, or if the browser cannot decode it (HEIC on Windows, say) — the
 * caller decides whether an undecodable original is acceptable.
 */
export async function compressImage(
  file: File,
  { maxEdge = 2048, quality = 0.84, targetBytes = 1_200_000 }: ImagePrepOptions = {}
): Promise<PreparedMedia> {
  const passthrough = async (note: string | null): Promise<PreparedMedia> => {
    const dataUrl = await readFileAsDataUrl(file);
    return { dataUrl, bytes: dataUrl.length, note, processed: false };
  };

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decodeImage(file);
  } catch {
    /* HEIC/HEIF on a browser without a decoder lands here. Nothing this app
       can do client-side; hand the original back and let the caller warn. */
    return passthrough(
      "This browser couldn't read that photo's format (usually .heic from an iPhone). It was saved as-is and may not display — set the iPhone camera to “Most Compatible”, or share it as a JPEG."
    );
  }

  const srcW = "width" in source ? source.width : 0;
  const srcH = "height" in source ? source.height : 0;
  if (!srcW || !srcH) return passthrough(null);

  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const alreadySmall = scale === 1 && file.size <= targetBytes;
  if (alreadySmall) {
    if ("close" in source) source.close();
    return passthrough(null);
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    if ("close" in source) source.close();
    return passthrough(null);
  }
  /* A cream backdrop rather than black, so a transparent PNG flattened into
     JPEG lands on paper rather than on a hole. */
  ctx.fillStyle = "#FAF5EB";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();

  /* Step quality down a few times before giving up, rather than shipping a
     10MB "compressed" file because the first guess was too generous. */
  let q = quality;
  let dataUrl = canvasToDataUrl(canvas, q);
  for (let i = 0; i < 4 && dataUrl.length > targetBytes && q > 0.4; i += 1) {
    q -= 0.12;
    dataUrl = canvasToDataUrl(canvas, q);
  }

  const original = file.size;
  const note =
    dataUrl.length < original
      ? `Photo optimised: ${formatBytes(original)} → ${formatBytes(dataUrl.length)} (${canvas.width}×${canvas.height}).`
      : null;

  /* If re-encoding somehow made it bigger (already-tiny or already-optimal
     source), keep the original bytes. */
  if (dataUrl.length >= original * 1.05 && original <= targetBytes) {
    return passthrough(null);
  }

  return { dataUrl, bytes: dataUrl.length, note, processed: true };
}

/* --------------------------------------------------------------- video ---- */

export interface VideoPrepOptions {
  /** Longest edge after downscaling. */
  maxEdge?: number;
  /** Target video bitrate for the re-encode. */
  videoBitsPerSecond?: number;
  /** Refuse anything longer than this, since transcoding runs in real time. */
  maxDurationSeconds?: number;
}

/** The recorder container this browser can produce, best (most portable) first. */
function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    /* H.264 in MP4 plays literally everywhere, including old iOS. Chrome has
       supported recording it since v128, Safari has always produced MP4. */
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? null;
}

/** Load a clip into a detached <video> and report whether it decodes at all. */
function loadVideoElement(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.muted = true;
    video.crossOrigin = "anonymous";
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
    };
    video.onloadedmetadata = () => {
      cleanup();
      resolve(video);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error(video.error?.message || "This browser cannot decode that clip."));
    };
    video.src = url;
    video.load();
  });
}

export interface TranscodeResult extends PreparedMedia {
  /** Set when the clip could not be re-encoded and the caller must decide. */
  failed?: string;
}

/**
 * Re-encode a clip entirely in the browser: play it into a canvas, record the
 * canvas (plus its audio) with MediaRecorder, and hand back the result as a
 * data URL. Runs in real time, so `onProgress` matters and `signal` lets the
 * reader give up.
 *
 * Only useful when the browser can DECODE the source — which is the normal
 * case, including an iPhone re-encoding its own HEVC in Safari.
 */
export async function transcodeVideo(
  file: File,
  {
    maxEdge = 1280,
    videoBitsPerSecond = 1_600_000,
    maxDurationSeconds = 300,
  }: VideoPrepOptions = {},
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<TranscodeResult> {
  const recorderMime = pickRecorderMime();
  if (!recorderMime) {
    return { dataUrl: "", bytes: 0, note: null, processed: false, failed: "This browser can't re-encode video." };
  }

  const objectUrl = URL.createObjectURL(file);
  let video: HTMLVideoElement;
  try {
    video = await loadVideoElement(objectUrl);
  } catch {
    URL.revokeObjectURL(objectUrl);
    return {
      dataUrl: "",
      bytes: 0,
      note: null,
      processed: false,
      failed:
        "This browser can't play that clip's format, so it can't shrink it either. Try uploading from the phone that recorded it, or re-export as MP4 (H.264).",
    };
  }

  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    URL.revokeObjectURL(objectUrl);
    return { dataUrl: "", bytes: 0, note: null, processed: false, failed: "That clip has no readable length." };
  }
  if (duration > maxDurationSeconds) {
    URL.revokeObjectURL(objectUrl);
    return {
      dataUrl: "",
      bytes: 0,
      note: null,
      processed: false,
      failed: `That clip is ${Math.round(duration)}s long. Trim it under ${maxDurationSeconds}s first — re-encoding happens in real time.`,
    };
  }

  const srcW = video.videoWidth || 640;
  const srcH = video.videoHeight || 480;
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  /* Even dimensions: H.264 encoders reject odd widths/heights. */
  const outW = Math.max(2, Math.round((srcW * scale) / 2) * 2);
  const outH = Math.max(2, Math.round((srcH * scale) / 2) * 2);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(objectUrl);
    return { dataUrl: "", bytes: 0, note: null, processed: false, failed: "Canvas unavailable." };
  }

  /* Preferred path: capture the element directly, which carries the audio
     track with it and keeps the element muted locally. Safari has no
     HTMLMediaElement.captureStream, so it falls back to canvas capture and
     routes audio through WebAudio instead. */
  type Capturable = HTMLVideoElement & {
    captureStream?: (fps?: number) => MediaStream;
    mozCaptureStream?: (fps?: number) => MediaStream;
  };
  const capturable = video as Capturable;
  const direct =
    typeof capturable.captureStream === "function"
      ? capturable.captureStream()
      : typeof capturable.mozCaptureStream === "function"
        ? capturable.mozCaptureStream()
        : null;

  let audioCtx: AudioContext | null = null;
  let stream: MediaStream;
  let drawFromCanvas = false;

  if (direct && direct.getVideoTracks().length > 0 && scale === 1) {
    /* Element capture already gives the right pixels at native size. */
    stream = direct;
  } else {
    drawFromCanvas = true;
    stream = canvas.captureStream(30);
    const audioTrack = direct?.getAudioTracks()[0];
    if (audioTrack) {
      stream.addTrack(audioTrack);
    } else {
      /* Safari route: tap the element's audio into the graph without ever
         connecting it to the speakers, so nothing is audible while it runs. */
      try {
        const AudioCtor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtor) {
          audioCtx = new AudioCtor();
          const source = audioCtx.createMediaElementSource(video);
          const dest = audioCtx.createMediaStreamDestination();
          source.connect(dest);
          const t = dest.stream.getAudioTracks()[0];
          if (t) stream.addTrack(t);
          /* createMediaElementSource redirects the element away from the
             default output, so it is already silent; un-mute so the graph
             actually receives samples. */
          video.muted = false;
          video.volume = 1;
        }
      } catch {
        /* No audio in the re-encode. Better than no clip at all. */
      }
    }
  }

  const recorder = new MediaRecorder(stream, { mimeType: recorderMime, videoBitsPerSecond });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  let raf = 0;
  const pump = () => {
    if (drawFromCanvas && !video.paused && !video.ended) {
      ctx.drawImage(video, 0, 0, outW, outH);
    }
    onProgress?.(Math.min(1, video.currentTime / duration));
    raf = requestAnimationFrame(pump);
  };

  const finished = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const stopAll = () => {
    cancelAnimationFrame(raf);
    if (recorder.state !== "inactive") recorder.stop();
    video.pause();
  };

  const onAbort = () => stopAll();
  signal?.addEventListener("abort", onAbort);

  try {
    recorder.start(500);
    if (drawFromCanvas) ctx.drawImage(video, 0, 0, outW, outH);
    pump();
    await video.play();
    await new Promise<void>((resolve) => {
      video.onended = () => resolve();
      /* A safety net: if `ended` never fires (a malformed trailer, say), stop
         a little past the declared duration rather than hanging forever. */
      window.setTimeout(resolve, (duration + 3) * 1000);
    });
    stopAll();
    await finished;
  } catch {
    stopAll();
    signal?.removeEventListener("abort", onAbort);
    URL.revokeObjectURL(objectUrl);
    audioCtx?.close().catch(() => {});
    return {
      dataUrl: "",
      bytes: 0,
      note: null,
      processed: false,
      failed: signal?.aborted ? "Cancelled." : "Re-encoding that clip failed partway through.",
    };
  }

  signal?.removeEventListener("abort", onAbort);
  URL.revokeObjectURL(objectUrl);
  audioCtx?.close().catch(() => {});

  if (signal?.aborted) {
    return { dataUrl: "", bytes: 0, note: null, processed: false, failed: "Cancelled." };
  }

  const outType = recorderMime.split(";")[0];
  const blob = new Blob(chunks, { type: outType });
  if (!blob.size) {
    return { dataUrl: "", bytes: 0, note: null, processed: false, failed: "Re-encoding produced an empty clip." };
  }

  const dataUrl = await readFileAsDataUrl(blob);
  return {
    dataUrl,
    bytes: dataUrl.length,
    processed: true,
    note: `Clip re-encoded for compatibility: ${formatBytes(file.size)} → ${formatBytes(dataUrl.length)} (${outW}×${outH}, ${outType.split("/")[1].toUpperCase()}).`,
  };
}

/** Does this browser think it can play the clip as labelled, after remapping? */
export async function canBrowserPlay(file: File): Promise<boolean> {
  const url = URL.createObjectURL(file);
  try {
    await loadVideoElement(url);
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}
