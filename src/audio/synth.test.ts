import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./engine";
import { createGameAudio } from "./index";
import type { WorldEvent } from "../game/world";
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
  kind = "gain";
  gain = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
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
  destination = new Node();
  createGain(): Node { const node = new Node(); this.nodes.push(node); return node; }
  createDynamicsCompressor(): Node { const node = this.createGain(); node.kind = "compressor"; return node; }
  createWaveShaper(): Node { const node = this.createGain(); node.kind = "shaper"; return node; }
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

function audioPlatform(diagnostics = false): { ctx: Context; gesture: () => void } {
  const ctx = new Context();
  let unlock = () => {};
  vi.stubGlobal("PeriodicWave", Wave);
  vi.stubGlobal("AudioContext", class { constructor() { return ctx; } });
  vi.stubGlobal("window", {
    location: { search: diagnostics ? "?audioLatency" : "" },
    addEventListener(type: string, listener: () => void) { if (type === "pointerdown") unlock = listener; },
    setInterval: () => 1,
    clearTimeout() {},
  });
  vi.stubGlobal("document", { baseURI: "http://localhost/", visibilityState: "visible", addEventListener() {} });
  // Keep bed loading pending so only real catch instrument sources are observed.
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  return { ctx, gesture: () => unlock() };
}

function gameAudio(diagnostics = false) {
  const { ctx, gesture } = audioPlatform(diagnostics);
  const audio = createGameAudio();
  gesture();
  return { ctx, audio };
}

function captures(count: number, combo: number): WorldEvent[] {
  return Array.from({ length: count }, () => ({ type: "capture", kind: "normal", source: "net", x: 0, y: 0, value: 1, combo }));
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

describe("sound effect routing and cleanup", () => {
  it("records capture-frame time and actual catch onset, including dropped batches, only when opted in", () => {
    const { ctx, audio } = gameAudio(true);
    ctx.currentTime = 3;
    audio.frame(captures(4, 8), null);
    ctx.currentTime = 3.01;
    audio.frame(captures(100, 9), null);
    ctx.currentTime = 3.06;
    audio.frame([], null);
    expect(window.__fishyAudio?.context).toBe(ctx);
    expect(window.__fishyAudio?.catches).toEqual([
      { frameTime: 3, noteTime: ctx.sources[0]!.startAt, count: 4, combo: 8 },
      { frameTime: 3.01, noteTime: null, count: 100, combo: 9 },
    ]);
    gameAudio();
    expect(window.__fishyAudio).toBeUndefined();
  });

  it("starts admitted catches within 5 ms and never replays blocked catches on a later frame", () => {
    const { ctx, audio } = gameAudio();
    // One catch, then a burst inside its 40 ms rate limit.
    ctx.currentTime = 1;
    audio.frame(captures(1, 0), null);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources.every(source => source.startAt >= 1 && source.startAt <= 1.005)).toBe(true);
    ctx.currentTime = 1.01;
    audio.frame(captures(100, 8), null);
    expect(ctx.sources).toHaveLength(2);
    // No new fish: freeing a voice must not turn those old fish into a late note.
    ctx.currentTime = 1.06;
    audio.frame([], null);
    expect(ctx.sources).toHaveLength(2);
    // A fresh simultaneous batch still gets its octave, in the supplied key and combo.
    audio.frame(captures(100, 8), null);
    const batch = ctx.sources.slice(2);
    expect(batch).toHaveLength(4);
    expect(batch.every(source => source.startAt >= 1.06 && source.startAt <= 1.065)).toBe(true);
    expect(batch[0]!.frequency.value).toBeCloseTo(880, 2); // A5: combo 8 -> degree 8 in D major pentatonic.
    expect(batch[2]!.frequency.value).toBeCloseTo(1760, 2); // Batch octave.
  });

  it("keeps a sustained burst bounded and plays no catches on empty frames", () => {
    const { ctx, audio } = gameAudio();
    let notes = 0;
    for (let frame = 0; frame < 360; frame++) {
      ctx.currentTime = 2 + frame / 120;
      const count = frame % 10 < 5 ? 50 : 0;
      const before = ctx.sources.length;
      audio.frame(captures(count, frame), null);
      const started = ctx.sources.slice(before);
      if (count === 0) expect(started).toHaveLength(0);
      else if (started.length > 0) {
        notes++;
        expect(started).toHaveLength(4); // Fundamental + overtone, and batch octave + overtone.
        for (const source of started) {
          expect(source.startAt - ctx.currentTime).toBeGreaterThanOrEqual(0);
          expect(source.startAt - ctx.currentTime).toBeLessThanOrEqual(0.005001);
        }
      }
      // The four-catch voice cap and 40 ms rate limit still apply during the burst.
      const active = ctx.sources.filter(source => source.startAt > ctx.currentTime - 0.16);
      expect(active.length).toBeLessThanOrEqual(16);
    }
    expect(notes).toBeGreaterThan(20);
    expect(notes).toBeLessThan(80);
  });

  it("drops catches when all eight effects voices are occupied, without replaying them as voices free", () => {
    const { ctx, audio } = gameAudio(true);
    ctx.currentTime = 4;
    audio.frame([
      { type: "golden", kind: "normal", x: 0, y: 0 },
      { type: "time-bonus", x: 0, y: 0, seconds: 1 },
      { type: "fx", kind: "goober", name: "burst", x: 0, y: 0 },
      { type: "trap-cast", traps: [{ id: 1, x: 0, y: 0, radius: 42, partner: null, age: 0, cooldown: 0 }] },
      { type: "trap-snap", trapId: 1, x: 0, y: 0, hits: 8 },
      { type: "seine-hit", x: 0, y: 0 }, { type: "snag", x: 0, y: 0 }, { type: "chum", x: 0, y: 0 },
      ...captures(100, 8),
    ], null);
    expect(window.__fishyAudio!.catches[0]!.noteTime).toBeNull();
    const sources = ctx.sources.length;
    expect(sources).toBeGreaterThan(0);
    // Goober's voice frees after 120 ms, inside the old 150 ms catch patience.
    ctx.currentTime = 4.13;
    audio.frame([], null);
    expect(ctx.sources).toHaveLength(sources);
    audio.frame(captures(10, 9), null);
    expect(ctx.sources).toHaveLength(sources + 4);
    expect(ctx.sources.at(-1)!.startAt).toBeCloseTo(4.135);
  });

  it("keeps effects off compressor lookahead while retaining mute and clipping protection", () => {
    const { ctx } = audioPlatform();
    const engine = new AudioEngine({ muted: false, music: 0.7, sfx: 0.8 });
    engine.unlock();
    const route = (start: Node): Node[] => [start, ...[...start.connections].flatMap(dest => route(dest as Node))];
    const effects = route(engine.sfx as unknown as Node);
    const music = route(engine.music as unknown as Node);
    expect(effects.some(node => node.kind === "compressor")).toBe(false);
    expect(music.some(node => node.kind === "compressor")).toBe(true);
    for (const path of [effects, music]) {
      expect(path).toContain(engine.master);
      expect(path.some(node => node.kind === "shaper")).toBe(true);
      expect(path).toContain(ctx.destination);
    }
  });

  it("disconnects the whirlpool modulation source along with its noise", () => {
    vi.stubGlobal("PeriodicWave", Wave);
    const ctx = new Context();
    const engine = { running: true, ctx, sfx: new Node() } as unknown as AudioEngine;
    new Sfx(engine, () => ({ tonic: 2, mode: "major" })).implode(10);
    ctx.finish();
  });

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

describe("rigging and boat sounds", () => {
  it.each(["trapSnaps", "seineHit", "snag", "chum", "trapCast"] as const)("rate-limits %s and disconnects all sources", (kind) => {
    vi.stubGlobal("PeriodicWave", Wave);
    const ctx = new Context();
    const out = new Node();
    const sfx = new Sfx({ running: true, ctx, sfx: out } as unknown as AudioEngine, () => ({ tonic: 0, mode: "major" }));
    if (kind === "trapSnaps") sfx.trapSnaps(4);
    else sfx[kind]();
    const sources = ctx.sources.length;
    expect(sources).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) {
      if (kind === "trapSnaps") sfx.trapSnaps(4);
      else sfx[kind]();
    }
    expect(ctx.sources).toHaveLength(sources);
    expect(ctx.nodes.some(node => node.connections.has(out))).toBe(true);
    ctx.currentTime = 2;
    if (kind === "trapSnaps") sfx.trapSnaps(4);
    else sfx[kind]();
    expect(ctx.sources.length).toBeGreaterThan(sources);
    ctx.finish();
  });

  it("plays exactly three soft plops for a cast, in the current key", () => {
    vi.stubGlobal("PeriodicWave", Wave);
    const ctx = new Context();
    const sfx = new Sfx({ running: true, ctx, sfx: new Node() } as unknown as AudioEngine, () => ({ tonic: 0, mode: "major" }));
    sfx.trapCast();
    const plops = ctx.sources.filter(source => source.type === "sine");
    expect(plops).toHaveLength(3);
    expect(new Set(plops.map(source => source.startAt)).size).toBe(3);
    expect(plops[0]!.frequency.value).toBeCloseTo(65.406, 2); // C3 plop resolves to C2.
    ctx.finish();
  });

  it("does not reserve a snap voice for an empty batch or make sounds while stopped", () => {
    const ctx = new Context();
    const engine = { running: true, ctx, sfx: new Node() };
    const sfx = new Sfx(engine as unknown as AudioEngine, () => ({ tonic: 2, mode: "major" }));
    sfx.trapSnaps(0);
    expect(ctx.sources).toHaveLength(0);
    engine.running = false;
    sfx.trapSnaps(4); sfx.seineHit(); sfx.snag(); sfx.chum(); sfx.trapCast();
    expect(ctx.sources).toHaveLength(0);
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

describe("weather sound", () => {
  it("reuses one wind source, follows gust strength and disconnects it on leaving the sea", () => {
    const ctx = new Context(), out = new Node();
    const sfx = new Sfx({ running: true, ctx, sfx: out } as unknown as AudioEngine, () => ({ tonic: 2, mode: "major" }));
    sfx.weather("storm", { x: 22, y: 0 });
    const source = ctx.sources[0]!;
    const filter = [...source.connections][0] as Node;
    const quiet = filter.frequency.value;
    for (let i = 0; i < 100; i++) sfx.weather("storm", { x: 45, y: 0 });
    expect(ctx.sources).toHaveLength(1);
    expect(filter.frequency.value).toBeGreaterThan(quiet);
    expect(source.loop).toBe(true);
    sfx.stopWeather();
    ctx.finish();
  });

  it("sounds one foghorn per start, keeps bubbles bounded and releases weather voices", () => {
    vi.stubGlobal("PeriodicWave", Wave);
    const ctx = new Context();
    const sfx = new Sfx({ running: true, ctx, sfx: new Node() } as unknown as AudioEngine, () => ({ tonic: 2, mode: "major" }));
    sfx.weather("fog", { x: 0, y: 0 });
    const horn = ctx.sources.length;
    expect(horn).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) sfx.weather("fog", { x: 0, y: 0 });
    expect(ctx.sources).toHaveLength(horn);
    sfx.stopWeather(); // Pause/resume should not announce the same fog again.
    sfx.weather("fog", { x: 0, y: 0 });
    expect(ctx.sources).toHaveLength(horn);
    ctx.currentTime = 5;
    sfx.weather("bloom", { x: 0, y: 0 });
    const bubbles = ctx.sources.length;
    expect(bubbles).toBeGreaterThan(horn);
    for (let i = 0; i < 100; i++) sfx.weather("bloom", { x: 0, y: 0 });
    expect(ctx.sources).toHaveLength(bubbles);
    ctx.currentTime = 6;
    sfx.weather("bloom", { x: 0, y: 0 });
    expect(ctx.sources.length).toBeGreaterThan(bubbles);
    sfx.weather("clear", { x: 0, y: 0 });
    ctx.finish();
  });

  it("muffles the music cutoff by twenty percent without resetting its mode", async () => {
    const { music, ctx } = await startMusic("endless");
    const filter = ctx.nodes.find(n => n.type === "lowpass" && n.Q.value === 0.6)!;
    expect(filter.frequency.value).toBe(9000);
    music.setFog(true);
    expect(filter.frequency.value).toBe(7200);
    music.setMode("hub");
    expect(filter.frequency.value).toBe(560);
    music.setFog(false);
    expect(filter.frequency.value).toBe(700);
  });

  it("uses the biome on screen entry and biome events even while audio is suspended", async () => {
    const { audio, ctx } = gameAudio();
    const chapter = vi.spyOn(Music.prototype, "setChapter");
    audio.screen("round", { final: false, endless: true, biome: "reef", upgrades: { "monster.unlock": 1 } });
    expect(chapter).toHaveBeenLastCalledWith(0);
    ctx.state = "suspended";
    audio.frame([{ type: "biome", biome: "trench" }], null);
    expect(chapter).toHaveBeenLastCalledWith(2);
    audio.frame([{ type: "biome", biome: "graveyard" }], null);
    expect(chapter).toHaveBeenLastCalledWith(1);
    chapter.mockRestore();
  });

  it("plays thunder with a flash once, respects reduced motion and stops wind on pause", async () => {
    const { World } = await import("../game/world");
    const { createRng } = await import("../game/rng");
    const { BASE_STATS } = await import("../game/stats");
    const { audio, ctx } = gameAudio();
    audio.screen("round", { final: false, upgrades: {} });
    const world = new World({ ...BASE_STATS, startFish: 0 }, createRng(3), 1280, 800, { round: 24, final: false, sea: "storm" });
    world.elapsed = 11.325;
    const thunder = vi.spyOn(Sfx.prototype, "thunder");
    audio.frame([], world);
    audio.frame([], world);
    expect(thunder).toHaveBeenCalledTimes(1);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    world.elapsed = 25.325;
    audio.frame([], world);
    expect(thunder).toHaveBeenCalledTimes(1);
    audio.screen("hub", { final: false, upgrades: {} });
    const sources = ctx.sources.length;
    audio.frame([], world); // main keeps pumping the same World while its pause panel is open.
    expect(ctx.sources).toHaveLength(sources);
    expect(ctx.sources.find(s => s.loop)!.stopAt).toBeLessThan(Infinity);
    thunder.mockRestore();
  });
});


it("keeps fog and its chapter paused across frames, then resumes without a second horn", async () => {
  const { World } = await import("../game/world");
  const { createRng } = await import("../game/rng");
  const { BASE_STATS } = await import("../game/stats");
  const { audio } = gameAudio();
  const chapter = vi.spyOn(Music.prototype, "setChapter");
  const fog = vi.spyOn(Music.prototype, "setFog");
  const world = new World({ ...BASE_STATS, startFish: 0 }, createRng(3), 1280, 800, { round: 24, final: false, endless: true, sea: "fog" });
  world.elapsed = 601;
  world.update(1 / 60);
  expect(world.sea).toBe("fog");
  audio.screen("round", { final: false, endless: true, biome: "graveyard", upgrades: { "monster.unlock": 1 } });
  audio.frame([], world);
  audio.screen("hub", { final: false, upgrades: { "monster.unlock": 1 } });
  expect(chapter).toHaveBeenLastCalledWith(1);
  audio.frame([], world);
  expect(fog).toHaveBeenLastCalledWith(false);
  audio.screen("round", { final: false, endless: true, upgrades: { "monster.unlock": 1 } });
  expect(chapter).toHaveBeenLastCalledWith(1);
  audio.frame([], world);
  expect(fog).toHaveBeenLastCalledWith(true);
  chapter.mockRestore(); fog.mockRestore();
});
