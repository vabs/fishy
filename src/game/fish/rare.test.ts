import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import { BASE_STATS, cloneStats, type Stats } from "../stats";
import { STEP, World, type CaptureSource, type Fish } from "../world";
import { ARMOR_FLOOR } from "./rare";

const SOURCES: CaptureSource[] = ["net", "electric", "epic", "star", "whirlpool"];

function makeWorld(tweak?: (stats: Stats) => void): World {
  const stats = cloneStats(BASE_STATS);
  stats.spawnRateMult = 0;
  stats.startFish = 0;
  stats.fish.normal.rate = 0;
  stats.fish.rare.rate = 1;
  tweak?.(stats);
  return new World(stats, createRng(42), 800, 600);
}

function withRare(armor: number, pierce: boolean, tweak?: (stats: Stats) => void): { world: World; fish: Fish } {
  const world = makeWorld((s) => {
    s.ability.rare.armor = armor;
    s.ability.rare.pierce = pierce;
    tweak?.(s);
  });
  const fish = world.spawn("rare")!;
  // Plenty of hp, so tests can hit it many times without capturing it.
  fish.hp = fish.maxHp = 1000;
  return { world, fish };
}

/** HP lost to one `world.damage` call. */
function hit(world: World, fish: Fish, amount: number, source: CaptureSource = "net"): number {
  const before = fish.hp;
  world.damage(fish, amount, source);
  return before - fish.hp;
}

describe("Rare armour", () => {
  it("takes a flat amount off every hit", () => {
    const { world, fish } = withRare(0.5, false);
    expect(hit(world, fish, 2)).toBeCloseTo(1.5);
    expect(hit(world, fish, 3)).toBeCloseTo(2.5);
  });

  it("applies to every damage source", () => {
    for (const source of SOURCES) {
      const { world, fish } = withRare(1, false);
      expect(hit(world, fish, 3, source)).toBeCloseTo(2);
    }
  });

  it("never blocks a hit outright: at least the floor gets through", () => {
    for (const source of SOURCES) {
      const { world, fish } = withRare(100, false);
      expect(hit(world, fish, 1, source)).toBeCloseTo(ARMOR_FLOOR);
      expect(hit(world, fish, 4, source)).toBeCloseTo(4 * ARMOR_FLOOR);
    }
    expect(ARMOR_FLOOR).toBeGreaterThan(0);
  });

  it("uses the floor only when armour would take more", () => {
    const { world, fish } = withRare(1, false);
    // 1 - 1 = 0 would block it, so the floor applies.
    expect(hit(world, fish, 1)).toBeCloseTo(ARMOR_FLOOR);
    // 2 - 1 = 1 is above the floor of 0.5.
    expect(hit(world, fish, 2)).toBeCloseTo(1);
  });

  it("ignores negative armour", () => {
    const { world, fish } = withRare(-3, false);
    expect(hit(world, fish, 1)).toBeCloseTo(1);
  });

  it("slows down a net capture compared with no armour", () => {
    const ticksToCatch = (armor: number) => {
      const world = makeWorld((s) => {
        s.ability.rare.armor = armor;
        s.netRadius = 10_000;
      });
      world.spawn("rare");
      world.pointer = { x: 400, y: 300 };
      let ticks = 0;
      while (world.fish.length > 0 && ticks < 1000) {
        world.update(STEP);
        ticks++;
      }
      return Math.round((ticks * STEP) / BASE_STATS.tickSeconds);
    };
    const hp = ticksToCatch(0);
    expect(ticksToCatch(0.5)).toBe(hp * 2);
  });
});

describe("Rare pierce", () => {
  it("doubles the first hit only, before armour", () => {
    const { world, fish } = withRare(0.5, true);
    expect(hit(world, fish, 1)).toBeCloseTo(2 * 1 - 0.5);
    expect(hit(world, fish, 1)).toBeCloseTo(0.5);
    expect(hit(world, fish, 1)).toBeCloseTo(0.5);
  });

  it("doubles the first hit from any source", () => {
    for (const source of SOURCES) {
      const { world, fish } = withRare(0, true);
      expect(hit(world, fish, 3, source)).toBeCloseTo(6);
      expect(hit(world, fish, 3, source)).toBeCloseTo(3);
    }
  });

  it("still keeps the floor on a pierced hit", () => {
    const { world, fish } = withRare(100, true);
    expect(hit(world, fish, 1)).toBeCloseTo(2 * ARMOR_FLOOR);
  });

  it("does nothing when not unlocked", () => {
    const { world, fish } = withRare(0, false);
    expect(hit(world, fish, 3)).toBeCloseTo(3);
  });

  it("counts per fish", () => {
    const { world, fish } = withRare(0, true);
    const other = world.spawn("rare")!;
    other.hp = other.maxHp = 1000;
    expect(hit(world, fish, 1)).toBeCloseTo(2);
    expect(hit(world, other, 1)).toBeCloseTo(2);
    expect(hit(world, fish, 1)).toBeCloseTo(1);
  });
});

describe("Rare effects", () => {
  it("emits an fx event when armour absorbs a hit, and a pierce event for the first hit", () => {
    const { world, fish } = withRare(0.5, true);
    world.damage(fish, 1, "net");
    world.damage(fish, 1, "net");
    const names = world.drainEvents().flatMap((e) => (e.type === "fx" && e.kind === "rare" ? [e.name] : []));
    expect(names).toEqual(["pierce", "armor"]);
  });

  it("stays quiet when armour absorbs nothing", () => {
    const { world, fish } = withRare(0, false);
    world.damage(fish, 1, "net");
    expect(world.drainEvents().filter((e) => e.type === "fx")).toHaveLength(0);
  });
});
