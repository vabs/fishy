/*
 * The player's sound settings, stored under their own localStorage key so that Play Again and save
 * import (which only touch `fishy.save`) never change them.
 */

export const AUDIO_KEY = "fishy.audio";

export interface AudioSettings {
  muted: boolean;
  /** Music volume, 0 to 1 (slider position). */
  music: number;
  /** Sound effects volume, 0 to 1 (slider position). */
  sfx: number;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = { muted: false, music: 0.7, sfx: 0.8 };

function level(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

/** Reads stored settings, keeping whatever is valid and falling back to defaults for the rest. */
export function parseAudioSettings(raw: string | null): AudioSettings {
  let data: unknown = null;
  try {
    data = raw === null ? null : JSON.parse(raw);
  } catch {
    // Unreadable: defaults.
  }
  const fields = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return {
    muted: typeof fields.muted === "boolean" ? fields.muted : DEFAULT_AUDIO_SETTINGS.muted,
    music: level(fields.music, DEFAULT_AUDIO_SETTINGS.music),
    sfx: level(fields.sfx, DEFAULT_AUDIO_SETTINGS.sfx),
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

export function loadAudioSettings(storage?: Storage): AudioSettings {
  const store = storage ?? browserStorage();
  try {
    return parseAudioSettings(store?.getItem(AUDIO_KEY) ?? null);
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

/** Never throws: returns false if the browser refused, and the settings just last for this visit. */
export function writeAudioSettings(settings: AudioSettings, storage?: Storage): boolean {
  const store = storage ?? browserStorage();
  if (!store) return false;
  try {
    const { muted, music, sfx } = settings;
    store.setItem(AUDIO_KEY, JSON.stringify({ muted, music, sfx }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Gain for a volume slider position. Loudness is heard roughly logarithmically, so a squared curve
 * makes the slider feel even: halfway sounds about half as loud, not barely quieter.
 */
export function sliderToGain(position: number): number {
  const p = Math.min(1, Math.max(0, position));
  return p * p;
}
