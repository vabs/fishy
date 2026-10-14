import { FISH, type FishColors, type FishKind } from "./fish";

/*
 * Fish colours. "standard" is each type's own body and fin colours (FishDef). "colorBlind" swaps in
 * colours that stay apart under protanopia, deuteranopia and tritanopia (palette.test.ts measures
 * them), so a fish's colour backs up its outline as a second cue.
 *
 * Render and UI code read the active colours here and pass them to fish art; the simulation never
 * imports this module. The player's choice is stored apart from the save (src/ui/display-settings.ts).
 */

export type PaletteName = "standard" | "colorBlind";

/**
 * Body and fin colours for the colour-blind palette. Each type keeps its hue family where it can,
 * but the bodies are spread over lightness as well as hue, since lightness survives every kind of
 * colour blindness: white Star, lemon Electric, pale Rare and mint Uncommon at the top, raspberry
 * Goober at the bottom. Electric (yellow) and Star (white) no longer share a colour. The plain
 * Okabe–Ito set only reaches 11 in palette.test.ts with eight types, so these were found by a search
 * within each type's hue family, scored the same way. Fins keep the standard step down from the body.
 */
export const COLOR_BLIND_FISH: Record<FishKind, { body: string; fin: string }> = {
  normal: { body: "#da893a", fin: "#b55a00" },
  uncommon: { body: "#43dea2", fin: "#00a575" },
  rare: { body: "#b6c2f0", fin: "#8894c0" },
  electric: { body: "#ffe20a", fin: "#ceaa00" },
  epic: { body: "#b46fff", fin: "#7e31d2" },
  goober: { body: "#ca3157", fin: "#940031" },
  monster: { body: "#858a8e", fin: "#55595e" },
  star: { body: "#ffffff", fin: "#d7d7d7" },
};

let active: PaletteName = "standard";
const listeners = new Set<(palette: PaletteName) => void>();
const colors = new Map<string, FishColors>();

export function getPalette(): PaletteName {
  return active;
}

/** Switches palette and tells every listener, so cached sprites and icons can be redrawn. */
export function setPalette(palette: PaletteName): void {
  if (palette === active) return;
  active = palette;
  for (const listener of listeners) listener(palette);
}

/** Calls `listener` after every palette change. Returns a function that stops it. */
export function onPaletteChange(listener: (palette: PaletteName) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A fish type's colours in the active palette, or in `palette`. Cheap enough to call every frame. */
export function fishColors(kind: FishKind, palette: PaletteName = active): FishColors {
  const key = `${palette}:${kind}`;
  let found = colors.get(key);
  if (!found) {
    found = palette === "standard" ? standardColors(kind) : colorBlindColors(kind);
    colors.set(key, found);
  }
  return found;
}

function standardColors(kind: FishKind): FishColors {
  const { body, fin } = FISH[kind];
  return { body, fin, tint: (color) => color };
}

function colorBlindColors(kind: FishKind): FishColors {
  const { body, fin } = COLOR_BLIND_FISH[kind];
  const from = toOklch(FISH[kind].body);
  const to = toOklch(body);
  const turn = to.h - from.h;
  const scale = from.c > 1e-4 ? to.c / from.c : 0;
  const tints = new Map<string, string>();
  return {
    body,
    fin,
    // Keep the colour's lightness, so glows still glow and bellies stay pale; turn its hue and
    // scale its chroma the way the body changed between palettes.
    tint(color) {
      let tinted = tints.get(color);
      if (tinted === undefined) {
        const c = toOklch(color);
        tinted = fromOklch(c.l, c.c * scale, c.h + turn);
        tints.set(color, tinted);
      }
      return tinted;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// OKLCH, a perceptual colour space: lightness, chroma, hue. https://bottosson.github.io/posts/oklab/

interface Oklch {
  l: number;
  c: number;
  /** Radians. */
  h: number;
}

function toOklch(hex: string): Oklch {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

/** Back to #rrggbb, lowering chroma as far as needed to stay inside sRGB. */
function fromOklch(l: number, c: number, h: number): string {
  let rgb = oklchToLinear(l, c, h);
  if (!inGamut(rgb)) {
    let low = 0;
    let high = c;
    for (let i = 0; i < 16; i++) {
      const mid = (low + high) / 2;
      if (inGamut(oklchToLinear(l, mid, h))) low = mid;
      else high = mid;
    }
    rgb = oklchToLinear(l, low, h);
  }
  return `#${rgb.map((v) => Math.round(fromLinear(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function oklchToLinear(L: number, c: number, h: number): [number, number, number] {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(rgb: number[]): boolean {
  return rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}
