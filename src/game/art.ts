/** Decoded painted assets. Null entries tell the renderer to keep using vector fallbacks. */
export interface ArtSet {
  sea: HTMLImageElement | null;
  boat: HTMLImageElement | null;
}

const art: ArtSet = { sea: null, boat: null };
const listeners = new Set<() => void>();
let started = false;

/** Starts loading once, returning the same live object immediately. Safe in Node. */
export function loadArt(): ArtSet {
  if (started || typeof Image === "undefined") return art;
  started = true;
  for (const [key, file] of [["sea", "sea-tile.webp"], ["boat", "boat.png"]] as const) {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      void (async () => {
        try {
          if (typeof image.decode === "function") await image.decode();
          art[key] = image;
          for (const listener of listeners) listener();
        } catch {
          // A failed download/decode keeps the original painted fallback available.
        }
      })();
    };
    image.src = `${import.meta.env.BASE_URL}art/${file}`;
  }
  return art;
}

/** Notifies after each asset decodes; returns an unsubscribe function. */
export function onArtReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
