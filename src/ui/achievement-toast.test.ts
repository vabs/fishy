// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showAchievementToast } from "./achievement-toast";
import { renderAchievements } from "./achievements-view";
import type { Achievement } from "../game/achievements";

const first: Achievement = {
  id: "one",
  name: "Hooked",
  description: "Catch your first fish",
  icon: "net",
};
const second: Achievement = {
  id: "two",
  name: "Sea Legs",
  description: "Keep fishing",
  icon: "wave",
};

beforeEach(() => {
  vi.useFakeTimers();
  // The DOM environment has no raster canvas; DOM and timer behavior remain real.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("achievement toast", () => {
  it("queues earned badges without cutting the current toast short, then hides", () => {
    const el = document.createElement("div");
    document.body.append(el);
    showAchievementToast(el, first);
    showAchievementToast(el, second);
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain("Hooked");
    vi.advanceTimersByTime(2900);
    expect(el.textContent).toContain("Hooked");
    vi.advanceTimersByTime(500);
    expect(el.textContent).toContain("Sea Legs");
    vi.advanceTimersByTime(3500);
    expect(el.hidden).toBe(true);
    el.remove();
  });
});

describe("achievement logbook", () => {
  it("keeps locked descriptions visible and redraws earned dates without duplicating cards", () => {
    const grid = document.createElement("div");
    renderAchievements(grid, [first, second], { one: "2026-10-20T12:00:00Z" });
    expect(grid.children).toHaveLength(2);
    expect(grid.children[0]?.textContent).toContain("Earned");
    expect(grid.children[1]?.textContent).toContain("Keep fishing");
    expect(grid.children[1]?.textContent).toContain("Locked");
    renderAchievements(grid, [first, second], {
      one: "2026-10-20T12:00:00Z",
      two: "2026-10-21T12:00:00Z",
    });
    expect(grid.children).toHaveLength(2);
    expect(grid.querySelectorAll(".is-earned")).toHaveLength(2);
  });
});
