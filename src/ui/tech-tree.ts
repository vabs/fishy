import "./tech-tree.css";
import { formatMoney } from "../format";
import { TreeGestures, type TreePointer } from "./tree-gestures";
import { FISH } from "../game/fish";
import { BASE_STATS } from "../game/stats";
import {
  TECH_NODES,
  canBuy,
  isMaxed,
  isVisible,
  laneOf,
  layoutTree,
  levelOf,
  nextCost,
  nodeChanges,
  type LaneKey,
  type TechNode,
  type Upgrades,
} from "../game/tech";

/*
 * The tech tree screen: a radial graph of DOM buttons over an SVG layer of rings and edges, in a
 * world that pans and zooms. It only displays state. Clicking an affordable node calls onBuy; the
 * caller buys, saves and passes the new state back through update().
 */

export interface TechTreeState {
  money: number;
  upgrades: Upgrades;
}

export interface TechTreeView {
  update(state: TechTreeState): void;
  dismiss(): void;
  destroy(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_SCALE = 0.3;
const MAX_SCALE = 2;
/** The automatic view never zooms in past this, so a young tree isn't huge. */
const MAX_FIT_SCALE = 1.1;
/** Room kept around everything visible when fitting, world px. */
const FIT_MARGIN = 50;
/** How far a node's price label reaches below its centre, world px. */
const PRICE_DROP = 56;
/** Gap between a lane's outermost visible ring and its label, world px. */
const LABEL_GAP = 48;
const BOAT_HALF_LENGTH = 70;
/** Space kept between a focused node and the edge of the view, screen px. */
const FOCUS_MARGIN = 70;
const NODE_SIZE = 54;
const ROOT_SIZE = 64;
/** Keep touch nodes readable without expanding hit areas into their neighbours. */
const TOUCH_MIN_SCALE = 48 / NODE_SIZE;

/** Fish lanes take the fish's colour in the player's palette, published as --fish-<kind> by main.ts. */
const LANE_TINTS: Record<LaneKey, string> = {
  net: "#9ad8ff",
  time: "#cdb8ff",
  spawning: "#6fe3c8",
  economy: "#ffd98a",
  ...(Object.fromEntries(
    Object.entries(FISH).map(([kind, def]) => [kind, `var(--fish-${kind}, ${def.body})`]),
  ) as Record<keyof typeof FISH, string>),
};

/** Points of a star centred on (cx, cy), first point straight up. */
function starPoints(points: number, outer: number, inner: number, cx = 0, cy = 0): string {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    out.push(`${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${out.join("L")}Z`;
}

/** A small fish facing left, body centred on (cx, cy). */
function fishPath(cx: number, cy: number, s: number): string {
  const p = (x: number, y: number): string => `${(cx + x * s).toFixed(2)} ${(cy + y * s).toFixed(2)}`;
  return `M${p(-6, 0)}C${p(-3, -4.5)} ${p(3, -4.5)} ${p(5, 0)}C${p(3, 4.5)} ${p(-3, 4.5)} ${p(-6, 0)}ZM${p(4, 0)}L${p(8, -3.5)}L${p(8, 3.5)}Z`;
}

const FILLED = 'fill="currentColor" stroke="none"';
const BOLT = `<path ${FILLED} d="M2.5 -11 L-6.5 2 H-0.5 L-2.5 11 L6.5 -2 H0.5 Z"/>`;
const COIN = `<circle r="9.5"/><text ${FILLED} y="4.6" text-anchor="middle" font-size="13" font-weight="800">$</text>`;
const RANGE =
  '<circle r="2.6" fill="currentColor" stroke="none"/><path d="M-4.5 -4.5a6.4 6.4 0 0 0 0 9M4.5 -4.5a6.4 6.4 0 0 1 0 9M-8.2 -8.2a11.6 11.6 0 0 0 0 16.4M8.2 -8.2a11.6 11.6 0 0 1 0 16.4"/>';

/** Inner markup for a 24×24 icon centred on the origin, by node id, then id suffix. */
const ICONS: Record<string, string> = {
  "net.radius":
    '<ellipse cx="-2.5" cy="-5" rx="8" ry="2.6"/><path d="M-10.5 -5 C-10.5 4 -6.5 9.5 -2.5 9.5 C1.5 9.5 5.5 4 5.5 -5"/><path stroke-width="1.4" d="M-6.5 -2.6 L-4 9 M-2.5 -2.4 V9.5 M1.5 -2.6 L-1 9 M-10 1 H5 M-8.4 5.6 H3.4"/><path stroke-width="2.6" d="M5.5 -5 L11 -11"/>',
  "net.tick": BOLT,
  "net.damage": '<path d="M-6 0 H6"/><rect x="-10" y="-6" width="4" height="12" rx="1.2"/><rect x="6" y="-6" width="4" height="12" rx="1.2"/><path d="M-11.5 -2.5 V2.5 M11.5 -2.5 V2.5"/>',
  "net.critChance": '<circle r="8"/><circle r="2.8"/><path d="M0 -11.5v4.5M0 7v4.5M-11.5 0h4.5M7 0h4.5"/>',
  "net.critMult": `<path d="${starPoints(8, 11, 4.6)}"/>`,
  "time.round": '<circle r="9.5"/><path d="M0 -5.5 V0 L4 3.5"/>',
  "time.round2": '<path d="M8.6 3.5 A9.2 9.2 0 1 1 6.2 -6.8"/><path d="M7.4 -11.2 L6.6 -6.4 L11.2 -5.4"/><path d="M0 -4.5 V0 L3.5 3"/>',
  "time.bonusChance": '<path d="M-6.5 -10.5 H6.5 M-6.5 10.5 H6.5 M-5 -10.5 V-7 L5 7 V10.5 M5 -10.5 V-7 L-5 7 V10.5"/>',
  "time.bonusSeconds": '<circle cx="-1.5" cy="2" r="8"/><path d="M-1.5 2 V-2 M-4.5 -9.5 H1.5 M7.5 -11 v6 M4.5 -8 h6"/>',
  "spawn.rate": '<path d="M-11 6 q2.75 -3.5 5.5 0 t5.5 0 t5.5 0 t5.5 0"/><path d="M0 -10.5 c-3.2 4.2 -3.2 7.5 0 7.5 s3.2 -3.3 0 -7.5z"/>',
  "spawn.rate2":
    '<path d="M-11 7 q2.75 -3.5 5.5 0 t5.5 0 t5.5 0 t5.5 0"/><path d="M-4.5 -10.5 c-3 4 -3 7 0 7 s3 -3 0 -7z M5 -7.5 c-2.6 3.4 -2.6 6 0 6 s2.6 -2.6 0 -6z"/>',
  "spawn.start": '<path d="M-6 11 V-10.5 M-6 -9.5 H7.5 L4.5 -5 L7.5 -0.5 H-6"/>',
  "spawn.twin": `<path d="${fishPath(-1.5, -4.5, 1)}"/><path d="${fishPath(-1.5, 5, 1)}"/>`,
  "econ.value": COIN,
  "econ.value2":
    '<ellipse cx="0" cy="-5.5" rx="8.5" ry="3.6"/><path d="M-8.5 -5.5 v5 a8.5 3.6 0 0 0 17 0 v-5 M-8.5 -0.5 v5 a8.5 3.6 0 0 0 17 0 v-5"/>',
  "econ.combo": '<path d="M-1.5 -4.5 l2.6 -2.6 a4.2 4.2 0 0 1 6 6 l-2.6 2.6 M1.5 4.5 l-2.6 2.6 a4.2 4.2 0 0 1 -6 -6 l2.6 -2.6 M-3.2 3.2 L3.2 -3.2"/>',
  "econ.comboWindow": '<circle cy="2" r="8.5"/><path d="M0 2 L3.5 -1.5 M-3.5 -10 H3.5 M0 -10 V-6.5"/>',
  "econ.comboCap": '<path d="M-9.5 7 V-5.5 L-4.8 -0.5 L0 -8 L4.8 -0.5 L9.5 -5.5 V7 Z"/>',
  "frenzy.length":
    '<path d="M-11 9 q2.75 -3.5 5.5 0 t5.5 0 t5.5 0 t5.5 0 M-11 3 q2.75 -3.5 5.5 0 t5.5 0 t5.5 0 t5.5 0"/><path d="M0 -2.5 V-11 M-3.5 -7.5 L0 -11 L3.5 -7.5"/>',
  "frenzy.value": `<path d="M-11 8.5 q2.75 -3.5 5.5 0 t5.5 0 t5.5 0 t5.5 0"/><circle cy="-3.5" r="6.5"/><text ${FILLED} y="0" text-anchor="middle" font-size="9.5" font-weight="800">$</text>`,
  "normal.weight": '<path stroke-width="3.2" d="M-7 9 V-8 M0 9 V-2 M7 9 V3"/>',
  weight: '<path stroke-width="3.2" d="M-7 9 V3 M0 9 V-2 M7 9 V-8"/>',
  value: COIN,
  unlock: `<path ${FILLED} d="${fishPath(-1.2, 0, 1.45)}"/>`,
  "uncommon.school": `<path d="${fishPath(-3.5, -5.5, 0.8)}"/><path d="${fishPath(-3.5, 5.5, 0.8)}"/><path d="${fishPath(3.5, 0, 0.8)}"/>`,
  "rare.pierce": '<path d="M-10 10 L8 -8 M1.5 -9 H9 V-1.5"/><path d="M-7 -1 a7 7 0 0 1 8 8"/>',
  "rare.armor": '<path d="M0 -10.5 L8.5 -7 V0 C8.5 5.5 4.5 9 0 11 C-4.5 9 -8.5 5.5 -8.5 0 V-7 Z"/><path d="M1 -6.5 L-2 -1 L2 2 L-1 7"/>',
  "electric.jumps":
    '<path d="M-9 7 L-3 -5 L3 5 L9 -7"/><circle cx="-9" cy="7" r="2.2" fill="currentColor"/><circle cx="-3" cy="-5" r="2.2" fill="currentColor"/><circle cx="3" cy="5" r="2.2" fill="currentColor"/><circle cx="9" cy="-7" r="2.2" fill="currentColor"/>',
  "electric.damage": BOLT,
  range: RANGE,
  "epic.chance":
    '<rect x="-9.5" y="-9.5" width="19" height="19" rx="4.5"/><circle cx="-4.2" cy="-4.2" r="1.7" fill="currentColor"/><circle r="1.7" fill="currentColor"/><circle cx="4.2" cy="4.2" r="1.7" fill="currentColor"/>',
  "goober.tier": '<path d="M-7.5 1.5 L0 -6 L7.5 1.5 M-7.5 9 L0 1.5 L7.5 9"/><path d="M-7.5 -10 H7.5"/>',
  "goober.count": '<circle cx="-3.5" cy="3.5" r="6"/><circle cx="6" cy="-3" r="3.5"/><circle cx="2" cy="-9.5" r="1.8"/>',
  "monster.pullRadius": '<path d="M0 0 a2 2 0 0 1 4 0 a4 4 0 0 1 -8 0 a6 6 0 0 1 12 0 a8 8 0 0 1 -16 0"/>',
  "monster.pullStrength": '<path d="M-7.5 -9.5 V1 a7.5 7.5 0 0 0 15 0 V-9.5 H3 V1 a3 3 0 0 1 -6 0 V-9.5 Z M-7.5 -4.5 H-3 M3 -4.5 H7.5"/>',
  "star.unlock": `<path ${FILLED} d="${starPoints(5, 11, 4.6, 0, 1)}"/>`,
  "star.chance": `<path ${FILLED} d="${starPoints(5, 6.5, 2.8, 3.5, 3.5)}"/><path d="M-10 -10 L-3.5 -3.5 M-4 -11 L0 -7 M-11 -4 L-7 0"/>`,
  "star.damage": `<path d="${starPoints(5, 11, 4.2, 0, 1)}"/>`,
  "star.bounces": '<path d="M-11 9 Q-7.5 -11 -4 9 Q-1 -4 2 9 Q4.5 1 7 9"/><circle cx="9.5" cy="5.5" r="2.2" fill="currentColor"/>',
  "star.speed": `<path ${FILLED} d="${starPoints(5, 7, 3, 4, 0)}"/><path d="M-11 -3 h6 M-11.5 2.5 h8 M-9 8 h5"/>`,
  "star.size": `<circle r="10.5" stroke-dasharray="2.6 3.2"/><path ${FILLED} d="${starPoints(5, 6, 2.6, 0, 0.6)}"/>`,
  "star.count":
    '<path d="M-8.5 6 L-2.5 -6.5 L8 -3 L4.5 8.5"/><circle cx="-8.5" cy="6" r="2.4" fill="currentColor"/><circle cx="-2.5" cy="-6.5" r="2.4" fill="currentColor"/><circle cx="8" cy="-3" r="2.4" fill="currentColor"/><circle cx="4.5" cy="8.5" r="2.4" fill="currentColor"/>',
};

function iconFor(node: TechNode): string {
  const id = node.id.replace(/\d+$/, "");
  const suffix = id.slice(id.indexOf(".") + 1);
  return ICONS[id] ?? ICONS[suffix] ?? ICONS["net.radius"]!;
}

/** Short money for the small label under a node: $950, $12.5k, $1.2M. */
function shortMoney(amount: number): string {
  if (amount < 10_000) return formatMoney(amount);
  if (amount < 1_000_000) return `$${Number((amount / 1000).toFixed(amount < 100_000 ? 1 : 0))}k`;
  return `$${Number((amount / 1_000_000).toFixed(1))}M`;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function html<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Ring segments around a node, one per level. */
function pipSegments(maxLevel: number, radius: number): string[] {
  if (maxLevel === 1) return [`M0 ${-radius}A${radius} ${radius} 0 1 1 0 ${radius}A${radius} ${radius} 0 1 1 0 ${-radius}`];
  const step = (Math.PI * 2) / maxLevel;
  const gap = Math.min(0.2, step * 0.3);
  return Array.from({ length: maxLevel }, (_, i) => {
    const a0 = -Math.PI / 2 + i * step + gap / 2;
    const a1 = a0 + step - gap;
    const p = (a: number): string => `${(Math.cos(a) * radius).toFixed(2)} ${(Math.sin(a) * radius).toFixed(2)}`;
    return `M${p(a0)}A${radius} ${radius} 0 0 1 ${p(a1)}`;
  });
}

const BOAT = `
  <g class="tech-boat-bob">
    <path class="tech-boat-hull" d="M-64 -24 Q24 -38 70 0 Q24 38 -64 24 Z"/>
    <path class="tech-boat-deck" d="M-54 -16 Q19 -27 54 0 Q19 27 -54 16 Z"/>
    <rect class="tech-boat-bench" x="-46" y="-19" width="8" height="38" rx="2"/>
    <rect class="tech-boat-bench" x="30" y="-13" width="7" height="26" rx="2"/>
  </g>`;

interface NodeView {
  node: TechNode;
  el: HTMLButtonElement;
  cost: HTMLSpanElement;
  pips: SVGPathElement[];
  x: number;
  y: number;
  size: number;
  visible: boolean;
}

let mounts = 0;

export function mountTechTree(container: HTMLElement, options: { onBuy(nodeId: string): void }): TechTreeView {
  const layout = layoutTree(TECH_NODES);
  const tipId = `tech-tip-${++mounts}`;

  const root = html("div", "tech");
  root.tabIndex = -1;
  const world = html("div", "tech-world");
  const back = svg("svg", { class: "tech-svg", width: 1, height: 1, "aria-hidden": "true" });
  const ringLayer = svg("g", { class: "tech-rings" });
  const edgeLayer = svg("g", { class: "tech-edges" });
  const labelLayer = svg("g", { class: "tech-labels" });
  const boat = svg("g", { class: "tech-boat" });
  boat.innerHTML = BOAT;
  back.append(ringLayer, edgeLayer, labelLayer, boat);
  const nodeLayer = html("div", "tech-nodes");
  world.append(back, nodeLayer);

  const tip = html("div", "tech-tip");
  tip.id = tipId;
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;

  const controls = html("div", "tech-controls");
  const zoomOut = html("button", "tech-control", "−");
  const zoomIn = html("button", "tech-control", "+");
  const recentre = html("button", "tech-control tech-control-fit");
  recentre.innerHTML =
    '<svg viewBox="-12 -12 24 24" aria-hidden="true"><circle r="3.5"/><path d="M-10 -5 V-10 H-5 M5 -10 H10 V-5 M10 5 V10 H5 M-5 10 H-10 V5"/></svg>';
  for (const [button, label] of [
    [zoomOut, "Zoom out"],
    [zoomIn, "Zoom in"],
    [recentre, "Fit the tree to the view"],
  ] as const) {
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
  }
  controls.append(zoomOut, zoomIn, recentre);
  const hint = html("div", "tech-hint", "Drag to pan · Scroll to zoom");
  root.append(world, tip, controls, hint);
  container.append(root);

  // Outside the gesture surface: its content can scroll independently of the tree.
  const sheet = html("div", "tech-sheet");
  sheet.hidden = true;
  sheet.tabIndex = -1;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "Upgrade details");
  const sheetClose = html("button", "tech-sheet-close", "×");
  sheetClose.type = "button";
  sheetClose.setAttribute("aria-label", "Close upgrade details");
  const sheetContent = html("div", "tech-sheet-content");
  const sheetBuy = html("button", "tech-sheet-buy", "Buy upgrade");
  sheetBuy.type = "button";
  sheet.append(sheetClose, sheetContent, sheetBuy);
  document.body.append(sheet);

  // Rings behind the nodes, like sonar around the boat.
  for (const radius of layout.rings) ringLayer.append(svg("circle", { r: radius }));

  // Lane labels sit just outside the lane's outermost visible ring.
  const labels = new Map<LaneKey, SVGTextElement>();
  for (const lane of layout.lanes) {
    // A style, not the fill attribute: attributes can't read CSS variables.
    const text = svg("text", { class: "tech-label", style: `fill: ${LANE_TINTS[lane.key]}` });
    text.textContent = lane.label;
    labelLayer.append(text);
    labels.set(lane.key, text);
  }

  // Nodes, in lane and ring order so Tab moves outwards through each branch in turn.
  const laneRank = new Map(layout.lanes.map((lane, i) => [lane.key, i]));
  const ordered = [...TECH_NODES].sort((a, b) => {
    const pa = layout.nodes.get(a.id)!;
    const pb = layout.nodes.get(b.id)!;
    const rank = (p: typeof pa): number => (p.lane === null ? -1 : (laneRank.get(p.lane) ?? 0));
    return rank(pa) - rank(pb) || pa.depth - pb.depth || Math.atan2(pa.y, pa.x) - Math.atan2(pb.y, pb.x);
  });
  const views = new Map<string, NodeView>();
  for (const node of ordered) {
    const placed = layout.nodes.get(node.id)!;
    const isRoot = placed.lane === null;
    const size = isRoot ? ROOT_SIZE : NODE_SIZE;
    const el = html("button", isRoot ? "tech-node is-root" : "tech-node");
    el.type = "button";
    el.dataset.id = node.id;
    el.hidden = true;
    el.style.left = `${placed.x}px`;
    el.style.top = `${placed.y}px`;
    el.style.setProperty("--size", `${size}px`);
    el.style.setProperty("--tint", LANE_TINTS[laneOf(node)]);

    // 10 px of room around the button, matching the inset in the CSS.
    const pipSvg = svg("svg", { class: "tech-pips", viewBox: `${-size / 2 - 10} ${-size / 2 - 10} ${size + 20} ${size + 20}` });
    const pips = pipSegments(node.maxLevel, size / 2 + 5).map((d) => svg("path", { d }));
    pipSvg.append(...pips);
    const icon = svg("svg", { class: "tech-icon", viewBox: "-12 -12 24 24", "aria-hidden": "true" });
    icon.innerHTML = iconFor(node);
    const cost = html("span", "tech-cost");
    el.append(pipSvg, icon, cost);
    nodeLayer.append(el);
    views.set(node.id, { node, el, cost, pips, x: placed.x, y: placed.y, size, visible: false });
  }

  // One edge per requirement, drawn from the requirement out to the node that needs it.
  const edges = TECH_NODES.flatMap((node) =>
    node.requires.map((id) => {
      const from = layout.nodes.get(id)!;
      const to = layout.nodes.get(node.id)!;
      const line = svg("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y });
      edgeLayer.append(line);
      return { from: id, to: node.id, line };
    }),
  );

  let state: TechTreeState = { money: 0, upgrades: {} };
  /** False until the first update, which shouldn't animate nodes in. */
  let mounted = false;
  let view = { x: 0, y: 0, scale: 1 };
  /** Follow the tree as it grows until the player pans or zooms themselves. */
  let autoFit = true;
  let hoverId: string | null = null;
  let focusId: string | null = null;
  let animateTimer = 0;
  let selectedId: string | null = null;
  let touchMode = window.matchMedia("(max-width: 700px), (any-pointer: coarse)").matches;
  root.classList.toggle("is-touch", touchMode);
  hint.textContent = touchMode ? "Tap an upgrade · Drag to pan · Pinch to zoom" : hint.textContent;
  const minimumScale = (): number => touchMode ? TOUCH_MIN_SCALE : MIN_SCALE;

  function closeSheet(restoreFocus = false): void {
    const selected = selectedId ? views.get(selectedId) : undefined;
    selected?.el.classList.remove("is-selected");
    selectedId = null;
    sheet.hidden = true;
    sheetBuy.disabled = true;
    if (restoreFocus) root.focus({ preventScroll: true });
  }

  function showSheet(id: string): void {
    closeSheet();
    const v = views.get(id);
    if (!v?.visible) return;
    selectedId = id;
    v.el.classList.add("is-selected");
    hoverId = null;
    focusId = null;
    tip.hidden = true;
    renderSheet(v);
    sheet.hidden = false;
    sheet.focus({ preventScroll: true });
  }

  function renderSheet(v: NodeView): void {
    renderDetails(v, sheetContent, true);
    sheet.style.setProperty("--tint", LANE_TINTS[laneOf(v.node)]);
    const maxed = isMaxed(v.node, state.upgrades);
    const buyable = canBuy(v.node, state.upgrades, state.money);
    sheetBuy.disabled = !buyable;
    sheetBuy.textContent = maxed ? "Fully upgraded" : `Buy · ${formatMoney(nextCost(v.node, levelOf(v.node, state.upgrades)))}`;
    sheet.setAttribute("aria-label", v.node.name);
  }

  function size(): { width: number; height: number } {
    return { width: root.clientWidth, height: root.clientHeight };
  }

  function applyView(animate = false): void {
    window.clearTimeout(animateTimer);
    root.classList.toggle("is-animating", animate);
    if (animate) animateTimer = window.setTimeout(() => root.classList.remove("is-animating"), 400);
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    root.style.setProperty("--zoom", String(view.scale));
    placeTip();
  }

  /** Frames everything visible: the boat, the visible nodes with their price labels, and lane labels. */
  function fit(animate: boolean): void {
    const { width, height } = size();
    if (width === 0 || height === 0) return;
    let box = { left: -BOAT_HALF_LENGTH, right: BOAT_HALF_LENGTH, top: -ROOT_SIZE, bottom: ROOT_SIZE };
    const grow = (left: number, top: number, right: number, bottom: number): void => {
      box = { left: Math.min(box.left, left), top: Math.min(box.top, top), right: Math.max(box.right, right), bottom: Math.max(box.bottom, bottom) };
    };
    for (const v of views.values()) if (v.visible) grow(v.x, v.y, v.x, v.y + PRICE_DROP);
    for (const label of labels.values()) {
      if (label.classList.contains("is-hidden")) continue;
      const b = label.getBBox();
      grow(b.x, b.y, b.x + b.width, b.y + b.height);
    }
    const w = box.right - box.left + 2 * FIT_MARGIN;
    const h = box.bottom - box.top + 2 * FIT_MARGIN;
    const scale = Math.min(MAX_FIT_SCALE, Math.max(minimumScale(), Math.min(width / w, height / h)));
    view = {
      x: width / 2 - ((box.left + box.right) / 2) * scale,
      y: height / 2 - ((box.top + box.bottom) / 2) * scale,
      scale,
    };
    applyView(animate);
  }

  /** Zooms by `factor`, keeping the world point under (sx, sy) where it is on screen. */
  function zoomAt(sx: number, sy: number, factor: number, animate = false): void {
    const scale = Math.min(MAX_SCALE, Math.max(minimumScale(), view.scale * factor));
    const k = scale / view.scale;
    view = { x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k, scale };
    autoFit = false;
    applyView(animate);
  }

  function zoomCentre(factor: number): void {
    const { width, height } = size();
    zoomAt(width / 2, height / 2, factor, true);
  }

  function screenOf(v: NodeView): { x: number; y: number; r: number } {
    return { x: v.x * view.scale + view.x, y: v.y * view.scale + view.y, r: (v.size / 2) * view.scale };
  }

  /** Pans just enough to bring a node comfortably into view. */
  function reveal(v: NodeView): void {
    const { width, height } = size();
    const p = screenOf(v);
    const dx = Math.min(0, width - FOCUS_MARGIN - p.x) + Math.max(0, FOCUS_MARGIN - p.x);
    const dy = Math.min(0, height - FOCUS_MARGIN - p.y) + Math.max(0, FOCUS_MARGIN - p.y);
    if (dx === 0 && dy === 0) return;
    view = { ...view, x: view.x + dx, y: view.y + dy };
    applyView(true);
  }

  function renderDetails(v: NodeView, target: HTMLElement, touch = false): void {
    const { node } = v;
    const level = levelOf(node, state.upgrades);
    const maxed = level >= node.maxLevel;
    const cost = nextCost(node, level);
    target.replaceChildren();
    target.style.setProperty("--tint", LANE_TINTS[laneOf(node)]);

    const head = html("div", "tech-tip-head");
    head.append(
      html("span", "tech-tip-lane", layout.lanes.find((l) => l.key === laneOf(node))?.label ?? ""),
      html("span", "tech-tip-level", maxed ? `Level ${level} · Max` : `Level ${level} → ${level + 1} of ${node.maxLevel}`),
    );
    target.append(head, html("h3", "tech-tip-name", node.name), html("p", "tech-tip-desc", node.description));

    const changes = nodeChanges(BASE_STATS, node, state.upgrades);
    if (changes.length > 0) {
      const list = html("dl", "tech-tip-stats");
      for (const change of changes) {
        const dd = html("dd", "");
        dd.append(html("span", "tech-tip-before", change.before), " → ", html("strong", "", change.after));
        list.append(html("dt", "", change.label), dd);
      }
      target.append(list);
    }

    const foot = html("div", "tech-tip-cost");
    if (maxed) {
      foot.classList.add("is-maxed");
      foot.textContent = "Fully upgraded";
    } else if (state.money >= cost) {
      foot.classList.add("is-ready");
      foot.append(html("strong", "", formatMoney(cost)), html("span", "", touch ? "Ready to upgrade" : "Click to buy"));
    } else {
      foot.classList.add("is-short");
      foot.append(html("strong", "", formatMoney(cost)), html("span", "", `${formatMoney(cost - state.money)} more`));
    }
    target.append(foot);
  }

  function placeTip(): void {
    const id = hoverId ?? focusId;
    const v = id ? views.get(id) : undefined;
    if (touchMode || !sheet.hidden || !v || !v.visible || root.classList.contains("is-panning")) {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
    const { width, height } = size();
    const p = screenOf(v);
    const gap = 14;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    // Prefer the side facing away from the boat, where a lane has fewer neighbours to cover.
    const right = p.x + p.r + gap;
    const left0 = p.x - p.r - gap - w;
    let left = v.x < -1 ? left0 : right;
    if (left === right && right + w > width - 8) left = left0;
    if (left === left0 && left0 < 8) left = right;
    left = Math.max(8, Math.min(width - w - 8, left));
    const top = Math.max(8, Math.min(height - h - 8, p.y - h / 2));
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function showTip(): void {
    const id = hoverId ?? focusId;
    const v = id ? views.get(id) : undefined;
    for (const other of views.values()) other.el.removeAttribute("aria-describedby");
    if (v) {
      renderDetails(v, tip);
      v.el.setAttribute("aria-describedby", tipId);
    }
    placeTip();
  }

  function update(next: TechTreeState): void {
    state = next;
    const { upgrades, money } = state;
    const deepest = new Map<LaneKey, number>();

    for (const v of views.values()) {
      const { node, el } = v;
      const visible = isVisible(node, upgrades);
      const level = levelOf(node, upgrades);
      const maxed = isMaxed(node, upgrades);
      const cost = nextCost(node, level);
      const buyable = canBuy(node, upgrades, money);

      if (visible && !v.visible && mounted) el.classList.add("is-new");
      v.visible = visible;
      el.hidden = !visible;
      el.classList.toggle("is-owned", level > 0);
      el.classList.toggle("is-maxed", maxed);
      el.classList.toggle("is-ready", buyable);
      el.classList.toggle("is-short", !maxed && !buyable);
      el.setAttribute("aria-disabled", String(!buyable));
      el.setAttribute(
        "aria-label",
        `${node.name}, level ${level} of ${node.maxLevel}${maxed ? ", maxed" : `, costs ${formatMoney(cost)}${buyable ? "" : ", can't afford yet"}`}`,
      );
      v.cost.textContent = maxed ? "Max" : shortMoney(cost);
      v.pips.forEach((pip, i) => pip.classList.toggle("is-on", i < level));

      const placed = layout.nodes.get(node.id)!;
      if (visible && placed.lane) deepest.set(placed.lane, Math.max(deepest.get(placed.lane) ?? 0, placed.depth));
    }

    for (const edge of edges) {
      const shown = views.get(edge.from)!.visible && views.get(edge.to)!.visible;
      edge.line.classList.toggle("is-hidden", !shown);
      edge.line.classList.toggle("is-owned", levelOf(views.get(edge.to)!.node, upgrades) > 0);
    }

    for (const lane of layout.lanes) {
      const label = labels.get(lane.key)!;
      const depth = deepest.get(lane.key);
      label.classList.toggle("is-hidden", depth === undefined);
      // Like axis labels on a radar chart: just past the outermost visible ring, reading away from
      // the centre, and further out below the boat where the price labels hang.
      const cos = Math.cos(lane.center);
      const sin = Math.sin(lane.center);
      const radius = (layout.rings[depth ?? 0] ?? 0) + LABEL_GAP + PRICE_DROP * Math.max(0, sin);
      label.setAttribute("x", (cos * radius).toFixed(1));
      label.setAttribute("y", (sin * radius).toFixed(1));
      label.setAttribute("text-anchor", cos > 0.35 ? "start" : cos < -0.35 ? "end" : "middle");
    }

    if (autoFit) fit(mounted);
    if (hoverId ?? focusId) showTip();
    if (selectedId) {
      const selected = views.get(selectedId);
      if (selected?.visible) renderSheet(selected);
      else closeSheet();
    }
    mounted = true;
  }

  // Buying and hovering, delegated to the node layer.
  function nodeFrom(target: EventTarget | null): NodeView | undefined {
    const el = target instanceof Element ? target.closest<HTMLElement>(".tech-node") : null;
    return el?.dataset.id ? views.get(el.dataset.id) : undefined;
  }

  nodeLayer.addEventListener("click", (event) => {
    const v = nodeFrom(event.target);
    if (!v) return;
    closeSheet();
    if (canBuy(v.node, state.upgrades, state.money)) {
      options.onBuy(v.node.id);
    } else if (!isMaxed(v.node, state.upgrades)) {
      v.el.classList.remove("is-denied");
      void v.el.offsetWidth; // Restart the shake if it's already playing.
      v.el.classList.add("is-denied");
    }
  });
  nodeLayer.addEventListener("animationend", (event) => {
    const el = nodeFrom(event.target)?.el;
    if (event.animationName === "tech-deny") el?.classList.remove("is-denied");
    if (event.animationName === "tech-pop") el?.classList.remove("is-new");
  });
  nodeLayer.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    if (event.pointerType === "mouse") {
      touchMode = false;
      root.classList.remove("is-touch");
      hint.textContent = "Drag to pan · Scroll to zoom";
    }
    const v = nodeFrom(event.target);
    if (!v || v.node.id === hoverId) return;
    hoverId = v.node.id;
    showTip();
  });
  nodeLayer.addEventListener("pointerout", (event) => {
    const v = nodeFrom(event.target);
    if (!v || (event.relatedTarget instanceof Node && v.el.contains(event.relatedTarget))) return;
    hoverId = null;
    showTip();
  });
  nodeLayer.addEventListener("focusin", (event) => {
    const v = nodeFrom(event.target);
    if (!v) return;
    focusId = v.node.id;
    // Only follow keyboard focus; a click shouldn't move the tree under the cursor.
    if (v.el.matches(":focus-visible")) {
      touchMode = false;
      root.classList.remove("is-touch");
      reveal(v);
    }
    showTip();
  });
  nodeLayer.addEventListener("focusout", () => {
    focusId = null;
    showTip();
  });

  const gestures = new TreeGestures();
  function pointer(event: PointerEvent): TreePointer {
    const rect = root.getBoundingClientRect();
    return { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top, pointerType: event.pointerType, nodeId: nodeFrom(event.target)?.node.id ?? null };
  }

  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    touchMode = event.pointerType === "touch";
    root.classList.toggle("is-touch", touchMode);
    hint.textContent = touchMode ? "Tap an upgrade · Drag to pan · Pinch to zoom" : "Drag to pan · Scroll to zoom";
    if (touchMode && view.scale < TOUCH_MIN_SCALE) {
      const rect = root.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, TOUCH_MIN_SCALE / view.scale);
    }
    if (event.target instanceof Element && event.target.closest(".tech-controls")) return;
    gestures.down(pointer(event), view);
    // Capture touch from the beginning; the selection uses the original down target.
    if (touchMode) root.setPointerCapture(event.pointerId);
    root.classList.toggle("is-panning", gestures.panning);
    placeTip();
  });
  root.addEventListener("pointermove", (event) => {
    const next = gestures.move(pointer(event), view, minimumScale(), MAX_SCALE);
    if (!next) return;
    autoFit = false;
    if (!root.hasPointerCapture(event.pointerId)) root.setPointerCapture(event.pointerId);
    root.classList.add("is-panning");
    closeSheet();
    view = next;
    applyView();
  });
  root.addEventListener("pointerup", (event) => {
    const result = gestures.up(pointer(event));
    root.classList.toggle("is-panning", gestures.panning);
    if (result.touchTap) {
      if (result.selection) showSheet(result.selection);
      else closeSheet();
    }
    placeTip();
  });
  function releaseCaptures(ids: number[]): void {
    for (const id of ids) if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
  }

  function dismiss(): void {
    releaseCaptures(gestures.cancelAll());
    window.clearTimeout(animateTimer);
    root.classList.remove("is-panning", "is-animating");
    hoverId = null;
    focusId = null;
    tip.hidden = true;
    for (const v of views.values()) v.el.removeAttribute("aria-describedby");
    closeSheet();
  }

  const cancelGesture = (event: PointerEvent): void => {
    releaseCaptures(gestures.cancel(event.pointerId));
    root.classList.toggle("is-panning", gestures.panning);
    placeTip();
  };
  root.addEventListener("pointercancel", cancelGesture);
  root.addEventListener("lostpointercapture", cancelGesture);
  // Pointer-generated clicks after touch, drag, or cancellation must never purchase.
  // Keyboard activation (detail zero) keeps the existing direct-buy behavior.
  root.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".tech-controls")) return;
    const pointerType = (event as PointerEvent).pointerType;
    if (!gestures.suppressClick || (event.detail === 0 && pointerType !== "touch")) return;
    event.stopPropagation();
    event.preventDefault();
  }, true);

  sheetClose.addEventListener("click", () => closeSheet(true));
  sheetBuy.addEventListener("click", () => {
    const v = selectedId ? views.get(selectedId) : undefined;
    if (v && canBuy(v.node, state.upgrades, state.money)) options.onBuy(v.node.id);
  });
  const dismissSheetOnEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !sheet.hidden) {
      closeSheet(true);
      event.preventDefault();
    }
  };
  document.addEventListener("keydown", dismissSheetOnEscape);

  root.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      // Trackpads send small pixel deltas, mouse wheels large ones; both zoom smoothly.
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-delta * 0.0015));
    },
    { passive: false },
  );

  root.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const pan = 80;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [pan, 0],
      ArrowRight: [-pan, 0],
      ArrowUp: [0, pan],
      ArrowDown: [0, -pan],
    };
    const move = moves[event.key];
    if (move) {
      autoFit = false;
      view = { ...view, x: view.x + move[0], y: view.y + move[1] };
      applyView(true);
    } else if (event.key === "+" || event.key === "=") zoomCentre(1.25);
    else if (event.key === "-" || event.key === "_") zoomCentre(0.8);
    else if (event.key === "0") {
      autoFit = true;
      fit(true);
    } else if (event.key === "Escape" && !sheet.hidden) {
      closeSheet(true);
    } else if (event.key === "Escape" && !tip.hidden) {
      // Dismiss without moving focus; the next hover or focus brings it back.
      hoverId = null;
      tip.hidden = true;
    } else return;
    event.preventDefault();
  });

  zoomIn.addEventListener("click", () => zoomCentre(1.25));
  zoomOut.addEventListener("click", () => zoomCentre(0.8));
  recentre.addEventListener("click", () => {
    autoFit = true;
    fit(true);
  });

  const resize = new ResizeObserver(() => {
    if (autoFit) fit(false);
    else placeTip();
  });
  resize.observe(root);
  fit(false);

  return {
    update,
    dismiss,
    destroy() {
      dismiss();
      document.removeEventListener("keydown", dismissSheetOnEscape);
      resize.disconnect();
      window.clearTimeout(animateTimer);
      sheet.remove();
      root.remove();
    },
  };
}
