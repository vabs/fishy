import type { FishKind } from "./fish";

export interface FishStats {
  /** Relative chance of this type spawning. 0 means it never spawns (still locked). */
  weight: number;
  valueMult: number;
}

/** Abilities of each fish type that upgrades can change. Read by that type's spec. */
export interface Abilities {
  uncommon: {
    schoolMin: number;
    schoolMax: number;
  };
  rare: {
    /** Flat damage removed from every hit. */
    armor: number;
    /** First hit on a Rare fish deals double damage. */
    pierce: boolean;
  };
  electric: {
    jumps: number;
    damage: number;
    /** px */
    range: number;
  };
  epic: {
    /** Chance, 0 to 1, for each fish in range to be captured. */
    chance: number;
    /** px */
    range: number;
  };
  goober: {
    /** Index into the Goober tier ladder: 0 Normal, 1 Uncommon, 2 Rare, 3 Electric, 4 Epic. */
    tier: number;
    count: number;
  };
  monster: {
    /** Vortex radius, px. Fish inside are pulled in, and captured when the Monster is. */
    pullRadius: number;
    /** px/s */
    pullStrength: number;
  };
  star: {
    bounces: number;
    damage: number;
    /** px/s */
    speed: number;
    /** Hit radius, px. */
    radius: number;
    /** Projectiles launched per captured Star. */
    count: number;
  };
}

/** Everything about a round that upgrades can change. The sim reads only this. */
export interface Stats {
  roundSeconds: number;
  /** Chance, 0 to 1, that a capture adds time to the round. */
  timeBonusChance: number;
  timeBonusSeconds: number;

  /** Time between net ticks. */
  tickSeconds: number;
  /** Net radius, px. */
  netRadius: number;
  netDamage: number;
  /** Chance, 0 to 1, that a net hit is critical. */
  critChance: number;
  critMult: number;

  /** Time between spawns. */
  spawnSeconds: number;
  maxFish: number;
  /** Fish already in the water when the round starts. */
  startFish: number;
  /** Chance, 0 to 1, that a capture spawns another fish of the same type. */
  twinChance: number;

  /** Multiplier on the value of every fish. */
  valueMult: number;
  /** Captures within this many seconds of each other build a combo. 0 turns combos off. */
  comboWindow: number;
  /** Value multiplier added per capture in a combo. */
  comboStep: number;
  /** Highest combo multiplier. */
  comboMax: number;

  fish: Record<FishKind, FishStats>;
  ability: Abilities;
}

const locked: FishStats = { weight: 0, valueMult: 1 };

export const BASE_STATS: Stats = {
  roundSeconds: 15,
  timeBonusChance: 0,
  timeBonusSeconds: 0.5,

  tickSeconds: 0.5,
  netRadius: 40,
  netDamage: 1,
  critChance: 0,
  critMult: 2,

  spawnSeconds: 0.8,
  maxFish: 25,
  startFish: 10,
  twinChance: 0,

  valueMult: 1,
  comboWindow: 0,
  comboStep: 0.1,
  comboMax: 2,

  fish: {
    normal: { weight: 1, valueMult: 1 },
    uncommon: { ...locked },
    rare: { ...locked },
    electric: { ...locked },
    epic: { ...locked },
    goober: { ...locked },
    monster: { ...locked },
    star: { ...locked },
  },

  ability: {
    uncommon: { schoolMin: 3, schoolMax: 5 },
    rare: { armor: 1, pierce: false },
    electric: { jumps: 2, damage: 1, range: 120 },
    epic: { chance: 0.25, range: 90 },
    goober: { tier: 0, count: 3 },
    monster: { pullRadius: 140, pullStrength: 40 },
    star: { bounces: 3, damage: 2, speed: 500, radius: 14, count: 1 },
  },
};

/** Deep copy, so upgrades and tests can change stats without touching BASE_STATS. */
export function cloneStats(stats: Stats): Stats {
  return structuredClone(stats);
}
