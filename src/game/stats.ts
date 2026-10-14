import type { FishKind } from "./fish";

/** Everything about a round that upgrades can change. The sim reads only this. */
export interface Stats {
  roundSeconds: number;
  /** Time between net ticks. */
  tickSeconds: number;
  /** Net radius, px. */
  netRadius: number;
  netDamage: number;
  /** Time between spawns. */
  spawnSeconds: number;
  maxFish: number;
  /** Fish already in the water when the round starts. */
  startFish: number;
  /** Relative chance of each type spawning. Types missing or at 0 never spawn. */
  spawnWeights: Partial<Record<FishKind, number>>;
  valueMult: number;
}

export const BASE_STATS: Stats = {
  roundSeconds: 15,
  tickSeconds: 0.5,
  netRadius: 40,
  netDamage: 1,
  spawnSeconds: 0.8,
  maxFish: 25,
  startFish: 10,
  spawnWeights: { normal: 1 },
  valueMult: 1,
};
