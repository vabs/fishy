import { describe, expect, it } from "vitest";
import { STEP, World, type Fish, type FxEvent, type Shot, type WorldEvent } from "../world";
import { createRng } from "../rng";
import { BASE_STATS, cloneStats, type Stats } from "../stats";
import { FISH_KINDS } from "./index";

const W = 1000;
const H = 700;

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

/** Steps the world, collecting its events. */
function run(world: World, seconds: number, afterStep?: (events: WorldEvent[]) => void): WorldEvent[] {
  const all: WorldEvent[] = [];
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    world.update(STEP);
    const events = world.drainEvents();
    all.push(...events);
    afterStep?.(events);
  }
  return all;
}

function spawnAt(world: World, kind: Fish["kind"], x: number, y: number): Fish {
  const fish = world.spawn(kind, { at: { x, y } });
  if (!fish) throw new Error(`could not spawn ${kind}`);
  expect(fish.x).toBeCloseTo(x);
  expect(fish.y).toBeCloseTo(y);
  return fish;
}

/** A sturdy fish that stays on its spot (apart from its wobble). */
function target(world: World, x: number, y: number): Fish {
  const fish = spawnAt(world, "normal", x, y);
  fish.speedMult = 0;
  fish.hp = fish.maxHp = 100;
  return fish;
}

function addShot(world: World, x: number, y: number, vx: number, vy: number): Shot {
  const a = world.stats.ability.star;
  const shot: Shot = {
    kind: "star",
    x,
    y,
    vx,
    vy,
    radius: a.radius,
    damage: a.damage,
    bouncesLeft: a.bounces,
    age: 0,
    cooldowns: new Map(),
  };
  world.shots.push(shot);
  return shot;
}

const fxNamed = (events: WorldEvent[], name: string) =>
  events.filter((e): e is FxEvent => e.type === "fx" && e.kind === "star" && e.name === name);

describe("Star fish", () => {
  it("zig-zags in and out of its orbit and stays on screen", () => {
    const world = makeWorld((s) => {
      s.fish.star.rate = 1;
      s.startFish = 30;
    });
    const stars = [...world.fish];
    const orbits = new Map(stars.map((f) => [f.id, [f.orbit, f.orbit]]));
    run(world, 5, () => {
      for (const fish of stars) {
        const seen = orbits.get(fish.id)!;
        seen[0] = Math.min(seen[0]!, fish.orbit);
        seen[1] = Math.max(seen[1]!, fish.orbit);
        expect(fish.x).toBeGreaterThanOrEqual(0);
        expect(fish.x).toBeLessThanOrEqual(W);
        expect(fish.y).toBeGreaterThanOrEqual(0);
        expect(fish.y).toBeLessThanOrEqual(H);
        expect(Math.hypot(fish.x - W / 2, fish.y - H / 2)).toBeGreaterThan(50);
      }
    });
    for (const [lo, hi] of orbits.values()) expect(hi! - lo!).toBeGreaterThan(0.1);
  });
});

describe("Star shots", () => {
  it("launches `count` projectiles from the capture point in different directions", () => {
    const world = makeWorld((s) => {
      s.ability.star.count = 3;
    });
    const star = spawnAt(world, "star", 700, 200);
    world.capture(star, "net");
    const [launch] = fxNamed(run(world, STEP), "launch");

    const a = world.stats.ability.star;
    expect(world.shots).toHaveLength(3);
    for (const shot of world.shots) {
      expect(shot.kind).toBe("star");
      expect(shot.x).toBeCloseTo(launch!.x);
      expect(shot.y).toBeCloseTo(launch!.y);
      expect(Math.hypot(shot.vx, shot.vy)).toBeCloseTo(a.speed);
      expect(shot).toMatchObject({ radius: a.radius, damage: a.damage, bouncesLeft: a.bounces });
    }
    const angles = world.shots.map((s) => Math.atan2(s.vy, s.vx));
    for (let i = 0; i < angles.length; i++) {
      for (let j = i + 1; j < angles.length; j++) {
        const gap = Math.abs(Math.atan2(Math.sin(angles[i]! - angles[j]!), Math.cos(angles[i]! - angles[j]!)));
        expect(gap).toBeGreaterThan(1);
      }
    }
  });

  for (const bounces of [0, 3, 6]) {
    it(`bounces exactly ${bounces} times inside the screen, then fades`, () => {
      const world = makeWorld((s) => {
        s.ability.star.bounces = bounces;
      });
      const star = spawnAt(world, "star", 300, 200);
      world.capture(star, "net");
      run(world, STEP);
      expect(world.shots).toHaveLength(1);
      const shot = world.shots[0]!;

      let bounced = 0;
      let faded = 0;
      for (let i = 0; i < 60 * 60 && world.shots.length > 0; i++) {
        run(world, STEP, (events) => {
          bounced += fxNamed(events, "bounce").length;
          faded += fxNamed(events, "fade").length;
        });
        expect(shot.x).toBeGreaterThanOrEqual(shot.radius);
        expect(shot.x).toBeLessThanOrEqual(W - shot.radius);
        expect(shot.y).toBeGreaterThanOrEqual(shot.radius);
        expect(shot.y).toBeLessThanOrEqual(H - shot.radius);
      }
      expect(world.shots).toHaveLength(0);
      expect(bounced).toBe(bounces);
      expect(faded).toBe(1);
    });
  }

  it("hits a fish it sits on once per cooldown", () => {
    const world = makeWorld();
    const fish = target(world, 300, 200);
    addShot(world, 300, 200, 0, 0);
    const damage = world.stats.ability.star.damage;

    run(world, 2 * STEP);
    expect(fish.hits).toBe(1);
    run(world, 0.2);
    expect(fish.hits).toBe(1);
    // Hits on steps 1, 16, 31 and 46 of the first second.
    run(world, 1 - 0.2 - 2 * STEP);
    expect(fish.hits).toBe(4);
    expect(fish.hp).toBe(100 - 4 * damage);
  });

  it("damages each fish along its path once as it passes, and misses the rest", () => {
    const world = makeWorld();
    const onPath = [target(world, 300, 200), target(world, 450, 200), target(world, 600, 200)];
    const offPath = target(world, 450, 120);
    addShot(world, 100, 200, world.stats.ability.star.speed, 0);
    const sources = run(world, 1.2)
      .filter((e) => e.type === "capture")
      .map((e) => e.source);

    for (const fish of onPath) expect(fish.hits).toBe(1);
    expect(offPath.hits).toBe(0);
    expect(sources).toEqual([]);
  });

  it("captures what it kills, and a Star it kills launches its own shots on a later step", () => {
    const world = makeWorld();
    const first = spawnAt(world, "star", 300, 200);
    world.capture(first, "net");
    const launchEvents = fxNamed(run(world, STEP), "launch");
    expect(world.shots).toHaveLength(1);

    // A second, weak Star right where the first shot starts.
    const second = spawnAt(world, "star", launchEvents[0]!.x + 6, launchEvents[0]!.y);
    second.hp = 1;
    const events = run(world, STEP);
    expect(second.captured).toBe(true);
    expect(events.some((e) => e.type === "capture" && e.kind === "star" && e.source === "star")).toBe(true);
    // Launched while the capture queue was processed: there, but not moved until the next step.
    expect(world.shots).toHaveLength(2);
    const launched = world.shots[1]!;
    expect(launched.age).toBe(0);
    const before = { x: launched.x, y: launched.y };

    run(world, STEP);
    expect(launched.age).toBeCloseTo(STEP);
    expect(Math.hypot(launched.x - before.x, launched.y - before.y)).toBeGreaterThan(1);
  });

  it("plays out the same for the same seed", () => {
    const play = () => {
      const world = makeWorld((s) => {
        s.fish.normal.rate = 1.875;
        s.fish.star.rate = 0.625;
        s.startFish = 25;
        s.spawnRateMult = 1;
        s.ability.star.count = 2;
        s.netRadius = 120;
      }, 9);
      run(world, 8, () => {
        world.pointer = { x: 500 + Math.sin(world.elapsed) * 300, y: 350 + Math.cos(world.elapsed) * 200 };
      });
      return { earned: world.earned, shots: world.shots.map((s) => [s.x, s.y]), fish: world.fish.map((f) => [f.x, f.y]) };
    };
    expect(play()).toEqual(play());
  });
});
