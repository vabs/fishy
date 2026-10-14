// Captures the README screenshots into docs/screenshots/: npm run screenshots
// Needs Google Chrome installed.
import { writeFile, mkdir } from "node:fs/promises";
import { chaseFish, launchChrome, newPage, startDevServer } from "./lib/browser.mjs";

const OUT = "docs/screenshots";
/** Money spent on the cheapest upgrades first, for the mid-game shots. */
const MID_GAME_BUDGET = 60_000;
const ALL_FISH = "normal,uncommon,rare,electric,epic,goober,monster,star";

await mkdir(OUT, { recursive: true });
const dev = await startDevServer(5190);
const browser = await launchChrome();
try {
  const tech = await dev.load("/src/game/tech/index.ts");
  const { BASE_STATS } = await dev.load("/src/game/stats.ts");
  const { createSave } = await dev.load("/src/save/index.ts");

  // First visit: the name prompt.
  const first = await newPage(browser);
  await first.goto(dev.url);
  await first.waitForSelector("dialog input");
  await first.waitForTimeout(400);
  await save(await first.screenshot(), "name-prompt");

  // Mid-game: a save with a good part of the tree bought.
  const mid = await newPage(browser);
  const upgrades = buyCheapest(tech, MID_GAME_BUDGET);
  const midSave = { ...createSave("Skipper"), round: 24, money: 1_850, upgrades };
  await mid.addInitScript((data) => localStorage.setItem("fishy.save", data), JSON.stringify(midSave));
  await mid.goto(`${dev.url}?fish=${ALL_FISH}`);
  await mid.waitForSelector("#hub:not([hidden])");
  await mid.waitForTimeout(600);
  await save(await mid.screenshot(), "tech-tree");

  await mid.click("#start-button");
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
  await mid.waitForTimeout(400);
  await save(await mid.screenshot(), "summary");

  // The end: a finished game.
  const done = await newPage(browser);
  const doneSave = {
    ...createSave("Skipper"),
    round: 131,
    finalRoundDone: true,
    stats: { totalFish: 48_213, fishByType: {}, bestRoundEarnings: 412_300, playTimeMs: 4_730_000 },
  };
  await done.addInitScript((data) => localStorage.setItem("fishy.save", data), JSON.stringify(doneSave));
  await done.goto(dev.url);
  await done.waitForSelector("#end-panel:not([hidden])");
  await done.waitForTimeout(400);
  await save(await done.screenshot(), "end");

  const errors = [first, mid, done].flatMap((page) => page.errors);
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
