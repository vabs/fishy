import type { BoatStats } from "./stats";
import type { Fish, Point } from "./world";

/** Minimum distance of a pulled fish's centre from the boat, px. */
export const BOAT_CLEARANCE = 70;

/**
 * Pulls through the fish's offset, preserving its orbit and other movement hooks. The whole path
 * stops at the boat's clearance circle, including when a bait net is on the opposite side.
 */
export function pullTowards(fish: Fish, target: Point, distance: number, boat: Point): void {
  if (distance <= 0) return;
  const x = fish.x;
  const y = fish.y;
  moveTowards(fish, target, distance, boat);
  fish.state.lureOx = (fish.state.lureOx ?? 0) + (fish.x - x);
  fish.state.lureOy = (fish.state.lureOy ?? 0) + (fish.y - y);
  fish.state.lureHeld = 1;
}

/** Releases only the lure's share of displacement when no lure pulled this step. */
export function relaxPull(fish: Fish, boat: Point, dt: number): void {
  if (fish.state.lureHeld === 1) {
    delete fish.state.lureHeld;
    return;
  }
  const ox = fish.state.lureOx;
  const oy = fish.state.lureOy;
  if (ox === undefined || oy === undefined) return;
  const length = Math.hypot(ox, oy);
  const step = length < 0.001 ? length : Math.min(length * 2.5, 70) * dt;
  const x = fish.x;
  const y = fish.y;
  moveTowards(fish, { x: x - ox, y: y - oy }, step, boat);
  const nx = ox + fish.x - x;
  const ny = oy + fish.y - y;
  if (Math.hypot(nx, ny) < 1e-8) {
    delete fish.state.lureOx;
    delete fish.state.lureOy;
  } else {
    fish.state.lureOx = nx;
    fish.state.lureOy = ny;
  }
}

/** Scales the lure's share alongside the fish's total displacement on arena resize. */
export function resizePull(fish: Fish, sx: number, sy: number): void {
  if (fish.state.lureOx !== undefined) fish.state.lureOx *= sx;
  if (fish.state.lureOy !== undefined) fish.state.lureOy *= sy;
}

function moveTowards(fish: Fish, target: Point, distance: number, boat: Point): void {
  if (distance <= 0) return;
  const oldX = fish.x;
  const oldY = fish.y;
  let x = oldX;
  let y = oldY;
  const fromBoat = Math.hypot(x - boat.x, y - boat.y);
  if (fromBoat < BOAT_CLEARANCE) {
    const dx = fromBoat > 1e-9 ? (x - boat.x) / fromBoat : 1;
    const dy = fromBoat > 1e-9 ? (y - boat.y) / fromBoat : 0;
    x = boat.x + dx * BOAT_CLEARANCE;
    y = boat.y + dy * BOAT_CLEARANCE;
  }
  const length = Math.hypot(target.x - x, target.y - y);
  if (length > 1e-9) {
    const ux = (target.x - x) / length;
    const uy = (target.y - y) / length;
    let step = Math.min(distance, length);
    const bx = x - boat.x;
    const by = y - boat.y;
    const along = bx * ux + by * uy;
    const discriminant = along * along - (bx * bx + by * by - BOAT_CLEARANCE * BOAT_CLEARANCE);
    if (along < 0 && discriminant >= 0) {
      const entry = -along - Math.sqrt(discriminant);
      if (entry >= -1e-8) step = Math.min(step, Math.max(0, entry));
    }
    x += ux * step;
    y += uy * step;
  }
  // The boat sits at the arena centre. Lures also keep displaced fish on screen.
  x = Math.max(16, Math.min(boat.x * 2 - 16, x));
  y = Math.max(16, Math.min(boat.y * 2 - 16, y));
  fish.offsetX += x - oldX;
  fish.offsetY += y - oldY;
  fish.x = x;
  fish.y = y;
}

/** The lantern slows swimming locally without changing a fish type's own speed state. */
export function lanternSpeed(fish: Point, boat: Point, stats: BoatStats): number {
  return stats.lanternRadius > 0 && Math.hypot(fish.x - boat.x, fish.y - boat.y) <= stats.lanternRadius ? stats.lanternSlow : 1;
}

/** Gentle lantern attraction, px/s, during the middle quarter of an endless day. */
export function lanternPull(stats: BoatStats, timeOfDay: number | undefined): number {
  return stats.lanternRadius > 0 && timeOfDay !== undefined && timeOfDay >= 0.375 && timeOfDay <= 0.625 ? 12 : 0;
}
