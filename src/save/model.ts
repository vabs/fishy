import type { Bounty } from "../game/bounties";

export const SAVE_KEY = "fishy.save";
export const SAVE_VERSION = 2;
export const NAME_MAX_LENGTH = 24;

/** Shown to the player when a save can't be loaded. */
export const SAVE_ERRORS = {
  notASave: "This file isn't a Fishy save.",
  newer: "This save is from a newer version of Fishy. Reload the page to update the game, then try again.",
  tooOld: "This save is from an old version of Fishy that can't be loaded anymore.",
  damaged: "This save file is damaged or incomplete, so it can't be loaded.",
} as const;

/** Personal bests and totals across every Endless session, retained by Play Again. */
export interface EndlessRecords {
  sessions: number;
  totalFish: number;
  timeMs: number;
  bestEarnings: number;
  bestFish: number;
  longestMs: number;
  bestCombo: number;
}

/** Everything the game keeps between visits. Stored as JSON under SAVE_KEY. */
export interface SaveData {
  version: 2;
  playerName: string;
  money: number;
  /** The next round to play, starting at 1. */
  round: number;
  /** Tech node id -> level. */
  upgrades: Record<string, number>;
  stats: {
    totalFish: number;
    fishByType: Record<string, number>;
    bestRoundEarnings: number;
    playTimeMs: number;
    lastRoundEarnings: number;
    goldenCaught: number;
    chestsOpened: number;
    bestCombo: number;
    bestTickCatches: number;
    bestStarHits: number;
    bountiesCompleted: number;
    perfectBountyRounds: number;
  };
  endless: EndlessRecords;
  /** Achievement id -> ISO time earned. Unknown ids are retained for forward compatibility. */
  achievements: Record<string, string>;
  /** The next timed round's board; survives a reload without rerolling. */
  bounties: { round: number; list: Bounty[] } | null;
  finalRoundDone: boolean;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
}

/** What a save needs to know about a tech node to check an imported level. */
export interface NodeInfo {
  id: string;
  maxLevel: number;
}

/** A timed round's earnings, captures and achievement records. */
export interface RoundResult {
  earned: number;
  caught: Partial<Record<string, number>>;
  durationMs: number;
  goldenCaught?: number;
  chestsOpened?: number;
  maxCombo?: number;
  bestTickCatches?: number;
  bestStarHits?: number;
  bountiesCompleted?: number;
  /** Paid on top of earned, never included in the round's earnings records. */
  bountyReward?: number;
  allBounties?: boolean;
}

/** Endless earnings are personal records, never campaign currency. */
export interface EndlessResult {
  earned: number;
  caught: Partial<Record<string, number>>;
  durationMs: number;
  maxCombo: number;
  goldenCaught: number;
  chestsOpened: number;
}

export type NameResult = { ok: true; name: string } | { ok: false; error: string };

/** Control characters and line/paragraph separators: never valid in a name. */
const FORBIDDEN_IN_NAME = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const FORBIDDEN_IN_NAME_ALL = new RegExp(FORBIDDEN_IN_NAME.source, "gu");

/** A new game. `playerName` should already have passed validateName. */
export function createSave(playerName: string, now = new Date()): SaveData {
  const time = now.toISOString();
  return {
    version: SAVE_VERSION,
    playerName,
    money: 0,
    round: 1,
    upgrades: {},
    stats: {
      totalFish: 0, fishByType: {}, bestRoundEarnings: 0, playTimeMs: 0,
      lastRoundEarnings: 0, goldenCaught: 0, chestsOpened: 0, bestCombo: 0,
      bestTickCatches: 0, bestStarHits: 0, bountiesCompleted: 0, perfectBountyRounds: 0,
    },
    endless: { sessions: 0, totalFish: 0, timeMs: 0, bestEarnings: 0, bestFish: 0, longestMs: 0, bestCombo: 0 },
    achievements: {},
    bounties: null,
    finalRoundDone: false,
    createdAt: time,
    updatedAt: time,
  };
}

/** Shared lifetime stats: Endless contributes catches and time, without timed-round records. */
function lifetimeStats(save: SaveData, result: RoundResult | EndlessResult): SaveData["stats"] {
  const fishByType = { ...save.stats.fishByType };
  let caught = 0;
  for (const [kind, count] of Object.entries(result.caught)) {
    if (!count) continue;
    fishByType[kind] = (fishByType[kind] ?? 0) + count;
    caught += count;
  }
  return {
    ...save.stats,
    totalFish: save.stats.totalFish + caught,
    fishByType,
    playTimeMs: save.stats.playTimeMs + result.durationMs,
    goldenCaught: save.stats.goldenCaught + (result.goldenCaught ?? 0),
    chestsOpened: save.stats.chestsOpened + (result.chestsOpened ?? 0),
    bestCombo: Math.max(save.stats.bestCombo, result.maxCombo ?? 0),
  };
}

/** Banks a finished round and its bounty rewards, advances the campaign and clears the board. */
export function recordRound(save: SaveData, result: RoundResult): SaveData {
  return {
    ...save,
    money: save.money + result.earned + (result.bountyReward ?? 0),
    round: save.round + 1,
    upgrades: { ...save.upgrades },
    stats: {
      ...lifetimeStats(save, result),
      bestRoundEarnings: Math.max(save.stats.bestRoundEarnings, result.earned),
      lastRoundEarnings: result.earned,
      bestTickCatches: Math.max(save.stats.bestTickCatches, result.bestTickCatches ?? 0),
      bestStarHits: Math.max(save.stats.bestStarHits, result.bestStarHits ?? 0),
      bountiesCompleted: save.stats.bountiesCompleted + (result.bountiesCompleted ?? 0),
      perfectBountyRounds: save.stats.perfectBountyRounds + (result.allBounties ? 1 : 0),
    },
    bounties: null,
  };
}

/** Records an Endless session without changing the campaign or its earnings records. */
export function recordEndless(save: SaveData, result: EndlessResult): SaveData {
  const stats = lifetimeStats(save, result);
  const caught = stats.totalFish - save.stats.totalFish;
  return {
    ...save,
    stats,
    endless: {
      sessions: save.endless.sessions + 1,
      totalFish: save.endless.totalFish + caught,
      timeMs: save.endless.timeMs + result.durationMs,
      bestEarnings: Math.max(save.endless.bestEarnings, result.earned),
      bestFish: Math.max(save.endless.bestFish, caught),
      longestMs: Math.max(save.endless.longestMs, result.durationMs),
      bestCombo: Math.max(save.endless.bestCombo, result.maxCombo),
    },
  };
}

/** Stores the next timed round's board, copying it so callers cannot mutate the saved challenges. */
export function setBounties(save: SaveData, board: { round: number; list: Bounty[] } | null): SaveData {
  return { ...save, bounties: board ? { round: board.round, list: board.list.map((b) => ({ ...b })) } : null };
}

/** "Play Again": a fresh campaign that keeps the name, achievement times and Endless records. */
export function resetProgress(save: SaveData, now = new Date()): SaveData {
  return { ...createSave(save.playerName, now), achievements: { ...save.achievements }, endless: { ...save.endless } };
}

/** Checks a name typed by the player. Length counts characters (code points), so emoji count once. */
export function validateName(raw: string): NameResult {
  const name = raw.trim();
  if (!name) return { ok: false, error: "Enter a name." };
  if (FORBIDDEN_IN_NAME.test(name)) {
    return { ok: false, error: "Names can't contain tabs, line breaks or other control characters." };
  }
  if ([...name].length > NAME_MAX_LENGTH) {
    return { ok: false, error: `Keep it to ${NAME_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, name };
}

/**
 * Repairs a name read from a file (which may have been hand-edited) instead of rejecting it:
 * strips forbidden characters and cuts it to length. Null if nothing usable is left.
 */
export function repairName(raw: string): string | null {
  const cleaned = raw.replace(FORBIDDEN_IN_NAME_ALL, "").trim();
  const name = [...cleaned].slice(0, NAME_MAX_LENGTH).join("").trim();
  return name || null;
}
