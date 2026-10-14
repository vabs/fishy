import type { Effect } from "./fx";
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

// ---------------------------------------------------------------------------------------------
// Look (render only). Golden fish are silhouettes outside the net like every fish, so what gives
// them away is shape and motion: four-point glints that pop around them. Never colour alone.

const TAU = Math.PI * 2;
/** Glints around each golden fish at once, and how long each one lives, s. */
const GLINTS = 4;
const GLINT_SECONDS = 0.8;
const GLINT_COLOR = "255, 250, 225";
const GLOW_COLOR = "255, 205, 70";

/** A four-point sparkle centred on (x, y): long thin rays, `r` px from the centre to a tip. */
export function sparklePath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rotation = 0): void {
  const waist = r * 0.2;
  ctx.moveTo(x + Math.cos(rotation) * r, y + Math.sin(rotation) * r);
  for (let i = 1; i < 8; i++) {
    const a = rotation + (i * Math.PI) / 4;
    const d = i % 2 === 0 ? r : waist;
    ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
}

/** Stable pseudo-random number in [0, 1) for a pair of integers, so glints don't jitter between frames. */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Glints popping in and out around a golden fish of body length `size`: each grows, turns and
 * shrinks away at a new spot on and around the body. `alpha` fades them with the fish.
 */
export function drawGlints(ctx: CanvasRenderingContext2D, fish: Fish, size: number, time: number, alpha: number): void {
  const reach = size * 0.55;
  const tip = clamp(size * 0.28, 7.5, 14);
  for (let i = 0; i < GLINTS; i++) {
    const t = time / GLINT_SECONDS + i / GLINTS + hash(fish.id, i);
    const cycle = Math.floor(t);
    const life = t - cycle;
    const pop = Math.sin(life * Math.PI);
    const angle = hash(fish.id * 7 + i, cycle) * TAU;
    const dist = reach * (0.3 + 0.7 * hash(cycle, fish.id * 13 + i));
    const x = fish.x + Math.cos(angle) * dist;
    const y = fish.y + Math.sin(angle) * dist * 0.75;
    const r = tip * pop;
    if (r < 0.5) continue;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 1.1);
    glow.addColorStop(0, `rgba(${GLOW_COLOR}, ${0.55 * pop * alpha})`);
    glow.addColorStop(1, `rgba(${GLOW_COLOR}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.1, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(${GLINT_COLOR}, ${pop * alpha})`;
    ctx.beginPath();
    sparklePath(ctx, x, y, r, life * 0.8);
    ctx.fill();
  }
}

/** Glints bursting outwards, for a golden fish appearing (small) or being caught (big). */
export function glintBurst(x: number, y: number, big: boolean): Effect {
  const count = big ? 9 : 5;
  const spin = Math.random() * TAU;
  const glints = Array.from({ length: count }, (_, i) => ({
    angle: spin + (i * TAU) / count + (Math.random() - 0.5) * 0.4,
    dist: (big ? 34 : 20) * (0.7 + Math.random() * 0.6),
    size: (big ? 8 : 6) * (0.7 + Math.random() * 0.5),
  }));
  return {
    life: big ? 0.7 : 0.55,
    draw(ctx, t) {
      const out = 1 - (1 - t) * (1 - t);
      const pop = Math.sin(Math.min(1, t * 1.4) * Math.PI);
      if (big && t < 0.35) {
        const flash = ctx.createRadialGradient(x, y, 0, x, y, 30);
        flash.addColorStop(0, `rgba(${GLINT_COLOR}, ${0.9 * (1 - t / 0.35)})`);
        flash.addColorStop(1, `rgba(${GLOW_COLOR}, 0)`);
        ctx.fillStyle = flash;
        ctx.beginPath();
        ctx.arc(x, y, 30, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(${GLINT_COLOR}, ${1 - t * t})`;
      ctx.beginPath();
      for (const g of glints) {
        const r = g.size * pop;
        if (r < 0.5) continue;
        sparklePath(ctx, x + Math.cos(g.angle) * g.dist * out, y + Math.sin(g.angle) * g.dist * out, r, t * 2);
      }
      ctx.fill();
    },
  };
}

/**
 * A golden fish diving away: its sprite tips down, shrinks and fades, and a little splash rises
 * where it went under. `sprite` is drawn facing +x at `width` × `height` px.
 */
export function diveEffect(
  event: { x: number; y: number; heading: number },
  sprite: { image: CanvasImageSource; width: number; height: number },
): Effect {
  const { x, y } = event;
  const flip = Math.cos(event.heading) < 0 ? -1 : 1;
  const drops = Array.from({ length: 7 }, () => ({
    angle: -Math.PI / 2 + (Math.random() - 0.5) * 2.2,
    speed: 40 + Math.random() * 45,
    size: 1.4 + Math.random() * 1.6,
  }));
  return {
    life: 0.6,
    draw(ctx, t) {
      // The fish goes under in the first half.
      const sink = Math.min(1, t / 0.5);
      if (sink < 1) {
        ctx.save();
        ctx.translate(x, y + sink * 6);
        ctx.rotate(event.heading);
        ctx.scale(1 - 0.6 * sink, (1 - 0.6 * sink) * flip);
        ctx.rotate(0.6 * sink);
        ctx.globalAlpha = 1 - sink;
        ctx.drawImage(sprite.image, -sprite.width / 2, -sprite.height / 2, sprite.width, sprite.height);
        ctx.restore();
      }
      // Splash ring and droplets.
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = `rgba(${GLINT_COLOR}, 0.8)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y + 4, 6 + 20 * t, (6 + 20 * t) * 0.45, 0, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = `rgba(${GLINT_COLOR}, 0.9)`;
      ctx.beginPath();
      for (const d of drops) {
        const s = d.speed * t;
        const dx = x + Math.cos(d.angle) * s;
        const dy = y + Math.sin(d.angle) * s + 120 * t * t;
        ctx.moveTo(dx + d.size, dy);
        ctx.arc(dx, dy, d.size * (1 - 0.5 * t), 0, TAU);
      }
      ctx.fill();
    },
  };
}
