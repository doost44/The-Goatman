import * as THREE from 'three';
import { loadImage, toCanvas, grade, crunchy, glowTexture, canvas } from './textures.js';
import { STRIDE } from './player.js';

// GoatMan himself: a low-poly body (about 420 triangles) built from boxes and tapered
// six-sided cylinders, textured with crops of Charlie's painting (assets/goatman/part-*.png)
// and animated in code. Proportions and stoop follow the turnaround in "Goatman Himself/"
// (N front, Nturn1 three-quarter, Nturn2 side): a curved back, long arms hanging past
// the knees, and goat legs that bend backwards.
//
// The model faces -Z and stands on y = 0. Every joint is a Group. Limbs hang down (-Y)
// from their joint and a positive rotation.x swings them forward.

const DIR = 'assets/goatman/';
const PARTS = ['face-front', 'face-side', 'hair', 'chest', 'arm', 'hand', 'leg', 'hoof'];

const HIP = 0.96; // metres: he is about 1.9 m tall in his stoop
const THIGH = 0.38, SHIN = 0.38, PASTERN = 0.2;
const BELLY = 0.32, CHEST = 0.4, NECK = 0.08;
const UPPER_ARM = 0.48, FOREARM = 0.52;
const BLUES = [0x0f74e7, 0x0b51b3]; // the strands in head1-15 and backhead1-13

// The walk: one cycle is two footsteps (player.js plays one every STRIDE metres), split
// into the 18 painted walk frames. game.js eases into and out of the walk through three
// "turn" frames of 6 ticks each (0.3 s at 60 fps), and so does he.
export const CYCLE = 2 * STRIDE;
const FRAMES = 18;
const TURN = 0.3;

// A pose is a set of joint angles in radians. Neck, head and arm angles are measured
// from the vertical rather than from the bent torso, so the numbers are easy to read.
const STAND = {
  hipY: HIP, lean: 0.35, hunch: 0.5, neck: 0.3, head: -0.05, roll: 0, twist: 0,
  thighL: 0.3, shinL: -0.75, ankleL: 0.45, thighR: 0.3, shinR: -0.75, ankleR: 0.45,
  armL: 0.06, elbowL: 0.12, spreadL: 0.06, armR: 0.06, elbowR: 0.12, spreadR: 0.06,
};
// down6: on his knees, shins flat behind him, hands flat on the ground in front.
const KNEEL = {
  ...STAND, hipY: 0.44, lean: 0.6, hunch: 0.4, neck: 0.45, head: 0.2,
  thighL: 0.25, shinL: -1.82, ankleL: 0, thighR: 0.2, shinR: -1.77, ankleR: 0,
  armL: 0.8, elbowL: 0, spreadL: 0.14, armR: 0.8, elbowR: 0, spreadR: 0.14,
};
// Reaching out to pet the Walking Thing: straightened up, one long arm raised.
const REACH = { ...STAND, lean: 0.1, hunch: 0.2, neck: 0.1, head: -0.45, armR: 2.3, elbowR: 0.3, spreadR: 0, armL: 0.3 };
// Where the head ends up when it leaves the neck (in his own space): face down in the
// water when drinking, rolled over on the grass when it comes off.
const HEAD_DRINK = { pos: new THREE.Vector3(0, 0.18, -1.12), rot: new THREE.Euler(-1.45, 0, 0) };
const HEAD_LOST = { pos: new THREE.Vector3(0.3, 0.16, -1.0), rot: new THREE.Euler(0.3, 0.5, 1.57) };

// Fills the see-through pixels of a crop with the average colour of the rest, so the
// edges of the painting don't show up black on the model.
function fillEdges(c) {
  const g = c.getContext('2d');
  const img = g.getImageData(0, 0, c.width, c.height);
  const p = img.data;
  let r = 0, gr = 0, b = 0, n = 0;
  for (let i = 0; i < p.length; i += 4) if (p[i + 3] > 127) { r += p[i]; gr += p[i + 1]; b += p[i + 2]; n++; }
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] > 127) continue;
    p[i] = r / n; p[i + 1] = gr / n; p[i + 2] = b / n; p[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function mirror(c) {
  const m = canvas(c.width, c.height);
  const g = m.getContext('2d');
  g.scale(-1, 1);
  g.drawImage(c, -c.width, 0);
  return m;
}

const clamp01 = (k) => Math.min(1, Math.max(0, k));
const ease = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };
const mix = (a, b, k) => {
  const out = {};
  for (const key in STAND) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
};

// Scripted actions from the paintings. at(k, from, off) gives the pose at progress k
// (0..1) starting from the pose he was in, and how far the head is off the neck (0..1).
// "hold" keeps the last pose until the next action.
const ACTIONS = {
  // down1-6: down onto his knees.
  kneel: { time: 1.2, hold: true, at: (k, from) => ({ pose: mix(from, KNEEL, ease(k)) }) },
  // head1-15: kneeling, the head sinks to the ground on stretching blue strands (drinking).
  drink: { time: 2.6, hold: true, at: (k, from) => ({
    pose: mix(from, KNEEL, ease(k / 0.4)), detach: ease((k - 0.35) / 0.65), head: HEAD_DRINK,
  }) },
  // Head back on, then up again.
  stand: { time: 1.5, at: (k, from, off) => ({
    pose: mix(from, STAND, ease((k - 0.35) / 0.65)), detach: off * (1 - ease(k / 0.4)),
  }) },
  // Reach up, a pat, back down.
  pet: { time: 2.4, at: (k, from) => ({ pose: mix(from, REACH, ease(k / 0.35) - ease((k - 0.7) / 0.3)) }) },
  // head1-15 then backhead1-13: the death after being SQUASHED. Down on his knees, the
  // head drops off onto the grass, and the blue strands spray out of the neck and fade.
  lose: { time: 3.6, hold: true, at: (k, from) => ({
    pose: mix(from, KNEEL, ease(k / 0.3)), detach: clamp01((k - 0.25) / 0.3) ** 2, head: HEAD_LOST, spray: (k - 0.55) / 0.45,
  }) },
};

export async function createGoatMan() {
  // Each part keeps its untouched pixels in `source`; setGrade() repaints the textures from them.
  const source = {};
  const tex = {};
  for (const p of PARTS) {
    source[p] = fillEdges(toCanvas(await loadImage(`${DIR}part-${p}.png`)));
    tex[p] = crunchy(toCanvas(source[p]));
  }
  // The sides of the head show only the back half of the profile (cheek, ear, hair):
  // with the whole profile there, a three-quarter view showed two faces. It is painted
  // looking left, so his right side gets it mirrored.
  source['face-right'] = mirror(source['face-side']);
  tex['face-right'] = crunchy(toCanvas(source['face-right']));
  tex['face-side'].repeat.x = tex['face-right'].repeat.x = 0.5;
  tex['face-side'].offset.x = 0.5;
  for (const p of ['arm', 'leg', 'chest']) tex[p].wrapS = THREE.RepeatWrapping;
  tex.arm.repeat.x = tex.leg.repeat.x = 3;
  tex.chest.repeat.x = 2;
  tex.hair.repeat.y = 0.65; // only the dark top of the crop, not the forehead under it
  tex.hair.offset.y = 0.35;

  const M = {};
  for (const p in tex) M[p] = new THREE.MeshLambertMaterial({ map: tex[p], flatShading: true });
  M.hoof = new THREE.MeshLambertMaterial({ color: 0x2a1418, flatShading: true });
  M.shin = new THREE.MeshLambertMaterial({ map: tex.hoof, flatShading: true }); // hairy, dark at the bottom

  // A tapered six-sided limb from its joint, up or (usually) down. Limbs reach a little
  // past the next joint so the bends don't open up gaps.
  const cylinder = (len, rTop, rBottom, mat, up = false) => {
    const geo = new THREE.CylinderGeometry(rTop, rBottom, len + 0.04, 6, 1);
    geo.translate(0, up ? len / 2 : -len / 2, 0);
    return new THREE.Mesh(geo, mat);
  };
  const joint = (parent, x, y, z) => {
    const j = new THREE.Group();
    j.position.set(x, y, z);
    parent.add(j);
    return j;
  };

  // --- The body ------------------------------------------------------------------------
  const group = new THREE.Group(); // at his hooves, turned to face where he is going
  const root = joint(group, 0, HIP, 0); // the pelvis
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.28), M.leg);
  root.add(pelvis);
  const belly = joint(root, 0, 0, 0);
  const bellyMesh = cylinder(BELLY + 0.04, 0.24, 0.2, M.chest, true);
  belly.add(bellyMesh);
  const chest = joint(belly, 0, BELLY - 0.05, 0);
  const chestMesh = cylinder(CHEST, 0.28, 0.24, M.chest, true);
  chest.add(chestMesh);
  for (const m of [bellyMesh, chestMesh]) m.scale.z = 0.8; // flatter front to back

  const neck = joint(chest, 0, CHEST - 0.04, -0.06);
  const neckMesh = cylinder(NECK + 0.08, 0.08, 0.1, M.chest, true);
  neck.add(neckMesh);
  const headMount = joint(neck, 0, NECK, 0); // where the head sits when it is on

  // The head is not a child of the neck, so it can come off: each frame it is placed at
  // headMount, or partway to wherever it is going.
  const head = new THREE.Group();
  group.add(head);
  // Box faces: +X (his right), -X (his left), top, bottom, back, front.
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.32), [
    M['face-right'], M['face-side'], M.hair, M['face-front'], M.hair, M['face-front'],
  ]);
  face.position.set(0, 0.18, -0.04);
  const mop = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.32), M.hair); // the dark hair
  mop.position.set(0, 0.35, 0.02);
  const mopBack = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.28, 0.1), M.hair);
  mopBack.position.set(0, 0.22, 0.14);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.07), M.chest); // for the profile
  nose.position.set(0, 0.15, -0.23);
  head.add(face, mop, mopBack, nose);

  function arm(side) {
    const shoulder = joint(chest, side * 0.25, CHEST - 0.07, -0.02);
    shoulder.add(cylinder(UPPER_ARM, 0.055, 0.045, M.arm));
    const elbow = joint(shoulder, 0, -UPPER_ARM, 0);
    elbow.add(cylinder(FOREARM, 0.045, 0.035, M.arm));
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.05), M.hand);
    hand.position.y = -FOREARM - 0.11;
    elbow.add(hand);
    const grip = joint(elbow, 0, -FOREARM - 0.16, -0.07); // where a pebble sits in his palm
    return { shoulder, elbow, grip };
  }
  const armL = arm(-1), armR = arm(1);

  function leg(side) {
    const hip = joint(root, side * 0.11, 0, 0.03);
    const thigh = cylinder(THIGH, 0.12, 0.1, M.leg);
    hip.add(thigh);
    const knee = joint(hip, 0, -THIGH, 0);
    knee.add(cylinder(SHIN, 0.1, 0.075, M.leg));
    const ankle = joint(knee, 0, -SHIN, 0);
    ankle.add(cylinder(PASTERN, 0.075, 0.07, M.shin));
    const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.17), M.hoof);
    hoof.position.set(0, -PASTERN - 0.03, -0.03);
    ankle.add(hoof);
    return { hip, knee, ankle, thigh };
  }
  const legL = leg(-1), legR = leg(1);

  // In first person only his lower legs are drawn: look down to see the hooves.
  const hideInFirstPerson = [pelvis, legL.thigh, legR.thigh, bellyMesh, chestMesh, neckMesh, head, armL.shoulder, armR.shoulder];
  let firstPerson = false;

  // Blue strands between the neck and the head while it is off (head1-15).
  const strandGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5); // grows along +Z
  const strandMats = BLUES.map((color) => new THREE.MeshBasicMaterial({ color, transparent: true }));
  const strands = [];
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(strandGeo, strandMats[i % 2]);
    m.visible = false;
    group.add(m);
    const a = i * 2.4, r = 0.015 + (i % 3) * 0.018;
    strands.push({
      m,
      neck: new THREE.Vector3(Math.cos(a) * r * 2, 0, Math.sin(a) * r * 1.5), // where it leaves the neck
      head: new THREE.Vector3(Math.sin(a) * r * 2.5, 0.02, Math.cos(a) * r * 2), // where it holds the head
      spray: new THREE.Vector3(Math.cos(a) * 0.8, 1.4 + (i % 4) * 0.35, 0.6 + Math.sin(a) * 0.5), // backhead1-13
      width: 0.018 + (i % 3) * 0.01,
    });
  }

  // Blob shadow (third person only): a soft dark disc on the ground under him.
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: glowTexture([[0, 'rgba(0,0,0,0.6)'], [0.55, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']], 16),
      transparent: true, depthWrite: false, fog: false,
    }),
  );
  shadow.renderOrder = 1;

  // --- Posing ----------------------------------------------------------------------------
  let J = { ...STAND }; // the pose drawn this frame
  let t = 0;
  let walk = 0; // 0 standing .. 1 walking, through the turn frames
  let air = 0;
  let airTime = 0;
  let land = 0; // knees give on landing, 1 .. 0
  let wasGrounded = true;
  let action = null; // { name, k, from, off, done, resolve }
  let detach = 0; // how far the head is off the neck
  let headTo = HEAD_DRINK;
  let spray = -1; // backhead: below 0 the strands hold the head; 0..1 spraying out and fading
  let hold = 0; // right forearm raised to carry a pebble, 0..1
  let fling = 1; // a throw, 0..1 (1 = done)

  function apply() {
    root.position.y = J.hipY;
    root.rotation.set(0, J.twist, J.roll);
    belly.rotation.x = -J.lean;
    chest.rotation.x = -J.hunch;
    const bent = J.lean + J.hunch; // undoes the torso's bend for parts measured from the vertical
    neck.rotation.x = bent - J.neck;
    headMount.rotation.x = J.neck - J.head;
    armL.shoulder.rotation.set(bent + J.armL, 0, -J.spreadL);
    armR.shoulder.rotation.set(bent + J.armR, 0, J.spreadR);
    armL.elbow.rotation.x = J.elbowL;
    armR.elbow.rotation.x = J.elbowR;
    legL.hip.rotation.x = J.thighL;
    legL.knee.rotation.x = J.shinL;
    legL.ankle.rotation.x = J.ankleL;
    legR.hip.rotation.x = J.thighR;
    legR.knee.rotation.x = J.shinR;
    legR.ankle.rotation.x = J.ankleR;
  }

  // Walking, standing, jumping and landing, worked out fresh every frame.
  function locomotion(dt, { speed, stride, grounded, vy }) {
    walk = clamp01(walk + (speed > 0.15 ? dt : -dt) / TURN);
    air = clamp01(air + (grounded ? -dt : dt) * 8);
    if (grounded && !wasGrounded && airTime > 0.25) land = 1;
    airTime = grounded ? 0 : airTime + dt;
    wasGrounded = grounded;
    land = Math.max(0, land - dt / 0.35);

    const w = ease(walk);
    const frame = Math.floor((stride / CYCLE) * FRAMES); // which of the 18 painted frames
    const ph = (frame / FRAMES) * Math.PI * 2;
    const s = Math.sin(ph), c = Math.cos(ph);
    const p = { ...STAND };
    // Idle sway, as if breathing.
    p.lean += 0.03 * Math.sin(t * 1.3) * (1 - w);
    p.hipY += 0.01 * Math.sin(t * 2.6) * (1 - w);
    p.armL += 0.04 * Math.sin(t * 1.1) * (1 - w);
    p.armR += 0.04 * Math.sin(t * 1.1 + 1.3) * (1 - w);
    // The left hoof lands at the start of the cycle and the right one halfway. Legs swing
    // from the hip; the backward knee folds up while a leg comes forward.
    p.thighL += 0.55 * c * w;
    p.thighR -= 0.55 * c * w;
    p.shinL -= 0.7 * Math.max(0, -s) * w;
    p.shinR -= 0.7 * Math.max(0, s) * w;
    p.ankleL += 0.35 * Math.max(0, -s) * w;
    p.ankleR += 0.35 * Math.max(0, s) * w;
    p.hipY -= 0.06 * Math.abs(c) * w; // lowest as each hoof lands
    p.lean += 0.08 * w;
    p.roll = 0.04 * c * w;
    p.twist = 0.1 * c * w;
    p.head -= 0.08 * w; // he looks ahead
    // Long arms swing low and loose, against the legs.
    p.armL -= 0.4 * c * w;
    p.armR += 0.4 * c * w;
    p.elbowL += 0.3 * Math.max(0, c) * w;
    p.elbowR += 0.3 * Math.max(0, -c) * w;
    // In the air: knees tucked going up; legs reaching and arms flailing coming down.
    if (air > 0) {
      const up = vy > 0 ? air : 0;
      const down = vy > 0 ? 0 : air * Math.min(1, -vy / 12);
      p.thighL += 0.5 * up; p.thighR += 0.7 * up;
      p.shinL -= 0.7 * up; p.shinR -= 0.5 * up;
      p.armL -= 0.3 * up; p.armR -= 0.3 * up;
      p.spreadL += 0.3 * air; p.spreadR += 0.3 * air;
      p.armL += down * (0.9 + 0.5 * Math.sin(t * 9));
      p.armR += down * (0.9 + 0.5 * Math.sin(t * 9 + 2));
      p.thighL -= 0.2 * down; p.thighR += 0.3 * down;
      p.head -= 0.4 * down;
    }
    // Landing: the knees give and he hunches over.
    const l = ease(land);
    p.hipY -= 0.2 * l;
    p.thighL += 0.5 * l; p.thighR += 0.5 * l;
    p.shinL -= 0.9 * l; p.shinR -= 0.9 * l;
    p.ankleL += 0.4 * l; p.ankleR += 0.4 * l;
    p.lean += 0.25 * l;
    p.armL += 0.3 * l; p.armR += 0.3 * l;
    return p;
  }

  // The head: on the neck, partway off it, or off. The strands follow it.
  const onPos = new THREE.Vector3(), onQuat = new THREE.Quaternion(), scale = new THREE.Vector3();
  const offQuat = new THREE.Quaternion();
  const inverse = new THREE.Matrix4(), local = new THREE.Matrix4();
  const from = new THREE.Vector3(), to = new THREE.Vector3(), dir = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  function placeHead() {
    group.updateMatrixWorld(true);
    local.multiplyMatrices(inverse.copy(group.matrixWorld).invert(), headMount.matrixWorld);
    local.decompose(onPos, onQuat, scale);
    offQuat.setFromEuler(headTo.rot);
    head.position.lerpVectors(onPos, headTo.pos, detach);
    head.quaternion.slerpQuaternions(onQuat, offQuat, detach);

    const show = detach > 0.01 && spray < 1 && head.visible;
    for (const s of strands) {
      s.m.visible = show;
      if (!show) continue;
      from.copy(s.neck).applyQuaternion(onQuat).add(onPos);
      if (spray < 0) {
        to.copy(s.head).applyQuaternion(head.quaternion).add(head.position);
      } else {
        // Snapped: each strand flicks up and back out of the neck, falls and shrinks.
        from.addScaledVector(s.spray, spray * 0.5);
        from.y -= 1.2 * spray * spray;
        to.copy(s.spray).normalize().multiplyScalar(0.12 * (1 - spray)).add(from);
      }
      dir.subVectors(to, from);
      const len = Math.max(0.001, dir.length());
      s.m.position.copy(from);
      s.m.quaternion.setFromUnitVectors(Z, dir.divideScalar(len));
      s.m.scale.set(s.width, s.width, len);
    }
    for (const m of strandMats) m.opacity = spray > 0 ? 1 - spray : 1;
  }

  const gm = {
    group,
    shadow,
    materials: M,
    // Re-colour him for a level with that scene's applyContrastAndSaturation values.
    setGrade(values) {
      for (const p in tex) {
        const c = tex[p].image;
        const g2 = c.getContext('2d');
        g2.clearRect(0, 0, c.width, c.height);
        g2.drawImage(source[p], 0, 0);
        if (values) grade(c, values);
        tex[p].needsUpdate = true;
      }
    },
    setFirstPerson(on) {
      firstPerson = on;
      for (const o of hideInFirstPerson) o.visible = !on;
    },
    get firstPerson() { return firstPerson; },
    holding: false, // carrying a pebble (rocks.js)
    throwArm() { fling = 0; },
    handWorld: (v) => armR.grip.getWorldPosition(v),
    // Play one of the ACTIONS; the promise resolves when it is done.
    play(name) {
      action?.resolve();
      if (name === 'drink') headTo = HEAD_DRINK;
      if (name === 'lose') headTo = HEAD_LOST;
      return new Promise((resolve) => {
        action = { name, k: 0, from: { ...J }, off: detach, resolve };
      });
    },
    // Straight back to normal (a new game, a level change).
    reset() {
      action?.resolve();
      action = null;
      detach = 0;
      spray = -1;
      walk = air = land = 0;
    },
    get acting() { return !!action; },
    // move: { pos, yaw, speed, stride, grounded, vy, ground }, where ground is the height
    // of the ground under him (null over the void), for the shadow.
    update(dt, move) {
      t += dt;
      group.position.copy(move.pos);
      group.rotation.y = move.yaw;
      let target = locomotion(dt, move);
      // Carrying a pebble, the right forearm comes up; throwing, the arm whips over.
      hold += ((gm.holding ? 1 : 0) - hold) * Math.min(1, dt * 8);
      fling = Math.min(1, fling + dt / 0.35);
      const whip = Math.sin(Math.PI * fling);
      target.armR += (0.6 - target.armR) * hold + 1.8 * whip;
      target.elbowR += (1.3 - target.elbowR) * hold - 0.6 * whip;
      if (action) {
        const a = ACTIONS[action.name];
        action.k = Math.min(1, action.k + dt / a.time);
        const now = a.at(action.k, action.from, action.off);
        target = now.pose;
        detach = now.detach ?? detach;
        spray = Math.min(1, now.spray ?? -1);
        if (action.k >= 1 && !action.done) {
          action.done = true;
          action.resolve();
          if (!a.hold) action = null;
        }
      }
      J = mix(J, target, Math.min(1, dt * 14)); // a little smoothing between poses
      apply();
      placeHead();

      shadow.visible = !firstPerson && move.ground !== null;
      if (shadow.visible) {
        const h = move.pos.y - move.ground;
        shadow.position.set(move.pos.x, move.ground + 0.04, move.pos.z);
        shadow.scale.setScalar(Math.max(0.3, 1 - h / 8));
        shadow.material.opacity = Math.max(0, 1 - h / 10);
      }
    },
  };
  apply();
  return gm;
}
