import { drawPlaceholder } from "./placeholder";
import type { FishSpec } from "./types";

/** Chain capture. Design: flees the cursor; on capture may net nearby fish. Not implemented yet. */
export const epic: FishSpec = {
  def: {
    name: "Epic",
    hp: 5,
    value: 15,
    speed: 45,
    size: 32,
    wobble: 8,
    wobbleSpeed: 1.4,
    body: "#b07cf2",
    fin: "#7a45c4",
  },
  shape: drawPlaceholder,
};
