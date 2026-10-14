/*
 * The music manifest, public/audio/music.json: which loop file plays for each chapter, and where it
 * loops. A chapter without an entry (or a missing or empty manifest) plays the generated bed.
 * Format and how to fill it in: README, "Music and sound". Pure, so it's tested.
 */
import { BEATS_PER_BAR, DEFAULT_BPM, DEFAULT_KEY, parseKey, type Key } from "./theory";

export const MANIFEST_URL = "audio/music.json";

export type LayerName = "groove" | "combo";

export interface AudioFile {
  /** URL, relative to the manifest. */
  src: string;
  /** MIME type for canPlayType, guessed from the extension when not given. */
  type: string;
  /** Loop points for this file only, where an encoder shifted the audio (e.g. an MP3 fallback). */
  loopStart?: number;
  loopEnd?: number;
}

export interface Track {
  name: string;
  /** The same audio in several formats, best first (e.g. Opus, then AAC). The first one the browser plays is used. */
  files: AudioFile[];
  /** Seconds. Playback starts at 0, then repeats loopStart..loopEnd forever. */
  loopStart: number;
  /** Seconds; null loops to the end of the file. */
  loopEnd: number | null;
  bpm: number;
  beatsPerBar: number;
  key: Key;
  /** Level trim, so loops picked from different packs sit at the same volume. */
  gainDb: number;
  /** Optional stems, the same length as the bed, that replace a generated layer. */
  layers: Partial<Record<LayerName, AudioFile[]>>;
}

export interface MusicManifest {
  /** Index is the chapter number (see CHAPTERS). Null: generated bed. */
  chapters: (Track | null)[];
}

const MIME_BY_EXTENSION: Record<string, string> = {
  opus: 'audio/ogg; codecs="opus"',
  ogg: "audio/ogg",
  oga: "audio/ogg",
  webm: 'audio/webm; codecs="opus"',
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  wav: "audio/wav",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function guessType(src: string): string {
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(src)?.[1]?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "";
}

function parseFiles(value: unknown, where: string, problems: string[]): AudioFile[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const files: AudioFile[] = [];
  list.forEach((entry: unknown, i) => {
    const raw = typeof entry === "string" ? { src: entry } : entry;
    if (!isRecord(raw) || typeof raw.src !== "string" || raw.src.trim() === "") {
      problems.push(`${where} file ${i + 1}: needs a "src"`);
      return;
    }
    const file: AudioFile = { src: raw.src, type: typeof raw.type === "string" ? raw.type : guessType(raw.src) };
    if (finiteNumber(raw.loopStart) && raw.loopStart >= 0) file.loopStart = raw.loopStart;
    if (finiteNumber(raw.loopEnd) && raw.loopEnd > 0) file.loopEnd = raw.loopEnd;
    files.push(file);
  });
  return files;
}

function parseTrack(raw: unknown, chapter: number, problems: string[]): Track | null {
  if (raw === null || raw === undefined) return null;
  const where = `chapter ${chapter}`;
  if (!isRecord(raw)) {
    problems.push(`${where}: should be an object or null`);
    return null;
  }
  const files = parseFiles(raw.files, where, problems);
  if (files.length === 0) {
    problems.push(`${where}: no "files", so it keeps the generated music`);
    return null;
  }
  const loopStart = finiteNumber(raw.loopStart) && raw.loopStart >= 0 ? raw.loopStart : 0;
  let loopEnd = finiteNumber(raw.loopEnd) ? raw.loopEnd : null;
  if (loopEnd !== null && loopEnd <= loopStart) {
    problems.push(`${where}: loopEnd must be after loopStart; looping the whole file instead`);
    loopEnd = null;
  }
  const bpm = finiteNumber(raw.bpm) && raw.bpm >= 30 && raw.bpm <= 300 ? raw.bpm : DEFAULT_BPM;
  if (raw.bpm !== undefined && bpm !== raw.bpm) problems.push(`${where}: bpm should be 30–300; using ${DEFAULT_BPM}`);
  const beatsPerBar =
    finiteNumber(raw.beatsPerBar) && Number.isInteger(raw.beatsPerBar) && raw.beatsPerBar >= 1 && raw.beatsPerBar <= 12
      ? raw.beatsPerBar
      : BEATS_PER_BAR;
  const key = typeof raw.key === "string" ? parseKey(raw.key) : null;
  if (raw.key !== undefined && !key) problems.push(`${where}: key "${String(raw.key)}" isn't like "D major"; using D major`);
  const layers: Track["layers"] = {};
  if (isRecord(raw.layers)) {
    for (const name of ["groove", "combo"] as const) {
      const stems = parseFiles(raw.layers[name], `${where} ${name} layer`, problems);
      if (stems.length > 0) layers[name] = stems;
    }
  }
  return {
    name: typeof raw.name === "string" ? raw.name : `Chapter ${chapter}`,
    files,
    loopStart,
    loopEnd,
    bpm,
    beatsPerBar,
    key: key ?? DEFAULT_KEY,
    gainDb: finiteNumber(raw.gainDb) ? Math.min(12, Math.max(-40, raw.gainDb)) : 0,
    layers,
  };
}

/** Reads a manifest, keeping every chapter that makes sense. `problems` says what was ignored. */
export function parseManifest(data: unknown): { manifest: MusicManifest; problems: string[] } {
  const problems: string[] = [];
  if (!isRecord(data) || !Array.isArray(data.chapters)) {
    if (data !== null && data !== undefined) problems.push('expected { "chapters": [...] }');
    return { manifest: { chapters: [] }, problems };
  }
  const chapters = data.chapters.map((raw: unknown, i) => parseTrack(raw, i, problems));
  return { manifest: { chapters }, problems };
}

/**
 * The files worth trying in this browser, in manifest order: those it says it can play, and those of
 * unknown type (decoding them is the only way to tell).
 */
export function playableFiles(files: readonly AudioFile[], canPlay: (type: string) => string): AudioFile[] {
  return files.filter((file) => file.type === "" || canPlay(file.type) !== "");
}
