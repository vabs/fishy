import { describe, expect, it } from "vitest";
import { createViewport, toWorldPoint } from "./viewport";

describe("game viewport", () => {
  it("preserves the reference arena at 1280 by 800", () => {
    expect(createViewport(1280, 800)).toEqual({
      screenWidth: 1280, screenHeight: 800, x: 0, y: 0,
      worldWidth: 1280, worldHeight: 800, scale: 1,
    });
  });

  it.each([[390, 844], [844, 390], [1920, 1080]])("keeps arena area constant at %i by %i", (width, height) => {
    const view = createViewport(width, height, 64, 56);
    expect(view.worldWidth * view.worldHeight).toBeCloseTo(1_024_000);
    expect(view.worldWidth * view.scale).toBeCloseTo(width);
    expect(view.worldHeight * view.scale).toBeCloseTo(height - 120);
    expect(view.y).toBe(64);
  });

  it("maps CSS positions to world positions after accounting for the HUD", () => {
    const view = createViewport(640, 480, 80);
    expect(toWorldPoint(view, { x: 100, y: 180 })).toEqual({ x: 200, y: 200 });
  });

  it("stays finite when browser chrome temporarily leaves no play area", () => {
    const view = createViewport(390, 40, 64, 56);
    expect(Number.isFinite(view.scale)).toBe(true);
    expect(view.worldWidth).toBeGreaterThan(0);
    expect(view.worldHeight).toBeGreaterThan(0);
  });
});
