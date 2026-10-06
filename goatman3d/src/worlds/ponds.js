import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTerrain } from '../terrain.js';
import { canvas, crunchy, rng } from '../textures.js';
import { createSplashes } from './splash.js';
import { cards, swaying, reedPaint, barkPaint, mistPaint, mistCards, stump } from './bog.js';
import { limb } from './tealtree.js';

// The night forest's still, black ponds, lying in its clearings. pondCourse() is where they
// are: each sinks the floor into a bowl with soft banks, and answers how deep the water is.
// The forest's ground is too coarse (7 m squares) for a bowl that small, so each pond gets
// its own finer patch of the same floor (a "basin", a disc), and the coarse ground under it
// is pushed down out of sight. buildPonds() is the water, painted near-black with the
// dome's blue and the glowing marks faintly in it (no real reflections), a thin mist, reeds
// and dead wood round the edge, and the splashes (wading, pebbles), from the savanna's.
//
// levels.json "ponds": { bank (metres of soft bank round the water), water (how far under
//   the lowest point of its banks the water lies), reeds, stumps, branches, mist (how many
//   per pond), mistColor ("r, g, b"), sky (the colour it takes on seen at a low angle), seed,
//   list: [{ name, at: [x, z], radius (of the water), depth (in the middle) }] }

const LIFT = 0.03; // the basins sit this much over the coarse ground where they cover it
const smooth = THREE.MathUtils.smoothstep;

// The height of a rect terrain's own flat triangles, as terrain.js's gridSurface works it out,
// for a height function at its corners: the coarse ground as it would be without ponds.
function gridHeight(t, height) {
  const [cx, cz] = t.center ?? [0, 0], [w, d] = t.size, [nx, nz] = t.segments;
  const sx = w / nx, sz = d / nz;
  const corner = (ix, iz) => height(cx - w / 2 + ix * sx, cz - d / 2 + iz * sz);
  return (x, z) => {
    const u = THREE.MathUtils.clamp((x - cx + w / 2) / sx, 0, nx - 1e-6);
    const v = THREE.MathUtils.clamp((z - cz + d / 2) / sz, 0, nz - 1e-6);
    const ix = Math.floor(u), iz = Math.floor(v), fu = u - ix, fv = v - iz;
    const a = corner(ix, iz), b = corner(ix, iz + 1), c = corner(ix + 1, iz + 1), e = corner(ix + 1, iz);
    return fu + fv <= 1 ? a + (e - a) * fu + (b - a) * fv : c + (b - c) * (1 - fu) + (e - c) * (1 - fv);
  };
}

// t: the forest's "terrain"; height(x, z): its floor's height at the corners of its squares.
export function pondCourse(d, t, height) {
  const coarse = gridHeight(t, height);
  const cell = Math.hypot(t.size[0] / t.segments[0], t.size[1] / t.segments[1]);
  const list = d.list.map((p) => {
    const [x, z] = p.at, R = p.radius, bank = R + d.bank;
    let low = Infinity; // the lowest point round its banks, so the water never stands over them
    for (let i = 0; i < 24; i++) low = Math.min(low, coarse(x + Math.cos(i / 3.82) * bank, z + Math.sin(i / 3.82) * bank));
    // sunk: the coarse ground's corners inside this go down out of sight; outer: the basin
    // reaches past every square that touches one of them.
    return { ...p, x, z, R, bank, y: low - d.water, sunk: bank + 0.5, outer: bank + 1 + cell };
  });
  const dist = (p, x, z) => Math.hypot(x - p.x, z - p.z);
  const find = (x, z, far) => list.find((p) => dist(p, x, z) < far(p)) ?? null;

  // A pond's floor: the bowl, the bank rising out of the water, then the coarse ground.
  function floor(p, x, z) {
    const k = dist(p, x, z), g = coarse(x, z) + LIFT;
    if (k >= p.bank) return g;
    const bowl = p.y - (k < p.R ? p.depth * (0.5 + 0.5 * Math.cos((Math.PI * k) / p.R)) : 0);
    return THREE.MathUtils.lerp(bowl, g, smooth(k, p.R, p.bank));
  }

  return {
    list,
    floor,
    // Clearings for woods.js: nothing grows in a pond or right on its banks.
    keepClear: list.map((p) => [p.x, p.z, p.bank + 1]),
    // The coarse ground's height h at one of its corners, pushed down under the basins.
    lower: (x, z, h) => (find(x, z, (p) => p.sunk) ? h - 8 : h),
    // The basins' height there, or null away from the ponds.
    height(x, z) {
      const p = find(x, z, (q) => q.outer);
      return p ? floor(p, x, z) : null;
    },
    // How deep the water is over ground at height y (0 out of it).
    depth(x, z, y) {
      const p = find(x, z, (q) => q.R);
      return p ? Math.max(0, p.y - y) : 0;
    },
    // The water's height near (x, z), or null away from it.
    surface(x, z) {
      const p = find(x, z, (q) => q.R + 0.3);
      return p ? p.y : null;
    },
    // In the water, or within `margin` metres of it.
    wet: (x, z, margin = 1) => !!find(x, z, (p) => p.R + margin),
    // The nearest pond's water, about where its sounds come from.
    nearest(x, z) {
      let best = null, far = Infinity;
      for (const p of list) if (dist(p, x, z) < far) { far = dist(p, x, z); best = p; }
      const k = Math.min(1, (best.R * 0.7) / (far || 1));
      return { x: best.x + (x - best.x) * k, y: best.y, z: best.z + (z - best.z) * k };
    },
  };
}

// The water's paint: near-black, with the dome's blue in long soft streaks, a few specks of
// its light and the glowing marks' orange, as if far off on the far bank.
function waterPaint(r) {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#020309';
  g.fillRect(0, 0, 128, 128);
  for (const [color, count, len] of [['#05081a', 60, 30], ['#0a102c', 30, 22], ['#121c4a', 12, 14], ['#1c2866', 3, 8]]) {
    g.fillStyle = color;
    for (let i = 0; i < count; i++) g.fillRect(Math.floor(r() * 128), Math.floor(r() * 128), 4 + Math.floor(r() * len), 1 + Math.floor(r() * 2));
  }
  for (const [color, count] of [['#5a3410', 10], ['#a0601a', 4], ['#8a96d8', 8]]) {
    g.fillStyle = color;
    for (let i = 0; i < count; i++) g.fillRect(Math.floor(r() * 128), Math.floor(r() * 128), 1 + Math.floor(r() * 2), 1);
  }
  const t = crunchy(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const dummy = new THREE.Object3D();

// t: the forest's "terrain" (its tile and texture); groundMat: its floor.
export function buildPonds(d, course, t, groundMat, camera) {
  const r = rng(d.seed ?? 5);
  const { list } = course;
  const time = { value: 0 };
  const group = new THREE.Group();

  // The basins: discs of the same floor, darkening to mud at the water. They are drawn over
  // the coarse ground where the two meet.
  const basinMat = groundMat.clone();
  Object.assign(basinMat, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const basins = list.map((p) => {
    const shade = (x, z) => {
      const k = 1 - smooth(Math.hypot(x - p.x, z - p.z), p.R, p.R + 2.5);
      return [1 - 0.6 * k, 1 - 0.6 * k, 1 - 0.45 * k];
    };
    const disc = { shape: 'disc', center: [p.x, p.z], radius: p.outer, segments: [36, 16], tile: t.tile };
    return buildTerrain(disc, basinMat, { reshape: (x, z) => course.floor(p, x, z), shade }).mesh;
  });
  group.add(...basins);

  // The water: one disc per pond, the paint once across it, drifting very slowly; seen at a
  // low angle it takes on the dome's blue.
  const geos = list.map((p) => {
    const geo = new THREE.CircleGeometry(p.R + 0.4, 28).rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (p.R / 8), uv.getY(i) * (p.R / 8));
    return geo.translate(p.x, p.y, p.z);
  });
  const mat = new THREE.MeshBasicMaterial({ map: waterPaint(r) });
  mat.customProgramCacheKey = () => 'pondwater';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime: time, uSky: { value: new THREE.Color(d.sky) } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vGraze;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vGraze = 1.0 - abs(dot(normalize(-mvPosition.xyz), up));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uSky;\nvarying float vGraze;')
      .replace('#include <map_fragment>', `
        vec2 drift = vec2(sin(uTime * 0.05), cos(uTime * 0.04)) * 0.02;
        diffuseColor *= max(texture2D(map, vMapUv + drift), texture2D(map, vMapUv * 1.3 - drift) * 0.8);
        diffuseColor.rgb = mix(diffuseColor.rgb, uSky, pow(vGraze, 4.0) * 0.4);`);
  };
  const water = new THREE.Mesh(mergeGeometries(geos), mat);
  geos.forEach((g) => g.dispose());
  water.userData.sinks = true; // pebbles go in and are gone
  water.userData.onRock = (hit) => splash(hit.point.x, hit.point.z, 0.7);
  const { splash, ...splashes } = createSplashes({ surface: course.surface, camera, r, ring: 0x7a86c0, drop: 0x8a96d0 });
  group.add(water, splashes.group);

  // Reeds in clumps round the edge, some standing in the shallows; stumps on the banks and in
  // the water; dead branches half sunk with their ends sticking out; a thin mist lying on it.
  const at = (p, from, to) => {
    const a = r() * Math.PI * 2, k = from + r() * (to - from);
    return { x: p.x + Math.cos(a) * k, z: p.z + Math.sin(a) * k };
  };
  const reeds = new THREE.InstancedMesh(cards(1.1, 1.9), swaying(new THREE.MeshLambertMaterial({ map: reedPaint(r), alphaTest: 0.5, side: THREE.DoubleSide }), time, 0.02), d.reeds * list.length);
  const wood = [], puffs = [];
  let n = 0;
  for (const p of list) {
    let clump;
    for (let i = 0; i < d.reeds; i++) {
      if (i % 5 === 0) clump = at(p, p.R - 1, p.R + 1.2);
      const x = clump.x + (r() - 0.5) * 2, z = clump.z + (r() - 0.5) * 2;
      dummy.position.set(x, course.floor(p, x, z), z);
      dummy.rotation.set(0, r() * Math.PI, 0);
      dummy.scale.set(0.8 + r() * 0.4, 0.6 + r() * 0.6, 0.8 + r() * 0.4);
      dummy.updateMatrix();
      reeds.setMatrixAt(n++, dummy.matrix);
    }
    for (let i = 0; i < d.stumps; i++) {
      const s = at(p, p.R * 0.6, p.R + 2);
      wood.push(stump(r, s.x, course.floor(p, s.x, s.z), s.z));
    }
    for (let i = 0; i < d.branches; i++) {
      const s = at(p, p.R * 0.3, p.R * 0.8), a = r() * Math.PI * 2, len = 2 + r() * 2.5;
      const pt = (k, up, side = 0) => new THREE.Vector3(s.x + Math.cos(a) * len * k - Math.sin(a) * side, p.y + up, s.z + Math.sin(a) * len * k + Math.cos(a) * side);
      wood.push(limb([pt(0, -0.4), pt(0.4, 0.05, 0.2), pt(0.75, 0.5, -0.1), pt(1, 0.9 + r() * 0.6, 0.2)], 0.14, 0.035, 5).geo);
    }
    for (let i = 0; i < d.mist; i++) {
      const s = at(p, 0, p.R * 0.7);
      puffs.push({ x: s.x, y: p.y + 0.3 + r() * 0.4, z: s.z, w: 4 + r() * 5, h: 0.8 + r() * 0.7 });
    }
  }
  const woodGeo = mergeGeometries(wood);
  wood.forEach((g) => g.dispose());
  const mist = mistCards(puffs, mistPaint(r, d.mistColor), time);
  mist.material.opacity = 0.3;
  group.add(reeds, new THREE.Mesh(woodGeo, new THREE.MeshLambertMaterial({ map: barkPaint(r), flatShading: true })), mist.mesh);

  return {
    group,
    basins,
    water,
    splash,
    update(dt, t) {
      time.value = t;
      splashes.update(dt);
    },
  };
}
