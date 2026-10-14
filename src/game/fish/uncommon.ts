import { range } from "../rng";
import type { Fish, World } from "../world";
import type { FishDef, FishSpec } from "./types";

const TAU = Math.PI * 2;

/** Gap between fish along the path, as a fraction of body length. */
const SPACING_ALONG = 0.85;
/** Gap between the school's two lanes, as a fraction of body length. */
const SPACING_LANE = 1.05;
/** Random nudge on each slot, px, so a school doesn't look like a grid. */
const SLOT_JITTER = 2.5;
/** Wobble phase lag per member, radians, so the school ripples instead of moving as one block. */
const PHASE_STEP = 0.45;
/** How quickly a member closes the gap to its slot, 1/s. Holds formation without snapping. */
const FOLLOW_RATE = 10;

/**
 * Set while a school's members are being spawned, so they don't start schools of their own.
 * A counter rather than a boolean in case spawns ever nest.
 */
let formingSchool = 0;
/** `world.totalCaught` when the current step began. See isByProduct. */
const caughtAtStepStart = new WeakMap<World, number>();
/** First live fish of each school this step, by school id. Members hold formation around it. */
const anchors = new WeakMap<World, Map<number, Fish>>();

/**
 * Early value bump. Natural spawns arrive as a school of `ability.uncommon.schoolMin..schoolMax`
 * fish that share one direction and speed and swim in a staggered two-lane formation.
 *
 * Rules:
 * - Only natural spawns (timed spawns and the starting fish) form schools. Members, twins and
 *   Goober burst fish swim alone.
 * - Members respect `maxFish`: if the water fills up mid-school, the school is just smaller.
 *   Otherwise a high Uncommon weight would let schools blow straight through the cap.
 * - If the leader is caught, the next member in line becomes the anchor and the rest keep formation.
 */
export const uncommon: FishSpec = {
  def: {
    name: "Uncommon",
    hp: 3,
    value: 3,
    speed: 55,
    size: 26,
    wobble: 8,
    wobbleSpeed: 2,
    body: "#7bd389",
    fin: "#3f9e57",
  },
  // Taller than long: the trailing fins reach well above and below the body.
  box: { width: 1.0, height: 1.35 },
  shape: drawAngelfish,

  update(world) {
    caughtAtStepStart.set(world, world.totalCaught);
    let map: Map<number, Fish> | undefined;
    for (const fish of world.fish) {
      const school = fish.state.school;
      if (fish.kind !== "uncommon" || fish.captured || school === undefined) continue;
      map ??= new Map();
      // world.fish keeps spawn order, so the first live member found is the front-most one.
      if (!map.has(school)) map.set(school, fish);
    }
    if (map) anchors.set(world, map);
    else anchors.delete(world);
  },

  onSpawn(world, fish) {
    if (formingSchool > 0 || isByProduct(world)) return;
    formSchool(world, fish);
  },

  move(world, fish, dt) {
    const school = fish.state.school;
    if (school === undefined) return;
    const anchor = anchors.get(world)?.get(school);
    if (!anchor || anchor === fish) return;

    const s = fish.state;
    const a = anchor.state;
    const back = (s.slotBack ?? 0) - (a.slotBack ?? 0);
    const side = (s.slotSide ?? 0) - (a.slotSide ?? 0);
    const slot = slotFor(world.swimArea(), anchor, back, side);
    const k = 1 - Math.exp(-FOLLOW_RATE * dt);
    fish.angle += Math.atan2(Math.sin(slot.angle - fish.angle), Math.cos(slot.angle - fish.angle)) * k;
    fish.orbit += (slot.orbit - fish.orbit) * k;
    fish.dir = anchor.dir;
    fish.wobblePhase = anchor.wobblePhase + (s.slotPhase ?? 0) - (a.slotPhase ?? 0);
  },
};

/**
 * True while the world is processing captures: something was caught since the step began, and
 * natural spawns always happen before captures in a step. Anything spawned then is a by-product of
 * a capture (a twin, a Goober burst, any future on-capture spawn) and must not start a school.
 */
function isByProduct(world: World): boolean {
  const atStart = caughtAtStepStart.get(world);
  return atStart !== undefined && world.totalCaught !== atStart;
}

/** Makes `leader` the front of a new school and spawns the rest behind it. */
function formSchool(world: World, leader: Fish): void {
  const { schoolMin, schoolMax } = world.stats.ability.uncommon;
  const min = Math.max(1, Math.floor(Math.min(schoolMin, schoolMax)));
  const max = Math.max(min, Math.floor(Math.max(schoolMin, schoolMax)));
  const size = min + Math.floor(world.rng() * (max - min + 1));

  leader.state.school = leader.id;
  leader.state.slotBack = 0;
  leader.state.slotSide = 0;
  leader.state.slotPhase = 0;
  if (size <= 1) return;

  const def = uncommon.def;
  const area = world.swimArea();
  // Put the second lane on whichever side has more room, so no slot crosses the edge or the boat.
  const outward = leader.orbit < 0.6 ? 1 : -1;

  formingSchool++;
  try {
    for (let i = 1; i < size; i++) {
      const back = i * SPACING_ALONG * def.size + range(world.rng, -SLOT_JITTER, SLOT_JITTER);
      const side = (i % 2) * SPACING_LANE * def.size * outward + range(world.rng, -SLOT_JITTER, SLOT_JITTER);
      const slot = slotFor(area, leader, back, side);
      // Spawn on the orbit path itself (no wobble); the world turns it back into angle and orbit.
      const at = {
        x: area.cx + Math.cos(slot.angle) * slot.orbit * area.rx,
        y: area.cy + Math.sin(slot.angle) * slot.orbit * area.ry,
      };
      const member = world.spawn("uncommon", { at });
      // The water is full: the school stays as big as it got.
      if (!member) break;

      member.dir = leader.dir;
      member.heading = leader.heading;
      member.state.school = leader.id;
      member.state.slotBack = back;
      member.state.slotSide = side;
      member.state.slotPhase = -i * PHASE_STEP;
      // Spawning at `at` started the wobble at its midpoint. Sync it with the leader and move the
      // fish to match, the same way the world places it.
      member.wobblePhase = leader.wobblePhase + member.state.slotPhase;
      const w = Math.sin(member.wobblePhase) * def.wobble;
      member.x += Math.cos(member.angle) * w;
      member.y += Math.sin(member.angle) * w;
    }
  } finally {
    formingSchool--;
  }
}

type SwimArea = ReturnType<World["swimArea"]>;

/**
 * Where a fish sits that is `back` px behind `anchor` along the anchor's orbit and `side` px off it
 * (positive is away from the boat), as an angle and orbit.
 *
 * Measuring along the path keeps the gaps the same all the way round the ellipse. The side step
 * follows the path's normal, not the line to the centre, so the lanes don't shear on the ellipse's
 * long sides.
 */
function slotFor(area: SwimArea, anchor: Fish, back: number, side: number): { angle: number; orbit: number } {
  const { rx, ry } = area;
  const o = anchor.orbit;
  /** Path length per radian, per unit of orbit, at angle `a`. */
  const arc = (a: number) => Math.max(Math.hypot(rx * Math.sin(a), ry * Math.cos(a)), 1e-6);

  // Step back along the path, measuring the arc halfway along the step.
  const rough = back / (o * arc(anchor.angle));
  const spine = anchor.angle - anchor.dir * (back / (o * arc(anchor.angle - (anchor.dir * rough) / 2)));

  // Solve side * normal = dOrbit * dP/dOrbit + dAngle * dP/dAngle for P = o * (rx cos a, ry sin a).
  const s = arc(spine);
  const dOrbit = (side * s) / (rx * ry);
  const dAngle = (-dOrbit * Math.sin(spine) * Math.cos(spine) * (ry * ry - rx * rx)) / (o * s * s);
  return { angle: spine + dAngle, orbit: Math.min(1, Math.max(area.minOrbit, o + dOrbit)) };
}

/** Angelfish: tall diamond body, long dorsal and anal fins sweeping back, small fan tail. */
function drawAngelfish(ctx: CanvasRenderingContext2D, def: FishDef): void {
  const l = def.size;
  const p = (x: number, y: number): [number, number] => [x * l, y * l];

  ctx.fillStyle = def.fin;
  // Dorsal fin: rises from the top of the body and trails far back.
  ctx.beginPath();
  ctx.moveTo(...p(0.06, -0.26));
  ctx.quadraticCurveTo(...p(-0.08, -0.52), ...p(-0.36, -0.64));
  ctx.quadraticCurveTo(...p(-0.24, -0.36), ...p(-0.17, -0.06));
  ctx.closePath();
  ctx.fill();
  // Anal fin: the mirror image below.
  ctx.beginPath();
  ctx.moveTo(...p(0.06, 0.26));
  ctx.quadraticCurveTo(...p(-0.08, 0.52), ...p(-0.36, 0.64));
  ctx.quadraticCurveTo(...p(-0.24, 0.36), ...p(-0.17, 0.06));
  ctx.closePath();
  ctx.fill();
  // Fan tail.
  ctx.beginPath();
  ctx.moveTo(...p(-0.16, 0));
  ctx.lineTo(...p(-0.42, -0.15));
  ctx.quadraticCurveTo(...p(-0.36, 0), ...p(-0.42, 0.15));
  ctx.closePath();
  ctx.fill();
  // Thin pelvic streamers.
  ctx.strokeStyle = def.fin;
  ctx.lineWidth = 0.035 * l;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(...p(0.1, 0.2));
  ctx.quadraticCurveTo(...p(0.02, 0.42), ...p(-0.12, 0.56));
  ctx.stroke();

  // Body: a tall diamond with rounded corners.
  ctx.fillStyle = def.body;
  ctx.beginPath();
  bodyPath(ctx, l);
  ctx.fill();

  // Vertical stripes, clipped to the body.
  ctx.save();
  ctx.beginPath();
  bodyPath(ctx, l);
  ctx.clip();
  ctx.fillStyle = def.fin;
  for (const x of [0.13, -0.05]) {
    ctx.beginPath();
    ctx.ellipse(x * l, 0, 0.035 * l, 0.4 * l, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // Eye
  ctx.fillStyle = "#16202a";
  ctx.beginPath();
  ctx.arc(...p(0.22, -0.05), 0.04 * l, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(...p(0.23, -0.06), 0.014 * l, 0, TAU);
  ctx.fill();
}

function bodyPath(ctx: CanvasRenderingContext2D, l: number): void {
  ctx.moveTo(0.36 * l, 0.02 * l);
  ctx.quadraticCurveTo(0.2 * l, -0.2 * l, 0.04 * l, -0.3 * l);
  ctx.quadraticCurveTo(-0.08 * l, -0.18 * l, -0.19 * l, 0);
  ctx.quadraticCurveTo(-0.08 * l, 0.18 * l, 0.04 * l, 0.3 * l);
  ctx.quadraticCurveTo(0.2 * l, 0.2 * l, 0.36 * l, 0.02 * l);
  ctx.closePath();
}
