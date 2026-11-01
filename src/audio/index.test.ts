import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldEvent } from "../game/world";
import { createGameAudio } from "./index";

const sounds = vi.hoisted(() => ({
  trapSnaps: vi.fn(), seineHit: vi.fn(), snag: vi.fn(), chum: vi.fn(), trapCast: vi.fn(), catches: vi.fn(),
}));
const state = vi.hoisted(() => ({ running: true }));
vi.mock("./engine", () => ({ AudioEngine: class {
  static supported = true;
  get running() { return state.running; }
  whenReady() {}
  listen() {}
} }));
vi.mock("./music", () => ({ Music: class {
  setUrgency() {}
  setFrenzy() {}
  pump() {}
} }));
vi.mock("./sfx", () => ({ Sfx: class { constructor() { Object.assign(this, sounds); } } }));

const snap = (id: number): WorldEvent => ({ type: "trap-snap", trapId: id, x: 100, y: 200, hits: 8 });
const cast: WorldEvent = { type: "trap-cast", traps: [{ id: 1, x: 100, y: 200, radius: 42, partner: null, age: 0, cooldown: 0 }] };
function audio() {
  vi.stubGlobal("window", { addEventListener() {} });
  return createGameAudio();
}
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); state.running = true; });

describe("world tool audio", () => {
  it("batches simultaneous trap snaps into one voice, counting nets rather than fish", () => {
    audio().frame([snap(1), snap(2), snap(3), snap(4)], null);
    expect(sounds.trapSnaps).toHaveBeenCalledExactlyOnceWith(4);
    expect(sounds.catches).toHaveBeenCalledWith(0, 0);
  });

  it("coalesces busy seine, snag, chum and cast events per frame", () => {
    const events: WorldEvent[] = [cast, { type: "seine-hit", x: 100, y: 200 }, { type: "snag", x: 100, y: 200 }, { type: "chum", x: 640, y: 400 }];
    audio().frame([...events, ...events], null);
    for (const name of ["seineHit", "snag", "chum", "trapCast"] as const) expect(sounds[name]).toHaveBeenCalledTimes(1);
    expect(sounds.trapSnaps).not.toHaveBeenCalled();
  });

  it("keeps empty casts, ordinary frames and a stopped audio engine silent", () => {
    const gameAudio = audio();
    gameAudio.frame([{ type: "trap-cast", traps: [] }], null);
    expect(sounds.trapCast).not.toHaveBeenCalled();
    state.running = false;
    gameAudio.frame([snap(1), cast, { type: "chum", x: 0, y: 0 }], null);
    expect(sounds.trapSnaps).not.toHaveBeenCalled();
    expect(sounds.chum).not.toHaveBeenCalled();
  });
});
