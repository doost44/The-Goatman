import * as THREE from 'three';
import { terrainHeight, groundTint } from './terrain.js';

// Ground for big levels (1.5 km and more across), built in square chunks round the camera
// and freed again behind it. Close chunks are fine, far ones coarse; past `view` metres there
// are none (the fog hides that far, and the far land in horizon.js takes over).
//
// levels.json terrain: { shape: "chunks", size: [w, d], center, chunk (metres, 128), view
//   (metres), lods: [[out to metres, segments per chunk], ...] finest first, cache (chunks
//   kept built), budget (chunks built a frame), plus the usual hills, flat, noise, rim,
//   mottle, tile }
//
// Every chunk's grid lines up with every other's, at every level of detail, so heights
// along an edge agree wherever two chunks of the same detail meet. Where a fine chunk
// meets a coarse one their edges can still differ a little: each chunk hangs a skirt
// down from its edges to hide the crack.
//
// Memory: a chunk's geometry is the only thing it owns (the material is shared). Built
// chunks are kept in a cache of `cache` chunks, so turning round or walking back costs
// nothing; past that the one unused longest is freed (geometry.dispose()), so a long walk
// never piles up memory on the graphics card.

export function createChunkedTerrain(t, material, { reshape, shade } = {}) {
  const C = t.chunk ?? 128;
  const [w, d] = t.size;
  const [cx, cz] = t.center ?? [0, 0];
  const x0 = cx - w / 2, z0 = cz - d / 2;
  const nx = Math.ceil(w / C), nz = Math.ceil(d / C);
  const lods = t.lods ?? [[200, 32], [450, 16], [Infinity, 8]];
  const view = t.view ?? 1000;
  const limit = t.cache ?? 200;
  const budget = t.budget ?? 3;
  const HYSTERESIS = C / 4; // metres either side of a detail boundary a chunk keeps its detail
  const natural = terrainHeight(t);
  const height = reshape ? (x, z) => reshape(x, z, natural(x, z)) : natural;
  const tint = groundTint(t, shade);
  if (tint) material.vertexColors = true;
  const tile = t.tile ?? 8;

  const group = new THREE.Group();
  const cache = new Map(); // "i,j,segments" -> { mesh, i, j, s, used }
  const shown = new Map(); // "i,j" -> the cache entry drawn there now
  const stats = { shown: 0, cached: 0, limit, built: 0, freed: 0, waiting: 0, triangles: 0 };
  let frame = 0;

  // The height of the triangles of a grid with squares `step` metres wide, the way chunk
  // meshes split them (along the b-e diagonal, as PlaneGeometry does): the exact surface
  // of a chunk drawn at that detail.
  function gridHeight(x, z, step) {
    const u = (x - x0) / step, v = (z - z0) / step;
    const ix = Math.floor(u), iz = Math.floor(v);
    const fu = u - ix, fv = v - iz;
    const X = x0 + ix * step, Z = z0 + iz * step;
    const a = height(X, Z), b = height(X, Z + step), e = height(X + step, Z);
    if (fu + fv <= 1) return a + (e - a) * fu + (b - a) * fv;
    const c = height(X + step, Z + step);
    return c + (b - c) * (1 - fu) + (e - c) * (1 - fv);
  }
  const finest = C / lods[0][1];
  const inside = (x, z) => x >= x0 && x <= x0 + nx * C && z >= z0 && z <= z0 + nz * C;
  const chunkOf = (x, z) => [Math.min(nx - 1, Math.floor((x - x0) / C)), Math.min(nz - 1, Math.floor((z - z0) / C))];
  // The exact surface where a chunk is drawn (at its detail), the finest grid elsewhere.
  function surface(x, z) {
    if (!inside(x, z)) return null;
    const [i, j] = chunkOf(x, z);
    const s = shown.get(`${i},${j}`)?.s ?? lods[0][1];
    return gridHeight(x, z, C / s);
  }
  // What player.js stands him on (see terrain.js): a stand-in object, as the chunks come and go.
  const ground = new THREE.Object3D();
  ground.userData.surface = surface;

  function build(i, j, s) {
    const step = C / s, n = s + 1;
    const X = x0 + i * C, Z = z0 + j * C;
    const skirt = Math.max(2, step * 1.5); // deeper for coarse chunks, whose edges differ more
    const count = n * n + 4 * n;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    const col = tint ? new Float32Array(count * 3) : null;
    const put = (k, x, y, z, from = k) => {
      pos.set([x, y, z], k * 3);
      uv.set([x / tile, -z / tile], k * 2); // world-space UVs: the texture runs on across chunks
      if (from !== k) { nor.copyWithin(k * 3, from * 3, from * 3 + 3); if (col) col.copyWithin(k * 3, from * 3, from * 3 + 3); return; }
      // the slope from the height either side, so lighting is smooth across chunk edges
      const hx = height(x + step, z) - height(x - step, z), hz = height(x, z + step) - height(x, z - step);
      const len = Math.hypot(hx, 2 * step, hz);
      nor.set([-hx / len, (2 * step) / len, -hz / len], k * 3);
      if (col) col.set(tint(x, z), k * 3);
    };
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const x = X + a * step, z = Z + b * step;
      put(b * n + a, x, height(x, z), z);
    }
    const index = [];
    for (let b = 0; b < s; b++) for (let a = 0; a < s; a++) {
      const A = b * n + a, B = A + n, E = A + 1, Cc = B + 1;
      index.push(A, B, E, B, Cc, E);
    }
    // The skirts: each edge's vertices again, `skirt` metres lower, joined to the edge by
    // quads facing out of the chunk (toward the neighbour whose edge might not meet it).
    let k = n * n;
    const edges = [
      [(q) => q, false], // z = Z (north)
      [(q) => (n - 1) * n + q, true], // z = Z + C (south)
      [(q) => q * n, true], // x = X (west)
      [(q) => q * n + n - 1, false], // x = X + C (east)
    ];
    for (const [edge, flip] of edges) {
      for (let q = 0; q < n; q++) {
        const top = edge(q);
        put(k + q, pos[top * 3], pos[top * 3 + 1] - skirt, pos[top * 3 + 2], top);
        if (q < s) {
          const t0 = edge(q), t1 = edge(q + 1), b0 = k + q, b1 = k + q + 1;
          if (flip) index.push(t0, b0, t1, t1, b0, b1);
          else index.push(t0, t1, b0, t1, b1, b0);
        }
      }
      k += n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    group.add(mesh);
    stats.built++;
    const entry = { mesh, i, j, s, used: frame, triangles: index.length / 3 };
    cache.set(`${i},${j},${s}`, entry);
    return entry;
  }

  function free(key, entry) {
    group.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    cache.delete(key);
    stats.freed++;
  }

  // Which detail a chunk `dist` metres away gets: its segments. A chunk already drawn
  // keeps its detail until it is HYSTERESIS past the boundary, so walking along a boundary
  // doesn't swap chunks back and forth.
  const detail = (dist) => lods.find(([out]) => dist < out)?.[1] ?? lods[lods.length - 1][1];
  function wanted(dist, now) {
    const near = detail(Math.max(0, dist - HYSTERESIS)), far = detail(dist + HYSTERESIS);
    return now !== undefined && now <= near && now >= far ? now : detail(dist);
  }

  // Each frame, once the camera is placed: show the chunks round it at the right detail,
  // build a few missing ones (nearest first), and free the oldest past the cache's limit.
  function update(camera) {
    frame++;
    const px = camera.position.x, pz = camera.position.z;
    const [ci, cj] = chunkOf(THREE.MathUtils.clamp(px, x0, x0 + nx * C - 1), THREE.MathUtils.clamp(pz, z0, z0 + nz * C - 1));
    const reach = Math.ceil(view / C) + 1;
    const keep = new Set(), todo = [];
    stats.triangles = 0;
    for (let j = Math.max(0, cj - reach); j <= Math.min(nz - 1, cj + reach); j++) {
      for (let i = Math.max(0, ci - reach); i <= Math.min(nx - 1, ci + reach); i++) {
        // from the camera to the nearest point of the chunk (0 standing on it)
        const X = x0 + i * C, Z = z0 + j * C;
        const dist = Math.hypot(Math.max(X - px, 0, px - X - C), Math.max(Z - pz, 0, pz - Z - C));
        if (dist > view) continue;
        const at = `${i},${j}`;
        const now = shown.get(at);
        const s = wanted(dist, now?.s);
        let entry = cache.get(`${at},${s}`);
        if (!entry) {
          if (now) todo.push([dist, i, j, s]); // keep drawing what is there until it is built
          else entry = build(i, j, s); // nothing there: build it now, never leave a hole
        }
        if (entry) {
          if (now && now !== entry) now.mesh.visible = false;
          shown.set(at, entry);
        }
        const drawn = shown.get(at);
        drawn.mesh.visible = true;
        drawn.used = frame;
        stats.triangles += drawn.triangles;
        keep.add(at);
      }
    }
    for (const [at, entry] of shown) {
      if (!keep.has(at)) { entry.mesh.visible = false; shown.delete(at); }
    }
    todo.sort((a, b) => a[0] - b[0]);
    for (const [, i, j, s] of todo.slice(0, budget)) {
      const old = shown.get(`${i},${j}`);
      old.mesh.visible = false;
      const entry = build(i, j, s);
      entry.mesh.visible = true;
      shown.set(`${i},${j}`, entry);
    }
    // Over the limit: free the chunks unused longest (never one being drawn).
    if (cache.size > limit) {
      const old = [...cache].filter(([, e]) => e.used < frame).sort((a, b) => a[1].used - b[1].used);
      for (const [key, entry] of old.slice(0, cache.size - limit)) free(key, entry);
    }
    stats.shown = shown.size;
    stats.cached = cache.size;
    stats.waiting = Math.max(0, todo.length - budget);
  }

  return {
    group,
    ground,
    heightAt: (x, z) => gridHeight(x, z, finest), // where props go: the finest grid
    height, // the smooth height (the far land samples it beyond the level too)
    surface,
    update,
    stats,
    bounds: { x0, z0, x1: x0 + nx * C, z1: z0 + nz * C, chunk: C },
    // The chunks drawn now, for the admin map: [i, j, segments].
    drawn: () => [...shown.values()].map((e) => [e.i, e.j, e.s]),
    dispose() {
      for (const [key, entry] of cache) free(key, entry);
      shown.clear();
    },
  };
}
