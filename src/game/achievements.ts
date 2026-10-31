import type { SaveData } from "../save";
import { BASE_STATS } from "./stats";
import { applyUpgrades } from "./tech/tree";

/** Stable badge metadata used by the logbook and achievement toast. */
export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
}

/** Shipped ids are permanent, including the combo ids whose numbers are not their thresholds. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "first-normal", name: "Hooked", description: "Catch your first Normal fish", icon: "fish:normal" },
  { id: "first-uncommon", name: "School's In", description: "Catch an Uncommon fish", icon: "fish:uncommon" },
  { id: "first-rare", name: "Armour Piercer", description: "Catch a Rare fish", icon: "fish:rare" },
  { id: "first-electric", name: "Shocking", description: "Catch an Electric fish", icon: "fish:electric" },
  { id: "first-epic", name: "Epic Haul", description: "Catch an Epic fish", icon: "fish:epic" },
  { id: "first-goober", name: "Goober Pop", description: "Catch a Goober", icon: "fish:goober" },
  { id: "first-monster", name: "Eye of the Storm", description: "Catch a Monster", icon: "fish:monster" },
  { id: "first-star", name: "Shooting Star", description: "Catch a Star", icon: "fish:star" },
  { id: "fish-1k", name: "Deckhand", description: "Catch 1,000 fish", icon: "net" },
  { id: "fish-10k", name: "Bosun", description: "Catch 10,000 fish", icon: "net" },
  { id: "fish-50k", name: "Old Salt", description: "Catch 50,000 fish", icon: "anchor" },
  { id: "combo-2", name: "On a Roll", description: "Reach a ×1.5 combo", icon: "combo" },
  { id: "combo-3", name: "Unstoppable", description: "Reach the highest combo your net allows, ×2 or more", icon: "combo" },
  { id: "haul-10", name: "Full Net", description: "Catch 10 fish in one sweep", icon: "net" },
  { id: "star-10", name: "Star Struck", description: "Hit 10 fish with one Star", icon: "star" },
  { id: "golden-50", name: "Gold Fever", description: "Catch 50 golden fish", icon: "gold" },
  { id: "chests-10", name: "Treasure Hunter", description: "Open 10 treasure chests", icon: "chest" },
  { id: "bounty-perfect", name: "Clean Sweep", description: "Complete every bounty in a round", icon: "scroll" },
  { id: "bounties-25", name: "Bounty Hunter", description: "Complete 25 bounties", icon: "scroll" },
  { id: "final", name: "Master of the Sea", description: "Finish the Final Round", icon: "crown" },
  { id: "endless-10", name: "Lost at Sea", description: "Spend 10 minutes in one Endless session", icon: "clock" },
  { id: "endless-30", name: "Sea Legs", description: "Spend 30 minutes in one Endless session", icon: "wave" },
];

/** Optional live-session facts available before its save is recorded. */
export interface AchievementMoment {
  endlessSessionMs?: number;
  allBounties?: boolean;
}

/** Qualifying badges not already granted; old saves receive fish and Final Round badges too. */
export function newAchievements(save: SaveData, moment: AchievementMoment = {}): Achievement[] {
  const stats = save.stats;
  const comboCap = Math.max(2, applyUpgrades(BASE_STATS, save.upgrades).comboMax);
  const endlessMs = Math.max(save.endless.longestMs, moment.endlessSessionMs ?? 0);
  const qualified: Record<string, boolean> = {
    "fish-1k": stats.totalFish >= 1000,
    "fish-10k": stats.totalFish >= 10000,
    "fish-50k": stats.totalFish >= 50000,
    "combo-2": stats.bestCombo + 1e-9 >= 1.5,
    "combo-3": stats.bestCombo + 1e-9 >= comboCap,
    "haul-10": stats.bestTickCatches >= 10,
    "star-10": stats.bestStarHits >= 10,
    "golden-50": stats.goldenCaught >= 50,
    "chests-10": stats.chestsOpened >= 10,
    "bounty-perfect": stats.perfectBountyRounds > 0 || moment.allBounties === true,
    "bounties-25": stats.bountiesCompleted >= 25,
    final: save.finalRoundDone,
    "endless-10": endlessMs >= 10 * 60 * 1000,
    "endless-30": endlessMs >= 30 * 60 * 1000,
  };
  return ACHIEVEMENTS.filter((achievement) => {
    if (Object.hasOwn(save.achievements, achievement.id)) return false;
    if (achievement.id.startsWith("first-")) return (stats.fishByType[achievement.id.slice(6)] ?? 0) > 0;
    return qualified[achievement.id] === true;
  });
}

/** Adds badge timestamps once, preserving unknown ids and every previously earned time. */
export function grantAchievements(save: SaveData, ids: readonly string[], now = new Date()): SaveData {
  const achievements = new Map(Object.entries(save.achievements));
  const time = now.toISOString();
  for (const id of ids) if (!achievements.has(id)) achievements.set(id, time);
  return { ...save, achievements: Object.fromEntries(achievements) };
}
