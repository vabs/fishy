import type { Fish, Point } from "./world";

/** Minimum distance of a pulled fish's centre from the boat, px. */
export const BOAT_CLEARANCE = 70;

/**
 * Pulls through the fish's offset, preserving its orbit and other movement hooks. The whole path
 * stops at the boat's clearance circle, including when a bait net is on the opposite side.
 */
export function pullTowards(fish: Fish, target: Point, distance: number, boat: Point): void {
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
  fish.offsetX += x - oldX;
  fish.offsetY += y - oldY;
  fish.x = x;
  fish.y = y;
}
