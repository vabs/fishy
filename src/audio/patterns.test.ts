import { describe, expect, it } from "vitest";
import { DEFAULT_KEY, SCALE_SIZE, degreeToMidi } from "./theory";
import {
  BED_STYLES,
  CHORDS,
  PATTERN_STEPS,
  arpForStep,
  chordForBar,
  grooveForBar,
  melodyForBar,
  snapToChord,
  type Chord,
} from "./patterns";

const D_MAJOR_PENTATONIC = new Set([2, 4, 6, 9, 11]);

describe("chords", () => {
  it("use only notes of the pentatonic scale", () => {
    for (const chord of Object.values(CHORDS) as Chord[]) {
      for (const degree of [...chord.pad, chord.bass, ...chord.tones]) {
        expect(D_MAJOR_PENTATONIC.has(degreeToMidi(DEFAULT_KEY, degree) % 12)).toBe(true);
      }
      expect(chord.tones.every((t) => t >= 0 && t < SCALE_SIZE)).toBe(true);
    }
  });

  it("hold for barsPerChord bars and come from the style's progressions", () => {
    for (const style of BED_STYLES) {
      const used = new Set<Chord>(style.progressions.flat().map((name) => CHORDS[name]));
      for (let bar = 0; bar < 64; bar++) {
        const chord = chordForBar(style, bar);
        expect(used.has(chord)).toBe(true);
        if (bar % style.barsPerChord !== 0) expect(chord).toBe(chordForBar(style, bar - 1));
      }
    }
  });

  it("snap a degree to the nearest chord tone in range", () => {
    // Bm7's tones are D F# A B; E (1) moves to D (0) or F# (2).
    expect([0, 2]).toContain(snapToChord(1, CHORDS.vi, -5, 10));
    expect(snapToChord(3, CHORDS.vi, -5, 10)).toBe(3);
    expect(snapToChord(1, CHORDS.vi, 2, 10)).toBe(2);
  });
});

describe("melodyForBar", () => {
  it("is the same every time for the same bar", () => {
    const style = BED_STYLES[0]!;
    expect(melodyForBar(style, 17)).toEqual(melodyForBar(style, 17));
  });

  it("stays in range, on eighths, and lands on chord tones on the beat", () => {
    for (const style of BED_STYLES) {
      for (let bar = 0; bar < 200; bar++) {
        const chord = chordForBar(style, bar);
        for (const note of melodyForBar(style, bar)) {
          expect(note.degree).toBeGreaterThanOrEqual(style.low);
          expect(note.degree).toBeLessThanOrEqual(style.high);
          expect(note.step % 2).toBe(0);
          expect(note.step).toBeLessThan(PATTERN_STEPS);
          expect(note.velocity).toBeGreaterThan(0);
          expect(note.velocity).toBeLessThanOrEqual(1);
          if (note.step % 4 === 0) expect(chord.tones).toContain(((note.degree % 5) + 5) % 5);
        }
      }
    }
  });

  it("is sparse, rests now and then, and doesn't repeat on a short cycle", () => {
    for (const style of BED_STYLES) {
      const bars = Array.from({ length: 256 }, (_, bar) => melodyForBar(style, bar));
      const notesPerBar = bars.reduce((sum, notes) => sum + notes.length, 0) / bars.length;
      expect(notesPerBar).toBeGreaterThan(0.8);
      expect(notesPerBar).toBeLessThan(4);
      expect(bars.some((notes) => notes.length === 0)).toBe(true);
      const text = bars.map((notes) => JSON.stringify(notes));
      for (const period of [4, 8, 16, 32]) {
        const repeats = text.slice(period).filter((bar, i) => bar === text[i]).length;
        expect(repeats / (text.length - period)).toBeLessThan(0.5);
      }
    }
  });
});

describe("grooveForBar", () => {
  it("has a kick and bass on the downbeat and a shaker on every eighth", () => {
    for (let bar = 0; bar < 50; bar++) {
      const hits = grooveForBar(5, bar);
      expect(hits).toContainEqual({ step: 0, sound: "kick", velocity: 1 });
      expect(hits).toContainEqual({ step: 0, sound: "bass", velocity: 1 });
      for (let step = 0; step < PATTERN_STEPS; step += 2) {
        expect(hits.some((hit) => hit.sound === "shaker" && hit.step === step)).toBe(true);
      }
      expect(hits.every((hit) => hit.step >= 0 && hit.step < PATTERN_STEPS)).toBe(true);
    }
  });

  it("varies from bar to bar", () => {
    const shapes = new Set(Array.from({ length: 32 }, (_, bar) => JSON.stringify(grooveForBar(5, bar))));
    expect(shapes.size).toBeGreaterThan(4);
  });
});

describe("arpForStep", () => {
  it("rests without a combo", () => {
    expect(arpForStep(CHORDS.I, 0, 0)).toBeNull();
  });

  it("plays eighths for a small combo and sixteenths for a big one, louder as it grows", () => {
    const small = Array.from({ length: 16 }, (_, step) => arpForStep(CHORDS.I, step, 0.3));
    const big = Array.from({ length: 16 }, (_, step) => arpForStep(CHORDS.I, step, 0.9));
    expect(small.filter(Boolean)).toHaveLength(8);
    expect(big.filter(Boolean)).toHaveLength(16);
    expect(big[0]!.velocity).toBeGreaterThan(small[0]!.velocity);
  });

  it("runs over chord tones within one octave above the melody", () => {
    for (const chord of Object.values(CHORDS) as Chord[]) {
      for (let step = 0; step < 32; step++) {
        const note = arpForStep(chord, step, 1)!;
        expect(chord.tones).toContain(note.degree % SCALE_SIZE);
        expect(note.degree).toBeGreaterThanOrEqual(SCALE_SIZE);
        expect(note.degree).toBeLessThanOrEqual(2 * SCALE_SIZE + SCALE_SIZE - 1);
      }
    }
  });

  it("runs the whole scale when the chord is unknown (a loop file is playing)", () => {
    const degrees = new Set(Array.from({ length: 10 }, (_, step) => arpForStep(null, step, 1)!.degree % SCALE_SIZE));
    expect(degrees.size).toBe(SCALE_SIZE);
  });
});
