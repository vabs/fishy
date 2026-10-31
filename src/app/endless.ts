import type { EndlessRecords, SaveData } from "../save";

/** Endless stays unlocked when Play Again retains previous sessions. */
export function endlessUnlocked(save: SaveData): boolean {
  return save.round > 1 || save.endless.sessions > 0;
}

/** Elapsed seconds as m:ss, keeping long sessions readable without wrapping hours. */
export function formatSeaTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Strictly improved personal bests; cumulative totals and tied records aren't new records. */
export function endlessRecordsDiff(before: EndlessRecords, after: EndlessRecords): string[] {
  const records = [ ["bestEarnings", "Best session earnings"], ["bestFish", "Most fish caught"],
    ["longestMs", "Longest trip"], ["bestCombo", "Best combo"] ] as const;
  return records.filter(([key]) => after[key] > before[key]).map(([, label]) => label);
}
