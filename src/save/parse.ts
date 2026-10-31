// zod/mini: same validation as "zod" for these simple types, at a fraction of the bundle size.
import * as z from "zod/mini";
import { FISH_KINDS } from "../game/fish";
import { MIGRATIONS, migrate, type Migrations, type RawSave } from "./migrations";
import { SAVE_ERRORS, SAVE_VERSION, repairName, type NodeInfo, type SaveData } from "./model";

export type SaveResult = { ok: true; save: SaveData } | { ok: false; error: string };

/**
 * The shape of a current-version save. Deliberately loose on values (any number, any string):
 * out-of-range values are repaired afterwards rather than rejecting the whole save.
 */
const saveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  playerName: z.string(),
  money: z.number(),
  round: z.number(),
  upgrades: z.record(z.string(), z.number()),
  stats: z.object({
    totalFish: z.number(),
    fishByType: z.record(z.string(), z.number()),
    bestRoundEarnings: z.number(),
    playTimeMs: z.number(),
    lastRoundEarnings: z.number(),
    goldenCaught: z.number(),
    chestsOpened: z.number(),
    bestCombo: z.number(),
    bestTickCatches: z.number(),
    bestStarHits: z.number(),
    bountiesCompleted: z.number(),
    perfectBountyRounds: z.number(),
  }),
  endless: z.object({
    sessions: z.number(), totalFish: z.number(), timeMs: z.number(), bestEarnings: z.number(),
    bestFish: z.number(), longestMs: z.number(), bestCombo: z.number(),
  }),
  // Invalid individual badges and challenges are discarded without losing the campaign.
  achievements: z.unknown(),
  bounties: z.unknown(),
  finalRoundDone: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const BYTE_ORDER_MARK = 0xfeff;

/** Upper bound for every stored number, so arithmetic on them stays exact. */
const MAX_NUMBER = Number.MAX_SAFE_INTEGER;

const bountySchema = z.object({
  id: z.string().check(z.minLength(1)),
  kind: z.enum(["catch", "combo", "golden", "chest", "haul", "earn", "frenzy"]),
  fish: z.optional(z.enum(FISH_KINDS)),
  target: z.number().check(z.gt(0), z.lte(MAX_NUMBER)),
  reward: z.number().check(z.gte(0), z.lte(MAX_NUMBER)),
});
const boardSchema = z.object({ round: z.number().check(z.int(), z.gte(1)), list: z.array(z.unknown()) });
const achievementTimesSchema = z.record(z.string(), z.unknown());
const isoTimeSchema = z.iso.datetime({ offset: true });

function repairBounties(value: unknown): SaveData["bounties"] {
  if (value === null) return null;
  const board = boardSchema.safeParse(value);
  if (!board.success) return null;
  return {
    round: board.data.round,
    list: board.data.list.flatMap((entry) => {
      const bounty = bountySchema.safeParse(entry);
      if (!bounty.success || (bounty.data.kind === "catch" && !bounty.data.fish)) return [];
      return [bounty.data];
    }),
  };
}

/** Unknown achievement ids are harmless and preserved; only valid ISO timestamp strings survive. */
function repairAchievements(value: unknown): Record<string, string> {
  const times = achievementTimesSchema.safeParse(value);
  if (!times.success) return {};
  return Object.fromEntries(Object.entries(times.data).flatMap(([id, time]) => {
    const iso = isoTimeSchema.safeParse(time);
    return iso.success ? [[id, iso.data]] : [];
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Number.isNaN(value) ? min : Math.min(Math.max(value, min), max);
}

const amount = (value: number): number => clamp(value, 0, MAX_NUMBER);
const count = (value: number): number => Math.floor(amount(value));

function mapValues(record: Record<string, number>, fn: (value: number) => number): Record<string, number> {
  // fromEntries defines own properties, so a "__proto__" key stays a plain key.
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fn(value)]));
}

function isoOr(text: string, fallback: Date): string {
  const time = Date.parse(text);
  return new Date(Number.isNaN(time) ? fallback : time).toISOString();
}

function isRawSave(value: unknown): value is RawSave {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const version: unknown = (value as Record<string, unknown>).version;
  return typeof version === "number" && Number.isInteger(version) && version >= 0;
}

/** Brings every number into a sane non-negative range, and repairs the name and timestamps. */
function repair(save: z.infer<typeof saveSchema>, playerName: string, now: Date): SaveData {
  return {
    ...save,
    playerName,
    money: amount(save.money),
    round: Math.max(1, count(save.round)),
    upgrades: mapValues(save.upgrades, count),
    stats: {
      totalFish: count(save.stats.totalFish),
      fishByType: mapValues(save.stats.fishByType, count),
      bestRoundEarnings: amount(save.stats.bestRoundEarnings),
      playTimeMs: amount(save.stats.playTimeMs),
      lastRoundEarnings: amount(save.stats.lastRoundEarnings),
      goldenCaught: count(save.stats.goldenCaught),
      chestsOpened: count(save.stats.chestsOpened),
      bestCombo: amount(save.stats.bestCombo),
      bestTickCatches: count(save.stats.bestTickCatches),
      bestStarHits: count(save.stats.bestStarHits),
      bountiesCompleted: count(save.stats.bountiesCompleted),
      perfectBountyRounds: count(save.stats.perfectBountyRounds),
    },
    endless: {
      sessions: count(save.endless.sessions),
      totalFish: count(save.endless.totalFish),
      timeMs: amount(save.endless.timeMs),
      bestEarnings: amount(save.endless.bestEarnings),
      bestFish: count(save.endless.bestFish),
      longestMs: amount(save.endless.longestMs),
      bestCombo: amount(save.endless.bestCombo),
    },
    achievements: repairAchievements(save.achievements),
    bounties: repairBounties(save.bounties),
    createdAt: isoOr(save.createdAt, now),
    updatedAt: isoOr(save.updatedAt, now),
  };
}

/**
 * Turns parsed JSON into a current-version save: checks the version, migrates, validates the shape
 * and repairs out-of-range values. Upgrade ids are not checked here (see sanitizeUpgrades).
 */
export function decodeSave(value: unknown, migrations: Migrations = MIGRATIONS, now = new Date()): SaveResult {
  if (!isRawSave(value)) return { ok: false, error: SAVE_ERRORS.notASave };
  if (value.version > SAVE_VERSION) return { ok: false, error: SAVE_ERRORS.newer };

  const migrated = migrate(value, migrations);
  if (!migrated.ok) return migrated;

  const parsed = saveSchema.safeParse(migrated.save);
  if (!parsed.success) return { ok: false, error: SAVE_ERRORS.damaged };

  const playerName = repairName(parsed.data.playerName);
  if (!playerName) return { ok: false, error: SAVE_ERRORS.damaged };

  return { ok: true, save: repair(parsed.data, playerName, now) };
}

/** decodeSave for JSON text. */
export function decodeSaveText(text: string, migrations: Migrations = MIGRATIONS): SaveResult {
  // Some editors add a byte order mark, which JSON.parse rejects.
  const json = text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, error: SAVE_ERRORS.notASave };
  }
  return decodeSave(value, migrations);
}

/**
 * Keeps only upgrades the tech tree knows, at whole levels within [0, maxLevel]. Run on every save
 * the game loads, since the tree can change between versions.
 */
export function sanitizeUpgrades(
  upgrades: Readonly<Record<string, number>>,
  nodes: readonly NodeInfo[],
): Record<string, number> {
  const maxLevels = new Map(nodes.map((node) => [node.id, node.maxLevel]));
  const kept: [string, number][] = [];
  for (const [id, level] of Object.entries(upgrades)) {
    const maxLevel = maxLevels.get(id);
    if (maxLevel !== undefined) kept.push([id, Math.floor(clamp(level, 0, maxLevel))]);
  }
  return Object.fromEntries(kept);
}

/**
 * Reads an imported save file. Errors are written for the player. `migrations` is only overridden
 * by tests.
 */
export function parseSave(text: string, nodes: readonly NodeInfo[], migrations: Migrations = MIGRATIONS): SaveResult {
  const result = decodeSaveText(text, migrations);
  if (!result.ok) return result;
  return { ok: true, save: { ...result.save, upgrades: sanitizeUpgrades(result.save.upgrades, nodes) } };
}
