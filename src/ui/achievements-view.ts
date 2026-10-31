import type { Achievement } from "../game/achievements";
import { FISH_KINDS, type FishKind } from "../game/fish";
import { buildSprites } from "../game/shapes";
import { PADLOCK_ICON } from "./icons";

const GLYPHS: Record<string, string> = {
  net: "M9 12H39M11 22H37M14 30H34M16 10L21 36M24 9V38M32 10L27 36M9 12Q9 38 24 38Q39 38 39 12M38 12L47 3",
  star: "M24 4L30 17L44 19L34 29L37 43L24 36L11 43L14 29L4 19L18 17Z",
  chest:
    "M7 21V41H41V21ZM7 21V16Q7 7 24 7Q41 7 41 16V21M15 10V41M33 10V41M21 20H27V28H21Z",
  wave: "M4 19Q11 8 18 19T32 19T46 19M4 30Q11 19 18 30T32 30T46 30M4 41Q11 30 18 41T32 41T46 41",
  scroll:
    "M12 10H37V39H11Q4 39 4 33H31M12 10Q12 4 6 4Q2 4 2 10H12M37 39Q44 39 44 32H38M19 18H30M19 25H30",
  anchor:
    "M24 13V43M14 22H34M6 29Q6 42 24 43Q42 42 42 29M3 33L6 28L11 31M37 31L42 28L45 33M29 8A5 5 0 1 1 19 8A5 5 0 1 1 29 8",
  clock: "M43 25A19 19 0 1 1 5 25A19 19 0 1 1 43 25M24 13V25L33 31M17 2H31",
  crown: "M6 12L16 23L24 7L32 23L42 12L38 39H10ZM10 33H38",
  combo:
    "M17 17L22 12A10 10 0 0 1 36 26L31 31M31 31L26 36A10 10 0 0 1 12 22L17 17M16 32L32 16",
};

/** Paints a full fish sprite or a bold canvas glyph inside a badge's empty centre. */
export function paintBadgeIcon(canvas: HTMLCanvasElement, icon: string): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const size = 56;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const c = canvas.getContext("2d");
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (icon.startsWith("fish:")) {
    const kind = icon.slice(5);
    if (FISH_KINDS.includes(kind as FishKind)) {
      const picture = buildSprites(kind as FishKind, dpr).full;
      const scale = Math.min(48 / picture.width, 38 / picture.height);
      const w = picture.width * scale;
      const h = picture.height * scale;
      c.shadowColor = "#3b241499";
      c.shadowBlur = 1.5;
      c.drawImage(picture, (size - w) / 2, (size - h) / 2, w, h);
      return;
    }
  }
  c.translate(4, 4);
  c.strokeStyle = "#553415";
  c.fillStyle = "#553415";
  c.lineWidth = 3.2;
  c.lineCap = "round";
  c.lineJoin = "round";
  if (icon === "coin" || icon === "gold") {
    c.beginPath();
    c.arc(24, 24, 18, 0, Math.PI * 2);
    c.stroke();
    c.font = '800 28px "Nunito", sans-serif';
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(icon === "gold" ? "✦" : "$", 24, 25);
  } else {
    c.stroke(new Path2D(GLYPHS[icon] ?? GLYPHS.star!));
  }
}

/** Renders a badge grid with visible locked descriptions and dates for earned badges. */
export function renderAchievements(
  grid: HTMLElement,
  list: readonly Achievement[],
  earned: Readonly<Record<string, string>>,
): void {
  const cards = list.map((achievement) => {
    const unlocked = Object.hasOwn(earned, achievement.id);
    const card = document.createElement("article");
    card.className = `achievement-card ${unlocked ? "is-earned" : "is-locked"}`;
    card.dataset.achievement = achievement.id;
    const badge = document.createElement("div");
    badge.className = "achievement-badge";
    const image = document.createElement("img");
    image.src = `${import.meta.env.BASE_URL}art/${unlocked ? "badge" : "badge-locked"}.png`;
    image.alt = "";
    image.width = image.height = 88;
    const canvas = document.createElement("canvas");
    canvas.dataset.icon = achievement.icon;
    canvas.setAttribute("aria-hidden", "true");
    badge.append(image, canvas);
    paintBadgeIcon(canvas, achievement.icon);
    const name = document.createElement("h3");
    name.textContent = achievement.name;
    const description = document.createElement("p");
    description.textContent = achievement.description;
    const status = document.createElement("span");
    status.className = "achievement-status";
    if (unlocked) {
      const date = new Date(earned[achievement.id]!);
      const valid = Number.isFinite(date.getTime());
      const time = document.createElement("time");
      if (valid) time.dateTime = date.toISOString();
      time.textContent = valid
        ? date.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          })
        : "";
      status.append("✓ Earned ", time);
    } else {
      status.innerHTML = PADLOCK_ICON;
      status.append("Locked");
    }
    card.append(badge, name, description, status);
    return card;
  });
  grid.replaceChildren(...cards);
}
