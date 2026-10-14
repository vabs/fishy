import { MANIFEST_URL, parseManifest, playableFiles, type AudioFile, type LayerName, type MusicManifest, type Track } from "./manifest";

/** A decoded loop and where it loops, in seconds. */
export interface LoopBuffer {
  buffer: AudioBuffer;
  loopStart: number;
  loopEnd: number;
}

export interface LoadedTrack {
  track: Track;
  bed: LoopBuffer;
  layers: Partial<Record<LayerName, LoopBuffer>>;
}

/**
 * Fetches public/audio/music.json. Anything wrong with it is a warning, not an error: the game just
 * plays its generated music for the chapters it can't use.
 */
export async function fetchManifest(): Promise<{ manifest: MusicManifest; base: URL }> {
  const base = new URL(MANIFEST_URL, document.baseURI);
  const none = { manifest: { chapters: [] }, base };
  let data: unknown;
  try {
    const response = await fetch(base, { cache: "no-cache" });
    if (!response.ok) return none;
    data = JSON.parse(await response.text());
  } catch {
    return none;
  }
  const { manifest, problems } = parseManifest(data);
  for (const problem of problems) console.warn(`Fishy music: ${MANIFEST_URL}: ${problem}.`);
  return { manifest, base };
}

let probe: HTMLAudioElement | null = null;

function canPlay(type: string): string {
  probe ??= document.createElement("audio");
  return probe.canPlayType(type);
}

/** Decodes the first of `files` this browser can play, with its loop points. Null if none work. */
async function loadLoop(ctx: AudioContext, files: readonly AudioFile[], track: Track, base: URL): Promise<LoopBuffer | null> {
  for (const file of playableFiles(files, canPlay)) {
    try {
      const response = await fetch(new URL(file.src, base));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      const end = Math.min(file.loopEnd ?? track.loopEnd ?? buffer.duration, buffer.duration);
      const start = Math.min(file.loopStart ?? track.loopStart, end);
      // A loop shorter than a beat is a typo: loop the whole file instead.
      const usable = end - start >= 60 / track.bpm;
      return { buffer, loopStart: usable ? start : 0, loopEnd: usable ? end : buffer.duration };
    } catch (error) {
      console.warn(`Fishy music: couldn't play ${file.src}, trying the next format.`, error);
    }
  }
  return null;
}

/** Fetches and decodes a chapter's bed and stems. Null if the bed can't be played. */
export async function loadTrack(ctx: AudioContext, track: Track, base: URL): Promise<LoadedTrack | null> {
  const [bed, groove, combo] = await Promise.all([
    loadLoop(ctx, track.files, track, base),
    track.layers.groove ? loadLoop(ctx, track.layers.groove, track, base) : null,
    track.layers.combo ? loadLoop(ctx, track.layers.combo, track, base) : null,
  ]);
  if (!bed) return null;
  const layers: LoadedTrack["layers"] = {};
  if (groove) layers.groove = groove;
  if (combo) layers.combo = combo;
  return { track, bed, layers };
}
