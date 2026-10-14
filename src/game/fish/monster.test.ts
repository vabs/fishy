import { describe, expect, it } from "vitest";
import { STEP, World, type Fish, type FxEvent, type WorldEvent } from "../world";
import { createRng } from "../rng";
import { BASE_STATS, cloneStats, type Stats } from "../stats";
import { FISH, FISH_KINDS } from "./index";

const W = 1000;
const H = 700;
const radius = BASE_STATS.ability.monster.pullRadius;

/** No timed spawns and every type locked unless a test says otherwise. */
function makeWorld(tune?: (stats: Stats) => void, seed = 42): World {
  const stats = cloneStats(BASE_STATS);
  stats.roundSeconds = 999;
  stats.startFish = 0;
  stats.spawnRateMult = 0;
  for (const kind of FISH_KINDS) stats.fish[kind].rate = 0;
  tune?.(stats);
  return new World(stats, createRng(seed), W, H);
}

function run(world: World, seconds: number, afterStep?: () => void): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    world.update(STEP);
    afterStep?.();
  }
}

function spawnAt(world: World, kind: Fish["kind"], x: number, y: number): Fish {
  const fish = world.spawn(kind, { at: { x, y } });
  if (!fish) throw new Error(`could not spawn ${kind}`);
  expect(fish.x).toBeCloseTo(x);
  expect(fish.y).toBeCloseTo(y);
  return fish;
}

/** A Monster near the top of the screen whose vortex has finished spinning up. */
function spunUpMonster(world: World): Fish {
  const boss = spawnAt(world, "monster", 500, 140);
  run(world, 1.2);
  return boss;
}

/** A fish at an offset from another fish. */
function spawnBy(world: World, kind: Fish["kind"], from: Fish, dx: number, dy: number): Fish {
  return spawnAt(world, kind, from.x + dx, from.y + dy);
}

/** A fish that stays put on its path (apart from its wobble), so only the vortex moves it. */
function still(fish: Fish): Fish {
  fish.speedMult = 0;
  return fish;
}

const dist = (a: Fish, b: Fish) => Math.hypot(a.x - b.x, a.y - b.y);
const offset = (f: Fish) => Math.hypot(f.offsetX, f.offsetY);

describe("Monster vortex", () => {
  it("releases resized vortex offsets completely and resets movement history", () => {
    const world = makeWorld();
    const boss = spunUpMonster(world);
    const fish = still(spawnBy(world, "normal", boss, 115, 0));
    run(world, 2);
    expect(fish.state.whirl).toBe(1);
    const ox = fish.state.whirlOx!;
    const oy = fish.state.whirlOy!;
    world.resize(W / 2, H * 2);
    expect(fish.state.whirlOx).toBeCloseTo(ox / 2);
    expect(fish.state.whirlOy).toBeCloseTo(oy * 2);
    expect(fish.state.whirlPx).toBeUndefined();
    expect(fish.state.whirlPy).toBeUndefined();
    expect(boss.state.lastX).toBeUndefined();
    expect(boss.state.lastY).toBeUndefined();
    world.fish.splice(world.fish.indexOf(boss), 1);
    run(world, 20);
    expect(fish.state.whirl).toBeUndefined();
    expect(fish.offsetX).toBeCloseTo(0);
    expect(fish.offsetY).toBeCloseTo(0);
  });

  it("pulls nearby fish in and around it, and leaves far fish and Stars alone", () => {
    const world = makeWorld();
    const boss = spunUpMonster(world);
    const near = still(spawnBy(world, "normal", boss, 115, 0));
    const far = still(spawnAt(world, "normal", 300, 520));
    const star = still(spawnBy(world, "star", boss, 50, 100));
    expect(dist(near, boss)).toBeLessThan(radius);
    expect(dist(star, boss)).toBeLessThan(radius);
    expect(dist(far, boss)).toBeGreaterThan(radius * 2);

    const start = dist(near, boss);
    let swept = 0;
    let lastAngle = Math.atan2(near.y - boss.y, near.x - boss.x);
    run(world, 4, () => {
      const angle = Math.atan2(near.y - boss.y, near.x - boss.x);
      swept += Math.atan2(Math.sin(angle - lastAngle), Math.cos(angle - lastAngle));
      lastAngle = angle;
    });

    expect(dist(near, boss)).toBeLessThan(start - 20);
    // Around it, clockwise on screen.
    expect(swept).toBeGreaterThan(0.5);
    for (const fish of [far, star, boss]) {
      expect(fish.offsetX).toBe(0);
      expect(fish.offsetY).toBe(0);
    }
  });

  it("never pulls another Monster", () => {
    const world = makeWorld();
    const boss = spunUpMonster(world);
    // Only one Monster can spawn normally, so dress up a Normal fish inside the first one's vortex.
    const rival = spawnBy(world, "normal", boss, -80, 40);
    rival.kind = "monster";
    run(world, 3);
    for (const fish of [boss, rival]) {
      expect(fish.offsetX).toBe(0);
      expect(fish.offsetY).toBe(0);
    }
  });

  it("bunches fish up without ever letting them into the Monster's body or off screen", () => {
    const world = makeWorld((s) => {
      s.fish.normal.rate = 1;
      s.startFish = 40;
      s.ability.monster.pullRadius = 220;
    });
    const boss = spawnAt(world, "monster", 500, 140);
    let closest = Infinity;
    run(world, 12, () => {
      for (const fish of world.fish) {
        expect(fish.x).toBeGreaterThanOrEqual(0);
        expect(fish.x).toBeLessThanOrEqual(W);
        expect(fish.y).toBeGreaterThanOrEqual(0);
        expect(fish.y).toBeLessThanOrEqual(H);
        if (fish !== boss && boss.age > 1.2) closest = Math.min(closest, dist(fish, boss));
      }
    });
    expect(closest).toBeGreaterThan(FISH.monster.size * 0.42);
    const held = world.fish.filter((f) => f !== boss && dist(f, boss) < 220);
    expect(held.length).toBeGreaterThanOrEqual(5);
  });

  it("lets a fish go once its own path has carried it too far, and it settles back on that path", () => {
    const world = makeWorld();
    const boss = spunUpMonster(world);
    const fish = spawnBy(world, "normal", boss, 100, 20);
    let wasHeld = false;
    let freedAfterHold = false;
    let maxOffset = 0;
    run(world, 40, () => {
      maxOffset = Math.max(maxOffset, offset(fish));
      if (fish.state.whirl === 1 && dist(fish, boss) < radius * 0.7) wasHeld = true;
      if (wasHeld && fish.state.whirl === undefined) freedAfterHold = true;
    });
    expect(wasHeld).toBe(true);
    expect(freedAfterHold).toBe(true);
    // Held to 1.5 radii from its path, give or take the screen and body limits.
    expect(maxOffset).toBeLessThan(radius * 1.5 + 10);
  });

  it("relaxes offsets smoothly back to 0 once the vortex lets go and the Monster is caught", () => {
    const world = makeWorld();
    const boss = spunUpMonster(world);
    const fish = still(spawnBy(world, "normal", boss, 115, 0));
    run(world, 3);
    expect(offset(fish)).toBeGreaterThan(10);

    // Shrink the vortex so the fish is outside it, then catch the Monster.
    world.stats.ability.monster.pullRadius = 10;
    world.capture(boss, "net");
    let biggestStep = 0;
    let last = { x: fish.x, y: fish.y };
    run(world, 8, () => {
      biggestStep = Math.max(biggestStep, Math.hypot(fish.x - last.x, fish.y - last.y));
      last = { x: fish.x, y: fish.y };
    });

    expect(boss.captured).toBe(true);
    expect(fish.captured).toBe(false);
    expect(fish.offsetX).toBe(0);
    expect(fish.offsetY).toBe(0);
    expect(fish.state.whirl).toBeUndefined();
    // At most a couple of px per step: a smooth swim, never a snap.
    expect(biggestStep).toBeLessThan(2.5);
  });
});

describe("Monster capture", () => {
  it("captures everything within the vortex radius and nothing outside it", () => {
    const world = makeWorld();
    const boss = spunUpMonster(world);
    const inside = [
      still(spawnBy(world, "normal", boss, 80, 0)),
      still(spawnBy(world, "normal", boss, -60, 80)),
      still(spawnBy(world, "star", boss, 0, 125)),
    ];
    const outside = [still(spawnBy(world, "normal", boss, 200, 0)), still(spawnBy(world, "normal", boss, -200, 60))];

    world.capture(boss, "net");
    const events: WorldEvent[] = [];
    for (let i = 0; i < 3; i++) {
      world.update(STEP);
      events.push(...world.drainEvents());
    }

    expect(inside.every((f) => f.captured)).toBe(true);
    expect(outside.some((f) => f.captured)).toBe(false);
    expect(world.caught).toEqual({ monster: 1, normal: 2, star: 1 });
    const whirlpool = events.filter((e) => e.type === "capture" && e.source === "whirlpool");
    expect(whirlpool).toHaveLength(3);
    const implode = events.find((e): e is FxEvent => e.type === "fx" && e.name === "implode");
    expect(implode?.points).toHaveLength(3);
    // The Star's own capture effect fired through the normal queue.
    expect(world.shots.filter((s) => s.kind === "star")).toHaveLength(BASE_STATS.ability.star.count);
  });

  it("plays out the same for the same seed", () => {
    const play = () => {
      const world = makeWorld((s) => {
        s.fish.normal.rate = 1.5;
        s.fish.monster.rate = 0.5;
        s.startFish = 25;
        s.spawnRateMult = 1;
      }, 7);
      run(world, 10);
      return world.fish.map((f) => [f.kind, f.x, f.y]);
    };
    expect(play()).toEqual(play());
  });
});
