import type { FishColors, FishDef } from "./types";

const TAU = Math.PI * 2;

/**
 * Stand-in outline for types whose real shape isn't drawn yet: an oval body with a forked tail,
 * in the type's own colours. Replace with a distinct outline (see docs/GAME_DESIGN.md).
 */
export function drawPlaceholder(ctx: CanvasRenderingContext2D, def: FishDef, colors: FishColors): void {
  const l = def.size;
  ctx.fillStyle = colors.fin;
  ctx.beginPath();
  ctx.moveTo(-0.26 * l, 0);
  ctx.lineTo(-0.5 * l, -0.2 * l);
  ctx.lineTo(-0.42 * l, 0);
  ctx.lineTo(-0.5 * l, 0.2 * l);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.ellipse(0.06 * l, 0, 0.36 * l, 0.2 * l, 0, 0, TAU);
  ctx.fill();

  ctx.fillStyle = "#16202a";
  ctx.beginPath();
  ctx.arc(0.27 * l, -0.05 * l, 0.04 * l, 0, TAU);
  ctx.fill();
}
