import type { Achievement } from "../game/achievements";
import { paintBadgeIcon } from "./achievements-view";

interface ToastQueue {
  items: Achievement[];
  active: boolean;
}
const queues = new WeakMap<HTMLElement, ToastQueue>();

/** Queues achievements per toast element, showing each for three seconds before the next. */
export function showAchievementToast(
  el: HTMLElement,
  achievement: Achievement,
): void {
  let queue = queues.get(el);
  if (!queue) {
    queue = { items: [], active: false };
    queues.set(el, queue);
  }
  queue.items.push(achievement);
  if (queue.active) return;
  const next = (): void => {
    const current = queue!.items.shift();
    if (!current) {
      queue!.active = false;
      return;
    }
    queue!.active = true;
    el.classList.add("achievement-toast");
    el.classList.remove("is-leaving");
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    const badge = document.createElement("div");
    badge.className = "achievement-badge";
    const image = document.createElement("img");
    image.src = `${import.meta.env.BASE_URL}art/badge.png`;
    image.alt = "";
    image.width = image.height = 64;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    paintBadgeIcon(canvas, current.icon);
    badge.append(image, canvas);
    const copy = document.createElement("div");
    const label = document.createElement("span");
    label.className = "achievement-toast-label";
    label.textContent = "Achievement unlocked";
    const name = document.createElement("strong");
    name.className = "achievement-toast-name";
    name.textContent = current.name;
    copy.append(label, name);
    el.replaceChildren(badge, copy);
    el.hidden = false;
    window.setTimeout(() => {
      el.classList.add("is-leaving");
      window.setTimeout(() => {
        el.hidden = true;
        el.classList.remove("is-leaving");
        next();
      }, 220);
    }, 3000);
  };
  next();
}
