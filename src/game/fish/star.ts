import { drawPlaceholder } from "./placeholder";
import type { FishSpec } from "./types";

/** Special. Design: on capture becomes a projectile bouncing off the screen edges. Not implemented yet. */
export const star: FishSpec = {
  def: {
    name: "Star",
    hp: 3,
    value: 10,
    speed: 90,
    size: 22,
    wobble: 14,
    wobbleSpeed: 3,
    body: "#ffd166",
    fin: "#e0a526",
  },
  shape: drawPlaceholder,
};
