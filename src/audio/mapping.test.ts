import { describe, expect, it } from "vitest";
import { TECH_NODES } from "../game/tech";
import { CHAPTERS, FRENZY_COMBO_FLOOR, batchLevel, catchDegree, catchStreamLevel, chapterFor, comboLevel } from "./mapping";

describe("chapterFor", () => {
  it("starts in the first chapter", () => {
    expect(chapterFor({})).toBe(0);
    expect(chapterFor({ "net.size": 3 })).toBe(0);
  });

  it("moves on at Electric, then at the Monster", () => {
    expect(chapterFor({ "electric.unlock": 1 })).toBe(1);
    expect(chapterFor({ "electric.unlock": 1, "monster.unlock": 1 })).toBe(2);
  });

  it("ignores levels that aren't owned or aren't numbers", () => {
    expect(chapterFor({ "electric.unlock": 0 })).toBe(0);
    expect(chapterFor({ "electric.unlock": Number.NaN })).toBe(0);
  });

  it("only uses milestones that exist in the tech tree", () => {
    const ids = new Set(TECH_NODES.map((node) => node.id));
    for (const { from } of CHAPTERS) if (from) expect(ids.has(from), from).toBe(true);
  });
});

describe("catchDegree", () => {
  it("climbs one scale step per combo capture for two octaves", () => {
    expect([0, 1, 2, 9].map(catchDegree)).toEqual([0, 1, 2, 9]);
  });

  it("then cycles through the top octave instead of rising forever", () => {
    expect([10, 11, 14, 15, 16].map(catchDegree)).toEqual([5, 6, 9, 5, 6]);
    for (let combo = 0; combo < 1000; combo += 7) {
      expect(catchDegree(combo)).toBeGreaterThanOrEqual(0);
      expect(catchDegree(combo)).toBeLessThan(10);
    }
  });

  it("treats odd input as no combo", () => {
    expect(catchDegree(-3)).toBe(0);
    expect(catchDegree(2.7)).toBe(2);
  });
});

describe("batchLevel", () => {
  it("is 1 for a single catch and grows gently, capped", () => {
    expect(batchLevel(1)).toBe(1);
    expect(batchLevel(2)).toBeCloseTo(1.2);
    expect(batchLevel(8)).toBeCloseTo(1.6);
    expect(batchLevel(500)).toBe(1.6);
  });
});

describe("catchStreamLevel", () => {
  it("leaves occasional catches alone and softens a steady stream", () => {
    expect(catchStreamLevel(0)).toBe(1);
    expect(catchStreamLevel(6)).toBeCloseTo(0.775);
    expect(catchStreamLevel(12)).toBeCloseTo(0.55);
    expect(catchStreamLevel(40)).toBeCloseTo(0.55);
  });
});

describe("comboLevel", () => {
  const live = { mult: 1.5, max: 2, sinceCapture: 0.1, window: 0.5 };

  it("is the share of the way to the highest multiplier", () => {
    expect(comboLevel(live)).toBeCloseTo(0.5);
    expect(comboLevel({ ...live, mult: 2 })).toBe(1);
    expect(comboLevel({ ...live, mult: 1 })).toBe(0);
  });

  it("drops to 0 once the combo window has passed", () => {
    expect(comboLevel({ ...live, sinceCapture: 0.6 })).toBe(0);
  });

  it("is 0 while combos are locked", () => {
    expect(comboLevel({ ...live, window: 0 })).toBe(0);
    expect(comboLevel({ ...live, max: 1 })).toBe(0);
  });

  it("lifts the music during a Feeding Frenzy, with or without a combo", () => {
    expect(comboLevel({ ...live, frenzy: true })).toBe(FRENZY_COMBO_FLOOR);
    expect(comboLevel({ ...live, window: 0, frenzy: true })).toBe(FRENZY_COMBO_FLOOR);
    expect(comboLevel({ ...live, sinceCapture: 0.6, frenzy: true })).toBe(FRENZY_COMBO_FLOOR);
    expect(comboLevel({ ...live, mult: 2, frenzy: true })).toBe(1);
    expect(comboLevel({ ...live, frenzy: false })).toBeCloseTo(0.5);
  });
});
