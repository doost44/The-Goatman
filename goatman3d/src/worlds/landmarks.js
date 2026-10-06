import * as THREE from 'three';
import { valueNoise } from '../terrain.js';
import { haze } from './horizon.js';

// Big shapes seen from anywhere in a big level, so the far distance has things in it to walk
// toward: peaks, spires, mesas, standing stones. Each is a THREE.LOD: real geometry up close
// and a few dozen triangles far off (the same outline, sampled more coarsely), hazed toward
// the fog by distance rather than hidden by it.
//
// levels.json "landmarks": [{ kind, at: [x, z], size: [radius, height], color?, seed? }]
//   and "landmarkLook": { color, swap (metres where the real one takes over), haze: [from, to, most] }

// Profiles: [height 0..1, radius 0..1] from the ground up, and how many sides.
const KINDS = {
  peak: { sides: 9, profile: [[0, 1], [0.3, 0.72], [0.6, 0.42], [0.85, 0.16], [1, 0.02]], jag: 0.3 },
  spire: { sides: 7, profile: [[0, 1], [0.12, 0.6], [0.5, 0.45], [0.9, 0.36], [1, 0.08]], jag: 0.2 },
  mesa: { sides: 10, profile: [[0, 1], [0.15, 0.86], [0.8, 0.74], [0.9, 0.62], [0.9, 0]], jag: 0.15 },
  stone: { sides: 4, profile: [[0, 1], [0.85, 0.82], [1, 0.4]], jag: 0.1 },
};

// The shape as rings of points round the middle: `rows` rows up the profile and `sides`
// points round each, the same bumps (jag) at the same angle and height on every detail.
function shape(kind, [radius, tall], seed, sides, split, ground) {
  const { profile, jag } = KINDS[kind];
  const rows = [];
  for (let p = 0; p < profile.length - 1; p++) {
    for (let q = 0; q < split; q++) {
      const k = q / split;
      rows.push([profile[p][0] + (profile[p + 1][0] - profile[p][0]) * k, profile[p][1] + (profile[p + 1][1] - profile[p][1]) * k]);
    }
  }
  rows.push(profile[profile.length - 1]);
  const pos = [], index = [];
  for (const [y, r] of rows) {
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const bump = 1 + jag * valueNoise(Math.cos(a) * 2.5 + seed, y * 4 + Math.sin(a) * 2.5 - seed);
      const x = Math.cos(a) * r * radius * bump, z = Math.sin(a) * r * radius * bump;
      pos.push(x, y === 0 ? ground(x, z) : y * tall, z); // the foot follows the ground under it
    }
  }
  for (let j = 0; j < rows.length - 1; j++) {
    for (let s = 0; s < sides; s++) {
      const a = j * sides + s, b = j * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
      index.push(a, c, b, b, c, d);
    }
  }
  const top = rows.length * sides, last = (rows.length - 1) * sides; // a point on top closes it
  pos.push(0, rows[rows.length - 1][0] * tall, 0);
  for (let s = 0; s < sides; s++) index.push(last + s, top, last + ((s + 1) % sides));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

export function buildLandmarks(list = [], look, heightAt, fogColor) {
  const group = new THREE.Group();
  const colliders = [];
  const mats = new Map(); // one material per colour
  const material = (color) => {
    if (!mats.has(color)) {
      const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
      const [from, to, most] = look.haze;
      haze(m, { color: fogColor, from, to, a: 0, b: most });
      mats.set(color, m);
    }
    return mats.get(color);
  };
  for (const [n, d] of list.entries()) {
    const { sides } = KINDS[d.kind];
    const seed = d.seed ?? n * 7.3;
    const mat = material(d.color ?? look.color);
    const [x, z] = d.at, y = heightAt(x, z);
    const ground = (dx, dz) => heightAt(x + dx, z + dz) - y - 3; // a little sunk into the ground
    const lod = new THREE.LOD();
    lod.addLevel(new THREE.Mesh(shape(d.kind, d.size, seed, sides * 2, 3, ground), mat), 0);
    lod.addLevel(new THREE.Mesh(shape(d.kind, d.size, seed, Math.max(4, sides), 1, ground), mat), look.swap);
    lod.position.set(x, y, z);
    group.add(lod);
    colliders.push({ kind: 'circle', x, z, r: d.size[0] * 0.8 });
  }
  return { group, colliders };
}
