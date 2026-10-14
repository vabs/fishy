import { describe, expect, it } from "vitest";
import { FISH, type FishKind } from "../fish";
import { createRng } from "../rng";
import { BASE_STATS } from "../stats";
import { STEP, World, type Point } from "../world";
import {
  TECH_NODES,
  applyUpgrades,
  buy,
  canBuy,
  getNode,
  isMaxed,
  isTreeComplete,
  isVisible,
  levelOf,
  nextCost,
  totalTreeCost,
  type TechNode,
  type Upgrades,
} from ".";

/*
 * Pacing estimate: plays a whole game with a bot through the real World, shopping after every
 * round, and prints the timeline. Not part of `npm test`; run it after changing costs:
 *   PACING=1 npx vitest run src/game/tech/pacing.test.ts --silent=false
 * Ability upgrades only pay off once the fish types implement them, so real games get faster as
 * they land.
 */

const WIDTH = 1280;
const HEIGHT = 800;
/** Seconds a player spends between rounds: summary screen plus shopping. */
const HUB_SECONDS = 10;
/**
 * Bot skill: cursor speed (px/s) and how often it picks a new target. Tuned to a casual player,
 * about $11 in round 1; a sharp bot (1400 px/s, 0.1 s) earns about $16.
 */
const POINTER_SPEED = 300;
const RETARGET_SECONDS = 0.6;
/** Longest round the sim will run, in case time bonuses snowball. */
const MAX_ROUND_SECONDS = 240;
const MAX_ROUNDS = 600;

/** Steers toward the fish with the most other fish around it, preferring nearby targets. */
function botTarget(world: World, from: Point): Point | null {
  const reach = world.stats.netRadius * 0.8;
  let best: Point | null = null;
  let bestScore = -Infinity;
  const live = world.fish.filter((f) => !f.captured);
  for (const f of live) {
    let score = 0;
    for (const g of live) {
      if (Math.hypot(g.x - f.x, g.y - f.y) <= reach) score += FISH[g.kind].value / FISH[g.kind].hp;
    }
    score -= Math.hypot(f.x - from.x, f.y - from.y) / 800;
    if (score > bestScore) {
      bestScore = score;
      best = { x: f.x, y: f.y };
    }
  }
  return best;
}

function playRound(upgrades: Upgrades, seed: number): { earned: number; seconds: number; caught: Partial<Record<FishKind, number>> } {
  const world = new World(applyUpgrades(BASE_STATS, upgrades), createRng(seed), WIDTH, HEIGHT);
  let pointer: Point = { x: WIDTH / 2, y: HEIGHT / 2 };
  let target: Point | null = null;
  let retarget = 0;
  while (!world.over && world.elapsed < MAX_ROUND_SECONDS) {
    retarget -= STEP;
    if (retarget <= 0) {
      target = botTarget(world, pointer);
      retarget = RETARGET_SECONDS;
    }
    if (target) {
      const dx = target.x - pointer.x;
      const dy = target.y - pointer.y;
      const dist = Math.hypot(dx, dy);
      const move = Math.min(dist, POINTER_SPEED * STEP);
      if (dist > 0) pointer = { x: pointer.x + (dx / dist) * move, y: pointer.y + (dy / dist) * move };
    }
    world.pointer = pointer;
    world.update(STEP);
    world.drainEvents();
  }
  return { earned: world.earned, seconds: world.elapsed, caught: world.caught };
}

/** A visible fish unlock the bot is willing to save for: no more than this many rounds of income. */
const SAVE_FOR_UNLOCK_ROUNDS = 2;

/**
 * Buys like an eager player: a new fish type as soon as it's affordable, and saves for one that's
 * nearly affordable. Otherwise the cheapest node first.
 */
function shop(upgrades: Upgrades, money: number, lastEarned: number): { upgrades: Upgrades; money: number; bought: string[] } {
  const bought: string[] = [];
  const cost = (n: TechNode): number => nextCost(n, levelOf(n, upgrades));
  for (;;) {
    const unlocks = TECH_NODES.filter((n) => n.id.endsWith(".unlock") && isVisible(n, upgrades) && !isMaxed(n, upgrades));
    const saving = unlocks.find((n) => cost(n) > money && cost(n) <= lastEarned * SAVE_FOR_UNLOCK_ROUNDS);
    const options = TECH_NODES.filter((n) => canBuy(n, upgrades, money - (saving ? cost(saving) : 0)));
    const affordableUnlock = unlocks.find((n) => cost(n) <= money);
    const pick = affordableUnlock ?? options.reduce<TechNode | undefined>((a, b) => (a && cost(a) <= cost(b) ? a : b), undefined);
    if (!pick) return { upgrades, money, bought };
    const result = buy(upgrades, money, pick.id)!;
    upgrades = result.upgrades;
    money = result.money;
    bought.push(pick.id);
  }
}

const minutes = (s: number): string => `${(s / 60).toFixed(1)} min`;

describe.runIf(import.meta.env.PACING)("pacing", () => {
  it("finishes the tree in a reasonable time", { timeout: 600_000 }, () => {
    let upgrades: Upgrades = {};
    let money = 0;
    let roundSeconds = 0;
    let rounds = 0;
    const lines: string[] = [];
    const milestones: string[] = [];
    const maxedAt: string[] = [];

    while (!isTreeComplete(upgrades) && rounds < MAX_ROUNDS) {
      rounds++;
      const round = playRound(upgrades, 1000 + rounds);
      roundSeconds += round.seconds;
      money += round.earned;
      const result = shop(upgrades, money, round.earned);
      upgrades = result.upgrades;
      money = result.money;
      const now = minutes(roundSeconds + rounds * HUB_SECONDS);
      for (const id of result.bought) {
        if (id.endsWith(".unlock")) milestones.push(`${id} at round ${rounds} (${now})`);
        if (isMaxed(getNode(id)!, upgrades)) maxedAt.push(`${id} maxed at ${now}`);
      }
      if (rounds <= 3 || rounds % 10 === 0) {
        const owned = TECH_NODES.reduce((sum, n) => sum + levelOf(n, upgrades), 0);
        const caught = Object.values(round.caught).reduce((sum, n) => sum + (n ?? 0), 0);
        lines.push(
          [
            `round ${String(rounds).padStart(3)}`,
            `${minutes(roundSeconds + rounds * HUB_SECONDS).padStart(9)}`,
            `${round.seconds.toFixed(0).padStart(3)} s`,
            `${(caught / round.seconds).toFixed(1).padStart(5)} fish/s`,
            `earned $${Math.round(round.earned).toLocaleString("en-US").padStart(9)}`,
            `levels ${String(owned).padStart(3)}`,
          ].join("  "),
        );
      }
    }

    const total = roundSeconds + rounds * HUB_SECONDS;
    console.log(
      [
        `Tree cost $${totalTreeCost().toLocaleString("en-US")}, ${TECH_NODES.length} nodes`,
        ...lines,
        ...milestones,
        "Last nodes maxed:",
        ...maxedAt.slice(-15),
        `Complete: ${isTreeComplete(upgrades)} after ${rounds} rounds`,
        `In rounds ${minutes(roundSeconds)}, with ${HUB_SECONDS} s per round in the hub ${minutes(total)}`,
      ].join("\n"),
    );
    expect(isTreeComplete(upgrades)).toBe(true);
  });
});
