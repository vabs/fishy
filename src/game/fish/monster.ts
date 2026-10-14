import { drawPlaceholder } from "./placeholder";
import type { FishSpec } from "./types";

/** Whirlpool. Design: pulls nearby fish into a vortex; on capture takes everything in it. Not implemented yet. */
export const monster: FishSpec = {
  def: {
    name: "Monster",
    hp: 60,
    value: 80,
    speed: 15,
    size: 90,
    wobble: 12,
    wobbleSpeed: 0.5,
    body: "#8d99ae",
    fin: "#5c677d",
    maxOnScreen: 1,
  },
  shape: drawPlaceholder,
};
