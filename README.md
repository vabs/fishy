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
  stats.ts          Everything upgrades can change (global, per fish, abilities) and base values
  fish/             One file per fish type (FishSpec): stats, shape and behaviour hooks
    types.ts        FishSpec: onSpawn, move, modifyDamage, onCapture, update, drawWorld, fx
    index.ts        Registry of all types
  render.ts         Canvas renderer: background, boat, silhouettes, net lens, effects
  shapes.ts         Builds each type's cached full / silhouette / hit-flash sprites
  fx.ts             Short-lived visual effects that fish types add
  rng.ts            Seeded random numbers
```

## Dev tips

In dev, `?fish=electric,epic` makes only those types spawn, e.g.
http://localhost:5173/?fish=electric,epic
