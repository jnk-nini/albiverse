"use client";

import { useEffect, useState } from "react";

/* ============================================================================
   CH.10 SECRET WISHLIST - shared "R&D lab" logic

   Pure helpers shared by WishlistScreen.tsx and its sibling components
   (WishlistDuoInput, WishlistBoard, WishlistMatrix, WishlistFundTracker,
   WishlistSnippets). Nothing here talks to Supabase or touches the DOM
   directly - it's the deterministic, no-network "brain" behind the
   Investigation Board's insights and the Synergy Matrix's reports.

   Per Nini's explicit choice (2026-09-08, cost-guardrail conversation): the
   "GIFT IDEA INSIGHT" / "SYNERGY REPORT" text is templated/scripted, NOT a
   real LLM call. Free, instant, deterministic, no API key, no per-use cost -
   matches the standing guardrail rule that any new "smart"-feeling feature
   should avoid a paid API unless she explicitly asks for one. */

export type EntryMode = "snapshot" | "scientist";
export type Priority = "low" | "medium" | "high";

export interface WishlistClue {
  id: string;
  type: "photo" | "note" | "clipping" | "diagram";
  text: string;
  image: string | null;
  x: number;
  y: number;
  rotation: number;
  createdAt: string;
}

export interface WishlistEdge {
  a: string;
  b: string;
}

export interface WishlistSnippet {
  id: string;
  text: string;
  style: "web" | "academic";
  createdAt: string;
}

/** Deterministic string hash (djb2) - used everywhere a "random-looking but
 * stable across renders" number is needed (node positions, phase offsets,
 * which template copy to pick), so the same id always draws the same way. */
export function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return Math.abs(hash >>> 0);
}

/** 0..1 pseudo-random float seeded by a string, stable across renders. */
export function seededUnit(seed: string, salt = 0): number {
  const h = hashString(`${seed}:${salt}`);
  return (h % 10000) / 10000;
}

export function pick<T>(arr: T[], seed: string): T {
  return arr[hashString(seed) % arr.length];
}

/* --------------------------------------------------------- insight copy
   Both the Investigation Board and the Synergy Matrix boil down to the same
   shape of problem: given two short text snippets that describe things the
   partner likes/wants, produce a plausible-sounding "here's what connects
   them" sentence. One shared template bank keeps both features' voice
   consistent instead of drifting into two different tones. */

const CONNECTOR_TEMPLATES = [
  "Cross-referencing “{A}” and “{B}”: the pattern points toward something that blends both.",
  "“{A}” and “{B}” keep showing up together in the file — a combined gift is the strongest lead.",
  "The evidence lines up: whoever likes “{A}” this much probably wants it paired with “{B}”.",
  "Two data points, one target: “{A}” × “{B}” reads like the same wish said twice.",
  "Analysis complete — “{A}” and “{B}” triangulate on one idea worth chasing.",
];

/* Kept deliberately noun-agnostic - {A}/{B} get filled with either a short
   product name ("Leather Satchel") or a full observation ("wants colorful
   accessories"), and a template that forces either shape into "a {a} that…"
   reads fine for one and garbled for the other. Treating both as quoted
   topics rather than grammatical nouns keeps it readable either way. */
const SUGGESTION_TEMPLATES = [
  "One gift that speaks to both “{A}” and “{B}” beats two separate guesses.",
  "Look for something that ties “{A}” and “{B}” together in a single gift.",
  "The overlap between “{A}” and “{B}” points to one well-chosen gift, not two.",
  "A gift built around both “{A}” and “{B}” would land harder than either alone.",
  "Whatever covers both “{A}” and “{B}” at once is the strongest pick here.",
];

function shortLabel(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 28) return trimmed;
  return `${trimmed.slice(0, 26).trim()}…`;
}

/** The Investigation Board's "GIFT IDEA INSIGHT" - fires once enough clues
 * are strung together. Picks the two most-connected clues and narrates the
 * connection, then proposes a blended gift built from their words. */
export function investigationInsight(clues: WishlistClue[], edges: WishlistEdge[]): string | null {
  if (clues.length < 2 || edges.length === 0) return null;

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const ranked = clues
    .filter((c) => degree.has(c.id))
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
  if (ranked.length < 2) return null;

  const [a, b] = ranked;
  const seed = `${a.id}:${b.id}:${edges.length}`;
  const connector = pick(CONNECTOR_TEMPLATES, seed)
    .replace("{A}", shortLabel(a.text))
    .replace("{B}", shortLabel(b.text));
  const suggestion = pick(SUGGESTION_TEMPLATES, `${seed}:s`)
    .replace("{A}", shortLabel(a.text))
    .replace("{B}", shortLabel(b.text));

  return `${connector}\n\n${suggestion}`;
}

/** The Synergy Matrix's "SYNERGY REPORT" - same idea, driven by two or more
 * selected wishlist items instead of corkboard clues. */
export function synergyReport(labels: string[]): string {
  if (labels.length < 2) return "Select at least two items to cross-reference.";
  const [a, b, ...rest] = labels;
  const seed = labels.join("|");
  const connector = pick(CONNECTOR_TEMPLATES, seed)
    .replace("{A}", shortLabel(a))
    .replace("{B}", shortLabel(b));
  const suggestion = pick(SUGGESTION_TEMPLATES, `${seed}:s`)
    .replace("{A}", shortLabel(a))
    .replace("{B}", shortLabel(rest[0] ?? b));

  const header =
    labels.length > 2
      ? `SYNERGY REPORT — ${labels.length} nodes cross-referenced`
      : `SYNERGY REPORT — ${shortLabel(a)} × ${shortLabel(b)}`;

  return `${header}\n\n${connector}\n\n${suggestion}`;
}

/* ---------------------------------------------------------- sound synths
   No audio files - everything here is generated on the fly with the Web
   Audio API, so there's nothing that can ever 404 or need an asset drop.
   Shared by WishlistScreen and every sibling wishlist component so they all
   play through the same AudioContext instead of each opening its own. */

let sharedCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  if (sharedCtx.state === "suspended") sharedCtx.resume().catch(() => {});
  return sharedCtx;
}

export function playThwip() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1400, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.14);
  gain.gain.setValueAtTime(0.16, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.17);
}

function noiseBurst(ctx: AudioContext, duration: number, gainPeak: number, filterFreqStart: number, filterFreqEnd: number) {
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(filterFreqStart, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(filterFreqEnd, ctx.currentTime + duration);
  filter.Q.value = 0.8;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainPeak, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
}

export function playPaperRip() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  noiseBurst(ctx, 0.5, 0.28, 2200, 350);
  setTimeout(() => noiseBurst(ctx, 0.22, 0.18, 1400, 200), 90);
}

export function playScratch() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  noiseBurst(ctx, 0.08, 0.06, 3200, 2200);
}

/** A sharp, academic "locked in" tap - two quick detuned clicks rather than
 * the softer THWIP triangle sweep, so the two entry styles sound distinct. */
export function playBam() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  [760, 540].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.05);
    gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.05 + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.05);
    osc.stop(ctx.currentTime + i * 0.05 + 0.1);
  });
}

/** A low, sustained "computational hum" - the Synergy Matrix's analysis
 * whir while it draws lines toward the nucleus. */
export function playHum(durationSec = 0.9) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(70, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(130, ctx.currentTime + durationSec);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.15);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + durationSec + 0.05);
}

/** A bright, quick "camera pop" for a detected pattern or a completed shot. */
export function playPop() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1800, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.09);
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.11);
}

/** The Scientist entry's "molecular bond" snap on submit - two quick tones
 * converging to one, like the fields clicking into place. */
export function playBondSnap() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(320, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(640, ctx.currentTime + 0.12);
  gain.gain.setValueAtTime(0.14, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.23);
}

/* --------------------------------------------------------------- fund copy */

export function fundLabel(mode: EntryMode): string {
  return mode === "snapshot" ? "PETER'S DAILY BUGLE ADVANCE" : "GWEN'S ACADEMIC SCHOLARSHIP GRANTS";
}

/** Loosely parses a free-text price field ("$45", "~40", "40.50") into a
 * number for the fund visualization. Unparsable/empty prices count as a
 * small flat amount so an item still nudges its side of the tracker. */
export function parsePrice(price: string): number {
  const cleaned = price.replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : 8;
}

/* ------------------------------------------------------------ typewriter
   Reveals `text` a few characters at a time. Used by the Investigation
   Board's insight card and the Synergy Matrix's report sheet so both read
   like they're being typed out live rather than just appearing. */
export function useTypewriter(text: string, speedMs = 18): string {
  const [shown, setShown] = useState("");

  useEffect(() => {
    setShown("");
    if (!text) return;
    let i = 0;
    const step = () => {
      i += 1;
      setShown(text.slice(0, i));
    };
    const id = window.setInterval(() => {
      step();
      if (i >= text.length) window.clearInterval(id);
    }, speedMs);
    return () => window.clearInterval(id);
  }, [text, speedMs]);

  return shown;
}
