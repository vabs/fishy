import { WEATHER_PATHS } from "./icons";
import { formatMoney } from "../format";

/** One bonus in display order; amounts describe earnings already included in the headline. */
export interface SummaryExtra {
  key: string;
  icon: "frenzy" | "traps" | "storm" | "fog" | "bloom" | "bounties";
  label: string;
  detail?: string;
  amount?: number;
}

interface ExtraRow {
  el: HTMLDivElement;
  icon: HTMLSpanElement;
  label: HTMLSpanElement;
  amount: HTMLSpanElement;
  detail: HTMLSpanElement;
  signature: string;
}
const ledgers = new WeakMap<HTMLElement, Map<string, ExtraRow>>();
const hooks = ["frenzy", "traps", "bounties"] as const;
// Fixed SVG paths use the same 24px, round-stroke style as ui/icons.ts.
const paths: Record<SummaryExtra["icon"], string> = {
  frenzy: '<path d="M2 14q4-8 8 0t8 0l4-6M2 19q4-6 8 0t8 0"/><path d="m10 3-3 6h5l-2 4"/>',
  traps: '<path d="M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16"/>',
  storm: WEATHER_PATHS.storm,
  fog: WEATHER_PATHS.fog,
  bloom: WEATHER_PATHS.bloom,
  bounties: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="m9 11 2 2 4-5"/>',
};

function makeRow(key: string): ExtraRow {
  const el = document.createElement("div");
  el.className = "summary-extra-row";
  el.dataset.key = key;
  // Keep the public hooks used by round checks on the row containing their text.
  if (key === "frenzy" || key === "traps") el.id = `summary-${key}`;
  if (key === "bounties") el.id = "summary-bounty-reward";
  const [icon, label, amount, detail] = ["icon", "label", "amount", "detail"].map((part) => {
    const span = document.createElement("span");
    span.className = `summary-extra-${part}`;
    el.append(span);
    return span;
  }) as [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement, HTMLSpanElement];
  icon.setAttribute("aria-hidden", "true");
  return { el, icon, label, amount, detail, signature: "" };
}

/** Renders the round's bonus ledger, retaining rows by key between updates. */
export function renderSummaryExtras(container: HTMLElement, rows: SummaryExtra[]): void {
  let ledger = ledgers.get(container);
  if (!ledger) {
    ledger = new Map();
    ledgers.set(container, ledger);
    container.classList.add("summary-bonuses");
    const heading = document.createElement("h3");
    heading.className = "summary-section-title";
    heading.textContent = "Bonuses this round";
    container.append(heading);
    // Existing integrations also inspect these hooks in rounds without the bonus.
    for (const key of hooks) {
      const row = makeRow(key);
      row.el.hidden = true;
      ledger.set(key, row);
      container.append(row.el);
    }
  }
  if (container.hidden !== (rows.length === 0)) container.hidden = rows.length === 0;
  const keys = new Set(rows.map((row) => row.key));
  for (const [key, row] of ledger) {
    if (keys.has(key)) continue;
    if (hooks.some((hook) => hook === key)) {
      if (!row.el.hidden) row.el.hidden = true;
      continue;
    }
    row.el.remove();
    ledger.delete(key);
  }
  rows.forEach((facts) => {
    let row = ledger.get(facts.key);
    if (!row) {
      row = makeRow(facts.key);
      ledger.set(facts.key, row);
    }
    if (row.el.hidden) row.el.hidden = false;
    const signature = JSON.stringify([facts.icon, facts.label, facts.detail, facts.amount]);
    if (signature !== row.signature) {
      row.signature = signature;
      row.icon.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[facts.icon]}</svg>`;
      row.label.textContent = `${facts.label}${facts.amount !== undefined ? " " : ""}`;
      row.amount.textContent = facts.amount === undefined ? "" : `+${formatMoney(facts.amount)}`;
      row.amount.hidden = facts.amount === undefined;
      row.detail.textContent = facts.detail ? ` ${facts.detail}` : "";
      row.detail.hidden = !facts.detail;
    }
  });
  const order = rows.map((row) => row.key);
  if (!keys.has("frenzy")) order.unshift("frenzy");
  if (!keys.has("traps")) order.splice(order.indexOf("frenzy") + 1, 0, "traps");
  if (!keys.has("bounties")) order.push("bounties");
  order.forEach((key, index) => {
    const row = ledger.get(key)!;
    const position = container.children[index + 1] ?? null;
    if (position !== row.el) container.insertBefore(row.el, position);
  });
}
