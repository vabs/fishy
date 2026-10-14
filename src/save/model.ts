export const SAVE_KEY = "fishy.save";
export const SAVE_VERSION = 1;
export const NAME_MAX_LENGTH = 24;

/** Shown to the player when a save can't be loaded. */
export const SAVE_ERRORS = {
  notASave: "This file isn't a Fishy save.",
  newer: "This save is from a newer version of Fishy. Reload the page to update the game, then try again.",
  tooOld: "This save is from an old version of Fishy that can't be loaded anymore.",
  damaged: "This save file is damaged or incomplete, so it can't be loaded.",
} as const;

/** Everything the game keeps between visits. Stored as JSON under SAVE_KEY. */
export interface SaveData {
  version: 1;
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
  };
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

export interface RoundResult {
  earned: number;
  caught: Partial<Record<string, number>>;
  durationMs: number;
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
    stats: { totalFish: 0, fishByType: {}, bestRoundEarnings: 0, playTimeMs: 0 },
    finalRoundDone: false,
    createdAt: time,
    updatedAt: time,
  };
}

/** Banks a finished round: adds its money, moves on to the next round and updates lifetime stats. */
export function recordRound(save: SaveData, result: RoundResult): SaveData {
  const fishByType = { ...save.stats.fishByType };
  let caught = 0;
  for (const [kind, count] of Object.entries(result.caught)) {
    if (!count) continue;
    fishByType[kind] = (fishByType[kind] ?? 0) + count;
    caught += count;
  }
  return {
    ...save,
    money: save.money + result.earned,
    round: save.round + 1,
    upgrades: { ...save.upgrades },
    stats: {
      totalFish: save.stats.totalFish + caught,
      fishByType,
      bestRoundEarnings: Math.max(save.stats.bestRoundEarnings, result.earned),
      playTimeMs: save.stats.playTimeMs + result.durationMs,
    },
  };
}

/** "Play Again": a fresh game that keeps only the player's name. */
export function resetProgress(save: SaveData, now = new Date()): SaveData {
  return createSave(save.playerName, now);
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
