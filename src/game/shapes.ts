import { FISH, type FishDef, type FishKind } from "./fish";

const TAU = Math.PI * 2;

/** Colour of every fish outside the net. Types are told apart by outline alone. */
const SILHOUETTE = "#071c2b";
const FLASH = "#ffffff";

/** Sprite box relative to body length. Every shape must fit inside it. */
const BOX_WIDTH = 1.1;
const BOX_HEIGHT = 0.8;

/** Draws a fish centred on the origin, facing +x, `def.size` px long. */
type DrawShape = (ctx: CanvasRenderingContext2D, def: FishDef) => void;

const SHAPES: Record<FishKind, DrawShape> = {
  normal: drawNormal,
};

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
  const def = FISH[kind];
  const width = def.size * BOX_WIDTH;
  const height = def.size * BOX_HEIGHT;
  const full = document.createElement("canvas");
  full.width = Math.ceil(width * dpr);
  full.height = Math.ceil(height * dpr);
  const ctx = context(full);
  ctx.scale(dpr, dpr);
  ctx.translate(width / 2, height / 2);
  SHAPES[kind](ctx, def);
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

/** Oval body, forked tail, small back fin. */
function drawNormal(ctx: CanvasRenderingContext2D, def: FishDef): void {
  const l = def.size;

  ctx.fillStyle = def.fin;
  // Forked tail
  ctx.beginPath();
  ctx.moveTo(-0.26 * l, 0);
  ctx.lineTo(-0.5 * l, -0.2 * l);
  ctx.lineTo(-0.42 * l, 0);
  ctx.lineTo(-0.5 * l, 0.2 * l);
  ctx.closePath();
  ctx.fill();
  // Back fin
  ctx.beginPath();
  ctx.moveTo(-0.1 * l, -0.16 * l);
  ctx.quadraticCurveTo(0, -0.32 * l, 0.14 * l, -0.17 * l);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = def.body;
  ctx.beginPath();
  ctx.ellipse(0.06 * l, 0, 0.36 * l, 0.2 * l, 0, 0, TAU);
  ctx.fill();

  // Side fin
  ctx.fillStyle = def.fin;
  ctx.beginPath();
  ctx.ellipse(0.08 * l, 0.06 * l, 0.08 * l, 0.035 * l, -0.5, 0, TAU);
  ctx.fill();

  // Eye
  ctx.fillStyle = "#16202a";
  ctx.beginPath();
  ctx.arc(0.27 * l, -0.05 * l, 0.04 * l, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0.28 * l, -0.06 * l, 0.014 * l, 0, TAU);
  ctx.fill();
}
