import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas } from './textures.js';
import { hull } from './walkingthing-body.js';
import { FRAME, sampleDrawing, stripeSheet, eyePaint } from './bushes-paint.js';

// The striped creatures' bodies, from their side drawing (cret1). Like the Walking Thing's
// body: every few columns of the drawing become a ring as tall as the paint there and nearly
// as wide, so from the side it has the drawing's outline, lumps and all. The skin is painted
// for the whole body (bushes-paint.js): u along it from tail to nose, v once round it.
// The back and the head are separate pieces, split at the dark crease between them, so the
// head can turn to watch. The ear is left out of the rings and added as two blunt nubs,
// and a separate eye blinks where the eye is drawn. Everything is in metres, the creature
// facing -z with its neck at the origin.

const COLUMN = 5; // px between rings
const RING = 8; // points round a ring
const CAP = 2; // rings rounding off each end
const NECK = 52; // the crease between the back and the head, px from the left of the drawing
const EAR = [68, 88]; // the columns of the ear sticking up from the head
const EYE = [117, 46]; // where the eye is drawn
const ROUND = 1.05; // how wide it is for how tall
const SINK = 0.25; // the rings go this far (of their height) below the ground: it sits like a heap
// The skin's v round the body, inset half a texel so a frame never shows its neighbour's edge.
const V0 = 0.5 / FRAME / 2, V1 = 0.5 - 1 / FRAME / 2;

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

// One piece, the columns from..to as rings, rounded off at both ends. Each ring knows how
// far along the body it is (`along`, in px of the drawing): its column, and on the rounded
// ends the distance over the surface from the edge of the end, so the stripes close in
// rings round each end instead of smearing across it.
function piece(cols, from, to, m, base) {
  const rings = cols.filter((s) => s.x >= from && s.x <= to).map(({ x, a }) => {
    const bottom = base + SINK * (base - a);
    return { x, along: x, mid: (a + bottom) / 2, half: (bottom - a) / 2, thick: ROUND * ((base - a) / 2) * m };
  });
  const cap = (end, dir, deep) => {
    const out = [];
    let arc = 0, was = { x: 0, h: end.half };
    for (let j = 0; j <= CAP; j++) { // from the edge of the end to its tip
      const t = ((j + 1) / (CAP + 1)) * (Math.PI / 2);
      const x = deep * Math.sin(t), h = end.half * Math.cos(t);
      arc += Math.hypot(x - was.x, h - was.h);
      was = { x, h };
      out.push({ ...end, x: end.x + dir * x, along: end.along + dir * arc, half: h, thick: end.thick * Math.cos(t) });
    }
    return out;
  };
  const ends = (ring) => 0.5 * Math.min(ring.half, ring.thick / m);
  const all = [...cap(rings[0], -1, ends(rings[0])).reverse(), ...rings, ...cap(rings.at(-1), 1, ends(rings.at(-1)))];
  return { rings, all, reach: [all[0].along, all.at(-1).along] };
}

// The piece's mesh, its skin's u from toU(along) and v once round it.
function skin({ all }, m, base, toU) {
  const pos = [], uv = [], index = [];
  const n = RING + 1; // the first point again at the end, so the skin's v can run 0..1 round it
  all.forEach(({ x, along, mid, half, thick }, i) => {
    for (let k = 0; k < n; k++) {
      const t = Math.PI + (k / RING) * Math.PI * 2; // from the bottom (sunk in the ground) round over the top
      pos.push(-Math.sin(t) * thick, (base - mid + Math.cos(t) * half) * m, (NECK - x) * m);
      uv.push(toU(along), V0 + (k / RING) * V1);
    }
    if (i === 0) return;
    for (let k = 0; k < RING; k++) {
      const a0 = (i - 1) * n + k, b0 = i * n + k;
      index.push(a0, b0, b0 + 1, a0, b0 + 1, a0 + 1);
    }
  });
  const geo = mergeVertices(new THREE.BufferGeometry()
    .setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    .setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    .setIndex(index));
  geo.computeVertexNormals();
  return geo;
}

// Where a column of the drawing is on a piece's surface, at a row: the side of its ring.
function side(rings, x, row, m) {
  const ring = rings.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
  const k = (row - ring.mid) / ring.half;
  return ring.thick * Math.sqrt(Math.max(0, 1 - k * k));
}

// Everything a creature is made of, built once and shared: { back, head (with its ears),
// eyes, the painted skins (grown and baby), open and shut eyes, the outline geometries, sizes }. length: metres nose to tail.
export function creatureParts(sheet, length, line) {
  const { cols, first, last, bottom } = spans(sheet);
  const m = length / (last - first);
  // Split at the crease, each piece closing with a rounded end that pushes into the other.
  const back = piece(cols, first, NECK, m, bottom);
  const head = piece(cols, NECK + 1, last, m, bottom);
  const u0 = back.reach[0], u1 = head.reach[1]; // tail tip to nose tip, in px along the surface
  const toU = (along) => THREE.MathUtils.clamp((along - u0) / (u1 - u0), 0, 1) * (0.5 - 1 / FRAME) + 0.5 / FRAME;
  back.geo = skin(back, m, bottom, toU);
  head.geo = skin(head, m, bottom, toU);

  // The ears: two blunt little nubs on top of the head, leaning out, painted with the drawn ear.
  const ex = (EAR[0] + EAR[1]) / 2, top = cols.find((s) => s.x >= ex).a;
  const ears = [-1, 1].map((s) => {
    const ear = new THREE.CylinderGeometry(2.5 * m, 7 * m, top * m * 1.1, 6).translate(0, (top * m * 1.1) / 2, 0);
    ear.rotateZ(-s * 0.35).rotateX(0.2);
    ear.translate(s * side(head.rings, ex, top + 6, m) * 0.75, (bottom - top - 3) * m, (NECK - ex) * m);
    const p = ear.attributes.position, uv = ear.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, toU(NECK - p.getZ(i) / m), 0.25 + s * 0.03); // the top of the head's stripes
    return ear;
  });
  const headGeo = mergeGeometries([head.geo, ...ears]);

  // The eyes, one on each side of the head where the eye is drawn.
  const r = 3.2 * m, ey = (bottom - EYE[1]) * m, ez = (NECK - EYE[0]) * m;
  const out = side(head.rings, EYE[0], EYE[1], m);
  const eyes = mergeGeometries([-1, 1].map((s) => new THREE.SphereGeometry(r, 8, 6).scale(0.6, 1, 1).translate(s * out, ey, ez)));
  eyes.translate(0, -ey, 0); // so blinking (scale.y) closes them round their middle

  // The skin: as many stripes from tail to nose as the drawing has across it, fewer on a baby.
  const look = sampleDrawing(sheet);
  const lines = Math.round(look.perPx * (u1 - u0));
  return {
    back: back.geo, head: headGeo, eyes, eyeY: ey,
    texture: stripeSheet(look, lines, false), babyTexture: stripeSheet(look, Math.round(lines * 0.7), true, 5),
    eyeMap: eyePaint(false), lidMap: eyePaint(true),
    backLine: hull(back.geo, line).geometry, headLine: hull(head.geo, line).geometry,
    height: (bottom - Math.min(...cols.map((s) => s.a))) * m,
    width: 2 * Math.max(...back.rings.map((g) => g.thick)),
    backZ: (NECK - (first + NECK) / 2) * m, headZ: (NECK - (NECK + last) / 2) * m,
  };
}
