import * as THREE from 'three';
import { rng } from './textures.js';

// GoatMan's head: one shaped low-poly skull (120 triangles) and a tousled hair cap over it.
// The skull is rings of points from the jaw up to the crown, each an oval pushed about by
// hand: narrow at the chin, the jaw a little pointed, a nose, ears at the sides. The painted
// face (part-face-front.png) is laid straight on over the front, and the profile
// (part-face-side.png, from Nturn2) straight on over each side, from the cheek back, so a
// three-quarter view never shows two faces. The cap wears the hair crop.
// The head's origin is where it sits on the neck; it faces -Z.

const deg = THREE.MathUtils.degToRad;
// The points round each ring, as angles from the front towards his right: closer
// together at the front, so the nose is narrow.
const ANGLES = [0, 25, 60, 100, 140, 180, 220, 260, 300, 335].map(deg);
// Rings from the jaw up: height, centre (z), half width, depth in front and behind (metres).
const RINGS = [
  [0.0, -0.065, 0.066, 0.065, 0.06], // jaw
  [0.05, -0.05, 0.082, 0.095, 0.09], // mouth
  [0.1, -0.045, 0.095, 0.1, 0.11], // nose, ears
  [0.16, -0.045, 0.1, 0.1, 0.12], // eyes
  [0.22, -0.04, 0.097, 0.092, 0.12], // brow
  [0.28, -0.035, 0.08, 0.072, 0.1], // forehead
];
const CHIN = [-0.025, -0.07]; // under the chin, and the crown: [y, z]
const CROWN = [0.33, -0.02];
// Pushed out by hand: [ring, point, metres]. The chin, lips, nose and bridge; the ears.
const PUSH = [[0, 0, 0.012], [1, 0, 0.008], [2, 0, 0.045], [3, 0, 0.014], [2, 3, 0.022], [2, 7, 0.022], [3, 3, 0.01], [3, 7, 0.01]];

// Where the paintings land on it (texture u, v as a straight line of x, y or z).
// Front: his right cheek at the left of the picture; the chin at the bottom, the eyes
// 0.45 up. Sides: the profile from just behind its eye to the hair at the back.
const FRONT = { u0: 0.475, ux: -4.8, v0: 0.066, vy: 2.65 };
const SIDE = { u0: 0.75, uz: 2.7, v0: 0.07, vy: 3.9 };
const FACING = -0.5; // a triangle whose normal points further forward than this shows the face

const ringPoint = ([y, z, w, front, back], a) => {
  const c = Math.cos(a);
  return new THREE.Vector3(w * Math.sin(a), y, z - c * (c > 0 ? front : back));
};

// Triangles (each three points, wound outward) into a non-indexed geometry. uvOf(p, normal)
// gives each corner's texture position and groupOf(normal) which of two materials it uses.
function build(tris, uvOf, groupOf = () => 0) {
  const normal = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const groups = [{ pos: [], uv: [] }, { pos: [], uv: [] }];
  for (const t of tris) {
    normal.crossVectors(e1.subVectors(t[1], t[0]), e2.subVectors(t[2], t[0])).normalize();
    const g = groups[groupOf(normal)];
    for (const p of t) { g.pos.push(p.x, p.y, p.z); g.uv.push(...uvOf(p, normal)); }
  }
  const [a, b] = groups;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...a.pos, ...b.pos], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([...a.uv, ...b.uv], 2));
  geo.addGroup(0, a.pos.length / 3, 0);
  geo.addGroup(a.pos.length / 3, b.pos.length / 3, 1);
  geo.computeVertexNormals();
  return geo;
}

// Rings joined into bands, closed with a point at each end.
function bands(rings, bottom, top) {
  const tris = [];
  const n = rings[0].length;
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    if (bottom) tris.push([bottom, rings[0][j], rings[0][k]]);
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i][j], b = rings[i][k], c = rings[i + 1][k], d = rings[i + 1][j];
      tris.push([a, d, c], [a, c, b]);
    }
    tris.push([top, rings.at(-1)[k], rings.at(-1)[j]]);
  }
  return tris;
}

function skull() {
  const rings = RINGS.map((r) => ANGLES.map((a) => ringPoint(r, a)));
  for (const [i, j, d] of PUSH) {
    rings[i][j].x += d * Math.sin(ANGLES[j]);
    rings[i][j].z -= d * Math.cos(ANGLES[j]);
  }
  const chin = new THREE.Vector3(0, CHIN[0], CHIN[1]);
  const crown = new THREE.Vector3(0, CROWN[0], CROWN[1]);
  return build(
    bands(rings, chin, crown),
    (p, n) => (n.z < FACING
      ? [FRONT.u0 + FRONT.ux * p.x, FRONT.v0 + FRONT.vy * p.y]
      : [SIDE.u0 + SIDE.uz * p.z, SIDE.v0 + SIDE.vy * p.y]),
    (n) => (n.z < FACING ? 0 : 1),
  );
}

// A point on the skull at angle a round it and height y (between the rings).
function onSkull(a, y) {
  let i = 0;
  while (i < RINGS.length - 2 && RINGS[i + 1][0] < y) i++;
  const lo = RINGS[i], hi = RINGS[i + 1];
  const k = THREE.MathUtils.clamp((y - lo[0]) / (hi[0] - lo[0]), 0, 1.6);
  return ringPoint(lo.map((v, n) => v + (hi[n] - v) * k), a);
}

// The hair: rings from the crown down to a jagged edge that is high over the forehead,
// over the ears at the sides and down to the nape at the back. Every point sits out from
// the skull by a different amount, so it looks tousled, and every other point of the edge
// hangs down in a tuft (a fringe over the forehead).
const CAP_SIDES = 12;
const CAP_RINGS = 3;
const edgeY = (a) => 0.15 + 0.13 * Math.cos(a); // 0.28 at the front (the forehead shows), 0.02 at the back
function cap() {
  const r = rng(11);
  const rings = [];
  for (let i = 1; i <= CAP_RINGS; i++) {
    const ring = [];
    for (let j = 0; j < CAP_SIDES; j++) {
      const a = ((j + 0.5) / CAP_SIDES) * Math.PI * 2; // no point dead centre: the fringe parts
      const k = i / CAP_RINGS;
      const y = CROWN[0] + (edgeY(a) - CROWN[0]) * k;
      const p = onSkull(a, Math.min(y, RINGS.at(-1)[0] + 0.03));
      const tuft = i === CAP_RINGS && j % 2;
      const out = 0.03 + r() * 0.03 + (tuft ? 0.012 : 0);
      p.x += Math.sin(a) * out;
      p.z -= Math.cos(a) * out;
      p.y = y + (i === 1 ? 0.035 : 0.015) + r() * 0.02;
      if (tuft) p.y -= 0.05 + r() * 0.04;
      ring.push(p);
    }
    rings.unshift(ring); // bands() wants them from the bottom up
  }
  const crown = new THREE.Vector3(0, CROWN[0] + 0.035, CROWN[1] + 0.01);
  // The hair crop's dark top part, laid on from above: down the sides it runs in streaks,
  // like hair hanging.
  return build(bands(rings, null, crown), (p) => [0.5 + p.x * 2.5, 0.6 + p.z]);
}

// The head, ready to place: skull and hair, with the materials for the face, the
// profile and the hair.
export function buildHead({ face, profile, hair }) {
  const head = new THREE.Group();
  head.add(new THREE.Mesh(skull(), [face, profile]));
  head.add(new THREE.Mesh(cap(), hair));
  return head;
}
