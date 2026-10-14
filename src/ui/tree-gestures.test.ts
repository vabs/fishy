import { describe, expect, it } from "vitest";
import { TreeGestures, type TreePointer } from "./tree-gestures";

const touch = (id: number, x: number, y: number, nodeId: string | null = null): TreePointer => ({ id, x, y, pointerType: "touch", nodeId });
const initial = { x: 10, y: 20, scale: 1 };

describe("tree pointer gestures", () => {
  it("dismisses an active pinch and returns every capture to release", () => {
    const gestures = new TreeGestures();
    gestures.down(touch(1, 0, 0, "net.radius"), initial);
    gestures.down(touch(2, 100, 0), initial);
    expect(gestures.cancelAll()).toEqual([1, 2]);
    expect(gestures.panning).toBe(false);
    expect(gestures.suppressClick).toBe(true);
    expect(gestures.move(touch(1, 20, 20), initial, 0.3, 2)).toBeNull();
    expect(gestures.up(touch(2, 100, 0))).toEqual({ selection: null, touchTap: false });
    expect(gestures.cancelAll()).toEqual([]);
  });

  it("selects a tapped touch node and suppresses its purchase click", () => {
    const gestures = new TreeGestures();
    gestures.down(touch(1, 50, 50, "net.radius"), initial);
    expect(gestures.up(touch(1, 52, 51))).toEqual({ selection: "net.radius", touchTap: true });
    expect(gestures.suppressClick).toBe(true);
  });

  it("keeps a mouse click available for immediate purchase", () => {
    const gestures = new TreeGestures();
    const mouse = { ...touch(1, 50, 50, "net.radius"), pointerType: "mouse" };
    gestures.down(mouse, initial);
    expect(gestures.up(mouse)).toEqual({ selection: null, touchTap: false });
    expect(gestures.suppressClick).toBe(false);
  });

  it("pans from the starting view and never selects after a drag", () => {
    const gestures = new TreeGestures();
    gestures.down(touch(1, 50, 50, "net.radius"), initial);
    expect(gestures.move(touch(1, 70, 80), initial, 0.3, 2)).toEqual({ x: 30, y: 50, scale: 1 });
    expect(gestures.up(touch(1, 70, 80))).toEqual({ selection: null, touchTap: false });
    expect(gestures.suppressClick).toBe(true);
  });

  it("anchors pinch zoom at the moving midpoint", () => {
    const gestures = new TreeGestures();
    gestures.down(touch(1, 0, 0), initial);
    gestures.down(touch(2, 100, 0), initial);
    // Midpoint moves from (50, 0) to (100, 0), distance doubles.
    expect(gestures.move(touch(2, 200, 0), initial, 0.3, 2)).toEqual({ x: 20, y: 40, scale: 2 });
    expect(gestures.up(touch(2, 200, 0))).toEqual({ selection: null, touchTap: false });
    expect(gestures.suppressClick).toBe(true);
  });

  it("rebases the remaining finger after pinch without jumping or selecting", () => {
    const gestures = new TreeGestures();
    gestures.down(touch(1, 0, 0, "net.radius"), initial);
    gestures.down(touch(2, 100, 0), initial);
    const pinched = gestures.move(touch(2, 200, 0), initial, 0.3, 2)!;
    gestures.up(touch(2, 200, 0));
    expect(gestures.move(touch(1, 5, 10), pinched, 0.3, 2)).toEqual({ x: 25, y: 50, scale: 2 });
    expect(gestures.up(touch(1, 5, 10))).toEqual({ selection: null, touchTap: false });
  });

  it("clamps pinch scale while retaining midpoint translation", () => {
    const gestures = new TreeGestures();
    gestures.down(touch(1, 0, 0), initial);
    gestures.down(touch(2, 100, 0), initial);
    expect(gestures.move(touch(2, 300, 0), initial, 0.3, 2)).toEqual({ x: 70, y: 40, scale: 2 });
  });

  it("cancels all pointers and suppresses any interrupted purchase click", () => {
    const gestures = new TreeGestures();
    gestures.down(touch(1, 50, 50, "net.radius"), initial);
    gestures.cancel(1);
    expect(gestures.move(touch(1, 100, 100), initial, 0.3, 2)).toBeNull();
    expect(gestures.up(touch(1, 100, 100))).toEqual({ selection: null, touchTap: false });
    expect(gestures.suppressClick).toBe(true);
    const mouse = { ...touch(2, 50, 50), pointerType: "mouse" };
    gestures.down(mouse, initial);
    gestures.up(mouse);
    expect(gestures.suppressClick).toBe(false);
  });

  it("ignores normal lost capture after a completed pointer release", () => {
    const gestures = new TreeGestures();
    const mouse = { ...touch(1, 50, 50), pointerType: "mouse" };
    gestures.down(mouse, initial);
    gestures.up(mouse);
    gestures.cancel(1);
    expect(gestures.suppressClick).toBe(false);
  });
});
