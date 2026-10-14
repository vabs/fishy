import type { Effect } from "./fx";
import { FISH, FISH_KINDS } from "./fish";
import { range, type Rng } from "./rng";
import type { Stats } from "./stats";
import type { Point, RoundOptions } from "./world";

/**
 * Treasure chest tuning.
 * - From round `fromRound` a round has one chest with chance `stats.chestChance`; the Final Round
 *   always has one. It appears between `appearFrom` and `appearTo` of the round's length.
 * - It floats in from just outside one screen edge and drifts across to the opposite edge at
 *   `speed` px/s. Its path stays within `bandNear`..`bandFar` of the way from the centre to the
 *   edges it runs along, well clear of the boat. If it reaches the far edge unopened it's gone.
 * - Only the net opens it: it has `hp` hit points, and net damage and crits apply. Abilities never
 *   touch it; it isn't a fish.
 * - Opening it pays `valueInFish` × the value of the most valuable unlocked fish type (with that
 *   type's and the global value multiplier, but no combo or ability bonus), plus one extra picked
 *   at random: `bonusSeconds` more round time, or `goldenFish` golden fish spilling out.
 */
export const CHEST = {
  fromRound: 3,
  appearFrom: 0.2,
  appearTo: 0.6,
  speed: 45,
  bandNear: 0.45,
  bandFar: 0.8,
  /** Body width, px. */
  size: 48,
  hp: 10,
  valueInFish: 20,
  bonusSeconds: 3,
  goldenFish: 3,
};

/** The extra a chest gives on top of its money. */
export type ChestReward = "time" | "golden";

/** A treasure chest floating across the surface. */
export interface Chest {
  x: number;
  y: number;
  /** Velocity, px/s. */
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  /** Seconds left on the hit flash. */
  hitFlash: number;
  /** Seconds since it appeared. */
  age: number;
}

/**
 * When this round's chest appears, in seconds of round time, or null if the round has none. Draws
 * nothing before round `CHEST.fromRound` unless it's the Final Round.
 */
export function chestTime(round: RoundOptions, stats: Stats, rng: Rng): number | null {
  if (!round.final && (round.round < CHEST.fromRound || rng() >= stats.chestChance)) return null;
  return stats.roundSeconds * range(rng, CHEST.appearFrom, CHEST.appearTo);
}

/** A chest just outside a random edge of a `width` × `height` sea, heading for the opposite edge. */
export function launchChest(width: number, height: number, rng: Rng): Chest {
  const horizontal = rng() < 0.5;
  const forward = rng() < 0.5 ? 1 : -1;
  const side = rng() < 0.5 ? 1 : -1;
  // Across the axis of travel, both ends sit in the same band on the same side of the boat.
  const across = horizontal ? height : width;
  const lane = () => across / 2 + side * (across / 2) * range(rng, CHEST.bandNear, CHEST.bandFar);
  const from = lane();
  const to = lane();
  const along = horizontal ? width : height;
  const start = forward === 1 ? -CHEST.size / 2 : along + CHEST.size / 2;
  const end = forward === 1 ? along + CHEST.size / 2 : -CHEST.size / 2;
  const [x0, y0, x1, y1] = horizontal ? [start, from, end, to] : [from, start, to, end];
  const length = Math.hypot(x1 - x0, y1 - y0);
  return {
    x: x0,
    y: y0,
    vx: ((x1 - x0) / length) * CHEST.speed,
    vy: ((y1 - y0) / length) * CHEST.speed,
    hp: CHEST.hp,
    maxHp: CHEST.hp,
    hitFlash: 0,
    age: 0,
  };
}

/** Drifts the chest on. False once it has floated off the far edge. */
export function moveChest(chest: Chest, dt: number, width: number, height: number): boolean {
  chest.x += chest.vx * dt;
  chest.y += chest.vy * dt;
  chest.age += dt;
  chest.hitFlash = Math.max(0, chest.hitFlash - dt);
  const margin = CHEST.size / 2 + 4;
  return chest.x >= -margin && chest.x <= width + margin && chest.y >= -margin && chest.y <= height + margin;
}

/** True when the net centred on `point` reaches the chest. */
export function chestInNet(chest: Chest, point: Point, netRadius: number): boolean {
  return Math.hypot(chest.x - point.x, chest.y - point.y) <= netRadius + CHEST.size * 0.4;
}

/**
 * What opening a chest pays: `CHEST.valueInFish` × the most valuable unlocked type's value, with
 * that type's value multiplier and the global one. 0 if nothing is unlocked.
 */
export function chestValue(stats: Stats): number {
  let best = 0;
  for (const kind of FISH_KINDS) {
    const fish = stats.fish[kind];
    if (fish.rate > 0) best = Math.max(best, FISH[kind].value * fish.valueMult);
  }
  return CHEST.valueInFish * best * stats.valueMult;
}

// ---------------------------------------------------------------------------------------------
// Look (render only). The chest floats at the surface, so it's always drawn in full colour, over
// the fish. Its outline (a box with a domed lid, bands and a lock) reads without colour.

const TAU = Math.PI * 2;
const WOOD = "#8a5a2c";
const WOOD_LIGHT = "#a8713a";
const WOOD_DARK = "#5e3a1a";
const OUTLINE = "#2b1a0b";
const BAND = "#f2c230";
const BAND_DARK = "#9a7410";

/** Sprite box as multiples of CHEST.size: room for the lid and the outline. */
export const CHEST_BOX = { width: 1.15, height: 1.0 };

/** Draws the chest centred on the origin, `CHEST.size` px wide. */
export function drawChestShape(ctx: CanvasRenderingContext2D): void {
  const w = CHEST.size;
  const left = -w / 2;
  const seam = -0.06 * w;
  const bottom = 0.36 * w;
  const lidTop = -0.4 * w;
  const line = Math.max(1.5, 0.05 * w);
  ctx.lineJoin = "round";
  ctx.lineWidth = line;
  ctx.strokeStyle = OUTLINE;

  // Body, with plank seams.
  ctx.fillStyle = WOOD;
  ctx.beginPath();
  ctx.roundRect(left, seam, w, bottom - seam, 0.06 * w);
  ctx.fill();
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = line * 0.5;
  ctx.beginPath();
  for (const y of [0.1, 0.23]) {
    ctx.moveTo(left + line, y * w);
    ctx.lineTo(-left - line, y * w);
  }
  ctx.stroke();

  // Lid: a low dome.
  ctx.fillStyle = WOOD_LIGHT;
  ctx.beginPath();
  ctx.moveTo(left, seam);
  ctx.lineTo(left, -0.2 * w);
  ctx.bezierCurveTo(left, lidTop - 0.02 * w, -left, lidTop - 0.02 * w, -left, -0.2 * w);
  ctx.lineTo(-left, seam);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(left + line, -0.22 * w);
  ctx.bezierCurveTo(left + line, -0.33 * w, -left - line, -0.33 * w, -left - line, -0.22 * w);
  ctx.stroke();

  // Gold bands over lid and body.
  ctx.fillStyle = BAND;
  ctx.strokeStyle = BAND_DARK;
  ctx.lineWidth = line * 0.5;
  for (const x of [-0.32, 0.22]) {
    ctx.beginPath();
    ctx.rect(x * w, lidTop + 0.07 * w, 0.1 * w, bottom - lidTop - 0.07 * w);
    ctx.fill();
    ctx.stroke();
  }
  // Rim along the lid's edge.
  ctx.beginPath();
  ctx.rect(left, seam - 0.05 * w, w, 0.07 * w);
  ctx.fill();
  ctx.stroke();

  // Lock plate and keyhole.
  ctx.beginPath();
  ctx.roundRect(-0.09 * w, seam - 0.08 * w, 0.18 * w, 0.2 * w, 0.03 * w);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(0, seam + 0.0 * w, 0.03 * w, 0, TAU);
  ctx.moveTo(-0.02 * w, seam + 0.01 * w);
  ctx.lineTo(0.02 * w, seam + 0.01 * w);
  ctx.lineTo(0.012 * w, seam + 0.08 * w);
  ctx.lineTo(-0.012 * w, seam + 0.08 * w);
  ctx.closePath();
  ctx.fill();

  // Dark outline round the whole chest last, so the shape stands out on any water.
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.moveTo(left, bottom - 0.06 * w);
  ctx.lineTo(left, -0.2 * w);
  ctx.bezierCurveTo(left, lidTop - 0.02 * w, -left, lidTop - 0.02 * w, -left, -0.2 * w);
  ctx.lineTo(-left, bottom - 0.06 * w);
  ctx.quadraticCurveTo(-left, bottom, -left - 0.06 * w, bottom);
  ctx.lineTo(left + 0.06 * w, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - 0.06 * w);
  ctx.closePath();
  ctx.stroke();
}

/**
 * Coins bursting out of an opened chest: they fly up and out, spin, fall back and fade, with a
 * flash where the chest was. Render only, so Math.random is fine here.
 */
export function coinBurst(x: number, y: number): Effect {
  const coins = Array.from({ length: 18 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const speed = 90 + Math.random() * 120;
    return {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: Math.random() * TAU,
      spinRate: 8 + Math.random() * 10,
      size: 3.5 + Math.random() * 2,
    };
  });
  const life = 1.1;
  return {
    life,
    draw(ctx, t) {
      const s = t * life;
      if (t < 0.25) {
        const flash = ctx.createRadialGradient(x, y, 0, x, y, 46);
        flash.addColorStop(0, `rgba(255, 246, 200, ${0.9 * (1 - t / 0.25)})`);
        flash.addColorStop(1, "rgba(255, 200, 60, 0)");
        ctx.fillStyle = flash;
        ctx.beginPath();
        ctx.arc(x, y, 46, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = Math.min(1, (1 - t) * 2.5);
      ctx.lineWidth = 1;
      for (const c of coins) {
        const cx = x + c.vx * s;
        const cy = y + c.vy * s + 260 * s * s;
        // A spinning coin is a disc seen edge-on now and then.
        const face = Math.abs(Math.cos(c.spin + c.spinRate * s));
        ctx.fillStyle = BAND;
        ctx.strokeStyle = BAND_DARK;
        ctx.beginPath();
        ctx.ellipse(cx, cy, c.size * Math.max(0.15, face), c.size, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
    },
  };
}
