/*
 * Keys, scales and the musical clock. Everything Fishy generates sits in one pentatonic key and
 * tempo (D major pentatonic at 92 BPM unless a loop file says otherwise), so any note fits with any
 * other. Pure: no Web Audio here, so it runs in tests.
 */

export type Mode = "major" | "minor";

export interface Key {
  /** Pitch class of the tonic: 0 is C, 2 is D … 11 is B. */
  tonic: number;
  mode: Mode;
}

export const DEFAULT_KEY: Key = { tonic: 2, mode: "major" };
export const DEFAULT_BPM = 92;
export const BEATS_PER_BAR = 4;
/** The scheduler's grid: sixteenth notes. */
export const STEPS_PER_BEAT = 4;

const PENTATONIC: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 7, 9],
  minor: [0, 3, 5, 7, 10],
};
/** Notes per octave of a pentatonic scale. Degree 5 is the tonic an octave up. */
export const SCALE_SIZE = 5;

const NOTE_CLASSES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Reads "D major", "F# minor", "Bb" (major by default). Null if it isn't a key. */
export function parseKey(text: string): Key | null {
  // Case-sensitive on purpose, so the "b" of "Bb" is always a flat.
  const match = /^\s*([A-G])([#b]?)(?:\s+(major|minor|Major|Minor))?\s*$/.exec(text);
  if (!match) return null;
  const [, letter = "", accidental = "", mode = "major"] = match;
  const base = NOTE_CLASSES[letter] ?? 0;
  const shift = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return { tonic: (base + shift + 12) % 12, mode: mode.toLowerCase() as Mode };
}

/**
 * MIDI note of a scale degree. Degree 0 is the tonic in `octave` (D4 = 62 for D major), 5 is the
 * tonic an octave up, and negative degrees go below it.
 */
export function degreeToMidi(key: Key, degree: number, octave = 4): number {
  const scale = PENTATONIC[key.mode];
  const octaves = Math.floor(degree / SCALE_SIZE);
  const index = degree - octaves * SCALE_SIZE;
  return 12 * (octave + 1 + octaves) + key.tonic + (scale[index] ?? 0);
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Frequency of a scale degree, see degreeToMidi. */
export function degreeToHz(key: Key, degree: number, octave = 4): number {
  return midiToHz(degreeToMidi(key, degree, octave));
}

/** A tempo grid anchored at a downbeat, in AudioContext seconds. */
export interface Clock {
  /** Time of a downbeat (normally when the current bed started). */
  origin: number;
  bpm: number;
  beatsPerBar: number;
}

export function beatLength(clock: Clock): number {
  return 60 / clock.bpm;
}

export function barLength(clock: Clock): number {
  return beatLength(clock) * clock.beatsPerBar;
}

export function stepLength(clock: Clock): number {
  return beatLength(clock) / STEPS_PER_BEAT;
}

export function stepsPerBar(clock: Clock): number {
  return clock.beatsPerBar * STEPS_PER_BEAT;
}

/** Tolerance so a time that is a hair past a grid line, by float rounding, still counts as on it. */
const EPSILON = 1e-6;

/** Index of the first grid line at or after `time`, counting from the origin in `unit` seconds. */
function gridIndex(clock: Clock, unit: number, time: number): number {
  return Math.max(0, Math.ceil((time - clock.origin) / unit - EPSILON));
}

/** The first beat at or after `time`. */
export function nextBeat(clock: Clock, time: number): number {
  const unit = beatLength(clock);
  return clock.origin + gridIndex(clock, unit, time) * unit;
}

/** The first downbeat (start of a bar) at or after `time`. */
export function nextDownbeat(clock: Clock, time: number): number {
  const unit = barLength(clock);
  return clock.origin + gridIndex(clock, unit, time) * unit;
}

/** Index of the first sixteenth-note step at or after `time`. Step 0 is the origin. */
export function stepIndexAt(clock: Clock, time: number): number {
  return gridIndex(clock, stepLength(clock), time);
}

export function stepTime(clock: Clock, index: number): number {
  return clock.origin + index * stepLength(clock);
}

/**
 * The tempo that makes a loop exactly a whole number of bars, closest to the stated `bpm`. Loop
 * points are typed in by hand, so this keeps generated layers locked to the loop for hours instead
 * of drifting by the rounding error every time it repeats.
 */
export function loopTempo(loopSeconds: number, bpm: number, beatsPerBar: number): number {
  const bar = (60 / bpm) * beatsPerBar;
  const bars = Math.max(1, Math.round(loopSeconds / bar));
  return (60 * beatsPerBar * bars) / loopSeconds;
}
