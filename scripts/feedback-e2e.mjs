// Feedback regressions: desktop/mobile hierarchy, Settings, export status and countdown urgency.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchChrome, startDevServer } from "./lib/browser.mjs";

const dev = await startDevServer(5193);
const browser = await launchChrome();
try {
  const { createSave } = await dev.load("/src/save/index.ts");
  for (const width of [1280, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: width < 500, isMobile: width < 500 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.addInitScript((save) => localStorage.setItem("fishy.save", JSON.stringify(save)), {
      ...createSave("Captain with a very long name"), money: 123456789, round: 2,
    });
    await page.goto(dev.url);
    await page.locator("#hub").waitFor({ state: "visible" });
    assert.ok(await page.locator("#hub-tools-toggle").isVisible(), `Settings missing at ${width}px`);
    assert.ok(await page.locator("#hub-tools").isHidden(), "Settings should start closed");
    const start = await page.locator("#start-button").boundingBox();
    assert.ok(Math.abs(start.x + start.width / 2 - width / 2) < 2, "Start Round should be centred");
    await page.locator("#hub-tools-toggle").click();
    await page.locator("#hub-tools").waitFor({ state: "visible" });
    const download = page.waitForEvent("download");
    await page.locator('[data-action="export"]').click();
    await download;
    const message = page.locator(".save-controls-message");
    await message.waitFor({ state: "visible" });
    assert.match(await message.innerText(), /Downloaded/);
    const menu = await page.locator("#hub-tools").boundingBox();
    const status = await message.boundingBox();
    assert.ok(status.x >= menu.x && status.x + status.width <= menu.x + menu.width + 1, "save status overflows Settings");
    assert.ok(status.y + status.height <= menu.y + menu.height, "save status clipped below Settings");
    await mkdir("output/playwright", { recursive: true });
    await page.screenshot({ path: `output/playwright/feedback-settings-${width}.png` });
    if (width === 1280) {
      const save = await page.evaluate(() => localStorage.getItem("fishy.save"));
      await page.locator('#hub-save input[type="file"]').setInputFiles({ name: "feedback-save.json", mimeType: "application/json", buffer: Buffer.from(save) });
      const confirmation = page.locator("dialog[open]:not(.intro)");
      await confirmation.waitFor();
      await page.keyboard.press("Escape");
      await confirmation.waitFor({ state: "hidden" });
      assert.ok(await page.locator("#hub-tools").isVisible(), "cancelling import closed Settings");
      await page.locator('#hub-save input[type="file"]').setInputFiles({ name: "feedback-save.json", mimeType: "application/json", buffer: Buffer.from(save) });
      await confirmation.waitFor();
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.ok(await page.locator("#hub-tools").isVisible(), "clicking import Cancel closed Settings");
    }
    await page.keyboard.press("Escape");
    assert.ok(await page.locator("#hub-tools").isHidden(), "Escape should close Settings");
    assert.equal(await page.locator("#hub-tools-toggle").evaluate((el) => el === document.activeElement), true);
    await page.screenshot({ path: `output/playwright/feedback-hub-${width}.png` });
    await page.locator("#start-button").click();
    await page.locator("#hud").waitFor({ state: "visible" });
    const primary = await page.locator(".hud-primary").boundingBox();
    const controls = await page.locator(".hud-controls").boundingBox();
    assert.ok(Math.abs(primary.x + primary.width / 2 - width / 2) < 2, "round progress should be centred");
    assert.ok(primary.y + primary.height <= controls.y || primary.x + primary.width <= controls.x, "controls overlap progress");
    await page.locator("#pause-button").click();
    await page.locator("#pause-panel").waitFor({ state: "visible" });
    assert.equal(await page.locator("#hud").getAttribute("data-paused"), "true");
    await page.locator("#resume-button").click();
    if (width === 1280) await page.mouse.move(650, 300);
    if (width === 1280) {
      await page.waitForFunction(() => document.querySelector("#hud").classList.contains("is-urgent"), null, { timeout: 15000 });
      assert.match(await page.locator("#hud-timer").getAttribute("aria-label"), /seconds left/);
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(await page.locator("#hud-timer").evaluate((el) => getComputedStyle(el).animationName), "none");
    }
    await mkdir("output/playwright", { recursive: true });
    await page.screenshot({ path: `output/playwright/feedback-round-${width}.png` });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`feedback checks passed at ${width}px`);
  }
} finally {
  await browser.close();
  await dev.close();
}
