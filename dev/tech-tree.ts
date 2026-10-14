/*
 * Dev harness for the tech tree screen: http://localhost:5173/dev/tech-tree.html
 * State lives in localStorage so it survives reloads. URL options:
 *   ?budget=5000   start as if $5,000 had been spent on the cheapest nodes first
 *   ?money=250     start with this much money
 *   ?fresh         ignore the stored state
 */
import "../src/style.css";
import { formatMoney } from "../src/format";
import { TECH_NODES, buy, canBuy, isTreeComplete, levelOf, nextCost, type Upgrades } from "../src/game/tech";
import { mountTechTree } from "../src/ui/tech-tree";

const STORAGE_KEY = "fishy.dev.techTree";

interface State {
  money: number;
  upgrades: Upgrades;
}

function element<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

/** Buys the cheapest buyable node until `budget` runs out. */
function buyCheapest(state: State, budget = state.money): State {
  let { upgrades, money } = state;
  let left = budget;
  for (;;) {
    const options = TECH_NODES.filter((n) => canBuy(n, upgrades, Math.min(money, left)));
    if (options.length === 0) return { upgrades, money };
    const cheapest = options.reduce((a, b) => (nextCost(a, levelOf(a, upgrades)) <= nextCost(b, levelOf(b, upgrades)) ? a : b));
    const result = buy(upgrades, money, cheapest.id)!;
    left -= money - result.money;
    ({ upgrades, money } = result);
  }
}

function initialState(): State {
  const params = new URLSearchParams(location.search);
  let state: State = { money: Number(params.get("money") ?? 0), upgrades: {} };
  const budget = Number(params.get("budget") ?? 0);
  if (budget > 0) state = { ...buyCheapest({ money: budget, upgrades: {} }), money: state.money };
  if (params.has("budget") || params.has("money") || params.has("fresh")) return state;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as State;
  } catch {
    // Private mode or a bad value: start fresh.
  }
  return state;
}

let state = initialState();
const tree = mountTechTree(element("#tree"), {
  onBuy(nodeId) {
    const result = buy(state.upgrades, state.money, nodeId);
    if (result) render(result);
  },
});

function render(next: State): void {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Not important for a dev page.
  }
  element("#money").textContent = formatMoney(state.money);
  const levels = TECH_NODES.reduce((sum, n) => sum + levelOf(n, state.upgrades), 0);
  const total = TECH_NODES.reduce((sum, n) => sum + n.maxLevel, 0);
  element("#status").textContent = isTreeComplete(state.upgrades)
    ? "Tree complete: Final Round unlocked"
    : `${levels} / ${total} levels`;
  tree.update(state);
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-add]")) {
  button.addEventListener("click", () => render({ ...state, money: state.money + Number(button.dataset.add) }));
}
element("#cheapest").addEventListener("click", () => render(buyCheapest(state)));
element("#max").addEventListener("click", () =>
  render({ ...state, upgrades: Object.fromEntries(TECH_NODES.map((n) => [n.id, n.maxLevel])) }),
);
element("#reset").addEventListener("click", () => render({ money: 0, upgrades: {} }));

render(state);
