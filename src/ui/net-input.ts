import { toWorldPoint, type GameViewport } from "../game/viewport";
import type { Point } from "../game/world";

const FINGER_OFFSET = 56;

interface NetInputOptions {
  getViewport(): GameViewport;
  enabled(): boolean;
  onChange(point: Point | null, finger: Point | null): void;
}

/** Mouse hover and a single captured touch share the same logical net position. */
export function mountNetInput(canvas: HTMLCanvasElement, options: NetInputOptions): { clear(): void; destroy(): void } {
  let active: number | null = null;

  function clear(): void {
    const id = active;
    active = null;
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    options.onChange(null, null);
  }

  function position(event: PointerEvent): void {
    const view = options.getViewport();
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * view.screenWidth / rect.width;
    const y = (event.clientY - rect.top) * view.screenHeight / rect.height;
    const touch = event.pointerType === "touch";
    const point = toWorldPoint(view, { x, y: y - (touch ? FINGER_OFFSET : 0) });
    point.x = Math.max(0, Math.min(view.worldWidth, point.x));
    point.y = Math.max(0, Math.min(view.worldHeight, point.y));
    options.onChange(point, touch ? toWorldPoint(view, { x, y }) : null);
  }

  const down = (event: PointerEvent): void => {
    if (!options.enabled() || event.pointerType === "mouse" || active !== null || !event.isPrimary) return;
    active = event.pointerId;
    canvas.setPointerCapture(active);
    event.preventDefault();
    position(event);
  };
  const move = (event: PointerEvent): void => {
    if (!options.enabled()) return;
    if (active !== null ? event.pointerId !== active : event.pointerType !== "mouse") return;
    position(event);
  };
  const end = (event: PointerEvent): void => {
    if (event.pointerId === active) clear();
  };
  const leave = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && active === null) clear();
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("lostpointercapture", end);
  canvas.addEventListener("pointerleave", leave);
  return {
    clear,
    destroy() {
      clear();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", end);
      canvas.removeEventListener("pointercancel", end);
      canvas.removeEventListener("lostpointercapture", end);
      canvas.removeEventListener("pointerleave", leave);
    },
  };
}
