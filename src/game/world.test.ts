import { describe, expect, it } from "vitest";
import { FISH, FISH_KINDS } from "./fish";
import { createRng } from "./rng";
import { SEA } from "./sea";
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
      // These replay fixtures predate both lanes, even after the tree gains their upgrades.
      const stats = fixture.full ? { ...fullStats(), rigging: { ...BASE_STATS.rigging }, boat: { ...BASE_STATS.boat } } : BASE_STATS;
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
    // The Reef boost stacks with the frenzy: 1 × 1.2 × 4 × 6 seconds.
    expect(world.fish.length - before).toBeGreaterThanOrEqual(28);
    expect(world.fish.length - before).toBeLessThanOrEqual(30);
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
    // Population tests: no trap nets or lantern catching or holding fish.
    stats.rigging.count = 0;
    stats.boat.lanternRadius = 0;
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
    // Population tests: no trap nets or lantern catching or holding fish.
    stats.rigging.count = 0;
    stats.boat.lanternRadius = 0;
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
    world.resize(200, 200);
    expect(world.traps).toHaveLength(0);
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
    expect(fish.offsetX).toBeGreaterThan(-1);
    expect(fish.offsetX).toBeLessThan(0);
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

/** The new lanes at their contract maxima, independent of when their tree nodes land. */
function toolsStats(): Stats {
  const stats = fullStats();
  Object.assign(stats.rigging, { count: 4, resetSeconds: 5 * 0.85 ** 4, radius: 52, damage: 4,
    haul: Infinity, seine: true, seineDamage: 1, baitPull: 45, baitRange: 110, snagSeconds: 4, frenzyResetMult: 0.5 });
  Object.assign(stats.boat, { chum: true, chumCooldown: 20 * 0.85 ** 3, chumSeconds: 6,
    chumRadius: 340, chumPull: 60, lanternRadius: 210, lanternSlow: 0.7 });
  return stats;
}

describe("Fully upgraded tools", () => {
  it("runs a day with recasts, chum, fish abilities and orientation changes using bounded live state", () => {
    const world = new World(toolsStats(), createRng(19), 1280, 800, { round: 1, final: false, endless: true });
    let casts = 0;
    let snaps = 0;
    let ropeHits = 0;
    let peakEvents = 0;
    let finite = true;
    for (let step = 0; step < 240 / STEP; step++) {
      if (step === 80 / STEP) world.resize(390, 844);
      if (step === 160 / STEP) world.resize(1280, 800);
      if (world.chumReady) world.chum();
      world.pointer = { x: world.width / 2 + Math.sin(world.elapsed) * world.width * 0.3,
        y: world.height / 2 + Math.cos(world.elapsed * 0.7) * world.height * 0.3 };
      world.update(STEP);
      const events = world.drainEvents();
      casts += events.filter(e => e.type === "trap-cast").length;
      snaps += events.filter(e => e.type === "trap-snap").length;
      const seine = events.filter(e => e.type === "seine-hit").length;
      ropeHits += seine;
      expect(seine).toBeLessThanOrEqual(4);
      peakEvents = Math.max(peakEvents, events.length);
      for (const trap of world.traps) {
        const cornerX = trap.x < world.width * 0.22 || trap.x > world.width * 0.78;
        const cornerY = trap.y < world.height * 0.22 || trap.y > world.height * 0.78;
        expect(cornerX && cornerY).toBe(false);
      }
      for (const fish of world.fish) finite &&= Number.isFinite(fish.x) && Number.isFinite(fish.y);
      const state = world as unknown as { seineCooldowns: Map<number, number> };
      expect(state.seineCooldowns.size).toBeLessThanOrEqual(120);
    }
    expect(casts).toBe(5);
    expect(snaps).toBeGreaterThan(20);
    expect(ropeHits).toBeGreaterThan(0);
    expect(world.trapCatches).toBeGreaterThan(20);
    expect(world.bestStarHits).toBeGreaterThan(0);
    expect(world.bonusCount.golden).toBeGreaterThan(0);
    expect(peakEvents).toBeLessThan(2000);
    expect(finite).toBe(true);
  });

  it("reports the cost per step of fully upgraded timed rounds", () => {
    const samples: number[] = [];
    for (const tools of [false, true]) {
      const stats = tools ? toolsStats() : fullStats();
      if (!tools) { stats.rigging = { ...BASE_STATS.rigging }; stats.boat = { ...BASE_STATS.boat }; }
      const world = new World(stats, createRng(19), 1280, 800, { round: 5, final: false });
      let steps = 0;
      const start = performance.now();
      while (!world.over) {
        if (world.chumReady) world.chum();
        world.pointer = { x: 640 + Math.sin(world.elapsed) * 400, y: 400 + Math.cos(world.elapsed * 0.7) * 250 };
        world.update(STEP);
        world.drainEvents();
        steps++;
      }
      samples.push((performance.now() - start) / steps);
      expect(world.totalCaught).toBeGreaterThan(1000);
    }
    console.log(`Full-upgrade step: tools off ${samples[0]!.toFixed(3)} ms, tools on ${samples[1]!.toFixed(3)} ms`);
  });
});

describe("Seine recast immunity", () => {
  it("keeps a fish's one-second immunity when old and new ropes overlap", () => {
    const stats = structuredClone(BASE_STATS);
    Object.assign(stats, { startFish: 0, spawnRateMult: 0, goldenRate: 0 });
    Object.assign(stats.rigging, { count: 2, seine: true });
    const make = () => new World(stats, createRng(42), 800, 600, { round: 1, final: false, endless: true });
    const preview = make();
    run(preview, 60);
    const [a, b] = preview.traps;
    expect(preview.traps).toHaveLength(2);
    const x = (a!.x + b!.x) / 2;
    const y = (a!.y + b!.y) / 2;
    const world = make();
    world.elapsed = 60 - 2 * STEP;
    world.traps = [
      { id: 1, x: x - 90, y, radius: 34, cooldown: 5, partner: 1, age: 0 },
      { id: 2, x: x + 90, y, radius: 34, cooldown: 5, partner: 0, age: 0 },
    ];
    const fish = stillFish(world, x, y);
    // Midpoints of valid ropes can lie inside the minimum orbit, so position this test fish exactly.
    fish.offsetX += x - fish.x;
    fish.offsetY += y - fish.y;
    fish.x = x;
    fish.y = y;
    fish.hp = 100;
    world.update(STEP);
    expect(fish.hits).toBe(1);
    world.update(STEP);
    expect(world.elapsed).toBe(60);
    expect(fish.hits).toBe(1);
    run(world, 1 - STEP);
    expect(fish.hits).toBe(2);
  });
});


describe("Clear weather compatibility", () => {
  // Recorded on main at 7b142c4 before weather integration, including the next RNG draw.
  it.each([
    { round: 1, earned: 7, caught: 7, fish: 13, x: 658.3007773408348, y: 130.822569566625, next: 0.08626641938462853 },
    { round: 7, earned: 8, caught: 8, fish: 12, x: 658.3007773408348, y: 130.822569566625, next: 0.35655746911652386 },
    { round: 10, earned: 9.5, caught: 8, fish: 19, x: 267.34808996982747, y: 339.93167735968734, next: 0.20450056600384414 },
  ])("replays main's round $round exactly, with omitted or explicit clear weather", fixture => {
    for (const sea of [undefined, "clear"] as const) {
      const world = new World(BASE_STATS, createRng(314), 800, 600, { round: fixture.round, final: false, sea });
      run(world, 8, () => { world.pointer = world.fish[0] ?? null; world.drainEvents(); });
      expect(world.sea).toBe("clear");
      expect(world.seaLeft).toBe(Infinity);
      expect(world.seaEarned).toBe(0);
      expect(world.earned).toBe(fixture.earned);
      expect(world.caught).toEqual({ normal: fixture.caught });
      expect(world.fish).toHaveLength(fixture.fish);
      expect(world.fish[0]!.x).toBe(fixture.x);
      expect(world.fish[0]!.y).toBe(fixture.y);
      expect(world.rng()).toBe(fixture.next);
    }
  });
});


describe("Storm wind", () => {
  const storm = (startFish = 1) => makeWorld({ startFish, roundSeconds: 90, goldenRate: 0, chestChance: 0 },
    { round: 7, final: false, sea: "storm" });

  it("has a seeded direction, a smooth six-second gust cycle and zero wind in other states", () => {
    const a = storm();
    const b = storm();
    expect(a.wind).toEqual(b.wind);
    expect(Math.hypot(a.wind.x, a.wind.y)).toBeCloseTo(22);
    run(a, 3);
    expect(Math.hypot(a.wind.x, a.wind.y)).toBeCloseTo(45);
    run(a, 3);
    expect(Math.hypot(a.wind.x, a.wind.y)).toBeCloseTo(22);
    for (const sea of ["clear", "fog", "bloom"] as const) {
      expect(makeWorld({}, { round: 7, final: false, sea }).wind).toEqual({ x: 0, y: 0 });
    }
  });

  it("settles in a bounded periodic spring equilibrium through offsets", () => {
    const world = storm();
    const fish = world.fish[0]!;
    fish.angle = 0;
    fish.orbit = 0.45;
    fish.speedMult = 0;
    const lengths: number[] = [];
    for (let step = 0; step < 30 / STEP; step++) {
      world.update(STEP);
      if (step >= 24 / STEP) lengths.push(Math.hypot(fish.offsetX, fish.offsetY));
      world.drainEvents();
    }
    // Mean displacement is mean wind / spring, with a small phase-lagged six-second sway.
    expect(lengths.reduce((a, b) => a + b) / lengths.length).toBeCloseTo((22 + 45) / 2 / 0.6, 1);
    expect(Math.min(...lengths)).toBeGreaterThan(35);
    expect(Math.max(...lengths)).toBeLessThan(75);
    const settled = { x: fish.offsetX, y: fish.offsetY };
    run(world, 6);
    expect(fish.offsetX).toBeCloseTo(settled.x, 4);
    expect(fish.offsetY).toBeCloseTo(settled.y, 4);
    expect(fish.x).toBeCloseTo(world.swimArea().cx + fish.orbit * world.swimArea().rx +
      Math.sin(fish.wobblePhase) * FISH.normal.wobble + fish.offsetX);
  });

  it("keeps drifting fish and goldens inside the swim ellipse and clear of the boat, including on resize", () => {
    const world = storm(40);
    const golden = world.spawnGolden()!;
    golden.golden!.timeLeft = 100;
    let bounded = true;
    for (let step = 0; step < 20 / STEP; step++) {
      if (step === 10 / STEP) world.resize(320, 568);
      world.update(STEP);
      const { cx, cy, rx, ry } = world.swimArea();
      for (const fish of world.fish) {
        bounded &&= Math.hypot((fish.x - cx) / rx, (fish.y - cy) / ry) <= 1 + 1e-9 &&
          Math.hypot(fish.x - cx, fish.y - cy) >= 70 - 1e-9;
      }
      world.drainEvents();
    }
    expect(bounded).toBe(true);
    expect(Math.hypot(golden.offsetX, golden.offsetY)).toBeGreaterThan(1);
  });

  it("announces timed weather once and leaves the chest on its own path", () => {
    const world = storm();
    world.chest = { x: 40, y: 40, vx: 10, vy: 0, hp: 10, maxHp: 10, age: 0, hitFlash: 0 };
    run(world, 2);
    expect(world.chest!.x).toBeCloseTo(60);
    expect(world.chest!.y).toBe(40);
    expect(world.drainEvents().filter(e => e.type === "sea")).toEqual([
      { type: "sea", phase: "start", state: "storm" },
    ]);
    world.timeLeft = STEP;
    world.update(STEP);
    world.update(STEP);
    expect(world.drainEvents().filter(e => e.type === "sea")).toEqual([
      { type: "sea", phase: "end", state: "storm" },
    ]);
  });
});

describe("Sea payouts", () => {
  it.each(["clear", "storm", "fog", "bloom"] as const)("applies %s to every capture source, with combo and golden bonuses", sea => {
    const mult = sea === "storm" ? 1.2 : sea === "fog" ? 1.15 : 1;
    const world = makeWorld({ startFish: 0, goldenRate: 0, chestChance: 0, comboWindow: 5 },
      { round: 7, final: false, sea });
    const sources = ["net", "trap", "seine", "electric", "epic", "star", "whirlpool"] as const;
    let base = 0;
    for (const [index, source] of sources.entries()) {
      const fish = world.spawn("normal", { golden: index === sources.length - 1 })!;
      base += FISH.normal.value * (source === "net" || source === "trap" || source === "seine" ? 1 : 1.5) *
        (1 + index * 0.1) * (fish.golden ? 10 : 1);
      world.capture(fish, source);
    }
    run(world, STEP);
    expect(world.earned).toBeCloseTo(base * mult);
    expect(world.seaEarned).toBeCloseTo(base * (mult - 1));
    const captures = world.drainEvents().filter(e => e.type === "capture");
    expect(captures.reduce((sum, e) => sum + e.value, 0)).toBeCloseTo(world.earned);
    expect(Object.values(world.earnedBy).reduce((a, b) => a + b, 0) + world.bonusEarned.golden).toBeCloseTo(world.earned);
  });

  it("excludes treasure from the weather bonus", () => {
    const world = makeWorld({ startFish: 0, netDamage: 100, goldenRate: 0, chestChance: 0 },
      { round: 7, final: false, sea: "fog" });
    world.chest = { x: 200, y: 200, vx: 0, vy: 0, hp: 1, maxHp: 1, age: 0, hitFlash: 0 };
    world.pointer = { x: 200, y: 200 };
    run(world, 0.6);
    expect(world.bonusCount.treasure).toBe(1);
    expect(world.earned).toBe(world.bonusEarned.treasure);
    expect(world.seaEarned).toBe(0);
  });
});

describe("Algal Bloom", () => {
  it.each(["clear", "storm", "fog", "bloom"] as const)("only changes spawn rates, HP and swimming in bloom (%s)", sea => {
    const stats = { ...BASE_STATS, startFish: 0, goldenRate: 0, chestChance: 0,
      fish: { ...BASE_STATS.fish, normal: { rate: 20, rateMult: 1, valueMult: 1 } } };
    const before = structuredClone(stats);
    const world = new World(stats, createRng(42), 800, 600, { round: 7, final: false, sea });
    const fish = world.spawn("normal")!;
    const angle = fish.angle;
    const { rx, ry } = world.swimArea();
    const arc = fish.orbit * Math.hypot(rx * Math.sin(angle), ry * Math.cos(angle));
    world.update(STEP);
    const bloom = sea === "bloom";
    expect(fish.hp).toBe(FISH.normal.hp * (bloom ? SEA.bloomHp : 1));
    expect(fish.maxHp).toBe(fish.hp);
    expect(Math.abs(fish.angle - angle)).toBeCloseTo(FISH.normal.speed * STEP / arc * (bloom ? SEA.bloomSpeed : 1), 12);
    run(world, 4 - STEP);
    expect(Math.abs(world.fish.length - (1 + 80 * (bloom ? SEA.bloomSpawn : 1)))).toBeLessThanOrEqual(1);
    expect(world.countOf("rare")).toBe(0);
    expect(stats).toEqual(before);
  });

  it("toughens all newly spawned kinds, including goldens, schools and capture by-products", () => {
    const world = makeWorld({ startFish: 0 }, { round: 7, final: false, sea: "bloom" });
    for (const kind of Object.keys(FISH) as (keyof typeof FISH)[]) world.spawn(kind);
    world.spawnGolden();
    for (const fish of world.fish) expect(fish.maxHp).toBe(FISH[fish.kind].hp * 1.5);
    const goober = world.fish.find(f => f.kind === "goober")!;
    world.capture(goober, "epic");
    run(world, STEP);
    expect(world.totalCaught).toBe(1);
    for (const fish of world.fish) expect(fish.maxHp).toBe(FISH[fish.kind].hp * 1.5);
  });
});

describe("Endless weather", () => {
  function weatherWorld(seed: number, overrides: Partial<Stats> = {}): World {
    return new World({ ...BASE_STATS, startFish: 0, spawnRateMult: 0, goldenRate: 0, ...overrides },
      createRng(seed), 800, 600, { round: 1, final: false, endless: true });
  }

  it("preserves main's chest arrivals, wave timing and world random stream", () => {
    // Recorded on main 7b142c4, before adding the endless-only weather stream.
    const world = weatherWorld(314);
    const chests: number[] = [];
    for (let step = 0; step < 400 / STEP; step++) {
      const before = world.chest;
      world.update(STEP);
      if (world.chest && world.chest !== before) chests.push(world.elapsed);
      world.drainEvents();
    }
    expect(chests).toEqual([82.65, 148.46666666666667, 209.01666666666665, 304.95, 387.01666666666665]);
    expect(world.frenzy).toEqual({ start: 405, end: 410, sweep: 1 });
    expect(world.rng()).toBe(0.5842846354935318);
  });

  it("rolls at 150-second boundaries, lasts 60 seconds and defers future frenzy overlaps", () => {
    let starts = 0;
    let skipped = 0;
    let deferred = 0;
    for (let seed = 0; seed < 12; seed++) {
      const world = weatherWorld(seed);
      expect(world.sea).toBe("clear");
      expect(world.seaLeft).toBe(0);
      let started = 0;
      let previous = "clear";
      const times: number[] = [];
      let overlap = false;
      let peakEvents = 0;
      for (let step = 0; step < 660 / STEP; step++) {
        world.update(STEP);
        const events = world.drainEvents().filter(e => e.type === "sea");
        peakEvents = Math.max(peakEvents, events.length);
        overlap ||= world.sea !== "clear" && world.frenzyActive;
        for (const event of events) {
          if (event.phase === "start") {
            starts++;
            started = world.elapsed;
            times.push(started);
            expect(event.state).not.toBe(previous);
            previous = event.state;
            expect(world.seaLeft).toBeCloseTo(60, 8);
            // 300s and 450s rolls would overlap waves at 315s and 495s respectively.
            const allowed = [150, 320, 500, 600];
            expect(allowed.some(t => Math.abs(t - started) < STEP)).toBe(true);
            if (Math.abs(started - 320) < STEP || Math.abs(started - 500) < STEP) deferred++;
          } else {
            expect(world.elapsed - started).toBeCloseTo(60, 8);
            expect(world.sea).toBe("clear");
            expect(world.seaLeft).toBe(0);
          }
        }
      }
      if (!times.some(t => Math.abs(t - 150) < STEP)) skipped++;
      expect(overlap).toBe(false);
      expect(times.length).toBeLessThanOrEqual(4);
      expect(peakEvents).toBeLessThanOrEqual(2);
    }
    expect(starts).toBeGreaterThan(12);
    expect(skipped).toBeGreaterThan(0);
    expect(deferred).toBeGreaterThan(0);
  });

  it("replays weather from its own stream even with different fish and chest activity", () => {
    function timeline(world: World): WorldEvent[] {
      const events: WorldEvent[] = [];
      for (let i = 0; i < 660 / STEP; i++) {
        world.update(STEP);
        events.push(...world.drainEvents().filter(e => e.type === "sea"));
      }
      return events;
    }
    const quiet = timeline(weatherWorld(17, { chestChance: 0 }));
    const busy = timeline(weatherWorld(17, { startFish: 10, spawnRateMult: 1, goldenRate: 1 }));
    expect(busy).toEqual(quiet);
    expect(quiet.length).toBeGreaterThan(0);
  });

  it("changes existing bloom HP proportionately and releases storm offsets when weather ends", () => {
    let blooms = 0;
    let storms = 0;
    for (let seed = 0; seed < 12; seed++) {
      const world = weatherWorld(seed);
      const fish = world.spawn("normal")!;
      fish.hp = fish.maxHp / 2;
      fish.speedMult = 0;
      fish.orbit = 0.45;
      for (let step = 0; step < 220 / STEP; step++) {
        world.update(STEP);
        for (const event of world.drainEvents()) {
          if (event.type !== "sea") continue;
          if (event.state === "bloom") {
            blooms++;
            expect(fish.maxHp).toBe(FISH.normal.hp * (event.phase === "start" ? 1.5 : 1));
            expect(fish.hp).toBe(fish.maxHp / 2);
          }
          if (event.state === "storm" && event.phase === "end") storms++;
        }
      }
      expect(world.sea).toBe("clear");
      expect(Math.hypot(fish.state.windOx ?? 0, fish.state.windOy ?? 0)).toBeLessThan(0.3);
    }
    expect(blooms).toBeGreaterThan(0);
    expect(storms).toBeGreaterThan(0);
  });

  it("announces an active state's end only once when a trip finishes", () => {
    let checked = false;
    for (let seed = 0; seed < 12 && !checked; seed++) {
      const world = weatherWorld(seed);
      run(world, 151);
      const state = world.sea;
      if (state === "clear") continue;
      world.drainEvents();
      world.finish();
      world.finish();
      run(world, 100);
      expect(world.drainEvents()).toEqual([{ type: "sea", phase: "end", state }]);
      checked = true;
    }
    expect(checked).toBe(true);
  });
});

it("bounds a storm after spawns, schools, ability movement and boat pulls", () => {
  const stats = toolsStats();
  stats.netDamage = 0;
  stats.rigging.damage = 0;
  stats.rigging.seineDamage = 0;
  const world = new World(stats, createRng(29), 320, 568, { round: 7, final: false, sea: "storm" });
  let bounded = true;
  for (let step = 0; step < 10 / STEP; step++) {
    if (world.chumReady) world.chum();
    world.update(STEP);
    const { cx, cy, rx, ry } = world.swimArea();
    for (const fish of world.fish) {
      bounded &&= Math.hypot((fish.x - cx) / rx, (fish.y - cy) / ry) <= 1 + 1e-9 &&
        Math.hypot(fish.x - cx, fish.y - cy) >= 70 - 1e-9;
    }
    world.drainEvents();
  }
  expect(bounded).toBe(true);
});

it("releases the wind's offset state completely after an endless storm", () => {
  let checked = false;
  for (let seed = 0; seed < 12 && !checked; seed++) {
    const world = new World({ ...BASE_STATS, startFish: 0, spawnRateMult: 0, goldenRate: 0 },
      createRng(seed), 800, 600, { round: 1, final: false, endless: true });
    const fish = world.spawn("normal")!;
    fish.angle = 0;
    fish.orbit = 1;
    fish.speedMult = 0;
    run(world, 151);
    if (world.sea !== "storm") continue;
    run(world, 89);
    expect(fish.state.windOx).toBeUndefined();
    expect(fish.state.windOy).toBeUndefined();
    expect(fish.offsetX).toBeCloseTo(0, 8);
    expect(fish.offsetY).toBeCloseTo(0, 8);
    checked = true;
  }
  expect(checked).toBe(true);
});


describe("Endless biomes", () => {
  const options: RoundOptions = { round: 1, final: false, endless: true };

  function biomeWorld(): World {
    const stats = structuredClone(BASE_STATS);
    Object.assign(stats, { startFish: 0, spawnRateMult: 0, goldenRate: 0, frenzySpawnMult: 1 });
    Object.assign(stats.ability.uncommon, { schoolMin: 1, schoolMax: 1 });
    return new World(stats, createRng(314), 800, 600, options);
  }

  it("announces each boundary once, remembers visits and keeps swimming fish", () => {
    const world = biomeWorld();
    expect(world.biome).toEqual({ biome: "reef", next: "trench", progress: 0, blend: 0 });
    expect([...world.biomesReached]).toEqual(["reef"]);
    expect(world.graveyardChests).toBe(0);
    expect(world.drainEvents().filter(e => e.type === "biome")).toEqual([]);
    const fish = world.spawn("normal")!;
    run(world, 300 - STEP, () => { world.drainEvents(); });
    const hp = fish.hp;
    const maxHp = fish.maxHp;
    expect(world.biome?.biome).toBe("reef");
    world.update(STEP);
    expect(world.elapsed).toBe(300);
    expect(world.biome?.biome).toBe("trench");
    expect(world.fish).toContain(fish);
    expect(fish.hp).toBe(hp);
    expect(fish.maxHp).toBe(maxHp);
    expect([...world.biomesReached]).toEqual(["reef", "trench"]);
    expect(world.drainEvents().filter(e => e.type === "biome")).toEqual([{ type: "biome", biome: "trench" }]);
    const boundaries: { at: number; biome: string }[] = [];
    for (let step = 0; step < 600 / STEP; step++) {
      world.update(STEP);
      for (const event of world.drainEvents()) {
        if (event.type === "biome") boundaries.push({ at: world.elapsed, biome: event.biome });
      }
    }
    expect(boundaries).toEqual([{ at: 600, biome: "graveyard" }, { at: 900, biome: "reef" }]);
    expect([...world.biomesReached]).toEqual(["reef", "trench", "graveyard"]);
    world.finish();
    world.drainEvents();
    run(world, 301);
    expect(world.elapsed).toBe(900);
    expect(world.drainEvents()).toEqual([]);
  });

  it("keeps timed rounds outside the biome clock", () => {
    const world = makeWorld({ startFish: 0, goldenRate: 0, chestChance: 0, roundSeconds: 1000 });
    run(world, 901);
    expect(world.biome).toBeUndefined();
    expect(world.biomesReached.size).toBe(0);
    expect(world.graveyardChests).toBe(0);
    expect(world.drainEvents().filter(e => e.type === "biome")).toEqual([]);
  });

  it("does not draw world randomness for biome clocks or boundary events", () => {
    const world = biomeWorld();
    const reference = biomeWorld();
    run(world, 1200, () => { world.drainEvents(); });
    for (let i = 0; i < 10; i++) expect(world.biome?.biome).toBe("trench");
    expect(world.rng()).toBe(reference.rng());
  });

  it.each([
    [0, [1.2, 1.2, 1, 1, 1, 1, 1, 1]],
    [300, [1, 1, 2, 1.5, 1, 1, 1, 1]],
    [600, [1, 1, 1, 1, 1, 1.5, 1.5, 1]],
  ] as const)("applies only the unlocked kinds' biome spawn multipliers at %i", (elapsed, multipliers) => {
    for (const [index, kind] of FISH_KINDS.entries()) {
      const world = biomeWorld();
      run(world, elapsed, () => { world.drainEvents(); });
      expect(world.sea).toBe("clear");
      const before = structuredClone(world.stats);
      world.stats.spawnRateMult = 1;
      // Every other kind is locked, including the kinds this biome would favour.
      for (const k of FISH_KINDS) world.stats.fish[k].rate = k === kind ? 5 : 0;
      let spawned = 0;
      run(world, 2, () => {
        spawned += world.fish.length;
        expect(world.fish.every(fish => fish.kind === kind)).toBe(true);
        world.fish.length = 0;
      });
      spawned += world.fish.length;
      expect(Math.abs(spawned - 10 * multipliers[index]!)).toBeLessThanOrEqual(1);
      expect(world.fish.every(fish => fish.kind === kind)).toBe(true);
      expect(world.stats.fish[kind].rateMult).toBe(before.fish[kind].rateMult);
    }
  });

  it("switches spawn clocks at the boundary", () => {
    const world = biomeWorld();
    run(world, 300 - STEP, () => { world.drainEvents(); });
    world.stats.spawnRateMult = 1;
    world.stats.fish.rare = { rate: 60, rateMult: 1, valueMult: 1 };
    world.stats.fish.normal.rate = 0;
    world.update(STEP);
    expect(world.countOf("rare")).toBe(2);
    world.update(STEP);
    expect(world.countOf("rare")).toBe(4);
  });

  it("keeps partial spawn progress when the biome changes", () => {
    const stats = structuredClone(BASE_STATS);
    Object.assign(stats, { startFish: 0, spawnRateMult: 0, goldenRate: 0 });
    const world = new World(stats, () => 0, 800, 600, options);
    run(world, 300 - 3 * STEP, () => { world.drainEvents(); });
    stats.spawnRateMult = 1;
    stats.fish.normal.rate = 0;
    stats.fish.rare.rate = 20;
    // Two Reef steps build 2/3 of a spawn; the first Trench step adds another 2/3.
    run(world, 2 * STEP);
    expect(world.countOf("rare")).toBe(0);
    world.update(STEP);
    expect(world.elapsed).toBe(300);
    expect(world.countOf("rare")).toBe(1);
  });

  it("stacks Reef spawn rates with Bloom and upgrade multipliers without changing stats", () => {
    let checked = false;
    for (let seed = 0; seed < 12 && !checked; seed++) {
      const stats = structuredClone(BASE_STATS);
      Object.assign(stats, { startFish: 0, spawnRateMult: 0, goldenRate: 0 });
      const world = new World(stats, createRng(seed), 800, 600, options);
      run(world, 150, () => { world.drainEvents(); });
      if (world.sea !== "bloom") continue;
      stats.spawnRateMult = 2;
      stats.fish.normal = { rate: 5, rateMult: 2, valueMult: 1 };
      const snapshot = structuredClone(stats);
      run(world, 2);
      expect(Math.abs(world.fish.length - 60)).toBeLessThanOrEqual(1);
      expect(world.fish.every(f => f.maxHp === FISH.normal.hp * 1.5)).toBe(true);
      expect(world.countOf("rare")).toBe(0);
      expect(stats).toEqual(snapshot);
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it.each([[0, 20], [300, 30], [600, 20]] as const)("uses the golden arrival multiplier at %i", (elapsed, expected) => {
    const world = biomeWorld();
    run(world, elapsed, () => { world.drainEvents(); });
    world.stats.goldenRate = 10;
    run(world, 2 + STEP);
    expect(world.drainEvents().filter(e => e.type === "golden")).toHaveLength(expected);
    expect(world.fish.every(f => f.kind === "normal")).toBe(true);
  });

  it("keeps goldens disabled at zero rate and never picks locked kinds", () => {
    const world = biomeWorld();
    run(world, 310, () => { world.drainEvents(); });
    expect(world.fish).toEqual([]);
    expect(world.drainEvents().filter(e => e.type === "golden")).toEqual([]);
    for (const kind of FISH_KINDS) world.stats.fish[kind].rate = 0;
    world.stats.goldenRate = 10;
    run(world, 2);
    expect(world.fish).toEqual([]);
    expect(world.drainEvents().filter(e => e.type === "golden")).toEqual([]);
  });

  it("weights golden kinds by the biome's unlocked spawn rates", () => {
    const world = biomeWorld();
    run(world, 300, () => { world.drainEvents(); });
    world.stats.fish.normal.rate = 1;
    world.stats.fish.rare = { rate: 1, rateMult: 1, valueMult: 1 };
    let rare = 0;
    for (let i = 0; i < 1000; i++) {
      const fish = world.spawnGolden()!;
      if (fish.kind === "rare") rare++;
      expect(["normal", "rare"]).toContain(fish.kind);
      world.fish.length = 0;
    }
    expect(rare).toBeGreaterThan(620);
    expect(rare).toBeLessThan(710);
  });

  it("shortens the outstanding chest wait immediately on entering the Graveyard", () => {
    const world = biomeWorld();
    run(world, 600 - STEP, () => { world.drainEvents(); });
    const state = world as unknown as { chestAt: number };
    state.chestAt = 690;
    world.chest = null;
    world.update(STEP);
    expect(state.chestAt).toBe(630);
    run(world, 30 - STEP);
    expect(world.chest).toBeNull();
    world.update(STEP);
    expect(world.chest).not.toBeNull();
    expect(state.chestAt - world.elapsed).toBeGreaterThanOrEqual(20);
    expect(state.chestAt - world.elapsed).toBeLessThanOrEqual(100 / 3);
  });

  it("restores the outstanding chest wait when leaving the Graveyard", () => {
    const world = biomeWorld();
    run(world, 900 - STEP, () => { world.drainEvents(); });
    const state = world as unknown as { chestAt: number };
    state.chestAt = 920;
    world.chest = null;
    world.update(STEP);
    expect(state.chestAt).toBe(960);
    run(world, 60 - STEP);
    expect(world.chest).toBeNull();
    world.update(STEP);
    expect(world.chest).not.toBeNull();
    expect(state.chestAt - world.elapsed).toBeGreaterThanOrEqual(60);
    expect(state.chestAt - world.elapsed).toBeLessThanOrEqual(100);
  });

  it("never replaces a floating chest when the shortened wait is due", () => {
    const world = biomeWorld();
    run(world, 600, () => { world.drainEvents(); });
    const state = world as unknown as { chestAt: number };
    state.chestAt = 601;
    const chest = { x: 200, y: 200, vx: 0, vy: 0, hp: 10, maxHp: 10, age: 0, hitFlash: 0 };
    world.chest = chest;
    run(world, 35);
    expect(world.chest).toBe(chest);
    world.chest = null;
    world.update(STEP);
    expect(world.chest).not.toBeNull();
    expect(state.chestAt - world.elapsed).toBeGreaterThanOrEqual(20);
    expect(state.chestAt - world.elapsed).toBeLessThanOrEqual(100 / 3);
  });

  it("counts chests by the biome where they open, including both sides of a boundary", () => {
    const world = biomeWorld();
    run(world, 600 - 2 * STEP, () => { world.drainEvents(); });
    world.stats.netDamage = 100;
    world.stats.tickSeconds = STEP;
    const open = () => {
      world.chest = { x: 200, y: 200, vx: 0, vy: 0, hp: 1, maxHp: 1, age: 0, hitFlash: 0 };
      world.pointer = { x: 200, y: 200 };
      world.update(STEP);
    };
    open();
    expect(world.graveyardChests).toBe(0);
    open();
    expect(world.elapsed).toBe(600);
    expect(world.graveyardChests).toBe(1);
    world.pointer = null;
    run(world, 300 - STEP, () => { world.drainEvents(); });
    open();
    expect(world.elapsed).toBe(900);
    expect(world.graveyardChests).toBe(1);
    expect(world.bonusCount.treasure).toBe(3);
  });
});
