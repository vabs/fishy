// Run: node scripts/audio-latency.mjs [--json]. Uses system Google Chrome and an isolated save.
// Measures capture-frame -> scheduled catch onset, NOT speaker/acoustic latency.
import assert from "node:assert/strict";
import { chaseFish, launchChrome, newPage, startDevServer } from "./lib/browser.mjs";

const dev = await startDevServer(5195);
let browser;
try {
  browser = await launchChrome();
  const page = await newPage(browser);
  const { createSave } = await dev.load("/src/save/index.ts");
  await page.addInitScript(save => {
    localStorage.setItem("fishy.save", JSON.stringify(save));
    localStorage.setItem("fishy.audio", JSON.stringify({ muted: false, music: 0.7, sfx: 0.8 }));
  }, createSave("Captain Latency"));
  await page.goto(new URL("?audioLatency", dev.url).href);
  await page.locator("#title-play").click();
  await page.locator("#hud:not([hidden])").waitFor();
  await page.waitForFunction(() => window.__fishyAudio?.context?.state === "running" && window.__fishy?.world);

  // Exercise normal pointer catches before a reproducible high-rate burst.
  await chaseFish(page, { steps: 40 });
  const normal = await page.evaluate(() => window.__fishyAudio.catches.splice(0));
  const burst = await page.evaluate(async () => {
    const diagnostics = window.__fishyAudio;
    // Real captures go through World's capture queue, next fixed step, drainEvents, audio.frame
    // and the real instruments. Quiet gaps expose any catches deferred to later frames.
    for (let frame = 0; frame < 180; frame++) {
      await new Promise(requestAnimationFrame);
      const world = window.__fishy.world;
      if (!world || world.over) throw new Error("Round ended during the latency probe");
      if (frame % 12 >= 6) continue;
      for (let i = 0; i < 25; i++) {
        const fish = world.spawn("normal");
        if (fish) world.damage(fish, fish.hp, "net");
      }
    }
    for (let frame = 0; frame < 15; frame++) await new Promise(requestAnimationFrame);
    return diagnostics.catches.splice(0);
  });
  const context = await page.evaluate(() => {
    const ctx = window.__fishyAudio.context;
    return {
      state: ctx.state,
      currentTime: ctx.currentTime,
      sampleRate: ctx.sampleRate,
      latencyHint: "interactive",
      baseLatencyMs: ctx.baseLatency * 1000,
      outputLatencyMs: typeof ctx.outputLatency === "number" ? ctx.outputLatency * 1000 : null,
    };
  });
  assert.deepEqual(page.errors, [], "Uncaught browser errors");
  assert.ok(burst.some(sample => sample.noteTime !== null), "No burst catch notes were recorded");
  assert.ok(burst.some(sample => sample.noteTime === null), "Burst did not exercise the rate limit");

  const report = { context, normal: distribution(normal), burst: distribution(burst) };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ...report, samples: { normal, burst } }, null, 2));
  } else {
    console.log("Capture frame -> catch note onset (ms; dropped batches excluded from percentiles)");
    console.table({ normal: report.normal, burst: report.burst });
    console.log("AudioContext/device estimates:", context);
    console.log("These are scheduling delays. Device latency and the 3 ms pluck attack are additional; effects bypass compressor lookahead.");
  }
} finally {
  await browser?.close();
  await dev.close();
}

function distribution(samples) {
  const delays = samples.filter(sample => sample.noteTime !== null)
    .map(sample => (sample.noteTime - sample.frameTime) * 1000).sort((a, b) => a - b);
  const percentile = p => delays.length ? +delays[Math.ceil(p * delays.length) - 1].toFixed(3) : null;
  return {
    captureBatches: samples.length,
    fish: samples.reduce((sum, sample) => sum + sample.count, 0),
    playedBatches: delays.length,
    droppedBatches: samples.length - delays.length,
    minMs: delays.length ? +delays[0].toFixed(3) : null,
    meanMs: delays.length ? +(delays.reduce((sum, delay) => sum + delay, 0) / delays.length).toFixed(3) : null,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
    maxMs: percentile(1),
  };
}
