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
  const circles: number[][] = [];
  const ellipses: number[][] = [];
  const transforms: number[][] = [];
  const translations: number[][] = [];
  const images: number[][] = [];
  const imagePaints: { image: CanvasImageSource; alpha: number; args: number[] }[] = [];
  const curves: number[][] = [];
  const scales: number[][] = [];
  const moves: number[][] = [];
  const gradients: { radii: number[]; stops: [number, string][] }[] = [];
  const noop = () => {};
  const target = {
    shadowBlur: 0,
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    clip: noop,
    beginPath() { currentArc = undefined; },
    stroke() { paints.push({ blur: this.shadowBlur, style: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth, arc: currentArc }); },
    fillRect() { fills.push({ color: this.fillStyle, blend: this.globalCompositeOperation, alpha: this.globalAlpha }); },
    fill() { paints.push({ blur: this.shadowBlur }); },
    fillText(text: string) { paints.push({ blur: this.shadowBlur, text, font: this.font, style: this.fillStyle, alpha: this.globalAlpha, width: this.lineWidth }); },
    arc(...values: number[]) { arcs.push(values[2]!); circles.push(values); currentArc = values; },
    ellipse(...values: number[]) { ellipses.push(values); },
    setTransform(...values: number[]) { transforms.push(values); },
    translate(...values: number[]) { translations.push(values); },
    quadraticCurveTo(...values: number[]) { curves.push(values); },
    moveTo(...values: number[]) { moves.push(values); },
    scale(...values: number[]) { scales.push(values); },
    drawImage(image: CanvasImageSource, ...values: number[]) { images.push(values); imagePaints.push({ image, alpha: this.globalAlpha, args: values }); },
    createRadialGradient: (...radii: number[]) => {
      const stops: [number, string][] = [];
      gradients.push({ radii, stops });
      return { addColorStop: (offset: number, color: string) => stops.push([offset, color]) };
    },
    createLinearGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
  };
  const ctx = new Proxy(target, { get: (object, key) => Reflect.get(object, key) ?? noop }) as unknown as CanvasRenderingContext2D;
  const canvas = { getContext: () => ctx, style: {} } as unknown as HTMLCanvasElement;
  return { canvas, ctx, paints, fills, arcs, circles, ellipses, transforms, translations, images, imagePaints, curves, scales, moves, gradients, renderer: new Renderer(canvas) };
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
    const { seaLight } = await import("./render");
    const seaTint = (timeOfDay?: number) => seaLight({ biome: "reef", sea: "clear", timeOfDay });
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
    const { seaLight } = await import("./render");
    const seaTint = (timeOfDay?: number) => seaLight({ biome: "reef", sea: "clear", timeOfDay });
    for (const phase of [0.25, 0.75]) {
      const { renderer, fills } = canvasRecorder();
      renderer.draw({ ...scene, timeOfDay: phase }, 0);
      const overlay = fills.find((fill) => fill.color === seaTint(phase).tint);
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

describe("trap presentation", () => {
  it("fills the re-arm arc from empty to ready and clamps invalid reset durations", async () => {
    const { cooldownArcFraction } = await import("./fx");
    expect(cooldownArcFraction(6, 6)).toBe(0);
    expect(cooldownArcFraction(3, 6)).toBe(0.5);
    expect(cooldownArcFraction(0, 6)).toBe(1);
    expect(cooldownArcFraction(8, 6)).toBe(0);
    expect(cooldownArcFraction(-1, 6)).toBe(1);
    expect(cooldownArcFraction(1, 0)).toBe(1);
  });

  async function setup(reduced = false) {
    vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
    vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
    const { World } = await import("./world");
    const { cloneStats } = await import("./stats");
    const { createRng } = await import("./rng");
    const stats = cloneStats(BASE_STATS);
    stats.startFish = 0;
    stats.rigging.resetSeconds = 6;
    const world = new World(stats, createRng(1), 1280, 800);
    world.traps = [{ id: 1, x: 300, y: 250, radius: 42, cooldown: 3, partner: null, age: 2 }];
    return { ...canvasRecorder(), world, stats };
  }

  it("draws a brass half arc on a cooling trap, and keeps its sprite cached", async () => {
    const { renderer, world, stats, paints, images } = await setup();
    renderer.draw({ ...scene, world, stats }, 0);
    const arc = paints.find(p => p.style === "#c69b52" && p.arc);
    expect(arc?.arc?.[2]).toBe(42);
    expect(arc?.arc?.[4]! - arc?.arc?.[3]!).toBeCloseTo(Math.PI);
    expect(images).toHaveLength(1);
    renderer.draw({ ...scene, world, stats }, 0);
    expect(images).toHaveLength(2);
  });

  it("cinches a snapping trap and returns to its radius without changing simulation state", async () => {
    const { renderer, world, stats, images } = await setup();
    renderer.onEvent({ type: "trap-snap", trapId: 1, x: 300, y: 250, hits: 1 });
    const before = structuredClone(world.traps);
    renderer.draw({ ...scene, world, stats }, 0.1);
    const cinched = images[0]![2]!;
    images.length = 0;
    renderer.draw({ ...scene, world, stats }, 0.4);
    expect(images[0]![2]).toBeGreaterThan(cinched);
    expect(world.traps).toEqual(before);
  });

  it("throws new nets from the boat, but lands them immediately with reduced motion", async () => {
    for (const reduced of [false, true]) {
      const { renderer, world, stats, images } = await setup(reduced);
      world.traps[0]!.age = 0;
      renderer.draw({ ...scene, world, stats }, 0);
      const image = images[0]!;
      const center = image[0]! + image[2]! / 2;
      expect(center).toBe(reduced ? 300 : 640);
    }
  });

  it("briefly reveals surviving fish inside a snap in full colour", async () => {
    const { renderer, world, stats, images } = await setup();
    world.spawn("normal", { at: { x: 300, y: 250 } });
    world.fish[0]!.age = 2;
    renderer.onEvent({ type: "trap-snap", trapId: 1, x: 300, y: 250, hits: 1 });
    renderer.draw({ ...scene, world, stats }, 0.01);
    expect(images.length).toBe(3); // Silhouette, full-colour flash, trap.
    images.length = 0;
    renderer.draw({ ...scene, world, stats }, 0.4);
    expect(images.length).toBe(2);
  });
});

describe("seine, bait and snag presentation", () => {
  it("sags along a quadratic with exact endpoints, including a zero-length rope", async () => {
    const { ropeSagPoint } = await import("./fx");
    const a = { x: 20, y: 30 }, b = { x: 220, y: 70 };
    expect(ropeSagPoint(a, b, 0)).toEqual(a);
    expect(ropeSagPoint(a, b, 1)).toEqual(b);
    expect(ropeSagPoint(a, b, 0.5).y).toBeGreaterThan(50);
    expect(ropeSagPoint(a, b, 0.5).y - 50).toBeLessThanOrEqual(9);
    expect(ropeSagPoint(a, a, 0.5)).toEqual(a);
  });

  it("draws each partner rope once and bait only around armed nets", async () => {
    vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
    const { World } = await import("./world");
    const { cloneStats } = await import("./stats");
    const { createRng } = await import("./rng");
    const stats = cloneStats(BASE_STATS);
    stats.startFish = 0;
    stats.rigging.baitPull = 15;
    stats.rigging.seine = true;
    const world = new World(stats, createRng(1), 1280, 800);
    world.traps = [
      { id: 1, x: 300, y: 250, radius: 42, cooldown: 0, partner: 1, age: 2 },
      { id: 2, x: 500, y: 250, radius: 42, cooldown: 3, partner: 0, age: 2 },
    ];
    const { renderer, curves, paints } = canvasRecorder();
    renderer.draw({ ...scene, world, stats }, 0);
    expect(curves.filter(curve => curve[2] === 500 && curve[3] === 250)).toHaveLength(1);
    expect(paints.filter(p => p.style?.startsWith("rgba(230, 226, 191,") && p.arc)).toHaveLength(2);
  });

  it("wraps and tugs a held chest, then removes the wrap on release", async () => {
    vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
    const { World } = await import("./world");
    const { createRng } = await import("./rng");
    const world = new World({ ...BASE_STATS, startFish: 0 }, createRng(1), 1280, 800);
    world.chest = { x: 300, y: 250, vx: 0, vy: 0, hp: 10, maxHp: 10, age: 2, hitFlash: 0, snagged: true, snagLeft: 4 };
    const { renderer, paints, translations } = canvasRecorder();
    renderer.onEvent({ type: "snag", x: 300, y: 250 });
    renderer.draw({ ...scene, world }, 0.04);
    expect(paints.some(p => p.style === "#c1aa7d")).toBe(true);
    expect(translations.some(p => p[0] !== 300 && Math.abs(p[0]! - 300) < 3)).toBe(true);
    world.chest.snagLeft = 0;
    paints.length = 0;
    renderer.draw({ ...scene, world }, 0.01);
    expect(paints.some(p => p.style === "#c1aa7d")).toBe(false);
  });
});

describe("boat tool presentation", () => {
  it("fades chum over its configured lifetime and handles locked or expired clouds", async () => {
    const { chumCloudAlpha } = await import("./fx");
    expect(chumCloudAlpha(0, 6)).toBe(1);
    expect(chumCloudAlpha(-1, 6)).toBe(1);
    expect(chumCloudAlpha(3, 6)).toBeGreaterThan(0);
    expect(chumCloudAlpha(3, 6)).toBeLessThan(1);
    expect(chumCloudAlpha(6, 6)).toBe(0);
    expect(chumCloudAlpha(8, 6)).toBe(0);
    expect(chumCloudAlpha(0, 0)).toBe(0);
  });

  it("maps unlocked lantern light to its exact lure radius, retaining the ordinary night lamp", async () => {
    const { lanternLightRadius } = await import("./fx");
    expect(lanternLightRadius(0, 0)).toBe(0);
    expect(lanternLightRadius(0, 1)).toBe(125);
    expect(lanternLightRadius(70, 0)).toBe(70);
    expect(lanternLightRadius(210, 1)).toBe(210);
    expect(lanternLightRadius(-1, 0)).toBe(0);
  });

  it("draws and expires a bounded chum cloud without adding capture particles", async () => {
    vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
    const { World } = await import("./world");
    const { cloneStats } = await import("./stats");
    const { createRng } = await import("./rng");
    const stats = cloneStats(BASE_STATS);
    stats.startFish = 0;
    stats.boat.chum = true;
    stats.boat.chumSeconds = 2;
    const world = new World(stats, createRng(1), 1280, 800);
    const { renderer, images, arcs } = canvasRecorder();
    expect(world.chum()).toBe(true);
    for (const event of world.drainEvents()) renderer.onEvent(event);
    renderer.draw({ ...scene, world, stats }, 1);
    expect(images).toHaveLength(4);
    expect(images.every(i => i[2]! > stats.boat.chumRadius * 0.8)).toBe(true);
    expect(arcs.filter(r => r === 2.5)).toHaveLength(0);
    images.length = 0;
    renderer.draw({ ...scene, world, stats }, 2);
    expect(images).toHaveLength(0);
  });

  it("scales the cached lantern light and uses the world's endless phase by default", async () => {
    vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
    const { World } = await import("./world");
    const { cloneStats } = await import("./stats");
    const { createRng } = await import("./rng");
    const stats = cloneStats(BASE_STATS);
    stats.startFish = 0;
    stats.boat.lanternRadius = 210;
    const world = new World(stats, createRng(1), 1280, 800, { round: 1, final: false, endless: true });
    world.elapsed = 120;
    const { renderer, images, fills } = canvasRecorder();
    renderer.resize(1280, 800, 1);
    renderer.draw({ ...scene, world, stats }, 0);
    expect(images.some(i => i[0] === -210 && i[2] === 420)).toBe(true);
    expect(fills.some(f => f.blend === "multiply" && f.alpha > 0.4)).toBe(true);
  });
});

it("does not revive a trap reveal after a delayed first frame", async () => {
  vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
  const { World } = await import("./world");
  const { createRng } = await import("./rng");
  const world = new World({ ...BASE_STATS, startFish: 0 }, createRng(1), 1280, 800);
  world.traps = [{ id: 1, x: 300, y: 250, radius: 42, cooldown: 3, partner: null, age: 2 }];
  world.spawn("normal", { at: { x: 300, y: 250 } });
  world.fish[0]!.age = 2;
  const { renderer, images } = canvasRecorder();
  renderer.onEvent({ type: "trap-snap", trapId: 1, x: 300, y: 250, hits: 1 });
  renderer.draw({ ...scene, world }, 0.4);
  expect(images).toHaveLength(2); // Only the silhouette and trap remain.
});

it("keeps left-swimming trap reveals belly-down over their silhouette", async () => {
  vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
  const { World } = await import("./world");
  const { createRng } = await import("./rng");
  const world = new World({ ...BASE_STATS, startFish: 0 }, createRng(1), 1280, 800);
  world.traps = [{ id: 1, x: 300, y: 250, radius: 42, cooldown: 3, partner: null, age: 2 }];
  world.spawn("normal", { at: { x: 300, y: 250 } });
  world.fish[0]!.heading = Math.PI;
  const { renderer, scales } = canvasRecorder();
  renderer.onEvent({ type: "trap-snap", trapId: 1, x: 300, y: 250, hits: 1 });
  renderer.draw({ ...scene, world }, 0.01);
  expect(scales).toContainEqual([1, -1]);
});

it("keeps an active chum cloud through resize and recentres it on the boat", async () => {
  vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
  const { World } = await import("./world");
  const { cloneStats } = await import("./stats");
  const { createRng } = await import("./rng");
  const stats = cloneStats(BASE_STATS);
  stats.startFish = 0;
  stats.boat.chum = true;
  const world = new World(stats, createRng(1), 1280, 800);
  const { renderer, images } = canvasRecorder();
  renderer.resize(1280, 800, 1);
  world.chum();
  for (const event of world.drainEvents()) renderer.onEvent(event);
  renderer.draw({ ...scene, world, stats }, 0.8);
  renderer.resize(640, 400, 1);
  world.resize(640, 400);
  images.length = 0;
  renderer.draw({ ...scene, world, stats }, 0);
  const cloud = images.filter(i => i.length === 4);
  expect(cloud).toHaveLength(4);
  const centers = cloud.map(i => i[0]! + i[2]! / 2);
  expect(Math.min(...centers)).toBeLessThan(320);
  expect(Math.max(...centers)).toBeGreaterThan(320);
  expect(Math.max(...centers)).toBeLessThan(640);
});

it("caches a readable trap rope with a brown outline and larger striped buoys", async () => {
  const cached: ReturnType<typeof canvasRecorder>[] = [];
  vi.stubGlobal("document", { createElement: () => {
    const recorder = canvasRecorder(); cached.push(recorder); return recorder.canvas;
  } });
  const { World } = await import("./world");
  const { createRng } = await import("./rng");
  const world = new World({ ...BASE_STATS, startFish: 0 }, createRng(1), 1280, 800);
  world.traps = [{ id: 1, x: 300, y: 250, radius: 42, cooldown: 3, partner: null, age: 2 }];
  const { renderer } = canvasRecorder();
  renderer.draw({ ...scene, world }, 0);
  const sprite = cached.find(r => r.ellipses.length === 4)!;
  expect(sprite).toBeDefined();
  const rope = sprite.paints.find(p => p.style === "#ac956c")!;
  const outline = sprite.paints.find(p => p.style === "#514031")!;
  expect(rope.width).toBeCloseTo(3);
  expect(outline.width! - rope.width!).toBeCloseTo(1.6);
  expect(sprite.paints.some(p => p.style === "rgba(223, 231, 205, 0.18)")).toBe(true);
  expect(sprite.ellipses.every(e => e[2]! >= 4.8 && e[3]! >= 3.2)).toBe(true);
  const count = cached.length;
  renderer.draw({ ...scene, world }, 0);
  expect(cached).toHaveLength(count);
});

it("uses one static fading chum ring and no moving bits with reduced motion", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
  const { World } = await import("./world");
  const { cloneStats } = await import("./stats");
  const { createRng } = await import("./rng");
  const stats = cloneStats(BASE_STATS);
  stats.startFish = 0;
  stats.boat.chum = true;
  const world = new World(stats, createRng(1), 1280, 800);
  const { renderer, ctx, images, arcs, paints } = canvasRecorder();
  const opacity: number[] = [];
  const drawImage = vi.spyOn(ctx, "drawImage").mockImplementation((_image, ..._args) => {
    opacity.push(ctx.globalAlpha);
  });
  world.chum();
  for (const event of world.drainEvents()) renderer.onEvent(event);
  renderer.draw({ ...scene, world, stats }, 0.2);
  expect(drawImage).toHaveBeenCalledTimes(1);
  const bounds = drawImage.mock.calls[0]!.slice(1);
  expect(bounds).toEqual([640 - stats.boat.chumRadius, 400 - stats.boat.chumRadius, stats.boat.chumRadius * 2, stats.boat.chumRadius * 2]);
  renderer.draw({ ...scene, world, stats }, 0.6);
  expect(drawImage).toHaveBeenCalledTimes(2);
  expect(drawImage.mock.calls[1]!.slice(1)).toEqual(bounds);
  expect(opacity[1]).toBeLessThan(opacity[0]!);
  expect(arcs).toHaveLength(0);
  expect(paints.some(p => p.style?.startsWith("rgba(237, 226, 190,"))).toBe(false);
  expect(images).toHaveLength(0); // The image spy records the single submission instead.
});

it("keeps chum plumes cached and drifts only a few bits inward while the current is active", async () => {
  const createElement = vi.fn(() => canvasRecorder().canvas);
  vi.stubGlobal("document", { createElement });
  const { World } = await import("./world");
  const { cloneStats } = await import("./stats");
  const { createRng } = await import("./rng");
  const stats = cloneStats(BASE_STATS);
  stats.startFish = 0;
  stats.boat.chum = true;
  const world = new World(stats, createRng(1), 1280, 800);
  const { renderer, images, circles } = canvasRecorder();
  world.chum();
  for (const event of world.drainEvents()) renderer.onEvent(event);
  renderer.draw({ ...scene, world, stats }, 0.8);
  const created = createElement.mock.calls.length;
  const bits = circles.filter(c => c[2] === 1.2);
  expect(bits).toHaveLength(5);
  expect(images).toHaveLength(4);
  for (const plume of images) {
    const radius = plume[2]! / 2;
    const distance = Math.hypot(plume[0]! + radius - 640, plume[1]! + radius - 400);
    expect(distance + radius).toBeLessThanOrEqual(stats.boat.chumRadius + 1e-8);
  }
  images.length = circles.length = 0;
  renderer.draw({ ...scene, world, stats }, 0.1);
  expect(createElement).toHaveBeenCalledTimes(created);
  const moved = circles.filter(c => c[2] === 1.2);
  expect(moved).toHaveLength(5);
  for (const [i, bit] of moved.entries()) {
    expect(Math.hypot(bit[0]! - 640, bit[1]! - 400)).toBeLessThan(Math.hypot(bits[i]![0]! - 640, bits[i]![1]! - 400));
  }
  vi.spyOn(world, "chumActive", "get").mockReturnValue(false);
  circles.length = 0;
  renderer.draw({ ...scene, world, stats }, 0.1);
  expect(circles.filter(c => c[2] === 1.2)).toHaveLength(0);
});


describe("sea lighting and visibility", () => {
  it("preserves the clear reef day and night and caps every sea's darkness and contrast", async () => {
    const { seaLight } = await import("./render");
    expect(seaLight({ biome: "reef", sea: "clear" })).toMatchObject({ alpha: 0, night: 0, lantern: 0 });
    expect(seaLight({ biome: "reef", sea: "clear", timeOfDay: 0.5 })).toEqual({ tint: "rgb(65, 84, 157)", alpha: 0.46, night: 1, lantern: 1 });
    // Measured average RGB of the three shipped tiles, independent of the lighting implementation.
    const averages = { reef: [42, 127, 149], trench: [64, 102, 148], graveyard: [66, 131, 127] };
    const luminance = (rgb: number[]) => rgb.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    for (const biome of ["reef", "trench", "graveyard"] as const) {
      for (const sea of ["clear", "storm", "fog", "bloom"] as const) {
        for (let i = 0; i <= 100; i++) {
          const light = seaLight({ biome, sea, timeOfDay: i / 100 });
          expect(light.alpha).toBeLessThanOrEqual(0.46);
          const tint = light.tint.match(/[\d.]+/g)!.map(Number);
          const rgb = averages[biome].map((v, j) => v * (1 - light.alpha + light.alpha * tint[j]! / 255));
          expect((luminance(rgb) + 0.05) / (luminance([16, 31, 44]) + 0.05), `${biome}/${sea}/${i}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("uses the nearer of boat and net for fog visibility, including lantern upgrades", async () => {
    const { fogSilhouetteAlpha } = await import("./render");
    expect(fogSilhouetteAlpha({ x: 700, y: 0 }, { x: 0, y: 0 }, null, BASE_STATS)).toBe(0.15);
    expect(fogSilhouetteAlpha({ x: 700, y: 0 }, { x: 0, y: 0 }, { x: 700, y: 0 }, BASE_STATS)).toBe(1);
    expect(fogSilhouetteAlpha({ x: 100, y: 0 }, { x: 0, y: 0 }, null, BASE_STATS)).toBe(1);
    const stats = { ...BASE_STATS, boat: { ...BASE_STATS.boat, lanternRadius: 210 } };
    expect(fogSilhouetteAlpha({ x: 300, y: 0 }, { x: 0, y: 0 }, null, stats)).toBe(1);
  });

  it("crossfades texture weights and light continuously at biome boundaries", async () => {
    const { biomeLayers, blendSeaLight, seaLight } = await import("./render");
    expect(biomeLayers()).toEqual([{ biome: "reef", alpha: 1 }]);
    expect(biomeLayers({ biome: "trench", next: "graveyard", blend: 0.5 })).toEqual([{ biome: "trench", alpha: 1 }, { biome: "graveyard", alpha: 0.5 }]);
    expect(biomeLayers({ biome: "trench", next: "graveyard", blend: 1 })).toEqual([{ biome: "graveyard", alpha: 1 }]);
    const a = seaLight({ biome: "trench", sea: "storm", timeOfDay: 0.5 });
    const b = seaLight({ biome: "graveyard", sea: "storm", timeOfDay: 0.5 });
    expect(blendSeaLight(a, b, 0)).toEqual(a);
    expect(blendSeaLight(a, b, 1)).toEqual(b);
    expect(blendSeaLight(a, b, 0.5).alpha).toBeLessThanOrEqual(0.46);
  });

  it.each(["storm", "fog", "bloom"] as const)("reuses both cached %s layers without repainting them", async (state) => {
    const { weatherLayers } = await import("./fx");
    const created: HTMLCanvasElement[] = [];
    vi.stubGlobal("document", { createElement: () => { const canvas = canvasRecorder().canvas; created.push(canvas); return canvas; } });
    const layers = weatherLayers(state);
    expect(layers).toHaveLength(2);
    expect(layers[0]).not.toBe(layers[1]);
    const allocations = created.length;
    for (let i = 0; i < 100; i++) expect(weatherLayers(state)).toBe(layers);
    expect(created).toHaveLength(allocations);
  });
});


describe("weather rendering integration", () => {
  async function setup(sea: "clear" | "fog" = "clear") {
    const { World } = await import("./world");
    const { createRng } = await import("./rng");
    const recorder = canvasRecorder();
    const caches: ReturnType<typeof canvasRecorder>[] = [];
    vi.stubGlobal("document", { createElement: () => { const cache = canvasRecorder(); caches.push(cache); return cache.canvas; } });
    const world = new World({ ...BASE_STATS, startFish: 0 }, createRng(31), 1280, 800, { round: 24, final: false, sea });
    return { ...recorder, world, caches };
  }

  it("fades only silhouettes in fog, preserves rims and draws the lens and chest at full strength", async () => {
    const { renderer, world, imagePaints } = await setup("fog");
    world.spawn("normal", { at: { x: 1100, y: 650 } });
    world.spawn("normal", { at: { x: 200, y: 200 } });
    for (const fish of world.fish) fish.age = 2;
    world.chest = { x: 1000, y: 600, vx: 0, vy: 0, hp: 3, maxHp: 6, age: 2, hitFlash: 0 };
    renderer.draw({ ...scene, world, pointer: { x: 200, y: 200 } }, 0);
    const fishImages = imagePaints.filter(p => p.args[2] === FISH_SPECS.normal.def.size * 1.1);
    expect(fishImages.map(p => p.alpha)).toEqual([0.15, 1, 1]); // Far silhouette, net silhouette, coloured lens.
    expect(imagePaints.filter(p => p.alpha === 0.55)).toHaveLength(2); // The thin cached rims.
    expect(imagePaints.at(-1)?.alpha).toBe(1); // Chest is above the fog pass.
  });

  it("caches both texture canvases through a changing transition and discards them only on resize", async () => {
    const { renderer, caches, imagePaints } = await setup();
    renderer.resize(640, 480, 1);
    const biome = { biome: "trench", next: "graveyard", blend: 0.25 } as const;
    renderer.draw({ ...scene, biome, timeOfDay: 0.5 }, 0);
    const first = imagePaints.filter(p => p.args.length === 2).slice(-2);
    expect(first.map(p => p.alpha)).toEqual([1, 0.25]);
    const count = caches.length;
    imagePaints.length = 0;
    renderer.draw({ ...scene, biome: { ...biome, blend: 0.75 }, timeOfDay: 0.5 }, 0);
    expect(caches).toHaveLength(count);
    const second = imagePaints.filter(p => p.args.length === 2).slice(-2);
    expect(second.map(p => p.image)).toEqual(first.map(p => p.image));
    expect(second.map(p => p.alpha)).toEqual([1, 0.75]);
    renderer.resize(800, 600, 1);
    renderer.draw({ ...scene, biome }, 0);
    expect(caches.length).toBeGreaterThan(count);
  });

  it("shares soft, infrequent lightning timing and suppresses flashes with reduced motion", async () => {
    const { weatherLightning } = await import("./fx");
    expect(weatherLightning(11)).toBe(0);
    expect(weatherLightning(11.325)).toBeCloseTo(0.1);
    expect(weatherLightning(25.325)).toBeCloseTo(0.1);
    expect(weatherLightning(11.325, true)).toBe(0);
    expect(weatherLightning(12)).toBe(0);
    expect(weatherLightning(19.325)).toBe(0);
  });
});


it("starts each wind ripple as a separate subpath instead of joining distant arcs", () => {
  const { renderer, ellipses, moves } = canvasRecorder();
  vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
  renderer.resize(640, 480, 1);
  renderer.draw({ ...scene, sea: "storm" }, 0.1);
  const ripples = ellipses.filter(e => e[2] === 7 && e[3] === 1.6);
  expect(ripples).toHaveLength(28);
  for (const e of ripples) {
    const start = [e[0]! + Math.cos(e[4]!) * 7, e[1]! + Math.sin(e[4]!) * 7];
    expect(moves.some(m => Math.hypot(m[0]! - start[0]!, m[1]! - start[1]!) < 0.001)).toBe(true);
  }
});


it.each(["storm", "fog", "bloom"] as const)("holds both %s layers still with reduced motion and keeps their pattern cache", (sea) => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("document", { createElement: () => canvasRecorder().canvas });
  const { renderer, ctx, translations, ellipses } = canvasRecorder();
  const pattern = vi.spyOn(ctx, "createPattern").mockReturnValue({} as CanvasPattern);
  renderer.resize(640, 480, 1);
  pattern.mockClear();
  translations.length = 0;
  renderer.draw({ ...scene, sea }, 0.1);
  const first = [...translations];
  expect(pattern).toHaveBeenCalledTimes(2);
  translations.length = 0;
  renderer.draw({ ...scene, sea }, 1);
  expect(translations).toEqual(first);
  expect(pattern).toHaveBeenCalledTimes(2);
  if (sea === "storm") expect(ellipses.filter(e => e[2] === 7 && e[3] === 1.6)).toHaveLength(0);
});


describe("weather visual review regressions", () => {
  it("draws two clearly visible rain depths and fading downwind whitecaps without frame allocations", async () => {
    const caches: ReturnType<typeof canvasRecorder>[] = [];
    vi.stubGlobal("document", { createElement: () => { const cache = canvasRecorder(); caches.push(cache); return cache.canvas; } });
    const { renderer, ctx } = canvasRecorder();
    renderer.resize(1280, 800, 1);
    const patterns = [{}, {}] as CanvasPattern[];
    let index = 0;
    vi.spyOn(ctx, "createPattern").mockImplementation(() => patterns[index++ % 2]!);
    const paints: number[] = [];
    vi.spyOn(ctx, "fillRect").mockImplementation(() => { if (patterns.includes(ctx.fillStyle as CanvasPattern)) paints.push(ctx.globalAlpha); });
    renderer.draw({ ...scene, sea: "storm" }, 0.5);
    expect(paints).toHaveLength(2);
    for (const alpha of paints) { expect(alpha).toBeGreaterThanOrEqual(0.25); expect(alpha).toBeLessThanOrEqual(0.35); }
    const count = caches.length;
    renderer.draw({ ...scene, sea: "storm" }, 0.5);
    expect(caches).toHaveLength(count);
    const { whitecapPose } = await import("./fx");
    const a = whitecapPose(0, 0.4, { x: 30, y: 10 }, 1280, 800);
    const b = whitecapPose(0, 0.5, { x: 30, y: 10 }, 1280, 800);
    expect(b.x - a.x).toBeCloseTo(3);
    expect(b.y - a.y).toBeCloseTo(1);
    expect(a.alpha).toBeGreaterThan(0);
    expect(whitecapPose(0, 0, { x: 30, y: 10 }, 1280, 800).alpha).toBe(0);
  });

  it("feathers the fog itself across 140 pixels with a reusable radial mask, without a circular clip", async () => {
    const { paintFogPool } = await import("./fx");
    const caches: ReturnType<typeof canvasRecorder>[] = [];
    vi.stubGlobal("document", { createElement: () => { const cache = canvasRecorder(); caches.push(cache); return cache.canvas; } });
    const mask = paintFogPool(200);
    expect(mask.width).toBe(680);
    const gradient = caches[0]!.gradients[0]!;
    expect(gradient.radii).toEqual([340, 340, 200, 340, 340, 340]);
    expect(gradient.stops).toEqual([[0, "rgba(0, 0, 0, 1)"], [1, "rgba(0, 0, 0, 0)"]]);
    const { renderer, ctx } = canvasRecorder();
    renderer.resize(1280, 800, 1);
    vi.spyOn(ctx, "createPattern").mockReturnValue({} as CanvasPattern);
    const clip = vi.spyOn(ctx, "clip");
    renderer.draw({ ...scene, sea: "fog", pointer: { x: 300, y: 300 } }, 0.1);
    expect(clip).not.toHaveBeenCalled();
    const count = caches.length;
    const submissions = caches.flatMap(c => c.imagePaints).filter(p => p.args.length === 4);
    expect(submissions.length).toBeGreaterThanOrEqual(2); // Boat and net erase the same cached feather.
    renderer.draw({ ...scene, sea: "fog", pointer: { x: 400, y: 300 } }, 0.1);
    expect(caches).toHaveLength(count);
  });

  it("makes a daytime storm darker than clear water while retaining every biome's contrast", async () => {
    const { seaLight } = await import("./render");
    for (const biome of ["reef", "trench", "graveyard"] as const) {
      const light = seaLight({ biome, sea: "storm", timeOfDay: 0 });
      const tint = light.tint.match(/[\d.]+/g)!.map(Number);
      const transmission = tint.map(v => 1 - light.alpha + light.alpha * v / 255);
      expect(transmission[1]).toBeLessThan(biome === "trench" ? 0.85 : 0.8);
      expect(transmission[2]).toBeGreaterThan(transmission[0]!);
    }
  });
});

it("drifts fog continuously across a tile wrap even when the layer is rotated and scaled", () => {
  const pattern = {} as CanvasPattern;
  const samples: number[] = [];
  vi.stubGlobal("document", { createElement: () => {
    const { canvas, ctx } = canvasRecorder();
    // Minimal affine Canvas platform: sample a periodic pigment at one fixed screen pixel.
    let m = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    Object.assign(ctx, {
      save() { stack.push([...m]); }, restore() { m = stack.pop()!; },
      setTransform(...values: number[]) { m = values; },
      translate(x: number, y: number) { m[4]! += m[0]! * x + m[2]! * y; m[5]! += m[1]! * x + m[3]! * y; },
      scale(x: number, y: number) { m[0]! *= x; m[1]! *= x; m[2]! *= y; m[3]! *= y; },
      rotate(angle: number) {
        const [a, b, c, d] = m as [number, number, number, number];
        const cos = Math.cos(angle), sin = Math.sin(angle);
        m[0] = a * cos + c * sin; m[1] = b * cos + d * sin;
        m[2] = c * cos - a * sin; m[3] = d * cos - b * sin;
      },
      fillRect() {
        if (ctx.fillStyle !== pattern) return;
        const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
        const x = 20 - e, y = 30 - f, det = a * d - b * c;
        samples.push(Math.cos((d * x - c * y) / det * Math.PI * 2 / 512) + Math.sin((a * y - b * x) / det * Math.PI * 2 / 512));
      },
    });
    return canvas;
  } });
  const { renderer, ctx } = canvasRecorder();
  renderer.resize(1280, 800, 1);
  vi.spyOn(ctx, "createPattern").mockReturnValue(pattern);
  renderer.draw({ ...scene, sea: "fog" }, 512 / 7.5 - 0.0001);
  const before = [...samples]; samples.length = 0;
  renderer.draw({ ...scene, sea: "fog" }, 0.0002);
  expect(before).toHaveLength(2); expect(samples).toHaveLength(2);
  for (let i = 0; i < 2; i++) expect(Math.abs(samples[i]! - before[i]!)).toBeLessThan(0.001);
});
