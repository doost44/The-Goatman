import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadImage, toCanvas, canvas, crunchy, grade, glowTexture, rng } from '../textures.js';
import { drape } from '../terrain.js';

// The teal tree, the savanna's landmark (tree.png), as a weeping willow. The painted
// orange-red trunk divides into a few thick branches that rise and arc outward, each
// splitting into thinner limbs, and from them hang hundreds of long tendrils in the painted
// canopy's teal and blue (with its red streaks). Most end in a ragged hem about where the
// trunk divides, so from afar it still reads as the painting's broad, flat-topped, dripping
// canopy; the long ones hang on in a thin curtain almost to the ground, and underneath you
// walk in among them. They sway in the wind, the tips most, and part round GoatMan and the
// Walking Thing's feet (a few lines added to the material's shader).
//
// levels.json "tree": { at: [x, z], texture, fork (metres up where the trunk divides),
//   branches, height (the top of the arcs), reach (how far they spread), spacing (metres
//   between tendrils along a limb), grade, keepOut (how close the Walking Thing's body comes), seed }

const TRUNK = [113, 132, 186, 254]; // the trunk in the painting: x0, x1, y0, y1
// Columns of the painted canopy that are mostly teal and blue: the tendrils' colours.
const COLUMNS = [44, 76, 80, 84, 104, 120, 124, 128, 144, 148, 152, 160, 168, 172, 192];
const TILES = 8; // tendril textures side by side, 16 x 128 px each
const ROWS = 8; // segments down a tendril, so it can bend
const PUSHERS = 3; // GoatMan and the Walking Thing's two feet

// A tapered tube along a smooth curve through `points`, r0 thick at the start and r1 at the
// end (bog.js makes its dead branches with it too).
export function limb(points, r0, r1, sides = 6) {
  const curve = new THREE.CatmullRomCurve3(points);
  const len = curve.getLength();
  const rings = Math.max(3, Math.ceil(len / 1.2));
  const { normals, binormals } = curve.computeFrenetFrames(rings, false);
  const pos = [], uv = [], index = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, r = r0 + (r1 - r0) * t;
    curve.getPointAt(t, p);
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      n.copy(normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(binormals[i], Math.sin(a));
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      uv.push(j / sides, (t * len) / 3);
      if (i === 0 || j === sides) continue;
      const A = (i - 1) * (sides + 1) + j - 1, B = A + sides + 1;
      index.push(A, A + 1, B, B, A + 1, B + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return { geo, curve, len };
}

// The tree's wood, in the tree's own space (its foot at 0): the trunk up to the fork, the
// branches arcing up and out from it, levelling off at the top, and the limbs splitting off
// them. Returns the limbs too, for hanging tendrils on.
function wood(d, r) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const parts = [limb([V(0, -0.5, 0), V(0.25, d.fork * 0.45, 0.1), V(0, d.fork, 0)], 1.0, 0.62, 8)];
  for (let i = 0; i < d.branches; i++) {
    const a = ((i + r() * 0.5) / d.branches) * Math.PI * 2;
    const at = (dist, y, turn = 0) => V(Math.sin(a + turn) * dist, y, Math.cos(a + turn) * dist);
    const reach = d.reach * (0.85 + r() * 0.2), top = d.height - r() * 2;
    const branch = limb([at(0.3, d.fork - 0.6), at(reach * 0.15, d.fork + (top - d.fork) * 0.55), at(reach * 0.4, top - 0.6),
      at(reach * 0.8, top), at(reach, top - 1 - r() * 1.5)], 0.5, 0.12);
    parts.push(branch);
    // Limbs splitting off it, out to the side, up a little and drooping at the ends.
    for (const k of [0.35, 0.55, 0.75]) {
      if (r() < 0.15) continue;
      const from = branch.curve.getPointAt(k);
      const side = (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.4);
      const out = Math.hypot(from.x, from.z), len = reach * (0.3 + r() * 0.2);
      const rise = Math.min(2.5, top + 0.5 - from.y);
      parts.push(limb([from, at(out + len * 0.45, from.y + rise, side * 0.6), at(out + len, from.y + rise - 1 - r() * 2, side)],
        0.8 * (0.5 - 0.38 * k), 0.07, 5));
    }
  }
  const geo = mergeGeometries(parts.map((part) => part.geo));
  for (const part of parts) part.geo.dispose();
  return { geo, limbs: parts.slice(1) };
}

// The tendrils' paint: each 16 px tile holds three strands, each coloured down one column of
// the painted canopy (teal and blue, the odd red streak, its drips at the bottom), with a
// leaf sticking out here and there, each a different length, tapering to a drop.
function tendrilPaint(img, d, r) {
  const W = img.width, H = img.height;
  const src = toCanvas(img).getContext('2d').getImageData(0, 0, W, H).data;
  const on = (x, y) => src[(y * W + x) * 4 + 3] > 127;
  const c = canvas(16 * TILES, 128);
  const g = c.getContext('2d');
  const out = g.createImageData(c.width, 128);
  const put = (x, y, sx, sy) => {
    if (!on(sx, sy)) return false;
    const i = (y * c.width + x) * 4, j = (sy * W + sx) * 4;
    out.data.set([src[j], src[j + 1], src[j + 2], 255], i);
    return true;
  };
  for (let t = 0; t < TILES; t++) {
    for (let s = 0; s < 3; s++) {
      const sx = COLUMNS[Math.floor(r() * COLUMNS.length)];
      let top = 0;
      while (!on(sx, top)) top++;
      let end = top;
      while (end < H - 1 && on(sx, end + 1)) end++;
      const left = t * 16 + s * 5, len = Math.floor(124 * (0.75 + r() * 0.25));
      let x = left + 1;
      for (let y = 0; y < len; y++) {
        if (r() < 0.06) x = THREE.MathUtils.clamp(x + (r() < 0.5 ? -1 : 1), left, left + 2); // a slow wiggle
        const sy = top + Math.floor((y / 128) * (end - top));
        const wide = y < len - 6 ? 3 : 2; // tapering at the end
        for (let k = 0; k < wide; k++) put(x + k, y, sx - 1 + k, sy) || put(x + k, y, sx, sy);
        const leaf = r() < 0.5 ? x - 1 : x + wide;
        if (r() < 0.12 && leaf >= t * 16 && leaf < t * 16 + 16) put(leaf, y, sx, sy);
      }
      if (r() < 0.6 && len < 122) { put(x, len + 2, sx, end); put(x + 1, len + 2, sx, end); put(x, len + 3, sx, end); } // a drop
    }
  }
  g.putImageData(out, 0, 0);
  grade(c, d.grade);
  return crunchy(c);
}

// The tendrils: a strip of three strands hanging from every few tens of centimetres of the
// high limbs, turned any way. sway = (how far down the strip, which strip) for the shader.
function tendrils(limbs, d, r) {
  const pos = [], uv = [], sway = [], index = [];
  const p = new THREE.Vector3();
  let n = 0;
  for (const { curve, len } of limbs) {
    for (let s = r() * d.spacing; s < len; s += d.spacing * (0.5 + r())) {
      curve.getPointAt(s / len, p);
      const out = Math.hypot(p.x, p.z);
      if (p.y < d.fork + 3 || out < (p.y > d.fork + 7 ? 1.2 : 2.5)) continue;
      // Most end in a ragged hem about the height of the fork; the long ones (more round the
      // outside) hang on almost to the ground, or to about head height underneath.
      const far = THREE.MathUtils.smoothstep(out, 4, d.reach * 0.75);
      const bottom = r() < 0.15 + 0.25 * far
        ? THREE.MathUtils.lerp(1.2 + r() * 1.8, 0.1 + r() * 1.2, far)
        : Math.min(p.y - 3, d.fork + (r() - 0.3) * 5);
      const top = p.y + 0.2 + r() * 0.6; // covering the limb
      const face = r() * Math.PI, ax = Math.cos(face), az = Math.sin(face);
      const w = 0.5 + r() * 0.35, seed = r();
      const tile = Math.floor(r() * TILES), u0 = tile / TILES, u1 = (tile + 1) / TILES;
      // It arches out from the limb, away from the trunk, before it hangs (which also
      // covers the crown when seen from above).
      const flip = -az * p.x + ax * p.z < 0 ? -1 : 1, arch = 0.5 + r() * 0.5;
      const ox = -az * flip * arch, oz = ax * flip * arch;
      for (let k = -1; k <= ROWS; k++) {
        const fall = Math.max(0, k / ROWS), y = k ? top - (top - bottom) * fall : top - 0.3;
        const o = k < 0 ? 0 : 1, v = k ? 1 - fall : 0.97;
        for (const side of [-0.5, 0.5]) {
          pos.push(p.x + ax * w * side + ox * o, y, p.z + az * w * side + oz * o);
          uv.push(side < 0 ? u0 : u1, v);
          sway.push(k ? fall : 0.03, seed);
        }
        if (k > -1) index.push(n - 2, n, n - 1, n - 1, n, n + 1);
        n += 2;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3)); // lit like the ground
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += 3; // they swing out a little
  return geo;
}

// The wind and the parting, added to a Lambert material's vertex shader. uPush: up to three
// things pushing through (x, z in the tree's space, radius, the height of their top).
function swaying(mat, uniforms) {
  mat.customProgramCacheKey = () => 'willow';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 sway;
        uniform float uTime;
        uniform vec4 uPush[${PUSHERS}];`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float bend = sway.x * sway.x; // the tips swing most
        float gust = 0.6 + 0.4 * sin(uTime * 0.3 + transformed.x * 0.06);
        transformed.x += bend * gust * (0.9 * sin(uTime * 0.8 + sway.y * 6.28) + 0.25 * sin(uTime * 2.3 + sway.y * 17.0));
        transformed.z += bend * gust * 0.6 * cos(uTime * 0.63 + sway.y * 9.1);
        for (int i = 0; i < ${PUSHERS}; i++) {
          vec2 d = transformed.xz - uPush[i].xy;
          float dist = max(length(d), 0.001);
          float k = sway.x * smoothstep(uPush[i].w + 1.0, uPush[i].w - 1.0, transformed.y);
          transformed.xz += d / dist * max(uPush[i].z - dist, 0.0) * k;
        }`);
  };
}

export async function buildTealTree(d, heightAt) {
  const img = await loadImage(d.texture);
  const r = rng(d.seed ?? 5);
  const [x, z] = d.at;
  const group = new THREE.Group();
  group.position.set(x, heightAt(x, z), z);

  // The wood, in the painting's orange-red trunk.
  const bark = canvas(16, 64);
  bark.getContext('2d').drawImage(img, TRUNK[0] + 3, TRUNK[2], TRUNK[1] - TRUNK[0] - 6, TRUNK[3] - TRUNK[2], 0, 0, 16, 64);
  grade(bark, d.grade);
  const { geo: woodGeo, limbs } = wood(d, r);
  group.add(new THREE.Mesh(woodGeo, new THREE.MeshLambertMaterial({ map: crunchy(bark, [2, 1]), flatShading: true })));

  const uniforms = { uTime: { value: 0 }, uPush: { value: Array.from({ length: PUSHERS }, () => new THREE.Vector4(0, 0, 0, -99)) } };
  const leafMat = new THREE.MeshLambertMaterial({ map: tendrilPaint(img, d, r), alphaTest: 0.5, side: THREE.DoubleSide });
  swaying(leafMat, uniforms);
  group.add(new THREE.Mesh(tendrils(limbs, d, r), leafMat));

  // The trunk alone stops the third-person camera (an invisible stand-in, quick to test).
  const blocker = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, d.fork, 6).translate(0, d.fork / 2, 0));
  blocker.visible = false;
  group.add(blocker);

  // Its shade on the grass.
  const shade = new THREE.Mesh(
    drape(new THREE.CircleGeometry(d.reach, 16).rotateX(-Math.PI / 2).translate(x, 0, z), heightAt, 0.05),
    new THREE.MeshBasicMaterial({ map: glowTexture([[0, 'rgba(8,0,6,0.6)'], [0.7, 'rgba(8,0,6,0.35)'], [1, 'rgba(8,0,6,0)']]), transparent: true, depthWrite: false }),
  );

  return {
    meshes: [group, shade],
    blockers: [blocker],
    colliders: [{ kind: 'circle', x, z, r: 1.2 }],
    // The Walking Thing keeps its body out of the canopy.
    keepOut: { kind: 'circle', x, z, r: d.keepOut },
    // pushers: [{ x, y, z, r, tall }, ...] pushing through the tendrils this frame.
    update(t, pushers) {
      uniforms.uTime.value = t;
      uniforms.uPush.value.forEach((v, i) => {
        const p = pushers[i];
        if (p) v.set(p.x - x, p.z - z, p.r, p.y - group.position.y + p.tall);
        else v.set(0, 0, 0, -99);
      });
    },
  };
}
