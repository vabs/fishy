import type { Effect } from "../fx";
import { range } from "../rng";
import type { Fish, FxEvent, Point, World } from "../world";
import { channels, shade } from "./color";
import type { FishColors, FishDef, FishSpec } from "./types";

const TAU = Math.PI * 2;

/**
 * Movement tuning. The eel drifts at `driftMult` × speed, then darts at up to `dartMult` × speed for
 * `dartMin`–`dartMax` s, resting `restMin`–`restMax` s between darts. Some darts (`shiftChance`) also
 * take it to a new distance from the boat, `shiftMin`–`shiftMax` of the orbit closer or further: the
 * orbit eases there over the dart, so the eel lunges diagonally and then drifts on.
 */
export const ELECTRIC_MOVE = {
  driftMult: 0.45,
  dartMult: 7,
  dartMin: 0.2,
  dartMax: 0.4,
  restMin: 0.8,
  restMax: 2.6,
  shiftChance: 0.4,
  shiftMin: 0.1,
  shiftMax: 0.3,
};

/** Seconds the lightning bolt stays on screen. */
const BOLT_SECONDS = 0.32;
/** The bolt is redrawn with a new jagged path this often, s. */
const BOLT_FLICKER_SECONDS = 0.045;
/** The bolt crosses one jump in this long, s, so the current visibly travels. */
const BOLT_JUMP_SECONDS = 0.035;

/** Chain damage: darts in bursts; when captured, a current jumps from fish to fish. */
export const electric: FishSpec = {
  def: {
    name: "Electric",
    hp: 4,
    value: 26,
    speed: 30,
    size: 50,
    // Kept small: a wobble faster than the slow drift would swing the eel's heading in and out.
    wobble: 3,
    wobbleSpeed: 1.2,
    body: "#f7e04b",
    fin: "#c9a812",
  },
  shape: drawEel,
  box: { width: 1.08, height: 0.38 },

  onSpawn(world, fish) {
    fish.speedMult = ELECTRIC_MOVE.driftMult;
    const s = eel(fish);
    // Stagger the first dart so a fresh round doesn't twitch in unison.
    s.rest = range(world.rng, 0.2, ELECTRIC_MOVE.restMax);
    s.dart = 0;
    s.dartLength = 0;
    s.from = fish.orbit;
    s.target = fish.orbit;
  },

  move(world, fish, dt) {
    const m = ELECTRIC_MOVE;
    const s = eel(fish);
    if (s.dart <= 0) {
      s.rest -= dt;
      if (s.rest <= 0) startDart(world, fish);
      return;
    }

    s.dart = Math.max(0, s.dart - dt);
    const p = 1 - s.dart / s.dartLength;
    // Full speed at once, easing off only near the end of the dart.
    fish.speedMult = m.driftMult + (m.dartMult - m.driftMult) * (1 - p * p * p);
    if (s.target !== s.from) {
      const { min, max } = orbitBounds(world);
      fish.orbit = clamp(s.from + (s.target - s.from) * (1 - (1 - p) * (1 - p)), min, max);
    }
    if (s.dart === 0) {
      fish.speedMult = m.driftMult;
      s.from = s.target = fish.orbit;
      s.rest = range(world.rng, m.restMin, m.restMax);
    }
  },

  onCapture(world, fish) {
    const { jumps, damage, range: reach } = world.stats.ability.electric;
    const hit = new Set<number>([fish.id]);
    const points: Point[] = [{ x: fish.x, y: fish.y }];
    let at: Point = points[0]!;
    for (let i = 0; i < jumps; i++) {
      const next = world.fishNear(at, reach).find((f) => !hit.has(f.id));
      if (!next) break;
      hit.add(next.id);
      at = { x: next.x, y: next.y };
      points.push(at);
      // A fish killed here is queued like any capture, so another Electric starts its own current later.
      world.damage(next, damage, "electric");
    }
    world.emit({ type: "fx", kind: "electric", name: "current", x: fish.x, y: fish.y, points });
  },

  fx(event, add, colors) {
    if (event.name === "current") add(currentEffect(event, colors));
  },
};

/** Per-fish movement state, kept in `fish.state`. */
type EelState = {
  /** Seconds until the next dart. */
  rest: number;
  /** Seconds left in the current dart; 0 while drifting. */
  dart: number;
  dartLength: number;
  /** Orbit at the start of the dart, and the orbit it ends on. Equal when the dart keeps its distance. */
  from: number;
  target: number;
};

function eel(fish: Fish): EelState {
  return fish.state as EelState;
}

function startDart(world: World, fish: Fish): void {
  const m = ELECTRIC_MOVE;
  const s = eel(fish);
  s.dartLength = range(world.rng, m.dartMin, m.dartMax);
  s.dart = s.dartLength;
  fish.speedMult = m.dartMult;
  s.from = s.target = fish.orbit;
  if (world.rng() < m.shiftChance) {
    const { min, max } = orbitBounds(world);
    const delta = range(world.rng, m.shiftMin, m.shiftMax) * (world.rng() < 0.5 ? -1 : 1);
    let target = fish.orbit + delta;
    if (target < min || target > max) target = fish.orbit - delta;
    s.target = clamp(target, min, max);
  }
}

/** Orbit range the world spawns fish in: clear of the boat, out to the edge of the swimming area. */
export function orbitBounds(world: World): { min: number; max: number } {
  return { min: world.swimArea().minOrbit, max: 1 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------------------------
// Outline

/** Long eel: thin, gently wavy body, rounded snout, one fin running along the back to a pointed tail. */
function drawEel(ctx: CanvasRenderingContext2D, def: FishDef, colors: FishColors): void {
  const l = def.size;
  const tailX = -0.5 * l;
  const headX = 0.47 * l;
  // s runs from 0 at the tail tip to 1 at the snout.
  const spineX = (s: number) => tailX + (headX - tailX) * s;
  // A gentle wave that straightens towards the head.
  const spineY = (s: number) => 0.03 * l * Math.sin(s * TAU * 1.1 + 0.4) * (1 - 0.8 * s);
  const half = (s: number) => {
    const h = 0.064 * l;
    if (s > 0.88) {
      const u = (s - 0.88) / 0.12;
      return h * Math.sqrt(Math.max(0, 1 - u * u));
    }
    return h * (0.12 + 0.88 * smoothstep(0, 0.7, s));
  };
  const steps = 48;
  const at = (s: number, offset: number) => ({ x: spineX(s), y: spineY(s) + offset });

  // Fins: one along the back from mid-body, a shorter one along the belly, meeting in a pointed tail.
  const taper = (s: number) => Math.pow(Math.min(1, (s + 0.03) / 0.2), 0.7);
  const backFin = (s: number) => 0.042 * l * smoothstep(0.72, 0.42, s) * taper(s);
  const bellyFin = (s: number) => 0.03 * l * smoothstep(0.46, 0.26, s) * taper(s);
  ctx.fillStyle = colors.fin;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const s = 0.74 * (1 - i / steps);
    const p = at(s, -half(s) - backFin(s));
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.lineTo(tailX - 0.035 * l, spineY(0));
  for (let i = 0; i <= steps; i++) {
    const s = 0.48 * (i / steps);
    const p = at(s, half(s) + bellyFin(s));
    ctx.lineTo(p.x, p.y);
  }
  ctx.lineTo(spineX(0.6), spineY(0.6));
  ctx.closePath();
  ctx.fill();

  // Body, shaded darker along the back.
  const body = ctx.createLinearGradient(0, -0.09 * l, 0, 0.09 * l);
  body.addColorStop(0, shade(colors.body, -0.22));
  body.addColorStop(0.45, colors.body);
  body.addColorStop(1, shade(colors.body, 0.35));
  ctx.fillStyle = body;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const p = at(s, -half(s));
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  for (let i = steps; i >= 0; i--) {
    const s = i / steps;
    const p = at(s, half(s));
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();

  // Zigzag stripe along the flank, like a spark.
  ctx.strokeStyle = colors.fin;
  ctx.lineWidth = 0.022 * l;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const s = 0.14 + (0.62 * i) / 12;
    const p = at(s, (i % 2 === 0 ? -0.35 : 0.3) * half(s));
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  // Small side fin behind the head.
  ctx.fillStyle = colors.fin;
  ctx.beginPath();
  ctx.ellipse(spineX(0.8), spineY(0.8) + 0.03 * l, 0.04 * l, 0.018 * l, -0.5, 0, TAU);
  ctx.fill();

  // Eye and mouth.
  const eye = at(0.93, -0.025 * l);
  ctx.fillStyle = "#16202a";
  ctx.beginPath();
  ctx.arc(eye.x, eye.y, 0.018 * l, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(eye.x + 0.005 * l, eye.y - 0.006 * l, 0.007 * l, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = shade(colors.body, -0.45);
  ctx.lineWidth = 0.012 * l;
  ctx.beginPath();
  const mouth = at(0.995, 0.012 * l);
  ctx.moveTo(mouth.x, mouth.y);
  ctx.lineTo(mouth.x - 0.04 * l, mouth.y + 0.008 * l);
  ctx.stroke();
}

/** 0 at `from`, 1 at `to`, smooth in between. Works in either direction. */
function smoothstep(from: number, to: number, x: number): number {
  const t = clamp((x - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
}


// ---------------------------------------------------------------------------------------------
// Lightning effect (render only, so Math.random is fine here)

/** One jagged line per jump (or per spark, for a current with nowhere to go), with its forks. */
type Bolt = { main: Point[]; forks: Point[][] }[];

/** The lightning's colours as "r, g, b": yellows in the standard palette, the eel's own in another. */
interface BoltTones {
  halo: string;
  band: string;
  /** Flash gradient: hot centre, middle, faded edge. */
  centre: string;
  middle: string;
  edge: string;
}

function currentEffect(event: FxEvent, colors: FishColors): Effect {
  const tones: BoltTones = {
    halo: channels(colors.tint("#ffc414")),
    band: channels(colors.tint("#ffea5a")),
    centre: channels(colors.tint("#ffffe6")),
    middle: channels(colors.tint("#ffdc3c")),
    edge: channels(colors.tint("#ffc814")),
  };
  const points = event.points && event.points.length > 0 ? event.points : [{ x: event.x, y: event.y }];
  const jumpCount = points.length - 1;
  const perJump = Math.min(BOLT_JUMP_SECONDS, (BOLT_SECONDS * 0.4) / Math.max(jumpCount, 1));
  let bolt = makeBolt(points);
  let frame = 0;

  return {
    life: BOLT_SECONDS,
    draw(ctx, t) {
      const seconds = t * BOLT_SECONDS;
      const f = Math.floor(seconds / BOLT_FLICKER_SECONDS);
      if (f !== frame) {
        frame = f;
        bolt = makeBolt(points);
      }
      const fade = 1 - t * t;
      const flicker = 0.7 + 0.3 * Math.random();
      const alpha = fade * flicker;
      const shown = jumpCount === 0 ? bolt.length : Math.min(jumpCount, Math.floor(seconds / perJump) + 1);
      const visible = bolt.slice(0, shown);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Flashes where the current starts and wherever it lands.
      glow(ctx, tones, points[0]!, 24 * (1 - t * 0.5), alpha);
      for (let i = 1; i <= Math.min(shown, jumpCount); i++) glow(ctx, tones, points[i]!, 15, alpha);

      const main = visible.map((b) => b.main);
      const all = [...main, ...visible.flatMap((b) => b.forks)];
      // Yellow halo and band in normal blending so they stay yellow over blue water, then a white-hot core.
      // A broad translucent band supplies the halo without a per-current shadow blur.
      stroke(ctx, all, `rgba(${tones.halo}, ${0.5 * alpha})`, 8);
      stroke(ctx, all, `rgba(${tones.band}, ${0.95 * alpha})`, 3);
      ctx.globalCompositeOperation = "lighter";
      stroke(ctx, main, `rgba(255, 255, 255, ${alpha})`, 1.2);
    },
  };
}

function stroke(ctx: CanvasRenderingContext2D, lines: Point[][], color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const line of lines) {
    line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  }
  ctx.stroke();
}

function glow(ctx: CanvasRenderingContext2D, tones: BoltTones, p: Point, radius: number, alpha: number): void {
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
  g.addColorStop(0, `rgba(${tones.centre}, ${0.95 * alpha})`);
  g.addColorStop(0.35, `rgba(${tones.middle}, ${0.6 * alpha})`);
  g.addColorStop(1, `rgba(${tones.edge}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, TAU);
  ctx.fill();
}

/** One jagged line per jump, plus short forks branching off it. A lone point gets a small spark burst. */
function makeBolt(points: Point[]): Bolt {
  const bolt: Bolt = [];
  if (points.length === 1) {
    const p = points[0]!;
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * TAU;
      const len = 10 + Math.random() * 10;
      bolt.push({ main: jagged(p, { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len }, 0.35), forks: [] });
    }
    return bolt;
  }
  for (let i = 1; i < points.length; i++) {
    const line = jagged(points[i - 1]!, points[i]!, 0.5);
    const forks: Point[][] = [];
    // Forks: short jagged spurs from random points on the bolt, angled off the direction of travel.
    const a = points[i - 1]!;
    const b = points[i]!;
    const dir = Math.atan2(b.y - a.y, b.x - a.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const count = 1 + Math.floor(Math.random() * 2);
    for (let k = 0; k < count; k++) {
      const from = line[1 + Math.floor(Math.random() * Math.max(1, line.length - 2))]!;
      const angle = dir + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.7);
      const forkLen = Math.min(30, len * (0.15 + Math.random() * 0.2));
      forks.push(jagged(from, { x: from.x + Math.cos(angle) * forkLen, y: from.y + Math.sin(angle) * forkLen }, 0.6));
    }
    bolt.push({ main: line, forks });
  }
  return bolt;
}

/** Midpoint displacement: splits the segment until pieces are short, nudging each midpoint sideways. */
function jagged(a: Point, b: Point, roughness: number): Point[] {
  const out: Point[] = [a];
  const split = (p: Point, q: Point, spread: number) => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 9) {
      out.push(q);
      return;
    }
    const off = (Math.random() - 0.5) * spread;
    const mid = { x: (p.x + q.x) / 2 - (dy / len) * off, y: (p.y + q.y) / 2 + (dx / len) * off };
    split(p, mid, spread * 0.5);
    split(mid, q, spread * 0.5);
  };
  split(a, b, Math.hypot(b.x - a.x, b.y - a.y) * roughness);
  return out;
}
