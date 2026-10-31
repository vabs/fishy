# Fishy: game design

Single-player browser game for desktop, phones and tablets. A round-based incremental game about catching fish: a boat
sits in the centre, fish swim around it, and the player guides a net that damages every
fish inside it on a timer. Money from each round buys upgrades in a tech tree, and bounties pay
extra for small challenges. Once the whole tree is maxed, the player plays a Final Round and the
game ends. Alongside the campaign, the Endless Sea is a sandbox with no clock, and achievements
mark milestones across both.

Exact numbers (HP, value, speeds, costs) live in code and get tuned during balancing. This document
describes mechanics.

## Core loop

1. A round starts with a time limit. Fish are already in the water and more keep spawning.
2. The net auto-ticks while active. Each tick damages every fish inside it.
3. A fish at 0 HP is captured. Its on-capture effect fires, if it has one.
4. When the timer reaches 0 the round ends. Fish still swimming are lost.
5. The value of every fish caught that round is banked as money, plus the reward for each bounty
   completed.
6. The player spends money in the tech tree, then starts the next round.

## Title screen

The game opens on a title screen over a painted golden-hour sea: the logo, a greeting ("Welcome
aboard" for a new player, "Welcome back" for a returning one) and four buttons.

- **Play** picks up the campaign: the hub, or straight into the next round while the tree has
  nothing to buy (a new game), or the end screen once the Final Round is done.
- **Endless Sea** starts an Endless trip. It's disabled, with "Play your first round to unlock"
  under it, until the save has played a round or has an Endless session on record, so it stays
  open after Play Again for anyone who has used it.
- **Achievements** opens the logbook of badges and shows the earned count ("7 / 22").
- **Settings** opens the same Settings drawer as the hub.

A first visit goes name prompt → three how-to-play slides → title screen. The hub's ⌂ button
returns to the title screen, as does Head home after an Endless trip.

## Input

With a mouse, the net follows the cursor and ticks automatically; mouse clicks do nothing. It
only ticks while the cursor is over the play area. On touch screens, holding and dragging guides
the net above the finger to keep fish visible; lifting the finger deactivates it. An extra finger
does not create another net.

The tech tree supports dragging to pan, mouse-wheel or two-finger pinch zoom, and tapping an
upgrade to inspect it before using Buy. Desktop upgrade details also offer a Buy button, and
segmented bars show current upgrade levels. Settings (how to play, sound, display, haptics and save
controls) opens from the hub and the title screen on every screen size; Start Round is centred in
the hub's top bar, with the bounty board below it. Portrait and landscape are both
supported, with controls kept clear of screen cutouts and the home indicator.

A round can be paused with the HUD pause button or Esc. Switching tabs/apps or rotating the device
also pauses it. Time and simulation stay frozen until Resume round; the HUD stays visible. Dialogs
scroll within the visible screen, including when the name-entry keyboard is open.

The HUD centres time remaining and the current round's earnings, with banked money and round number
to the side and the bounty checklist beneath them. In the Endless Sea the clock is replaced by fish
caught, time at sea and best combo, and earnings read "This trip". The last five seconds of a round
highlight and pulse; the pulse stops while paused and is disabled with reduced motion. The net's
look and the feedback around catches are described under Game feel; none of it changes the net's
hit area or timing.

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
- There is no limit on fish in a timed round: fish keep arriving whether or not the player catches
  any. The only per-type limit is the Monster, at most one at a time. The Endless Sea caps the
  total (see below).

## Feeding Frenzy

Every fifth round (5, 10, 15, …) and the Final Round have a Feeding Frenzy wave. The Endless Sea
has one every 90 s (see Endless Sea).

- It starts 35% of the way through the round's base length and lasts 5 s. Time bonuses don't move
  it.
- A front sweeps once across the sea, from a random side to the other, over the length of the wave.
  While it runs every unlocked type spawns 3× as fast, and every new fish pours in just behind the
  front, swimming the way the wave goes.
- Fish caught during the wave are worth 1.5×, on top of every other multiplier.
- Upgrades: Rising Tide (Time) makes the wave longer; Frenzy Feast (Economy) raises the bonus.

The signals never rely on colour alone. Before a frenzy round the hub's hint says so and Start Round
wears a Frenzy badge (compact screens hide the hint). In the round a "Feeding Frenzy!" banner hangs
under the HUD with the value bonus, the seconds left and a bar that empties; the sea takes a light
tint and a line of foam marks the front; a sting plays and the music lifts. The round summary adds
a line with the money and fish the wave brought in, which the per-type rows already include.

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
not in the row of their own type. Lifetime stats and catch bounties still count them as their own
type.

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

## Golden fish

A rare golden version of any fish type, worth 10× its normal value, that tries to get away.

- From round 2 on (never in round 1, while new players are still learning), golden fish arrive on
  their own clock, about one every 17 s of round time. They aren't a share of spawns, so late-game
  spawn volume doesn't flood the sea with them. The type is picked in proportion to spawn rates.
  Endless trips have them from the start.
- If a golden fish bounty is on the board and none has appeared by 35% of the round's base length,
  one is spawned then.
- A golden fish is a fresh spawn that swims alone: a golden Uncommon brings no school.
- Its catch pays 10× with the usual multipliers on top (type value, global value, ability bonus,
  combo). Its type's own effect still fires: a golden Electric releases its current, a golden
  Goober bursts (its burst fish aren't golden).
- It swims 1.5× as fast as its type. When the edge of the net comes within 80 px of it, it darts:
  faster still (2.7× its type), turning round if it was heading for the net and edging away from
  it.
- Left uncaught for 8 s, it dives and is gone, paying nothing.
- Inside the net it's drawn in gold with a sheen. Outside, it's a silhouette like every fish, but
  four-point glints keep popping around it, so it can be spotted anywhere by shape and motion,
  not by colour alone.
- The round summary gives golden catches their own "Golden fish" row, apart from their type's row.
- Sounds: a shimmer when one appears, a bright chime when it's caught, a soft plop if it escapes.

Upgrades (Economy): Gold Rush (more golden fish), Lingering Gold (longer before they dive).

## Treasure chests

- From round 3 on, a round has a 30% chance of one treasure chest; the Final Round always has one,
  and so does a round whose bounty board asks for one.
- It appears between 20% and 60% of the way through the round (20% to 40% when a bounty asks for
  it), floats in from one screen edge and drifts across to the opposite edge at about 45 px/s on a
  path well clear of the boat, bobbing gently. If it reaches the far edge unopened, it's gone.
- It floats at the surface, so it's always drawn in full colour, never as a silhouette: a wooden
  chest with gold bands, a domed lid and a lock, a shape that reads without colour.
- Only the net opens it. It has 10 HP; net damage and crits apply. It shows an HP bar while the net
  reaches it and flashes when hit. Abilities (Electric, Epic, Star, Whirlpool) never touch it.
- Opening it pays 20 × the value of the most valuable unlocked fish type, with that type's value
  upgrades and the global value multiplier (no combo, no ability bonus), plus one extra at random:
  3 s more round time, or 3 golden fish spilling out. In the Endless Sea, with no clock, it's always
  the golden fish. Coins burst out under a big "+$" floater, with a creak and a jingle.
- The round summary has a "Treasure" row: chests opened and their money.

Upgrades (Economy): Treasure Map (+15 percentage points of chest chance per level, up to 100%).

Golden fish and chests draw their random numbers from a stream of their own, seeded from the
round's, and round 1 draws none, so they never shift the rest of a round's randomness.

## Bounties

Optional challenges for the next timed round, posted in the hub before it starts
(`src/game/bounties.ts`).

- From round 2 (`BOUNTIES_FROM_ROUND`): two per round, three from round 8. None in round 1, the
  Final Round or the Endless Sea.
- Every target comes from the round's stats after upgrades, so each bounty can be done in one round:

  | Kind | Label | Target | Offered |
  | --- | --- | --- | --- |
  | catch | Catch 20 Rare fish | 35–60% of the type's expected catches (spawn rate × round length, plus its share of the starting fish) | Each unlocked type |
  | combo | Reach combo ×1.5 | ×1.2 up to the current combo cap, in steps of 0.1; before round 8 the low end is likelier | Once Combo is bought |
  | haul | Net 8 fish in one sweep | 4 up to a ceiling of 4–12 that grows with net size and fish density | Always |
  | earn | Earn $31,162 | 110–130% of recent earnings | Once there are recent earnings |
  | golden | Catch a golden fish | 1 | From round 2 |
  | chest | Open the treasure chest | 1 | From round 3 |
  | frenzy | Catch 40 fish in the Feeding Frenzy | 35–55% of the fish the wave is expected to bring in | Frenzy rounds |

- Kinds are drawn at random from those on offer. A board can hold two catch bounties for different
  fish; every other kind appears at most once.
- Reward: recent earnings (last round's, or the best round's when there's no last round on record;
  at least $20) × a share for the bounty's difficulty, rounded to two significant figures. Shares run
  from 15% for an easy catch target to 30% for a chest or a high earnings target. Rewards are paid
  only for completed bounties, on top of the round's earnings, and never count towards the
  best-round record or the next round's estimate.
- Determinism: the board's random numbers come from a seed hashed from the save's creation time and
  the round number, and nothing else. The board is stored in the save, so reloading and buying
  upgrades keep it. The one exception: a purchase that completes the tree clears it, since the
  Final Round has no bounties.
- Guarantees: before the round starts, the board tells the simulation what it needs. A chest
  bounty skips the chest chance roll and brings the chest in between 20% and 40% of the base round
  length; a golden fish bounty spawns a golden fish at 35% of it if none has appeared.
- Progress is read from the round's totals: catches per type (golden fish and Goober burst fish
  count as their own type), the highest combo multiplier, golden fish caught, chests opened, the
  best net sweep, earnings and fish caught during the wave.
- They show in three places. The hub lists each label and reward under the top bar. The HUD shows a
  checklist of up to three with live progress; completing one plays its sound, gives the sea a small
  shake, buzzes where haptics are on, and flashes the checklist. The summary ticks each one off with
  its reward (or crosses it out with "Not earned"), adds a "Bounties +$…" line, and includes the
  money in the headline figure.

## Round records

Every round and Endless trip keeps three records, which feed bounties, achievements and the save:

- **Best combo:** the highest combo multiplier reached (1 with no combo).
- **Best sweep (net haul):** the most fish a single net tick captured.
- **Star hits:** the most damaging hits a single Star shot landed over its flight, counting repeat
  hits on the same fish after its cooldown.

The save keeps the best of each across every round and trip.

## Endless Sea

A sandbox for enjoying the build so far without the clock (`RoundOptions.endless`). It uses the
player's current upgrades and the same simulation as a round.

- No clock: time left is infinite and the trip runs until the player ends it. Time bonuses do
  nothing and show nothing.
- Fish spawn as usual, but at most 80 swim at once (`ENDLESS.maxFish`, about 1.3× the busiest
  moment of a fully upgraded timed round). Spawns over the cap are dropped, school members and
  burst fish included. Golden fish (chest spills too) and Frenzy pour-ins get 40 fish of surge room
  above the cap (`ENDLESS.surgeRoom`), so a sea that has filled up still gets its surprises.
- Feeding Frenzy waves recur: the first starts 45 s in (`ENDLESS.firstFrenzy`), then one every 90 s
  from start to start (`ENDLESS.frenzyEvery`). Each lasts the normal wave length and sweeps the
  opposite way to the one before. Wave times are worked out from the first start and a wave
  number, never by adding to a running timer, so they stay on their fixed steps however long a trip
  lasts.
- Treasure chests recur: the first arrives 60–100 s in, and each arrival sets the next one 60–100 s
  later (`ENDLESS.chestGap`). If a chest is still floating when the next is due, the next waits
  until it's gone. Opened chests always spill golden fish.
- Golden fish swim from the start of a trip.
- No bounties, so no guarantees.
- Day and night: the sea's light turns every 4 minutes of trip time, from golden hour through dusk
  (1 min), night (2 min) and dawn (3 min). The tint covers only the water. At night the caustics
  give way to a few moonlight glints, the net's lens is lit a little brighter so fish inside stay
  readable, and a lantern glows around the boat. It has no effect on play.
- Pausing works as in a round. The pause panel adds End trip, the only way to end a trip.
- The logbook that follows shows the trip's earnings, fish, time at sea and best combo, notes that
  Endless catches don't go to the bank, and marks each new personal record (best session earnings,
  most fish caught, longest trip, best combo; only strict improvements count). Keep fishing starts
  another trip; Head home goes to the title screen.
- A trip never changes money, round, upgrades or the round earnings records. It adds its fish,
  golden fish, chests, time and round records to the lifetime stats (so it counts towards
  achievements), and updates the Endless records: sessions, total fish, total time, best earnings,
  most fish, longest trip and best combo. Play Again keeps the Endless records.

## Achievements

22 badges (`src/game/achievements.ts`). Each has a permanent id, a name, a one-line description and
an icon: a fish sprite, or a glyph (net, star, coin, chest, gold, wave, scroll, anchor, clock,
crown, combo) drawn inside a brass medallion.

| Group | Badges |
| --- | --- |
| First catch of each type | Hooked (Normal), School's In (Uncommon), Armour Piercer (Rare), Shocking (Electric), Epic Haul (Epic), Goober Pop (Goober), Eye of the Storm (Monster), Shooting Star (Star) |
| Lifetime fish | Deckhand (1,000), Bosun (10,000), Old Salt (50,000) |
| Combo | On a Roll (×1.5); Unstoppable (the combo cap of the current upgrades: ×2, up to ×4 with every Combo Cap level) |
| Round records | Full Net (10 fish in one sweep), Star Struck (10 hits from one Star shot) |
| Bonuses | Gold Fever (50 golden fish), Treasure Hunter (10 chests) |
| Bounties | Clean Sweep (every bounty in a round), Bounty Hunter (25 bounties) |
| Campaign | Master of the Sea (finish the Final Round) |
| Endless | Lost at Sea (10 minutes in one trip), Sea Legs (30 minutes in one trip) |

- Achievements are worked out from the save, not from events: `newAchievements(save)` lists every
  badge the save qualifies for but hasn't been granted, and `grantAchievements` stamps each with
  the time earned. Two live facts can also be passed in, for a check made before the save is
  written: whether every bounty this round was completed, and how long the current trip has lasted.
- The game checks at the end of every round and Endless trip, and once a minute during a trip so
  Lost at Sea and Sea Legs unlock the moment they're reached. Each new badge gets a toast ("Achievement
  unlocked" and its name over the medallion) for 3 s, one after another, and a short brass
  fanfare.
- It also checks quietly when a save loads or is imported, with a single "N achievements
  unlocked" toast. That way a save from before achievements gets the ones it already qualifies for:
  first catches, lifetime fish and Master of the Sea (older saves carry no combo, golden fish,
  chest, bounty or Endless stats).
- Endless trips count towards every badge except the two bounty badges and Master of the Sea.
- Badges are kept by Play Again. They're stored as id → ISO time; unknown ids are kept, so a save
  from a newer version doesn't lose them. Ids are permanent, including `combo-2` and `combo-3`,
  whose numbers aren't their thresholds.
- The logbook shows all 22: earned ones on a gold medallion with the date, locked ones on a
  tarnished one with the description, a padlock and "Locked". The title screen, the hub and the
  logbook show the earned count.

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

## Game feel

Feedback that makes catching satisfying. It all lives in the renderer and the page; none of it
changes the simulation, the net's hit area or its timing.

- **Water:** a painted, low-contrast sea tile, warm light from the upper left cooling towards the
  lower right, and two slow layers of caustic light.
- **Net:** a rope rim with floats and a fine mesh. A brass inlay runs round the rope as the next
  tick charges. The inner weave cinches on a tick that hits, and caught fish are briefly pulled
  inward. Outside the rim, a combo arc shows the multiplier as a share of the cap and drains as the
  combo window runs out, with the multiplier written under the net.
- **Catches:** a foam ripple (0.5 s) and a few sparks per catch, and a "+$12" floater that merges
  with nearby ones; a catch worth 10× the round's average gets a bigger floater. Each catch sends a
  coin flying to the HUD's earnings, which bump as coins land.
- **Shake:** the sea (never the HUD) shakes briefly, at most 6 px, on 8 or more catches in one
  frame, a Star launch, a Whirlpool implosion, a chest opening and a completed bounty.
- **Summary:** the headline figure counts up from $0 over 0.8 s.
- **Haptics:** where the browser can vibrate, a 15 ms buzz for 8 or more catches in a frame, a Star
  launch or an implosion, 20 ms for a completed bounty and 30 ms for a chest. A Haptics switch under
  Settings → Display turns them off. It's on by default, shown only where vibration works, and
  stored with the display settings.
- **Reduced motion** turns off the shake, flying coins and the earnings bump, ripples, sparks, the
  catch pull and net cinch, the extra effects of abilities, golden fish and chests, the checklist
  flash and the count-up, and holds the water's light still.

## Tech tree

### Model

- All nodes are defined in one TypeScript config file. Each node has an id, branch, prerequisites,
  max level, a cost curve (`base * growth^level`) and an effect on the game's stats.
- Each level's dollar price is rounded up to a multiple of 10. A $2 price becomes $10; a $34
  price becomes $40; prices already divisible by 10 stay unchanged.
- At the start of each round the game computes `stats = applyUpgrades(baseStats, ownedLevels)`.
  The simulation only reads `stats`, so adding an upgrade means adding a config entry.
- Shown as a radial graph centred on the boat, drawn on a parchment sea chart with brass medallions
  for nodes. A node's neighbours appear once it is bought.
- Each fish's unlock gates the rest of its nodes. Fish unlock in order: Uncommon → Rare →
  Electric → Epic → Goober → Monster → Star.
- Pacing target: finishing the tree takes roughly 1–1.5 hours. `src/game/tech/pacing.test.ts`
  checks it by playing a whole game with a bot, which finishes in about 70 minutes. Golden fish,
  chests and Feeding Frenzy waves are part of that; to make room for them, upgrades over $2,000
  cost more the pricier they are (×1.2 at $10k, ×1.6 at $100k, ×1.9 at $500k).

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
- Feeding Frenzy wave length

**Economy**
- Fish value (all fish)
- Combo: captures in quick succession stack a value multiplier
- Combo window and combo cap
- Value of fish caught in a Feeding Frenzy
- Golden fish: how often they appear, how long they stay
- Treasure chest chance

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

Only Normal fish spawn. The only visible node is the root in the centre, Bigger Net ($10,
affordable after round 1). Buying it opens the rest of the Net branch and the Normal fish branch;
Time, Economy and Spawning open from those. Until the first upgrade is affordable there is nothing
to choose, so the game skips the hub and goes straight to the next round.

## Final round and end screen

- When every node in the tech tree is at max level, the "Start Round" button becomes "Final Round".
- The Final Round plays like any other round, with a "Final Round" label. It has no bounties.
- Afterwards an end screen over the harbour thanks the player, shows lifetime stats (rounds played,
  fish caught, best round, time at sea; Endless trips count towards fish and time), and offers
  "Play Again".
- "Play Again" wipes the campaign (money, round, upgrades, stats, bounty board) but keeps the
  player's name, achievements and Endless records.

## Save data

Stored in the browser's localStorage under `fishy.save`, at version 2:

```ts
{
  version: 2,
  playerName: string,
  money: number,
  round: number,                    // the next round to play
  upgrades: Record<nodeId, level>,
  stats: {
    totalFish, fishByType, bestRoundEarnings, playTimeMs,
    lastRoundEarnings,              // bounty rewards scale from it
    goldenCaught, chestsOpened,
    bestCombo, bestTickCatches, bestStarHits,   // best round records
    bountiesCompleted, perfectBountyRounds,
  },
  endless: { sessions, totalFish, timeMs, bestEarnings, bestFish, longestMs, bestCombo },
  achievements: Record<achievementId, isoTime>,
  bounties: { round, list: Bounty[] } | null,   // the next round's board
  finalRoundDone: boolean,
  createdAt: string,
  updatedAt: string,
}
```

- **First visit:** the player enters a name, which creates the save.
- **Autosave:** after every round, Endless trip and purchase, and whenever a board is rolled or an
  achievement granted.
- **A round** banks its earnings plus bounty rewards, moves to the next round and clears the board.
  The best-round and last-round records use the earnings without bounty money.
- **An Endless trip** adds to lifetime stats and the Endless records only; money, round, upgrades and
  the round earnings records stay as they were.
- **Play Again** starts a fresh save with the same name, achievements and Endless records.
- **Export:** downloads the save as `fishy-<name>-<date>.json`.
- **Import:**
  1. The player picks a file and the game checks its shape.
  2. Saves from older versions are upgraded to the current format.
  3. Unknown upgrade ids are dropped and levels are capped at each node's max.
  4. The game asks before overwriting the current save.
- **Version 1 → 2:** stored and imported version 1 saves gain the new stats at zero, empty Endless
  records, no achievements and no board, then receive the achievements they already qualify for.
- There is no tamper protection. Editing your own save only affects you.
- A save that can't be read is moved to `fishy.save.corrupt` instead of being deleted.
- If the browser refuses to store the save, the game says so once and suggests exporting.

## Screens

Name prompt and three how-to-play slides (first visit only; Settings → How to play reopens the
slides) → title screen.

- **Play:** hub (tech tree, bounty board, money, Start Round, Settings) → round → round summary →
  hub → … → Final Round → end screen → Play Again → round 1.
- **Endless Sea:** Endless trip → pause → End trip → Endless logbook → another trip, or
  back to the title screen.
- **Achievements** and **Settings** open over the title screen, and from the hub, whose ⌂ button
  returns to the title screen.

## Art direction

Cozy nautical: golden-hour light on a teal sea, a small wooden fishing boat in the middle, and an
interface made of warm wood, rope, brass, aged paper and sea-chart ink.

- Colours are CSS custom properties on `:root` in `src/style.css`: deep, mid and light sea
  (`--sea-deep`, `--sea`, `--sea-light`), sunset oranges for buttons and money (`--sunset`,
  `--sunset-deep`), `--brass` for trims and badges, `--wood` and `--wood-dark` for bars and
  outlines, `--paper` for logbook panels, `--ink` and `--ink-dark` for text, `--foam` for foam and
  the net.
- Type: Lilita One for titles, big numbers and buttons; Nunito (600, 700, 800) for everything else.
  Both are self-hosted through `@fontsource/lilita-one` and `@fontsource/nunito`.
- Painted assets live in `public/art/` with credits in `public/art/CREDITS.md`: the logo, the title
  backdrop, the sea tile and boat for play, the parchment chart and compass rose for the tech tree,
  wood, paper and rope textures, brass badge medallions (and a tarnished one for locked badges), the
  harbour for the end screen, the app icon and the favicon.
- The title screen sits over a slowly drifting painted sea; the hub is a wooden bar above the chart;
  summaries, the Endless logbook, achievements and dialogs are parchment panels headed like a
  captain's log; the end screen is the harbour at sunset.
- The renderer uses the painted sea and boat once they've loaded (`src/game/art.ts`) and its own
  drawings until then, so a slow or failed download never blocks play. Fish stay drawn in code so
  silhouettes and the colour-blind palette keep working.

## Sound

Cozy and nautical, with a pulse in the rounds. Everything is in D major pentatonic at 124 BPM, so
every note fits.

- **Music** is one continuous bed whose mix follows the screen:
  - The title screen hears it calm and a little muffled. The hub, the round summary and the pause
    panel hear it under water (low-passed, quieter) with a sparser melody.
  - A timed round opens it up on the next downbeat with a driving groove (four-on-the-floor kick,
    backbeat claps, off-beat hats, shaker, syncopated bass) and a busier melody; a combo layer
    follows the combo multiplier.
  - The last five seconds add an accented hat roll and a rising swell. Endless trips never hear it.
  - A Feeding Frenzy wave adds a bright octave lead and a tambourine, and lifts the combo layer.
  - The Final Round has everything open. A short stinger ends each round and each Endless trip,
    with a longer climb after the Final Round.
  - Endless trips get a restrained mix for long listening: no claps, no countdown, a little quieter,
    and a melody whose density changes every 16 bars instead of building up.
  - Three chapters (start, Electric fish, the Monster) change the bed in the hub so it doesn't wear
    thin over a whole game; their generated melodies use a steel drum, a kalimba and a marimba. The
    beds are CC0 loop files once chosen, and generated in code until then.
- **Sound effects** are generated in code and in key: catches climb the scale with the combo, and
  each ability (current, star, whirlpool, goober), time bonus, Feeding Frenzy wave, golden fish,
  chest and purchase has its own sound. A completed bounty plays three bright notes and a bell; an
  achievement plays five soft brass notes and a shimmer.
  Late rounds capture hundreds of fish a second, so effects are rate-limited and batched.
- **Controls**: M or a speaker button mutes; music and effects volumes are under Settings. Sound
  settings are stored apart from the save.

How it is built and how to add the loop files: README, "Music and sound".

## Accessibility

- **Colour-blind palette.** A switch under Settings → Display redraws the fish, their effects, the
  round summary icons, the achievement badges, the tech tree's fish lanes and the how-to-play
  slides in colours that stay apart under protanopia, deuteranopia and tritanopia. Every type keeps
  its outline, so colour becomes a reliable second cue rather than the only one. With the switch
  off the game looks exactly as before. Like the sound settings, the choice is stored apart from
  the save (`fishy.display`, with the haptics setting), so Play Again and import leave it alone.
- `src/game/palette.test.ts` simulates the three kinds of colour blindness and checks every pair of
  fish colours stays clearly apart (CIEDE2000 of at least 15), and clear of the water.
- Other colour cues never rely on hue alone: an affordable upgrade has a filled price tag and a
  glowing ring, money pop-ups read "+$12" where bonus time reads "+3s", health bars are read by
  length, bounty results carry a tick or a cross and "Not earned", and locked badges are tarnished
  with a padlock and "Locked".
- **Reduced motion** keeps the how-to-play slides and the title backdrop still and turns off the
  timer pulse and the effects listed under Game feel. Achievement toasts fade in place instead of
  sliding.
- **Haptics** can be turned off under Settings → Display.
- A new fish type needs a colour-blind entry beside its standard colours (`src/game/palette.ts`).

## Architecture

- Static site: Vite + TypeScript, Canvas 2D, no framework or game engine. No server.
- The simulation (`src/game/world.ts`) has no DOM access. It uses a seeded random number generator
  and a fixed 60 Hz step, so rounds can be replayed exactly in tests. Endless trips run the same
  simulation; bounties reach it only as the round's `guarantee` option.
- Bounties (`src/game/bounties.ts`) and achievements (`src/game/achievements.ts`) are pure and
  tested. Small helpers in `src/app/` keep the bounty board stable, work out payouts and Endless
  records for `src/main.ts`, and are tested too.
- Rendering (`src/game/render.ts`) reads the world and draws it; it never changes game state.
  Fish art and effects draw with the colours the renderer hands them from the active palette
  (`src/game/palette.ts`), so the simulation never depends on the player's palette.
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
