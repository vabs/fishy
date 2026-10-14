// Helpers for scripts that drive the game in a real browser (screenshots, smoke test).
// playwright-core drives the locally installed Google Chrome; nothing is downloaded.
import { chromium } from "playwright-core";
import { createServer } from "vite";

export const VIEWPORT = { width: 1280, height: 800 };

/** Starts the Vite dev server. `load(path)` imports a source module (e.g. the tech tree) in Node. */
export async function startDevServer(port = 5190) {
  const server = await createServer({ server: { port }, logLevel: "error" });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite dev server did not report a URL");
  return { url, close: () => server.close(), load: (path) => server.ssrLoadModule(path) };
}

export function launchChrome() {
  return chromium.launch({ channel: "chrome" });
}

/** A fresh page (empty localStorage) that records uncaught page errors in `page.errors`. */
export async function newPage(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (error) => page.errors.push(String(error)));
  return page;
}

/**
 * Keeps the net on the nearest fish (found by scanning the canvas for silhouette pixels) for
 * `steps` frames. Calls `onFrame(score)` after each move, where score counts full-colour pixels in
 * the lens, i.e. how much fish the net is showing.
 */
export async function chaseFish(page, { steps, netRadius = 40, onFrame }) {
  let pos = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 4 };
  for (let i = 0; i < steps; i++) {
    const fish = await page.evaluate(findNearestSilhouette, pos);
    if (fish) {
      pos = fish;
      await page.mouse.move(pos.x, pos.y, { steps: 2 });
    }
    await page.waitForTimeout(60);
    if (onFrame) await onFrame(await page.evaluate(lensColourScore, { ...pos, radius: netRadius }));
  }
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
