import { drawPlaceholder } from "./placeholder";
import type { FishSpec } from "./types";

/** Tanky, high value. Design: armour reduces every hit by a flat amount. Not implemented yet. */
export const rare: FishSpec = {
  def: {
    name: "Rare",
    hp: 8,
    value: 12,
    speed: 25,
    size: 40,
    wobble: 6,
    wobbleSpeed: 1,
    body: "#5b8def",
    fin: "#2f5fbf",
  },
  shape: drawPlaceholder,
};
