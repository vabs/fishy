import { createRng } from "./rng";
import type { Stats } from "./stats";

/** Weather shared by the simulation, renderer and round announcements. */
export type SeaState = "clear" | "storm" | "fog" | "bloom";

/** Sea-state timing, movement and rewards. */
export const SEA = {
  fromRound: 6, chance: 0.35, endlessEvery: 150, endlessLength: 60,
  stormBase: 22, stormGust: 45, stormSpring: 0.6, stormValue: 1.2, fogValue: 1.15,
  bloomSpawn: 1.25, bloomSpeed: 0.75, bloomHp: 1.5,
} as const;

/**
 * Stable weather from the save's creation stamp and round, using the bounty board's FNV hash.
 * A frenzy round resets the lookback at least every fifth round, bounding recursion to four.
 */
export function seaStateFor(createdAt: string, round: number, final = false): SeaState {
  if (final || !Number.isInteger(round) || round < SEA.fromRound || round % 5 === 0) return "clear";
  let seed = 2166136261;
  for (const char of `${createdAt}:${round}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const rng = createRng(seed);
  if (rng() >= SEA.chance) return "clear";
  const previous = seaStateFor(createdAt, round - 1);
  const choices = (["storm", "fog", "bloom"] as const).filter(state => state !== previous);
  return choices[Math.floor(rng() * choices.length)]!;
}

/** Opacity of a fog silhouette, fully visible in the clear pool and never invisible outside it. */
export function fogAlpha(distance: number, clearRadius: number): number {
  return Math.max(0.15, Math.min(1, 1 - (distance - clearRadius) / 160));
}

/** The larger clear pool supplied by the boat's lantern or the moving net. */
export function fogClearRadius(stats: Stats): number {
  return Math.max(90 + stats.boat.lanternRadius, stats.netRadius * 2.5);
}

/** Short weather name for badges and summaries. */
export function seaLabel(state: SeaState): string {
  return { clear: "Clear", storm: "Storm", fog: "Fog", bloom: "Algal Bloom" }[state];
}

/** Round-start banner copy; clear weather needs no announcement. */
export function seaBlurb(state: SeaState): string {
  return { clear: "", storm: "Storm · catches ×1.2", fog: "Fog · catches ×1.15",
    bloom: "Algal Bloom · more fish, tougher" }[state];
}
