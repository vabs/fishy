import "./style.css";
import { formatDuration, formatMoney, wholeShares } from "./format";
import { FISH, FISH_KINDS, type FishKind } from "./game/fish";
import { Renderer } from "./game/render";
import { buildSprites } from "./game/shapes";
import { createRng } from "./game/rng";
import { BASE_STATS, type Stats } from "./game/stats";
import { TECH_NODES, applyUpgrades, buy, canBuy, isTreeComplete } from "./game/tech";
import { STEP, World, type Point } from "./game/world";
import { createSave, loadSave, recordRound, resetProgress, sanitizeUpgrades, writeSave, type SaveData } from "./save";
import { promptForName } from "./ui/name-prompt";
import { mountSaveControls } from "./ui/save-controls";
import { mountTechTree } from "./ui/tech-tree";

/** Longest frame the sim will catch up on, so a backgrounded tab doesn't fast-forward a round. */
const MAX_FRAME_SECONDS = 0.25;
const TOAST_SECONDS = 6;
/** The first-round tip disappears after the first catch, or after this long. */
const HINT_SECONDS = 8;

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
const hub = {
  root: element("#hub"),
  name: element("#hub-name"),
  round: element("#hub-round"),
  money: element("#hub-money"),
  hint: element("#hub-hint"),
  save: element("#hub-save"),
  tree: element("#hub-tree"),
  start: element<HTMLButtonElement>("#start-button"),
};
const summary = {
  root: element("#summary-panel"),
  title: element("#summary-title"),
  earned: element("#summary-earned"),
  table: element("#summary-table"),
  rows: element("#summary-rows"),
  fish: element("#summary-fish"),
  total: element("#summary-total"),
  empty: element("#summary-empty"),
};
const end = {
  root: element("#end-panel"),
  message: element("#end-message"),
  rounds: element("#end-rounds"),
  fish: element("#end-fish"),
  best: element("#end-best"),
  time: element("#end-time"),
};
const toast = element("#toast");
const roundHint = element("#round-hint");

const renderer = new Renderer(canvas);
let save: SaveData;
let world: World | null = null;
/** Stats of the round being played, or the base stats between rounds. */
let stats: Stats = BASE_STATS;
let pointer: Point | null = null;
/** Round number shown while playing; the save has already moved on once the round ends. */
let playingRound = 1;
let finalRound = false;
let accumulator = 0;
let lastFrame = performance.now();
let toastTimer = 0;
let saveFailureShown = false;

/**
 * Dev only: `?fish=electric,epic` makes only those types spawn, sharing Normal's base spawn rate,
 * to try a type out.
 */
function applyDevOverrides(stats: Stats): Stats {
  if (!import.meta.env.DEV) return stats;
  const only = new URLSearchParams(location.search).get("fish");
  if (only) {
    const kinds = only.split(",").filter((k): k is FishKind => k in stats.fish);
    const each = BASE_STATS.fish.normal.rate / Math.max(kinds.length, 1);
    for (const kind of FISH_KINDS) stats.fish[kind].rate = kinds.includes(kind) ? each : 0;
  }
  return stats;
}

async function loadOrCreateSave(): Promise<SaveData> {
  const stored = loadSave();
  if (stored) return { ...stored, upgrades: sanitizeUpgrades(stored.upgrades, TECH_NODES) };
  const fresh = createSave(await promptForName());
  persist(fresh);
  return fresh;
}

/** Writes the save, and tells the player once per visit if the browser won't keep it. */
function persist(next: SaveData): void {
  if (writeSave(next) || saveFailureShown) return;
  saveFailureShown = true;
  showToast("This browser isn't keeping your progress. Use Export save before you leave to keep it.");
}

function setSave(next: SaveData): void {
  save = next;
  persist(save);
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), TOAST_SECONDS * 1000);
}

function showOnly(screen: "hub" | "round" | "summary" | "end"): void {
  if (screen !== "round") roundHint.hidden = true;
  hub.root.hidden = screen !== "hub";
  hud.root.hidden = screen !== "round";
  summary.root.hidden = screen !== "summary";
  end.root.hidden = screen !== "end";
  document.body.classList.toggle("playing", screen === "round");
}

function showHub(): void {
  world = null;
  stats = BASE_STATS;
  renderHub();
  showOnly("hub");
}

function renderHub(): void {
  const complete = isTreeComplete(save.upgrades);
  hub.name.textContent = save.playerName;
  hub.round.textContent = complete ? "Final Round next" : `Round ${save.round} next`;
  hub.money.textContent = formatMoney(save.money);
  hub.hint.textContent = hint(complete);
  hub.start.textContent = complete ? "Final Round" : "Start Round";
  hub.start.classList.toggle("is-final", complete);
  tree.update({ money: save.money, upgrades: save.upgrades });
}

function hint(complete: boolean): string {
  if (complete) return "Every upgrade is yours. One last round to go.";
  if (TECH_NODES.some((node) => canBuy(node, save.upgrades, save.money))) return "Click a glowing upgrade to buy it.";
  return "Catch more fish to afford the next upgrade.";
}

function startRound(): void {
  finalRound = isTreeComplete(save.upgrades);
  playingRound = save.round;
  stats = applyDevOverrides(applyUpgrades(BASE_STATS, save.upgrades));
  world = new World(stats, createRng(Date.now()), window.innerWidth, window.innerHeight);
  accumulator = 0;
  showOnly("round");
}

function endRound(finished: World): void {
  const recorded = recordRound(save, {
    earned: finished.earned,
    caught: finished.caught,
    durationMs: Math.round(finished.elapsed * 1000),
  });
  setSave(finalRound ? { ...recorded, finalRoundDone: true } : recorded);

  summary.title.textContent = finalRound ? "Final Round complete" : `Round ${playingRound} complete`;
  summary.earned.textContent = formatMoney(finished.earned);
  summary.fish.textContent = finished.totalCaught.toLocaleString("en-US");
  summary.total.textContent = formatMoney(finished.earned);
  const kinds = FISH_KINDS.filter((kind) => finished.caught[kind]).sort(
    (a, b) => (finished.earnedBy[b] ?? 0) - (finished.earnedBy[a] ?? 0),
  );
  const shares = wholeShares(kinds.map((kind) => finished.earnedBy[kind] ?? 0), finished.earned);
  summary.rows.replaceChildren(...kinds.map((kind, i) => summaryRow(kind, finished.caught[kind] ?? 0, shares[i] ?? 0)));
  summary.table.hidden = kinds.length === 0;
  summary.empty.hidden = kinds.length > 0;
  showOnly("summary");
}

function summaryRow(kind: FishKind, caught: number, earned: number): HTMLTableRowElement {
  const row = document.createElement("tr");
  const name = document.createElement("td");
  const label = document.createElement("span");
  label.className = "summary-fish";
  label.append(fishIcon(kind), FISH[kind].name);
  name.append(label);
  const count = document.createElement("td");
  count.textContent = caught.toLocaleString("en-US");
  const money = document.createElement("td");
  money.textContent = formatMoney(earned);
  row.append(name, count, money);
  return row;
}

/** A small full-colour picture of a fish type, fitted into 40 × 26 px. */
function fishIcon(kind: FishKind): HTMLCanvasElement {
  const dpr = window.devicePixelRatio || 1;
  const sprite = buildSprites(kind, dpr);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(40 * dpr);
  canvas.height = Math.round(26 * dpr);
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const scale = Math.min(canvas.width / sprite.full.width, canvas.height / sprite.full.height);
    const w = sprite.full.width * scale;
    const h = sprite.full.height * scale;
    ctx.drawImage(sprite.full, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }
  return canvas;
}

function showEnd(): void {
  world = null;
  end.message.textContent = `You've mastered the sea, ${save.playerName}.`;
  end.rounds.textContent = String(save.round - 1);
  end.fish.textContent = save.stats.totalFish.toLocaleString("en-US");
  end.best.textContent = formatMoney(save.stats.bestRoundEarnings);
  end.time.textContent = formatDuration(save.stats.playTimeMs);
  showOnly("end");
}

/** Where the player goes between rounds. */
function showHome(): void {
  if (save.finalRoundDone) showEnd();
  else if (nothingToBuy()) startRound();
  else showHub();
}

/**
 * True for a new game (and until the first upgrade is affordable): the tree would only show one
 * locked node, so the player goes straight back to the water instead.
 */
function nothingToBuy(): boolean {
  return Object.keys(save.upgrades).length === 0 && !TECH_NODES.some((node) => canBuy(node, save.upgrades, save.money));
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.resize(width, height, window.devicePixelRatio || 1);
  world?.resize(width, height);
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function updateHud(): void {
  if (!world) return;
  const playing = !world.over;
  setText(hud.round, finalRound ? "Final Round" : `Round ${playingRound}`);
  setText(hud.timer, `${world.timeLeft.toFixed(1)}s`);
  setText(hud.money, formatMoney(playing ? save.money + world.earned : save.money));
  const combo = world.combo > 0 ? ` · combo ×${world.comboMult.toFixed(1)}` : "";
  setText(hud.earned, playing ? `+${formatMoney(world.earned)} this round${combo}` : "");
  const showHint = playing && playingRound === 1 && world.totalCaught === 0 && world.elapsed < HINT_SECONDS;
  if (roundHint.hidden === showHint) roundHint.hidden = !showHint;
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

resize();
requestAnimationFrame(frame);

// The sea keeps drawing behind the name prompt on a first visit.
save = await loadOrCreateSave();

const tree = mountTechTree(hub.tree, {
  onBuy(nodeId) {
    const result = buy(save.upgrades, save.money, nodeId);
    if (!result) return;
    setSave({ ...save, ...result });
    renderHub();
  },
});
mountSaveControls(hub.save, {
  getSave: () => save,
  nodes: TECH_NODES,
  onImport(imported) {
    setSave(imported);
    showHome();
  },
});
hub.start.addEventListener("click", startRound);
element("#continue-button").addEventListener("click", showHome);
element("#play-again-button").addEventListener("click", () => {
  setSave(resetProgress(save));
  showHome();
});

showHome();
