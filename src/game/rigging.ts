import { BOAT_CLEARANCE } from "./boat";
import { range, type Rng } from "./rng";
import type { RiggingStats } from "./stats";
import type { Point } from "./world";

/** Trap and seine timing, in seconds, and rope reach, in pixels. */
export const RIGGING = { endlessRecast: 60, seineReach: 10, seineCooldown: 1 };

/** A stationary net, optionally joined to another entry in the world's trap array. */
export interface Trap extends Point {
  id: number;
  radius: number;
  /** Seconds until armed again; 0 = armed. */
  cooldown: number;
  /** Index into world.traps of its seine partner, or null. */
  partner: number | null;
  /** Seconds since this net was cast. */
  age: number;
}

interface Area { cx: number; cy: number; rx: number; ry: number; minOrbit: number }
const ATTEMPTS = 160;

function fits(point: Point, radius: number, area: Area, width: number, height: number): boolean {
  const orbit = Math.hypot((point.x - area.cx) / area.rx, (point.y - area.cy) / area.ry);
  const cornerX = point.x < width * 0.22 || point.x > width * 0.78;
  const cornerY = point.y < height * 0.22 || point.y > height * 0.78;
  return orbit >= Math.max(0.3, area.minOrbit) && orbit <= 0.85 && !(cornerX && cornerY) &&
    Math.hypot(point.x - area.cx, point.y - area.cy) >= BOAT_CLEARANCE + radius &&
    point.x >= radius && point.x <= width - radius && point.y >= radius && point.y <= height - radius;
}

function spaced(point: Point, radius: number, traps: readonly Trap[]): boolean {
  return traps.every(other => Math.hypot(point.x - other.x, point.y - other.y) >= 2.4 * Math.max(radius, other.radius));
}

function partnerDistance(a: Point, b: Point): boolean {
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  return distance >= 140 && distance <= 280;
}

/** Casts random nets with bounded retries; impossible spots are omitted, never forced. */
export function castTraps(area: Area, width: number, height: number, stats: RiggingStats, rng: Rng): Trap[] {
  const traps: Trap[] = [];
  for (let i = 0; i < stats.count; i++) {
    const partner = stats.seine && traps.length % 2 === 1 ? traps.length - 1 : null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const angle = range(rng, 0, Math.PI * 2);
      const orbit = range(rng, Math.max(0.3, area.minOrbit), 0.85);
      const point = { x: area.cx + Math.cos(angle) * area.rx * orbit, y: area.cy + Math.sin(angle) * area.ry * orbit };
      if (!fits(point, stats.radius, area, width, height) || !spaced(point, stats.radius, traps)) continue;
      if (partner !== null && !partnerDistance(point, traps[partner]!)) continue;
      const index = traps.length;
      traps.push({ id: index + 1, ...point, radius: stats.radius, cooldown: 0, partner, age: 0 });
      if (partner !== null) traps[partner]!.partner = index;
      break;
    }
  }
  return traps;
}

/** Scales nets with the arena, dropping invalid spots and repairing partner indices. Draws no RNG. */
export function resizeTraps(traps: readonly Trap[], area: Area, width: number, height: number, sx: number, sy: number): Trap[] {
  const kept: Trap[] = [];
  const indices = new Map<number, number>();
  for (const [index, trap] of traps.entries()) {
    const scaled = { ...trap, x: trap.x * sx, y: trap.y * sy, partner: null };
    if (!fits(scaled, scaled.radius, area, width, height) || !spaced(scaled, scaled.radius, kept)) continue;
    indices.set(index, kept.length);
    kept.push(scaled);
  }
  for (const [old, index] of indices) {
    const oldPartner = traps[old]!.partner;
    const partner = oldPartner === null ? undefined : indices.get(oldPartner);
    if (partner !== undefined && partnerDistance(kept[index]!, kept[partner]!)) kept[index]!.partner = partner;
  }
  return kept;
}

/** Shortest distance to the closed segment, including its endpoints and zero-length ropes. */
export function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
