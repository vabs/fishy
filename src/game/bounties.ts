import { formatMoney } from "../format";
import { CHEST } from "./chest";
import { FISH, FISH_KINDS, type FishKind } from "./fish";
import { GOLDEN } from "./golden";
import type { Rng } from "./rng";
import { spawnRate, type Stats } from "./stats";
import { isFrenzyRound } from "./world";

/** Stable bounty kinds stored in save files. */
export type BountyKind = "catch" | "combo" | "golden" | "chest" | "haul" | "earn" | "frenzy";

/** One optional challenge and its extra payout. */
export interface Bounty {
  id: string;
  kind: BountyKind;
  fish?: FishKind;
  target: number;
  reward: number;
}

/** Round totals used to evaluate challenges without changing the simulation. */
export interface BountyFacts {
  caught: Partial<Record<FishKind, number>>;
  maxComboMult: number;
  goldenCaught: number;
  chestsOpened: number;
  bestTickCatches: number;
  earned: number;
  frenzyCaught: number;
}

/** The first round to offer a bounty board. */
export const BOUNTIES_FROM_ROUND = 2;

/** Rolls an achievable board using only the supplied random stream and current round stats. */
export function rollBounties(input: {
  round: number;
  final: boolean;
  upgrades: Readonly<Record<string, number>>;
  stats: Stats;
  recentEarnings: number;
  rng: Rng;
}): Bounty[] {
  const { round, final, stats, recentEarnings, rng } = input;
  if (round < BOUNTIES_FROM_ROUND || final) return [];

  const candidates: { kind: BountyKind; fish?: FishKind }[] = [];
  const unlocked = FISH_KINDS.filter((kind) => spawnRate(stats, kind) > 0);
  const totalRate = unlocked.reduce((sum, kind) => sum + spawnRate(stats, kind), 0);
  for (const fish of unlocked) candidates.push({ kind: "catch", fish });
  if (stats.comboWindow > 0 && stats.comboMax > 1.1 && stats.comboMax >= 1.2) candidates.push({ kind: "combo" });
  candidates.push({ kind: "haul" });
  if (recentEarnings > 0) candidates.push({ kind: "earn" });
  if (round >= GOLDEN.fromRound && stats.goldenRate > 0) candidates.push({ kind: "golden" });
  if (round >= CHEST.fromRound) candidates.push({ kind: "chest" });
  if (isFrenzyRound({ round, final })) candidates.push({ kind: "frenzy" });

  const list: Bounty[] = [];
  while (list.length < (round >= 8 ? 3 : 2) && candidates.length > 0) {
    const selected = candidates.splice(Math.floor(rng() * candidates.length), 1)[0]!;
    const { kind, fish } = selected;
    // Two different fish challenges can share a board; every other kind appears at most once.
    if (kind === "catch" && list.some((b) => b.kind === "catch")) {
      for (let i = candidates.length - 1; i >= 0; i--) {
        if (candidates[i]!.kind === "catch") candidates.splice(i, 1);
      }
    }
    const focus = rng();
    let target: number;
    let difficulty: number;
    switch (kind) {
      case "catch": {
        const rate = spawnRate(stats, fish!);
        const expected = rate * stats.roundSeconds + stats.startFish * rate / totalRate;
        target = Math.max(1, Math.round(expected * (0.35 + focus * 0.25)));
        difficulty = 0.15 + focus * 0.1;
        break;
      }
      case "combo": {
        const maxSteps = Math.floor((stats.comboMax + 1e-9) * 10) - 12;
        // Early boards favour the lower end; later boards can ask for the full cap.
        const step = Math.floor((round < 8 ? focus * focus : focus) * (maxSteps + 1));
        target = (12 + step) / 10;
        difficulty = 0.18 + 0.1 * step / Math.max(1, maxSteps);
        break;
      }
      case "haul": {
        const density = totalRate + stats.startFish / Math.max(1, stats.roundSeconds);
        const ceiling = Math.min(12, Math.max(4, Math.round(4 + Math.log2(Math.max(1, stats.netRadius / 40)) * 2 + Math.log2(Math.max(1, density / 2)))));
        target = 4 + Math.floor(focus * (ceiling - 3));
        difficulty = 0.2 + (target - 4) / 8 * 0.09;
        break;
      }
      case "earn":
        target = Math.max(1, Math.round(recentEarnings * (1.1 + focus * 0.2)));
        difficulty = 0.24 + focus * 0.06;
        break;
      case "golden":
        target = 1;
        difficulty = 0.28;
        break;
      case "chest":
        target = 1;
        difficulty = 0.3;
        break;
      case "frenzy":
        target = Math.max(1, Math.round(totalRate * stats.frenzySeconds * stats.frenzySpawnMult * (0.35 + focus * 0.2)));
        difficulty = 0.25 + focus * 0.05;
        break;
    }
    list.push({
      id: `bounty-${round}-${kind}${fish ? `-${fish}` : ""}`,
      ...selected,
      target,
      reward: Number((Math.max(20, recentEarnings) * difficulty).toPrecision(2)),
    });
  }
  return list;
}

/** Current progress, retaining the actual value even after the target is exceeded. */
export function bountyProgress(b: Bounty, facts: BountyFacts): { value: number; target: number; done: boolean } {
  let value: number;
  const target = b.kind === "golden" || b.kind === "chest" ? 1 : b.target;
  switch (b.kind) {
    case "catch": value = b.fish ? facts.caught[b.fish] ?? 0 : 0; break;
    case "combo": value = facts.maxComboMult; break;
    case "golden": value = facts.goldenCaught; break;
    case "chest": value = facts.chestsOpened; break;
    case "haul": value = facts.bestTickCatches; break;
    case "earn": value = facts.earned; break;
    case "frenzy": value = facts.frenzyCaught; break;
  }
  return { value, target, done: value + (b.kind === "combo" ? 1e-9 : 0) >= target };
}

/** Short, plain-English challenge text for the hub, HUD and summary. */
export function bountyLabel(b: Bounty): string {
  switch (b.kind) {
    case "catch": return `Catch ${b.target} ${b.fish ? FISH[b.fish].name : ""} fish`;
    case "combo": return `Reach combo ×${b.target.toFixed(1)}`;
    case "golden": return "Catch a golden fish";
    case "chest": return "Open the treasure chest";
    case "haul": return `Net ${b.target} fish in one sweep`;
    case "earn": return `Earn ${formatMoney(b.target)}`;
    case "frenzy": return `Catch ${b.target} fish in the Feeding Frenzy`;
  }
}

/** Events the world must arrange so every offered challenge is possible. */
export function bountyGuarantees(list: readonly Bounty[]): { chest?: boolean; golden?: boolean } {
  return {
    ...(list.some((b) => b.kind === "chest") ? { chest: true } : {}),
    ...(list.some((b) => b.kind === "golden") ? { golden: true } : {}),
  };
}
