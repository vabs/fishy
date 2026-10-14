import type { FishKind } from "../fish";
import type { TechNode } from "./tree";

/*
 * Every upgrade in the game. Costs and effects live here so balancing means editing this file only.
 * `apply` must be order-independent: add to a field, or multiply it, but don't mix the two on one
 * field, so the order nodes are applied in never matters.
 * Ids are saved in players' save files: never rename one once it has shipped.
 */

const FISH_NAMES: Record<FishKind, string> = {
  normal: "Normal",
  uncommon: "Uncommon",
  rare: "Rare",
  electric: "Electric",
  epic: "Epic",
  goober: "Goober",
  monster: "Monster",
  star: "Star",
};

function fishBranch(kind: FishKind): Pick<TechNode, "branch" | "fish"> {
  return { branch: kind === "star" ? "star" : "fish", fish: kind };
}

/** Starts a fish type spawning at `rate` fish per second (Normal fish start at 1.25). */
function unlock(kind: FishKind, opts: { name: string; description: string; rate: number; cost: number; requires: string[] }): TechNode {
  return {
    id: `${kind}.unlock`,
    ...fishBranch(kind),
    name: opts.name,
    description: opts.description,
    maxLevel: 1,
    cost: { base: opts.cost, growth: 1 },
    requires: opts.requires,
    apply(stats) {
      stats.fish[kind].rate += opts.rate;
    },
  };
}

/**
 * Makes one fish type spawn more often, without touching any other type. The id keeps its old
 * "weight" name because ids are stored in save files.
 */
function spawnMore(
  kind: FishKind,
  opts: { name: string; per: number; maxLevel: number; cost: TechNode["cost"]; requires: string[] },
): TechNode {
  return {
    id: `${kind}.weight`,
    ...fishBranch(kind),
    name: opts.name,
    description: `${FISH_NAMES[kind]} fish spawn ${Math.round(opts.per * 100)}% more often per level`,
    maxLevel: opts.maxLevel,
    cost: opts.cost,
    requires: opts.requires,
    apply(stats, level) {
      stats.fish[kind].rateMult += opts.per * level;
    },
  };
}

function fishValue(
  kind: FishKind,
  opts: { name: string; per: number; maxLevel: number; cost: TechNode["cost"]; requires: string[] },
): TechNode {
  return {
    id: `${kind}.value`,
    ...fishBranch(kind),
    name: opts.name,
    description: `+${Math.round(opts.per * 100)}% ${FISH_NAMES[kind]} fish value per level`,
    maxLevel: opts.maxLevel,
    cost: opts.cost,
    requires: opts.requires,
    apply(stats, level) {
      stats.fish[kind].valueMult += opts.per * level;
    },
  };
}

export const TECH_NODES: readonly TechNode[] = [
  // Net. The root sits in the centre of the tree; everything grows from it.
  {
    id: "net.radius",
    branch: "net",
    name: "Bigger Net",
    description: "+8 px net radius per level",
    maxLevel: 10,
    cost: { base: 2, growth: 1.6 },
    requires: [],
    apply(stats, level) {
      stats.netRadius += 8 * level;
    },
  },
  {
    id: "net.tick",
    branch: "net",
    name: "Quick Net",
    description: "−0.03 s between net ticks per level",
    maxLevel: 8,
    cost: { base: 6, growth: 1.7 },
    requires: ["net.radius"],
    apply(stats, level) {
      stats.tickSeconds -= 0.03 * level;
    },
  },
  {
    id: "net.damage",
    branch: "net",
    name: "Heavier Net",
    description: "+1 net damage per level",
    maxLevel: 5,
    cost: { base: 34, growth: 3 },
    requires: ["net.radius"],
    apply(stats, level) {
      stats.netDamage += level;
    },
  },
  {
    id: "net.critChance",
    branch: "net",
    name: "Lucky Strike",
    description: "+4% chance that a net hit is critical, per level",
    maxLevel: 10,
    cost: { base: 110, growth: 1.6 },
    requires: ["net.damage"],
    apply(stats, level) {
      stats.critChance += 0.04 * level;
    },
  },
  {
    id: "net.critMult",
    branch: "net",
    name: "Crushing Blow",
    description: "+0.5× critical hit damage per level",
    maxLevel: 6,
    cost: { base: 500, growth: 1.8 },
    requires: ["net.critChance"],
    apply(stats, level) {
      stats.critMult += 0.5 * level;
    },
  },
  {
    id: "net.damage2",
    branch: "net",
    name: "Steel Net",
    description: "+1 net damage per level",
    maxLevel: 5,
    cost: { base: 5000, growth: 1.6 },
    requires: ["net.damage"],
    apply(stats, level) {
      stats.netDamage += level;
    },
  },
  {
    id: "net.radius2",
    branch: "net",
    name: "Huge Net",
    description: "+6 px net radius per level",
    maxLevel: 5,
    cost: { base: 4000, growth: 1.6 },
    requires: ["net.tick"],
    apply(stats, level) {
      stats.netRadius += 6 * level;
    },
  },

  // Time
  {
    id: "time.round",
    branch: "time",
    name: "Longer Rounds",
    description: "+1.5 s per round per level",
    maxLevel: 6,
    cost: { base: 25, growth: 2 },
    requires: ["net.tick"],
    apply(stats, level) {
      stats.roundSeconds += 1.5 * level;
    },
  },
  {
    id: "time.bonusChance",
    branch: "time",
    name: "Borrowed Time",
    description: "+1% chance per level that a capture adds time to the round",
    maxLevel: 5,
    cost: { base: 570, growth: 1.8 },
    requires: ["time.round"],
    apply(stats, level) {
      stats.timeBonusChance += 0.01 * level;
    },
  },
  {
    id: "time.bonusSeconds",
    branch: "time",
    name: "Extra Seconds",
    description: "+0.1 s added by each time bonus, per level",
    maxLevel: 5,
    cost: { base: 3000, growth: 1.5 },
    requires: ["time.bonusChance"],
    apply(stats, level) {
      stats.timeBonusSeconds += 0.1 * level;
    },
  },
  {
    id: "time.round2",
    branch: "time",
    name: "Overtime",
    description: "+1.5 s per round per level",
    maxLevel: 4,
    cost: { base: 15000, growth: 1.8 },
    requires: ["time.round"],
    apply(stats, level) {
      stats.roundSeconds += 1.5 * level;
    },
  },
  {
    id: "frenzy.length",
    branch: "time",
    name: "Rising Tide",
    description: "Feeding Frenzy waves last 1.5 s longer per level",
    maxLevel: 3,
    cost: { base: 1500, growth: 2 },
    requires: ["time.round"],
    apply(stats, level) {
      stats.frenzySeconds += 1.5 * level;
    },
  },

  // Spawning
  {
    id: "spawn.rate",
    branch: "spawning",
    name: "Chum the Water",
    description: "Every fish type spawns 10% faster per level",
    maxLevel: 10,
    cost: { base: 17, growth: 1.55 },
    requires: ["econ.value"],
    apply(stats, level) {
      stats.spawnRateMult *= 1.1 ** level;
    },
  },
  {
    id: "spawn.start",
    branch: "spawning",
    name: "Head Start",
    description: "+3 fish already in the water when a round starts, per level",
    maxLevel: 6,
    cost: { base: 88, growth: 1.8 },
    requires: ["spawn.rate"],
    apply(stats, level) {
      stats.startFish += 3 * level;
    },
  },
  {
    id: "spawn.twin",
    branch: "spawning",
    name: "Twin Fish",
    description: "+2.5% chance per level that a capture spawns another fish of the same type",
    maxLevel: 8,
    cost: { base: 1500, growth: 1.8 },
    requires: ["spawn.start"],
    apply(stats, level) {
      stats.twinChance += 0.025 * level;
    },
  },
  {
    id: "spawn.rate2",
    branch: "spawning",
    name: "Teeming Waters",
    description: "Every fish type spawns 8% faster per level",
    maxLevel: 5,
    cost: { base: 60000, growth: 2 },
    requires: ["spawn.start"],
    apply(stats, level) {
      stats.spawnRateMult *= 1.08 ** level;
    },
  },

  // Economy
  {
    id: "econ.value",
    branch: "economy",
    name: "Fish Market",
    description: "+10% value of every fish per level",
    maxLevel: 10,
    cost: { base: 10, growth: 1.65 },
    requires: ["normal.value"],
    apply(stats, level) {
      stats.valueMult += 0.1 * level;
    },
  },
  {
    id: "econ.combo",
    branch: "economy",
    name: "Combo",
    description:
      "Level 1: captures within 0.5 s of each other build a combo worth +10% value per capture. Each level after: +5% more per capture",
    maxLevel: 5,
    cost: { base: 800, growth: 1.5 },
    requires: ["econ.value"],
    apply(stats, level) {
      // Combos are off while the window is 0; level 1 opens it. Added, not set, so order never matters.
      stats.comboWindow += 0.5;
      stats.comboStep += 0.05 * (level - 1);
    },
  },
  {
    id: "econ.comboWindow",
    branch: "economy",
    name: "Quick Hands",
    description: "+0.1 s combo window per level",
    maxLevel: 5,
    cost: { base: 990, growth: 1.5 },
    requires: ["econ.combo"],
    apply(stats, level) {
      stats.comboWindow += 0.1 * level;
    },
  },
  {
    id: "econ.comboCap",
    branch: "economy",
    name: "Combo Cap",
    description: "+0.25× highest combo multiplier per level",
    maxLevel: 8,
    cost: { base: 2000, growth: 1.8 },
    requires: ["econ.combo"],
    apply(stats, level) {
      stats.comboMax += 0.25 * level;
    },
  },
  {
    id: "frenzy.value",
    branch: "economy",
    name: "Frenzy Feast",
    description: "+0.1× value of fish caught in a Feeding Frenzy, per level",
    maxLevel: 5,
    cost: { base: 20000, growth: 2 },
    requires: ["econ.combo"],
    apply(stats, level) {
      stats.frenzyValueMult += 0.1 * level;
    },
  },
  {
    id: "econ.value2",
    branch: "economy",
    name: "Golden Scales",
    description: "+10% value of every fish per level",
    maxLevel: 10,
    cost: { base: 60000, growth: 1.5 },
    requires: ["econ.value"],
    apply(stats, level) {
      stats.valueMult += 0.1 * level;
    },
  },

  // Normal fish
  fishValue("normal", {
    name: "Plump Normals",
    per: 0.25,
    maxLevel: 8,
    cost: { base: 4, growth: 1.75 },
    requires: ["net.radius"],
  }),
  {
    id: "normal.weight",
    ...fishBranch("normal"),
    name: "More Minnows",
    description: "Normal fish spawn 20% more often per level",
    maxLevel: 5,
    cost: { base: 390, growth: 1.8 },
    requires: ["normal.value", "uncommon.unlock"],
    apply(stats, level) {
      stats.fish.normal.rateMult += 0.2 * level;
    },
  },

  // Uncommon fish
  unlock("uncommon", {
    name: "Uncommon Fish",
    description: "Uncommon fish start spawning, in schools of 3–5",
    rate: 0.25,
    cost: 110,
    requires: ["normal.value"],
  }),
  spawnMore("uncommon", { name: "Uncommon Shoals", per: 0.3, maxLevel: 5, cost: { base: 170, growth: 1.6 }, requires: ["uncommon.unlock"] }),
  fishValue("uncommon", { name: "Bright Fins", per: 0.1, maxLevel: 6, cost: { base: 140, growth: 1.6 }, requires: ["uncommon.unlock"] }),
  {
    id: "uncommon.school",
    ...fishBranch("uncommon"),
    name: "Bigger Schools",
    description: "+1 fish in every Uncommon school per level",
    maxLevel: 1,
    cost: { base: 990, growth: 2.2 },
    requires: ["uncommon.value"],
    apply(stats, level) {
      stats.ability.uncommon.schoolMin += level;
      stats.ability.uncommon.schoolMax += level;
    },
  },

  // Rare fish
  unlock("rare", {
    name: "Rare Fish",
    description: "Rare fish start spawning: slow, armoured and valuable",
    rate: 0.25,
    cost: 770,
    requires: ["uncommon.unlock"],
  }),
  spawnMore("rare", { name: "Rare Sightings", per: 0.3, maxLevel: 5, cost: { base: 770, growth: 1.6 }, requires: ["rare.unlock"] }),
  fishValue("rare", { name: "Trophy Fish", per: 0.25, maxLevel: 6, cost: { base: 990, growth: 1.6 }, requires: ["rare.unlock"] }),
  {
    id: "rare.pierce",
    ...fishBranch("rare"),
    name: "Armour Pierce",
    description: "The first hit on each Rare fish deals double damage",
    maxLevel: 1,
    cost: { base: 4300, growth: 1 },
    requires: ["rare.value"],
    apply(stats) {
      stats.ability.rare.pierce = true;
    },
  },
  {
    id: "rare.armor",
    ...fishBranch("rare"),
    name: "Brittle Scales",
    description: "−25% Rare armour per level",
    maxLevel: 4,
    cost: { base: 1500, growth: 1.6 },
    requires: ["rare.weight"],
    apply(stats, level) {
      // Relative, so every level counts whatever the base armour is tuned to.
      stats.ability.rare.armor *= Math.max(0, 1 - 0.25 * level);
    },
  },

  // Electric fish
  unlock("electric", {
    name: "Electric Fish",
    description: "Electric fish start spawning. When caught, a current jumps between nearby fish",
    rate: 0.19,
    cost: 7900,
    requires: ["rare.unlock"],
  }),
  spawnMore("electric", { name: "Storm Season", per: 0.3, maxLevel: 5, cost: { base: 4810, growth: 1.6 }, requires: ["electric.unlock"] }),
  fishValue("electric", { name: "Live Wires", per: 0.25, maxLevel: 6, cost: { base: 5590, growth: 1.6 }, requires: ["electric.unlock"] }),
  {
    id: "electric.jumps",
    ...fishBranch("electric"),
    name: "Chain Lightning",
    description: "+1 jump for each Electric current, per level",
    maxLevel: 6,
    cost: { base: 3000, growth: 1.5 },
    requires: ["electric.value"],
    apply(stats, level) {
      stats.ability.electric.jumps += level;
    },
  },
  {
    id: "electric.damage",
    ...fishBranch("electric"),
    name: "High Voltage",
    description: "+1 current damage per level",
    maxLevel: 5,
    cost: { base: 3000, growth: 1.5 },
    requires: ["electric.value"],
    apply(stats, level) {
      stats.ability.electric.damage += level;
    },
  },
  {
    id: "electric.range",
    ...fishBranch("electric"),
    name: "Long Arc",
    description: "+20 px current jump range per level",
    maxLevel: 5,
    cost: { base: 3000, growth: 1.5 },
    requires: ["electric.weight"],
    apply(stats, level) {
      stats.ability.electric.range += 20 * level;
    },
  },

  // Epic fish
  unlock("epic", {
    name: "Epic Fish",
    description: "Epic fish start spawning. When caught, they may net the fish around them",
    rate: 0.2,
    cost: 28000,
    requires: ["electric.unlock"],
  }),
  spawnMore("epic", { name: "Deep Lures", per: 0.3, maxLevel: 5, cost: { base: 14300, growth: 1.6 }, requires: ["epic.unlock"] }),
  fishValue("epic", { name: "Glowing Lure", per: 0.25, maxLevel: 6, cost: { base: 16900, growth: 1.6 }, requires: ["epic.unlock"] }),
  {
    id: "epic.chance",
    ...fishBranch("epic"),
    name: "Epic Haul",
    description: "+5% chance per level for each fish in range to be captured with an Epic fish",
    maxLevel: 6,
    cost: { base: 8000, growth: 1.5 },
    requires: ["epic.value"],
    apply(stats, level) {
      stats.ability.epic.chance += 0.05 * level;
    },
  },
  {
    id: "epic.range",
    ...fishBranch("epic"),
    name: "Wide Lure",
    description: "+15 px Epic capture range per level",
    maxLevel: 6,
    cost: { base: 8000, growth: 1.5 },
    requires: ["epic.weight"],
    apply(stats, level) {
      stats.ability.epic.range += 15 * level;
    },
  },

  // Goober fish
  unlock("goober", {
    name: "Goober Fish",
    description: "Goober fish start spawning. When caught, they burst into Normal fish",
    rate: 0.04,
    cost: 72000,
    requires: ["epic.unlock"],
  }),
  spawnMore("goober", { name: "Goober Bloom", per: 0.3, maxLevel: 5, cost: { base: 31200, growth: 1.6 }, requires: ["goober.unlock"] }),
  fishValue("goober", { name: "Squishy Treats", per: 0.25, maxLevel: 6, cost: { base: 6000, growth: 1.5 }, requires: ["goober.unlock"] }),
  {
    id: "goober.tier",
    ...fishBranch("goober"),
    name: "Goober Evolution",
    description: "Goobers burst into the next fish type up, per level: Normal → Uncommon → Rare → Electric → Epic",
    maxLevel: 4,
    cost: { base: 100000, growth: 2 },
    requires: ["goober.value"],
    apply(stats, level) {
      stats.ability.goober.tier = Math.min(4, stats.ability.goober.tier + level);
    },
  },
  {
    id: "goober.count",
    ...fishBranch("goober"),
    name: "Goober Brood",
    description: "+1 fish per Goober burst, per level",
    maxLevel: 1,
    cost: { base: 36400, growth: 1.6 },
    requires: ["goober.weight"],
    apply(stats, level) {
      stats.ability.goober.count += level;
    },
  },

  // Monster fish
  unlock("monster", {
    name: "Monster Fish",
    description: "Monster fish start spawning, one at a time. Their whirlpool gathers fish; catch one to take them all",
    rate: 0.04,
    cost: 120000,
    requires: ["goober.unlock"],
  }),
  spawnMore("monster", { name: "Here Be Monsters", per: 0.3, maxLevel: 5, cost: { base: 15000, growth: 1.5 }, requires: ["monster.unlock"] }),
  fishValue("monster", { name: "Monster Bounty", per: 0.25, maxLevel: 6, cost: { base: 20000, growth: 1.4 }, requires: ["monster.unlock"] }),
  {
    id: "monster.pullRadius",
    ...fishBranch("monster"),
    name: "Maelstrom",
    description: "+20 px whirlpool radius per level",
    maxLevel: 4,
    cost: { base: 15000, growth: 1.5 },
    requires: ["monster.weight"],
    apply(stats, level) {
      stats.ability.monster.pullRadius += 20 * level;
    },
  },
  {
    id: "monster.pullStrength",
    ...fishBranch("monster"),
    name: "Undertow",
    description: "+12 px/s whirlpool pull per level",
    maxLevel: 4,
    cost: { base: 15000, growth: 1.5 },
    requires: ["monster.value"],
    apply(stats, level) {
      stats.ability.monster.pullStrength += 12 * level;
    },
  },

  // Star fish
  unlock("star", {
    name: "Star Fish",
    description: "Glowing Star fish start spawning, rarely. When caught, they shoot off and bounce around the screen",
    rate: 0.075,
    cost: 160000,
    requires: ["monster.unlock"],
  }),
  {
    id: "star.chance",
    ...fishBranch("star"),
    name: "Starfall",
    description: "Star fish spawn 50% more often per level",
    maxLevel: 5,
    cost: { base: 100000, growth: 1.5 },
    requires: ["star.unlock"],
    apply(stats, level) {
      stats.fish.star.rateMult += 0.5 * level;
    },
  },
  {
    id: "star.damage",
    ...fishBranch("star"),
    name: "Sharp Points",
    description: "+1 Star damage per level",
    maxLevel: 4,
    cost: { base: 25000, growth: 1.6 },
    requires: ["star.unlock"],
    apply(stats, level) {
      stats.ability.star.damage += level;
    },
  },
  {
    id: "star.bounces",
    ...fishBranch("star"),
    name: "Ricochet",
    description: "+1 bounce before a Star fades, per level",
    maxLevel: 4,
    cost: { base: 75000, growth: 1.6 },
    requires: ["star.damage"],
    apply(stats, level) {
      stats.ability.star.bounces += level;
    },
  },
  {
    id: "star.speed",
    ...fishBranch("star"),
    name: "Shooting Star",
    description: "+60 px/s Star speed and +1 bounce per level",
    maxLevel: 4,
    cost: { base: 75000, growth: 1.5 },
    requires: ["star.chance"],
    apply(stats, level) {
      stats.ability.star.speed += 60 * level;
      stats.ability.star.bounces += level;
    },
  },
  {
    id: "star.size",
    ...fishBranch("star"),
    name: "Supernova",
    description: "+5 px Star hit radius per level",
    maxLevel: 4,
    cost: { base: 30000, growth: 1.5 },
    requires: ["star.damage"],
    apply(stats, level) {
      stats.ability.star.radius += 5 * level;
    },
  },
  {
    id: "star.count",
    ...fishBranch("star"),
    name: "Constellation",
    description: "+1 shard launched per Star caught, per level: a smaller Star that fades after half as many bounces",
    maxLevel: 3,
    cost: { base: 500000, growth: 1.5 },
    requires: ["star.bounces"],
    apply(stats, level) {
      stats.ability.star.count += level;
    },
  },
];
