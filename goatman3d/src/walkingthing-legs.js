import * as THREE from 'three';

// The Walking Thing's legs: long, thin, slightly bowed stilts. Each frame a leg is worked out
// from its hip and its foot (two-bone IK: thigh and shin, then a short pastern down to the
// foot) and drawn as one tube along a smooth curve through hip, knee, ankle and foot,
// thinning all the way down, so the joints bend instead of kinking. A spring on each knee
// makes the legs wobble when it stops, and the foot's pad squashes as it lands.

export const THIGH = 0.42, SHIN = 0.36, PASTERN = 0.22; // of a leg's length
const AROUND = 6; // points round the tube
const BOW = 0.035; // how far the thigh and shin bow, as a part of their length
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

// The curve's points: the hip, the thigh's bowed middle, the knee, the shin's middle, the
// ankle, the foot. Rings go along each part between them, `s` of the way down the leg.
const PARTS = [THIGH / 2, THIGH / 2, SHIN / 2, SHIN / 2, PASTERN];
const RINGS = [];
PARTS.reduce((s, len, i) => {
  const n = Math.max(3, Math.round(len * 26));
  for (let j = 0; j < n; j++) RINGS.push({ t: (i + j / n) / PARTS.length, s: s + (len * j) / n });
  return s + len;
}, 0);
RINGS.push({ t: 1, s: 1 });

// How thick a leg is (times k) a part s of the way down: thinning to the foot, a little
// knobbly at the knee and the ankle.
const bump = (s, at, w) => Math.exp(-(((s - at) / w) ** 2));
const radius = (s) => 0.35 - 0.2 * s + 0.05 * bump(s, THIGH, 0.04) + 0.035 * bump(s, THIGH + SHIN, 0.03);

// A tube's worth of points (placed every frame) and how they join up, facing out.
function tube() {
  const count = RINGS.length * (AROUND + 1);
  const uv = [], index = [];
  RINGS.forEach(({ s }, i) => {
    for (let j = 0; j <= AROUND; j++) {
      uv.push(j / AROUND, 1 - s);
      if (i === 0 || j === AROUND) continue;
      const a = (i - 1) * (AROUND + 1) + j, b = a + AROUND + 1;
      index.push(a, b + 1, b, a, a + 1, b + 1);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3)); // flat shaded: unused
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

function knot(radius, mat, line, width, squash = 1) {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 0), mat);
  mesh.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius + width, 0), line));
  mesh.scale.y = squash;
  return mesh;
}

// One leg (s: -1 left, 1 right): its tube, the dark outline round it, and the foot's pad.
export function createLeg(s, { k, line, mat, lineMat }) {
  const skin = tube(), edge = tube();
  const leg = {
    s, skin, edge,
    meshes: [new THREE.Mesh(skin, mat), new THREE.Mesh(edge, lineMat)],
    pad: knot(0.42 * k, mat, lineMat, line, 0.5),
    curve: new THREE.CatmullRomCurve3([...PARTS, 0].map(() => new THREE.Vector3()), false, 'centripetal'),
    // the foot: where it is, and where a step goes from and to (k = 1 when planted)
    at: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), k: 1, time: 1, lift: 1,
    grow: 1, // the foot's size (the squash makes it huge)
    held: null, // a scripted position instead of walking (the stomp)
    wob: 0, wobVel: 0, // the knee's spring: metres forward
    squash: 0, squashVel: 0, // the pad flattening as the foot lands
  };
  for (const mesh of leg.meshes) mesh.frustumCulled = false;
  return leg;
}

// The springs. push: how hard the knee is pushed forward (the body slowing down pushes it
// on, speeding up holds it back).
export function springLeg(leg, dt, push) {
  const steps = Math.ceil(dt / 0.02);
  for (let i = 0; i < steps; i++) {
    const h = dt / steps;
    leg.wobVel += (push - 64 * leg.wob - 3.2 * leg.wobVel) * h; // about 1.3 wobbles a second
    leg.wob += leg.wobVel * h;
    leg.squashVel += (-600 * leg.squash - 17 * leg.squashVel) * h;
    leg.squash += leg.squashVel * h;
  }
}

const hip = new THREE.Vector3(), ankle = new THREE.Vector3(), knee = new THREE.Vector3();
const dir = new THREE.Vector3(), bend = new THREE.Vector3(), pole = new THREE.Vector3();
const v = new THREE.Vector3(), q = new THREE.Vector3(), tan = new THREE.Vector3();
const n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
const points = RINGS.map(() => new THREE.Vector3());

// The middle of a..b, pushed square to it towards `bend` by `by`.
function bowed(out, a, b, by) {
  v.subVectors(b, a).normalize();
  q.copy(bend).addScaledVector(v, -bend.dot(v)).normalize();
  return out.addVectors(a, b).multiplyScalar(0.5).addScaledVector(q, by);
}

// Lays a leg from its hip (a world point) down to its foot (leg.at). The knee bends forward,
// and up and out as it kneels (crouch 0..1); the lowest part folds back flat on the ground.
// axes: the creature's { fwd, side, back }; size: { T, S, P } the bones' lengths, k, line.
export function placeLeg(leg, hipAt, { fwd, side, back }, crouch, { T, S, P, k, line }) {
  const fold = crouch * 1.35;
  hip.copy(hipAt);
  ankle.copy(leg.at).addScaledVector(UP, P * Math.cos(fold)).addScaledVector(back, P * Math.sin(fold));
  dir.subVectors(ankle, hip);
  const far = dir.length();
  dir.divideScalar(far || 1);
  const d = clamp(far, Math.abs(T - S) + 0.01, T + S - 0.01);
  ankle.copy(hip).addScaledVector(dir, d);
  const a = (T * T - S * S + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, T * T - a * a));
  pole.copy(fwd).addScaledVector(UP, 0.3 + crouch * 1.5).addScaledVector(side, leg.s * crouch * 0.5);
  bend.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  knee.copy(hip).addScaledVector(dir, a).addScaledVector(bend, h).addScaledVector(fwd, leg.wob);

  // The curve through the joints, the thigh bowing forward and the shin back, the knee's
  // wobble rippling on down the shin.
  const c = leg.curve.points;
  c[0].copy(hip);
  bowed(c[1], hip, knee, BOW * T);
  c[2].copy(knee);
  bowed(c[3], knee, ankle, -BOW * S).addScaledVector(fwd, -0.5 * leg.wob);
  c[4].copy(ankle);
  c[5].copy(leg.at);
  for (let i = 0; i < RINGS.length; i++) leg.curve.getPoint(RINGS[i].t, points[i]);

  // The tube round it, and the outline a little bigger.
  const skin = leg.skin.attributes.position, edge = leg.edge.attributes.position;
  let n = 0;
  for (let i = 0; i < RINGS.length; i++) {
    tan.subVectors(points[Math.min(i + 1, RINGS.length - 1)], points[Math.max(i - 1, 0)]).normalize();
    n1.copy(side).addScaledVector(tan, -side.dot(tan)).normalize();
    n2.crossVectors(tan, n1);
    const r = radius(RINGS[i].s) * k;
    for (let j = 0; j <= AROUND; j++) {
      const x = Math.cos((j / AROUND) * Math.PI * 2), y = Math.sin((j / AROUND) * Math.PI * 2);
      q.copy(points[i]).addScaledVector(n1, x * r).addScaledVector(n2, y * r);
      skin.setXYZ(n, q.x, q.y, q.z);
      q.copy(points[i]).addScaledVector(n1, x * (r + line)).addScaledVector(n2, y * (r + line));
      edge.setXYZ(n++, q.x, q.y, q.z);
    }
  }
  skin.needsUpdate = edge.needsUpdate = true;

  const g = leg.grow, sq = leg.squash;
  leg.pad.position.copy(leg.at);
  leg.pad.scale.set(g * (1 + 0.3 * sq), g * 0.5 * (1 - 0.5 * sq), g * (1 + 0.3 * sq));
}
