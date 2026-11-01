import { describe, expect, it } from "vitest";
import { BASE_STATS } from "../game/stats";
import { createRng } from "../game/rng";
import { World } from "../game/world";
import { createSave } from "../save";
import { advanceEndless, endlessRecordsDiff, endlessUnlocked, formatSeaTime } from "./endless";

describe("endless wiring", () => {
  it("unlocks after a timed round or a retained endless session", () => {
    const save = createSave("Skipper");
    expect(endlessUnlocked(save)).toBe(false);
    expect(endlessUnlocked({ ...save, round: 2 })).toBe(true);
    expect(endlessUnlocked({ ...save, endless: { ...save.endless, sessions: 1 } })).toBe(true);
  });
  it("formats elapsed seconds without rounding up the next minute", () => {
    expect([0, 9.9, 59.99, 60, 3601].map(formatSeaTime)).toEqual(["0:00", "0:09", "0:59", "1:00", "60:01"]);
  });
  it("fast-forwards a real trip through biome boundaries without retaining old effects", () => {
    const world = new World(BASE_STATS, createRng(10), 1280, 800, { round: 7, final: false, endless: true });
    advanceEndless(world, 601);
    expect(world.elapsed).toBeCloseTo(601);
    expect(world.biome?.biome).toBe("graveyard");
    expect([...world.biomesReached]).toEqual(["reef", "trench", "graveyard"]);
    expect(world.drainEvents()).toEqual([]);
    world.update(1 / 60);
    expect(world.drainEvents().filter((e) => e.type === "biome")).toEqual([]);
    const timed = new World(BASE_STATS, createRng(10), 1280, 800);
    advanceEndless(timed, 301);
    expect(timed.elapsed).toBe(0);
    for (const seconds of [-1, NaN, Infinity]) advanceEndless(world, seconds);
    expect(world.elapsed).toBeCloseTo(601 + 1 / 60);
  });
  it("lists only personal bests that improved, excluding cumulative totals and ties", () => {
    const before = createSave("Skipper").endless;
    const after = { ...before, sessions: 1, totalFish: 5, timeMs: 1000, bestFish: 5, longestMs: 1000 };
    expect(endlessRecordsDiff(before, after)).toEqual(["Most fish caught", "Longest trip"]);
    expect(endlessRecordsDiff(after, after)).toEqual([]);
    expect(endlessRecordsDiff(before, { ...before, bestEarnings: 5, bestCombo: 1.5 })).toEqual(["Best session earnings", "Best combo"]);
  });
});
