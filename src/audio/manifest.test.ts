import { describe, expect, it } from "vitest";
import { DEFAULT_KEY } from "./theory";
import { guessType, parseManifest, playableFiles } from "./manifest";
import shippedManifest from "../../public/audio/music.json?raw";

describe("parseManifest", () => {
  it("reads a full chapter entry", () => {
    const { manifest, problems } = parseManifest({
      chapters: [
        {
          name: "Shallows",
          files: ["shallows.opus", { src: "shallows.m4a", loopStart: 0.046 }],
          loopStart: 0,
          loopEnd: 20.87,
          bpm: 92,
          key: "D major",
          gainDb: -3,
          layers: { groove: ["shallows-groove.opus"] },
        },
        null,
      ],
    });
    expect(problems).toEqual([]);
    expect(manifest.chapters).toHaveLength(2);
    expect(manifest.chapters[1]).toBeNull();
    expect(manifest.chapters[0]).toEqual({
      name: "Shallows",
      files: [
        { src: "shallows.opus", type: 'audio/ogg; codecs="opus"' },
        { src: "shallows.m4a", type: "audio/mp4", loopStart: 0.046 },
      ],
      loopStart: 0,
      loopEnd: 20.87,
      bpm: 92,
      beatsPerBar: 4,
      key: DEFAULT_KEY,
      gainDb: -3,
      layers: { groove: [{ src: "shallows-groove.opus", type: 'audio/ogg; codecs="opus"' }] },
    });
  });

  it("fills defaults for a bare entry", () => {
    const { manifest } = parseManifest({ chapters: [{ files: "bed.mp3" }] });
    expect(manifest.chapters[0]).toMatchObject({ loopStart: 0, loopEnd: null, bpm: 92, beatsPerBar: 4, key: DEFAULT_KEY, gainDb: 0 });
  });

  it("drops what doesn't make sense and says why", () => {
    const { manifest, problems } = parseManifest({
      chapters: [{ files: [] }, { files: ["a.opus"], loopStart: 5, loopEnd: 2, bpm: 9000, key: "Q" }, 42],
    });
    expect(manifest.chapters[0]).toBeNull();
    expect(manifest.chapters[1]).toMatchObject({ loopEnd: null, bpm: 92, key: DEFAULT_KEY });
    expect(manifest.chapters[2]).toBeNull();
    expect(problems).toHaveLength(5);
  });

  it("treats a missing or malformed manifest as no loops", () => {
    expect(parseManifest(null)).toEqual({ manifest: { chapters: [] }, problems: [] });
    expect(parseManifest({ tracks: [] }).manifest.chapters).toEqual([]);
    expect(parseManifest("<!doctype html>").problems).toHaveLength(1);
  });

  it("accepts the manifest that ships with the game", () => {
    expect(parseManifest(JSON.parse(shippedManifest)).problems).toEqual([]);
  });
});

describe("files", () => {
  it("guesses MIME types from extensions", () => {
    expect(guessType("a/b/bed.OPUS")).toBe('audio/ogg; codecs="opus"');
    expect(guessType("bed.m4a?v=2")).toBe("audio/mp4");
    expect(guessType("bed")).toBe("");
  });

  it("keeps files the browser can play, in order, and unknown ones to try", () => {
    const files = [
      { src: "a.opus", type: 'audio/ogg; codecs="opus"' },
      { src: "a.m4a", type: "audio/mp4" },
      { src: "a.raw", type: "" },
    ];
    const safari = (type: string): string => (type === "audio/mp4" ? "probably" : "");
    expect(playableFiles(files, safari).map((f) => f.src)).toEqual(["a.m4a", "a.raw"]);
    expect(playableFiles(files, () => "maybe").map((f) => f.src)).toEqual(["a.opus", "a.m4a", "a.raw"]);
  });
});
