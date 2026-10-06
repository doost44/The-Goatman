import * as THREE from 'three';
import { CYCLE } from './goatman.js';

// First-person arms, Half-Life style: GoatMan's two long red arms dangle at the bottom
// of the screen and swing with his stride. They live in their own little scene, drawn
// after the world with the depth buffer cleared, so they never poke into walls.
// They use his body's materials, so the level's colour grade applies to them too.

const SHOULDER = [0.5, -0.36, 0.05]; // right shoulder, in camera space (the left is mirrored)
const REACH = 1.35; // how far forward the arms hang (radians from straight down)
const INWARD = 0.1;
const ELBOW = 0.3;
const WRIST = -0.8; // the hands droop
const UPPER = 0.46, FORE = 0.46;
const HOLD = { shoulder: 1.1, elbow: 0.8, wrist: -0.3, inward: 0.1 }; // right arm carrying a pebble
const PAT = { shoulder: 2.3, elbow: 0.2, wrist: 0.3, time: 2.4 }; // right arm reaching up to pet

export function createArms(materials) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.01, 10);
  const ambient = new THREE.AmbientLight(0xffffff, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(0.3, 1, 0.4);
  const rig = new THREE.Group(); // everything moves together for the bob
  scene.add(ambient, sun, rig);

  function limb(len, rTop, rBottom) {
    const geo = new THREE.CylinderGeometry(rTop, rBottom, len, 6, 1).translate(0, -len / 2, 0);
    return new THREE.Mesh(geo, materials.arm);
  }
  function arm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(SHOULDER[0] * side, SHOULDER[1], SHOULDER[2]);
    shoulder.add(limb(UPPER, 0.06, 0.05));
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER;
    elbow.add(limb(FORE, 0.05, 0.04));
    const wrist = new THREE.Group();
    wrist.position.y = -FORE;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.05), materials.hand);
    hand.position.y = -0.1;
    wrist.add(hand);
    elbow.add(wrist);
    shoulder.add(elbow);
    rig.add(shoulder);
    return { side, shoulder, elbow, wrist };
  }
  const arms = [arm(-1), arm(1)];
  const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.05, 0), new THREE.MeshLambertMaterial({ color: 0x8e93ac, flatShading: true }));
  pebble.position.set(0, -0.19, -0.06);
  pebble.scale.y = 0.8;
  arms[1].wrist.add(pebble);
  let t = 0;
  let hold = 0; // 0..1 raising the right hand with a pebble in it
  let fling = 1; // a throw, 0..1 (1 = done)
  let patting = 1; // petting, 0..1 (1 = done)

  const api = {
    scene,
    camera,
    visible: true,
    holding: false, // carrying a pebble (rocks.js)
    throwArm() { fling = 0; },
    pat() { patting = 0; },
    // Where the pebble in his hand is, in camera space.
    handPos: (v) => pebble.getWorldPosition(v),
    // Same mood as the level: copy its ambient and sun lights (every frame, as they can change).
    light(level) {
      ambient.color.copy(level.ambient.color);
      ambient.intensity = level.ambient.intensity;
      sun.color.copy(level.sun.color);
      sun.intensity = level.sun.intensity;
    },
    // pitch: where the view points (negative looking down). lower: 0..1 slides the arms
    // out of sight while the camera moves out to third person.
    update(dt, { stride, speed, grounded, pitch, lower, fov, aspect }) {
      t += dt;
      camera.fov = fov;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      const ph = (stride / CYCLE) * Math.PI * 2;
      // Looking down, the arms hang towards the ground (straight into the view).
      const hang = THREE.MathUtils.lerp(REACH, Math.PI / 2, Math.max(0, -pitch) / (Math.PI / 2)) - Math.max(0, pitch) * 0.8;
      hold += ((api.holding ? 1 : 0) - hold) * Math.min(1, dt * 8);
      fling = Math.min(1, fling + dt / 0.3);
      const whip = Math.sin(Math.PI * fling);
      patting = Math.min(1, patting + dt / PAT.time);
      const reach = Math.sin(Math.PI * patting) ** 0.5; // up, held there, down
      const tap = Math.sin(patting * Math.PI * 8) * 0.12 * reach;
      for (const a of arms) {
        const swing = Math.cos(ph) * a.side * 0.18 * speed + 0.03 * Math.sin(t * 1.1 + a.side);
        a.shoulder.rotation.set(hang + swing + (grounded ? 0 : -0.3), 0, -INWARD * a.side);
        a.elbow.rotation.x = ELBOW + Math.max(0, swing) * 0.5;
        a.wrist.rotation.x = WRIST - swing * 0.6;
        if (a.side === 1) { // the pebble hand comes up into view; a throw whips it forward
          a.shoulder.rotation.x += (HOLD.shoulder - a.shoulder.rotation.x) * hold + whip * 0.9;
          a.shoulder.rotation.z -= HOLD.inward * hold;
          a.elbow.rotation.x += (HOLD.elbow - a.elbow.rotation.x) * hold - whip * 0.5;
          a.wrist.rotation.x += (HOLD.wrist - a.wrist.rotation.x) * hold;
          a.shoulder.rotation.x += (PAT.shoulder - a.shoulder.rotation.x) * reach + tap;
          a.elbow.rotation.x += (PAT.elbow - a.elbow.rotation.x) * reach;
          a.wrist.rotation.x += (PAT.wrist - a.wrist.rotation.x) * reach - tap;
        }
      }
      pebble.visible = api.holding;
      rig.position.y = -lower * 0.8 - Math.abs(Math.sin(ph)) * 0.03 * speed;
    },
  };
  return api;
}
