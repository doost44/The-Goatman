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
  let t = 0;

  return {
    scene,
    camera,
    visible: true,
    // Same mood as the level: copy its ambient and sun.
    light(def) {
      ambient.color.set(def.ambient.color);
      ambient.intensity = def.ambient.intensity;
      sun.color.set(def.sun.color);
      sun.intensity = def.sun.intensity;
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
      for (const a of arms) {
        const swing = Math.cos(ph) * a.side * 0.18 * speed + 0.03 * Math.sin(t * 1.1 + a.side);
        a.shoulder.rotation.set(hang + swing + (grounded ? 0 : -0.3), 0, -INWARD * a.side);
        a.elbow.rotation.x = ELBOW + Math.max(0, swing) * 0.5;
        a.wrist.rotation.x = WRIST - swing * 0.6;
      }
      rig.position.y = -lower * 0.8 - Math.abs(Math.sin(ph)) * 0.03 * speed;
    },
  };
}
