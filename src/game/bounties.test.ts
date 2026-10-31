import { describe, expect, it } from "vitest";
import { BOUNTIES_FROM_ROUND, bountyGuarantees, bountyLabel, bountyProgress, rollBounties, type Bounty, type BountyFacts } from "./bounties";
import { FISH_KINDS } from "./fish";
import { createRng } from "./rng";
import { BASE_STATS, cloneStats, spawnRate, type Stats } from "./stats";
import { applyUpgrades, TECH_NODES } from "./tech";

const upgrades = Object.fromEntries(TECH_NODES.map((n) => [n.id, n.maxLevel]));
const maxStats = applyUpgrades(BASE_STATS, upgrades);

function roll(seed: number, round = 10, stats: Stats = maxStats, recentEarnings = 1234): Bounty[] {
  return rollBounties({ round, final: false, upgrades, stats, recentEarnings, rng: createRng(seed) });
}

const facts: BountyFacts = {
  caught: { uncommon: 6 }, maxComboMult: 1.5 - 1e-12, goldenCaught: 1,
  chestsOpened: 1, bestTickCatches: 8, earned: 1200, frenzyCaught: 20,
};

describe("rollBounties", () => {
  it("waits until round 2 and skips the Final Round without drawing randomness", () => {
    const rng = () => { throw new Error("must not draw"); };
    expect(BOUNTIES_FROM_ROUND).toBe(2);
    for (const [round, final] of [[1, false], [10, true]] as const) {
      expect(rollBounties({ round, final, upgrades: {}, stats: BASE_STATS, recentEarnings: 0, rng })).toEqual([]);
    }
  });

  it("replays from a seed without changing stats or upgrades", () => {
    const before = structuredClone(maxStats);
    expect(roll(123)).toEqual(roll(123));
    expect(roll(123)).not.toEqual(roll(456));
    expect(maxStats).toEqual(before);
  });

  it("offers two bounties before round 8 and three afterwards, with unique ids and eligible kinds", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      for (const round of [2, 3, 5, 7, 8, 10]) {
        const board = roll(seed, round);
        expect(board).toHaveLength(round < 8 ? 2 : 3);
        expect(new Set(board.map((b) => b.id)).size).toBe(board.length);
        for (const b of board) {
          seen.add(b.kind);
          const sameKind = board.filter((other) => other.kind === b.kind);
          expect(sameKind.length).toBeLessThanOrEqual(b.kind === "catch" ? 2 : 1);
          if (b.kind === "catch") expect(new Set(sameKind.map((other) => other.fish)).size).toBe(sameKind.length);
          if (b.kind === "chest") expect(round).toBeGreaterThanOrEqual(3);
          if (b.kind === "frenzy") expect(round % 5).toBe(0);
          expect(b.target).toBeGreaterThan(0);
          expect(b.reward).toBeGreaterThan(0);
        }
      }
    }
    expect([...seen].sort()).toEqual(["catch", "chest", "combo", "earn", "frenzy", "golden", "haul"]);
  });

  it("never asks for locked fish, disabled combos or golden fish, or earnings with no history", () => {
    const stats = cloneStats(BASE_STATS);
    stats.goldenRate = 0;
    for (let seed = 0; seed < 100; seed++) {
      for (const b of roll(seed, 2, stats, 0)) {
        expect(["catch", "haul"]).toContain(b.kind);
        if (b.kind === "catch") expect(b.fish).toBe("normal");
      }
    }
  });

  it("uses effective spawn rates and each fish's share of the starting population", () => {
    const seen = new Set<string>();
    const totalRate = FISH_KINDS.reduce((sum, kind) => sum + spawnRate(maxStats, kind), 0);
    for (let seed = 0; seed < 200; seed++) {
      for (const b of roll(seed)) {
        if (b.kind !== "catch") continue;
        seen.add(b.fish!);
        const rate = spawnRate(maxStats, b.fish!);
        const expected = rate * maxStats.roundSeconds + maxStats.startFish * rate / totalRate;
        expect(b.target).toBeGreaterThanOrEqual(Math.max(1, Math.round(expected * 0.35)));
        expect(b.target).toBeLessThanOrEqual(Math.max(1, Math.round(expected * 0.6)));
      }
    }
    expect([...seen].sort()).toEqual([...FISH_KINDS].sort());
  });

  it("keeps rare targets at one and only offers combos above the enabled threshold", () => {
    const stats = cloneStats(BASE_STATS);
    stats.fish.star.rate = 0.00001;
    stats.comboWindow = 0.5;
    stats.comboMax = 1.1;
    let sawStar = false;
    for (let seed = 0; seed < 100; seed++) {
      for (const b of roll(seed, 2, stats, 0)) {
        expect(b.kind).not.toBe("combo");
        if (b.fish === "star") { sawStar = true; expect(b.target).toBe(1); }
      }
    }
    expect(sawStar).toBe(true);
  });

  it("scales targets within the combo cap, haul range and recent earnings", () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const b of roll(seed)) {
        if (b.kind === "combo") {
          expect(b.target).toBeGreaterThanOrEqual(1.2);
          expect(b.target).toBeLessThanOrEqual(maxStats.comboMax);
          expect(b.target * 10).toBeCloseTo(Math.round(b.target * 10));
        }
        if (b.kind === "haul") {
          expect(b.target).toBeGreaterThanOrEqual(4);
          expect(b.target).toBeLessThanOrEqual(12);
        }
        if (b.kind === "earn") {
          expect(b.target).toBeGreaterThanOrEqual(Math.round(1234 * 1.1));
          expect(b.target).toBeLessThanOrEqual(Math.round(1234 * 1.3));
        }
      }
    }
  });

  it("pays 15–30% of the earnings baseline, rounded to two significant figures", () => {
    for (const earnings of [0, 1234, 987654]) {
      for (let seed = 0; seed < 100; seed++) {
        for (const b of roll(seed, 10, maxStats, earnings)) {
          const baseline = Math.max(20, earnings);
          expect(b.reward).toBe(Number(b.reward.toPrecision(2)));
          expect(b.reward).toBeGreaterThanOrEqual(Number((baseline * 0.15).toPrecision(2)));
          expect(b.reward).toBeLessThanOrEqual(Number((baseline * 0.3).toPrecision(2)));
          if (b.kind === "chest") expect(b.reward).toBeGreaterThanOrEqual(Number((baseline * 0.25).toPrecision(2)));
        }
      }
    }
  });
});

describe("bounty labels and progress", () => {
  it.each([
    [{ kind: "catch", fish: "uncommon", target: 6 }, "Catch 6 Uncommon fish", 6],
    [{ kind: "combo", target: 1.5 }, "Reach combo ×1.5", facts.maxComboMult],
    [{ kind: "haul", target: 8 }, "Net 8 fish in one sweep", 8],
    [{ kind: "earn", target: 1200 }, "Earn $1,200", 1200],
    [{ kind: "golden", target: 1 }, "Catch a golden fish", 1],
    [{ kind: "chest", target: 1 }, "Open the treasure chest", 1],
    [{ kind: "frenzy", target: 20 }, "Catch 20 fish in the Feeding Frenzy", 20],
  ] as const)("describes and measures $kind", (fields, label, value) => {
    const bounty: Bounty = { id: "test", reward: 10, ...fields };
    expect(bountyLabel(bounty)).toBe(label);
    expect(bountyProgress(bounty, facts)).toEqual({ value, target: fields.target, done: true });
    expect(bountyProgress(bounty, { caught: {}, maxComboMult: 1, goldenCaught: 0, chestsOpened: 0, bestTickCatches: 0, earned: 0, frenzyCaught: 0 }).done).toBe(false);
  });

  it("uses a target of one for golden fish and chests", () => {
    for (const kind of ["golden", "chest"] as const) {
      expect(bountyProgress({ id: "a", kind, target: 20, reward: 10 }, facts)).toEqual({ value: 1, target: 1, done: true });
    }
  });

  it("guarantees only events required by the board", () => {
    expect(bountyGuarantees([])).toEqual({});
    expect(bountyGuarantees([{ id: "a", kind: "catch", fish: "normal", target: 2, reward: 5 }])).toEqual({});
    expect(bountyGuarantees([{ id: "a", kind: "golden", target: 1, reward: 5 }])).toEqual({ golden: true });
    expect(bountyGuarantees([{ id: "a", kind: "chest", target: 1, reward: 5 }])).toEqual({ chest: true });
    expect(bountyGuarantees(["chest", "golden"].map((kind) => ({ id: kind, kind, target: 1, reward: 5 } as Bounty)))).toEqual({ chest: true, golden: true });
  });
});
