// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderBounties, type BountyItem } from "./bounties-view";

const item: BountyItem = {
  label: "Catch 5 Rare fish",
  value: 3,
  target: 5,
  done: false,
  reward: 80,
};

describe("bounty views", () => {
  it("updates progress in place, including when the caller mutates an item", () => {
    const container = document.createElement("div");
    const current = { ...item };
    renderBounties(container, [current], "hud");
    const row = container.firstElementChild;
    expect(container.textContent).toContain("3/5");
    current.value = 5;
    current.done = true;
    renderBounties(container, [current], "hud");
    expect(container.firstElementChild).toBe(row);
    expect(container.textContent).toContain("5/5");
    expect(row?.classList.contains("is-done")).toBe(true);
    expect(container.textContent).toContain("✓");
  });

  it("does no DOM writes for identical values and hides an empty board", () => {
    const container = document.createElement("div");
    renderBounties(container, [item], "hud");
    const observer = new MutationObserver(() => {});
    observer.observe(container, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
    renderBounties(container, [{ ...item }], "hud");
    expect(observer.takeRecords()).toHaveLength(0);
    renderBounties(container, [], "hud");
    expect(container.hidden).toBe(true);
    expect(container.children).toHaveLength(0);
  });

  it("only shows three HUD rows, keeps labels as text, and pays completed summary rows", () => {
    const container = document.createElement("div");
    renderBounties(
      container,
      Array.from({ length: 5 }, () => item),
      "hud",
    );
    expect(container.children).toHaveLength(3);
    renderBounties(
      container,
      [
        { ...item, label: "<img src=x>", done: true },
        { ...item, failed: true },
      ],
      "summary",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("+$80");
    expect(container.textContent).toContain("Not earned");
    expect(container.textContent).toContain("✕");
  });
});
