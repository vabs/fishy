import type { FishColors, FishDef, FishSpec } from "./types";

const TAU = Math.PI * 2;

/** Baseline fish: steady orbit, no ability. */
export const normal: FishSpec = {
  def: {
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
  shape: drawNormal,
};

/** Oval body, forked tail, small back fin. */
function drawNormal(ctx: CanvasRenderingContext2D, def: FishDef, colors: FishColors): void {
  const l = def.size;

  ctx.fillStyle = colors.fin;
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

  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.ellipse(0.06 * l, 0, 0.36 * l, 0.2 * l, 0, 0, TAU);
  ctx.fill();

  // Side fin
  ctx.fillStyle = colors.fin;
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
