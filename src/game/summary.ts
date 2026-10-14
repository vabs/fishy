import { wholeShares } from "../format";
import { FISH_KINDS, type FishKind } from "./fish";
import type { BonusKind, World } from "./world";

/** A row of the round summary: a fish type, or a bonus such as golden fish. */
export interface SummaryRow {
  key: FishKind | BonusKind;
  count: number;
  /** Whole dollars. */
  earned: number;
}

type RoundTallies = Pick<World, "earned" | "caughtBy" | "earnedBy" | "bonusCount" | "bonusEarned">;

/**
 * The round summary's rows, most money first. Fish types come from `caughtBy`/`earnedBy`, bonuses
 * from `bonusCount`/`bonusEarned`; amounts are whole-dollar shares that add up to the round's total.
 */
export function summaryRows(world: RoundTallies): SummaryRow[] {
  const bonuses = Object.keys(world.bonusCount) as BonusKind[];
  const rows = [
    ...FISH_KINDS.filter((kind) => world.caughtBy[kind]).map((kind) => ({
      key: kind,
      count: world.caughtBy[kind] ?? 0,
      money: world.earnedBy[kind] ?? 0,
    })),
    ...bonuses.filter((bonus) => world.bonusCount[bonus] > 0).map((bonus) => ({
      key: bonus,
      count: world.bonusCount[bonus],
      money: world.bonusEarned[bonus],
    })),
  ].sort((a, b) => b.money - a.money);
  const shares = wholeShares(rows.map((row) => row.money), world.earned);
  return rows.map((row, i) => ({ key: row.key, count: row.count, earned: shares[i] ?? 0 }));
}
