import { CHEST, CHEST_BOX, drawChestShape } from "./chest";
import { FISH_SPECS, type FishColors, type FishKind } from "./fish";
import { fishColors } from "./palette";

/** Colour of every fish outside the net. Types are told apart by outline alone. */
const SILHOUETTE = "#071c2b";
const FLASH = "#ffffff";
/** Hue a golden fish is painted in. It keeps the type's own light and shade, so its markings show. */
const GOLD = "#ffc425";

/** Default sprite box relative to body length. */
const DEFAULT_BOX = { width: 1.1, height: 0.8 };

export interface FishSprites {
  full: HTMLCanvasElement;
  silhouette: HTMLCanvasElement;
  flash: HTMLCanvasElement;
  /** The same fish in gold, with a sheen across it. */
  golden: HTMLCanvasElement;
  /** Size to draw at, CSS px. */
  width: number;
  height: number;
}

/**
 * Renders a fish once at device resolution, in the active palette unless `colors` says otherwise,
 * then derives the silhouette and hit-flash versions from it. Rebuild after a palette change. Later,
 * sprites can replace the shape functions and keep the rest.
 */
export function buildSprites(kind: FishKind, dpr: number, colors: FishColors = fishColors(kind)): FishSprites {
  const spec = FISH_SPECS[kind];
  const box = spec.box ?? DEFAULT_BOX;
  const width = spec.def.size * box.width;
  const height = spec.def.size * box.height;
  const full = document.createElement("canvas");
  full.width = Math.ceil(width * dpr);
  full.height = Math.ceil(height * dpr);
  const ctx = context(full);
  ctx.scale(dpr, dpr);
  ctx.translate(width / 2, height / 2);
  spec.shape(ctx, spec.def, colors);
  return { full, silhouette: tint(full, SILHOUETTE), flash: tint(full, FLASH), golden: gild(full), width, height };
}

export interface ChestSprites {
  full: HTMLCanvasElement;
  flash: HTMLCanvasElement;
  /** Size to draw at, CSS px. */
  width: number;
  height: number;
}

/** The treasure chest, rendered once at device resolution, with its hit-flash version. */
export function buildChestSprites(dpr: number): ChestSprites {
  const width = CHEST.size * CHEST_BOX.width;
  const height = CHEST.size * CHEST_BOX.height;
  const full = document.createElement("canvas");
  full.width = Math.ceil(width * dpr);
  full.height = Math.ceil(height * dpr);
  const ctx = context(full);
  ctx.scale(dpr, dpr);
  ctx.translate(width / 2, height / 2);
  drawChestShape(ctx);
  return { full, flash: tint(full, FLASH), width, height };
}

/** A gold copy of a sprite: its own shading in gold, lifted a little, with a diagonal sheen. */
function gild(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const { width, height } = source;
  canvas.width = width;
  canvas.height = height;
  const ctx = context(canvas);
  ctx.drawImage(source, 0, 0);
  // Gold hue and saturation over the fish's own lightness.
  ctx.globalCompositeOperation = "color";
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, 0, width, height);
  // Lift dark fish (the Monster, the Rare) so every type reads as polished metal, not brass.
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = "rgba(150, 105, 0, 0.45)";
  ctx.fillRect(0, 0, width, height);
  // Sheen: a bright band across the body, and a softer one beside it.
  const sheen = ctx.createLinearGradient(0, 0, width, height);
  sheen.addColorStop(0.28, "rgba(255, 255, 255, 0)");
  sheen.addColorStop(0.38, "rgba(255, 255, 240, 0.75)");
  sheen.addColorStop(0.46, "rgba(255, 255, 255, 0)");
  sheen.addColorStop(0.55, "rgba(255, 255, 255, 0)");
  sheen.addColorStop(0.6, "rgba(255, 250, 220, 0.35)");
  sheen.addColorStop(0.65, "rgba(255, 255, 255, 0)");
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);
  // Keep only the fish: the fills above covered the whole canvas.
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/** Copies a sprite with every visible pixel replaced by one colour. */
function tint(source: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = context(canvas);
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not supported");
  return ctx;
}
