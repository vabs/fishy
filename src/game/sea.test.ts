import { describe, expect, it } from "vitest";
import { createRng } from "./rng";
import { fogAlpha, fogClearRadius, SEA, seaBlurb, seaLabel, seaStateFor } from "./sea";
import { BASE_STATS, cloneStats } from "./stats";

describe("seaStateFor", () => {
  it("uses the bounty board's FNV seed and round rules without rerolling", () => {
    for (const createdAt of ["2026-01-01", "another save", "🐟"]) {
      for (let round = 1; round <= 120; round++) {
        const state = seaStateFor(createdAt, round, false);
        expect(seaStateFor(createdAt, round)).toBe(state);
        expect(seaStateFor(createdAt, round, true)).toBe("clear");
        if (round < 6 || round % 5 === 0) expect(state).toBe("clear");
        else {
          let seed = 2166136261;
          for (const char of `${createdAt}:${round}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
          expect(state === "clear").toBe(createRng(seed)() >= SEA.chance);
        }
        if (state !== "clear") expect(seaStateFor(createdAt, round - 1)).not.toBe(state);
      }
    }
  });

  it("offers all weather equally often, only on about 35% of eligible rounds", () => {
    const counts = { clear: 0, storm: 0, fog: 0, bloom: 0 };
    for (let save = 0; save < 100; save++) {
      for (let round = 6; round < 50; round++) {
        if (round % 5 !== 0) counts[seaStateFor(`save-${save}`, round)]++;
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b);
    expect(1 - counts.clear / total).toBeCloseTo(0.35, 1);
    for (const state of ["storm", "fog", "bloom"] as const) expect(counts[state] / total).toBeCloseTo(0.35 / 3, 1);
  });
});

describe("fog", () => {
  it("keeps a fully clear pool and fades to a visible silhouette", () => {
    expect(fogAlpha(0, 100)).toBe(1);
    expect(fogAlpha(100, 100)).toBe(1);
    expect(fogAlpha(180, 100)).toBe(0.5);
    expect(fogAlpha(260, 100)).toBe(0.15);
    expect(fogAlpha(1000, 100)).toBe(0.15);
  });

  it("uses the larger of the lantern pool and 2.5 net radii", () => {
    const stats = cloneStats(BASE_STATS);
    expect(fogClearRadius(stats)).toBe(100);
    stats.netRadius = 20;
    expect(fogClearRadius(stats)).toBe(90);
    for (let level = 1; level <= 3; level++) {
      stats.boat.lanternRadius = 70 * level;
      expect(fogClearRadius(stats)).toBe(90 + 70 * level);
    }
    stats.netRadius = 150;
    expect(fogClearRadius(stats)).toBe(375);
  });
});

it("exports the agreed labels, banner copy and tuning", () => {
  expect((["clear", "storm", "fog", "bloom"] as const).map(seaLabel)).toEqual([
    "Clear", "Storm", "Fog", "Algal Bloom",
  ]);
  expect(seaBlurb("storm")).toBe("Storm · catches ×1.2");
  expect(seaBlurb("fog")).toBe("Fog · catches ×1.15");
  expect(seaBlurb("bloom")).toBe("Algal Bloom · more fish, tougher");
  expect(seaBlurb("clear")).toBe("");
  expect(SEA).toEqual({ fromRound: 6, chance: 0.35, endlessEvery: 150, endlessLength: 60,
    stormBase: 22, stormGust: 45, stormSpring: 0.6, stormValue: 1.2, fogValue: 1.15,
    bloomSpawn: 1.25, bloomSpeed: 0.75, bloomHp: 1.5 });
});
