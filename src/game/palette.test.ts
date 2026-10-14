import { afterEach, describe, expect, it, vi } from "vitest";
import { FISH, FISH_KINDS, type FishKind } from "./fish";
import { COLOR_BLIND_FISH, fishColors, getPalette, onPaletteChange, setPalette } from "./palette";

/*
 * How the colour-blind palette looks to colour-blind players. Each colour is run through the
 * Machado, Oliveira & Fernandes (2009) simulation of protanopia, deuteranopia and tritanopia at full
 * severity, applied in linear RGB, then compared in CIE Lab (D65) with the CIEDE2000 formula.
 *
 * Threshold: ΔE00 ≥ 15 for every pair of body colours. A ΔE00 of about 1 is just noticeable between
 * two large patches side by side, and 10 or so reads as clearly different colours. Fish are small,
 * they move, and the player has to recognise a type rather than notice that two patches differ, so
 * the test asks for half again that. The standard palette falls far short: Rare and Epic are 1.2
 * apart under protanopia, Electric and Star 3.5 under deuteranopia.
 */
const MIN_DISTANCE = 15;
/** Each body must also stand out from the sea, or the fish would vanish in the net's lens. */
const MIN_WATER_DISTANCE = 10;
const WATER = ["#2b8cab", "#124e6b"];

type Rgb = [number, number, number];
type Lab = [number, number, number];

/** Machado et al. 2009, severity 1.0, for linear RGB. Rows are R', G', B'. */
const VISION: Record<string, number[]> = {
  normal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

function linearRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return [linear(((n >> 16) & 0xff) / 255), linear(((n >> 8) & 0xff) / 255), linear((n & 0xff) / 255)];
}

/** The colour as someone with this kind of vision sees it, in CIE Lab. */
function seen(hex: string, vision: string): Lab {
  const m = VISION[vision]!;
  const [r, g, b] = linearRgb(hex);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const R = clamp(m[0]! * r + m[1]! * g + m[2]! * b);
  const G = clamp(m[3]! * r + m[4]! * g + m[5]! * b);
  const B = clamp(m[6]! * r + m[7]! * g + m[8]! * b);
  // Linear sRGB to XYZ, relative to the D65 white.
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIEDE2000 colour difference (Sharma, Wu & Dalal 2005), with kL = kC = kH = 1. */
function deltaE2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const deg = Math.PI / 180;
  const C = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(C ** 7 / (C ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1 = Math.hypot(a1p, b1);
  const C2 = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / deg + 360) % 360);
  const h1 = hue(b1, a1p);
  const h2 = hue(b2, a2p);
  let dh = 0;
  if (C1 * C2 !== 0) dh = h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 < -180 ? h2 - h1 + 360 : h2 - h1;
  const dL = L2 - L1;
  const dC = C2 - C1;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh * deg) / 2);
  const L = (L1 + L2) / 2;
  const Cp = (C1 + C2) / 2;
  let h = h1 + h2;
  if (C1 * C2 !== 0) h = (Math.abs(h1 - h2) > 180 ? h + (h < 360 ? 360 : -360) : h) / 2;
  const T = 1 - 0.17 * Math.cos((h - 30) * deg) + 0.24 * Math.cos(2 * h * deg) + 0.32 * Math.cos((3 * h + 6) * deg) - 0.2 * Math.cos((4 * h - 63) * deg);
  const SL = 1 + (0.015 * (L - 50) ** 2) / Math.sqrt(20 + (L - 50) ** 2);
  const SC = 1 + 0.045 * Cp;
  const SH = 1 + 0.015 * Cp * T;
  const RT = -Math.sin(2 * 30 * Math.exp(-(((h - 275) / 25) ** 2)) * deg) * 2 * Math.sqrt(Cp ** 7 / (Cp ** 7 + 25 ** 7));
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

/** Every pair of types and how far apart their bodies look, closest first. */
function pairs(bodies: Record<FishKind, string>, vision: string): { pair: string; distance: number }[] {
  const out: { pair: string; distance: number }[] = [];
  FISH_KINDS.forEach((a, i) => {
    for (const b of FISH_KINDS.slice(i + 1)) {
      out.push({ pair: `${a}/${b}`, distance: deltaE2000(seen(bodies[a], vision), seen(bodies[b], vision)) });
    }
  });
  return out.sort((x, y) => x.distance - y.distance);
}

const colorBlindBodies = Object.fromEntries(FISH_KINDS.map((kind) => [kind, COLOR_BLIND_FISH[kind].body])) as Record<FishKind, string>;

afterEach(() => setPalette("standard"));

describe("CIEDE2000", () => {
  it("matches published test pairs", () => {
    // Sharma, Wu & Dalal (2005), pairs 1, 7 and 19.
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE2000([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 4);
    expect(deltaE2000([50, 2.5, 0], [56, -27, -3])).toBeCloseTo(31.903, 3);
  });
});

describe("colour-blind palette", () => {
  it.each(Object.keys(VISION))("keeps every pair of fish bodies apart with %s", (vision) => {
    const closest = pairs(colorBlindBodies, vision)[0]!;
    expect(closest.distance, `${closest.pair} under ${vision}`).toBeGreaterThanOrEqual(MIN_DISTANCE);
  });

  it.each(Object.keys(VISION))("keeps every fish body clear of the water with %s", (vision) => {
    for (const kind of FISH_KINDS) {
      for (const water of WATER) {
        const distance = deltaE2000(seen(colorBlindBodies[kind], vision), seen(water, vision));
        expect(distance, `${kind} on ${water} under ${vision}`).toBeGreaterThanOrEqual(MIN_WATER_DISTANCE);
      }
    }
  });
});

describe("fishColors", () => {
  it("is each type's own colours in the standard palette, with tint left alone", () => {
    for (const kind of FISH_KINDS) {
      const colors = fishColors(kind, "standard");
      expect([colors.body, colors.fin]).toEqual([FISH[kind].body, FISH[kind].fin]);
      expect(colors.tint("#ffd0dc")).toBe("#ffd0dc");
    }
  });

  it("follows the active palette", () => {
    expect(getPalette()).toBe("standard");
    expect(fishColors("rare").body).toBe(FISH.rare.body);
    setPalette("colorBlind");
    expect(fishColors("rare")).toBe(fishColors("rare", "colorBlind"));
    expect(fishColors("rare").body).toBe(COLOR_BLIND_FISH.rare.body);
  });

  it("tints other colours along with the body, keeping neutrals neutral", () => {
    const star = fishColors("star", "colorBlind");
    // The Star is white in this palette, so its golden glow turns grey: no hue left to clash with Electric.
    const [r, g, b] = linearRgb(star.tint("#ffb703"));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.01);
    expect(fishColors("goober", "colorBlind").tint("#ffffff")).toBe("#ffffff");
    expect(fishColors("goober", "colorBlind").tint("#ffd0dc")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("palette changes", () => {
  it("tells listeners once per real change, until they stop listening", () => {
    const listener = vi.fn();
    const stop = onPaletteChange(listener);
    setPalette("colorBlind");
    setPalette("colorBlind");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("colorBlind");
    stop();
    setPalette("standard");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("never reaches the simulation: world and fish code don't import the palette", () => {
    const sources = import.meta.glob<string>(["./world.ts", "./stats.ts", "./fish-grid.ts", "./rng.ts", "./fish/*.ts"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    expect(Object.keys(sources).length).toBeGreaterThan(8);
    for (const [file, source] of Object.entries(sources)) expect(source, file).not.toMatch(/palette"/);
  });
});
