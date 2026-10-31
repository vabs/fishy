import { describe, expect, it } from "vitest";
import { createSave } from "../save";
import { endlessRecordsDiff, endlessUnlocked, formatSeaTime } from "./endless";

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
  it("lists only personal bests that improved, excluding cumulative totals and ties", () => {
    const before = createSave("Skipper").endless;
    const after = { ...before, sessions: 1, totalFish: 5, timeMs: 1000, bestFish: 5, longestMs: 1000 };
    expect(endlessRecordsDiff(before, after)).toEqual(["Most fish caught", "Longest trip"]);
    expect(endlessRecordsDiff(after, after)).toEqual([]);
    expect(endlessRecordsDiff(before, { ...before, bestEarnings: 5, bestCombo: 1.5 })).toEqual(["Best session earnings", "Best combo"]);
  });
});
