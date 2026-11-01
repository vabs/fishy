import type { World } from "../game/world";

/** Keeps the bucket's accessible countdown and filling ring in step with play time. */
export function mountChumControl(button: HTMLButtonElement, throwChum: () => void): {
  update(world: World | null, paused: boolean): void;
} {
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", throwChum);
  const ring = button.querySelector<SVGCircleElement>(".chum-progress")!;
  return {
    update(world, paused) {
      button.hidden = !world?.stats.boat.chum;
      if (button.hidden || !world) return;
      const ready = world.chumReady && !paused;
      const seconds = Math.ceil(world.chumCooldownLeft);
      const label = ready ? "Throw chum (Space), ready" : `Throw chum, ${seconds} seconds left${paused ? ", paused" : ""}`;
      if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
      button.setAttribute("aria-disabled", String(!ready));
      button.classList.toggle("is-ready", ready);
      button.dataset.cooldown = String(seconds);
      ring.style.strokeDashoffset = String(100 * Math.min(1, world.chumCooldownLeft / world.stats.boat.chumCooldown));
    },
  };
}

/** Space belongs to the sea only when the player isn't typing. */
export function isChumKey(event: KeyboardEvent): boolean {
  if (event.code !== "Space" && event.key !== " ") return false;
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return false;
  const target = event.target;
  return !(target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}
