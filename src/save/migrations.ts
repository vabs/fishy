import { SAVE_ERRORS, SAVE_VERSION } from "./model";

/** A parsed save before validation: any object, with a whole-number version. */
export type RawSave = Record<string, unknown> & { version: number };

/**
 * Turns a version n save into the shape of version n + 1. The input is unvalidated (old files can be
 * hand-edited), so read it defensively; the result is validated after the last step. `version` is set
 * for you.
 */
export type Migration = (save: Record<string, unknown>) => Record<string, unknown>;

export type Migrations = Readonly<Partial<Record<number, Migration>>>;

/**
 * MIGRATIONS[n] upgrades a version n save to version n + 1. When SaveData changes shape, bump
 * SAVE_VERSION and add the step from the previous version here, so stored saves and old exports
 * keep loading.
 */
export const MIGRATIONS: Migrations = {};

/** Runs every step from `save.version` up to `target`. */
export function migrate(
  save: RawSave,
  migrations: Migrations = MIGRATIONS,
  target: number = SAVE_VERSION,
): { ok: true; save: Record<string, unknown> } | { ok: false; error: string } {
  let current: Record<string, unknown> = save;
  for (let version = save.version; version < target; version++) {
    const step = migrations[version];
    if (!step) return { ok: false, error: SAVE_ERRORS.tooOld };
    try {
      current = { ...step(current), version: version + 1 };
    } catch {
      return { ok: false, error: SAVE_ERRORS.damaged };
    }
  }
  return { ok: true, save: current };
}
