import { describe, expect, it } from "vitest";
import { FISH } from "./fish";
import { createRng } from "./rng";
import { BASE_STATS, type Stats } from "./stats";
import { STEP, World, type Fish } from "./world";

function makeWorld(overrides: Partial<Stats> = {}): World {
  // No timed spawns unless a test asks for them, so fish counts stay predictable.
  return new World({ ...BASE_STATS, spawnRateMult: 0, ...overrides }, createRng(42), 800, 600);
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
    expect(world.earned).toBe(FISH.normal.value);
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
    expect(world.earned).toBe(FISH.normal.value);
    expect(world.totalCaught).toBe(1);
  });

  it("keeps spawning each type at its own rate, with no limit on fish in the water", () => {
    const fish = { ...BASE_STATS.fish, normal: { rate: 20, rateMult: 1, valueMult: 1 } };
    const world = makeWorld({ startFish: 0, spawnRateMult: 1, fish });
    run(world, 5);
    expect(world.fish.length).toBeGreaterThanOrEqual(99);
    expect(world.fish.length).toBeLessThanOrEqual(101);
  });

  it("doesn't slow one type down when another starts spawning", () => {
    const normalsAfter = (fish: Stats["fish"]) => {
      const world = makeWorld({ startFish: 0, spawnRateMult: 1, fish });
      run(world, 4);
      return world.countOf("normal");
    };
    const normalOnly = { ...BASE_STATS.fish, normal: { rate: 5, rateMult: 1, valueMult: 1 } };
    const withRare = { ...normalOnly, rare: { rate: 5, rateMult: 1, valueMult: 1 } };
    expect(Math.abs(normalsAfter(withRare) - normalsAfter(normalOnly))).toBeLessThanOrEqual(1);
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

describe("World round mechanics", () => {
  it("deals critical damage when the crit roll succeeds", () => {
    const world = makeWorld({ startFish: 1, netRadius: 10_000, critChance: 1, critMult: 3 });
    world.pointer = { x: 400, y: 300 };
    run(world, BASE_STATS.tickSeconds + STEP);
    expect(world.totalCaught).toBe(1);
  });

  it("adds time when the time bonus roll succeeds", () => {
    const world = makeWorld({ startFish: 1, timeBonusChance: 1, timeBonusSeconds: 2 });
    const before = world.timeLeft;
    world.capture(world.fish[0]!, "net");
    run(world, STEP);
    expect(world.timeLeft).toBeCloseTo(before + 2 - STEP);
  });

  it("caps bonus time at one extra round length", () => {
    const world = makeWorld({ startFish: 20, roundSeconds: 2, timeBonusChance: 1, timeBonusSeconds: 0.75 });
    for (const fish of [...world.fish]) world.capture(fish, "net");
    run(world, STEP);
    expect(world.timeLeft).toBeCloseTo(2 + 2 - STEP);
  });

  it("spawns a twin of a captured fish when the twin roll succeeds", () => {
    const world = makeWorld({ startFish: 1, twinChance: 1 });
    const first = world.fish[0]!;
    world.capture(first, "net");
    run(world, STEP);
    expect(world.fish).toHaveLength(1);
    expect(world.fish[0]!.id).not.toBe(first.id);
    expect(world.fish[0]!.kind).toBe(first.kind);
  });

  it("raises the value multiplier for captures inside the combo window", () => {
    const world = makeWorld({ startFish: 3, comboWindow: 1, comboStep: 0.5, comboMax: 10 });
    for (const fish of [...world.fish]) world.capture(fish, "net");
    run(world, STEP);
    // 1 + 1.5 + 2 for three Normal fish worth 1 each.
    expect(world.earned).toBeCloseTo(4.5);
    expect(world.earnedBy.normal).toBeCloseTo(4.5);
    expect(world.combo).toBe(2);
  });

  it("spawns at a requested position", () => {
    const world = makeWorld({ startFish: 0 });
    const fish = world.spawn("normal", { at: { x: 600, y: 200 } })!;
    expect(fish.x).toBeCloseTo(600);
    expect(fish.y).toBeCloseTo(200);
  });

  it("respects a type's maxOnScreen", () => {
    const world = makeWorld({
      startFish: 5,
      fish: { ...BASE_STATS.fish, normal: { rate: 0, rateMult: 1, valueMult: 1 }, monster: { rate: 1, rateMult: 1, valueMult: 1 } },
    });
    expect(world.countOf("monster")).toBe(1);
  });
});
