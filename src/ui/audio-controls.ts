import type { AudioSettings, GameAudio } from "../audio";
import "./audio-controls.css";

const SPEAKER = '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor"/>';
const ICONS = {
  on: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER}<path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  off: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER}<path d="M15.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  volume: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="8" r="2.6" fill="currentColor"/><circle cx="15" cy="16" r="2.6" fill="currentColor"/></svg>`,
};

const SLIDERS = [
  { setting: "music", label: "Music" },
  { setting: "sfx", label: "Effects" },
] as const;

let mounts = 0;

/**
 * Sound controls. "hud": one mute button for the round's top bar. "hub": the mute button plus a
 * Volume button that opens a small panel with the music and effects sliders. Every mounted copy
 * stays in step through audio.onChange.
 */
export function mountAudioControls(container: HTMLElement, audio: GameAudio, variant: "hud" | "hub"): void {
  if (!audio.supported) return;
  const id = `audio-controls-${++mounts}`;
  const root = document.createElement("div");
  root.className = `audio-controls is-${variant}`;
  root.innerHTML = `
    <button type="button" class="audio-button" data-action="mute" aria-label="Mute sound" aria-pressed="false"></button>
    ${
      variant === "hub"
        ? `<button type="button" class="audio-button" data-action="volume" aria-label="Volume" title="Volume"
             aria-expanded="false" aria-controls="${id}-panel">${ICONS.volume}</button>
           <div id="${id}-panel" class="audio-panel" role="group" aria-label="Volume" hidden>
             ${SLIDERS.map(
               ({ setting, label }) => `
               <label class="audio-slider" for="${id}-${setting}">
                 <span>${label}</span>
                 <input id="${id}-${setting}" type="range" min="0" max="100" step="5" data-setting="${setting}" />
                 <output for="${id}-${setting}"></output>
               </label>`,
             ).join("")}
             <p class="audio-panel-note">Press M to mute or unmute.</p>
           </div>`
        : ""
    }`;

  const mute = root.querySelector<HTMLButtonElement>('[data-action="mute"]')!;
  mute.addEventListener("click", () => audio.update({ muted: !audio.settings.muted }));

  const sliders = [...root.querySelectorAll<HTMLInputElement>("input[data-setting]")];
  for (const slider of sliders) {
    const setting = slider.dataset.setting as "music" | "sfx";
    slider.addEventListener("input", () => {
      const value = Number(slider.value) / 100;
      // Turning a volume up while muted means the player wants to hear it.
      audio.update({ [setting]: value, ...(value > 0 ? { muted: false } : {}) });
    });
    if (setting === "sfx") slider.addEventListener("change", () => audio.preview());
  }

  const volume = root.querySelector<HTMLButtonElement>('[data-action="volume"]');
  const panel = root.querySelector<HTMLElement>(".audio-panel");
  if (volume && panel) {
    const setOpen = (open: boolean, returnFocus = false): void => {
      panel.hidden = !open;
      volume.setAttribute("aria-expanded", String(open));
      if (open) sliders[0]?.focus();
      else if (returnFocus) volume.focus();
    };
    volume.addEventListener("click", () => setOpen(panel.hidden !== false));
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        setOpen(false, true);
      }
    });
    // In the mobile tools menu this panel participates in layout. Closing it on the
    // pointerdown of Export/Help would move those buttons before the finger lifts.
    const withinControls = (target: Node): boolean => (root.closest(".hub-tools") ?? root).contains(target);
    document.addEventListener("pointerdown", (event) => {
      if (!panel.hidden && !withinControls(event.target as Node)) setOpen(false);
    });
    root.addEventListener("focusout", (event) => {
      if (!panel.hidden && event.relatedTarget instanceof Node && !withinControls(event.relatedTarget)) setOpen(false);
    });
  }

  const render = (settings: AudioSettings): void => {
    mute.innerHTML = settings.muted ? ICONS.off : ICONS.on;
    mute.setAttribute("aria-pressed", String(settings.muted));
    mute.title = settings.muted ? "Sound off (M)" : "Sound on (M)";
    root.classList.toggle("is-muted", settings.muted);
    for (const slider of sliders) {
      const percent = Math.round(settings[slider.dataset.setting as "music" | "sfx"] * 100);
      slider.value = String(percent);
      const output = slider.nextElementSibling;
      if (output) output.textContent = `${percent}%`;
    }
  };
  render(audio.settings);
  audio.onChange(render);
  container.append(root);
}
