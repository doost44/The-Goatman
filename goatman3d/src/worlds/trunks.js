import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadImage, loadTexture, canvas, crunchy, toCanvas } from '../textures.js';
import { limb } from './tealtree.js';

// The night forest's wood, from fore.png: low-poly bark cylinders and "extruded cards"
// (Charlie's painted trunk cut-outs given a little thickness, like a cardboard diorama),
// the roots round the big trunks, the fallen ones and the ones bent over into arches, and
// a few of weathered pale dead wood. woods.js says where they all go. Each kind is an
// instanced mesh in the scatter, so only the ones near the camera are drawn; the arches are
// one merged mesh.

const SLICE = 8; // pixel rows between the points of a card's outline
const DEPTH = 0.3; // card thickness, metres
// Bark cylinders come in three sizes, so the bark's pattern is about the same size on all
// of them: [up to this radius, times the bark goes round].
const SIZES = [[0.5, 1], [1.1, 3], [Infinity, 7]];
const TALL = 24; // metres the bark's pattern is fitted to up a trunk (taller ones stretch it)

// --- The painted cards ---------------------------------------------------------------------

// All six trunk cut-outs side by side in one texture (so all cards draw with one material),
// with a patch of plain bark at the end for their edges. The tops fade to black.
async function cardAtlas() {
  const imgs = [];
  for (let i = 1; i <= 6; i++) imgs.push(await loadImage(`assets/forest/trunk${i}.png`));
  const PATCH = 8;
  const width = imgs.reduce((w, im) => w + im.width, 0) + PATCH;
  const c = canvas(width, 256);
  const g = c.getContext('2d');
  let x = 0;
  const cards = imgs.map((im) => {
    g.drawImage(im, x, 0);
    const card = { x0: x, w: im.width };
    x += im.width;
    return card;
  });
  g.globalCompositeOperation = 'source-atop'; // darken the paint, keep the cut-out
  const fade = g.createLinearGradient(0, 0, 0, 110);
  fade.addColorStop(0, 'rgba(0,0,0,0.9)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, width, 110);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#140d0b';
  g.fillRect(x, 0, PATCH, 256);
  const data = g.getImageData(0, 0, width, 256).data;
  for (const card of cards) card.geometry = cardGeometry(card, data, width, (x + PATCH / 2) / width);
  return { texture: crunchy(c), cards };
}

// A card's outline is traced from the cut-out's alpha (the outermost painted pixel on every
// few rows), extruded, and drawn with the painting on its faces.
function cardGeometry(card, data, width, patchU) {
  const left = [], right = [];
  for (let y = 0; y <= 256; y += SLICE) {
    const row = Math.min(y, 255);
    let a = -1, b = -1;
    for (let x = card.x0; x < card.x0 + card.w; x++) {
      if (data[(row * width + x) * 4 + 3] > 127) { if (a < 0) a = x; b = x + 1; }
    }
    if (a < 0) continue;
    left.push(new THREE.Vector2(a / width, 1 - y / 256));
    right.push(new THREE.Vector2(b / width, 1 - y / 256));
  }
  // Drawn in texture coordinates, so the faces' UVs already point at the painting.
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape([...left, ...right.reverse()]), { depth: DEPTH, bevelEnabled: false });
  const uv = geo.attributes.uv;
  const sides = geo.groups[1];
  for (let i = sides.start; i < sides.start + sides.count; i++) uv.setXY(i, patchU, 0.5);
  geo.clearGroups();
  // Then to metres: 1 wide and 1 tall (scaled per trunk), standing on y = 0.
  geo.translate(-(card.x0 + card.w / 2) / width, 0, -DEPTH / 2);
  geo.scale(width / card.w, 1, 1);
  return geo;
}

// --- The shapes, each 1 across ------------------------------------------------------------

// A trunk 1 tall with a foot 1 in radius, narrowing to the top.
function barkGeometry(around) {
  const geo = new THREE.CylinderGeometry(0.7, 1, 1, 7, 1, true).translate(0, 0.5, 0);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, (uv.getY(i) * TALL) / 3);
  return geo;
}

// A root of a trunk 1 in radius, from inside its foot out and down into the ground.
function rootGeometry(shape) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const points = shape
    ? [V(0.5, 0.9, 0), V(1.1, 0.5, 0.2), V(1.9, 0.15, -0.1), V(2.8, -0.15, 0.1)]
    : [V(0.5, 0.6, 0), V(1.3, 0.28, 0), V(2.1, 0.05, 0), V(3, -0.15, 0)];
  return limb(points, 0.42, 0.07, 5).geo;
}

// A fallen trunk 1 long and 1 in radius lying along x, closed so its cut ends show.
function logGeometry() {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 7, 1, false).rotateZ(Math.PI / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3);
  return geo;
}

// Weathered dead wood, pale as old bone: the bark's light and dark swapped, so the
// painting's specks become dark cracks in pale grey wood.
function bleached(img) {
  const c = toCanvas(img), g = c.getContext('2d');
  const data = g.getImageData(0, 0, c.width, c.height), p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const v = Math.max(20, 150 - (p[i] + p[i + 1] + p[i + 2])); // bark is 0-40 bright
    p[i] = v; p[i + 1] = v * 0.97; p[i + 2] = v * 0.92;
  }
  g.putImageData(data, 0, 0);
  return c;
}

// --- Placing them --------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0), ALONG = new THREE.Vector3(0, 0, 1);
const m = new THREE.Matrix4(), q = new THREE.Quaternion(), turn = new THREE.Quaternion();
const axis = new THREE.Vector3(), pos = new THREE.Vector3(), size = new THREE.Vector3();

// Standing at (t.x, t.y, t.z), turned by t.yaw and tipped t.lean toward t.leanDir.
function standing(t, sx, sy, sz) {
  q.setFromAxisAngle(UP, t.yaw);
  axis.set(Math.cos(t.leanDir), 0, Math.sin(t.leanDir));
  turn.setFromAxisAngle(axis.cross(UP).normalize(), -t.lean);
  q.premultiply(turn);
  return m.compose(pos.set(t.x, t.y, t.z), q, size.set(sx, sy, sz));
}

// Turned to face `yaw` (round y, x pointing along it) and tipped `pitch` up (round its z).
function lying(x, y, z, yaw, pitch, sx, sy, sz) {
  q.setFromAxisAngle(UP, yaw).multiply(turn.setFromAxisAngle(ALONG, pitch));
  return m.compose(pos.set(x, y, z), q, size.set(sx, sy, sz));
}

// Puts everything woods.js planned into the scatter. blush(x, z): 0-1, how much the pink
// light of the way out tints the wood there. Returns the merged arches, the same arches one
// by one for raycasts, the scatter kinds the camera and pebbles bump into, and the materials.
export async function buildTrunks(plan, scatter, blush = () => 0) {
  const bark = await loadTexture('assets/forest/bark.png', 1);
  const atlas = await cardAtlas();
  const lambert = (o) => new THREE.MeshLambertMaterial({ flatShading: true, ...o });
  const barkMat = lambert({ map: bark });
  const bone = crunchy(bleached(bark.image), 1);
  const paleMat = lambert({ map: bone, emissive: '#5a5e70', emissiveMap: bone }); // faintly ghostly even in shadow
  const cardMat = lambert({ map: atlas.texture, alphaTest: 0.5 });
  const kinds = (mat) => ({
    sizes: SIZES.map(([, around]) => scatter.kind(barkGeometry(around), mat)),
    roots: [0, 1].map((shape) => scatter.kind(rootGeometry(shape), mat)),
  });
  const dark = kinds(barkMat), pale = kinds(paleMat);
  const cards = atlas.cards.map((card) => scatter.kind(card.geometry, cardMat));
  const logs = scatter.kind(logGeometry(), paleMat), darkLogs = scatter.kind(logGeometry(), barkMat);

  const color = new THREE.Color(), pink = new THREE.Color();
  const tint = (x, z, k) => color.setRGB(k, k, k * 1.06).lerp(pink.setRGB(1.7 * k, 0.85 * k, 1.25 * k), blush(x, z));
  for (const t of plan.trunks) {
    if (t.card) {
      const card = atlas.cards[t.art], height = t.height * 0.75;
      scatter.add(cards[t.art], standing(t, height * (card.w / 256) * 0.75, height, 1), tint(t.x, t.z, t.tint));
    } else {
      const k = SIZES.findIndex(([max]) => t.radius <= max);
      scatter.add((t.pale ? pale : dark).sizes[k], standing(t, t.radius, t.height, t.radius), tint(t.x, t.z, t.tint));
    }
  }
  for (const r of plan.roots) {
    scatter.add((r.pale ? pale : dark).roots[r.shape], lying(r.x, r.y, r.z, -r.yaw, r.tilt, r.size, r.size, r.size), tint(r.x, r.z, r.tint));
  }
  for (const l of plan.logs) {
    const len = Math.hypot(l.bx - l.ax, l.bz - l.az);
    const yaw = Math.atan2(-(l.bz - l.az), l.bx - l.ax), pitch = Math.atan2(l.yb - l.ya, len);
    scatter.add(l.dark ? darkLogs : logs, lying(l.x, (l.ya + l.yb) / 2, l.z, yaw, pitch, len, l.r, l.r), tint(l.x, l.z, l.tint));
  }

  // The arches: tubes bent along their curves, tinted through their vertex colours.
  const geos = plan.arches.map((a) => {
    const { geo } = limb(a.points, a.r0, a.r1, 6);
    const c = tint(a.points[3].x, a.points[3].z, a.tint);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count).fill([c.r, c.g, c.b]).flat(), 3));
    return geo;
  });
  const arches = new THREE.Mesh(mergeGeometries(geos), lambert({ map: bark, vertexColors: true }));
  // Raycasts (the chase camera, pebbles) use each arch on its own, never drawn, so a ray only
  // works through the triangles of an arch it comes near.
  const archBlockers = geos.map((g) => new THREE.Mesh(g, arches.material));
  return { arches, archBlockers, solid: [...dark.sizes, ...pale.sizes, ...cards, logs, darkLogs], mats: { bark: barkMat, pale: paleMat } };
}

// A few big bark trunks on their own, merged into one mesh (the field's way back).
// specs: [{ x, y, z, radius, height, yaw, lean, leanDir }]. Returns { mesh, colliders }.
export async function barkTrunks(specs) {
  const bark = await loadTexture('assets/forest/bark.png', 1);
  const geos = specs.map((t) => barkGeometry(SIZES.find(([max]) => t.radius <= max)[1]).applyMatrix4(standing(t, t.radius, t.height, t.radius)));
  const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ map: bark, flatShading: true }));
  for (const g of geos) g.dispose();
  return { mesh, colliders: specs.map((t) => ({ kind: 'circle', x: t.x, z: t.z, r: t.radius })) };
}
