import "./style.css";
import { weatherIcon } from "./ui/icons";
import "./app/feedback.css";
import { bountyBoard, bountyFacts, bountyResult } from "./app/bounties";
import { advanceEndless, endlessRecordsDiff, endlessUnlocked, formatSeaTime } from "./app/endless";
import { takeToolHint } from "./app/tool-hints";
import { isChumKey, mountChumControl } from "./ui/chum-control";
import { ACHIEVEMENTS, grantAchievements, newAchievements, type AchievementMoment } from "./game/achievements";
import { bountyGuarantees, type Bounty } from "./game/bounties";
import { renderBounties } from "./ui/bounties-view";
import { renderSummaryExtras, type SummaryExtra } from "./ui/summary-extras";
import { renderAchievements } from "./ui/achievements-view";
import { showAchievementToast } from "./ui/achievement-toast";
import { createGameAudio } from "./audio";
import { formatCompactMoney, formatDuration, formatMoney } from "./format";
import { FISH, FISH_KINDS, type FishKind } from "./game/fish";
import { fishColors, onPaletteChange, setPalette } from "./game/palette";
import { Renderer } from "./game/render";
import { buildChestSprites, buildSprites } from "./game/shapes";
import { BIOME, biomeLabel, type Biome } from "./game/biome";
import { SEA, seaBlurb, seaLabel, seaStateFor, type SeaState } from "./game/sea";
import { createRng } from "./game/rng";
import { BASE_STATS, type Stats } from "./game/stats";
import { summaryRows, type SummaryRow } from "./game/summary";
import { TECH_NODES, applyUpgrades, buy, canBuy, isTreeComplete, refundRemovedLevels } from "./game/tech";
import { STEP, World, isFrenzyRound, type Point } from "./game/world";
import { createViewport } from "./game/viewport";
import { createSave, loadSave, recordEndless, recordRound, resetProgress, sanitizeUpgrades, writeSave, type SaveData } from "./save";
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
const BANNER_SECONDS = 3;

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
  bonuses: element("#summary-bonuses"),
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
const title = element("#title");
const titlePlay = element<HTMLButtonElement>("#title-play");
const titleEndless = element<HTMLButtonElement>("#title-endless");
const titleSettings = element<HTMLButtonElement>("#title-settings");
const endlessPanel = element("#endless-panel");
const achievementsPanel = element("#achievements-panel");
const achievementsClose = element<HTMLButtonElement>("#achievements-close");
const hubAchievements = document.createElement("button");
hubAchievements.id = "hub-achievements";
hubAchievements.type = "button";
hubAchievements.className = "hub-achievements";
element(".hub-player").append(hubAchievements);
const toast = element("#toast");
const roundHint = element("#round-hint");
const frenzyBanner = {
  root: element("#frenzy-banner"),
  value: element("#frenzy-value"),
  time: element("#frenzy-time"),
  fill: element("#frenzy-bar-fill"),
};
const roundBanners = element("#round-banners");
roundBanners.classList.add("is-live");
const seaBanner = element("#sea-banner");
const biomeBanner = element("#biome-banner");
let seaBannerUntil = 0;
let biomeBannerUntil = 0;
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
  if (!achievementsPanel.hidden) drawAchievements();
});

const renderer = new Renderer(canvas);
const audio = createGameAudio();
mountAudioControls(element("#hud-audio"), audio, "hud");
mountAudioControls(element("#hub-audio"), audio, "hub");
const display = mountDisplayControls(element("#hub-display"), element("#hub-haptics"));
let save: SaveData;
let world: World | null = null;
// Read-only access to the current session for dev pages and browser regression checks.
if (import.meta.env.DEV) Object.defineProperty(window, "__fishy", {
  configurable: true, get: () => ({ world, pointer }),
});
const chumControl = mountChumControl(element<HTMLButtonElement>("#chum-button"), () => {
  if (screen === "round" && !paused && !document.querySelector("dialog[open]")) world?.chum();
});
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
let returningPlayer = false;
type Screen = "title" | "hub" | "round" | "summary" | "end" | "endless";
let screen: Screen = "title";
let activeBounties: readonly Bounty[] = [];
const completedBounties = new Set<string>();
let coinTarget: Point | null = null;
let achievementOpener: HTMLElement | null = null;
let achievementBackground: HTMLElement | null = null;
let toolsOpener: HTMLElement = toolsToggle;
let countUp: { amount: number; start: number } | null = null;
let trapHint = false;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const timeParam = import.meta.env.DEV ? new URLSearchParams(location.search).get("time") : null;
const devTime = timeParam !== null && Number.isFinite(Number(timeParam)) ? Number(timeParam) : undefined;

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

function showOnly(next: Screen): void {
  netInput.clear();
  tree.dismiss();
  setToolsOpen(false);
  countUp = null;
  summary.earned.classList.remove("is-counting");
  screen = next;
  paused = false;
  hud.root.dataset.paused = "false";
  hud.root.classList.remove("is-urgent");
  pausePanel.hidden = true;
  if (next !== "round") {
    roundHint.hidden = true;
    frenzyBanner.root.hidden = true;
    seaBanner.hidden = true;
    biomeBanner.hidden = true;
    coinTarget = null;
  }
  title.hidden = next !== "title";
  hub.root.hidden = next !== "hub";
  hud.root.hidden = next !== "round";
  summary.root.hidden = next !== "summary";
  end.root.hidden = next !== "end";
  endlessPanel.hidden = next !== "endless";
  document.body.classList.toggle("playing", next === "round");
  // A new round sends its context after the World exists, including a dev biome offset.
  if (next !== "round") audio.screen(next === "endless" ? "summary" : next, audioContext());
}

/** Screen and biome share one context, including while a trip is paused or in its logbook. */
function audioContext(): { final: boolean; endless: boolean; biome?: Biome; upgrades: SaveData["upgrades"] } {
  const endless = screen === "round" ? hud.root.dataset.mode === "endless" : world?.endless ?? false;
  return { final: finalRound, endless, biome: world?.biome?.biome ?? (endless ? "reef" : undefined), upgrades: save.upgrades };
}

/** The same weather supplies the hub, the bounty board and the timed simulation. */
function nextSea(): SeaState {
  if (import.meta.env.DEV) {
    const forced = new URLSearchParams(location.search).get("sea");
    if (forced === "storm" || forced === "fog" || forced === "bloom") return forced;
  }
  return seaStateFor(save.createdAt, save.round, isTreeComplete(save.upgrades));
}

function showTitle(): void {
  world = null;
  stats = BASE_STATS;
  finalRound = false;
  element("#title-greeting").textContent = `Welcome ${returningPlayer ? "back" : "aboard"}, ${save.playerName}.`;
  const unlocked = endlessUnlocked(save);
  titleEndless.disabled = !unlocked;
  element("#title-endless-lock").hidden = unlocked;
  updateAchievementCounts();
  showOnly("title");
  resize();
  titlePlay.focus({ preventScroll: true });
}

function updateAchievementCounts(): void {
  const count = `${ACHIEVEMENTS.filter((a) => Object.hasOwn(save.achievements, a.id)).length} / ${ACHIEVEMENTS.length}`;
  element("#title-achievements-count").textContent = count;
  element("#achievements-count").textContent = count;
  hubAchievements.textContent = `Achievements ${count}`;
}

function checkAchievements(moment: AchievementMoment = {}, silent = false): void {
  const unlocked = newAchievements(save, moment);
  if (unlocked.length) {
    setSave(grantAchievements(save, unlocked.map((a) => a.id)));
    if (silent) showToast(`${unlocked.length} achievement${unlocked.length === 1 ? "" : "s"} unlocked`);
    else for (const achievement of unlocked) {
      showAchievementToast(element("#achievement-toast"), achievement);
      audio.achievement();
    }
  }
  updateAchievementCounts();
}

function drawAchievements(): void {
  renderAchievements(element("#achievements-grid"), ACHIEVEMENTS, save.achievements);
  updateAchievementCounts();
}

function openAchievements(opener: HTMLElement): void {
  setToolsOpen(false);
  drawAchievements();
  achievementOpener = opener;
  achievementBackground = screen === "title" ? title : hub.root;
  achievementBackground.inert = true;
  achievementsPanel.hidden = false;
  achievementsClose.focus({ preventScroll: true });
}

function closeAchievements(): void {
  achievementsPanel.hidden = true;
  if (achievementBackground) achievementBackground.inert = false;
  achievementOpener?.focus({ preventScroll: true });
  achievementBackground = null;
}

/** Persists a board once; starting directly from Play must roll it too. */
function prepareBounties(): readonly Bounty[] {
  const next = bountyBoard(save, nextSea());
  if (next !== save) setSave(next);
  return save.bounties?.list ?? [];
}

function vibrate(ms: number): void {
  if (display.settings.haptics && typeof navigator.vibrate === "function") navigator.vibrate(ms);
}

function showHub(): void {
  world = null;
  stats = BASE_STATS;
  renderHub();
  showOnly("hub");
}

function renderHub(): void {
  const complete = isTreeComplete(save.upgrades);
  const list = prepareBounties();
  const emptyFacts = { caught: {}, maxComboMult: 1, goldenCaught: 0, chestsOpened: 0,
    bestTickCatches: 0, earned: 0, frenzyCaught: 0 };
  renderBounties(element("#hub-bounties"), bountyResult(list, emptyFacts).items.map((b) => ({ ...b, failed: false })), "hub");
  updateAchievementCounts();
  hub.name.textContent = save.playerName;
  hub.round.textContent = complete ? "Final Round next" : `Round ${save.round} next`;
  setMoney(hub.money, save.money);
  const frenzy = isFrenzyRound({ round: save.round, final: complete });
  const sea = nextSea();
  hub.hint.textContent = hint(complete, frenzy, sea);
  hub.start.textContent = complete ? "Final Round" : "Start Round";
  hub.start.classList.toggle("is-final", complete);
  // A badge as well as the hint, which compact screens hide.
  hub.start.classList.toggle("has-frenzy", frenzy);
  hub.start.classList.toggle("has-weather", sea !== "clear");
  hub.start.dataset.sea = sea;
  if (sea !== "clear") {
    const badge = document.createElement("span");
    badge.className = "weather-badge";
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.className = "weather-badge-icon";
    icon.innerHTML = weatherIcon(sea, 14);
    badge.append(icon, ` ${seaLabel(sea)}`);
    hub.start.append(badge);
  }
  tree.update({ money: save.money, upgrades: save.upgrades });
}

function hint(complete: boolean, frenzy: boolean, sea: SeaState): string {
  if (sea === "storm") return "Storm this round: fish drift with the wind.";
  if (sea === "fog") return "Fog this round: your lantern and net keep fish in sight.";
  if (sea === "bloom") return "Algal Bloom this round: more fish, slower and tougher.";
  if (complete) return "Every upgrade is yours. One last round to go.";
  // Short, so it fits beside Start Round on a phone.
  if (frenzy) return "Feeding Frenzy this round!";
  if (TECH_NODES.some((node) => canBuy(node, save.upgrades, save.money))) {
    return touchLayout.matches ? "Tap a glowing upgrade, then Buy." : "Click a glowing upgrade to buy it.";
  }
  return "Catch more fish to afford the next upgrade.";
}

function startRound(): void {
  activeBounties = prepareBounties();
  beginSession(false);
}

function startEndless(): void {
  if (!endlessUnlocked(save)) return;
  activeBounties = [];
  beginSession(true);
}

function beginSession(endless: boolean): void {
  finalRound = !endless && isTreeComplete(save.upgrades);
  playingRound = save.round;
  stats = applyDevOverrides(applyUpgrades(BASE_STATS, save.upgrades));
  completedBounties.clear();
  hud.root.dataset.mode = endless ? "endless" : "round";
  element("#hud-endless").hidden = !endless;
  element("#harbour-button").hidden = !endless;
  renderBounties(element("#hud-bounties"), [], "hud");
  world = null;
  seaBannerUntil = biomeBannerUntil = 0;
  seaBanner.hidden = biomeBanner.hidden = true;
  showOnly("round");
  resize();
  world = new World(stats, createRng(Date.now()), viewport.worldWidth, viewport.worldHeight, {
    round: playingRound, final: finalRound, endless, sea: endless ? undefined : nextSea(), guarantee: bountyGuarantees(activeBounties),
  });
  if (endless && import.meta.env.DEV) {
    const seconds = Number(new URLSearchParams(location.search).get("endlessTime"));
    advanceEndless(world, seconds);
    if (seconds > 0 && Number.isFinite(seconds)) announceBiome(world.biome!.biome);
  }
  if (world.sea !== "clear") announceSea(world.sea);
  audio.screen("round", audioContext());
  trapHint = !endless && stats.rigging.count > 0 && takeToolHint(save.createdAt, "trap");
  if (stats.boat.chum && takeToolHint(save.createdAt, "chum")) showToast("Press Space or tap the bucket to throw chum");
  updateHud();
  resize();
  accumulator = 0;
  lastFrame = performance.now();
  roundHint.textContent = trapHint ? "Trap nets snap shut on fish that swim over them" : touchLayout.matches
    ? "Hold and drag to fish. Your net floats above your finger."
    : "Move your net over the fish. It catches them on its own.";
}

/** The only exit from an Endless trip; records it exactly once and never banks its catch. */
function finishEndless(): void {
  if (!world?.endless || world.over) return;
  const finished = world;
  finished.finish();
  const before = save.endless;
  const durationMs = Math.round(finished.elapsed * 1000);
  setSave(recordEndless(save, { earned: finished.earned, caught: finished.caught,
    durationMs, maxCombo: finished.maxComboMult, goldenCaught: finished.bonusCount.golden,
    chestsOpened: finished.bonusCount.treasure, bestTickCatches: finished.bestTickCatches,
    bestStarHits: finished.bestStarHits }));
  element("#endless-earned").textContent = formatMoney(finished.earned);
  element("#endless-fish").textContent = finished.totalCaught.toLocaleString("en-US");
  element("#endless-time").textContent = formatSeaTime(finished.elapsed);
  element("#endless-biomes").textContent = `Biomes visited: ${[...finished.biomesReached].map(biomeLabel).join(" · ")}`;
  element("#endless-combo").textContent = `×${finished.maxComboMult.toFixed(1)}`;
  element("#endless-records").replaceChildren(...endlessRecordsDiff(before, save.endless).map((label) => {
    const chip = document.createElement("span");
    chip.textContent = `✦ ${label}`;
    return chip;
  }));
  showOnly("endless");
  checkAchievements({ endlessSessionMs: durationMs, biomesReached: [...finished.biomesReached],
    graveyardChests: finished.graveyardChests });
}

function endRound(finished: World): void {
  const bounties = bountyResult(activeBounties, bountyFacts(finished));
  const recorded = recordRound(save, {
    earned: finished.earned,
    caught: finished.caught,
    durationMs: Math.round(finished.elapsed * 1000),
    goldenCaught: finished.bonusCount.golden,
    chestsOpened: finished.bonusCount.treasure,
    maxCombo: finished.maxComboMult, bestTickCatches: finished.bestTickCatches,
    bestStarHits: finished.bestStarHits, bountiesCompleted: bounties.completed,
    bountyReward: bounties.reward, allBounties: bounties.all,
  });
  setSave(finalRound ? { ...recorded, finalRoundDone: true } : recorded);

  summary.title.textContent = finalRound ? "Final Round complete" : `Round ${playingRound} complete`;
  const total = finished.earned + bounties.reward;
  summary.earned.textContent = formatMoney(total);
  renderBounties(element("#summary-bounties"), bounties.items, "summary");
  // Frenzy earnings are already in the fish table; bounty rewards are added to the headline.
  const extras: SummaryExtra[] = [];
  if (finished.frenzy) extras.push({ key: "frenzy", icon: "frenzy", label: "Feeding Frenzy:",
    detail: `from ${finished.frenzyCaught.toLocaleString("en-US")} fish`, amount: finished.frenzyEarned });
  if (finished.trapCatches > 0) extras.push({ key: "traps", icon: "traps", label: "Trap nets:",
    detail: `${finished.trapCatches.toLocaleString("en-US")} fish` });
  if (finished.sea !== "clear") extras.push({ key: "sea", icon: finished.sea,
    label: finished.sea === "bloom" ? "Algal Bloom" : `${seaLabel(finished.sea)} bonus`,
    detail: finished.sea === "storm" ? `catches ×${SEA.stormValue}` : finished.sea === "fog" ? `catches ×${SEA.fogValue}` : undefined,
    amount: finished.sea === "bloom" ? undefined : finished.seaEarned });
  if (activeBounties.length > 0) extras.push({ key: "bounties", icon: "bounties", label: "Bounties", amount: bounties.reward });
  renderSummaryExtras(summary.bonuses, extras);
  summary.fish.textContent = finished.totalCaught.toLocaleString("en-US");
  // The table adds up its own rows; bounty money shows in the headline and the bonus ledger.
  summary.total.textContent = formatMoney(finished.earned);
  const rows = summaryRows(finished);
  summary.rows.replaceChildren(...rows.map(summaryRow));
  summary.table.hidden = rows.length === 0;
  summary.empty.hidden = rows.length > 0;
  showOnly("summary");
  if (!reducedMotion.matches) {
    countUp = { amount: total, start: performance.now() };
    summary.earned.classList.add("is-counting");
    summary.earned.textContent = formatMoney(0);
  }
  checkAchievements({ allBounties: bounties.all });
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
  placeRoundBanners();
  const safeBottom = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom")) || 0;
  // The contact strip lets a finger reach below the sea while the net stays above it.
  const bottom = safeBottom + (touchLayout.matches && document.body.classList.contains("playing") ? 56 : 0);
  viewport = createViewport(width, height, top, bottom);
  netInput.clear();
  const density = touchLayout.matches ? Math.min(window.devicePixelRatio || 1, 2) : window.devicePixelRatio || 1;
  renderer.resize(width, height, density, viewport);
  world?.resize(viewport.worldWidth, viewport.worldHeight);
  measureCoinTarget();
  measureSettingsBounds();
}

/** Read layout only on HUD start/mode/resize, never from the frame loop. */
function measureCoinTarget(): void {
  if (hud.root.hidden) { coinTarget = null; return; }
  const rect = hud.earned.getBoundingClientRect();
  coinTarget = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Header height changes with phone orientation, names and upgrade hints. */
function measureSettingsBounds(): void {
  if (hub.root.hidden) return;
  const bottom = element(".hub-bar").getBoundingClientRect().bottom - (window.visualViewport?.offsetTop ?? 0);
  hubTools.style.setProperty("--settings-header-bottom", `${bottom}px`);
}

function setToolsOpen(open: boolean): void {
  const fromTitle = screen === "title";
  if (open) {
    toolsOpener = fromTitle ? titleSettings : toolsToggle;
    if (fromTitle) document.body.append(hubTools);
    hubTools.classList.toggle("is-title-settings", fromTitle);
    if (!fromTitle) measureSettingsBounds();
  }
  hubTools.classList.toggle("is-open", open);
  hubTools.hidden = !open;
  toolsToggle.setAttribute("aria-expanded", String(open && !fromTitle));
  titleSettings.setAttribute("aria-expanded", String(open && fromTitle));
  titleSettings.setAttribute("aria-controls", "hub-tools");
  if (!open && hubTools.parentElement === document.body) {
    element(".hub-bar").append(hubTools);
    hubTools.classList.remove("is-title-settings");
  }
  if (open && fromTitle) element<HTMLButtonElement>("#hub-tools-close").focus({ preventScroll: true });
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
  element("#harbour-button").hidden = !world.endless;
  audio.screen("hub", audioContext());
  resumeButton.focus({ preventScroll: true });
}

function resumeRound(): void {
  if (!world || world.over || document.hidden) return;
  paused = false;
  hud.root.dataset.paused = "false";
  pausePanel.hidden = true;
  accumulator = 0;
  lastFrame = performance.now();
  audio.screen("round", audioContext());
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
  chumControl.update(world, paused);
  const playing = !world.over;
  setText(hud.round, world.endless ? "Endless Sea" : finalRound ? "Final Round" : `Round ${playingRound}`);
  if (!world.endless) {
    setText(hud.timer, `${world.timeLeft.toFixed(1)}s`);
    hud.timer.setAttribute("aria-label", `${world.timeLeft.toFixed(1)} seconds left`);
  } else {
    setText(element("#hud-endless-fish"), world.totalCaught.toLocaleString("en-US"));
    setText(element("#hud-endless-time"), formatSeaTime(world.elapsed));
    setText(element("#hud-endless-best"), `×${world.maxComboMult.toFixed(1)}`);
    const biome = world.biome!;
    setText(element("#hud-biome"), biomeLabel(biome.biome));
    setText(element("#hud-biome-next"), `${formatSeaTime(Math.ceil(BIOME.length * (1 - biome.progress)))} to next biome`);
    setText(element("#hud-weather"), `${seaLabel(world.sea)}${world.sea === "clear" ? " weather" : ` · ${Math.ceil(world.seaLeft)}s left`}`);
  }
  element("#hud-weather").hidden = !world.endless;
  hud.root.classList.toggle("is-urgent", !world.endless && playing && world.timeLeft <= 5);
  setMoney(hud.money, save.money);
  const combo = world.combo > 0 ? `Combo ×${world.comboMult.toFixed(1)}` : "";
  const earnings = touchLayout.matches ? formatCompactMoney(world.earned) : formatMoney(world.earned);
  setText(hud.earned, `+${earnings}`);
  setText(hud.combo, playing ? combo : "");
  const showHint = playing && world.elapsed < HINT_SECONDS && (trapHint || (!world.endless && playingRound === 1 && world.totalCaught === 0));
  if (roundHint.hidden === showHint) roundHint.hidden = !showHint;
  updateFrenzyBanner(world, playing);
  seaBanner.hidden = !playing || world.elapsed >= seaBannerUntil;
  biomeBanner.hidden = !playing || world.elapsed >= biomeBannerUntil;
  const items = bountyResult(activeBounties, bountyFacts(world)).items;
  renderBounties(element("#hud-bounties"), items.map((b) => ({ ...b, failed: false })), "hud");
  items.forEach((item, index) => {
    const id = activeBounties[index]!.id;
    if (!item.done || completedBounties.has(id)) return;
    completedBounties.add(id);
    audio.bounty();
    renderer.shake(3);
    vibrate(20);
    if (!reducedMotion.matches) element("#hud-bounties").animate([
      { backgroundColor: "#ffd58688" }, { backgroundColor: "transparent" },
    ], { duration: 350 });
  });
}

/** Shows the Feeding Frenzy banner while the wave runs, with a bar that empties as it does. */
function updateFrenzyBanner(world: World, playing: boolean): void {
  const wave = world.frenzy;
  const show = playing && wave !== null && world.frenzyActive;
  if (frenzyBanner.root.hidden === show) {
    frenzyBanner.root.hidden = !show;
    if (show) placeRoundBanners();
  }
  if (!show) return;
  const left = world.frenzyLeft;
  setText(frenzyBanner.value, `Every catch ×${Number(world.stats.frenzyValueMult.toFixed(2))}`);
  setText(frenzyBanner.time, `· ${Math.ceil(left)}s`);
  frenzyBanner.fill.style.transform = `scaleX(${(left / (wave.end - wave.start)).toFixed(3)})`;
}

/** Measure on entry/resize, keeping stacked banners clear of the HUD and bounty checklist. */
function placeRoundBanners(): void {
  const bounties = element("#hud-bounties");
  roundBanners.style.top = `${Math.max(hud.root.getBoundingClientRect().bottom,
    bounties.hidden ? 0 : bounties.getBoundingClientRect().bottom) + 6}px`;
}

/** Announcements use simulation time, so pausing also pauses their three-second lifetime. */
function announceSea(sea: SeaState): void {
  if (!world || sea === "clear") return;
  const icon = document.createElement("span");
  icon.className = "weather-banner-icon";
  icon.innerHTML = weatherIcon(sea, 18);
  seaBanner.replaceChildren(icon, ` ${seaBlurb(sea)}`);
  seaBannerUntil = world.elapsed + BANNER_SECONDS;
  seaBanner.hidden = false;
  placeRoundBanners();
}

function announceBiome(biome: Biome): void {
  if (!world) return;
  biomeBanner.textContent = `Entering the ${biomeLabel(biome)}`;
  biomeBannerUntil = world.elapsed + BANNER_SECONDS;
  biomeBanner.hidden = false;
  placeRoundBanners();
}

/** True once per whole minute of a trip, so endless achievement checks stay cheap. */
function crossedMinute(before: number, after: number): boolean {
  return Math.floor(Math.max(0, before) / 60) !== Math.floor(after / 60);
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
      if (world.over && !world.endless) {
        updateHud();
        endRound(world);
        break;
      }
    }
    // Lost at Sea and Sea Legs unlock the moment a trip reaches them, not only when it ends.
    if (world.endless && !world.over && crossedMinute(world.elapsed - dt, world.elapsed)) {
      checkAchievements({ endlessSessionMs: Math.round(world.elapsed * 1000) });
    }
  }
  if (world) {
    const events = world.drainEvents();
    for (const event of events) {
      renderer.onEvent(event);
      if (screen !== "round") continue;
      if (event.type === "sea" && event.phase === "start") announceSea(event.state);
      if (event.type === "biome") {
        announceBiome(event.biome);
        audio.screen("round", audioContext());
      }
    }
    audio.frame(events, world);
    const captures = events.filter((e) => e.type === "capture").length;
    if (events.some((e) => e.type === "chest-open")) vibrate(30);
    else if (captures >= 8 || events.some((e) => e.type === "fx" &&
      ((e.kind === "star" && e.name === "launch") || (e.kind === "monster" && e.name === "implode")))) vibrate(15);
  }

  renderer.draw({ world, pointer, stats, finger, coinTarget,
    timeOfDay: world?.endless ? devTime ?? world.timeOfDay : undefined }, paused ? 0 : dt);
  if (renderer.drainCoinArrivals() > 0 && screen === "round" && !reducedMotion.matches) {
    // Cancel/restart through the animation API: no forced layout to retrigger the bump.
    for (const animation of hud.earned.getAnimations()) animation.cancel();
    hud.earned.classList.add("is-bumping");
    const bump = hud.earned.animate([{ scale: "1" }, { scale: "1.12", offset: 0.35 }, { scale: "1" }], { duration: 180 });
    bump.onfinish = () => hud.earned.classList.remove("is-bumping");
  }
  if (screen === "round") updateHud();
  if (countUp) {
    const progress = reducedMotion.matches ? 1 : Math.min(1, (now - countUp.start) / 800);
    summary.earned.textContent = formatMoney(countUp.amount * (1 - (1 - progress) ** 3));
    if (progress === 1) { countUp = null; summary.earned.classList.remove("is-counting"); }
  }
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
  if (!hubTools.contains(event.target as Node) && !toolsToggle.contains(event.target as Node) && !titleSettings.contains(event.target as Node)) setToolsOpen(false);
});
window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
  if (!achievementsPanel.hidden) {
    if (event.key === "Escape") { event.preventDefault(); closeAchievements(); }
    if (event.key === "Tab") { event.preventDefault(); achievementsClose.focus(); }
    return;
  }
  if (event.key === "Escape" && !hubTools.hidden) {
    event.preventDefault();
    setToolsOpen(false);
    toolsOpener.focus({ preventScroll: true });
    return;
  }
  if (event.key === "Escape" && world && !world.over) {
    event.preventDefault();
    if (paused) resumeRound();
    else pauseRound();
  }
  if (isChumKey(event) && screen === "round" && world?.stats.boat.chum && !world.over && !paused) {
    event.preventDefault();
    world.chum();
  }
});

resize();
requestAnimationFrame(frame);

// The sea keeps drawing behind the name prompt on a first visit.
const loaded = await loadOrCreateSave();
save = loaded.save;
returningPlayer = !loaded.isNew;

const tree = mountTechTree(hub.tree, {
  onBuy(nodeId) {
    const result = buy(save.upgrades, save.money, nodeId);
    if (!result) return;
    setSave({ ...save, ...result });
    audio.purchase(nodeId, save.upgrades);
    if (nodeId === "boat.chum" && takeToolHint(save.createdAt, "chum")) showToast("Press Space or tap the bucket to throw chum");
    renderHub();
  },
});
mountSaveControls(hub.save, {
  getSave: () => save,
  nodes: TECH_NODES,
  onImport(imported) {
    setSave(imported);
    returningPlayer = true;
    checkAchievements({}, true);
    showTitle();
  },
});
hub.start.addEventListener("click", startRound);
titlePlay.addEventListener("click", showHome);
titleEndless.addEventListener("click", startEndless);
titleSettings.addEventListener("click", () => setToolsOpen(hubTools.hidden === true));
element("#hub-tools-close").addEventListener("click", () => {
  setToolsOpen(false);
  toolsOpener.focus({ preventScroll: true });
});
element("#hub-home").addEventListener("click", showTitle);
element("#title-achievements").addEventListener("click", () => openAchievements(element("#title-achievements")));
hubAchievements.addEventListener("click", () => openAchievements(hubAchievements));
achievementsClose.addEventListener("click", closeAchievements);
element("#harbour-button").addEventListener("click", finishEndless);
element("#endless-again").addEventListener("click", startEndless);
element("#endless-harbour").addEventListener("click", showTitle);
element("#help-button").addEventListener("click", () => {
  setToolsOpen(false);
  void showIntro({ playerName: save.playerName, mode: "replay" });
});
element("#continue-button").addEventListener("click", showHome);
element("#play-again-button").addEventListener("click", () => {
  setSave(resetProgress(save));
  showHome();
});

// New players learn the basics before arriving at the title.
checkAchievements({}, true);
if (loaded.isNew) await showIntro({ playerName: save.playerName, mode: "first" });
showTitle();
