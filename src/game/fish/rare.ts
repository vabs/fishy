import type { Effect } from "../fx";
import type { Fish, FxEvent, World } from "../world";
import type { FishDef, FishSpec } from "./types";

const TAU = Math.PI * 2;

/**
 * Armour never blocks a hit outright: at least this share of the hit always gets through, so a weak
 * net still makes progress and a Rare is never immune to anything.
 */
export const ARMOR_FLOOR = 0.25;

const ARMOR_FX_SECONDS = 0.28;
const PIERCE_FX_SECONDS = 0.35;

/**
 * Tanky, high value. Slow and large; armour takes a flat `ability.rare.armor` off every hit from
 * any source, so net damage upgrades pay off.
 */
export const rare: FishSpec = {
  def: {
    name: "Rare",
    // With base armour 0.5, a base net (1 damage) needs 12 ticks; 2 damage needs 4.
    hp: 6,
    value: 15,
    speed: 25,
    size: 40,
    wobble: 6,
    wobbleSpeed: 1,
    body: "#5b8def",
    fin: "#2f5fbf",
  },
  shape: drawRare,

  modifyDamage(world, fish, amount) {
    const { armor, pierce } = world.stats.ability.rare;
    return armoredDamage(world, fish, amount, armor, pierce);
  },

  fx(event, add) {
    if (event.name === "armor") add(armorSpark(event));
    else if (event.name === "pierce") add(pierceBurst(event));
  },
};

/**
 * Damage a hit really deals to a Rare.
 *
 * Pierce: the first hit on each Rare (`fish.hits === 0`; the world counts hits after this runs)
 * deals double damage. It doubles before armour, so the pierce hit is one heavy blow that armour
 * still dents: 2 × hit − armour, which beats doubling what's left after armour.
 *
 * Armour: subtracts a flat amount, but never lets less than ARMOR_FLOOR of the hit through.
 */
function armoredDamage(world: World, fish: Fish, amount: number, armor: number, pierce: boolean): number {
  if (amount <= 0) return amount;
  const pierced = pierce && fish.hits === 0;
  const hit = pierced ? amount * 2 : amount;
  const dealt = Math.max(hit - Math.max(0, armor), hit * ARMOR_FLOOR);
  if (pierced) world.emit(fxEvent(fish, "pierce"));
  else if (dealt < hit) world.emit(fxEvent(fish, "armor"));
  return dealt;
}

function fxEvent(fish: Fish, name: "armor" | "pierce"): FxEvent {
  return { type: "fx", kind: "rare", name, x: fish.x, y: fish.y, radius: rare.def.size * 0.4 };
}

/** A couple of short metallic glints where the armour turned the hit. */
function armorSpark(event: FxEvent): Effect {
  const r = event.radius ?? 16;
  // Random spot on the upper half of the fish, wherever it's facing.
  const at = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
  const x = event.x + Math.cos(at) * r * 0.7;
  const y = event.y + Math.sin(at) * r * 0.7;
  const rays = [at - 0.6, at, at + 0.6].map((a) => a + (Math.random() - 0.5) * 0.4);
  return {
    life: ARMOR_FX_SECONDS,
    draw(ctx, t) {
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = "#e8f1ff";
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const a of rays) {
        const from = 2 + t * 5;
        const to = 5 + t * 9;
        ctx.moveTo(x + Math.cos(a) * from, y + Math.sin(a) * from);
        ctx.lineTo(x + Math.cos(a) * to, y + Math.sin(a) * to);
      }
      ctx.stroke();
    },
  };
}

/** A sharp star where the first, pierced hit landed. */
function pierceBurst(event: FxEvent): Effect {
  const r = event.radius ?? 16;
  const spin = Math.random() * TAU;
  return {
    life: PIERCE_FX_SECONDS,
    draw(ctx, t) {
      const ease = 1 - (1 - t) * (1 - t);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = "#fff3c4";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = spin + (i * TAU) / 6;
        ctx.moveTo(event.x + Math.cos(a) * r * (0.3 + ease * 0.5), event.y + Math.sin(a) * r * (0.3 + ease * 0.5));
        ctx.lineTo(event.x + Math.cos(a) * r * (0.6 + ease * 0.8), event.y + Math.sin(a) * r * (0.6 + ease * 0.8));
      }
      ctx.stroke();
    },
  };
}

/** Bulky, deep body, a row of spines along the back, a square-cut tail. */
function drawRare(ctx: CanvasRenderingContext2D, def: FishDef): void {
  const l = def.size;
  const p = (x: number, y: number): [number, number] => [x * l, y * l];

  ctx.fillStyle = def.fin;
  // Spiked back fin: tall spines joined by a lower membrane.
  ctx.beginPath();
  ctx.moveTo(...p(-0.26, -0.12));
  const spines: [number, number][] = [
    [-0.2, -0.33],
    [-0.1, -0.38],
    [0.0, -0.39],
    [0.1, -0.37],
    [0.19, -0.31],
  ];
  spines.forEach(([x, y], i) => {
    ctx.lineTo(...p(x - 0.035, -0.22));
    ctx.lineTo(...p(x, y));
    if (i === spines.length - 1) ctx.lineTo(...p(x + 0.05, -0.2));
  });
  ctx.lineTo(...p(0.2, -0.14));
  ctx.closePath();
  ctx.fill();
  // Square-cut tail.
  ctx.beginPath();
  ctx.moveTo(...p(-0.32, -0.07));
  ctx.lineTo(...p(-0.49, -0.19));
  ctx.quadraticCurveTo(...p(-0.46, 0), ...p(-0.49, 0.19));
  ctx.lineTo(...p(-0.32, 0.07));
  ctx.closePath();
  ctx.fill();
  // Belly fin.
  ctx.beginPath();
  ctx.moveTo(...p(-0.02, 0.2));
  ctx.lineTo(...p(-0.14, 0.34));
  ctx.lineTo(...p(-0.18, 0.18));
  ctx.closePath();
  ctx.fill();

  // Body: deep and heavy at the front, tapering to the tail.
  ctx.fillStyle = def.body;
  ctx.beginPath();
  bodyPath(ctx, l);
  ctx.fill();

  // Darker back and a few scale spots, clipped to the body.
  ctx.save();
  ctx.beginPath();
  bodyPath(ctx, l);
  ctx.clip();
  ctx.fillStyle = def.fin;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.ellipse(...p(0, -0.24), 0.42 * l, 0.12 * l, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.35;
  for (const [x, y] of [
    [-0.16, 0.02],
    [-0.04, 0.08],
    [0.06, -0.02],
    [-0.1, -0.08],
  ] as const) {
    ctx.beginPath();
    ctx.arc(...p(x, y), 0.03 * l, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // Gill cover, bulging towards the tail.
  ctx.strokeStyle = def.fin;
  ctx.lineWidth = 0.025 * l;
  ctx.beginPath();
  ctx.arc(...p(0.34, 0.01), 0.18 * l, Math.PI - 0.85, Math.PI + 0.85);
  ctx.stroke();

  // Side fin, just behind the gill.
  ctx.fillStyle = def.fin;
  ctx.beginPath();
  ctx.moveTo(...p(0.13, 0.04));
  ctx.quadraticCurveTo(...p(0.02, 0.0), ...p(-0.05, 0.1));
  ctx.quadraticCurveTo(...p(0.06, 0.12), ...p(0.13, 0.07));
  ctx.closePath();
  ctx.fill();

  // Eye
  ctx.fillStyle = "#16202a";
  ctx.beginPath();
  ctx.arc(...p(0.27, -0.06), 0.04 * l, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(...p(0.28, -0.07), 0.014 * l, 0, TAU);
  ctx.fill();
}

function bodyPath(ctx: CanvasRenderingContext2D, l: number): void {
  ctx.moveTo(0.42 * l, 0.03 * l);
  ctx.bezierCurveTo(0.4 * l, -0.2 * l, 0.15 * l, -0.27 * l, -0.05 * l, -0.24 * l);
  ctx.bezierCurveTo(-0.22 * l, -0.21 * l, -0.3 * l, -0.12 * l, -0.34 * l, 0);
  ctx.bezierCurveTo(-0.3 * l, 0.12 * l, -0.2 * l, 0.22 * l, -0.03 * l, 0.25 * l);
  ctx.bezierCurveTo(0.18 * l, 0.27 * l, 0.4 * l, 0.22 * l, 0.42 * l, 0.03 * l);
  ctx.closePath();
}
