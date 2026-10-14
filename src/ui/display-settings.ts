/*
 * The player's display settings, stored under their own localStorage key like the sound settings,
 * so Play Again and save import (which only touch `fishy.save`) never change them, and an export
 * doesn't carry them to another device.
 */

export const DISPLAY_KEY = "fishy.display";

export interface DisplaySettings {
  /** Fish drawn in the colour-blind palette (src/game/palette.ts). */
  colorBlind: boolean;
}

export const DEFAULT_DISPLAY_SETTINGS: Readonly<DisplaySettings> = { colorBlind: false };

/** Reads stored settings, keeping whatever is valid and falling back to defaults for the rest. */
export function parseDisplaySettings(raw: string | null): DisplaySettings {
  let data: unknown = null;
  try {
    data = raw === null ? null : JSON.parse(raw);
  } catch {
    // Unreadable: defaults.
  }
  const fields = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return {
    colorBlind: typeof fields.colorBlind === "boolean" ? fields.colorBlind : DEFAULT_DISPLAY_SETTINGS.colorBlind,
  };
}

/** localStorage, or null where the browser blocks it (access throws there). Mirrors src/save/storage.ts. */
function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The stored settings. Blocked or broken storage just means the defaults. */
export function loadDisplaySettings(storage?: Storage): DisplaySettings {
  const store = storage ?? browserStorage();
  try {
    return parseDisplaySettings(store?.getItem(DISPLAY_KEY) ?? null);
  } catch {
    return { ...DEFAULT_DISPLAY_SETTINGS };
  }
}

/** Never throws: returns false if the browser refused, and the settings just last for this visit. */
export function writeDisplaySettings(settings: DisplaySettings, storage?: Storage): boolean {
  const store = storage ?? browserStorage();
  if (!store) return false;
  try {
    store.setItem(DISPLAY_KEY, JSON.stringify({ colorBlind: settings.colorBlind }));
    return true;
  } catch {
    return false;
  }
}
