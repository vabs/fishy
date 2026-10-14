import { FISH, FISH_KINDS } from "../fish";
import type { Stats } from "../stats";
import { applyUpgrades, levelOf, type TechNode, type Upgrades } from "./tree";

/** One stat a node changes, formatted for the player. */
export interface StatChange {
  label: string;
  before: string;
  after: string;
}

type Format = (value: number | boolean) => string;

const num = (digits = 0): Format => (v) => (typeof v === "number" ? String(Number(v.toFixed(digits))) : String(v));
const unit = (suffix: string, digits = 0): Format => (v) => `${num(digits)(v)} ${suffix}`;
const percent: Format = (v) => `${Number(((v as number) * 100).toFixed(1))}%`;
const times: Format = (v) => `${Number((v as number).toFixed(2))}×`;
const onOff: Format = (v) => (v ? "On" : "Off");
const GOOBER_TIERS = ["Normal", "Uncommon", "Rare", "Electric", "Epic"];
const tier: Format = (v) => GOOBER_TIERS[v as number] ?? String(v);

/** Player-facing name and format for every Stats field, by dotted path. */
const STAT_FORMATS: Record<string, [string, Format]> = {
  roundSeconds: ["Round length", unit("s", 1)],
  timeBonusChance: ["Time bonus chance", percent],
  timeBonusSeconds: ["Time per bonus", unit("s", 2)],
  tickSeconds: ["Time between net ticks", unit("s", 2)],
  netRadius: ["Net radius", unit("px")],
  netDamage: ["Net damage", num(1)],
  critChance: ["Critical hit chance", percent],
  critMult: ["Critical hit damage", times],
  spawnSeconds: ["Time between spawns", unit("s", 2)],
  maxFish: ["Most fish at once", num()],
  startFish: ["Fish at round start", num()],
  twinChance: ["Twin chance", percent],
  valueMult: ["Value of every fish", times],
  comboWindow: ["Combo window", unit("s", 2)],
  comboStep: ["Value per combo capture", (v) => `+${percent(v)}`],
  comboMax: ["Highest combo", times],
  "ability.uncommon.schoolMin": ["Smallest school", num()],
  "ability.uncommon.schoolMax": ["Largest school", num()],
  "ability.rare.armor": ["Rare armour", num(2)],
  "ability.rare.pierce": ["Armour pierce", onOff],
  "ability.electric.jumps": ["Current jumps", num()],
  "ability.electric.damage": ["Current damage", num(1)],
  "ability.electric.range": ["Current jump range", unit("px")],
  "ability.epic.chance": ["Epic capture chance", percent],
  "ability.epic.range": ["Epic capture range", unit("px")],
  "ability.goober.tier": ["Goobers burst into", tier],
  "ability.goober.count": ["Fish per Goober burst", num()],
  "ability.monster.pullRadius": ["Whirlpool radius", unit("px")],
  "ability.monster.pullStrength": ["Whirlpool pull", unit("px/s")],
  "ability.star.bounces": ["Star bounces", num()],
  "ability.star.damage": ["Star damage", num(1)],
  "ability.star.speed": ["Star speed", unit("px/s")],
  "ability.star.radius": ["Star hit radius", unit("px")],
  "ability.star.count": ["Stars per catch", num()],
  ...Object.fromEntries(
    FISH_KINDS.flatMap((kind) => [
      [`fish.${kind}.weight`, [`${FISH[kind].name} spawn weight`, num(3)]],
      [`fish.${kind}.valueMult`, [`${FISH[kind].name} value`, times]],
    ]),
  ),
};

/** Dotted paths of every number or boolean that differs between two Stats-shaped objects. */
export function changedPaths(a: unknown, b: unknown, path = ""): string[] {
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    return Object.keys(a).flatMap((key) =>
      changedPaths((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path ? `${path}.${key}` : key),
    );
  }
  return a === b ? [] : [path];
}

function valueAt(stats: Stats, path: string): number | boolean {
  return path.split(".").reduce<unknown>((obj, key) => (obj as Record<string, unknown>)[key], stats) as number | boolean;
}

export function describeChanges(before: Stats, after: Stats): StatChange[] {
  return changedPaths(before, after).map((path) => {
    const [label, format] = STAT_FORMATS[path] ?? [path, num(2)];
    return { label, before: format(valueAt(before, path)), after: format(valueAt(after, path)) };
  });
}

/**
 * What buying the next level of `node` would change, given the current upgrades. For a maxed
 * node, what the node has changed in total.
 */
export function nodeChanges(base: Stats, node: TechNode, upgrades: Upgrades): StatChange[] {
  const level = levelOf(node, upgrades);
  const maxed = level >= node.maxLevel;
  const from = applyUpgrades(base, maxed ? { ...upgrades, [node.id]: 0 } : upgrades);
  const to = applyUpgrades(base, { ...upgrades, [node.id]: maxed ? level : level + 1 });
  return describeChanges(from, to);
}

export function hasStatLabel(path: string): boolean {
  return path in STAT_FORMATS;
}
