import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import { BASE_STATS, cloneStats, type Stats } from "../stats";
import { STEP, World, type Fish, type FxEvent } from "../world";
import { EPIC_FLEE, epic } from "./epic";
import { FISH_KINDS, type FishKind } from "./index";

/** Stats where nothing spawns on its own, with a round long enough for any test. */
function quietStats(overrides: Partial<Stats> = {}, ability: Partial<Stats["ability"]["epic"]> = {}): Stats {
  const stats = cloneStats(BASE_STATS);
  for (const kind of FISH_KINDS) stats.fish[kind].weight = 0;
  Object.assign(stats, { spawnSeconds: Infinity, startFish: 0, roundSeconds: 10_000 }, overrides);
  Object.assign(stats.ability.epic, ability);
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

const offset = (fish: Fish) => Math.hypot(fish.offsetX, fish.offsetY);

describe("Epic flee", () => {
  it("swims away from a nearby cursor, then drifts back to its orbit when it leaves", () => {
    // No net damage, so only the fleeing is under test.
    const world = makeWorld(quietStats({ netDamage: 0 }));
    const fish = put(world, "epic", 600, 300);
    // 80 px to its left: inside the alert distance of 40 + 60, outside the net.
    world.pointer = { x: 520, y: 300 };

    run(world, 0.5);
    expect(offset(fish)).toBeGreaterThan(25);
    // Pushed right, away from the cursor; the orbit itself runs up or down here.
    expect(fish.offsetX).toBeGreaterThan(Math.abs(fish.offsetY));

    world.pointer = null;
    run(world, 0.5);
    const returning = offset(fish);
    expect(returning).toBeLessThan(25);
    run(world, 4);
    expect(fish.offsetX).toBe(0);
    expect(fish.offsetY).toBe(0);
  });

  it("ignores a cursor that is far away", () => {
    const world = makeWorld(quietStats({ netDamage: 0 }));
    const fish = put(world, "epic", 600, 300);
    world.pointer = { x: 600 - (BASE_STATS.netRadius + EPIC_FLEE.alertMargin + 5), y: 300 };
    run(world, 1);
    expect(offset(fish)).toBe(0);
  });

  it("is slower than the cursor, tires, and never leaves the screen when herded to the edge", () => {
    const world = makeWorld(quietStats({ netDamage: 0 }));
    const fish = put(world, "epic", 650, 150);
    let tiredSteps = 0;
    let fastest = 0;
    let nearestEdge = Infinity;
    // Herd it outward from the boat side for a long time, so it is pinned against the screen edge.
    for (let i = 0; i < 30 / STEP; i++) {
      const dx = fish.x - 400;
      const dy = fish.y - 300;
      const d = Math.hypot(dx, dy);
      world.pointer = { x: fish.x - (dx / d) * 50, y: fish.y - (dy / d) * 50 };
      const before = { x: fish.offsetX, y: fish.offsetY };
      world.update(STEP);
      fastest = Math.max(fastest, Math.hypot(fish.offsetX - before.x, fish.offsetY - before.y) / STEP);
      if ((fish.state.tired ?? 0) > 0) tiredSteps++;

      expect(offset(fish)).toBeLessThanOrEqual(EPIC_FLEE.maxOffset + 1e-6);
      expect(fish.x).toBeGreaterThanOrEqual(0);
      expect(fish.x).toBeLessThanOrEqual(800);
      expect(fish.y).toBeGreaterThanOrEqual(0);
      expect(fish.y).toBeLessThanOrEqual(600);
      nearestEdge = Math.min(nearestEdge, fish.x, fish.y, 800 - fish.x, 600 - fish.y);
    }
    expect(fish.captured).toBe(false);
    // It did reach the edge, and was held a margin inside it (give or take the orbit's one-step drift).
    expect(nearestEdge).toBeLessThan(EPIC_FLEE.screenMargin + 2);
    expect(nearestEdge).toBeGreaterThan(EPIC_FLEE.screenMargin - 2);
    // Chased the whole time, it spends a good share of it tired.
    expect(tiredSteps * STEP).toBeGreaterThan(10);
    // Offset speed never beats the flee speed, bar the small correction when the on-screen clamp
    // follows the orbit.
    expect(fastest).toBeLessThanOrEqual(EPIC_FLEE.speed + 60);
  });

  it("never strays further than maxOffset from its orbit path", () => {
    const world = makeWorld(quietStats({ netDamage: 0 }));
    const fish = put(world, "epic", 760, 300);
    // Start it near the cap, already pushed toward the boat, then keep pushing inward.
    fish.offsetX = -(EPIC_FLEE.maxOffset - 10);
    let largest = 0;
    for (let i = 0; i < 1 / STEP; i++) {
      world.pointer = { x: fish.x + 40, y: fish.y };
      world.update(STEP);
      largest = Math.max(largest, offset(fish));
    }
    expect(largest).toBeCloseTo(EPIC_FLEE.maxOffset, 6);
  });

  it("can be caught by a cursor that chases it at a modest speed", () => {
    const world = makeWorld(quietStats());
    const fish = put(world, "epic", 600, 300);
    const cursor = { x: 600 - 90, y: 300 };
    // A deliberately slow hand: 300 px/s.
    run(world, 8, () => {
      if (fish.captured) return;
      const dx = fish.x - cursor.x;
      const dy = fish.y - cursor.y;
      const d = Math.hypot(dx, dy);
      const step = Math.min(d, 300 * STEP);
      if (d > 0) {
        cursor.x += (dx / d) * step;
        cursor.y += (dy / d) * step;
      }
      world.pointer = { ...cursor };
    });
    expect(world.caught.epic).toBe(1);
  });

  it("keeps out of the boat when chased toward it", () => {
    const world = makeWorld(quietStats({ netDamage: 0 }));
    const fish = put(world, "epic", 500, 300);
    let closest = Infinity;
    for (let i = 0; i < 10 / STEP; i++) {
      const dx = fish.x - 400;
      const dy = fish.y - 300;
      const d = Math.hypot(dx, dy);
      world.pointer = { x: fish.x + (dx / d) * 40, y: fish.y + (dy / d) * 40 };
      world.update(STEP);
      closest = Math.min(closest, Math.hypot(fish.x - 400, fish.y - 300));
    }
    // Pushed right up to the clearance (give or take the orbit's one-step drift), never inside it.
    expect(closest).toBeGreaterThan(EPIC_FLEE.boatClearance - 2);
    expect(closest).toBeLessThan(EPIC_FLEE.boatClearance + 2);
  });
});

describe("Epic net", () => {
  function scene(chance: number) {
    const world = makeWorld(quietStats({}, { chance, range: 90 }));
    const angler = put(world, "epic", 600, 200);
    const inside = [put(world, "normal", 630, 200), put(world, "normal", 600, 260), put(world, "rare", 540, 170)];
    const outside = [put(world, "normal", 695, 200), put(world, "normal", 600, 320), put(world, "normal", 480, 140)];
    return { world, angler, inside, outside };
  }

  it("with chance 1, captures every fish in range and nothing outside it", () => {
    const { world, angler, inside, outside } = scene(1);
    epic.onCapture!(world, angler, "net");

    for (const fish of inside) expect(fish.captured).toBe(true);
    for (const fish of outside) expect(fish.captured).toBe(false);

    const fx = world.drainEvents().filter((e): e is FxEvent => e.type === "fx" && e.kind === "epic");
    expect(fx).toHaveLength(1);
    expect(fx[0]?.radius).toBe(90);
    expect(fx[0]?.points).toHaveLength(inside.length);

    run(world, STEP);
    const sources = world.drainEvents().flatMap((e) => (e.type === "capture" ? [e.source] : []));
    expect(sources).toEqual(["epic", "epic", "epic"]);
    expect(world.fish).toHaveLength(outside.length + 1);
  });

  it("with chance 0, captures nothing", () => {
    const { world, angler, inside, outside } = scene(0);
    epic.onCapture!(world, angler, "net");
    for (const fish of [...inside, ...outside]) expect(fish.captured).toBe(false);
    const fx = world.drainEvents().find((e): e is FxEvent => e.type === "fx");
    expect(fx?.points).toEqual([]);
  });

  it("rolls each fish with the world's seeded rng", () => {
    const caughtIds = (seed: number) => {
      const world = makeWorld(quietStats({}, { chance: 0.5, range: 400 }), seed);
      const angler = put(world, "epic", 600, 200);
      const others = Array.from({ length: 12 }, (_, i) => put(world, "normal", 450 + i * 25, 120 + (i % 3) * 30));
      epic.onCapture!(world, angler, "net");
      return others.filter((f) => f.captured).map((f) => f.id);
    };
    const first = caughtIds(5);
    expect(caughtIds(5)).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(12);
  });

  it("runs through the capture pipeline when the Epic itself is caught", () => {
    const world = makeWorld(quietStats({}, { chance: 1, range: 90 }));
    const angler = put(world, "epic", 600, 200);
    put(world, "normal", 640, 200);
    world.capture(angler, "net");
    run(world, STEP);
    run(world, STEP);
    expect(world.caught).toEqual({ epic: 1, normal: 1 });
  });
});
