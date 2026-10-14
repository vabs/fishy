/** A short-lived visual effect owned by the renderer. */
export interface Effect {
  /** Seconds the effect lasts. */
  life: number;
  /** Draws the effect. `t` runs from 0 (start) to 1 (end). The context is in CSS px. */
  draw(ctx: CanvasRenderingContext2D, t: number): void;
}
