import { SEA, type SeaState } from "../game/sea";
import type { Point } from "../game/world";
import type { AudioEngine } from "./engine";
import { SfxGate, type VoiceLimit } from "./gate";
import { batchLevel, catchDegree, catchStreamLevel } from "./mapping";
import { rewardPhrase } from "./patterns";
import { bass, bell, brass, noise, pluck, pop, run, windNoise, type NoiseRiser } from "./synth";
import { degreeToHz, type Key } from "./theory";

/*
 * Sound effects, all synthesised and all in the music's key. Late rounds capture hundreds of fish a
 * second, so every kind of sound is rate-limited, and catches arriving together become one richer
 * note instead of a pile of them.
 */

type SfxKind =
  | "catch" | "current" | "bounce" | "launch" | "implode" | "burst" | "bonus" | "chime" | "frenzy" | "shimmer" | "golden"
  | "plop" | "treasure" | "bounty" | "achievement"
  | "trapSnap" | "seine" | "snag" | "chum" | "trapCast" | "thunder" | "foghorn" | "bubble";

const LIMITS: Record<SfxKind, VoiceLimit> = {
  thunder: { gap: 8, voices: 1 },
  foghorn: { gap: 4, voices: 1 },
  bubble: { gap: 0.5, voices: 1 },
  trapSnap: { gap: 0.12, voices: 2 },
  seine: { gap: 0.35, voices: 1 },
  snag: { gap: 0.6, voices: 1 },
  chum: { gap: 0.9, voices: 1 },
  trapCast: { gap: 1.5, voices: 1 },
  catch: { gap: 0.04, voices: 4 },
  current: { gap: 0.12, voices: 2 },
  bounce: { gap: 0.07, voices: 2 },
  launch: { gap: 0.15, voices: 1 },
  implode: { gap: 0.5, voices: 1 },
  burst: { gap: 0.08, voices: 2 },
  bonus: { gap: 0.15, voices: 1 },
  chime: { gap: 0 },
  frenzy: { gap: 0 },
  shimmer: { gap: 0.3, voices: 1 },
  golden: { gap: 0.12, voices: 2 },
  plop: { gap: 0.2, voices: 1 },
  treasure: { gap: 0.5, voices: 1 },
  bounty: { gap: 0.5, voices: 1 },
  achievement: { gap: 1.2, voices: 1 },
};
const MAX_VOICES = 8;
/** How long a catch counts as sounding, s: the audible part of its tail. */
const CATCH_LENGTH = 0.16;
/** Gap between the notes of an Electric current, s: one note per jump. */
const CURRENT_STEP = 0.045;
const MAX_CURRENT_NOTES = 9;
/** Gap between the notes of the Feeding Frenzy sting's run, s. */
const FRENZY_STEP = 0.06;

/** Peak levels, before the effects volume. */
const LEVEL = {
  catch: 0.24, current: 0.07, bounce: 0.06, launch: 0.09, implode: 0.13, burst: 0.12, bonus: 0.07, chime: 0.11, frenzy: 0.1,
  shimmer: 0.045, golden: 0.1, plop: 0.13, treasure: 0.1, bounty: 0.08, achievement: 0.09,
};
/** Gap between the notes of a golden shimmer, s. */
const SHIMMER_STEP = 0.045;

function pickOne(items: readonly number[]): number {
  return items[Math.floor(Math.random() * items.length)] ?? items[0] ?? 0;
}

export class Sfx {
  private gate = new SfxGate(MAX_VOICES, LIMITS);
  /** Start times of recent catch notes, to tell a steady stream from the odd catch. */
  private recentCatches: number[] = [];
  private wind: NoiseRiser | null = null;
  private sea: SeaState = "clear";
  private nextBubble = 0;

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
  catches(count: number, combo: number): number | null {
    const ctx = this.ctx;
    if (!ctx || count <= 0) return null;
    // Batch only this frame. A blocked catch is dropped, never replayed after its fish is gone.
    const voice = this.start("catch", CATCH_LENGTH);
    if (!voice) return null;
    this.recentCatches = this.recentCatches.filter((time) => voice.time - time < 0.5);
    this.recentCatches.push(voice.time);
    const level = batchLevel(count);
    const gain = LEVEL.catch * level * catchStreamLevel(this.recentCatches.length);
    const freq = this.hz(catchDegree(combo));
    pluck(ctx, voice.out, { time: voice.time, freq, gain, decay: 0.3, bright: 0.25 + 0.2 * (level - 1) });
    // Several at once: add the octave above, for a fuller note rather than a louder one.
    if (count >= 3) {
      pluck(ctx, voice.out, { time: voice.time, freq: freq * 2, gain: (gain * (level - 1)) / 1.2, decay: 0.22, bright: 0.1 });
    }
    return voice.time;
  }

  /** Maintains quiet weather on the effects bus; repeated frames never allocate more wind sources. */
  weather(state: SeaState, wind: Point): void {
    const ctx = this.ctx;
    if (state !== this.sea) {
      this.stopWeather();
      this.sea = state;
      this.nextBubble = 0;
      if (state === "fog") {
        const voice = this.start("foghorn", 2.4);
        if (voice) brass(voice.ctx, voice.out, voice.time, this.hz(0, 2), 0.045, 2.4);
      }
    }
    if (!ctx) return;
    if (state === "storm") {
      this.wind ??= windNoise(ctx, this.engine.sfx);
      this.wind.setLevel((Math.hypot(wind.x, wind.y) - SEA.stormBase) / (SEA.stormGust - SEA.stormBase));
    } else if (state === "bloom" && ctx.currentTime >= this.nextBubble) {
      this.nextBubble = ctx.currentTime + 0.8;
      const voice = this.start("bubble", 0.2);
      if (voice) pop(ctx, voice.out, voice.time, this.hz(2, 4), 0.018);
    }
  }

  /** Releases a continuous bed on pause or screen exit; resuming does not replay the foghorn. */
  stopWeather(): void {
    this.wind?.stop();
    this.wind = null;
  }

  /** A distant, low rumble accompanying the shared soft-lightning envelope. */
  thunder(): void {
    const voice = this.start("thunder", 3);
    if (!voice) return;
    noise(voice.ctx, voice.out, { time: voice.time, gain: 0.1, attack: 0.45, decay: 2.5, filter: "lowpass", from: 240, to: 65, q: 0.5 });
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
      lfo.disconnect();
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

  /**
   * A Feeding Frenzy wave rolling in: a rising whoosh of surf under a quick run up the scale that
   * lands on two bells. Always plays, however busy the catches are.
   */
  frenzy(): void {
    const degrees = [3, 4, 5, 6, 7, 8];
    const voice = this.start("frenzy", 1.3, true);
    if (!voice) return;
    const { ctx, time, out } = voice;
    noise(ctx, out, { time, gain: LEVEL.frenzy * 1.2, attack: 0.3, decay: 0.8, filter: "bandpass", from: 250, to: 2400, q: 0.9 });
    run(ctx, out, { time, freqs: degrees.map((degree) => this.hz(degree)), stepSeconds: FRENZY_STEP, gain: LEVEL.frenzy });
    const land = time + degrees.length * FRENZY_STEP;
    for (const degree of [10, 12]) bell(ctx, out, land, this.hz(degree), LEVEL.frenzy * 0.7, 1.1);
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

  /** All traps snapping this frame share one creak, splash and low wooden knock. */
  trapSnaps(count: number): void {
    if (count <= 0) return;
    const voice = this.start("trapSnap", 0.42);
    if (!voice) return;
    const { ctx, time, out } = voice;
    const gain = 0.065 * (1 + Math.min(3, count - 1) * 0.1);
    noise(ctx, out, { time, gain: gain * 0.65, attack: 0.015, decay: 0.13, filter: "bandpass", from: this.hz(0, 3), to: this.hz(2, 3), q: 14 });
    noise(ctx, out, { time: time + 0.035, gain: gain * 0.7, attack: 0.008, decay: 0.2, filter: "highpass", from: 1400, to: 700 });
    pluck(ctx, out, { time: time + 0.025, freq: this.hz(0, 2), gain, decay: 0.12, bright: 0.08 });
  }

  /** A quiet keyed rope pluck, with a deliberately long gap under a busy seine. */
  seineHit(): void {
    const voice = this.start("seine", 0.2);
    if (!voice) return;
    pluck(voice.ctx, voice.out, { time: voice.time, freq: this.hz(2, 4), gain: 0.028, decay: 0.15, bright: 0.06 });
  }

  /** The chest meets the rope: a low clunk under a short, rising stretch. */
  snag(): void {
    const voice = this.start("snag", 0.5);
    if (!voice) return;
    const { ctx, time, out } = voice;
    pop(ctx, out, time, this.hz(0, 2), 0.09);
    noise(ctx, out, { time: time + 0.025, gain: 0.055, attack: 0.06, decay: 0.26, filter: "bandpass", from: this.hz(0, 3), to: this.hz(3, 3), q: 18 });
  }

  /** A larger splash followed by a falling, bubbly gurgle. */
  chum(): void {
    const voice = this.start("chum", 0.9);
    if (!voice) return;
    const { ctx, time, out } = voice;
    noise(ctx, out, { time, gain: 0.14, attack: 0.025, decay: 0.4, filter: "lowpass", from: 2200, to: 350 });
    for (let i = 0; i < 6; i++) {
      pop(ctx, out, time + 0.13 + i * 0.085, this.hz(5 - i % 4, 3), 0.045 * (1 - i * 0.1));
    }
  }

  /** One cast gets three soft plops, regardless of the number of nets thrown. */
  trapCast(): void {
    const voice = this.start("trapCast", 0.8);
    if (!voice) return;
    const { ctx, time, out } = voice;
    for (const [i, degree] of [0, 2, 1].entries()) {
      const at = time + i * 0.15;
      pop(ctx, out, at, this.hz(degree, 3), 0.055);
      noise(ctx, out, { time: at + 0.01, gain: 0.018, attack: 0.005, decay: 0.1, filter: "highpass", from: 900 });
    }
  }

  /** A treasure chest opening: a creaking hinge, a soft thud as the lid falls back, then coins. */
  treasure(): void {
    const voice = this.start("treasure", 1.4);
    if (!voice) return;
    const { ctx, time, out } = voice;
    // The creak: a narrow band of noise squeezed upwards, then a lower one as the lid settles.
    noise(ctx, out, { time, gain: LEVEL.treasure * 0.9, attack: 0.06, decay: 0.3, filter: "bandpass", from: 320, to: 950, q: 18 });
    noise(ctx, out, { time: time + 0.2, gain: LEVEL.treasure * 0.6, attack: 0.04, decay: 0.2, filter: "bandpass", from: 700, to: 420, q: 16 });
    pop(ctx, out, time + 0.32, this.hz(0, 2), LEVEL.treasure * 1.2);
    // Coins: quick clinks high in the scale, tumbling out.
    for (let i = 0; i < 9; i++) {
      const at = time + 0.38 + i * 0.055 + Math.random() * 0.025;
      bell(ctx, out, at, this.hz(pickOne([10, 11, 12, 13, 14, 15])), LEVEL.treasure * (0.9 - i * 0.07), 0.22);
    }
  }

  /** A completed bounty: three bright notes and a small bell, about half a second. */
  bounty(): void {
    const voice = this.start("bounty", 0.55);
    if (!voice) return;
    const { ctx, time, out } = voice;
    for (const note of rewardPhrase("bounty")) {
      pluck(ctx, out, { time: time + note.offset, freq: this.hz(note.degree), gain: LEVEL.bounty, decay: note.length - 0.003, bright: 0.4 });
    }
    bell(ctx, out, time + 0.24, this.hz(10), LEVEL.bounty * 0.55, 0.25);
  }

  /** An earned achievement: five soft brass notes and a high shimmer, about 1.2 seconds. */
  achievement(): void {
    const voice = this.start("achievement", 1.25);
    if (!voice) return;
    const { ctx, time, out } = voice;
    for (const note of rewardPhrase("achievement")) {
      brass(ctx, out, time + note.offset, this.hz(note.degree), LEVEL.achievement, note.length);
    }
    for (const [i, degree] of [10, 12, 15].entries()) {
      bell(ctx, out, time + 0.7 + i * 0.12, this.hz(degree), LEVEL.achievement * 0.3, 0.22);
    }
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
