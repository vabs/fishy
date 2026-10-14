import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEY,
  barLength,
  degreeToHz,
  degreeToMidi,
  loopTempo,
  midiToHz,
  nextBeat,
  nextDownbeat,
  parseKey,
  stepIndexAt,
  stepTime,
  type Clock,
} from "./theory";

describe("parseKey", () => {
  it("reads note names, accidentals and modes", () => {
    expect(parseKey("D major")).toEqual({ tonic: 2, mode: "major" });
    expect(parseKey("F# minor")).toEqual({ tonic: 6, mode: "minor" });
    expect(parseKey("Bb")).toEqual({ tonic: 10, mode: "major" });
    expect(parseKey(" A Minor ")).toEqual({ tonic: 9, mode: "minor" });
    expect(parseKey("Cb major")).toEqual({ tonic: 11, mode: "major" });
  });

  it("rejects anything else", () => {
    expect(parseKey("H major")).toBeNull();
    expect(parseKey("D dorian")).toBeNull();
    expect(parseKey("")).toBeNull();
    expect(parseKey("d major")).toBeNull();
  });
});

describe("degreeToMidi", () => {
  it("walks D major pentatonic from D4", () => {
    const notes = [0, 1, 2, 3, 4, 5].map((d) => degreeToMidi(DEFAULT_KEY, d));
    // D4 E4 F#4 A4 B4 D5
    expect(notes).toEqual([62, 64, 66, 69, 71, 74]);
  });

  it("goes below the tonic with negative degrees and moves by octave", () => {
    // B3, A3, F#3
    expect([-1, -2, -3].map((d) => degreeToMidi(DEFAULT_KEY, d))).toEqual([59, 57, 54]);
    expect(degreeToMidi(DEFAULT_KEY, 0, 2)).toBe(38);
  });

  it("uses the minor pentatonic in a minor key", () => {
    const aMinor = { tonic: 9, mode: "minor" as const };
    // A4 C5 D5 E5 G5
    expect([0, 1, 2, 3, 4].map((d) => degreeToMidi(aMinor, d))).toEqual([69, 72, 74, 76, 79]);
  });

  it("only ever lands on scale notes", () => {
    const scale = new Set([2, 4, 6, 9, 11]);
    for (let d = -12; d <= 15; d++) expect(scale.has(degreeToMidi(DEFAULT_KEY, d) % 12)).toBe(true);
  });
});

describe("pitch", () => {
  it("tunes A4 to 440 Hz", () => {
    expect(midiToHz(69)).toBe(440);
    expect(degreeToHz(DEFAULT_KEY, 3)).toBeCloseTo(440, 6);
    expect(midiToHz(81)).toBeCloseTo(880, 6);
  });
});

describe("clock", () => {
  const clock: Clock = { origin: 10, bpm: 120, beatsPerBar: 4 };

  it("finds the next beat and downbeat at or after a time", () => {
    expect(nextBeat(clock, 10)).toBe(10);
    expect(nextBeat(clock, 10.1)).toBe(10.5);
    expect(nextDownbeat(clock, 10.1)).toBe(12);
    expect(nextDownbeat(clock, 12)).toBe(12);
    expect(nextDownbeat(clock, 12 + 1e-9)).toBe(12);
    expect(barLength(clock)).toBe(2);
  });

  it("never goes before the origin", () => {
    expect(nextDownbeat(clock, 3)).toBe(10);
    expect(stepIndexAt(clock, 0)).toBe(0);
  });

  it("maps sixteenth steps to times and back", () => {
    expect(stepTime(clock, 4)).toBe(10.5);
    expect(stepIndexAt(clock, 10.5)).toBe(4);
    expect(stepIndexAt(clock, 10.51)).toBe(5);
  });
});

describe("loopTempo", () => {
  it("nudges the tempo so a loop is a whole number of bars", () => {
    // 8 bars of 4/4 at 92 BPM is 20.8696 s; typed as 20.87.
    const bpm = loopTempo(20.87, 92, 4);
    expect(bpm).toBeCloseTo(92, 1);
    expect((20.87 / ((60 / bpm) * 4)) % 1).toBeCloseTo(0, 9);
  });

  it("treats a loop shorter than a bar as one bar", () => {
    expect(loopTempo(1, 92, 4)).toBe(240);
  });
});
