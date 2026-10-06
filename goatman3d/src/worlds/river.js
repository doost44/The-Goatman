import * as THREE from 'three';
import { canvas, crunchy, rng } from '../textures.js';
import { sfx } from '../sfx.js';
import { subtitle } from '../hud.js';

// The savanna's low, boggy river: the dark red band at the bottom of ground1.png.
// riverCourse() is its shape: it carves a shallow channel into the ground with soft muddy
// banks (buildTerrain's reshape and shade) and answers where the water is and how deep.
// buildRiver() is the water itself: dark red-brown to nearly black, painted with the dusk's
// reds and a few pale glints, flowing slowly with faint ripples, plus the splashes (his
// hooves, the Walking Thing's feet, pebbles) and the odd bubble. bog.js dresses its banks.
//
// levels.json "river": { points: [[x, z], ...] (from treeline to treeline), width (bank to
//   bank), depth (of the channel), water (how far below the banks the water sits), margin
//   (metres over which the banks blend into the ground), flow (metres a second), sky (the
//   colour it shows looking along it), seed, bog (bog.js) }

const STEP = 2; // metres between samples along it
const TILE = 3; // metres of water to one tile of its paint
const CELL = 16; // size of the squares used to find the nearest stretch quickly
const clamp = THREE.MathUtils.clamp;

export function riverCourse(d, natural) {
  const curve = new THREE.CatmullRomCurve3(d.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const n = Math.ceil(curve.getLength() / STEP);
  const pts = curve.getSpacedPoints(n).map((p) => ({ x: p.x, z: p.z, level: natural(p.x, p.z) }));
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
  const R = d.width / 2;
  const edge = (R * Math.acos((2 * d.water) / d.depth - 1)) / Math.PI; // where the water meets the banks
  const reach = R + d.margin;

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
  // { x, z, d (how far), i (the stretch), level (of the banks there) }.
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
    best.d = Math.sqrt(best.d2);
    best.level = pts[best.i].level + (pts[best.i + 1].level - pts[best.i].level) * best.k;
    return best;
  }
  const carve = (dist) => (dist < R ? d.depth * (0.5 + 0.5 * Math.cos((Math.PI * dist) / R)) : 0);

  return {
    pts, edge, R,
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
      return best;
    },
    // `across` metres to the side of its middle, `s` metres along: { x, z, level, dx, dz
    // (the way it flows) }.
    at(s, across = 0) {
      const f = clamp(s / STEP, 0, n - 1e-6), i = Math.floor(f), k = f - i;
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      return { x: a.x + (b.x - a.x) * k - dz * across, z: a.z + (b.z - a.z) * k + dx * across, level: a.level + (b.level - a.level) * k, dx, dz };
    },
    // The ground across it, levelled to the banks and carved into a channel.
    reshape(x, z, h) {
      const q = nearest(x, z);
      if (!q || q.d > reach) return h;
      return THREE.MathUtils.lerp(h, q.level, 1 - THREE.MathUtils.smoothstep(q.d, R, reach)) - carve(q.d);
    },
    // Mud: the ground darkens toward the water to the painting's dark red-brown.
    shade(x, z) {
      const q = nearest(x, z);
      const k = q ? 1 - THREE.MathUtils.smoothstep(q.d, edge + 1, R + 3) : 0;
      return [1 - 0.6 * k, 1 - 0.76 * k, 1 - 0.7 * k];
    },
    // How deep the water is over ground at height y (0 out of it).
    depth(x, z, y) {
      const q = nearest(x, z);
      return q && q.d < R ? Math.max(0, q.level - d.water - y) : 0;
    },
    // The water's height near (x, z), or null away from it.
    surface(x, z) {
      const q = nearest(x, z);
      return q && q.d < edge + 1 ? q.level - d.water : null;
    },
  };
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

export function buildRiver(d, course, camera) {
  const r = rng(d.seed ?? 3);
  const { pts, edge } = course;
  const group = new THREE.Group();

  // The water: a strip along the middle, wide enough that its edges go in under the banks,
  // the paint TILE metres to a tile.
  const W = edge + 1;
  const pos = [], uv = [], index = [];
  pts.forEach((p, i) => {
    for (let k = 0; k <= 4; k++) {
      const across = (k / 4 - 0.5) * 2 * W, at = course.at(i * STEP, across);
      pos.push(at.x, p.level - d.water, at.z);
      uv.push(across / TILE, (i * STEP) / TILE);
    }
    if (i > 0) for (let k = 0; k < 4; k++) {
      const A = (i - 1) * 5 + k, B = i * 5 + k;
      index.push(A, A + 1, B, A + 1, B + 1, B); // facing up
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
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
      .replace('#include <common>', '#include <common>\nvarying float vGraze;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vGraze = 1.0 - abs(dot(normalize(-mvPosition.xyz), up));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFlow;\nuniform vec3 uSky;\nvarying float vGraze;')
      .replace('#include <map_fragment>', `
        vec4 slow = texture2D(map, vMapUv + vec2(0.0, -uFlow));
        vec4 fast = texture2D(map, vMapUv * 1.37 + vec2(0.37, -uFlow * 1.8));
        diffuseColor *= max(slow, fast * 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, uSky, pow(vGraze, 3.0) * 0.5);`);
  };
  const water = new THREE.Mesh(geo, mat);
  water.userData.sinks = true; // pebbles go in and are gone
  water.userData.onRock = (hit) => splash(hit.point.x, hit.point.z, 0.7);
  group.add(water);

  // Splashes: a ring spreading on the water and a few drops thrown up.
  const ringGeo = new THREE.RingGeometry(0.8, 1, 18).rotateX(-Math.PI / 2);
  const rings = Array.from({ length: 10 }, () => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xc88898, transparent: true, depthWrite: false }));
    m.visible = false;
    group.add(m);
    return m;
  });
  const DROPS = 80;
  const dropPos = new Float32Array(DROPS * 3).fill(-999);
  const dropVel = new Float32Array(DROPS * 3), dropFloor = new Float32Array(DROPS);
  const dropGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
  const drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({ color: 0xd8a8b4, size: 0.12 }));
  drops.frustumCulled = false;
  group.add(drops);
  let nextDrop = 0, nextRing = 0;

  // Left (-1) to right (1) of the camera, and how loud (quieter further off).
  const right = new THREE.Vector3(), to = new THREE.Vector3();
  function heard(x, z) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    to.set(x - camera.position.x, 0, z - camera.position.z);
    const dist = to.length();
    return { pan: clamp(to.dot(right) / (dist || 1), -1, 1), loud: clamp(1.2 - dist / 40, 0, 1) };
  }
  function ripple(x, y, z, size) {
    const m = rings[nextRing++ % rings.length];
    m.position.set(x, y + 0.04, z);
    m.userData = { life: 0, size };
    m.visible = true;
  }
  // size: about 0.4 for his hoof, 0.7 a pebble, 1.5 the Walking Thing's foot.
  function splash(x, z, size = 0.5, sound = true) {
    const y = course.surface(x, z);
    if (y === null) return;
    ripple(x, y, z, size);
    for (let n = 0; n < 3 + size * 5; n++) {
      const i = nextDrop++ % DROPS, a = r() * Math.PI * 2, out = (0.6 + r()) * size;
      dropPos.set([x, y + 0.05, z], i * 3);
      dropVel.set([Math.cos(a) * out, (2 + r() * 2.5) * Math.sqrt(size), Math.sin(a) * out], i * 3);
      dropFloor[i] = y;
    }
    const s = heard(x, z);
    if (sound && s.loud > 0) sfx.splash(s.pan, s.loud, size);
  }

  // Now and then, somewhere near him, a bubble swells up out of the water and pops.
  const bubbles = Array.from({ length: 4 }, () => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: 0x6a3a44 }));
    m.visible = false;
    group.add(m);
    return m;
  });
  let bubbleIn = 2, nextBubble = 0, captioned = false;
  function bubble() {
    const near = course.nearest(camera.position.x, camera.position.z);
    if (!near || near.d > 40) return;
    const at = course.at((near.i + (r() - 0.5) * 20) * STEP, (r() - 0.5) * 1.4 * edge);
    const b = bubbles[nextBubble++ % bubbles.length];
    b.position.set(at.x, at.level - d.water, at.z);
    b.userData = { life: 0, size: 0.1 + r() * 0.14 };
    b.visible = true;
  }

  return {
    group,
    water,
    splash,
    update(dt, t, dim) {
      flow.value = (t * d.flow) / TILE;
      mat.color.setScalar(0.55 + 0.45 * dim);
      sky.value.copy(skyColor).multiplyScalar(dim);
      for (const m of rings) {
        if (!m.visible) continue;
        m.userData.life += dt / (0.7 + 0.4 * m.userData.size);
        const k = m.userData.life;
        m.scale.setScalar((0.3 + 1.7 * k) * m.userData.size);
        m.material.opacity = 0.55 * (1 - k) * dim;
        if (k >= 1) m.visible = false;
      }
      for (let i = 0; i < DROPS; i++) {
        if (dropPos[i * 3 + 1] < -900) continue;
        dropVel[i * 3 + 1] -= 12 * dt;
        for (let a = 0; a < 3; a++) dropPos[i * 3 + a] += dropVel[i * 3 + a] * dt;
        if (dropPos[i * 3 + 1] < dropFloor[i]) dropPos[i * 3 + 1] = -999;
      }
      dropGeo.attributes.position.needsUpdate = true;

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
