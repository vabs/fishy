import { fetchManifest, loadTrack, type LoadedTrack, type LoopBuffer } from "./loader";
import type { LayerName, MusicManifest } from "./manifest";
import {
  BED_STYLES,
  PATTERN_STEPS,
  arpForStep,
  chordForBar,
  grooveForBar,
  isChordStart,
  melodyForBar,
  type BedStyle,
  type Chord,
  type GrooveHit,
  type MelodyNote,
} from "./patterns";
import { bass, bell, kick, noise, pad, pluck } from "./synth";
import {
  BEATS_PER_BAR,
  DEFAULT_BPM,
  DEFAULT_KEY,
  barLength,
  beatLength,
  degreeToHz,
  loopTempo,
  nextBeat,
  nextDownbeat,
  stepIndexAt,
  stepTime,
  stepsPerBar,
  type Clock,
  type Key,
} from "./theory";

/*
 * The music: one continuous bed that never restarts, with layers on top.
 *
 *   bed (loop file, or generated) ─┐
 *   groove layer ──────────────────┼→ low-pass filter → music gain
 *   combo layer ───────────────────┘
 *   round-end stinger ─────────────────────────────────→ music gain
 *
 * The hub hears the bed through the low-pass, quieter, as if from under water. A round opens the
 * filter into the next downbeat and brings in the groove; the combo layer follows the combo
 * multiplier. Chapters (see CHAPTERS) crossfade between beds on a bar line.
 *
 * Notes are scheduled a little ahead of time from a timer, on the AudioContext clock, so timing is
 * sample-accurate however busy the main thread is.
 */

export type MusicMode = "hub" | "round" | "final" | "end";

/** How far ahead notes are scheduled, s: enough to ride out a slow frame, short enough for the combo layer to react. */
const LOOKAHEAD = 0.3;
const TICK_MS = 50;
/** A step this late (s) is skipped rather than played late, e.g. after the main thread stalled. */
const LATE = 0.02;

/** The hub hears the music from under water: low-passed and 6 dB down. */
const HUB_CUTOFF = 700;
const OPEN_CUTOFF = 16000;
const HUB_LEVEL = 0.5;
const END_LEVEL = 0.85;
/** Chapter change, s. */
const CROSSFADE = 3;
/** Fade-in when the music first starts, s. */
const FIRST_FADE = 2.5;
/** The Final Round always has some of the combo layer. */
const FINAL_COMBO_FLOOR = 0.35;
/** Swing: off-beat eighths of the groove land this share of a beat late. */
const SWING = 0.08;

/** Levels of the generated parts, before the music volume. Kept low: the music sits behind the game. */
const LEVEL = { pad: 0.02, melody: 0.1, kick: 0.16, shaker: 0.03, bass: 0.08, arp: 0.07, stinger: 0.1 };

/** Sets a parameter's course from `now`: hold until `start`, then ramp to `value` by `end`. */
function glide(param: AudioParam, now: number, value: number, start: number, end: number, exponential = false): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  if (start > now) param.setValueAtTime(param.value, start);
  if (exponential) param.exponentialRampToValueAtTime(Math.max(value, 0.0001), end);
  else param.linearRampToValueAtTime(value, end);
}

function gainNode(ctx: AudioContext, value: number, dest: AudioNode): GainNode {
  const gain = ctx.createGain();
  gain.gain.value = value;
  gain.connect(dest);
  return gain;
}

interface Buses {
  bed: AudioNode;
  groove: AudioNode;
  combo: AudioNode;
}

/** One chapter's bed. Crossfades through its faders; stopped beds are forgotten once silent. */
abstract class Bed {
  /** When the bed stops (Infinity while playing). */
  stopAt = Infinity;
  private faders: GainNode[] = [];

  constructor(
    protected readonly ctx: AudioContext,
    readonly chapter: number,
    readonly clock: Clock,
    readonly key: Key,
  ) {}

  /** The chord at a time, for the layers to follow. Null when unknown (a loop file). */
  abstract chordAt(time: number): Chord | null;
  /** Schedules the bed's own notes up to `until`. */
  abstract schedule(until: number, now: number): void;

  /** True when a loop file stem plays this layer instead of the generated one. */
  hasStem(_layer: LayerName): boolean {
    return false;
  }

  /** Sets the level of a stem (combo stems follow the combo). */
  setStem(_layer: LayerName, _level: number, _now: number): void {}

  protected fader(dest: AudioNode): GainNode {
    const gain = gainNode(this.ctx, 0, dest);
    this.faders.push(gain);
    return gain;
  }

  fadeIn(at: number, seconds: number): void {
    for (const { gain } of this.faders) {
      gain.setValueAtTime(0, at);
      gain.linearRampToValueAtTime(1, at + seconds);
    }
  }

  fadeOut(at: number, seconds: number): void {
    for (const { gain } of this.faders) {
      gain.cancelScheduledValues(at);
      gain.setTargetAtTime(0, at, seconds / 5);
    }
    this.stopAt = at + seconds;
  }

  dispose(): void {
    for (const fader of this.faders) fader.disconnect();
  }
}

/** The placeholder bed, generated in code: a soft pad and a sparse marimba line, different every bar. */
class GeneratedBed extends Bed {
  private readonly style: BedStyle;
  private readonly out: GainNode;
  private nextStep = 0;
  private melody: { bar: number; notes: MelodyNote[] } = { bar: -1, notes: [] };

  constructor(ctx: AudioContext, dest: AudioNode, chapter: number, start: number) {
    super(ctx, chapter, { origin: start, bpm: DEFAULT_BPM, beatsPerBar: BEATS_PER_BAR }, DEFAULT_KEY);
    this.style = BED_STYLES[chapter] ?? BED_STYLES[0]!;
    this.out = this.fader(dest);
  }

  chordAt(time: number): Chord {
    return chordForBar(this.style, Math.max(0, Math.floor((time - this.clock.origin) / barLength(this.clock))));
  }

  schedule(until: number, now: number): void {
    for (; ; this.nextStep++) {
      const time = stepTime(this.clock, this.nextStep);
      if (time >= until || time >= this.stopAt) return;
      if (time >= now - LATE) this.play(this.nextStep, time);
    }
  }

  private play(index: number, time: number): void {
    const { ctx, style, key, out } = this;
    const bar = Math.floor(index / PATTERN_STEPS);
    const step = index % PATTERN_STEPS;
    if (step === 0 && isChordStart(style, bar)) {
      const chord = chordForBar(style, bar);
      const freqs = [degreeToHz(key, chord.bass, 2), ...chord.pad.map((degree) => degreeToHz(key, degree))];
      pad(ctx, out, { time, freqs, gain: LEVEL.pad, length: style.barsPerChord * barLength(this.clock), cutoff: style.padCutoff });
    }
    if (this.melody.bar !== bar) this.melody = { bar, notes: melodyForBar(style, bar) };
    const kalimba = style.voice === "kalimba";
    for (const note of this.melody.notes) {
      if (note.step !== step) continue;
      pluck(ctx, out, {
        time,
        freq: degreeToHz(key, note.degree),
        gain: LEVEL.melody * note.velocity,
        decay: kalimba ? 1.4 : 1.1,
        overtone: kalimba ? 5.4 : 3.93,
        bright: kalimba ? 0.18 : 0.3,
      });
    }
  }
}

/** A chapter's loop file (and stems), looping gaplessly between its loop points. */
class LoopBed extends Bed {
  private sources: AudioBufferSourceNode[] = [];
  private stems: Partial<Record<LayerName, GainNode>> = {};

  constructor(ctx: AudioContext, buses: Buses, chapter: number, loaded: LoadedTrack, start: number) {
    const { track, bed } = loaded;
    const bpm = loopTempo(bed.loopEnd - bed.loopStart, track.bpm, track.beatsPerBar);
    super(ctx, chapter, { origin: start, bpm, beatsPerBar: track.beatsPerBar }, track.key);
    const trim = 10 ** (track.gainDb / 20);
    this.play(bed, this.fader(buses.bed), trim, start);
    for (const layer of ["groove", "combo"] as const) {
      const stem = loaded.layers[layer];
      if (!stem) continue;
      // Groove stems are gated by the groove bus; combo stems also follow the combo.
      const level = gainNode(ctx, layer === "combo" ? 0 : 1, buses[layer]);
      this.stems[layer] = level;
      this.play(stem, this.fader(level), trim, start);
    }
  }

  private play(loop: LoopBuffer, dest: AudioNode, trim: number, start: number): void {
    const source = this.ctx.createBufferSource();
    source.buffer = loop.buffer;
    source.loop = true;
    source.loopStart = loop.loopStart;
    source.loopEnd = loop.loopEnd;
    source.connect(gainNode(this.ctx, trim, dest));
    source.start(start);
    this.sources.push(source);
  }

  chordAt(): null {
    return null;
  }

  schedule(): void {}

  override hasStem(layer: LayerName): boolean {
    return this.stems[layer] !== undefined;
  }

  override setStem(layer: LayerName, level: number, now: number): void {
    this.stems[layer]?.gain.setTargetAtTime(level, now, 0.15);
  }

  override fadeOut(at: number, seconds: number): void {
    super.fadeOut(at, seconds);
    for (const source of this.sources) source.stop(this.stopAt + 0.1);
  }
}

export class Music {
  private ctx: AudioContext | null = null;
  private filter!: BiquadFilterNode;
  private buses!: Record<keyof Buses | "stinger", GainNode>;
  private beds: Bed[] = [];
  private current: Bed | null = null;
  /** Null until fetched. */
  private manifest: MusicManifest | null = null;
  private base: URL | null = null;
  private loads = new Map<number, Promise<LoadedTrack | null>>();
  private chapter = 0;
  private mode: MusicMode = "hub";
  private combo = 0;
  /** The generated layers' grid, and their next step on it. */
  private layerClock: Clock | null = null;
  private layerStep = 0;
  /** The groove and combo layers play between these times. */
  private layersFrom = Infinity;
  private layersUntil = Infinity;
  private groove: { bar: number; hits: GrooveHit[] } = { bar: -1, hits: [] };

  /** The key the music is in, for sound effects to match. */
  get key(): Key {
    return this.current?.key ?? DEFAULT_KEY;
  }

  /** Builds the graph and starts the bed. Called once, when the AudioContext exists. */
  start(ctx: AudioContext, output: AudioNode): void {
    this.ctx = ctx;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.6;
    this.filter.frequency.value = HUB_CUTOFF;
    this.filter.connect(output);
    this.buses = {
      bed: gainNode(ctx, HUB_LEVEL, this.filter),
      groove: gainNode(ctx, 0, this.filter),
      combo: gainNode(ctx, 0, this.filter),
      stinger: gainNode(ctx, 1, output),
    };
    window.setInterval(() => this.pump(), TICK_MS);
    void fetchManifest().then(({ manifest, base }) => {
      this.manifest = manifest;
      this.base = base;
      void this.switchBed();
    });
  }

  setMode(mode: MusicMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode !== "round" && mode !== "final") this.combo = 0;
    this.applyMode(false);
  }

  /** Switches to a chapter's bed with a crossfade on the next bar line. */
  setChapter(chapter: number): void {
    if (chapter === this.chapter) return;
    this.chapter = chapter;
    if (this.manifest) void this.switchBed();
  }

  /** How much of the combo layer to play, 0 to 1. */
  setCombo(level: number): void {
    if (Math.abs(level - this.combo) < 0.01) return;
    this.combo = level;
    if (this.ctx && this.current) this.current.setStem("combo", this.comboLevel, this.ctx.currentTime);
  }

  /** A one-bar phrase at the end of a round, resolving to the tonic, from the next beat. */
  stinger(final: boolean): void {
    const ctx = this.ctx;
    const bed = this.current;
    if (!ctx || !bed || ctx.state !== "running") return;
    const { key, clock } = bed;
    const eighth = beatLength(clock) / 2;
    const start = nextBeat(clock, ctx.currentTime + 0.03);
    // Up to the tonic: A B | D for a round, a two-octave climb for the Final Round.
    const climb = final ? [0, 2, 3, 5, 7, 8] : [3, 4];
    climb.forEach((degree, i) => {
      const gain = LEVEL.stinger * (0.6 + (0.4 * i) / climb.length);
      pluck(ctx, this.buses.stinger, { time: start + i * eighth, freq: degreeToHz(key, degree), gain, decay: 0.7 });
    });
    const land = start + climb.length * eighth;
    pluck(ctx, this.buses.stinger, { time: land, freq: degreeToHz(key, 5), gain: LEVEL.stinger, decay: 1.6 });
    for (const degree of final ? [5, 7, 8, 10] : [5, 7, 8]) {
      bell(ctx, this.buses.stinger, land, degreeToHz(key, degree), LEVEL.stinger * 0.45, final ? 3.2 : 2.2);
    }
  }

  /** Schedules what's due. Runs on a timer; calling it more often (e.g. every frame) is harmless. */
  pump(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const until = now + LOOKAHEAD;
    for (const bed of this.beds) bed.schedule(until, now);
    this.scheduleLayers(until, now);
    // Forget beds once they and their last notes' tails have faded out.
    this.beds = this.beds.filter((bed) => {
      if (now < bed.stopAt + 3) return true;
      bed.dispose();
      return false;
    });
  }

  private get comboLevel(): number {
    if (this.mode === "final") return Math.max(this.combo, FINAL_COMBO_FLOOR);
    return this.mode === "round" ? this.combo : 0;
  }

  private applyMode(instant: boolean): void {
    const ctx = this.ctx;
    const bed = this.current;
    if (!ctx || !bed) return;
    const now = ctx.currentTime;
    const { filter, buses } = this;
    const playing = this.mode === "round" || this.mode === "final";
    const cutoff = this.mode === "hub" ? HUB_CUTOFF : OPEN_CUTOFF;
    const level = this.mode === "hub" ? HUB_LEVEL : this.mode === "end" ? END_LEVEL : 1;
    const layers = playing ? 1 : 0;
    if (instant) {
      filter.frequency.setValueAtTime(cutoff, now);
      buses.bed.gain.setValueAtTime(level, now);
      buses.groove.gain.setValueAtTime(layers, now);
      buses.combo.gain.setValueAtTime(layers, now);
      this.layersFrom = playing ? now : Infinity;
      this.layersUntil = Infinity;
    } else if (playing) {
      // Sweep the filter open into the next downbeat; the groove comes in on it.
      const downbeat = nextDownbeat(bed.clock, now + 0.05);
      glide(filter.frequency, now, cutoff, now, downbeat, true);
      glide(buses.bed.gain, now, level, now, downbeat);
      glide(buses.groove.gain, now, 1, downbeat - 0.02, downbeat);
      glide(buses.combo.gain, now, 1, downbeat - 0.02, downbeat);
      this.layersFrom = downbeat;
      this.layersUntil = Infinity;
    } else {
      // The layers drop over a beat; the filter closes (or opens, for the end screen) over a bar.
      const beat = beatLength(bed.clock);
      const bar = barLength(bed.clock);
      glide(buses.groove.gain, now, 0, now, now + beat);
      glide(buses.combo.gain, now, 0, now, now + beat);
      this.layersUntil = Math.min(this.layersUntil, now + beat);
      glide(filter.frequency, now, cutoff, now, now + (this.mode === "end" ? 2 * bar : bar), true);
      glide(buses.bed.gain, now, level, now, now + bar);
    }
    bed.setStem("combo", this.comboLevel, now);
  }

  private async switchBed(): Promise<void> {
    const chapter = this.chapter;
    const loaded = await this.load(chapter);
    const ctx = this.ctx;
    // A newer switch took over while this one was loading, or this bed is already playing.
    if (!ctx || chapter !== this.chapter || this.current?.chapter === chapter) return;
    const now = ctx.currentTime;
    const previous = this.current;
    const start = previous ? nextDownbeat(previous.clock, now + 0.1) : now + 0.1;
    const bed = loaded ? new LoopBed(ctx, this.buses, chapter, loaded, start) : new GeneratedBed(ctx, this.buses.bed, chapter, start);
    bed.fadeIn(start, previous ? CROSSFADE : FIRST_FADE);
    previous?.fadeOut(start, CROSSFADE);
    this.beds.push(bed);
    this.current = bed;
    if (previous) bed.setStem("combo", this.comboLevel, now);
    else this.applyMode(true);
    this.keepLoaded(chapter);
  }

  private load(chapter: number): Promise<LoadedTrack | null> {
    const track = this.manifest?.chapters[chapter];
    if (!track || !this.ctx || !this.base) return Promise.resolve(null);
    let loading = this.loads.get(chapter);
    if (!loading) {
      loading = loadTrack(this.ctx, track, this.base);
      this.loads.set(chapter, loading);
    }
    return loading;
  }

  /** Keeps only this chapter's and the next one's audio: decoded loops take a lot of memory. */
  private keepLoaded(chapter: number): void {
    for (const loaded of [...this.loads.keys()]) if (loaded !== chapter && loaded !== chapter + 1) this.loads.delete(loaded);
    void this.load(chapter + 1);
  }

  private scheduleLayers(until: number, now: number): void {
    const bed = this.current;
    if (!bed) return;
    if (this.layerClock !== bed.clock) {
      // A new bed: the layers follow its grid from its first downbeat.
      this.layerClock = bed.clock;
      this.layerStep = stepIndexAt(bed.clock, now);
    }
    for (; ; this.layerStep++) {
      const time = stepTime(bed.clock, this.layerStep);
      if (time >= until) return;
      if (time >= now - LATE && time >= this.layersFrom && time < this.layersUntil) this.playLayers(bed, this.layerStep, time);
    }
  }

  private playLayers(bed: Bed, index: number, time: number): void {
    const ctx = this.ctx!;
    const perBar = stepsPerBar(bed.clock);
    const bar = Math.floor(index / perBar);
    const step = index % perBar;
    const chord = bed.chordAt(time);
    if (!bed.hasStem("groove")) {
      if (this.groove.bar !== bar) this.groove = { bar, hits: grooveForBar(bed.chapter + 1, bar) };
      const swing = step % 4 === 2 ? SWING * beatLength(bed.clock) : 0;
      for (const hit of this.groove.hits) if (hit.step === step) this.playHit(hit, time + swing, chord, bed.key);
    }
    if (!bed.hasStem("combo")) {
      const note = arpForStep(chord, index, this.comboLevel);
      if (note) {
        pluck(ctx, this.buses.combo, {
          time,
          freq: degreeToHz(bed.key, note.degree),
          gain: LEVEL.arp * note.velocity,
          decay: 0.4,
          overtone: 5.4,
          bright: 0.15,
        });
      }
    }
  }

  private playHit(hit: GrooveHit, time: number, chord: Chord | null, key: Key): void {
    const ctx = this.ctx!;
    const dest = this.buses.groove;
    switch (hit.sound) {
      case "kick":
        kick(ctx, dest, time, LEVEL.kick * hit.velocity);
        break;
      case "shaker":
        noise(ctx, dest, { time, gain: LEVEL.shaker * hit.velocity, attack: 0.004, decay: 0.07, filter: "highpass", from: 7000, q: 0.7 });
        break;
      case "bass":
        bass(ctx, dest, time, degreeToHz(key, chord?.bass ?? 0, 2), LEVEL.bass * hit.velocity, 0.45);
        break;
    }
  }
}
