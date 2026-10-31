// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import shell from "../../index.html?raw";

const state = vi.hoisted(() => ({ order: [] as string[], finishIntro: null as (() => void) | null, screen: vi.fn() }));
vi.mock("../ui/name-prompt", () => ({ promptForName: async () => { state.order.push("name"); return "New Skipper"; } }));
vi.mock("../ui/intro", () => ({ showIntro: () => {
  state.order.push("intro");
  return new Promise<void>((resolve) => { state.finishIntro = resolve; });
} }));
vi.mock("../game/render", () => ({ Renderer: class { resize() {} } }));
vi.mock("../audio", () => ({ createGameAudio: () => ({ supported: false, screen: state.screen }) }));
vi.mock("../ui/tech-tree", () => ({ mountTechTree: () => ({ update() {}, dismiss() {} }) }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("waits for name and tutorial before the title, with Endless locked and unsupported haptics hidden", async () => {
  const parsed = new DOMParser().parseFromString(shell, "text/html");
  document.body.replaceChildren(...parsed.body.childNodes);
  localStorage.clear();
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: undefined });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  const boot = import("../main");
  await vi.waitFor(() => expect(state.finishIntro).not.toBeNull());
  const el = (id: string): HTMLElement => document.getElementById(id)!;
  expect(state.order).toEqual(["name", "intro"]);
  expect(el("title").hidden).toBe(true);
  expect(el("hud").hidden).toBe(true);
  state.finishIntro!();
  await boot;
  expect(el("title").hidden).toBe(false);
  expect(el("title-greeting").textContent).toBe("Welcome aboard, New Skipper.");
  expect(el("title-endless").hasAttribute("disabled")).toBe(true);
  expect(el("title-endless-lock").hidden).toBe(false);
  expect(el("hub-haptics").hidden).toBe(true);
  expect(state.screen).toHaveBeenLastCalledWith("title", expect.anything());
  el("title-play").click();
  expect(el("hud").hidden).toBe(false);
  expect(el("hud-bounties").hidden).toBe(true);
  expect(el("hub").hidden).toBe(true);
  el("pause-button").click();
  expect(el("pause-panel").hidden).toBe(false);
  expect(el("harbour-button").hidden).toBe(true);
});
