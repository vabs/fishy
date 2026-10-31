import { bountyLabel, bountyProgress, rollBounties, type Bounty, type BountyFacts } from "../game/bounties";
import { createRng } from "../game/rng";
import { BASE_STATS } from "../game/stats";
import { applyUpgrades, isTreeComplete } from "../game/tech";
import type { World } from "../game/world";
import { setBounties, type SaveData } from "../save";
import type { BountyItem } from "../ui/bounties-view";

/** The simulation's lifetime-in-this-round facts, including bonus catches. */
export function bountyFacts(world: World): BountyFacts {
  return { caught: world.caught, maxComboMult: world.maxComboMult,
    goldenCaught: world.bonusCount.golden, chestsOpened: world.bonusCount.treasure,
    bestTickCatches: world.bestTickCatches, earned: world.earned, frenzyCaught: world.frenzyCaught };
}

/** Keeps a board stable across reloads and purchases, except when the Final Round unlocks. */
export function bountyBoard(save: SaveData): SaveData {
  const final = isTreeComplete(save.upgrades);
  const suppressed = save.round < 2 || final;
  const recentEarnings = save.stats.lastRoundEarnings || save.stats.bestRoundEarnings;
  const existing = save.bounties?.round === save.round ? save.bounties.list : null;
  if (existing && suppressed && existing.length === 0) return save;
  let seed = 2166136261;
  for (const char of `${save.createdAt}:${save.round}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const stats = applyUpgrades(BASE_STATS, save.upgrades);
  const roll = (estimate: number): Bounty[] => rollBounties({ round: save.round, final,
    upgrades: save.upgrades, stats, recentEarnings: estimate, rng: createRng(seed) });
  if (existing && !suppressed) {
    if (!recentEarnings) return save;
    // Old boards have no estimate stamp. Match the deterministic zero roll, or its $6 reward
    // ceiling (20 × .3) if purchases have since changed the candidates/targets.
    const zeroRoll = JSON.stringify(roll(0));
    const zeroBudget = recentEarnings > 40 && existing.length > 0 &&
      existing.every((b) => b.reward <= 6 && b.kind !== "earn");
    if (JSON.stringify(existing) !== zeroRoll && !zeroBudget) return save;
  }
  const list = roll(recentEarnings);
  // Small estimates can produce the same board as zero; don't rewrite an identical board.
  if (existing && JSON.stringify(existing) === JSON.stringify(list)) return save;
  return setBounties(save, { round: save.round, list });
}

/** Presentation and payout derived from the same completed flags, so rewards cannot diverge. */
export function bountyResult(list: readonly Bounty[], facts: BountyFacts): {
  items: BountyItem[]; reward: number; completed: number; all: boolean;
} {
  const items = list.map((b) => {
    const progress = bountyProgress(b, facts);
    return { label: bountyLabel(b), ...progress, reward: b.reward, failed: !progress.done };
  });
  const done = items.filter((b) => b.done);
  return { items, reward: done.reduce((sum, b) => sum + b.reward, 0), completed: done.length,
    all: items.length > 0 && done.length === items.length };
}
