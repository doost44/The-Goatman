import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas, crunchy } from './textures.js';
import { fillEdges, hull } from './walkingthing-body.js';

// The striped creatures' bodies, from their side drawing (cret1-4). Like the Walking Thing's
// body: every few columns of the drawing become a ring as tall as the paint there and nearly
// as wide, so from the side it is the drawing, lumps and all, with the painting on both
// flanks (all four drawings, swapped as it moves, so the stripes boil like the painting).
// The back and the head are separate pieces, split at the dark crease between them, so the
// head can turn to watch. The ear is left out of the rings and added as two blunt nubs,
// and the drawn eye is painted over: a separate eye blinks there instead. Everything is in
// metres, the creature facing -z with its neck at the origin.

const COLUMN = 5; // px between rings
const RING = 8; // points round a ring
const CAP = 2; // rings rounding off each end
const NECK = 52; // the crease between the back and the head, px from the left of the drawing
const EAR = [68, 88]; // the columns of the ear sticking up from the head
const EYE = [117, 46]; // where the eye is drawn
const ROUND = 1.05; // how wide it is for how tall
const SINK = 0.25; // the rings go this far (of their height) below the ground: it sits like a heap

// The four drawings side by side, the eye painted over with the stripes beside it and the
// see-through pixels filled in, so the edges don't show dark.
function paint(sheet) {
  const { frameW: W, frameH: H } = sheet;
  const c = canvas(W * 4, H);
  const g = c.getContext('2d');
  sheet.frames.forEach((f, i) => {
    const one = canvas(W, H), og = one.getContext('2d');
    og.drawImage(sheet.img, f.x, f.y, f.w, f.h, 0, 0, W, H);
    og.drawImage(one, EYE[0] - 11, EYE[1] - 4, 7, 9, EYE[0] - 3, EYE[1] - 4, 7, 9);
    const img = og.getImageData(0, 0, W, H);
    fillEdges(img.data);
    g.putImageData(img, i * W, 0);
  });
  return c;
}

// The painted rows of each column of the first drawing (a few stray pixels don't count),
// with the ear cut off level with the head round it.
function spans(sheet) {
  const { frameW: W, frameH: H } = sheet, f = sheet.frames[0];
  const c = canvas(W, H);
  c.getContext('2d').drawImage(sheet.img, f.x, f.y, f.w, f.h, 0, 0, W, H);
  const p = c.getContext('2d').getImageData(0, 0, W, H).data;
  const span = (x) => {
    let a = -1, b = -1;
    for (let y = 0; y < H; y++) if (p[(y * W + x) * 4 + 3] > 127) { if (a < 0) a = y; b = y + 1; }
    return b - a >= 6 ? { x, a, b } : null;
  };
  let first = 0, last = W - 1;
  while (!span(first)) first++;
  while (!span(last)) last--;
  const [e0, e1] = [span(EAR[0]), span(EAR[1])];
  const out = [];
  for (let x = first; x <= last; x += COLUMN) {
    const s = span(x);
    if (!s) continue;
    if (x > EAR[0] && x < EAR[1]) s.a = e0.a + ((e1.a - e0.a) * (x - EAR[0])) / (EAR[1] - EAR[0]);
    out.push(s);
  }
  return { cols: out, first, last, bottom: Math.max(...out.map((s) => s.b)) };
}

// One piece, the columns from..to as rings, rounded off at both ends.
function piece(cols, from, to, m, base, W, H) {
  const rings = cols.filter((s) => s.x >= from && s.x <= to).map(({ x, a }) => {
    const bottom = base + SINK * (base - a);
    return { x, u: x, mid: (a + bottom) / 2, half: (bottom - a) / 2, thick: ROUND * ((base - a) / 2) * m };
  });
  const cap = (end, dir, deep) => {
    const out = [];
    for (let j = CAP; j >= 0; j--) {
      const t = ((j + 1) / (CAP + 1)) * (Math.PI / 2);
      out.push({ ...end, x: end.x + dir * deep * Math.sin(t), u: end.x - dir * 3, half: end.half * Math.cos(t), thick: end.thick * Math.cos(t) });
    }
    return out; // from the tip inwards (painted from just inside the drawing's edge)
  };
  const ends = (ring) => 0.5 * Math.min(ring.half, ring.thick / m);
  const all = [...cap(rings[0], -1, ends(rings[0])), ...rings, ...cap(rings.at(-1), 1, ends(rings.at(-1))).reverse()];
  const pos = [], uv = [], index = [];
  all.forEach(({ x, u, mid, half, thick }, i) => {
    for (let k = 0; k < RING; k++) {
      const t = (k / RING) * Math.PI * 2; // 0 is the top
      pos.push(-Math.sin(t) * thick, (base - mid + Math.cos(t) * half) * m, (NECK - x) * m);
      const row = Math.min(H - 1, mid - Math.cos(t) * Math.max(0, half - 2)); // the paint just inside the outline
      uv.push(THREE.MathUtils.clamp(u, 0, W - 1) / (W * 4), 1 - row / H);
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
  return { geo, rings };
}

// Where a column of the drawing is on a piece's surface, at a row: the side of its ring.
function side(rings, x, row, m) {
  const ring = rings.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
  const k = (row - ring.mid) / ring.half;
  return ring.thick * Math.sqrt(Math.max(0, 1 - k * k));
}

// The eyes' paint: a yellow ring round a dark middle, where a sphere's sides face out.
function eyePaint() {
  const c = canvas(32, 16);
  const g = c.getContext('2d');
  g.fillStyle = '#1c0612';
  g.fillRect(0, 0, 32, 16);
  for (const x of [0, 16, 32]) {
    g.fillStyle = '#e8c860';
    g.beginPath(); g.ellipse(x, 8, 4, 5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#12040c';
    g.beginPath(); g.ellipse(x, 8, 2, 3, 0, 0, Math.PI * 2); g.fill();
  }
  return crunchy(c);
}

// Everything a creature is made of, built once and shared: { back, head (with its ears),
// eyes, the painted texture, the outline geometries, sizes }. length: metres nose to tail.
export function creatureParts(sheet, length, line) {
  const { frameW: W, frameH: H } = sheet;
  const { cols, first, last, bottom } = spans(sheet);
  const m = length / (last - first);
  // Split at the crease, each piece closing with a rounded end that pushes into the other.
  const back = piece(cols, first, NECK, m, bottom, W, H);
  const head = piece(cols, NECK + 1, last, m, bottom, W, H);

  // The ears: two blunt little nubs on top of the head, leaning out, painted with the drawn ear.
  const ex = (EAR[0] + EAR[1]) / 2, top = cols.find((s) => s.x >= ex).a;
  const ears = [-1, 1].map((s) => {
    const ear = new THREE.CylinderGeometry(2.5 * m, 7 * m, top * m * 1.1, 6).translate(0, (top * m * 1.1) / 2, 0);
    ear.rotateZ(-s * 0.35).rotateX(0.2);
    ear.translate(s * side(head.rings, ex, top + 6, m) * 0.75, (bottom - top - 3) * m, (NECK - ex) * m);
    const p = ear.attributes.position, uv = ear.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (NECK - p.getZ(i) / m) / (W * 4), 1 - (bottom - p.getY(i) / m) / H);
    return ear;
  });
  const headGeo = mergeGeometries([head.geo, ...ears]);

  // The eyes, one on each side of the head where the eye is drawn.
  const r = 3.2 * m, ey = (bottom - EYE[1]) * m, ez = (NECK - EYE[0]) * m;
  const out = side(head.rings, EYE[0], EYE[1], m);
  const eyes = mergeGeometries([-1, 1].map((s) => new THREE.SphereGeometry(r, 8, 6).scale(0.6, 1, 1).translate(s * out, ey, ez)));
  eyes.translate(0, -ey, 0); // so blinking (scale.y) closes them round their middle

  const texture = crunchy(paint(sheet));
  return {
    back: back.geo, head: headGeo, eyes, eyeY: ey, texture, eyeMap: eyePaint(),
    backLine: hull(back.geo, line).geometry, headLine: hull(head.geo, line).geometry,
    height: (bottom - Math.min(...cols.map((s) => s.a))) * m,
    width: 2 * Math.max(...back.rings.map((g) => g.thick)),
    backZ: (NECK - (first + NECK) / 2) * m, headZ: (NECK - (NECK + last) / 2) * m,
  };
}
