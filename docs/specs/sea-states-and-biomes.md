# Sea States and Endless Biomes

Two features that add variety without new controls. **Sea States** change the weather for a whole
round (timed and endless). **Biomes** change the sea itself as an Endless trip goes on. A third
feature, the Leviathan boss, comes later and isn't covered here. Section 3 fixes the round
summary's right column, which these features add rows to.

Design rule for both: every change is readable at a glance, announced before or as it happens, and
countered by something the player can buy. Nothing here is a pure penalty.

---

## 1. Sea States

### 1.1 Summary

| State | What changes | Counter | Payout |
|---|---|---|---|
| Clear | Nothing (default) | — | ×1 |
| Storm | Wind pushes every fish downwind in gusts | Chum, Bait, trap nets downwind | ×1.2 |
| Fog | Far silhouettes fade; only the area near the boat and your net stays clear | Lantern Lure (pushes the fog back) | ×1.15 |
| Algal Bloom | More fish, slower and tougher | Net damage, Strong Mesh, Electric chains | ×1 (more fish) |

### 1.2 When they happen (timed rounds)

- None before round **6** (`SEA.fromRound = 6`), in a Feeding Frenzy round (every 5th), or in the Final
  Round. Those rounds stay as they are.
- Other rounds: **35 %** chance of a non-clear state (`SEA.chance = 0.35`), equal weights between Storm,
  Fog and Algal Bloom, and never the same non-clear state two rounds in a row.
- The state is a **pure function of the save and the round**:
  `seaStateFor(createdAt: string, round: number): SeaState`, seeded like the bounty board (FNV hash of
  `createdAt:round`). It looks back at round − 1 through the same function to avoid repeats. No save
  field is needed, a reload never rerolls, and buying upgrades never changes it.
- The World receives it through `RoundOptions.sea` (default `"clear"`). The World never rolls it in a
  timed round, so seeds of clear rounds replay exactly as today.

### 1.3 When they happen (Endless)

- Weather rotates on its own clock: every `SEA.endlessEvery = 150` s, a **50 %** chance that a state
  starts and lasts `SEA.endlessLength = 60` s, never overlapping a frenzy wave (a roll that would
  overlap waits until the wave ends). It is never the same state twice in a row.
- The World draws these from a **separate stream that only exists in Endless**, so existing endless
  tests keep their chest and frenzy timings.

### 1.4 The states in detail

**Storm**
- Each storm picks a wind direction (any angle) from its seed.
- Wind speed is `22 px/s` base, with gusts to `45 px/s` on a smooth ~6 s cycle.
- Wind is applied through fish **offsets** (`offsetX/offsetY`), like chum, bait and the Monster pull,
  never by writing `x/y` (those are recomputed from the orbit every step).
- A spring pulls offsets back toward the orbit at `0.6 /s`, so the school settles about 35–75 px
  downwind and sways with the gusts instead of piling onto the edge. Offsets stay inside the swim area.
- Golden fish drift too. The chest keeps its own path.
- Synergy: trap nets on the downwind side get more traffic, and chum (60 px/s pull) beats the wind
  near the boat.
- Every catch pays **×1.2** while the storm blows ("Rough-weather bonus").

**Fog**
- Visibility is a pure helper in `sea.ts` that the renderer uses:
  `fogAlpha(d) = max(0.15, 1 − (d − clear) / 160)`, where `d` is the fish's distance to the nearer of
  the boat or the net centre.
  `clear = max(90 + lanternRadius, netRadius × 2.5)`.
- Silhouettes are drawn at that alpha. Every silhouette also keeps a thin outline, so nothing is fully
  invisible.
- **Inside the net nothing changes**: full colour and health bars as always.
- Golden fish glints and the chest show through the fog at full strength, so surprises stay findable.
- The Lantern Lure becomes valuable: each level pushes the clear area out by 70 px.
- Every catch pays **×1.15**.

**Algal Bloom**
- Fish spawn **×1.25**, swim **×0.75** speed and have **×1.5 HP**. One identity: a crowded,
  sluggish, tougher sea.
- Net damage upgrades, Strong Mesh (trap nets) and Electric chains are the counters.
- Ability captures behave as usual.
- No payout bonus: the extra fish compensate. The pacing check below confirms it.

### 1.5 Announcements and UI

- **Hub:** the Start Round button gets a weather badge (like the existing FRENZY badge) and the hint
  line says e.g. "Storm this round: fish drift with the wind." Phone layout keeps the short form.
- **Round start:** a banner hangs under the HUD for ~3 s (same style as the frenzy banner):
  "Storm · catches ×1.2", "Fog · catches ×1.15", "Algal Bloom · more fish, tougher".
- **Endless:** the same banner appears when a state starts, and a small line under the Endless HUD
  shows the current weather and its seconds left.
- **Summary:** a line "Storm: +$X from the rough-weather bonus" (Fog likewise), or "Algal Bloom".
- **Bounties:** no "earn" bounty in an Algal Bloom round, because the target is based on the last
  round. Everything else is unchanged.

### 1.6 Look and sound

- **Storm:**
  - Visual: diagonal rain streaks from two cached layers moving with the wind; ripple marks aligned
    with the wind; a cooler blue-grey tint; an occasional soft lightning flash, at most every 8 s and
    never full white.
  - Sound: a wind noise bed that follows the gust cycle, and a distant thunder rumble with each flash.
  - Reduced motion: static rain tint, no flashes.
- **Fog:**
  - Visual: two slow drifting fog layers (cached noise canvases); a pale grey-teal tint; the lantern
    and the net cut clear pools through it.
  - Sound: music low-pass about 20 % lower, and a soft foghorn at the start.
  - Reduced motion: static fog.
- **Algal Bloom:**
  - Visual: a green-teal tint; slow floating algae patches (cached blobs); small bubbles.
  - Sound: a soft bubbly texture.
- **All states:**
  - Silhouette readability must hold in the colour-blind palette and on phones.
  - A pure test checks that the average sea luminance under each tint stays at least a set contrast
    away from the silhouette colour.

### 1.7 API

```ts
// src/game/sea.ts (new, pure)
export type SeaState = "clear" | "storm" | "fog" | "bloom";
export const SEA: { fromRound: 6; chance: 0.35; endlessEvery: 150; endlessLength: 60;
  stormBase: 22; stormGust: 45; stormSpring: 0.6; stormValue: 1.2; fogValue: 1.15;
  bloomSpawn: 1.25; bloomSpeed: 0.75; bloomHp: 1.5 };
export function seaStateFor(createdAt: string, round: number, final: boolean): SeaState;
export function fogAlpha(distance: number, clearRadius: number): number;
export function fogClearRadius(stats: Stats): number;

// src/game/world.ts
interface RoundOptions { /* … */ sea?: SeaState }
class World {
  get sea(): SeaState;                 // current state (endless: changes over time)
  get seaLeft(): number;               // endless: seconds left; timed: Infinity
  get wind(): { x: number; y: number } // px/s, zero unless storm
  seaEarned: number;                   // money from the storm/fog bonus this round
}
// New WorldEvent: { type: "sea"; phase: "start" | "end"; state: SeaState }
```

### 1.8 Balance and tests

- **Pacing:** the pacing bot plays sea states using `seaStateFor`. The full campaign may change by at
  most **±3 %**; tune the Storm and Fog bonuses and the Bloom multipliers until it does.
- **Unit tests:**
  - `seaStateFor`: deterministic, follows the round rules, no repeats.
  - Storm drift moves fish through offsets, stays in bounds and settles at the spring equilibrium.
  - Fog alpha and clear radius, including the effect of the lantern.
  - Bloom spawn, speed and HP.
  - Payout multipliers and `seaEarned`.
  - Endless rotation timing, the frenzy-overlap rule and the separate stream.
  - Clear timed rounds replay exactly against hard-coded values from main.
- **E2E:** a save at round 7 with a forced state (DEV `?sea=storm`) shows the badge in the hub, the
  banner in the round and the line in the summary, and the endless weather line appears.

---

## 2. Endless Biomes

### 2.1 Summary

An Endless trip sails through three biomes in a loop, **5 minutes each** (`BIOME.length = 300`).
The biome is a pure function of the trip's elapsed time, with no randomness.

| Biome | Look | Fish and events (only for unlocked kinds) | Music chapter |
|---|---|---|---|
| Shallow Reef (0–5 min) | today's painted teal sea | Normal and Uncommon ×1.2 | Shallows |
| Abyssal Trench (5–10 min) | deep indigo sea with faint glowing specks | Rare ×2, Electric ×1.5, golden fish ×1.5 | Deep |
| Sunken Graveyard (10–15 min) | murky green-teal sea with faint shipwreck timbers | chests every 20–33 s (gap ÷3), Goober and Monster ×1.5 | Currents |

After the Graveyard, the trip returns to the Reef.

### 2.2 One lighting model

- The day/night cycle (4 min), the biome (5 min) and the sea state all feed one pure function in
  `render.ts`, replacing `seaTint`'s single input:
  `seaLight({ biome, timeOfDay, sea }) → { tint, alpha, night, lantern }`.
  Each layer stays as it is; the function combines them.
- **Readability cap:** combined darkness never goes past a limit. Abyssal Trench at night uses a
  moonlit blue, never near-black. The same luminance test as the sea states covers every
  biome × time-of-day × sea-state combination.

### 2.3 Transitions

- An **8 s crossfade** of the sea texture and lighting at each boundary.
- A banner under the HUD: "Entering the Abyssal Trench".
- The music crossfades to the biome's chapter (the existing three chapters, through the existing bar-line
  crossfade).
- In Endless, the music chapter follows the biome instead of upgrades. `audio.screen` gets
  `biome?: Biome`.
- Spawn multipliers change at the moment of the boundary. Fish already swimming stay.

### 2.4 Art (codex image generation)

- `public/art/sea-trench.webp` and `public/art/sea-graveyard.webp`: 1024×1024, seamless, painterly,
  in the same style and from the same top-down view as `sea-tile.webp`. They must stay **low contrast**:
  no dark patches, no hotspots, nothing that reads as a fish. The trench is deep indigo-blue with
  sparse soft bioluminescent specks. The graveyard is murky green-teal with very faint sunken timbers
  and ribs.
- Each must pass the same check as the current tile: a 2×2 tiling preview, plus a mock with navy
  silhouettes and the white net.
- The Shallow Reef keeps `sea-tile.webp`.

### 2.5 HUD, records and achievements

- **HUD:** the Endless HUD shows the biome name under "Endless Sea" and the time until the next one.
- **Logbook:** the end-of-trip logbook lists the biomes visited.
- **New achievements:** checked through the end-of-trip moment, so no new cumulative save fields are
  needed.

  | id | name | condition |
  |---|---|---|
  | `biome-trench` | Into the Deep | Reach the Abyssal Trench in one trip |
  | `biome-graveyard` | Grave Robber | Open 5 chests in the Sunken Graveyard in one trip |

  These go through `AchievementMoment`: `{ biomesReached, graveyardChests }`, with ids that are never
  renamed. The "Lost at Sea" and "Sea Legs" checks while a trip is running stay as they are.

### 2.6 API

```ts
// src/game/biome.ts (new, pure)
export type Biome = "reef" | "trench" | "graveyard";
export const BIOME: { length: 300; crossfade: 8; order: readonly Biome[] };
export function biomeAt(elapsed: number): { biome: Biome; next: Biome; progress: number; blend: number };
export function biomeSpawnMult(biome: Biome, kind: FishKind): number;
export function biomeGoldenMult(biome: Biome): number;
export function biomeChestGapMult(biome: Biome): number;

// src/game/world.ts (endless only)
class World {
  get biome(): ReturnType<typeof biomeAt> | undefined;   // undefined in timed rounds
  graveyardChests: number;
  biomesReached: Set<Biome>;
}
// New WorldEvent: { type: "biome"; biome: Biome }
```

### 2.7 Tests

- `biomeAt`: boundaries, the loop and the crossfade blend.
- Spawn, golden and chest multipliers apply only in Endless and only to unlocked kinds.
- The chest gap shrinks in the Graveyard.
- Biome events fire once per boundary.
- `seaLight` stays within the readability cap for every combination.
- The new achievements are granted from the moment.
- E2E: DEV `?endlessTime=` jumps a trip forward to check each biome's look, banner and HUD label.

---

## 3. Round summary ("scorecard") right column fix

Problem (seen at round 50 on a large desktop): the right column of the summary logbook is broken.
- The first bonus chip ("Feeding Frenzy: …") is clipped at the top, because `.panel .summary-frenzy`
  has `margin: -6px auto 18px` inside the scrolling `.summary-body`.
- The bonus chips are centred while the bounty list is left-aligned.
- The column's text is 10–12 px next to the ~18 px table, and bounty labels wrap awkwardly.
- The sea-state line from this plan will need a place in the same column.

Fix:
- Replace the chips with one left-aligned **bonus ledger** in the right column, titled
  "Bonuses this round".
  - Each row has an icon, a label, an optional detail and an amount, in a grid that matches the
    table's rhythm (14–15 px text, tabular numbers, amounts right-aligned).
  - Rows, in order, each shown only when relevant: Feeding Frenzy (+$ · N fish), Trap nets (N fish),
    sea state ("Storm bonus" +$, "Fog bonus" +$, or "Algal Bloom"), and Bounties (total +$).
- Below it, **Bounty rewards** uses the same row grid: tick or cross, then the label (it may wrap to
  two lines, aligned under itself), then the amount. Failed bounties are muted and show
  "$X · not earned".
- Nothing is ever clipped: no negative margins at the top of the scroll area, and the column scrolls
  with the body.
- The rows render through a small DOM helper, `renderSummaryExtras(container, rows)` in
  `src/ui/summary-extras.ts`, so the wiring agent can add the sea-state row without touching the CSS.
- Layout:
  - **Two columns at ≥ 1000 px.** At 1280×800, a round with 10 fish rows, 3 extras and 3 bounties fits
    without hiding Continue (the sticky footer stays).
  - **Below 1000 px, one column:** the ledger and bounties follow the table, with no horizontal
    overflow at 320 px.
- Dev gallery: a `#summary-full` scene that has all of these at once, including one failed bounty and
  a sea-state row.

---

## 4. Build plan (codex agents, separate branches, `--no-ff` merges)

| Wave | Agent | Files it owns |
|---|---|---|
| 0 | orchestrator | this spec → shared contract; `SeaState`/`Biome` types stubbed on main |
| 1 | SEA-SIM | `sea.ts`, world sea integration, endless weather rotation, tests |
| 1 | ART | `sea-trench.webp`, `sea-graveyard.webp` |
| 1 | SCORECARD | summary markup + CSS, `src/ui/summary-extras.ts`, `endRound` summary-filling lines in `main.ts`, dev gallery scene |
| 1 | BIOME-SIM | `biome.ts`, world biome integration, achievements, tests (after SEA-SIM if both touch `world.ts`) |
| 2 | RENDER+AUDIO | rain/wind/lightning, fog layers, bloom, `seaLight`, texture crossfade, weather sounds, dev page `?sea=` / `?biome=` |
| 2 | WIRING | hub badge and hint, banners, summary lines, Endless HUD lines, bounty rule, music chapter per biome, pacing retune, e2e, README and design doc |

The orchestrator checks screenshots of every state and biome by day, dusk and night, on phone and
desktop and in the colour-blind palette, runs every browser suite, and asks before pushing.
