import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import { BASE_STATS, cloneStats, type Stats } from "../stats";
import { STEP, World } from "../world";

function makeWorld(seed = 42, tweak?: (stats: Stats) => void, width = 800, height = 600): World {
  const stats = cloneStats(BASE_STATS);
  // No timed or starting spawns unless a test asks, so fish counts stay predictable.
  stats.spawnSeconds = Infinity;
  stats.startFish = 0;
  stats.fish.normal.weight = 0;
  stats.fish.uncommon.weight = 1;
  tweak?.(stats);
  return new World(stats, createRng(seed), width, height);
}

function run(world: World, seconds: number): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) world.update(STEP);
}

describe("Uncommon schools", () => {
  it("spawns a school of schoolMin..schoolMax fish, covering the whole range", () => {
    const sizes = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const world = makeWorld(seed);
      world.spawn();
      const n = world.fish.length;
      expect(n).toBeGreaterThanOrEqual(BASE_STATS.ability.uncommon.schoolMin);
      expect(n).toBeLessThanOrEqual(BASE_STATS.ability.uncommon.schoolMax);
      expect(world.fish.every((f) => f.kind === "uncommon")).toBe(true);
      sizes.add(n);
    }
    expect([...sizes].sort()).toEqual([3, 4, 5]);
  });

  it("reads the school size from ability stats", () => {
    const world = makeWorld(1, (s) => {
      s.ability.uncommon.schoolMin = 7;
      s.ability.uncommon.schoolMax = 7;
    });
    world.spawn("uncommon");
    expect(world.fish).toHaveLength(7);
  });

  it("schools the fish already in the water at the start", () => {
    const world = makeWorld(3, (s) => {
      s.startFish = 2;
      s.ability.uncommon.schoolMin = 3;
      s.ability.uncommon.schoolMax = 3;
    });
    expect(world.fish).toHaveLength(6);
  });

  it("gives every member the leader's direction and keeps them apart", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const world = makeWorld(seed);
      world.spawn();
      const [leader, ...members] = world.fish;
      for (const m of members) {
        expect(m.dir).toBe(leader!.dir);
        expect(m.state.school).toBe(leader!.id);
      }
      for (const a of world.fish) {
        for (const b of world.fish) {
          if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(12);
        }
      }
    }
  });

  it.each([
    [800, 600],
    [1920, 1080],
  ])("moves the school together without overlapping (%i x %i)", (width, height) => {
    for (let seed = 1; seed <= 10; seed++) {
      const world = makeWorld(
        seed,
        (s) => {
          s.ability.uncommon.schoolMin = 5;
          s.ability.uncommon.schoolMax = 5;
        },
        width,
        height,
      );
      world.spawn();
      const leader = world.fish[0]!;
      const start = { x: leader.x, y: leader.y };
      const gaps = world.fish.map((f) => Math.hypot(f.x - leader.x, f.y - leader.y));

      let closest = Infinity;
      for (let t = 0; t < 6 / STEP; t++) {
        world.update(STEP);
        for (const a of world.fish) {
          for (const b of world.fish) if (a !== b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
        }
      }

      // The school went somewhere...
      expect(Math.hypot(leader.x - start.x, leader.y - start.y)).toBeGreaterThan(60);
      // ...never bunched up...
      expect(closest).toBeGreaterThan(18);
      // ...and every member is still roughly where it started relative to the leader. Gaps are kept
      // along the path, so the straight-line distance only changes where the path curves.
      world.fish.forEach((f, i) => {
        expect(Math.abs(Math.hypot(f.x - leader.x, f.y - leader.y) - gaps[i]!)).toBeLessThan(4 + gaps[i]! * 0.3);
        expect(f.dir).toBe(leader.dir);
      });
    }
  });

  it("keeps formation around the next member when the leader is caught", () => {
    const world = makeWorld(5, (s) => {
      s.ability.uncommon.schoolMin = 4;
      s.ability.uncommon.schoolMax = 4;
    });
    world.spawn();
    const [leader, next, ...rest] = world.fish;
    world.capture(leader!, "net");
    run(world, STEP);
    const gaps = rest.map((f) => Math.hypot(f.x - next!.x, f.y - next!.y));
    run(world, 6);
    rest.forEach((f, i) => {
      expect(Math.abs(Math.hypot(f.x - next!.x, f.y - next!.y) - gaps[i]!)).toBeLessThan(4 + gaps[i]! * 0.3);
    });
  });

  it("respects maxFish: a school stops growing when the water is full", () => {
    const world = makeWorld(1, (s) => {
      s.maxFish = 2;
      s.ability.uncommon.schoolMin = 5;
      s.ability.uncommon.schoolMax = 5;
    });
    world.spawn();
    expect(world.fish).toHaveLength(2);
  });

  it("does not start a school from a twin", () => {
    const world = makeWorld(2, (s) => {
      s.twinChance = 1;
      s.ability.uncommon.schoolMin = 3;
      s.ability.uncommon.schoolMax = 3;
    });
    world.spawn();
    expect(world.fish).toHaveLength(3);
    const caught = world.fish[1]!;
    world.capture(caught, "net");
    run(world, STEP);
    // Two left from the school, plus one lone twin.
    expect(world.fish).toHaveLength(3);
    const twin = world.fish.find((f) => f.state.school === undefined);
    expect(twin?.kind).toBe("uncommon");
  });

  it("still schools natural spawns in the steps after a capture", () => {
    const world = makeWorld(6, (s) => {
      s.spawnSeconds = 0.1;
      s.ability.uncommon.schoolMin = 3;
      s.ability.uncommon.schoolMax = 3;
    });
    world.spawn();
    world.capture(world.fish[0]!, "net");
    run(world, STEP);
    expect(world.fish).toHaveLength(2);
    // One timed spawn lands in this window.
    run(world, 0.1);
    expect(world.fish).toHaveLength(5);
  });
});
