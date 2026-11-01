import type { FishKind } from "./fish";

export interface FishStats {
  /** Fish of this type spawned per second, before multipliers. 0 means it never spawns (still locked). */
  rate: number;
  /** Multiplier on this type's spawn rate. */
  rateMult: number;
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
    /** Projectiles launched per captured Star: the Star itself, then smaller shards. */
    count: number;
  };
}

/**
 * Trap nets: cast at random spots in the fishing area (never the corners) at the start of every
 * round. An armed net snaps when a fish swims over it, then needs `resetSeconds` to re-arm.
 */
export interface RiggingStats {
  /** Trap nets cast each round. 0 until the Rigging lane is unlocked. */
  count: number;
  /** Seconds a net needs to re-arm after it snaps. */
  resetSeconds: number;
  /** Net radius, px. */
  radius: number;
  /** Damage each snap deals to every fish it hits. */
  damage: number;
  /** Most fish one snap can hit. Infinity hits every fish inside. */
  haul: number;
  /** Nets 1–2 and 3–4 are joined by a rope that hits fish crossing it. */
  seine: boolean;
  /** Damage the seine rope deals to a fish crossing it. */
  seineDamage: number;
  /** Pull towards each armed net on fish within `baitRange`, px/s. 0 means no bait. */
  baitPull: number;
  /** px */
  baitRange: number;
  /** A net catches the treasure chest and holds it this long, s. 0 means nets don't snag. */
  snagSeconds: number;
  /** Multiplier on reset time while a Feeding Frenzy runs (0.5 is twice as fast). 1 is off. */
  frenzyResetMult: number;
}

/** The boat's own tools. */
export interface BoatStats {
  /** Chum can be thrown (Space or the HUD button). */
  chum: boolean;
  /** Seconds between chum throws. */
  chumCooldown: number;
  /** Seconds the chum keeps pulling fish in. */
  chumSeconds: number;
  /** Fish within this distance of the boat drift towards it while chum is in the water, px. */
  chumRadius: number;
  /** px/s */
  chumPull: number;
  /** Fish within this distance of the boat swim slower, px. 0 means no lantern. */
  lanternRadius: number;
  /** Speed multiplier for fish in the lantern's light (0.7 is 30% slower). */
  lanternSlow: number;
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

  /** Multiplier on every type's spawn rate. */
  spawnRateMult: number;
  /** Fish already in the water when the round starts. */
  startFish: number;
  /** Chance, 0 to 1, that a capture spawns another fish of the same type. */
  twinChance: number;

  /** Multiplier on the value of every fish. */
  valueMult: number;
  /**
   * Extra value multiplier for fish caught by an ability (Electric current, Epic net, Star shot,
   * Whirlpool) rather than the net. Late in a game the net catches nearly everything anyway, so
   * without this, abilities would just re-catch fish and earn nothing extra.
   */
  abilityValueMult: number;
  /** Captures within this many seconds of each other build a combo. 0 turns combos off. */
  comboWindow: number;
  /** Value multiplier added per capture in a combo. */
  comboStep: number;
  /** Highest combo multiplier. */
  comboMax: number;

  /** Length of the Feeding Frenzy wave, s. It comes in every fifth round and in the Final Round. */
  frenzySeconds: number;
  /** Multiplier on every type's spawn rate while the Feeding Frenzy wave runs. */
  frenzySpawnMult: number;
  /** Value multiplier for fish caught while the Feeding Frenzy wave runs. */
  frenzyValueMult: number;
  /**
   * Golden fish per second of round time, from round 2. They arrive on their own clock, not as a
   * share of spawns, so late-game spawn volume doesn't flood the sea with them.
   */
  goldenRate: number;
  /** Value multiplier for a golden fish, on top of its type's value and every other multiplier. */
  goldenValueMult: number;
  /** Seconds a golden fish stays before it dives away. */
  goldenSeconds: number;
  /** Chance, 0 to 1, that a round from round 3 on has a treasure chest. The Final Round always has one. */
  chestChance: number;

  fish: Record<FishKind, FishStats>;
  ability: Abilities;
  rigging: RiggingStats;
  boat: BoatStats;
}

const locked: FishStats = { rate: 0, rateMult: 1, valueMult: 1 };

export const BASE_STATS: Stats = {
  roundSeconds: 15,
  timeBonusChance: 0,
  timeBonusSeconds: 0.5,

  tickSeconds: 0.5,
  netRadius: 40,
  netDamage: 1,
  critChance: 0,
  critMult: 2,

  spawnRateMult: 1,
  startFish: 10,
  twinChance: 0,

  valueMult: 1,
  abilityValueMult: 1.5,
  comboWindow: 0,
  comboStep: 0.1,
  comboMax: 2,

  frenzySeconds: 5,
  frenzySpawnMult: 3,
  frenzyValueMult: 1.5,
  goldenRate: 0.06,
  goldenValueMult: 10,
  goldenSeconds: 8,
  chestChance: 0.3,

  fish: {
    normal: { rate: 1.25, rateMult: 1, valueMult: 1 },
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
    rare: { armor: 0.5, pierce: false },
    electric: { jumps: 2, damage: 1, range: 120 },
    epic: { chance: 0.25, range: 90 },
    goober: { tier: 0, count: 2 },
    monster: { pullRadius: 140, pullStrength: 40 },
    star: { bounces: 3, damage: 3, speed: 500, radius: 14, count: 1 },
  },

  rigging: {
    count: 0,
    resetSeconds: 5,
    radius: 34,
    damage: 1,
    haul: 1,
    seine: false,
    seineDamage: 1,
    baitPull: 0,
    baitRange: 110,
    snagSeconds: 0,
    frenzyResetMult: 1,
  },
  boat: {
    chum: false,
    chumCooldown: 20,
    chumSeconds: 4,
    chumRadius: 220,
    chumPull: 60,
    lanternRadius: 0,
    lanternSlow: 0.7,
  },
};

/** Fish of `kind` spawned per second, with every multiplier applied. */
export function spawnRate(stats: Stats, kind: FishKind): number {
  const fish = stats.fish[kind];
  return fish.rate * fish.rateMult * stats.spawnRateMult;
}

/** Deep copy, so upgrades and tests can change stats without touching BASE_STATS. */
export function cloneStats(stats: Stats): Stats {
  return structuredClone(stats);
}
