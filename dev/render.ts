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
// Tools: ?traps=4&seine=1&bait=1&chum=1&lantern=1; add &still=1 for a frozen pose.
// Additional still poses: &snap=1, &cast=1, &snag=1. Tool scenes animate the simulation.
const query = new URLSearchParams(location.search);
const still = query.has("still");
const enabled = (name: string): boolean => query.get(name) === "1";
const requestedTraps = Number(query.get("traps") ?? (enabled("seine") ? 2 : enabled("bait") || enabled("snag") ? 1 : 0));
const traps = Number.isFinite(requestedTraps) ? Math.min(4, Math.max(0, Math.floor(requestedTraps))) : 0;
const tools = traps > 0 || enabled("chum") || enabled("lantern");
const live = query.has("live") || tools;
const endless = query.has("endless");
const count = Math.min(endless ? 80 : 600, Math.max(16, Number(query.get("fish")) || 96));
const requestedPhase = query.has("time") ? Number(query.get("time")) : undefined;
const phase = requestedPhase !== undefined && Number.isFinite(requestedPhase) ? requestedPhase : undefined;
if (query.get("palette") === "colorBlind") setPalette("colorBlind");
const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const renderer = new Renderer(canvas);
const stats = applyUpgrades(BASE_STATS, Object.fromEntries(TECH_NODES.map((n) => [n.id, n.maxLevel])));
stats.startFish = 0;
stats.roundSeconds = 3600;
stats.ability.uncommon.schoolMin = stats.ability.uncommon.schoolMax = 1;
stats.netRadius = 128;
stats.rigging.count = traps;
stats.rigging.radius = 42;
stats.rigging.resetSeconds = 6;
stats.rigging.seine = enabled("seine");
stats.rigging.baitPull = enabled("bait") ? 45 : 0;
stats.rigging.snagSeconds = enabled("snag") ? 4 : 0;
stats.boat.chum = enabled("chum");
stats.boat.lanternRadius = enabled("lantern") ? 210 : 0;
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
// The review owns its fixture; gameplay state and save data are never touched.
for (const [i, trap] of world.traps.entries()) {
  trap.age = still && !enabled("cast") ? 2 : enabled("cast") && still ? 0.3 : 0;
  trap.cooldown = still && !enabled("cast") && i % 2 ? stats.rigging.resetSeconds * 0.5 : 0;
  for (let j = 0; j < 2; j++) {
    const fish = world.fish[8 + i * 2 + j];
    if (!fish) continue;
    fish.x = trap.x + (j ? 14 : -12); fish.y = trap.y + (j ? 8 : -6);
    fish.heading = j ? 0.3 : -0.5; fish.age = 2;
  }
}
if (enabled("snag") && world.traps[0]) {
  world.chest.x = world.traps[0].x + 12;
  world.chest.y = world.traps[0].y;
  world.chest.snagged = true;
  world.chest.snagLeft = 4;
}
if (stats.boat.chum) {
  world.chum();
  for (const event of world.drainEvents()) renderer.onEvent(event);
}
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
let benchmarking = false;
let accumulator = 0;
const snapButton = document.querySelector<HTMLButtonElement>("#snap")!;
const chumButton = document.querySelector<HTMLButtonElement>("#chum")!;
snapButton.disabled = world.traps.length === 0;
chumButton.disabled = !stats.boat.chum;
snapButton.addEventListener("click", () => { snapAll(); setActive(true); });
chumButton.addEventListener("click", () => {
  if (world.chum()) for (const event of world.drainEvents()) renderer.onEvent(event);
  else renderer.onEvent({ type: "chum", x: world.width / 2, y: world.height / 2 });
  setActive(true);
});
document.querySelector("#freeze")!.addEventListener("click", () => setActive(!active));
document.querySelector("#freeze")!.textContent = active ? "Freeze" : "Animate";
canvas.addEventListener("pointermove", (event) => { pointer = toWorldPoint(view, event); if (still) renderer.draw(scene(), 0); });
document.querySelector("#burst")!.addEventListener("click", () => {
  renderer.onEvent({ type: "tick", ...pointer, radius: stats.netRadius, hits: 12, crits: 2 });
  for (let i = 0; i < 12; i++) renderer.onEvent({
    type: "capture", kind: FISH_KINDS[i % 8]!, source: "net", x: pointer.x + Math.cos(i * 2.4) * 80,
    y: pointer.y + Math.sin(i * 2.4) * 80, value: i === 0 ? 2400 : 38, combo: i, golden: i === 0,
  });
  setActive(true);
});
document.querySelector("#bench")!.addEventListener("click", benchmark);
window.addEventListener("resize", () => location.reload());
onArtReady(() => { renderer.draw(scene(), 0); updateReady(); });
// Warm the deterministic chum pose before adding a short snap, so both can be inspected still.
renderer.draw(scene(), still && stats.boat.chum ? 0.8 : 0);
if (enabled("snap")) { snapAll(); renderer.draw(scene(), 0.08); }
updateReady();
requestAnimationFrame(frame);

function frame(now: number): void {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  if (benchmarking) { requestAnimationFrame(frame); return; }
  if (live && active) {
    accumulator += dt;
    // Fixed steps keep simulation timing independent of the monitor's refresh rate.
    while (accumulator >= STEP) {
      world.pointer = pointer;
      world.update(STEP);
      for (const event of world.drainEvents()) renderer.onEvent(event);
      accumulator -= STEP;
    }
  }
  // These are presentation controls: replay chum even while the simulation is cooling down.
  chumButton.disabled = !stats.boat.chum;
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

function setActive(value: boolean): void {
  active = value;
  document.querySelector("#freeze")!.textContent = active ? "Freeze" : "Animate";
}

/** Sends presentation events with a known cooldown; it never captures review fish. */
function snapAll(): void {
  for (const trap of world.traps) {
    trap.age = Math.max(2, trap.age);
    trap.cooldown = stats.rigging.resetSeconds;
    renderer.onEvent({ type: "trap-snap", trapId: trap.id, x: trap.x, y: trap.y, hits: 2 });
    if (trap.partner !== null) renderer.onEvent({ type: "seine-hit", x: trap.x, y: trap.y });
  }
  if (world.chest && (world.chest.snagLeft ?? 0) > 0) renderer.onEvent({ type: "snag", x: world.chest.x, y: world.chest.y });
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
  if (benchmarking) return;
  benchmarking = true;
  const bench = new World({ ...cloneStats(stats), startFish: 0 }, createRng(90210), view.worldWidth, view.worldHeight);
  for (let i = 0; bench.fish.length < 300; i++) bench.spawn(FISH_KINDS[i % 8]);
  for (const fish of bench.fish) fish.age = 2;
  for (const trap of bench.traps) trap.age = 2;
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
  benchmarking = false;
}
