import { describe, expect, it, vi } from "vitest";
import { createRng } from "../rng";
import { BASE_STATS, cloneStats, type Stats } from "../stats";
import { STEP, World, type Fish, type FxEvent, type Point } from "../world";
import { ELECTRIC_MOVE, electric, orbitBounds } from "./electric";
import { FISH_KINDS, type FishKind } from "./index";

/** Stats where only `kinds` spawn, with no timed spawns and a round long enough for any test. */
function statsFor(kinds: FishKind[], ability: Partial<Stats["ability"]["electric"]> = {}): Stats {
  const stats = cloneStats(BASE_STATS);
  for (const kind of FISH_KINDS) stats.fish[kind].weight = kinds.includes(kind) ? 1 : 0;
  stats.spawnSeconds = Infinity;
  stats.startFish = 0;
  stats.roundSeconds = 10_000;
  Object.assign(stats.ability.electric, ability);
  return stats;
}

function makeWorld(stats: Stats, seed = 42): World {
  return new World(stats, createRng(seed), 800, 600);
}

function run(world: World, seconds: number, beforeStep?: () => void): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    beforeStep?.();
    world.update(STEP);
  }
}

function put(world: World, kind: FishKind, x: number, y: number): Fish {
  const fish = world.spawn(kind, { at: { x, y } });
  if (!fish) throw new Error(`could not spawn ${kind}`);
  expect(fish.x).toBeCloseTo(x);
  expect(fish.y).toBeCloseTo(y);
  return fish;
}

function currents(world: World): FxEvent[] {
  return world.drainEvents().filter((e): e is FxEvent => e.type === "fx" && e.kind === "electric");
}

describe("Electric current", () => {
  it("jumps nearest-first, at most `jumps` times, each fish once, for the same damage every jump", () => {
    const world = makeWorld(statsFor([], { jumps: 3, damage: 1, range: 120 }));
    const eel = put(world, "electric", 450, 120);
    const a = put(world, "normal", 490, 120); // 40 from the eel
    const decoy = put(world, "normal", 450, 200); // 80 from the eel, 89 from a, 120.4 from b
    const b = put(world, "normal", 540, 120); // 50 from a
    const c = put(world, "normal", 600, 120); // 60 from b
    const d = put(world, "normal", 660, 120); // 60 from c, but the jumps run out first
    const damage = vi.spyOn(world, "damage");

    electric.onCapture!(world, eel, "net");

    expect(damage.mock.calls).toEqual([
      [a, 1, "electric"],
      [b, 1, "electric"],
      [c, 1, "electric"],
    ]);
    for (const fish of [a, b, c]) expect(fish.hp).toBe(fish.maxHp - 1);
    for (const fish of [decoy, d, eel]) expect(fish.hp).toBe(fish.maxHp);
    const [event] = currents(world);
    expect(event?.points).toEqual([
      { x: eel.x, y: eel.y },
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
      { x: c.x, y: c.y },
    ]);
  });

  it("measures range from the previous fish, not from where the current started", () => {
    const world = makeWorld(statsFor([], { jumps: 5, damage: 1, range: 100 }));
    const eel = put(world, "electric", 300, 120);
    const a = put(world, "normal", 390, 120); // 90 from the eel
    const b = put(world, "normal", 480, 120); // 90 from a, 180 from the eel
    const far = put(world, "normal", 585, 120); // 105 from b: out of range
    const damage = vi.spyOn(world, "damage");

    electric.onCapture!(world, eel, "net");

    expect(damage.mock.calls.map(([fish]) => fish)).toEqual([a, b]);
    expect(far.hp).toBe(far.maxHp);
  });

  it("never hits the same fish twice, even with jumps to spare", () => {
    const world = makeWorld(statsFor([], { jumps: 10, damage: 0.5, range: 200 }));
    const eel = put(world, "electric", 300, 120);
    const a = put(world, "normal", 340, 120);
    const b = put(world, "normal", 380, 120);
    const damage = vi.spyOn(world, "damage");

    electric.onCapture!(world, eel, "net");

    expect(damage.mock.calls.map(([fish]) => fish)).toEqual([a, b]);
    expect(currents(world)[0]?.points).toHaveLength(3);
  });

  it("fizzles with nothing in range but still shows a spark", () => {
    const world = makeWorld(statsFor([], { range: 50 }));
    const eel = put(world, "electric", 300, 120);
    put(world, "normal", 360, 120);
    const damage = vi.spyOn(world, "damage");

    electric.onCapture!(world, eel, "net");

    expect(damage).not.toHaveBeenCalled();
    expect(currents(world)[0]?.points).toEqual([{ x: eel.x, y: eel.y }]);
  });

  it("captures fish it kills through the normal pipeline, with source electric", () => {
    const world = makeWorld(statsFor([], { jumps: 2, damage: 5, range: 120 }));
    const eel = put(world, "electric", 450, 120);
    put(world, "normal", 500, 120);
    put(world, "normal", 550, 120);

    world.capture(eel, "net");
    run(world, STEP); // the eel's capture fires the current
    run(world, STEP); // the fish it killed are paid for

    const captures = world.drainEvents().filter((e) => e.type === "capture");
    expect(captures.map((e) => e.type === "capture" && [e.kind, e.source])).toEqual([
      ["electric", "net"],
      ["normal", "electric"],
      ["normal", "electric"],
    ]);
    expect(world.fish).toHaveLength(0);
  });

  it("chains: an Electric killed by a current starts its own on a later step", () => {
    const world = makeWorld(statsFor([], { jumps: 1, damage: 10, range: 120 }));
    const first = put(world, "electric", 300, 120);
    const second = put(world, "electric", 350, 120); // nearest to the first
    const target = put(world, "normal", 450, 120); // 100 from the second, 150 from the first

    world.capture(first, "net");
    run(world, STEP);
    expect(second.captured).toBe(true);
    expect(target.hp).toBe(target.maxHp);
    expect(world.caught.electric).toBe(1);

    run(world, STEP);
    expect(world.caught.electric).toBe(2);
    expect(target.captured).toBe(true);
    const fx = currents(world);
    expect(fx).toHaveLength(2);
    expect(fx[1]?.points?.[1]?.x).toBeCloseTo(target.x);

    run(world, STEP);
    expect(world.caught.normal).toBe(1);
  });
});

describe("Electric movement", () => {
  it("uses the same orbit range as spawning", () => {
    const world = makeWorld(statsFor([]));
    // 800 × 600 screen: the swimming area is 370 × 270, and fish keep 70 px from the boat.
    expect(orbitBounds(world)).toEqual({ min: 70 / 270, max: 1 });
  });

  it("drifts, darts in short bursts and shifts orbit, staying in bounds and on screen", () => {
    const world = makeWorld({ ...statsFor(["electric"]), startFish: 25 }, 7);
    const { min, max } = orbitBounds(world);
    const startOrbit = new Map(world.fish.map((f) => [f.id, f.orbit]));
    const runLength = new Map<number, number>();
    const darts: number[] = [];
    let drifting = 0;
    let biggestShift = 0;
    const { driftMult, dartMin, dartMax } = ELECTRIC_MOVE;

    run(world, 60, () => {
      for (const fish of world.fish) {
        expect(fish.orbit).toBeGreaterThanOrEqual(min - 1e-9);
        expect(fish.orbit).toBeLessThanOrEqual(max + 1e-9);
        expect(fish.x).toBeGreaterThanOrEqual(0);
        expect(fish.x).toBeLessThanOrEqual(800);
        expect(fish.y).toBeGreaterThanOrEqual(0);
        expect(fish.y).toBeLessThanOrEqual(600);
        expect(Math.hypot(fish.x - 400, fish.y - 300)).toBeGreaterThan(50);
        biggestShift = Math.max(biggestShift, Math.abs(fish.orbit - startOrbit.get(fish.id)!));

        if (fish.speedMult > driftMult + 1e-9) {
          runLength.set(fish.id, (runLength.get(fish.id) ?? 0) + 1);
        } else {
          drifting++;
          const steps = runLength.get(fish.id);
          if (steps) darts.push(steps * STEP);
          runLength.delete(fish.id);
        }
      }
    });

    expect(world.fish).toHaveLength(25);
    // Each fish rests 0.8–2.6 s between darts, so 60 s gives well over 20 darts per fish.
    expect(darts.length).toBeGreaterThan(25 * 20);
    for (const seconds of darts) {
      expect(seconds).toBeGreaterThanOrEqual(dartMin - STEP * 1.5);
      expect(seconds).toBeLessThanOrEqual(dartMax + STEP * 1.5);
    }
    // Mostly drifting.
    expect(drifting).toBeGreaterThan(0.7 * 25 * 60 * 60);
    expect(biggestShift).toBeGreaterThan(0.2);
  });

  it("changes distance only while darting, gradually rather than in one step", () => {
    const world = makeWorld({ ...statsFor(["electric"]), startFish: 20 }, 3);
    const { driftMult, shiftMax, dartMin } = ELECTRIC_MOVE;
    let largestStep = 0;
    for (let i = 0; i < 30 / STEP; i++) {
      const before = world.fish.map((f) => ({ orbit: f.orbit, darting: f.speedMult > driftMult }));
      world.update(STEP);
      world.fish.forEach((f, j) => {
        const change = Math.abs(f.orbit - before[j]!.orbit);
        // A dart is set up on the step it starts, so the orbit can only move once the eel is darting.
        if (!before[j]!.darting) expect(change).toBe(0);
        largestStep = Math.max(largestStep, change);
      });
    }
    // The shift eases out over the dart (1 - (1 - p)²), so one step covers at most 2·STEP/dart of it.
    expect(largestStep).toBeGreaterThan(0);
    expect(largestStep).toBeLessThanOrEqual((shiftMax * 2 * STEP) / dartMin + 1e-9);
  });

  it("is deterministic for a seed", () => {
    const play = () => {
      const world = makeWorld({ ...statsFor(["electric"]), startFish: 10 }, 11);
      run(world, 10);
      return world.fish.map((f): Point => ({ x: f.x, y: f.y }));
    };
    expect(play()).toEqual(play());
  });
});
