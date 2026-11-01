import { describe, expect, it } from "vitest";
import { BASE_STATS, cloneStats } from "../stats";
import { TECH_NODES, getNode } from ".";
import { changedPaths, describeChanges, hasStatLabel, nodeChanges } from "./describe";

describe("describeChanges", () => {
  it("lists only what changed, with names and units", () => {
    const after = cloneStats(BASE_STATS);
    after.netRadius = 48;
    after.critChance = 0.04;
    after.ability.rare.pierce = true;
    after.fish.uncommon.rate = 0.375;
    expect(describeChanges(BASE_STATS, after)).toEqual([
      { label: "Net radius", before: "40 px", after: "48 px" },
      { label: "Critical hit chance", before: "0%", after: "4%" },
      { label: "Uncommon fish per second", before: "0", after: "0.375" },
      { label: "Armour pierce", before: "Off", after: "On" },
    ]);
  });
});

describe("nodeChanges", () => {
  it("shows Chum, cooldown, both reach effects and each Lantern level", () => {
    expect(nodeChanges(BASE_STATS, getNode("boat.chum")!, {})).toEqual([
      { label: "Chum", before: "Off", after: "On" },
    ]);
    expect(nodeChanges(BASE_STATS, getNode("boat.chumCooldown")!, {})).toEqual([
      { label: "Chum cooldown", before: "20.0 s", after: "17.0 s" },
    ]);
    expect(nodeChanges(BASE_STATS, getNode("boat.chumReach")!, {})).toEqual([
      { label: "Chum duration", before: "4.0 s", after: "5.0 s" },
      { label: "Chum reach", before: "220 px", after: "280 px" },
    ]);
    expect(nodeChanges(BASE_STATS, getNode("boat.lantern")!, { "boat.lantern": 1 })).toEqual([
      { label: "Lantern reach", before: "70 px", after: "140 px" },
    ]);
    expect(nodeChanges(BASE_STATS, getNode("boat.lantern")!, { "boat.lantern": 3 })).toEqual([
      { label: "Lantern reach", before: "0 px", after: "210 px" },
    ]);
  });

  it("shows trap count, reset seconds and an unlimited haul in player terms", () => {
    expect(nodeChanges(BASE_STATS, getNode("rigging.count")!, { "rigging.unlock": 1 })).toEqual([
      { label: "Trap nets", before: "1", after: "2" },
    ]);
    expect(nodeChanges(BASE_STATS, getNode("rigging.reset")!, {})).toEqual([
      { label: "Reset", before: "5.0 s", after: "4.3 s" },
    ]);
    expect(nodeChanges(BASE_STATS, getNode("rigging.haul")!, { "rigging.haul": 1 })).toEqual([
      { label: "Haul", before: "3", after: "all" },
    ]);
    expect(nodeChanges(BASE_STATS, getNode("rigging.haul")!, { "rigging.haul": 2 })).toEqual([
      { label: "Haul", before: "1", after: "all" },
    ]);
  });

  it("shows the next level, or the whole effect once maxed", () => {
    const radius = getNode("net.radius")!;
    expect(nodeChanges(BASE_STATS, radius, { "net.radius": 2 })).toEqual([{ label: "Net radius", before: "56 px", after: "64 px" }]);
    expect(nodeChanges(BASE_STATS, radius, { "net.radius": radius.maxLevel })).toEqual([
      { label: "Net radius", before: "40 px", after: "120 px" },
    ]);
  });

  it("names every stat any node changes", () => {
    for (const node of TECH_NODES) {
      expect(nodeChanges(BASE_STATS, node, {}).length, node.id).toBeGreaterThan(0);
      const after = cloneStats(BASE_STATS);
      node.apply(after, node.maxLevel);
      for (const path of changedPaths(BASE_STATS, after)) expect(hasStatLabel(path), `${node.id}: ${path}`).toBe(true);
    }
  });
});
