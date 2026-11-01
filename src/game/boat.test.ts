import { describe, expect, it } from "vitest";
import { pullTowards, relaxPull, resizePull } from "./boat";
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

function boatWorld(tune?: (stats: typeof BASE_STATS) => void, endless = false): World {
  const stats = structuredClone(BASE_STATS);
  Object.assign(stats, { startFish: 0, spawnRateMult: 0, goldenRate: 0, roundSeconds: 100 });
  tune?.(stats);
  return new World(stats, createRng(42), 800, 600, { round: 1, final: false, endless });
}

function run(world: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) world.update(1 / 60);
}

describe("Chum", () => {
  it("is a no-op while locked, cooling down or after the round ends", () => {
    const locked = boatWorld();
    expect(locked.chum()).toBe(false);
    expect(locked.chumReady).toBe(false);
    expect(locked.chumCooldownLeft).toBe(Infinity);
    expect(locked.chumActive).toBe(false);
    expect(locked.drainEvents()).toEqual([]);
    const world = boatWorld(s => { s.boat.chum = true; });
    expect(world.chumReady).toBe(true);
    expect(world.chum()).toBe(true);
    expect(world.chum()).toBe(false);
    expect(world.chumActive).toBe(true);
    expect(world.chumCooldownLeft).toBe(20);
    expect(world.drainEvents()).toEqual([{ type: "chum", x: 400, y: 300 }]);
    world.timeLeft = 0;
    expect(world.chum()).toBe(false);
    run(world, 2);
    expect(world.chumCooldownLeft).toBe(20);
    expect(world.chumReady).toBe(false);
  });

  it("pulls only nearby fish during its active duration and becomes ready after its cooldown", () => {
    const world = boatWorld(s => { s.boat.chum = true; });
    const fish = world.spawn("normal", { at: { x: 600, y: 300 } })!;
    const outside = world.spawn("normal", { at: { x: 120, y: 300 } })!;
    fish.speedMult = outside.speedMult = 0;
    world.chum();
    world.update(1 / 60);
    expect(fish.offsetX).toBeCloseTo(-1);
    expect(outside.offsetX).toBe(0);
    run(world, 4 - 1 / 60);
    expect(world.chumActive).toBe(false);
    expect(fish.x).toBeCloseTo(470);
    const offset = fish.offsetX;
    run(world, 1);
    expect(Math.abs(fish.offsetX)).toBeLessThan(Math.abs(offset));
    expect(world.chumCooldownLeft).toBeCloseTo(15);
    run(world, 15);
    expect(world.chumCooldownLeft).toBe(0);
    expect(world.chumReady).toBe(true);
    expect(world.chum()).toBe(true);
  });

  it("stops at boat clearance and finishes with the endless session", () => {
    const world = boatWorld(s => { s.boat.chum = true; s.boat.chumPull = 10000; }, true);
    const fish = world.spawn("normal", { at: { x: 500, y: 300 } })!;
    fish.speedMult = 0;
    world.chum();
    run(world, 1);
    expect(Math.hypot(fish.x - 400, fish.y - 300)).toBeCloseTo(70);
    world.finish();
    const left = world.chumCooldownLeft;
    expect(world.chum()).toBe(false);
    run(world, 10);
    expect(world.chumCooldownLeft).toBe(left);
  });
});

describe("Lantern and day cycle", () => {
  it("slows nearby swimming without compounding a type's speed multiplier or affecting distant fish", () => {
    const normal = boatWorld();
    const lit = boatWorld(s => { s.boat.lanternRadius = 150; });
    const a = normal.spawn("normal", { at: { x: 500, y: 300 } })!;
    const b = lit.spawn("normal", { at: { x: 500, y: 300 } })!;
    const farA = normal.spawn("normal", { at: { x: 650, y: 300 } })!;
    const farB = lit.spawn("normal", { at: { x: 650, y: 300 } })!;
    a.speedMult = b.speedMult = 0.8;
    normal.update(1 / 60);
    lit.update(1 / 60);
    expect(Math.abs(b.angle / a.angle)).toBeCloseTo(0.7, 10);
    run(normal, 59 / 60);
    run(lit, 59 / 60);
    expect(Math.abs(b.angle)).toBeLessThan(Math.abs(a.angle) * 0.8);
    expect(b.speedMult).toBe(0.8);
    expect(farB.x).toBe(farA.x);
    expect(farB.y).toBe(farA.y);
  });

  it("pulls gently only during endless nights and wraps the four-minute day", () => {
    const timed = boatWorld(s => { s.boat.lanternRadius = 210; });
    const day = boatWorld(s => { s.boat.lanternRadius = 210; }, true);
    const night = boatWorld(s => { s.boat.lanternRadius = 210; }, true);
    const dark = boatWorld(undefined, true);
    night.elapsed = dark.elapsed = 120;
    for (const world of [timed, day, night, dark]) {
      const fish = world.spawn("normal", { at: { x: 550, y: 300 } })!;
      fish.speedMult = 0;
      world.update(1 / 60);
    }
    expect(timed.timeOfDay).toBeUndefined();
    expect(day.timeOfDay).toBeCloseTo(0);
    expect(night.timeOfDay).toBeCloseTo(0.5);
    expect(night.fish[0]!.offsetX).toBeLessThan(0);
    expect(night.fish[0]!.offsetX).toBeGreaterThan(-1);
    for (const world of [timed, day, dark]) expect(world.fish[0]!.offsetX).toBe(0);
    night.elapsed = 240;
    expect(night.timeOfDay).toBe(0);
    night.elapsed = 360;
    expect(night.timeOfDay).toBe(0.5);
  });
});


describe("Lantern with golden fish", () => {
  it("slows swimming without extending the golden fish's escape clock", () => {
    const world = boatWorld(s => { s.boat.lanternRadius = 500; s.goldenSeconds = 0.1; });
    const fish = world.spawn("normal", { at: { x: 500, y: 300 }, golden: true })!;
    run(world, 0.2);
    expect(world.fish).not.toContain(fish);
    expect(world.totalCaught).toBe(0);
    expect(world.drainEvents().filter(e => e.type === "golden-escape")).toHaveLength(1);
  });
});

describe("Released lure movement", () => {
  it.each([600, 700])("lets a swimming fish return to its path safely after chum from x=%i", x => {
    const world = boatWorld(s => { s.boat.chum = true; s.boat.chumRadius = 340; s.boat.chumSeconds = 6; });
    const fish = world.spawn("normal", { at: { x, y: 300 } })!;
    world.chum();
    let closest = Infinity;
    let left = Infinity;
    let right = -Infinity;
    for (let i = 0; i < 40 * 60; i++) {
      world.update(1 / 60);
      closest = Math.min(closest, Math.hypot(fish.x - 400, fish.y - 300));
      left = Math.min(left, fish.x);
      right = Math.max(right, fish.x);
    }
    expect(closest).toBeGreaterThanOrEqual(60);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(800);
    expect(Math.hypot(fish.offsetX, fish.offsetY)).toBeLessThan(0.01);
  });
});


describe("Lure displacement ownership", () => {
  it("releases its share while preserving other offsets, including after resize", () => {
    const world = boatWorld();
    const fish = world.spawn("normal", { at: { x: 600, y: 300 } })!;
    fish.offsetX = 10;
    fish.offsetY = 5;
    pullTowards(fish, { x: 660, y: 300 }, 60, { x: 400, y: 300 });
    relaxPull(fish, { x: 400, y: 300 }, 1 / 60);
    fish.offsetX *= 1.5;
    fish.offsetY *= 2;
    fish.x *= 1.5;
    fish.y *= 2;
    resizePull(fish, 1.5, 2);
    for (let i = 0; i < 600; i++) relaxPull(fish, { x: 600, y: 600 }, 1 / 60);
    expect(fish.offsetX).toBeCloseTo(15);
    expect(fish.offsetY).toBeCloseTo(10);
    expect(fish.x).toBeCloseTo(900);
    expect(fish.y).toBeCloseTo(600);
  });
});
