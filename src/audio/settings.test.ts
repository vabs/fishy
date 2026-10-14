import { describe, expect, it } from "vitest";
import { SAVE_KEY } from "../save";
import { AUDIO_KEY, DEFAULT_AUDIO_SETTINGS, loadAudioSettings, parseAudioSettings, sliderToGain, writeAudioSettings } from "./settings";

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  failWrites = false;
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.items.set(key, value);
  }
}

describe("parseAudioSettings", () => {
  it("uses defaults when nothing is stored or it can't be read", () => {
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings("{nope")).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings("[1,2]")).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it("keeps valid fields and repairs the rest", () => {
    expect(parseAudioSettings('{"muted":true,"music":0.25}')).toEqual({ ...DEFAULT_AUDIO_SETTINGS, muted: true, music: 0.25 });
    expect(parseAudioSettings('{"muted":"yes","music":7,"sfx":-1}')).toEqual({
      muted: DEFAULT_AUDIO_SETTINGS.muted,
      music: 1,
      sfx: 0,
    });
  });
});

describe("audio settings storage", () => {
  it("round-trips under its own key, apart from the save", () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, "save");
    expect(writeAudioSettings({ muted: true, music: 0.3, sfx: 0.9 }, storage)).toBe(true);
    expect(AUDIO_KEY).not.toBe(SAVE_KEY);
    expect(loadAudioSettings(storage)).toEqual({ muted: true, music: 0.3, sfx: 0.9 });
    expect(storage.getItem(SAVE_KEY)).toBe("save");
  });

  it("reports a refused write instead of throwing", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(writeAudioSettings(DEFAULT_AUDIO_SETTINGS, storage)).toBe(false);
  });

  it("falls back to defaults when there's no storage at all", () => {
    expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});

describe("sliderToGain", () => {
  it("is silent at 0, full at 1 and quieter than linear between", () => {
    expect(sliderToGain(0)).toBe(0);
    expect(sliderToGain(1)).toBe(1);
    expect(sliderToGain(0.5)).toBe(0.25);
    expect(sliderToGain(2)).toBe(1);
    expect(sliderToGain(-1)).toBe(0);
  });
});
