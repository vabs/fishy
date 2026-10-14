# Fishy

A round-based fish catching game for the browser. A boat sits in the middle of the sea and fish
swim around it. Your cursor carries a net that catches fish on its own; spend what you earn on
upgrades between rounds, unlock stranger fish, and work your way to the Final Round.

**Play:** https://vabs.github.io/fishy/ (desktop browsers)

![A round in progress: two fish inside the net are drawn in colour with health bars, the rest of the sea shows dark fish silhouettes](docs/screenshots/gameplay.png)

## How to play

- **Move the mouse.** The circle around the cursor is your net. Every half second it hits every
  fish inside it. Clicking does nothing.
- **Catch fish.** A fish whose health reaches zero is caught and pays out.
- **Beat the clock.** Each round lasts 15 seconds. Whatever you caught is banked when the timer
  runs out; fish still swimming are lost.
- **Look through the net.** Outside the net every fish is a dark silhouette, told apart by its
  outline. Inside the net you see it in full colour, with its health bar.
- **Upgrade.** Between rounds, spend money in the tech tree: a bigger net, harder hits, faster
  ticks, longer rounds, new fish and their abilities.
- **Finish.** Max out the whole tree to unlock the Final Round.

![Round summary showing fish caught, money earned and the bank balance](docs/screenshots/summary.png)

## Fish

| Fish | What it does |
| --- | --- |
| Normal | The fish you start with. Steady and simple. |
| Uncommon | Swims in small schools, so one sweep can catch several. |
| Rare | Slow and armoured, but worth a lot. |
| Electric | Darts around. When caught, a current jumps from fish to fish, damaging each one. |
| Epic | Swims away from your net. When caught, it can net the fish around it. |
| Goober | Bursts into new fish when caught. Upgrades decide which kind. |
| Monster | A whirlpool: pulls nearby fish into a vortex, and when caught takes all of them with it. |
| Star | Rare. When caught it shoots across the sea, bouncing off the edges and hitting every fish in its path. |

A fish caught by any of these effects counts as caught by you, so its own ability fires too and
chains can run through the whole sea.

## Saving

Progress is saved in your browser. Export your save to a file to move it to another browser or
computer, and import it there.

## Status

Work in progress. Playable now: rounds, the net, Normal fish and the silhouette lens. Being built:
the tech tree, saves, the other fish types and the Final Round.
Full design: [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).

## Development

Requires Node 22.12+ (24 recommended, see `.nvmrc`).

```bash
npm install
npm run dev           # dev server at http://localhost:5173
npm test              # vitest
npm run typecheck
npm run build         # static site in dist/
npm run preview       # serve the build locally
npm run screenshots   # regenerate docs/screenshots (needs Google Chrome installed)
```

In dev, `?fish=electric,epic` makes only those types spawn, which is handy for trying one out:
http://localhost:5173/?fish=electric,epic

### Structure

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
scripts/
  screenshots.mjs   Captures the README screenshots
```

### Deploy

Every push to `main` runs the tests, builds, and deploys `dist/` to GitHub Pages
(`.github/workflows/deploy.yml`). The repo's Pages source must be set to "GitHub Actions".

Saves live in the browser's localStorage, which is tied to the site's exact origin. Changing the
domain later means players have to export and re-import their saves.
