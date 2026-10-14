import type { FxEvent, World, WorldEvent } from "../game/world";
import { AudioEngine } from "./engine";
import { chapterFor, comboLevel } from "./mapping";
import { Music } from "./music";
import { loadAudioSettings, type AudioSettings } from "./settings";
import { Sfx } from "./sfx";

export type { AudioSettings } from "./settings";

export type Screen = "hub" | "round" | "summary" | "end";

/**
 * The game's sound, as main.ts sees it: tell it what's on screen, what was bought, and each frame's
 * world events. It decides what to play. The simulation itself knows nothing about audio.
 */
export interface GameAudio {
  /** False in browsers without Web Audio: the controls hide themselves. */
  readonly supported: boolean;
  readonly settings: AudioSettings;
  update(change: Partial<AudioSettings>): void;
  onChange(listener: (settings: AudioSettings) => void): () => void;
  /** A screen was shown. `final` is whether the round being played (or just finished) is the Final Round. */
  screen(screen: Screen, context: { final: boolean; upgrades: Readonly<Record<string, number>> }): void;
  /** A tech tree node was bought; `upgrades` includes it. */
  purchase(nodeId: string, upgrades: Readonly<Record<string, number>>): void;
  /** One frame's drained world events, and the world they came from. */
  frame(events: readonly WorldEvent[], world: World | null): void;
  /** Plays one catch at the current effects volume. */
  preview(): void;
}

/** True when a key press is typing into a text field, so "M" shouldn't mute. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["range", "checkbox", "radio", "button", "submit", "reset"].includes(target.type);
}

export function createGameAudio(): GameAudio {
  const engine = new AudioEngine(loadAudioSettings());
  const music = new Music();
  const sfx = new Sfx(engine, () => music.key);
  engine.whenReady((ctx) => music.start(ctx, engine.music));
  engine.listen();

  window.addEventListener("keydown", (event) => {
    if (event.key !== "m" && event.key !== "M") return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
    engine.update({ muted: !engine.settings.muted });
  });

  /** World time of the last capture, for telling when a combo has run out. */
  let lastCaptureAt = Number.NEGATIVE_INFINITY;

  function fx(event: FxEvent): void {
    switch (`${event.kind}:${event.name}`) {
      case "electric:current":
        // The first point is the Electric fish itself; each one after is a jump.
        sfx.current((event.points?.length ?? 1) - 1);
        break;
      case "star:launch":
        sfx.launch();
        break;
      case "star:bounce":
        sfx.bounce();
        break;
      case "monster:implode":
        sfx.implode(event.points?.length ?? 0);
        break;
      case "goober:burst":
        sfx.burst();
        break;
    }
  }

  return {
    supported: AudioEngine.supported,
    get settings() {
      return engine.settings;
    },
    update: (change) => engine.update(change),
    onChange: (listener) => engine.onChange(listener),

    screen(screen, { final, upgrades }) {
      music.setChapter(chapterFor(upgrades));
      switch (screen) {
        case "hub":
          music.setMode("hub");
          break;
        case "round":
          lastCaptureAt = Number.NEGATIVE_INFINITY;
          music.setMode(final ? "final" : "round");
          break;
        case "summary":
          music.stinger(final);
          music.setMode("hub");
          break;
        case "end":
          music.setMode("end");
          break;
      }
    },

    purchase(nodeId, upgrades) {
      sfx.purchase(nodeId.endsWith(".unlock"));
      music.setChapter(chapterFor(upgrades));
    },

    frame(events, world) {
      if (!engine.running) return;
      let catches = 0;
      let combo = 0;
      for (const event of events) {
        if (event.type === "capture") {
          catches++;
          combo = Math.max(combo, event.combo);
          if (event.golden) sfx.goldenCatch();
        } else if (event.type === "time-bonus") sfx.timeBonus();
        else if (event.type === "fx") fx(event);
        else if (event.type === "golden") sfx.shimmer();
        else if (event.type === "golden-escape") sfx.plop();
        else if (event.type === "chest-open") sfx.treasure();
      }
      sfx.catches(catches, combo);
      sfx.flush();
      if (world) {
        if (catches > 0) lastCaptureAt = world.elapsed;
        const { comboMax, comboWindow } = world.stats;
        const sinceCapture = world.elapsed - lastCaptureAt;
        music.setCombo(world.over ? 0 : comboLevel({ mult: world.comboMult, max: comboMax, sinceCapture, window: comboWindow }));
      }
      music.pump();
    },

    preview: () => sfx.preview(),
  };
}
