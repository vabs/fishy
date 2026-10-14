import { FISH, FISH_KINDS, FISH_SPECS, type FishDef, type FishKind } from "./fish";
import { pickWeighted, range, type Rng } from "./rng";
import { spawnRate, type Stats } from "./stats";

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
/** A Feeding Frenzy wave comes in every this many rounds, and in the Final Round. */
export const FRENZY_EVERY = 5;
/** The wave starts this far into the round, as a share of the round's base length. */
const FRENZY_START = 0.35;
/** Fish pour in within this distance behind the wave's front, px. */
const FRENZY_BAND = 70;
/** Fish pour in no closer to the swimming area's sides than this, as a fraction of its half-width. */
const FRENZY_REACH = 0.96;

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
  /** The type this fish's catch is credited to in the round summary, when not its own (a Goober's burst fish). */
  credit?: FishKind;
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
  | { type: "frenzy"; phase: "start" | "end" }
  | FxEvent;

export interface SpawnOptions {
  /** Spawn at this screen position instead of a random spot. */
  at?: Point;
  /** Credit this fish's catch to another type in the round summary. */
  credit?: FishKind;
  /** Swim this way round the boat instead of a random one. */
  dir?: 1 | -1;
}

/** Facts about the round being played that aren't upgrades. */
export interface RoundOptions {
  /** The round's number, from 1. */
  round: number;
  /** True for the Final Round, played once the whole tree is bought. */
  final: boolean;
}

/** True for a round with a Feeding Frenzy wave: every fifth round, and the Final Round. */
export function isFrenzyRound({ round, final }: RoundOptions): boolean {
  return final || (round > 0 && round % FRENZY_EVERY === 0);
}

/**
 * A Feeding Frenzy wave. For a few seconds every type spawns faster and every catch is worth more.
 * A front sweeps once across the sea and the new fish pour in just behind it.
 */
export interface FrenzyWave {
  /** Seconds since the round started. Time bonuses don't move the wave. */
  start: number;
  end: number;
  /** Which way the front sweeps: 1 from the left side to the right, -1 from the right to the left. */
  sweep: 1 | -1;
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
  /** Fish caught this round per type. */
  caught: Partial<Record<FishKind, number>> = {};
  /** Fish caught this round per summary row: like `caught`, but a Goober's burst fish count as Goober. */
  caughtBy: Partial<Record<FishKind, number>> = {};
  /** Money earned this round per summary row, credited like `caughtBy`. */
  earnedBy: Partial<Record<FishKind, number>> = {};
  /** Captures in the current combo after the first. */
  combo = 0;
  pointer: Point | null = null;
  /** This round's Feeding Frenzy wave, or null in a round without one. */
  readonly frenzy: FrenzyWave | null;
  /** Fish caught while the Feeding Frenzy wave ran, and the money they earned. Part of the totals above. */
  frenzyCaught = 0;
  frenzyEarned = 0;

  private events: WorldEvent[] = [];
  private captureQueue: { fish: Fish; source: CaptureSource }[] = [];
  private tickTimer = 0;
  /** Per type: progress towards its next spawn, in spawns. */
  private spawnTimers = new Map<FishKind, number>();
  private lastCaptureAt = -Infinity;
  /** Seconds time bonuses have added this round. Capped at roundSeconds so chains can't stretch a round forever. */
  private bonusTime = 0;
  private nextId = 1;
  /** Whether the frenzy wave ran last step, so its start and end are announced once each. */
  private frenzyRunning = false;

  constructor(
    readonly stats: Stats,
    readonly rng: Rng,
    private _width: number,
    private _height: number,
    readonly round: RoundOptions = { round: 1, final: false },
  ) {
    this.timeLeft = stats.roundSeconds;
    // Only a frenzy round draws a random number for it, so every other round plays out as before.
    if (isFrenzyRound(round)) {
      const start = stats.roundSeconds * FRENZY_START;
      this.frenzy = { start, end: start + stats.frenzySeconds, sweep: this.rng() < 0.5 ? 1 : -1 };
    } else {
      this.frenzy = null;
    }
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

  /** True while the Feeding Frenzy wave runs. */
  get frenzyActive(): boolean {
    const wave = this.frenzy;
    return wave !== null && this.elapsed >= wave.start && this.elapsed < wave.end;
  }

  /** Seconds left in the Feeding Frenzy wave while it runs, else 0. */
  get frenzyLeft(): number {
    return this.frenzy && this.frenzyActive ? this.frenzy.end - this.elapsed : 0;
  }

  /**
   * x of the Feeding Frenzy wave's front while it runs, px, else null. The front crosses the
   * swimming area from side to side once over the length of the wave.
   */
  get frenzyFront(): number | null {
    const wave = this.frenzy;
    if (!wave || !this.frenzyActive) return null;
    const { cx, rx } = this.swimArea();
    const t = (this.elapsed - wave.start) / (wave.end - wave.start);
    return cx + wave.sweep * rx * (2 * t - 1);
  }

  resize(width: number, height: number): void {
    const sx = width / this._width;
    const sy = height / this._height;
    this._width = width;
    this._height = height;
    for (const fish of this.fish) {
      fish.offsetX *= sx;
      fish.offsetY *= sy;
      this.place(fish);
    }
    for (const shot of this.shots) {
      shot.x = Math.max(shot.radius, Math.min(width - shot.radius, shot.x * sx));
      shot.y = Math.max(shot.radius, Math.min(height - shot.radius, shot.y * sy));
    }
    for (const kind of FISH_KINDS) FISH_SPECS[kind].onResize?.(this, sx, sy);
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
    this.announceFrenzy();
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

  /**
   * Adds a fish of `kind`, or of a type picked in proportion to spawn rates. There's no limit on fish
   * in the water, only a type's own maxOnScreen. Undefined if nothing could spawn.
   */
  spawn(kind?: FishKind, options: SpawnOptions = {}): Fish | undefined {
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
    const dir = options.dir ?? (this.rng() < 0.5 ? 1 : -1);
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
      ...(options.credit ? { credit: options.credit } : {}),
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
      // Proportions only: the global spawn multiplier is the same for every type.
      weights[kind] = this.stats.fish[kind].rate * this.stats.fish[kind].rateMult;
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

  /** Every type spawns on its own clock, so unlocking or boosting one never slows another. */
  private spawnFish(dt: number): void {
    // During a Feeding Frenzy every clock runs faster and every new fish pours in behind the wave.
    const wave = this.frenzy;
    const front = this.frenzyFront;
    const mult = front === null ? 1 : this.stats.frenzySpawnMult;
    for (const kind of FISH_KINDS) {
      const rate = spawnRate(this.stats, kind) * mult;
      if (rate <= 0) continue;
      // Each type starts part-way to its first spawn, so types don't all arrive in step.
      let progress = (this.spawnTimers.get(kind) ?? this.rng()) + rate * dt;
      while (progress >= 1) {
        progress -= 1;
        if (wave && front !== null) this.spawnInWave(kind, wave, front);
        else this.spawn(kind);
      }
      this.spawnTimers.set(kind, progress);
    }
  }

  /** Spawns a fish just behind the frenzy wave's front, swimming the way the wave sweeps. */
  private spawnInWave(kind: FishKind, wave: FrenzyWave, front: number): void {
    const { cx, cy, rx, ry } = this.swimArea();
    const x = front - wave.sweep * this.rng() * FRENZY_BAND;
    const u = Math.max(-FRENZY_REACH, Math.min(FRENZY_REACH, (x - cx) / rx));
    const y = cy + (this.rng() * 2 - 1) * ry * Math.sqrt(1 - u * u);
    // Clockwise is rightwards above the boat and leftwards below it, so fish in the two halves go
    // opposite ways round to travel with the wave.
    const dir = (y < cy) === (wave.sweep === 1) ? 1 : -1;
    this.spawn(kind, { at: { x: cx + u * rx, y }, dir });
  }

  /** Emits an event when the frenzy wave starts and when it ends. */
  private announceFrenzy(): void {
    const running = this.frenzyActive;
    if (running === this.frenzyRunning) return;
    this.frenzyRunning = running;
    this.emit({ type: "frenzy", phase: running ? "start" : "end" });
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
    const frenzy = this.frenzyActive;
    const frenzyMult = frenzy ? this.stats.frenzyValueMult : 1;
    for (const { fish, source } of this.captureQueue.splice(0, MAX_CAPTURES_PER_STEP)) {
      this.updateCombo();
      const sourceMult = source === "net" ? 1 : this.stats.abilityValueMult;
      const value =
        FISH[fish.kind].value * this.stats.fish[fish.kind].valueMult * this.stats.valueMult * sourceMult * frenzyMult *
        this.comboMult;
      this.earned += value;
      if (frenzy) {
        this.frenzyCaught++;
        this.frenzyEarned += value;
      }
      this.caught[fish.kind] = (this.caught[fish.kind] ?? 0) + 1;
      const credit = fish.credit ?? fish.kind;
      this.caughtBy[credit] = (this.caughtBy[credit] ?? 0) + 1;
      this.earnedBy[credit] = (this.earnedBy[credit] ?? 0) + value;
      this.emit({ type: "capture", kind: fish.kind, source, x: fish.x, y: fish.y, value, combo: this.combo });

      FISH_SPECS[fish.kind].onCapture?.(this, fish, source);
      if (this.rng() < this.stats.twinChance) this.spawn(fish.kind);
      const bonusRoom = this.stats.roundSeconds - this.bonusTime;
      if (bonusRoom > 0 && this.rng() < this.stats.timeBonusChance) {
        const seconds = Math.min(this.stats.timeBonusSeconds, bonusRoom);
        this.bonusTime += seconds;
        this.timeLeft += seconds;
        this.emit({ type: "time-bonus", x: fish.x, y: fish.y, seconds });
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
