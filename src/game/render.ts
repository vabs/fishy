import { formatMoney } from "../format";
import { FISH, FISH_KINDS, FISH_SPECS, MAX_FISH_SIZE, type FishKind } from "./fish";
import type { Effect } from "./fx";
import { buildSprites, type FishSprites } from "./shapes";
import type { Stats } from "./stats";
import type { Fish, Point, World, WorldEvent } from "./world";

const TAU = Math.PI * 2;

const COLORS = {
  waterInner: "#2b8cab",
  waterOuter: "#124e6b",
  lens: "rgba(210, 245, 255, 0.14)",
  net: "rgba(255, 255, 255, 0.85)",
  netCharge: "rgba(255, 255, 255, 0.4)",
  hpBack: "rgba(0, 0, 0, 0.45)",
  hpFill: "#7ee081",
  floater: "#fff3c4",
  timeBonus: "#9ef0ff",
  hull: "#8a5a32",
  hullEdge: "#5b3a1f",
  deck: "#b07a48",
  bench: "#6e4526",
};

const FADE_IN_SECONDS = 0.4;
const FLOATER_SECONDS = 0.9;
const PULSE_SECONDS = 0.25;
const PARTICLES_PER_CAPTURE = 8;

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
}

interface Pulse {
  x: number;
  y: number;
  radius: number;
  strong: boolean;
  age: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  age: number;
  life: number;
}

export interface Scene {
  world: World | null;
  pointer: Point | null;
  stats: Stats;
}

/** Draws the world. Reads game state, never changes it. */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private background: HTMLCanvasElement | null = null;
  private readonly sprites = new Map<FishKind, FishSprites>();
  private floaters: Floater[] = [];
  private pulses: Pulse[] = [];
  private particles: Particle[] = [];
  private effects: { effect: Effect; age: number }[] = [];
  private time = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not supported");
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.background = this.paintBackground();
    // Sprites are rendered at device resolution, which may have changed.
    this.sprites.clear();
  }

  onEvent(event: WorldEvent): void {
    switch (event.type) {
      case "tick":
        this.pulses.push({ x: event.x, y: event.y, radius: event.radius, strong: event.hits > 0, age: 0 });
        break;
      case "capture": {
        this.floaters.push({ x: event.x, y: event.y, text: `+${formatMoney(event.value)}`, color: COLORS.floater, age: 0 });
        const color = FISH[event.kind].body;
        for (let i = 0; i < PARTICLES_PER_CAPTURE; i++) {
          const angle = Math.random() * TAU;
          const speed = 40 + Math.random() * 60;
          this.particles.push({
            x: event.x,
            y: event.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color,
            age: 0,
            life: 0.3 + Math.random() * 0.3,
          });
        }
        break;
      }
      case "time-bonus":
        this.floaters.push({ x: event.x, y: event.y - 18, text: `+${event.seconds}s`, color: COLORS.timeBonus, age: 0 });
        break;
      case "fx":
        FISH_SPECS[event.kind].fx?.(event, (effect) => this.effects.push({ effect, age: 0 }));
        break;
    }
  }

  draw({ world, pointer, stats }: Scene, dt: number): void {
    this.time += dt;
    this.advanceEffects(dt);

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.background) ctx.drawImage(this.background, 0, 0);
    this.resetTransform();

    this.drawBoat();
    if (world) {
      for (const fish of world.fish) this.drawFish(fish, "silhouette");
      this.resetTransform();
    }

    const netActive = world && !world.over && pointer;
    if (netActive) this.drawLens(world, pointer, stats.netRadius);
    if (world) for (const kind of FISH_KINDS) FISH_SPECS[kind].drawWorld?.(ctx, world, this.time);
    this.drawEffects();
    if (netActive) this.drawNet(pointer, stats.netRadius, world.tickProgress);
  }

  private resetTransform(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private sprite(kind: FishKind): FishSprites {
    let sprites = this.sprites.get(kind);
    if (!sprites) {
      sprites = buildSprites(kind, this.dpr);
      this.sprites.set(kind, sprites);
    }
    return sprites;
  }

  /** Leaves the transform set to the fish. Call resetTransform() after a batch. */
  private drawFish(fish: Fish, variant: "full" | "silhouette" | "flash"): void {
    const ctx = this.ctx;
    const sprites = this.sprite(fish.kind);
    const cos = Math.cos(fish.heading);
    const sin = Math.sin(fish.heading);
    // Mirror fish swimming left so they stay belly-down.
    const flip = cos < 0 ? -1 : 1;
    const d = this.dpr;
    ctx.setTransform(d * cos, d * sin, -d * sin * flip, d * cos * flip, d * fish.x, d * fish.y);
    ctx.globalAlpha = Math.min(1, fish.age / FADE_IN_SECONDS);
    ctx.drawImage(sprites[variant], -sprites.width / 2, -sprites.height / 2, sprites.width, sprites.height);
    ctx.globalAlpha = 1;
  }

  /** Inside the net, fish are drawn in full colour over their silhouettes. */
  private drawLens(world: World, pointer: Point, radius: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius, 0, TAU);
    ctx.clip();
    ctx.fillStyle = COLORS.lens;
    ctx.fillRect(pointer.x - radius, pointer.y - radius, radius * 2, radius * 2);
    const reach = radius + MAX_FISH_SIZE;
    for (const fish of world.fish) {
      if (Math.hypot(fish.x - pointer.x, fish.y - pointer.y) > reach) continue;
      this.drawFish(fish, fish.hitFlash > 0 ? "flash" : "full");
    }
    ctx.restore();

    for (const fish of world.fish) {
      if (Math.hypot(fish.x - pointer.x, fish.y - pointer.y) <= radius) this.drawHpBar(fish);
    }
  }

  private drawHpBar(fish: Fish): void {
    const ctx = this.ctx;
    const size = FISH[fish.kind].size;
    const width = size * 0.7;
    const x = fish.x - width / 2;
    const y = fish.y - size * 0.45 - 6;
    ctx.fillStyle = COLORS.hpBack;
    ctx.fillRect(x, y, width, 3);
    ctx.fillStyle = COLORS.hpFill;
    ctx.fillRect(x, y, width * Math.max(0, fish.hp / fish.maxHp), 3);
  }

  private drawNet(pointer: Point, radius: number, charge: number): void {
    const ctx = this.ctx;
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.net;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius, 0, TAU);
    ctx.stroke();

    // Charge arc: fills clockwise until the next tick.
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.netCharge;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius + 5, -Math.PI / 2, -Math.PI / 2 + charge * TAU);
    ctx.stroke();

    ctx.fillStyle = COLORS.net;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 2, 0, TAU);
    ctx.fill();
  }

  private drawBoat(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.rotate(Math.sin(this.time * 1.2) * 0.04);

    ctx.fillStyle = COLORS.hull;
    ctx.strokeStyle = COLORS.hullEdge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-40, -15);
    ctx.quadraticCurveTo(15, -24, 44, 0);
    ctx.quadraticCurveTo(15, 24, -40, 15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = COLORS.deck;
    ctx.beginPath();
    ctx.moveTo(-34, -10);
    ctx.quadraticCurveTo(12, -17, 34, 0);
    ctx.quadraticCurveTo(12, 17, -34, 10);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = COLORS.bench;
    ctx.fillRect(-18, -12, 5, 24);
    ctx.fillRect(6, -12, 5, 24);
    ctx.restore();
  }

  private advanceEffects(dt: number): void {
    for (const f of this.floaters) f.age += dt;
    for (const p of this.pulses) p.age += dt;
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.floaters = this.floaters.filter((f) => f.age < FLOATER_SECONDS);
    this.pulses = this.pulses.filter((p) => p.age < PULSE_SECONDS);
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const e of this.effects) e.age += dt;
    this.effects = this.effects.filter((e) => e.age < e.effect.life);
  }

  private drawEffects(): void {
    const ctx = this.ctx;

    ctx.lineWidth = 2;
    for (const p of this.pulses) {
      const t = p.age / PULSE_SECONDS;
      ctx.strokeStyle = `rgba(255, 255, 255, ${(1 - t) * (p.strong ? 0.6 : 0.15)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * (1 + 0.15 * t), 0, TAU);
      ctx.stroke();
    }

    for (const p of this.particles) {
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, TAU);
      ctx.fill();
    }

    for (const { effect, age } of this.effects) {
      ctx.save();
      effect.draw(ctx, age / effect.life);
      ctx.restore();
    }

    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const f of this.floaters) {
      const t = f.age / FLOATER_SECONDS;
      ctx.fillStyle = f.color;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillText(f.text, f.x, f.y - 12 - t * 30);
    }
    ctx.globalAlpha = 1;
  }

  private paintBackground(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = this.canvas.width;
    canvas.height = this.canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not supported");
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(cx, cy));
    gradient.addColorStop(0, COLORS.waterInner);
    gradient.addColorStop(1, COLORS.waterOuter);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }
}
