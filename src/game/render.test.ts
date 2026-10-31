import { afterEach, describe, expect, it, vi } from "vitest";
import { FISH_SPECS } from "./fish";
import { fishColors } from "./palette";
import { Renderer } from "./render";
import { BASE_STATS } from "./stats";
import { createViewport } from "./viewport";
import type { FxEvent } from "./world";

/** Records canvas submissions; browser benchmarks cover the actual raster cost. */
function canvasRecorder() {
  const paints: { blur: number; text?: string; font?: string; style?: string; alpha?: number; width?: number; arc?: number[] }[] = [];
  const fills: { color: string; blend: string; alpha: number }[] = [];
  let currentArc: number[] | undefined;
  const arcs: number[] = [];
  const ellipses: number[][] = [];
  const transforms: number[][] = [];
  const translations: number[][] = [];
  const images: number[][] = [];
  const noop = () => {};
  const target = {
    shadowBlur: 0,
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    beginPath() { currentArc = undefined; },
    stroke() { paints.push({ blur: this.shadowBlur, style: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth, arc: currentArc }); },
    fillRect() { fills.push({ color: this.fillStyle, blend: this.globalCompositeOperation, alpha: this.globalAlpha }); },
    fill() { paints.push({ blur: this.shadowBlur }); },
    fillText(text: string) { paints.push({ blur: this.shadowBlur, text, font: this.font, style: this.fillStyle, alpha: this.globalAlpha, width: this.lineWidth }); },
    arc(...values: number[]) { arcs.push(values[2]!); currentArc = values; },
    ellipse(...values: number[]) { ellipses.push(values); },
    setTransform(...values: number[]) { transforms.push(values); },
    translate(...values: number[]) { translations.push(values); },
    drawImage(_image: CanvasImageSource, ...values: number[]) { images.push(values); },
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
  const ctx = new Proxy(target, { get: (object, key) => Reflect.get(object, key) ?? noop }) as unknown as CanvasRenderingContext2D;
  const canvas = { getContext: () => ctx, style: {} } as unknown as HTMLCanvasElement;
  return { canvas, ctx, paints, fills, arcs, ellipses, transforms, translations, images, renderer: new Renderer(canvas) };
}

const scene = { world: null, pointer: null, stats: BASE_STATS };
const net = (x = 200): FxEvent => ({
  type: "fx", kind: "epic", name: "net", x, y: 200, radius: 180, points: [{ x: x + 30, y: 200 }],
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("viewport rendering", () => {
  it("draws logical world positions below the HUD at the correct screen scale", () => {
    const { canvas, renderer, transforms, translations } = canvasRecorder();
    vi.stubGlobal("document", { createElement: () => canvas });
    renderer.resize(640, 480, 2, createViewport(640, 480, 80));
    renderer.draw(scene, 0);
    expect(transforms).toContainEqual([1, 0, 0, 1, 0, 160]);
    expect(translations).toContainEqual([640, 400]);
  });
});

describe("burst rendering", () => {
  it("pulls a net-caught fish toward the net, shrinks it, and removes the visual after the catch", () => {
    const { renderer, images, translations } = canvasRecorder();
    vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
    renderer.onEvent({ type: "tick", x: 200, y: 200, radius: 70, hits: 1, crits: 0 });
    renderer.onEvent({ type: "capture", kind: "normal", source: "net", x: 150, y: 200, value: 1, combo: 0 });
    renderer.draw(scene, 0.04);
    expect(images).toHaveLength(1);
    const firstWidth = images[0]![2]!;
    const firstX = translations.at(-1)![0]!;
    expect(firstX).toBeGreaterThan(150);
    expect(firstX).toBeLessThan(200);
    renderer.draw(scene, 0.04);
    expect(images).toHaveLength(2);
    expect(images[1]![2]).toBeLessThan(firstWidth);
    expect(translations.at(-1)![0]).toBeGreaterThan(firstX);
    renderer.draw(scene, 0.4);
    expect(images).toHaveLength(2);
  });

  it("does not pull ability captures or captures with an expired net position", () => {
    const { renderer, images } = canvasRecorder();
    renderer.onEvent({ type: "tick", x: 200, y: 200, radius: 70, hits: 1, crits: 0 });
    renderer.onEvent({ type: "capture", kind: "normal", source: "epic", x: 150, y: 200, value: 1, combo: 0 });
    renderer.draw(scene, 0.2);
    renderer.onEvent({ type: "capture", kind: "normal", source: "net", x: 150, y: 200, value: 1, combo: 0 });
    renderer.draw(scene, 0.01);
    expect(images).toHaveLength(0);
  });

  it("bounds catch sprite artwork during a capture burst and restores its budget", () => {
    const { renderer, images } = canvasRecorder();
    vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
    const tick = () => renderer.onEvent({ type: "tick", x: 200, y: 200, radius: 70, hits: 1000, crits: 0 });
    const capture = () => renderer.onEvent({ type: "capture", kind: "normal", source: "net", x: 150, y: 200, value: 1, combo: 0 });
    tick();
    for (let i = 0; i < 1000; i++) capture();
    renderer.draw(scene, 0.01);
    expect(images.length).toBeGreaterThan(0);
    expect(images.length).toBeLessThanOrEqual(24);
    renderer.draw(scene, 1);
    images.length = 0;
    tick();
    capture();
    renderer.draw(scene, 0.01);
    expect(images).toHaveLength(1);
  });

  it("omits the added capture motion when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { renderer, images } = canvasRecorder();
    renderer.onEvent({ type: "tick", x: 200, y: 200, radius: 70, hits: 1, crits: 0 });
    renderer.onEvent({ type: "capture", kind: "normal", source: "net", x: 150, y: 200, value: 1, combo: 0 });
    renderer.draw(scene, 0.01);
    expect(images).toHaveLength(0);
  });

  it("combines nearby capture payouts without losing their value", () => {
    const { renderer, paints } = canvasRecorder();
    for (let i = 0; i < 1000; i++) renderer.onEvent({ type: "capture", kind: "normal", source: "net", x: 200, y: 200, value: 1, combo: i });
    renderer.draw(scene, 0.01);
    expect(paints.flatMap((p) => p.text ? [p.text] : [])).toEqual(["+$1,000"]);
  });

  it("keeps a golden catch's payout apart from the plain catches around it", () => {
    const { renderer, paints } = canvasRecorder();
    renderer.onEvent({ type: "capture", kind: "normal", source: "net", x: 200, y: 200, value: 1, combo: 0 });
    renderer.onEvent({ type: "capture", kind: "normal", source: "net", x: 200, y: 200, value: 10, combo: 1, golden: true });
    renderer.onEvent({ type: "capture", kind: "normal", source: "net", x: 200, y: 200, value: 1, combo: 2 });
    renderer.draw(scene, 0.01);
    expect(paints.flatMap((p) => p.text ? [p.text] : [])).toEqual(["+$2", "+$10"]);
  });

  it("bounds capture particles and lets the budget recover after they expire", () => {
    const { renderer, arcs } = canvasRecorder();
    const capture = () => renderer.onEvent({ type: "capture", kind: "normal", source: "net", x: 200, y: 200, value: 1, combo: 0 });
    for (let i = 0; i < 1000; i++) capture();
    renderer.draw(scene, 0.01);
    expect(arcs.filter((r) => r === 2.5).length).toBeLessThanOrEqual(360);
    renderer.draw(scene, 1);
    arcs.length = 0;
    capture();
    renderer.draw(scene, 0.01);
    expect(arcs.filter((r) => r === 2.5)).toHaveLength(8);
  });

  it.each(["epic", "electric"] as const)("admits at most twelve %s effects before building their artwork", (kind) => {
    const { renderer } = canvasRecorder();
    const factory = vi.spyOn(FISH_SPECS[kind], "fx");
    for (let i = 0; i < 200; i++) renderer.onEvent(kind === "epic" ? net(i * 200) : {
      type: "fx", kind, name: "current", x: i * 200, y: 200, points: [{ x: i * 200, y: 200 }],
    });
    expect(factory).toHaveBeenCalledTimes(12);
    renderer.draw(scene, 1);
    factory.mockClear();
    renderer.onEvent(kind === "epic" ? net() : { type: "fx", kind, name: "current", x: 200, y: 200 });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("shares one net between nearby Epic captures and keeps the input events intact", () => {
    const { renderer } = canvasRecorder();
    const factory = vi.spyOn(FISH_SPECS.epic, "fx");
    const first = net();
    const second = net(210);
    renderer.onEvent(first);
    renderer.onEvent(second);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]![0].points).toEqual([...first.points!, ...second.points!]);
    expect(first.points).toEqual([{ x: 230, y: 200 }]);
  });

  it("uses blur for only one Epic rim paint", () => {
    const { ctx, paints } = canvasRecorder();
    FISH_SPECS.epic.fx!(net(), (effect) => effect.draw(ctx, 0.6), fishColors("epic"));
    expect(paints.filter((p) => p.blur > 0)).toHaveLength(1);
  });

  it("bounds Monster streaks without modifying the capture event", () => {
    const { renderer } = canvasRecorder();
    const factory = vi.spyOn(FISH_SPECS.monster, "fx");
    const event: FxEvent = { type: "fx", kind: "monster", name: "implode", x: 200, y: 200, points: Array.from({ length: 1000 }, (_, i) => ({ x: 200 + i, y: 200 })) };
    renderer.onEvent(event);
    expect(factory.mock.calls[0]![0].points!.length).toBeLessThanOrEqual(96);
    expect(event.points).toHaveLength(1000);
  });

  it("bounds the shared effect pool during mixed capture bursts", () => {
    const { renderer } = canvasRecorder();
    const rare = vi.spyOn(FISH_SPECS.rare, "fx");
    const goober = vi.spyOn(FISH_SPECS.goober, "fx");
    for (let i = 0; i < 1000; i++) renderer.onEvent({ type: "fx", kind: i % 2 ? "rare" : "goober", name: i % 2 ? "armor" : "burst", x: 200, y: 200 });
    expect(rare.mock.calls.length + goober.mock.calls.length).toBeLessThanOrEqual(64);
  });

  it("draws Electric lightning without expensive shadow paints", () => {
    const { ctx, paints } = canvasRecorder();
    FISH_SPECS.electric.fx!({ type: "fx", kind: "electric", name: "current", x: 200, y: 200, points: [{ x: 200, y: 200 }, { x: 250, y: 200 }] }, (effect) => effect.draw(ctx, 0.6), fishColors("electric"));
    expect(paints.filter((p) => p.blur > 0)).toHaveLength(0);
  });
});

describe("renderer feel math", () => {
  it("leaves timed rounds untinted and interpolates a continuous day cycle", async () => {
    const { seaTint } = await import("./render");
    expect(seaTint(undefined).alpha).toBe(0);
    expect(seaTint(0.5).night).toBe(1);
    expect(seaTint(0).night).toBe(0);
    expect(seaTint(1)).toEqual(seaTint(0));
    expect(seaTint(0.5).alpha).toBeLessThanOrEqual(0.5);
    expect(seaTint(0.49999).alpha).toBeCloseTo(seaTint(0.50001).alpha, 3);
  });

  it("flies coins from their catch to the CSS target along a raised curve", async () => {
    const { coinFlight } = await import("./fx");
    const from = { x: 20, y: 200 }, to = { x: 300, y: 30 };
    expect(coinFlight(from, to, 0)).toMatchObject(from);
    expect(coinFlight(from, to, 1)).toMatchObject(to);
    expect(coinFlight(from, to, 0.5).y).toBeLessThan(115);
    expect(coinFlight(from, to, 1).scale).toBeLessThan(coinFlight(from, to, 0).scale);
  });

  it("caps shake at six CSS pixels and decays to rest in a quarter second", async () => {
    const { shakeOffset } = await import("./fx");
    expect(Math.hypot(...Object.values(shakeOffset(100, 0.01)))).toBeLessThanOrEqual(6);
    expect(shakeOffset(6, 0.25)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(6, 0.24).x ** 2 + shakeOffset(6, 0.24).y ** 2).toBeLessThan(0.01);
  });

  it("normalizes combo level, guards no-upgrade rounds, and drains the window", async () => {
    const { comboRingLevel } = await import("./render");
    expect(comboRingLevel(1.6, 2, 1)).toBeCloseTo(0.6);
    expect(comboRingLevel(1.6, 2, 0.5)).toBeCloseTo(0.3);
    expect(comboRingLevel(2, 1, 1)).toBe(0);
    expect(comboRingLevel(3, 2, 2)).toBe(1);
  });

  it("reports reduced-motion capture arrivals once and never loses a busy batch", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { renderer } = canvasRecorder();
    for (let i = 0; i < 100; i++) renderer.onEvent({ type: "capture", kind: "normal", source: "epic", x: 100, y: 100, value: 1, combo: 0 });
    renderer.draw({ ...scene, coinTarget: { x: 300, y: 20 } }, 0.01);
    expect(renderer.drainCoinArrivals()).toBe(100);
    expect(renderer.drainCoinArrivals()).toBe(0);
  });
});

describe("screen-space capture feedback", () => {
  it("bounds coin artwork at forty and preserves all merged arrivals", () => {
    const { renderer, images, ellipses } = canvasRecorder();
    const targetScene = { ...scene, coinTarget: { x: 320, y: 20 } };
    for (let i = 0; i < 1000; i++) renderer.onEvent({ type: "capture", kind: "normal", source: "epic", x: 100, y: 200, value: 1, combo: i });
    renderer.draw(targetScene, 0.01);
    expect(renderer.drainCoinArrivals()).toBe(0);
    expect(images).toHaveLength(0);
    expect(ellipses.filter((e) => e[3] === 4.5)).toHaveLength(40);
    renderer.draw(targetScene, 1);
    expect(renderer.drainCoinArrivals()).toBe(1000);
    expect(renderer.drainCoinArrivals()).toBe(0);
  });

  it("does not strand in-flight arrivals when the HUD disappears", () => {
    const { renderer } = canvasRecorder();
    renderer.onEvent({ type: "capture", kind: "normal", source: "epic", x: 100, y: 200, value: 1, combo: 0 });
    renderer.draw({ ...scene, coinTarget: { x: 320, y: 20 } }, 0.01);
    renderer.draw(scene, 0.01);
    expect(renderer.drainCoinArrivals()).toBe(1);
  });

  it("keeps the HUD coin path outside world shake transforms", () => {
    const { renderer, transforms } = canvasRecorder();
    renderer.shake(6);
    renderer.onEvent({ type: "capture", kind: "normal", source: "epic", x: 100, y: 200, value: 1, combo: 0 });
    renderer.draw({ ...scene, coinTarget: { x: 320, y: 20 } }, 0.01);
    expect(transforms.at(-1)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(transforms.some((t) => t[4] !== 0 || t[5] !== 0)).toBe(true);
  });

  it("reads the simulation's real combo expiry without changing it", async () => {
    const { World, STEP } = await import("./world");
    const { createRng } = await import("./rng");
    const world = new World({ ...BASE_STATS, comboWindow: 1 }, createRng(1), 1280, 800);
    expect(world.comboProgress).toBe(0);
    world.capture(world.fish[0]!, "net");
    world.update(STEP);
    expect(world.comboProgress).toBe(1);
    world.update(0.5);
    expect(world.comboProgress).toBeCloseTo(0.5);
    world.update(1);
    expect(world.comboProgress).toBe(0);
  });
});

it("reuses soft glow artwork across frames instead of rebuilding gradients", async () => {
  const { ctx, canvas } = canvasRecorder();
  vi.stubGlobal("document", { createElement: () => canvas });
  const gradient = vi.spyOn(ctx, "createRadialGradient");
  const { drawGlow } = await import("./fx");
  for (let i = 0; i < 100; i++) drawGlow(ctx, "254, 205, 71", 100, 200, 30, i / 100);
  expect(gradient).toHaveBeenCalledTimes(1);
  expect(ctx.globalAlpha).toBe(1);
});

it("emphasizes a ten-times catch using the fish average, excluding chest money", async () => {
  const { World } = await import("./world");
  const { createRng } = await import("./rng");
  const world = new World({ ...BASE_STATS, startFish: 0 }, createRng(1), 1280, 800);
  world.earned = 1100;
  world.bonusEarned.treasure = 1000;
  world.caught.normal = 100;
  const { renderer, paints } = canvasRecorder();
  renderer.onEvent({ type: "capture", kind: "normal", source: "epic", x: 100, y: 200, value: 10, combo: 0 });
  renderer.draw({ ...scene, world }, 0.01);
  expect(paints.find((paint) => paint.text === "+$10")?.font).toContain("26px");
});

it("projects coin origins into CSS pixels below the HUD on a scaled viewport", () => {
  const { renderer, ellipses } = canvasRecorder();
  vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
  renderer.resize(640, 480, 2, createViewport(640, 480, 80));
  renderer.onEvent({ type: "capture", kind: "normal", source: "epic", x: 100, y: 200, value: 1, combo: 0 });
  renderer.draw({ ...scene, coinTarget: { x: 320, y: 20 } }, 0.01);
  expect(ellipses.some((e) => e[0] === 50 && e[1] === 180 && e[2] === 4.5)).toBe(true);
});

describe("visual review corrections", () => {
  it("uses a darkening blend for dusk and dawn without whitening the water", async () => {
    const { seaTint } = await import("./render");
    for (const phase of [0.25, 0.75]) {
      const { renderer, fills } = canvasRecorder();
      renderer.draw({ ...scene, timeOfDay: phase }, 0);
      const overlay = fills.find((fill) => fill.color === seaTint(phase).color);
      expect(overlay?.blend).toBe("multiply");
    }
  });

  it("holds coin size through most of its flight before shrinking at the counter", async () => {
    const { coinFlight } = await import("./fx");
    const from = { x: 0, y: 300 }, to = { x: 400, y: 20 };
    expect(coinFlight(from, to, 0.7).scale).toBeGreaterThanOrEqual(1);
    expect(coinFlight(from, to, 0.95).scale).toBeLessThan(0.6);
  });

  it("puts the thin charge segment on the rope and leaves a gap before the combo arc", async () => {
    const { World, STEP } = await import("./world");
    const { createRng } = await import("./rng");
    const stats = { ...BASE_STATS, comboWindow: 1, tickSeconds: 1, netRadius: 70 };
    const world = new World(stats, createRng(1), 1280, 800);
    world.capture(world.fish[0]!, "net");
    world.update(STEP);
    world.combo = 6;
    world.fish = [];
    const { renderer, paints } = canvasRecorder();
    renderer.draw({ ...scene, world, stats, pointer: { x: 200, y: 200 } }, 0);
    const charge = paints.filter((paint) => paint.style === "#d9a441" && paint.arc);
    const combo = paints.find((paint) => paint.style === "#f4a259" && paint.arc);
    expect(charge).toHaveLength(1);
    expect(charge[0]!.arc![2]).toBe(70);
    expect(charge[0]!.arc![3]).toBe(-Math.PI / 2);
    expect(charge[0]!.width).toBeLessThan(2);
    expect(combo?.arc?.[3]).toBe(-Math.PI / 2);
    expect(combo!.arc![2]! - combo!.width! / 2 - 73.5).toBeGreaterThanOrEqual(6);
  });

  it("keeps small payouts bright through the burst with a thin outline", () => {
    const { renderer, paints } = canvasRecorder();
    renderer.onEvent({ type: "capture", kind: "normal", source: "epic", x: 100, y: 200, value: 38, combo: 0 });
    renderer.draw(scene, 0.35);
    const payout = paints.find((paint) => paint.text === "+$38");
    expect(payout?.alpha).toBe(1);
    expect(payout?.style).toBe("#fffbed");
    expect(payout?.width).toBeLessThan(2);
  });

  it("draws foam-white two-pixel catch rings that expire after half a second", () => {
    const { renderer, paints } = canvasRecorder();
    renderer.onEvent({ type: "capture", kind: "normal", source: "epic", x: 100, y: 200, value: 1, combo: 0 });
    renderer.draw(scene, 0.35);
    expect(paints.some((paint) => paint.width === 2 && paint.style?.startsWith("rgba(232, 251, 255, 0.3"))).toBe(true);
    paints.length = 0;
    renderer.draw(scene, 0.2);
    expect(paints.some((paint) => paint.width === 2 && paint.style?.startsWith("rgba(232, 251, 255,"))).toBe(false);
  });

  it("builds deterministic caustic cells with varied areas and directions", async () => {
    const { causticCells } = await import("./fx");
    const cells = causticCells();
    expect(cells).toEqual(causticCells());
    expect(cells).toHaveLength(48);
    const areas = cells.map((cell) => Math.abs(cell.reduce((sum, a, i) => {
      const b = cell[(i + 1) % cell.length]!;
      return sum + a.x * b.y - a.y * b.x;
    }, 0)) / 2);
    expect(areas.reduce((a, b) => a + b, 0)).toBeCloseTo(512 * 512, 3);
    expect(Math.max(...areas) / Math.min(...areas)).toBeGreaterThan(2);
    expect(cells.every((cell) => cell.length >= 3 && cell.every((p) => Number.isFinite(p.x + p.y)))).toBe(true);
  });
});

it("prepaints caustic masks once and creates no new gradients while drawing", () => {
  const { renderer } = canvasRecorder();
  const gradients: ReturnType<typeof vi.spyOn>[] = [];
  vi.stubGlobal("document", { createElement: () => {
    const { canvas, ctx } = canvasRecorder();
    ctx.createPattern = () => ({} as CanvasPattern);
    gradients.push(vi.spyOn(ctx, "createLinearGradient"), vi.spyOn(ctx, "createRadialGradient"));
    return canvas;
  } });
  renderer.resize(1280, 800, 2);
  const before = gradients.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
  expect(before).toBeGreaterThan(2);
  for (let i = 0; i < 100; i++) renderer.draw(scene, 1 / 60);
  expect(gradients.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(before);
});
