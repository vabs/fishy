import { describe, expect, it } from "vitest";
import { createRng } from "./rng";
import { BASE_STATS, cloneStats } from "./stats";
import { summaryRows } from "./summary";
import { STEP, World } from "./world";

describe("summaryRows", () => {
  it("gives golden fish their own row, and the rows add up to the total", () => {
    const stats = cloneStats(BASE_STATS);
    Object.assign(stats, { spawnRateMult: 0, startFish: 0, goldenRate: 0, valueMult: 1.37, comboWindow: 1, comboStep: 0.13 });
    stats.fish.uncommon.rate = 1;
    const world = new World(stats, createRng(5), 800, 600, { round: 4, final: false });
    for (let i = 0; i < 3; i++) world.spawn("normal");
    world.spawn("rare");
    world.spawn("normal", { golden: true });
    world.spawn("rare", { golden: true });
    for (const fish of [...world.fish]) world.capture(fish, "net");
    world.update(STEP);

    const rows = summaryRows(world);
    expect(rows.map((r) => r.key)).toEqual(["golden", "rare", "normal"]);
    expect(rows.find((r) => r.key === "golden")?.count).toBe(2);
    expect(rows.find((r) => r.key === "normal")?.count).toBe(3);
    expect(rows.reduce((sum, r) => sum + r.earned, 0)).toBe(Math.floor(world.earned));
    for (const row of rows) expect(Number.isInteger(row.earned)).toBe(true);
  });

  it("gives opened chests a Treasure row, still adding up to the total", () => {
    const stats = cloneStats(BASE_STATS);
    Object.assign(stats, { spawnRateMult: 0, startFish: 0, goldenRate: 0, valueMult: 1.13, netRadius: 200 });
    const world = new World(stats, createRng(8), 800, 600, { round: 6, final: false });
    world.chest = { x: 600, y: 100, vx: 0, vy: 0, hp: 0.5, maxHp: 10, hitFlash: 0, age: 1 };
    world.spawn("normal", { at: { x: 600, y: 120 } });
    world.pointer = { x: 600, y: 105 };
    for (let i = 0; i < 70; i++) world.update(STEP);

    const rows = summaryRows(world);
    expect(rows[0]).toMatchObject({ key: "treasure", count: 1 });
    expect(rows.map((r) => r.key)).toContain("normal");
    expect(rows.reduce((sum, r) => sum + r.earned, 0)).toBe(Math.floor(world.earned));
  });

  it("leaves out bonus rows with nothing in them", () => {
    const world = new World(cloneStats(BASE_STATS), createRng(1), 800, 600);
    world.capture(world.fish[0]!, "net");
    world.update(STEP);
    expect(summaryRows(world).map((r) => r.key)).toEqual(["normal"]);
  });

  it("is empty when nothing was caught", () => {
    expect(summaryRows(new World(cloneStats(BASE_STATS), createRng(1), 800, 600))).toEqual([]);
  });
});
