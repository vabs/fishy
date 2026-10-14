import { drawPlaceholder } from "./placeholder";
import type { FishSpec } from "./types";

/** Spawner. Design: slow, bobs, reverses; on capture bursts into fish of its tier. Not implemented yet. */
export const goober: FishSpec = {
  def: {
    name: "Goober",
    hp: 6,
    value: 5,
    speed: 20,
    size: 34,
    wobble: 22,
    wobbleSpeed: 1.2,
    body: "#ff8fab",
    fin: "#d95c7c",
  },
  shape: drawPlaceholder,
};
