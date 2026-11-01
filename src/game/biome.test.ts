import { describe, expect, it } from "vitest";
import { BIOME, biomeAt, biomeChestGapMult, biomeGoldenMult, biomeLabel, biomeSpawnMult, type Biome } from "./biome";
import { FISH_KINDS } from "./fish";

describe("biomeAt", () => {
  it.each([
    [0, "reef", "trench", 0],
    [150, "reef", "trench", 0.5],
    [300, "trench", "graveyard", 0],
    [450, "trench", "graveyard", 0.5],
    [600, "graveyard", "reef", 0],
    [750, "graveyard", "reef", 0.5],
    [900, "reef", "trench", 0],
    [1800, "reef", "trench", 0],
  ] as const)("sails the loop at %i seconds", (elapsed, biome, next, progress) => {
    expect(biomeAt(elapsed)).toEqual({ biome, next, progress, blend: 0 });
  });

  it.each([300, 600, 900, 1200])("crossfades into the next biome over the eight seconds before %i", boundary => {
    expect(biomeAt(boundary - 9).blend).toBe(0);
    expect(biomeAt(boundary - 8).blend).toBe(0);
    expect(biomeAt(boundary - 6).blend).toBe(0.25);
    expect(biomeAt(boundary - 4).blend).toBe(0.5);
    expect(biomeAt(boundary - 2).blend).toBe(0.75);
    expect(biomeAt(boundary - 0.001).blend).toBeCloseTo(1, 3);
    const before = biomeAt(boundary - 0.001);
    const after = biomeAt(boundary);
    expect(after.biome).toBe(before.next);
    expect(after.progress).toBe(0);
    expect(after.blend).toBe(0);
  });

  it("treats a negative trip time as the start", () => {
    expect(biomeAt(-1)).toEqual(biomeAt(0));
    expect(BIOME.order).toEqual(["reef", "trench", "graveyard"]);
  });
});

describe("biome multipliers", () => {
  it.each([
    ["reef", [1.2, 1.2, 1, 1, 1, 1, 1, 1], 1, 1, "Shallow Reef"],
    ["trench", [1, 1, 2, 1.5, 1, 1, 1, 1], 1.5, 1, "Abyssal Trench"],
    ["graveyard", [1, 1, 1, 1, 1, 1.5, 1.5, 1], 1, 1 / 3, "Sunken Graveyard"],
  ] satisfies [Biome, number[], number, number, string][])("supplies %s's spawn and event rates", (biome, spawns, golden, chest, label) => {
    expect(FISH_KINDS.map(kind => biomeSpawnMult(biome, kind))).toEqual(spawns);
    expect(biomeGoldenMult(biome)).toBe(golden);
    expect(biomeChestGapMult(biome)).toBe(chest);
    expect(biomeLabel(biome)).toBe(label);
  });
});
