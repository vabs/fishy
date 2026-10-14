/*
 * Note patterns for the generated music: chords, the sparse marimba line, the groove and the combo
 * arpeggio. Every bar draws its choices from its own seeded random numbers, so the music never
 * repeats a fixed loop yet any bar can be regenerated exactly. Notes are scale degrees (see
 * theory.ts), so the same patterns fit any pentatonic key. Pure, so it's tested.
 */
import { createRng, type Rng } from "../game/rng";
import { SCALE_SIZE } from "./theory";

/** Patterns assume 4/4 in sixteenth-note steps. */
export const PATTERN_STEPS = 16;

export interface Chord {
  /** Bass note: scale degree from the tonic in octave 2. */
  bass: number;
  /** Pad voicing: scale degrees from the tonic in octave 4. */
  pad: readonly number[];
  /** Chord tones as degrees within an octave (0–4), root first. */
  tones: readonly number[];
}

/** Chords made only of the pentatonic scale's own notes, so nothing can clash. Named as in D major. */
export const CHORDS = {
  /** D(add9): F#3 A3 D4 E4 over D */
  I: { bass: 0, pad: [-3, -2, 0, 1], tones: [0, 2, 3, 1] },
  /** D/F#: A3 D4 E4 A4 over F# */
  I6: { bass: 2, pad: [-2, 0, 1, 3], tones: [0, 2, 3, 1] },
  /** Em7sus4: B3 D4 E4 A4 over E */
  ii: { bass: 1, pad: [-1, 0, 1, 3], tones: [1, 3, 4, 0] },
  /** Asus4(add9): E3 A3 B3 D4 over A */
  V: { bass: 3, pad: [-4, -2, -1, 0], tones: [3, 4, 0, 1] },
  /** Bm7: F#3 A3 B3 D4 over B */
  vi: { bass: -1, pad: [-3, -2, -1, 0], tones: [4, 0, 2, 3] },
} as const satisfies Record<string, Chord>;

export type ChordName = keyof typeof CHORDS;

/** One chapter's generated bed. */
export interface BedStyle {
  seed: number;
  /** Each phrase plays one of these, picked at random; each chord lasts `barsPerChord` bars. */
  progressions: readonly (readonly ChordName[])[];
  barsPerChord: number;
  /** Chance of a melody note on each beat; off-beats get half. */
  density: number;
  /** Chance that a bar has no melody at all, so the line breathes. */
  restChance: number;
  /** Melody range, in scale degrees from the tonic in octave 4. */
  low: number;
  high: number;
  /** Melody timbre. */
  voice: "marimba" | "kalimba";
  /** Pad brightness: its low-pass cutoff, Hz. */
  padCutoff: number;
}

export const BED_STYLES: readonly BedStyle[] = [
  {
    // Shallows: the start of the game. Plain, open, mid register.
    seed: 11,
    progressions: [
      ["I", "vi", "ii", "V"],
      ["I", "V", "vi", "ii"],
      ["vi", "ii", "I", "V"],
    ],
    barsPerChord: 2,
    density: 0.28,
    restChance: 0.2,
    low: 0,
    high: 7,
    voice: "marimba",
    padCutoff: 1100,
  },
  {
    // Currents: from Electric fish on. A brighter, busier line, a bit higher.
    seed: 23,
    progressions: [
      ["vi", "I6", "ii", "V"],
      ["I", "ii", "vi", "V"],
      ["ii", "V", "I", "vi"],
    ],
    barsPerChord: 2,
    density: 0.34,
    restChance: 0.15,
    low: 2,
    high: 9,
    voice: "kalimba",
    padCutoff: 1500,
  },
  {
    // Deep: from the Monster on. Darker, lower, sparser, leaning on the relative minor.
    seed: 37,
    progressions: [
      ["vi", "ii", "vi", "V"],
      ["vi", "V", "ii", "I6"],
      ["ii", "vi", "V", "I"],
    ],
    barsPerChord: 2,
    density: 0.2,
    restChance: 0.25,
    low: -2,
    high: 5,
    voice: "marimba",
    padCutoff: 800,
  },
];

/** Random numbers for one bar (or phrase) of one pattern: the same inputs always give the same bar. */
function barRng(seed: number, index: number): Rng {
  return createRng((Math.imul(seed, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0);
}

function degreeClass(degree: number): number {
  return ((degree % SCALE_SIZE) + SCALE_SIZE) % SCALE_SIZE;
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] ?? items[0]!;
}

export function chordForBar(style: BedStyle, bar: number): Chord {
  const phraseBars = style.barsPerChord * 4;
  const phrase = Math.floor(bar / phraseBars);
  const progression = pick(barRng(style.seed ^ 0x5bd1e995, phrase), style.progressions);
  const index = Math.floor((bar - phrase * phraseBars) / style.barsPerChord);
  return CHORDS[progression[index] ?? "I"];
}

/** True on the first bar of each chord, when the pad and bass change. */
export function isChordStart(style: BedStyle, bar: number): boolean {
  return bar % style.barsPerChord === 0;
}

/** The nearest degree to `degree`, inside low..high, that is a tone of `chord`. */
export function snapToChord(degree: number, chord: Chord, low: number, high: number): number {
  for (let distance = 0; distance <= SCALE_SIZE; distance++) {
    for (const candidate of [degree - distance, degree + distance]) {
      if (candidate >= low && candidate <= high && chord.tones.includes(degreeClass(candidate))) return candidate;
    }
  }
  return Math.min(high, Math.max(low, degree));
}

export interface MelodyNote {
  /** Sixteenth-note step in the bar, 0–15. */
  step: number;
  /** Scale degree from the tonic in octave 4. */
  degree: number;
  /** 0 to 1. */
  velocity: number;
}

/** Steps the melody may take between notes, in scale degrees: mostly small, sometimes still. */
const MOVES = [-2, -1, -1, 0, 1, 1, 2];

/** The marimba line for one bar: a few notes on eighths, wandering by small steps, landing on chord tones on the beat. */
export function melodyForBar(style: BedStyle, bar: number): MelodyNote[] {
  const rng = barRng(style.seed, bar);
  if (rng() < style.restChance) return [];
  const chord = chordForBar(style, bar);
  const start = style.low + Math.floor(rng() * (style.high - style.low + 1));
  let degree = snapToChord(start, chord, style.low, style.high);
  const notes: MelodyNote[] = [];
  for (let eighth = 0; eighth < 8; eighth++) {
    const onBeat = eighth % 2 === 0;
    const chance = style.density * (eighth === 0 ? 1.5 : onBeat ? 1 : 0.5);
    if (rng() >= chance) continue;
    degree = Math.min(style.high, Math.max(style.low, degree + pick(rng, MOVES)));
    if (onBeat) degree = snapToChord(degree, chord, style.low, style.high);
    notes.push({ step: eighth * 2, degree, velocity: (onBeat ? 0.75 : 0.5) + rng() * 0.25 });
  }
  return notes;
}

export type GrooveSound = "kick" | "shaker" | "bass";

export interface GrooveHit {
  step: number;
  sound: GrooveSound;
  velocity: number;
}

/** The round groove for one bar: a soft kick on 1 and 3, a shaker on eighths, a plucked bass on the chord root. */
export function grooveForBar(seed: number, bar: number): GrooveHit[] {
  const rng = barRng(seed ^ 0x27d4eb2f, bar);
  const hits: GrooveHit[] = [
    { step: 0, sound: "kick", velocity: 1 },
    { step: 8, sound: "kick", velocity: 0.75 },
    { step: 0, sound: "bass", velocity: 1 },
    { step: 10, sound: "bass", velocity: 0.6 },
  ];
  if (rng() < 0.3) hits.push({ step: 14, sound: "kick", velocity: 0.45 });
  else if (rng() < 0.3) hits.push({ step: 6, sound: "kick", velocity: 0.4 });
  if (rng() < 0.4) hits.push({ step: 14, sound: "bass", velocity: 0.45 });
  for (let step = 0; step < PATTERN_STEPS; step += 2) {
    hits.push({ step, sound: "shaker", velocity: step % 4 === 2 ? 0.8 : 0.45 });
    if (rng() < 0.18) hits.push({ step: step + 1, sound: "shaker", velocity: 0.25 });
  }
  return hits;
}

/**
 * The combo arpeggio's note at a step (counted from the start of the music), or null for a rest.
 * It runs up and down the chord in the octave above the melody: eighths for a small combo, sixteenths
 * past half way, louder as the combo grows. Without a known chord it runs the whole scale.
 */
export function arpForStep(chord: Chord | null, step: number, level: number): { degree: number; velocity: number } | null {
  if (level < 0.05) return null;
  const sixteenths = level >= 0.5;
  if (!sixteenths && step % 2 === 1) return null;
  const tones = [...(chord?.tones ?? [0, 1, 2, 3, 4])].sort((a, b) => a - b);
  // One octave of chord tones, topped with the lowest one an octave up.
  const ladder = [...tones.map((t) => SCALE_SIZE + t), 2 * SCALE_SIZE + (tones[0] ?? 0)];
  const cycle = [...ladder, ...ladder.slice(1, -1).reverse()];
  const position = sixteenths ? step : step / 2;
  const degree = cycle[position % cycle.length] ?? SCALE_SIZE;
  const accent = step % 4 === 0 ? 1 : 0.7;
  return { degree, velocity: (0.4 + 0.6 * level) * accent };
}
