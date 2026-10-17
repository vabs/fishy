import { afterEach, describe, expect, it, vi } from "vitest";
import { FISH_SPECS } from "./fish";
import { fishColors } from "./palette";
import { Renderer } from "./render";
import { BASE_STATS } from "./stats";
import { createViewport } from "./viewport";
import type { FxEvent } from "./world";

/** Records canvas submissions; browser benchmarks cover the actual raster cost. */
function canvasRecorder() {
  const paints: { blur: number; text?: string }[] = [];
  const arcs: number[] = [];
  const transforms: number[][] = [];
  const translations: number[][] = [];
  const images: number[][] = [];
  const noop = () => {};
  const target = {
    shadowBlur: 0,
    stroke() { paints.push({ blur: this.shadowBlur }); },
    fill() { paints.push({ blur: this.shadowBlur }); },
    fillText(text: string) { paints.push({ blur: this.shadowBlur, text }); },
    arc(_x: number, _y: number, radius: number) { arcs.push(radius); },
    setTransform(...values: number[]) { transforms.push(values); },
    translate(...values: number[]) { translations.push(values); },
    drawImage(_image: CanvasImageSource, ...values: number[]) { images.push(values); },
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
  const ctx = new Proxy(target, { get: (object, key) => Reflect.get(object, key) ?? noop }) as unknown as CanvasRenderingContext2D;
  const canvas = { getContext: () => ctx, style: {} } as unknown as HTMLCanvasElement;
  return { canvas, ctx, paints, arcs, transforms, translations, images, renderer: new Renderer(canvas) };
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
    expect(arcs.filter((r) => r === 2.5).length).toBeLessThanOrEqual(1200);
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
