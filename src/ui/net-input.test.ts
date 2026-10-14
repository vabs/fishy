import { describe, expect, it } from "vitest";
import type { Point } from "../game/world";
import { mountNetInput } from "./net-input";

class Surface extends EventTarget {
  captured = new Set<number>();
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
  getBoundingClientRect() { return { left: 10, top: 20, width: 640, height: 400 }; }
  fire(type: string, overrides: Record<string, unknown> = {}) {
    this.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 110, clientY: 170, ...overrides,
    }));
  }
}

function setup() {
  const surface = new Surface();
  let point: Point | null = null;
  let anchor: Point | null = null;
  let enabled = true;
  const input = mountNetInput(surface as unknown as HTMLCanvasElement, {
    getViewport: () => ({ screenWidth: 640, screenHeight: 400, x: 0, y: 0, worldWidth: 1280, worldHeight: 800, scale: 0.5 }),
    enabled: () => enabled,
    onChange: (next, finger) => { point = next; anchor = finger; },
  });
  return { surface, input, state: () => ({ point, anchor }), disable: () => { enabled = false; } };
}

describe("net input", () => {
  it("starts on touch-down and positions the net above the finger", () => {
    const { surface, state } = setup();
    surface.fire("pointerdown");
    expect(surface.captured.has(1)).toBe(true);
    expect(state()).toEqual({ point: { x: 200, y: 188 }, anchor: { x: 200, y: 300 } });
  });

  it.each(["pointerup", "pointercancel", "lostpointercapture"])("clears the net on %s", (event) => {
    const { surface, state } = setup();
    surface.fire("pointerdown");
    surface.fire(event);
    expect(state()).toEqual({ point: null, anchor: null });
    expect(surface.captured.size).toBe(0);
  });

  it("ignores extra fingers and lets a new finger take over after release", () => {
    const { surface, state } = setup();
    surface.fire("pointerdown");
    surface.fire("pointerdown", { pointerId: 2, isPrimary: false, clientX: 500 });
    surface.fire("pointermove", { pointerId: 2, clientX: 500 });
    surface.fire("pointerup", { pointerId: 2 });
    expect(state().point).toEqual({ x: 200, y: 188 });
    surface.fire("pointerup");
    surface.fire("pointerdown", { pointerId: 3, clientX: 210 });
    expect(state().point).toEqual({ x: 400, y: 188 });
  });

  it("preserves mouse hover controls without requiring a button press", () => {
    const { surface, state } = setup();
    surface.fire("pointermove", { pointerType: "mouse" });
    expect(state()).toEqual({ point: { x: 200, y: 300 }, anchor: null });
    surface.fire("pointerleave", { pointerType: "mouse" });
    expect(state().point).toBeNull();
  });

  it("clamps a captured drag at the arena edges", () => {
    const { surface, state } = setup();
    surface.fire("pointerdown");
    surface.fire("pointermove", { clientX: 900, clientY: 0 });
    expect(state().point).toEqual({ x: 1280, y: 0 });
  });

  it("ignores input while paused and clears capture on teardown", () => {
    const { surface, state, disable, input } = setup();
    surface.fire("pointerdown");
    input.clear();
    disable();
    surface.fire("pointerdown");
    expect(surface.captured.size).toBe(0);
    expect(state().point).toBeNull();
    input.destroy();
    surface.fire("pointermove", { pointerType: "mouse" });
    expect(state().point).toBeNull();
  });
});
