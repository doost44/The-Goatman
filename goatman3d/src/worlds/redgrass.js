import * as THREE from 'three';
import { canvas, crunchy, rng } from '../textures.js';

// The vast red field's grass: tufts of red blades and the painting's little black sprouts
// all over 1.5 km, tall grass filling the dips (taller than GoatMan: down there only the
// sky shows), and the huge ring where the grass lies flattened.
//
// Built in square tiles round him, like the ground's chunks (chunks.js): each tile's grass is
// one merged mesh, made when he comes within `reach` of it (the same grass every time, from
// the tile's own seed) and kept in a cache of `cache` tiles, the one unused longest freed
// past that. Merged rather than instanced: a few dozen tiles draw far cheaper than thousands
// of instanced copies on a slow graphics chip. In the shader each blade sways a little in
// the wind, shrinks into the ground toward the edge of `reach` (so nothing pops in), and
// darkens under the passing cloud shadows like the ground.
//
// levels.json "grass": { reach, tile (metres), cache, budget, tufts and sprouts (per square
//   metre), tuftSize, sproutSize, colors, sprout, tall: { per, size: [min, max] }, flat (per
//   square metre in the ring) }; and the level's dips: [{ at, radius, depth }], ring: { at, radius, width }

// The blades and the sprout side by side along the bottom (20 px high), and the tall grass in
// the right half, the whole 64 px high: thin tapering blades with gaps between them.
function paint(d, r) {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const color = () => d.colors[Math.floor(r() * d.colors.length)];
  for (let i = 0; i < 22; i++) { // a tuft: x 0..26, the bottom 20 px
    g.strokeStyle = color();
    g.beginPath();
    const x = 2 + r() * 22;
    g.moveTo(x, 64);
    g.lineTo(x + (r() - 0.5) * 9, 45 + r() * 9);
    g.stroke();
  }
  g.strokeStyle = d.sprout; // a sprout: a stem with leaves going up and out, x 26..33
  g.beginPath();
  g.moveTo(29.5, 64);
  g.lineTo(29.5, 50);
  for (const [y, w] of [[52, 2], [56, 3], [60, 2]]) {
    g.moveTo(29.5, y + 1);
    g.lineTo(29.5 - w, y - 1);
    g.moveTo(29.5, y + 1);
    g.lineTo(29.5 + w, y - 1);
  }
  g.stroke();
  for (let i = 0; i < 11; i++) { // tall grass: x 35..63, blades tapering to a point, bending over
    g.fillStyle = color();
    const x = 36 + r() * 24, top = r() * 30, lean = (r() - 0.5) * 12;
    g.beginPath();
    g.moveTo(x - 1.2, 64);
    g.quadraticCurveTo(x, 40, x + lean, top);
    g.quadraticCurveTo(x + 0.4, 40, x + 1.2, 64);
    g.fill();
  }
  return crunchy(c);
}

// Where on the painting each kind is: [u0, u1, v1] (from the bottom up to v1).
const ART = { tuft: [0, 0.41, 0.31], sprout: [0.41, 0.52, 0.25], tall: [0.54, 1, 1] };

// The material's shader: every vertex knows its blade's foot (aFoot), so blades shrink and
// sway about their own feet. shadow.patch adds the cloud shadows.
function grassMaterial(map, time, reach, shadow) {
  const mat = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
  mat.customProgramCacheKey = () => 'redgrass';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime: time, uReach: reach });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uReach;\nattribute vec3 aFoot;')
      .replace('#include <project_vertex>', `
        float away = distance(aFoot.xz, cameraPosition.xz);
        vec3 grown = aFoot + (transformed - aFoot) * (1.0 - smoothstep(uReach * 0.7, uReach, away));
        float phase = fract(sin(dot(aFoot.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.28;
        grown.x += (grown.y - aFoot.y) * 0.12 * (0.6 + 0.4 * sin(uTime * 1.3 - aFoot.x * 0.08 + phase));
        vec4 mvPosition = modelViewMatrix * vec4(grown, 1.0);
        gl_Position = projectionMatrix * mvPosition;`);
    shadow.patch(shader);
  };
  return mat;
}

export function buildRedGrass(d, { heightAt, inside, dips = [], ring, shadow, seed }) {
  const T = d.tile, reach = { value: d.reach }, time = { value: 0 };
  const mat = grassMaterial(paint(d, rng(seed)), time, reach, shadow);
  const group = new THREE.Group();
  const { x0, z0, x1, z1 } = inside.bounds;
  const nx = Math.ceil((x1 - x0) / T), nz = Math.ceil((z1 - z0) / T);
  const cache = new Map(); // "i,j" -> { mesh, used }
  let frame = 0;

  // How far into a dip (0 at its rim, 1 in the middle), and whether (x, z) is in the ring's band.
  const inDip = (x, z) => Math.max(0, ...dips.map((dp) => 1 - Math.hypot(x - dp.at[0], z - dp.at[1]) / (dp.radius * 0.85)));
  const inRing = (x, z) => !!ring && Math.abs(Math.hypot(x - ring.at[0], z - ring.at[1]) - ring.radius) < ring.width / 2;
  // How far the tile whose corner is (X, Z) is from a point (0 inside it).
  const away = (X, Z, x, z) => Math.hypot(Math.max(X - x, 0, x - X - T), Math.max(Z - z, 0, z - Z - T));

  // One tile's grass, as a single mesh: cards added to plain arrays, then one geometry.
  function build(i, j) {
    const r = rng(seed * 7919 + i * 131 + j * 1543 + 1);
    const X = x0 + i * T, Z = z0 + j * T;
    const pos = [], uv = [], foot = [], index = [];
    // A card standing at (x, y, z), w wide and h tall, turned `turn` about the upright and
    // tipped over by `lie` (pressed flat in the ring).
    const card = (x, y, z, w, h, turn, [u0, u1, v1], lie = 0) => {
      const c = Math.cos(turn), s = Math.sin(turn), up = Math.cos(lie), out = Math.sin(lie);
      const n = pos.length / 3;
      for (const [a, b] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]]) {
        pos.push(x + a * w * c + b * h * out * s, y + b * h * up, z - a * w * s + b * h * out * c);
        uv.push(u0 + (a + 0.5) * (u1 - u0), b * v1);
        foot.push(x, y, z);
      }
      index.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
    };
    const crossed = (x, z, w, h, art) => {
      const y = heightAt(x, z) - 0.05, turn = r() * Math.PI;
      card(x, y, z, w, h, turn, art);
      card(x, y, z, w, h, turn + Math.PI / 2, art);
    };
    const between = ([a, b]) => a + r() * (b - a);
    const sow = (per, fn) => {
      for (let n = Math.round(T * T * per); n > 0; n--) {
        const x = X + r() * T, z = Z + r() * T;
        if (inside(x, z)) fn(x, z);
      }
    };
    sow(d.tufts, (x, z) => {
      const s = between(d.tuftSize);
      if (!inRing(x, z) && inDip(x, z) < 0.15) crossed(x, z, s * 1.6, s, ART.tuft);
    });
    sow(d.sprouts, (x, z) => {
      const s = between(d.sproutSize);
      if (!inRing(x, z)) crossed(x, z, s * 0.5, s, ART.sprout);
    });
    // The dips: tall grass, tallest in the middle, thick enough to see nothing but it and the sky.
    if (dips.some((dp) => away(X, Z, ...dp.at) < dp.radius)) {
      sow(d.tall.per, (x, z) => {
        const k = inDip(x, z);
        if (k <= 0) return;
        const s = d.tuftSize[1] + (between(d.tall.size) - d.tuftSize[1]) * Math.min(1, k * 1.6);
        crossed(x, z, 1.1 + r() * 0.4, s, ART.tall);
      });
    }
    // The ring: grass pressed flat, all lying the same way round, as if something huge turned there.
    if (ring && away(X, Z, ...ring.at) < ring.radius + ring.width) {
      sow(d.flat, (x, z) => {
        if (!inRing(x, z)) return;
        const a = Math.atan2(z - ring.at[1], x - ring.at[0]);
        card(x, heightAt(x, z) + 0.03, z, 1.6, between(d.tuftSize) * 0.6, -a + (r() - 0.5) * 0.5, ART.tuft, 1.42);
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3)); // lit like the ground
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aFoot', new THREE.Float32BufferAttribute(foot, 3));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    return { mesh, used: frame };
  }

  return {
    group,
    // Once the camera is placed: show the tiles within reach, build at most `budget` missing
    // ones a frame (nearest first; the one he is in at once), and free the oldest past `cache`.
    update(t, camera) {
      time.value = t;
      frame++;
      const px = camera.position.x, pz = camera.position.z, R = reach.value;
      const todo = [];
      for (const entry of cache.values()) entry.mesh.visible = false;
      const i0 = Math.max(0, Math.floor((px - R - x0) / T)), i1 = Math.min(nx - 1, Math.floor((px + R - x0) / T));
      const j0 = Math.max(0, Math.floor((pz - R - z0) / T)), j1 = Math.min(nz - 1, Math.floor((pz + R - z0) / T));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dist = away(x0 + i * T, z0 + j * T, px, pz);
          if (dist > R) continue;
          const key = `${i},${j}`;
          if (!cache.has(key) && dist === 0) cache.set(key, build(i, j));
          const entry = cache.get(key);
          if (entry) { entry.mesh.visible = true; entry.used = frame; } else todo.push([dist, i, j]);
        }
      }
      todo.sort((a, b) => a[0] - b[0]);
      for (const [, i, j] of todo.slice(0, d.budget)) {
        const entry = build(i, j);
        entry.mesh.visible = true;
        cache.set(`${i},${j}`, entry);
      }
      if (cache.size > d.cache) {
        const old = [...cache].filter(([, e]) => e.used < frame).sort((a, b) => a[1].used - b[1].used);
        for (const [key, e] of old.slice(0, cache.size - d.cache)) {
          group.remove(e.mesh);
          e.mesh.geometry.dispose();
          cache.delete(key);
        }
      }
    },
    dispose() {
      for (const e of cache.values()) e.mesh.geometry.dispose();
      cache.clear();
    },
  };
}
