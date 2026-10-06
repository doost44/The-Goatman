import * as THREE from 'three';
import { loadImage, toCanvas, grade, crunchy, glowTexture } from './textures.js';
import { buildHead } from './goatman-head.js';
import {
  HIP, THIGH, SHIN, PASTERN, HOOF, BELLY, CHEST, NECK, UPPER_ARM, FOREARM, ACTIONS, createMotion,
} from './goatman-poses.js';

export { CYCLE } from './goatman-poses.js';

// GoatMan himself: a low-poly body built from tapered six-sided limbs, a shaped head
// (goatman-head.js) and a torso, textured with crops of Charlie's painting
// (assets/goatman/part-*.png) and animated in code (goatman-poses.js). Proportions and stoop
// follow the turnaround in "Goatman Himself/" (N front, Nturn1 three-quarter, Nturn2 side):
// a curved back, the head carried forward on a long neck, long arms hanging past the knees,
// and goat legs that bend backwards.
//
// The model faces -Z and stands on y = 0. Every joint is a Group. Limbs hang down (-Y)
// from their joint and a positive rotation.x swings them forward.

const DIR = 'assets/goatman/';
const PARTS = ['face-front', 'face-side', 'hair', 'chest', 'arm', 'hand', 'leg', 'hoof'];
const BLUES = [0x0f74e7, 0x0b51b3]; // the strands in head1-15 and backhead1-13

// Where the head ends up when it leaves the neck (in his own space): face down in the
// water when drinking, rolled over on the grass when it comes off.
const HEAD_TO = {
  drink: { pos: new THREE.Vector3(0, 0.12, -1.12), rot: new THREE.Euler(-1.45, 0, 0) },
  lose: { pos: new THREE.Vector3(0.3, 0.13, -1.0), rot: new THREE.Euler(0.3, 0.5, 1.57) },
};

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

// A tapered six-sided limb with rounded ends, from its joint down (or up). The rounded
// ends overlap at each bend like knuckles, so no gaps open between the limbs.
function limb(len, rJoint, rEnd, mat, up = false) {
  const profile = [[0, -rEnd * 0.9], [rEnd * 0.8, -rEnd * 0.45], [rEnd, 0], [rJoint, len], [rJoint * 0.8, len + rJoint * 0.45], [0, len + rJoint * 0.9]];
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 6);
  if (up) geo.rotateX(Math.PI).translate(0, len, 0); // the joint at the bottom, reaching up
  else geo.translate(0, -len, 0); // the joint at the top, hanging down
  return new THREE.Mesh(geo, mat);
}

export async function createGoatMan() {
  // Each part keeps its untouched pixels in `source`; setGrade() repaints the textures from them.
  const source = {};
  const tex = {};
  for (const p of PARTS) {
    source[p] = fillEdges(toCanvas(await loadImage(`${DIR}part-${p}.png`)));
    tex[p] = crunchy(toCanvas(source[p]));
  }
  for (const p of ['arm', 'leg', 'chest']) tex[p].wrapS = THREE.RepeatWrapping;
  tex.arm.repeat.x = tex.leg.repeat.x = 3;
  tex.chest.repeat.x = 2;

  const M = {};
  for (const p in tex) M[p] = new THREE.MeshLambertMaterial({ map: tex[p], flatShading: true });
  M.hair.side = THREE.DoubleSide; // its ragged edge is seen from below too
  M.hoof = new THREE.MeshLambertMaterial({ color: 0x2a1418, flatShading: true });
  M.shin = new THREE.MeshLambertMaterial({ map: tex.hoof, flatShading: true }); // hairy, dark at the bottom

  // A tapered six-sided cylinder from its joint, up or (usually) down, for the torso.
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

  // A long thin neck from the front of his hunched shoulders, carrying the head out ahead.
  const neck = joint(chest, 0, CHEST - 0.05, -0.08);
  const neckMesh = limb(NECK, 0.075, 0.062, M.chest, true);
  neck.add(neckMesh);
  const headMount = joint(neck, 0, NECK, 0); // where the head sits when it is on

  // The head is not a child of the neck, so it can come off: each frame it is placed at
  // headMount, or partway to wherever it is going.
  const head = buildHead({ face: M['face-front'], profile: M['face-side'], hair: M.hair });
  group.add(head);

  function arm(side) {
    const shoulder = joint(chest, side * 0.25, CHEST - 0.07, -0.02);
    shoulder.add(limb(UPPER_ARM, 0.058, 0.046, M.arm));
    const elbow = joint(shoulder, 0, -UPPER_ARM, 0);
    elbow.add(limb(FOREARM, 0.046, 0.036, M.arm));
    const wrist = joint(elbow, 0, -FOREARM, 0);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.05), M.hand);
    hand.position.y = -0.11;
    wrist.add(hand);
    const grip = joint(wrist, 0, -0.16, -0.07); // where a pebble sits in his palm
    return { shoulder, elbow, wrist, grip };
  }
  const armL = arm(-1), armR = arm(1);

  function leg(side) {
    const hip = joint(root, side * 0.11, 0, 0.03);
    const thigh = limb(THIGH, 0.12, 0.1, M.leg);
    hip.add(thigh);
    const knee = joint(hip, 0, -THIGH, 0);
    knee.add(limb(SHIN, 0.1, 0.075, M.leg));
    const ankle = joint(knee, 0, -SHIN, 0);
    ankle.add(limb(PASTERN, 0.075, 0.068, M.shin));
    const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.13, HOOF, 0.17), M.hoof);
    hoof.position.set(0, -PASTERN - HOOF / 2, -0.03);
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
    const a = i * 2.4, r = 0.012 + (i % 3) * 0.015;
    strands.push({
      m,
      neck: new THREE.Vector3(Math.cos(a) * r * 2, 0, Math.sin(a) * r * 1.5), // where it leaves the neck
      head: new THREE.Vector3(Math.sin(a) * r * 2.5, 0.01, Math.cos(a) * r * 2 - 0.02), // where it holds the head
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
  const motion = createMotion();
  let action = null; // { name, k, from, off, done, resolve }
  let detach = 0; // how far the head is off the neck
  let headTo = HEAD_TO.drink;
  let spray = -1; // backhead: below 0 the strands hold the head; 0..1 spraying out and fading
  let hold = 0; // right forearm raised to carry a pebble, 0..1
  let fling = 1; // a throw, 0..1 (1 = done)

  function apply(P) {
    root.position.y = P.hipY;
    root.rotation.set(0, P.twist, P.roll);
    belly.rotation.set(-P.lean, 0, P.sway);
    chest.rotation.set(-P.hunch, P.turn, 0);
    const bent = P.lean + P.hunch; // undoes the torso's bend for parts measured from the vertical
    neck.rotation.x = bent - P.neck;
    headMount.rotation.set(P.neck - P.head, P.look, 0);
    armL.shoulder.rotation.set(bent + P.armL, 0, -P.spreadL);
    armR.shoulder.rotation.set(bent + P.armR, 0, P.spreadR);
    armL.elbow.rotation.x = P.elbowL;
    armR.elbow.rotation.x = P.elbowR;
    armL.wrist.rotation.x = P.wristL;
    armR.wrist.rotation.x = P.wristR;
    legL.hip.rotation.x = P.thighL;
    legL.knee.rotation.x = P.shinL;
    legL.ankle.rotation.x = P.ankleL;
    legR.hip.rotation.x = P.thighR;
    legR.knee.rotation.x = P.shinR;
    legR.ankle.rotation.x = P.ankleR;
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
    // Play one of the ACTIONS; the promise resolves when it is done. `skip` goes straight
    // to its end (arriving in a level already kneeling).
    play(name, skip = false) {
      action?.resolve();
      headTo = HEAD_TO[name] ?? headTo;
      return new Promise((resolve) => {
        action = { name, k: skip ? 1 : 0, from: motion.pose, off: detach, resolve };
        if (skip) motion.set(ACTIONS[name].at(1, action.from, detach).pose);
      });
    },
    // Straight back to normal (a new game, a level change).
    reset() {
      action?.resolve();
      action = null;
      detach = 0;
      spray = -1;
      motion.reset();
    },
    get acting() { return !!action; },
    // move: { pos, yaw, speed, stride, grounded, vy, sprint, ground, float }, where ground is
    // the height of the ground under him (null over the void), for the shadow, and float
    // makes him weightless (the start screen).
    update(dt, move) {
      group.position.copy(move.pos);
      group.rotation.y = move.yaw;
      let scripted = null;
      if (action) {
        const a = ACTIONS[action.name];
        action.k = Math.min(1, action.k + dt / a.time);
        const now = a.at(action.k, action.from, action.off);
        scripted = now.pose;
        detach = now.detach ?? detach;
        spray = Math.min(1, now.spray ?? -1);
        if (action.k >= 1 && !action.done) {
          action.done = true;
          action.resolve();
          if (!a.hold) action = null;
        }
      }
      // Carrying a pebble, the right forearm comes up; throwing, the arm whips over.
      hold += ((gm.holding ? 1 : 0) - hold) * Math.min(1, dt * 8);
      fling = Math.min(1, fling + dt / 0.35);
      const P = motion.update(dt, move, scripted, hold);
      const whip = Math.sin(Math.PI * fling);
      P.armR += 1.8 * whip;
      P.elbowR -= 0.6 * whip;
      apply(P);
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
  apply(motion.update(0, { yaw: 0, speed: 0, stride: 0, grounded: true, vy: 0 }, null, 0));
  return gm;
}
