/*
 * Small synthesised instruments, shared by the music and the sound effects. Each call builds a few
 * oscillators or a noise source for one note, schedules it at `time` (AudioContext seconds) and
 * cleans the nodes up when it ends. Every function returns the time the note is silent.
 */

/** "Silent" for exponential ramps, which can't reach 0: −80 dB. */
const SILENT = 0.0001;

type Wave = OscillatorType | PeriodicWave;

/** One gain node per note, connected to `dest` and disconnected once the note's last source ends. */
function voice(ctx: AudioContext, dest: AudioNode): GainNode {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(dest);
  return gain;
}

function oscillator(ctx: AudioContext, wave: Wave, freq: number, dest: AudioNode, start: number, stop: number): OscillatorNode {
  const osc = ctx.createOscillator();
  if (wave instanceof PeriodicWave) osc.setPeriodicWave(wave);
  else osc.type = wave;
  osc.frequency.value = freq;
  osc.connect(dest);
  osc.start(start);
  osc.stop(stop);
  return osc;
}

/** Disconnects `nodes` when `source` stops, so finished notes can be garbage collected. */
function cleanUp(source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
  source.onended = () => {
    for (const node of nodes) node.disconnect();
  };
}

/** A percussive envelope: up to `peak` in `attack` seconds, then an exponential fall to silence over `decay`. */
function strike(param: AudioParam, time: number, peak: number, attack: number, decay: number): number {
  const level = Math.max(peak, SILENT * 2);
  param.setValueAtTime(SILENT, time);
  param.linearRampToValueAtTime(level, time + attack);
  param.exponentialRampToValueAtTime(SILENT, time + attack + decay);
  return time + attack + decay;
}

export interface PluckOptions {
  time: number;
  freq: number;
  gain: number;
  /** Seconds to fade out. */
  decay: number;
  /** The bright overtone, as a multiple of the frequency: about 3.9 sounds like a marimba bar, 5.4 like a kalimba tine. */
  overtone?: number;
  /** Level of the overtone relative to the fundamental. */
  bright?: number;
}

/** A mallet or tine: a sine with one quickly fading overtone. */
export function pluck(ctx: AudioContext, dest: AudioNode, o: PluckOptions): number {
  const out = voice(ctx, dest);
  const end = strike(out.gain, o.time, o.gain, 0.003, o.decay);
  const fundamental = oscillator(ctx, "sine", o.freq, out, o.time, end + 0.02);
  const shimmer = ctx.createGain();
  shimmer.connect(out);
  strike(shimmer.gain, o.time, o.bright ?? 0.3, 0.002, o.decay * 0.22);
  const overtone = oscillator(ctx, "sine", o.freq * (o.overtone ?? 3.93), shimmer, o.time, end + 0.02);
  cleanUp(fundamental, out, shimmer);
  cleanUp(overtone);
  return end;
}

/** Bell partials: ratio to the fundamental, level, and share of the decay. */
const BELL_PARTIALS = [
  [1, 1, 1],
  [2, 0.4, 0.6],
  [2.76, 0.25, 0.4],
  [5.4, 0.12, 0.2],
] as const;

/** A small glassy bell. */
export function bell(ctx: AudioContext, dest: AudioNode, time: number, freq: number, gain: number, decay: number): number {
  const out = voice(ctx, dest);
  out.gain.value = gain;
  const end = time + decay + 0.003;
  let last: OscillatorNode | null = null;
  for (const [ratio, level, share] of BELL_PARTIALS) {
    const partial = ctx.createGain();
    partial.connect(out);
    strike(partial.gain, time, level, 0.003, decay * share);
    last = oscillator(ctx, "sine", freq * ratio, partial, time, end + 0.02);
    cleanUp(last, partial);
  }
  if (last) last.addEventListener("ended", () => out.disconnect());
  return end;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise, made once per context and shared by every noisy sound. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

export interface NoiseOptions {
  time: number;
  gain: number;
  attack: number;
  decay: number;
  filter: BiquadFilterType;
  /** Filter frequency at the start, Hz. */
  from: number;
  /** Filter frequency at the end, Hz (default: stays at `from`). */
  to?: number;
  q?: number;
}

/** Filtered noise with a swell and fade: shakers, whooshes, swirls. Returns the voice gain for extra modulation. */
export function noise(ctx: AudioContext, dest: AudioNode, o: NoiseOptions): { end: number; out: GainNode } {
  const out = voice(ctx, dest);
  const end = strike(out.gain, o.time, o.gain, o.attack, o.decay);
  const filter = ctx.createBiquadFilter();
  filter.type = o.filter;
  filter.Q.value = o.q ?? 1;
  filter.frequency.setValueAtTime(o.from, o.time);
  if (o.to !== undefined) filter.frequency.exponentialRampToValueAtTime(o.to, end);
  filter.connect(out);
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.connect(filter);
  source.start(o.time, Math.random() * 1.5);
  source.stop(end + 0.02);
  cleanUp(source, filter, out);
  return { end, out };
}

/** A soft, low kick: a sine that drops in pitch. */
export function kick(ctx: AudioContext, dest: AudioNode, time: number, gain: number): number {
  const out = voice(ctx, dest);
  const end = strike(out.gain, time, gain, 0.004, 0.32);
  const osc = oscillator(ctx, "sine", 110, out, time, end + 0.02);
  osc.frequency.setValueAtTime(110, time);
  osc.frequency.exponentialRampToValueAtTime(46, time + 0.14);
  cleanUp(osc, out);
  return end;
}

/** A pitch-dropping blip: a soft pop. */
export function pop(ctx: AudioContext, dest: AudioNode, time: number, freq: number, gain: number): number {
  const out = voice(ctx, dest);
  const end = strike(out.gain, time, gain, 0.002, 0.11);
  const osc = oscillator(ctx, "sine", freq, out, time, end + 0.02);
  osc.frequency.setValueAtTime(freq, time);
  osc.frequency.exponentialRampToValueAtTime(freq / 2, time + 0.07);
  cleanUp(osc, out);
  return end;
}

/** A round bass note: a triangle through a low-pass, plucked (short decay) or held. */
export function bass(ctx: AudioContext, dest: AudioNode, time: number, freq: number, gain: number, length: number): number {
  const out = voice(ctx, dest);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 420;
  filter.connect(out);
  const end = strike(out.gain, time, gain, 0.012, length);
  const osc = oscillator(ctx, "triangle", freq, filter, time, end + 0.02);
  cleanUp(osc, filter, out);
  return end;
}

const padWaves = new WeakMap<BaseAudioContext, PeriodicWave>();

/** A warm, soft waveform: a few gentle harmonics, darker than a triangle. */
function padWave(ctx: AudioContext): PeriodicWave {
  let wave = padWaves.get(ctx);
  if (!wave) {
    const harmonics = [0, 1, 0.35, 0.18, 0.08, 0.04];
    wave = ctx.createPeriodicWave(new Float32Array(harmonics.length), new Float32Array(harmonics));
    padWaves.set(ctx, wave);
  }
  return wave;
}

/**
 * A pad chord held for `length` seconds: slow swell in, long release after. Two slightly detuned
 * oscillators per note give it a gentle chorus.
 */
export function pad(
  ctx: AudioContext,
  dest: AudioNode,
  o: { time: number; freqs: readonly number[]; gain: number; length: number; cutoff: number },
): number {
  const out = voice(ctx, dest);
  const attack = Math.min(1.4, o.length / 3);
  const release = 2.2;
  out.gain.setValueAtTime(0, o.time);
  out.gain.linearRampToValueAtTime(o.gain, o.time + attack);
  out.gain.setValueAtTime(o.gain, o.time + o.length);
  out.gain.setTargetAtTime(0, o.time + o.length, release / 4);
  const end = o.time + o.length + release;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = o.cutoff;
  filter.Q.value = 0.5;
  filter.connect(out);
  const wave = padWave(ctx);
  let last: OscillatorNode | null = null;
  for (const freq of o.freqs) {
    for (const cents of [-5, 5]) {
      last = oscillator(ctx, wave, freq, filter, o.time, end);
      last.detune.value = cents + (Math.random() - 0.5) * 4;
    }
  }
  if (last) cleanUp(last, filter, out);
  return end;
}

/**
 * Notes stepping through `freqs` every `stepSeconds`, retriggered each step, in one voice: the
 * Electric current, which climbs one note per jump.
 */
export function run(
  ctx: AudioContext,
  dest: AudioNode,
  o: { time: number; freqs: readonly number[]; stepSeconds: number; gain: number },
): number {
  const out = voice(ctx, dest);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2600;
  filter.connect(out);
  const steps = Math.max(1, o.freqs.length);
  const end = o.time + steps * o.stepSeconds + 0.25;
  const osc = oscillator(ctx, "triangle", o.freqs[0] ?? 440, filter, o.time, end + 0.02);
  const sparkle = ctx.createGain();
  sparkle.gain.value = 0.18;
  sparkle.connect(filter);
  const octave = oscillator(ctx, "sine", (o.freqs[0] ?? 440) * 2.01, sparkle, o.time, end + 0.02);
  out.gain.setValueAtTime(SILENT, o.time);
  o.freqs.forEach((freq, i) => {
    const t = o.time + i * o.stepSeconds;
    osc.frequency.setValueAtTime(freq, t);
    octave.frequency.setValueAtTime(freq * 2.01, t);
    out.gain.linearRampToValueAtTime(o.gain, t + 0.004);
    out.gain.exponentialRampToValueAtTime(o.gain * 0.3, t + o.stepSeconds);
  });
  out.gain.exponentialRampToValueAtTime(SILENT, end);
  cleanUp(osc, filter, out, sparkle);
  cleanUp(octave);
  return end;
}
