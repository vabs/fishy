import { describe, expect, it } from "vitest";
import { FISH } from "./fish";
import { createRng } from "./rng";
import { BASE_STATS, type Stats } from "./stats";
import { TECH_NODES, applyUpgrades } from "./tech";
import { ENDLESS, STEP, World, isFrenzyRound, type Fish, type RoundOptions, type WorldEvent } from "./world";

function makeWorld(overrides: Partial<Stats> = {}, round?: RoundOptions): World {
  // No timed spawns unless a test asks for them, so fish counts stay predictable.
  return new World({ ...BASE_STATS, spawnRateMult: 0, ...overrides }, createRng(42), 800, 600, round);
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
  it("keeps projectiles inside the arena when its orientation changes", () => {
    const world = makeWorld({ startFish: 1 });
    world.shots.push({
      kind: "star", x: 780, y: 580, vx: 100, vy: 50, radius: 14,
      damage: 2, bouncesLeft: 3, age: 1, cooldowns: new Map([[17, 0.2]]),
    });
    world.fish[0]!.offsetX = 72;
    world.fish[0]!.offsetY = 24;
    world.resize(600, 800);
    const shot = world.shots[0]!;
    expect(shot.x).toBeCloseTo(585);
    expect(shot.y).toBeCloseTo(580 * 4 / 3);
    expect(shot.x).toBeLessThanOrEqual(600 - shot.radius);
    expect(shot.y).toBeLessThanOrEqual(800 - shot.radius);
    expect(shot.cooldowns.get(17)).toBe(0.2);
    expect(Math.hypot(shot.vx, shot.vy)).toBeCloseTo(Math.hypot(100, 50));
    expect(world.fish[0]!.offsetX).toBe(54);
    expect(world.fish[0]!.offsetY).toBe(32);
    expect(world.elapsed).toBe(0);
    expect(world.earned).toBe(0);
  });

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

  it("pays the ability bonus for fish caught by an ability, not by the net", () => {
    const world = makeWorld({ startFish: 2, abilityValueMult: 1.5 });
    const [byNet, byCurrent] = world.fish;
    world.capture(byNet!, "net");
    world.capture(byCurrent!, "electric");
    run(world, STEP);
    expect(world.earned).toBeCloseTo(FISH.normal.value * 2.5);
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

describe("Feeding Frenzy", () => {
  const FRENZY_ROUND: RoundOptions = { round: 5, final: false };
  /**
   * A 20 s frenzy round with no fish, golden fish or chests unless asked: the wave runs from 7 s
   * to 13 s and spawns fish four times as fast.
   */
  const frenzyWorld = (overrides: Partial<Stats> = {}, round = FRENZY_ROUND) =>
    makeWorld(
      { startFish: 0, roundSeconds: 20, frenzySeconds: 6, frenzySpawnMult: 4, goldenRate: 0, chestChance: 0, ...overrides },
      round,
    );
  /** Normal fish spawning at `rate` per second, and nothing else. */
  const spawning = (rate: number): Partial<Stats> => ({
    spawnRateMult: 1,
    fish: { ...BASE_STATS.fish, normal: { rate, rateMult: 1, valueMult: 1 } },
  });

  it("comes in every fifth round and in the Final Round", () => {
    const rounds = Array.from({ length: 21 }, (_, i) => i + 1).filter((round) => isFrenzyRound({ round, final: false }));
    expect(rounds).toEqual([5, 10, 15, 20]);
    expect(isFrenzyRound({ round: 7, final: true })).toBe(true);
    expect(makeWorld({}, { round: 4, final: false }).frenzy).toBeNull();
    expect(makeWorld({}, { round: 10, final: false }).frenzy).not.toBeNull();
    expect(makeWorld({}, { round: 3, final: true }).frenzy).not.toBeNull();
  });

  it("never comes in a world built without round options, which plays round 1", () => {
    expect(makeWorld().frenzy).toBeNull();
    expect(makeWorld().round).toEqual({ round: 1, final: false });
  });

  it("leaves rounds without a frenzy exactly as they were", () => {
    const play = (round?: RoundOptions) => {
      // No golden fish or chests, which round 4 would otherwise bring.
      const world = new World({ ...BASE_STATS, goldenRate: 0, chestChance: 0 }, createRng(7), 800, 600, round);
      run(world, 10, () => {
        world.pointer = { x: 400 + Math.sin(world.timeLeft) * 200, y: 300 };
      });
      return { earned: world.earned, fish: world.fish.map((f) => [f.kind, f.x, f.y]), next: world.rng() };
    };
    expect(play({ round: 4, final: false })).toEqual(play());
  });

  it("starts 35% into the round's base length and lasts frenzySeconds, whatever time bonuses add", () => {
    const world = frenzyWorld({ startFish: 10, timeBonusChance: 1, timeBonusSeconds: 2 });
    expect(world.frenzy).toMatchObject({ start: 7, end: 13 });
    for (const fish of [...world.fish]) world.capture(fish, "net");
    run(world, STEP);
    expect(world.timeLeft).toBeGreaterThan(30);

    run(world, 6.9);
    expect(world.frenzyActive).toBe(false);
    expect(world.frenzyLeft).toBe(0);
    run(world, 0.2);
    expect(world.frenzyActive).toBe(true);
    expect(world.frenzyLeft).toBeCloseTo(5.9, 1);
    run(world, 5.8);
    expect(world.frenzyActive).toBe(true);
    run(world, 0.2);
    expect(world.frenzyActive).toBe(false);
    expect(world.frenzy).toMatchObject({ start: 7, end: 13 });
  });

  it("starts later in longer rounds and lasts longer with a longer wave", () => {
    expect(frenzyWorld({ roundSeconds: 30, frenzySeconds: 9 }).frenzy).toMatchObject({ start: 10.5, end: 19.5 });
  });

  it("announces its start and its end once each", () => {
    const world = frenzyWorld();
    const events: WorldEvent[] = [];
    run(world, 15, () => events.push(...world.drainEvents()));
    events.push(...world.drainEvents());
    expect(events.filter((e) => e.type === "frenzy")).toEqual([
      { type: "frenzy", phase: "start" },
      { type: "frenzy", phase: "end" },
    ]);
  });

  it("makes fish spawn four times as fast, only while the wave runs", () => {
    const world = frenzyWorld(spawning(10));
    run(world, 1);
    const counts = [world.fish.length];
    for (let i = 0; i < 3; i++) {
      run(world, 6);
      counts.push(world.fish.length);
    }
    const [before, during, after] = [counts[1]! - counts[0]!, counts[2]! - counts[1]!, counts[3]! - counts[2]!];
    expect(before).toBeGreaterThanOrEqual(59);
    expect(before).toBeLessThanOrEqual(61);
    expect(during).toBeGreaterThanOrEqual(238);
    expect(during).toBeLessThanOrEqual(242);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  it("follows the frenzy spawn multiplier", () => {
    const world = frenzyWorld({ ...spawning(10), frenzySpawnMult: 2 });
    run(world, 7);
    const before = world.fish.length;
    run(world, 6);
    expect(Math.abs(world.fish.length - before - 120)).toBeLessThanOrEqual(2);
  });

  it("pours the new fish in just behind a front that sweeps across the sea, swimming with it", () => {
    const world = frenzyWorld(spawning(10));
    const wave = world.frenzy!;
    const { cx, rx, minOrbit } = world.swimArea();
    run(world, 6.5);
    const fronts: number[] = [];
    let checked = 0;
    while (world.elapsed < 13.5) {
      world.update(STEP);
      const front = world.frenzyFront;
      if (front === null) continue;
      fronts.push(front);
      for (const fish of world.fish) {
        // Fish placed next to the boat are pushed out to its clearance, and fish are kept off the
        // swimming area's very ends; the rest sit where they poured in.
        if (fish.age > 0 || fish.orbit <= minOrbit || Math.abs(fish.x - cx) > 0.95 * rx) continue;
        const behind = wave.sweep * (front - fish.x);
        expect(behind).toBeGreaterThanOrEqual(-1e-6);
        expect(behind).toBeLessThanOrEqual(80);
        expect(Math.sign(Math.cos(fish.heading))).toBe(wave.sweep);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    // From one side of the swimming area to the other.
    expect(Math.abs(fronts[0]! - (cx - wave.sweep * rx))).toBeLessThan(5);
    expect(Math.abs(fronts[fronts.length - 1]! - (cx + wave.sweep * rx))).toBeLessThan(5);
    expect(world.frenzyFront).toBeNull();
  });

  it("pays 1.5× for fish caught while the wave runs, on top of the other multipliers", () => {
    const world = frenzyWorld({ startFish: 4, abilityValueMult: 1.5 });
    const [early, inWave, byCurrent, late] = world.fish;
    run(world, 1);
    world.capture(early!, "net");
    run(world, STEP);
    expect(world.earned).toBeCloseTo(1);

    run(world, 7);
    world.capture(inWave!, "net");
    world.capture(byCurrent!, "electric");
    run(world, STEP);
    expect(world.earned).toBeCloseTo(1 + 1.5 + 1.5 * 1.5);
    expect(world.frenzyEarned).toBeCloseTo(1.5 + 1.5 * 1.5);
    expect(world.frenzyCaught).toBe(2);

    run(world, 6);
    world.capture(late!, "net");
    run(world, STEP);
    expect(world.earned).toBeCloseTo(1 + 1.5 + 2.25 + 1);
    expect(world.frenzyEarned).toBeCloseTo(3.75);
    expect(world.frenzyCaught).toBe(2);
  });

  it("follows the frenzy value multiplier", () => {
    const world = frenzyWorld({ startFish: 1, frenzyValueMult: 2.5 });
    run(world, 8);
    world.capture(world.fish[0]!, "net");
    run(world, STEP);
    expect(world.earned).toBeCloseTo(2.5);
  });

  it("tallies what the wave earned as part of the round's totals", () => {
    const world = frenzyWorld({ ...spawning(4), startFish: 20, netRadius: 120 }, { round: 9, final: true });
    let inWave = false;
    let tally = 0;
    let caught = 0;
    run(world, 20, () => {
      const fish = world.fish.find((f) => !f.captured);
      if (fish) world.pointer = { x: fish.x, y: fish.y };
      for (const event of world.drainEvents()) {
        if (event.type === "frenzy") inWave = event.phase === "start";
        else if (event.type === "capture" && inWave) {
          tally += event.value;
          caught++;
        }
      }
    });
    expect(caught).toBeGreaterThan(0);
    expect(world.frenzyCaught).toBe(caught);
    expect(world.frenzyEarned).toBeCloseTo(tally);
    expect(world.frenzyEarned).toBeLessThan(world.earned);
    const rows = Object.values(world.earnedBy).reduce<number>((sum, n) => sum + (n ?? 0), 0);
    expect(rows).toBeCloseTo(world.earned);
  });
});

describe("Round facts", () => {
  it("retains the highest combo after the combo expires", () => {
    const world = makeWorld({ startFish: 3, comboWindow: 0.5, comboStep: 0.5, comboMax: 1.75 });
    expect(world.maxComboMult).toBe(1);
    expect(world.bestTickCatches).toBe(0);
    expect(world.bestStarHits).toBe(0);
    for (const fish of [...world.fish]) world.capture(fish, "electric");
    run(world, STEP);
    expect(world.maxComboMult).toBe(1.75);
    run(world, 1);
    world.capture(world.spawn("normal")!, "net");
    run(world, STEP);
    expect(world.comboMult).toBe(1);
    expect(world.maxComboMult).toBe(1.75);
  });

  it("counts lethal net hits per tick, excluding surviving hits and ability captures", () => {
    const world = makeWorld({ startFish: 0, netRadius: 40, netDamage: 10, tickSeconds: STEP });
    const eel = world.spawn("electric", { at: { x: 600, y: 300 } })!;
    eel.speedMult = 0;
    const nearby = world.spawn("normal", { at: { x: 670, y: 300 } })!;
    nearby.hp = 1;
    nearby.speedMult = 0;
    const sturdy = world.spawn("normal", { at: { x: 600, y: 300 } })!;
    sturdy.hp = 100;
    sturdy.speedMult = 0;
    world.pointer = { x: 600, y: 300 };
    run(world, 2 * STEP);
    expect(world.caught.electric).toBe(1);
    expect(world.caught.normal).toBe(1);
    expect(sturdy.captured).toBe(false);
    expect(world.bestTickCatches).toBe(1);
    for (let i = 0; i < 3; i++) world.spawn("normal", { at: world.pointer });
    for (let i = 0; i < 2; i++) {
      const fish = world.spawn("normal", { at: world.pointer })!;
      fish.hp = 15;
      fish.speedMult = 0;
    }
    // Three catches on the first tick, two on the second: their hauls must not be combined.
    world.update(2 * STEP);
    expect(world.totalCaught).toBe(7);
    expect(world.bestTickCatches).toBe(3);
    expect(world.drainEvents().filter(e => e.type === "capture" && e.source === "electric")).toHaveLength(1);
  });

  it("attributes a large haul to its tick even when captures wait for the next step", () => {
    const world = makeWorld({ startFish: 201, netRadius: 10_000, netDamage: 10, tickSeconds: STEP });
    world.pointer = { x: 400, y: 300 };
    run(world, STEP);
    expect(world.totalCaught).toBe(200);
    expect(world.bestTickCatches).toBe(201);
    run(world, STEP);
    expect(world.totalCaught).toBe(201);
    expect(world.bestTickCatches).toBe(201);
  });
});

/** Every upgrade at its real maximum, including fish and ability unlocks. */
function fullStats(): Stats {
  return applyUpgrades(BASE_STATS, Object.fromEntries(TECH_NODES.map(node => [node.id, node.maxLevel])));
}

describe("Timed seed compatibility", () => {
  // Recorded on main at 3b489ee before changing the simulation. The next RNG value also catches
  // extra draws that happen not to change this round's catches.
  it.each([
    { seed: 7, round: 1, final: false, full: false, earned: 0, caught: {}, next: 0.554895979585126 },
    { seed: 42, round: 4, final: false, full: false, earned: 1, caught: { normal: 1 }, next: 0.39465633244253695 },
    { seed: 19, round: 5, final: false, full: true, earned: 3597198.419999953,
      caught: { uncommon: 1286, normal: 985, electric: 201, star: 96, epic: 355, monster: 37, rare: 252, goober: 42 },
      next: 0.12441657553426921 },
    { seed: 123, round: 99, final: true, full: true, earned: 3503005.199999957,
      caught: { uncommon: 1217, normal: 949, star: 100, electric: 179, epic: 309, rare: 228, monster: 40, goober: 34 },
      next: 0.5533206530380994 },
  ])("preserves main's round $round with seed $seed", fixture => {
    for (const guarantee of [undefined, {}, { chest: false, golden: false }]) {
      const stats = fixture.full ? fullStats() : BASE_STATS;
      const world = new World(stats, createRng(fixture.seed), 1280, 800,
        { round: fixture.round, final: fixture.final, ...(guarantee ? { guarantee } : {}) });
      while (!world.over && world.elapsed < 240) {
        world.pointer = { x: 640 + Math.sin(world.elapsed) * 400, y: 400 + Math.cos(world.elapsed * 0.7) * 250 };
        world.update(STEP);
        world.drainEvents();
      }
      expect(world.over).toBe(true);
      expect(world.earned).toBe(fixture.earned);
      expect(world.caught).toEqual(fixture.caught);
      expect(world.rng()).toBe(fixture.next);
    }
  });
});

describe("Endless sessions", () => {
  const options: RoundOptions = { round: 1, final: false, endless: true };

  it("keeps an infinite clock until finish, then freezes the simulation", () => {
    const world = makeWorld({ startFish: 1, roundSeconds: 1 }, options);
    expect(world.endless).toBe(true);
    expect(world.timeLeft).toBe(Infinity);
    run(world, 10);
    expect(world.over).toBe(false);
    expect(world.elapsed).toBeCloseTo(10);
    expect(world.timeLeft).toBe(Infinity);
    world.finish();
    world.finish();
    expect(world.over).toBe(true);
    const positions = world.fish.map(f => [f.x, f.y]);
    run(world, 1);
    expect(world.elapsed).toBeCloseTo(10);
    expect(world.fish.map(f => [f.x, f.y])).toEqual(positions);
  });

  it("ignores finish in timed rounds", () => {
    const world = makeWorld({ roundSeconds: 1 });
    expect(world.endless).toBe(false);
    world.finish();
    expect(world.over).toBe(false);
    run(world, 2);
    expect(world.over).toBe(true);
  });

  it("suppresses capture time bonuses, including golden captures", () => {
    const world = makeWorld({ startFish: 1, timeBonusChance: 1, timeBonusSeconds: 5 }, options);
    const golden = world.spawnGolden()!;
    world.capture(world.fish[0]!, "net");
    world.capture(golden, "star");
    run(world, STEP);
    expect(world.totalCaught).toBe(2);
    expect(world.bonusCount.golden).toBe(1);
    expect(world.timeLeft).toBe(Infinity);
    expect(world.drainEvents().some(e => e.type === "time-bonus")).toBe(false);
  });

  it("allows normal golden arrivals even in round 1", () => {
    const world = makeWorld({ startFish: 0, goldenRate: 1 }, options);
    run(world, 4);
    expect(world.drainEvents().filter(e => e.type === "golden").length).toBeGreaterThanOrEqual(4);
    const disabled = makeWorld({ startFish: 0, goldenRate: 0 }, options);
    run(disabled, 4);
    expect(disabled.drainEvents().some(e => e.type === "golden")).toBe(false);
  });
});

describe("Endless frenzy waves", () => {
  function quietEndless(): World {
    return makeWorld({ startFish: 0, goldenRate: 0, chestChance: 0, frenzySeconds: 6 },
      { round: 1, final: false, endless: true });
  }

  it("exposes the current or next wave and alternates its sweep", () => {
    const world = quietEndless();
    const first = world.frenzy!;
    expect(first).toMatchObject({ start: 45, end: 51 });
    run(world, 45 - STEP);
    expect(world.frenzyActive).toBe(false);
    expect(world.frenzyFront).toBeNull();
    world.update(STEP);
    expect(world.frenzyActive).toBe(true);
    expect(world.frenzyLeft).toBeCloseTo(6);
    const { cx, rx } = world.swimArea();
    expect(world.frenzyFront).toBeCloseTo(cx - first.sweep * rx);
    run(world, 6);
    expect(world.frenzyActive).toBe(false);
    expect(world.frenzyLeft).toBe(0);
    expect(world.frenzy).toMatchObject({ start: 135, end: 141, sweep: -first.sweep });
    run(world, 84);
    expect(world.frenzyActive).toBe(true);
    expect(world.frenzyFront).toBeCloseTo(cx + first.sweep * rx);
    world.capture(world.spawn("normal")!, "net");
    world.update(STEP);
    expect(world.frenzyCaught).toBe(1);
    expect(world.frenzyEarned).toBe(1.5);
  });

  it("announces every start and end on schedule for over an hour without drifting", () => {
    const world = quietEndless();
    const transitions: { phase: string; at: number }[] = [];
    const seconds = 3660;
    for (let i = 0; i < seconds / STEP; i++) {
      world.update(STEP);
      for (const event of world.drainEvents()) {
        if (event.type === "frenzy") transitions.push({ phase: event.phase, at: world.elapsed });
      }
    }
    expect(transitions).toHaveLength(82);
    for (let wave = 0; wave < 41; wave++) {
      expect(transitions[2 * wave]!.phase).toBe("start");
      expect(transitions[2 * wave]!.at).toBeCloseTo(45 + wave * 90, 8);
      expect(transitions[2 * wave + 1]!.phase).toBe("end");
      expect(transitions[2 * wave + 1]!.at).toBeCloseTo(51 + wave * 90, 8);
    }
    expect(world.elapsed).toBeCloseTo(seconds, 10);
    expect(world.frenzy).toMatchObject({ start: 3735, end: 3741 });
    expect(world.drainEvents()).toEqual([]);
  });

  it("boosts spawns again during later waves", () => {
    const world = quietEndless();
    world.stats.spawnRateMult = 1;
    world.stats.frenzySpawnMult = 4;
    world.stats.fish = { ...BASE_STATS.fish, normal: { rate: 1, rateMult: 1, valueMult: 1 } };
    // Remove the previous spawns so this checks the wave independently of the fish cap.
    run(world, 134, () => { world.fish.length = 0; world.drainEvents(); });
    world.fish.length = 0;
    run(world, 1);
    const before = world.fish.length;
    run(world, 6);
    expect(world.fish.length - before).toBeGreaterThanOrEqual(23);
    expect(world.fish.length - before).toBeLessThanOrEqual(25);
  });
});

describe("Endless population and stability", () => {
  const options: RoundOptions = { round: 1, final: false, endless: true };

  it("caps starting fish, schools and direct spawns", () => {
    const stats = fullStats();
    Object.assign(stats, { startFish: ENDLESS.maxFish * 2, spawnRateMult: 0, goldenRate: 0 });
    const world = new World(stats, createRng(42), 1280, 800, options);
    expect(world.fish).toHaveLength(ENDLESS.maxFish);
    expect(world.spawn("normal")).toBeUndefined();
    world.fish.length = ENDLESS.maxFish - 1;
    world.spawn("uncommon");
    expect(world.fish).toHaveLength(ENDLESS.maxFish);
  });

  it("keeps golden fish and frenzy pour-ins coming in a full sea, up to the surge room", () => {
    const stats = fullStats();
    Object.assign(stats, { startFish: ENDLESS.maxFish, spawnRateMult: 0, goldenRate: 0 });
    const world = new World(stats, createRng(42), 1280, 800, options);
    expect(world.fish).toHaveLength(ENDLESS.maxFish);
    expect(world.spawnGolden()?.golden).toBeDefined();
    expect(world.spawn("normal", { surge: true })).toBeDefined();
    for (let i = 0; i < ENDLESS.surgeRoom * 2; i++) world.spawn("normal", { surge: true });
    expect(world.fish).toHaveLength(ENDLESS.maxFish + ENDLESS.surgeRoom);
    expect(world.spawnGolden()).toBeUndefined();
  });

  it("pours fish in during an endless frenzy even when the sea is full", () => {
    const stats = fullStats();
    Object.assign(stats, { startFish: ENDLESS.maxFish, goldenRate: 0 });
    const world = new World(stats, createRng(42), 1280, 800, options);
    run(world, ENDLESS.firstFrenzy - 1, () => { world.drainEvents(); });
    const before = world.fish.filter((f) => !f.captured).length;
    expect(before).toBe(ENDLESS.maxFish);
    run(world, 2, () => { world.drainEvents(); });
    expect(world.fish.filter((f) => !f.captured).length).toBeGreaterThan(before);
  });

  it("caps Goober bursts and twins, and discards skipped spawns without a backlog", () => {
    const stats = fullStats();
    Object.assign(stats, { startFish: 0, spawnRateMult: 0, goldenRate: 0, twinChance: 1 });
    const world = new World(stats, createRng(42), 1280, 800, options);
    const goober = world.spawn("goober")!;
    for (let i = 1; i < ENDLESS.maxFish; i++) world.spawn("normal");
    world.capture(goober, "net");
    world.update(STEP);
    expect(world.fish).toHaveLength(ENDLESS.maxFish);
    expect(world.fish.filter(f => f.credit === "goober")).toHaveLength(1);
    world.stats.spawnRateMult = 1;
    run(world, 5, () => { world.drainEvents(); });
    world.stats.spawnRateMult = 0;
    world.fish.length = 0;
    run(world, 1);
    expect(world.fish).toHaveLength(0);
  });

  it("runs ten minutes fully upgraded with finite positions and bounded live state", { timeout: 10_000 }, () => {
    const stats = fullStats();
    const world = new World(stats, createRng(19), 1280, 800, options);
    const state = world as unknown as { spawnTimers: Map<string, number>; captureQueue: unknown[] };
    let peakFish = world.fish.length;
    let peakShots = 0;
    let peakQueue = 0;
    let peakCooldowns = 0;
    let peakEvents = 0;
    let finite = true;
    let timeBonus = false;
    for (let i = 0; i < 600 / STEP; i++) {
      // First leave the net idle to exercise the cap, then catch normally to exercise abilities.
      if (world.elapsed >= 120) world.pointer = {
        x: 640 + Math.sin(world.elapsed) * 400, y: 400 + Math.cos(world.elapsed * 0.7) * 250,
      };
      world.update(STEP);
      peakFish = Math.max(peakFish, world.fish.filter(f => !f.captured).length);
      peakShots = Math.max(peakShots, world.shots.length);
      peakQueue = Math.max(peakQueue, state.captureQueue.length);
      for (const fish of world.fish) finite &&= Number.isFinite(fish.x) && Number.isFinite(fish.y);
      for (const shot of world.shots) {
        finite &&= Number.isFinite(shot.x) && Number.isFinite(shot.y);
        peakCooldowns = Math.max(peakCooldowns, shot.cooldowns.size);
      }
      const events = world.drainEvents();
      peakEvents = Math.max(peakEvents, events.length);
      timeBonus ||= events.some(e => e.type === "time-bonus");
    }
    expect(world.elapsed).toBe(600);
    expect(world.over).toBe(false);
    expect(world.timeLeft).toBe(Infinity);
    expect(peakFish).toBeGreaterThanOrEqual(ENDLESS.maxFish);
    expect(peakFish).toBeLessThanOrEqual(ENDLESS.maxFish + ENDLESS.surgeRoom);
    expect(world.totalCaught).toBeGreaterThan(1000);
    expect(world.bonusCount.treasure).toBeGreaterThan(0);
    expect(world.bestStarHits).toBeGreaterThan(0);
    expect(peakShots).toBeLessThan(ENDLESS.maxFish * stats.ability.star.count);
    expect(peakQueue).toBeLessThanOrEqual(ENDLESS.maxFish + ENDLESS.surgeRoom);
    expect(peakCooldowns).toBeLessThanOrEqual(ENDLESS.maxFish + ENDLESS.surgeRoom);
    expect(peakEvents).toBeLessThan(2000);
    expect(finite).toBe(true);
    expect(timeBonus).toBe(false);
    expect(state.spawnTimers.size).toBeLessThanOrEqual(8);
    for (const progress of state.spawnTimers.values()) {
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThan(1);
    }
    expect(world.drainEvents()).toEqual([]);
  });
});

describe("World trap casting", () => {
  it("casts on round start and each endless minute, without drawing again from the world stream", () => {
    const stats = { ...BASE_STATS, startFish: 0, spawnRateMult: 0, goldenRate: 0,
      rigging: { ...BASE_STATS.rigging, count: 4, seine: true } };
    const world = new World(stats, createRng(51), 1280, 800, { round: 1, final: false, endless: true });
    const first = world.traps.map(t => [t.x, t.y]);
    expect(world.drainEvents().filter(e => e.type === "trap-cast")).toHaveLength(1);
    run(world, 60 - STEP);
    expect(world.traps.map(t => [t.x, t.y])).toEqual(first);
    world.update(STEP);
    expect(world.traps.map(t => [t.x, t.y])).not.toEqual(first);
    expect(world.drainEvents().filter(e => e.type === "trap-cast")).toHaveLength(1);
    run(world, 60);
    expect(world.drainEvents().filter(e => e.type === "trap-cast")).toHaveLength(1);
  });

  it("keeps timed nets in place, ages them and scales them on resize", () => {
    const world = makeWorld({ startFish: 0, roundSeconds: 200, rigging: { ...BASE_STATS.rigging, count: 1 } });
    const first = { ...world.traps[0]! };
    run(world, 70);
    expect(world.traps[0]).toMatchObject({ x: first.x, y: first.y });
    expect(world.traps[0]!.age).toBeCloseTo(70);
    world.resize(880, 660);
    expect(world.traps[0]!.x).toBeCloseTo(first.x * 1.1);
    expect(world.traps[0]!.y).toBeCloseTo(first.y * 1.1);
  });
});

/** A quiet sea with a known net position, independent of the placement random stream. */
function trapWorld(tweak?: (stats: Stats) => void, round?: RoundOptions): World {
  const stats = structuredClone(BASE_STATS);
  Object.assign(stats, { startFish: 0, spawnRateMult: 0, goldenRate: 0, roundSeconds: 100 });
  Object.assign(stats.rigging, { count: 1, radius: 40, damage: 2, resetSeconds: 1, haul: 1 });
  tweak?.(stats);
  const world = new World(stats, createRng(42), 800, 600, round);
  world.traps = [{ id: 1, x: 600, y: 300, radius: 40, cooldown: 0, partner: null, age: 0 }];
  world.drainEvents();
  return world;
}

function stillFish(world: World, x = 600, y = 300, kind: Fish["kind"] = "normal"): Fish {
  const fish = world.spawn(kind, { at: { x, y } })!;
  fish.speedMult = 0;
  return fish;
}

describe("Trap snaps", () => {
  it("hits the nearest haul, waits to re-arm, and counts only trap captures", () => {
    const world = trapWorld();
    const far = stillFish(world, 620);
    const near = stillFish(world, 603);
    world.update(STEP);
    expect(near.captured).toBe(true);
    expect(far.hp).toBe(far.maxHp);
    expect(world.trapCatches).toBe(1);
    expect(world.traps[0]!.cooldown).toBe(1);
    expect(world.drainEvents()).toContainEqual({ type: "trap-snap", trapId: 1, x: 600, y: 300, hits: 1 });
    run(world, 1 - STEP);
    expect(far.captured).toBe(false);
    world.update(STEP);
    expect(far.captured).toBe(true);
    expect(world.trapCatches).toBe(2);
    const other = stillFish(world, 700);
    world.capture(other, "net");
    world.update(STEP);
    expect(world.trapCatches).toBe(2);
  });

  it("supports an unlimited haul and applies armour through normal damage", () => {
    const world = trapWorld(s => { s.rigging.haul = Infinity; s.ability.rare.armor = 1; });
    for (let i = 0; i < 5; i++) stillFish(world, 600 + i);
    const rare = stillFish(world, 610, 300, "rare");
    world.update(STEP);
    expect(world.trapCatches).toBe(5);
    expect(rare.hp).toBe(rare.maxHp - 1);
    expect(rare.hits).toBe(1);
    expect(world.drainEvents()).toContainEqual({ type: "trap-snap", trapId: 1, x: 600, y: 300, hits: 6 });
  });

  it("halves the reset only for snaps during frenzy", () => {
    const world = trapWorld(s => { s.rigging.frenzyResetMult = 0.5; s.roundSeconds = 20; }, { round: 5, final: false });
    world.elapsed = 7;
    stillFish(world);
    world.update(STEP);
    expect(world.frenzyActive).toBe(true);
    expect(world.traps[0]!.cooldown).toBe(0.5);
    const next = stillFish(world);
    run(world, 0.5 - STEP);
    expect(next.captured).toBe(false);
    world.update(STEP);
    expect(next.captured).toBe(true);
    world.elapsed = 14;
    run(world, 0.5);
    stillFish(world);
    world.update(STEP);
    expect(world.traps[0]!.cooldown).toBe(1);
  });

  it("pays trap captures without the ability bonus, including golden fish", () => {
    const world = trapWorld(s => { s.abilityValueMult = 9; s.rigging.haul = Infinity; s.valueMult = 3; });
    stillFish(world);
    const golden = world.spawn("normal", { at: { x: 600, y: 300 }, golden: true })!;
    golden.speedMult = 0;
    world.update(STEP);
    expect(world.earned).toBe(33);
    expect(world.bonusCount.golden).toBe(1);
    expect(world.trapCatches).toBe(2);
    expect(world.drainEvents().filter(e => e.type === "capture").every(e => e.source === "trap")).toBe(true);
  });

  it.each(["electric", "epic", "monster", "star", "goober"] as const)("fires a trapped %s's own capture ability", kind => {
    const world = trapWorld(s => { s.rigging.damage = 100; s.ability.epic.chance = 1; });
    const fish = stillFish(world, 600, 300, kind);
    world.traps[0]!.x = fish.x;
    world.traps[0]!.y = fish.y;
    const nearby = stillFish(world, fish.x + 60, fish.y);
    world.update(STEP);
    expect(fish.captured).toBe(true);
    expect(world.trapCatches).toBe(1);
    if (kind === "star") expect(world.shots.length).toBeGreaterThan(0);
    else if (kind === "goober") expect(world.fish.some(f => f.credit === "goober")).toBe(true);
    else {
      if (kind === "electric") expect(nearby.hits).toBeGreaterThan(0);
      else { world.update(STEP); expect(nearby.captured).toBe(true); }
    }
  });
});

function seineWorld(): World {
  const world = trapWorld(s => { s.rigging.seine = true; });
  world.traps = [
    { id: 1, x: 600, y: 210, radius: 40, cooldown: 99, partner: 1, age: 0 },
    { id: 2, x: 600, y: 390, radius: 40, cooldown: 99, partner: 0, age: 0 },
  ];
  return world;
}

describe("Seine ropes", () => {
  it("hits only the segment, once per fish per second even with overlapping ropes", () => {
    const world = seineWorld();
    world.traps.push(...world.traps.map((trap, index) => ({ ...trap, id: index + 3, partner: index === 0 ? 3 : 2 })));
    const fish = stillFish(world);
    fish.hp = 100;
    const beyond = stillFish(world, 600, 450);
    const away = stillFish(world, 630);
    world.update(STEP);
    expect(fish.hits).toBe(1);
    expect(fish.hp).toBe(100 - world.stats.rigging.seineDamage);
    expect(beyond.hits).toBe(0);
    expect(away.hits).toBe(0);
    run(world, 1 - STEP);
    expect(fish.hits).toBe(1);
    world.update(STEP);
    expect(fish.hits).toBe(2);
  });

  it("uses normal damage, credits catches and pays without the ability multiplier", () => {
    const world = seineWorld();
    world.stats.rigging.seineDamage = 3;
    world.stats.abilityValueMult = 10;
    stillFish(world);
    const rare = stillFish(world, 600, 310, "rare");
    world.stats.ability.rare.armor = 1;
    world.update(STEP);
    expect(world.trapCatches).toBe(1);
    expect(world.earned).toBe(1);
    expect(rare.hp).toBe(rare.maxHp - 2);
    expect(world.drainEvents()).toContainEqual(expect.objectContaining({ type: "capture", source: "seine", value: 1 }));
  });

  it("bounds hit events and removes cooldowns for fish that leave", () => {
    const world = seineWorld();
    for (let i = 0; i < 500; i++) { const fish = stillFish(world); fish.hp = 100; }
    world.update(STEP);
    expect(world.fish.every(fish => fish.hits === 1)).toBe(true);
    const events = world.drainEvents().filter(e => e.type === "seine-hit");
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThanOrEqual(4);
    world.fish.length = 0;
    world.update(STEP);
    const state = world as unknown as { seineCooldowns: Map<number, number> };
    expect(state.seineCooldowns.size).toBe(0);
  });
});

describe("Bait and snag", () => {
  it("pulls towards the nearest armed net within range using fish offsets", () => {
    const world = trapWorld(s => { s.rigging.baitPull = 60; s.rigging.baitRange = 180; });
    world.traps.push({ id: 2, x: 550, y: 300, radius: 40, cooldown: 0, partner: null, age: 0 });
    const fish = stillFish(world, 680);
    const outside = stillFish(world, 200);
    world.update(STEP);
    expect(fish.offsetX).toBeCloseTo(-1);
    expect(fish.offsetY).toBeCloseTo(0);
    expect(outside.offsetX).toBe(0);
    for (const trap of world.traps) trap.cooldown = 10;
    world.update(STEP);
    expect(fish.offsetX).toBeCloseTo(-1);
  });

  it("never pulls a fish through the boat towards a far-side net", () => {
    const world = trapWorld(s => { s.rigging.baitPull = 10000; s.rigging.baitRange = 1000; });
    const fish = stillFish(world, 200);
    run(world, 1);
    expect(fish.x).toBeCloseTo(330);
    expect(Math.hypot(fish.x - 400, fish.y - 300)).toBeGreaterThanOrEqual(70 - 1e-8);
  });

  it("snags a chest just once and lets it drift after the hold expires", () => {
    const world = trapWorld(s => { s.rigging.snagSeconds = 1; });
    world.chest = { x: 600, y: 300, vx: 45, vy: 0, hp: 10, maxHp: 10, age: 0, hitFlash: 0 };
    world.update(STEP);
    const x = world.chest.x;
    run(world, 1 - STEP);
    expect(world.chest.x).toBeCloseTo(x, 10);
    expect(world.chest.age).toBeCloseTo(1);
    run(world, 0.2);
    expect(world.chest.x).toBeGreaterThan(x);
    expect(world.drainEvents().filter(e => e.type === "snag")).toHaveLength(1);
    const next = { ...world.chest, x: 600, age: 0, snagged: false, snagLeft: 0 };
    world.chest = next;
    world.update(STEP);
    expect(world.drainEvents().filter(e => e.type === "snag")).toHaveLength(1);
  });
});
