import { afterEach, describe, expect, it, vi } from "vitest";
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
  sampleRate = 8000;
  nodes: Node[] = [];
  sources: Node[] = [];
  buffers = 0;
  createGain(): Node { const node = new Node(); this.nodes.push(node); return node; }
  createBiquadFilter(): Node { return this.createGain(); }
  createOscillator(): Node { const node = this.createGain(); this.sources.push(node); return node; }
  createBufferSource(): Node { return this.createOscillator(); }
  createPeriodicWave(): Wave { return new Wave(); }
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
