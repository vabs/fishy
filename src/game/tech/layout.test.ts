import { describe, expect, it } from "vitest";
import { TECH_NODES } from ".";
import { DEFAULT_LAYOUT, LANE_ORDER, laneOf, layoutTree } from "./layout";

const TAU = Math.PI * 2;

describe("layoutTree", () => {
  const layout = layoutTree();

  it("places every node, with the root on the boat in the centre", () => {
    expect(layout.nodes.size).toBe(TECH_NODES.length);
    expect(layout.nodes.get("net.radius")).toEqual({ x: 0, y: 0, lane: null, depth: -1 });
  });

  it("is deterministic", () => {
    expect(layoutTree()).toEqual(layout);
  });

  it("keeps every pair of nodes out of each other's footprint", () => {
    const { x: sx, y: sy } = DEFAULT_LAYOUT.spacing;
    const points = [...layout.nodes.entries()];
    for (const [i, [a, p]] of points.entries()) {
      for (const [b, q] of points.slice(i + 1)) {
        // 1 is exactly on the edge of the footprint ellipse; allow a sliver for lanes that curve.
        const reach = Math.hypot((p.x - q.x) / sx, (p.y - q.y) / sy);
        expect(reach, `${a} and ${b}`).toBeGreaterThanOrEqual(0.97);
      }
    }
  });

  it("fits the lanes around the circle without overlapping, Net at the top", () => {
    expect(layout.lanes.map((l) => l.key)).toEqual(LANE_ORDER);
    for (const [i, lane] of layout.lanes.entries()) {
      expect(lane.end).toBeGreaterThan(lane.start);
      const next = layout.lanes[i + 1];
      if (next) expect(next.start).toBeCloseTo(lane.end);
    }
    const first = layout.lanes[0]!;
    const last = layout.lanes[layout.lanes.length - 1]!;
    expect(last.end - first.start).toBeCloseTo(TAU);
    expect(first.center).toBeCloseTo(-Math.PI / 2);
  });

  it("keeps each node inside its lane and on its ring", () => {
    for (const node of TECH_NODES) {
      const placed = layout.nodes.get(node.id)!;
      if (placed.lane === null) continue;
      expect(placed.lane).toBe(laneOf(node));
      const lane = layout.lanes.find((l) => l.key === placed.lane)!;
      let angle = Math.atan2(placed.y, placed.x);
      while (angle < lane.start) angle += TAU;
      expect(angle, node.id).toBeLessThanOrEqual(lane.end);
      expect(Math.hypot(placed.x, placed.y)).toBeCloseTo(layout.rings[placed.depth]!);
    }
  });

  it("puts a node one ring further out than what it needs in its own lane", () => {
    for (const node of TECH_NODES) {
      const placed = layout.nodes.get(node.id)!;
      for (const id of node.requires) {
        const parent = layout.nodes.get(id)!;
        if (parent.lane === placed.lane) expect(placed.depth, node.id).toBeGreaterThan(parent.depth);
      }
    }
  });
});
