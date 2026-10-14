// Captures the README screenshots into docs/screenshots/.
// Usage: npm run screenshots
// Needs Google Chrome installed: playwright-core drives it, no browser download.
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const OUT = "docs/screenshots";
const VIEWPORT = { width: 1280, height: 800 };
const NET_RADIUS = 40;

await mkdir(OUT, { recursive: true });
const server = await createServer({ server: { port: 5190 }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error("Vite dev server did not report a URL");

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(url);
  await page.click("#start-button");
  await page.waitForTimeout(500);
  await chaseAndCapture(page, "gameplay");

  await page.waitForSelector("#summary-panel:not([hidden])", { timeout: 30_000 });
  await page.waitForTimeout(300);
  await shot(page, "summary");

  if (errors.length) throw new Error(`Page errors:\n${errors.join("\n")}`);
} finally {
  await browser.close();
  await server.close();
}

async function shot(page, name, buffer) {
  const path = `${OUT}/${name}.png`;
  if (buffer) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, buffer);
  } else {
    await page.screenshot({ path });
  }
  console.log(`saved ${path}`);
}

/**
 * Keeps the net on the nearest fish (found by scanning the canvas for silhouette pixels) and keeps
 * the frame with the most full-colour fish inside the lens.
 */
async function chaseAndCapture(page, name) {
  let pos = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 4 };
  let best = { score: -1, buffer: null };
  for (let i = 0; i < 60; i++) {
    const fish = await page.evaluate(findNearestSilhouette, pos);
    if (fish) {
      pos = fish;
      await page.mouse.move(pos.x, pos.y, { steps: 2 });
    }
    await page.waitForTimeout(60);
    const score = await page.evaluate(lensColourScore, { ...pos, radius: NET_RADIUS });
    if (score > best.score) best = { score, buffer: await page.screenshot() };
  }
  await shot(page, name, best.buffer);
}

function findNearestSilhouette(near) {
  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const scale = canvas.width / innerWidth;
  let best = null;
  let bestDistance = Infinity;
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const i = (y * width + x) * 4;
      if (data[i] >= 20 || data[i + 1] >= 45 || data[i + 2] >= 60) continue;
      const px = x / scale;
      const py = y / scale;
      // Skip the boat.
      if (Math.hypot(px - innerWidth / 2, py - innerHeight / 2) < 60) continue;
      const distance = Math.hypot(px - near.x, py - near.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: px, y: py };
      }
    }
  }
  return best;
}

/** Counts clearly non-water pixels inside the lens, i.e. fish drawn in colour. */
function lensColourScore({ x, y, radius }) {
  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const scale = canvas.width / innerWidth;
  const r = Math.round(radius * scale);
  const { data } = ctx.getImageData(Math.round(x * scale) - r, Math.round(y * scale) - r, r * 2, r * 2);
  let score = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [red, green, blue] = [data[i], data[i + 1], data[i + 2]];
    if (red > blue + 30 || green > blue + 40) score++;
  }
  return score;
}
