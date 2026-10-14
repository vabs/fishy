// Smoke test of the whole game flow in a real browser: npm run e2e
// First visit -> name -> hub -> round -> summary -> buy an upgrade -> reload keeps progress ->
// Final Round -> end screen -> Play Again. Needs Google Chrome installed.
import assert from "node:assert/strict";
import { chaseFish, launchChrome, newPage, startDevServer } from "./lib/browser.mjs";

const NAME = "Captain Smoke";

const dev = await startDevServer(5191);
const browser = await launchChrome();
try {
  const page = await newPage(browser);
  await page.goto(dev.url);

  step("first visit asks for a name");
  await page.locator("dialog input").fill(NAME);
  await page.locator("dialog button[type=submit]").click();
  await page.waitForSelector("#hub:not([hidden])");
  assert.equal(await text(page, "#hub-name"), NAME);
  assert.equal(await text(page, "#hub-money"), "$0");

  step("a round plays and banks money");
  await page.click("#start-button");
  await page.waitForSelector("#hud:not([hidden])");
  await chaseFish(page, { steps: 120 });
  await page.waitForSelector("#summary-panel:not([hidden])", { timeout: 30_000 });
  assert.equal(await text(page, "#summary-title"), "Round 1 complete");
  const banked = money(await text(page, "#summary-bank"));
  assert.ok(banked > 0, "caught nothing in round 1");

  step("the hub shows the money and the root upgrade can be bought");
  await page.click("#continue-button");
  await page.waitForSelector("#hub:not([hidden])");
  assert.equal(money(await text(page, "#hub-money")), banked);
  assert.equal(await text(page, "#hub-round"), "Round 2 next");
  await page.click(".tech-node.is-root");
  const afterBuy = money(await text(page, "#hub-money"));
  assert.ok(afterBuy < banked, "buying the root upgrade didn't spend money");

  step("a reload keeps the save and skips the name prompt");
  await page.reload();
  await page.waitForSelector("#hub:not([hidden])");
  assert.equal(await text(page, "#hub-name"), NAME);
  assert.equal(money(await text(page, "#hub-money")), afterBuy);

  step("a maxed tree offers the Final Round");
  const { TECH_NODES } = await dev.load("/src/game/tech/index.ts");
  const maxed = Object.fromEntries(TECH_NODES.map((node) => [node.id, node.maxLevel]));
  await page.evaluate((upgrades) => {
    const save = JSON.parse(localStorage.getItem("fishy.save"));
    localStorage.setItem("fishy.save", JSON.stringify({ ...save, upgrades }));
  }, maxed);
  await page.reload();
  await page.waitForSelector("#hub:not([hidden])");
  assert.equal(await text(page, "#start-button"), "Final Round");

  step("the Final Round ends on the thank-you screen");
  await page.click("#start-button");
  await page.waitForFunction(() => document.querySelector("#hud-round")?.textContent === "Final Round");
  await page.waitForSelector("#summary-panel:not([hidden])", { timeout: 120_000 });
  assert.equal(await text(page, "#summary-title"), "Final Round complete");
  await page.click("#continue-button");
  await page.waitForSelector("#end-panel:not([hidden])");
  assert.equal(await text(page, "#end-rounds"), "2");

  step("the end screen survives a reload");
  await page.reload();
  await page.waitForSelector("#end-panel:not([hidden])");

  step("Play Again starts over and keeps the name");
  await page.click("#play-again-button");
  await page.waitForSelector("#hub:not([hidden])");
  assert.equal(await text(page, "#hub-name"), NAME);
  assert.equal(await text(page, "#hub-money"), "$0");
  assert.equal(await text(page, "#hub-round"), "Round 1 next");

  assert.deepEqual(page.errors, [], "page errors");
  console.log("\nall good");
} finally {
  await browser.close();
  await dev.close();
}

function step(name) {
  console.log(`- ${name}`);
}

async function text(page, selector) {
  return (await page.locator(selector).innerText()).trim();
}

function money(label) {
  return Number(label.replace(/[$,]/g, ""));
}
