import { describe, expect, it } from "vitest";
import { CHEST, chestTime, chestValue, launchChest, type Chest } from "./chest";
import { FISH } from "./fish";
import { createRng } from "./rng";
import { BASE_STATS, cloneStats, type Stats } from "./stats";
import { STEP, World, type WorldEvent } from "./world";

/** No timed or starting spawns, no golden fish, and a round long enough for any test. */
function quietStats(tweak?: (stats: Stats) => void): Stats {
  const stats = cloneStats(BASE_STATS);
  Object.assign(stats, { spawnRateMult: 0, startFish: 0, goldenRate: 0, roundSeconds: 10_000 });
  tweak?.(stats);
  return stats;
}

function makeWorld(stats: Stats, round = 3, seed = 42, final = false): World {
  return new World(stats, createRng(seed), 800, 600, { round, final });
}

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

/** A chest parked at (x, y), not moving. */
function park(world: World, x = 600, y = 120): Chest {
  const chest: Chest = { x, y, vx: 0, vy: 0, hp: CHEST.hp, maxHp: CHEST.hp, hitFlash: 0, age: 1 };
  world.chest = chest;
  return chest;
}

/**
 * Holds the net on the chest, step by step, until it opens. Returns the opening step's events and
 * the time left just before that step.
 */
function openIt(world: World, chest: Chest): { events: WorldEvent[]; timeBefore: number } {
  for (let i = 0; i < 60 * 30; i++) {
    const timeBefore = world.timeLeft;
    world.pointer = { x: chest.x, y: chest.y };
    world.update(STEP);
    const events = world.drainEvents();
    if (!world.chest) return { events, timeBefore };
  }
  throw new Error("the chest never opened");
}

describe("Chest rounds", () => {
  it("never comes in rounds 1 and 2, and draws nothing for it there", () => {
    const stats = quietStats((s) => (s.chestChance = 1));
    for (const round of [1, 2]) {
      const rng = createRng(1);
      expect(chestTime({ round, final: false }, stats, rng)).toBeNull();
      expect(rng()).toBe(createRng(1)());
      const world = makeWorld(stats, round);
      run(world, 60);
      expect(world.chest).toBeNull();
    }
  });

  it("comes in about chestChance of rounds from round 3", () => {
    const stats = quietStats();
    expect(BASE_STATS.chestChance).toBe(0.3);
    let chests = 0;
    for (let seed = 1; seed <= 1000; seed++) if (chestTime({ round: 3, final: false }, stats, createRng(seed)) !== null) chests++;
    expect(chests / 1000).toBeGreaterThan(0.26);
    expect(chests / 1000).toBeLessThan(0.34);
  });

  it("always comes in the Final Round", () => {
    const stats = quietStats((s) => (s.chestChance = 0));
    for (let seed = 1; seed <= 50; seed++) expect(chestTime({ round: 9, final: true }, stats, createRng(seed))).not.toBeNull();
    const world = makeWorld(quietStats((s) => ((s.chestChance = 0), (s.roundSeconds = 20))), 9, 3, true);
    let seen = false;
    run(world, 20, () => (seen ||= world.chest !== null));
    expect(seen).toBe(true);
  });

  it("appears between 20% and 60% of the round", () => {
    const stats = quietStats((s) => ((s.chestChance = 1), (s.roundSeconds = 30)));
    for (let seed = 1; seed <= 200; seed++) {
      const at = chestTime({ round: 5, final: false }, stats, createRng(seed))!;
      expect(at).toBeGreaterThanOrEqual(6);
      expect(at).toBeLessThanOrEqual(18);
    }
    const world = makeWorld(stats);
    let appeared = -1;
    run(world, 30, () => {
      if (appeared < 0 && world.chest) appeared = world.elapsed;
    });
    expect(appeared).toBeGreaterThanOrEqual(6);
    expect(appeared).toBeLessThanOrEqual(18 + STEP * 2);
  });

  it("plays out the same for the same seed", () => {
    const path = () => {
      const world = makeWorld(quietStats((s) => ((s.chestChance = 1), (s.roundSeconds = 30))), 4, 11);
      const points: number[][] = [];
      run(world, 30, () => world.chest && points.push([world.chest.x, world.chest.y]));
      return points;
    };
    expect(path().length).toBeGreaterThan(0);
    expect(path()).toEqual(path());
  });
});

describe("Chest drift", () => {
  it("floats in from one edge across to the other, clear of the boat, and is gone at the far edge", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const chest = launchChest(800, 600, createRng(seed));
      const onLeftOrRight = chest.x < 0 || chest.x > 800;
      const onTopOrBottom = chest.y < 0 || chest.y > 600;
      expect(onLeftOrRight !== onTopOrBottom, `seed ${seed}`).toBe(true);
      expect(Math.hypot(chest.vx, chest.vy)).toBeCloseTo(CHEST.speed);

      const world = makeWorld(quietStats());
      world.chest = chest;
      let steps = 0;
      let crossed = 0;
      while (world.chest && steps < 60 * 60) {
        world.update(STEP);
        steps++;
        expect(Math.hypot(chest.x - 400, chest.y - 300), `seed ${seed}`).toBeGreaterThan(120);
        crossed = Math.max(crossed, Math.abs(chest.x - 400) < 1 || Math.abs(chest.y - 300) < 1 ? 1 : 0);
      }
      expect(world.chest).toBeNull();
      // It went all the way across: past the middle of the screen to the far side.
      expect(crossed).toBe(1);
      expect(chest.x < -CHEST.size / 2 || chest.x > 800 + CHEST.size / 2 || chest.y < -CHEST.size / 2 || chest.y > 600 + CHEST.size / 2).toBe(true);
      expect(world.earned).toBe(0);
    }
  });

  it("keeps drifting at the same speed after the sea is resized", () => {
    const world = makeWorld(quietStats());
    const chest = park(world, 400, 100);
    chest.vx = CHEST.speed;
    world.resize(600, 800);
    expect(chest.x).toBeCloseTo(300);
    expect(chest.y).toBeCloseTo(100 * (800 / 600));
    expect(Math.hypot(chest.vx, chest.vy)).toBeCloseTo(CHEST.speed);
  });
});

describe("Chest opening", () => {
  it("takes net damage, with crits, and opens at 0 hp", () => {
    const world = makeWorld(quietStats((s) => ((s.netDamage = 2), (s.critChance = 1), (s.critMult = 2))));
    const chest = park(world);
    world.pointer = { x: chest.x, y: chest.y };
    run(world, BASE_STATS.tickSeconds + STEP);
    expect(chest.hp).toBe(CHEST.hp - 4);
    expect(chest.hitFlash).toBeGreaterThan(0);
    run(world, BASE_STATS.tickSeconds * 2);
    expect(world.chest).toBeNull();
    expect(world.bonusCount.treasure).toBe(1);
  });

  it("is never touched by abilities: currents, Epic nets, Star shots and whirlpools", () => {
    const world = makeWorld(quietStats((s) => ((s.fish.monster.rate = 1), (s.ability.epic.chance = 1))));
    const chest = park(world, 400, 120);
    const around = [
      world.spawn("electric", { at: { x: 400, y: 160 } })!,
      world.spawn("epic", { at: { x: 440, y: 150 } })!,
      world.spawn("star", { at: { x: 360, y: 150 } })!,
      world.spawn("monster", { at: { x: 420, y: 170 } })!,
    ];
    for (const fish of around) world.capture(fish, "net");
    // Star shots fly about for a while; keep the net away from the chest.
    world.pointer = { x: 700, y: 500 };
    run(world, 5);
    expect(chest.hp).toBe(CHEST.hp);
    expect(world.chest).toBe(chest);
  });

  it("pays 20 × the most valuable unlocked type's value, with value multipliers but no combo or ability bonus", () => {
    const tweak = (s: Stats) => {
      s.fish.rare.rate = 0.1;
      s.fish.rare.valueMult = 1.5;
      s.fish.electric.rate = 0; // worth more, but still locked
      s.valueMult = 2;
      s.comboWindow = 10;
      s.comboStep = 1;
      s.comboMax = 10;
    };
    const stats = quietStats(tweak);
    const expected = 20 * FISH.rare.value * 1.5 * 2;
    expect(CHEST.valueInFish).toBe(20);
    expect(chestValue(stats)).toBeCloseTo(expected);

    const world = makeWorld(stats);
    // Build a combo first; the chest ignores it.
    world.spawn("normal");
    world.spawn("normal");
    for (const fish of [...world.fish]) world.capture(fish, "net");
    run(world, STEP);
    const before = world.earned;
    expect(world.combo).toBe(1);
    const { events } = openIt(world, park(world));
    expect(world.earned - before).toBeCloseTo(expected);
    expect(world.bonusEarned.treasure).toBeCloseTo(expected);
    expect(world.bonusCount.treasure).toBe(1);
    expect(world.caughtBy).toEqual({ normal: 2 });
    expect(events.find((e) => e.type === "chest-open")).toMatchObject({ value: expected });
  });

  it("reads the most valuable type by its value multiplier too", () => {
    const stats = quietStats((s) => {
      s.fish.uncommon.rate = 1;
      s.fish.rare.rate = 1;
      s.fish.uncommon.valueMult = (FISH.rare.value / FISH.uncommon.value) * 2;
    });
    expect(chestValue(stats)).toBeCloseTo(20 * FISH.rare.value * 2);
  });

  it("adds round time or spills golden fish, about half the time each", () => {
    let time = 0;
    let golden = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const world = makeWorld(quietStats(), 3, seed);
      const { events, timeBefore } = openIt(world, park(world));
      const open = events.find((e) => e.type === "chest-open");
      if (open?.type !== "chest-open") throw new Error("no chest-open event");
      if (open.reward === "time") {
        time++;
        expect(world.timeLeft).toBeCloseTo(timeBefore + CHEST.bonusSeconds - STEP);
        expect(events.find((e) => e.type === "time-bonus")).toMatchObject({ seconds: CHEST.bonusSeconds });
        expect(world.fish.some((f) => f.golden)).toBe(false);
      } else {
        golden++;
        expect(world.timeLeft).toBeCloseTo(timeBefore - STEP);
        expect(events.filter((e) => e.type === "golden")).toHaveLength(CHEST.goldenFish);
        expect(world.fish.filter((f) => f.golden)).toHaveLength(CHEST.goldenFish);
      }
    }
    expect(time).toBeGreaterThan(15);
    expect(golden).toBeGreaterThan(15);
  });
});
