import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, grantAchievements, newAchievements } from "./achievements";
import { FISH_KINDS } from "./fish";
import { BASE_STATS } from "./stats";
import { applyUpgrades, TECH_NODES } from "./tech";
import { createSave, parseSave, recordEndless, recordRound, type SaveData } from "../save";
import v1 from "../save/fixtures/v1.json";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const ids = (save: SaveData, moment?: Parameters<typeof newAchievements>[1]): string[] => newAchievements(save, moment).map((a) => a.id);

function withStats(stats: Partial<SaveData["stats"]>): SaveData {
  const save = createSave("Ann", NOW);
  return { ...save, stats: { ...save.stats, ...stats } };
}

describe("ACHIEVEMENTS", () => {
  it("keeps all 22 stable ids and valid icons", () => {
    expect(ACHIEVEMENTS.map((a) => a.id)).toEqual([
      ...FISH_KINDS.map((kind) => `first-${kind}`), "fish-1k", "fish-10k", "fish-50k",
      "combo-2", "combo-3", "haul-10", "star-10", "golden-50", "chests-10",
      "bounty-perfect", "bounties-25", "final", "endless-10", "endless-30",
    ]);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(22);
    const icons = new Set([...FISH_KINDS.map((kind) => `fish:${kind}`), "net", "star", "coin", "chest", "gold", "wave", "scroll", "anchor", "clock", "crown", "combo"]);
    for (const a of ACHIEVEMENTS) {
      expect(a.name).not.toBe("");
      expect(a.description).not.toBe("");
      expect(icons.has(a.icon)).toBe(true);
    }
  });
});

describe("newAchievements", () => {
  it("grants nothing to a fresh save and does not mutate it", () => {
    const save = createSave("Ann", NOW);
    const snapshot = structuredClone(save);
    expect(newAchievements(save)).toEqual([]);
    expect(save).toEqual(snapshot);
  });

  it.each(FISH_KINDS)("recognises the first %s fish", (kind) => {
    expect(ids(withStats({ totalFish: 1, fishByType: { [kind]: 1 } }))).toEqual([`first-${kind}`]);
  });

  it.each([[999, []], [1000, ["fish-1k"]], [10000, ["fish-1k", "fish-10k"]], [50000, ["fish-1k", "fish-10k", "fish-50k"]]] as const)("recognises %i lifetime catches", (totalFish, expected) => {
    expect(ids(withStats({ totalFish }))).toEqual(expected);
  });

  it("grants fish and final badges retroactively to a migrated v1 save", () => {
    const parsed = parseSave(JSON.stringify(v1), TECH_NODES);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(ids(parsed.save)).toEqual(["first-normal", "first-uncommon", "first-rare", "fish-1k", "final"]);
  });

  it("requires ×1.5 for On a Roll and the current net's cap (at least ×2) for Unstoppable", () => {
    expect(ids(withStats({ bestCombo: 1.49 }))).toEqual([]);
    expect(ids(withStats({ bestCombo: 1.5 }))).toEqual(["combo-2"]);
    const save = { ...withStats({ bestCombo: 2 }), upgrades: { "econ.combo": 1 } };
    expect(applyUpgrades(BASE_STATS, save.upgrades).comboMax).toBe(2);
    expect(ids(save)).toEqual(["combo-2", "combo-3"]);
    save.upgrades = { "econ.combo": 1, "econ.comboCap": 1 } as typeof save.upgrades;
    expect(ids(save)).toEqual(["combo-2"]);
    save.stats.bestCombo = 2.25 - 1e-12;
    expect(ids(save)).toEqual(["combo-2", "combo-3"]);
    const maxed = { ...save, upgrades: Object.fromEntries(TECH_NODES.map((n) => [n.id, n.maxLevel])) };
    maxed.stats.bestCombo = applyUpgrades(BASE_STATS, maxed.upgrades).comboMax;
    expect(maxed.stats.bestCombo).toBe(4);
    expect(ids(maxed)).toContain("combo-3");
  });

  it.each([
    ["haul-10", "bestTickCatches", 10], ["star-10", "bestStarHits", 10],
    ["golden-50", "goldenCaught", 50], ["chests-10", "chestsOpened", 10],
    ["bounties-25", "bountiesCompleted", 25], ["bounty-perfect", "perfectBountyRounds", 1],
  ] as const)("checks the %s lifetime threshold", (id, key, target) => {
    expect(ids(withStats({ [key]: target - 1 }))).not.toContain(id);
    expect(ids(withStats({ [key]: target }))).toContain(id);
  });

  it("recognises Clean Sweep from the current moment before stats are recorded", () => {
    const save = createSave("Ann", NOW);
    expect(ids(save, { allBounties: false })).not.toContain("bounty-perfect");
    expect(ids(save, { allBounties: true })).toContain("bounty-perfect");
  });

  it("recognises Endless milestones from a single session or longest record, not cumulative time", () => {
    const save = createSave("Ann", NOW);
    save.endless.timeMs = 3600000;
    expect(ids(save)).toEqual([]);
    expect(ids(save, { endlessSessionMs: 599999 })).toEqual([]);
    expect(ids(save, { endlessSessionMs: 600000 })).toEqual(["endless-10"]);
    expect(ids(save, { endlessSessionMs: 1800000 })).toEqual(["endless-10", "endless-30"]);
    save.endless.longestMs = 1800000;
    expect(ids(save, { endlessSessionMs: 0 })).toEqual(["endless-10", "endless-30"]);
  });

  it("reads records produced by timed rounds and Endless sessions", () => {
    let save = recordRound(createSave("Ann", NOW), { earned: 10, caught: { normal: 1 }, durationMs: 1000, bestTickCatches: 10, bestStarHits: 10, bountiesCompleted: 25, allBounties: true });
    save = recordEndless(save, { earned: 200, caught: { golden: 0, uncommon: 1000 }, durationMs: 1800000, goldenCaught: 50, chestsOpened: 10, maxCombo: 2 });
    expect(ids(save)).toEqual(["first-normal", "first-uncommon", "fish-1k", "combo-2", "combo-3", "haul-10", "star-10", "golden-50", "chests-10", "bounty-perfect", "bounties-25", "endless-10", "endless-30"]);
  });
});

describe("grantAchievements", () => {
  it("stamps new ids once and never overwrites the original time", () => {
    const save = withStats({ fishByType: { normal: 1 } });
    const snapshot = structuredClone(save);
    const first = grantAchievements(save, ["first-normal", "first-normal"], NOW);
    expect(first.achievements).toEqual({ "first-normal": NOW.toISOString() });
    expect(newAchievements(first)).toEqual([]);
    const again = grantAchievements(first, ["first-normal", "future-id"], new Date("2026-11-01T00:00:00.000Z"));
    expect(again.achievements).toEqual({ "first-normal": NOW.toISOString(), "future-id": "2026-11-01T00:00:00.000Z" });
    expect(save).toEqual(snapshot);
    expect(first.achievements).toEqual({ "first-normal": NOW.toISOString() });
  });

  it("can grant an id that is also a plain object's inherited key", () => {
    const save = grantAchievements(createSave("Ann", NOW), ["toString", "__proto__"], NOW);
    expect(Object.hasOwn(save.achievements, "toString")).toBe(true);
    expect(Object.hasOwn(save.achievements, "__proto__")).toBe(true);
    expect(save.achievements["__proto__"]).toBe(NOW.toISOString());
  });
});
