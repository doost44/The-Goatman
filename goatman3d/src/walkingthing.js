import * as THREE from 'three';
import { loadSheet, loadTexture } from './textures.js';
import { sfx } from './sound.js';
import { shake, subtitle } from './hud.js';
import { pushOut } from './player.js';
import { BODY_ROWS, bodyGeometry, legTexture, hull, createShadow } from './walkingthing-body.js';
import { THIGH, SHIN, PASTERN, createLeg, placeLeg, springLeg } from './walkingthing-legs.js';

// The Walking Thing, from WBOY1-11 (WALKYBOY/): a pale small body high up on two very long,
// thin, red-lined stilt legs. The body is the painted body swept round into a rounded
// low-poly shape with the painting on its flanks (walkingthing-body.js). The legs are worked
// out every frame from where its feet are (walkingthing-legs.js), so the feet plant on the
// ground and lift. The walk keeps the painting's rhythm: one stride cycle is its 11
// drawings, and the body tips the way it does in them; it dips and sways onto each foot as
// it lands. The dark outlines are back faces drawn a little bigger ("inverted hulls"), like
// the painted line round the body and down the legs.
//
// levels.json "walkingThing": { home, wander, height, speed, frameTime, notice, lower, ... }
// and for riding it: rideSpeed, hurry (Shift: rideSpeed times this), turn (radians a second).

const SHEET = 'assets/field/wboy';
const TALL = 254; // the drawings' height in pixels, top of the head to the feet
// Per drawing, WBOY1-11: how far it tips its head up (radians), read off the frames.
const TIP = [0, 0, 0, 0.02, 0.02, 0, 0, 0.05, 0.14, 0.11, 0.04];
const SWING = 0.55; // part of a cycle each foot spends in the air: the next lifts just before the other lands
const KNEEL_HIP = 1.2; // metres above the ground when it kneels
// The tip at a point f (0..11) through the drawings, on a smooth curve through them.
function tipAt(f) {
  const i = Math.floor(f), w = f - i, at = (n) => TIP[(n + 11) % 11];
  const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
  return p1 + 0.5 * w * (p2 - p0 + w * (2 * p0 - 5 * p1 + 4 * p2 - p3 + w * (3 * (p1 - p2) + p3 - p0)));
}

const rnd = (a, b) => a + Math.random() * (b - a);
const ease = (k) => k * k * (3 - 2 * k);
const clamp = THREE.MathUtils.clamp;

// --- The creature ----------------------------------------------------------------------------

export async function createWalkingThing(def, { heightAt, camera, player }) {
  const sheet = await loadSheet(SHEET);
  const H = def.height;
  const m = H / TALL; // metres per pixel of the painting
  const legLen = (TALL - BODY_ROWS) * m;
  const T = legLen * THIGH, S = legLen * SHIN, P = legLen * PASTERN;
  const k = H / 22; // radii and outlines were tuned at 22 m tall
  const depth = 40 * m; // how thick its body is
  const spread = depth * 0.3; // hips either side of the middle
  const line = 0.045 * k;
  const cycle = 11 * def.frameTime; // seconds per stride cycle: one per drawing

  const group = new THREE.Group();
  // A little of their own colour unlit (emissive), so they stay pale like the painting.
  const legTex = legTexture(sheet);
  const legMat = new THREE.MeshLambertMaterial({ map: legTex, emissiveMap: legTex, emissive: 0x404040, flatShading: true, color: 0xe8e0e0 });
  const redLine = new THREE.MeshBasicMaterial({ color: 0x4a0a14, side: THREE.BackSide });
  const darkLine = new THREE.MeshBasicMaterial({ color: 0x3b2733, side: THREE.BackSide });

  const { geo: bodyGeo, texture: bodyTex, top: backTop } = bodyGeometry(sheet, m, depth); // backTop: above the hips
  const body = new THREE.Group();
  body.rotation.order = 'YXZ';
  body.add(new THREE.Mesh(bodyGeo, new THREE.MeshLambertMaterial({ map: bodyTex, emissiveMap: bodyTex, emissive: 0x505050, flatShading: true, color: 0xe4dcdc })));
  body.add(hull(bodyGeo, line * 1.8, darkLine));
  group.add(body);

  const size = { T, S, P, k, line };
  const legs = [-1, 1].map((s) => {
    const leg = createLeg(s, { k, line, mat: legMat, lineMat: redLine });
    group.add(...leg.meshes, leg.pad);
    return leg;
  });

  const shadow = createShadow(await loadTexture(def.shadow), (backTop + 30 * m) * 1.6, depth * 2.2);
  group.add(shadow);

  // --- State ---
  const pos = new THREE.Vector3(def.home[0], 0, def.home[2]); // the ground point under its hips
  const fwd = new THREE.Vector3(), side = new THREE.Vector3(), back = new THREE.Vector3();
  const v = new THREE.Vector3(), hip = new THREE.Vector3();
  let heading = def.facing ?? 0;
  let speed = 0;
  let phase = 0;
  let crouch = 0; // 0 standing .. 1 kneeling
  let rear = 0; // rearing back, head up (the squash)
  let dip = 0, dipVel = 0, press = 0; // the body sinking onto a foot as it lands, and springing back up
  let roll = 0, rollVel = 0, rollTo = 0; // and leaning over onto that foot
  let lastSpeed = 0;
  let mode = 'wander'; // wander | watch | script | ridden
  let target = null; // where it is walking to
  let rest = rnd(1, 3); // seconds before it sets off again
  const home = new THREE.Vector3(...def.home); // where it wanders round
  let drive = 0, turning = 0, hurry = false; // ridden: his keys (W/S, A/D, Shift)
  let cruise = 0; // ridden: seconds it walks on by itself (arriving in a new level)
  const tweens = []; // scripted changes, run in game time
  const colliders = legs.map(() => ({ kind: 'circle', x: 0, z: 0, r: 0.45 * k + 0.1 }));
  const belly = { kind: 'circle', x: 0, z: 0, r: depth, off: true }; // only when it kneels
  colliders.push(belly);

  function axes() {
    fwd.set(-Math.sin(heading), 0, -Math.cos(heading));
    side.set(Math.cos(heading), 0, -Math.sin(heading));
    back.copy(fwd).negate();
  }
  // Where a foot stands when it is not walking: under its hip, a little out to the side.
  function stance(leg, ahead, out) {
    out.copy(pos).addScaledVector(fwd, ahead).addScaledVector(side, leg.s * spread * 1.4);
    out.y = heightAt(out.x, out.z);
    return out;
  }
  function step(leg, to, time) {
    leg.from.copy(leg.at);
    leg.to.copy(to);
    leg.k = 0;
    leg.time = time;
    leg.lift = Math.min(4 * k, 0.6 * k + leg.from.distanceTo(to) * 0.35);
  }

  const right = new THREE.Vector3();
  function pan(p) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    v.subVectors(p, camera.position).setY(0).normalize();
    return clamp(v.dot(right), -1, 1);
  }
  // A foot comes down: felt more than heard, and the closer the more the screen shakes. The
  // body sinks and leans onto it, the knee gives and the pad squashes.
  function footfall(leg) {
    const walking = Math.min(1, speed / def.speed);
    press += (2.5 * k * walking) / 0.06; // pressing down over a moment, not all at once
    rollTo = leg.s * 0.035;
    leg.wobVel -= 0.8 * k * walking;
    leg.squashVel += 8;
    const d = camera.position.distanceTo(leg.at);
    sfx.thud(clamp(1.4 - d / 45, 0.15, 1.3), pan(leg.at));
    const riding = player.mount === thing ? 0.35 : 1;
    shake(clamp(0.55 - d / 70, 0, 0.55) * riding * (def.shake ?? 1));
  }

  const axesNow = { fwd, side, back };
  function placeLegs() {
    for (const leg of legs) placeLeg(leg, body.localToWorld(hip.set(leg.s * spread, 0, 0)), axesNow, crouch, size);
  }

  // --- What it does ---

  function wander(dt) {
    const d = target ? Math.hypot(target.x - pos.x, target.z - pos.z) : 0;
    if (!target || d < 3) {
      target = null;
      rest -= dt;
      if (rest <= 0) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * def.wander;
        target = new THREE.Vector3(home.x + Math.cos(a) * r, 0, home.z + Math.sin(a) * r);
        rest = rnd(3, 8);
      }
      return 0;
    }
    return turnToward(target, dt, 0.35) ? def.speed : def.speed * 0.3;
  }
  // Turns toward a point; true when it is roughly facing it.
  function turnToward(p, dt, rate) {
    const want = Math.atan2(-(p.x - pos.x), -(p.z - pos.z));
    const diff = Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
    heading += clamp(diff, -rate * dt, rate * dt);
    return Math.abs(diff) < 0.5;
  }

  function update(dt) {
    for (const tw of [...tweens]) {
      tw.t = Math.min(1, tw.t + dt / tw.time);
      tw.fn(tw.t);
      if (tw.t >= 1) { tweens.splice(tweens.indexOf(tw), 1); tw.resolve(); }
    }
    axes();

    // What it wants: wander about, or stop and look at him when he comes near.
    let want = 0;
    const near = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z);
    if (mode === 'wander' && near < def.notice && !player.mount) {
      mode = 'watch';
      sfx.call(pan(body.position));
      subtitle('[the Walking Thing hums]', 2.5);
    } else if (mode === 'watch' && near > def.notice * 1.4) {
      mode = 'wander';
    }
    if (mode === 'ridden') { // he steers: W walks on, S stops, A and D turn it
      heading += turning * def.turn * dt;
      want = drive > 0 || cruise > 0 ? def.rideSpeed * (hurry && drive > 0 ? def.hurry ?? 1.5 : 1) : 0;
      cruise = Math.max(0, cruise - dt);
    } else if (mode === 'script') { // kneeling, carrying him off, the squash
      if (target) {
        const facing = turnToward(target, dt, 0.5);
        want = crouch > 0.2 ? 0 : def.speed * (facing ? thing.pace : 0.3); // still getting up: it turns on the spot
      }
    } else {
      const watching = mode === 'watch' || thing.stopped;
      if (watching) turnToward(player.pos, dt, 0.6);
      else want = wander(dt);
      crouch += ((watching ? def.lower : 0) - crouch) * Math.min(1, dt * 0.8);
    }

    speed += (want - speed) * Math.min(1, dt * 1.5);
    pos.addScaledVector(fwd, speed * dt);
    pushOut(pos, thing.avoid, 0); // the level's no-go areas: the tree's canopy, the pool, the edge
    pos.y = heightAt(pos.x, pos.z);

    // The stride: a foot sets off at the start of each half of the cycle (at once when it
    // sets off from standing, not gliding off over its feet).
    if (lastSpeed < 0.05 && speed >= 0.05 && legs.every((l) => l.k >= 1 && !l.held)) phase = 0.999;
    const before = phase;
    phase = (phase + (dt * speed) / (def.speed * cycle)) % 1;
    const swingTime = (cycle * SWING) / Math.max(1, speed / def.speed); // quicker steps going faster
    // How far ahead a lifting foot goes: it lands as far in front of the hips as it will be
    // behind them when it lifts again (closer in when going slowly, further setting off).
    const pace = Math.max(speed, want);
    const ahead = 0.5 * (def.speed * cycle * Math.min(1, pace / def.speed) + pace * swingTime);
    for (const leg of legs) {
      if (leg.held) continue;
      const start = leg.s < 0 ? 0 : 0.5;
      const crossed = speed > 0.05 && (before < start ? phase >= start || phase < before : phase >= start && phase < before);
      const other = legs.find((l) => l !== leg);
      if (leg.k >= 1 && crossed) step(leg, stance(leg, ahead, v), swingTime);
      // Standing about: a foot catches up when it is left behind (stopping, turning).
      else if (leg.k >= 1 && other.k >= 1 && speed < 0.3 && leg.at.distanceTo(stance(leg, 0, v)) > 1.5 * k) step(leg, v, swingTime);
    }
    for (const leg of legs) {
      if (leg.held) { leg.at.copy(leg.held); continue; }
      if (leg.k >= 1) continue;
      leg.k = Math.min(1, leg.k + dt / leg.time);
      const e = ease(leg.k);
      leg.at.lerpVectors(leg.from, leg.to, e);
      leg.at.y = THREE.MathUtils.lerp(leg.from.y, leg.to.y, leg.k) + Math.sin(Math.PI * leg.k) * leg.lift;
      if (leg.k >= 1) footfall(leg);
    }

    // The springs: the body's dip and lean, and the knees, which the body speeding up or
    // slowing down pushes on (the wobble when it stops).
    const walking = Math.min(1, speed / def.speed);
    const accel = dt > 0 ? (speed - lastSpeed) / dt : 0;
    lastSpeed = speed;
    for (let n = Math.ceil(dt / 0.02), s = 0; s < n; s++) {
      const h = dt / n;
      dipVel += (press - 32 * dip - 5 * dipVel) * h;
      press *= Math.exp(-h / 0.06);
      dip += dipVel * h;
      rollVel += (25 * (rollTo * walking - roll) - 7 * rollVel) * h;
      roll += rollVel * h;
    }
    for (const leg of legs) springLeg(leg, dt, -accel * 5 * k);

    // The body: over the hips' ground point, at leg height (lower as it kneels), tipping
    // with the painting's drawings, dipping and leaning onto each foot as it lands.
    const tip = tipAt(phase * 11) * walking;
    const stand = (T + S + P) * 0.96;
    body.position.set(pos.x, pos.y + stand + (KNEEL_HIP - stand) * crouch - dip, pos.z);
    body.rotation.set(tip - crouch * 0.12 + rear * 0.45, heading, roll);
    body.updateMatrixWorld();
    placeLegs();
    shadow.userData.lay(pos, fwd, side, heightAt);

    legs.forEach((leg, n) => { colliders[n].x = leg.at.x; colliders[n].z = leg.at.z; });
    belly.off = crouch < 0.6;
    belly.x = pos.x;
    belly.z = pos.z;
    thing.talkPoint.set(pos.x, pos.y + stand * 0.5, pos.z);
  }

  function tween(time, fn) {
    return new Promise((resolve) => tweens.push({ t: 0, time: Math.max(time, 0.001), fn, resolve }));
  }

  const thing = {
    group,
    colliders,
    avoid: [], // colliders it keeps out of (set by the level)
    talkPoint: new THREE.Vector3(),
    stopped: false, // talking: it stands and looks at him
    pace: 1,
    update,
    get heading() { return heading; },
    get body() { return body; },
    get sway() { return body.rotation.z; }, // rolling from foot to foot (the rider's view rolls too)
    // Where a rider kneels: on top of its back, just in front of the pale block.
    seat(out) { return body.localToWorld(out.set(0, backTop - 2 * m, 2 * m)); },
    // Scripted: down onto its knees, back up, and off somewhere.
    kneel(time) {
      mode = 'script';
      target = null;
      const from = crouch;
      sfx.groan(pan(body.position));
      subtitle('[the Walking Thing kneels, creaking]', 3);
      return tween(time, (t) => { crouch = from + (1 - from) * ease(t); });
    },
    rise(time) {
      const from = crouch;
      sfx.groan(pan(body.position), 0.8);
      return tween(time, (t) => { crouch = from * (1 - ease(t)); });
    },
    walkTo(point, pace = 1) {
      mode = 'script';
      target = new THREE.Vector3(...point);
      thing.pace = pace;
    },
    wait: (time) => tween(time, () => {}), // seconds of game time
    // The squash: it rears back and lifts the leg nearest him high over his head, its foot
    // swelling, then brings it down on him.
    async raiseFoot(over, time, size) {
      mode = 'script';
      target = null;
      const leg = legs.reduce((a, b) => (a.at.distanceTo(over) < b.at.distanceTo(over) ? a : b));
      const from = leg.at.clone();
      const top = over.clone().add(v.copy(over).sub(pos).setY(0).normalize().multiplyScalar(-1.5)).setY(over.y + 9 * k);
      leg.held = leg.at.clone();
      thing.stomping = leg;
      return tween(time, (t) => {
        const e = ease(t);
        leg.held.lerpVectors(from, top, e);
        leg.held.y += Math.sin(Math.PI * e) * 3 * k;
        leg.grow = 1 + (size - 1) * e;
        rear = e;
      });
    },
    dropFoot(onto, time) {
      const leg = thing.stomping;
      const from = leg.held.clone();
      sfx.whistle(time);
      return tween(time, (t) => {
        leg.held.lerpVectors(from, onto, t * t); // falling faster and faster
        rear = 1 - t * 0.7;
      });
    },
    // After: the foot slowly lifting off him again, still huge.
    liftFoot(at, time) {
      const leg = thing.stomping;
      const y = heightAt(at.x, at.z);
      return tween(time, (t) => {
        leg.held.set(at.x, y + 0.5 + 4.5 * k * ease(t), at.z);
        rear = 0.3 * (1 - t);
      });
    },
    nearestFoot(p) {
      return legs.reduce((a, b) => (a.at.distanceTo(p) < b.at.distanceTo(p) ? a : b)).at.clone();
    },
    // Climbing on: up from where he stands to its back, turning to look out over its head,
    // then it carries him (player.mount).
    climbOn(rider, time) {
      const start = rider.pos.clone(), end = new THREE.Vector3();
      let t = 0;
      rider.mount = {
        heading: thing.heading,
        look: -0.3, // the view eases round to its heading, looking down a little (player.js)
        seat(out) {
          thing.seat(end);
          out.lerpVectors(start, end, ease(t));
          out.y += Math.sin(Math.PI * t) * 2;
          return out;
        },
      };
      return tween(time, (now) => { t = now; }).then(() => { rider.mount = thing; });
    },
    // Climbing down: from its back to `ahead` metres in front of it, turning round on the
    // way to face it.
    climbOff(rider, ahead, time) {
      const start = thing.seat(new THREE.Vector3());
      const end = pos.clone().addScaledVector(fwd, ahead);
      end.y = heightAt(end.x, end.z);
      let t = 0;
      rider.mount = {
        heading: heading + Math.PI,
        look: 0.1,
        seat(out) {
          out.lerpVectors(start, end, ease(t));
          out.y += Math.sin(Math.PI * t) * 1.5;
          return out;
        },
      };
      return tween(time, (now) => { t = now; }).then(() => { rider.mount = null; });
    },
    // Carrying him where he steers it (player.js calls steer() with his keys every frame).
    carry(rider, walkOn = 0) {
      mode = 'ridden';
      target = null;
      cruise = walkOn;
      if (walkOn) speed = def.rideSpeed; // arriving mid-stride
      rider.mount = thing;
    },
    steer(forward, turn, fast = false) {
      drive = forward;
      turning = turn;
      hurry = fast;
      if (forward < 0) cruise = 0;
    },
    // Somewhere else at once, standing (out of sight, under the ending's white-out).
    moveTo(point, facing) {
      pos.set(point[0], 0, point[2]);
      heading = facing;
      speed = crouch = rear = 0;
      axes();
      for (const leg of legs) { stance(leg, 0, leg.at); leg.k = 1; }
      update(0);
    },
    // Left to itself: it stays about here, watching him when he is near.
    settle() {
      mode = 'wander';
      target = null;
      home.copy(pos);
    },
    // Petted: it kneels and lowers its head to him, stays a moment, then gets up again.
    async nuzzle(time) {
      mode = 'script';
      target = null;
      const from = crouch;
      await tween(time * 0.4, (t) => { crouch = from + (1 - from) * ease(t); rear = -0.8 * ease(t); });
      await tween(time * 0.2, () => {});
      await tween(time * 0.4, (t) => { crouch = 1 - ease(t); rear = -0.8 * (1 - ease(t)); });
      thing.settle();
    },
  };
  // Start standing, feet planted.
  axes();
  for (const leg of legs) stance(leg, 0, leg.at);
  update(0);
  return thing;
}
