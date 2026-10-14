import { describe, expect, it } from "vitest";
import { AUDIO_KEY } from "../audio/settings";
import { SAVE_KEY } from "../save";
import { DEFAULT_DISPLAY_SETTINGS, DISPLAY_KEY, loadDisplaySettings, parseDisplaySettings, writeDisplaySettings } from "./display-settings";

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  failReads = false;
  failWrites = false;
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    if (this.failReads) throw new Error("SecurityError");
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

describe("parseDisplaySettings", () => {
  it("uses defaults when nothing is stored or it can't be read", () => {
    expect(parseDisplaySettings(null)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings("{nope")).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings("[true]")).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings('{"colorBlind":"yes"}')).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("keeps a valid setting", () => {
    expect(parseDisplaySettings('{"colorBlind":true}')).toEqual({ colorBlind: true });
  });
});

describe("display settings storage", () => {
  it("round-trips under its own key, apart from the save and the sound settings", () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, "save");
    expect(writeDisplaySettings({ colorBlind: true }, storage)).toBe(true);
    expect(new Set([DISPLAY_KEY, SAVE_KEY, AUDIO_KEY]).size).toBe(3);
    expect(loadDisplaySettings(storage)).toEqual({ colorBlind: true });
    expect(storage.getItem(SAVE_KEY)).toBe("save");
  });

  it("treats blocked storage as off, and reports a refused write instead of throwing", () => {
    const storage = new MemoryStorage();
    storage.failReads = true;
    expect(loadDisplaySettings(storage)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    storage.failWrites = true;
    expect(writeDisplaySettings({ colorBlind: true }, storage)).toBe(false);
  });

  it("falls back to defaults when there's no storage at all", () => {
    expect(loadDisplaySettings()).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(writeDisplaySettings({ colorBlind: true })).toBe(false);
  });
});
