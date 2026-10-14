import type { Stats } from "./stats";
import type { Fish, World } from "./world";

/**
 * Golden fish: a rare golden version of any type, worth `stats.goldenValueMult` × its value, that
 * tries to get away.
 *
 * Tuning:
 * - From round `fromRound` on, golden fish arrive on their own clock at `stats.goldenRate` per
 *   second, as fresh spawns that swim alone (a golden Uncommon starts no school).
 * - It swims at `speedMult` × its type's speed. When the net comes within `netRadius + alertMargin`
 *   px it darts: its speed eases up to `dartMult` × that over `easeSeconds`, it turns round if it was
 *   heading towards the net (at most once every `turnGap` s), and it edges away from the net across
 *   its orbit at up to `driftRate` of the swimming area per second.
 * - Left uncaught for `stats.goldenSeconds`, it dives and is gone, paying nothing.
 *
 * The extra speed is returned to the World as a multiplier for one step and never written to
 * `fish.speedMult`, which belongs to the type's own movement, so fleeing can't compound across steps.
 */
export const GOLDEN = {
  fromRound: 2,
  speedMult: 1.5,
  alertMargin: 80,
  dartMult: 1.8,
  easeSeconds: 0.25,
  turnGap: 0.8,
  driftRate: 0.3,
};

/** Per-fish golden state, on `fish.golden`. */
export interface GoldenState {
  /** Seconds left before it dives away. */
  timeLeft: number;
  /** 0 to 1: how hard it's darting away from the net right now. */
  dart: number;
  /** Seconds before it may turn round again. */
  turnIn: number;
}

export function newGoldenState(stats: Stats): GoldenState {
  return { timeLeft: stats.goldenSeconds, dart: 0, turnIn: 0 };
}

/**
 * Runs a golden fish's escape for one step, before the World moves it along its orbit. May turn it
 * round and shift its orbit; returns the speed multiplier for this step, on top of `fish.speedMult`.
 */
export function goldenSwim(world: World, fish: Fish, golden: GoldenState, dt: number): number {
  const g = GOLDEN;
  golden.timeLeft -= dt;
  golden.turnIn = Math.max(0, golden.turnIn - dt);

  const pointer = world.pointer;
  const threatened =
    pointer !== null && Math.hypot(fish.x - pointer.x, fish.y - pointer.y) < world.stats.netRadius + g.alertMargin;
  golden.dart = clamp(golden.dart + (threatened ? dt : -dt) / g.easeSeconds, 0, 1);

  if (pointer && threatened) {
    const { cx, cy, rx, ry, minOrbit } = world.swimArea();
    // Which way it's swimming along the path, against which way is away from the net.
    const ahead =
      -Math.sin(fish.angle) * rx * fish.dir * (fish.x - pointer.x) + Math.cos(fish.angle) * ry * fish.dir * (fish.y - pointer.y);
    if (ahead < 0 && golden.turnIn === 0) {
      fish.dir = fish.dir === 1 ? -1 : 1;
      golden.turnIn = g.turnGap;
    }
    // Outwards when the net is nearer the boat, inwards when it's further out.
    const netOrbit = Math.hypot((pointer.x - cx) / rx, (pointer.y - cy) / ry);
    const away = netOrbit < fish.orbit ? 1 : -1;
    fish.orbit = clamp(fish.orbit + away * g.driftRate * golden.dart * dt, minOrbit, 1);
  }
  return g.speedMult * (1 + (g.dartMult - 1) * golden.dart);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
