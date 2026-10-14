import { describe, expect, it } from "vitest";
import { FISH } from "./fish";
import { GOLDEN } from "./golden";
import { createRng, type Rng } from "./rng";
import { BASE_STATS, cloneStats, type Stats } from "./stats";
import { STEP, World, type Fish, type WorldEvent } from "./world";

/** No timed or starting spawns, and a round long enough for any test. Rates still weight golden picks. */
function quietStats(tweak?: (stats: Stats) => void): Stats {
  const stats = cloneStats(BASE_STATS);
  stats.spawnRateMult = 0;
  stats.startFish = 0;
  stats.roundSeconds = 10_000;
  tweak?.(stats);
  return stats;
}

function makeWorld(stats: Stats, round = 2, rng: Rng = createRng(42), width = 800, height = 600): World {
  return new World(stats, rng, width, height, { round, final: false });
}

/** Advances the world, calling `beforeStep` first on every step. Returns every event on the way. */
function run(world: World, seconds: number, beforeStep?: () => void): WorldEvent[] {
  const events: WorldEvent[] = [];
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    beforeStep?.();
    world.update(STEP);
    events.push(...world.drainEvents());
  }
  return events;
}

const count = (events: WorldEvent[], type: WorldEvent["type"]) => events.filter((e) => e.type === type).length;

/** Path length a fish covers over `seconds`. */
function pathLength(world: World, fish: Fish, seconds: number, beforeStep?: () => void): number {
  let total = 0;
  let last = { x: fish.x, y: fish.y };
  run(world, seconds, () => {
    beforeStep?.();
    total += Math.hypot(fish.x - last.x, fish.y - last.y);
    last = { x: fish.x, y: fish.y };
  });
  return total + Math.hypot(fish.x - last.x, fish.y - last.y);
}

describe("Golden fish arrivals", () => {
  it("never appear in round 1, and draw no random numbers there", () => {
    const draws = (goldenRate: number) => {
      let n = 0;
      const base = createRng(7);
      const rng = () => {
        n++;
        return base();
      };
      const stats = cloneStats(BASE_STATS);
      stats.goldenRate = goldenRate;
      const world = new World(stats, rng, 800, 600);
      const events = run(world, 60, () => {
        world.pointer = { x: 400 + Math.sin(world.elapsed) * 200, y: 300 };
      });
      expect(count(events, "golden")).toBe(0);
      expect(world.fish.some((f) => f.golden)).toBe(false);
      return { n, earned: world.earned };
    };
    expect(draws(50)).toEqual(draws(0));
  });

  it("arrive on their own clock from round 2", () => {
    const world = makeWorld(quietStats((s) => (s.goldenRate = 0.5)));
    const events = run(world, 20);
    // The clock starts part-way to its first fish: 10 or 11 in 20 s.
    expect(count(events, "golden")).toBeGreaterThanOrEqual(10);
    expect(count(events, "golden")).toBeLessThanOrEqual(11);
  });

  it("arrive at the base rate of about one every 17 s", () => {
    const world = makeWorld(quietStats());
    const events = run(world, 170);
    expect(BASE_STATS.goldenRate).toBeCloseTo(0.06);
    expect(count(events, "golden")).toBeGreaterThanOrEqual(10);
    expect(count(events, "golden")).toBeLessThanOrEqual(11);
  });

  it("don't follow the spawn rate: a busier sea brings no more of them", () => {
    const golden = (spawnRateMult: number) => {
      const world = makeWorld(quietStats((s) => (s.spawnRateMult = spawnRateMult)));
      return count(run(world, 60), "golden");
    };
    expect(golden(8)).toBe(golden(0));
  });

  it("appear in the Final Round too", () => {
    const world = new World(quietStats((s) => (s.goldenRate = 1)), createRng(3), 800, 600, { round: 1, final: true });
    expect(count(run(world, 5), "golden")).toBeGreaterThanOrEqual(4);
  });

  it("pick their type in proportion to spawn rates", () => {
    const world = makeWorld(
      quietStats((s) => {
        s.goldenRate = 0;
        s.fish.normal.rate = 1;
        s.fish.rare.rate = 3;
      }),
    );
    const kinds = Array.from({ length: 400 }, () => world.spawnGolden()!.kind);
    const rare = kinds.filter((k) => k === "rare").length / kinds.length;
    expect(new Set(kinds)).toEqual(new Set(["normal", "rare"]));
    expect(rare).toBeGreaterThan(0.65);
    expect(rare).toBeLessThan(0.85);
  });

  it("swim alone: a golden Uncommon starts no school", () => {
    const world = makeWorld(
      quietStats((s) => {
        s.goldenRate = 0;
        s.fish.normal.rate = 0;
        s.fish.uncommon.rate = 1;
      }),
    );
    const fish = world.spawnGolden()!;
    expect(fish.kind).toBe("uncommon");
    expect(world.fish).toEqual([fish]);
    expect(fish.state.school).toBeUndefined();
    // A plain natural spawn still brings its school.
    world.spawn("uncommon");
    expect(world.fish.length).toBeGreaterThan(2);
  });
});

describe("Golden fish value", () => {
  it("is worth goldenValueMult times the fish, in its own summary row", () => {
    const world = makeWorld(quietStats((s) => (s.goldenRate = 0)));
    const fish = world.spawn("normal", { golden: true })!;
    world.drainEvents();
    world.capture(fish, "net");
    run(world, STEP);
    expect(BASE_STATS.goldenValueMult).toBe(10);
    expect(world.earned).toBeCloseTo(10 * FISH.normal.value);
    expect(world.caught).toEqual({ normal: 1 });
    expect(world.caughtBy).toEqual({});
    expect(world.earnedBy).toEqual({});
    expect(world.bonusCount.golden).toBe(1);
    expect(world.bonusEarned.golden).toBeCloseTo(world.earned);
  });

  it("stacks with type value, global value, the ability bonus and the combo", () => {
    const world = makeWorld(
      quietStats((s) => {
        s.goldenRate = 0;
        s.fish.rare.valueMult = 2;
        s.valueMult = 1.5;
        s.abilityValueMult = 1.5;
        s.comboWindow = 1;
        s.comboStep = 0.5;
        s.comboMax = 10;
      }),
    );
    const plain = world.spawn("normal")!;
    const golden = world.spawn("rare", { golden: true })!;
    world.capture(plain, "net");
    world.capture(golden, "electric");
    run(world, STEP);
    const goldenValue = FISH.rare.value * 2 * 1.5 * 1.5 * 1.5 * 10;
    expect(world.bonusEarned.golden).toBeCloseTo(goldenValue);
    expect(world.earned).toBeCloseTo(FISH.normal.value * 1.5 + goldenValue);
    expect(world.earnedBy).toEqual({ normal: FISH.normal.value * 1.5 });
  });

  it("marks the capture event as golden", () => {
    const world = makeWorld(quietStats((s) => (s.goldenRate = 0)));
    world.capture(world.spawn("normal", { golden: true })!, "net");
    const events = run(world, STEP);
    expect(events.find((e) => e.type === "capture")).toMatchObject({ golden: true, value: 10 * FISH.normal.value });
  });
});

describe("Golden fish escape", () => {
  it("dives away after goldenSeconds, paying nothing", () => {
    const world = makeWorld(quietStats((s) => (s.goldenRate = 0)));
    const plain = world.spawn("normal")!;
    const fish = world.spawn("normal", { golden: true })!;
    expect(BASE_STATS.goldenSeconds).toBe(8);
    run(world, BASE_STATS.goldenSeconds - 0.1);
    expect(world.fish).toContain(fish);
    const events = run(world, 0.2);
    expect(world.fish).toEqual([plain]);
    expect(events.find((e) => e.type === "golden-escape")).toMatchObject({ kind: "normal" });
    expect(count(events, "capture")).toBe(0);
    expect(world.earned).toBe(0);
    expect(world.bonusCount.golden).toBe(0);
  });

  it("lingers as long as goldenSeconds says", () => {
    const world = makeWorld(quietStats((s) => ((s.goldenRate = 0), (s.goldenSeconds = 20))));
    const fish = world.spawn("normal", { golden: true })!;
    run(world, 19.5);
    expect(world.fish).toContain(fish);
    run(world, 1);
    expect(world.fish).not.toContain(fish);
  });

  it("swims faster than its type", () => {
    // A square sea makes the orbit a circle, so the angle swept compares speed along the path.
    const world = makeWorld(quietStats((s) => (s.goldenRate = 0)), 2, createRng(42), 600, 600);
    const plain = world.spawn("normal", { at: { x: 480, y: 300 } })!;
    const golden = world.spawn("normal", { at: { x: 120, y: 300 }, golden: true })!;
    const from = { plain: plain.angle, golden: golden.angle };
    run(world, 2);
    const ratio = Math.abs(golden.angle - from.golden) / Math.abs(plain.angle - from.plain);
    expect(ratio).toBeCloseTo(GOLDEN.speedMult, 5);
  });

  it("darts away from a net that comes close, without touching speedMult", () => {
    const world = makeWorld(quietStats((s) => (s.goldenRate = 0)));
    const golden = world.spawn("normal", { at: { x: 622, y: 300 }, golden: true })!;
    const calm = pathLength(world, golden, 1);
    // Chase it from behind, close enough to scare it but not inside the net.
    const behind = () => {
      world.pointer = { x: golden.x - Math.cos(golden.heading) * 100, y: golden.y - Math.sin(golden.heading) * 100 };
    };
    run(world, 0.5, behind);
    const chased = pathLength(world, golden, 1, behind);
    expect(chased / calm).toBeGreaterThan(GOLDEN.dartMult * 0.85);
    expect(golden.speedMult).toBe(1);
    expect(golden.golden!.dart).toBe(1);
  });

  it("turns round when the net comes at it from ahead, and gets away", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const world = makeWorld(quietStats((s) => (s.goldenRate = 0)), 2, createRng(seed));
      const fish = world.spawn("normal", { at: { x: 622, y: 300 }, golden: true })!;
      const dir = fish.dir;
      // At angle 0 a fish swimming dir 1 heads down the screen.
      const net = { x: 622, y: 300 + dir * 100 };
      world.pointer = net;
      run(world, STEP);
      expect(fish.dir, `seed ${seed}`).toBe(-dir);
      const before = Math.hypot(fish.x - net.x, fish.y - net.y);
      run(world, 1);
      expect(Math.hypot(fish.x - net.x, fish.y - net.y)).toBeGreaterThan(before + 60);
    }
  });

  it("is caught like any fish once the net holds it", () => {
    const world = makeWorld(quietStats((s) => ((s.goldenRate = 0), (s.netRadius = 10_000))));
    world.spawn("normal", { golden: true });
    world.pointer = { x: 400, y: 300 };
    run(world, BASE_STATS.tickSeconds * 2 + STEP);
    expect(world.bonusCount.golden).toBe(1);
  });
});

describe("Golden fish keep their type's behaviour", () => {
  it("a golden Electric still releases its current", () => {
    const world = makeWorld(quietStats((s) => (s.goldenRate = 0)));
    const eel = world.spawn("electric", { at: { x: 600, y: 300 }, golden: true })!;
    world.spawn("normal", { at: { x: 640, y: 300 } });
    world.capture(eel, "net");
    const events = run(world, STEP);
    expect(events.find((e) => e.type === "fx" && e.kind === "electric")).toMatchObject({ name: "current" });
  });

  it("a golden Goober still bursts, into fish that aren't golden", () => {
    const world = makeWorld(quietStats((s) => (s.goldenRate = 0)));
    const goober = world.spawn("goober", { golden: true })!;
    world.capture(goober, "net");
    run(world, STEP);
    expect(world.fish).toHaveLength(BASE_STATS.ability.goober.count);
    expect(world.fish.every((f) => !f.golden && f.credit === "goober")).toBe(true);
    expect(world.bonusCount.golden).toBe(1);
    expect(world.caughtBy).toEqual({});
  });
});
