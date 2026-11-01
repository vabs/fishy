import { describe, expect, it } from "vitest";
import { castTraps, resizeTraps } from "./rigging";
import { createRng } from "./rng";
import { BASE_STATS } from "./stats";
import { World } from "./world";

const stats = { ...BASE_STATS.rigging, count: 4, radius: 52, seine: true };

/** Check geometry independently of the placement helpers, including all four forbidden corners. */
function valid(width: number, height: number, traps: ReturnType<typeof castTraps>): void {
  const area = new World(BASE_STATS, createRng(1), width, height).swimArea();
  for (const [i, trap] of traps.entries()) {
    const orbit = Math.hypot((trap.x - area.cx) / area.rx, (trap.y - area.cy) / area.ry);
    expect(orbit).toBeGreaterThanOrEqual(Math.max(0.3, area.minOrbit) - 1e-10);
    expect(orbit).toBeLessThanOrEqual(0.85 + 1e-10);
    const edgeX = trap.x < width * 0.22 || trap.x > width * 0.78;
    const edgeY = trap.y < height * 0.22 || trap.y > height * 0.78;
    expect(edgeX && edgeY).toBe(false);
    for (const other of traps.slice(0, i)) {
      expect(Math.hypot(trap.x - other.x, trap.y - other.y)).toBeGreaterThanOrEqual(2.4 * trap.radius - 1e-10);
    }
    if (trap.partner !== null) {
      const partner = traps[trap.partner]!;
      expect(partner.partner).toBe(i);
      const distance = Math.hypot(trap.x - partner.x, trap.y - partner.y);
      expect(distance).toBeGreaterThanOrEqual(140 - 1e-10);
      expect(distance).toBeLessThanOrEqual(280 + 1e-10);
    }
  }
}

describe("Trap placement", () => {
  it.each([[390, 844], [1280, 800], [844, 390], [600, 600]])("keeps all geometry valid on %i × %i over many seeds", (width, height) => {
    const area = new World(BASE_STATS, createRng(1), width, height).swimArea();
    let placed = 0;
    for (let seed = 0; seed < 150; seed++) {
      const traps = castTraps(area, width, height, stats, createRng(seed));
      placed += traps.length;
      valid(width, height, traps);
    }
    expect(placed).toBeGreaterThan(400);
  });

  it("is deterministic while different seeds cast at different spots", () => {
    const area = new World(BASE_STATS, createRng(1), 1280, 800).swimArea();
    const cast = (seed: number) => castTraps(area, 1280, 800, stats, createRng(seed));
    expect(cast(17)).toEqual(cast(17));
    expect(cast(17)).not.toEqual(cast(18));
  });

  it("casts fewer nets instead of relaxing impossible constraints", () => {
    const area = { cx: 40, cy: 40, rx: 10, ry: 10, minOrbit: 0.9 };
    let draws = 0;
    expect(castTraps(area, 80, 80, stats, () => { draws++; return 0.5; })).toEqual([]);
    expect(draws).toBeLessThan(2000);
  });

  it("scales positions on resize and drops nets that no longer fit", () => {
    const area = new World(BASE_STATS, createRng(1), 1280, 800).swimArea();
    const traps = castTraps(area, 1280, 800, stats, createRng(42));
    const larger = new World(BASE_STATS, createRng(1), 1408, 880).swimArea();
    const scaled = resizeTraps(traps, larger, 1408, 880, 1.1, 1.1);
    expect(scaled.length).toBeGreaterThan(0);
    expect(scaled[0]!.x).toBeCloseTo(traps[0]!.x * 1.1);
    valid(1408, 880, scaled);
    const phone = new World(BASE_STATS, createRng(1), 390, 844).swimArea();
    valid(390, 844, resizeTraps(traps, phone, 390, 844, 390 / 1280, 844 / 800));
  });
});
