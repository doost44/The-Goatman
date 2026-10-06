import * as THREE from 'three';
import { createChunkedTerrain } from '../chunks.js';
import { loadTexture, rng } from '../textures.js';
import { buildSkyDome, buildFarLand } from './horizon.js';
import { buildLandmarks } from './landmarks.js';
import { createScatter } from './scatter.js';

// A test level for big worlds, not part of the story (admin mode only: ?admin&level=expanse,
// or 5 while flying). 2 km of rolling land in chunks, far hills beyond its edge, landmarks
// on the skyline, and loose stones to give a sense of speed. The red field and the savanna
// are built the same way: createChunkedTerrain for the ground, buildFarLand past the fog,
// buildLandmarks for the big shapes, a scatter for the small ones.

export async function buildExpanse(def, { camera }) {
  const group = new THREE.Group();
  const r = rng(def.seed);
  const fog = new THREE.Color(def.fog.color); // the haze follows the fog (levels may change it)

  const floor = await loadTexture(def.terrain.texture, 1);
  const groundMat = new THREE.MeshLambertMaterial({ map: floor, color: new THREE.Color(...def.terrain.tint) });
  const terrain = createChunkedTerrain(def.terrain, groundMat);
  const { heightAt } = terrain;
  const far = buildFarLand(def.horizon, terrain.height, { center: def.terrain.center, cut: def.terrain.view - 20, fogColor: fog, sun: def.sun.dir });
  const sky = await buildSkyDome(def.skyDome, def.fog.color);
  const marks = buildLandmarks(def.landmarks, def.landmarkLook, heightAt, fog);
  const stones = buildStones(def.stones, terrain, r);
  group.add(terrain.group, far, sky, marks.group, ...stones.meshes);

  return {
    group,
    ground: [terrain.ground],
    colliders: marks.colliders,
    blockers: [],
    actors: {},
    heightAt,
    chunks: terrain, // the admin box and map show what it has built
    update() {
      sky.position.copy(camera.position);
    },
    beforeRender(cam) {
      terrain.update(cam);
      stones.update(cam);
    },
    dispose() {
      terrain.dispose();
    },
  };
}

// Stones lying about, a few kinds of lumpy low-poly rock in a scatter.
function buildStones(d, terrain, r) {
  const scatter = createScatter({ reach: d.reach });
  const mat = new THREE.MeshLambertMaterial({ color: d.color, flatShading: true });
  const kinds = [0, 1, 2].map((k) => {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (1 + 0.3 * Math.sin(i * 1.7 + k)), pos.getY(i) * 0.6, pos.getZ(i) * (1 + 0.3 * Math.cos(i * 2.3 + k)));
    geo.computeVertexNormals();
    return scatter.kind(geo, mat);
  });
  const { x0, z0, x1, z1 } = terrain.bounds;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const tint = new THREE.Color();
  for (let i = 0; i < d.count; i++) {
    const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
    const size = d.size[0] + r() ** 3 * (d.size[1] - d.size[0]); // mostly small
    p.set(x, terrain.heightAt(x, z) - size * 0.2, z);
    q.setFromEuler(e.set(r() * 0.4, r() * Math.PI * 2, r() * 0.4));
    s.set(size, size, size);
    scatter.add(kinds[i % 3], m.compose(p, q, s), tint.setScalar(0.75 + r() * 0.35));
  }
  return { meshes: scatter.done(), update: (camera) => scatter.update(camera) };
}
