import type { Effect } from "../fx";
import type { Fish, FxEvent, World } from "../world";
import type { FishDef, FishKind, FishSpec } from "./types";

const TAU = Math.PI * 2;

/** The Monster sweeps in and out between these orbit fractions. */
const SWEEP_MID = 0.6;
const SWEEP_AMP = 0.18;
/** Speed of the sweep cycle, radians/s (about 50 s per cycle). */
const SWEEP_RATE = 0.13;
/** Fastest the Monster changes its orbit fraction, per second. */
const SWEEP_DRIFT = 0.012;

/** Fish centres stay at least this far from the Monster's centre, as a fraction of its size. */
const BODY_RADIUS = 0.42;
/** Seconds after spawning before the vortex reaches full strength, so nothing jumps when it appears. */
const SPIN_UP_SECONDS = 1;
/** Direction the vortex turns: 1 is clockwise on screen. */
const SPIN = 1;
/** Outer share of the radius over which the pull fades in, so fish ease into the vortex. */
const EDGE_BAND = 0.15;
/** Share of the pull strength that goes into circling rather than pulling in. */
const SWIRL = 0.8;
/** How hard fish are steered onto their ring, (px/s) per px. */
const RING_STIFFNESS = 1.5;
/**
 * A fish keeps swimming its own path underneath. Once the vortex has dragged it this many radii away
 * from that path it breaks free, so fish churn through the vortex and never drift far from home.
 */
const HOLD_LIMIT = 1.5;
/** Released fish swim back to their own path at up to this speed, px/s. */
const RELAX_MAX_SPEED = 70;
/** How fast the last bit of displacement decays, 1/s. */
const RELAX_RATE = 2.5;
/** Displacement small enough to drop once a fish is free, px. */
const SETTLE = 0.3;
/** Pulled fish stay this far from the boat's centre, px. */
const BOAT_KEEP = 60;
/** Movement beyond this in one step is a teleport (e.g. a resize), not swimming, px. */
const TELEPORT = 30;

/** Keys in `fish.state` for a fish the vortex has displaced. Prefixed so other types' state is safe. */
const HELD = "whirl";
const OFF_X = "whirlOx";
const OFF_Y = "whirlOy";
const OWN_X = "whirlPx";
const OWN_Y = "whirlPy";

/** Types the vortex leaves alone. */
const UNPULLED: ReadonlySet<FishKind> = new Set(["monster", "star"]);

/** Whirlpool: very slow wide sweeps, pulls nearby fish into a vortex, captures them all when caught. */
export const monster: FishSpec = {
  def: {
    name: "Monster",
    hp: 60,
    value: 380,
    speed: 15,
    size: 110,
    wobble: 4,
    wobbleSpeed: 0.5,
    body: "#8d99ae",
    fin: "#5c677d",
    maxOnScreen: 1,
  },
  shape: drawShark,
  box: { width: 1.1, height: 0.84 },

  onSpawn(world, fish) {
    // Start inside the sweep band, well clear of the boat, at the matching point of the cycle. The
    // fish is still fully transparent on its first frame, so the move can't be seen.
    fish.orbit = clamp(fish.orbit, SWEEP_MID - SWEEP_AMP, SWEEP_MID + SWEEP_AMP);
    const phase = Math.asin(clamp((fish.orbit - SWEEP_MID) / SWEEP_AMP, -1, 1));
    fish.state.sweep = world.rng() < 0.5 ? phase : Math.PI - phase;
  },

  move(_world, fish, dt) {
    const phase = (fish.state.sweep ?? 0) + SWEEP_RATE * dt;
    fish.state.sweep = phase;
    const target = SWEEP_MID + SWEEP_AMP * Math.sin(phase);
    const step = SWEEP_DRIFT * dt;
    fish.orbit += clamp(target - fish.orbit, -step, step);
  },

  update: pullFish,

  onResize(world, sx, sy) {
    for (const fish of world.fish) {
      const state = fish.state;
      if (state[HELD] === 1) {
        state[OFF_X] = (state[OFF_X] ?? 0) * sx;
        state[OFF_Y] = (state[OFF_Y] ?? 0) * sy;
        delete state[OWN_X];
        delete state[OWN_Y];
      }
      if (fish.kind === "monster") {
        delete state.lastX;
        delete state.lastY;
      }
    }
  },

  onCapture(world, fish) {
    const radius = world.stats.ability.monster.pullRadius;
    const caught = world.fishNear(fish, radius);
    for (const other of caught) world.capture(other, "whirlpool");
    world.emit({
      type: "fx",
      kind: "monster",
      name: "implode",
      x: fish.x,
      y: fish.y,
      radius,
      points: caught.map((f) => ({ x: f.x, y: f.y })),
    });
  },

  drawWorld: drawVortex,

  fx(event, add) {
    if (event.name === "implode") add(implosion(event));
  },
};

interface Vortex {
  fish: Fish;
  /** Velocity, px/s. */
  vx: number;
  vy: number;
  /** 0 to 1 while spinning up. */
  power: number;
}

/**
 * Moves every fish near a Monster along the vortex, and lets go of the rest smoothly. All of it is
 * done through the fish's offset; the vortex's share is tracked in `fish.state` so it can be undone.
 */
function pullFish(world: World, dt: number): void {
  if (dt <= 0) return;
  const vortices: Vortex[] = [];
  for (const fish of world.fish) {
    if (fish.kind !== "monster" || fish.captured) continue;
    const [vx, vy] = velocity(fish.x, fish.y, fish.state.lastX, fish.state.lastY, dt);
    fish.state.lastX = fish.x;
    fish.state.lastY = fish.y;
    vortices.push({ fish, vx, vy, power: Math.min(1, fish.age / SPIN_UP_SECONDS) });
  }
  const { pullRadius, pullStrength } = world.stats.ability.monster;
  for (const fish of world.fish) {
    if (!fish.captured && !UNPULLED.has(fish.kind)) pullOne(world, fish, vortices, pullRadius, pullStrength, dt);
  }
}

function pullOne(world: World, fish: Fish, vortices: Vortex[], radius: number, strength: number, dt: number): void {
  const state = fish.state;
  const held = state[HELD] === 1;
  const size = world.defOf(fish.kind).size;

  let vortex: Vortex | undefined;
  let dist = Infinity;
  for (const v of vortices) {
    const d = Math.hypot(fish.x - v.fish.x, fish.y - v.fish.y);
    if (d < dist) {
      dist = d;
      vortex = v;
    }
  }
  const inside = vortex !== undefined && dist < radius;
  const grip = vortex && inside ? smoothstep((radius - dist) / (EDGE_BAND * radius)) * vortex.power : 0;
  if (!held && grip <= 0) return;

  // The vortex's share of the offset, and where the fish would be without it.
  const ox = held ? (state[OFF_X] ?? 0) : 0;
  const oy = held ? (state[OFF_Y] ?? 0) : 0;
  const ownX = fish.x - ox;
  const ownY = fish.y - oy;
  const [ownVx, ownVy] = held ? velocity(ownX, ownY, state[OWN_X], state[OWN_Y], dt) : [0, 0];

  let nx = ox;
  let ny = oy;
  if (vortex && grip > 0) {
    // Carried along with the Monster and around it; its own swimming is held back by the grip.
    const [fx, fy] = flow(fish, size, vortex.fish, dist, radius, strength);
    nx += grip * (fx + vortex.vx - ownVx) * dt;
    ny += grip * (fy + vortex.vy - ownVy) * dt;
  }
  const len = Math.hypot(ox, oy);
  if (grip < 1 && len > 0) {
    const step = Math.min(len, Math.min(len * RELAX_RATE, RELAX_MAX_SPEED) * dt) * (1 - grip);
    nx -= (ox / len) * step;
    ny -= (oy / len) * step;
  }
  // The limit stops the vortex dragging a fish further. Above it (the radius shrank), the offset
  // comes down at swimming speed rather than in one jump.
  const limit = Math.max(HOLD_LIMIT * radius, len - RELAX_MAX_SPEED * dt);
  const dragged = Math.hypot(nx, ny);
  if (grip > 0 && dragged > limit) {
    nx *= limit / dragged;
    ny *= limit / dragged;
  }

  // Keep where the fish will be next step clear of the Monster's body and the boat, and on screen.
  const baseX = ownX + ownVx * dt;
  const baseY = ownY + ownVy * dt;
  let x = baseX + nx;
  let y = baseY + ny;
  if (vortex && inside) {
    const keep = (monster.def.size * BODY_RADIUS + size * 0.3) * vortex.power;
    [x, y] = pushOut(x, y, vortex.fish.x + vortex.vx * dt, vortex.fish.y + vortex.vy * dt, keep);
  }
  const cx = world.width / 2;
  const cy = world.height / 2;
  // Never push a fish further out than its own path, or it could never settle.
  [x, y] = pushOut(x, y, cx, cy, Math.min(BOAT_KEEP, Math.hypot(baseX - cx, baseY - cy)));
  const margin = size * 0.4;
  x = clamp(x, Math.min(margin, baseX), Math.max(world.width - margin, baseX));
  y = clamp(y, Math.min(margin, baseY), Math.max(world.height - margin, baseY));
  nx = x - baseX;
  ny = y - baseY;

  // Other types may use the offset too; only the vortex's share changes.
  const otherX = fish.offsetX - ox;
  const otherY = fish.offsetY - oy;
  if (grip <= 0 && Math.hypot(nx, ny) < SETTLE) {
    fish.offsetX = otherX;
    fish.offsetY = otherY;
    for (const key of [HELD, OFF_X, OFF_Y, OWN_X, OWN_Y]) delete state[key];
    return;
  }
  fish.offsetX = otherX + nx;
  fish.offsetY = otherY + ny;
  state[HELD] = 1;
  state[OFF_X] = nx;
  state[OFF_Y] = ny;
  state[OWN_X] = ownX;
  state[OWN_Y] = ownY;
}

/** Vortex velocity at a fish, relative to the Monster: around it and onto the fish's ring. Px/s. */
function flow(fish: Fish, size: number, centre: Fish, dist: number, radius: number, strength: number): [number, number] {
  const ux = dist > 1e-6 ? (fish.x - centre.x) / dist : 1;
  const uy = dist > 1e-6 ? (fish.y - centre.y) / dist : 0;
  let radial = clamp((ringRadius(fish, size, radius) - dist) * RING_STIFFNESS, -strength, strength);
  let around = strength * SWIRL;
  const speed = Math.hypot(radial, around);
  if (speed > strength) {
    radial *= strength / speed;
    around *= strength / speed;
  }
  return [ux * radial - uy * around * SPIN, uy * radial + ux * around * SPIN];
}

/** Each fish settles on its own ring just outside the Monster's body, so they bunch without stacking. */
function ringRadius(fish: Fish, size: number, radius: number): number {
  const inner = monster.def.size * BODY_RADIUS + size * 0.5 + 6;
  const spread = Math.max(0, radius * 0.85 - inner) * 0.45;
  return inner + spread * ((fish.id * 0.618034) % 1);
}

/** Velocity from the last position, px/s. Zero on the first step or after a teleport. */
function velocity(x: number, y: number, lastX: number | undefined, lastY: number | undefined, dt: number): [number, number] {
  if (lastX === undefined || lastY === undefined) return [0, 0];
  const dx = x - lastX;
  const dy = y - lastY;
  return Math.hypot(dx, dy) < TELEPORT ? [dx / dt, dy / dt] : [0, 0];
}

function pushOut(x: number, y: number, cx: number, cy: number, keep: number): [number, number] {
  const d = Math.hypot(x - cx, y - cy);
  if (d >= keep || keep <= 0) return [x, y];
  if (d < 1e-6) return [cx + keep, cy];
  return [cx + ((x - cx) / d) * keep, cy + ((y - cy) / d) * keep];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** A faint turning ring and spiral arms, so the vortex radius can be read. */
function drawVortex(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  const radius = world.stats.ability.monster.pullRadius;
  for (const fish of world.fish) {
    if (fish.kind !== "monster" || fish.captured) continue;
    const alpha = Math.min(1, fish.age / SPIN_UP_SECONDS);
    ctx.save();
    ctx.translate(fish.x, fish.y);
    ctx.lineCap = "round";

    ctx.rotate(SPIN * time * 0.35);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(205, 240, 255, ${0.16 * alpha})`;
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      ctx.beginPath();
      ctx.arc(0, 0, radius, a, a + 0.55);
      ctx.stroke();
    }

    ctx.rotate(SPIN * time * 0.25);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(205, 240, 255, ${0.1 * alpha})`;
    for (let i = 0; i < 3; i++) {
      const a0 = (i * TAU) / 3;
      ctx.beginPath();
      for (let k = 0; k <= 12; k++) {
        const u = k / 12;
        const r = radius * (0.92 - 0.38 * u);
        const a = a0 + SPIN * 1.5 * u;
        if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

interface Streak {
  r: number;
  a: number;
  fish: boolean;
}

/** Captured fish (and some water) streak into the centre along the spiral, then a flash. */
function implosion(event: FxEvent): Effect {
  const { x, y } = event;
  const radius = event.radius ?? 140;
  const streaks: Streak[] = (event.points ?? []).map((p) => ({
    r: Math.hypot(p.x - x, p.y - y),
    a: Math.atan2(p.y - y, p.x - x),
    fish: true,
  }));
  for (let i = 0; i < 22; i++) {
    streaks.push({ r: radius * (0.7 + 0.3 * Math.random()), a: Math.random() * TAU, fish: false });
  }
  const at = (s: Streak, u: number): [number, number] => {
    const k = u * u;
    const r = s.r * (1 - k);
    const a = s.a + SPIN * 2.4 * k;
    return [x + Math.cos(a) * r, y + Math.sin(a) * r];
  };

  return {
    life: 0.8,
    draw(ctx, t) {
      const travel = Math.min(1, t / 0.75);
      ctx.lineCap = "round";

      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(200, 238, 255, ${0.55 * (1 - travel)})`;
      ctx.beginPath();
      ctx.arc(x, y, radius * (1 - travel * travel), 0, TAU);
      ctx.stroke();

      // Heads arrive at 0.75; the tails keep draining into the centre after that.
      const tail = Math.min(1, Math.max(0, t / 0.75 - 0.3));
      for (const s of streaks) {
        if (tail >= travel) break;
        ctx.beginPath();
        for (let k = 0; k <= 8; k++) {
          const [px, py] = at(s, tail + ((travel - tail) * k) / 8);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        const fade = 1 - t * 0.7;
        ctx.strokeStyle = s.fish ? `rgba(255, 248, 220, ${0.9 * fade})` : `rgba(170, 225, 255, ${0.6 * fade})`;
        ctx.lineWidth = (s.fish ? 4 : 2) * (1 - travel * 0.5);
        ctx.stroke();
        if (s.fish && travel < 1) {
          const [hx, hy] = at(s, travel);
          ctx.fillStyle = `rgba(255, 255, 255, ${fade})`;
          ctx.beginPath();
          ctx.arc(hx, hy, 3, 0, TAU);
          ctx.fill();
        }
      }

      if (t > 0.55) {
        const f = (t - 0.55) / 0.45;
        const r = 12 + 36 * f;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
        glow.addColorStop(0, `rgba(255, 255, 255, ${0.8 * (1 - f)})`);
        glow.addColorStop(1, "rgba(180, 230, 255, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    },
  };
}

/** Huge shark: pointed snout, tall swept dorsal fin, crescent tail. Faces +x. */
function drawShark(ctx: CanvasRenderingContext2D, def: FishDef): void {
  const l = def.size;
  const p = (x: number, y: number): [number, number] => [x * l, y * l];

  ctx.fillStyle = def.fin;
  // Crescent tail
  ctx.beginPath();
  ctx.moveTo(...p(-0.31, -0.035));
  ctx.quadraticCurveTo(...p(-0.42, -0.1), ...p(-0.53, -0.32));
  ctx.quadraticCurveTo(...p(-0.38, -0.02), ...p(-0.5, 0.22));
  ctx.quadraticCurveTo(...p(-0.42, 0.08), ...p(-0.31, 0.035));
  ctx.closePath();
  ctx.fill();
  // Tall dorsal fin
  ctx.beginPath();
  ctx.moveTo(...p(0.1, -0.12));
  ctx.quadraticCurveTo(...p(0.0, -0.24), ...p(-0.11, -0.39));
  ctx.quadraticCurveTo(...p(-0.07, -0.22), ...p(-0.13, -0.11));
  ctx.closePath();
  ctx.fill();
  // Second dorsal and anal fins
  ctx.beginPath();
  ctx.moveTo(...p(-0.2, -0.075));
  ctx.lineTo(...p(-0.27, -0.13));
  ctx.lineTo(...p(-0.27, -0.055));
  ctx.closePath();
  ctx.moveTo(...p(-0.18, 0.07));
  ctx.lineTo(...p(-0.25, 0.12));
  ctx.lineTo(...p(-0.26, 0.05));
  ctx.closePath();
  ctx.fill();
  // Pectoral fin
  ctx.beginPath();
  ctx.moveTo(...p(0.16, 0.08));
  ctx.quadraticCurveTo(...p(0.08, 0.2), ...p(-0.06, 0.3));
  ctx.quadraticCurveTo(...p(0.02, 0.15), ...p(0.0, 0.09));
  ctx.closePath();
  ctx.fill();

  // Body: long and tapered, pointed snout
  const body = new Path2D();
  body.moveTo(...p(0.53, 0.01));
  body.bezierCurveTo(...p(0.44, -0.09), ...p(0.22, -0.135), ...p(0.02, -0.13));
  body.bezierCurveTo(...p(-0.14, -0.12), ...p(-0.25, -0.06), ...p(-0.33, -0.035));
  body.lineTo(...p(-0.33, 0.035));
  body.bezierCurveTo(...p(-0.24, 0.07), ...p(-0.1, 0.115), ...p(0.06, 0.112));
  body.bezierCurveTo(...p(0.26, 0.11), ...p(0.43, 0.07), ...p(0.53, 0.01));
  body.closePath();
  ctx.fillStyle = def.body;
  ctx.fill(body);

  // Pale belly
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = "#dfe6ee";
  ctx.beginPath();
  ctx.ellipse(...p(0.08, 0.11), 0.46 * l, 0.07 * l, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Gill slits
  ctx.strokeStyle = "rgba(40, 50, 66, 0.55)";
  ctx.lineWidth = Math.max(1, 0.012 * l);
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const gx = 0.27 - i * 0.035;
    ctx.beginPath();
    ctx.moveTo(...p(gx, -0.05));
    ctx.quadraticCurveTo(...p(gx - 0.02, 0.0), ...p(gx, 0.05));
    ctx.stroke();
  }
  // Mouth
  ctx.beginPath();
  ctx.moveTo(...p(0.44, 0.05));
  ctx.quadraticCurveTo(...p(0.38, 0.075), ...p(0.33, 0.06));
  ctx.stroke();

  // Eye
  ctx.fillStyle = "#11161f";
  ctx.beginPath();
  ctx.arc(...p(0.39, -0.035), 0.02 * l, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(...p(0.395, -0.04), 0.007 * l, 0, TAU);
  ctx.fill();
}
