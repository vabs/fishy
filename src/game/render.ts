import { formatMoney } from "../format";
import { CHEST, chestInNet, coinBurst, type Chest } from "./chest";
import { FISH, FISH_KINDS, FISH_SPECS, MAX_FISH_SIZE, type FishKind } from "./fish";
import { causticCells, chumCloudAlpha, coinFlight, cooldownArcFraction, drawChumShape, drawGlow, lanternLightRadius, ropeSagPoint, shakeOffset, waterSplash, type Effect } from "./fx";
import { loadArt, onArtReady } from "./art";
import { diveEffect, sparklePath, glintBurst } from "./golden";
import { fishColors, getPalette, type PaletteName } from "./palette";
import { buildChestSprites, buildSprites, type ChestSprites, type FishSprites } from "./shapes";
import type { Trap } from "./rigging";
import type { Stats } from "./stats";
import type { Fish, FxEvent, Point, World, WorldEvent } from "./world";
import type { GameViewport } from "./viewport";

const TAU = Math.PI * 2;

const COLORS = {
  waterInner: "#2b8cab",
  waterOuter: "#124e6b",
  lens: "rgba(210, 245, 255, 0.14)",
  net: "#fff1cd",
  netCharge: "#d9a441",
  hpBack: "rgba(0, 0, 0, 0.45)",
  hpFill: "#7ee081",
  floater: "#fffbed",
  timeBonus: "#9ef0ff",
  gold: "#ffd34d",
  goldFloater: "#ffe58a",
  hull: "#8a5a32",
  hullEdge: "#5b3a1f",
  deck: "#b07a48",
  bench: "#6e4526",
  frenzyTint: "rgba(200, 255, 240, 0.11)",
  frenzyWake: "rgba(255, 255, 255, 0.16)",
  foam: "rgba(255, 255, 255, 0.8)",
};

const FADE_IN_SECONDS = 0.4;
const FLOATER_SECONDS = 0.9;
/** A treasure payout's floater is bigger and stays up longer. */
const BIG_FLOATER_SECONDS = 1.6;
const PULSE_SECONDS = 0.25;
const PARTICLES_PER_CAPTURE = 8;
const PARTICLES_PER_GOLDEN = 16;
// These budgets affect decoration only; the World always processes every capture and payout.
const MAX_PARTICLES = 360;
const MAX_FLOATERS = 80;
const MAX_PULSES = 12;
const MAX_EFFECTS = 64;
const MAX_HEAVY_EFFECTS = 12;
/** Golden fish and treasure effects, which aren't any fish type's fx. */
const MAX_BONUS_EFFECTS = 24;
const MAX_NET_TARGETS = 24;
const CATCH_SECONDS = 0.28;
const MAX_CATCH_SPRITES = 24;
const MAX_WHIRLPOOL_TARGETS = 96;
const MERGE_SECONDS = 0.1;
/** The Feeding Frenzy tint and foam fade in and out over this long at the ends of the wave. */
const FRENZY_FADE_SECONDS = 0.6;
/** Width of the bright wake behind the frenzy wave's front, px. */
const FRENZY_WAKE = 140;
const FOAM_BUBBLES = 64;
const RIPPLE_SECONDS = 0.5;
const CAUSTIC_MARGIN = 32;

/** Smooth, cyclic sea-only multiply tint. Dusk and dawn retain the water's contrast. */
export function seaTint(timeOfDay?: number): { color: string; alpha: number; night: number } {
  if (timeOfDay === undefined || !Number.isFinite(timeOfDay)) return { color: "rgb(0, 0, 0)", alpha: 0, night: 0 };
  const stops = [
    { rgb: [255, 220, 180], alpha: 0.035, night: 0 },
    { rgb: [193, 115, 160], alpha: 0.32, night: 0.25 },
    { rgb: [65, 84, 157], alpha: 0.46, night: 1 },
    { rgb: [239, 182, 165], alpha: 0.15, night: 0.15 },
  ];
  const phase = ((timeOfDay % 1 + 1) % 1) * 4;
  const a = stops[Math.floor(phase)]!;
  const b = stops[(Math.floor(phase) + 1) % 4]!;
  const f = phase % 1;
  const t = f * f * (3 - 2 * f);
  return {
    color: `rgb(${a.rgb.map((v, i) => Math.round(v + (b.rgb[i]! - v) * t)).join(", ")})`,
    alpha: a.alpha + (b.alpha - a.alpha) * t,
    night: a.night + (b.night - a.night) * t,
  };
}

/** Normalized combo arc, shortened as the simulation's combo window drains. */
export function comboRingLevel(mult: number, max: number, window: number): number {
  return max <= 1 ? 0 : Math.min(1, Math.max(0, (mult - 1) / (max - 1))) * Math.min(1, Math.max(0, window));
}

interface TrapVisual {
  snapAge: number;
  reset: number;
  cooling: boolean;
  readyAge: number;
  reveal: boolean;
}

interface TrapReveal extends Point {
  kind: FishKind;
  heading: number;
  golden: boolean;
  age: number;
}

interface FlyingCoin {
  from: Point;
  target: Point;
  age: number;
  life: number;
  count: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  /** Capture payouts are formatted once after nearby captures have been combined. */
  value?: number;
  /** Largest individual payout in a merged group, for the ten-times catch emphasis. */
  largestCatch?: number;
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

interface CatchSprite {
  kind: FishKind;
  golden: boolean;
  x: number;
  y: number;
  target: Point;
  age: number;
}

export interface Scene {
  world: World | null;
  pointer: Point | null;
  stats: Stats;
  /** Touch contact, in world coordinates; decoration only, never a second net. */
  finger?: Point | null;
  /** Endless sea phase: golden hour 0, dusk .25, night .5, dawn .75. */
  timeOfDay?: number;
  /** HUD counter centre in CSS screen pixels. */
  coinTarget?: Point | null;
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
  /** Palette the cached sprites were drawn in. */
  private palette: PaletteName = getPalette();
  private chestSprites: ChestSprites | null = null;
  private floaters: Floater[] = [];
  private pulses: Pulse[] = [];
  private particles: Particle[] = [];
  private catches: CatchSprite[] = [];
  private lastNetTick: (Point & { age: number }) | null = null;
  private netCinch = 0;
  private trapSprites = new Map<number, HTMLCanvasElement>();
  private trapVisuals = new Map<number, TrapVisual>();
  private trapReveals: TrapReveal[] = [];
  private chumCloud: (Point & { age: number }) | null = null;
  private snagAge = 1;
  private lastSeineSpark = -1;
  private readonly reducedMotion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  private effects: { effect: Effect; age: number; event: FxEvent }[] = [];
  private bonusEffects: { effect: Effect; age: number }[] = [];
  private time = 0;
  private readonly art = loadArt();
  private backgroundDirty = false;
  private caustics: HTMLCanvasElement[] = [];
  private causticTile: HTMLCanvasElement | null = null;
  private lantern: HTMLCanvasElement | null = null;
  private night = 0;
  private shakeAmount = 0;
  private shakeAge = 1;
  private shakeX = 0;
  private shakeY = 0;
  private captureBatch = 0;
  private pendingCoins: { x: number; y: number; count: number }[] = [];
  private coins: FlyingCoin[] = [];
  private coinArrivals = 0;
  private averageCatch = Infinity;
  private comboMult = 1;
  private comboPulse = 0;
  /** Fixed ripple pool: no per-capture allocation or unbounded growth. */
  private readonly ripples = Array.from({ length: 32 }, () => ({ x: 0, y: 0, age: 1 }));

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not supported");
    this.ctx = ctx;
    onArtReady(() => { this.backgroundDirty = true; });
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
    this.caustics = this.paintCaustics();
    this.lantern = this.paintLantern();
    // A viewport change cannot invalidate a pending HUD bump.
    this.coinArrivals += this.coins.reduce((sum, coin) => sum + coin.count, 0);
    this.coins = [];
    this.shakeAmount = 0;
    this.shakeX = this.shakeY = 0;
    for (const ripple of this.ripples) ripple.age = 1;
    // Sprites are rendered at device resolution, which may have changed.
    this.sprites.clear();
    this.chestSprites = null;
    if (this.chumCloud) {
      this.chumCloud.x = this.width / 2;
      this.chumCloud.y = this.height / 2;
    }
    this.trapSprites.clear();
    this.trapVisuals.clear();
    this.trapReveals.length = 0;
    this.floaters = [];
    this.particles = [];
    this.pulses = [];
    this.catches = [];
    this.lastNetTick = null;
    this.netCinch = 0;
    this.effects = [];
    this.bonusEffects = [];
  }

  /** Adds a brief world-only shake, in CSS pixels; ignored with reduced motion. */
  shake(amount: number): void {
    if (this.reducedMotion?.matches || !Number.isFinite(amount) || amount <= 0) return;
    this.shakeAmount = Math.min(6, Math.max(amount, this.shakeAmount * Math.max(0, 1 - this.shakeAge / 0.25)));
    this.shakeAge = 0;
  }

  /** Capture tokens that arrived since the last drain (merged coins retain their count). */
  drainCoinArrivals(): number {
    const arrived = this.coinArrivals;
    this.coinArrivals = 0;
    return arrived;
  }

  onEvent(event: WorldEvent): void {
    switch (event.type) {
      case "chum":
        this.chumCloud = { x: event.x, y: event.y, age: 0 };
        this.addBonusEffect(waterSplash(event.x, event.y, 48));
        break;
      case "seine-hit":
        if (this.time - this.lastSeineSpark >= 0.08) {
          this.lastSeineSpark = this.time;
          this.addBonusEffect({ life: 0.3, draw(ctx, t) {
            ctx.fillStyle = "#fff1cd"; ctx.globalAlpha *= 1 - t;
            ctx.beginPath(); sparklePath(ctx, event.x, event.y, 4 * Math.sin(Math.PI * t), 0); ctx.fill();
          } });
        }
        break;
      case "snag":
        this.snagAge = 0;
        break;
      case "trap-cast":
        this.trapVisuals.clear();
        this.trapReveals.length = 0;
        break;
      case "trap-snap":
        if (this.trapVisuals.size < 16 || this.trapVisuals.has(event.trapId)) {
          this.trapVisuals.set(event.trapId, { snapAge: 0, reset: 0, cooling: true, readyAge: 1, reveal: true });
        }
        this.addBonusEffect(waterSplash(event.x, event.y));
        break;
      case "tick":
        this.lastNetTick = { x: event.x, y: event.y, age: 0 };
        if (event.hits > 0 && !this.reducedMotion?.matches) this.netCinch = PULSE_SECONDS;
        if (!this.reducedMotion?.matches && this.pulses.length < MAX_PULSES) {
          this.pulses.push({ x: event.x, y: event.y, radius: event.radius, strong: event.hits > 0, age: 0 });
        }
        break;
      case "capture": {
        if (event.source === "trap" && !this.reducedMotion?.matches && this.trapReveals.length < 96) {
          this.trapReveals.push({ x: event.x, y: event.y, kind: event.kind, heading: 0, golden: !!event.golden, age: 0 });
        }
        this.captureBatch++;
        const pending = this.pendingCoins.at(-1);
        if (this.pendingCoins.length >= 40 && pending) pending.count++;
        else this.pendingCoins.push({ x: event.x, y: event.y, count: 1 });
        if (!this.reducedMotion?.matches) {
          const ripple = this.ripples.find((r) => r.age >= RIPPLE_SECONDS);
          if (ripple) { ripple.x = event.x; ripple.y = event.y; ripple.age = 0; }
        }
        const big = event.value >= this.averageCatch * 10;
        // Keep only a visual copy: capture, payout and the net's hit area stay owned by World.
        if (event.source === "net" && this.lastNetTick && this.lastNetTick.age <= MERGE_SECONDS &&
            !this.reducedMotion?.matches && this.catches.length < MAX_CATCH_SPRITES) {
          this.catches.push({
            kind: event.kind, golden: !!event.golden, x: event.x, y: event.y,
            target: { x: this.lastNetTick.x, y: this.lastNetTick.y }, age: 0,
          });
        }
        // A golden catch keeps its own payout, so it never merges with the plain catches around it.
        const floaterColor = event.golden ? COLORS.goldFloater : COLORS.floater;
        const nearby = this.floaters.find((f) =>
          f.value !== undefined && f.color === floaterColor && f.age < MERGE_SECONDS &&
          Math.hypot(f.x - event.x, f.y - event.y) <= 40,
        );
        if (nearby) {
          nearby.value! += event.value;
          nearby.text = "";
          nearby.big ||= big;
          nearby.largestCatch = Math.max(nearby.largestCatch ?? 0, event.value);
        } else if (this.floaters.length < MAX_FLOATERS) {
          this.floaters.push({ x: event.x, y: event.y, text: "", value: event.value, largestCatch: event.value, color: floaterColor, age: 0, big });
        }
        if (event.golden) this.addBonusEffect(glintBurst(event.x, event.y, true));
        const color = event.golden ? COLORS.gold : fishColors(event.kind).body;
        const perCapture = event.golden ? PARTICLES_PER_GOLDEN : PARTICLES_PER_CAPTURE;
        const count = this.reducedMotion?.matches ? 0 : Math.min(perCapture, MAX_PARTICLES - this.particles.length);
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
        if ((event.kind === "star" && event.name === "launch") || (event.kind === "monster" && event.name === "implode")) this.shake(4);
        if (!this.reducedMotion?.matches) this.addEffect(event);
        break;
      case "golden":
        this.addBonusEffect(glintBurst(event.x, event.y, false));
        break;
      case "chest-open":
        this.shake(5);
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
    if (!this.reducedMotion?.matches && this.bonusEffects.length < MAX_BONUS_EFFECTS) this.bonusEffects.push({ effect, age: 0 });
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
    }, fishColors(event.kind));
  }

  draw({ world, pointer, stats, finger, timeOfDay, coinTarget }: Scene, dt: number): void {
    dt = Math.max(0, dt);
    if (!this.reducedMotion?.matches) this.time += dt;
    this.advanceEffects(dt);
    if (this.captureBatch >= 8) this.shake(3 + Math.min(3, this.captureBatch / 20));
    this.captureBatch = 0;
    this.launchCoins(coinTarget);
    if (this.reducedMotion?.matches) {
      this.shakeAmount = 0;
      this.coins.forEach((coin) => { this.coinArrivals += coin.count; });
      this.coins = [];
    }
    const offset = shakeOffset(this.shakeAmount, this.shakeAge);
    this.shakeX = offset.x;
    this.shakeY = offset.y;
    if (world) {
      this.averageCatch = world.totalCaught > 0 ? (world.earned - world.bonusEarned.treasure) / world.totalCaught : Infinity;
      for (const floater of this.floaters) {
        if (floater.largestCatch !== undefined && floater.largestCatch >= this.averageCatch * 10) floater.big = true;
      }
    }
    if (this.palette !== getPalette()) {
      this.palette = getPalette();
      this.sprites.clear();
    }
    if (this.backgroundDirty && this.width > 0) {
      this.background = this.paintBackground();
      this.backgroundDirty = false;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.background) ctx.drawImage(this.background, 0, 0);
    const tint = seaTint(timeOfDay ?? world?.timeOfDay);
    this.night = tint.night;
    if (tint.alpha > 0) {
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = tint.alpha;
      ctx.fillStyle = tint.color;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
    this.drawCaustics();
    const frenzy = world ? this.frenzyFade(world) : 0;
    if (frenzy > 0) {
      ctx.globalAlpha = frenzy;
      ctx.fillStyle = COLORS.frenzyTint;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.globalAlpha = 1;
    }
    this.resetTransform();
    if (world && frenzy > 0) this.drawFrenzyFront(world, frenzy);
    if (world) {
      this.drawChum(world);
      this.drawRiggingWater(world);
    }
    this.drawBoat(stats.boat.lanternRadius);
    if (world) {
      for (const fish of world.fish) this.drawFish(fish, "silhouette");
      this.resetTransform();
    }
    if (world) {
      this.drawTrapReveals(world);
      this.drawTraps(world);
    }
    const netActive = world && !world.over && pointer;
    if (netActive) this.drawLens(world, pointer, stats.netRadius);
    if (world) for (const kind of FISH_KINDS) FISH_SPECS[kind].drawWorld?.(ctx, world, this.time, fishColors(kind));
    if (world?.chest) this.drawChest(world.chest, netActive ? pointer : null, stats.netRadius);
    if (world) this.drawGoldenGlints(world);
    this.drawEffects();
    if (netActive) {
      this.drawNet(pointer, stats.netRadius, world.tickProgress);
      this.drawCombo(world, pointer, stats);
    } else this.comboMult = 1;
    if (netActive && finger) this.drawFinger(finger, pointer);
    this.drawCoins();
  }

  private resetTransform(): void {
    const scale = this.dpr * this.viewScale;
    this.ctx.setTransform(scale, 0, 0, scale, (this.offsetX + this.shakeX) * this.dpr, (this.offsetY + this.shakeY) * this.dpr);
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
      d * fish.x + (this.offsetX + this.shakeX) * this.dpr, d * fish.y + (this.offsetY + this.shakeY) * this.dpr);
    ctx.globalAlpha = Math.min(1, fish.age / FADE_IN_SECONDS);
    ctx.drawImage(sprites[variant], -sprites.width / 2, -sprites.height / 2, sprites.width, sprites.height);
    ctx.globalAlpha = 1;
  }

  private drawChum(world: World): void {
    const ctx = this.ctx;
    const stats = world.stats.boat;
    const cloud = this.chumCloud;
    if (cloud) {
      const alpha = chumCloudAlpha(cloud.age, stats.chumSeconds);
      if (alpha === 0 || !stats.chum) this.chumCloud = null;
      else {
        if (this.reducedMotion?.matches) {
          drawChumShape(ctx, cloud.x, cloud.y, stats.chumRadius, alpha * 0.4, true);
        } else {
          const spread = 1 - (1 - Math.min(1, cloud.age / 1.2)) ** 2;
          const radius = stats.chumRadius * (0.12 + spread * 0.88);
          // Four broad overlapping plumes share cached pigment; their outer edges reach the lure radius.
          for (let i = 0; i < 4; i++) {
            const angle = i * TAU / 4 + 0.4 + Math.sin(i * 2.1) * 0.17;
            const distance = radius * (i % 2 ? 0.32 : 0.3);
            const size = radius - distance;
            drawChumShape(ctx, cloud.x + Math.cos(angle) * distance, cloud.y + Math.sin(angle) * distance, size, alpha * 0.28);
          }
        }
      }
    }
    if (!world.chumActive || this.reducedMotion?.matches) return;
    ctx.strokeStyle = "rgba(237, 226, 190, 0.13)"; ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const angle = i * TAU / 12 + 0.2;
      const t = (this.time * 0.28 + i * 0.618034) % 1;
      const radius = 70 + (stats.chumRadius - 70) * (1 - t);
      const length = Math.min(12, Math.max(0, radius - 65));
      ctx.moveTo(world.width / 2 + Math.cos(angle) * radius, world.height / 2 + Math.sin(angle) * radius);
      ctx.lineTo(world.width / 2 + Math.cos(angle) * (radius - length), world.height / 2 + Math.sin(angle) * (radius - length));
    }
    ctx.stroke();
    // A few pale morsels follow the inward current, rather than outlining the cloud with dots.
    ctx.fillStyle = "#e6c69c";
    for (let i = 0; i < 5; i++) {
      const angle = i * 2.399963 + 0.6;
      const t = (this.time * 0.2 + i * 0.173) % 1;
      const radius = 70 + Math.max(0, stats.chumRadius - 70) * (1 - t);
      ctx.globalAlpha = Math.sin(t * Math.PI) * 0.38;
      ctx.beginPath();
      ctx.arc(world.width / 2 + Math.cos(angle) * radius, world.height / 2 + Math.sin(angle) * radius, 1.2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawRiggingWater(world: World): void {
    const ctx = this.ctx;
    const reduced = this.reducedMotion?.matches;
    for (const [index, trap] of world.traps.entries()) {
      if (!reduced && trap.age < 0.65) continue;
      if (world.stats.rigging.baitPull > 0 && trap.cooldown === 0) {
        for (let i = 0; i < 2; i++) {
          const t = (this.time * 0.22 + i / 2 + trap.id * 0.13) % 1;
          const radius = trap.radius + 6 + t * Math.min(30, world.stats.rigging.baitRange * 0.15);
          ctx.strokeStyle = `rgba(230, 226, 191, ${0.12 * (1 - t)})`;
          ctx.lineWidth = 0.8 / this.viewScale;
          ctx.beginPath(); ctx.arc(trap.x, trap.y, radius, 0, TAU); ctx.stroke();
        }
      }
      if (!world.stats.rigging.seine || trap.partner === null || trap.partner <= index) continue;
      const partner = world.traps[trap.partner];
      if (!partner || (!reduced && partner.age < 0.65)) continue;
      const mid = ropeSagPoint(trap, partner, 0.5);
      const controlY = mid.y * 2 - (trap.y + partner.y) / 2;
      ctx.strokeStyle = "#9b8965"; ctx.lineWidth = 1.4 / this.viewScale;
      ctx.beginPath(); ctx.moveTo(trap.x, trap.y);
      ctx.quadraticCurveTo(mid.x, controlY, partner.x, partner.y); ctx.stroke();
      const floats = Math.min(9, Math.max(3, Math.floor(Math.hypot(partner.x - trap.x, partner.y - trap.y) / 32)));
      for (let i = 1; i <= floats; i++) {
        const point = ropeSagPoint(trap, partner, i / (floats + 1));
        ctx.fillStyle = i % 2 ? "#e4d8bb" : "#aa6750";
        ctx.strokeStyle = "#4d5143"; ctx.lineWidth = 0.7 / this.viewScale;
        ctx.beginPath(); ctx.ellipse(point.x, point.y, 2.5 / this.viewScale, 1.8 / this.viewScale, 0, 0, TAU); ctx.fill(); ctx.stroke();
      }
    }
  }

  /** Cached secondary rope, faint mesh and four striped buoys, in device resolution. */
  private trapSprite(radius: number): HTMLCanvasElement {
    const cached = this.trapSprites.get(radius);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    const scale = this.dpr * this.viewScale;
    const size = (radius + 7) * 2;
    canvas.width = canvas.height = Math.ceil(size * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.translate(size / 2, size / 2);
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.clip();
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = "rgba(223, 231, 205, 0.18)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    const spacing = Math.max(12, radius / 4);
    for (let d = -radius * 2; d <= radius * 2; d += spacing) {
      ctx.moveTo(d, -radius * 2); ctx.lineTo(d, radius * 2);
      ctx.moveTo(-radius * 2, d); ctx.lineTo(radius * 2, d);
    }
    ctx.stroke(); ctx.restore();
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU);
    ctx.strokeStyle = "#514031"; ctx.lineWidth = 4.6; ctx.stroke();
    ctx.strokeStyle = "#ac956c"; ctx.lineWidth = 3; ctx.stroke();
    ctx.setLineDash([1.5, 3]); ctx.strokeStyle = "#675c43"; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 4; i++) {
      ctx.save();
      const a = i * TAU / 4 + Math.PI / 4;
      ctx.translate(Math.cos(a) * radius, Math.sin(a) * radius);
      ctx.rotate(a);
      ctx.fillStyle = "#f2e4c5"; ctx.strokeStyle = "#514635"; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.ellipse(0, 0, 4.8, 3.2, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#a9503d"; ctx.fillRect(-1.4, -2.7, 2.8, 5.4);
      ctx.restore();
    }
    if (this.trapSprites.size >= 16) this.trapSprites.clear();
    this.trapSprites.set(radius, canvas);
    return canvas;
  }

  private trapPosition(trap: Trap, world: World): Point {
    const t = this.reducedMotion?.matches ? 1 : Math.min(1, trap.age / 0.65);
    return {
      x: world.width / 2 + (trap.x - world.width / 2) * t,
      y: world.height / 2 + (trap.y - world.height / 2) * t - Math.sin(t * Math.PI) * 65,
    };
  }

  private drawTraps(world: World): void {
    const ctx = this.ctx;
    for (const trap of world.traps) {
      let visual = this.trapVisuals.get(trap.id);
      if (!visual) {
        visual = { snapAge: 1, reset: 0, cooling: trap.cooldown > 0, readyAge: 1, reveal: false };
        this.trapVisuals.set(trap.id, visual);
      }
      if (trap.cooldown > 0 && visual.reset === 0) {
        visual.reset = Math.max(trap.cooldown, world.stats.rigging.resetSeconds * (world.frenzyActive ? world.stats.rigging.frenzyResetMult : 1));
      }
      if (visual.cooling && trap.cooldown === 0) {
        visual.readyAge = 0;
        visual.reset = 0;
      }
      visual.cooling = trap.cooldown > 0;
      const point = this.trapPosition(trap, world);
      const cinch = this.reducedMotion?.matches ? 0 : Math.sin(Math.PI * Math.min(1, visual.snapAge / 0.3));
      const radius = trap.radius * (1 - cinch * 0.28);
      if (trap.cooldown === 0) {
        const breathe = this.reducedMotion?.matches ? 0.06 : 0.06 + Math.sin(this.time * 1.3 + trap.id) * 0.025;
        drawGlow(ctx, "238, 218, 163", point.x, point.y, radius * 1.4, breathe);
      }
      const size = (trap.radius + 7) * 2 * (1 - cinch * 0.28);
      ctx.drawImage(this.trapSprite(trap.radius), point.x - size / 2, point.y - size / 2, size, size);
      if (trap.cooldown > 0) {
        ctx.strokeStyle = "#c69b52"; ctx.lineWidth = 1.3 / this.viewScale;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, -Math.PI / 2, -Math.PI / 2 + TAU * cooldownArcFraction(trap.cooldown, visual.reset));
        ctx.stroke();
      }
      if (!this.reducedMotion?.matches && visual.readyAge < 0.4) {
        ctx.fillStyle = "#fff1cd";
        ctx.globalAlpha = Math.sin(visual.readyAge / 0.4 * Math.PI);
        ctx.beginPath(); sparklePath(ctx, trap.x, trap.y - trap.radius, 4, 0); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (!this.reducedMotion?.matches && trap.age >= 0.65 && trap.age < 1.15) {
        ctx.save(); waterSplash(trap.x, trap.y, trap.radius).draw(ctx, (trap.age - 0.65) / 0.5); ctx.restore();
      }
    }
    // Recasts and resized-away traps cannot leave growing state behind.
    for (const id of this.trapVisuals.keys()) if (!world.traps.some(trap => trap.id === id)) this.trapVisuals.delete(id);
  }

  private drawTrapReveals(world: World): void {
    if (this.reducedMotion?.matches) return;
    for (const trap of world.traps) {
      const visual = this.trapVisuals.get(trap.id);
      if (!visual?.reveal) continue;
      visual.reveal = false;
      if (visual.snapAge >= 0.3) continue;
      for (const fish of world.fish) {
        if (fish.captured || Math.hypot(fish.x - trap.x, fish.y - trap.y) > trap.radius || this.trapReveals.length >= 96) continue;
        this.trapReveals.push({ x: fish.x, y: fish.y, kind: fish.kind, heading: fish.heading, golden: !!fish.golden, age: visual.snapAge });
      }
    }
    const ctx = this.ctx;
    for (const fish of this.trapReveals) {
      const sprite = this.sprite(fish.kind);
      ctx.save(); ctx.translate(fish.x, fish.y); ctx.rotate(fish.heading);
      ctx.scale(1, Math.cos(fish.heading) < 0 ? -1 : 1);
      ctx.globalAlpha = Math.min(1, (0.3 - fish.age) / 0.12);
      ctx.drawImage(fish.golden ? sprite.golden : sprite.full, -sprite.width / 2, -sprite.height / 2, sprite.width, sprite.height);
      ctx.restore();
    }
  }

  /** Inside the net, fish are drawn in full colour over their silhouettes. */
  private drawLens(world: World, pointer: Point, radius: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius, 0, TAU);
    ctx.clip();
    ctx.fillStyle = this.night > 0.4 ? "rgba(224, 246, 243, 0.23)" : COLORS.lens;
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
      const ripple = (this.time * 0.6 + offset) % 1;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 * (1 - ripple)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(chest.x, chest.y + size * 0.3, size * (0.55 + 0.4 * ripple), size * (0.14 + 0.1 * ripple), 0, 0, TAU);
      ctx.stroke();
    }
    const held = (chest.snagLeft ?? 0) > 0;
    const tug = held && !this.reducedMotion?.matches ? Math.sin(this.snagAge * 62) * 2.5 * Math.max(0, 1 - this.snagAge / 0.4) : 0;
    ctx.translate(chest.x + tug, chest.y + Math.sin(this.time * 1.8) * 2.5);
    ctx.rotate(Math.sin(this.time * 1.3 + 0.6) * 0.06);
    ctx.drawImage(chest.hitFlash > 0 ? sprites.flash : sprites.full, -sprites.width / 2, -sprites.height / 2, sprites.width, sprites.height);
    if (held) {
      ctx.strokeStyle = "#c1aa7d"; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (const x of [-12, 9]) ctx.ellipse(x, 0, 4, size * 0.3, -0.3, 0, TAU);
      ctx.moveTo(-size * 0.5, 5); ctx.quadraticCurveTo(0, -4, size * 0.5, 3);
      ctx.stroke();
      ctx.fillStyle = "#e0cf9d"; ctx.beginPath(); ctx.arc(-10, 5, 2.4, 0, TAU); ctx.fill();
    }
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
      const size = FISH[fish.kind].size;
      const alpha = Math.min(1, fish.age / FADE_IN_SECONDS);
      for (let i = 0; i < 4; i++) {
        const phase = this.time * 1.25 + i / 4 + fish.id * 0.618034;
        const t = phase % 1;
        const angle = fish.id * 2.4 + i * 2.1 + Math.floor(phase) * 1.7;
        const r = Math.min(11, size * 0.27) * Math.sin(t * Math.PI);
        const x = fish.x + Math.cos(angle) * size * 0.4;
        const y = fish.y + Math.sin(angle) * size * 0.3;
        drawGlow(ctx, "255, 205, 70", x, y, r * 1.4, alpha * 0.35);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#fff6d6";
        ctx.beginPath();
        sparklePath(ctx, x, y, r, t * 0.8);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
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
    const cinch = this.reducedMotion?.matches ? 0 : Math.sin(Math.PI * this.netCinch / PULSE_SECONDS);
    ctx.save();
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius, 0, TAU);
    ctx.clip();
    ctx.translate(pointer.x, pointer.y);
    ctx.rotate(Math.PI / 4);
    const meshScale = 1 - cinch * 0.08;
    ctx.scale(meshScale, meshScale);
    ctx.strokeStyle = `rgba(225, 250, 255, ${0.07 + cinch * 0.1})`;
    ctx.lineWidth = 1 / this.viewScale;
    // Bound line count even with very large upgraded nets or a narrow mobile viewport.
    const spacing = Math.max(16 / this.viewScale, radius / 5);
    const extent = radius / 0.92;
    ctx.beginPath();
    for (let offset = -Math.ceil(extent / spacing) * spacing; offset <= extent; offset += spacing) {
      ctx.moveTo(offset, -extent);
      ctx.lineTo(offset, extent);
      ctx.moveTo(-extent, offset);
      ctx.lineTo(extent, offset);
    }
    ctx.stroke();
    ctx.restore();

    // The bright outer rim always marks the actual hit area; only the inner weave cinches.
    if (cinch > 0) {
      ctx.lineWidth = 1.5 / this.viewScale;
      ctx.strokeStyle = `rgba(235, 255, 255, ${cinch * 0.65})`;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, radius * meshScale, 0, TAU);
      ctx.stroke();
    }
    ctx.lineWidth = 6 / this.viewScale;
    ctx.strokeStyle = "rgba(40, 40, 29, 0.55)";
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 3.5 / this.viewScale;
    ctx.strokeStyle = COLORS.net;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius, 0, TAU);
    ctx.stroke();

    ctx.save();
    ctx.setLineDash([2 / this.viewScale, 4 / this.viewScale]);
    ctx.lineWidth = 1.2 / this.viewScale;
    ctx.strokeStyle = "#b7925e";
    ctx.stroke();
    ctx.restore();
    // Floats and knots remain legible even on a phone.
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8;
      const x = pointer.x + Math.cos(a) * radius;
      const y = pointer.y + Math.sin(a) * radius;
      ctx.fillStyle = i % 2 ? "#d9a441" : "#fff7e6";
      ctx.strokeStyle = "#765637";
      ctx.lineWidth = 1 / this.viewScale;
      ctx.beginPath();
      ctx.ellipse(x, y, 3.5 / this.viewScale, 2.4 / this.viewScale, a, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }

    // A thin brass inlay on the rope, with no separate charge circle outside it.
    ctx.lineWidth = 1.4 / this.viewScale;
    ctx.strokeStyle = COLORS.netCharge;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, radius, -Math.PI / 2, -Math.PI / 2 + charge * TAU);
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

  /** How strongly to show the Feeding Frenzy, 0 to 1: full while the wave runs, fading at its ends. */
  private frenzyFade(world: World): number {
    const wave = world.frenzy;
    if (!wave || !world.frenzyActive) return 0;
    const t = world.elapsed;
    return Math.min(1, (t - wave.start) / FRENZY_FADE_SECONDS, (wave.end - t) / FRENZY_FADE_SECONDS);
  }

  /**
   * The Feeding Frenzy wave's front: a wavy line of foam across the whole screen with a bright wake
   * and bubbles behind it, where the new fish pour in.
   */
  private drawFrenzyFront(world: World, alpha: number): void {
    const wave = world.frenzy;
    const front = world.frenzyFront;
    if (!wave || front === null) return;
    const ctx = this.ctx;
    const top = -this.offsetY / this.viewScale;
    const bottom = (this.canvas.height / this.dpr - this.offsetY) / this.viewScale;
    const crest = (y: number): number =>
      front + Math.sin(y * 0.045 + this.time * 4) * 5 + Math.sin(y * 0.012 - this.time * 1.7) * 9;
    const crestLine = (): void => {
      ctx.beginPath();
      for (let y = top; y <= bottom + 10; y += 10) {
        if (y === top) ctx.moveTo(crest(y), y);
        else ctx.lineTo(crest(y), y);
      }
    };
    ctx.save();
    ctx.globalAlpha = alpha;

    // The wake: bright at the crest, fading out behind it.
    const wakeEnd = front - wave.sweep * FRENZY_WAKE;
    const wake = ctx.createLinearGradient(front, 0, wakeEnd, 0);
    wake.addColorStop(0, COLORS.frenzyWake);
    wake.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = wake;
    crestLine();
    ctx.lineTo(wakeEnd, bottom + 10);
    ctx.lineTo(wakeEnd, top);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = COLORS.foam;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    crestLine();
    ctx.stroke();

    // Bubbles drift back from the crest and fade, each on its own phase so the foam never pulses.
    ctx.fillStyle = COLORS.foam;
    for (let i = 0; i < FOAM_BUBBLES; i++) {
      const y = top + ((i + 0.5) / FOAM_BUBBLES) * (bottom - top) + Math.sin(i * 12.9898) * 6;
      const drift = (i * 0.618034 + this.time * 0.9) % 1;
      ctx.globalAlpha = alpha * (1 - drift) * 0.8;
      ctx.beginPath();
      ctx.arc(crest(y) - wave.sweep * (4 + drift * 46), y, 1.5 + (i % 3), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBoat(lureRadius = 0): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    const radius = lanternLightRadius(lureRadius, this.night);
    if (this.lantern && radius > 0) {
      ctx.globalAlpha = lureRadius > 0 ? 0.35 + this.night * 0.5 : this.night * 0.75;
      ctx.drawImage(this.lantern, -radius, -radius, radius * 2, radius * 2);
      ctx.globalAlpha = 1;
    }
    for (const phase of [0, 0.5]) {
      const t = (this.time * 0.24 + phase) % 1;
      ctx.strokeStyle = `rgba(232, 251, 255, ${(1 - t) * 0.2})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(0, 4, 48 + t * 20, 17 + t * 12, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.translate(0, Math.sin(this.time * 1.4) * 1.5);
    ctx.rotate(Math.sin(this.time * 1.2) * 0.04);
    // Layered translucent ellipses are a soft hull shadow, without shadowBlur.
    for (let i = 3; i > 0; i--) {
      ctx.fillStyle = "rgba(5, 27, 35, 0.09)";
      ctx.beginPath();
      ctx.ellipse(4, 6, 45 + i * 3, 13 + i * 2, 0, 0, TAU);
      ctx.fill();
    }
    if (this.art.boat) {
      // The painted asset has transparent margins around its 560 px hull.
      ctx.drawImage(this.art.boat, -58, -29, 116, 58);
      ctx.restore();
      return;
    }

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
    this.shakeAge += dt;
    this.snagAge += dt;
    if (this.chumCloud) this.chumCloud.age += dt;
    for (const visual of this.trapVisuals.values()) { visual.snapAge += dt; visual.readyAge += dt; }
    for (const fish of this.trapReveals) fish.age += dt;
    this.trapReveals = this.reducedMotion?.matches ? [] : this.trapReveals.filter(fish => fish.age < 0.3);
    this.comboPulse = Math.max(0, this.comboPulse - dt);
    for (const ripple of this.ripples) ripple.age += dt;
    let kept = 0;
    for (const coin of this.coins) {
      coin.age += dt;
      if (coin.age >= coin.life) this.coinArrivals += coin.count;
      else this.coins[kept++] = coin;
    }
    this.coins.length = kept;
    this.netCinch = Math.max(0, this.netCinch - dt);
    if (this.lastNetTick) this.lastNetTick.age += dt;
    for (const fish of this.catches) fish.age += dt;
    this.catches = this.reducedMotion?.matches ? [] : this.catches.filter((fish) => fish.age < CATCH_SECONDS);
    if (this.reducedMotion?.matches) {
      this.particles.length = 0;
      this.pulses.length = 0;
      this.effects.length = 0;
      this.bonusEffects.length = 0;
    }
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

    if (!this.reducedMotion?.matches) for (const ripple of this.ripples) {
      if (ripple.age >= RIPPLE_SECONDS) continue;
      const t = ripple.age / RIPPLE_SECONDS;
      ctx.strokeStyle = `rgba(232, 251, 255, ${0.9 * (1 - t) ** 0.8})`;
      ctx.lineWidth = 2 / this.viewScale;
      ctx.beginPath();
      const r = (5 + (1 - (1 - t) ** 2) * 25) / this.viewScale;
      ctx.ellipse(ripple.x, ripple.y, r, r * 0.75, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    for (const p of this.pulses) {
      const t = p.age / PULSE_SECONDS;
      ctx.strokeStyle = `rgba(255, 255, 255, ${(1 - t) * (p.strong ? 0.6 : 0.15)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * (1 + 0.15 * t), 0, TAU);
      ctx.stroke();
    }

    for (const fish of this.catches) {
      const t = fish.age / CATCH_SECONDS;
      const pull = 1 - (1 - t) * (1 - t);
      const sprites = this.sprite(fish.kind);
      const scale = t < 0.2 ? 1 + 0.25 * Math.sin(t / 0.2 * Math.PI / 2) : 1.25 * (1 - (t - 0.2) / 0.8) ** 1.3;
      const width = sprites.width * scale;
      const height = sprites.height * scale;
      ctx.save();
      ctx.translate(fish.x + (fish.target.x - fish.x) * pull, fish.y + (fish.target.y - fish.y) * pull);
      ctx.rotate(Math.atan2(fish.target.y - fish.y, fish.target.x - fish.x));
      ctx.globalAlpha = 1 - t;
      ctx.drawImage(fish.golden ? sprites.golden : sprites.full, -width / 2, -height / 2, width, height);
      ctx.restore();
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

    const font = `800 ${16 / this.viewScale}px Nunito, system-ui, sans-serif`;
    const bigFont = `800 ${26 / this.viewScale}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = "center";
    for (const f of this.floaters) {
      const t = f.age / (f.big ? BIG_FLOATER_SECONDS : FLOATER_SECONDS);
      ctx.font = f.big ? bigFont : font;
      ctx.fillStyle = f.color;
      ctx.globalAlpha = Math.min(1, (1 - t) / 0.4);
      if (!f.text && f.value !== undefined) f.text = `+${formatMoney(f.value)}`;
      const y = f.y - 12 - (this.reducedMotion?.matches ? 0 : t * (f.big ? 40 : 30));
      ctx.lineJoin = "round";
      ctx.lineWidth = (f.big ? 2.2 : 1.4) / this.viewScale;
      ctx.strokeStyle = "rgba(13, 35, 44, 0.9)";
      ctx.strokeText(f.text, f.x, y);
      ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
  }

  private launchCoins(target?: Point | null): void {
    for (const pending of this.pendingCoins) {
      if (!target || this.reducedMotion?.matches) {
        this.coinArrivals += pending.count;
        continue;
      }
      if (this.coins.length >= 40) {
        this.coins.at(-1)!.count += pending.count;
        continue;
      }
      this.coins.push({
        from: { x: pending.x * this.viewScale + this.offsetX, y: pending.y * this.viewScale + this.offsetY },
        target: { ...target }, age: 0, life: 0.65 + (this.coins.length % 5) * 0.035, count: pending.count,
      });
    }
    this.pendingCoins.length = 0;
    // A hidden/moved HUD must not strand coins or lose arrivals.
    if (!target) {
      for (const coin of this.coins) this.coinArrivals += coin.count;
      this.coins.length = 0;
    } else for (const coin of this.coins) { coin.target.x = target.x; coin.target.y = target.y; }
  }

  private drawCoins(): void {
    if (this.coins.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineWidth = 1;
    for (const coin of this.coins) {
      const t = coin.age / coin.life;
      const p = coinFlight(coin.from, coin.target, t);
      // Two short, fading specks give direction without a long competing streak.
      for (let i = 2; i >= 1; i--) {
        if (t < i * 0.035) continue;
        const trail = coinFlight(coin.from, coin.target, t - i * 0.035);
        ctx.fillStyle = i === 1 ? "rgba(255, 219, 121, 0.5)" : "rgba(255, 219, 121, 0.25)";
        ctx.beginPath();
        ctx.arc(trail.x, trail.y, (2 - i * 0.45) * p.scale, 0, TAU);
        ctx.fill();
      }
      const radius = 4.5 * p.scale;
      const face = 0.75 + 0.25 * Math.abs(Math.cos(t * 15));
      ctx.fillStyle = "#ffd05c";
      ctx.strokeStyle = "#68421d";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius * face, radius, -0.25, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#fff3b8";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius * face * 0.65, radius * 0.65, -0.25, Math.PI, Math.PI * 1.75);
      ctx.stroke();
      ctx.fillStyle = "#fff9da";
      ctx.fillRect(p.x - radius * face * 0.35, p.y - radius * 0.5, Math.max(0.75, radius * 0.25), radius * 0.65);
    }
    ctx.restore();
  }

  private drawCombo(world: World, pointer: Point, stats: Stats): void {
    if (world.comboMult > this.comboMult && !this.reducedMotion?.matches) this.comboPulse = 0.3;
    this.comboMult = world.comboMult;
    const level = comboRingLevel(world.comboMult, stats.comboMax, world.comboProgress);
    if (level <= 0) return;
    const ctx = this.ctx;
    const pulse = Math.sin(this.comboPulse / 0.3 * Math.PI);
    const r = stats.netRadius + (12 + pulse * 2) / this.viewScale;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(36, 41, 36, 0.5)";
    ctx.lineWidth = 3.8 / this.viewScale;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, r, -Math.PI / 2, -Math.PI / 2 + level * TAU);
    ctx.stroke();
    ctx.strokeStyle = "#f4a259";
    ctx.lineWidth = (3.2 + pulse * 0.4) / this.viewScale;
    ctx.stroke();
    ctx.font = `800 ${13 / this.viewScale}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "#193844";
    ctx.lineWidth = 4 / this.viewScale;
    const label = `×${world.comboMult.toFixed(1)}`;
    const y = pointer.y + r;
    ctx.strokeText(label, pointer.x, y);
    ctx.fillStyle = "#fff1cd";
    ctx.fillText(label, pointer.x, y);
    ctx.restore();
  }

  /** Organic light cells, warped continuously so the repeated tile has no seams. */
  private paintCausticTile(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    const size = 512;
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const cells = causticCells();
    const warp = (x: number, y: number): Point => {
      const u = x / size * TAU;
      const v = y / size * TAU;
      return {
        x: x + Math.sin(v + 0.8 * Math.sin(u)) * 12 + Math.sin(2 * u + v + 0.7) * 5,
        y: y + Math.sin(u + 0.6 * Math.sin(v)) * 13 + Math.sin(u - 2 * v) * 4,
      };
    };
    ctx.lineJoin = "round";
    // Soft shoulders, then a narrow core, both painted once without a blur filter.
    for (const width of [6, 1.6]) {
      ctx.lineWidth = width;
      ctx.strokeStyle = width === 6 ? "rgba(240, 243, 209, 0.08)" : "rgba(255, 249, 220, 0.28)";
      ctx.beginPath();
      for (const cell of cells) for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        // Copy neighbouring cells to wrap the geometry as well as the noise at every edge.
        for (let i = 0; i < cell.length; i++) {
          const a = cell[i]!;
          const b = cell[(i + 1) % cell.length]!;
          const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 7));
          for (let k = 0; k <= steps; k++) {
            const t = k / steps;
            const p = warp(a.x + (b.x - a.x) * t + ox, a.y + (b.y - a.y) * t + oy);
            if (i === 0 && k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          }
        }
        ctx.closePath();
      }
      ctx.stroke();
    }
    return canvas;
  }

  /** Prepaints differently scaled/rotated layers and their directional light masks at CSS density. */
  private paintCaustics(): HTMLCanvasElement[] {
    this.causticTile ??= this.paintCausticTile();
    const w = Math.ceil(this.canvas.width / this.dpr) + CAUSTIC_MARGIN * 2;
    const h = Math.ceil(this.canvas.height / this.dpr) + CAUSTIC_MARGIN * 2;
    const layers: HTMLCanvasElement[] = [];
    for (let i = 0; i < 2; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      const pattern = ctx.createPattern(this.causticTile, "repeat");
      if (!pattern) continue;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(i === 0 ? -0.12 : 0.49);
      ctx.scale(i === 0 ? 0.88 : 1.43, i === 0 ? 0.88 : 1.43);
      ctx.fillStyle = pattern;
      const reach = Math.hypot(w, h);
      ctx.fillRect(-reach, -reach, reach * 2, reach * 2);
      ctx.restore();
      const fade = ctx.createLinearGradient(0, 0, w * 0.85, h * 0.85);
      fade.addColorStop(0, "rgba(255, 255, 255, 1)");
      fade.addColorStop(0.4, "rgba(255, 255, 255, 0.55)");
      fade.addColorStop(1, "rgba(255, 255, 255, 0.025)");
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, w, h);
      layers.push(canvas);
    }
    return layers;
  }

  private drawCaustics(): void {
    if (this.caustics.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    // The cache already includes rotation, scale and the falloff toward the lower right.
    for (let i = 0; i < this.caustics.length; i++) {
      const direction = i === 0 ? 1 : -1;
      const x = Math.sin(this.time * 0.08) * 12 * direction;
      const y = Math.sin(this.time * 0.06 + 0.4) * 9 * direction;
      ctx.globalAlpha = 0.032 * (1 - this.night * 0.9);
      ctx.drawImage(this.caustics[i]!, x - CAUSTIC_MARGIN, y - CAUSTIC_MARGIN);
    }
    // A few faint moonlight glints remain when the moving caustics recede.
    if (this.night > 0.2) {
      ctx.strokeStyle = "#e8fbff";
      ctx.lineWidth = 1;
      for (let i = 0; i < 16; i++) {
        const x = ((i * 0.618034) % 1) * w;
        const y = ((i * 0.4137 + 0.17) % 1) * h;
        ctx.globalAlpha = this.night * 0.13 * (0.5 + 0.5 * Math.sin(this.time * 0.7 + i * 2.3));
        ctx.beginPath();
        ctx.moveTo(x - 2, y); ctx.lineTo(x + 2, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private paintLantern(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    const ctx = canvas.getContext("2d")!;
    const glow = ctx.createRadialGradient(96, 96, 2, 96, 96, 96);
    glow.addColorStop(0, "rgba(255, 222, 146, 0.65)");
    glow.addColorStop(0.25, "rgba(255, 181, 81, 0.25)");
    glow.addColorStop(1, "rgba(255, 181, 81, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 192, 192);
    return canvas;
  }

  private paintBackground(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = this.canvas.width;
    canvas.height = this.canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not supported");
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(cx, cy));
    gradient.addColorStop(0, COLORS.waterInner);
    gradient.addColorStop(1, COLORS.waterOuter);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    if (this.art.sea) {
      const tile = 640 * Math.max(0.65, this.viewScale) * this.dpr;
      for (let y = 0; y < h; y += tile) for (let x = 0; x < w; x += tile) {
        ctx.drawImage(this.art.sea, x, y, tile + 0.5, tile + 0.5);
      }
      const light = ctx.createLinearGradient(0, 0, w, h);
      light.addColorStop(0, "rgba(239, 171, 84, 0.5)");
      light.addColorStop(0.45, "rgba(244, 162, 89, 0.14)");
      light.addColorStop(1, "rgba(40, 91, 139, 0.3)");
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      const amber = ctx.createRadialGradient(-w * 0.08, -h * 0.12, 0, 0, 0, Math.hypot(w, h) * 0.75);
      amber.addColorStop(0, "rgba(255, 177, 70, 0.2)");
      amber.addColorStop(0.6, "rgba(244, 162, 70, 0.065)");
      amber.addColorStop(1, "rgba(244, 162, 70, 0)");
      ctx.fillStyle = amber;
      ctx.fillRect(0, 0, w, h);
      const vignette = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.18, cx, cy, Math.hypot(cx, cy));
      vignette.addColorStop(0, "rgba(13, 59, 79, 0)");
      vignette.addColorStop(1, "rgba(13, 59, 79, 0.25)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
      const bx = (this.width / 2 * this.viewScale + this.offsetX) * this.dpr;
      const by = (this.height / 2 * this.viewScale + this.offsetY) * this.dpr;
      const glow = ctx.createRadialGradient(bx, by, 0, bx, by, 145 * this.dpr * this.viewScale);
      glow.addColorStop(0, "rgba(255, 213, 135, 0.12)");
      glow.addColorStop(1, "rgba(255, 213, 135, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }
    return canvas;
  }
}
