import type { Effect } from "../fx";
import type { Fish, FxEvent, Point } from "../world";
import { channels, shade } from "./color";
import type { FishColors, FishDef, FishSpec } from "./types";

const TAU = Math.PI * 2;

/**
 * Flee tuning. The anglerfish is shy but must stay catchable:
 * - It notices the cursor within `netRadius + alertMargin` px and calms down once it is
 *   `calmMargin` px further than that.
 * - It flees straight away from the cursor at up to `speed` px/s, well below how fast a mouse moves.
 *   Speed falls to `minSpeedFactor` of that as stamina runs down, and is cut by `inNetFactor` while
 *   the fish is inside the net.
 * - Stamina lasts `burstSeconds` of fleeing. Then it is tired for `tiredSeconds`: it can't flee and
 *   swims at `tiredSpeedMult`. Stamina refills over `recoverSafe` s once the cursor leaves, but only
 *   over `recoverThreatened` s while it stays close, so a chased fish manages short bursts at best.
 * - It never strays more than `maxOffset` px from its orbit path, keeps its centre `screenMargin` px
 *   inside the screen and `boatClearance` px from the boat, and swims back to its orbit at up to
 *   `returnSpeed` px/s when the cursor is gone.
 */
export const EPIC_FLEE = {
  alertMargin: 60,
  calmMargin: 20,
  speed: 110,
  minSpeedFactor: 0.4,
  inNetFactor: 0.5,
  burstSeconds: 1.4,
  tiredSeconds: 1.6,
  tiredSpeedMult: 0.5,
  recoverSafe: 2.5,
  recoverThreatened: 5,
  maxOffset: 140,
  returnSpeed: 50,
  screenMargin: 16,
  boatClearance: 60,
};

/** Seconds the cast-net effect lasts, and the share of it spent opening. */
const NET_SECONDS = 0.7;
const NET_CAST = 0.45;

/** Chain capture: shies away from the cursor; when captured, may net every fish around it. */
export const epic: FishSpec = {
  def: {
    name: "Epic",
    hp: 5,
    value: 30,
    speed: 45,
    size: 36,
    wobble: 8,
    wobbleSpeed: 1.4,
    body: "#b07cf2",
    fin: "#7a45c4",
  },
  shape: drawAnglerfish,
  box: { width: 1.3, height: 1 },

  onSpawn(_world, fish) {
    const s = angler(fish);
    s.stamina = 1;
    s.tired = 0;
    s.alert = 0;
  },

  move(world, fish, dt) {
    const f = EPIC_FLEE;
    const s = angler(fish);
    // Where the orbit alone puts it, from the last placement. One step stale, which is under a pixel.
    const homeX = fish.x - fish.offsetX;
    const homeY = fish.y - fish.offsetY;
    let ox = fish.offsetX;
    let oy = fish.offsetY;

    const pointer = world.pointer;
    const reach = world.stats.netRadius + f.alertMargin + (s.alert ? f.calmMargin : 0);
    const threatened = pointer !== null && Math.hypot(fish.x - pointer.x, fish.y - pointer.y) < reach;
    s.alert = threatened ? 1 : 0;
    s.tired = Math.max(0, s.tired - dt);

    if (pointer && threatened && s.tired === 0 && s.stamina > 0) {
      let dx = fish.x - pointer.x;
      let dy = fish.y - pointer.y;
      let d = Math.hypot(dx, dy);
      if (d < 1e-6) {
        dx = Math.cos(fish.heading);
        dy = Math.sin(fish.heading);
        d = 1;
      }
      const speed =
        f.speed *
        (f.minSpeedFactor + (1 - f.minSpeedFactor) * s.stamina) *
        (world.inNet(fish, pointer) ? f.inNetFactor : 1);
      ox += (dx / d) * speed * dt;
      oy += (dy / d) * speed * dt;
      s.stamina = Math.max(0, s.stamina - dt / f.burstSeconds);
      if (s.stamina === 0) s.tired = f.tiredSeconds;
    } else {
      s.stamina = Math.min(1, s.stamina + dt / (threatened ? f.recoverThreatened : f.recoverSafe));
      if (!threatened) {
        // Drift back to the orbit, slowing for the last few pixels.
        const away = Math.hypot(ox, oy);
        if (away > 0) {
          const step = Math.min(away, Math.min(f.returnSpeed, 8 + away * 2) * dt);
          ox -= (ox / away) * step;
          oy -= (oy / away) * step;
        }
      }
    }

    const away = Math.hypot(ox, oy);
    if (away > f.maxOffset) {
      ox *= f.maxOffset / away;
      oy *= f.maxOffset / away;
    }
    // Stay clear of the boat.
    const cx = world.width / 2;
    const cy = world.height / 2;
    const fromBoat = Math.hypot(homeX + ox - cx, homeY + oy - cy);
    if (fromBoat < f.boatClearance) {
      const k = f.boatClearance / Math.max(fromBoat, 1e-6);
      ox = cx + (homeX + ox - cx) * k - homeX;
      oy = cy + (homeY + oy - cy) * k - homeY;
    }
    // Stay on screen. Home is always inside these bounds, so this only ever pulls the fish back.
    ox = clamp(homeX + ox, f.screenMargin, world.width - f.screenMargin) - homeX;
    oy = clamp(homeY + oy, f.screenMargin, world.height - f.screenMargin) - homeY;

    fish.offsetX = ox;
    fish.offsetY = oy;
    fish.speedMult = s.tired > 0 ? f.tiredSpeedMult : 1;
  },

  onCapture(world, fish) {
    const { chance, range } = world.stats.ability.epic;
    const caught: Point[] = [];
    for (const other of world.fishNear(fish, range)) {
      if (other === fish) continue;
      if (world.rng() < chance) {
        world.capture(other, "epic");
        caught.push({ x: other.x, y: other.y });
      }
    }
    world.emit({ type: "fx", kind: "epic", name: "net", x: fish.x, y: fish.y, radius: range, points: caught });
  },

  fx(event, add, colors) {
    if (event.name === "net") add(netEffect(event, colors));
  },
};

/** Per-fish flee state, kept in `fish.state`. */
type AnglerState = {
  /** 0 to 1. Used up by fleeing. */
  stamina: number;
  /** Seconds left before it can flee again. */
  tired: number;
  /** 1 while it has noticed the cursor. */
  alert: number;
};

function angler(fish: Fish): AnglerState {
  return fish.state as AnglerState;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------------------------
// Outline

/** Anglerfish: big head with a gaping, toothy mouth, small tail, and a lure dangling in front. */
function drawAnglerfish(ctx: CanvasRenderingContext2D, def: FishDef, colors: FishColors): void {
  const l = def.size;
  ctx.lineJoin = "round";

  // Tail fan.
  ctx.fillStyle = colors.fin;
  ctx.beginPath();
  ctx.moveTo(-0.27 * l, -0.05 * l);
  ctx.lineTo(-0.5 * l, -0.2 * l);
  ctx.quadraticCurveTo(-0.43 * l, 0, -0.5 * l, 0.2 * l);
  ctx.lineTo(-0.27 * l, 0.05 * l);
  ctx.closePath();
  ctx.fill();

  // Soft back fin.
  ctx.beginPath();
  ctx.moveTo(-0.22 * l, -0.1 * l);
  ctx.quadraticCurveTo(-0.16 * l, -0.27 * l, -0.02 * l, -0.24 * l);
  ctx.lineTo(0.02 * l, -0.18 * l);
  ctx.closePath();
  ctx.fill();

  // Lure: a stalk arching forward from the forehead to a glowing bulb in front of the mouth.
  const bulb = { x: 0.55 * l, y: -0.18 * l };
  ctx.strokeStyle = colors.fin;
  ctx.lineWidth = 0.05 * l;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0.12 * l, -0.27 * l);
  ctx.quadraticCurveTo(0.34 * l, -0.66 * l, bulb.x, bulb.y - 0.05 * l);
  ctx.stroke();

  // Body: tall rounded head tapering to the tail, with the mouth cut in as a wide wedge.
  const body = ctx.createLinearGradient(0, -0.32 * l, 0, 0.3 * l);
  body.addColorStop(0, shade(colors.body, -0.15));
  body.addColorStop(0.55, colors.body);
  body.addColorStop(1, shade(colors.body, 0.3));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-0.3 * l, -0.055 * l);
  ctx.bezierCurveTo(-0.16 * l, -0.1 * l, -0.06 * l, -0.33 * l, 0.14 * l, -0.32 * l);
  ctx.bezierCurveTo(0.31 * l, -0.31 * l, 0.42 * l, -0.19 * l, 0.43 * l, -0.07 * l);
  ctx.lineTo(0.19 * l, 0.02 * l);
  ctx.lineTo(0.47 * l, 0.07 * l);
  ctx.bezierCurveTo(0.45 * l, 0.25 * l, 0.22 * l, 0.31 * l, 0.03 * l, 0.26 * l);
  ctx.bezierCurveTo(-0.12 * l, 0.21 * l, -0.2 * l, 0.08 * l, -0.3 * l, 0.055 * l);
  ctx.closePath();
  ctx.fill();

  // Teeth along both jaws.
  ctx.fillStyle = "#f6f1ff";
  const teeth = (from: Point, to: Point, count: number, point: 1 | -1) => {
    for (let i = 0; i < count; i++) {
      const a = (i + 0.15) / count;
      const b = (i + 0.85) / count;
      const m = (i + 0.5) / count;
      const ax = from.x + (to.x - from.x) * a;
      const ay = from.y + (to.y - from.y) * a;
      const bx = from.x + (to.x - from.x) * b;
      const by = from.y + (to.y - from.y) * b;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(from.x + (to.x - from.x) * m, from.y + (to.y - from.y) * m + point * 0.055 * l);
      ctx.lineTo(bx, by);
      ctx.closePath();
      ctx.fill();
    }
  };
  teeth({ x: 0.42 * l, y: -0.065 * l }, { x: 0.25 * l, y: -0.003 * l }, 3, 1);
  teeth({ x: 0.25 * l, y: 0.03 * l }, { x: 0.46 * l, y: 0.068 * l }, 3, -1);

  // Side fin.
  ctx.fillStyle = colors.fin;
  ctx.beginPath();
  ctx.ellipse(-0.03 * l, 0.11 * l, 0.08 * l, 0.04 * l, 0.5, 0, TAU);
  ctx.fill();

  // Eye.
  ctx.fillStyle = "#fdf6d8";
  ctx.beginPath();
  ctx.arc(0.22 * l, -0.17 * l, 0.05 * l, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#16202a";
  ctx.beginPath();
  ctx.arc(0.23 * l, -0.17 * l, 0.03 * l, 0, TAU);
  ctx.fill();

  // Bulb.
  const glow = ctx.createRadialGradient(bulb.x - 0.015 * l, bulb.y - 0.015 * l, 0, bulb.x, bulb.y, 0.07 * l);
  glow.addColorStop(0, "#ffffff");
  glow.addColorStop(0.5, "#fff3a0");
  glow.addColorStop(1, "#f2c94c");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(bulb.x, bulb.y, 0.07 * l, 0, TAU);
  ctx.fill();
}


// ---------------------------------------------------------------------------------------------
// Cast-net effect (render only, so Math.random is fine here)

function netEffect(event: FxEvent, colors: FishColors): Effect {
  // Lavender in the standard palette, the Epic's own colour in another; "r, g, b" for rgba().
  const flashEdge = channels(colors.tint("#c8a0ff"));
  const mesh = channels(colors.tint("#e2ceff"));
  const rim = channels(colors.tint("#f4eaff"));
  const rimGlow = channels(colors.body);
  const centre = { x: event.x, y: event.y };
  const radius = event.radius ?? 90;
  const targets = event.points ?? [];
  const spokes = 14;
  const spin = Math.random() * TAU;
  const at = (angle: number, r: number) => ({ x: centre.x + Math.cos(angle) * r, y: centre.y + Math.sin(angle) * r });

  /** One ring of mesh, sagging inward between spokes like a real net. */
  const ring = (ctx: CanvasRenderingContext2D, r: number) => {
    for (let i = 0; i < spokes; i++) {
      const a0 = spin + (i * TAU) / spokes;
      const a1 = spin + ((i + 1) * TAU) / spokes;
      const p0 = at(a0, r);
      const p1 = at(a1, r);
      const c = at((a0 + a1) / 2, r * 0.9);
      if (i === 0) ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(c.x, c.y, p1.x, p1.y);
    }
  };

  return {
    life: NET_SECONDS,
    draw(ctx, t) {
      const cast = Math.min(1, t / NET_CAST);
      const r = radius * (1 - (1 - cast) ** 3);
      const alpha = t < NET_CAST ? 1 : 1 - (t - NET_CAST) / (1 - NET_CAST);
      ctx.lineCap = "round";

      // Flash where the Epic was caught.
      const flash = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, 28);
      flash.addColorStop(0, `rgba(255, 255, 255, ${0.8 * (1 - cast)})`);
      flash.addColorStop(1, `rgba(${flashEdge}, 0)`);
      ctx.fillStyle = flash;
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, 28, 0, TAU);
      ctx.fill();

      // Mesh: spokes and inner rings.
      ctx.strokeStyle = `rgba(${mesh}, ${0.7 * alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < spokes; i++) {
        const a = spin + (i * TAU) / spokes;
        const p0 = at(a, r * 0.1);
        const p1 = at(a, r);
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
      }
      ring(ctx, r * 0.4);
      ring(ctx, r * 0.7);
      ctx.stroke();

      // Rim, glowing, with sinker weights at each spoke.
      ctx.strokeStyle = `rgba(${rim}, ${alpha})`;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = `rgba(${rimGlow}, 0.95)`;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ring(ctx, r);
      ctx.stroke();
      // The glow belongs to the rim, not fourteen separate dots and every captured fish.
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.fillStyle = `rgba(${rim}, ${alpha})`;
      ctx.beginPath();
      for (let i = 0; i < spokes; i++) {
        const p = at(spin + (i * TAU) / spokes, r);
        ctx.moveTo(p.x + 2, p.y);
        ctx.arc(p.x, p.y, 2, 0, TAU);
      }
      ctx.fill();

      // Each captured fish gets a tether from the centre and a snare closing round it,
      // once the net has opened far enough to reach it.
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * alpha})`;
      ctx.beginPath();
      for (const p of targets) {
        if (Math.hypot(p.x - centre.x, p.y - centre.y) > r + 2) continue;
        ctx.moveTo(centre.x, centre.y);
        ctx.lineTo(p.x, p.y);
        const snare = 13 - 6 * t;
        ctx.moveTo(p.x + snare, p.y);
        ctx.arc(p.x, p.y, snare, 0, TAU);
      }
      ctx.stroke();
    },
  };
}
