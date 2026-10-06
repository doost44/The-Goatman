import { STRIDE, SPRINT_STEP } from './player.js';

// How GoatMan moves. A pose is a set of joint angles in radians, plus his hip height in
// metres. Neck, head and arm angles are measured from the vertical rather than from the
// bent torso, so the numbers are easy to read.
//
// Every frame a target pose is worked out (standing and breathing, leaning into a walk or a
// sprint, tucked in the air, sinking on landing, leaning into turns, or a scripted pose from
// the paintings) and every joint follows its target on a critically damped spring, so
// nothing ever pops. The walk cycle rides on top of the springs: it runs on the continuous
// stride (two footsteps a cycle, so his hooves land with the footstep sounds) and they fade
// it in and out. On the ground his legs reach for where his hooves should be (a two-bone
// solve), so a planted hoof stays put while he walks over it.

// Body measurements, metres (goatman.js builds him from these).
export const HIP = 0.96; // he is about 1.9 m tall in his stoop
export const THIGH = 0.38, SHIN = 0.38, PASTERN = 0.2, HOOF = 0.06;
export const BELLY = 0.32, CHEST = 0.4, NECK = 0.2;
export const UPPER_ARM = 0.48, FOREARM = 0.52;
export const CYCLE = 2 * STRIDE; // a walk cycle: two footsteps

const SMOOTH = 0.12; // seconds for a joint to catch up with its target
const FOOT = -0.053; // where a standing hoof is, ahead of the hip (a little behind)
const REACH = 0.95; // how far a hoof can travel under him while planted

export const STAND = {
  hipY: HIP, lean: 0.35, hunch: 0.5, sway: 0, turn: 0, neck: 0.5, head: 0.08, look: 0, roll: 0, twist: 0,
  thighL: 0.3, shinL: -0.75, ankleL: 0.45, thighR: 0.3, shinR: -0.75, ankleR: 0.45,
  armL: 0.06, elbowL: 0.12, spreadL: 0.06, wristL: 0, armR: 0.06, elbowR: 0.12, spreadR: 0.06, wristR: 0,
};
// down6: on his knees, shins flat behind him, hands flat on the ground in front.
const KNEEL = {
  ...STAND, hipY: 0.44, lean: 0.6, hunch: 0.4, neck: 0.55, head: 0.25,
  thighL: 0.25, shinL: -1.82, ankleL: 0, thighR: 0.2, shinR: -1.77, ankleR: 0,
  armL: 0.8, elbowL: 0, spreadL: 0.14, wristL: 0.3, armR: 0.8, elbowR: 0, spreadR: 0.14, wristR: 0.3,
};
// Reaching out to pet the Walking Thing: straightened up, one long arm raised.
const REACH_UP = { ...STAND, lean: 0.1, hunch: 0.2, neck: 0.25, head: -0.45, armR: 2.3, elbowR: 0.3, spreadR: 0, wristR: -0.3, armL: 0.3 };

const clamp01 = (k) => Math.min(1, Math.max(0, k));
export const ease = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };
export const mix = (a, b, k) => {
  const out = {};
  for (const key in STAND) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
};

// Scripted actions from the paintings. at(k, from, off) gives the pose at progress k (0..1)
// starting from the pose he was in, and how far the head is off the neck (0..1). "hold"
// keeps the last pose until the next action. goatman.js runs them.
export const ACTIONS = {
  // down1-6: down onto his knees.
  kneel: { time: 1.2, hold: true, at: (k, from) => ({ pose: mix(from, KNEEL, ease(k)) }) },
  // head1-15: kneeling, the head sinks to the ground on stretching blue strands (drinking).
  drink: { time: 2.6, hold: true, at: (k, from) => ({ pose: mix(from, KNEEL, ease(k / 0.4)), detach: ease((k - 0.35) / 0.65) }) },
  // Head back on, then up again.
  stand: { time: 1.5, at: (k, from, off) => ({ pose: mix(from, STAND, ease((k - 0.35) / 0.65)), detach: off * (1 - ease(k / 0.4)) }) },
  // Reach up, a pat, back down.
  pet: { time: 2.4, at: (k, from) => ({ pose: mix(from, REACH_UP, ease(k / 0.35) - ease((k - 0.7) / 0.3)) }) },
  // head1-15 then backhead1-13: the death after being SQUASHED. Down on his knees, the head
  // drops off onto the grass, and the blue strands spray out of the neck and fade.
  lose: { time: 3.6, hold: true, at: (k, from) => ({ pose: mix(from, KNEEL, ease(k / 0.3)), detach: clamp01((k - 0.25) / 0.3) ** 2, spray: (k - 0.55) / 0.45 }) },
};

// Each value follows its target on a critically damped spring (the smoothing in Unity's
// SmoothDamp): it eases in and out and never overshoots, at any frame rate.
function follow(now, vel, target, time, dt) {
  const w = 2 / time, x = w * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  for (const key in target) {
    const change = now[key] - target[key];
    const temp = ((vel[key] ?? 0) + w * change) * dt;
    vel[key] = ((vel[key] ?? 0) - w * temp) * decay;
    now[key] = target[key] + (change + temp) * decay;
  }
}

// A smooth curve from a to b as k goes 0..1, leaving and arriving with slope m (Hermite).
const hermite = (a, b, m, k) => {
  const k2 = k * k, k3 = k2 * k;
  return (2 * k3 - 3 * k2 + 1) * a + (k3 - 2 * k2 + k) * m + (3 * k2 - 2 * k3) * b + (k3 - k2) * m;
};

// One leg at p through its cycle (0: the hoof lands) as [thigh, shin, ankle] angles, for a
// hip `hip` metres up. Planted (until `st`), the hoof slides back under him exactly as fast
// as he walks over it; then it lifts and swings forward on an arc, leaving and landing with
// some of that speed so it doesn't jerk. The pastern lands heel first, rocks onto the toe
// as the hoof pushes off and flicks up behind as it lifts. `w` (0..1) scales the step down
// to standing still.
function leg(p, w, travel, lift, st, hip) {
  let f, h = 0, pastern;
  if (p < st) {
    const k = p / st;
    f = travel * (0.5 - k);
    pastern = 0.25 - 0.8 * ease(k);
  } else {
    const k = (p - st) / (1 - st);
    f = hermite(-travel / 2, travel / 2, (-0.8 * travel * (1 - st)) / st, k);
    h = lift * Math.sin(Math.PI * k) ** 1.5;
    pastern = -0.55 + 0.8 * ease(k) - 0.65 * Math.sin(Math.PI * Math.min(1, k / 0.75)) ** 2;
  }
  f *= w; h *= w; pastern *= w;
  // From the hoof up to the ankle, then the thigh and shin that reach the ankle with the
  // knee bent forward (it is the ankle that bends back, like a goat's). Near full stretch
  // the reach is eased off so the knee never snaps straight.
  const af = FOOT + f - PASTERN * Math.sin(pastern);
  const ad = hip - HOOF - h - PASTERN * Math.cos(pastern);
  const want = Math.hypot(af, ad) / (THIGH + SHIN);
  const L = (THIGH + SHIN) * (want < 0.85 ? want : 0.97 - 0.12 * Math.exp((0.85 - want) / 0.12));
  const atHip = Math.acos((THIGH * THIGH + L * L - SHIN * SHIN) / (2 * THIGH * L));
  const atKnee = Math.acos((THIGH * THIGH + SHIN * SHIN - L * L) / (2 * THIGH * SHIN));
  const thigh = Math.atan2(af, ad) + atHip;
  const shin = thigh - (Math.PI - atKnee);
  return [thigh, shin - thigh, pastern - shin];
}

// Weightless (the start screen): curled up a little, his long limbs drifting slowly.
function floating(t) {
  const s = (rate, offset) => Math.sin(t * rate + offset);
  return {
    ...STAND, lean: 0.25 + 0.06 * s(0.5, 0), hunch: 0.35, neck: 0.45, head: 0.1 + 0.08 * s(0.4, 1),
    armL: 0.5 + 0.3 * s(0.45, 0.5), armR: 0.4 + 0.3 * s(0.38, 2),
    spreadL: 0.5 + 0.15 * s(0.3, 1), spreadR: 0.45 + 0.15 * s(0.33, 3),
    elbowL: 0.5 + 0.2 * s(0.5, 2), elbowR: 0.4 + 0.2 * s(0.42, 0),
    wristL: 0.2 * s(0.6, 1), wristR: 0.2 * s(0.55, 2),
    thighL: 0.6 + 0.2 * s(0.35, 1), thighR: 0.3 + 0.2 * s(0.4, 2.5),
    shinL: -1.1 + 0.25 * s(0.37, 0), shinR: -0.8 + 0.25 * s(0.45, 1.5),
    ankleL: 0.6, ankleR: 0.5, roll: 0.05 * s(0.3, 0.7), twist: 0.08 * s(0.27, 2),
  };
}

export function createMotion() {
  const pose = { ...STAND }; // the springs' pose
  const vel = {};
  const out = { ...STAND }; // what is drawn: the springs' pose plus the walk cycle
  // Weights that ease in and out on springs of their own: walking (0..1), sprinting
  // (0..1), hooves on the ground (0..1) and how fast he is turning (radians a second).
  const gait = { walk: 0, sprint: 0, plant: 1, turn: 0 };
  const gaitVel = {};
  let t = 0;
  let lastYaw = null;
  let airTime = 0, fallSpeed = 0, land = 0;

  // The pose he is heading for, without the walk cycle.
  function target(dt, { speed, grounded, vy, sprint }) {
    if (grounded && airTime > 0.2) land = Math.max(land, Math.min(1, fallSpeed / 14)); // touchdown
    airTime = grounded ? 0 : airTime + dt;
    if (!grounded) fallSpeed = -vy;
    land *= Math.exp(-dt / 0.2);
    const w = gait.walk, s = gait.sprint, still = 1 - w;
    const p = { ...STAND };
    // Breathing, standing about.
    p.lean += 0.03 * Math.sin(t * 1.3) * still;
    p.hipY += 0.01 * Math.sin(t * 2.6) * still;
    p.armL += 0.04 * Math.sin(t * 1.1) * still;
    p.armR += 0.04 * Math.sin(t * 1.1 + 1.3) * still;
    // Walking he leans in and looks ahead; sprinting, further and lower, his long arms
    // bent a little more and swinging further back than forward.
    p.hipY -= 0.01 * w + 0.04 * s;
    p.lean += 0.08 * w + 0.18 * s;
    p.hunch += 0.05 * s;
    p.head -= 0.06 * w + 0.12 * s;
    p.armL -= 0.15 * s; p.armR -= 0.15 * s;
    p.elbowL += 0.12 * w + 0.2 * s; p.elbowR += 0.12 * w + 0.2 * s;
    // Turning: he leans in, his head leads and his arms swing out behind.
    const turn = gait.turn;
    p.roll += 0.05 * turn * Math.min(1, speed);
    p.look += 0.08 * turn;
    p.spreadR += 0.08 * turn; p.spreadL -= 0.08 * turn;
    // In the air: knees tucked going up; legs reaching and arms flailing coming down.
    if (!grounded) {
      const up = vy > 0 ? 1 : 0;
      const down = vy > 0 ? 0 : Math.min(1, -vy / 12);
      p.thighL += 0.5 * up; p.thighR += 0.7 * up;
      p.shinL -= 0.7 * up; p.shinR -= 0.5 * up;
      p.armL -= 0.3 * up; p.armR -= 0.3 * up;
      p.spreadL += 0.3; p.spreadR += 0.3;
      p.armL += down * (0.9 + 0.5 * Math.sin(t * 9));
      p.armR += down * (0.9 + 0.5 * Math.sin(t * 9 + 2));
      p.thighL -= 0.2 * down; p.thighR += 0.3 * down;
      p.head -= 0.4 * down;
    }
    // Landing: he sinks and hunches over (his legs bend to it, see leg()).
    p.hipY -= 0.22 * land;
    p.lean += 0.25 * land;
    p.neck += 0.1 * land;
    p.armL += 0.3 * land; p.armR += 0.3 * land;
    return p;
  }

  // The walk cycle on top of the springs' pose: the swing of the arms, the hips and spine,
  // the bob, and the legs (worked out from where the hooves go).
  function cycle(stride, sprint, hold) {
    const w = gait.walk, s = gait.sprint;
    const ph = (stride / CYCLE) * Math.PI * 2; // the left hoof lands at 0, the right at pi
    const step = STRIDE * (1 + (SPRINT_STEP - 1) * sprint); // metres a footstep, as player.js counts them
    const st = Math.min(0.6, (REACH * (1 - 0.15 * s)) / (2 * step)); // the part of a cycle a hoof is down
    const mid = Math.PI * st; // the left hoof under him: the body is lowest
    const swing = (0.3 + 0.3 * s) * w, arm = ph - 0.3; // the arms lag the legs a little
    out.hipY = pose.hipY - (0.035 + 0.04 * s) * w * (0.5 + 0.5 * Math.cos(2 * (ph - mid)));
    out.lean = pose.lean + 0.03 * w * Math.cos(2 * ph);
    out.roll = pose.roll - 0.05 * w * Math.sin(ph); // the hip drops on the side of the lifted leg
    out.sway = pose.sway + 0.04 * w * Math.sin(ph); // and the spine leans back over the other
    out.twist = pose.twist - (0.1 + 0.06 * s) * w * Math.cos(ph); // the hips turn with the legs
    out.turn = pose.turn - 1.6 * (out.twist - pose.twist); // the shoulders turn against them
    out.look = pose.look + 0.6 * (out.twist - pose.twist); // and the head keeps looking ahead
    out.head = pose.head - 0.05 * w * Math.cos(2 * (ph - mid) + 0.6); // nodding with each step
    out.armL = pose.armL - swing * Math.cos(arm);
    out.armR = pose.armR + swing * Math.cos(arm) * (1 - hold);
    out.elbowL = pose.elbowL + (0.1 + 0.1 * s) * w * (1 - Math.cos(arm)); // bent most swinging forward
    out.elbowR = pose.elbowR + (0.1 + 0.1 * s) * w * (1 + Math.cos(arm)) * (1 - hold);
    out.wristL = pose.wristL - (0.35 + 0.2 * s) * w * Math.sin(arm); // the hands trail
    out.wristR = pose.wristR + (0.35 + 0.2 * s) * w * Math.sin(arm) * (1 - hold);
    // The legs: where the hooves go, blended with the springs' legs off the ground.
    const travel = 2 * step * st, lift = 0.13 + 0.15 * s, k = ph / (Math.PI * 2);
    const L = leg(k - Math.floor(k), w, travel, lift, st, out.hipY);
    const R = leg(k + 0.5 - Math.floor(k + 0.5), w, travel, lift, st, out.hipY);
    const g = gait.plant;
    out.thighL = pose.thighL + (L[0] - pose.thighL) * g;
    out.shinL = pose.shinL + (L[1] - pose.shinL) * g;
    out.ankleL = pose.ankleL + (L[2] - pose.ankleL) * g;
    out.thighR = pose.thighR + (R[0] - pose.thighR) * g;
    out.shinR = pose.shinR + (R[1] - pose.shinR) * g;
    out.ankleR = pose.ankleR + (R[2] - pose.ankleR) * g;
  }

  return {
    // move: { yaw, speed (1 = walking), stride, grounded, vy, sprint, float };
    // scripted: an action's pose, which takes over; hold (0..1): the right forearm raised
    // with a pebble. Returns the pose to draw.
    update(dt, move, scripted, hold) {
      t += dt;
      const yaw = move.yaw;
      const turning = lastYaw === null || dt <= 0 ? 0 : Math.atan2(Math.sin(yaw - lastYaw), Math.cos(yaw - lastYaw)) / dt;
      lastYaw = yaw;
      const free = !scripted && !move.float;
      follow(gait, gaitVel, {
        walk: free && move.grounded ? clamp01(move.speed / 0.4) : 0,
        sprint: free ? move.sprint ?? 0 : 0,
        plant: free && move.grounded ? 1 : 0,
        turn: free ? Math.max(-4, Math.min(4, turning)) : 0,
      }, SMOOTH, dt);
      const want = scripted ?? (move.float ? floating(t) : target(dt, move));
      want.armR += (0.6 - want.armR) * hold;
      want.elbowR += (1.3 - want.elbowR) * hold;
      follow(pose, vel, want, SMOOTH, dt);
      Object.assign(out, pose);
      cycle(move.stride ?? 0, move.sprint ?? 0, hold);
      return out;
    },
    // The springs' pose, which a scripted action starts from.
    get pose() { return { ...pose }; },
    // Straight into a pose, no easing (arriving in a level already kneeling).
    set(p) {
      Object.assign(pose, p);
      for (const key in vel) vel[key] = 0;
    },
    // Straight back to standing (a new game, a level change).
    reset() {
      Object.assign(pose, STAND);
      for (const key in vel) vel[key] = 0;
      Object.assign(gait, { walk: 0, sprint: 0, plant: 1, turn: 0 });
      for (const key in gaitVel) gaitVel[key] = 0;
      lastYaw = null;
      land = airTime = 0;
    },
  };
}
