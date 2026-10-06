import * as THREE from 'three';
import { canvas, crunchy, rng } from '../textures.js';
import { sfx } from '../sfx.js';
import { createSplashes } from './splash.js';
import { subtitle } from '../hud.js';

// The savanna's low, boggy river: the dark red band at the bottom of ground1.png.
// riverCourse() is its shape: it carves a shallow channel into the ground with soft muddy
// banks (the terrain's reshape and shade) and answers where the water is and how deep. The
// marsh's tidal creeks are courses too, narrower. buildRiver() is the water itself, for all
// the courses and the still water of waters.js (bays, the swamp): dark red-brown to nearly
// black, painted with the dusk's reds and a few pale glints, flowing slowly with faint
// ripples, plus the splashes (his hooves, the Walking Thing's feet, pebbles) and the odd
// bubble. bog.js dresses its banks.
//
// levels.json "river": { points: [[x, z, width?, depth?], ...] (from treeline to marsh; the
//   optional third and fourth numbers scale the width and depth there: wide and shallow at
//   the ford, wider still into the marsh), width (bank to bank), depth (of the channel),
//   water (how far below the banks the water sits), margin (metres over which the banks
//   blend into the ground), flow (metres a second), sky (the colour it shows looking along
//   it), seed, bog (bog.js) }. "creeks": [{ points, width?, depth? }, ...] the same, with
//   the river's numbers for anything left out.

const STEP = 2; // metres between samples along it
const TILE = 3; // metres of water to one tile of its paint
const CELL = 16; // size of the squares used to find the nearest stretch quickly
const TILE_SQUARE = 192; // metres: the water is drawn in squares this big, so what is out of view isn't
const clamp = THREE.MathUtils.clamp;

export function riverCourse(d, natural) {
  const curve = new THREE.CatmullRomCurve3(d.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const n = Math.ceil(curve.getLength() / STEP);
  const pts = curve.getSpacedPoints(n).map((p) => ({ x: p.x, z: p.z, level: natural(p.x, p.z), ...scales(d, p.x, p.z) }));
  // The banks' level along it: the ground's own height, smoothed over a long stretch so
  // the water only rises and falls gently.
  for (let pass = 0; pass < 3; pass++) {
    const was = pts.map((p) => p.level);
    pts.forEach((p, i) => {
      let sum = 0;
      for (let j = i - 8; j <= i + 8; j++) sum += was[clamp(j, 0, n)];
      p.level = sum / 17;
    });
  }
  // How wide and deep it is at each point, and where the water meets the banks.
  for (const p of pts) {
    p.R = (d.width * p.w) / 2;
    p.depth = Math.max(d.depth * p.dd, d.water * 1.25); // always some water in it
    p.edge = (p.R * Math.acos((2 * d.water) / p.depth - 1)) / Math.PI;
  }
  const reach = Math.max(...pts.map((p) => p.R)) + d.margin;
  const lerp = (a, b, k, key) => a[key] + (b[key] - a[key]) * k;

  // Each square of the ground lists the stretches of river near it.
  const cells = new Map();
  const key = (cx, cz) => (cx + 512) * 1024 + cz + 512;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[i + 1];
    for (let cx = Math.floor((Math.min(a.x, b.x) - reach) / CELL); cx <= Math.floor((Math.max(a.x, b.x) + reach) / CELL); cx++) {
      for (let cz = Math.floor((Math.min(a.z, b.z) - reach) / CELL); cz <= Math.floor((Math.max(a.z, b.z) + reach) / CELL); cz++) {
        const k = key(cx, cz);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(i);
      }
    }
  }
  // The nearest point on the middle of the river, or null if it is far off:
  // { x, z, d (how far), i (the stretch), level (of the banks there), R, edge, depth (there) }.
  function nearest(x, z) {
    const list = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return null;
    let best = null;
    for (const i of list) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const k = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const px = a.x + dx * k, pz = a.z + dz * k;
      const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (!best || d2 < best.d2) best = { x: px, z: pz, d2, i, k };
    }
    const a = pts[best.i], b = pts[best.i + 1];
    best.d = Math.sqrt(best.d2);
    for (const name of ['level', 'R', 'edge', 'depth']) best[name] = lerp(a, b, best.k, name);
    return best;
  }
  const carve = (dist, q) => (dist < q.R ? q.depth * (0.5 + 0.5 * Math.cos((Math.PI * dist) / q.R)) : 0);

  return {
    pts,
    edge: pts[0].edge, R: pts[0].R, // as wide as it is where it starts (each point has its own)
    water: d.water,
    flow: d.flow,
    length: n * STEP,
    nearest,
    // The nearest point on its middle, however far off (roughly: where its sound comes from).
    closest(x, z) {
      let best = pts[0], d2 = Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        const e = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2;
        if (e < d2) { d2 = e; best = pts[i]; }
      }
      return { ...best, d: Math.sqrt(d2) };
    },
    // `across` metres to the side of its middle, `s` metres along: { x, z, level, dx, dz
    // (the way it flows), R, edge (how wide it is there) }.
    at(s, across = 0) {
      const f = clamp(s / STEP, 0, n - 1e-6), i = Math.floor(f), k = f - i;
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      return {
        x: a.x + (b.x - a.x) * k - dz * across, z: a.z + (b.z - a.z) * k + dx * across,
        level: lerp(a, b, k, 'level'), R: lerp(a, b, k, 'R'), edge: lerp(a, b, k, 'edge'), dx, dz,
      };
    },
    // The ground across it, levelled to the banks and carved into a channel.
    reshape(x, z, h) {
      const q = nearest(x, z);
      if (!q || q.d > q.R + d.margin) return h;
      return THREE.MathUtils.lerp(h, q.level, 1 - THREE.MathUtils.smoothstep(q.d, q.R, q.R + d.margin)) - carve(q.d, q);
    },
    // Mud: how much the ground darkens toward the water (0..1).
    mud(x, z) {
      const q = nearest(x, z);
      return q ? 1 - THREE.MathUtils.smoothstep(q.d, q.edge + 1, q.R + 3) : 0;
    },
    // How deep the water is over ground at height y (0 out of it).
    depth(x, z, y) {
      const q = nearest(x, z);
      return q && q.d < q.R ? Math.max(0, q.level - d.water - y) : 0;
    },
    // The water's height near (x, z), or null away from it.
    surface(x, z) {
      const q = nearest(x, z);
      return q && q.d < q.edge + 1 ? q.level - d.water : null;
    },
    // In the water, or within `margin` metres of it.
    wet(x, z, margin = 1) {
      const q = nearest(x, z);
      return !!q && q.d < q.edge + margin;
    },
  };
}

// How much wider and deeper than usual the river is at (x, z): from the scales given with
// its points ([x, z, width, depth]), along the line between the nearest two.
function scales(d, x, z) {
  let best = { d2: Infinity, w: 1, dd: 1 };
  for (let i = 0; i < d.points.length - 1; i++) {
    const [ax, az, aw = 1, ad = 1] = d.points[i], [bx, bz, bw = 1, bd = 1] = d.points[i + 1];
    const dx = bx - ax, dz = bz - az;
    const k = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    const d2 = (x - ax - dx * k) ** 2 + (z - az - dz * k) ** 2;
    if (d2 < best.d2) best = { d2, w: aw + (bw - aw) * k, dd: ad + (bd - ad) * k };
  }
  return { w: best.w, dd: best.dd };
}

// The water's paint, in the river band's colours: long streaks along the flow in dark
// reds and browns, and short pale glints across it, like the sky caught on ripples. Each
// dab is drawn again a tile over, so the paint repeats without seams.
function waterPaint(r) {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  g.fillStyle = '#1c0a12';
  g.fillRect(0, 0, 64, 64);
  const dab = (x, y, w, h) => {
    for (const ox of [0, -64]) for (const oy of [0, -64]) g.fillRect(x + ox, y + oy, w, h);
  };
  const streaks = [['#0c0408', 70], ['#2a1220', 44], ['#3a1626', 26], ['#4a2030', 12], ['#6a2e40', 4]];
  for (const [color, count] of streaks) {
    g.fillStyle = color;
    for (let i = 0; i < count; i++) dab(Math.floor(r() * 64), Math.floor(r() * 64), 1 + Math.floor(r() * 2), 2 + Math.floor(r() * 6));
  }
  for (const [color, count] of [['#8a5060', 5], ['#c08898', 2]]) {
    g.fillStyle = color;
    for (let i = 0; i < count; i++) dab(Math.floor(r() * 64), Math.floor(r() * 64), 1 + Math.floor(r() * 3), 1);
  }
  return crunchy(c, [1, 1]);
}

// waters (waters.js): { courses (the river and the creeks), pools (still water: { at,
//   outline(angle) -> metres, level }), surface(x, z) (the water's height there, or null) }.
export function buildRiver(d, waters, camera) {
  const r = rng(d.seed ?? 3);
  const group = new THREE.Group();

  // The water, in squares TILE_SQUARE metres across so what is out of view isn't drawn. Each
  // course is a strip along its middle, wide enough that its edges go in under the banks,
  // the paint TILE metres to a tile, flowing; each pool a flat fan, barely drifting.
  const tiles = new Map();
  const tile = (x, z) => {
    const k = `${Math.floor(x / TILE_SQUARE)},${Math.floor(z / TILE_SQUARE)}`;
    if (!tiles.has(k)) tiles.set(k, { pos: [], uv: [], drift: [], index: [] });
    return tiles.get(k);
  };
  const vertex = (t, x, y, z, u, v, drift) => {
    t.pos.push(x, y, z);
    t.uv.push(u, v);
    t.drift.push(drift);
    return t.pos.length / 3 - 1;
  };
  for (const course of waters.courses) {
    const { pts } = course;
    for (let i = 1; i < pts.length; i++) {
      const t = tile((pts[i - 1].x + pts[i].x) / 2, (pts[i - 1].z + pts[i].z) / 2);
      const row = (j) => [0, 1, 2, 3, 4].map((k) => {
        const W = pts[j].edge + 1, across = (k / 4 - 0.5) * 2 * W, at = course.at(j * STEP, across);
        return vertex(t, at.x, pts[j].level - d.water, at.z, across / TILE, (j * STEP) / TILE, 1);
      });
      const A = row(i - 1), B = row(i);
      for (let k = 0; k < 4; k++) t.index.push(A[k], A[k + 1], B[k], A[k + 1], B[k + 1], B[k]); // facing up
    }
  }
  for (const pool of waters.pools) {
    const [cx, cz] = pool.at, n = 36;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const r0 = pool.outline(a0) + 1, r1 = pool.outline(a1) + 1;
      const x0 = cx + Math.cos(a0) * r0, z0 = cz + Math.sin(a0) * r0, x1 = cx + Math.cos(a1) * r1, z1 = cz + Math.sin(a1) * r1;
      const t = tile((cx + x0 + x1) / 3, (cz + z0 + z1) / 3);
      const v = (x, z) => vertex(t, x, pool.level, z, x / TILE, z / TILE, 0.15);
      t.index.push(v(cx, cz), v(x1, z1), v(x0, z0));
    }
  }
  // The paint is read twice, flowing at two speeds and sizes, so the two drift through each
  // other as faint ripples; looking along it, it takes on the sky's colour.
  const flow = { value: 0 };
  const sky = { value: new THREE.Color(d.sky) };
  const skyColor = new THREE.Color(d.sky);
  const mat = new THREE.MeshBasicMaterial({ map: waterPaint(r) });
  mat.customProgramCacheKey = () => 'bogwater';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uFlow: flow, uSky: sky });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float drift;\nvarying float vGraze, vDrift;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vDrift = drift;
        vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vGraze = 1.0 - abs(dot(normalize(-mvPosition.xyz), up));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFlow;\nuniform vec3 uSky;\nvarying float vGraze, vDrift;')
      .replace('#include <map_fragment>', `
        vec4 slow = texture2D(map, vMapUv + vec2(0.0, -uFlow * vDrift));
        vec4 fast = texture2D(map, vMapUv * 1.37 + vec2(0.37, -uFlow * 1.8 * vDrift));
        diffuseColor *= max(slow, fast * 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, uSky, pow(vGraze, 3.0) * 0.5);`);
  };
  const meshes = [...tiles.values()].map((t) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(t.uv, 2));
    geo.setAttribute('drift', new THREE.Float32BufferAttribute(t.drift, 1));
    geo.setIndex(t.index);
    geo.computeVertexNormals();
    const water = new THREE.Mesh(geo, mat);
    water.userData.sinks = true; // pebbles go in and are gone
    water.userData.onRock = (hit) => splash(hit.point.x, hit.point.z, 0.7);
    group.add(water);
    return water;
  });

  // Splashes: his hooves, the Walking Thing's feet, pebbles.
  const { splash, ripple, heard, ...splashes } = createSplashes({ surface: waters.surface, camera, r });
  group.add(splashes.group);

  // Now and then, somewhere near him, a bubble swells up out of the water and pops.
  const bubbles = Array.from({ length: 4 }, () => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: 0x6a3a44 }));
    m.visible = false;
    group.add(m);
    return m;
  });
  let bubbleIn = 2, nextBubble = 0, captioned = false;
  function bubble() {
    const course = waters.courses.find((c) => c.nearest(camera.position.x, camera.position.z)?.d < 40);
    if (!course) return;
    const near = course.nearest(camera.position.x, camera.position.z);
    const at = course.at((near.i + (r() - 0.5) * 20) * STEP, (r() - 0.5) * 1.4 * near.edge);
    const b = bubbles[nextBubble++ % bubbles.length];
    b.position.set(at.x, at.level - d.water, at.z);
    b.userData = { life: 0, size: 0.1 + r() * 0.14 };
    b.visible = true;
  }

  return {
    group,
    meshes, // what pebbles sink into
    splash,
    update(dt, t, dim) {
      flow.value = (t * d.flow) / TILE;
      mat.color.setScalar(0.55 + 0.45 * dim);
      sky.value.copy(skyColor).multiplyScalar(dim);
      splashes.update(dt, dim);

      if ((bubbleIn -= dt) <= 0) { bubble(); bubbleIn = 1.5 + r() * 3.5; }
      for (const b of bubbles) {
        if (!b.visible) continue;
        const k = (b.userData.life += dt / 0.8);
        b.scale.set(1, 0.7, 1).multiplyScalar(b.userData.size * Math.min(1, k * 1.5));
        if (k < 1) continue;
        b.visible = false;
        ripple(b.position.x, b.position.y, b.position.z, 0.3);
        const s = heard(b.position.x, b.position.z);
        if (s.loud <= 0) continue;
        sfx.bloop(s.pan, s.loud);
        if (!captioned) { subtitle('[the bog bubbles]', 2); captioned = true; }
      }
    },
  };
}
