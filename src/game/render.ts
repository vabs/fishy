import { formatMoney } from "../format";
import { CHEST, chestInNet, coinBurst, type Chest } from "./chest";
import { FISH, FISH_KINDS, FISH_SPECS, MAX_FISH_SIZE, type FishKind } from "./fish";
import type { Effect } from "./fx";
import { diveEffect, drawGlints, glintBurst } from "./golden";
import { buildChestSprites, buildSprites, type ChestSprites, type FishSprites } from "./shapes";
import type { Stats } from "./stats";
import type { Fish, FxEvent, Point, World, WorldEvent } from "./world";
import type { GameViewport } from "./viewport";

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
  gold: "#ffd34d",
  goldFloater: "#ffe58a",
  hull: "#8a5a32",
  hullEdge: "#5b3a1f",
  deck: "#b07a48",
  bench: "#6e4526",
};

const FADE_IN_SECONDS = 0.4;
const FLOATER_SECONDS = 0.9;
/** A treasure payout's floater is bigger and stays up longer. */
const BIG_FLOATER_SECONDS = 1.6;
const PULSE_SECONDS = 0.25;
const PARTICLES_PER_CAPTURE = 8;
const PARTICLES_PER_GOLDEN = 16;
// These budgets affect decoration only; the World always processes every capture and payout.
const MAX_PARTICLES = 1200;
const MAX_FLOATERS = 80;
const MAX_PULSES = 12;
const MAX_EFFECTS = 64;
const MAX_HEAVY_EFFECTS = 12;
/** Golden fish and treasure effects, which aren't any fish type's fx. */
const MAX_BONUS_EFFECTS = 24;
const MAX_NET_TARGETS = 24;
const MAX_WHIRLPOOL_TARGETS = 96;
const MERGE_SECONDS = 0.1;

interface Floater {
  x: number;
  y: number;
  text: string;
  /** Capture payouts are formatted once after nearby captures have been combined. */
  value?: number;
  color: string;
  age: number;
  big?: boolean;
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
  /** Touch contact, in world coordinates; decoration only, never a second net. */
  finger?: Point | null;
}

/** Draws the world. Reads game state, never changes it. */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private viewScale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private background: HTMLCanvasElement | null = null;
  private readonly sprites = new Map<FishKind, FishSprites>();
  private chestSprites: ChestSprites | null = null;
  private floaters: Floater[] = [];
  private pulses: Pulse[] = [];
  private particles: Particle[] = [];
  private effects: { effect: Effect; age: number; event: FxEvent }[] = [];
  private bonusEffects: { effect: Effect; age: number }[] = [];
  private time = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not supported");
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number, view?: GameViewport): void {
    this.width = view?.worldWidth ?? width;
    this.height = view?.worldHeight ?? height;
    this.dpr = dpr;
    this.viewScale = view?.scale ?? 1;
    this.offsetX = view?.x ?? 0;
    this.offsetY = view?.y ?? 0;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.background = this.paintBackground();
    // Sprites are rendered at device resolution, which may have changed.
    this.sprites.clear();
    this.chestSprites = null;
    this.floaters = [];
    this.particles = [];
    this.pulses = [];
    this.effects = [];
    this.bonusEffects = [];
  }

  onEvent(event: WorldEvent): void {
    switch (event.type) {
      case "tick":
        if (this.pulses.length < MAX_PULSES) {
          this.pulses.push({ x: event.x, y: event.y, radius: event.radius, strong: event.hits > 0, age: 0 });
        }
        break;
      case "capture": {
        // A golden catch keeps its own payout, so it never merges with the plain catches around it.
        const floaterColor = event.golden ? COLORS.goldFloater : COLORS.floater;
        const nearby = this.floaters.find((f) =>
          f.value !== undefined && f.color === floaterColor && f.age < MERGE_SECONDS &&
          Math.hypot(f.x - event.x, f.y - event.y) <= 40,
        );
        if (nearby) {
          nearby.value! += event.value;
          nearby.text = "";
        } else if (this.floaters.length < MAX_FLOATERS) {
          this.floaters.push({ x: event.x, y: event.y, text: "", value: event.value, color: floaterColor, age: 0 });
        }
        if (event.golden) this.addBonusEffect(glintBurst(event.x, event.y, true));
        const color = event.golden ? COLORS.gold : FISH[event.kind].body;
        const perCapture = event.golden ? PARTICLES_PER_GOLDEN : PARTICLES_PER_CAPTURE;
        const count = Math.min(perCapture, MAX_PARTICLES - this.particles.length);
        for (let i = 0; i < count; i++) {
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
        if (this.floaters.length < MAX_FLOATERS) {
          this.floaters.push({ x: event.x, y: event.y - 18, text: `+${event.seconds}s`, color: COLORS.timeBonus, age: 0 });
        }
        break;
      case "fx":
        this.addEffect(event);
        break;
      case "golden":
        this.addBonusEffect(glintBurst(event.x, event.y, false));
        break;
      case "chest-open":
        this.addBonusEffect(coinBurst(event.x, event.y));
        this.addBonusEffect(glintBurst(event.x, event.y, true));
        this.floaters.push({ x: event.x, y: event.y - 10, text: `+${formatMoney(event.value)}`, color: COLORS.goldFloater, age: 0, big: true });
        break;
      case "golden-escape": {
        const sprites = this.sprite(event.kind);
        this.addBonusEffect(diveEffect(event, { image: sprites.silhouette, width: sprites.width, height: sprites.height }));
        break;
      }
    }
  }

  private addBonusEffect(effect: Effect): void {
    if (this.bonusEffects.length < MAX_BONUS_EFFECTS) this.bonusEffects.push({ effect, age: 0 });
  }

  private addEffect(event: FxEvent): void {
    if (event.kind === "epic" && event.name === "net") {
      const nearby = this.effects.find((e) =>
        e.event.kind === "epic" && e.event.name === "net" && e.age < MERGE_SECONDS &&
        Math.hypot(e.event.x - event.x, e.event.y - event.y) <= (e.event.radius ?? 90) * 0.35,
      );
      if (nearby) {
        const points = nearby.event.points!;
        for (const point of event.points ?? []) {
          if (points.length >= MAX_NET_TARGETS) break;
          points.push(point);
        }
        return;
      }
    }
    if (this.effects.length >= MAX_EFFECTS) return;
    if ((event.kind === "epic" || event.kind === "electric") &&
        this.effects.filter((e) => e.event.kind === event.kind).length >= MAX_HEAVY_EFFECTS) return;

    // Keep event data owned by the sim intact. The Epic effect reads this mutable target list
    // so nearby captures can share artwork; the number of rendered tethers stays bounded.
    const limit = event.kind === "epic" ? MAX_NET_TARGETS : MAX_WHIRLPOOL_TARGETS;
    const visual = { ...event, points: (event.points ?? []).slice(0, limit) };
    FISH_SPECS[event.kind].fx?.(visual, (effect) => {
      if (this.effects.length < MAX_EFFECTS) this.effects.push({ effect, age: 0, event: visual });
    });
  }

  draw({ world, pointer, stats, finger }: Scene, dt: number): void {
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
    if (world?.chest) this.drawChest(world.chest, netActive ? pointer : null, stats.netRadius);
    if (world) this.drawGoldenGlints(world);
    this.drawEffects();
    if (netActive) this.drawNet(pointer, stats.netRadius, world.tickProgress);
    if (netActive && finger) this.drawFinger(finger, pointer);
  }

  private resetTransform(): void {
    const scale = this.dpr * this.viewScale;
    this.ctx.setTransform(scale, 0, 0, scale, this.offsetX * this.dpr, this.offsetY * this.dpr);
  }

  private sprite(kind: FishKind): FishSprites {
    let sprites = this.sprites.get(kind);
    if (!sprites) {
      sprites = buildSprites(kind, this.dpr * this.viewScale);
      this.sprites.set(kind, sprites);
    }
    return sprites;
  }

  /** Leaves the transform set to the fish. Call resetTransform() after a batch. */
  private drawFish(fish: Fish, variant: "full" | "silhouette" | "flash" | "golden"): void {
    const ctx = this.ctx;
    const sprites = this.sprite(fish.kind);
    const cos = Math.cos(fish.heading);
    const sin = Math.sin(fish.heading);
    // Mirror fish swimming left so they stay belly-down.
    const flip = cos < 0 ? -1 : 1;
    const d = this.dpr * this.viewScale;
    ctx.setTransform(d * cos, d * sin, -d * sin * flip, d * cos * flip,
      d * fish.x + this.offsetX * this.dpr, d * fish.y + this.offsetY * this.dpr);
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
      this.drawFish(fish, fish.hitFlash > 0 ? "flash" : fish.golden ? "golden" : "full");
    }
    ctx.restore();

    for (const fish of world.fish) {
      if (Math.hypot(fish.x - pointer.x, fish.y - pointer.y) <= radius) this.drawHpBar(fish);
    }
  }

  /**
   * The treasure chest floats at the surface, so it's drawn in full colour over the fish, bobbing
   * in a ring of ripples. Its HP bar shows while the net reaches it.
   */
  private drawChest(chest: Chest, pointer: Point | null, netRadius: number): void {
    const ctx = this.ctx;
    this.chestSprites ??= buildChestSprites(this.dpr * this.viewScale);
    const sprites = this.chestSprites;
    const size = CHEST.size;
    ctx.save();
    ctx.globalAlpha = Math.min(1, chest.age / FADE_IN_SECONDS);
    for (const offset of [0, 0.5]) {
      const ripple = (chest.age * 0.6 + offset) % 1;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 * (1 - ripple)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(chest.x, chest.y + size * 0.3, size * (0.55 + 0.4 * ripple), size * (0.14 + 0.1 * ripple), 0, 0, TAU);
      ctx.stroke();
    }
    ctx.translate(chest.x, chest.y + Math.sin(chest.age * 1.8) * 2.5);
    ctx.rotate(Math.sin(chest.age * 1.3 + 0.6) * 0.06);
    ctx.drawImage(chest.hitFlash > 0 ? sprites.flash : sprites.full, -sprites.width / 2, -sprites.height / 2, sprites.width, sprites.height);
    ctx.restore();

    if (!pointer || !chestInNet(chest, pointer, netRadius)) return;
    const width = size * 0.9;
    const x = chest.x - width / 2;
    const y = chest.y - sprites.height / 2 - 8;
    ctx.fillStyle = COLORS.hpBack;
    ctx.fillRect(x, y, width, 4);
    ctx.fillStyle = COLORS.hpFill;
    ctx.fillRect(x, y, width * Math.max(0, chest.hp / chest.maxHp), 4);
  }

  /** Golden fish twinkle wherever they are, so they can be spotted outside the net as well as in it. */
  private drawGoldenGlints(world: World): void {
    const ctx = this.ctx;
    for (const fish of world.fish) {
      if (!fish.golden || fish.captured) continue;
      drawGlints(ctx, fish, FISH[fish.kind].size, this.time, Math.min(1, fish.age / FADE_IN_SECONDS));
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
    ctx.lineWidth = 2 / this.viewScale;
    ctx.strokeStyle = COLORS.net;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius, 0, TAU);
    ctx.stroke();

    // Charge arc: fills clockwise until the next tick.
    ctx.lineWidth = 3 / this.viewScale;
    ctx.strokeStyle = COLORS.netCharge;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius + 5, -Math.PI / 2, -Math.PI / 2 + charge * TAU);
    ctx.stroke();

    ctx.fillStyle = COLORS.net;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 2 / this.viewScale, 0, TAU);
    ctx.fill();
  }

  private drawFinger(finger: Point, net: Point): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1 / this.viewScale;
    ctx.beginPath();
    ctx.moveTo(net.x, net.y);
    ctx.lineTo(finger.x, finger.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(finger.x, finger.y, 10 / this.viewScale, 0, TAU);
    ctx.stroke();
    ctx.restore();
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
    this.floaters = this.floaters.filter((f) => f.age < (f.big ? BIG_FLOATER_SECONDS : FLOATER_SECONDS));
    this.pulses = this.pulses.filter((p) => p.age < PULSE_SECONDS);
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const e of this.effects) e.age += dt;
    this.effects = this.effects.filter((e) => e.age < e.effect.life);
    for (const e of this.bonusEffects) e.age += dt;
    this.bonusEffects = this.bonusEffects.filter((e) => e.age < e.effect.life);
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

    for (const { effect, age } of [...this.effects, ...this.bonusEffects]) {
      ctx.save();
      effect.draw(ctx, age / effect.life);
      ctx.restore();
    }

    const font = `bold ${15 / this.viewScale}px system-ui, sans-serif`;
    const bigFont = `bold ${26 / this.viewScale}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    for (const f of this.floaters) {
      const t = f.age / (f.big ? BIG_FLOATER_SECONDS : FLOATER_SECONDS);
      ctx.font = f.big ? bigFont : font;
      ctx.fillStyle = f.color;
      ctx.globalAlpha = 1 - t * t;
      if (!f.text && f.value !== undefined) f.text = `+${formatMoney(f.value)}`;
      ctx.fillText(f.text, f.x, f.y - 12 - t * (f.big ? 40 : 30));
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
