export type FishKind = "normal";

export interface FishDef {
  name: string;
  hp: number;
  /** Money paid when captured, before multipliers. */
  value: number;
  /** Speed along the orbit, px/s. The same wherever the fish spawned. */
  speed: number;
  /** Body length, px. */
  size: number;
  /** How far the fish drifts in and out of its orbit, px. */
  wobble: number;
  /** How fast it drifts in and out, radians/s. */
  wobbleSpeed: number;
  body: string;
  fin: string;
}

export const FISH: Record<FishKind, FishDef> = {
  normal: {
    name: "Normal",
    hp: 2,
    value: 1,
    speed: 40,
    size: 28,
    wobble: 10,
    wobbleSpeed: 1.6,
    body: "#f4a259",
    fin: "#d1712a",
  },
};

export const FISH_KINDS = Object.keys(FISH) as FishKind[];

export const MAX_FISH_SIZE = Math.max(...FISH_KINDS.map((kind) => FISH[kind].size));
