import { describe, expect, it } from "vitest";
import { createSave } from "../save";
import { BASE_STATS } from "../game/stats";
import { createRng } from "../game/rng";
import { World } from "../game/world";
import { TECH_NODES } from "../game/tech";
import { bountyFacts, bountyBoard, bountyResult } from "./bounties";

describe("bounty wiring", () => {
  it("adapts the world's capture and bonus records", () => {
    const world = new World(BASE_STATS, createRng(1), 1280, 800);
    world.caught = { normal: 8 }; world.maxComboMult = 1.6;
    world.bonusCount = { golden: 2, treasure: 1 }; world.bestTickCatches = 6;
    world.earned = 180; world.frenzyCaught = 4;
    expect(bountyFacts(world)).toEqual({ caught: { normal: 8 }, maxComboMult: 1.6,
      goldenCaught: 2, chestsOpened: 1, bestTickCatches: 6, earned: 180, frenzyCaught: 4 });
  });

  it("rolls deterministically and keeps a persisted board across purchases", () => {
    const save = { ...createSave("Skipper", new Date("2026-01-01")), round: 2 };
    const rolled = bountyBoard(save);
    expect(rolled.bounties?.list.length).toBe(2);
    expect(bountyBoard(save).bounties).toEqual(rolled.bounties);
    const purchased = { ...rolled, upgrades: { "net.radius": 1 } };
    expect(bountyBoard(purchased)).toBe(purchased);
    expect(bountyBoard({ ...rolled, round: 3 }).bounties?.round).toBe(3);
  });

  it("uses a migrated save's best round when last-round earnings are missing", () => {
    const save = { ...createSave("Skipper", new Date("2026-01-01")), round: 24 };
    save.stats.bestRoundEarnings = 26000;
    const board = bountyBoard(save);
    expect(board.bounties!.list.every((b) => b.reward >= 3900)).toBe(true);
    expect(bountyBoard(board)).toBe(board);
  });

  it("repairs a zero-estimate board once without rerolling it after purchases", () => {
    const save = { ...createSave("Skipper", new Date("2026-01-01")), round: 24 };
    const underpaid = bountyBoard(save);
    // A purchase may change the zero-roll candidates before the stored board is repaired.
    const migrated = { ...underpaid, upgrades: { "net.radius": 6, "rare.unlock": 1 },
      stats: { ...save.stats, bestRoundEarnings: 26000 } };
    const repaired = bountyBoard(migrated);
    expect(repaired.bounties!.list.every((b) => b.reward >= 3900)).toBe(true);
    expect(bountyBoard(repaired)).toBe(repaired);
    const purchased = { ...repaired, upgrades: { ...repaired.upgrades, "net.damage": 1 } };
    expect(bountyBoard(purchased)).toBe(purchased);
  });

  it("prefers the latest round to a historical best and keeps custom stored boards", () => {
    const save = { ...createSave("Skipper", new Date("2026-01-01")), round: 24 };
    save.stats.lastRoundEarnings = 1000; save.stats.bestRoundEarnings = 26000;
    expect(bountyBoard(save).bounties!.list.every((b) => b.reward >= 150 && b.reward <= 300)).toBe(true);
    save.bounties = { round: 24, list: [{ id: "custom", kind: "earn", target: 10, reward: 20 }] };
    expect(bountyBoard(save)).toBe(save);
  });

  it("suppresses stale boards in round one and after buying the final upgrade", () => {
    const rolled = bountyBoard({ ...createSave("Skipper"), round: 2 });
    expect(bountyBoard({ ...rolled, round: 1 }).bounties?.list).toEqual([]);
    const upgrades = Object.fromEntries(TECH_NODES.map((node) => [node.id, node.maxLevel]));
    expect(bountyBoard({ ...rolled, upgrades }).bounties?.list).toEqual([]);
  });

  it("pays only completed bounties and never calls an empty board perfect", () => {
    const world = new World(BASE_STATS, createRng(1), 1280, 800);
    world.earned = 80;
    const list = [ { id: "a", kind: "earn" as const, target: 50, reward: 20 },
      { id: "b", kind: "chest" as const, target: 1, reward: 30 } ];
    const result = bountyResult(list, bountyFacts(world));
    expect(result.reward).toBe(20); expect(result.completed).toBe(1); expect(result.all).toBe(false);
    expect(result.items[1]?.failed).toBe(true);
    world.bonusCount.treasure = 1;
    expect(bountyResult(list, bountyFacts(world)).all).toBe(true);
    expect(bountyResult([], bountyFacts(world))).toMatchObject({ reward: 0, completed: 0, all: false });
  });
});
