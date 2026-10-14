import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import { BASE_STATS, cloneStats, type Stats } from "../stats";
import { STEP, World, type Fish } from "../world";
import { GOOBER_TIERS, gooberTier } from "./goober";
import type { FishKind } from "./types";

function makeWorld(tweak?: (stats: Stats) => void, seed = 42): World {
  const stats = cloneStats(BASE_STATS);
  stats.spawnSeconds = Infinity;
  stats.startFish = 0;
  stats.fish.normal.weight = 0;
  stats.fish.goober.weight = 1;
  tweak?.(stats);
  return new World(stats, createRng(seed), 800, 600);
}

function run(world: World, seconds: number, each?: () => void): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    world.update(STEP);
    each?.();
  }
}

/** Captures a Goober placed mid-orbit and returns it and the fish it burst into. */
function pop(tweak?: (stats: Stats) => void): { world: World; goober: Fish; spawned: Fish[] } {
  const world = makeWorld(tweak);
  const goober = world.spawn("goober", { at: { x: 600, y: 300 } })!;
  world.capture(goober, "net");
  run(world, STEP);
  return { world, goober, spawned: world.fish.filter((f) => f.id !== goober.id) };
}

describe("Goober burst", () => {
  it("bursts into `count` fish of its tier at its own position", () => {
    const { goober, spawned } = pop((s) => {
      s.ability.goober.tier = 2;
      s.ability.goober.count = 4;
    });
    expect(spawned).toHaveLength(4);
    expect(spawned.every((f) => f.kind === "rare")).toBe(true);
    for (const f of spawned) expect(Math.hypot(f.x - goober.x, f.y - goober.y)).toBeLessThan(40);
  });

  it("spreads the burst so the fish don't stack", () => {
    const { spawned } = pop((s) => {
      s.ability.goober.count = 5;
    });
    for (const a of spawned) {
      for (const b of spawned) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(10);
    }
  });

  it("walks the tier ladder Normal, Uncommon, Rare, Electric, Epic", () => {
    expect([...GOOBER_TIERS]).toEqual(["normal", "uncommon", "rare", "electric", "epic"]);
    GOOBER_TIERS.forEach((kind, tier) => {
      const { spawned } = pop((s) => {
        s.ability.goober.tier = tier;
        s.ability.goober.count = 2;
        // One fish per Uncommon, so school members don't muddy the count.
        s.ability.uncommon.schoolMin = 1;
        s.ability.uncommon.schoolMax = 1;
      });
      expect(spawned.map((f) => f.kind)).toEqual([kind, kind]);
    });
  });

  it("clamps tiers outside the ladder", () => {
    expect(gooberTier(-3)).toBe("normal");
    expect(gooberTier(99)).toBe("epic");
    expect(gooberTier(1.7)).toBe("uncommon");
    expect(gooberTier(Number.NaN)).toBe("normal");
    const { spawned } = pop((s) => {
      s.ability.goober.tier = 42;
    });
    expect(spawned.every((f) => f.kind === "epic")).toBe(true);
  });

  it("never spawns a Goober, Monster or Star, whatever the tier", () => {
    const banned: FishKind[] = ["goober", "monster", "star"];
    for (let tier = -5; tier <= 20; tier++) expect(banned).not.toContain(gooberTier(tier));
    for (const kind of GOOBER_TIERS) expect(banned).not.toContain(kind);
  });

  it("ignores maxFish", () => {
    const { world, spawned } = pop((s) => {
      s.maxFish = 1;
      s.ability.goober.count = 6;
    });
    expect(spawned).toHaveLength(6);
    expect(world.fish.length).toBeGreaterThan(world.stats.maxFish);
  });

  it("spawns nothing for a count of 0", () => {
    const { spawned } = pop((s) => {
      s.ability.goober.count = 0;
    });
    expect(spawned).toHaveLength(0);
  });

  it("emits a burst fx event where it popped", () => {
    const { world, goober } = pop();
    const burst = world.drainEvents().find((e) => e.type === "fx" && e.kind === "goober");
    expect(burst).toMatchObject({ name: "burst", x: goober.x, y: goober.y });
  });

  it("doesn't start Uncommon schools", () => {
    const { spawned } = pop((s) => {
      s.ability.goober.tier = 1;
      s.ability.goober.count = 3;
      s.ability.uncommon.schoolMin = 5;
      s.ability.uncommon.schoolMax = 5;
    });
    expect(spawned).toHaveLength(3);
    expect(spawned.every((f) => f.kind === "uncommon" && f.state.school === undefined)).toBe(true);
  });

  it("plays out the same for the same seed", () => {
    const positions = () => pop((s) => (s.ability.goober.count = 4)).spawned.map((f) => [f.x, f.y]);
    expect(positions()).toEqual(positions());
  });
});

describe("Goober movement", () => {
  it("sometimes reverses, easing to a stop instead of snapping", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const world = makeWorld(undefined, seed);
      const fish = world.spawn("goober")!;
      let flips = 0;
      let dir = fish.dir;
      let mult = fish.speedMult;
      let biggestJump = 0;
      run(world, 20, () => {
        biggestJump = Math.max(biggestJump, Math.abs(fish.speedMult - mult));
        if (fish.dir !== dir) {
          flips++;
          // It only turns round once it has all but stopped.
          expect(fish.speedMult).toBeLessThan(0.1);
        }
        dir = fish.dir;
        mult = fish.speedMult;
      });
      expect(flips).toBeGreaterThanOrEqual(2);
      expect(biggestJump).toBeLessThan(0.1);
    }
  });

  it("bobs further in and out than a Normal fish", () => {
    const world = makeWorld();
    // A square screen makes the orbit a circle, so distance from the centre changes only by bobbing.
    world.resize(600, 600);
    const bob = (fish: Fish) => {
      let near = Infinity;
      let far = 0;
      return {
        sample() {
          const d = Math.hypot(fish.x - 300, fish.y - 300);
          near = Math.min(near, d);
          far = Math.max(far, d);
        },
        get range() {
          return far - near;
        },
      };
    };
    const goober = bob(world.spawn("goober", { at: { x: 450, y: 300 } })!);
    const normal = bob(world.spawn("normal", { at: { x: 150, y: 300 } })!);
    run(world, 6, () => {
      goober.sample();
      normal.sample();
    });
    expect(goober.range).toBeGreaterThan(40);
    expect(goober.range).toBeGreaterThan(normal.range * 2);
  });
});
