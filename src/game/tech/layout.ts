import { FISH, type FishKind } from "../fish";
import type { Branch, TechNode } from "./tree";
import { TECH_NODES } from "./nodes";

/*
 * Radial layout for the tech tree screen, computed from the node graph so new nodes need no
 * placing by hand. The root sits in the centre on the boat. Every other node belongs to a lane: a
 * wedge of the circle for its branch, or for its fish type. A node's ring is its depth within its
 * lane, so each lane's first nodes form an inner ring around the boat and the lane grows outwards.
 * Lanes get just enough angle for their busiest ring, and the rings are pushed out until all the
 * lanes fit around the circle. Nodes need more room stacked vertically than side by side, so a lane
 * pointing sideways needs more angle than one pointing up or down.
 */

export type LaneKey = Exclude<Branch, "fish" | "star"> | FishKind;

/** Clockwise from the top. Neighbours share requirements, so cross-lane edges stay short. */
export const LANE_ORDER: readonly LaneKey[] = [
  "net",
  "time",
  "spawning",
  "economy",
  "normal",
  "uncommon",
  "rare",
  "electric",
  "epic",
  "goober",
  "monster",
  "star",
];

const LANE_LABELS: Record<LaneKey, string> = {
  net: "Net",
  time: "Time",
  spawning: "Spawning",
  economy: "Economy",
  ...(Object.fromEntries(Object.entries(FISH).map(([kind, def]) => [kind, def.name])) as Record<FishKind, string>),
};

export interface LayoutOptions {
  /**
   * Room each node needs, px: the width and height of an ellipse that neighbouring node centres
   * stay outside. Taller than wide, because a node's price label hangs below it.
   */
  spacing: { x: number; y: number };
  /** Gap between rings, px. */
  ringGap: number;
  /** Smallest radius of the first ring, px. Grows until every lane fits. */
  minInnerRadius: number;
  /** Empty angle kept at each side of a lane, in node gaps at the inner ring. */
  lanePadding: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  spacing: { x: 84, y: 108 },
  ringGap: 108,
  minInnerRadius: 170,
  lanePadding: 0.15,
};

export interface Lane {
  key: LaneKey;
  label: string;
  /** Angles in radians, clockwise from +x (screen coordinates, y down). */
  start: number;
  end: number;
  center: number;
}

export interface PlacedNode {
  x: number;
  y: number;
  /** Null for the root. */
  lane: LaneKey | null;
  /** Ring within the lane; -1 for the root. */
  depth: number;
}

export interface TreeLayout {
  nodes: Map<string, PlacedNode>;
  lanes: Lane[];
  /** Radius of each ring, px. */
  rings: number[];
  /** Distance from the centre to the farthest node centre, px. */
  extent: number;
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]): number => sum(values) / values.length;

export function laneOf(node: TechNode): LaneKey {
  if (node.fish) return node.fish;
  if (node.branch === "fish" || node.branch === "star") throw new Error(`${node.id} needs a fish`);
  return node.branch;
}

export function layoutTree(nodes: readonly TechNode[] = TECH_NODES, options: LayoutOptions = DEFAULT_LAYOUT): TreeLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = nodes.filter((n) => n.requires.length === 0);
  const rootIds = new Set(roots.map((n) => n.id));
  const laned = nodes.filter((n) => !rootIds.has(n.id));

  // Depth within the lane: 0 when nothing the node needs is in its own lane.
  const depths = new Map<string, number>();
  const depthOf = (node: TechNode): number => {
    const known = depths.get(node.id);
    if (known !== undefined) return known;
    const lane = laneOf(node);
    let depth = 0;
    for (const id of node.requires) {
      const parent = byId.get(id);
      if (parent && !rootIds.has(id) && laneOf(parent) === lane) depth = Math.max(depth, depthOf(parent) + 1);
    }
    depths.set(node.id, depth);
    return depth;
  };

  // Nodes per lane and ring, in definition order.
  const grid = new Map<LaneKey, TechNode[][]>();
  for (const node of laned) {
    const lane = laneOf(node);
    const rings = grid.get(lane) ?? [];
    (rings[depthOf(node)] ??= []).push(node);
    grid.set(lane, rings);
  }
  const lanes = LANE_ORDER.filter((key) => grid.has(key));
  for (const key of grid.keys()) if (!lanes.includes(key)) throw new Error(`Lane ${key} is missing from LANE_ORDER`);
  const ringCount = Math.max(1, ...[...grid.values()].map((rings) => rings.length));

  const radiusAt = (inner: number, depth: number): number => inner + depth * options.ringGap;
  /** Angle between neighbours on a ring of this radius, around the given angle. */
  const gapAt = (radius: number, at: number): number => {
    // Neighbours on a ring are apart along the tangent; that's how far it is to the ellipse's edge.
    const distance = 1 / Math.hypot(Math.sin(at) / options.spacing.x, Math.cos(at) / options.spacing.y);
    return 2 * Math.asin(Math.min(1, distance / (2 * radius)));
  };
  // Angle each lane needs: enough for its busiest ring, plus padding.
  const needs = (inner: number, centres: number[]): number[] =>
    lanes.map((key, i) => {
      const at = centres[i] ?? 0;
      const rings = grid.get(key) ?? [];
      const widest = Math.max(...rings.map((ring, depth) => (ring?.length ?? 0) * gapAt(radiusAt(inner, depth), at)));
      return widest + 2 * options.lanePadding * gapAt(inner, at);
    });
  // Lay the lanes clockwise with the first one centred at the top, sharing out the spare angle evenly.
  const arrange = (laneNeeds: number[]): Lane[] => {
    const spare = (Math.PI * 2 - sum(laneNeeds)) / lanes.length;
    let angle = -Math.PI / 2 - ((laneNeeds[0] ?? 0) + spare) / 2;
    return lanes.map((key, i) => {
      const width = (laneNeeds[i] ?? 0) + spare;
      const lane = { key, label: LANE_LABELS[key], start: angle, end: angle + width, center: angle + width / 2 };
      angle += width;
      return lane;
    });
  };

  // What a lane needs depends on where it points, and where it points depends on what the lanes
  // before it need, so settle both together. A few rounds is plenty.
  let centres = lanes.map((_, i) => -Math.PI / 2 + (i * Math.PI * 2) / lanes.length);
  let inner = options.minInnerRadius;
  let laneInfo: Lane[] = [];
  for (let round = 0; round < 4; round++) {
    inner = options.minInnerRadius;
    while (sum(needs(inner, centres)) > Math.PI * 2) inner += 5;
    laneInfo = arrange(needs(inner, centres));
    centres = laneInfo.map((lane) => lane.center);
  }
  // The last round moved the lanes a little; make sure they still fit where they ended up.
  while (sum(needs(inner, centres)) > Math.PI * 2) inner += 5;
  laneInfo = arrange(needs(inner, centres));

  const placed = new Map<string, PlacedNode>();
  const angles = new Map<string, number>();
  for (const root of roots) placed.set(root.id, { x: 0, y: 0, lane: null, depth: -1 });

  // Which way each node is pulled by the nodes in other lanes that need it: -1 anticlockwise, +1 clockwise.
  const laneIndex = new Map(laneInfo.map((lane, i) => [lane.key, i]));
  const pull = new Map<string, number>();
  for (const node of laned) {
    for (const id of node.requires) {
      const parent = byId.get(id);
      if (!parent || rootIds.has(id) || laneOf(parent) === laneOf(node)) continue;
      const from = laneIndex.get(laneOf(parent)) ?? 0;
      const to = laneIndex.get(laneOf(node)) ?? 0;
      // Shortest way round the circle.
      let step = to - from;
      if (step > lanes.length / 2) step -= lanes.length;
      if (step < -lanes.length / 2) step += lanes.length;
      pull.set(id, (pull.get(id) ?? 0) + Math.sign(step));
    }
  }

  for (const lane of laneInfo) {
    const rings = grid.get(lane.key) ?? [];
    rings.forEach((ring = [], depth) => {
      const radius = radiusAt(inner, depth);
      const gap = gapAt(radius, lane.center);
      // Each node wants to sit at the average angle of the nodes it needs in its own lane.
      const wanted = ring.map((node, order) => {
        const own = node.requires.flatMap((id) => {
          const parent = byId.get(id);
          const a = angles.get(id);
          return parent && laneOf(parent) === lane.key && a !== undefined ? [a] : [];
        });
        return { node, ideal: own.length > 0 ? mean(own) : lane.center, pull: pull.get(node.id) ?? 0, order };
      });
      wanted.sort((a, b) => a.ideal - b.ideal || a.pull - b.pull || a.order - b.order);

      // Pack in order at least one gap apart, centre the group on the ideals, keep it in the lane.
      const packed: number[] = [];
      for (const [i, w] of wanted.entries()) packed.push(i === 0 ? w.ideal : Math.max(w.ideal, (packed[i - 1] ?? 0) + gap));
      let shift = mean(wanted.map((w) => w.ideal)) - mean(packed);
      const lo = lane.start + gap / 2;
      const hi = lane.end - gap / 2;
      const first = (packed[0] ?? 0) + shift;
      const last = (packed[packed.length - 1] ?? 0) + shift;
      if (first < lo) shift += lo - first;
      else if (last > hi) shift -= last - hi;

      wanted.forEach((w, i) => {
        const a = (packed[i] ?? 0) + shift;
        angles.set(w.node.id, a);
        placed.set(w.node.id, { x: Math.cos(a) * radius, y: Math.sin(a) * radius, lane: lane.key, depth });
      });
    });
  }

  const rings = Array.from({ length: ringCount }, (_, depth) => radiusAt(inner, depth));
  const extent = Math.max(0, ...[...placed.values()].map((p) => Math.hypot(p.x, p.y)));
  return { nodes: placed, lanes: laneInfo, rings, extent };
}
