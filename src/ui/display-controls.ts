import { getPalette, onPaletteChange, setPalette } from "../game/palette";
import { writeDisplaySettings } from "./display-settings";
import "./display-controls.css";

/** An eye with a half-filled iris. */
const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M2.5 12s3.6-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.6 6.5-9.5 6.5S2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  <circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/>
  <path d="M12 8.4a3.6 3.6 0 0 0 0 7.2z" fill="currentColor"/>
</svg>`;

/**
 * The colour-blind palette switch: an icon button in the hub bar, a labelled row in the compact
 * tools menu. Switching redraws every fish straight away and stores the choice apart from the save.
 */
export function mountDisplayControls(container: HTMLElement): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "display-toggle";
  button.dataset.action = "color-blind";
  button.innerHTML = `${ICON}<span class="display-toggle-label">Colour-blind palette</span><span class="display-toggle-state" aria-hidden="true"></span>`;
  const state = button.querySelector<HTMLElement>(".display-toggle-state")!;

  button.addEventListener("click", () => {
    const colorBlind = getPalette() !== "colorBlind";
    setPalette(colorBlind ? "colorBlind" : "standard");
    // A refused write only means the choice lasts for this visit.
    writeDisplaySettings({ colorBlind });
  });

  const render = (): void => {
    const on = getPalette() === "colorBlind";
    button.setAttribute("aria-pressed", String(on));
    button.title = `Colour-blind palette: ${on ? "on" : "off"}`;
    state.textContent = on ? "On" : "Off";
  };
  render();
  onPaletteChange(render);
  container.append(button);
}
