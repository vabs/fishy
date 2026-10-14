/** Limits for one kind of sound. */
export interface VoiceLimit {
  /** Seconds that must pass between two voices of this kind. */
  gap: number;
  /** Voices of this kind that may sound at once (default: no limit beyond the overall cap). */
  voices?: number;
}

/**
 * Keeps sound effects from piling up. Late rounds capture hundreds of fish a second; without this
 * every one would start a voice. Each kind of sound has a minimum gap between voices and its own
 * share of voices, and only `maxVoices` may sound at once across all kinds. Times are in seconds
 * (AudioContext time).
 */
export class SfxGate {
  private lastStart = new Map<string, number>();
  /** End time and kind of each voice still sounding. */
  private voices: { kind: string; end: number }[] = [];

  constructor(
    readonly maxVoices: number,
    private readonly limits: Readonly<Record<string, VoiceLimit>>,
  ) {}

  /** True if a voice of `kind` could start now: its gap has passed and a voice is free. */
  ready(kind: string, now: number): boolean {
    const limit = this.limits[kind];
    const last = this.lastStart.get(kind);
    if (limit && last !== undefined && now - last < limit.gap) return false;
    if (this.active(now) >= this.maxVoices) return false;
    return limit?.voices === undefined || this.active(now, kind) < limit.voices;
  }

  /**
   * Reserves a voice of `kind` lasting `duration` seconds if it's ready. `force` skips the limits
   * (for one-off UI sounds such as a purchase chime) but still counts the voice.
   */
  tryStart(kind: string, now: number, duration: number, force = false): boolean {
    if (!force && !this.ready(kind, now)) return false;
    this.lastStart.set(kind, now);
    this.voices.push({ kind, end: now + duration });
    return true;
  }

  /** Voices still sounding at `now`, of one kind or of all. */
  active(now: number, kind?: string): number {
    this.voices = this.voices.filter((voice) => voice.end > now);
    return kind === undefined ? this.voices.length : this.voices.filter((voice) => voice.kind === kind).length;
  }
}
