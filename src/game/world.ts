import { CHEST, chestInNet, chestTime, chestValue, launchChest, moveChest, type Chest, type ChestReward } from "./chest";
import { FISH, FISH_KINDS, FISH_SPECS, type FishDef, type FishKind } from "./fish";
import { GOLDEN, goldenSwim, newGoldenState, type GoldenState } from "./golden";
import { createRng, pickWeighted, range, type Rng } from "./rng";
import { castTraps, resizeTraps, RIGGING, type Trap } from "./rigging";
import { spawnRate, type Stats } from "./stats";

const TAU = Math.PI * 2;

/** The sim always advances in fixed steps, so a seed replays a round exactly. */
export const STEP = 1 / 60;

/** Endless sandbox pacing and population limit. */
export const ENDLESS: {
  /** Seconds between the starts of frenzy waves. */
  frenzyEvery: number;
  /** Seconds until the first wave. */
  firstFrenzy: number;
  /** Seconds between chest arrivals, waiting if the previous chest is still present. */
  chestGap: [number, number];
  /** Most fish swimming at once: about 1.3× the median peak (61) in full-upgrade timed play. */
  maxFish: number;
  /**
   * Extra room above `maxFish` for golden fish (including chest spills) and frenzy pour-ins, so a
   * sea that has filled up to the cap still gets its surprises.
   */
  surgeRoom: number;
} = { frenzyEvery: 90, firstFrenzy: 45, chestGap: [60, 100], maxFish: 80, surgeRoom: 40 };

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

export { RIGGING, type Trap } from "./rigging";

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
  /** Set on a golden fish: worth far more, flees the net and dives away if not caught in time. */
  golden?: GoldenState;
  /** Free per-fish state for the type's hooks (timers, flags). */
  state: Record<string, number>;
}

export type CaptureSource = "net" | "electric" | "epic" | "star" | "whirlpool" | "trap" | "seine";

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
  /** Damaging hits over this shot's whole flight. Absent until its first hit. */
  hits?: number;
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
  | { type: "capture"; kind: FishKind; source: CaptureSource; x: number; y: number; value: number; combo: number; golden?: boolean }
  | { type: "time-bonus"; x: number; y: number; seconds: number }
  | { type: "frenzy"; phase: "start" | "end" }
  /** A golden fish appeared. */
  | { type: "golden"; kind: FishKind; x: number; y: number }
  /** A golden fish wasn't caught in time and dived away. It's already gone from `fish`. */
  | { type: "golden-escape"; kind: FishKind; x: number; y: number; heading: number }
  /** The net opened the treasure chest. `value` is the money it paid. */
  | { type: "chest-open"; x: number; y: number; value: number; reward: ChestReward }
  | { type: "trap-cast"; traps: readonly Trap[] }
  | { type: "trap-snap"; trapId: number; x: number; y: number; hits: number }
  | FxEvent;

export interface SpawnOptions {
  /** Spawn at this screen position instead of a random spot. */
  at?: Point;
  /** Credit this fish's catch to another type in the round summary. */
  credit?: FishKind;
  /** Swim this way round the boat instead of a random one. */
  dir?: 1 | -1;
  /** Make it a golden fish. */
  golden?: boolean;
  /** A frenzy pour-in: may use the endless surge room above the population cap, like golden fish. */
  surge?: boolean;
}

/** Round summary rows that aren't a fish type. */
export type BonusKind = "golden" | "treasure";

/** Facts about the round being played that aren't upgrades. */
export interface RoundOptions {
  /** The round's number, from 1. */
  round: number;
  /** True for the Final Round, played once the whole tree is bought. */
  final: boolean;
  /** Endless sandbox: no clock, recurring frenzy waves and chests. */
  endless?: boolean;
  /** Events a bounty needs: make sure they happen this round. */
  guarantee?: { chest?: boolean; golden?: boolean };
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
  traps: Trap[] = [];
  /** Fish caught directly by trap nets and seine ropes this round. */
  trapCatches = 0;
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
  /**
   * Golden fish caught and treasure chests opened this round. They get their own summary rows, so
   * golden fish aren't in `caughtBy`.
   */
  bonusCount: Record<BonusKind, number> = { golden: 0, treasure: 0 };
  /** Money earned this round per bonus row. */
  bonusEarned: Record<BonusKind, number> = { golden: 0, treasure: 0 };
  /** The treasure chest floating across the sea, if there is one right now. */
  chest: Chest | null = null;
  /** Captures in the current combo after the first. */
  combo = 0;
  /** Highest combo multiplier reached this round (1 when no combo). */
  maxComboMult = 1;
  /** Most fish captured directly by a single net tick this round. */
  bestTickCatches = 0;
  /** Most damaging hits over a single Star shot's whole flight this round. */
  bestStarHits = 0;
  pointer: Point | null = null;
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
  /** Random numbers for round events (golden fish, the chest), kept apart from `rng`. See `eventRng`. */
  private eventStream: Rng | null = null;
  /** Progress towards the next golden fish, in fish. */
  private goldenProgress = 0;
  /** A guarantee only supplies a fallback if no golden fish has appeared at all. */
  private goldenSeen = false;
  /** Next chest arrival; null after the single timed chest, or in a timed round without one. */
  private chestAt: number | null = null;
  private finished = false;
  private readonly firstWave: FrenzyWave | null;
  /** Compensated elapsed sum in endless, keeping wave boundaries on their fixed steps for hours. */
  private elapsedError = 0;
  private riggingStream: Rng | null = null;
  private nextRecast = RIGGING.endlessRecast;

  constructor(
    readonly stats: Stats,
    readonly rng: Rng,
    private _width: number,
    private _height: number,
    readonly round: RoundOptions = { round: 1, final: false },
  ) {
    this.timeLeft = this.endless ? Infinity : stats.roundSeconds;
    // Only frenzy rounds and endless draw for a wave, so other timed rounds replay as before.
    if (this.endless || isFrenzyRound(round)) {
      const start = this.endless ? ENDLESS.firstFrenzy : stats.roundSeconds * FRENZY_START;
      this.firstWave = { start, end: start + stats.frenzySeconds, sweep: this.rng() < 0.5 ? 1 : -1 };
    } else {
      this.firstWave = null;
    }
    for (let i = 0; i < stats.startFish; i++) this.spawn();
    // Events that can't happen this round (always so in timed round 1) draw nothing, so those rounds
    // replay as they always have.
    if (this.hasGolden) this.goldenProgress = this.eventRng();
    const chestRound = this.round.final ||
      (this.round.round >= CHEST.fromRound && (stats.chestChance > 0 || this.round.guarantee?.chest));
    if (this.endless) this.chestAt = range(this.eventRng, ...ENDLESS.chestGap);
    else if (chestRound) this.chestAt = chestTime(this.round, stats, this.eventRng);
    this.castRigging();
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get over(): boolean {
    return this.endless ? this.finished : this.timeLeft <= 0;
  }

  /** True in the endless sandbox. */
  get endless(): boolean {
    return this.round.endless === true;
  }

  /** Ends an endless session. No-op in a timed round. */
  finish(): void {
    if (this.endless) this.finished = true;
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

  /** Fraction of the current combo window left, for the renderer's draining ring. */
  get comboProgress(): number {
    return this.stats.comboWindow > 0 ? Math.max(0, Math.min(1, 1 - (this.elapsed - this.lastCaptureAt) / this.stats.comboWindow)) : 0;
  }

  /** The current or next frenzy wave; null only in timed rounds without a wave. */
  get frenzy(): FrenzyWave | null {
    const first = this.firstWave;
    if (!this.endless || !first) return first;
    // Derive from the first start and an integer index, never by adding a period to a drifting
    // timer. Between waves expose the next one, so the renderer and HUD can read its duration.
    let index = Math.max(0, Math.floor((this.elapsed - first.start) / ENDLESS.frenzyEvery));
    if (this.elapsed >= first.start + index * ENDLESS.frenzyEvery + this.stats.frenzySeconds) index++;
    const start = first.start + index * ENDLESS.frenzyEvery;
    return {
      start, end: start + this.stats.frenzySeconds,
      sweep: index % 2 === 0 ? first.sweep : first.sweep === 1 ? -1 : 1,
    };
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
    this.traps = resizeTraps(this.traps, this.swimArea(), width, height, sx, sy);
    for (const shot of this.shots) {
      shot.x = Math.max(shot.radius, Math.min(width - shot.radius, shot.x * sx));
      shot.y = Math.max(shot.radius, Math.min(height - shot.radius, shot.y * sy));
    }
    for (const kind of FISH_KINDS) FISH_SPECS[kind].onResize?.(this, sx, sy);
    if (this.chest) {
      const chest = this.chest;
      chest.x *= sx;
      chest.y *= sy;
      const speed = Math.hypot(chest.vx, chest.vy);
      const scaled = Math.hypot(chest.vx * sx, chest.vy * sy);
      if (scaled > 0) {
        chest.vx = (chest.vx * sx * speed) / scaled;
        chest.vy = (chest.vy * sy * speed) / scaled;
      }
    }
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
    if (this.endless) {
      const seconds = dt - this.elapsedError;
      const elapsed = this.elapsed + seconds;
      this.elapsedError = (elapsed - this.elapsed) - seconds;
      this.elapsed = elapsed;
    } else {
      this.elapsed += dt;
    }
    this.announceFrenzy();
    if (this.endless && this.elapsed >= this.nextRecast) {
      this.castRigging();
      this.nextRecast = (Math.floor(this.elapsed / RIGGING.endlessRecast) + 1) * RIGGING.endlessRecast;
    }
    for (const trap of this.traps) {
      trap.age += dt;
      trap.cooldown = Math.max(0, trap.cooldown - dt);
      if (trap.cooldown < 1e-9) trap.cooldown = 0;
    }
    for (const kind of FISH_KINDS) FISH_SPECS[kind].update?.(this, dt);
    this.moveFish(dt);
    this.escapeGolden();
    this.spawnFish(dt);
    this.spawnGoldenFish(dt);
    this.floatChest(dt);
    this.tickNet(dt);
    this.snapTraps();
    this.processCaptures();
    if (!this.endless) this.timeLeft = Math.max(0, this.timeLeft - dt);
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
   * Adds a fish of `kind`, or of a type picked in proportion to spawn rates. Timed rounds only
   * enforce a type's maxOnScreen; endless also caps the swimming population, with surge room above
   * the cap for golden fish and frenzy pour-ins. Refused spawns are discarded, including school
   * members and capture by-products. Undefined if nothing could spawn.
   */
  spawn(kind?: FishKind, options: SpawnOptions = {}): Fish | undefined {
    if (this.endless) {
      let swimming = 0;
      for (const fish of this.fish) if (!fish.captured) swimming++;
      const limit = options.golden || options.surge ? ENDLESS.maxFish + ENDLESS.surgeRoom : ENDLESS.maxFish;
      if (swimming >= limit) return undefined;
    }
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
      ...(options.golden ? { golden: newGoldenState(this.stats) } : {}),
      state: {},
    };
    this.place(fish);
    this.fish.push(fish);
    FISH_SPECS[k].onSpawn?.(this, fish);
    if (fish.golden) {
      this.goldenSeen = true;
      this.emit({ type: "golden", kind: k, x: fish.x, y: fish.y });
    }
    return fish;
  }

  /**
   * Adds a golden fish of a type picked in proportion to spawn rates, as a fresh spawn of its own.
   * Undefined if nothing could spawn.
   */
  spawnGolden(at?: Point): Fish | undefined {
    const kind = this.pickKind(this.eventRng);
    return kind ? this.spawn(kind, at ? { golden: true, at } : { golden: true }) : undefined;
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

  /** Golden fish swim from GOLDEN.fromRound on, and in every endless session. */
  private get hasGolden(): boolean {
    return this.stats.goldenRate > 0 && (this.endless || this.round.final || this.round.round >= GOLDEN.fromRound);
  }

  /**
   * The random stream for round events, seeded from `rng` the first time it's needed. Events draw
   * from it, not from `rng`, so they don't shift every fish's random numbers when they happen.
   */
  private get eventRng(): Rng {
    this.eventStream ??= createRng(Math.floor(this.rng() * 0x1_0000_0000));
    return this.eventStream;
  }

  private snapTraps(): void {
    const stats = this.stats.rigging;
    for (const trap of this.traps) {
      if (trap.cooldown > 0) continue;
      const nearby = this.fishNear(trap, trap.radius).slice(0, stats.haul);
      if (nearby.length === 0) continue;
      for (const fish of nearby) this.damage(fish, stats.damage, "trap");
      trap.cooldown = stats.resetSeconds * (this.frenzyActive ? stats.frenzyResetMult : 1);
      this.emit({ type: "trap-snap", trapId: trap.id, x: trap.x, y: trap.y, hits: nearby.length });
    }
  }

  private castRigging(): void {
    if (this.stats.rigging.count <= 0) return;
    this.riggingStream ??= createRng(Math.floor(this.rng() * 0x1_0000_0000));
    this.traps = castTraps(this.swimArea(), this.width, this.height, this.stats.rigging, this.riggingStream);
    // Snapshot the cast: age and cooldown keep changing on the live traps.
    this.emit({ type: "trap-cast", traps: this.traps.map(trap => ({ ...trap })) });
  }

  private pickKind(rng: Rng = this.rng): FishKind | undefined {
    const weights: Partial<Record<FishKind, number>> = {};
    for (const kind of FISH_KINDS) {
      const max = FISH[kind].maxOnScreen;
      if (max !== undefined && this.countOf(kind) >= max) continue;
      // Proportions only: the global spawn multiplier is the same for every type.
      weights[kind] = this.stats.fish[kind].rate * this.stats.fish[kind].rateMult;
    }
    return pickWeighted(rng, weights);
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
      // A golden fish's extra speed applies to this step only; speedMult belongs to the type.
      const boost = fish.golden ? goldenSwim(this, fish, fish.golden, dt) : 1;
      fish.angle += (fish.dir * spec.def.speed * fish.speedMult * boost * dt) / Math.max(arc, 1);
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

  /** Golden fish whose time is up dive away, paying nothing. */
  private escapeGolden(): void {
    const escaping = (fish: Fish) => fish.golden !== undefined && !fish.captured && fish.golden.timeLeft <= 0;
    if (!this.fish.some(escaping)) return;
    for (const fish of this.fish) {
      if (escaping(fish)) this.emit({ type: "golden-escape", kind: fish.kind, x: fish.x, y: fish.y, heading: fish.heading });
    }
    this.fish = this.fish.filter((fish) => !escaping(fish));
  }

  /** Golden fish arrive on their own clock, not as a share of spawns. */
  private spawnGoldenFish(dt: number): void {
    const rate = this.stats.goldenRate;
    if (!this.hasGolden || rate <= 0) return;
    this.goldenProgress += rate * dt;
    while (this.goldenProgress >= 1) {
      this.goldenProgress -= 1;
      this.spawnGolden();
    }
    if (this.round.guarantee?.golden && !this.goldenSeen && this.elapsed >= this.stats.roundSeconds * 0.35) {
      this.spawnGolden();
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
    this.spawn(kind, { at: { x: cx + u * rx, y }, dir, surge: true });
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
    let catches = 0;
    for (const fish of this.fish) {
      if (fish.captured || !this.inNet(fish, point)) continue;
      const crit = this.rng() < this.stats.critChance;
      if (crit) crits++;
      this.damage(fish, this.stats.netDamage * (crit ? this.stats.critMult : 1), "net");
      if (fish.captured) catches++;
      hits++;
    }
    this.bestTickCatches = Math.max(this.bestTickCatches, catches);
    const chest = this.chest;
    if (chest && chestInNet(chest, point, this.stats.netRadius)) {
      const crit = this.eventRng() < this.stats.critChance;
      if (crit) crits++;
      hits++;
      chest.hp -= this.stats.netDamage * (crit ? this.stats.critMult : 1);
      chest.hitFlash = HIT_FLASH_SECONDS;
      if (chest.hp <= 0) this.openChest(chest);
    }
    this.emit({ type: "tick", x: point.x, y: point.y, radius: this.stats.netRadius, hits, crits });
  }

  /** The chest appears on time, drifts across, and is gone if it reaches the far edge unopened. */
  private floatChest(dt: number): void {
    if (this.chestAt !== null && this.elapsed >= this.chestAt && (!this.endless || !this.chest)) {
      this.chestAt = this.endless ? this.elapsed + range(this.eventRng, ...ENDLESS.chestGap) : null;
      this.chest = launchChest(this._width, this._height, this.eventRng);
    }
    if (this.chest && !moveChest(this.chest, dt, this._width, this._height)) this.chest = null;
  }

  /**
   * Pays out a chest the net has broken open: a lump sum (no combo, no ability bonus), plus either
   * extra round time or golden fish spilling out.
   */
  private openChest(chest: Chest): void {
    this.chest = null;
    const value = chestValue(this.stats);
    this.earned += value;
    this.bonusCount.treasure++;
    this.bonusEarned.treasure += value;
    const reward: ChestReward = this.eventRng() < 0.5 && !this.endless ? "time" : "golden";
    this.emit({ type: "chest-open", x: chest.x, y: chest.y, value, reward });
    if (reward === "time") {
      this.timeLeft += CHEST.bonusSeconds;
      // Below the chest, clear of its payout floater.
      this.emit({ type: "time-bonus", x: chest.x, y: chest.y + CHEST.size, seconds: CHEST.bonusSeconds });
      return;
    }
    for (let i = 0; i < CHEST.goldenFish; i++) {
      const a = (i / CHEST.goldenFish) * Math.PI * 2 + this.eventRng();
      this.spawnGolden({ x: chest.x + Math.cos(a) * 16, y: chest.y + Math.sin(a) * 16 });
    }
  }

  private processCaptures(): void {
    if (this.captureQueue.length === 0) return;
    const frenzy = this.frenzyActive;
    const frenzyMult = frenzy ? this.stats.frenzyValueMult : 1;
    for (const { fish, source } of this.captureQueue.splice(0, MAX_CAPTURES_PER_STEP)) {
      this.updateCombo();
      const rigging = source === "trap" || source === "seine";
      if (rigging) this.trapCatches++;
      const sourceMult = source === "net" || rigging ? 1 : this.stats.abilityValueMult;
      const goldenMult = fish.golden ? this.stats.goldenValueMult : 1;
      const value =
        FISH[fish.kind].value * this.stats.fish[fish.kind].valueMult * this.stats.valueMult * sourceMult * frenzyMult *
        this.comboMult * goldenMult;
      this.earned += value;
      if (frenzy) {
        this.frenzyCaught++;
        this.frenzyEarned += value;
      }
      this.caught[fish.kind] = (this.caught[fish.kind] ?? 0) + 1;
      if (fish.golden) {
        this.bonusCount.golden++;
        this.bonusEarned.golden += value;
      } else {
        const credit = fish.credit ?? fish.kind;
        this.caughtBy[credit] = (this.caughtBy[credit] ?? 0) + 1;
        this.earnedBy[credit] = (this.earnedBy[credit] ?? 0) + value;
      }
      this.emit({
        type: "capture", kind: fish.kind, source, x: fish.x, y: fish.y, value, combo: this.combo,
        ...(fish.golden ? { golden: true } : {}),
      });

      FISH_SPECS[fish.kind].onCapture?.(this, fish, source);
      if (this.rng() < this.stats.twinChance) this.spawn(fish.kind);
      const bonusRoom = this.stats.roundSeconds - this.bonusTime;
      if (!this.endless && bonusRoom > 0 && this.rng() < this.stats.timeBonusChance) {
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
    this.maxComboMult = Math.max(this.maxComboMult, this.comboMult);
    this.lastCaptureAt = this.elapsed;
  }
}
