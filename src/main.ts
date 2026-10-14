import "./style.css";
import { formatMoney } from "./format";
import { Renderer } from "./game/render";
import { createRng } from "./game/rng";
import { BASE_STATS } from "./game/stats";
import { STEP, World, type Point } from "./game/world";

/** Longest frame the sim will catch up on, so a backgrounded tab doesn't fast-forward a round. */
const MAX_FRAME_SECONDS = 0.25;

function element<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

const canvas = element<HTMLCanvasElement>("#game");
const hud = {
  root: element("#hud"),
  round: element("#hud-round"),
  timer: element("#hud-timer"),
  money: element("#hud-money"),
  earned: element("#hud-earned"),
};
const startPanel = element("#start-panel");
const summary = {
  root: element("#summary-panel"),
  title: element("#summary-title"),
  fish: element("#summary-fish"),
  earned: element("#summary-earned"),
  bank: element("#summary-bank"),
};

const renderer = new Renderer(canvas);
const stats = BASE_STATS;
let world: World | null = null;
let pointer: Point | null = null;
let bank = 0;
let round = 1;
let accumulator = 0;
let lastFrame = performance.now();

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.resize(width, height, window.devicePixelRatio || 1);
  world?.resize(width, height);
}

function startRound(): void {
  world = new World(stats, createRng(Date.now()), window.innerWidth, window.innerHeight);
  accumulator = 0;
  startPanel.hidden = true;
  summary.root.hidden = true;
  hud.root.hidden = false;
  document.body.classList.add("playing");
}

function endRound(finished: World): void {
  bank += finished.earned;
  summary.title.textContent = `Round ${round} complete`;
  summary.fish.textContent = String(finished.totalCaught);
  summary.earned.textContent = formatMoney(finished.earned);
  summary.bank.textContent = formatMoney(bank);
  summary.root.hidden = false;
  document.body.classList.remove("playing");
  round++;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function updateHud(): void {
  if (!world) return;
  setText(hud.round, `Round ${world.over ? round - 1 : round}`);
  setText(hud.timer, `${world.timeLeft.toFixed(1)}s`);
  setText(hud.money, formatMoney(bank + (world.over ? 0 : world.earned)));
  setText(hud.earned, world.over ? "" : `+${formatMoney(world.earned)} this round`);
}

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_SECONDS);
  lastFrame = now;

  if (world && !world.over) {
    accumulator += dt;
    while (accumulator >= STEP) {
      world.pointer = pointer;
      world.update(STEP);
      accumulator -= STEP;
      if (world.over) {
        endRound(world);
        break;
      }
    }
  }
  if (world) for (const event of world.drainEvents()) renderer.onEvent(event);

  renderer.draw({ world, pointer, stats }, dt);
  updateHud();
  requestAnimationFrame(frame);
}

canvas.addEventListener("pointermove", (event) => {
  pointer = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointerleave", () => {
  pointer = null;
});
window.addEventListener("resize", resize);
element("#start-button").addEventListener("click", startRound);
element("#next-button").addEventListener("click", startRound);

resize();
requestAnimationFrame(frame);
