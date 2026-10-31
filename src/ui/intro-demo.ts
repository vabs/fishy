import { FISH, type FishKind } from "../game/fish";
import { buildSprites, type FishSprites } from "../game/shapes";

/*
 * A tiny scripted scene for the "how to play" slides: a net sweeps across a strip of sea, fish
 * inside it light up, lose health on each tick and pop with "+$1". It reuses the game's sprites but
 * not its simulation, so it always shows the same lesson.
 */

const TAU = Math.PI * 2;
const WIDTH = 400;
const HEIGHT = 190;
const NET_RADIUS = 36;
const TICK_SECONDS = 0.5;
const RESPAWN_SECONDS = 1.2;
const FLOATER_SECONDS = 0.8;

const hasTouchInput = (): boolean =>
  window.matchMedia("(any-pointer: coarse)").matches || navigator.maxTouchPoints > 0;

/** Small tutorial canvases do not need a phone's full backing resolution. */
const demoDpr = (): number => Math.min(window.devicePixelRatio || 1, hasTouchInput() ? 2 : Infinity);

/** Paint once per demo: soft teal water, warm reflected light and a few quiet ripples. */
function buildDemoSea(dpr: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(WIDTH * dpr);
  canvas.height = Math.round(HEIGHT * dpr);
  const c = canvas.getContext("2d");
  if (!c) return canvas;
  c.scale(dpr, dpr);
  const water = c.createLinearGradient(0, 0, WIDTH, HEIGHT);
  water.addColorStop(0, "#4aabb0");
  water.addColorStop(0.45, "#23798a");
  water.addColorStop(1, "#0d3b4f");
  c.fillStyle = water;
  c.fillRect(0, 0, WIDTH, HEIGHT);
  const sunlight = c.createRadialGradient(30, 0, 0, 30, 0, 240);
  sunlight.addColorStop(0, "#f4a25930");
  sunlight.addColorStop(1, "#f4a25900");
  c.fillStyle = sunlight;
  c.fillRect(0, 0, WIDTH, HEIGHT);
  c.lineWidth = 1.5;
  c.strokeStyle = "#e8fbff12";
  for (let i = 0; i < 12; i++) {
    const y = i * 18 - 8;
    const bend = Math.sin(i * 1.7) * 14;
    c.beginPath();
    c.moveTo(-20, y);
    c.bezierCurveTo(90, y + bend + 12, 230, y + bend - 12, WIDTH + 20, y + 6);
    c.stroke();
  }
  return canvas;
}

interface DemoFish {
  kind: FishKind;
  x: number;
  y: number;
  speed: number;
  dir: 1 | -1;
  hp: number;
  maxHp: number;
  flash: number;
  /** Seconds until it swims back in after being caught; 0 while swimming. */
  away: number;
}

interface Floater {
  x: number;
  y: number;
  age: number;
}

/** Starts the demo on `canvas` and returns a function that stops it. */
export function startNetDemo(canvas: HTMLCanvasElement, still = false): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = demoDpr();
  const touch = hasTouchInput();
  canvas.width = Math.round(WIDTH * dpr);
  canvas.height = Math.round(HEIGHT * dpr);
  const sea = buildDemoSea(dpr);

  const sprites = new Map<FishKind, FishSprites>();
  const sprite = (kind: FishKind): FishSprites => {
    let s = sprites.get(kind);
    if (!s) sprites.set(kind, (s = buildSprites(kind, dpr)));
    return s;
  };

  const lanes: [FishKind, number, number, 1 | -1][] = [
    ["normal", 40, 38, 1],
    ["uncommon", 72, 50, -1],
    ["normal", 104, 44, 1],
    ["normal", 136, 34, -1],
    ["uncommon", 162, 46, 1],
  ];
  const fish: DemoFish[] = lanes.map(([kind, y, speed, dir], i) => ({
    kind,
    x: (i * 97) % WIDTH,
    y,
    speed,
    dir,
    hp: 2,
    maxHp: 2,
    flash: 0,
    away: 0,
  }));
  const floaters: Floater[] = [];
  let time = 0;
  let tickTimer = 0;
  let last = performance.now();
  let frame = 0;

  const net = (t: number) => ({
    x: WIDTH / 2 + Math.sin(t * 0.55) * (WIDTH / 2 - 60),
    y: HEIGHT / 2 + Math.sin(t * 1.15) * (HEIGHT / 2 - 45),
  });

  function step(dt: number): void {
    time += dt;
    const p = net(time);
    for (const f of fish) {
      f.flash = Math.max(0, f.flash - dt);
      if (f.away > 0) {
        f.away -= dt;
        if (f.away <= 0) {
          f.away = 0;
          f.hp = f.maxHp;
          f.x = f.dir > 0 ? -20 : WIDTH + 20;
        }
        continue;
      }
      f.x += f.dir * f.speed * dt;
      if (f.x > WIDTH + 24) f.x = -24;
      if (f.x < -24) f.x = WIDTH + 24;
    }
    tickTimer += dt;
    while (tickTimer >= TICK_SECONDS) {
      tickTimer -= TICK_SECONDS;
      for (const f of fish) {
        if (f.away > 0 || Math.hypot(f.x - p.x, f.y - p.y) > NET_RADIUS + FISH[f.kind].size * 0.4) continue;
        f.hp -= 1;
        f.flash = 0.12;
        if (f.hp <= 0) {
          floaters.push({ x: f.x, y: f.y, age: 0 });
          f.away = RESPAWN_SECONDS;
        }
      }
    }
    for (const fl of floaters) fl.age += dt;
    while (floaters[0] && floaters[0].age > FLOATER_SECONDS) floaters.shift();
  }

  function drawFish(f: DemoFish, variant: "full" | "silhouette" | "flash"): void {
    const s = sprite(f.kind);
    ctx!.save();
    ctx!.translate(f.x, f.y);
    if (f.dir < 0) ctx!.scale(-1, 1);
    ctx!.drawImage(s[variant], -s.width / 2, -s.height / 2, s.width, s.height);
    ctx!.restore();
  }

  function draw(): void {
    const c = ctx!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.drawImage(sea, 0, 0, WIDTH, HEIGHT);

    const live = fish.filter((f) => f.away <= 0);
    for (const f of live) drawFish(f, "silhouette");

    const p = net(time);
    c.save();
    c.beginPath();
    c.arc(p.x, p.y, NET_RADIUS, 0, TAU);
    c.clip();
    c.fillStyle = "#fff7e61c";
    c.fillRect(p.x - NET_RADIUS, p.y - NET_RADIUS, NET_RADIUS * 2, NET_RADIUS * 2);
    for (const f of live) drawFish(f, f.flash > 0 ? "flash" : "full");
    c.restore();

    for (const f of live) {
      if (Math.hypot(f.x - p.x, f.y - p.y) > NET_RADIUS) continue;
      const w = FISH[f.kind].size * 0.7;
      const top = f.y - FISH[f.kind].size * 0.45 - 6;
      c.fillStyle = "rgba(0, 0, 0, 0.45)";
      c.fillRect(f.x - w / 2, top, w, 3);
      c.fillStyle = "#a8d39b";
      c.fillRect(f.x - w / 2, top, (w * f.hp) / f.maxHp, 3);
    }

    c.lineWidth = 5;
    c.strokeStyle = "#77563170";
    c.beginPath();
    c.arc(p.x, p.y, NET_RADIUS, 0, TAU);
    c.stroke();
    c.lineWidth = 3;
    c.strokeStyle = "#f3e3c3";
    c.stroke();
    c.lineWidth = 1;
    c.strokeStyle = "#fff7e6";
    c.setLineDash([2, 5]);
    c.stroke();
    c.setLineDash([]);
    c.lineWidth = 3;
    c.strokeStyle = "#d9a441b3";
    c.beginPath();
    c.arc(p.x, p.y, NET_RADIUS + 5, -Math.PI / 2, -Math.PI / 2 + (tickTimer / TICK_SECONDS) * TAU);
    c.stroke();
    // Show the touch contact below the net so the lesson matches the playing controls.
    c.fillStyle = "#fff7e6";
    c.strokeStyle = "#0d3b4f";
    c.lineWidth = 1;
    c.beginPath();
    if (touch) {
      c.arc(p.x, p.y + NET_RADIUS + 12, 7, 0, TAU);
    } else {
      c.moveTo(p.x, p.y);
      c.lineTo(p.x, p.y + 13);
      c.lineTo(p.x + 3.5, p.y + 9.5);
      c.lineTo(p.x + 8.5, p.y + 9.5);
      c.closePath();
    }
    c.fill();
    c.stroke();

    c.font = '800 14px "Nunito", sans-serif';
    c.textAlign = "center";
    c.fillStyle = "#fff7e6";
    for (const fl of floaters) {
      const t = fl.age / FLOATER_SECONDS;
      c.globalAlpha = 1 - t * t;
      c.fillText("+$1", fl.x, fl.y - 10 - t * 24);
    }
    c.globalAlpha = 1;
  }

  if (still || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // A single still frame, a couple of seconds in.
    for (let i = 0; i < 140; i++) step(1 / 60);
    draw();
    return () => {};
  }

  const loop = (now: number): void => {
    step(Math.min((now - last) / 1000, 0.1));
    last = now;
    draw();
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame((now) => {
    last = now;
    loop(now);
  });
  return () => cancelAnimationFrame(frame);
}

const PARADE: FishKind[] = ["normal", "uncommon", "rare", "electric", "epic", "goober", "star"];

/**
 * The send-off slide: the boat with one of every fish type circling it in full colour, a peek at
 * what's to come. Returns a function that stops it.
 */
export function startParadeDemo(canvas: HTMLCanvasElement, still = false): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = demoDpr();
  canvas.width = Math.round(WIDTH * dpr);
  canvas.height = Math.round(HEIGHT * dpr);
  const sea = buildDemoSea(dpr);
  const sprites = PARADE.map((kind) => buildSprites(kind, dpr));
  let frame = 0;

  function draw(time: number): void {
    const c = ctx!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.drawImage(sea, 0, 0, WIDTH, HEIGHT);

    // Fish behind the boat (top half of the ellipse) first, then the boat, then the rest.
    const placed = sprites.map((s, i) => {
      const angle = -time * 0.35 + (i / sprites.length) * TAU;
      const x = WIDTH / 2 + Math.cos(angle) * 150;
      const y = HEIGHT / 2 + Math.sin(angle) * 62;
      // Moving anticlockwise: the direction of travel is the tangent, a quarter turn behind.
      const heading = Math.atan2(-Math.cos(angle) * 62, Math.sin(angle) * 150);
      return { s, x, y, heading };
    });
    const drawOne = ({ s, x, y, heading }: (typeof placed)[number]): void => {
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      const flip = cos < 0 ? -1 : 1;
      c.setTransform(dpr * cos, dpr * sin, -dpr * sin * flip, dpr * cos * flip, dpr * x, dpr * y);
      c.drawImage(s.full, -s.width / 2, -s.height / 2, s.width, s.height);
    };
    for (const p of placed) if (p.y < HEIGHT / 2) drawOne(p);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBoat(c, WIDTH / 2, HEIGHT / 2, Math.sin(time * 1.2) * 0.04);
    for (const p of placed) if (p.y >= HEIGHT / 2) drawOne(p);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  if (still || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    draw(1);
    return () => {};
  }
  const start = performance.now();
  const loop = (now: number): void => {
    draw((now - start) / 1000);
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(frame);
}

/** A warm wooden boat, kept as a few cheap vector shapes for the tutorial. */
function drawBoat(c: CanvasRenderingContext2D, x: number, y: number, tilt: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(tilt);
  c.fillStyle = "#7a4a2a";
  c.strokeStyle = "#4a2b17";
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(-40, -15);
  c.quadraticCurveTo(15, -24, 44, 0);
  c.quadraticCurveTo(15, 24, -40, 15);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = "#c58b50";
  c.beginPath();
  c.moveTo(-34, -10);
  c.quadraticCurveTo(12, -17, 34, 0);
  c.quadraticCurveTo(12, 17, -34, 10);
  c.closePath();
  c.fill();
  c.strokeStyle = "#fff0c54d";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(-30, -5);
  c.lineTo(28, -5);
  c.moveTo(-30, 5);
  c.lineTo(28, 5);
  c.stroke();
  c.fillStyle = "#4a2b17";
  c.fillRect(-18, -12, 5, 24);
  c.fillRect(6, -12, 5, 24);
  c.restore();
}
