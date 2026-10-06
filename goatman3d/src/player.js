import * as THREE from 'three';
import { loopsLevel, duck } from './sound.js';
import { sfx } from './sfx.js';
import { showHint } from './hud.js';
import { settings } from './options.js';

// GoatMan's body: walking, jumping, falling into the void and dropping back in.
// Ported from automation-map/src/player.js; the circular island is replaced by the
// level's own ground meshes (a ray straight down finds the height) and colliders.
//
// player.pos is where his hooves are; the head object (turned by the mouse) sits
// EYE above it and the camera module decides where the camera goes from there.

// How he moves: walking, sprinting and jumping, all in one place.
export const EYE = 1.7;
const RIDE_EYE = 1.2; // kneeling on the Walking Thing's back
const SPEED = 4.5; // walking, metres a second
const SPRINT = 1.8; // Shift: this many times faster, on the ground going forward
const SPRINT_UP = 0.3, SPRINT_DOWN = 0.2; // seconds to reach a full sprint and to drop back
export const SPRINT_STEP = 1.5; // sprinting, each footstep is this much longer
export const SPRINT_FOV = 6; // degrees the view widens at a full sprint
const GRAVITY = 20;
const MAX_FALL = 40; // terminal velocity
const WRAP_HEIGHT = 90; // how far above the respawn point a fall into the void comes back in
const SOFT_FALL = 12; // fall speed just before touching down after a wrap
const DIP = 0.45; // how far the view sinks on a hard landing
const DIP_TIME = 0.4;
const JUMP = 7; // upward speed of a jump (about 1.2 units high)
const AIR_CONTROL = 5; // how quickly WASD steers you in the air
const BODY = 0.4; // his radius, for colliders
const STEP_UP = 0.6; // highest ledge he walks straight up
export const STRIDE = 1.1; // metres per footstep walking (goatman-poses.js times his stride to it)
const BOB = 0.05;
const WADE_SLOW = 0.4; // wading (the savanna's bog): this much slower, and no sprinting
const WADE_DIP = 0.25; // how far the view sinks, his hooves in the mud

const DOWN = new THREE.Vector3(0, -1, 0);
const RIDE_HINT = 'RIDING · W WALK · SHIFT HURRY · S STOP · A/D TURN · E GET DOWN';

// Nearest point to (x, z) on a polyline of [x, z] points, and how far away it is.
export function nearestOnPath(points, x, z) {
  let best = { x: points[0][0], z: points[0][1], d: Infinity, t: 0 };
  let along = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const k = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
    const px = ax + dx * k, pz = az + dz * k;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { x: px, z: pz, d, t: along + k * Math.sqrt(len2) };
    along += Math.sqrt(len2);
  }
  return best;
}

// Colliders push a body standing at p (his hooves, a creature's feet) out sideways: circles
// (trunks, legs), boxes, corridors along a path, rings that keep it inside and lines (fallen
// trunks). `body` is its radius and `tall` its height, for colliders that only reach so high
// (y0..y1).
export function pushOut(p, colliders, body = BODY, tall = EYE) {
  for (const c of colliders) {
    if (c.off) continue;
    if (c.y0 !== undefined && (p.y > c.y1 || p.y + tall < c.y0)) continue;
    if (c.kind === 'line') {
      // A fallen trunk from a to b, its top at ya and yb: it stops him unless he is up on it,
      // or it is low enough to step over.
      const dx = c.bx - c.ax, dz = c.bz - c.az;
      const k = THREE.MathUtils.clamp(((p.x - c.ax) * dx + (p.z - c.az) * dz) / (dx * dx + dz * dz), 0, 1);
      if (p.y > c.ya + (c.yb - c.ya) * k - STEP_UP) continue;
      const ex = p.x - (c.ax + dx * k), ez = p.z - (c.az + dz * k);
      const d = Math.hypot(ex, ez);
      const min = c.r + body;
      if (d < min && d > 1e-4) { p.x += (ex / d) * (min - d); p.z += (ez / d) * (min - d); }
    } else if (c.kind === 'circle') {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + body;
      if (d < min && d > 1e-4) { p.x += (dx / d) * (min - d); p.z += (dz / d) * (min - d); }
    } else if (c.kind === 'ring') {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const max = c.r - body;
      if (d > max) { p.x = c.x + (dx / d) * max; p.z = c.z + (dz / d) * max; }
    } else if (c.kind === 'path') {
      // A corridor along a line of points: stay within half its width of the line.
      const near = nearestOnPath(c.points, p.x, p.z);
      const max = c.width / 2 - body;
      if (near.d > max) {
        p.x = near.x + ((p.x - near.x) / near.d) * max;
        p.z = near.z + ((p.z - near.z) / near.d) * max;
      }
    } else if (c.kind === 'box') {
      const nx = THREE.MathUtils.clamp(p.x, c.minX, c.maxX);
      const nz = THREE.MathUtils.clamp(p.z, c.minZ, c.maxZ);
      const dx = p.x - nx, dz = p.z - nz;
      const d = Math.hypot(dx, dz);
      if (d < body) {
        if (d > 1e-4) { p.x += (dx / d) * (body - d); p.z += (dz / d) * (body - d); }
        else { // inside: leave by the nearest side
          const sides = [p.x - c.minX, c.maxX - p.x, p.z - c.minZ, c.maxZ - p.z];
          const i = sides.indexOf(Math.min(...sides));
          if (i === 0) p.x = c.minX - body; else if (i === 1) p.x = c.maxX + body;
          else if (i === 2) p.z = c.minZ - body; else p.z = c.maxZ + body;
        }
      }
    }
  }
}

// Is a body standing at p still inside a trunk (circle) or a fallen one (line)?
function wedged(p, colliders, body = BODY) {
  return colliders.some((c) => {
    if (c.off || (c.y0 !== undefined && (p.y > c.y1 || p.y + EYE < c.y0))) return false;
    if (c.kind === 'circle') return Math.hypot(p.x - c.x, p.z - c.z) < c.r + body - 0.02;
    if (c.kind !== 'line') return false;
    const dx = c.bx - c.ax, dz = c.bz - c.az;
    const k = THREE.MathUtils.clamp(((p.x - c.ax) * dx + (p.z - c.az) * dz) / (dx * dx + dz * dz), 0, 1);
    return p.y <= c.ya + (c.yb - c.ya) * k - STEP_UP && Math.hypot(p.x - c.ax - dx * k, p.z - c.az - dz * k) < c.r + body - 0.02;
  });
}

export function createPlayer(head, controls, keys) {
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const move = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const from = new THREE.Vector3();
  let dip = 1; // landing dip progress, 0..1 (1 = standing)
  let dipDepth = 0;
  let stunned = 0; // seconds of no air control after being knocked
  let ramp = 0; // sprinting, 0..1 at a steady rate (player.sprint is it eased)

  const player = {
    pos,
    vel,
    level: null, // set by levels.js: { ground, colliders, voidY, respawn, surface, water, splash }
    grounded: true,
    wrapped: false, // falling back in from above
    frozen: false, // cutscenes and dialogue: no walking
    mount: null, // the creature being ridden (it moves the player)
    stride: 0, // footsteps taken, times STRIDE: drives the walk animation and view bob
    speed: 0, // current ground speed: 1 is a walk, SPRINT a full sprint
    sprint: 0, // 0..1, easing in and out with Shift
    wade: 0, // 0..1, how much he is wading
    bob: 0,
    update,
    place,
    knock,
    groundAt,
  };

  // Height of the ground under (x, z) within reach of y, or null if there is none. Terrain
  // knows its own height (userData.surface); anything else is found with a ray straight down.
  function groundAt(x, z, y, above = STEP_UP, below = STEP_UP) {
    if (!player.level) return null;
    let best = null;
    const rest = [];
    for (const o of player.level.ground) {
      if (!o.userData.surface) { rest.push(o); continue; }
      const h = o.userData.surface(x, z);
      if (h !== null && h <= y + above && h >= y - below && (best === null || h > best)) best = h;
    }
    if (!rest.length) return best;
    from.set(x, y + above, z);
    ray.set(from, DOWN);
    ray.far = above + below;
    const hit = ray.intersectObjects(rest, false)[0];
    return hit && (best === null || hit.point.y > best) ? hit.point.y : best;
  }

  // Put him somewhere (a spawn point), standing on whatever is below.
  function place(p, yawDeg = 0) {
    pos.set(p[0], p[1] ?? 0, p[2]);
    const g = groundAt(pos.x, pos.z, pos.y + 50, 0, 200);
    if (g !== null) pos.y = g;
    vel.set(0, 0, 0);
    head.rotation.set(0, THREE.MathUtils.degToRad(yawDeg), 0, 'YXZ');
    player.grounded = true;
    player.wrapped = false;
    player.sprint = ramp = player.wade = 0;
    dip = 1;
    syncHead(0);
  }

  // Send him flying.
  function knock(dir, speed, up) {
    vel.set(dir.x, 0, dir.z).normalize().multiplyScalar(speed);
    vel.y = up;
    player.grounded = false;
    stunned = 1.5;
  }

  function wrap() {
    const r = player.level.respawn;
    pos.set(r[0], (r[1] ?? 0) + WRAP_HEIGHT, r[2]);
    vel.x = vel.z = 0;
    player.wrapped = true;
  }

  // What his hooves are in: the level's ground, or water (the savanna's bog), where they
  // splash (the sound is the footstep's own, except landing).
  const wet = (y) => (player.level.water?.(pos.x, pos.z, y) ?? 0) > 0.12;
  const underfoot = (y = pos.y) => (wet(y) ? 'water' : player.level.surface);
  function splash(size, y = pos.y, sound = false) { if (wet(y)) player.level.splash?.(pos.x, pos.z, size, sound); }

  function land(y) {
    sfx.land(-vel.y / 25, underfoot(y));
    splash(0.8, y, true);
    dipDepth = DIP * Math.min(1, -vel.y / SOFT_FALL);
    dip = dipDepth > 0.05 ? 0 : 1;
    pos.y = y;
    vel.set(0, 0, 0);
    player.grounded = true;
    player.wrapped = false;
  }

  // Pushed out of anything solid. A gap narrower than he is pushes him from both sides at once
  // and could squeeze him through, so if he is still stuck in something he stays where he was.
  function collide(before) {
    const all = player.level.colliders;
    pushOut(pos, all);
    pushOut(pos, all);
    if (wedged(pos, all) && !wedged(before, all)) { pos.x = before.x; pos.z = before.z; }
  }

  // Shift with W: only walking forward (and not backing up at the same time).
  function sprinting() {
    if (!controls.isLocked || player.frozen) return false;
    return !!(keys.ShiftLeft || keys.ShiftRight) && !!(keys.KeyW || keys.ArrowUp) && !(keys.KeyS || keys.ArrowDown);
  }

  // WASD as a direction on the ground plane, relative to where the head faces.
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  function wishDir() {
    move.set(0, 0, 0);
    if (!controls.isLocked || player.frozen) return move;
    forward.set(0, 0, -1).applyAxisAngle(UP, head.rotation.y);
    right.crossVectors(forward, UP);
    move.addScaledVector(forward, (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0));
    move.addScaledVector(right, (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0));
    return move.lengthSq() > 0 ? move.normalize() : move;
  }

  function syncHead(dt) {
    if (dip < 1) dip = Math.min(1, dip + dt / DIP_TIME);
    // The view dips as each hoof lands, harder sprinting (unless screen shake is off).
    const bob = Math.min(player.speed, settings.shake ? SPRINT : 1) * (1 + player.wade); // heavier, wading
    player.bob = player.grounded ? (Math.abs(Math.sin(player.stride * Math.PI / STRIDE)) - 0.5) * BOB * bob : 0;
    const eye = player.mount ? RIDE_EYE : EYE - WADE_DIP * player.wade;
    head.position.set(pos.x, pos.y + eye - dipDepth * Math.sin(dip * Math.PI) + player.bob, pos.z);
  }

  // Carried: on the creature's back, turning when it turns. While climbing on or off, the
  // view eases round to look the way the stand-in faces. A mount that can be steered gets
  // his keys: W/S and A/D.
  let carried = null; // its heading last frame
  let ridden = null; // what carried him last frame
  let hinted = false;
  const key = (...codes) => (codes.some((c) => keys[c]) ? 1 : 0);
  function ride(dt) {
    const mount = player.mount;
    if (mount !== ridden) carried = null; // on or off: a different heading, not a turn
    ridden = mount;
    const { heading, look } = mount;
    if (carried !== null) head.rotation.y += Math.atan2(Math.sin(heading - carried), Math.cos(heading - carried));
    carried = heading;
    if (look !== undefined) {
      const k = Math.min(1, dt * 2.5);
      head.rotation.y += Math.atan2(Math.sin(heading - head.rotation.y), Math.cos(heading - head.rotation.y)) * k;
      head.rotation.x += (look - head.rotation.x) * k;
    }
    const steering = !!mount.steer && !player.frozen;
    if (mount.steer) {
      const on = steering && controls.isLocked;
      mount.steer(on ? key('KeyW', 'ArrowUp') - key('KeyS', 'ArrowDown') : 0, on ? key('KeyA', 'ArrowLeft') - key('KeyD', 'ArrowRight') : 0, on && !!key('ShiftLeft', 'ShiftRight'));
    }
    hint(steering);
    mount.seat(pos);
  }
  function hint(on) {
    if (on !== hinted) showHint(on ? RIDE_HINT : null, 'ride');
    hinted = on;
  }

  function update(dt) {
    if (!player.level) return;
    if (player.mount) { // riding: the creature carries him, kneeling on its back (walkingthing.js)
      ride(dt);
      vel.set(0, 0, 0);
      player.speed = player.sprint = ramp = player.wade = 0;
      player.grounded = true;
      loopsLevel.wind(0);
      syncHead(dt);
      return;
    }
    carried = ridden = null;
    hint(false);
    const wish = wishDir();
    // Wading: how deep the water is over his hooves, eased so the view sinks smoothly.
    if (player.grounded) {
      const deep = player.level.water?.(pos.x, pos.z, pos.y) ?? 0;
      player.wade += (THREE.MathUtils.smoothstep(deep, 0.05, 0.35) - player.wade) * Math.min(1, dt * 4);
    }
    // Sprinting eases in and out; in the air it stays as it was, so a jump carries the speed.
    const run = sprinting() && player.wade < 0.3;
    if (player.grounded) ramp = THREE.MathUtils.clamp(ramp + (run ? dt / SPRINT_UP : -dt / SPRINT_DOWN), 0, 1);
    const sprint = player.sprint = THREE.MathUtils.smoothstep(ramp, 0, 1);
    const speed = SPEED * (player.level.speed ?? 1) * (1 + (SPRINT - 1) * sprint) * (1 - WADE_SLOW * player.wade);

    if (player.grounded) {
      loopsLevel.wind(0);
      duck(0, 'fall');
      // Walking speed is kept in vel, so stepping or jumping off an edge carries you out.
      vel.set(wish.x * speed, 0, wish.z * speed);
      const before = pos.clone();
      pos.addScaledVector(vel, dt);
      collide(before);
      const ground = groundAt(pos.x, pos.z, pos.y);
      if (ground === null) {
        // Off an edge (or down something too steep to walk): fall.
        player.grounded = false;
      } else {
        pos.y = ground;
      }
      const walked = Math.hypot(pos.x - before.x, pos.z - before.z);
      if (dt > 0) player.speed = THREE.MathUtils.lerp(player.speed, walked / dt / SPEED, Math.min(1, dt * 10));
      // Sprinting, each footstep is longer (and heavier).
      const steps = Math.floor(player.stride / STRIDE);
      player.stride += walked / (1 + (SPRINT_STEP - 1) * sprint);
      if (player.grounded && Math.floor(player.stride / STRIDE) > steps) {
        sfx.step(underfoot(), 1 + 0.3 * sprint, sprint);
        splash(0.4);
      }

      if (player.grounded && keys.Space && controls.isLocked && !player.frozen) {
        sfx.jump(underfoot());
        splash(0.6);
        vel.y = JUMP;
        dip = 1;
        player.grounded = false;
      }
      syncHead(dt);
      return;
    }

    // In the air: gravity, plus some steering (not while dropping back in from above).
    player.speed = 0;
    const prevY = pos.y;
    vel.y = Math.max(vel.y - GRAVITY * dt, -MAX_FALL);
    stunned = Math.max(0, stunned - dt);
    if (!player.wrapped && stunned === 0) {
      const k = Math.min(1, AIR_CONTROL * dt);
      vel.x += (wish.x * speed - vel.x) * k * wish.lengthSq();
      vel.z += (wish.z * speed - vel.z) * k * wish.lengthSq();
    }
    // Coming back in: slow down near the ground, like a soft parachute.
    const r = player.level.respawn;
    if (player.wrapped) {
      const near = THREE.MathUtils.clamp((pos.y - (r[1] ?? 0)) / 40, 0, 1);
      vel.y = Math.max(vel.y, -THREE.MathUtils.lerp(SOFT_FALL, MAX_FALL, near));
    }
    const before = pos.clone();
    pos.addScaledVector(vel, dt);
    collide(before);
    player.stride += (Math.hypot(vel.x, vel.z) * dt) / (1 + (SPRINT_STEP - 1) * sprint); // his legs keep their rhythm in a jump
    const fall = Math.min(1, Math.max(0, -vel.y - 4) / 30); // wind builds as you fall faster
    loopsLevel.wind(fall);
    duck(fall * 0.8, 'fall');

    if (vel.y <= 0) {
      // Landing: anything solid between where we were and where we are now.
      const g = groundAt(pos.x, pos.z, pos.y, prevY - pos.y + 0.05, 0.05);
      if (g !== null && g >= pos.y - 0.05) land(g);
    }
    if (pos.y < player.level.voidY) wrap();
    syncHead(dt);
  }

  return player;
}
