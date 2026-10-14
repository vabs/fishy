import { describe, expect, it } from "vitest";
import { FISH } from "./fish";
import { createRng } from "./rng";
import { BASE_STATS, type Stats } from "./stats";
import { STEP, World, isFrenzyRound, type Fish, type RoundOptions, type WorldEvent } from "./world";

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
