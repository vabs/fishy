/*
 * How game state becomes audio parameters: which music chapter plays, how a catch is pitched, how
 * loud a batch of catches is and how much of the combo layer to bring in. Pure, so it's tested.
 */
import { SCALE_SIZE } from "./theory";

/**
 * Music chapters, switched in the hub as the game opens up, so one bed isn't heard for the whole
 * 1–1.5 hours. `from` is the upgrade that starts the chapter.
 */
export const CHAPTERS: readonly { name: string; from: string | null }[] = [
  { name: "Shallows", from: null },
  { name: "Currents", from: "electric.unlock" },
  { name: "Deep", from: "monster.unlock" },
];

/** The latest chapter whose milestone upgrade is owned. */
export function chapterFor(upgrades: Readonly<Record<string, number>>): number {
  let chapter = 0;
  CHAPTERS.forEach(({ from }, index) => {
    const level = from ? upgrades[from] : 0;
    if (from && typeof level === "number" && level >= 1) chapter = index;
  });
  return chapter;
}

/** Catch notes climb this many scale steps (two octaves) before they stop rising. */
const CATCH_CLIMB = 2 * SCALE_SIZE;

/**
 * Scale degree of a catch note for a combo count (captures in the combo after the first): the
 * pitch climbs the pentatonic scale one step per capture for two octaves, then keeps cycling
 * through the top octave so long combos still move without going shrill.
 */
export function catchDegree(combo: number): number {
  const step = Math.max(0, Math.floor(combo));
  if (step < CATCH_CLIMB) return step;
  return CATCH_CLIMB - SCALE_SIZE + ((step - CATCH_CLIMB) % SCALE_SIZE);
}

/**
 * Loudness of one note standing in for `count` catches in the same moment: a bit louder for more,
 * but never more than 1.6×, so hundreds of catches a second stay one gentle note.
 */
export function batchLevel(count: number): number {
  if (count <= 1) return 1;
  return Math.min(1.6, 1 + 0.2 * Math.log2(count));
}

export interface ComboState {
  /** Current value multiplier from the combo (1 means no combo). */
  mult: number;
  /** Highest multiplier the player's upgrades allow. */
  max: number;
  /** Seconds since the last capture. */
  sinceCapture: number;
  /** Captures within this many seconds chain; 0 when combos aren't unlocked. */
  window: number;
}

/**
 * How much of the combo layer to play, 0 to 1: the share of the way to the highest multiplier, while
 * the combo is still alive. The game keeps the last multiplier until the next capture, so a combo
 * counts as over once its window has passed.
 */
export function comboLevel({ mult, max, sinceCapture, window }: ComboState): number {
  if (window <= 0 || max <= 1 || sinceCapture > window) return 0;
  return Math.min(1, Math.max(0, (mult - 1) / (max - 1)));
}
