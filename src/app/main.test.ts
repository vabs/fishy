// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import shell from "../../index.html?raw";
import { createSave, type SaveData } from "../save";
import type { Scene } from "../game/render";

const state = vi.hoisted(() => ({ scene: null as Scene | null, screen: vi.fn(), bounty: vi.fn(), achievement: vi.fn() }));
vi.mock("../game/render", () => ({ Renderer: class {
  resize() {} onEvent() {} shake() {} drainCoinArrivals() { return 0; }
  draw(scene: Scene) { state.scene = scene; }
} }));
vi.mock("../audio", () => ({ createGameAudio: () => ({ supported: false, screen: state.screen,
  bounty: state.bounty, achievement: state.achievement, frame() {} }) }));
vi.mock("../ui/tech-tree", () => ({ mountTechTree: () => ({ update() {}, dismiss() {} }) }));
vi.mock("../game/shapes", () => ({ buildSprites: () => ({ full: { width: 40, height: 26 } }),
  buildChestSprites: () => ({ full: { width: 40, height: 26 } }) }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("routes title, hub, bounties and Endless while banking only timed rewards", async () => {
  const parsed = new DOMParser().parseFromString(shell, "text/html");
  document.body.replaceChildren(...parsed.body.childNodes);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const vibrate = vi.fn();
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
  let frame: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1; });
  let now = performance.now();
  const advance = () => { now = Math.max(performance.now(), now) + 50; frame(now); };
  const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const stored = (): SaveData => JSON.parse(localStorage.getItem("fishy.save")!);
  const saved = createSave("Skipper");
  saved.round = 2; saved.money = 1000;
  saved.stats.fishByType = { normal: 1, uncommon: 1 };
  saved.bounties = { round: 2, list: [
    { id: "earn", kind: "earn", target: 50, reward: 20 },
    { id: "chest", kind: "chest", target: 1, reward: 30 },
  ] };
  localStorage.setItem("fishy.save", JSON.stringify(saved));
  await import("../main");
  expect(el("title").hidden).toBe(false);
  expect(el("title-greeting").textContent).toBe("Welcome back, Skipper.");
  expect(el<HTMLButtonElement>("title-endless").disabled).toBe(false);
  expect(el("toast").textContent).toBe("2 achievements unlocked");
  expect(state.achievement).not.toHaveBeenCalled();

  el("title-settings").click();
  el("hub-tools-close").click();
  expect(el("hub-tools").hidden).toBe(true);
  expect(document.activeElement).toBe(el("title-settings"));
  el("title-settings").click();
  expect(el("hub-tools").parentElement).toBe(document.body);
  expect(el("hub-tools").hidden).toBe(false);
  const haptics = document.querySelector<HTMLButtonElement>('[data-action="haptics"]')!;
  haptics.click();
  document.querySelector<HTMLButtonElement>('[data-action="color-blind"]')!.click();
  expect(JSON.parse(localStorage.getItem("fishy.display")!)).toEqual({ colorBlind: true, haptics: false });
  haptics.click();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  expect(el("hub-tools").closest("#hub")).toBe(el("hub"));
  expect(document.activeElement).toBe(el("title-settings"));
  el("title-achievements").click();
  expect(el("achievements-panel").hidden).toBe(false);
  expect(el("title").inert).toBe(true);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  expect(el("achievements-panel").hidden).toBe(true);
  expect(el("title").inert).toBe(false);
  expect(document.activeElement).toBe(el("title-achievements"));

  el("title-play").click();
  expect(el("hub").hidden).toBe(false);
  expect(el("hub-bounties").children.length).toBe(2);
  el("hub-achievements").click();
  el("achievements-close").click();
  expect(document.activeElement).toBe(el("hub-achievements"));
  el("start-button").click();
  expect(el("hud-bounties").hidden).toBe(false);
  advance();
  const timed = state.scene!.world!;
  timed.earned = 80; timed.caught = { normal: 2 }; timed.bonusCount.treasure = 1;
  timed.maxComboMult = 1.6; timed.bestTickCatches = 10; timed.bestStarHits = 11;
  timed.timeLeft = .001;
  advance();
  expect(el("summary-panel").hidden).toBe(false);
  expect(stored().money).toBe(1130);
  expect(stored().stats).toMatchObject({ bountiesCompleted: 2, perfectBountyRounds: 1, bestCombo: 1.6,
    bestTickCatches: 10, bestStarHits: 11 });
  expect(el("summary-bounty-reward").textContent).toBe("Bounties +$50");
  expect(el("summary-total").textContent).toBe("$130");
  expect(state.bounty).toHaveBeenCalledTimes(2);
  expect(stored().achievements).toHaveProperty("bounty-perfect");
  advance();
  expect(state.bounty).toHaveBeenCalledTimes(2);
  expect(stored().money).toBe(1130);
  for (let i = 0; i < 20; i++) advance();
  expect(el("summary-earned").textContent).toBe("$130");
  expect(el("summary-earned").classList.contains("is-counting")).toBe(false);

  el("continue-button").click();
  el("hub-home").click();
  el("title-endless").click();
  advance();
  const endless = state.scene!.world!;
  expect(endless.endless).toBe(true);
  expect(state.screen).toHaveBeenLastCalledWith("round", expect.objectContaining({ endless: true }));
  expect(el("hud").dataset.mode).toBe("endless");
  expect(el("hud-bounties").hidden).toBe(true);
  expect(el("hud").classList.contains("is-urgent")).toBe(false);
  endless.earned = 200; endless.caught = { normal: 5 }; endless.elapsed = 601;
  advance();
  expect(el("hud-endless-time").textContent).toBe("10:01");
  expect(state.scene!.timeOfDay).toBeCloseTo((endless.elapsed / 240) % 1);
  el("pause-button").click();
  expect(el("harbour-button").hidden).toBe(false);
  const elapsed = endless.elapsed;
  advance();
  expect(endless.elapsed).toBe(elapsed);
  el("harbour-button").click();
  expect(el("endless-panel").hidden).toBe(false);
  expect(stored().money).toBe(1130);
  expect(stored().round).toBe(3);
  expect(stored().endless.sessions).toBe(1);
  expect(stored().achievements).toHaveProperty("endless-10");
  expect(el("endless-records").textContent).toContain("Longest trip");
  el("harbour-button").click();
  expect(stored().endless.sessions).toBe(1);
  el("endless-again").click();
  advance();
  expect(state.scene!.world!.endless).toBe(true);
  el("pause-button").click(); el("harbour-button").click(); el("endless-harbour").click();
  expect(el("title").hidden).toBe(false);
  expect(stored().endless.sessions).toBe(2);
  expect(state.screen).toHaveBeenLastCalledWith("title", expect.anything());
});
