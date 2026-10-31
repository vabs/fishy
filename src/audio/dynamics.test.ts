import { describe, expect, it } from "vitest";
import { urgencyLevel, urgencyHatForStep, mixForMode } from "./dynamics";

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

describe("screen mix", () => {
  it("keeps the hub calm and makes the title a little more welcoming", () => {
    expect(mixForMode("hub")).toMatchObject({ cutoff: 700, bed: 0.5, groove: 0 });
    expect(mixForMode("title")).toMatchObject({ cutoff: 1400, groove: 0 });
    expect(mixForMode("title").bed).toBeGreaterThan(mixForMode("hub").bed);
    expect(mixForMode("endless").groove).toBeGreaterThan(0);
    expect(mixForMode("endless").groove).toBeLessThan(mixForMode("round").groove);
  });
});
