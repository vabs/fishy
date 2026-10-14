import type { AudioEngine } from "./engine";
import { SfxGate, type VoiceLimit } from "./gate";
import { batchLevel, catchDegree, catchStreamLevel } from "./mapping";
import { bass, bell, noise, pluck, pop, run } from "./synth";
import { degreeToHz, type Key } from "./theory";

/*
 * Sound effects, all synthesised and all in the music's key. Late rounds capture hundreds of fish a
 * second, so every kind of sound is rate-limited, and catches arriving together become one richer
 * note instead of a pile of them.
 */

type SfxKind =
  | "catch" | "current" | "bounce" | "launch" | "implode" | "burst" | "bonus" | "chime" | "shimmer" | "golden" | "plop";

const LIMITS: Record<SfxKind, VoiceLimit> = {
  catch: { gap: 0.04, voices: 4 },
  current: { gap: 0.12, voices: 2 },
  bounce: { gap: 0.07, voices: 2 },
  launch: { gap: 0.15, voices: 1 },
  implode: { gap: 0.5, voices: 1 },
  burst: { gap: 0.08, voices: 2 },
  bonus: { gap: 0.15, voices: 1 },
  chime: { gap: 0 },
  shimmer: { gap: 0.3, voices: 1 },
  golden: { gap: 0.12, voices: 2 },
  plop: { gap: 0.2, voices: 1 },
};
const MAX_VOICES = 8;
/** Catches still waiting for a voice after this long are dropped: they'd sound late. */
const CATCH_PATIENCE = 0.15;
/** How long a catch counts as sounding, s: the audible part of its tail. */
const CATCH_LENGTH = 0.16;
/** Gap between the notes of an Electric current, s: one note per jump. */
const CURRENT_STEP = 0.045;
const MAX_CURRENT_NOTES = 9;

/** Peak levels, before the effects volume. */
const LEVEL = {
  catch: 0.24, current: 0.07, bounce: 0.06, launch: 0.09, implode: 0.13, burst: 0.12, bonus: 0.07, chime: 0.11,
  shimmer: 0.045, golden: 0.1, plop: 0.13,
};
/** Gap between the notes of a golden shimmer, s. */
const SHIMMER_STEP = 0.045;

function pickOne(items: readonly number[]): number {
  return items[Math.floor(Math.random() * items.length)] ?? items[0] ?? 0;
}

export class Sfx {
  private gate = new SfxGate(MAX_VOICES, LIMITS);
  private pending = { count: 0, combo: 0, since: 0 };
  /** Start times of recent catch notes, to tell a steady stream from the odd catch. */
  private recentCatches: number[] = [];

  constructor(
    private readonly engine: AudioEngine,
    private readonly key: () => Key,
  ) {}

  private get ctx(): AudioContext | null {
    return this.engine.running ? this.engine.ctx : null;
  }

  /** A start time for a voice of `kind`, or null if it's rate-limited or sound is off. */
  private start(kind: SfxKind, length: number, force = false): { ctx: AudioContext; time: number; out: AudioNode } | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const time = ctx.currentTime + 0.005;
    return this.gate.tryStart(kind, time, length, force) ? { ctx, time, out: this.engine.sfx } : null;
  }

  private hz(degree: number, octave = 4): number {
    return degreeToHz(this.key(), degree, octave);
  }

  /** `count` fish caught this frame; `combo` is the highest combo count among them. */
  catches(count: number, combo: number): void {
    const ctx = this.ctx;
    if (!ctx || count <= 0) return;
    if (this.pending.count === 0) this.pending.since = ctx.currentTime;
    this.pending.count += count;
    this.pending.combo = Math.max(this.pending.combo, combo);
    this.flush();
  }

  /** Plays waiting catches once a catch voice is free. Call every frame. */
  flush(): void {
    const pending = this.pending;
    if (pending.count === 0) return;
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - pending.since > CATCH_PATIENCE) {
      pending.count = 0;
      pending.combo = 0;
      return;
    }
    const voice = this.start("catch", CATCH_LENGTH);
    if (!voice) return;
    this.recentCatches = this.recentCatches.filter((time) => voice.time - time < 0.5);
    this.recentCatches.push(voice.time);
    const level = batchLevel(pending.count);
    const gain = LEVEL.catch * level * catchStreamLevel(this.recentCatches.length);
    const freq = this.hz(catchDegree(pending.combo));
    pluck(ctx, voice.out, { time: voice.time, freq, gain, decay: 0.3, bright: 0.25 + 0.2 * (level - 1) });
    // Several at once: add the octave above, for a fuller note rather than a louder one.
    if (pending.count >= 3) {
      pluck(ctx, voice.out, { time: voice.time, freq: freq * 2, gain: (gain * (level - 1)) / 1.2, decay: 0.22, bright: 0.1 });
    }
    pending.count = 0;
    pending.combo = 0;
  }

  /** An Electric current: one rising note per jump. */
  current(jumps: number): void {
    const notes = Math.min(Math.max(jumps, 0) + 1, MAX_CURRENT_NOTES);
    const voice = this.start("current", notes * CURRENT_STEP + 0.15);
    if (!voice) return;
    const first = pickOne([0, 1, 2]);
    const freqs = Array.from({ length: notes }, (_, i) => this.hz(first + i));
    run(voice.ctx, voice.out, { time: voice.time, freqs, stepSeconds: CURRENT_STEP, gain: LEVEL.current });
  }

  /** A Star fish bouncing off the edge: a glass ping, high in the scale. */
  bounce(): void {
    const voice = this.start("bounce", 0.2);
    if (!voice) return;
    bell(voice.ctx, voice.out, voice.time, this.hz(pickOne([10, 12, 13])), LEVEL.bounce, 0.35);
  }

  /** A Star fish launching: a soft whoosh. */
  launch(): void {
    const voice = this.start("launch", 0.4);
    if (!voice) return;
    noise(voice.ctx, voice.out, { time: voice.time, gain: LEVEL.launch, attack: 0.12, decay: 0.3, filter: "bandpass", from: 350, to: 2600, q: 1.4 });
  }

  /** A Whirlpool imploding: a swirl of filtered noise spiralling down, over a low tonic. */
  implode(caught: number): void {
    const voice = this.start("implode", 1);
    if (!voice) return;
    const { ctx, time, out } = voice;
    const gain = LEVEL.implode * (0.7 + 0.3 * Math.min(1, caught / 30));
    // The swirl: a tremolo that slows down as the pitch falls.
    const swirl = ctx.createGain();
    swirl.gain.value = 0.6;
    swirl.connect(out);
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(10, time);
    lfo.frequency.exponentialRampToValueAtTime(3, time + 1);
    const depth = ctx.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth).connect(swirl.gain);
    const { end } = noise(ctx, swirl, { time, gain, attack: 0.08, decay: 0.9, filter: "bandpass", from: 1800, to: 160, q: 4 });
    lfo.start(time);
    lfo.stop(end + 0.05);
    lfo.onended = () => {
      depth.disconnect();
      swirl.disconnect();
    };
    bass(ctx, out, time + 0.05, this.hz(0, 2), gain * 0.8, 0.8);
  }

  /** A Goober bursting: a soft pop. */
  burst(): void {
    const voice = this.start("burst", 0.12);
    if (!voice) return;
    pop(voice.ctx, voice.out, voice.time, this.hz(pickOne([5, 7, 8])), LEVEL.burst);
  }

  /** Time added to the round: a tiny bell. */
  timeBonus(): void {
    const voice = this.start("bonus", 0.3);
    if (!voice) return;
    bell(voice.ctx, voice.out, voice.time, this.hz(12), LEVEL.bonus, 0.45);
  }

  /** A golden fish appearing: a quiet glissando of high bells, rising. */
  shimmer(): void {
    const degrees = [10, 11, 12, 13, 14, 15];
    const voice = this.start("shimmer", degrees.length * SHIMMER_STEP + 0.6);
    if (!voice) return;
    degrees.forEach((degree, i) => {
      bell(voice.ctx, voice.out, voice.time + i * SHIMMER_STEP, this.hz(degree), LEVEL.shimmer * (1 - i * 0.08), 0.6);
    });
  }

  /** A golden fish caught: a bright chime, a rising arpeggio that rings out, topped with a sparkle. */
  goldenCatch(): void {
    const degrees = [5, 7, 8, 10];
    const voice = this.start("golden", 1.3);
    if (!voice) return;
    const { ctx, time, out } = voice;
    degrees.forEach((degree, i) => bell(ctx, out, time + i * 0.055, this.hz(degree), LEVEL.golden, 1.1));
    pluck(ctx, out, { time: time + 0.22, freq: this.hz(15), gain: LEVEL.golden * 0.7, decay: 0.5, overtone: 5.4, bright: 0.5 });
  }

  /** A golden fish getting away: a soft, low plop and a whisper of splash. */
  plop(): void {
    const voice = this.start("plop", 0.3);
    if (!voice) return;
    const { ctx, time, out } = voice;
    pop(ctx, out, time, this.hz(pickOne([0, 2]), 3), LEVEL.plop);
    noise(ctx, out, { time: time + 0.02, gain: LEVEL.plop * 0.25, attack: 0.005, decay: 0.12, filter: "highpass", from: 2500 });
  }

  /** A purchase in the tech tree: a two-note chime, or a little arpeggio for unlocking a fish. */
  purchase(unlock: boolean): void {
    const degrees = unlock ? [5, 7, 8, 10] : [8, 10];
    const voice = this.start("chime", 0.6, true);
    if (!voice) return;
    degrees.forEach((degree, i) => {
      bell(voice.ctx, voice.out, voice.time + i * 0.08, this.hz(degree), LEVEL.chime, unlock ? 1.4 : 1);
    });
  }

  /** A single catch, so the player can hear the effects volume while setting it. */
  preview(): void {
    this.catches(1, 0);
  }
}
