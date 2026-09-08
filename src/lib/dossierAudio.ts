"use client";

/* ============================================================================
   CH.11 SOUND — synthesised, not sampled
   ----------------------------------------------------------------------------
   The dossier is full of tactile noises: a thumbprint scanner sweeping, a
   sheet torn off a notepad, a rubber stamp coming down, a slide projector's
   shutter, web strands snapping. Every one of them is generated here with the
   Web Audio API rather than loaded as a file.

   Why synthesis:
     - no audio assets to host, so nothing is added to the bundle or to
       Vercel's bandwidth (the standing cost guardrail: this chapter adds no
       network requests at all, metered or otherwise);
     - no 404 risk - a missing MP3 is the single most common way sound breaks
       in this app (see the ambient-track story in the project notes);
     - the short mechanical noises this chapter wants are exactly the kind
       synthesis is GOOD at. Noise bursts through a swept filter genuinely do
       sound like paper and machinery.

   What synthesis is worse at is the ambient location loops (rain, a cafe, night
   traffic) - those are filtered-noise impressions, not recordings. They read as
   atmosphere rather than realism, which is the right trade for something that
   costs nothing and cannot fail to load.

   Everything is lazy: no AudioContext exists until the reader's first gesture,
   because browsers refuse to start one before that anyway.
   ========================================================================== */

const MUTE_KEY = "albiverse:dossier:muted";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let noiseBuffer: AudioBuffer | null = null;

/* Reading the stored preference is deferred to the first call rather than done
   at module scope, so importing this file never touches storage during SSR. */
let prefLoaded = false;

function loadPref() {
  if (prefLoaded) return;
  prefLoaded = true;
  try {
    muted = window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    muted = false;
  }
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  loadPref();

  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }

  /* Autoplay policy parks the context until a gesture; every SFX call happens
     inside one, so resuming here is both allowed and the cheapest place. */
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function isMuted(): boolean {
  loadPref();
  return muted;
}

export function setMuted(next: boolean) {
  loadPref();
  muted = next;
  try {
    window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    /* a rejected write only costs the preference, never the sound */
  }
  if (master && ctx) {
    master.gain.setTargetAtTime(next ? 0 : 0.5, ctx.currentTime, 0.02);
  }
  if (next) stopAmbient();
}

/** One second of white noise, built once and replayed at different rates. */
function noise(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const len = c.sampleRate;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

interface BurstOptions {
  duration?: number;
  attack?: number;
  gain?: number;
  type?: BiquadFilterType;
  from?: number;
  to?: number;
  q?: number;
  rate?: number;
  delay?: number;
}

/** A shaped burst of noise - the workhorse behind paper, clicks and thwips. */
function burst(opts: BurstOptions = {}) {
  const c = ac();
  if (!c || muted) return;

  const {
    duration = 0.16,
    attack = 0.004,
    gain = 0.5,
    type = "bandpass",
    from = 1800,
    to = 400,
    q = 1.1,
    rate = 1,
    delay = 0,
  } = opts;

  const t0 = c.currentTime + delay;

  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.playbackRate.value = rate;

  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, to), t0 + duration);

  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  src.connect(filter).connect(env).connect(master!);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

interface ToneOptions {
  freq?: number;
  to?: number;
  duration?: number;
  gain?: number;
  type?: OscillatorType;
  delay?: number;
}

function tone(opts: ToneOptions = {}) {
  const c = ac();
  if (!c || muted) return;

  const { freq = 440, to = freq, duration = 0.12, gain = 0.22, type = "sine", delay = 0 } = opts;
  const t0 = c.currentTime + delay;

  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + duration);

  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(env).connect(master!);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/* ------------------------------------------------------------- the sounds -- */

/** Web line fired: a sharp hiss with a falling pitch behind it. */
export function thwip() {
  burst({ duration: 0.13, from: 5200, to: 900, gain: 0.34, q: 0.8 });
  tone({ freq: 880, to: 180, duration: 0.13, gain: 0.1, type: "sawtooth" });
}

/** The biometric scanner sweeping the badge. */
export function scan() {
  tone({ freq: 320, to: 1500, duration: 0.42, gain: 0.09, type: "triangle" });
  burst({ duration: 0.42, from: 600, to: 4200, gain: 0.09, q: 4 });
  tone({ freq: 1760, duration: 0.07, gain: 0.14, type: "square", delay: 0.42 });
}

/** A card flipping over - air, then the edge landing. */
export function cardFlip() {
  burst({ duration: 0.22, from: 900, to: 2600, gain: 0.16, q: 0.7 });
  burst({ duration: 0.05, from: 2400, to: 700, gain: 0.3, delay: 0.2 });
}

/** A sheet torn off a notepad. Two bursts: the rip, then the sheet settling. */
export function paperTear() {
  burst({ duration: 0.26, from: 3400, to: 1300, gain: 0.34, q: 0.6, rate: 1.4 });
  window.setTimeout(() => burst({ duration: 0.12, from: 1600, to: 600, gain: 0.13 }), 190);
}

/** A rubber stamp coming down: the thud, then the wood. */
export function stamp() {
  tone({ freq: 150, to: 52, duration: 0.16, gain: 0.36, type: "sine" });
  burst({ duration: 0.09, from: 2600, to: 500, gain: 0.28, q: 0.7 });
}

/** A mechanical slide-projector shutter. */
export function shutter() {
  burst({ duration: 0.045, from: 3800, to: 1200, gain: 0.34, q: 1.6 });
  window.setTimeout(() => burst({ duration: 0.07, from: 2200, to: 380, gain: 0.26 }), 70);
  tone({ freq: 90, to: 58, duration: 0.14, gain: 0.16, type: "sine", delay: 0.07 });
}

/** A rotary dial notching one step. */
export function dialClick() {
  burst({ duration: 0.028, from: 4200, to: 2200, gain: 0.22, q: 2.4 });
}

/** A web strand snapping under the blade. */
export function webSnap() {
  tone({ freq: 1200, to: 240, duration: 0.16, gain: 0.16, type: "triangle" });
  burst({ duration: 0.1, from: 3000, to: 800, gain: 0.2, q: 1.4 });
}

/** Something going wrong across dimensions - a short torn-signal stutter. */
export function glitch() {
  /* Every burst here is scheduled through setTimeout, including the i=0 one -
     that's a macrotask, which is no longer "in response to a user gesture" as
     far as mobile Safari is concerned. Priming the context synchronously,
     before any timeout is queued, is what lets the delayed bursts actually
     produce sound instead of running against a still-suspended context. */
  ac();
  for (let i = 0; i < 4; i++) {
    window.setTimeout(
      () => burst({ duration: 0.035, from: 900 + i * 1400, to: 300, gain: 0.13, q: 3 }),
      i * 38
    );
  }
}

/** Alarm spikes on chaos mode. */
export function alarm() {
  tone({ freq: 660, to: 320, duration: 0.18, gain: 0.2, type: "square" });
  tone({ freq: 620, to: 300, duration: 0.18, gain: 0.16, type: "square", delay: 0.2 });
  burst({ duration: 0.3, from: 2400, to: 500, gain: 0.12 });
}

/** The vault finally opening: a rising bloom with a warm chord under it. */
export function bloom() {
  [392, 494, 587, 784].forEach((f, i) =>
    tone({ freq: f, duration: 1.5, gain: 0.09, type: "sine", delay: i * 0.09 })
  );
  burst({ duration: 1.1, from: 400, to: 4800, gain: 0.09, q: 0.7 });
}

/** Primes/resumes the shared AudioContext synchronously. Call this at the
    top of any pointer/click handler whose own sound is actually scheduled
    for later (e.g. behind a hold-timer) - browsers only treat context
    creation/resume as gesture-backed while it happens inside the gesture's
    own synchronous call stack, not inside a setTimeout queued from it. */
export function primeAudio() {
  ac();
}

/** Rushing wind for the upside-down flip. */
export function whoosh() {
  burst({ duration: 0.85, from: 260, to: 2600, gain: 0.2, q: 0.5 });
  window.setTimeout(() => burst({ duration: 0.7, from: 2400, to: 300, gain: 0.16, q: 0.5 }), 700);
}

/* ------------------------------------------------------ ambient location -- */

export type Ambience = "rain" | "cafe" | "traffic" | "night";

let ambientNodes: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

/**
 * A looping impression of a place, for the travelogue's map pins. Filtered
 * noise, not a recording - close enough to set a mood, honest about being a
 * sketch. Only one ever plays at a time.
 */
export function playAmbient(kind: Ambience) {
  const c = ac();
  if (!c || muted) return;
  stopAmbient();

  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.loop = true;

  const filter = c.createBiquadFilter();
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, c.currentTime);

  switch (kind) {
    case "rain":
      filter.type = "highpass";
      filter.frequency.value = 1400;
      src.playbackRate.value = 1.1;
      gain.gain.exponentialRampToValueAtTime(0.14, c.currentTime + 1.2);
      break;
    case "cafe":
      /* A low murmur: most of the energy under 700Hz, nothing bright. */
      filter.type = "lowpass";
      filter.frequency.value = 700;
      src.playbackRate.value = 0.35;
      gain.gain.exponentialRampToValueAtTime(0.2, c.currentTime + 1.2);
      break;
    case "traffic":
      filter.type = "lowpass";
      filter.frequency.value = 340;
      src.playbackRate.value = 0.22;
      gain.gain.exponentialRampToValueAtTime(0.24, c.currentTime + 1.4);
      break;
    case "night":
      filter.type = "bandpass";
      filter.frequency.value = 3200;
      filter.Q.value = 0.8;
      src.playbackRate.value = 0.8;
      gain.gain.exponentialRampToValueAtTime(0.07, c.currentTime + 1.6);
      break;
  }

  src.connect(filter).connect(gain).connect(master!);
  src.start();
  ambientNodes = { src, gain };
}

export function stopAmbient() {
  if (!ambientNodes || !ctx) return;
  const { src, gain } = ambientNodes;
  ambientNodes = null;
  gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
  window.setTimeout(() => {
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
  }, 900);
}
