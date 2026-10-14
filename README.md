# Fishy

A round-based fish catching game for the browser. Fish swim around a boat; your cursor carries a net
that catches them automatically. Spend what you earn in a tech tree between rounds.

Design: [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).

## Requirements

Node 22.12+ (24 recommended, see `.nvmrc`).

## Scripts

```bash
npm install
npm run dev         # dev server at http://localhost:5173
npm test            # vitest
npm run typecheck
npm run build       # static site in dist/, host anywhere
npm run preview     # serve the build locally
```

## Structure

```
index.html          Page shell: canvas, HUD, panels
src/main.ts         Boot, game loop, input, screens
src/game/
  world.ts          The simulation for one round. No DOM, fixed 60 Hz step, seeded RNG
  fish.ts           Fish type definitions
  stats.ts          Everything upgrades can change, and the starting values
  render.ts         Canvas renderer: background, boat, silhouettes, net lens, effects
  shapes.ts         Fish shapes and their cached full / silhouette / hit-flash sprites
  rng.ts            Seeded random numbers
```
