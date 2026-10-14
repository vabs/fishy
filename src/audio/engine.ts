import { sliderToGain, writeAudioSettings, type AudioSettings } from "./settings";

/** Seconds to fade the master volume when muting or unmuting, so it never clicks. */
const MUTE_FADE = 0.05;
/** Master level when unmuted: sets the overall loudness; the compressor keeps the busiest moments from clipping. */
const OUTPUT_LEVEL = 1.3;
/** The last stage passes everything below this level untouched and rounds off anything above it. */
const SOFT_CLIP_FROM = 0.8;
/** Highest input level the soft clip shapes; anything louder is held at full scale. */
const SOFT_CLIP_RANGE = 2;

/**
 * A safety net after the compressor: a waveshaper curve that is a straight line up to
 * SOFT_CLIP_FROM and bends smoothly towards full scale above it, so even a freak pile-up of sounds
 * at full volume never clips harshly. Normal levels never reach it.
 */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(4096);
  const room = 1 - SOFT_CLIP_FROM;
  for (let i = 0; i < curve.length; i++) {
    const x = ((i / (curve.length - 1)) * 2 - 1) * SOFT_CLIP_RANGE;
    const size = Math.abs(x);
    const shaped = size <= SOFT_CLIP_FROM ? size : SOFT_CLIP_FROM + room * Math.tanh((size - SOFT_CLIP_FROM) / room);
    curve[i] = Math.sign(x) * shaped;
  }
  return curve;
}

/**
 * The AudioContext and the mixing graph every sound goes through:
 *
 *   music sources → music gain ┐
 *                              ├→ master gain (mute) → compressor → soft clip → speakers
 *   sound effects → sfx gain  ┘
 *
 * Browsers only let audio start after a click or key press, so the context is created on the
 * first one. It only runs while there is something to hear: it is suspended while muted or while
 * the tab is hidden, which also pauses the music exactly where it was.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  /** Created with the context; read them only from `whenReady` callbacks or after `ctx` is set. */
  master!: GainNode;
  music!: GainNode;
  sfx!: GainNode;

  private readyCallbacks: ((ctx: AudioContext) => void)[] = [];
  private listeners = new Set<(settings: AudioSettings) => void>();
  private suspendTimer: number | undefined;

  constructor(private current: AudioSettings) {}

  static get supported(): boolean {
    return typeof AudioContext !== "undefined";
  }

  get settings(): AudioSettings {
    return { ...this.current };
  }

  /** True while sound can actually be heard (or measured). */
  get running(): boolean {
    return this.ctx?.state === "running";
  }

  /** Listens for the first gesture and for the tab being hidden. Call once. */
  listen(): void {
    // Any click or key press counts (moving the mouse doesn't). Kept for the whole visit: a later
    // press resumes the context if the browser refused the first time.
    for (const type of ["pointerdown", "keydown", "click"]) {
      window.addEventListener(type, () => this.unlock(), { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", () => this.syncRunning());
  }

  /** Creates the context (call inside a user gesture) or resumes it. Safe to call any time. */
  unlock(): void {
    if (!this.ctx) {
      if (!AudioEngine.supported) return;
      try {
        this.ctx = new AudioContext({ latencyHint: "interactive" });
      } catch {
        return;
      }
      this.build(this.ctx);
      const callbacks = this.readyCallbacks;
      this.readyCallbacks = [];
      for (const callback of callbacks) callback(this.ctx);
    }
    this.syncRunning();
  }

  /** Runs `callback` once the context exists (now, if it already does). */
  whenReady(callback: (ctx: AudioContext) => void): void {
    if (this.ctx) callback(this.ctx);
    else this.readyCallbacks.push(callback);
  }

  onChange(listener: (settings: AudioSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(change: Partial<AudioSettings>): void {
    const next = { ...this.current, ...change };
    if (next.muted === this.current.muted && next.music === this.current.music && next.sfx === this.current.sfx) return;
    this.current = next;
    writeAudioSettings(next);
    this.applyLevels();
    this.syncRunning();
    for (const listener of this.listeners) listener(this.settings);
  }

  private build(ctx: AudioContext): void {
    const compressor = ctx.createDynamicsCompressor();
    // Gentle: catches the odd pile-up of peaks rather than squashing the mix.
    compressor.threshold.value = -10;
    compressor.knee.value = 8;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    // The shaper's curve covers −1..1, so scale the signal into it first.
    const range = ctx.createGain();
    range.gain.value = 1 / SOFT_CLIP_RANGE;
    const softClip = ctx.createWaveShaper();
    softClip.curve = softClipCurve();
    compressor.connect(range).connect(softClip).connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(compressor);
    this.music = ctx.createGain();
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.master.gain.value = this.current.muted ? 0 : OUTPUT_LEVEL;
    this.music.gain.value = sliderToGain(this.current.music);
    this.sfx.gain.value = sliderToGain(this.current.sfx);
  }

  private applyLevels(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.current.muted ? 0 : OUTPUT_LEVEL, now, MUTE_FADE / 3);
    this.music.gain.setTargetAtTime(sliderToGain(this.current.music), now, 0.03);
    this.sfx.gain.setTargetAtTime(sliderToGain(this.current.sfx), now, 0.03);
  }

  /** Runs the context only while unmuted and visible. */
  private syncRunning(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    window.clearTimeout(this.suspendTimer);
    const wanted = !this.current.muted && document.visibilityState === "visible";
    if (wanted) {
      if (ctx.state !== "running") ctx.resume().catch(() => {});
    } else if (ctx.state === "running") {
      // Muting fades out first so it doesn't click; a hidden tab can stop at once.
      const delay = document.visibilityState === "visible" ? MUTE_FADE * 1000 + 60 : 0;
      this.suspendTimer = window.setTimeout(() => {
        if (this.current.muted || document.visibilityState !== "visible") ctx.suspend().catch(() => {});
      }, delay);
    }
  }
}
