import type { Effect } from "../fx";
import type { CaptureSource, Fish, FxEvent, World } from "../world";

export type FishKind = "normal" | "uncommon" | "rare" | "electric" | "epic" | "goober" | "monster" | "star";

export interface FishDef {
  name: string;
  hp: number;
  /** Money paid when captured, before multipliers. */
  value: number;
  /** Speed along the orbit, px/s. The same wherever the fish spawned. */
  speed: number;
  /** Body length, px. */
  size: number;
  /** How far the fish drifts in and out of its orbit, px. */
  wobble: number;
  /** How fast it drifts in and out, radians/s. */
  wobbleSpeed: number;
  body: string;
  fin: string;
  /** Most of this type allowed in the water at once. Unlimited when missing. */
  maxOnScreen?: number;
}

/** Draws a fish centred on the origin, facing +x, `def.size` px long. Must fit inside the spec's box. */
export type DrawShape = (ctx: CanvasRenderingContext2D, def: FishDef) => void;

/**
 * Everything that makes a fish type what it is. Hooks are optional; a type with none just orbits.
 * Each type lives in its own file under src/game/fish/ and is registered in index.ts.
 */
export interface FishSpec {
  def: FishDef;
  shape: DrawShape;
  /** Sprite box as multiples of `def.size`. Defaults to 1.1 wide by 0.8 tall. */
  box?: { width: number; height: number };

  /** Runs right after the fish is added to the world. */
  onSpawn?(world: World, fish: Fish): void;
  /** Runs every step after the default orbit movement. Use fish.speedMult, offsetX/Y, dir, state. */
  move?(world: World, fish: Fish, dt: number): void;
  /** Adjusts damage before it's applied, e.g. armour. */
  modifyDamage?(world: World, fish: Fish, amount: number, source: CaptureSource): number;
  /** Runs once when this fish's capture is processed. */
  onCapture?(world: World, fish: Fish, source: CaptureSource): void;
  /** Runs once per step whether or not any fish of this type exist, e.g. to move projectiles. */
  update?(world: World, dt: number): void;
  /** Rebase type-specific displacement and movement history after the arena changes size. */
  onResize?(world: World, scaleX: number, scaleY: number): void;

  /** Draws world-level visuals for this type above the fish, e.g. a vortex or projectiles. */
  drawWorld?(ctx: CanvasRenderingContext2D, world: World, time: number): void;
  /** Turns this type's fx events into short-lived visual effects. */
  fx?(event: FxEvent, add: (effect: Effect) => void): void;
}
