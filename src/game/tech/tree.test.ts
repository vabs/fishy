import { describe, expect, it } from "vitest";
import { FISH_KINDS } from "../fish";
import { BASE_STATS, cloneStats, spawnRate, type Stats } from "../stats";
import {
  TECH_NODES,
  applyUpgrades,
  buy,
  canBuy,
  getNode,
  isTreeComplete,
  isVisible,
  levelOf,
  nextCost,
  remainingCost,
  totalTreeCost,
  type TechNode,
  type Upgrades,
} from ".";

function node(id: string): TechNode {
  const found = getNode(id);
  if (!found) throw new Error(`No node ${id}`);
  return found;
}

function maxedTree(): Upgrades {
  return Object.fromEntries(TECH_NODES.map((n) => [n.id, n.maxLevel]));
}

/** Buys the cheapest buyable node until nothing is left, with unlimited money. */
function buyEverything(): { upgrades: Upgrades; spent: number } {
  let upgrades: Upgrades = {};
  let spent = 0;
  for (;;) {
    const options = TECH_NODES.filter((n) => canBuy(n, upgrades, Infinity));
    if (options.length === 0) return { upgrades, spent };
    const cheapest = options.reduce((a, b) => (nextCost(a, levelOf(a, upgrades)) <= nextCost(b, levelOf(b, upgrades)) ? a : b));
    spent += nextCost(cheapest, levelOf(cheapest, upgrades));
    upgrades = buy(upgrades, Infinity, cheapest.id)!.upgrades;
  }
}

describe("applyUpgrades", () => {
  it("returns the base stats unchanged with no upgrades, without sharing objects", () => {
    const stats = applyUpgrades(BASE_STATS, {});
    expect(stats).toEqual(BASE_STATS);
    expect(stats).not.toBe(BASE_STATS);
    expect(stats.fish).not.toBe(BASE_STATS.fish);
    expect(stats.ability.star).not.toBe(BASE_STATS.ability.star);
  });

  it("never mutates the base stats", () => {
    const before = cloneStats(BASE_STATS);
    applyUpgrades(BASE_STATS, maxedTree());
    expect(BASE_STATS).toEqual(before);
  });

  it("applies every owned level", () => {
    const stats = applyUpgrades(BASE_STATS, { "net.radius": 3, "uncommon.unlock": 1 });
    expect(stats.netRadius).toBe(BASE_STATS.netRadius + 3 * 8);
    expect(stats.fish.uncommon.rate).toBeGreaterThan(0);
    expect(stats.fish.rare.rate).toBe(0);
  });

  it("ignores unknown ids and clamps levels to each node's range", () => {
    const radius = node("net.radius");
    const stats = applyUpgrades(BASE_STATS, { "no.such.node": 5, "net.radius": 999, "net.tick": -3 });
    expect(stats.netRadius).toBe(applyUpgrades(BASE_STATS, { "net.radius": radius.maxLevel }).netRadius);
    expect(stats.tickSeconds).toBe(BASE_STATS.tickSeconds);
  });

  it("gives the same result whatever order the nodes are applied in", () => {
    const upgrades = maxedTree();
    const forward = applyUpgrades(BASE_STATS, upgrades);
    const backward = cloneStats(BASE_STATS);
    for (const n of [...TECH_NODES].reverse()) n.apply(backward, n.maxLevel);
    expect(backward).toEqual(forward);
  });

  it("keeps a fully upgraded game playable", () => {
    const stats = applyUpgrades(BASE_STATS, maxedTree());
    expect(stats.tickSeconds).toBeGreaterThan(0.1);
    expect(stats.spawnRateMult).toBeLessThan(10);
    for (const chance of [stats.critChance, stats.timeBonusChance, stats.twinChance, stats.ability.epic.chance]) {
      expect(chance).toBeGreaterThan(0);
      expect(chance).toBeLessThanOrEqual(1);
    }
    expect(stats.ability.goober.tier).toBe(4);
    expect(stats.ability.rare.armor).toBeGreaterThanOrEqual(0);
    expect(stats.ability.uncommon.schoolMin).toBeLessThanOrEqual(stats.ability.uncommon.schoolMax);
    for (const kind of FISH_KINDS) expect(stats.fish[kind].rate).toBeGreaterThan(0);
  });

  it("never lowers any fish type's spawn rate", () => {
    for (const n of TECH_NODES) {
      for (let level = 1; level <= n.maxLevel; level++) {
        const stats = cloneStats(BASE_STATS);
        n.apply(stats, level);
        for (const kind of FISH_KINDS) {
          expect(spawnRate(stats, kind), `${n.id} level ${level}, ${kind}`).toBeGreaterThanOrEqual(spawnRate(BASE_STATS, kind));
        }
      }
    }
  });
});

describe("node definitions", () => {
  it("have unique ids", () => {
    const ids = TECH_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only require nodes that exist, never themselves", () => {
    for (const n of TECH_NODES) {
      for (const id of n.requires) {
        expect(getNode(id), `${n.id} requires unknown ${id}`).toBeDefined();
        expect(id).not.toBe(n.id);
      }
    }
  });

  it("have no requirement cycles", () => {
    const state = new Map<string, "visiting" | "done">();
    const visit = (n: TechNode, path: string[]): void => {
      if (state.get(n.id) === "done") return;
      if (state.get(n.id) === "visiting") throw new Error(`Cycle: ${[...path, n.id].join(" → ")}`);
      state.set(n.id, "visiting");
      for (const id of n.requires) visit(node(id), [...path, n.id]);
      state.set(n.id, "done");
    };
    for (const n of TECH_NODES) expect(() => visit(n, [])).not.toThrow();
  });

  it("have exactly one root", () => {
    expect(TECH_NODES.filter((n) => n.requires.length === 0).map((n) => n.id)).toEqual(["net.radius"]);
  });

  it("have sane levels and costs", () => {
    for (const n of TECH_NODES) {
      expect(Number.isInteger(n.maxLevel), n.id).toBe(true);
      expect(n.maxLevel, n.id).toBeGreaterThanOrEqual(1);
      expect(n.cost.base, n.id).toBeGreaterThan(0);
      expect(n.cost.growth, n.id).toBeGreaterThanOrEqual(1);
      expect(n.name.length, n.id).toBeGreaterThan(0);
      expect(n.description.length, n.id).toBeGreaterThan(0);
    }
  });

  it("put every fish branch node on a fish", () => {
    for (const n of TECH_NODES) {
      if (n.branch === "fish" || n.branch === "star") expect(n.fish, n.id).toBeDefined();
      else expect(n.fish, n.id).toBeUndefined();
    }
  });

  it("each change the stats at level 1, and again at every level after", () => {
    for (const n of TECH_NODES) {
      const previous: Stats[] = [cloneStats(BASE_STATS)];
      for (let level = 1; level <= n.maxLevel; level++) {
        const stats = cloneStats(BASE_STATS);
        n.apply(stats, level);
        expect(stats, `${n.id} level ${level} changes nothing`).not.toEqual(previous[previous.length - 1]);
        previous.push(stats);
      }
    }
  });

  it("cover every fish type with an unlock (except Normal), spawn rate and value", () => {
    for (const kind of FISH_KINDS) {
      if (kind !== "normal") expect(getNode(`${kind}.unlock`), kind).toBeDefined();
      expect(TECH_NODES.some((n) => n.fish === kind && n.id !== `${kind}.unlock`), kind).toBe(true);
    }
  });

  it("gate each fish type's other nodes behind its unlock", () => {
    for (const n of TECH_NODES) {
      if (!n.fish || n.fish === "normal" || n.id.endsWith(".unlock")) continue;
      const unlockId = `${n.fish}.unlock`;
      const reachesUnlock = (id: string): boolean => id === unlockId || node(id).requires.some(reachesUnlock);
      expect(n.requires.some(reachesUnlock), n.id).toBe(true);
    }
  });
});

describe("nextCost", () => {
  it("rounds each level's calculated dollar price up to a multiple of ten", () => {
    const n: TechNode = { ...node("net.radius"), cost: { base: 10, growth: 1.5 } };
    expect(nextCost(n, 0)).toBe(10);
    expect(nextCost(n, 1)).toBe(20);
    expect(nextCost(n, 2)).toBe(30);
    expect(nextCost(n, 3)).toBe(40);
  });

  it.each([[2, 10], [34, 40], [590, 590], [591, 600], [999, 1000], [1000, 1000]])(
    "raises $%i to $%i without raising an already rounded price",
    (base, expected) => {
      const n: TechNode = { ...node("net.radius"), cost: { base, growth: 1 } };
      expect(nextCost(n, 0)).toBe(expected);
    },
  );

  it("charges ten dollars for the first purchase", () => {
    expect(canBuy(node("net.radius"), {}, 9)).toBe(false);
    expect(buy({}, 10, "net.radius")).toEqual({ upgrades: { "net.radius": 1 }, money: 0 });
  });

  it("makes every actual upgrade price a multiple of ten without lowering it", () => {
    for (const n of TECH_NODES) {
      for (let level = 0; level < n.maxLevel; level++) {
        const price = nextCost(n, level);
        expect(price % 10, `${n.id} level ${level + 1}`).toBe(0);
        expect(price).toBeGreaterThanOrEqual(Math.round(n.cost.base * n.cost.growth ** level));
      }
    }
  });
});

describe("isVisible", () => {
  it("shows only the root at the start", () => {
    expect(TECH_NODES.filter((n) => isVisible(n, {})).map((n) => n.id)).toEqual(["net.radius"]);
  });

  it("opens the Net and Normal fish branches once the root is bought", () => {
    const visible = TECH_NODES.filter((n) => isVisible(n, { "net.radius": 1 }));
    expect(visible.map((n) => n.branch)).toContain("net");
    expect(visible.some((n) => n.fish === "normal")).toBe(true);
    expect(visible.every((n) => n.branch === "net" || n.fish === "normal")).toBe(true);
  });

  it("needs every requirement at level 1 or more", () => {
    const minnows = node("normal.weight");
    expect(minnows.requires).toEqual(["normal.value", "uncommon.unlock"]);
    expect(isVisible(minnows, { "normal.value": 3 })).toBe(false);
    expect(isVisible(minnows, { "normal.value": 1, "uncommon.unlock": 0 })).toBe(false);
    expect(isVisible(minnows, { "normal.value": 1, "uncommon.unlock": 1 })).toBe(true);
  });

  it("starts with only Normal fish spawning", () => {
    for (const kind of FISH_KINDS) expect(BASE_STATS.fish[kind].rate > 0).toBe(kind === "normal");
  });
});

describe("buy", () => {
  it("raises the level and takes the cost, without mutating its inputs", () => {
    const upgrades: Upgrades = { "net.radius": 1 };
    const cost = nextCost(node("net.radius"), 1);
    const result = buy(upgrades, 100, "net.radius");
    expect(result).toEqual({ upgrades: { "net.radius": 2 }, money: 100 - cost });
    expect(upgrades).toEqual({ "net.radius": 1 });
  });

  it("refuses when money is short, and allows the exact amount", () => {
    const cost = nextCost(node("net.radius"), 0);
    expect(buy({}, cost - 1, "net.radius")).toBeNull();
    expect(buy({}, cost, "net.radius")?.money).toBe(0);
  });

  it("refuses at max level", () => {
    const n = node("net.radius");
    expect(buy({ "net.radius": n.maxLevel }, Infinity, "net.radius")).toBeNull();
    expect(canBuy(n, { "net.radius": n.maxLevel }, Infinity)).toBe(false);
  });

  it("refuses when requirements are not owned", () => {
    expect(buy({}, Infinity, "net.tick")).toBeNull();
    expect(buy({ "net.radius": 1 }, Infinity, "net.tick")).not.toBeNull();
  });

  it("refuses unknown ids", () => {
    expect(buy({}, Infinity, "nope")).toBeNull();
  });
});

describe("isTreeComplete", () => {
  it("is false at the start and true with every node maxed", () => {
    expect(isTreeComplete({})).toBe(false);
    expect(isTreeComplete(maxedTree())).toBe(true);
  });

  it("is false while any node is one level short", () => {
    for (const n of TECH_NODES) {
      expect(isTreeComplete({ ...maxedTree(), [n.id]: n.maxLevel - 1 }), n.id).toBe(false);
    }
  });

  it("can be reached by buying one node at a time from the start", () => {
    const { upgrades, spent } = buyEverything();
    expect(isTreeComplete(upgrades)).toBe(true);
    expect(spent).toBe(totalTreeCost());
  });
});

describe("totalTreeCost", () => {
  it("sums every level of every node", () => {
    const radius = node("net.radius");
    let expected = 0;
    for (let level = 0; level < radius.maxLevel; level++) expected += nextCost(radius, level);
    expect(remainingCost(radius)).toBe(expected);
    expect(totalTreeCost([radius])).toBe(expected);
    expect(remainingCost(radius, radius.maxLevel)).toBe(0);
  });

  it("stays near the total the pacing sim was tuned for", () => {
    // About 70 minutes of play for the pacing bot (see pacing.test.ts). Rerun the sim when this moves a lot.
    expect(totalTreeCost()).toBeGreaterThan(25_000_000);
    expect(totalTreeCost()).toBeLessThan(40_000_000);
  });
});
