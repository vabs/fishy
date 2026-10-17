// Smoke test of the whole game flow in a real browser: npm run e2e
// First visit -> name -> straight into round 1 -> summary -> hub -> buy an upgrade -> colour-blind
// palette -> reload keeps progress -> a Feeding Frenzy round -> Final Round -> end screen -> mute ->
// Play Again. Needs Google Chrome installed.
import assert from "node:assert/strict";
import { chaseFish, launchChrome, newPage, startDevServer } from "./lib/browser.mjs";

const NAME = "Captain Smoke";

const dev = await startDevServer(5191);
const browser = await launchChrome();
try {
  const page = await newPage(browser);
  await page.goto(dev.url);

  step("first visit asks for a name, then shows three how-to-play slides");
  await page.locator("dialog input").fill(NAME);
  await page.locator("dialog button[type=submit]").click();
  const intro = page.locator("dialog.intro");
  await intro.waitFor();
  assert.ok(await page.locator("#hud").isHidden(), "round started before the slides");
  await intro.getByRole("button", { name: "Next" }).click();
  await page.keyboard.press("ArrowRight");
  assert.equal((await intro.locator(".intro-good-luck").innerText()).trim(), `Good luck, ${NAME}!`);

  step("Let's play goes straight into round 1 with a tip");
  await intro.getByRole("button", { name: "Let's play" }).click();
  await page.waitForSelector("#hud:not([hidden])");
  assert.equal(await intro.count(), 0, "slides still open");
  assert.ok(await page.locator("#hub").isHidden(), "hub shown with nothing to buy");
  await page.waitForSelector("#round-hint:not([hidden])");

  step("rounds bank money until the first upgrade is affordable, then the hub opens");
  let round = 1;
  for (;;) {
    await chaseFish(page, { steps: 120 });
    await page.waitForSelector("#summary-panel:not([hidden])", { timeout: 30_000 });
    assert.equal(await text(page, "#summary-title"), `Round ${round} complete`);
    await page.click("#continue-button");
    round++;
    await page.waitForSelector("#hub:not([hidden]), #hud:not([hidden])");
    if (await page.locator("#hub").isVisible()) break;
    assert.ok(round < 5, "never earned enough for the first upgrade");
  }
  assert.equal(await text(page, "#hub-name"), NAME);
  assert.equal(await text(page, "#hub-round"), `Round ${round} next`);
  const banked = money(await text(page, "#hub-money"));
  await page.click(".tech-node.is-root");
  const afterBuy = money(await text(page, "#hub-money"));
  assert.ok(afterBuy < banked, "buying the root upgrade didn't spend money");

  step("the hub's help button reopens the slides, and Escape closes them");
  await page.click("#hub-tools-toggle");
  await page.click("#help-button");
  await intro.waitFor();
  await page.keyboard.press("Escape");
  await intro.waitFor({ state: "detached" });
  assert.ok(await page.locator("#hub").isVisible());

  step("the colour-blind palette switch recolours the fish at once");
  await page.click("#hub-tools-toggle");
  const paletteSwitch = page.locator("#hub-display .display-toggle");
  const starColour = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fish-star").trim());
  assert.equal(await paletteSwitch.getAttribute("aria-pressed"), "false");
  const standardStar = await starColour();
  await paletteSwitch.click();
  assert.equal(await paletteSwitch.getAttribute("aria-pressed"), "true");
  assert.notEqual(await starColour(), standardStar, "the tech tree's fish colours didn't change");
  const displaySettings = await page.evaluate(() => localStorage.getItem("fishy.display"));
  assert.equal(JSON.parse(displaySettings).colorBlind, true);

  step("a reload keeps the save and the palette, and skips the name prompt");
  await page.reload();
  await page.waitForSelector("#hub:not([hidden])");
  assert.equal(await text(page, "#hub-name"), NAME);
  assert.equal(money(await text(page, "#hub-money")), afterBuy);
  assert.equal(await page.isVisible("#hub-tools-toggle"), true, "Settings missing on desktop");
  await page.click("#hub-tools-toggle");
  assert.equal(await paletteSwitch.getAttribute("aria-pressed"), "true");
  assert.notEqual(await starColour(), standardStar);

  step("round 5 brings a Feeding Frenzy: the hub says so, a banner announces the wave, the summary counts it");
  await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem("fishy.save"));
    localStorage.setItem("fishy.save", JSON.stringify({ ...save, round: 5 }));
  });
  await page.reload();
  await page.waitForSelector("#hub:not([hidden])");
  assert.equal(await text(page, "#hub-round"), "Round 5 next");
  assert.match(await text(page, "#hub-hint"), /Feeding Frenzy this round/);
  assert.ok(await page.locator("#start-button.has-frenzy").isVisible(), "no Frenzy badge on Start Round");
  await page.click("#start-button");
  await page.waitForSelector("#frenzy-banner:not([hidden])", { timeout: 15_000 });
  assert.match(await text(page, "#frenzy-banner"), /^Feeding Frenzy!/);
  await chaseFish(page, { steps: 40 });
  await page.waitForSelector("#frenzy-banner", { state: "hidden", timeout: 15_000 });
  await page.waitForSelector("#summary-panel:not([hidden])", { timeout: 30_000 });
  assert.equal(await text(page, "#summary-title"), "Round 5 complete");
  assert.match(await text(page, "#summary-frenzy"), /^Feeding Frenzy: \+\$[\d,]+ from [\d,]+ fish$/);
  await page.click("#continue-button");
  round = 6;
  await page.waitForSelector("#hub:not([hidden])");
  assert.equal(await text(page, "#hub-round"), `Round ${round} next`);
  assert.doesNotMatch(await text(page, "#hub-hint"), /Feeding Frenzy/);
  assert.equal(await page.locator("#start-button.has-frenzy").count(), 0, "Frenzy badge on a plain round");

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
  assert.ok(await page.locator("#start-button.has-frenzy").isVisible(), "no Frenzy badge on the Final Round");

  step("the Final Round has its Feeding Frenzy and ends on the thank-you screen");
  await page.click("#start-button");
  await page.waitForFunction(() => document.querySelector("#hud-round")?.textContent === "Final Round");
  await page.waitForSelector("#frenzy-banner:not([hidden])", { timeout: 30_000 });
  await page.waitForSelector("#summary-panel:not([hidden])", { timeout: 120_000 });
  assert.equal(await text(page, "#summary-title"), "Final Round complete");
  assert.match(await text(page, "#summary-frenzy"), /^Feeding Frenzy: /);
  await page.click("#continue-button");
  await page.waitForSelector("#end-panel:not([hidden])");
  assert.equal(await text(page, "#end-rounds"), String(round));

  step("the end screen survives a reload");
  await page.reload();
  await page.waitForSelector("#end-panel:not([hidden])");

  step("M mutes the sound");
  await page.keyboard.press("m");
  const audioSettings = await page.evaluate(() => localStorage.getItem("fishy.audio"));
  assert.equal(JSON.parse(audioSettings).muted, true);

  step("Play Again starts over in round 1, keeps the name and leaves the sound and display settings alone");
  await page.click("#play-again-button");
  await page.waitForSelector("#hud:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#hud-round")?.textContent === "Round 1");
  const fresh = await page.evaluate(() => JSON.parse(localStorage.getItem("fishy.save")));
  assert.equal(fresh.playerName, NAME);
  assert.equal(fresh.money, 0);
  assert.deepEqual(fresh.upgrades, {});
  assert.equal(await page.evaluate(() => localStorage.getItem("fishy.audio")), audioSettings);
  assert.equal(await page.locator('#hud-audio [data-action="mute"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.evaluate(() => localStorage.getItem("fishy.display")), displaySettings);
  assert.equal(await paletteSwitch.getAttribute("aria-pressed"), "true");

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
