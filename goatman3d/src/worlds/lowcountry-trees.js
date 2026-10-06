import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { limb } from './tealtree.js';
import { beard } from './strands.js';

// The savanna's South Carolina trees, as low-poly shapes in the painting's colours. Each
// builder makes one tree in its own space (its foot at 0) from a seeded random function, as
// separate geometries for its wood, its crown and its moss (strands.js), so lowcountry.js
// can put many copies of a few of them in a scatter.
//   pine     longleaf pine: a tall straight bare trunk, a few short branches and needle tufts at the top
//   oak      live oak: a short thick trunk, low wide twisting limbs, dark leaf clumps, Spanish moss
//   cypress  bald cypress: a flared, buttressed foot with knees round it, a flat sparse crown, moss
//   snag     a dead tree standing in the water: a leaning trunk broken off, a few broken limbs, moss

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A lumpy clump of needles or leaves: an icosahedron with its corners pushed in and out (the
// same corner always moves the same way, so it stays closed), flattened by `flat`.
function clump(r, size, flat, at, Shape = THREE.IcosahedronGeometry) {
  const geo = new Shape(size, 0);
  const pos = geo.attributes.position;
  const bumps = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!bumps.has(key)) bumps.set(key, 0.75 + r() * 0.5);
    const k = bumps.get(key);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * flat, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo.translate(at.x, at.y, at.z);
}

// Moss hanging from points along limbs' curves: [{ curve, from, to (0..1 along it) }].
function mossFrom(curves, r, every, drop) {
  const list = [];
  const p = new THREE.Vector3();
  for (const { curve, from = 0.2, to = 1 } of curves) {
    const len = curve.getLength();
    for (let s = from * len + r() * every; s < to * len; s += every * (0.6 + r() * 0.8)) {
      curve.getPointAt(s / len, p);
      const a = r() * Math.PI * 2, tile = Math.floor(r() * 4);
      list.push({
        points: beard(p.clone().add(V(0, -0.15, 0)), drop[0] + r() * (drop[1] - drop[0]), r),
        width: 0.3 + r() * 0.25, out: V(Math.cos(a), 0, Math.sin(a)), u0: tile / 4, u1: (tile + 1) / 4, seed: r(),
      });
    }
  }
  return list;
}

const merged = (parts) => {
  const geo = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return geo;
};

export function pine(r, tall) {
  const lean = (r() - 0.5) * 0.8;
  const top = V(lean, tall, 0);
  const trunk = new THREE.CylinderGeometry(0.14, 0.36, tall + 0.6, 5, 1).translate(0, tall / 2 - 0.3, 0);
  const pos = trunk.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + lean * ((pos.getY(i) + 0.6) / tall)); // leaning a little
  trunk.computeVertexNormals();
  const wood = [trunk];
  const tuft = (size, at) => clump(r, size, 0.7, at, THREE.OctahedronGeometry);
  const crown = [tuft(1.6, top.clone().add(V(0, 0.6, 0)))];
  const n = 4 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const y = tall * (0.72 + 0.26 * (i / n)), a = r() * Math.PI * 2, len = 1 + r() * 2.2;
    const from = V(lean * (y / tall), y, 0), out = V(Math.cos(a), 0, Math.sin(a));
    const end = from.clone().addScaledVector(out, len).add(V(0, 0.4 + r() * 0.8, 0));
    wood.push(limb([from, from.clone().addScaledVector(out, len * 0.5).add(V(0, 0.15, 0)), end], 0.1, 0.05, 3, 3).geo);
    crown.push(tuft(1 + r() * 0.7, end));
  }
  return { wood: merged(wood), crown: merged(crown) };
}

export function oak(r, size = 1) {
  const s = size;
  const wood = [limb([V(0, -0.8, 0), V(0.3 * s, 1.5 * s, 0.2 * s), V(0, 3 * s, 0)], 1.0 * s, 0.75 * s, 6, 2).geo];
  const crown = [], hang = [];
  const n = 5 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const a = ((i + r() * 0.6) / n) * Math.PI * 2, reach = (10 + r() * 5) * s;
    const y0 = (2.4 + r() * 1.2) * s;
    const at = (k, up, side) => V(
      Math.cos(a) * reach * k - Math.sin(a) * side * s, y0 + up * s, Math.sin(a) * reach * k + Math.cos(a) * side * s,
    );
    const w = () => (r() - 0.5) * 3;
    // low and wide, rising, dipping and rising again as it goes out, twisting side to side
    const big = limb([at(0, 0, 0), at(0.25, 1.6, w()), at(0.5, 0.8, w()), at(0.75, 2 + r(), w()), at(1, 1 + r() * 1.5, w())], 0.55 * s, 0.12 * s, 5, 2.2);
    wood.push(big.geo);
    hang.push({ curve: big.curve, from: 0.3 });
    for (const k of [0.45, 0.75]) {
      const p = big.curve.getPointAt(k), b = a + (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.5), len = reach * 0.35;
      const twig = limb([p, p.clone().add(V(Math.cos(b) * len * 0.5, 1.2 * s, Math.sin(b) * len * 0.5)),
        p.clone().add(V(Math.cos(b) * len, (0.6 + r()) * s, Math.sin(b) * len))], 0.22 * s, 0.06 * s, 4, 2.5);
      wood.push(twig.geo);
      hang.push({ curve: twig.curve, from: 0.3 });
    }
    // small dark leaf clumps along the top of the limb, the limb showing between them
    for (const k of [0.4, 0.62, 0.82, 1]) {
      const p = big.curve.getPointAt(k);
      crown.push(clump(r, (1.1 + r() * 0.9) * s, 0.55, p.add(V((r() - 0.5) * 1.5, (0.9 + r() * 0.6) * s, (r() - 0.5) * 1.5))));
    }
  }
  return { wood: merged(wood), crown: merged(crown), moss: mossFrom(hang, r, 1.3, [1.2 * s, 3.6 * s]) };
}

export function cypress(r, tall) {
  // The trunk turned on a lathe, then its foot pushed out into buttresses.
  const profile = [[2.0, -0.6], [1.6, 0.3], [1.0, 1.3], [0.6, 3], [0.3, tall]].map(([x, y]) => new THREE.Vector2(x, y));
  const trunk = mergeVertices(new THREE.LatheGeometry(profile, 8).deleteAttribute('normal'));
  const pos = trunk.attributes.position, phase = r() * 6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + 0.45 * Math.max(0, 1 - y / 3) * Math.max(0, Math.sin(3 * Math.atan2(z, x) + phase));
    pos.setXYZ(i, x * k, y, z * k);
  }
  trunk.computeVertexNormals();
  const wood = [trunk];
  for (let i = 0, n = 5 + Math.floor(r() * 5); i < n; i++) { // knees poking up round it
    const a = r() * Math.PI * 2, d = 2 + r() * 2.5, h = 0.4 + r() * 0.8;
    wood.push(new THREE.ConeGeometry(0.16 + r() * 0.1, h, 4).translate(Math.cos(a) * d, h / 2 - 0.2, Math.sin(a) * d));
  }
  // A flat, sparse crown in layers, on short branches.
  const crown = [], hang = [];
  for (let i = 0, n = 4 + Math.floor(r() * 3); i < n; i++) {
    const a = r() * Math.PI * 2, out = 1.5 + r() * 3, y = tall * (0.78 + r() * 0.2);
    const end = V(Math.cos(a) * out, y + 0.5, Math.sin(a) * out);
    const branch = limb([V(0, y - 1.5, 0), V(Math.cos(a) * out * 0.5, y, Math.sin(a) * out * 0.5), end], 0.18, 0.06, 4, 3);
    wood.push(branch.geo);
    hang.push({ curve: branch.curve, from: 0.4 });
    crown.push(clump(r, 2 + r() * 1.2, 0.35, end.clone().add(V(0, 0.6, 0))));
  }
  crown.push(clump(r, 2.4, 0.35, V(0, tall + 0.4, 0)));
  return { wood: merged(wood), crown: merged(crown), moss: mossFrom(hang, r, 0.7, [1, 3]) };
}

export function snag(r, tall) {
  const lean = V((r() - 0.5) * 2, 0, (r() - 0.5) * 2);
  const top = V(lean.x, tall, lean.z);
  const trunk = limb([V(0, -1, 0), V(lean.x * 0.4, tall * 0.5, lean.z * 0.4), top], 0.4, 0.16, 6, 2.5);
  const wood = [trunk.geo], hang = [];
  for (let i = 0, n = 2 + Math.floor(r() * 3); i < n; i++) {
    const p = trunk.curve.getPointAt(0.45 + r() * 0.5), a = r() * Math.PI * 2, len = 1.5 + r() * 3;
    const branch = limb([p, p.clone().add(V(Math.cos(a) * len * 0.5, len * 0.4, Math.sin(a) * len * 0.5)),
      p.clone().add(V(Math.cos(a) * len, len * (0.3 + r() * 0.6), Math.sin(a) * len))], 0.13, 0.04, 4, 2.5);
    wood.push(branch.geo);
    hang.push({ curve: branch.curve, from: 0.2 });
  }
  return { wood: merged(wood), moss: mossFrom(hang, r, 0.6, [0.8, 2.6]) };
}
