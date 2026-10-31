import { loadArt, onArtReady } from "../src/game/art";
import { FISH_KINDS } from "../src/game/fish";
import { setPalette } from "../src/game/palette";
import { Renderer, type Scene } from "../src/game/render";
import { createRng } from "../src/game/rng";
import { BASE_STATS, cloneStats } from "../src/game/stats";
import { applyUpgrades, TECH_NODES } from "../src/game/tech";
import { createViewport, toWorldPoint } from "../src/game/viewport";
import { STEP, World, type Point } from "../src/game/world";

// Seeded scene, no save/audio/main wiring. ?still=1 is stable for visual comparisons.
// ?time=0.5&endless=1, ?palette=colorBlind, ?fish=300, ?title=1, ?live=1.
const query = new URLSearchParams(location.search);
const still = query.has("still");
const live = query.has("live");
const endless = query.has("endless");
const count = Math.min(endless ? 80 : 600, Math.max(16, Number(query.get("fish")) || 96));
const phase = query.has("time") ? Number(query.get("time")) : undefined;
if (query.get("palette") === "colorBlind") setPalette("colorBlind");
const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const renderer = new Renderer(canvas);
const stats = applyUpgrades(BASE_STATS, Object.fromEntries(TECH_NODES.map((n) => [n.id, n.maxLevel])));
stats.startFish = 0;
stats.roundSeconds = 3600;
stats.ability.uncommon.schoolMin = stats.ability.uncommon.schoolMax = 1;
stats.netRadius = 128;
const view = createViewport(innerWidth, innerHeight, 76, innerWidth < 500 ? 56 : 36);
renderer.resize(innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2), view);
const world = makeWorld(count, endless);
let pointer: Point = { x: view.worldWidth * 0.43, y: view.worldHeight * 0.48 };
// A handful of fish in the lens makes clipping, eyes and health legible in every screenshot.
for (let i = 0; i < 8; i++) {
  const fish = world.fish[i];
  if (!fish) continue;
  const angle = i * Math.PI / 4;
  fish.x = pointer.x + Math.cos(angle) * 82;
  fish.y = pointer.y + Math.sin(angle) * 82;
  fish.heading = angle + Math.PI / 2;
  fish.hp *= 0.65;
}
world.chest = { x: view.worldWidth * 0.7, y: view.worldHeight * 0.62, vx: 0, vy: 0, hp: 6, maxHp: 10, age: 2, hitFlash: 0 };
world.combo = 6;
const scene = (): Scene => {
  const rect = document.querySelector("#counter")!.getBoundingClientRect();
  return { world: query.has("title") ? null : world, pointer, stats, timeOfDay: phase, coinTarget: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
};
document.querySelector("#mode")!.textContent = endless ? "Endless · renderer review" : "Late round · renderer review";
const phaseName = phase === undefined ? "Endless sea" : ["Golden hour", "Dusk", "Night watch", "Dawn"][Math.floor(((phase % 1 + 1) % 1) * 4)]!;
document.querySelector("#clock")!.textContent = endless ? phaseName : "24.0s";
document.querySelector("#counter small")!.textContent = `Earnings · combo ×${world.comboMult.toFixed(1)}`;
const metrics = document.querySelector("#metrics")!;
let frames = 0, sum = 0;
let arrivals = 0;
let previous = performance.now();
let active = !still;
canvas.addEventListener("pointermove", (event) => { pointer = toWorldPoint(view, event); if (still) renderer.draw(scene(), 0); });
document.querySelector("#burst")!.addEventListener("click", () => {
  renderer.onEvent({ type: "tick", ...pointer, radius: stats.netRadius, hits: 12, crits: 2 });
  for (let i = 0; i < 12; i++) renderer.onEvent({
    type: "capture", kind: FISH_KINDS[i % 8]!, source: "net", x: pointer.x + Math.cos(i * 2.4) * 80,
    y: pointer.y + Math.sin(i * 2.4) * 80, value: i === 0 ? 2400 : 38, combo: i, golden: i === 0,
  });
  active = true;
});
document.querySelector("#bench")!.addEventListener("click", benchmark);
window.addEventListener("resize", () => location.reload());
onArtReady(() => { renderer.draw(scene(), 0); updateReady(); });
renderer.draw(scene(), 0);
updateReady();
requestAnimationFrame(frame);

function frame(now: number): void {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  if (live && active) {
    world.pointer = pointer;
    world.update(STEP);
    for (const event of world.drainEvents()) renderer.onEvent(event);
  }
  const start = performance.now();
  renderer.draw(scene(), active ? dt : 0);
  const ms = performance.now() - start;
  if (frames++ > 30) sum += ms;
  arrivals += renderer.drainCoinArrivals();
  if (frames % 120 === 0) {
    const average = sum / Math.max(1, frames - 31);
    metrics.textContent = `${world.fish.length} fish · draw ${average.toFixed(2)} ms · ${arrivals} coin arrivals`;
    console.info("Fishy renderer draw", { fish: world.fish.length, averageMs: average, dpr: devicePixelRatio, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches });
  }
  requestAnimationFrame(frame);
}

function makeWorld(population: number, sandbox: boolean): World {
  const w = new World(stats, createRng(230410), view.worldWidth, view.worldHeight, { round: 24, final: false, endless: sandbox });
  for (let i = 0; w.fish.length < population - 1 && i < population * 3; i++) w.spawn(FISH_KINDS[i % 8]);
  for (const fish of w.fish) fish.age = 2;
  w.spawnGolden({ x: view.worldWidth * 0.76, y: view.worldHeight * 0.3 });
  if (w.fish.at(-1)?.golden) w.fish.at(-1)!.age = 2;
  w.earned = 12480;
  w.caught.normal = 100;
  // Establish a real combo timestamp through a harmless Normal capture, not a private field.
  const normal = w.fish.find((fish) => fish.kind === "normal");
  if (normal) { w.capture(normal, "net"); w.update(STEP); w.drainEvents(); }
  for (const fish of w.fish) fish.age = 2;
  return w;
}

function updateReady(): void {
  const art = loadArt();
  document.body.dataset.ready = String(!!art.sea && !!art.boat);
  metrics.textContent = `${world.fish.length} fish · ${document.body.dataset.ready === "true" ? "Art ready" : "Loading art"} · seed 230410`;
}

/** Draw submission timings only; browser compositor/raster time is additional. */
async function benchmark(): Promise<void> {
  const bench = new World({ ...cloneStats(stats), startFish: 0 }, createRng(90210), view.worldWidth, view.worldHeight);
  for (let i = 0; bench.fish.length < 300; i++) bench.spawn(FISH_KINDS[i % 8]);
  for (const fish of bench.fish) fish.age = 2;
  const samples: number[] = [];
  for (let i = 0; i < 360; i++) {
    await new Promise(requestAnimationFrame);
    const start = performance.now();
    renderer.draw({ ...scene(), world: bench }, STEP);
    const ms = performance.now() - start;
    if (i >= 60) samples.push(ms);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const result = { fish: bench.fish.length, averageMs: samples.reduce((a, b) => a + b, 0) / samples.length, p95Ms: sorted[Math.floor(sorted.length * 0.95)], width: innerWidth, height: innerHeight, dpr: Math.min(devicePixelRatio || 1, 2) };
  console.info("Fishy renderer benchmark", result);
  metrics.textContent = `300 fish · avg ${result.averageMs.toFixed(2)} ms · p95 ${result.p95Ms!.toFixed(2)} ms`;
  document.body.dataset.benchmark = JSON.stringify(result);
}
