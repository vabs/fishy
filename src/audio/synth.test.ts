import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioEngine } from "./engine";
import { Music } from "./music";
import { Sfx } from "./sfx";
import { bass, bell, brass, clap, kick, noise, pad, pluck, pop, risingNoise, run, steelDrum } from "./synth";

// Only the Web Audio platform is doubled: the real instrument graphs and envelopes run here.
class Param {
  value = 0;
  setValueAtTime(value: number, _time: number): this { this.value = value; return this; }
  linearRampToValueAtTime(value: number, _time: number): this { this.value = value; return this; }
  exponentialRampToValueAtTime(value: number, _time: number): this {
    if (!(value > 0) || !Number.isFinite(value)) throw new Error("Invalid exponential ramp");
    this.value = value;
    return this;
  }
  setTargetAtTime(value: number, _time: number, _constant: number): this { this.value = value; return this; }
  cancelScheduledValues(_time: number): this { return this; }
}
class Node {
  gain = new Param();
  frequency = new Param();
  detune = new Param();
  Q = new Param();
  type = "";
  buffer: unknown;
  loop = false;
  connections = new Set<unknown>();
  startAt = Infinity;
  stopAt = Infinity;
  onended: (() => void) | null = null;
  listeners: (() => void)[] = [];
  connect(dest: unknown): unknown { this.connections.add(dest); return dest; }
  disconnect(): void { this.connections.clear(); }
  start(time: number): void { this.startAt = time; }
  stop(time: number): void {
    if (time < this.startAt || !Number.isFinite(time)) throw new Error("Invalid stop");
    this.stopAt = time;
  }
  setPeriodicWave(_wave: unknown): void {}
  addEventListener(_name: string, callback: () => void): void { this.listeners.push(callback); }
  end(): void { this.onended?.(); this.listeners.forEach((callback) => callback()); }
}
class Wave {}
class Context {
  currentTime = 0;
  state = "running";
  sampleRate = 8000;
  nodes: Node[] = [];
  sources: Node[] = [];
  buffers = 0;
  createGain(): Node { const node = new Node(); this.nodes.push(node); return node; }
  createBiquadFilter(): Node { return this.createGain(); }
  createOscillator(): Node { const node = this.createGain(); this.sources.push(node); return node; }
  createBufferSource(): Node { return this.createOscillator(); }
  createPeriodicWave(): Wave { return new Wave(); }
  async decodeAudioData(): Promise<{ duration: number }> { return { duration: 16 }; }
  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    this.buffers++;
    return { getChannelData: () => new Float32Array(length) };
  }
  finish(): void {
    for (const source of [...this.sources].sort((a, b) => a.stopAt - b.stopAt)) {
      expect(Number.isFinite(source.stopAt), "source has a scheduled stop").toBe(true);
      source.end();
    }
    expect(this.nodes.filter((node) => node.connections.size > 0), "finished nodes disconnected").toEqual([]);
  }
}

afterEach(() => vi.unstubAllGlobals());

const instruments: Record<string, (ctx: AudioContext, dest: AudioNode) => unknown> = {
  pluck: (ctx, dest) => pluck(ctx, dest, { time: 0, freq: 294, gain: 0.1, decay: 0.5 }),
  steelDrum: (ctx, dest) => steelDrum(ctx, dest, { time: 0, freq: 294, gain: 0.1, decay: 0.65 }),
  bell: (ctx, dest) => bell(ctx, dest, 0, 588, 0.1, 0.5),
  kick: (ctx, dest) => kick(ctx, dest, 0, 0.1),
  clap: (ctx, dest) => clap(ctx, dest, 0, 0.1),
  bass: (ctx, dest) => bass(ctx, dest, 0, 73, 0.1, 0.15),
  brass: (ctx, dest) => brass(ctx, dest, 0, 294, 0.1, 0.6),
  pop: (ctx, dest) => pop(ctx, dest, 0, 294, 0.1),
  pad: (ctx, dest) => pad(ctx, dest, { time: 0, freqs: [73, 220, 294], gain: 0.01, length: 4, cutoff: 1100 }),
  run: (ctx, dest) => run(ctx, dest, { time: 0, freqs: [294, 330, 440], gain: 0.1, stepSeconds: 0.045 }),
};

describe("instrument lifecycle", () => {
  for (const [name, play] of Object.entries(instruments)) {
    it(`${name} stops and disconnects every source and intermediate node`, () => {
      vi.stubGlobal("PeriodicWave", Wave);
      const ctx = new Context();
      play(ctx as unknown as AudioContext, new Node() as unknown as AudioNode);
      ctx.finish();
    });
  }

  it("reuses one noise buffer for drums and the riser, and releases the riser on cancellation", () => {
    const ctx = new Context();
    const context = ctx as unknown as AudioContext;
    const dest = new Node() as unknown as AudioNode;
    const options = { time: 0, gain: 0.01, attack: 0.001, decay: 0.03, filter: "highpass" as const, from: 7000 };
    for (let i = 0; i < 100; i++) noise(context, dest, options);
    const riser = risingNoise(context, dest, 0, 0.018);
    riser.setLevel(0.2);
    riser.setLevel(1);
    ctx.currentTime = 1;
    riser.stop();
    riser.stop();
    expect(ctx.buffers).toBe(1);
    expect(ctx.sources.at(-1)!.stopAt).toBeCloseTo(1.025);
    ctx.finish();
  });
});

describe("reward sound routing", () => {
  it("rate-limits each reward, follows the current key and routes through the effects bus", () => {
    vi.stubGlobal("PeriodicWave", Wave);
    const ctx = new Context();
    const out = new Node();
    const engine = { running: true, ctx, sfx: out } as unknown as AudioEngine;
    const sfx = new Sfx(engine, () => ({ tonic: 0, mode: "minor" }));
    sfx.bounty();
    const bountySources = ctx.sources.length;
    expect(bountySources).toBeGreaterThan(0);
    expect(ctx.sources[0]!.frequency.value).toBeCloseTo(523.251, 2); // C5 in the supplied key.
    sfx.bounty();
    expect(ctx.sources).toHaveLength(bountySources);
    sfx.achievement();
    const bothSources = ctx.sources.length;
    expect(bothSources).toBeGreaterThan(bountySources);
    expect(ctx.sources[bountySources]!.frequency.value).toBeCloseTo(261.626, 2); // C4.
    sfx.achievement();
    expect(ctx.sources).toHaveLength(bothSources);
    expect(ctx.nodes.some((node) => node.connections.has(out))).toBe(true);
    ctx.currentTime = 1.3;
    sfx.achievement();
    sfx.bounty();
    expect(ctx.sources.length).toBeGreaterThan(bothSources);
    ctx.finish();
  });
});

async function startMusic(mode: "hub" | "round" | "endless" = "hub", chapters: unknown[] = []): Promise<{ music: Music; ctx: Context }> {
  vi.stubGlobal("PeriodicWave", Wave);
  vi.stubGlobal("window", { setInterval: () => 1 });
  vi.stubGlobal("document", { baseURI: "http://localhost/", createElement: () => ({ canPlayType: () => "probably" }) });
  vi.stubGlobal("fetch", async () => ({ ok: true, text: async () => JSON.stringify({ chapters }), arrayBuffer: async () => new ArrayBuffer(0) }));
  const ctx = new Context();
  const music = new Music();
  music.setMode(mode);
  music.start(ctx as unknown as AudioContext, new Node() as unknown as AudioNode);
  // Wait for the actual manifest loader and bed switch, without scheduling a real timer.
  for (let i = 0; i < 30; i++) await Promise.resolve();
  return { music, ctx };
}

describe("music transitions", () => {
  it("keeps the first downbeat when round entry falls inside the lookahead", async () => {
    const { music, ctx } = await startMusic();
    music.pump(); // In the hub, scan the first .3 s without scheduling any drums.
    music.setMode("round"); // The bed's first downbeat at .1 s is still in that lookahead.
    music.pump();
    const kicks = ctx.sources.filter((source) => source.type === "sine" && source.frequency.value === 48);
    expect(kicks.some((source) => Math.abs(source.startAt - 0.1) < 1e-6)).toBe(true);
  });

  it("stops the countdown source when leaving a round and never starts one in endless", async () => {
    const { music, ctx } = await startMusic("round");
    music.setUrgency(0.5);
    const riser = ctx.sources.find((source) => source.loop)!;
    expect(riser).toBeDefined();
    ctx.currentTime = 0.2;
    music.setMode("hub");
    expect(riser.stopAt).toBeCloseTo(0.225);
    music.setMode("endless");
    const count = ctx.sources.length;
    music.setUrgency(1);
    expect(ctx.sources).toHaveLength(count);
  });

  it("keeps endless fade-out tails free of claps when returning to a calm screen", async () => {
    const { music, ctx } = await startMusic("endless");
    music.pump();
    ctx.currentTime = 0.3;
    music.setMode("hub");
    music.pump();
    expect(ctx.nodes.some((node) => node.type === "bandpass" && node.frequency.value === 3200)).toBe(false);
  });

  it("disconnects each loop source and its trim gain when the source ends", async () => {
    const { ctx } = await startMusic("hub", [{ files: "bed.opus", bpm: 108, loopEnd: 16 }]);
    const source = ctx.sources.find((node) => node.loop)!;
    expect(source).toBeDefined();
    const trim = [...source.connections][0] as Node;
    expect(trim.connections.size).toBe(1);
    source.end();
    expect(source.connections.size).toBe(0);
    expect(trim.connections.size).toBe(0);
  });

  it("adds and releases the frenzy percussion without leaving a continuous source", async () => {
    const { music, ctx } = await startMusic("round");
    music.setFrenzy(true);
    music.pump();
    const firstCount = ctx.sources.length;
    expect(firstCount).toBeGreaterThan(0);
    music.setFrenzy(false);
    music.setMode("title");
    for (const source of ctx.sources) expect(Number.isFinite(source.stopAt)).toBe(true);
  });
});
