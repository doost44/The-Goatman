import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// GoatMan's hands, for his body (goatman.js), first person and third: a
// narrow palm and long thin fingers like the paintings' (Goatman Himself/1-18.png), three
// joints each, and a thumb. One skinned mesh per hand (one draw call): every piece of
// it follows one bone, and the bones are what move.
//
// The hand hangs down (-Y) from the wrist with its palm facing forward (-Z), the way his
// arm joints are built, and its fingers curl forward (positive rotation.x). `side` is +1
// for his right hand and -1 for his left: it puts the thumb on the outside.

const PALM = 0.085, WIDE = 0.064, THICK = 0.024;
// Each finger: across the palm (x, right hand), length, how far it fans out (radians).
const FINGERS = [
  [-0.023, 0.13, -0.09], // little finger
  [-0.008, 0.155, -0.03],
  [0.008, 0.165, 0.02],
  [0.023, 0.145, 0.07], // index
];
const SPLIT = [0.42, 0.32, 0.26]; // how a finger's length shares out between its three joints
const THUMB = { at: [0.03, -0.02, -0.006], len: 0.1, out: 0.32, forward: 0.6 };
// How far each joint bends with a full curl (base, middle, tip). The thumb bends less.
const BEND = [1.0, 1.35, 0.9];
const THUMB_BEND = [0.3, 0.7, 0.6];
const SMOOTH = 10; // how quickly the fingers follow (per second)

// A thin tapered segment from its joint down, a little longer than the bone so the joints
// close over like knuckles.
function segment(len, r0, r1) {
  return new THREE.CylinderGeometry(r0, r1, len + r0, 5, 1).translate(0, -len / 2 + r0 / 2, 0);
}

// Tags every vertex of a piece with the bone it follows.
function follows(geo, bone) {
  const n = geo.attributes.position.count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((v, i) => (i % 4 ? 0 : bone)), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((v, i) => (i % 4 ? 0 : 1)), 4));
  return geo;
}

export function buildHand(material, side = 1, size = 1) {
  const bones = [new THREE.Bone()]; // the wrist
  const pieces = []; // [geometry, the bone it follows]
  const add = (parent, x, y, z) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent.add(b);
    bones.push(b);
    return b;
  };

  // The palm: a flattened box, narrower at the wrist, the knuckles a little rounded.
  const palm = new THREE.BoxGeometry(WIDE, PALM, THICK, 2, 1, 1).translate(0, -PALM / 2, 0);
  const p = palm.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = -p.getY(i) / PALM; // 0 at the wrist, 1 at the knuckles
    p.setX(i, p.getX(i) * (0.75 + 0.25 * k));
    if (k > 0.9 && Math.abs(p.getX(i)) < 0.01) p.setY(i, p.getY(i) - 0.004);
  }
  palm.computeVertexNormals();
  pieces.push([palm, 0]);

  // The fingers: three bones in a chain from the knuckles, each with its segment.
  const fingers = FINGERS.map(([x, len, fan], f) => {
    const chain = [];
    let parent = bones[0], y = -PALM;
    for (let j = 0; j < 3; j++) {
      const b = add(parent, j === 0 ? x * side : 0, y, 0);
      const l = len * SPLIT[j];
      const r = 0.0085 - j * 0.0015 - (f === 0 ? 0.001 : 0);
      pieces.push([segment(l, r, r * 0.85), bones.length - 1]);
      chain.push(b);
      parent = b;
      y = -l;
    }
    return { chain, fan: fan * side, phase: f * 0.7 };
  });

  // The thumb: from the side of the palm near the wrist, angled out and forward.
  const thumb = [];
  {
    let parent = bones[0];
    for (let j = 0; j < 3; j++) {
      const at = j === 0 ? THUMB.at : [0, -THUMB.len * SPLIT[j - 1], 0];
      const b = add(parent, at[0] * side, at[1], at[2]);
      const r = 0.0105 - j * 0.002;
      pieces.push([segment(THUMB.len * SPLIT[j], r, r * 0.85), bones.length - 1]);
      thumb.push(b);
      parent = b;
    }
  }

  // Each piece was made round its own joint: move it to where that joint is, all straight.
  bones[0].updateMatrixWorld(true);
  const at = new THREE.Vector3();
  const geos = pieces.map(([g, b]) => follows(g.translate(...bones[b].getWorldPosition(at).toArray()), b));
  const mesh = new THREE.SkinnedMesh(mergeGeometries(geos), material);
  geos.forEach((g) => g.dispose());
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false; // its bounding sphere is the open hand's; the fingers move
  mesh.scale.setScalar(size);

  // Where a pebble sits: against the curled fingers, in front of the palm.
  const grip = new THREE.Object3D();
  grip.position.set(0, -PALM - 0.03, -0.045);
  mesh.add(grip);

  // What the fingers are doing now, eased towards what they are asked to do.
  const now = { curl: 0.3, splay: 0, stroke: 0 };
  let t = Math.random() * 10;

  // curl: 0 open .. 1 a fist (closing round a pebble is about 0.75); splay: 0..1 fingers
  // spread wide and bent back (throwing); stroke: 0..1 fingers ripple in turn (petting).
  function update(dt, want) {
    t += dt;
    const k = Math.min(1, dt * SMOOTH);
    for (const key in now) now[key] += ((want[key] ?? 0) - now[key]) * k;
    const { curl, splay, stroke } = now;
    for (const f of fingers) {
      // A slow drift so a hand at rest is never quite still, and the stroke's ripple.
      const ripple = stroke * (0.5 + 0.5 * Math.sin(t * 9 - f.phase * 2)) * 0.9;
      const c = curl * (1 - splay) + 0.03 * Math.sin(t * 0.7 + f.phase) + ripple - 0.25 * splay;
      f.chain.forEach((b, j) => { b.rotation.x = c * BEND[j]; });
      f.chain[0].rotation.z = f.fan * (1 + 2.5 * splay);
    }
    const tc = curl * (1 - splay) + 0.4 * stroke * 0.3;
    thumb[0].rotation.set(THUMB.forward * (1 - 0.6 * splay) + tc * 0.4, 0, THUMB.out * side * (1 + 0.6 * splay));
    thumb[1].rotation.x = tc * THUMB_BEND[1];
    thumb[2].rotation.x = tc * THUMB_BEND[2];
  }
  update(1, now);

  return { mesh, grip, update };
}
