import "./style.css";
import { createGameAudio } from "./audio";
import { formatCompactMoney, formatDuration, formatMoney } from "./format";
import { FISH, FISH_KINDS, type FishKind } from "./game/fish";
import { fishColors, onPaletteChange, setPalette } from "./game/palette";
import { Renderer } from "./game/render";
import { buildChestSprites, buildSprites } from "./game/shapes";
import { createRng } from "./game/rng";
import { BASE_STATS, type Stats } from "./game/stats";
import { summaryRows, type SummaryRow } from "./game/summary";
import { TECH_NODES, applyUpgrades, buy, canBuy, isTreeComplete, refundRemovedLevels } from "./game/tech";
import { STEP, World, isFrenzyRound, type Point } from "./game/world";
import { createViewport } from "./game/viewport";
import { createSave, loadSave, recordRound, resetProgress, sanitizeUpgrades, writeSave, type SaveData } from "./save";
import { mountAudioControls } from "./ui/audio-controls";
import { mountDisplayControls } from "./ui/display-controls";
import { loadDisplaySettings } from "./ui/display-settings";
import { showIntro } from "./ui/intro";
import { promptForName } from "./ui/name-prompt";
import { mountSaveControls } from "./ui/save-controls";
import { mountTechTree } from "./ui/tech-tree";
import { mountNetInput } from "./ui/net-input";

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
  combo: element("#hud-combo"),
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
  frenzy: element("#summary-frenzy"),
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
const frenzyBanner = {
  root: element("#frenzy-banner"),
  value: element("#frenzy-value"),
  time: element("#frenzy-time"),
  fill: element("#frenzy-bar-fill"),
};
const pausePanel = element("#pause-panel");
const pauseMessage = element("#pause-message");
const resumeButton = element<HTMLButtonElement>("#resume-button");
const toolsToggle = element<HTMLButtonElement>("#hub-tools-toggle");
const hubTools = element("#hub-tools");
const touchLayout = window.matchMedia("(any-pointer: coarse)");

// The palette is a per-device choice, stored apart from the save. Blocked storage means standard.
setPalette(loadDisplaySettings().colorBlind ? "colorBlind" : "standard");
publishFishColors();
onPaletteChange(() => {
  publishFishColors();
  for (const icon of summary.rows.querySelectorAll<HTMLCanvasElement>("canvas[data-icon]")) {
    paintRowIcon(icon, icon.dataset.icon as SummaryRow["key"]);
  }
});

const renderer = new Renderer(canvas);
const audio = createGameAudio();
mountAudioControls(element("#hud-audio"), audio, "hud");
mountAudioControls(element("#hub-audio"), audio, "hub");
mountDisplayControls(element("#hub-display"));
let save: SaveData;
let world: World | null = null;
/** Stats of the round being played, or the base stats between rounds. */
let stats: Stats = BASE_STATS;
let pointer: Point | null = null;
let finger: Point | null = null;
let viewport = createViewport(window.innerWidth, window.innerHeight);
let landscape = window.innerWidth > window.innerHeight;
let paused = false;
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

/** The stored save, or a new one after asking for the player's name. `isNew` is true for the latter. */
async function loadOrCreateSave(): Promise<{ save: SaveData; isNew: boolean }> {
  const stored = loadSave();
  if (stored) {
    // Balance updates can shorten or remove upgrades; pay back levels the save can no longer own.
    const { upgrades, refund } = refundRemovedLevels(stored.upgrades);
    const loaded = { ...stored, money: stored.money + refund, upgrades: sanitizeUpgrades(upgrades, TECH_NODES) };
    if (refund > 0) {
      persist(loaded);
      showToast(`The upgrade tree was rebalanced. ${formatMoney(refund)} was refunded for upgrades that were shortened or removed.`);
    }
    return { save: loaded, isNew: false };
  }
  const fresh = createSave(await promptForName());
  persist(fresh);
  return { save: fresh, isNew: true };
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
  netInput.clear();
  tree.dismiss();
  paused = false;
  hud.root.dataset.paused = "false";
  pausePanel.hidden = true;
  if (screen !== "round") {
    roundHint.hidden = true;
    frenzyBanner.root.hidden = true;
  }
  hub.root.hidden = screen !== "hub";
  hud.root.hidden = screen !== "round";
  summary.root.hidden = screen !== "summary";
  end.root.hidden = screen !== "end";
  document.body.classList.toggle("playing", screen === "round");
  audio.screen(screen, { final: finalRound, upgrades: save.upgrades });
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
  setMoney(hub.money, save.money);
  const frenzy = isFrenzyRound({ round: save.round, final: complete });
  hub.hint.textContent = hint(complete, frenzy);
  hub.start.textContent = complete ? "Final Round" : "Start Round";
  hub.start.classList.toggle("is-final", complete);
  // A badge as well as the hint, which compact screens hide.
  hub.start.classList.toggle("has-frenzy", frenzy);
  tree.update({ money: save.money, upgrades: save.upgrades });
}

function hint(complete: boolean, frenzy: boolean): string {
  if (complete) return "Every upgrade is yours. One last round to go.";
  // Short, so it fits beside Start Round on a phone.
  if (frenzy) return "Feeding Frenzy this round!";
  if (TECH_NODES.some((node) => canBuy(node, save.upgrades, save.money))) {
    return touchLayout.matches ? "Tap a glowing upgrade, then Buy." : "Click a glowing upgrade to buy it.";
  }
  return "Catch more fish to afford the next upgrade.";
}

function startRound(): void {
  finalRound = isTreeComplete(save.upgrades);
  playingRound = save.round;
  stats = applyDevOverrides(applyUpgrades(BASE_STATS, save.upgrades));
  setToolsOpen(false);
  showOnly("round");
  resize();
  world = new World(stats, createRng(Date.now()), viewport.worldWidth, viewport.worldHeight, {
    round: playingRound,
    final: finalRound,
  });
  accumulator = 0;
  lastFrame = performance.now();
  roundHint.textContent = touchLayout.matches
    ? "Hold and drag to fish. Your net floats above your finger."
    : "Move your net over the fish. It catches them on its own.";
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
  // Already counted in the rows below; this says how much of it the wave brought in.
  summary.frenzy.hidden = !finished.frenzy;
  summary.frenzy.textContent = finished.frenzy
    ? `Feeding Frenzy: +${formatMoney(finished.frenzyEarned)} from ${finished.frenzyCaught.toLocaleString("en-US")} fish`
    : "";
  summary.fish.textContent = finished.totalCaught.toLocaleString("en-US");
  summary.total.textContent = formatMoney(finished.earned);
  const rows = summaryRows(finished);
  summary.rows.replaceChildren(...rows.map(summaryRow));
  summary.table.hidden = rows.length === 0;
  summary.empty.hidden = rows.length > 0;
  showOnly("summary");
}

function summaryRow({ key, count: caught, earned }: SummaryRow): HTMLTableRowElement {
  const row = document.createElement("tr");
  const name = document.createElement("td");
  const label = document.createElement("span");
  label.className = "summary-fish";
  const title = key === "golden" ? "Golden fish" : key === "treasure" ? "Treasure" : FISH[key].name;
  label.append(rowIcon(key), title);
  name.append(label);
  const count = document.createElement("td");
  count.textContent = caught.toLocaleString("en-US");
  const money = document.createElement("td");
  money.textContent = formatMoney(earned);
  row.append(name, count, money);
  return row;
}

/** A small full-colour picture for a summary row (a fish, a golden fish, the chest), fitted into 40 × 26 px. */
function rowIcon(key: SummaryRow["key"]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.dataset.icon = key;
  canvas.setAttribute("aria-hidden", "true");
  paintRowIcon(canvas, key);
  return canvas;
}

/** Draws (or redraws, after a palette change) a summary row's icon in the active palette. */
function paintRowIcon(canvas: HTMLCanvasElement, key: SummaryRow["key"]): void {
  const dpr = window.devicePixelRatio || 1;
  const picture =
    key === "golden" ? buildSprites("normal", dpr).golden
    : key === "treasure" ? buildChestSprites(dpr).full
    : buildSprites(key, dpr).full;
  canvas.width = Math.round(40 * dpr);
  canvas.height = Math.round(26 * dpr);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const scale = Math.min(canvas.width / picture.width, canvas.height / picture.height);
    const w = picture.width * scale;
    const h = picture.height * scale;
    ctx.drawImage(picture, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }
}

/** Fish body colours as CSS variables (--fish-normal, ...) for the tech tree and how-to-play slides. */
function publishFishColors(): void {
  for (const kind of FISH_KINDS) document.documentElement.style.setProperty(`--fish-${kind}`, fishColors(kind).body);
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
  const height = window.visualViewport?.height ?? window.innerHeight;
  const nextLandscape = window.innerWidth > window.innerHeight;
  if (world && touchLayout.matches && nextLandscape !== landscape) pauseRound("Screen rotated. Resume when you're ready.");
  landscape = nextLandscape;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
  document.documentElement.style.setProperty("--viewport-top", `${window.visualViewport?.offsetTop ?? 0}px`);
  const top = document.body.classList.contains("playing") ? hud.root.getBoundingClientRect().height : 0;
  if (!frenzyBanner.root.hidden) placeFrenzyBanner();
  const safeBottom = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom")) || 0;
  // The contact strip lets a finger reach below the sea while the net stays above it.
  const bottom = safeBottom + (touchLayout.matches && document.body.classList.contains("playing") ? 56 : 0);
  viewport = createViewport(width, height, top, bottom);
  netInput.clear();
  const density = touchLayout.matches ? Math.min(window.devicePixelRatio || 1, 2) : window.devicePixelRatio || 1;
  renderer.resize(width, height, density, viewport);
  world?.resize(viewport.worldWidth, viewport.worldHeight);
}

function setToolsOpen(open: boolean): void {
  hubTools.classList.toggle("is-open", open);
  hubTools.hidden = !open;
  toolsToggle.setAttribute("aria-expanded", String(open));
}

function pauseRound(message = "Your round is paused."): void {
  if (!world || world.over || paused) return;
  paused = true;
  hud.root.dataset.paused = "true";
  netInput.clear();
  world.pointer = null;
  accumulator = 0;
  pauseMessage.textContent = message;
  pausePanel.hidden = false;
  audio.screen("hub", { final: finalRound, upgrades: save.upgrades });
  resumeButton.focus({ preventScroll: true });
}

function resumeRound(): void {
  if (!world || world.over || document.hidden) return;
  paused = false;
  hud.root.dataset.paused = "false";
  pausePanel.hidden = true;
  accumulator = 0;
  lastFrame = performance.now();
  audio.screen("round", { final: finalRound, upgrades: save.upgrades });
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setMoney(el: HTMLElement, amount: number): void {
  const full = formatMoney(amount);
  setText(el, touchLayout.matches ? formatCompactMoney(amount) : full);
  if (el.title !== full) el.title = full;
}

function updateHud(): void {
  if (!world) return;
  const playing = !world.over;
  setText(hud.round, finalRound ? "Final Round" : `Round ${playingRound}`);
  setText(hud.timer, `${world.timeLeft.toFixed(1)}s`);
  hud.timer.setAttribute("aria-label", `${world.timeLeft.toFixed(1)} seconds left`);
  hud.root.classList.toggle("is-urgent", playing && world.timeLeft <= 5);
  setMoney(hud.money, save.money);
  const combo = world.combo > 0 ? `Combo ×${world.comboMult.toFixed(1)}` : "";
  const earnings = touchLayout.matches ? formatCompactMoney(world.earned) : formatMoney(world.earned);
  setText(hud.earned, `+${earnings}`);
  setText(hud.combo, playing ? combo : "");
  const showHint = playing && playingRound === 1 && world.totalCaught === 0 && world.elapsed < HINT_SECONDS;
  if (roundHint.hidden === showHint) roundHint.hidden = !showHint;
  updateFrenzyBanner(world, playing);
}

/** Shows the Feeding Frenzy banner while the wave runs, with a bar that empties as it does. */
function updateFrenzyBanner(world: World, playing: boolean): void {
  const wave = world.frenzy;
  const show = playing && wave !== null && world.frenzyActive;
  if (frenzyBanner.root.hidden === show) {
    frenzyBanner.root.hidden = !show;
    if (show) placeFrenzyBanner();
  }
  if (!show) return;
  const left = world.frenzyLeft;
  setText(frenzyBanner.value, `Every catch ×${Number(world.stats.frenzyValueMult.toFixed(2))}`);
  setText(frenzyBanner.time, `· ${Math.ceil(left)}s`);
  frenzyBanner.fill.style.transform = `scaleX(${(left / (wave.end - wave.start)).toFixed(3)})`;
}

/** Hangs the frenzy banner just below the HUD, measured now that the HUD shows this round's numbers. */
function placeFrenzyBanner(): void {
  frenzyBanner.root.style.top = `${hud.root.getBoundingClientRect().bottom + 6}px`;
}

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_SECONDS);
  lastFrame = now;

  if (world && !world.over && !paused) {
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
  if (world) {
    const events = world.drainEvents();
    for (const event of events) renderer.onEvent(event);
    audio.frame(events, world);
  }

  renderer.draw({ world, pointer, stats, finger }, paused ? 0 : dt);
  updateHud();
  requestAnimationFrame(frame);
}

const netInput = mountNetInput(canvas, {
  getViewport: () => viewport,
  enabled: () => Boolean(world && !world.over && !paused),
  onChange(next, contact) { pointer = next; finger = contact; },
});
window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
window.visualViewport?.addEventListener("scroll", resize);
touchLayout.addEventListener("change", resize);
window.addEventListener("orientationchange", () => pauseRound("Screen rotated. Resume when you're ready."));
window.addEventListener("blur", () => pauseRound());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseRound("Your round paused while you were away.");
});
element("#pause-button").addEventListener("click", () => pauseRound());
resumeButton.addEventListener("click", resumeRound);
toolsToggle.addEventListener("click", () => setToolsOpen(!hubTools.classList.contains("is-open")));
document.addEventListener("pointerdown", (event) => {
  if (document.querySelector("dialog[open]")) return;
  if (!hubTools.contains(event.target as Node) && !toolsToggle.contains(event.target as Node)) setToolsOpen(false);
});
window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
  if (event.key === "Escape" && !hubTools.hidden) {
    event.preventDefault();
    setToolsOpen(false);
    toolsToggle.focus({ preventScroll: true });
    return;
  }
  if (event.key === "Escape" && world && !world.over) {
    event.preventDefault();
    if (paused) resumeRound();
    else pauseRound();
  }
});

resize();
requestAnimationFrame(frame);

// The sea keeps drawing behind the name prompt on a first visit.
const loaded = await loadOrCreateSave();
save = loaded.save;

const tree = mountTechTree(hub.tree, {
  onBuy(nodeId) {
    const result = buy(save.upgrades, save.money, nodeId);
    if (!result) return;
    setSave({ ...save, ...result });
    audio.purchase(nodeId, save.upgrades);
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
element("#help-button").addEventListener("click", () => {
  setToolsOpen(false);
  void showIntro({ playerName: save.playerName, mode: "replay" });
});
element("#continue-button").addEventListener("click", showHome);
element("#play-again-button").addEventListener("click", () => {
  setSave(resetProgress(save));
  showHome();
});

// New players learn the basics before their first round.
if (loaded.isNew) await showIntro({ playerName: save.playerName, mode: "first" });
showHome();
