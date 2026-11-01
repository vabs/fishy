// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import shell from "../../index.html?raw";
import { createSave } from "../save";
import type { Scene } from "../game/render";

const state = vi.hoisted(() => ({ scene: null as Scene | null }));
vi.mock("../game/render", () => ({ Renderer: class {
  resize() {} onEvent() {} shake() {} drainCoinArrivals() { return 0; }
  draw(scene: Scene) { state.scene = scene; }
} }));
vi.mock("../audio", () => ({ createGameAudio: () => ({ supported: false, screen() {},
  bounty() {}, achievement() {}, frame() {} }) }));
vi.mock("../ui/tech-tree", () => ({ mountTechTree: () => ({ update() {}, dismiss() {} }) }));
vi.mock("../game/shapes", () => ({ buildSprites: () => ({ full: { width: 40, height: 26 } }),
  buildChestSprites: () => ({ full: { width: 40, height: 26 } }) }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("wires tools, one-off hints, keyboard guards, pause, summary and Endless to the world", async () => {
  const parsed = new DOMParser().parseFromString(shell, "text/html");
  document.body.replaceChildren(...parsed.body.childNodes);
  localStorage.clear();
  const save = { ...createSave("Skipper"), round: 20, upgrades: {
    "net.radius": 1, "rigging.unlock": 1, "boat.chum": 1, "boat.lantern": 1,
  } };
  localStorage.setItem("fishy.save", JSON.stringify(save));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  let frame: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1; });
  let now = performance.now();
  const advance = () => { now = Math.max(performance.now(), now) + 50; frame(now); };
  const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const space = (target: EventTarget = window, repeat = false) => {
    const event = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true, repeat });
    target.dispatchEvent(event);
    return event;
  };
  await import("../main");
  el("title-play").click(); el("start-button").click(); advance();
  const world = state.scene!.world!;
  expect(world.traps.length).toBeGreaterThan(0);
  expect(el("round-hint").textContent).toBe("Trap nets snap shut on fish that swim over them");
  expect(el("toast").textContent).toBe("Press Space or tap the bucket to throw chum");
  const button = el<HTMLButtonElement>("chum-button");
  expect(button.hidden).toBe(false);
  expect(button.classList.contains("is-ready")).toBe(true);
  const down = vi.fn();
  document.addEventListener("pointerdown", down);
  button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(down).not.toHaveBeenCalled();
  document.removeEventListener("pointerdown", down);
  const input = document.createElement("input");
  document.body.append(input);
  space(input);
  expect(world.chumReady).toBe(true);
  input.remove();
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  const child = document.createElement("span");
  editor.append(child); document.body.append(editor);
  space(child);
  expect(world.chumReady).toBe(true);
  editor.remove();
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", ""); document.body.append(dialog);
  space();
  expect(world.chumReady).toBe(true);
  dialog.remove();
  space(window, true);
  expect(world.chumReady).toBe(true);
  el("pause-button").click();
  space(); button.click(); advance();
  expect(world.chumReady).toBe(true);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  expect(el("pause-panel").hidden).toBe(true);
  expect(space().defaultPrevented).toBe(true);
  advance();
  expect(world.chumActive).toBe(true);
  expect(button.dataset.cooldown).toBe("20");
  expect(button.getAttribute("aria-label")).toMatch(/20 seconds left/);
  expect(button.classList.contains("is-ready")).toBe(false);
  const ring = button.querySelector<SVGCircleElement>(".chum-progress")!;
  expect(Number(ring.style.strokeDashoffset)).toBeGreaterThan(99);
  world.trapCatches = 3;
  world.timeLeft = 0.001; advance();
  expect(el("summary-traps").hidden).toBe(false);
  expect(el("summary-traps").textContent).toBe("Trap nets: 3 fish");
  expect(el("summary-frenzy").nextElementSibling).toBe(el("summary-traps"));
  el("continue-button").click(); el("start-button").click(); advance();
  expect(el("round-hint").hidden).toBe(true);
  state.scene!.world!.timeLeft = 0.001; advance();
  expect(el("summary-traps").hidden).toBe(true);
  el("continue-button").click(); el("hub-home").click(); el("title-endless").click(); advance();
  const endless = state.scene!.world!;
  button.click(); advance();
  expect(endless.chumActive).toBe(true);
  expect(endless.traps.length).toBeGreaterThan(0);
  expect(state.scene!.timeOfDay).toBe(endless.timeOfDay);
});
