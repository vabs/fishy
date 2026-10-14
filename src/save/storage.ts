import { SAVE_KEY, type SaveData } from "./model";
import { decodeSaveText } from "./parse";

/** Where an unreadable save is moved, so a bug or bad edit never silently destroys progress. */
export const CORRUPT_SAVE_KEY = `${SAVE_KEY}.corrupt`;

/** localStorage, or null where the browser blocks it (e.g. site data disabled), since access throws there. */
function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The stored save, migrated to the current version, or null if there is none. A save that can't be
 * read is moved to CORRUPT_SAVE_KEY and null is returned, so the game starts fresh instead of crashing.
 * Upgrade ids are not checked against the tech tree here: run sanitizeUpgrades on the result.
 */
export function loadSave(storage?: Storage): SaveData | null {
  const store = storage ?? browserStorage();
  if (!store) return null;

  let raw: string | null;
  try {
    raw = store.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  const result = decodeSaveText(raw);
  if (result.ok) return result.save;

  console.warn(`Fishy: the saved game couldn't be read (${result.error}). Keeping it under "${CORRUPT_SAVE_KEY}".`);
  try {
    store.setItem(CORRUPT_SAVE_KEY, raw);
    store.removeItem(SAVE_KEY);
  } catch {
    // Couldn't make the backup, so leave the original where it is rather than lose it.
  }
  return null;
}

/**
 * Stores the save and stamps its updatedAt. Never throws: returns false if the browser refused
 * (storage full or blocked), in which case the game can carry on with the save in memory.
 */
export function writeSave(save: SaveData, storage?: Storage): boolean {
  save.updatedAt = new Date().toISOString();
  const store = storage ?? browserStorage();
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch (error) {
    console.error("Fishy: couldn't write the save.", error);
    return false;
  }
}
