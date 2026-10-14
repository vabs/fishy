import type { Point } from "./world";

/** Keep net coverage, fish density and logical speeds comparable across screen sizes. */
const ARENA_AREA = 1280 * 800;

export interface GameViewport {
  screenWidth: number;
  screenHeight: number;
  x: number;
  y: number;
  worldWidth: number;
  worldHeight: number;
  scale: number;
}

export function createViewport(width: number, height: number, top = 0, bottom = 0): GameViewport {
  const screenWidth = Math.max(1, width);
  const screenHeight = Math.max(1, height);
  const y = Math.min(Math.max(0, top), screenHeight - 1);
  const availableHeight = Math.max(1, screenHeight - y - Math.max(0, bottom));
  const scale = Math.sqrt(screenWidth * availableHeight / ARENA_AREA);
  return { screenWidth, screenHeight, x: 0, y, worldWidth: screenWidth / scale, worldHeight: availableHeight / scale, scale };
}

export function toWorldPoint(view: GameViewport, point: Point): Point {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}
