// Real Chrome touch input, responsive layouts and pause lifecycle: npm run e2e:mobile
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchChrome, startDevServer } from "./lib/browser.mjs";

const dev = await startDevServer(5192);
const browser = await launchChrome();
const screenshots = process.argv.includes("--screenshots");
try {
  const { createSave } = await dev.load("/src/save/index.ts");
  const { TECH_NODES } = await dev.load("/src/game/tech/index.ts");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  // Observe the real canvas projection without adding test hooks to the shipped game.
  await page.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const transform = proto.setTransform;
    proto.setTransform = function (...args) {
      if (this.canvas.id === "game" && args.join(",") === "1,0,0,1,0,0") window.drawnNet = window.drawnFinger = null;
      return transform.apply(this, args);
    };
    const arc = proto.arc;
    proto.arc = function (x, y, radius, ...args) {
      if (this.canvas.id === "game") {
        const colour = this.strokeStyle.replaceAll(" ", "");
        const matrix = this.getTransform();
        const density = this.canvas.width / this.canvas.getBoundingClientRect().width;
        const point = { x: (matrix.a * x + matrix.c * y + matrix.e) / density, y: (matrix.b * x + matrix.d * y + matrix.f) / density };
        if (colour === "#fff1cd" && radius > 10) window.drawnNet = point;
        if (colour === "rgba(255,255,255,0.25)") window.drawnFinger = point;
      }
      return arc.call(this, x, y, radius, ...args);
    };
  });
  const cdp = await context.newCDPSession(page);
  const touch = (type, points = []) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y, id = 1]) => ({ x, y, id })) });
  const tap = async (selector) => page.locator(selector).tap();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("fishy.save")));
  const seed = async (save) => {
    await page.evaluate((data) => localStorage.setItem("fishy.save", JSON.stringify(data)), save);
    await page.reload();
    await tap("#title-play");
  };

  step("name entry and tutorial fit a phone and a reduced keyboard viewport");
  await page.goto(dev.url);
  await page.locator("dialog input").fill("Captain Touch");
  await page.setViewportSize({ width: 390, height: 360 });
  await fits(page, "dialog[open]");
  await page.locator("dialog button[type=submit]").tap();
  await page.setViewportSize({ width: 390, height: 844 });
  await fits(page, "dialog.intro");
  assert.match(await page.locator(".intro-slide").first().innerText(), /above your finger/);
  await page.getByRole("button", { name: "Next", exact: true }).tap();
  assert.match(await page.locator(".intro-slide").nth(1).innerText(), /pinch to zoom/);
  await page.getByRole("button", { name: "Next", exact: true }).tap();
  await page.getByRole("button", { name: "Let's play", exact: true }).tap();
  await fits(page, "#title");
  await tap("#title-play");
  await page.locator("#hud").waitFor({ state: "visible" });
  assert.ok(await page.locator("#chum-button").isHidden(), "locked chum appears on touch");

  step("hold/drag places the net 56px above the finger; lift/cancel clear it; DPR is capped");
  assert.equal(await page.locator("#game").evaluate((canvas) => canvas.width), 780);
  await touch("touchStart", [[190, 420]]);
  await page.waitForFunction(() => window.drawnNet !== null);
  await netAt(page, 190, 364);
  await shot(page, "mobile-gameplay");
  await touch("touchMove", [[230, 470]]);
  await netAt(page, 230, 414);
  await touch("touchEnd");
  await page.waitForFunction(() => window.drawnNet === null);
  await touch("touchStart", [[100, 350]]);
  await netAt(page, 100, 294);
  await touch("touchStart", [[100, 350, 1], [290, 560, 2]]);
  await touch("touchMove", [[100, 350, 1], [330, 600, 2]]);
  await netAt(page, 100, 294);
  await touch("touchCancel");
  await page.waitForFunction(() => window.drawnNet === null);
  // The contact strip makes even the bottom edge of the sea reachable.
  await touch("touchStart", [[190, 843]]);
  await netAt(page, 190, 787);
  await touch("touchEnd");

  step("manual pause, blur and orientation freeze the timer until explicit resume");
  await tap("#pause-button");
  await frozen(page);
  await tap("#resume-button");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await frozen(page);
  await tap("#resume-button");
  // Headless Chrome keeps pages visible. Exercise the same visibility listener
  // with a controlled hidden state rather than relying on OS app switching.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await frozen(page);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await frozen(page);
  await tap("#resume-button");
  await page.setViewportSize({ width: 844, height: 390 });
  await frozen(page);
  await fits(page, "#pause-panel");
  await shot(page, "mobile-landscape-pause");
  await tap("#resume-button");
  const before = await page.locator("#hud-timer").innerText();
  await page.waitForFunction((old) => document.querySelector("#hud-timer").textContent !== old, before);

  step("touch tree tap inspects; only Buy spends money; drag, pinch and cancel never buy");
  await page.setViewportSize({ width: 390, height: 844 });
  const fresh = { ...createSave("Captain Touch"), round: 2, money: 10000 };
  await seed(fresh);
  await page.locator("#hub").waitFor({ state: "visible" });
  await tap(".tech-node.is-root");
  await page.locator(".tech-sheet").waitFor({ state: "visible" });
  assert.equal((await stored()).money, fresh.money);
  await fits(page, ".tech-sheet");
  await tap(".tech-sheet-buy");
  assert.ok((await stored()).money < fresh.money);
  await tap(".tech-sheet-close");
  await page.waitForTimeout(450);
  const afterBuy = await stored();
  const root = await page.locator(".tech-node.is-root").boundingBox();
  const rx = root.x + root.width / 2, ry = root.y + root.height / 2;
  await touch("touchStart", [[rx, ry]]);
  await touch("touchMove", [[rx + 55, ry + 45]]);
  await touch("touchEnd");
  assert.ok(await page.locator(".tech-sheet").isHidden());
  assert.deepEqual(await stored(), afterBuy);
  const tree = await page.locator(".tech").boundingBox();
  const cy = tree.y + tree.height / 2;
  const previous = await treeView(page);
  await touch("touchStart", [[130, cy, 1]]);
  await touch("touchStart", [[130, cy, 1], [260, cy, 2]]);
  await touch("touchMove", [[90, cy, 1], [300, cy, 2]]);
  const zoomed = await treeView(page);
  assert.ok(zoomed.scale > previous.scale, "pinch did not zoom");
  // The world point under the stationary midpoint stays anchored.
  close((195 - previous.x) / previous.scale, (195 - zoomed.x) / zoomed.scale, 1);
  close((cy - tree.y - previous.y) / previous.scale, (cy - tree.y - zoomed.y) / zoomed.scale, 1);
  await touch("touchEnd");
  assert.deepEqual(await stored(), afterBuy);
  await touch("touchStart", [[195, cy]]);
  await touch("touchCancel");
  assert.deepEqual(await stored(), afterBuy);
  await tap('[aria-label="Fit the tree to the view"]');
  await page.waitForTimeout(450);
  const bounds = await page.locator('.tech-node:not([hidden]):not(.is-root)').first().boundingBox();
  assert.ok(bounds.width >= 47.9 && bounds.height >= 47.9, "touch nodes too small");
  await shot(page, "mobile-tree");

  step("tools, sound, export/import and help remain usable in portrait and landscape");
  await tap("#hub-tools-toggle");
  await fits(page, "#hub-tools");
  await page.locator('#hub-audio [data-action="mute"]').tap();
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("fishy.audio"))).muted, true);
  await page.locator('#hub-audio [data-action="volume"]').tap();
  await fits(page, ".audio-panel");
  const download = page.waitForEvent("download");
  await page.locator('[data-action="export"]').tap();
  assert.match(await page.locator(".save-controls-message").innerText(), /Downloaded/);
  assert.match((await download).suggestedFilename(), /\.json$/);
  await page.locator('#hub-save input[type="file"]').setInputFiles({ name: "mobile-save.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(afterBuy)) });
  await page.locator("dialog[open]:not(.intro)").waitFor();
  await fits(page, "dialog[open]");
  await page.getByRole("button", { name: "Cancel", exact: true }).tap();
  await tap("#help-button");
  await page.setViewportSize({ width: 844, height: 390 });
  await fits(page, "dialog.intro");
  await page.getByRole("button", { name: "Skip", exact: true }).tap();
  await tap("#hub-tools-toggle");
  await fits(page, "#hub-tools");
  const settings = await page.locator("#hub-tools").boundingBox();
  const gear = await page.locator("#hub-tools-toggle").boundingBox();
  assert.ok(settings.y >= gear.y + gear.height, "landscape Settings covers the gear");
  await tap("#hub-tools-toggle");
  assert.ok(await page.locator("#hub-tools").isHidden());
  await tap("#hub-tools-toggle");
  await tap("#hub-tools-close");
  assert.ok(await page.locator("#hub-tools").isHidden());
  assert.equal(await page.locator("#hub-tools-toggle").evaluate((el) => el === document.activeElement), true);

  step("starting a round dismisses an open upgrade sheet; summary and end screens scroll");
  await tap(".tech-node.is-root");
  await page.locator(".tech-sheet").waitFor({ state: "visible" });
  await tap("#start-button");
  assert.ok(await page.locator(".tech-sheet").isHidden(), "details leaked into the round");
  await page.locator("#summary-panel").waitFor({ state: "visible", timeout: 25000 });
  await fits(page, "#summary-panel");
  await fits(page, "#continue-button");
  await page.locator(".summary-body").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await fits(page, "#continue-button");
  await tap("#continue-button");
  await page.setViewportSize({ width: 320, height: 568 });
  await seed({ ...afterBuy, money: 123456789 });
  await page.locator("#hub").waitFor({ state: "visible" });
  assert.equal(await page.locator("#hub-money").innerText(), "$123.5M");
  assert.equal(await page.locator("#hub-money").getAttribute("title"), "$123,456,789");
  await tap("#start-button");
  await page.locator("#hud").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#hud-money").textContent === "$123.5M");
  const hudLayout = await page.evaluate(() => {
    const money = document.querySelector("#hud-money");
    const range = document.createRange();
    range.selectNodeContents(money);
    const text = range.getBoundingClientRect();
    const controls = document.querySelector(".hud-controls").getBoundingClientRect();
    return { left: text.left, right: text.right, controlsLeft: controls.left };
  });
  assert.ok(hudLayout.left >= 0 && hudLayout.right <= hudLayout.controlsLeft, `large balance overlaps controls: ${JSON.stringify(hudLayout)}`);
  step("the bucket fits beside pause and a real tap throws chum without placing or moving the net");
  const maxed = Object.fromEntries(TECH_NODES.map((node) => [node.id, node.maxLevel]));
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await seed({ ...afterBuy, upgrades: { ...maxed, "econ.value2": 0 } });
    await tap("#start-button");
    await page.waitForFunction(() => window.__fishy?.world?.traps.length > 0);
    await fits(page, "#chum-button");
    await fits(page, "#pause-button");
    const bucket = await page.locator("#chum-button").boundingBox();
    const pause = await page.locator("#pause-button").boundingBox();
    assert.ok(Math.abs(bucket.y - pause.y) < 1 && bucket.x + bucket.width <= pause.x,
      `bucket does not fit beside pause at ${viewport.width}px`);
    assert.ok(bucket.width >= 44 && bucket.height >= 44, "bucket hit target is too small");
    assert.equal(await page.evaluate(() => window.__fishy.pointer), null);
    await tap("#chum-button");
    await page.waitForFunction(() => window.__fishy.world.chumActive);
    assert.equal(await page.evaluate(() => window.__fishy.pointer), null, "bucket tap placed the net");
    assert.equal(await page.evaluate(() => window.__fishy.world.pointer), null, "bucket tap moved the simulation net");
    // The HUD refreshes on the next frame after the throw.
    await page.waitForFunction(() => /seconds left/.test(document.querySelector("#chum-button").getAttribute("aria-label")));
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#chum-button")).animationName === "none");
    // A drag still works after the bucket tap, and lifting still deactivates it.
    await touch("touchStart", [[viewport.width / 2, viewport.height * .7]]);
    await page.waitForFunction(() => window.__fishy.pointer !== null);
    await touch("touchEnd");
    await page.waitForFunction(() => window.__fishy.pointer === null);
    await shot(page, `mobile-tools-${viewport.width}`);
  }
  step("weather badges and stacked announcements fit 320–390px phones");
  const weatherSave = { ...afterBuy, round: 7, upgrades: { "net.radius": 1 }, money: 1000 };
  await page.evaluate((data) => localStorage.setItem("fishy.save", JSON.stringify(data)), weatherSave);
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${dev.url}?sea=storm`);
    await tap("#title-play");
    await fits(page, "#start-button");
    await fits(page, ".weather-badge");
    assert.match(await page.locator(".weather-badge").innerText(), /Storm/);
    await tap("#start-button");
    await page.locator("#sea-banner").waitFor({ state: "visible" });
    await fits(page, "#sea-banner");
    const banner = await page.locator("#sea-banner").boundingBox();
    const bounties = await page.locator("#hud-bounties").boundingBox();
    assert.ok(banner.y >= bounties.y + bounties.height, "weather banner overlaps the bounty checklist");
    await shot(page, `mobile-storm-${width}`);
    await page.goto(`${dev.url}?endlessTime=301`);
    await tap("#title-endless");
    await fits(page, "#hud");
    await fits(page, "#hud-biome");
    await fits(page, "#hud-weather");
    await fits(page, "#biome-banner");
    assert.equal(await page.locator("#hud-biome").innerText(), "Abyssal Trench");
    await shot(page, `mobile-trench-${width}`);
  }
  await page.goto(dev.url);
  await seed({ ...afterBuy, finalRoundDone: true, upgrades: maxed });
  await page.locator("#end-panel").waitFor({ state: "visible" });
  await fits(page, "#end-panel");
  await page.setViewportSize({ width: 320, height: 568 });
  await fits(page, "#end-panel");
  await tap("#play-again-button");
  await page.locator("#hud").waitFor({ state: "visible" });
  await fits(page, "#hud");
  await tap("#pause-button");
  await fits(page, "#pause-panel");

  await shot(page, "mobile-small-pause");
  assert.deepEqual(errors, [], "uncaught page errors");
  console.log("\nmobile checks passed");
} finally {
  await browser.close();
  await dev.close();
}

function step(label) { console.log(`- ${label}`); }
async function shot(page, name) {
  if (!screenshots) return;
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: `output/playwright/${name}.png` });
}
function close(actual, expected, tolerance = 0.6) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`); }
async function netAt(page, x, y) {
  await page.waitForFunction(({ x, y }) => window.drawnNet && Math.abs(window.drawnNet.x - x) < .6 && Math.abs(window.drawnNet.y - y) < .6, { x, y });
  const finger = await page.evaluate(() => window.drawnFinger);
  close(finger.x, x); close(finger.y, y + 56);
}
async function frozen(page) {
  await page.locator("#pause-panel").waitFor({ state: "visible" });
  await page.waitForTimeout(100);
  const value = await page.locator("#hud-timer").innerText();
  await page.waitForTimeout(400);
  assert.equal(await page.locator("#hud-timer").innerText(), value);
  assert.equal(await page.evaluate(() => window.drawnNet), null);
}
async function treeView(page) {
  return page.locator(".tech-world").evaluate((world) => {
    const matrix = new DOMMatrix(world.style.transform);
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  });
}
async function fits(page, selector) {
  await page.locator(selector).waitFor({ state: "visible" });
  await page.waitForFunction((selector) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.x >= -1 && rect.right <= innerWidth + 1 && rect.y >= visualViewport.offsetTop - 1 && rect.bottom <= visualViewport.offsetTop + visualViewport.height + 1;
  }, selector, { timeout: 5000 });
  const result = await page.locator(selector).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, height: visualViewport.height, width: innerWidth, top: visualViewport.offsetTop, overflow: getComputedStyle(el).overflowY };
  });
  assert.ok(result.x >= -1 && result.right <= result.width + 1, `${selector} overflows horizontally: ${JSON.stringify(result)}`);
  assert.ok(result.y >= result.top - 1 && result.bottom <= result.top + result.height + 1, `${selector} overflows vertically: ${JSON.stringify(result)}`);
}
