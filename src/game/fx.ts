import { createRng } from "./rng";

/** A short-lived visual effect owned by the renderer. */
export interface Effect {
  /** Seconds the effect lasts. */
  life: number;
  /** Draws the effect. `t` runs from 0 (start) to 1 (end). The context is in CSS px. */
  draw(ctx: CanvasRenderingContext2D, t: number): void;
}

/** A screen-space coin's raised flight path; t is clamped to [0, 1]. */
export function coinFlight(from: { x: number; y: number }, to: { x: number; y: number }, t: number): { x: number; y: number; scale: number } {
  t = Math.min(1, Math.max(0, t));
  if (t === 0) return { ...from, scale: 1 };
  if (t === 1) return { ...to, scale: 0.15 };
  // Brief anticipation/pop, then acceleration toward the counter.
  const travel = t * t;
  const lift = Math.sin(Math.PI * t) * Math.min(100, 30 + Math.hypot(to.x - from.x, to.y - from.y) * 0.18);
  return {
    x: from.x + (to.x - from.x) * travel,
    y: from.y + (to.y - from.y) * travel - lift,
    // Keep an identifiable coin during travel; shrink only as it enters the counter.
    scale: (1 + Math.sin(Math.PI * Math.min(1, t * 3)) * 0.2) * (1 - Math.max(0, (t - 0.78) / 0.22) * 0.85),
  };
}

/** Seeded, periodic Voronoi cells for a 512 px caustic tile. Computed only when caching light. */
export function causticCells(): { x: number; y: number }[][] {
  const size = 512;
  const rng = createRng(81477);
  const sites: { x: number; y: number }[] = [];
  while (sites.length < 48) {
    const candidate = { x: rng() * size, y: rng() * size };
    // Keep tiny slivers out, but leave the larger empty patches that make light cells organic.
    if (sites.some((p) => {
      const dx = Math.min(Math.abs(candidate.x - p.x), size - Math.abs(candidate.x - p.x));
      const dy = Math.min(Math.abs(candidate.y - p.y), size - Math.abs(candidate.y - p.y));
      return Math.hypot(dx, dy) < 28;
    })) continue;
    sites.push(candidate);
  }
  const neighbours = sites.flatMap((p) => [-1, 0, 1].flatMap((x) =>
    [-1, 0, 1].map((y) => ({ x: p.x + x * size, y: p.y + y * size })),
  ));
  return sites.map((site) => {
    let cell = [
      { x: site.x - size, y: site.y - size }, { x: site.x + size, y: site.y - size },
      { x: site.x + size, y: site.y + size }, { x: site.x - size, y: site.y + size },
    ];
    for (const other of neighbours) {
      const dx = other.x - site.x;
      const dy = other.y - site.y;
      if (dx === 0 && dy === 0) continue;
      const halfway = (other.x ** 2 + other.y ** 2 - site.x ** 2 - site.y ** 2) / 2;
      const clipped: { x: number; y: number }[] = [];
      for (let i = 0; i < cell.length; i++) {
        const a = cell[i]!;
        const b = cell[(i + 1) % cell.length]!;
        const da = a.x * dx + a.y * dy - halfway;
        const db = b.x * dx + b.y * dy - halfway;
        if (da <= 0) clipped.push(a);
        if ((da <= 0) !== (db <= 0)) {
          const t = da / (da - db);
          clipped.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      }
      cell = clipped;
    }
    return cell;
  });
}

/** Deterministic world shake in CSS pixels, bounded by 6 px and settled after 250 ms. */
export function shakeOffset(amount: number, age: number): { x: number; y: number } {
  const envelope = Math.max(0, 1 - Math.max(0, age) / 0.25) ** 2;
  const radius = Math.min(6, Math.max(0, amount)) * envelope;
  if (radius === 0) return { x: 0, y: 0 };
  const x = Math.cos(age * 107);
  const y = Math.sin(age * 113) * 0.6;
  const bound = Math.max(1, Math.hypot(x, y));
  return { x: x * radius / bound, y: y * radius / bound };
}

const glowSprites = new Map<string, HTMLCanvasElement>();

/** Draws a soft light from a small cached sprite, rather than a gradient every frame. */
export function drawGlow(ctx: CanvasRenderingContext2D, channels: string, x: number, y: number, radius: number, alpha: number): void {
  let sprite = glowSprites.get(channels);
  if (!sprite) {
    if (typeof document === "undefined") return;
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = 96;
    const paint = sprite.getContext("2d");
    if (!paint) return;
    const gradient = paint.createRadialGradient(48, 48, 0, 48, 48, 48);
    gradient.addColorStop(0, `rgba(${channels}, 1)`);
    gradient.addColorStop(1, `rgba(${channels}, 0)`);
    paint.fillStyle = gradient;
    paint.fillRect(0, 0, 96, 96);
    // Fixed palette colours normally keep this under ten entries.
    if (glowSprites.size >= 32) glowSprites.clear();
    glowSprites.set(channels, sprite);
  }
  const previous = ctx.globalAlpha;
  ctx.globalAlpha = previous * Math.max(0, Math.min(1, alpha));
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = previous;
}

const chumSprites = new Map<boolean, HTMLCanvasElement>();

/** Draws cached soft chum pigment, as a broad plume or a hollow reduced-motion tint ring. */
export function drawChumShape(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number, ring = false): void {
  if (radius <= 0 || alpha <= 0) return;
  let sprite = chumSprites.get(ring);
  if (!sprite) {
    if (typeof document === "undefined") return;
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = 160;
    const paint = sprite.getContext("2d");
    if (!paint) return;
    const gradient = paint.createRadialGradient(80, 80, 0, 80, 80, 80);
    const stops: readonly (readonly [number, number])[] = ring ? [[0, 0], [0.28, 0], [0.58, 0.55], [0.76, 0.42], [1, 0]] : [[0, 0.75], [0.3, 0.65], [0.65, 0.3], [1, 0]];
    for (const [offset, opacity] of stops) gradient.addColorStop(offset, `rgba(151, 76, 49, ${opacity})`);
    paint.fillStyle = gradient;
    paint.fillRect(0, 0, 160, 160);
    chumSprites.set(ring, sprite);
  }
  const previous = ctx.globalAlpha;
  ctx.globalAlpha = previous * Math.min(1, alpha);
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = previous;
}

/** Re-arm progress, from empty at the snap to one when ready. */
export function cooldownArcFraction(cooldown: number, resetSeconds: number): number {
  return resetSeconds <= 0 ? 1 : Math.max(0, Math.min(1, 1 - cooldown / resetSeconds));
}

/** A small, deterministic foam burst; callers omit it for reduced motion. */
export function waterSplash(x: number, y: number, radius = 24): Effect {
  return {
    life: 0.5,
    draw(ctx, t) {
      ctx.strokeStyle = `rgba(232, 251, 255, ${0.65 * (1 - t)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * (0.3 + t), radius * (0.2 + t * 0.6), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#e8fbff";
      ctx.globalAlpha *= 0.7 * (1 - t);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4 + 0.2;
        const distance = radius * (0.2 + t * 0.8);
        const px = x + Math.cos(angle) * distance;
        const py = y + Math.sin(angle) * distance * 0.6 - Math.sin(t * Math.PI) * 10;
        ctx.moveTo(px + 1.5, py);
        ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      }
      ctx.fill();
    },
  };
}

/** Point on a gently sagging quadratic rope; sag stays within the seine's hit reach. */
export function ropeSagPoint(a: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
  t = Math.max(0, Math.min(1, t));
  const sag = Math.min(18, Math.hypot(b.x - a.x, b.y - a.y) * 0.08);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + 2 * (1 - t) * t * sag };
}

/** Normalized cloud opacity over the configured chum lifetime. */
export function chumCloudAlpha(age: number, seconds: number): number {
  return seconds <= 0 ? 0 : Math.max(0, Math.min(1, 1 - age / seconds)) ** 1.3;
}

/** Lure light follows its actual range; a locked lantern retains the small ordinary night lamp. */
export function lanternLightRadius(upgradeRadius: number, night: number): number {
  return upgradeRadius > 0 ? upgradeRadius : night > 0 ? 125 : 0;
}
