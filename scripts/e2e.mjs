// Smoke test of the whole game flow in a real browser: npm run e2e
// First visit -> name -> tutorial -> title -> timed rounds/bounties -> hub -> Endless ->
// achievements -> reload -> Feeding Frenzy -> Final Round -> end screen -> Play Again. Needs Google Chrome installed.
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

  step("the tutorial leads to the title; Play starts round 1 with a tip");
  await intro.getByRole("button", { name: "Let's play" }).click();
  await page.locator("#title").waitFor({ state: "visible" });
  assert.ok(await page.locator("#title-endless").isDisabled());
  assert.ok(await page.locator("#title-endless-lock").isVisible());
  await page.click("#title-play");
  await page.waitForSelector("#hud:not([hidden])");
  assert.equal(await intro.count(), 0, "slides still open");
  assert.ok(await page.locator("#hub").isHidden(), "hub shown with nothing to buy");
  await page.waitForSelector("#round-hint:not([hidden])");
  assert.ok(await page.locator("#hud-bounties").isHidden());
  assert.ok(await page.locator("#chum-button").isHidden(), "chum is shown before its unlock");

  step("rounds bank money until the first upgrade is affordable, then the hub opens");
  let round = 1;
  for (;;) {
    await chaseFish(page, { steps: 120 });
    await page.waitForSelector("#summary-panel:not([hidden])", { timeout: 30_000 });
    assert.equal(await text(page, "#summary-title"), `Round ${round} complete`);
    await continueVisible(page);
    if (round === 1) {
      await page.reload();
      await page.locator("#title").waitFor({ state: "visible" });
      assert.ok(await page.locator("#title-endless").isEnabled(), "Endless did not unlock after round 1");
      assert.ok(await page.locator("#title-endless-lock").isHidden());
      await page.click("#title-play");
    } else await page.click("#continue-button");
    round++;
    await page.waitForSelector("#hub:not([hidden]), #hud:not([hidden])");
    if (await page.locator("#hub").isVisible()) break;
    assert.ok(round < 5, "never earned enough for the first upgrade");
  }
  assert.equal(await text(page, "#hub-name"), NAME);
  assert.equal(await text(page, "#hub-round"), `Round ${round} next`);
  assert.ok(round >= 2);
  assert.ok(await page.locator("#hub-bounties").isVisible());
  assert.ok(await page.locator("#hub-bounties .bounty-row").count() >= 2);

  step("Endless unlocks after round 1, records a trip and leaves the bank alone");
  const beforeEndless = await page.evaluate(() => JSON.parse(localStorage.getItem("fishy.save")));
  await page.click("#hub-home");
  assert.ok(await page.locator("#title-endless").isEnabled());
  assert.ok(await page.locator("#title-endless-lock").isHidden());
  await page.click("#title-endless");
  await page.waitForSelector('#hud[data-mode="endless"]:not([hidden])');
  assert.ok(await page.locator("#hud-bounties").isHidden());
  await chaseFish(page, { steps: 100 });
  await page.waitForFunction(() => {
    const [m, s] = document.querySelector("#hud-endless-time").textContent.split(":").map(Number);
    return m * 60 + s >= 10;
  });
  assert.equal(await page.locator("#hud.is-urgent").count(), 0);
  await page.click("#pause-button");
  await page.locator("#harbour-button").waitFor({ state: "visible" });
  const frozen = await text(page, "#hud-endless-time");
  await page.waitForTimeout(350);
  assert.equal(await text(page, "#hud-endless-time"), frozen);
  await page.click("#harbour-button");
  await page.locator("#endless-panel").waitFor({ state: "visible" });
  const afterEndless = await page.evaluate(() => JSON.parse(localStorage.getItem("fishy.save")));
  assert.equal(afterEndless.money, beforeEndless.money);
  assert.equal(afterEndless.round, beforeEndless.round);
  assert.deepEqual(afterEndless.upgrades, beforeEndless.upgrades);
  assert.equal(afterEndless.endless.sessions, beforeEndless.endless.sessions + 1);
  assert.ok(afterEndless.endless.timeMs >= beforeEndless.endless.timeMs + 10000);
  assert.ok(await page.locator("#endless-records").innerText());
  await page.click("#endless-harbour");

  step("achievements open and close back to the title with focus restored");
  await page.click("#title-achievements");
  await page.locator("#achievements-panel").waitFor({ state: "visible" });
  assert.equal(await page.locator(".achievement-card").count(), 24);
  await page.keyboard.press("Escape");
  assert.ok(await page.locator("#achievements-panel").isHidden());
  assert.ok(await page.locator("#title").isVisible());
  assert.equal(await page.locator("#title-achievements").evaluate((el) => el === document.activeElement), true);

  step("title Settings reuses the same drawer and closes on Escape");
  await page.click("#title-settings");
  await page.locator("#hub-tools").waitFor({ state: "visible" });
  assert.equal(await page.locator("#hub-tools").count(), 1);
  await page.keyboard.press("Escape");
  assert.ok(await page.locator("#hub-tools").isHidden());
  await page.click("#title-play");
  await page.locator("#hub").waitFor({ state: "visible" });
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
  await page.click("#title-play");
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
  await page.click("#title-play");
  await page.waitForSelector("#hub:not([hidden])");
  assert.equal(await text(page, "#hub-round"), "Round 5 next");
  assert.match(await text(page, "#hub-hint"), /Feeding Frenzy this round/);
  assert.ok(await page.locator("#start-button.has-frenzy").isVisible(), "no Frenzy badge on Start Round");
  await page.click("#start-button");
  await page.locator("#hud-bounties").waitFor({ state: "visible" });
  await page.waitForSelector("#frenzy-banner:not([hidden])", { timeout: 15_000 });
  assert.match(await text(page, "#frenzy-banner"), /^Feeding Frenzy!/);
  await chaseFish(page, { steps: 40 });
  await page.waitForSelector("#frenzy-banner", { state: "hidden", timeout: 15_000 });
  await page.waitForSelector("#summary-panel:not([hidden])", { timeout: 30_000 });
  assert.equal(await text(page, "#summary-title"), "Round 5 complete");
  assert.match(await text(page, "#summary-frenzy"), /^Feeding Frenzy:?\s+\+\$[\d,]+\s+from [\d,]+ fish$/);
  await page.click("#continue-button");
  round = 6;
  await page.waitForSelector("#hub:not([hidden])");
  assert.equal(await text(page, "#hub-round"), `Round ${round} next`);
  assert.doesNotMatch(await text(page, "#hub-hint"), /Feeding Frenzy/);
  assert.equal(await page.locator("#start-button.has-frenzy").count(), 0, "Frenzy badge on a plain round");

  await checkWeatherAndBiomes(browser, dev);
  await page.bringToFront();

  step("a maxed tree offers the Final Round");
  const { TECH_NODES } = await dev.load("/src/game/tech/index.ts");
  const maxed = Object.fromEntries(TECH_NODES.map((node) => [node.id, node.maxLevel]));
  await checkBoatTools(browser, dev, maxed);
  await page.bringToFront();
  await page.evaluate((upgrades) => {
    const save = JSON.parse(localStorage.getItem("fishy.save"));
    localStorage.setItem("fishy.save", JSON.stringify({ ...save, upgrades }));
  }, maxed);
  await page.reload();
  await page.click("#title-play");
  await page.waitForSelector("#hub:not([hidden])");
  assert.equal(await text(page, "#start-button"), "Final Round");
  assert.ok(await page.locator("#hub-bounties").isHidden());
  assert.ok(await page.locator("#start-button.has-frenzy").isVisible(), "no Frenzy badge on the Final Round");

  step("the Final Round has its Feeding Frenzy and ends on the thank-you screen");
  await page.click("#start-button");
  await page.waitForFunction(() => document.querySelector("#hud-round")?.textContent === "Final Round");
  await page.waitForSelector("#frenzy-banner:not([hidden])", { timeout: 30_000 });
  await page.waitForSelector("#summary-panel:not([hidden])", { timeout: 120_000 });
  assert.equal(await text(page, "#summary-title"), "Final Round complete");
  await continueVisible(page);
  assert.match(await text(page, "#summary-frenzy"), /^Feeding Frenzy:?\s/);
  await page.click("#continue-button");
  await page.waitForSelector("#end-panel:not([hidden])");
  assert.equal(await text(page, "#end-rounds"), String(round));

  step("the end screen survives a reload");
  await page.reload();
  await page.click("#title-play");
  await page.waitForSelector("#end-panel:not([hidden])");

  step("M mutes the sound");
  await page.keyboard.press("m");
  const audioSettings = await page.evaluate(() => localStorage.getItem("fishy.audio"));
  assert.equal(JSON.parse(audioSettings).muted, true);

  const beforeReset = await page.evaluate(() => JSON.parse(localStorage.getItem("fishy.save")));
  step("Play Again starts over in round 1, keeps the name and leaves the sound and display settings alone");
  await page.click("#play-again-button");
  await page.waitForSelector("#hud:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#hud-round")?.textContent === "Round 1");
  const fresh = await page.evaluate(() => JSON.parse(localStorage.getItem("fishy.save")));
  assert.equal(fresh.playerName, NAME);
  assert.equal(fresh.money, 0);
  assert.deepEqual(fresh.upgrades, {});
  assert.deepEqual(fresh.achievements, beforeReset.achievements);
  assert.deepEqual(fresh.endless, beforeReset.endless);
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

/** The logbook footer stays available at both ends of a long summary. */
async function continueVisible(page) {
  for (const bottom of [false, true]) {
    await page.locator(".summary-body").evaluate((el, bottom) => { el.scrollTop = bottom ? el.scrollHeight : 0; }, bottom);
    const button = await page.locator("#continue-button").boundingBox();
    const viewport = page.viewportSize();
    assert.ok(button && button.y >= 0 && button.y + button.height <= viewport.height,
      "Continue is outside the summary viewport");
  }
}

/** Tool assertions read the simulation, so they also work before trap artwork lands. */
async function checkBoatTools(browser, dev, maxed) {
  step("trap nets start in the sea; Space and the bucket throw chum in rounds and Endless");
  const { createSave } = await dev.load("/src/save/index.ts");
  const tools = await newPage(browser);
  const seed = { ...createSave("Captain Rigging"), round: 40,
    upgrades: { ...maxed, "econ.value2": 0 } };
  await tools.addInitScript((save) => localStorage.setItem("fishy.save", JSON.stringify(save)), seed);
  await tools.goto(dev.url);
  await tools.click("#title-play"); await tools.click("#start-button");
  await tools.waitForFunction(() => window.__fishy?.world?.traps.length > 0);
  assert.equal(await tools.evaluate(() => window.__fishy.world.stats.boat.lanternRadius), 210);
  assert.equal(await tools.evaluate(() => window.__fishy.world.traps.every(({ x, y }) => {
    const { width, height } = window.__fishy.world;
    return !((x < width * .22 || x > width * .78) && (y < height * .22 || y > height * .78));
  })), true, "a trap was cast in a corner");
  const bucket = tools.locator("#chum-button");
  await bucket.waitFor({ state: "visible" });
  assert.match(await text(tools, "#round-hint"), /Trap nets snap shut/);
  assert.equal(await text(tools, "#toast"), "Press Space or tap the bucket to throw chum");
  assert.match(await bucket.getAttribute("aria-label"), /ready/);
  await tools.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await bucket.evaluate((el) => getComputedStyle(el).animationName), "none");
  await tools.emulateMedia({ reducedMotion: "no-preference" });
  assert.equal(await bucket.evaluate((el) => getComputedStyle(el).animationName), "chum-ready");
  await tools.evaluate(() => {
    const input = document.createElement("input"); input.id = "typing-guard";
    input.style.cssText = "position:fixed;bottom:0;z-index:100";
    document.body.append(input); input.focus();
  });
  await tools.keyboard.press("Space");
  assert.equal(await tools.evaluate(() => window.__fishy.world.chumReady), true, "typing threw chum");
  await tools.evaluate(() => {
    document.querySelector("#typing-guard").remove();
    const dialog = document.createElement("dialog"); dialog.id = "dialog-guard";
    document.body.append(dialog); dialog.showModal();
  });
  await tools.keyboard.press("Space");
  assert.equal(await tools.evaluate(() => window.__fishy.world.chumReady), true, "dialog Space threw chum");
  await tools.evaluate(() => document.querySelector("#dialog-guard").remove());
  await tools.keyboard.press("Space");
  await tools.waitForFunction(() => window.__fishy.world.chumActive && Number(document.querySelector("#chum-button").dataset.cooldown) > 0);
  assert.match(await bucket.getAttribute("aria-label"), /\d+ seconds left/);
  assert.ok(await bucket.locator(".chum-progress").evaluate((el) => Number(el.style.strokeDashoffset) > 0));
  assert.equal(await bucket.getAttribute("aria-disabled"), "true");
  await tools.keyboard.press("Escape");
  await tools.locator("#pause-panel").waitFor({ state: "visible" });
  const cooldown = await tools.evaluate(() => window.__fishy.world.chumCooldownLeft);
  // Space on the focused Resume button would activate that button through native keyboard input.
  await tools.evaluate(() => document.activeElement?.blur());
  await tools.keyboard.press("Space");
  await tools.waitForTimeout(150);
  assert.equal(await tools.evaluate(() => window.__fishy.world.chumCooldownLeft), cooldown, "paused cooldown advanced");
  await tools.keyboard.press("Escape");
  await tools.locator("#pause-panel").waitFor({ state: "hidden" });
  await tools.reload();
  await tools.click("#title-endless");
  await tools.waitForFunction(() => window.__fishy?.world?.endless && window.__fishy.world.traps.length > 0);
  await bucket.click();
  await tools.waitForFunction(() => window.__fishy.world.chumActive);
  assert.deepEqual(tools.errors, [], "tool page errors");
  await tools.context().close();
}

/** Weather travels from a stable hub forecast through the round to the ledger; trips keep biome records. */
async function checkWeatherAndBiomes(browser, dev) {
  step("round 7 forecasts a forced storm, announces it and records its bonus");
  const { createSave } = await dev.load("/src/save/index.ts");
  const page = await newPage(browser);
  const save = { ...createSave("Weather Watch"), round: 7, money: 1000, upgrades: { "net.radius": 1 } };
  await page.addInitScript((data) => localStorage.setItem("fishy.save", data), JSON.stringify(save));
  await page.goto(`${dev.url}?sea=storm`);
  await page.click("#title-play");
  await page.locator("#hub").waitFor({ state: "visible" });
  assert.match(await text(page, "#start-button .weather-badge"), /storm/i);
  assert.match(await text(page, "#hub-hint"), /Storm this round: fish drift with the wind/);
  await page.reload();
  await page.click("#title-play");
  assert.equal(await page.locator("#start-button").getAttribute("data-sea"), "storm");
  await page.click("#start-button");
  await page.locator("#sea-banner").waitFor({ state: "visible" });
  assert.match(await text(page, "#sea-banner"), /Storm · catches ×1.2/);
  assert.equal(await page.evaluate(() => window.__fishy.world.sea), "storm");
  await chaseFish(page, { steps: 60 });
  await page.locator("#summary-panel").waitFor({ state: "visible", timeout: 30000 });
  const row = page.locator('#summary-bonuses [data-key="sea"]');
  assert.match(await row.innerText(), /Storm bonus/);
  assert.match(await row.locator(".summary-extra-amount").innerText(), /^\+\$/);
  await continueVisible(page);

  step("an Endless trip at 301 seconds names the Trench, announces it and lists visited biomes");
  await page.goto(`${dev.url}?endlessTime=301`);
  await page.click("#title-endless");
  await page.locator('#hud[data-mode="endless"]').waitFor({ state: "visible" });
  assert.equal(await text(page, "#hud-biome"), "Abyssal Trench");
  assert.match(await text(page, "#hud-biome-next"), /to next biome/);
  assert.match(await text(page, "#biome-banner"), /Entering the Abyssal Trench/);
  assert.ok(await page.locator("#hud-weather").isVisible());
  assert.match(await text(page, "#hud-weather"), /Clear|Storm|Fog|Algal Bloom/);
  await page.click("#pause-button");
  await page.click("#harbour-button");
  assert.match(await text(page, "#endless-biomes"), /Shallow Reef · Abyssal Trench/);
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("fishy.save")).achievements["biome-trench"]));
  assert.deepEqual(page.errors, [], "weather/biome page errors");
  await page.context().close();
}
