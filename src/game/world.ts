import { FISH, FISH_KINDS, FISH_SPECS, type FishDef, type FishKind } from "./fish";
import { pickWeighted, range, type Rng } from "./rng";
import type { Stats } from "./stats";

const TAU = Math.PI * 2;

/** The sim always advances in fixed steps, so a seed replays a round exactly. */
export const STEP = 1 / 60;

/** Gap between the swimming area and the screen edge, px. */
const EDGE_MARGIN = 30;
/** Fish never orbit closer to the centre than this, so they stay clear of the boat, px. */
const BOAT_CLEARANCE = 70;
/** Captures handled per step. Any beyond this wait for the next step. */
const MAX_CAPTURES_PER_STEP = 200;
const HIT_FLASH_SECONDS = 0.12;

export interface Point {
  x: number;
  y: number;
}

export interface Fish {
  id: number;
  kind: FishKind;
  hp: number;
  maxHp: number;
  /** Times this fish has been damaged. */
  hits: number;
  /** Position on the orbit, radians. */
  angle: number;
  /** Distance from the boat as a fraction of the swimming area: 0 is the centre, 1 the edge. */
  orbit: number;
  dir: 1 | -1;
  /** Multiplier on the type's speed, for darting, slowing and so on. */
  speedMult: number;
  wobblePhase: number;
  /** Displacement from the orbit path, px. For pulls, fleeing and other off-path movement. */
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  /** Direction of travel, radians. */
  heading: number;
  /** Seconds since spawning. */
  age: number;
  /** Seconds left on the hit flash. */
  hitFlash: number;
  captured: boolean;
  /** Free per-fish state for the type's hooks (timers, flags). */
  state: Record<string, number>;
}

export type CaptureSource = "net" | "electric" | "epic" | "star" | "whirlpool";

/** A projectile, e.g. a launched Star fish. Moved and drawn by the type that owns it. */
export interface Shot {
  kind: FishKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Hit radius, px. */
  radius: number;
  damage: number;
  bouncesLeft: number;
  age: number;
  /** Fish id → seconds until this shot can hit that fish again. */
  cooldowns: Map<number, number>;
}

/** A visual cue from a fish type's ability. The type's `fx` hook turns it into effects. */
export interface FxEvent {
  type: "fx";
  kind: FishKind;
  name: string;
  x: number;
  y: number;
  points?: Point[];
  radius?: number;
}

export type WorldEvent =
  | { type: "tick"; x: number; y: number; radius: number; hits: number; crits: number }
  | { type: "capture"; kind: FishKind; source: CaptureSource; x: number; y: number; value: number; combo: number }
  | { type: "time-bonus"; x: number; y: number; seconds: number }
  | FxEvent;

export interface SpawnOptions {
  /** Spawn at this screen position instead of a random spot. */
  at?: Point;
  /** Spawn even when the water is at maxFish. maxOnScreen limits still apply. */
  ignoreCap?: boolean;
}

/** One round of play. No DOM access: input writes `pointer`, the renderer reads the rest. */
export class World {
  fish: Fish[] = [];
  shots: Shot[] = [];
  timeLeft: number;
  /** Seconds since the round started. */
  elapsed = 0;
  /** Money earned this round. Banked when the round ends. */
  earned = 0;
  caught: Partial<Record<FishKind, number>> = {};
  /** Captures in the current combo after the first. */
  combo = 0;
  pointer: Point | null = null;

  private events: WorldEvent[] = [];
  private captureQueue: { fish: Fish; source: CaptureSource }[] = [];
  private tickTimer = 0;
  private spawnTimer = 0;
  private lastCaptureAt = -Infinity;
  private nextId = 1;

  constructor(
    readonly stats: Stats,
    readonly rng: Rng,
    private _width: number,
    private _height: number,
  ) {
    this.timeLeft = stats.roundSeconds;
    for (let i = 0; i < stats.startFish; i++) this.spawn();
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get over(): boolean {
    return this.timeLeft <= 0;
  }

  /** How far the net is through charging its next tick, 0 to 1. */
  get tickProgress(): number {
    return Math.min(1, this.tickTimer / this.tickEvery);
  }

  get totalCaught(): number {
    return Object.values<number | undefined>(this.caught).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  }

  get comboMult(): number {
    return Math.min(1 + this.combo * this.stats.comboStep, this.stats.comboMax);
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    for (const fish of this.fish) this.place(fish);
  }

  /** Returns everything that happened since the last call, for effects and sound. */
  drainEvents(): WorldEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  emit(event: WorldEvent): void {
    this.events.push(event);
  }

  update(dt: number): void {
    if (this.over) return;
    this.elapsed += dt;
    for (const kind of FISH_KINDS) FISH_SPECS[kind].update?.(this, dt);
    this.moveFish(dt);
    this.spawnFish(dt);
    this.tickNet(dt);
    this.processCaptures();
    this.timeLeft = Math.max(0, this.timeLeft - dt);
  }

  countOf(kind: FishKind): number {
    let n = 0;
    for (const fish of this.fish) if (fish.kind === kind && !fish.captured) n++;
    return n;
  }

  /** Live fish whose centre is within `radius` of a point, nearest first. */
  fishNear(point: Point, radius: number): Fish[] {
    return this.fish
      .filter((f) => !f.captured && Math.hypot(f.x - point.x, f.y - point.y) <= radius)
      .sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y));
  }

  /** Adds a fish of `kind`, or of a type picked by spawn weight. Undefined if nothing could spawn. */
  spawn(kind?: FishKind, options: SpawnOptions = {}): Fish | undefined {
    if (!options.ignoreCap && this.fish.length >= this.stats.maxFish) return undefined;
    const k = kind ?? this.pickKind();
    if (!k) return undefined;
    const def = FISH[k];
    if (def.maxOnScreen !== undefined && this.countOf(k) >= def.maxOnScreen) return undefined;

    const { cx, cy, rx, ry, minOrbit } = this.swimArea();
    let angle = range(this.rng, 0, TAU);
    let orbit = range(this.rng, minOrbit, 1);
    let wobblePhase = range(this.rng, 0, TAU);
    if (options.at) {
      const nx = (options.at.x - cx) / rx;
      const ny = (options.at.y - cy) / ry;
      angle = Math.atan2(ny, nx);
      orbit = Math.min(1, Math.max(minOrbit, Math.hypot(nx, ny)));
      // Start the wobble at its midpoint so the fish appears exactly where asked.
      wobblePhase = 0;
    }
    const dir = this.rng() < 0.5 ? 1 : -1;
    const fish: Fish = {
      id: this.nextId++,
      kind: k,
      hp: def.hp,
      maxHp: def.hp,
      hits: 0,
      angle,
      orbit,
      dir,
      speedMult: 1,
      wobblePhase,
      offsetX: 0,
      offsetY: 0,
      x: 0,
      y: 0,
      heading: angle + (dir * Math.PI) / 2,
      age: 0,
      hitFlash: 0,
      captured: false,
      state: {},
    };
    this.place(fish);
    this.fish.push(fish);
    FISH_SPECS[k].onSpawn?.(this, fish);
    return fish;
  }

  damage(fish: Fish, amount: number, source: CaptureSource): void {
    if (fish.captured) return;
    const dealt = FISH_SPECS[fish.kind].modifyDamage?.(this, fish, amount, source) ?? amount;
    fish.hits++;
    fish.hp -= dealt;
    fish.hitFlash = HIT_FLASH_SECONDS;
    if (fish.hp <= 0) this.capture(fish, source);
  }

  /** The only way a fish gets captured. Effects run when the queue is processed, never recursively. */
  capture(fish: Fish, source: CaptureSource): void {
    if (fish.captured) return;
    fish.captured = true;
    fish.hp = 0;
    this.captureQueue.push({ fish, source });
  }

  inNet(fish: Fish, point: Point): boolean {
    const reach = this.stats.netRadius + FISH[fish.kind].size * 0.4;
    return Math.hypot(fish.x - point.x, fish.y - point.y) <= reach;
  }

  private get tickEvery(): number {
    return Math.max(this.stats.tickSeconds, STEP);
  }

  private pickKind(): FishKind | undefined {
    const weights: Partial<Record<FishKind, number>> = {};
    for (const kind of FISH_KINDS) {
      const max = FISH[kind].maxOnScreen;
      if (max !== undefined && this.countOf(kind) >= max) continue;
      weights[kind] = this.stats.fish[kind].weight;
    }
    return pickWeighted(this.rng, weights);
  }

  /**
   * The ellipse fish swim in, fitted to the screen. An orbit of 1 is its edge; `minOrbit` is the
   * closest a fish may orbit, keeping it clear of the boat.
   */
  swimArea(): { cx: number; cy: number; rx: number; ry: number; minOrbit: number } {
    const rx = Math.max(this._width / 2 - EDGE_MARGIN, 1);
    const ry = Math.max(this._height / 2 - EDGE_MARGIN, 1);
    return { cx: this._width / 2, cy: this._height / 2, rx, ry, minOrbit: Math.min(0.9, BOAT_CLEARANCE / Math.min(rx, ry)) };
  }

  /** A fish type's definition. Fish modules use this rather than importing the registry, which imports them. */
  defOf(kind: FishKind): FishDef {
    return FISH[kind];
  }

  private place(fish: Fish): void {
    const { cx, cy, rx, ry } = this.swimArea();
    const wobble = Math.sin(fish.wobblePhase) * FISH[fish.kind].wobble;
    const cos = Math.cos(fish.angle);
    const sin = Math.sin(fish.angle);
    fish.x = cx + cos * (fish.orbit * rx + wobble) + fish.offsetX;
    fish.y = cy + sin * (fish.orbit * ry + wobble) + fish.offsetY;
  }

  private moveFish(dt: number): void {
    const { rx, ry } = this.swimArea();
    for (const fish of this.fish) {
      const spec = FISH_SPECS[fish.kind];
      // Path length per radian at this point on the ellipse, so speed is px/s everywhere.
      const arc = fish.orbit * Math.hypot(rx * Math.sin(fish.angle), ry * Math.cos(fish.angle));
      fish.angle += (fish.dir * spec.def.speed * fish.speedMult * dt) / Math.max(arc, 1);
      fish.wobblePhase += spec.def.wobbleSpeed * dt;
      spec.move?.(this, fish, dt);
      const prevX = fish.x;
      const prevY = fish.y;
      this.place(fish);
      if (fish.x !== prevX || fish.y !== prevY) fish.heading = Math.atan2(fish.y - prevY, fish.x - prevX);
      fish.age += dt;
      fish.hitFlash = Math.max(0, fish.hitFlash - dt);
    }
  }

  private spawnFish(dt: number): void {
    const every = Math.max(this.stats.spawnSeconds, STEP);
    this.spawnTimer += dt;
    while (this.spawnTimer >= every) {
      this.spawnTimer -= every;
      this.spawn();
    }
  }

  private tickNet(dt: number): void {
    this.tickTimer += dt;
    if (!this.pointer) {
      // Stay charged while the cursor is away, so the net ticks as soon as it comes back.
      this.tickTimer = Math.min(this.tickTimer, this.tickEvery);
      return;
    }
    while (this.tickTimer >= this.tickEvery) {
      this.tickTimer -= this.tickEvery;
      this.netTick(this.pointer);
    }
  }

  private netTick(point: Point): void {
    let hits = 0;
    let crits = 0;
    for (const fish of this.fish) {
      if (fish.captured || !this.inNet(fish, point)) continue;
      const crit = this.rng() < this.stats.critChance;
      if (crit) crits++;
      this.damage(fish, this.stats.netDamage * (crit ? this.stats.critMult : 1), "net");
      hits++;
    }
    this.emit({ type: "tick", x: point.x, y: point.y, radius: this.stats.netRadius, hits, crits });
  }

  private processCaptures(): void {
    if (this.captureQueue.length === 0) return;
    for (const { fish, source } of this.captureQueue.splice(0, MAX_CAPTURES_PER_STEP)) {
      this.updateCombo();
      const value = FISH[fish.kind].value * this.stats.fish[fish.kind].valueMult * this.stats.valueMult * this.comboMult;
      this.earned += value;
      this.caught[fish.kind] = (this.caught[fish.kind] ?? 0) + 1;
      this.emit({ type: "capture", kind: fish.kind, source, x: fish.x, y: fish.y, value, combo: this.combo });

      FISH_SPECS[fish.kind].onCapture?.(this, fish, source);
      if (this.rng() < this.stats.twinChance) this.spawn(fish.kind);
      if (this.rng() < this.stats.timeBonusChance) {
        this.timeLeft += this.stats.timeBonusSeconds;
        this.emit({ type: "time-bonus", x: fish.x, y: fish.y, seconds: this.stats.timeBonusSeconds });
      }
    }
    this.fish = this.fish.filter((fish) => !fish.captured);
  }

  private updateCombo(): void {
    const chained = this.stats.comboWindow > 0 && this.elapsed - this.lastCaptureAt <= this.stats.comboWindow;
    this.combo = chained ? this.combo + 1 : 0;
    this.lastCaptureAt = this.elapsed;
  }
}
