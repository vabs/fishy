// Dev harness for the save UI: http://localhost:5173/dev/save.html
import { formatMoney } from "../src/format";
import { grantAchievements, newAchievements } from "../src/game/achievements";
import {
  createSave,
  loadSave,
  recordRound,
  recordEndless,
  resetProgress,
  sanitizeUpgrades,
  writeSave,
  type NodeInfo,
  type SaveData,
} from "../src/save";
import "../src/style.css";
import { promptForName } from "../src/ui/name-prompt";
import { mountSaveControls } from "../src/ui/save-controls";

/** Stand-in for the tech tree. */
const NODES: readonly NodeInfo[] = [
  { id: "net.size", maxLevel: 5 },
  { id: "net.damage", maxLevel: 10 },
  { id: "time.length", maxLevel: 3 },
];

function element<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

let save: SaveData = await boot();

async function boot(): Promise<SaveData> {
  const stored = loadSave();
  if (stored) return { ...stored, upgrades: sanitizeUpgrades(stored.upgrades, NODES) };
  return newSave();
}

async function newSave(): Promise<SaveData> {
  element("#hub").hidden = true;
  const fresh = createSave(await promptForName());
  writeSave(fresh);
  return fresh;
}

function update(next: SaveData): void {
  save = grantAchievements(next, newAchievements(next).map((achievement) => achievement.id));
  writeSave(save);
  render();
}

function render(): void {
  element("#hub").hidden = false;
  element("#hub-name").textContent = save.playerName;
  element("#hub-round").textContent = String(save.round);
  element("#hub-money").textContent = formatMoney(save.money);
  element("#hub-upgrades").textContent = String(Object.values(save.upgrades).reduce((a, b) => a + b, 0));
  element("#hub-achievements").textContent = String(Object.keys(save.achievements).length);
  element("#hub-endless").textContent = String(save.endless.sessions);
  element("#dump").textContent = JSON.stringify(save, null, 2);
}

element("#play-round").addEventListener("click", () => {
  const caught = { normal: 5 + Math.floor(Math.random() * 20), uncommon: Math.floor(Math.random() * 5) };
  update(recordRound(save, {
    earned: caught.normal * 10 + caught.uncommon * 40, caught, durationMs: 30_000,
    goldenCaught: 1, chestsOpened: 1, maxCombo: 1.5, bestTickCatches: 5, bestStarHits: 0,
  }));
});
element("#play-endless").addEventListener("click", () => {
  update(recordEndless(save, {
    earned: 5000, caught: { normal: 400, uncommon: 25 }, durationMs: 600_000,
    goldenCaught: 3, chestsOpened: 2, maxCombo: 2,
  }));
});
element("#play-again").addEventListener("click", () => update(resetProgress(save)));
element("#buy-upgrade").addEventListener("click", () => {
  const node = NODES[Math.floor(Math.random() * NODES.length)]!;
  const level = Math.min((save.upgrades[node.id] ?? 0) + 1, node.maxLevel);
  update({ ...save, upgrades: { ...save.upgrades, [node.id]: level } });
});
element("#new-save").addEventListener("click", async () => {
  save = await newSave();
  render();
});

mountSaveControls(element("#save-controls"), {
  getSave: () => save,
  nodes: NODES,
  onImport: update,
});
render();
