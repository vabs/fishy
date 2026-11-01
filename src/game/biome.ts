import type { FishKind } from "./fish";

/** The three seas visited during an Endless trip, in sailing order. */
export type Biome = "reef" | "trench" | "graveyard";

/** Seconds per biome and the visual crossfade into the next one. */
export const BIOME: { length: 300; crossfade: 8; order: readonly Biome[] } = {
  length: 300, crossfade: 8, order: ["reef", "trench", "graveyard"],
};

/**
 * Pure trip clock. Blend rises from 0 to 1 during the last eight seconds before a boundary;
 * the new biome takes over at the boundary, when its spawn and event multipliers change too.
 */
export function biomeAt(elapsed: number): { biome: Biome; next: Biome; progress: number; blend: number } {
  const time = Math.max(0, elapsed);
  const index = Math.floor(time / BIOME.length) % BIOME.order.length;
  const seconds = time % BIOME.length;
  return {
    biome: BIOME.order[index]!,
    next: BIOME.order[(index + 1) % BIOME.order.length]!,
    progress: seconds / BIOME.length,
    blend: Math.max(0, (seconds - (BIOME.length - BIOME.crossfade)) / BIOME.crossfade),
  };
}

/** Multiplier for an unlocked kind's spawn clock and its share of randomly picked fish. */
export function biomeSpawnMult(biome: Biome, kind: FishKind): number {
  if (biome === "reef" && (kind === "normal" || kind === "uncommon")) return 1.2;
  if (biome === "trench") {
    if (kind === "rare") return 2;
    if (kind === "electric") return 1.5;
  }
  if (biome === "graveyard" && (kind === "goober" || kind === "monster")) return 1.5;
  return 1;
}

/** Golden fish arrive more often in the Trench. */
export function biomeGoldenMult(biome: Biome): number {
  return biome === "trench" ? 1.5 : 1;
}

/** The Graveyard shortens the interval between chests to a third of its usual length. */
export function biomeChestGapMult(biome: Biome): number {
  return biome === "graveyard" ? 1 / 3 : 1;
}

/** Biome name shared by the HUD, trip log and entry announcements. */
export function biomeLabel(biome: Biome): string {
  return { reef: "Shallow Reef", trench: "Abyssal Trench", graveyard: "Sunken Graveyard" }[biome];
}
