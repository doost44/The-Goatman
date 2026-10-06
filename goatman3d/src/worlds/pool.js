import * as THREE from 'three';
import { loadTexture } from '../textures.js';
import { drape } from '../terrain.js';

// The orange and blue swirl pool (thepool.png), kept for the final level: a small round
// pool, the painting's rings (an ellipse seen from the side) laid flat so they are round.
// They shimmer and turn very slowly. GoatMan drinks from it with story.actions.drink
// (an interaction { type: "drink", at } and an outcome "drink": { edge, hold, shot }).
//
// d: { at: [x, z], radius, texture }
export async function buildPool(d, heightAt) {
  const map = await loadTexture(d.texture);
  map.center.set(0.5, 0.5);
  const [x, z] = d.at;
  const mesh = new THREE.Mesh(
    drape(new THREE.CircleGeometry(d.radius, 20).rotateX(-Math.PI / 2).translate(x, 0, z), heightAt, 0.06),
    new THREE.MeshBasicMaterial({ map, alphaTest: 0.5 }),
  );
  return {
    mesh,
    collider: { kind: 'circle', x, z, r: d.radius - 0.5 },
    // dim: how dark the level has got (1 = not at all)
    update(t, dim = 1) {
      map.rotation = t * 0.04;
      mesh.material.color.setScalar((0.85 + 0.1 * Math.sin(t * 1.3)) * (0.5 + 0.5 * dim));
    },
  };
}
