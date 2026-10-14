import { describe, expect, it } from "vitest";
import { createRng } from "./rng";
import { BASE_STATS, type Stats } from "./stats";
import { STEP, World, type Fish } from "./world";

function makeWorld(overrides: Partial<Stats> = {}): World {
  // No timed spawns unless a test asks for them, so fish counts stay predictable.
  return new World({ ...BASE_STATS, spawnSeconds: Infinity, ...overrides }, createRng(42), 800, 600);
}

/** Advances the world, calling `beforeStep` first on every step (e.g. to move the pointer). */
function run(world: World, seconds: number, beforeStep?: () => void): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    beforeStep?.();
    world.update(STEP);
  }
}

function followWith(world: World, fish: Fish): () => void {
  return () => {
    world.pointer = { x: fish.x, y: fish.y };
  };
}

describe("World", () => {
  it("damages a fish in the net on each tick and captures it at 0 hp", () => {
    const world = makeWorld({ startFish: 1 });
    const fish = world.fish[0]!;
    const follow = followWith(world, fish);

    run(world, BASE_STATS.tickSeconds + STEP, follow);
    expect(fish.hp).toBe(fish.maxHp - BASE_STATS.netDamage);
    expect(world.earned).toBe(0);

    run(world, BASE_STATS.tickSeconds, follow);
    expect(fish.captured).toBe(true);
    expect(world.fish).toHaveLength(0);
    expect(world.earned).toBe(fish.value);
    expect(world.caught.normal).toBe(1);
  });

  it("leaves fish outside the net alone", () => {
    const world = makeWorld({ startFish: 5 });
    world.pointer = { x: -1000, y: -1000 };
    run(world, 2);
    expect(world.fish.every((f) => f.hp === f.maxHp)).toBe(true);
  });

  it("hits every fish inside the net with one tick", () => {
    const world = makeWorld({ startFish: 6, netRadius: 10_000 });
    world.pointer = { x: 400, y: 300 };
    run(world, BASE_STATS.tickSeconds + STEP);
    expect(world.fish).toHaveLength(6);
    expect(world.fish.every((f) => f.hp === f.maxHp - BASE_STATS.netDamage)).toBe(true);
  });

  it("does not tick while the pointer is off the play area", () => {
    const world = makeWorld({ startFish: 3, netRadius: 10_000 });
    run(world, 2);
    expect(world.fish.every((f) => f.hp === f.maxHp)).toBe(true);
  });

  it("pays for a fish only once, however many times it is hit", () => {
    const world = makeWorld({ startFish: 1 });
    const fish = world.fish[0]!;
    world.damage(fish, 99, "net");
    world.damage(fish, 99, "net");
    world.capture(fish, "net");
    run(world, STEP);
    expect(world.earned).toBe(fish.value);
    expect(world.totalCaught).toBe(1);
  });

  it("spawns fish over time up to the cap", () => {
    const world = makeWorld({ startFish: 0, spawnSeconds: 0.1, maxFish: 5 });
    run(world, 2);
    expect(world.fish).toHaveLength(5);
  });

  it("keeps every fish clear of the boat and inside the screen", () => {
    const world = makeWorld({ startFish: 50 });
    run(world, 5);
    for (const fish of world.fish) {
      expect(Math.hypot(fish.x - 400, fish.y - 300)).toBeGreaterThan(50);
      expect(fish.x).toBeGreaterThanOrEqual(0);
      expect(fish.x).toBeLessThanOrEqual(800);
      expect(fish.y).toBeGreaterThanOrEqual(0);
      expect(fish.y).toBeLessThanOrEqual(600);
    }
  });

  it("ends when the timer runs out and then stops changing", () => {
    const world = makeWorld({ startFish: 3, roundSeconds: 1, netRadius: 10_000 });
    world.pointer = { x: 400, y: 300 };
    run(world, 1.5);
    expect(world.over).toBe(true);
    const earned = world.earned;
    const positions = world.fish.map((f) => [f.x, f.y]);
    run(world, 1);
    expect(world.earned).toBe(earned);
    expect(world.fish.map((f) => [f.x, f.y])).toEqual(positions);
  });

  it("plays out the same for the same seed", () => {
    const play = () => {
      const world = new World({ ...BASE_STATS }, createRng(7), 800, 600);
      run(world, 10, () => {
        world.pointer = { x: 400 + Math.sin(world.timeLeft) * 200, y: 300 };
      });
      return { earned: world.earned, fish: world.fish.length };
    };
    expect(play()).toEqual(play());
  });
});
