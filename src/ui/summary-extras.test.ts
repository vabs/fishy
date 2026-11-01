// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderSummaryExtras, type SummaryExtra } from "./summary-extras";

const frenzy: SummaryExtra = {
  key: "frenzy", icon: "frenzy", label: "Feeding Frenzy:", detail: "from 56 fish", amount: 1842.9,
};
const traps: SummaryExtra = { key: "traps", icon: "traps", label: "Trap nets:", detail: "65 fish" };

describe("summary extras", () => {
  it("keeps the supplied ledger order and the text used by round checks", () => {
    const container = document.createElement("section");
    renderSummaryExtras(container, [frenzy, traps,
      { key: "sea", icon: "storm", label: "Storm bonus", amount: 120 },
      { key: "bounties", icon: "bounties", label: "Bounties", amount: 50 },
    ]);
    expect(container.querySelector("h3")?.textContent).toBe("Bonuses this round");
    expect([...container.querySelectorAll<HTMLElement>("[data-key]:not([hidden])")].map((row) => row.dataset.key))
      .toEqual(["frenzy", "traps", "sea", "bounties"]);
    expect(container.querySelector("#summary-frenzy")?.textContent).toBe("Feeding Frenzy: +$1,842 from 56 fish");
    expect(container.querySelector("#summary-bounty-reward")?.textContent).toBe("Bounties +$50");
    expect(container.querySelectorAll("svg[aria-hidden=true]")).toHaveLength(4);
  });

  it("hides an empty ledger and shows it again when there are bonuses", () => {
    const container = document.createElement("section");
    renderSummaryExtras(container, []);
    expect(container.hidden).toBe(true);
    renderSummaryExtras(container, [traps]);
    expect(container.hidden).toBe(false);
    renderSummaryExtras(container, []);
    expect(container.hidden).toBe(true);
    expect(container.querySelectorAll("[data-key]:not([hidden])")).toHaveLength(0);
    expect(container.querySelector<HTMLElement>("#summary-traps")?.hidden).toBe(true);
  });

  it("formats whole-dollar amounts, including zero, and leaves absent amounts blank", () => {
    const container = document.createElement("section");
    renderSummaryExtras(container, [frenzy, traps,
      { key: "sea", icon: "fog", label: "Fog bonus", amount: 0 },
      { key: "bloom", icon: "bloom", label: "Algal Bloom" },
    ]);
    expect([...container.querySelectorAll<HTMLElement>("[data-key]:not([hidden]) .summary-extra-amount")].map((amount) => amount.textContent))
      .toEqual(["+$1,842", "", "+$0", ""]);
    expect(container.querySelector<HTMLElement>('[data-key="traps"] .summary-extra-amount')?.hidden).toBe(true);
    expect(container.querySelector<HTMLElement>('[data-key="bloom"] .summary-extra-detail')?.hidden).toBe(true);
  });

  it("does no DOM writes for unchanged facts and updates mutated facts in place", () => {
    const container = document.createElement("section");
    const current = { ...frenzy };
    renderSummaryExtras(container, [current]);
    const row = container.querySelector("[data-key]:not([hidden])");
    const observer = new MutationObserver(() => {});
    observer.observe(container, { attributes: true, childList: true, subtree: true, characterData: true });
    renderSummaryExtras(container, [{ ...current }]);
    expect(observer.takeRecords()).toHaveLength(0);
    current.amount = 2030;
    current.detail = "from 70 fish";
    renderSummaryExtras(container, [current]);
    expect(container.querySelector("[data-key]:not([hidden])")).toBe(row);
    expect(row?.textContent).toBe("Feeding Frenzy: +$2,030 from 70 fish");
    observer.disconnect();
  });

  it("retains keyed rows on reorder, hides unused hooks and clears optional facts", () => {
    const container = document.createElement("section");
    renderSummaryExtras(container, [frenzy, traps]);
    const first = container.querySelector("#summary-frenzy");
    const second = container.querySelector("#summary-traps");
    renderSummaryExtras(container, [traps, frenzy]);
    expect([...container.querySelectorAll("[data-key]:not([hidden])")]).toEqual([second, first]);
    renderSummaryExtras(container, [{ key: "frenzy", icon: "bloom", label: "<img src=x>" }]);
    expect(container.querySelector("[data-key]:not([hidden])")).toBe(first);
    expect(container.querySelector<HTMLElement>("#summary-traps")?.hidden).toBe(true);
    expect(first?.textContent).toBe("<img src=x>");
    expect(first?.querySelector("img")).toBeNull();
    expect(first?.querySelector<HTMLElement>(".summary-extra-amount")?.hidden).toBe(true);
    expect(first?.querySelector("svg path")?.getAttribute("d")).not.toBeNull();
  });

  it("keeps the hidden frenzy hook directly before traps in rounds without a frenzy", () => {
    const container = document.createElement("section");
    renderSummaryExtras(container, [traps]);
    expect(container.querySelector<HTMLElement>("#summary-frenzy")?.hidden).toBe(true);
    expect(container.querySelector("#summary-frenzy")?.nextElementSibling).toBe(container.querySelector("#summary-traps"));
    expect(container.querySelector("#summary-traps")?.textContent).toBe("Trap nets: 65 fish");
  });

  it("removes a sea-state row when the next round is clear", () => {
    const container = document.createElement("section");
    renderSummaryExtras(container, [{ key: "sea", icon: "storm", label: "Storm bonus", amount: 100 }]);
    renderSummaryExtras(container, [traps]);
    expect(container.querySelector('[data-key="sea"]')).toBeNull();
  });
});
