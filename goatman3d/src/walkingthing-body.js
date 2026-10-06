import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas, crunchy } from './textures.js';

// The Walking Thing's body and the paint for its legs, from its first drawing (WBOY1).

export const BODY_ROWS = 56; // in the 256 px drawings its legs start below this row
export const HIP_X = 49; // where the legs come out of the body, pixels from the left
const COLUMN = 3, RING = 8;
const NECK = 22; // the head and neck, this many pixels at the front, are thinner than the body
const NOSE = 10; // over this many pixels the head narrows into a blunt nose
const DROOP = 5; // pixels the nose hangs below the drawing, so the head sits lower than the back
const CAP = 3; // rings rounding off each end

// The body: the drawing above the legs, swept round. Every few columns of the painting
// become a ring as tall as the paint in that column (thinner at the head), the rings are
// joined into one rounded low-poly shape, and the painting is projected onto it from the
// side, so it shows on both flanks. Each end closes with a few shrinking rings, so the
// front is a rounded snout and the pale block at the back has a soft end, not a flat face.
export function bodyGeometry(sheet, m, depth) {
  const f = sheet.frames[0];
  const c = canvas(f.w, BODY_ROWS);
  const g = c.getContext('2d');
  g.drawImage(sheet.img, f.x, f.y, f.w, BODY_ROWS, 0, 0, f.w, BODY_ROWS);
  const img = g.getImageData(0, 0, f.w, BODY_ROWS);
  const p = img.data;
  // The painted rows of a column; a few stray pixels at the tips don't count.
  const span = (x) => {
    let a = -1, b = -1;
    for (let y = 0; y < BODY_ROWS; y++) if (p[(y * f.w + x) * 4 + 3] > 127) { if (a < 0) a = y; b = y + 1; }
    return b - a >= 6 ? { x, a, b } : null;
  };
  let first = 0, last = f.w - 1;
  while (!span(first)) first++;
  while (!span(last)) last--;
  const cols = [];
  for (let x = first; x < last; x += x < first + NOSE ? 2 : COLUMN) if (span(x)) cols.push(span(x)); // closer round the nose
  cols.push(span(last));
  const head = span(first + NOSE); // the drawn tip is ragged (an open mouth): the nose follows the head
  fillEdges(p);
  g.putImageData(img, 0, 0);

  const smooth = THREE.MathUtils.smoothstep;
  const rings = cols.map(({ x, a, b }) => {
    const d = x - first;
    const nose = 0.5 + 0.5 * Math.sin((Math.min(1, d / NOSE) * Math.PI) / 2);
    if (d < NOSE) ({ a, b } = head);
    // The nose narrows mostly from below, the top of the head sloping a little down to it.
    const top = a + (1 - nose) * 4, bottom = b - (b - a) * (1 - nose);
    return {
      x, u: x,
      mid: (top + bottom) / 2, half: (bottom - top) / 2,
      drop: DROOP * (1 - smooth(d, 0, NECK)),
      paint: (b - a) / 2 - 3, // its back and belly show the paint inside the outline, not the line
      thick: (depth / 2) * (0.45 + 0.55 * smooth(x, first + NECK - 8, first + NECK + 8)) * nose,
    };
  });
  // The block at the back is drawn rounding off into a sliver: its cap does that instead.
  while (rings.length > 2 && rings.at(-1).half < 0.6 * rings.at(-2).half) rings.pop();
  // The caps: rings shrinking round to a point. The nose is as deep as it is round; the back
  // reaches the end of the drawing, a blunter dome.
  const cap = (end, dir, deep) => {
    const out = [];
    for (let j = CAP; j >= 0; j--) {
      const a = ((j + 1) / (CAP + 1)) * (Math.PI / 2);
      out.push({ ...end, x: end.x + dir * deep * Math.sin(a), u: end.x - dir * 2, half: end.half * Math.cos(a), thick: end.thick * Math.cos(a) });
    }
    return out; // from the tip inwards (the last is the tip itself, a ring of one point)
  };
  const nose = rings[0], tail = rings.at(-1);
  const all = [
    ...cap(nose, -1, 0.8 * Math.min(nose.half, nose.thick / m)),
    ...rings,
    ...cap(tail, 1, Math.max(last + 1 - tail.x, 0.35 * Math.min(tail.half, tail.thick / m))).reverse(),
  ];

  const pos = [], uv = [], index = [];
  all.forEach(({ x, u, mid, half, drop, paint, thick }, i) => {
    for (let k = 0; k < RING; k++) {
      const t = (k / RING) * Math.PI * 2; // 0 is the top
      pos.push(Math.sin(t) * thick, (BODY_ROWS - mid - drop + Math.cos(t) * half) * m, (x - HIP_X) * m);
      uv.push(u / f.w, 1 - (mid - Math.cos(t) * Math.max(0, Math.min(half, paint))) / BODY_ROWS);
    }
    if (i === 0) return;
    for (let k = 0; k < RING; k++) {
      const a0 = (i - 1) * RING + k, a1 = (i - 1) * RING + ((k + 1) % RING), b0 = i * RING + k, b1 = i * RING + ((k + 1) % RING);
      index.push(a0, b0, b1, a0, b1, a1);
    }
  });
  const geo = mergeVertices(new THREE.BufferGeometry()
    .setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    .setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    .setIndex(index));
  geo.computeVertexNormals();
  // The top of its back as drawn (where a rider sits), before the head was lowered.
  const top = (BODY_ROWS - Math.min(...cols.map((col) => col.a))) * m;
  return { geo, texture: crunchy(c), top };
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
// stretched to the width of the texture and wrapped round the legs.
export function legTexture(sheet) {
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
export function hull(geo, width, material) {
  const g = mergeVertices(geo.clone().deleteAttribute('uv').deleteAttribute('normal'));
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * width, p.getY(i) + n.getY(i) * width, p.getZ(i) + n.getZ(i) * width);
  }
  return new THREE.Mesh(g, material);
}

// Its blob shadow (shadow.png, len by wide metres): a grid laid over the ground under the
// body every frame with userData.lay(centre, fwd, side, heightAt).
export function createShadow(map, len, wide) {
  const geo = new THREE.PlaneGeometry(1, 1, 6, 4);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map, color: 0x2a0010, transparent: true, opacity: 0.6, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  }));
  mesh.frustumCulled = false;
  const p = geo.attributes.position;
  const grid = [];
  for (let i = 0; i < p.count; i++) grid.push([p.getX(i), p.getY(i)]);
  mesh.userData.lay = (centre, fwd, side, heightAt) => {
    grid.forEach(([lx, ly], i) => {
      const x = centre.x + fwd.x * (-lx * len) + side.x * (ly * wide);
      const z = centre.z + fwd.z * (-lx * len) + side.z * (ly * wide);
      p.setXYZ(i, x, heightAt(x, z) + 0.06, z);
    });
    p.needsUpdate = true;
  };
  return mesh;
}
