import { formatMoney } from "../format";

/** Presentation-ready bounty facts; the view never changes game or save state. */
export interface BountyItem {
  label: string;
  value: number;
  target: number;
  done: boolean;
  reward: number;
  failed?: boolean;
  /** HUD progress, e.g. "$2,567/$31K" or "×1.4/×1.5"; defaults to whole numbers. */
  progressText?: string;
}

type Variant = "hub" | "hud" | "summary";
interface Row {
  el: HTMLDivElement;
  mark: HTMLSpanElement;
  label: HTMLSpanElement;
  progress: HTMLSpanElement;
  reward: HTMLSpanElement;
  signature: string;
}
interface Board {
  variant: Variant;
  rows: Row[];
}
const boards = new WeakMap<HTMLElement, Board>();

function makeRow(): Row {
  const el = document.createElement("div");
  el.className = "bounty-row";
  const spans = ["mark", "label", "progress", "reward"].map((part) => {
    const span = document.createElement("span");
    span.className = `bounty-${part}`;
    el.append(span);
    return span;
  });
  spans[0]!.setAttribute("aria-hidden", "true");
  return {
    el,
    mark: spans[0]!,
    label: spans[1]!,
    progress: spans[2]!,
    reward: spans[3]!,
    signature: "",
  };
}

/** Updates by index, retaining row elements and skipping all DOM writes when facts are unchanged. */
export function renderBounties(
  container: HTMLElement,
  items: BountyItem[],
  variant: Variant,
): void {
  let board = boards.get(container);
  if (!board) {
    board = { variant, rows: [] };
    boards.set(container, board);
    container.classList.add("bounties", `is-${variant}`);
  } else if (board.variant !== variant) {
    container.classList.remove(`is-${board.variant}`);
    container.classList.add(`is-${variant}`);
    board.variant = variant;
    for (const row of board.rows) row.signature = "";
  }
  const shown = variant === "hud" ? items.slice(0, 3) : items;
  if (container.hidden !== (shown.length === 0))
    container.hidden = shown.length === 0;
  while (board.rows.length > shown.length) board.rows.pop()!.el.remove();
  shown.forEach((item, index) => {
    let row = board.rows[index];
    if (!row) {
      row = makeRow();
      board.rows.push(row);
      container.append(row.el);
    }
    // Store values, never the caller's object: live facts may be mutated in place.
    const signature = JSON.stringify([
      item.label,
      item.value,
      item.target,
      item.done,
      item.reward,
      item.failed,
    ]);
    if (signature === row.signature) return;
    row.signature = signature;
    const done = item.done && !item.failed;
    row.el.classList.toggle("is-done", done);
    row.el.classList.toggle(
      "is-failed",
      Boolean(item.failed) || (variant === "summary" && !done),
    );
    row.mark.textContent =
      variant === "hub"
        ? "⚑"
        : done
          ? "✓"
          : variant === "summary" || item.failed
            ? "✕"
            : "○";
    row.label.textContent = item.label;
    row.progress.textContent = item.progressText ?? `${Math.floor(Math.min(item.value, item.target))}/${item.target}`;
    row.progress.hidden = variant !== "hud";
    if (variant === "summary") {
      const amount = document.createElement("span");
      amount.className = "bounty-amount";
      amount.textContent = `${done ? "+" : ""}${formatMoney(item.reward)}`;
      row.reward.replaceChildren(amount);
      if (!done) {
        const status = document.createElement("span");
        status.className = "bounty-unearned";
        status.textContent = " · Not earned";
        row.reward.append(status);
      }
    } else {
      row.reward.textContent = `+${formatMoney(item.reward)}`;
    }
    row.reward.hidden = variant === "hud";
    row.el.setAttribute(
      "aria-label",
      variant === "hud"
        ? `${item.label}, ${row.progress.textContent}${done ? ", complete" : ""}`
        : `${item.label}, ${variant === "summary" ? (done ? "complete, " : "incomplete, ") : "reward "}${row.reward.textContent}`,
    );
  });
}
