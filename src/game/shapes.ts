import { FISH_SPECS, type FishKind } from "./fish";

/** Colour of every fish outside the net. Types are told apart by outline alone. */
const SILHOUETTE = "#071c2b";
const FLASH = "#ffffff";

/** Default sprite box relative to body length. */
const DEFAULT_BOX = { width: 1.1, height: 0.8 };

export interface FishSprites {
  full: HTMLCanvasElement;
  silhouette: HTMLCanvasElement;
  flash: HTMLCanvasElement;
  /** Size to draw at, CSS px. */
  width: number;
  height: number;
}

/**
 * Renders a fish once at device resolution, then derives the silhouette and hit-flash versions
 * from it. Later, sprites can replace the shape functions and keep the rest.
 */
export function buildSprites(kind: FishKind, dpr: number): FishSprites {
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
  spec.shape(ctx, spec.def);
  return { full, silhouette: tint(full, SILHOUETTE), flash: tint(full, FLASH), width, height };
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
