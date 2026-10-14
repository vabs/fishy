import { electric } from "./electric";
import { epic } from "./epic";
import { goober } from "./goober";
import { monster } from "./monster";
import { normal } from "./normal";
import { rare } from "./rare";
import { star } from "./star";
import type { FishDef, FishKind, FishSpec } from "./types";
import { uncommon } from "./uncommon";

export type { DrawShape, FishColors, FishDef, FishKind, FishSpec } from "./types";

export const FISH_SPECS: Record<FishKind, FishSpec> = {
  normal,
  uncommon,
  rare,
  electric,
  epic,
  goober,
  monster,
  star,
};

export const FISH_KINDS = Object.keys(FISH_SPECS) as FishKind[];

export const FISH = Object.fromEntries(FISH_KINDS.map((kind) => [kind, FISH_SPECS[kind].def])) as Record<
  FishKind,
  FishDef
>;

export const MAX_FISH_SIZE = Math.max(...FISH_KINDS.map((kind) => FISH[kind].size));
