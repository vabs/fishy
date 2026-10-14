import { TECH_NODES, type TechNode, type Upgrades } from "./tree";

/** Nodes that have been taken out of the game, with what they cost, so owners can be refunded. */
const RETIRED: Record<string, TechNode["cost"]> = {
  // Crowded Waters raised the cap on fish in the water; there is no cap any more.
  "spawn.max": { base: 40, growth: 1.6 },
};

/**
 * Gives money back for levels a save owns that no longer exist: levels above a node's current max
 * (after a node was shortened) and every level of a retired node. Levels are refunded at the cost
 * they have now (or had, for retired nodes). Returns the upgrades without those levels.
 */
export function refundRemovedLevels(upgrades: Readonly<Upgrades>): { upgrades: Upgrades; refund: number } {
  const nodes = new Map(TECH_NODES.map((node) => [node.id, node]));
  const kept: Upgrades = {};
  let refund = 0;
  for (const [id, owned] of Object.entries(upgrades)) {
    const level = Math.max(0, Math.floor(owned));
    const node = nodes.get(id);
    const retired = RETIRED[id];
    const keep = node ? Math.min(level, node.maxLevel) : 0;
    const cost = node?.cost ?? retired;
    if (cost) for (let l = keep; l < level; l++) refund += Math.round(cost.base * cost.growth ** l);
    if (node || !retired) kept[id] = node ? keep : owned;
  }
  return { upgrades: kept, refund };
}
