import { afterEach, describe, expect, it, vi } from "vitest";
import { loadArt, onArtReady } from "./art";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("painted art", () => {
  it("is safe without browser Image and keeps fallback images null", () => {
    expect(loadArt()).toEqual({ sea: null, boat: null });
    expect(onArtReady(() => {})()).toBeUndefined();
  });

  it("publishes each image only after decoding and notifies subscribers", async () => {
    const images: { src: string; onload: (() => void) | null; decode: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal("Image", class {
      src = "";
      onload = null;
      decode = vi.fn().mockResolvedValue(undefined);
      constructor() { images.push(this); }
    });
    const { loadArt, onArtReady } = await import("./art");
    const ready = vi.fn();
    const stop = onArtReady(ready);
    const art = loadArt();
    expect(art.sea).toBeNull();
    expect(images.map((i) => i.src)).toEqual(["/art/sea-tile.webp", "/art/boat.png"]);
    images[0]!.onload!();
    await vi.waitFor(() => expect(art.sea).toBe(images[0]));
    expect(ready).toHaveBeenCalledTimes(1);
    stop();
    images[1]!.onload!();
    await vi.waitFor(() => expect(art.boat).toBe(images[1]));
    expect(ready).toHaveBeenCalledTimes(1);
    expect(loadArt()).toBe(art);
  });

  it("retains the fallback if decoding rejects", async () => {
    const images: { onload: (() => void) | null }[] = [];
    vi.stubGlobal("Image", class {
      onload = null;
      decode = () => Promise.reject(new Error("bad image"));
      constructor() { images.push(this); }
    });
    const { loadArt } = await import("./art");
    const art = loadArt();
    images[0]!.onload!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(art.sea).toBeNull();
  });
});
