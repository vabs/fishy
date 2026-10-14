import type { FishKind } from "../fish";
import { cloneStats, type Stats } from "../stats";
import { TECH_NODES } from "./nodes";

export type Branch = "net" | "time" | "economy" | "spawning" | "fish" | "star";

export interface TechNode {
  /** Stable: saved in players' save files. Never rename once shipped. */
  id: string;
  branch: Branch;
  /** Which fish a "fish" branch node belongs to. Groups the node in the layout and colours it. */
  fish?: FishKind;
  name: string;
  /** What one level does. */
  description: string;
  maxLevel: number;
  /** Cost of the next level is round(base * growth^currentLevel). */
  cost: { base: number; growth: number };
  /** Node ids that must be at level 1 or more before this node is visible or buyable. */
  requires: string[];
  /** Applies `level` levels (1 or more) to a cloned Stats. Should be order-independent across nodes. */
  apply(stats: Stats, level: number): void;
}

/** Owned level per node id. Missing ids are level 0. */
export type Upgrades = Record<string, number>;

export { TECH_NODES };

const NODES_BY_ID = new Map(TECH_NODES.map((node) => [node.id, node]));

export function getNode(id: string): TechNode | undefined {
  return NODES_BY_ID.get(id);
}

/** Owned level of a node, clamped to 0..maxLevel so a hand-edited save can't overshoot. */
export function levelOf(node: TechNode, upgrades: Upgrades): number {
  const level = upgrades[node.id] ?? 0;
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(node.maxLevel, Math.floor(level)));
}

export function applyUpgrades(base: Stats, upgrades: Upgrades): Stats {
  const stats = cloneStats(base);
  for (const node of TECH_NODES) {
    const level = levelOf(node, upgrades);
    if (level > 0) node.apply(stats, level);
  }
  return stats;
}

export function nextCost(node: TechNode, level: number): number {
  return Math.round(node.cost.base * node.cost.growth ** level);
}

export function isVisible(node: TechNode, upgrades: Upgrades): boolean {
  return node.requires.every((id) => (upgrades[id] ?? 0) >= 1);
}

export function isMaxed(node: TechNode, upgrades: Upgrades): boolean {
  return levelOf(node, upgrades) >= node.maxLevel;
}

export function canBuy(node: TechNode, upgrades: Upgrades, money: number): boolean {
  return isVisible(node, upgrades) && !isMaxed(node, upgrades) && money >= nextCost(node, levelOf(node, upgrades));
}

export function buy(upgrades: Upgrades, money: number, nodeId: string): { upgrades: Upgrades; money: number } | null {
  const node = NODES_BY_ID.get(nodeId);
  if (!node || !canBuy(node, upgrades, money)) return null;
  const level = levelOf(node, upgrades);
  return {
    upgrades: { ...upgrades, [nodeId]: level + 1 },
    money: money - nextCost(node, level),
  };
}

export function isTreeComplete(upgrades: Upgrades): boolean {
  return TECH_NODES.every((node) => isMaxed(node, upgrades));
}

/** Money needed to take a node from `from` to max level. */
export function remainingCost(node: TechNode, from = 0): number {
  let total = 0;
  for (let level = from; level < node.maxLevel; level++) total += nextCost(node, level);
  return total;
}

/** Money needed to max every node from scratch. For pacing. */
export function totalTreeCost(nodes: readonly TechNode[] = TECH_NODES): number {
  return nodes.reduce((sum, node) => sum + remainingCost(node), 0);
}
