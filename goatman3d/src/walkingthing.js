import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadSheet, loadTexture, canvas, crunchy } from './textures.js';
import { sfx } from './sound.js';
import { shake, subtitle } from './hud.js';
import { pushOut } from './player.js';

// The Walking Thing, from WBOY1-11 (WALKYBOY/): a pale small body high up on two very long,
// thin, red-lined stilt legs. The body is the painted body swept round into a rounded
// low-poly shape with the painting on its flanks. The legs are thin cylinders worked out every
// frame from where its feet are (two-bone IK), so the feet plant on the ground and lift.
// The walk keeps the painting's rhythm: one stride cycle is its 11 drawings, and the body
// bobs and tips the way it does in them. The dark outlines are back faces drawn a little
// bigger ("inverted hulls"), like the painted line round the body and down the legs.
//
// levels.json "walkingThing": { home, wander, height, speed, frameTime, notice, lower, ... }
// and for riding it: rideSpeed, turn (radians a second).

const SHEET = 'assets/field/wboy';
const BODY_ROWS = 56; // in the 256 px drawings its legs start below this row
const TALL = 254; // the drawings' height in pixels, top of the head to the feet
const HIP_X = 49; // where the legs come out of the body, pixels from the left
// Per drawing, WBOY1-11: how far the body sits below its highest (pixels) and how far it
// tips its head up (radians), read off the frames.
const BOB = [0, 1, 1, 0, 1, 4, 5, 7, 4, 4, 6];
const TIP = [0, 0, 0, 0.02, 0.02, 0, 0, 0.05, 0.14, 0.11, 0.04];
const SWING = 0.42; // part of a cycle each foot spends in the air
const THIGH = 0.42, SHIN = 0.36, PASTERN = 0.22; // of a leg's length
const KNEEL_HIP = 1.2; // metres above the ground when it kneels

const UP = new THREE.Vector3(0, 1, 0);
const Y = UP;
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = (k) => k * k * (3 - 2 * k);
const clamp = THREE.MathUtils.clamp;

// --- Building it --------------------------------------------------------------------------

// The body: the first drawing above the legs, swept round. Every few columns of the
// painting become a ring as tall as the paint in that column (narrower at the head), the
// rings are joined into one rounded low-poly shape, and the painting is projected onto it
// from the side, so it shows on both flanks.
const COLUMN = 3, RING = 8;
function bodyGeometry(sheet, m, depth) {
  const f = sheet.frames[0];
  const c = canvas(f.w, BODY_ROWS);
  const g = c.getContext('2d');
  g.drawImage(sheet.img, f.x, f.y, f.w, BODY_ROWS, 0, 0, f.w, BODY_ROWS);
  const img = g.getImageData(0, 0, f.w, BODY_ROWS);
  const p = img.data;
  const cols = [];
  for (let x = 1; x < f.w; x += COLUMN) {
    let a = -1, b = -1;
    for (let y = 0; y < BODY_ROWS; y++) if (p[(y * f.w + x) * 4 + 3] > 127) { if (a < 0) a = y; b = y + 1; }
    if (a >= 0) cols.push({ x, a, b });
  }
  fillEdges(p);
  g.putImageData(img, 0, 0);

  const pos = [], uv = [], index = [];
  const head = cols[0].x + 22; // the head and neck end about here
  cols.forEach(({ x, a, b }, i) => {
    const mid = (a + b) / 2, half = (b - a) / 2;
    const thick = (depth / 2) * (0.45 + 0.55 * THREE.MathUtils.smoothstep(x, head - 8, head + 8));
    for (let k = 0; k < RING; k++) {
      const t = (k / RING) * Math.PI * 2; // 0 is the top
      const y = mid - Math.cos(t) * half;
      pos.push(Math.sin(t) * thick, (BODY_ROWS - y) * m, (x - HIP_X) * m);
      // its back and belly show the paint just inside the painted outline, not the line itself
      uv.push(x / f.w, 1 - (mid - Math.cos(t) * Math.max(0, half - 3)) / BODY_ROWS);
    }
    if (i > 0) {
      for (let k = 0; k < RING; k++) {
        const a0 = (i - 1) * RING + k, a1 = (i - 1) * RING + ((k + 1) % RING), b0 = i * RING + k, b1 = i * RING + ((k + 1) % RING);
        index.push(a0, b0, b1, a0, b1, a1);
      }
    }
  });
  // Close both ends with a fan round a middle point.
  for (const [i, face] of [[0, 1], [cols.length - 1, -1]]) {
    const { x, a, b } = cols[i];
    const centre = pos.length / 3;
    pos.push(0, (BODY_ROWS - (a + b) / 2) * m, (x - HIP_X) * m);
    uv.push(x / f.w, 1 - (a + b) / 2 / BODY_ROWS);
    for (let k = 0; k < RING; k++) {
      const k0 = i * RING + k, k1 = i * RING + ((k + 1) % RING);
      index.push(...(face > 0 ? [centre, k0, k1] : [centre, k1, k0]));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return { geo, texture: crunchy(c) };
}

// See-through pixels take the average colour of the painted ones, so the edges of the
// painting don't show up dark on the model.
function fillEdges(p) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < p.length; i += 4) if (p[i + 3] > 127) { r += p[i]; g += p[i + 1]; b += p[i + 2]; n++; }
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] > 127) continue;
    p[i] = r / n; p[i + 1] = g / n; p[i + 2] = b / n; p[i + 3] = 255;
  }
}

// A leg's paint: down the first drawing's front leg, the middle of each row's painted span
// stretched to the width of the texture and wrapped round the cylinders.
function legTexture(sheet) {
  const f = sheet.frames[0];
  const from = BODY_ROWS + 4, to = 250;
  const c = canvas(16, to - from);
  const g = c.getContext('2d');
  const src = canvas(f.w, 256);
  const sg = src.getContext('2d');
  sg.drawImage(sheet.img, f.x, f.y, f.w, 256, 0, 0, f.w, 256);
  const data = sg.getImageData(0, 0, f.w, 256).data;
  for (let y = from; y < to; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < 56; x++) {
      const on = data[(y * f.w + x) * 4 + 3] > 127;
      if (on && a < 0) a = x;
      if (on) b = x + 1;
      else if (a >= 0) break; // just the first leg from the left
    }
    const inset = Math.floor((b - a) / 4); // the middle of the leg: the outline does its edges
    if (a >= 0) g.drawImage(src, a + inset, y, Math.max(1, b - a - inset * 2), 1, 0, y - from, 16, 1);
  }
  const t = crunchy(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.x = 2;
  return t;
}

// Back faces of a copy pushed out along its normals: a dark outline from every side.
function hull(geo, width, material) {
  const g = mergeVertices(geo.clone().deleteAttribute('uv').deleteAttribute('normal'));
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * width, p.getY(i) + n.getY(i) * width, p.getZ(i) + n.getZ(i) * width);
  }
  return new THREE.Mesh(g, material);
}

// A leg segment one unit long from y = 0 to 1 (stretched to length each frame), showing
// the part of the leg texture between v0 and v1.
function segment(r0, r1, v0, v1, mat, line, width) {
  const geo = new THREE.CylinderGeometry(r1, r0, 1, 6, 1, true).translate(0, 0.5, 0);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + (v1 - v0) * uv.getY(i));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.add(new THREE.Mesh(new THREE.CylinderGeometry(r1 + width, r0 + width, 1, 6, 1, true).translate(0, 0.5, 0), line));
  return mesh;
}

function knot(radius, mat, line, width, squash = 1) {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 0), mat);
  mesh.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius + width, 0), line));
  mesh.scale.y = squash;
  return mesh;
}

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

  const { geo: bodyGeo, texture: bodyTex } = bodyGeometry(sheet, m, depth);
  const body = new THREE.Group();
  body.rotation.order = 'YXZ';
  body.add(new THREE.Mesh(bodyGeo, new THREE.MeshLambertMaterial({ map: bodyTex, emissiveMap: bodyTex, emissive: 0x505050, flatShading: true, color: 0xe4dcdc })));
  body.add(hull(bodyGeo, line * 1.8, darkLine));
  bodyGeo.computeBoundingBox();
  const backTop = bodyGeo.boundingBox.max.y; // the top of its back, above the hips
  group.add(body);

  const legs = [-1, 1].map((s) => {
    const leg = {
      s,
      thigh: segment(0.36 * k, 0.29 * k, 1, 1 - THIGH, legMat, redLine, line),
      shin: segment(0.27 * k, 0.21 * k, 1 - THIGH, PASTERN, legMat, redLine, line),
      pastern: segment(0.2 * k, 0.15 * k, PASTERN, 0, legMat, redLine, line),
      knee: knot(0.4 * k, legMat, redLine, line),
      ankle: knot(0.31 * k, legMat, redLine, line),
      pad: knot(0.42 * k, legMat, redLine, line, 0.5),
      // the foot: where it is, and where a step goes from and to (k = 1 when planted)
      at: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), k: 1, time: 1, lift: 1,
      grow: 1, // the foot's size (the squash makes it huge)
      held: null, // a scripted position instead of walking (the stomp)
    };
    group.add(leg.thigh, leg.shin, leg.pastern, leg.knee, leg.ankle, leg.pad);
    return leg;
  });

  // shadow.png as its blob shadow, laid over the ground under the body every frame
  const shadowGeo = new THREE.PlaneGeometry(1, 1, 6, 4);
  const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({
    map: await loadTexture(def.shadow), color: 0x2a0010, transparent: true, opacity: 0.6, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  }));
  shadow.frustumCulled = false;
  const grid = [];
  for (let i = 0; i < shadowGeo.attributes.position.count; i++) {
    grid.push([shadowGeo.attributes.position.getX(i), shadowGeo.attributes.position.getY(i)]);
  }
  group.add(shadow);

  // --- State ---
  const pos = new THREE.Vector3(def.home[0], 0, def.home[2]); // the ground point under its hips
  const fwd = new THREE.Vector3(), side = new THREE.Vector3(), back = new THREE.Vector3();
  const v = new THREE.Vector3(), hip = new THREE.Vector3(), ankle = new THREE.Vector3();
  const knee = new THREE.Vector3(), dir = new THREE.Vector3(), bend = new THREE.Vector3(), pole = new THREE.Vector3();
  let heading = def.facing ?? 0;
  let speed = 0;
  let phase = 0;
  let crouch = 0; // 0 standing .. 1 kneeling
  let rear = 0; // rearing back, head up (the squash)
  let mode = 'wander'; // wander | watch | script | ridden
  let target = null; // where it is walking to
  let rest = rnd(1, 3); // seconds before it sets off again
  const home = new THREE.Vector3(...def.home); // where it wanders round
  let drive = 0, turning = 0; // ridden: his keys (W/S, A/D)
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
  // A foot comes down: felt more than heard, and the closer the more the screen shakes.
  function footfall(leg) {
    const d = camera.position.distanceTo(leg.at);
    sfx.thud(clamp(1.4 - d / 45, 0.15, 1.3), pan(leg.at));
    const riding = player.mount === thing ? 0.35 : 1;
    shake(clamp(0.55 - d / 70, 0, 0.55) * riding * (def.shake ?? 1));
  }

  // The legs from the hips to the feet. The knees bend forward, and up and out as it kneels;
  // the lowest part of each leg folds back flat on the ground.
  function placeLegs() {
    const fold = crouch * 1.35;
    for (const leg of legs) {
      body.localToWorld(hip.set(leg.s * spread, 0, 0));
      ankle.copy(leg.at).addScaledVector(UP, P * Math.cos(fold)).addScaledVector(back, P * Math.sin(fold));
      dir.subVectors(ankle, hip);
      const far = dir.length();
      dir.divideScalar(far || 1);
      const d = clamp(far, Math.abs(T - S) + 0.01, T + S - 0.01);
      ankle.copy(hip).addScaledVector(dir, d);
      const a = (T * T - S * S + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, T * T - a * a));
      pole.copy(fwd).addScaledVector(UP, 0.3 + crouch * 1.5).addScaledVector(side, leg.s * crouch * 0.5);
      bend.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
      knee.copy(hip).addScaledVector(dir, a).addScaledVector(bend, h);
      put(leg.thigh, hip, knee);
      put(leg.shin, knee, ankle);
      put(leg.pastern, ankle, leg.at);
      leg.knee.position.copy(knee);
      leg.ankle.position.copy(ankle);
      leg.pad.position.copy(leg.at);
      leg.pad.scale.set(leg.grow, leg.grow * 0.5, leg.grow);
    }
  }
  function put(mesh, a, b) {
    v.subVectors(b, a);
    const len = v.length();
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(Y, v.divideScalar(len || 1));
    mesh.scale.set(1, len, 1);
  }

  function layShadow() {
    const p = shadowGeo.attributes.position;
    const len = (backTop + 30 * m) * 1.6, wide = depth * 2.2;
    for (let i = 0; i < grid.length; i++) {
      const [lx, ly] = grid[i];
      const x = pos.x + fwd.x * (-lx * len) + side.x * (ly * wide);
      const z = pos.z + fwd.z * (-lx * len) + side.z * (ly * wide);
      p.setXYZ(i, x, heightAt(x, z) + 0.06, z);
    }
    p.needsUpdate = true;
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
      want = drive > 0 || cruise > 0 ? def.rideSpeed : 0;
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

    // The stride: a foot sets off at the start of each half of the cycle.
    const before = phase;
    phase = (phase + (dt * speed) / (def.speed * cycle)) % 1;
    const swingTime = cycle * SWING;
    const ahead = speed * swingTime + 0.29 * speed * cycle;
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

    // The body: over the hips' ground point, at leg height (lower as it kneels), bobbing
    // and tipping with the painting's drawings, swaying from foot to foot.
    const f = phase * 11;
    const i = Math.floor(f) % 11, j = (i + 1) % 11, w = f - Math.floor(f);
    const walking = Math.min(1, speed / def.speed);
    const bob = (BOB[i] + (BOB[j] - BOB[i]) * w) * m * walking;
    const tip = (TIP[i] + (TIP[j] - TIP[i]) * w) * walking;
    const stand = (T + S + P) * 0.96;
    body.position.set(pos.x, pos.y + stand + (KNEEL_HIP - stand) * crouch - bob, pos.z);
    body.rotation.set(tip - crouch * 0.12 + rear * 0.45, heading, Math.sin(phase * Math.PI * 2) * 0.035 * walking);
    body.updateMatrixWorld();
    placeLegs();
    layShadow();

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
    steer(forward, turn) {
      drive = forward;
      turning = turn;
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
