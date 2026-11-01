/** Deterministic visual gallery. Uses the production shell; never starts main.ts or writes a save. */
import shell from "../index.html?raw";
import "../src/style.css";
import "../src/ui/audio-controls.css";
import "../src/ui/display-controls.css";
import "../src/ui/save-controls.css";
import { renderBounties, type BountyItem } from "../src/ui/bounties-view";
import { renderSummaryExtras, type SummaryExtra } from "../src/ui/summary-extras";
import {
  renderAchievements,
  paintBadgeIcon,
} from "../src/ui/achievements-view";
import { showAchievementToast } from "../src/ui/achievement-toast";
import { MIXER_ICON } from "../src/ui/icons";
import { mountTechTree } from "../src/ui/tech-tree";
import { mountDisplayControls } from "../src/ui/display-controls";
import { promptForName } from "../src/ui/name-prompt";
import { showIntro } from "../src/ui/intro";
import { ACHIEVEMENTS } from "../src/game/achievements";
import { FISH, FISH_KINDS, type FishKind } from "../src/game/fish";
import { buildSprites } from "../src/game/shapes";
import { fishColors, onPaletteChange, setPalette } from "../src/game/palette";
import {
  TECH_NODES,
  buy,
  canBuy,
  levelOf,
  nextCost,
  type Upgrades,
} from "../src/game/tech";
import { formatMoney } from "../src/format";

const parsed = new DOMParser().parseFromString(
  shell.replaceAll("%BASE_URL%", import.meta.env.BASE_URL),
  "text/html",
);
parsed.querySelectorAll("script").forEach((script) => script.remove());
document
  .querySelector("#gallery-stage")!
  .replaceChildren(...parsed.body.childNodes);

const galleryStyle = document.createElement("style");
galleryStyle.textContent = `
  .gallery-tools { position:fixed; bottom:calc(10px + env(safe-area-inset-bottom,0px)); left:50%; transform:translateX(-50%); z-index:100; max-width:calc(100vw - 24px); border:1px solid #d9a441; border-radius:10px; color:#fff7e6; background:#0d3b4ff5; font:700 11px "Nunito",sans-serif; box-shadow:0 3px 12px #092c3f55; }
  .gallery-tools summary { min-height:44px; display:flex; gap:10px; align-items:center; justify-content:center; padding:8px 14px; cursor:pointer; }
  .gallery-tools summary::before { content:"☷"; font-size:18px; } #gallery-current { color:#ffcc88; }
  .gallery-tools[open] { width:560px; padding:8px 12px 12px; max-height:65dvh; overflow:auto; }
  #gallery-nav { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; }
  #gallery-nav a { min-height:44px; display:grid; place-items:center; border:1px solid #8d9c92; border-radius:6px; text-decoration:none; color:#fff7e6; }
  #gallery-nav a[aria-current=page] { background:#f4a259; color:#3b2414; }
  .gallery-tools p { font-size:10px; margin:10px 0; color:#bbd5d8; } .gallery-tools label { display:flex; align-items:center; min-height:44px; }
  .gallery-return { margin-top:16px; font:800 12px "Nunito",sans-serif; color:#1f6f86; }
  .gallery-tools ~ * { box-sizing:border-box; }
  #gallery-stage *, #gallery-stage *::before, #gallery-stage *::after, .dialog[open], .intro-node.is-ready { animation:none !important; }
  @media(max-width:500px) { #gallery-nav { grid-template-columns:repeat(3,minmax(0,1fr)); } }
`;
document.head.append(galleryStyle);

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Gallery element missing: ${id}`);
  return element as T;
}
function text(id: string, value: string): void {
  el(id).textContent = value;
}
const scenes = [
  "title",
  "hub",
  "settings",
  "hud",
  "hud-endless",
  "hud-urgent",
  "frenzy",
  "pause",
  "summary",
  "summary-full",
  "endless",
  "achievements",
  "toast",
  "end",
  "name",
  "intro",
  "import",
] as const;
type Scene = (typeof scenes)[number];
for (const scene of scenes) {
  const link = document.createElement("a");
  link.href = `#${scene}`;
  link.textContent = scene;
  el("gallery-nav").append(link);
}
const earned = Object.fromEntries(
  ACHIEVEMENTS.slice(0, 7).map((a) => [a.id, "2026-10-20T12:00:00Z"]),
);
const bounties: BountyItem[] = [
  { label: "Catch 5 Rare fish", value: 3, target: 5, done: false, reward: 80 },
  {
    label: "Reach combo ×1.5",
    value: 1.5,
    target: 1.5,
    done: true,
    reward: 120,
  },
  {
    label: "Open the treasure chest",
    value: 0,
    target: 1,
    done: false,
    reward: 160,
  },
];
const summaryBounties = bounties.map((b, i) => ({
  ...b,
  done: i < 2,
  failed: i === 2,
}));
let state: { money: number; upgrades: Upgrades } = {
  money: 6200,
  upgrades: {},
};
// Follow the real progression just far enough to show several readable branches.
let spent = 0;
while (spent < 1600) {
  const available = TECH_NODES.filter((n) =>
    canBuy(n, state.upgrades, state.money),
  );
  if (!available.length) break;
  const cheapest = available.reduce((a, b) =>
    nextCost(a, levelOf(a, state.upgrades)) <
    nextCost(b, levelOf(b, state.upgrades))
      ? a
      : b,
  );
  const result = buy(state.upgrades, state.money, cheapest.id);
  if (!result) break;
  spent += state.money - result.money;
  state = result;
}
state.money = 1850;
const tree = mountTechTree(el("hub-tree"), {
  onBuy(nodeId) {
    const result = buy(state.upgrades, state.money, nodeId);
    if (!result) return;
    state = result;
    text("hub-money", formatMoney(state.money));
    tree.update(state);
  },
});

text("title-greeting", "Welcome back, Skipper.");
text("title-achievements-count", "7 / 22");
text("hub-name", "Skipper");
text("hub-round", "Round 15 next");
text("hub-money", "$1,850");
text("hub-hint", "Feeding Frenzy this round! Make every catch count.");
el("start-button").classList.add("has-frenzy");
text("hud-round", "Round 15");
text("hud-money", "$1,850");
text("hud-timer", "12.4s");
text("hud-earned", "+$2,640");
text("hud-combo", "Combo ×1.8");
text("hud-endless-fish", "248");
text("hud-endless-time", "08:42");
text("hud-endless-best", "×2.0");
text("frenzy-value", "Every catch ×1.5");
text("frenzy-time", "· 4s");
el("frenzy-bar-fill").style.transform = "scaleX(.72)";
text("endless-earned", "$24,860");
text("endless-fish", "1,248");
text("endless-time", "12 min 42 s");
text("endless-combo", "×2.4");
for (const record of ["✦ Most fish caught", "✦ Best session earnings"]) {
  const chip = document.createElement("span");
  chip.textContent = record;
  el("endless-records").append(chip);
}
text("achievements-count", "7 / 22");
text(
  "end-message",
  "You've mastered the sea, Skipper. Here's to every little catch along the way.",
);
text("end-rounds", "130");
text("end-fish", "48,213");
text("end-best", "$412,300");
text("end-time", "1 h 18 min");
text("toast", "Save exported. Your next adventure is safe and sound.");

const rowFish: [FishKind, number, number][] = [
  ["star", 14, 1024],
  ["goober", 20, 470],
  ["uncommon", 135, 575],
  ["rare", 9, 432],
  ["electric", 8, 296],
  ["normal", 16, 248],
];
const fullRowFish: [FishKind | "golden" | "treasure", number, number][] = [
  ["star", 22, 72936], ["goober", 70, 33786], ["electric", 63, 31619],
  ["monster", 8, 27930], ["golden", 7, 23436], ["rare", 67, 22763],
  ["epic", 53, 22414], ["uncommon", 345, 15505], ["treasure", 1, 15000], ["normal", 64, 1790],
];
function showSummary(full: boolean): void {
  const fish = full ? fullRowFish : rowFish;
  const rewards: BountyItem[] = full ? [
    { label: "Open the treasure chest", value: 0, target: 1, done: false, reward: 7800 },
    { label: "Net 8 fish in one sweep", value: 12, target: 8, done: true, reward: 6400 },
    { label: "Catch 22 Rare fish", value: 67, target: 22, done: true, reward: 5000 },
  ] : summaryBounties;
  const bountyReward = rewards.reduce((total, bounty) => total + (bounty.done ? bounty.reward : 0), 0);
  const fishEarnings = fish.reduce((total, [, , amount]) => total + amount, 0);
  text("summary-title", full ? "Round 50 complete" : "Round 15 complete");
  text("summary-earned", formatMoney(fishEarnings + bountyReward));
  text("summary-total", formatMoney(fishEarnings));
  text("summary-fish", fish.reduce((total, [kind, count]) => total + (kind === "treasure" ? 0 : count), 0).toLocaleString("en-US"));
  const extras: SummaryExtra[] = [
    { key: "frenzy", icon: "frenzy", label: "Feeding Frenzy:", detail: "from 56 fish", amount: full ? 32842 : 842 },
  ];
  if (full) extras.push(
    { key: "traps", icon: "traps", label: "Trap nets:", detail: "65 fish" },
    { key: "sea", icon: "storm", label: "Storm bonus", amount: 12735 },
  );
  extras.push({ key: "bounties", icon: "bounties", label: "Bounties", amount: bountyReward });
  renderSummaryExtras(el("summary-bonuses"), extras);
  renderBounties(el("summary-bounties"), rewards, "summary");
  el("summary-rows").replaceChildren(...fish.map(([kind, count, amount]) => {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    const label = document.createElement("span");
    label.className = "summary-fish";
    const canvas = document.createElement("canvas");
    canvas.dataset.icon = kind === "golden" ? "gold" : kind === "treasure" ? "chest" : `fish:${kind}`;
    canvas.setAttribute("aria-hidden", "true");
    label.append(canvas, kind === "golden" ? "Golden fish" : kind === "treasure" ? "Treasure chest" : FISH[kind].name);
    name.append(label);
    const caught = document.createElement("td");
    caught.textContent = count.toLocaleString("en-US");
    const money = document.createElement("td");
    money.textContent = formatMoney(amount);
    row.append(name, caught, money);
    paintBadgeIcon(canvas, canvas.dataset.icon);
    return row;
  }));
  el("summary-panel").hidden = false;
  el("summary-panel").querySelector(".summary-body")!.scrollTop = 0;
}

// Sound controls are local gallery controls; no audio engine or storage is started.
function audioControls(container: HTMLElement, hub: boolean): void {
  container.innerHTML = `<div class="audio-controls is-${hub ? "hub" : "hud"}">
    <button class="audio-button" type="button" data-action="mute" aria-label="Mute sound" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9Z"/><path fill="none" stroke="currentColor" stroke-width="2" d="M16 8q6 4 0 8"/></svg></button>
    ${hub ? `<button class="audio-button" type="button" data-action="volume" aria-label="Volume" aria-expanded="true">${MIXER_ICON}</button><div class="audio-panel"><label class="audio-slider"><span>Music</span><input aria-label="Music volume" type="range" value="65"/><output>65%</output></label><label class="audio-slider"><span>Effects</span><input aria-label="Effects volume" type="range" value="80"/><output>80%</output></label><p class="audio-panel-note">Press M to mute or unmute.</p></div>` : ""}</div>`;
  container
    .querySelector<HTMLButtonElement>("[data-action=mute]")!
    .addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const muted = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(muted));
      button.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
    });
  const volume = container.querySelector<HTMLButtonElement>(
    "[data-action=volume]",
  );
  volume?.addEventListener("click", () => {
    const panel = container.querySelector<HTMLElement>(".audio-panel")!;
    panel.hidden = !panel.hidden;
    volume.setAttribute("aria-expanded", String(!panel.hidden));
  });
  container
    .querySelectorAll<HTMLInputElement>("input[type=range]")
    .forEach((input) =>
      input.addEventListener("input", () => {
        input.nextElementSibling!.textContent = `${input.value}%`;
      }),
    );
}
audioControls(el("hub-audio"), true);
audioControls(el("hud-audio"), false);
// Mount the real display control, but intercept its click to avoid persisting a gallery preference.
mountDisplayControls(el("hub-display"));
el("hub-display").addEventListener(
  "click",
  (event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
    setPalette(
      el<HTMLInputElement>("gallery-palette").checked
        ? "standard"
        : "colorBlind",
    );
  },
  true,
);
el("hub-haptics").innerHTML =
  '<button class="display-toggle" data-action="haptics" type="button" aria-pressed="true"><span>Haptics</span><span class="display-toggle-state">On</span></button>';
el("hub-haptics")
  .querySelector("button")!
  .addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const enabled = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(enabled));
    button.querySelector("span:last-child")!.textContent = enabled
      ? "On"
      : "Off";
  });
el("hub-save").innerHTML =
  '<div class="save-controls"><div class="save-controls-buttons"><button class="save-controls-button" data-action="export" type="button">Export save</button><button class="save-controls-button" data-action="import" type="button">Import save</button></div><p class="save-controls-message" role="status">Progress saved · just now</p></div>';
el("hub-save")
  .querySelector("[data-action=export]")!
  .addEventListener("click", () => {
    el("hub-save").querySelector(".save-controls-message")!.textContent =
      "Gallery preview · no file downloaded";
  });
el("hub-save")
  .querySelector("[data-action=import]")!
  .addEventListener("click", () => {
    location.hash = "import";
  });

let cleanupDialog: (() => void) | undefined;
function returnLink(dialog: HTMLDialogElement): void {
  const link = document.createElement("a");
  link.className = "gallery-return";
  link.href = "#title";
  link.textContent = "Back to gallery";
  dialog.append(link);
}
function navigate(scene: Scene): void {
  location.hash = scene;
}
for (const [id, scene] of Object.entries({
  "title-play": "hub",
  "title-settings": "settings",
  "title-achievements": "achievements",
  "hub-home": "title",
  "start-button": "hud",
  "pause-button": "pause",
  "resume-button": "hud",
  "continue-button": "hub",
  "endless-again": "hud-endless",
  "endless-harbour": "hub",
  "achievements-close": "title",
  "play-again-button": "title",
  "help-button": "intro",
  "harbour-button": "endless",
})) {
  el(id).addEventListener("click", () => navigate(scene as Scene));
}
el("hub-tools-toggle").addEventListener("click", () => {
  const open = el("hub-tools").hidden;
  el("hub-tools").hidden = !open;
  el("hub-tools-toggle").setAttribute("aria-expanded", String(open));
});

const water = new Image();
water.src = `${import.meta.env.BASE_URL}art/sea-tile.webp`;
const boat = new Image();
boat.src = `${import.meta.env.BASE_URL}art/boat.png`;
await Promise.all([water.decode(), boat.decode(), document.fonts.ready]);
function drawSea(): void {
  const canvas = el<HTMLCanvasElement>("game");
  const width = innerWidth;
  const height = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const c = canvas.getContext("2d")!;
  c.scale(dpr, dpr);
  c.fillStyle = "#1f6f86";
  c.fillRect(0, 0, width, height);
  c.globalAlpha = 0.5;
  c.fillStyle = c.createPattern(water, "repeat")!;
  c.fillRect(0, 0, width, height);
  c.globalAlpha = 1;
  const net = {
    x: width * 0.64,
    y: height * 0.57,
    r: Math.min(120, width * 0.21),
  };
  for (let i = 0; i < 42; i++) {
    const x = (0.07 + ((i * 173) % 857) / 1000) * width;
    const y = (0.29 + ((i * 97) % 610) / 1000) * height;
    const s = buildSprites(FISH_KINDS[i % FISH_KINDS.length]!, dpr);
    const inside = Math.hypot(x - net.x, y - net.y) < net.r;
    c.save();
    c.translate(x, y);
    c.rotate(((i % 7) - 3) * 0.3);
    c.drawImage(
      inside ? s.full : s.silhouette,
      -s.width / 2,
      -s.height / 2,
      s.width,
      s.height,
    );
    c.restore();
  }
  c.save();
  c.beginPath();
  c.arc(net.x, net.y, net.r, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = "#e8fbff15";
  c.fillRect(net.x - net.r, net.y - net.r, net.r * 2, net.r * 2);
  c.strokeStyle = "#e8fbff18";
  c.lineWidth = 1;
  for (let n = -net.r; n < net.r; n += 14) {
    c.beginPath();
    c.moveTo(net.x + n, net.y - net.r);
    c.lineTo(net.x + n, net.y + net.r);
    c.stroke();
    c.beginPath();
    c.moveTo(net.x - net.r, net.y + n);
    c.lineTo(net.x + net.r, net.y + n);
    c.stroke();
  }
  c.restore();
  c.beginPath();
  c.arc(net.x, net.y, net.r, 0, Math.PI * 2);
  c.strokeStyle = "#e8fbffbb";
  c.lineWidth = 2;
  c.stroke();
  const bw = Math.min(144, width * 0.28);
  c.drawImage(boat, width * 0.48 - bw / 2, height * 0.54 - bw / 4, bw, bw / 2);
}
function repaint(): void {
  for (const kind of FISH_KINDS)
    document.documentElement.style.setProperty(
      `--fish-${kind}`,
      fishColors(kind).body,
    );
  renderAchievements(el("achievements-grid"), ACHIEVEMENTS, earned);
  document
    .querySelectorAll<HTMLCanvasElement>("#summary-rows canvas")
    .forEach((c) => paintBadgeIcon(c, c.dataset.icon!));
  drawSea();
}
onPaletteChange((palette) => {
  el<HTMLInputElement>("gallery-palette").checked = palette === "colorBlind";
  repaint();
});
el("gallery-palette").addEventListener("change", () =>
  setPalette(
    el<HTMLInputElement>("gallery-palette").checked ? "colorBlind" : "standard",
  ),
);
window.addEventListener("resize", () => {
  drawSea();
  if (!el("frenzy-banner").hidden) {
    el("frenzy-banner").style.top = `${el("hud").getBoundingClientRect().bottom + 8}px`;
  }
});
repaint();

function showScene(): void {
  cleanupDialog?.();
  cleanupDialog = undefined;
  const hash = location.hash.slice(1) as Scene;
  const scene: Scene = scenes.includes(hash) ? hash : "title";
  tree.dismiss();
  for (const id of [
    "title",
    "hub",
    "hud",
    "pause-panel",
    "summary-panel",
    "endless-panel",
    "achievements-panel",
    "end-panel",
    "toast",
    "achievement-toast",
    "round-hint",
    "frenzy-banner",
  ])
    el(id).hidden = true;
  el("hub-tools").hidden = true;
  el("hub-tools-toggle").setAttribute("aria-expanded", "false");
  el("hud").dataset.mode = scene === "hud-endless" ? "endless" : "round";
  el("hud").classList.toggle("is-urgent", scene === "hud-urgent");
  el("hud").dataset.paused = String(scene === "pause");
  text("hud-timer", scene === "hud-urgent" ? "4.2s" : "12.4s");
  text("gallery-current", scene);
  document
    .querySelectorAll<HTMLAnchorElement>("#gallery-nav a")
    .forEach((a) =>
      a.setAttribute("aria-current", a.hash === `#${scene}` ? "page" : "false"),
    );
  document.querySelector<HTMLDetailsElement>(".gallery-tools")!.open = false;
  document.body.dataset.galleryScene = scene;
  renderBounties(el("hub-bounties"), bounties, "hub");
  renderBounties(el("hud-bounties"), bounties, "hud");
  if (["hub", "settings"].includes(scene)) {
    el("hub").hidden = false;
    tree.update(state);
    if (scene === "settings") {
      el("hub-tools").hidden = false;
      el("hub-tools-toggle").setAttribute("aria-expanded", "true");
    }
  } else if (
    ["hud", "hud-endless", "hud-urgent", "frenzy", "pause"].includes(scene)
  ) {
    el("hud").hidden = false;
    el("hud-bounties").hidden = scene === "hud-endless";
    el("round-hint").hidden = scene !== "hud";
    el("frenzy-banner").hidden = scene !== "frenzy";
    if (scene === "frenzy")
      el("frenzy-banner").style.top =
        `${el("hud").getBoundingClientRect().bottom + 8}px`;
    el("pause-panel").hidden = scene !== "pause";
    // Preview the endless-only return action alongside the ordinary resume button.
    el("harbour-button").hidden = scene !== "pause";
  } else if (scene === "summary" || scene === "summary-full") showSummary(scene === "summary-full");
  else if (scene === "endless") el("endless-panel").hidden = false;
  else if (scene === "achievements") el("achievements-panel").hidden = false;
  else if (scene === "end") el("end-panel").hidden = false;
  else if (scene === "toast") {
    el("title").hidden = false;
    el("toast").hidden = false;
    // Exercise the real queue in a detached element; freeze a copy for reliable screenshots.
    const demo = document.createElement("div");
    showAchievementToast(demo, ACHIEVEMENTS[2]!);
    el("achievement-toast").replaceChildren(
      ...[...demo.childNodes].map((n) => n.cloneNode(true)),
    );
    el("achievement-toast").hidden = false;
    el("achievement-toast")
      .querySelectorAll<HTMLCanvasElement>("canvas")
      .forEach((canvas) => paintBadgeIcon(canvas, ACHIEVEMENTS[2]!.icon));
  } else if (scene === "name") {
    el("title").hidden = false;
    void promptForName().then(() => {
      if (location.hash === "#name") navigate("intro");
    });
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    input.value = "Skipper";
    cleanupDialog = () => {
      input.value = "Skipper";
      dialog
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { cancelable: true }));
    };
    returnLink(dialog);
  } else if (scene === "intro") {
    el("title").hidden = false;
    void showIntro({ playerName: "Skipper", mode: "replay", staticDemo: true }).then(() => {
      if (location.hash === "#intro") navigate("hub");
    });
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
    cleanupDialog = () =>
      dialog.querySelector<HTMLButtonElement>("[data-action=skip]")!.click();
    returnLink(dialog);
  } else if (scene === "import") {
    el("hub").hidden = false;
    tree.update(state);
    const dialog = document.createElement("dialog");
    dialog.className = "dialog";
    dialog.innerHTML =
      '<form method="dialog"><h2>Import save</h2><p>Replace your current save (<strong>Skipper</strong>, round 15, $1,850) with <strong>Captain Willow</strong>, round 32, $8,240?</p><p class="dialog-note">Your current progress will be lost. Export it first if you want to keep it.</p><div class="dialog-actions"><button class="dialog-button is-secondary" value="cancel">Cancel</button><button class="dialog-button" value="replace">Replace</button></div></form>';
    document.body.append(dialog);
    dialog.showModal();
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        navigate("settings");
      },
      { once: true },
    );
    cleanupDialog = () => dialog.remove();
    returnLink(dialog);
  } else el("title").hidden = false;
}
window.addEventListener("hashchange", showScene);
showScene();
