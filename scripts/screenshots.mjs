// Captures the README screenshots into docs/screenshots/: npm run screenshots
// Needs Google Chrome installed.
import { writeFile, mkdir } from "node:fs/promises";
import { chaseFish, launchChrome, newPage, startDevServer } from "./lib/browser.mjs";

const OUT = "docs/screenshots";
/** Supporting upgrades for the late-game shots; Rigging and Boat are maxed below. */
const GAMEPLAY_BUDGET = 2_000_000;
const ALL_FISH = "normal,uncommon,rare,electric,epic,goober,monster,star";

await mkdir(OUT, { recursive: true });
const dev = await startDevServer(5190);
const browser = await launchChrome();
try {
  const tech = await dev.load("/src/game/tech/index.ts");
  const { BASE_STATS } = await dev.load("/src/game/stats.ts");
  const { createSave } = await dev.load("/src/save/index.ts");
  const { grantAchievements, newAchievements } = await dev.load("/src/game/achievements.ts");
  const withBadges = (save) => grantAchievements(save, newAchievements(save).map((a) => a.id));

  // First visit: the name prompt.
  const first = await newPage(browser);
  await first.goto(dev.url);
  await first.waitForSelector("dialog input");
  await first.waitForTimeout(400);
  await save(await first.screenshot(), "name-prompt");

  // Then the how-to-play slides, with the net demo mid-sweep.
  await first.locator("dialog input").fill("Skipper");
  await first.locator("dialog button[type=submit]").click();
  await first.locator("dialog.intro").waitFor();
  await first.waitForTimeout(2_600);
  await save(await first.screenshot(), "how-to-play");

  // A late-game save with trap nets, seine ropes and the lantern bought.
  const mid = await newPage(browser);
  const upgrades = { ...buyCheapest(tech, GAMEPLAY_BUDGET), ...Object.fromEntries(
    tech.TECH_NODES.filter((node) => node.branch === "rigging" || node.branch === "boat")
      .map((node) => [node.id, node.maxLevel]),
  ) };
  const midSave = withBadges({ ...createSave("Skipper"), round: 24, money: 1_850, upgrades,
    stats: { ...createSave("Skipper").stats, totalFish: 800, bestRoundEarnings: 26000,
      fishByType: { normal: 350, uncommon: 250, rare: 80, electric: 60, epic: 40, goober: 20 },
      bestCombo: 1.6 } });
  await mid.addInitScript((data) => localStorage.setItem("fishy.save", data), JSON.stringify(midSave));
  await mid.goto(`${dev.url}?fish=${ALL_FISH}`);
  await mid.waitForSelector("#title:not([hidden])");
  await mid.waitForTimeout(600);
  await save(await mid.screenshot(), "title");
  await mid.click("#title-achievements");
  await mid.waitForSelector("#achievements-panel:not([hidden])");
  await save(await mid.screenshot(), "achievements");
  await mid.click("#achievements-close");
  await mid.click("#title-play");
  await mid.waitForSelector("#hub:not([hidden])");
  await mid.waitForTimeout(600);
  await save(await mid.screenshot(), "tech-tree");

  await mid.click("#start-button");
  await mid.waitForFunction(() => window.__fishy?.world?.traps.length > 0 && window.__fishy.world.stats.boat.lanternRadius > 0);
  await mid.waitForTimeout(1_500);
  const netRadius = tech.applyUpgrades(BASE_STATS, upgrades).netRadius;
  let best = { score: -1, image: null };
  await chaseFish(mid, {
    steps: 70,
    netRadius,
    async onFrame(score) {
      if (score > best.score) best = { score, image: await mid.screenshot() };
    },
  });
  await save(best.image, "gameplay");

  await mid.waitForSelector("#summary-panel:not([hidden])", { timeout: 120_000 });
  await mid.waitForTimeout(1000);
  await save(await mid.screenshot(), "summary");

  // A real Endless trip with the dev-only sea-phase override set to night.
  const endless = await newPage(browser);
  await endless.addInitScript((data) => localStorage.setItem("fishy.save", data), JSON.stringify(midSave));
  await endless.goto(`${dev.url}?fish=${ALL_FISH}&time=0.5`);
  await endless.click("#title-endless");
  await endless.waitForSelector('#hud[data-mode="endless"]:not([hidden])');
  await endless.waitForFunction(() => window.__fishy?.world?.traps.length > 0 && window.__fishy.world.stats.boat.lanternRadius > 0);
  await chaseFish(endless, { steps: 65, netRadius });
  await save(await endless.screenshot(), "endless");

  // The end: a finished game.
  const done = await newPage(browser);
  const doneSave = withBadges({
    ...createSave("Skipper"),
    round: 131,
    finalRoundDone: true,
    stats: { ...createSave("Skipper").stats, totalFish: 48_213, fishByType: {}, bestRoundEarnings: 412_300, playTimeMs: 4_730_000 },
  });
  await done.addInitScript((data) => localStorage.setItem("fishy.save", data), JSON.stringify(doneSave));
  await done.goto(dev.url);
  await done.click("#title-play");
  await done.waitForSelector("#end-panel:not([hidden])");
  await done.waitForTimeout(400);
  await save(await done.screenshot(), "end");

  const errors = [first, mid, endless, done].flatMap((page) => page.errors);
  if (errors.length) throw new Error(`Page errors:\n${errors.join("\n")}`);
} finally {
  await browser.close();
  await dev.close();
}

async function save(image, name) {
  const path = `${OUT}/${name}.png`;
  await writeFile(path, image);
  console.log(`saved ${path}`);
}

/** Buys the cheapest affordable upgrade until `budget` runs out, like a careful player would. */
function buyCheapest({ TECH_NODES, buy, canBuy, levelOf, nextCost }, budget) {
  let upgrades = {};
  let money = budget;
  for (;;) {
    const options = TECH_NODES.filter((node) => canBuy(node, upgrades, money));
    if (options.length === 0) return upgrades;
    const cost = (node) => nextCost(node, levelOf(node, upgrades));
    const cheapest = options.reduce((a, b) => (cost(a) <= cost(b) ? a : b));
    ({ upgrades, money } = buy(upgrades, money, cheapest.id));
  }
}
