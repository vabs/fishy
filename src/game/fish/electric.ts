import { drawPlaceholder } from "./placeholder";
import type { FishSpec } from "./types";

/** Chain damage. Design: darts in bursts; on capture a current jumps fish to fish. Not implemented yet. */
export const electric: FishSpec = {
  def: {
    name: "Electric",
    hp: 4,
    value: 8,
    speed: 30,
    size: 38,
    wobble: 6,
    wobbleSpeed: 2.5,
    body: "#f7e04b",
    fin: "#c9a812",
  },
  shape: drawPlaceholder,
};
