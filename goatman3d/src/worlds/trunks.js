import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadImage, loadTexture, canvas, crunchy } from '../textures.js';
import { walkPath } from '../terrain.js';
import { nearestOnPath } from '../player.js';

// The night forest's trunks, from fore.png: low-poly bark cylinders, and "extruded cards":
// Charlie's painted trunk cut-outs given a little thickness, like a cardboard diorama.
// Hundreds of them are merged into a few meshes per stretch of path so they draw fast.

const SLICE = 8; // pixel rows between the points of a card's outline
const DEPTH = 0.3; // card thickness, metres
const CHUNK = 32; // metres of path per merged mesh

const lerp = (a, b, k) => a + (b - a) * k;

// --- Where the trunks go -------------------------------------------------------------------
// From levels.json "trunks": rows of trunks along both sides of the path, a few leaning hard
// or arching over it, a few in the way, and a thicket behind the start. Returns one spec
// per trunk; `near` ones block the camera and (if close enough) the player.
export function plantTrunks(def, path, heightAt, r, keepClear = []) {
  const half = path.width / 2;
  const len = walkPath(path.points, 0.5).at(-1).t;
  const specs = [];

  // o: anything to force (radius, height, lean, leanDir, card, near). force: skip the
  // check that keeps the corridor and the keepClear spots open.
  function add(x, z, o = {}, force = false) {
    const near = nearestOnPath(path.points, x, z);
    const card = o.card ?? r() < def.cards;
    const radius = o.radius ?? lerp(def.radius[0], def.radius[1], r() * r());
    const room = card ? 0.4 : radius;
    if (!force && (near.d - room < half + 0.3 || keepClear.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr + room))) return;
    specs.push({
      x, z, y: heightAt(x, z) - 0.3, radius, card,
      height: o.height ?? lerp(def.height[0], def.height[1], r()),
      // cards turn their painted face to the path
      yaw: Math.atan2(near.x - x, near.z - z) + (r() - 0.5) * 0.7,
      leanDir: o.leanDir ?? r() * Math.PI * 2,
      lean: o.lean ?? r() * def.lean,
      art: Math.floor(r() * 6),
      tint: 1.3 + r() * 0.9,
      near: o.near ?? near.d < 9.5,
      t: near.t,
    });
  }

  for (const [min, max, spacing] of def.rows) {
    for (const s of walkPath(path.points, spacing, r() * spacing)) {
      for (const side of [-1, 1]) {
        const off = side * lerp(min, max, r());
        const along = (r() - 0.5) * spacing * 0.8;
        add(s.x + s.nx * off + s.dx * along, s.z + s.nz * off + s.dz * along);
      }
    }
  }
  // Trunks leaning hard, and a few fallen across the path high enough to walk under.
  walkPath(path.points, len / def.leaners, 5).forEach((s, i) => {
    const side = i % 2 ? 1 : -1;
    add(s.x + s.nx * side * 6, s.z + s.nz * side * 6, { lean: 0.25 + r() * 0.2, card: false });
  });
  for (const s of walkPath(path.points, len / (def.arches + 1), len / (def.arches + 1))) {
    if (s.t > len - 20) break;
    const side = Math.round(s.t) % 2 ? 1 : -1;
    // tipped toward the path: about 3.4 m up where it crosses the edge of the corridor
    const leanDir = Math.atan2(-s.nz * side, -s.nx * side);
    add(s.x + s.nx * side * 6.5, s.z + s.nz * side * 6.5, { lean: 0.78, leanDir, radius: 0.45, height: 22, card: false, near: true });
  }
  // A few right in the way, to walk around.
  for (const s of walkPath(path.points, (len - 45) / def.inPath, 20).slice(0, def.inPath)) {
    const off = (Math.round(s.t) % 2 ? 1 : -1) * (1 + r() * 0.8);
    add(s.x + s.nx * off, s.z + s.nz * off, { radius: 0.32 + r() * 0.15, card: false, near: true }, true);
  }
  // A thicket behind where he starts, so the only way is forward.
  const [sx, sz] = path.points[0], [nx, nz] = path.points[1];
  const back = Math.atan2(sz - nz, sx - nx);
  for (let i = 0; i < def.behind; i++) {
    const a = back + (r() - 0.5) * Math.PI * 1.3;
    const d = 4.2 + r() * r() * 18;
    add(sx + Math.cos(a) * d, sz + Math.sin(a) * d);
  }
  return specs;
}

// --- The painted cards ---------------------------------------------------------------------

// All six trunk cut-outs side by side in one texture (so all cards draw in one go), with
// a patch of plain bark at the end for their edges. The tops fade to black.
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
  const texture = crunchy(c);
  return { texture, cards };
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

// --- Building the meshes ----------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const m = new THREE.Matrix4(), q = new THREE.Quaternion(), lean = new THREE.Quaternion();
const axis = new THREE.Vector3(), pos = new THREE.Vector3(), size = new THREE.Vector3();

function place(geo, t, sx, sy) {
  q.setFromAxisAngle(UP, t.yaw);
  axis.set(Math.cos(t.leanDir), 0, Math.sin(t.leanDir));
  lean.setFromAxisAngle(axis.cross(UP).normalize(), -t.lean); // tip over toward leanDir
  q.premultiply(lean);
  m.compose(pos.set(t.x, t.y, t.z), q, size.set(sx, sy, 1));
  geo.applyMatrix4(m);
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([t.tint, t.tint, t.tint * 1.06], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function cylinder(t) {
  const geo = new THREE.CylinderGeometry(t.radius * 0.7, t.radius, t.height, 7, 1, true);
  geo.translate(0, t.height / 2, 0);
  const uv = geo.attributes.uv;
  const around = Math.max(1, Math.round((Math.PI * 2 * t.radius) / 1.6));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, (uv.getY(i) * t.height) / 3);
  return place(geo, t, 1, 1);
}

function extruded(t, atlas) {
  const card = atlas.cards[t.art];
  const height = t.height * 0.75;
  return place(card.geometry.clone(), t, height * (card.w / 256) * 0.75, height);
}

// Merges the trunks into meshes: per stretch of path, cylinders and cards, near and far.
// Returns { meshes, blockers, colliders }.
export async function buildTrunks(specs) {
  const bark = await loadTexture('assets/forest/bark.png', 1);
  const atlas = await cardAtlas();
  const barkMat = new THREE.MeshLambertMaterial({ map: bark, vertexColors: true, flatShading: true });
  const cardMat = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, flatShading: true, alphaTest: 0.5 });
  const lists = new Map();
  const colliders = [];
  for (const t of specs) {
    const key = `${Math.floor(t.t / CHUNK)}-${t.card ? 'card' : 'bark'}-${t.near ? 'near' : 'far'}`;
    if (!lists.has(key)) lists.set(key, []);
    lists.get(key).push(t.card ? extruded(t, atlas) : cylinder(t));
    const r = t.card ? Math.min(1, t.height * 0.06) : t.radius;
    if (t.near) colliders.push({ kind: 'circle', x: t.x, z: t.z, r });
  }
  const meshes = [], blockers = [];
  for (const [key, geos] of lists) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), key.includes('card') ? cardMat : barkMat);
    for (const g of geos) g.dispose();
    meshes.push(mesh);
    if (key.endsWith('near')) blockers.push(mesh);
  }
  for (const card of atlas.cards) card.geometry.dispose();
  return { meshes, blockers, colliders };
}
