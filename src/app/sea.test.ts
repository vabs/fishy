// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import shell from "../../index.html?raw";
import { createSave, type SaveData } from "../save";
import type { Scene } from "../game/render";

const state = vi.hoisted(() => ({ scene: null as Scene | null, screen: vi.fn() }));
vi.mock("../game/render", () => ({ Renderer: class {
  resize() {} onEvent() {} shake() {} drainCoinArrivals() { return 0; }
  draw(scene: Scene) { state.scene = scene; }
} }));
vi.mock("../audio", () => ({ createGameAudio: () => ({ supported: false, screen: state.screen,
  bounty() {}, achievement() {}, frame() {} }) }));
vi.mock("../ui/tech-tree", () => ({ mountTechTree: () => ({ update() {}, dismiss() {} }) }));
vi.mock("../game/shapes", () => ({ buildSprites: () => ({ full: { width: 40, height: 26 } }),
  buildChestSprites: () => ({ full: { width: 40, height: 26 } }) }));

afterEach(() => {
  history.replaceState(null, "", "/");
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("announces timed weather, records its bonus, and follows an Endless trip through biomes", async () => {
  const parsed = new DOMParser().parseFromString(shell, "text/html");
  document.body.replaceChildren(...parsed.body.childNodes);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Date, "now").mockReturnValue(1234);
  let frame: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1; });
  let now = performance.now();
  const advance = () => { now = Math.max(performance.now(), now) + 50; frame(now); };
  const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const stored = (): SaveData => JSON.parse(localStorage.getItem("fishy.save")!);
  const save = { ...createSave("Skipper"), round: 7, money: 1000 };
  localStorage.clear();
  localStorage.setItem("fishy.save", JSON.stringify(save));
  history.replaceState(null, "", "/?sea=storm");
  await import("../main");
  el("title-play").click();
  expect(el("start-button").dataset.sea).toBe("storm");
  expect(el("start-button").querySelector(".weather-badge")?.textContent).toContain("Storm");
  expect(el("hub-hint").textContent).toMatch(/fish drift with the wind/);
  el("start-button").click(); advance();
  const storm = state.scene!.world!;
  expect(storm.sea).toBe("storm");
  expect(el("sea-banner").hidden).toBe(false);
  expect(el("sea-banner").textContent).toContain("Storm · catches ×1.2");
  el("pause-button").click();
  for (let i = 0; i < 70; i++) advance();
  expect(el("sea-banner").hidden).toBe(false);
  el("resume-button").click();
  for (let i = 0; i < 65; i++) advance();
  expect(el("sea-banner").hidden).toBe(true);
  storm.seaEarned = 12; storm.earned = 72; storm.timeLeft = .001; advance();
  expect(el("summary-panel").hidden).toBe(false);
  expect(el("summary-bonuses").textContent).toContain("Storm bonus +$12");
  expect(stored().money).toBe(1072);

  history.replaceState(null, "", "/?sea=fog");
  el("continue-button").click(); el("start-button").click(); advance();
  const fog = state.scene!.world!;
  expect(fog.sea).toBe("fog");
  expect(el("sea-banner").textContent).toContain("Fog · catches ×1.15");
  fog.seaEarned = 3; fog.timeLeft = .001; advance();
  expect(el("summary-bonuses").textContent).toContain("Fog bonus +$3");

  history.replaceState(null, "", "/?sea=bloom");
  el("continue-button").click();
  expect(stored().bounties!.list.every((b) => b.kind !== "earn")).toBe(true);
  el("start-button").click(); advance();
  const bloom = state.scene!.world!;
  expect(bloom.sea).toBe("bloom");
  bloom.timeLeft = .001; advance();
  expect(el("summary-bonuses").querySelector('[data-key="sea"]')?.textContent).toBe("Algal Bloom");

  // Invalid dev weather falls back to the real round rule; a clear round removes the old row.
  history.replaceState(null, "", "/?sea=invalid");
  el("continue-button").click();
  expect(el("start-button").classList.contains("has-weather")).toBe(false);
  el("start-button").click(); advance();
  const clear = state.scene!.world!;
  expect(clear.sea).toBe("clear");
  expect(el("sea-banner").hidden).toBe(true);
  clear.timeLeft = .001; advance();
  expect(el("summary-bonuses").querySelector('[data-key="sea"]')).toBeNull();

  history.replaceState(null, "", "/?endlessTime=301");
  el("continue-button").click(); el("hub-home").click(); el("title-endless").click(); advance();
  const endless = state.scene!.world!;
  expect(endless.elapsed).toBeGreaterThanOrEqual(301);
  expect(endless.elapsed).toBeLessThanOrEqual(301.25);
  expect(el("hud-biome").textContent).toBe("Abyssal Trench");
  expect(el("hud-biome-next").textContent).toBe("4:59 to next biome");
  expect(el("hud-weather").hidden).toBe(false);
  expect(el("biome-banner").textContent).toBe("Entering the Abyssal Trench");
  expect(state.screen).toHaveBeenLastCalledWith("round", expect.objectContaining({ endless: true, biome: "trench" }));
  // The seeded pending weather waits out the 315–320s wave, then announces its start.
  endless.elapsed = 319.99; advance();
  expect(endless.sea).toBe("storm");
  expect(el("sea-banner").hidden).toBe(false);
  expect(el("sea-banner").textContent).toContain("Storm · catches ×1.2");
  expect(el("hud-weather").textContent).toContain("Storm · 60s left");
  // Cross the next boundary through the normal update path, then check its trip-end moment.
  endless.elapsed = 599.99; advance();
  expect(el("hud-biome").textContent).toBe("Sunken Graveyard");
  expect(el("biome-banner").textContent).toBe("Entering the Sunken Graveyard");
  expect(state.screen).toHaveBeenLastCalledWith("round", expect.objectContaining({ biome: "graveyard" }));
  endless.graveyardChests = 5;
  el("pause-button").click(); el("resume-button").click();
  expect(state.screen).toHaveBeenLastCalledWith("round", expect.objectContaining({ biome: "graveyard" }));
  el("pause-button").click(); el("harbour-button").click();
  expect(el("endless-biomes").textContent).toBe("Biomes visited: Shallow Reef · Abyssal Trench · Sunken Graveyard");
  expect(stored().achievements).toHaveProperty("biome-trench");
  expect(stored().achievements).toHaveProperty("biome-graveyard");
});
