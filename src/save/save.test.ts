import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeSave } from "./file";
import {
  CORRUPT_SAVE_KEY,
  SAVE_ERRORS,
  SAVE_KEY,
  createSave,
  loadSave,
  parseSave,
  recordRound,
  resetProgress,
  sanitizeUpgrades,
  saveFileName,
  validateName,
  writeSave,
  type NodeInfo,
  type SaveData,
} from "./index";
import { migrate, type Migrations } from "./migrations";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const NODES: readonly NodeInfo[] = [
  { id: "net.size", maxLevel: 5 },
  { id: "net.damage", maxLevel: 10 },
];

/** Just enough of the Storage interface for tests. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

/** A save with some progress in it. */
function playedSave(): SaveData {
  return {
    ...createSave("Ann", NOW),
    money: 1234,
    round: 5,
    upgrades: { "net.size": 2, "net.damage": 3 },
    stats: { totalFish: 40, fishByType: { normal: 35, uncommon: 5 }, bestRoundEarnings: 500, playTimeMs: 120_000 },
  };
}

/** A save file's JSON with some fields replaced, as a hand-edited file might be. */
function edited(changes: Record<string, unknown>): string {
  return JSON.stringify({ ...playedSave(), ...changes });
}

function parseOk(text: string): SaveData {
  const result = parseSave(text, NODES);
  if (!result.ok) throw new Error(`expected a valid save, got: ${result.error}`);
  return result.save;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createSave", () => {
  it("starts a new game at round 1 with nothing", () => {
    expect(createSave("Ann", NOW)).toEqual({
      version: 1,
      playerName: "Ann",
      money: 0,
      round: 1,
      upgrades: {},
      stats: { totalFish: 0, fishByType: {}, bestRoundEarnings: 0, playTimeMs: 0 },
      finalRoundDone: false,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });
});

describe("writeSave and loadSave", () => {
  it("round-trips a save through storage", () => {
    const storage = memoryStorage();
    const save = playedSave();
    expect(writeSave(save, storage)).toBe(true);
    expect(loadSave(storage)).toEqual(save);
  });

  it("stamps updatedAt on write", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T08:30:00.000Z"));
    const storage = memoryStorage();
    const save = playedSave();
    writeSave(save, storage);
    expect(save.updatedAt).toBe("2026-10-14T08:30:00.000Z");
    expect(loadSave(storage)?.updatedAt).toBe("2026-10-14T08:30:00.000Z");
    expect(loadSave(storage)?.createdAt).toBe(NOW.toISOString());
  });

  it("returns null when there is no save", () => {
    expect(loadSave(memoryStorage())).toBeNull();
  });

  it.each([
    ["broken JSON", '{"version": 1, "playerName": "Ann"'],
    ["the wrong shape", JSON.stringify({ version: 1, playerName: "Ann", money: "lots" })],
    ["a newer version", edited({ version: 99 })],
  ])("moves %s aside instead of crashing or losing it", (_, raw) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = memoryStorage({ [SAVE_KEY]: raw });
    expect(loadSave(storage)).toBeNull();
    expect(storage.getItem(CORRUPT_SAVE_KEY)).toBe(raw);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
  });

  it("keeps a corrupt save in place if the backup can't be written", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = memoryStorage({ [SAVE_KEY]: "not json" });
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(loadSave(storage)).toBeNull();
    expect(storage.getItem(SAVE_KEY)).toBe("not json");
  });

  it("keeps unknown upgrade ids (it has no node list) but repairs bad numbers", () => {
    const storage = memoryStorage({ [SAVE_KEY]: edited({ money: -50, upgrades: { "old.node": 3, "net.size": -1 } }) });
    const save = loadSave(storage);
    expect(save?.money).toBe(0);
    expect(save?.upgrades).toEqual({ "old.node": 3, "net.size": 0 });
  });

  it("doesn't throw when storage is unavailable", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = memoryStorage();
    broken.getItem = () => {
      throw new Error("SecurityError");
    };
    broken.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(loadSave(broken)).toBeNull();
    expect(writeSave(playedSave(), broken)).toBe(false);
  });
});

describe("recordRound", () => {
  it("banks the money, moves to the next round and adds to the stats", () => {
    const before = playedSave();
    const snapshot = structuredClone(before);
    const after = recordRound(before, { earned: 300, caught: { normal: 10, rare: 2 }, durationMs: 30_000 });

    expect(after.money).toBe(1534);
    expect(after.round).toBe(6);
    expect(after.stats).toEqual({
      totalFish: 52,
      fishByType: { normal: 45, uncommon: 5, rare: 2 },
      bestRoundEarnings: 500,
      playTimeMs: 150_000,
    });
    expect(after.upgrades).toEqual(before.upgrades);
    expect(before).toEqual(snapshot);
  });

  it("raises the best round and ignores empty counts", () => {
    const after = recordRound(playedSave(), { earned: 900, caught: { normal: 0, epic: undefined }, durationMs: 0 });
    expect(after.stats.bestRoundEarnings).toBe(900);
    expect(after.stats.totalFish).toBe(40);
    expect(after.stats.fishByType).toEqual({ normal: 35, uncommon: 5 });
  });
});

describe("resetProgress", () => {
  it("wipes everything except the player's name", () => {
    const later = new Date("2026-11-01T00:00:00.000Z");
    const save = { ...playedSave(), finalRoundDone: true };
    expect(resetProgress(save, later)).toEqual(createSave("Ann", later));
  });
});

describe("validateName", () => {
  it.each([
    ["Ann", "Ann"],
    ["  Captain Ann  ", "Captain Ann"],
    ["x".repeat(24), "x".repeat(24)],
    ["🐟".repeat(24), "🐟".repeat(24)],
    ["Zoë", "Zoë"],
  ])("accepts %j", (raw, name) => {
    expect(validateName(raw)).toEqual({ ok: true, name });
  });

  it.each([
    ["an empty name", ""],
    ["only spaces", "   \t "],
    ["25 characters", "x".repeat(25)],
    ["a tab inside", "Ann\tBob"],
    ["a line break inside", "Ann\nBob"],
    ["a control character", "Ann\u0007"],
    ["a line separator", `Ann${String.fromCharCode(0x2028)}Bob`],
  ])("rejects %s", (_, raw) => {
    const result = validateName(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toBe("");
  });
});

describe("parseSave", () => {
  it("reads back an exported save unchanged", () => {
    const save = playedSave();
    expect(parseOk(serializeSave(save))).toEqual(save);
  });

  it("accepts a file that starts with a byte order mark", () => {
    const bom = String.fromCharCode(0xfeff);
    expect(parseOk(`${bom}${serializeSave(playedSave())}`).playerName).toBe("Ann");
  });

  it.each([
    ["bad JSON", "{ nope"],
    ["an empty file", ""],
    ["a number", "42"],
    ["an array", "[1, 2]"],
    ["null", "null"],
    ["an object without a version", JSON.stringify({ playerName: "Ann", money: 1 })],
    ["another app's file", JSON.stringify({ name: "fishy", version: "0.1.0" })],
    ["a negative version", JSON.stringify({ version: -1 })],
  ])("says %s isn't a Fishy save", (_, text) => {
    expect(parseSave(text, NODES)).toEqual({ ok: false, error: SAVE_ERRORS.notASave });
  });

  it.each([
    ["a missing field", (() => {
      const { stats: _, ...rest } = playedSave();
      return JSON.stringify(rest);
    })()],
    ["a wrong type", edited({ money: "1000" })],
    ["a non-number level", edited({ upgrades: { "net.size": "max" } })],
    ["an unusable name", edited({ playerName: " \n\t " })],
  ])("rejects a save with %s as damaged", (_, text) => {
    expect(parseSave(text, NODES)).toEqual({ ok: false, error: SAVE_ERRORS.damaged });
  });

  it("refuses a save from a newer version", () => {
    expect(parseSave(edited({ version: 2 }), NODES)).toEqual({ ok: false, error: SAVE_ERRORS.newer });
  });

  it("drops unknown upgrade ids and clamps levels to [0, maxLevel]", () => {
    const save = parseOk(edited({ upgrades: { "net.size": 99, "net.damage": -4, "removed.node": 2 } }));
    expect(save.upgrades).toEqual({ "net.size": 5, "net.damage": 0 });
  });

  it("rounds fractional levels down", () => {
    expect(parseOk(edited({ upgrades: { "net.size": 2.7 } })).upgrades).toEqual({ "net.size": 2 });
  });

  it("clamps money, round and stats to sane values", () => {
    const save = parseOk(
      edited({
        money: -500,
        round: -3,
        stats: { totalFish: -1, fishByType: { normal: -2, rare: 1.5 }, bestRoundEarnings: -10, playTimeMs: 1e300 },
      }),
    );
    expect(save.money).toBe(0);
    expect(save.round).toBe(1);
    expect(save.stats).toEqual({
      totalFish: 0,
      fishByType: { normal: 0, rare: 1 },
      bestRoundEarnings: 0,
      playTimeMs: Number.MAX_SAFE_INTEGER,
    });
  });

  it("repairs a hand-edited name and timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const save = parseOk(edited({ playerName: `  Ann\u0007${"y".repeat(40)}`, createdAt: "yesterday-ish" }));
    expect(save.playerName).toBe(`Ann${"y".repeat(21)}`);
    expect(validateName(save.playerName).ok).toBe(true);
    expect(save.createdAt).toBe(NOW.toISOString());
  });

  it("drops fields it doesn't know", () => {
    expect(parseOk(edited({ cheats: true }))).not.toHaveProperty("cheats");
  });

  describe("migrations", () => {
    /** A made-up version 0 format, to prove old saves are upgraded before they are validated. */
    const v0 = { version: 0, name: "Old Salt", coins: 120, level: 4, nets: { "net.size": 9, gone: 1 } };
    const fromV0: Migrations = {
      0: (old) => ({
        playerName: old.name,
        money: old.coins,
        round: old.level,
        upgrades: old.nets,
        stats: { totalFish: 0, fishByType: {}, bestRoundEarnings: 0, playTimeMs: 0 },
        finalRoundDone: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    };

    it("upgrades an old save to the current version, then sanitises it", () => {
      expect(parseSave(JSON.stringify(v0), NODES, fromV0)).toEqual({
        ok: true,
        save: {
          version: 1,
          playerName: "Old Salt",
          money: 120,
          round: 4,
          upgrades: { "net.size": 5 },
          stats: { totalFish: 0, fishByType: {}, bestRoundEarnings: 0, playTimeMs: 0 },
          finalRoundDone: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      });
    });

    it("says a version with no migration path is too old", () => {
      expect(parseSave(JSON.stringify(v0), NODES)).toEqual({ ok: false, error: SAVE_ERRORS.tooOld });
    });

    it("treats a migration that fails on bad data as damaged", () => {
      const broken = JSON.stringify({ version: 0 });
      const strict: Migrations = { 0: (old) => ({ ...old, upgrades: Object.keys(old.nets as object) }) };
      expect(parseSave(broken, NODES, strict)).toEqual({ ok: false, error: SAVE_ERRORS.damaged });
    });

    it("runs every step in order and sets the version", () => {
      const steps: Migrations = {
        0: (save) => ({ ...save, trail: ["0->1"] }),
        1: (save) => ({ ...save, trail: [...(save.trail as string[]), "1->2"] }),
      };
      expect(migrate({ version: 0 }, steps, 2)).toEqual({ ok: true, save: { version: 2, trail: ["0->1", "1->2"] } });
    });
  });
});

describe("sanitizeUpgrades", () => {
  it("keeps known nodes within their level range", () => {
    expect(sanitizeUpgrades({ "net.size": 6, "net.damage": 3, other: 1 }, NODES)).toEqual({
      "net.size": 5,
      "net.damage": 3,
    });
  });
});

describe("saveFileName", () => {
  const day = new Date(2026, 9, 3);

  it.each([
    ["Ann", "fishy-Ann-2026-10-03.json"],
    ["Captain Ann", "fishy-Captain-Ann-2026-10-03.json"],
    ["../../etc/passwd", "fishy-etc-passwd-2026-10-03.json"],
    ['a<b>:"c"|?*', "fishy-a-b-c-2026-10-03.json"],
    ["Zoë_釣り", "fishy-Zoë_釣り-2026-10-03.json"],
    ["🐟🐟", "fishy-player-2026-10-03.json"],
  ])("makes %j safe", (name, file) => {
    expect(saveFileName(name, day)).toBe(file);
  });
});
