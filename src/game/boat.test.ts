import { describe, expect, it } from "vitest";
import { pullTowards } from "./boat";
import { createRng } from "./rng";
import { BASE_STATS } from "./stats";
import { World } from "./world";

describe("Boat-safe pulling", () => {
  it("moves through offsets and stops at the target", () => {
    const world = new World({ ...BASE_STATS, startFish: 0 }, createRng(1), 800, 600);
    const fish = world.spawn("normal", { at: { x: 600, y: 300 } })!;
    fish.offsetX = 10;
    fish.offsetY = 5;
    pullTowards(fish, { x: 650, y: 300 }, 20, { x: 400, y: 300 });
    expect(fish.x).toBe(620);
    expect(fish.offsetX).toBe(30);
    expect(fish.offsetY).toBe(5);
    pullTowards(fish, { x: 650, y: 300 }, 100, { x: 400, y: 300 });
    expect(fish.x).toBe(650);
  });

  it("stops before the boat even when the target lies on its far side", () => {
    const world = new World({ ...BASE_STATS, startFish: 0 }, createRng(1), 800, 600);
    const fish = world.spawn("normal", { at: { x: 600, y: 300 } })!;
    pullTowards(fish, { x: 200, y: 300 }, 1000, { x: 400, y: 300 });
    expect(fish.x).toBeCloseTo(470);
    expect(fish.y).toBe(300);
    const offset = fish.offsetX;
    pullTowards(fish, { x: 400, y: 300 }, 1000, { x: 400, y: 300 });
    expect(fish.offsetX).toBeCloseTo(offset);
  });

  it("allows tangential movement but blocks an oblique chord through the boat", () => {
    const world = new World({ ...BASE_STATS, startFish: 0 }, createRng(1), 800, 600);
    const fish = world.spawn("normal", { at: { x: 600, y: 350 } })!;
    pullTowards(fish, { x: 200, y: 350 }, 1000, { x: 400, y: 300 });
    expect(fish.x).toBeGreaterThan(400);
    expect(Math.hypot(fish.x - 400, fish.y - 300)).toBeCloseTo(70);
    pullTowards(fish, { x: fish.x, y: 450 }, 20, { x: 400, y: 300 });
    expect(fish.y).toBeCloseTo(370);
  });
});
