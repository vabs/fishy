import { describe, expect, it } from "vitest";
import { urgencyLevel, urgencyHatForStep } from "./dynamics";

describe("urgencyLevel", () => {
  it("only lifts the final five seconds of a live timed round", () => {
    for (const time of [Infinity, NaN, 20, 5.01, 0, -1]) expect(urgencyLevel(time)).toBe(0);
    expect(urgencyLevel(5)).toBeGreaterThan(0);
    expect(urgencyLevel(2)).toBeGreaterThan(urgencyLevel(4));
    expect(urgencyLevel(0.001)).toBeCloseTo(1, 3);
    expect(urgencyLevel(1, true)).toBe(0);
  });
});

describe("urgencyHatForStep", () => {
  it("adds a sixteenth roll only during urgency, with beat accents", () => {
    expect(urgencyHatForStep(0, 0)).toBeNull();
    for (let step = 0; step < 16; step++) {
      expect(urgencyHatForStep(step, 0.2)).toBeGreaterThan(0);
      expect(urgencyHatForStep(step, 1)).toBeGreaterThan(urgencyHatForStep(step, 0.2)!);
    }
    expect(urgencyHatForStep(0, 1)).toBeGreaterThan(urgencyHatForStep(1, 1)!);
  });
});
