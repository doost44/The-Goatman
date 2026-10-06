import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadImage, canvas, crunchy, rng } from '../textures.js';
import { createScatter } from './scatter.js';
import { strandGeometry, swaying } from './strands.js';
import { haze } from './horizon.js';
import { pine, oak, cypress, snag } from './lowcountry-trees.js';

// Where the savanna's South Carolina trees stand (lowcountry-trees.js makes them): longleaf
// pines spaced far apart over the open flats, live oaks hung with Spanish moss near the
// willow and the river, bald cypress with their knees in the swamp's dark water, dead trees
// standing in the swamp, the bays and the marsh's creeks, and at the edge of the land a real
// band of dark forest (cards cut from the painted treeline) that you can ride into a little
// way. A couple of giants (hazed by distance, not fogged out) can be seen from anywhere.
// A few kinds of each tree, thousands of copies in scatters (scatter.js); their trunks are
// solid, kept in a grid so only the ones near him are tested.
//
// levels.json "lowcountry": {
//   pines: { count, areas: [[x, z, radius], ...], gap (metres between), tall: [min, max] },
//   oaks: { count, areas, gap, size: [min, max] },
//   cypress: { count, gap, tall },   (in the swamp)
//   snags: { count, gap, tall },     (in the swamp, the bays and the creeks)
//   band: { from, to (metres from the middle), count, gap, tall, opening: [x, z, width] (the
//     way out through it), texture, reach },
//   giants: [{ kind: pine | cypress | snag, at, tall, seed }],
//   reach (pines), near (the other trees) }

const CELL = 24; // metres per square of the grid of trunks
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Bark: a dark base with streaks along the grain.
function barkPaint(r, base, streaks) {
  const c = canvas(16, 64);
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 16, 64);
  for (let i = 0; i < 50; i++) {
    g.fillStyle = streaks[Math.floor(r() * streaks.length)];
    g.fillRect(Math.floor(r() * 16), Math.floor(r() * 64), 1, 3 + Math.floor(r() * 10));
  }
  return crunchy(c, [1, 1]);
}

// Spanish moss: grey-green wisps, four tiles of three strands each, thinning to the tips.
function mossPaint(r) {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  for (let t = 0; t < 4; t++) {
    for (let s = 0; s < 4; s++) {
      let x = t * 16 + 2 + s * 3 + Math.floor(r() * 2);
      const len = 30 + Math.floor(r() * 34);
      for (let y = 0; y < len; y++) {
        if (r() < 0.15) x = THREE.MathUtils.clamp(x + (r() < 0.5 ? -1 : 1), t * 16, t * 16 + 15);
        g.fillStyle = ['#6e7a6a', '#8a9480', '#5a6458', '#9aa08c', '#76705e'][Math.floor(r() * 5)];
        g.fillRect(x, y, y < len * 0.7 && r() < 0.6 ? 2 : 1, 1);
        if (r() < 0.12) g.fillRect(x + (r() < 0.5 ? -1 : 2), y, 1, 2); // a wisp off it
      }
    }
  }
  return crunchy(c);
}

// The band's trees: cards cut from the painted treeline's dark streaks, each shaped into a
// tall ragged crown on a short dark trunk. Three side by side.
async function bandPaint(url, r) {
  const img = await loadImage(url);
  const c = canvas(96, 128);
  const g = c.getContext('2d');
  for (let k = 0; k < 3; k++) {
    g.drawImage(img, img.width * (0.62 + k * 0.1), img.height * 0.45, img.width * 0.12, img.height * 0.5, k * 32, 0, 32, 128);
  }
  const p = g.getImageData(0, 0, 96, 128);
  for (let k = 0; k < 3; k++) {
    const peak = 4 + Math.floor(r() * 10);
    for (let y = 0; y < 128; y++) {
      const crown = y < 112 ? Math.min(15, ((y - peak) / (100 - peak)) * 15 + 2) : 2.5; // then the trunk
      for (let x = 0; x < 32; x++) {
        const half = crown + (r() - 0.5) * 3, i = (y * 96 + k * 32 + x) * 4;
        const inside = y >= peak && Math.abs(x - 15.5) < half;
        p.data[i + 3] = inside ? 255 : 0;
        if (y >= 112) p.data.set([24, 10, 18], i); // the trunk
      }
    }
  }
  g.putImageData(p, 0, 0);
  return crunchy(c);
}

// Standing cards, two crossed, lit like the ground, showing u0..u1 of the paint.
function crossed(w, h, u0, u1) {
  const card = new THREE.PlaneGeometry(w, h).translate(0, h / 2 - 0.3, 0);
  const uv = card.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) ? u1 : u0);
  const geo = mergeGeometries([card, card.clone().rotateY(Math.PI / 2)]);
  const normal = geo.attributes.normal;
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0);
  return geo;
}

// heightAt; waters (waters.js); open(x, z): may a tree stand on land here; bounds: metres from
// the middle he can reach; fog: the level's live fog colour (the giants are hazed toward it).
export async function buildLowcountry(d, { heightAt, waters, open, bounds, fog }) {
  const r = rng(d.seed ?? 13);
  const time = { value: 0 };
  const mat = {
    pine: new THREE.MeshLambertMaterial({ map: barkPaint(r, '#3a1418', ['#5a2418', '#2a0c12', '#6a3020']), flatShading: true }),
    bark: new THREE.MeshLambertMaterial({ map: barkPaint(r, '#2e2228', ['#1a1216', '#3e3036', '#4a3a3e']), flatShading: true }),
    dead: new THREE.MeshLambertMaterial({ map: barkPaint(r, '#5a5058', ['#3a3038', '#6e6268', '#4a4048']), flatShading: true }),
    tufts: new THREE.MeshLambertMaterial({ color: '#2a6274', flatShading: true }),
    leaves: new THREE.MeshLambertMaterial({ color: '#24566a', flatShading: true }),
    needles: new THREE.MeshLambertMaterial({ color: '#36584e', flatShading: true }),
    moss: swaying(new THREE.MeshLambertMaterial({ map: mossPaint(r), alphaTest: 0.5, side: THREE.DoubleSide }), { uTime: time }, { amount: 0.35, key: 'moss' }),
  };

  // The trunks he can't walk through, in a grid.
  const grid = new Map();
  const solid = (x, z, rad) => {
    const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ kind: 'circle', x, z, r: rad });
  };
  const near = (x, z, rad) => {
    const out = [];
    for (let i = Math.floor((x - rad) / CELL); i <= Math.floor((x + rad) / CELL); i++) {
      for (let j = Math.floor((z - rad) / CELL); j <= Math.floor((z + rad) / CELL); j++) {
        for (const c of grid.get(`${i},${j}`) ?? []) if (Math.hypot(c.x - x, c.z - z) < rad + c.r) out.push(c);
      }
    }
    return out;
  };

  // n spots from pick(), each ok and at least `gap` from the others (gives up after a while).
  function spots(n, pick, gap, ok) {
    const out = [], taken = new Map(), G = Math.max(gap, 1);
    const free = (x, z) => {
      for (let i = Math.floor(x / G) - 1; i <= Math.floor(x / G) + 1; i++) {
        for (let j = Math.floor(z / G) - 1; j <= Math.floor(z / G) + 1; j++) {
          for (const [px, pz] of taken.get(`${i},${j}`) ?? []) if (Math.hypot(px - x, pz - z) < gap) return false;
        }
      }
      return true;
    };
    for (let tries = 0; out.length < n && tries < n * 40; tries++) {
      const p = pick();
      if (!p || !ok(p.x, p.z) || !free(p.x, p.z)) continue;
      out.push(p);
      const k = `${Math.floor(p.x / G)},${Math.floor(p.z / G)}`;
      if (!taken.has(k)) taken.set(k, []);
      taken.get(k).push([p.x, p.z]);
    }
    return out;
  }
  const inDisc = (areas) => () => {
    const weights = areas.map((a) => a[2] ** 2), total = weights.reduce((s, w) => s + w, 0);
    let w = r() * total, i = 0;
    while (w > weights[i]) w -= weights[i++];
    const [x, z, rad] = areas[i], a = r() * Math.PI * 2, out = Math.sqrt(r()) * rad;
    return { x: x + Math.cos(a) * out, z: z + Math.sin(a) * out };
  };
  const inside = (x, z) => Math.hypot(x, z) < bounds;
  const onLand = (x, z) => inside(x, z) && open(x, z);
  const swamp = waters.swamp;
  const inSwamp = () => {
    const a = r() * Math.PI * 2, out = Math.sqrt(r()) * swamp.outline(a) * 0.9;
    return { x: swamp.at[0] + Math.cos(a) * out, z: swamp.at[1] + Math.sin(a) * out };
  };
  const inWater = () => {
    const k = r();
    if (k < 0.45 || !waters.creeks.length) return swamp ? inSwamp() : null;
    if (k < 0.7) {
      const pool = waters.pools[Math.floor(r() * waters.pools.length)], a = r() * Math.PI * 2, out = Math.sqrt(r()) * pool.outline(a) * 0.8;
      return { x: pool.at[0] + Math.cos(a) * out, z: pool.at[1] + Math.sin(a) * out };
    }
    const creek = waters.creeks[Math.floor(r() * waters.creeks.length)], s = r() * creek.length, here = creek.at(s);
    return creek.at(s, (r() - 0.5) * here.edge);
  };

  // Puts copies of a few kinds of tree into a scatter: makes `variants` trees with make(r,
  // size), then each spot gets one of them, turned any way and a little bigger or smaller.
  const turn = new THREE.Quaternion(), scale = new THREE.Vector3(), at = new THREE.Vector3(), m = new THREE.Matrix4(), UP = V(0, 1, 0);
  function plant(scatter, list, variants, make, [lo, hi], parts, radius) {
    const kinds = Array.from({ length: variants }, () => {
      const tree = make(r, lo + r() * (hi - lo));
      return parts.map(([name, material]) => (tree[name] ? scatter.kind(name === 'moss' ? strandGeometry(tree[name], 0.9) : tree[name], material) : null));
    });
    list.forEach((p, i) => {
      const k = 0.85 + r() * 0.3;
      turn.setFromAxisAngle(UP, r() * Math.PI * 2);
      m.compose(at.set(p.x, heightAt(p.x, p.z), p.z), turn, scale.setScalar(k));
      for (const kind of kinds[i % variants]) if (kind !== null) scatter.add(kind, m);
      solid(p.x, p.z, radius * k);
    });
  }

  const far = createScatter({ reach: d.reach }); // the pines: tall, seen a long way off
  const close = createScatter({ reach: d.near });
  const P = d.pines, O = d.oaks, C = d.cypress, S = d.snags, B = d.band;
  plant(far, spots(P.count, inDisc(P.areas), P.gap, onLand), 5, pine, P.tall, [['wood', mat.pine], ['crown', mat.tufts]], 0.45);
  plant(close, spots(O.count, inDisc(O.areas), O.gap, onLand), 3, oak, O.size, [['wood', mat.bark], ['crown', mat.leaves], ['moss', mat.moss]], 1.1);
  if (swamp) plant(close, spots(C.count, inSwamp, C.gap, inside), 3, cypress, C.tall, [['wood', mat.bark], ['crown', mat.needles], ['moss', mat.moss]], 1.4);
  plant(close, spots(S.count, inWater, S.gap, inside), 3, snag, S.tall, [['wood', mat.dead], ['moss', mat.moss]], 0.4);

  // The band of forest at the edge, leaving the way out open.
  const band = createScatter({ reach: B.reach });
  const bandMat = new THREE.MeshLambertMaterial({ map: await bandPaint(B.texture, r), alphaTest: 0.5, side: THREE.DoubleSide });
  const cards = [0, 1, 2].map((k) => band.kind(crossed(7, B.tall, k / 3, (k + 1) / 3), bandMat));
  const [ox, oz, ow] = B.opening, oa = Math.atan2(oz, ox);
  const ring = () => {
    const a = r() * Math.PI * 2, out = Math.sqrt(B.from ** 2 + r() * (B.to ** 2 - B.from ** 2));
    return { x: Math.cos(a) * out, z: Math.sin(a) * out, a, out };
  };
  for (const p of spots(B.count, ring, B.gap, (x, z) => Math.abs(Math.atan2(Math.sin(Math.atan2(z, x) - oa), Math.cos(Math.atan2(z, x) - oa))) * Math.hypot(x, z) > ow / 2)) {
    const k = 0.7 + r() * 0.6;
    turn.setFromAxisAngle(UP, r() * Math.PI);
    m.compose(at.set(p.x, heightAt(p.x, p.z), p.z), turn, scale.set(k, 0.8 + r() * 0.5, k));
    band.add(cards[Math.floor(r() * 3)], m);
    if (p.out < bounds + 4) solid(p.x, p.z, 0.7);
  }

  // The giants: one each, real geometry hazed toward the fog instead of fogged out.
  const giants = new THREE.Group();
  const hazy = (material) => {
    const h = material.clone();
    haze(h, { color: fog, from: 150, to: 1600, a: 0, b: 0.7 });
    return h;
  };
  const make = { pine, cypress, snag };
  const looks = { pine: [mat.pine, mat.tufts], cypress: [mat.bark, mat.needles], snag: [mat.dead] };
  for (const g of d.giants ?? []) {
    const tree = make[g.kind](rng(g.seed ?? 3), g.tall / 3);
    const [wood, crown] = looks[g.kind].map(hazy);
    const one = new THREE.Group();
    one.add(new THREE.Mesh(tree.wood, wood));
    if (tree.crown) one.add(new THREE.Mesh(tree.crown, crown));
    if (tree.moss) one.add(new THREE.Mesh(strandGeometry(tree.moss, 0.6), mat.moss));
    one.scale.setScalar(3);
    one.position.set(g.at[0], heightAt(...g.at), g.at[1]);
    giants.add(one);
    solid(g.at[0], g.at[1], 4);
  }

  return {
    meshes: [...far.done(), ...close.done(), ...band.done(), giants],
    near, // (x, z, radius): the trunks there
    update(camera, t) {
      far.update(camera);
      close.update(camera);
      band.update(camera);
      time.value = t;
    },
  };
}
