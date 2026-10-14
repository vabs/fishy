import { FISH, type FishKind } from "./fish";
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
  value: number;
  /** Position on the orbit, radians. */
  angle: number;
  /** Distance from the boat as a fraction of the swimming area: 0 is the centre, 1 the edge. */
  orbit: number;
  dir: 1 | -1;
  wobblePhase: number;
  x: number;
  y: number;
  /** Direction of travel, radians. */
  heading: number;
  /** Seconds since spawning. */
  age: number;
  /** Seconds left on the hit flash. */
  hitFlash: number;
  captured: boolean;
}

export type CaptureSource = "net";

export type WorldEvent =
  | { type: "tick"; x: number; y: number; radius: number; hits: number }
  | { type: "capture"; kind: FishKind; source: CaptureSource; x: number; y: number; value: number };

/** One round of play. No DOM access: input writes `pointer`, the renderer reads the rest. */
export class World {
  fish: Fish[] = [];
  timeLeft: number;
  /** Money earned this round. Banked when the round ends. */
  earned = 0;
  caught: Partial<Record<FishKind, number>> = {};
  pointer: Point | null = null;

  private events: WorldEvent[] = [];
  private captureQueue: { fish: Fish; source: CaptureSource }[] = [];
  private tickTimer = 0;
  private spawnTimer = 0;
  private nextId = 1;

  constructor(
    readonly stats: Stats,
    private readonly rng: Rng,
    private width: number,
    private height: number,
  ) {
    this.timeLeft = stats.roundSeconds;
    for (let i = 0; i < stats.startFish; i++) this.spawn();
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

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    for (const fish of this.fish) this.place(fish);
  }

  /** Returns everything that happened since the last call, for effects and sound. */
  drainEvents(): WorldEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  update(dt: number): void {
    if (this.over) return;
    this.moveFish(dt);
    this.spawnFish(dt);
    this.tickNet(dt);
    this.processCaptures();
    this.timeLeft = Math.max(0, this.timeLeft - dt);
  }

  spawn(kind?: FishKind): Fish | undefined {
    const k = kind ?? pickWeighted(this.rng, this.stats.spawnWeights);
    if (!k) return undefined;
    const def = FISH[k];
    const { rx, ry } = this.area();
    const minOrbit = Math.min(0.9, BOAT_CLEARANCE / Math.min(rx, ry));
    const dir = this.rng() < 0.5 ? 1 : -1;
    const angle = range(this.rng, 0, TAU);
    const fish: Fish = {
      id: this.nextId++,
      kind: k,
      hp: def.hp,
      maxHp: def.hp,
      value: def.value,
      angle,
      orbit: range(this.rng, minOrbit, 1),
      dir,
      wobblePhase: range(this.rng, 0, TAU),
      x: 0,
      y: 0,
      heading: angle + (dir * Math.PI) / 2,
      age: 0,
      hitFlash: 0,
      captured: false,
    };
    this.place(fish);
    this.fish.push(fish);
    return fish;
  }

  damage(fish: Fish, amount: number, source: CaptureSource): void {
    if (fish.captured) return;
    fish.hp -= amount;
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

  /** The ellipse fish swim in, fitted to the screen. */
  private area(): { cx: number; cy: number; rx: number; ry: number } {
    return {
      cx: this.width / 2,
      cy: this.height / 2,
      rx: Math.max(this.width / 2 - EDGE_MARGIN, 1),
      ry: Math.max(this.height / 2 - EDGE_MARGIN, 1),
    };
  }

  private place(fish: Fish): void {
    const { cx, cy, rx, ry } = this.area();
    const wobble = Math.sin(fish.wobblePhase) * FISH[fish.kind].wobble;
    const cos = Math.cos(fish.angle);
    const sin = Math.sin(fish.angle);
    fish.x = cx + cos * (fish.orbit * rx + wobble);
    fish.y = cy + sin * (fish.orbit * ry + wobble);
  }

  private moveFish(dt: number): void {
    const { rx, ry } = this.area();
    for (const fish of this.fish) {
      const def = FISH[fish.kind];
      // Path length per radian at this point on the ellipse, so speed is px/s everywhere.
      const arc = fish.orbit * Math.hypot(rx * Math.sin(fish.angle), ry * Math.cos(fish.angle));
      fish.angle += (fish.dir * def.speed * dt) / Math.max(arc, 1);
      fish.wobblePhase += def.wobbleSpeed * dt;
      const prevX = fish.x;
      const prevY = fish.y;
      this.place(fish);
      fish.heading = Math.atan2(fish.y - prevY, fish.x - prevX);
      fish.age += dt;
      fish.hitFlash = Math.max(0, fish.hitFlash - dt);
    }
  }

  private spawnFish(dt: number): void {
    const every = Math.max(this.stats.spawnSeconds, STEP);
    this.spawnTimer += dt;
    while (this.spawnTimer >= every) {
      this.spawnTimer -= every;
      if (this.fish.length < this.stats.maxFish) this.spawn();
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
    for (const fish of this.fish) {
      if (fish.captured || !this.inNet(fish, point)) continue;
      this.damage(fish, this.stats.netDamage, "net");
      hits++;
    }
    this.events.push({ type: "tick", x: point.x, y: point.y, radius: this.stats.netRadius, hits });
  }

  private processCaptures(): void {
    if (this.captureQueue.length === 0) return;
    for (const { fish, source } of this.captureQueue.splice(0, MAX_CAPTURES_PER_STEP)) {
      const value = fish.value * this.stats.valueMult;
      this.earned += value;
      this.caught[fish.kind] = (this.caught[fish.kind] ?? 0) + 1;
      this.events.push({ type: "capture", kind: fish.kind, source, x: fish.x, y: fish.y, value });
    }
    this.fish = this.fish.filter((fish) => !fish.captured);
  }
}
