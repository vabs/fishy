import type { Effect } from "../fx";
import { range } from "../rng";
import type { FxEvent } from "../world";
import type { FishDef, FishKind, FishSpec } from "./types";

const TAU = Math.PI * 2;

/**
 * What a Goober bursts into, by `ability.goober.tier`. Never a Goober, Monster or Star, so a burst
 * can't feed another burst forever.
 */
export const GOOBER_TIERS = ["normal", "uncommon", "rare", "electric", "epic"] as const satisfies readonly FishKind[];

/** Seconds between direction changes, picked at random each time. */
const TURN_EVERY_MIN = 3;
const TURN_EVERY_MAX = 7;
/** How long a turn takes: it slows to a stop, flips, and speeds back up. */
const TURN_SECONDS = 1;
/** How far burst fish land from the Goober's centre, px: a base plus a bit per fish. */
const BURST_SPREAD_BASE = 10;
const BURST_SPREAD_PER_FISH = 3;
const BURST_SPREAD_MAX = 40;
const BURST_FX_SECONDS = 0.45;

/** The kind a Goober of this tier bursts into. Tiers outside the ladder clamp to its ends. */
export function gooberTier(tier: number): (typeof GOOBER_TIERS)[number] {
  const i = Number.isFinite(tier) ? Math.floor(tier) : 0;
  return GOOBER_TIERS[Math.min(GOOBER_TIERS.length - 1, Math.max(0, i))]!;
}

/**
 * Spawner. Slow, bobs strongly in and out, and now and then eases to a stop and swims the other
 * way. When captured it bursts into `ability.goober.count` fish of its tier at its own position,
 * which is usually inside the net. The round summary credits those fish to the Goober.
 */
export const goober: FishSpec = {
  def: {
    name: "Goober",
    hp: 6,
    value: 140,
    speed: 20,
    size: 34,
    // A big, slow bob. Heading follows velocity, so a faster bob would outrun the orbit speed and
    // tip the fish nose-down; at 24 px × 0.75 rad/s it peaks at about 40° off level.
    wobble: 24,
    wobbleSpeed: 0.75,
    body: "#ff8fab",
    fin: "#d95c7c",
  },
  shape: drawPuffer,

  onSpawn(world, fish) {
    fish.state.turnIn = range(world.rng, TURN_EVERY_MIN, TURN_EVERY_MAX);
    fish.state.turning = -1;
  },

  move(world, fish, dt) {
    const s = fish.state;
    const turning = s.turning ?? -1;
    if (turning < 0) {
      s.turnIn = (s.turnIn ?? 0) - dt;
      if (s.turnIn <= 0) {
        s.turning = 0;
        s.flipped = 0;
      }
      return;
    }
    // Ease through the turn: speed follows |cos|, from full to zero and back, and the direction
    // flips at the stop, so the fish never jumps from one direction to the other.
    s.turning = turning + dt;
    const t = Math.min(1, s.turning / TURN_SECONDS);
    if (t >= 0.5 && !s.flipped) {
      fish.dir = fish.dir === 1 ? -1 : 1;
      s.flipped = 1;
    }
    fish.speedMult = Math.abs(Math.cos(Math.PI * t));
    if (t >= 1) {
      fish.speedMult = 1;
      s.turning = -1;
      s.turnIn = range(world.rng, TURN_EVERY_MIN, TURN_EVERY_MAX);
    }
  },

  onCapture(world, fish) {
    const { tier, count } = world.stats.ability.goober;
    const kind = gooberTier(tier);
    const n = Math.max(0, Math.floor(count));
    const spread = Math.min(BURST_SPREAD_MAX, BURST_SPREAD_BASE + BURST_SPREAD_PER_FISH * n);
    // Evenly round a circle from a random start, with a little jitter, so the fish don't stack.
    const start = world.rng() * TAU;
    for (let i = 0; i < n; i++) {
      const a = start + (i * TAU) / n + range(world.rng, -0.2, 0.2);
      const r = spread * range(world.rng, 0.8, 1.1);
      world.spawn(kind, { at: { x: fish.x + Math.cos(a) * r, y: fish.y + Math.sin(a) * r }, credit: "goober" });
    }
    world.emit({ type: "fx", kind: "goober", name: "burst", x: fish.x, y: fish.y, radius: spread + goober.def.size / 2 });
  },

  fx(event, add) {
    if (event.name === "burst") add(burst(event));
  },
};

/** A pop: a ring rushing out, droplets flung away, and a quick flash in the middle. */
function burst(event: FxEvent): Effect {
  const reach = event.radius ?? 30;
  const drops = Array.from({ length: 12 }, () => ({
    angle: Math.random() * TAU,
    dist: reach * (0.7 + Math.random() * 0.6),
    size: 1.5 + Math.random() * 2,
  }));
  const { body, fin } = goober.def;
  return {
    life: BURST_FX_SECONDS,
    draw(ctx, t) {
      const out = 1 - (1 - t) * (1 - t) * (1 - t);

      // Flash
      if (t < 0.3) {
        ctx.globalAlpha = 1 - t / 0.3;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(event.x, event.y, reach * (0.25 + out * 0.3), 0, TAU);
        ctx.fill();
      }

      // Ring
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = body;
      ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(event.x, event.y, reach * (0.3 + out * 0.9), 0, TAU);
      ctx.stroke();

      // Droplets
      ctx.fillStyle = fin;
      for (const d of drops) {
        const r = d.dist * out;
        ctx.beginPath();
        ctx.arc(event.x + Math.cos(d.angle) * r, event.y + Math.sin(d.angle) * r, d.size * (1 - t * 0.6), 0, TAU);
        ctx.fill();
      }
    },
  };
}

/** Round puffer: a ball covered in short spines, a little fan tail, a big eye and a pouty mouth. */
function drawPuffer(ctx: CanvasRenderingContext2D, def: FishDef): void {
  const l = def.size;
  const p = (x: number, y: number): [number, number] => [x * l, y * l];
  const cx = 0.04;
  const radius = 0.29;

  ctx.fillStyle = def.fin;
  // Little fan tail.
  ctx.beginPath();
  ctx.moveTo(...p(-0.22, 0));
  ctx.lineTo(...p(-0.46, -0.13));
  ctx.quadraticCurveTo(...p(-0.4, 0), ...p(-0.46, 0.13));
  ctx.closePath();
  ctx.fill();

  // Short spines all round, except where the tail joins.
  const spines = 18;
  for (let i = 0; i < spines; i++) {
    const a = (i * TAU) / spines + 0.1;
    if (Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < 0.45) continue;
    const base = radius - 0.01;
    const tip = radius + 0.08;
    ctx.beginPath();
    ctx.moveTo(...p(cx + Math.cos(a - 0.09) * base, Math.sin(a - 0.09) * base));
    ctx.lineTo(...p(cx + Math.cos(a) * tip, Math.sin(a) * tip));
    ctx.lineTo(...p(cx + Math.cos(a + 0.09) * base, Math.sin(a + 0.09) * base));
    ctx.closePath();
    ctx.fill();
  }

  // Body
  ctx.fillStyle = def.body;
  ctx.beginPath();
  ctx.arc(...p(cx, 0), radius * l, 0, TAU);
  ctx.fill();

  // Pale belly and a few spots, clipped to the body.
  ctx.save();
  ctx.beginPath();
  ctx.arc(...p(cx, 0), radius * l, 0, TAU);
  ctx.clip();
  ctx.fillStyle = "#ffd0dc";
  ctx.beginPath();
  ctx.ellipse(...p(cx + 0.02, 0.2), 0.3 * l, 0.17 * l, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = def.fin;
  ctx.globalAlpha = 0.5;
  for (const [x, y] of [
    [-0.12, -0.12],
    [-0.02, -0.2],
    [-0.15, 0.02],
    [0.06, -0.12],
  ] as const) {
    ctx.beginPath();
    ctx.arc(...p(x, y), 0.028 * l, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // Side fin
  ctx.fillStyle = def.fin;
  ctx.beginPath();
  ctx.ellipse(...p(-0.02, 0.04), 0.07 * l, 0.04 * l, 0.5, 0, TAU);
  ctx.fill();

  // Mouth
  ctx.strokeStyle = def.fin;
  ctx.lineWidth = 0.03 * l;
  ctx.beginPath();
  ctx.arc(...p(0.31, 0.05), 0.03 * l, 0, TAU);
  ctx.stroke();

  // Big eye
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(...p(0.17, -0.08), 0.075 * l, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#16202a";
  ctx.beginPath();
  ctx.arc(...p(0.19, -0.08), 0.045 * l, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(...p(0.2, -0.095), 0.015 * l, 0, TAU);
  ctx.fill();
}
