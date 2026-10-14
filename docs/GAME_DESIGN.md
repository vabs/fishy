# Fishy: game design

Single-player browser game for desktop, phones and tablets. A round-based incremental game about catching fish: a boat
sits in the centre, fish swim around it, and the player guides a net that damages every
fish inside it on a timer. Money from each round buys upgrades in a tech tree. Once the whole tree
is maxed, the player plays a Final Round and the game ends.

Exact numbers (HP, value, speeds, costs) live in code and get tuned during balancing. This document
describes mechanics.

## Core loop

1. A round starts with a time limit. Fish are already in the water and more keep spawning.
2. The net auto-ticks while active. Each tick damages every fish inside it.
3. A fish at 0 HP is captured. Its on-capture effect fires, if it has one.
4. When the timer reaches 0 the round ends. Fish still swimming are lost.
5. The value of every fish caught that round is banked as money.
6. The player spends money in the tech tree, then starts the next round.

## Input

With a mouse, the net follows the cursor and ticks automatically; mouse clicks do nothing. It
only ticks while the cursor is over the play area. On touch screens, holding and dragging guides
the net above the finger to keep fish visible; lifting the finger deactivates it. An extra finger
does not create another net.

The tech tree supports dragging to pan, mouse-wheel or two-finger pinch zoom, and tapping an
upgrade to inspect it before using Buy. Compact screens put help, sound and save controls under
the ⋯ button while keeping money and Start Round visible. Portrait and landscape are both
supported, with controls kept clear of screen cutouts and the home indicator.

A round can be paused with the HUD pause button. Switching tabs/apps or rotating the device also
pauses it. Time and simulation stay frozen until Resume round; the HUD stays visible. Dialogs
scroll within the visible screen, including when the name-entry keyboard is open.

The arena keeps the area of a 1280 × 800 reference field as its aspect ratio changes. The net,
abilities and fish speeds use those logical coordinates, so a smaller display does not increase
the share of the sea covered by an upgrade. On touch displays the canvas pixel density is capped
at 2 to limit rendering work.

## Capturing

Every capture goes through one function, `capture(fish, source)`, whatever caused it: the net, an
Electric current, an Epic fish, a Star fish or a Whirlpool. Captures are queued and processed once
per frame, so chain reactions never recurse and the number of effects per frame can be capped.

A fish captured by any source behaves like a fish captured by the net: it pays its value and its
on-capture effect fires. Fish caught by an ability (Electric current, Epic net, Star shot, Whirlpool)
pay 1.5× their value, so chain reactions earn money even late in the game, when the net would catch
nearly every fish anyway.

## Spawning

- Every unlocked fish type spawns on its own clock at its own rate (fish per second). Unlocking or
  upgrading one type adds fish; it never makes another type rarer.
- There is no limit on fish in the water: fish keep arriving whether or not the player catches any.
  The only per-type limit is the Monster, at most one at a time.

## Movement

- Fish orbit the boat. The orbit is an ellipse fitted to the screen, so wide screens are used fully.
- A fish can spawn anywhere between just outside the boat and the edge of the play area. Spawn
  distance has no effect on behaviour.
- Movement is defined only by fish type. Speeds are in pixels per second along the path, so a fish
  far from the boat moves no faster than the same fish close to it.

## Fish types

The player starts with Normal fish only. Every other type is unlocked in the tech tree.

| Fish | Role | Movement | On capture |
| --- | --- | --- | --- |
| Normal | Baseline | Steady orbit, gentle wobble | Nothing |
| Uncommon | Early value bump, makes low levels playable | Spawns in a school of 3–5 that swim together, a bit faster than Normal | Nothing |
| Rare | Tanky, high value | Slow and large. Armour reduces every hit by a flat amount, but at least 25% of a hit always gets through, so damage upgrades matter | Nothing |
| Electric | Chain damage | Drifts, then darts in sudden bursts; sometimes jumps to a new distance from the boat | Releases a current (see below) |
| Epic | Chain capture | Swims away from the cursor when it gets close, then returns to its orbit | Chance to instantly capture each fish within range |
| Goober | Spawner | Slow, bobs in and out, sometimes reverses direction | Bursts into fish of its current tier (see below) |
| Monster | Whirlpool | Very slow, wide sweeps. At most one on screen | Captures every fish in its vortex (see below) |

### Electric current

When an Electric fish is captured it releases a small current that jumps from fish to fish. Each
jump goes to the nearest fish within jump range that this current has not already hit, and damages
it. Damage is the same on every jump to start with; it can fall off per jump if balancing needs it.
A fish killed by the current is captured, so another Electric fish starts a new current.

Upgrades: number of jumps, current damage, jump range.

Electric fish drift slowly, then dart in short bursts, sometimes to a new distance from the boat.

### Epic net

When an Epic fish is captured, every fish within range has a chance to be captured instantly.

Upgrades: capture chance, range.

Epic fish swim away from the net when it comes close, but tire after a short burst, so they stay
catchable.

### Goober tiers

A captured Goober bursts into several fish at its own position. That position is usually inside the
net, so the new fish tend to be caught on the next ticks.

The fish it spawns depends on its tier, upgraded in the tech tree:
Normal → Uncommon → Rare → Electric → Epic.

A Goober never spawns a Goober, Monster or Star, so it can't loop forever.

The round summary counts burst fish under Goober: their catches and money show in the Goober row,
not in the row of their own type. Lifetime stats still count them as their own type.

Upgrades: spawn tier, spawn count.

### Monster (Whirlpool)

- **While alive:** pulls nearby fish into a slow vortex around itself, bunching them together.
- **When captured:** every fish within its vortex radius is captured instantly (HP set to 0) and
  spirals into the centre. Their own on-capture effects fire.

This gives the player a choice: keep it alive so it herds fish into clumps (good for the net and for
Star fish), or capture it to collect everything it has gathered. No fish ever attacks the boat.

Upgrades: vortex radius, pull strength, value.

## Star fish

A rare special fish, separate from the seven types above.

- Small, fast and glowing. Its spawn chance is a tech tree upgrade.
- When captured it becomes a projectile. It launches from where it was caught in a random direction,
  bounces off the screen edges a set number of times, then fades.
- It damages every fish in its path. Each fish has a short cooldown before the same star can hit it
  again, so a fish isn't hit every frame.
- A fish reduced to 0 HP by a star is captured, and its effect fires. A star can capture another
  star, which launches a second projectile.
- Each Constellation level adds a shard to every launch: a smaller star (80% of the size) that fades
  after half as many bounces, rounded up. Shards deal full damage. Full-strength extra stars let Star
  shots catch about three quarters of a late round's money, leaving little for the net and the other
  abilities; shards bring that to about two thirds.

Upgrades: spawn chance, bounces, damage, speed, size (hit radius), shards per catch (Constellation).
Possible late upgrades: split on bounce, damaging trail.

## Silhouette lens

Late-game screens get crowded, so fish are drawn as uniform dark silhouettes. Only the part of the
screen inside the net is drawn in full colour, like a lens. A fish half inside the net is drawn half
in colour. HP bars appear only inside the lens.

Each type needs an outline that is recognisable without colour:

| Fish | Outline |
| --- | --- |
| Normal | Oval body, forked tail |
| Uncommon | Angelfish: tall diamond body, long fins |
| Rare | Bulky body, spiked back fin |
| Electric | Long eel |
| Epic | Anglerfish with a lure |
| Goober | Round puffer |
| Monster | Huge shark |
| Star | Five-point star |

Silhouettes are generated from each fish's full image (canvas shapes now, sprites later) and cached,
so drawing thousands of fish stays cheap.

## Tech tree

### Model

- All nodes are defined in one TypeScript config file. Each node has an id, branch, prerequisites,
  max level, a cost curve (`base * growth^level`) and an effect on the game's stats.
- Each level's dollar price is rounded up to a multiple of 10. A $2 price becomes $10; a $34
  price becomes $40; prices already divisible by 10 stay unchanged.
- At the start of each round the game computes `stats = applyUpgrades(baseStats, ownedLevels)`.
  The simulation only reads `stats`, so adding an upgrade means adding a config entry.
- Shown as a radial graph centred on the boat. A node's neighbours appear once it is bought.
- Each fish's unlock gates the rest of its nodes. Fish unlock in order: Uncommon → Rare →
  Electric → Epic → Goober → Monster → Star.
- Pacing target: finishing the tree takes roughly 1–1.5 hours. `src/game/tech/pacing.test.ts`
  checks it by playing a whole game with a bot.

### Branches

**Net**
- Net size (radius)
- Net damage
- Tick speed
- Critical hit chance
- Critical hit damage

**Time**
- Longer rounds
- Chance to add time when a fish is captured
- Amount of time added (bonus time is capped at one extra round length per round, so chains
  can't stretch a round forever)

**Economy**
- Fish value (all fish)
- Combo: captures in quick succession stack a value multiplier
- Combo window and combo cap

**Spawning**
- Spawn speed of every fish type
- Fish already in the water when the round starts
- Chance to spawn the same fish when a fish is captured

**Per fish type** (Normal, Uncommon, Rare, Electric, Epic, Goober, Monster)
- Unlock (all except Normal)
- Spawn rate: this type spawns more often (never at the expense of another type)
- Value
- Type-specific upgrades:
  - Uncommon: school size
  - Rare: armour pierce (first hit deals double damage)
  - Electric: jumps, current damage, jump range
  - Epic: capture chance, range
  - Goober: spawn tier, spawn count
  - Monster: vortex radius, pull strength

**Star fish**
- Unlock and spawn chance
- Bounces, damage, speed, size
- Constellation: smaller shards launched alongside each Star

### Starting state

Only Normal fish spawn. The only visible node is the root in the centre, Bigger Net ($2,
affordable after round 1). Buying it opens the rest of the Net branch and the Normal fish branch;
Time, Economy and Spawning open from those.

## Final round and end screen

- When every node in the tech tree is at max level, the "Next Round" button becomes "Final Round".
- The Final Round plays like any other round, with a "Final Round" label.
- Afterwards an end screen thanks the player, shows lifetime stats, and offers "Play Again".
- "Play Again" wipes all progress (money, round, upgrades, stats) but keeps the player's name.

## Save data

Stored in the browser's localStorage under `fishy.save`:

```ts
{
  version: number,
  playerName: string,
  money: number,
  round: number,
  upgrades: Record<nodeId, level>,
  stats: { totalFish, fishByType, bestRoundEarnings, playTimeMs },
  finalRoundDone: boolean,
  createdAt: string,
  updatedAt: string,
}
```

- **First visit:** the player enters a name, which creates the save.
- **Autosave:** after every round and every purchase.
- **Export:** downloads the save as `fishy-<name>-<date>.json`.
- **Import:**
  1. The player picks a file and the game checks its shape.
  2. Saves from older versions are upgraded to the current format.
  3. Unknown upgrade ids are dropped and levels are capped at each node's max.
  4. The game asks before overwriting the current save.
- There is no tamper protection. Editing your own save only affects you.
- A save that can't be read is moved to `fishy.save.corrupt` instead of being deleted.
- If the browser refuses to store the save, the game says so once and suggests exporting.

## Screens

Name prompt and three how-to-play slides (first visit only; the hub's ? button reopens the slides) → hub (tech tree, money, Start Round, export/import) → round →
round summary → hub → … → Final Round → end screen.

## Sound

Cozy ocean lo-fi that sits behind the game. Everything is in D major pentatonic at 92 BPM, so
every note fits.

- **Music** is one continuous bed. The hub hears it under water (low-passed, quieter); a round
  opens it up on the next downbeat and adds a groove; a combo layer follows the combo multiplier;
  a short stinger ends each round. Three chapters (start, Electric fish, the Monster) change the
  bed in the hub so it doesn't wear thin over a whole game. The beds are CC0 loop files once
  chosen, and generated in code until then.
- **Sound effects** are generated in code and in key: catches climb the scale with the combo, and
  each ability (current, star, whirlpool, goober), time bonus and purchase has its own sound.
  Late rounds capture hundreds of fish a second, so effects are rate-limited and batched.
- **Controls**: M or a speaker button mutes; music and effects volumes are set in the hub. Sound
  settings are stored apart from the save.

How it is built and how to add the loop files: README, "Music and sound".

## Architecture

- Static site: Vite + TypeScript, Canvas 2D, no framework or game engine. No server.
- The simulation (`src/game/world.ts`) has no DOM access. It uses a seeded random number generator
  and a fixed 60 Hz step, so rounds can be replayed exactly in tests.
- Rendering (`src/game/render.ts`) reads the world and draws it; it never changes game state.
- Audio (`src/audio/`) works like rendering: it hears the world's events and the screen changes,
  and never changes game state. The simulation knows nothing about sound.
- Tests use vitest.

## Milestones

1. ~~Canvas loop, boat, Normal fish, net with auto-tick, capture, round timer, money, silhouette lens.~~
2. ~~Tech tree model and screen, name prompt, save, export and import.~~
3. ~~Fish types, one at a time.~~
4. ~~Star fish.~~
5. ~~Final Round and end screen.~~
6. Polish (sound, more effects), then a balance pass with real play.
