// Focused real-browser coverage for upgrade inspection and explicit purchase controls.
import assert from "node:assert/strict";
import { launchChrome, startDevServer } from "./lib/browser.mjs";

const dev = await startDevServer(5194);
const browser = await launchChrome();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(dev.url);
  await page.evaluate(mountIsolatedTree);

  const root = page.locator(".tech-node.is-root");
  const tip = page.locator(".tech-tip");
  const buy = tip.locator("button");
  // Manual zoom turns off automatic fitting as newly unlocked nodes appear.
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.waitForTimeout(450);
  await root.hover();
  await tip.waitFor({ state: "visible" });
  assert.equal(await tip.getAttribute("role"), "region");
  assert.equal(await tip.getByRole("progressbar").getAttribute("aria-valuenow"), "0");
  assert.equal(await buy.isEnabled(), true);
  await buy.hover();
  await page.waitForTimeout(250);
  assert.equal(await tip.isVisible(), true, "details disappeared crossing to the action");
  const beforeView = await page.locator(".tech-world").getAttribute("style");
  await buy.click();
  assert.equal(await page.evaluate(() => window.treePurchases), 1);
  assert.equal(await tip.getByRole("progressbar").getAttribute("aria-valuenow"), "1");
  assert.equal(await tip.locator(".tech-level-segment.is-on").count(), 1);
  assert.equal(await page.locator(".tech-world").getAttribute("style"), beforeView, "Buy panned or zoomed the tree");

  // Leave the pointer in the details panel while switching from mouse to keyboard.
  await page.keyboard.press("Tab");
  const nextNode = await page.evaluate(() => {
    const id = document.activeElement?.dataset.id;
    const node = window.treeNodes.find((entry) => entry.id === id);
    return { id, name: node?.name, level: window.treeState.upgrades[id] ?? 0 };
  });
  assert.ok(nextNode.id && nextNode.id !== "net.radius", "mouse-to-keyboard Tab did not reach the next node");
  assert.equal(await tip.locator(".tech-tip-name").innerText(), nextNode.name, "stationary pointer overrode keyboard upgrade details");
  await page.keyboard.press("Tab");
  assert.equal(await buy.evaluate((el) => el === document.activeElement), true);
  assert.match(await buy.getAttribute("aria-label"), new RegExp(`^Buy ${nextNode.name} for `));
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate((id) => window.treeState.upgrades[id], nextNode.id), nextNode.level + 1, "keyboard Buy purchased the wrong upgrade");
  assert.equal(await page.evaluate(() => window.treeState.upgrades["net.radius"]), 1);

  await page.mouse.move(10, 10);
  await root.focus();
  await page.keyboard.press("Tab");
  assert.equal(await buy.evaluate((el) => el === document.activeElement), true, "Tab did not reach Buy");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => window.treePurchases), 3);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await root.evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.matches(".tech-node:not(.is-root)")), true, "Tab skipped the remaining nodes");

  await root.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  assert.equal(await tip.isHidden(), true);
  assert.equal(await root.evaluate((el) => el === document.activeElement), true);

  await page.evaluate(() => {
    window.treeState.money = 0;
    window.testTree.update(window.treeState);
  });
  await root.hover();
  assert.equal(await buy.isDisabled(), true, "unaffordable Buy enabled");
  await page.evaluate(() => {
    const node = window.treeNodes.find((n) => n.id === "net.radius");
    window.treeState.upgrades[node.id] = node.maxLevel;
    window.testTree.update(window.treeState);
  });
  assert.equal(await buy.innerText(), "Fully upgraded");
  assert.equal(await buy.isDisabled(), true);
  assert.equal(await tip.getByRole("progressbar").getAttribute("aria-valuenow"), await tip.getByRole("progressbar").getAttribute("aria-valuemax"));

  await page.evaluate(() => {
    window.treeState = { money: 10000, upgrades: {} };
    window.testTree.update(window.treeState);
  });
  await root.click();
  assert.equal(await page.evaluate(() => window.treePurchases), 4, "direct node purchase regressed");
  assert.deepEqual(errors, []);

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage();
  await mobile.goto(dev.url);
  await mobile.evaluate(mountIsolatedTree);
  await mobile.locator(".tech-node.is-root").tap();
  await mobile.locator(".tech-sheet").waitFor({ state: "visible" });
  assert.equal(await mobile.evaluate(() => window.treePurchases), 0, "touch inspection spent money");
  assert.equal(await mobile.locator(".tech-tip").isHidden(), true);
  assert.equal(await mobile.getByRole("progressbar").getAttribute("aria-valuenow"), "0");
  await mobile.locator(".tech-sheet-buy").tap();
  assert.equal(await mobile.evaluate(() => window.treePurchases), 1, "mobile Buy failed");
  assert.equal(await mobile.getByRole("progressbar").getAttribute("aria-valuenow"), "1");
  console.log("Upgrade details: hover, Buy, progress, keyboard, Escape, affordability, maxed, direct purchase and mobile inspection passed.");
} finally {
  await browser.close();
  await dev.close();
}

async function mountIsolatedTree() {
  const { mountTechTree } = await import("/src/ui/tech-tree.ts");
  const { TECH_NODES, buy } = await import("/src/game/tech/index.ts");
  document.body.replaceChildren();
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0";
  document.body.append(container);
  window.treeState = { money: 10000, upgrades: {} };
  window.treeNodes = TECH_NODES;
  window.treePurchases = 0;
  window.testTree = mountTechTree(container, { onBuy(id) {
    const next = buy(window.treeState.upgrades, window.treeState.money, id);
    if (!next) throw new Error("Unexpected unaffordable purchase");
    window.treeState = next;
    window.treePurchases++;
    window.testTree.update(next);
  } });
  window.testTree.update(window.treeState);
}
