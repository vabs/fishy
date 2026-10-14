import { drawPlaceholder } from "./placeholder";
import type { FishSpec } from "./types";

/** Early value bump. Design: spawns in a school of 3–5 that swim together. Not implemented yet. */
export const uncommon: FishSpec = {
  def: {
    name: "Uncommon",
    hp: 3,
    value: 3,
    speed: 55,
    size: 26,
    wobble: 8,
    wobbleSpeed: 2,
    body: "#7bd389",
    fin: "#3f9e57",
  },
  shape: drawPlaceholder,
};
