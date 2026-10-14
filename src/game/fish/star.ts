import type { Effect } from "../fx";
import { range } from "../rng";
import type { FxEvent, Shot, World } from "../world";
import type { FishDef, FishSpec } from "./types";

const TAU = Math.PI * 2;

/** How far the Star zig-zags in or out of its orbit, as a fraction of the swimming area. */
const ZIG_AMPLITUDE = 0.12;
/** Zig-zags per second, picked per Star. */
const ZIG_RATE_MIN = 0.75;
const ZIG_RATE_MAX = 1.05;
/** Seconds before the same shot can hit the same fish again. */
const HIT_COOLDOWN = 0.25;
/** Cooldowns this close to 0 count as over (float error from adding up steps). */
const EPSILON = 1e-9;
/** Seconds of past path drawn behind a shot. */
const TRAIL_SECONDS = 0.12;
const TRAIL_DOTS = 7;
/** Shot spin, radians/s. */
const SHOT_SPIN = 9;

/** Special: small, fast, glowing; zig-zags. On capture it becomes projectiles that bounce off the edges. */
export const star: FishSpec = {
  def: {
    name: "Star",
    hp: 3,
    value: 360,
    speed: 90,
    size: 24,
    wobble: 0,
    wobbleSpeed: 0,
    body: "#ffd166",
    fin: "#e0a526",
  },
  shape: drawStarFish,
  box: { width: 1, height: 1 },

  onSpawn(world, fish) {
    // Zig-zag inwards from the outer half of the water and outwards from the inner half, so it
    // always stays between the boat and the edge.
    fish.state.zigBase = fish.orbit;
    fish.state.zigDir = fish.orbit > 0.6 ? -1 : 1;
    fish.state.zigRate = range(world.rng, ZIG_RATE_MIN, ZIG_RATE_MAX);
    fish.state.zig = 0;
  },

  move(_world, fish, dt) {
    const s = fish.state;
    const phase = (s.zig ?? 0) + (s.zigRate ?? ZIG_RATE_MIN) * dt;
    s.zig = phase;
    // Triangle wave 0 → 1 → 0: straight legs with sharp turns.
    const tri = 1 - Math.abs(1 - 2 * (phase % 1));
    fish.orbit = (s.zigBase ?? fish.orbit) + (s.zigDir ?? 1) * ZIG_AMPLITUDE * tri;
  },

  onCapture(world, fish) {
    launch(world, fish.x, fish.y);
  },

  update: moveShots,
  drawWorld,

  fx(event, add) {
    if (event.name === "launch") add(burst(event, 0.35, 1));
    else if (event.name === "bounce") add(burst(event, 0.25, 0.55));
    else if (event.name === "fade") add(fade(event));
  },
};

/** Turns a captured Star into `count` projectiles fanned out in random directions. */
function launch(world: World, x: number, y: number): void {
  const a = world.stats.ability.star;
  const count = Math.max(0, Math.round(a.count));
  const start = range(world.rng, 0, TAU);
  const spread = count > 0 ? TAU / count : 0;
  const [left, right, top, bottom] = bounds(world, a.radius);
  for (let i = 0; i < count; i++) {
    const angle = start + i * spread + range(world.rng, -0.25, 0.25) * spread;
    world.shots.push({
      kind: "star",
      x: clamp(x, left, right),
      y: clamp(y, top, bottom),
      vx: Math.cos(angle) * a.speed,
      vy: Math.sin(angle) * a.speed,
      radius: a.radius,
      damage: a.damage,
      bouncesLeft: a.bounces,
      age: 0,
      cooldowns: new Map(),
    });
  }
  world.emit({ type: "fx", kind: "star", name: "launch", x, y, radius: a.radius });
}

/** Moves every Star shot, bounces it off the screen edges and damages the fish it passes. */
function moveShots(world: World, dt: number): void {
  let kept = 0;
  for (const shot of world.shots) {
    if (shot.kind !== "star" || stepShot(world, shot, dt)) world.shots[kept++] = shot;
  }
  world.shots.length = kept;
}

/** Returns false once the shot is gone. */
function stepShot(world: World, shot: Shot, dt: number): boolean {
  shot.age += dt;
  for (const [id, left] of shot.cooldowns) {
    if (left - dt <= EPSILON) shot.cooldowns.delete(id);
    else shot.cooldowns.set(id, left - dt);
  }

  const fromX = shot.x;
  const fromY = shot.y;
  shot.x += shot.vx * dt;
  shot.y += shot.vy * dt;

  const [left, right, top, bottom] = bounds(world, shot.radius);
  let gone = false;
  if (shot.x < left || shot.x > right) {
    const low = shot.x < left;
    if (shot.bouncesLeft > 0) {
      shot.bouncesLeft--;
      shot.x = low ? 2 * left - shot.x : 2 * right - shot.x;
      shot.vx = low ? Math.abs(shot.vx) : -Math.abs(shot.vx);
      world.emit({ type: "fx", kind: "star", name: "bounce", x: low ? left : right, y: shot.y });
    } else {
      gone = true;
    }
    shot.x = clamp(shot.x, left, right);
  }
  if (shot.y < top || shot.y > bottom) {
    const low = shot.y < top;
    if (shot.bouncesLeft > 0 && !gone) {
      shot.bouncesLeft--;
      shot.y = low ? 2 * top - shot.y : 2 * bottom - shot.y;
      shot.vy = low ? Math.abs(shot.vy) : -Math.abs(shot.vy);
      world.emit({ type: "fx", kind: "star", name: "bounce", x: shot.x, y: low ? top : bottom });
    } else {
      gone = true;
    }
    shot.y = clamp(shot.y, top, bottom);
  }

  hitFish(world, shot, fromX, fromY);
  if (gone) world.emit({ type: "fx", kind: "star", name: "fade", x: shot.x, y: shot.y, radius: shot.radius });
  return !gone;
}

/** Damages every live fish within reach of the shot's path this step, once per cooldown. */
function hitFish(world: World, shot: Shot, fromX: number, fromY: number): void {
  for (const fish of world.fish) {
    if (fish.captured || shot.cooldowns.has(fish.id)) continue;
    const reach = shot.radius + world.defOf(fish.kind).size * 0.4;
    if (segmentDistance(fish.x, fish.y, fromX, fromY, shot.x, shot.y) > reach) continue;
    shot.cooldowns.set(fish.id, HIT_COOLDOWN);
    world.damage(fish, shot.damage, "star");
  }
}

/** Where a shot's centre can be: [left, right, top, bottom]. */
function bounds(world: World, radius: number): [number, number, number, number] {
  return [radius, Math.max(radius, world.width - radius), radius, Math.max(radius, world.height - radius)];
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Reflects a coordinate back into [min, max], the way the shot bounced, to trace its past path. */
function fold(value: number, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return min;
  const period = 2 * span;
  const m = (((value - min) % period) + period) % period;
  return min + (m <= span ? m : period - m);
}

function starPath(ctx: CanvasRenderingContext2D, outer: number, inner: number, rotation = 0): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i * Math.PI) / 5;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

/** Five-point star, one point forward. */
function drawStarFish(ctx: CanvasRenderingContext2D, def: FishDef): void {
  const outer = def.size * 0.46;
  const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, outer);
  fill.addColorStop(0, "#fffbe6");
  fill.addColorStop(0.5, def.body);
  fill.addColorStop(1, def.fin);
  starPath(ctx, outer, outer * 0.48);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = def.size * 0.04;
  ctx.strokeStyle = def.fin;
  ctx.stroke();
}

/** Glow around live Stars, and the shots: trail, glow, spinning star. Drawn above the fish. */
function drawWorld(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const fish of world.fish) {
    if (fish.kind !== "star" || fish.captured) continue;
    const pulse = 0.75 + 0.25 * Math.sin(time * 5 + fish.id);
    const r = star.def.size * 1.3;
    const alpha = 0.32 * pulse * Math.min(1, fish.age / 0.4);
    glow(ctx, fish.x, fish.y, r, `rgba(255, 214, 102, ${alpha})`);
  }

  for (const shot of world.shots) {
    if (shot.kind === "star") glow(ctx, shot.x, shot.y, shot.radius * 2.6, "rgba(255, 226, 140, 0.7)");
  }
  ctx.restore();

  // Golden trail along the path the shot actually took, bounces included.
  for (const shot of world.shots) {
    if (shot.kind !== "star") continue;
    const [left, right, top, bottom] = bounds(world, shot.radius);
    const trail = Math.min(TRAIL_SECONDS, shot.age);
    for (let k = TRAIL_DOTS; k >= 1; k--) {
      const back = (trail * k) / TRAIL_DOTS;
      const x = fold(shot.x - shot.vx * back, left, right);
      const y = fold(shot.y - shot.vy * back, top, bottom);
      const f = 1 - k / (TRAIL_DOTS + 1);
      ctx.fillStyle = `rgba(255, 196, 70, ${0.6 * f})`;
      ctx.beginPath();
      ctx.arc(x, y, shot.radius * (0.25 + 0.5 * f), 0, TAU);
      ctx.fill();
    }
  }

  for (const shot of world.shots) {
    if (shot.kind !== "star") continue;
    ctx.save();
    ctx.translate(shot.x, shot.y);
    starPath(ctx, shot.radius * 1.05, shot.radius * 0.5, shot.age * SHOT_SPIN);
    ctx.fillStyle = "#fff6cc";
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffb703";
    ctx.stroke();
    ctx.restore();
  }
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(255, 200, 80, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/** A flash with sparks, for launches and wall hits. */
function burst(event: FxEvent, life: number, scale: number): Effect {
  const { x, y } = event;
  const sparks = Array.from({ length: Math.round(10 * scale) }, () => ({
    a: Math.random() * TAU,
    d: (24 + Math.random() * 26) * scale,
  }));
  return {
    life,
    draw(ctx, t) {
      ctx.globalCompositeOperation = "lighter";
      glow(ctx, x, y, (14 + 22 * t) * scale, `rgba(255, 236, 170, ${0.8 * (1 - t)})`);
      ctx.strokeStyle = `rgba(255, 220, 120, ${1 - t})`;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      for (const s of sparks) {
        const r0 = s.d * t;
        const r1 = s.d * Math.min(1, t + 0.25);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(s.a) * r0, y + Math.sin(s.a) * r0);
        ctx.lineTo(x + Math.cos(s.a) * r1, y + Math.sin(s.a) * r1);
        ctx.stroke();
      }
    },
  };
}

/** A spent shot shrinks and fades where it last hit the edge. */
function fade(event: FxEvent): Effect {
  const { x, y } = event;
  const radius = event.radius ?? 14;
  const spin = Math.random() * TAU;
  return {
    life: 0.45,
    draw(ctx, t) {
      ctx.globalCompositeOperation = "lighter";
      glow(ctx, x, y, radius * (2.6 + t), `rgba(255, 226, 140, ${0.6 * (1 - t)})`);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1 - t;
      ctx.translate(x, y);
      starPath(ctx, radius * 1.05 * (1 - 0.6 * t), radius * 0.5 * (1 - 0.6 * t), spin + t * 3);
      ctx.fillStyle = "#fff6cc";
      ctx.fill();
    },
  };
}
