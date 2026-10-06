import * as THREE from 'three';
import { walkPath, valueNoise } from '../terrain.js';
import { nearestOnPath } from '../player.js';

// Where everything in the night forest goes (forest.js and trunks.js build it): an open forest
// spreading out from the main path in every direction, thick along the paths' edges, gathered
// into clusters and opening into clearings, closing in impassably at its far edge. Trunks
// lean, a few arch over and some have fallen; the big ones have roots; dark undergrowth and
// stones lie everywhere; and there are spots for the eyes to look out from, more of them
// deeper in. Only numbers here: { trunks, logs, arches, roots, growth, stones, spots, near,
// crowded, wall }.
//
// levels.json "woods": { spacing (metres between trunks in the open), gap (the narrowest gap
//   left to walk through), noise (scale of the clusters and clearings), clearings and clusters
//   (noise levels below and above which), big: [share, min, max] (big trunks), edge: [from, to]
//   (where they close in), wall (an invisible ring behind the closed edge, just in case), logs,
//   arches, stones, eyeSpots, snags (pale dead trunks standing about), reach (how far from the
//   camera things are drawn) }
// "trunks": { rows (along the main path), radius, height, lean, cards, leaners, inPath, behind,
//   toGate: [degrees, degrees, from, to] (every pale trunk leans toward the way out: the first
//   angle up to `from` metres from it, easing to the second by `to`) }
// "undergrowth": { count, size }
// "sidePaths": [{ points, width, mouth: "leaning" | "undergrowth", end: { kind, at, radius (of the
//   clearing), ring and trunks (a ring's), size and tint (a tree's) } }]

const lerp = THREE.MathUtils.lerp;
const CELL = 8; // metres per square of the grid things are sorted into, to find neighbours

export function planForest(def, heightAt, r, { keepClear = [], trunks: fixed = [] } = {}) {
  const W = def.woods, T = def.trunks;
  const [cx, cz] = def.terrain.center;
  const side = def.sidePaths ?? [];
  const paths = [def.path, ...side].map((p) => ({ points: p.points, half: p.width / 2 }));
  const clear = [...keepClear, ...side.filter((p) => p.end).map((p) => [...p.end.at, p.end.radius])];
  const trunks = [], logs = [], arches = [], roots = [], growth = [], stones = [], spots = [];
  const grid = new Map(); // "ix,iz" -> solid things there: { x, z, room, collider }
  const toCentre = (x, z) => Math.hypot(x - cx, z - cz);
  const onPath = (x, z, room) => paths.some((p) => nearestOnPath(p.points, x, z).d < p.half + room);
  const inClearing = (x, z, room) => clear.some(([qx, qz, qr]) => Math.hypot(x - qx, z - qz) < qr + room);
  // Is anything solid within `gap` metres of a circle there?
  function crowded(x, z, radius, gap) {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    for (let i = ix - 1; i <= ix + 1; i++) {
      for (let j = iz - 1; j <= iz + 1; j++) {
        for (const t of grid.get(`${i},${j}`) ?? []) if (Math.hypot(t.x - x, t.z - z) < t.room + radius + gap) return true;
      }
    }
    return false;
  }
  function remember(t) {
    const key = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(t);
  }
  const size = () => (r() < W.big[0] ? lerp(W.big[1], W.big[2], r()) : lerp(T.radius[0], T.radius[1], r() * r()));

  // A trunk at (x, z). o: anything to force (radius, height, lean, leanDir, card, gap). Unless
  // `force`, it keeps off the paths and out of the clearings, with room to walk between.
  function add(x, z, o = {}, force = false) {
    const card = o.card ?? r() < T.cards;
    const radius = o.radius ?? size();
    const height = o.height ?? lerp(T.height[0], T.height[1], r());
    const room = card ? Math.min(1, height * 0.06) : radius; // a card's painted trunk is about that wide at its foot
    if (!force && (onPath(x, z, room + 0.3) || inClearing(x, z, room) || crowded(x, z, room, o.gap ?? W.gap))) return null;
    const near = nearestOnPath(def.path.points, x, z);
    const t = {
      x, z, y: heightAt(x, z) - 0.3, radius, height, room, card,
      // cards near the path turn their painted face to it
      yaw: near.d < 25 ? Math.atan2(near.x - x, near.z - z) + (r() - 0.5) * 0.7 : r() * Math.PI * 2,
      leanDir: o.leanDir ?? r() * Math.PI * 2,
      lean: o.lean ?? r() * T.lean,
      art: Math.floor(r() * 6),
      tint: 1.3 + r() * 0.9,
      noRoots: o.noRoots,
    };
    t.collider = { kind: 'circle', x, z, r: room };
    trunks.push(t);
    remember(t);
    return t;
  }

  for (const t of fixed) { trunks.push(t); remember(t); } // the way out's (gate.js)
  features(def, side, heightAt, r, add, spots);

  // Rows along both sides of the main path, then closer ones along the side paths.
  const rows = (points, list) => {
    for (const [min, max, spacing] of list) {
      for (const s of walkPath(points, spacing, r() * spacing)) {
        for (const k of [-1, 1]) {
          const off = k * lerp(min, max, r()), along = (r() - 0.5) * spacing * 0.8;
          add(s.x + s.nx * off + s.dx * along, s.z + s.nz * off + s.dz * along);
        }
      }
    }
  };
  rows(def.path.points, T.rows);
  for (const p of side) rows(p.points, [[p.width / 2 + 0.6, p.width / 2 + 2.4, 2.8]]);

  const len = walkPath(def.path.points, 0.5).at(-1).t;
  // Trunks leaning hard by the path, and a few right in the way, to walk around.
  walkPath(def.path.points, len / T.leaners, 5).forEach((s, i) => {
    const k = i % 2 ? 1 : -1;
    add(s.x + s.nx * k * 6, s.z + s.nz * k * 6, { lean: 0.25 + r() * 0.2, card: false });
  });
  for (const s of walkPath(def.path.points, (len - 45) / T.inPath, 20).slice(0, T.inPath)) {
    const off = (Math.round(s.t) % 2 ? 1 : -1) * (1 + r() * 0.8);
    add(s.x + s.nx * off, s.z + s.nz * off, { radius: 0.32 + r() * 0.15, card: false }, true);
  }
  // A thicket behind where he starts, so the way to go is forward.
  const [sx, sz] = def.path.points[0], [nx, nz] = def.path.points[1];
  const back = Math.atan2(sz - nz, sx - nx);
  for (let i = 0; i < T.behind; i++) {
    const a = back + (r() - 0.5) * Math.PI * 1.3, d = 4.2 + r() * r() * 18;
    add(sx + Math.cos(a) * d, sz + Math.sin(a) * d);
  }

  // Pale dead snags standing about the forest, here and there.
  for (let n = 0, tries = 0; n < (W.snags ?? 0) && tries < W.snags * 20; tries++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (W.edge[0] - 10);
    const t = add(cx + Math.cos(a) * d, cz + Math.sin(a) * d, { card: false, radius: lerp(0.3, 0.6, r()), height: lerp(7, 16, r()), noRoots: true });
    if (t) { Object.assign(t, { pale: true, tint: 0.55 + r() * 0.3 }); n++; }
  }

  // The open forest: a trunk on each square of a jittered grid, none in the clearings (where
  // the noise is low) and three where it gathers into clusters (where it is high).
  const S = W.spacing;
  for (let gx = cx - W.edge[0]; gx < cx + W.edge[0]; gx += S) {
    for (let gz = cz - W.edge[0]; gz < cz + W.edge[0]; gz += S) {
      const x = gx + r() * S, z = gz + r() * S;
      if (toCentre(x, z) > W.edge[0]) continue;
      const n = 0.7 * valueNoise(x * W.noise + 17, z * W.noise - 9) + 0.3 * valueNoise(x * W.noise * 3, z * W.noise * 3);
      if (n < W.clearings) continue;
      const cluster = n > W.clusters;
      for (let k = 0; k < (cluster ? 3 : 1); k++) {
        add(x + (k ? (r() - 0.5) * S : 0), z + (k ? (r() - 0.5) * S : 0), cluster ? { gap: W.gap * 0.7 } : {});
      }
    }
  }
  // The edge: rings of ever bigger trunks ever closer together, each ring's in front of the
  // last one's gaps, until there is no way through.
  for (let rad = W.edge[0], ring = 0; rad <= W.edge[1]; ring++) {
    const k = (rad - W.edge[0]) / (W.edge[1] - W.edge[0]);
    const radius = lerp(0.6, 1.6, k), gap = lerp(W.gap, 0, k);
    const n = Math.floor((Math.PI * 2 * rad) / (2 * radius + gap));
    for (let i = 0; i < n; i++) {
      const a = ((i + (ring % 2) * 0.5) / n) * Math.PI * 2;
      add(cx + Math.cos(a) * rad, cz + Math.sin(a) * rad, { radius: radius * (0.9 + r() * 0.2), card: false, noRoots: true }, true);
    }
    rad += 2 * radius + 0.4;
  }

  // Every pale trunk leans toward the way out, the nearer the more, so the whole forest
  // points the way once you notice it.
  const [gx, gz] = def.exit.at, [most, least, from, to] = T.toGate ?? [0, 0, 0, 1];
  for (const t of trunks) {
    if (!t.pale) continue;
    t.lean = THREE.MathUtils.degToRad(lerp(most, least, THREE.MathUtils.smoothstep(Math.hypot(gx - t.x, gz - t.z), from, to)));
    t.leanDir = Math.atan2(gz - t.z, gx - t.x);
    t.y -= t.radius * Math.sin(t.lean); // so the raised side of its foot stays in the ground
    const out = Math.tan(t.lean) * 1.2; // the collider goes where the trunk is at his chest
    t.collider.x = t.x + Math.cos(t.leanDir) * out;
    t.collider.z = t.z + Math.sin(t.leanDir) * out;
  }

  const tools = { onPath, inClearing, crowded, remember, toCentre };
  plantLogs(def, heightAt, r, logs, tools);
  plantArches(def, heightAt, r, arches, tools);
  // Roots round the big trunks, tipped so their ends reach the ground.
  for (const t of trunks) {
    if (t.card || t.radius < 0.55 || t.noRoots) continue;
    const n = 3 + Math.floor(r() * 3), turn0 = r() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = turn0 + ((i + (r() - 0.5) * 0.6) / n) * Math.PI * 2;
      const reach = t.radius * 2.9;
      const drop = heightAt(t.x + Math.cos(a) * reach, t.z + Math.sin(a) * reach) - heightAt(t.x, t.z);
      const lean = t.pale ? Math.sin(t.lean) * t.radius * 0.7 : 0; // a leaning trunk's roots go with it
      roots.push({ x: t.x + Math.cos(t.leanDir) * lean, z: t.z + Math.sin(t.leanDir) * lean, y: heightAt(t.x, t.z), yaw: a, size: t.radius * (0.85 + r() * 0.3) * (t.giant ? 1.6 : 1), tilt: Math.atan2(drop, reach), shape: Math.floor(r() * 2), tint: t.tint, pale: t.pale });
    }
  }
  // Undergrowth everywhere off the paths, thickest over the mouths of the hidden ones; and
  // stones, half sunk in the ground.
  const U = def.undergrowth;
  const clump = (x, z, big = 1) => {
    if (crowded(x, z, 0.1, 0)) return;
    growth.push({ x, z, y: heightAt(x, z), size: lerp(U.size[0], U.size[1], r()) * big, yaw: r() * Math.PI, shape: Math.floor(r() * 2) });
  };
  const anywhere = () => {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * W.edge[1];
    return [cx + Math.cos(a) * d, cz + Math.sin(a) * d];
  };
  for (let i = 0; i < U.count; i++) {
    const [x, z] = anywhere();
    if (!onPath(x, z, 0.4)) clump(x, z);
  }
  for (const p of side.filter((q) => q.mouth === 'undergrowth')) {
    for (const s of walkPath(p.points, 0.8).slice(0, 8)) {
      for (let k = 0; k < 3; k++) clump(s.x + (r() - 0.5) * p.width * 1.6, s.z + (r() - 0.5) * p.width * 1.6, 1.5);
    }
  }
  for (let i = 0; i < W.stones; i++) {
    const [x, z] = anywhere();
    if (onPath(x, z, 0.3) || crowded(x, z, 0.3, 0)) continue;
    stones.push({ x, z, y: heightAt(x, z), size: 0.15 + r() * r() * 0.5, yaw: r() * Math.PI * 2, tilt: (r() - 0.5) * 0.6 });
  }
  // Where eyes can look out from: beside trunks, low down or up the trunk, more of them the
  // further from the main path.
  for (let tries = 0; spots.length < W.eyeSpots && tries < W.eyeSpots * 8; tries++) {
    const t = trunks[Math.floor(r() * trunks.length)];
    if (toCentre(t.x, t.z) > W.edge[0]) continue;
    const depth = nearestOnPath(def.path.points, t.x, t.z).d;
    if (r() > 0.15 + 0.85 * THREE.MathUtils.smoothstep(depth, 5, 70)) continue;
    const a = r() * Math.PI * 2, out = t.room + 0.2;
    const x = t.x + Math.cos(a) * out, z = t.z + Math.sin(a) * out;
    if (onPath(x, z, 1)) continue;
    const high = r() < 0.2;
    spots.push({ x, z, y: heightAt(x, z) + (high ? lerp(2, 4.5, r()) : lerp(0.3, 1.1, r())) });
  }

  // The solid things within `radius` of (x, z), as colliders (forest.js keeps those nearby).
  function near(x, z, radius) {
    const out = new Set();
    const n = Math.ceil(radius / CELL), ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    for (let i = ix - n; i <= ix + n; i++) {
      for (let j = iz - n; j <= iz + n; j++) {
        for (const t of grid.get(`${i},${j}`) ?? []) if (Math.hypot(t.x - x, t.z - z) < radius + t.room) out.add(t.collider);
      }
    }
    return [...out];
  }
  return { trunks, logs, arches, roots, growth, stones, spots, near, crowded, wall: { kind: 'ring', x: cx, z: cz, r: W.wall } };
}

// What the side paths lead to (levels.json "end"): a ring of trunks round a clearing, an old
// pale giant with its roots spread wide, or a dell where the eyes gather; and how their mouths
// are hidden: a trunk leaning across.
function features(def, side, heightAt, r, add, spots) {
  const steps = walkPath(def.path.points, 1);
  for (const p of side) {
    if (p.mouth === 'leaning') {
      const [s] = walkPath(p.points, 1, 2.5);
      const along = steps.reduce((a, b) => (Math.hypot(b.x - s.x, b.z - s.z) < Math.hypot(a.x - s.x, a.z - s.z) ? b : a));
      add(s.x + s.nx * 0.5, s.z + s.nz * 0.5, { radius: 0.6, card: false, lean: 0.42, leanDir: Math.atan2(along.dz, along.dx) }, true);
    }
    const e = p.end;
    if (!e) continue;
    const [x, z] = e.at;
    if (e.kind === 'ring') { // tall pale trunks standing evenly round the clearing, like stones
      for (let i = 0; i < e.trunks; i++) {
        const a = (i / e.trunks) * Math.PI * 2;
        const t = add(x + Math.cos(a) * e.ring, z + Math.sin(a) * e.ring, { radius: 1.1 + r() * 0.2, card: false, lean: 0.02, height: 34 }, true);
        Object.assign(t, { pale: true, tint: 0.65 + r() * 0.2, noRoots: true });
      }
    } else if (e.kind === 'tree') {
      const t = add(x, z, { radius: e.size, card: false, lean: 0.05, height: 40 }, true);
      Object.assign(t, { pale: true, tint: e.tint ?? 1.3, giant: true }); // pale, like old bone
    } else if (e.kind === 'eyes') {
      for (let i = 0; i < 26; i++) { // all round the dell, low and high
        const a = (i / 26) * Math.PI * 2 + r() * 0.2, d = e.radius * (0.8 + r() * 0.5);
        const sx = x + Math.cos(a) * d, sz = z + Math.sin(a) * d;
        spots.push({ x: sx, z: sz, y: heightAt(sx, sz) + (i % 4 ? 0.4 + r() * 0.8 : 2 + r() * 2), gather: true });
      }
    }
  }
}

// Fallen trunks lying on the ground: thin ones to step over, thick ones to climb onto.
function plantLogs(def, heightAt, r, logs, { onPath, inClearing, crowded, remember, toCentre }) {
  const W = def.woods, [cx, cz] = def.terrain.center, [gx, gz] = def.exit.at;
  // Its middle line, from end a to end b, sits 0.6 of its radius above the ground there.
  const lay = (ax, az, bx, bz, radius) => ({ ax, az, bx, bz, ya: heightAt(ax, az) + radius * 0.6, yb: heightAt(bx, bz) + radius * 0.6, r: radius, tint: 0.55 + r() * 0.4 });
  // Lying along the ground all the way (not floating over a dip or buried in a bump), and
  // clear of everything else.
  const fits = (log, room) => [0, 0.25, 0.5, 0.75, 1].every((k) => {
    const x = lerp(log.ax, log.bx, k), z = lerp(log.az, log.bz, k);
    const above = lerp(log.ya, log.yb, k) - heightAt(x, z);
    return above > -0.2 * log.r && above < 1.3 * log.r && !crowded(x, z, log.r, room);
  });
  const keep = (log) => {
    log.x = (log.ax + log.bx) / 2;
    log.z = (log.az + log.bz) / 2;
    log.collider = { kind: 'line', ax: log.ax, az: log.az, bx: log.bx, bz: log.bz, r: log.r, ya: log.ya + log.r, yb: log.yb + log.r };
    const n = Math.ceil(Math.hypot(log.bx - log.ax, log.bz - log.az) / 1.5);
    for (let i = 0; i <= n; i++) {
      remember({ x: lerp(log.ax, log.bx, i / n), z: lerp(log.az, log.bz, i / n), room: log.r, collider: log.collider });
    }
    logs.push(log);
  };
  // A few across the main path: two to step over and one to climb.
  const steps = walkPath(def.path.points, 1);
  for (const [k, radius] of [[0.3, 0.26], [0.55, 0.3], [0.78, 0.56]]) {
    for (let tries = 0; tries < 12; tries++) {
      const s = steps[Math.floor(steps.length * k) + tries * 2];
      const half = def.path.width / 2 + 2.2;
      const log = lay(s.x - s.nx * half, s.z - s.nz * half, s.x + s.nx * half, s.z + s.nz * half, radius);
      if (fits(log, 0.2)) { keep(log); break; }
    }
  }
  for (let tries = 0; logs.length < W.logs && tries < W.logs * 30; tries++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (W.edge[0] - 10);
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    const turn = Math.atan2(gz - z, gx - x) + (r() - 0.5) * 0.6, half = 3 + r() * 5, radius = 0.26 + r() * 0.34; // pale, so pointing the way out too
    const dx = Math.cos(turn) * half, dz = Math.sin(turn) * half;
    if ([-1, -0.5, 0, 0.5, 1].some((k) => onPath(x + dx * k, z + dz * k, radius + 0.5) || inClearing(x + dx * k, z + dz * k, radius))) continue;
    const log = lay(x - dx, z - dz, x + dx, z + dz, radius);
    if (toCentre(x, z) < W.edge[0] - 10 && fits(log, 0.5)) keep(log);
  }
}

// Trunks bent over into arches with both ends in the ground: a few over the main path, high
// enough to walk under, and more through the forest.
function plantArches(def, heightAt, r, arches, { onPath, crowded, remember, toCentre }) {
  const W = def.woods, [cx, cz] = def.terrain.center;
  function bend(ax, az, bx, bz, top) {
    const r0 = 0.42 + r() * 0.12, r1 = r0 * 0.55;
    if (crowded(ax, az, r0, 0.3) || crowded(bx, bz, r1, 0.3)) return false;
    const feet = (heightAt(ax, az) + heightAt(bx, bz)) / 2;
    const points = [];
    for (let i = 0; i <= 6; i++) {
      const k = i / 6, x = lerp(ax, bx, k), z = lerp(az, bz, k);
      const up = Math.sin(Math.PI * k) ** 0.6; // steep legs, a rounded top
      points.push(new THREE.Vector3(x, lerp(heightAt(x, z), feet, up) + up * top - 0.2, z));
    }
    arches.push({ points, r0, r1, tint: 1.3 + r() * 0.8 });
    for (const [x, z, radius] of [[ax, az, r0], [bx, bz, r1]]) remember({ x, z, room: radius, collider: { kind: 'circle', x, z, r: radius } });
    return true;
  }
  const steps = walkPath(def.path.points, 1);
  for (const k of [0.2, 0.47, 0.7]) {
    for (let tries = 0; tries < 12; tries++) {
      const s = steps[Math.floor(steps.length * k) + tries * 2];
      const half = def.path.width / 2 + 1.6;
      if (bend(s.x - s.nx * half, s.z - s.nz * half, s.x + s.nx * half, s.z + s.nz * half, 3.6 + r() * 1.2)) break;
    }
  }
  for (let tries = 0; arches.length < W.arches && tries < W.arches * 30; tries++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (W.edge[0] - 10);
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    const turn = r() * Math.PI, half = 2.5 + r() * 2.5;
    const dx = Math.cos(turn) * half, dz = Math.sin(turn) * half;
    if ([-1, 0, 1].some((k) => onPath(x + dx * k, z + dz * k, 1)) || toCentre(x, z) > W.edge[0]) continue;
    bend(x - dx, z - dz, x + dx, z + dz, 2.6 + r() * 2);
  }
}
