import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadSheet, loadTexture, canvas, crunchy, glowTexture, rng } from '../textures.js';
import { walkPath, drape } from '../terrain.js';
import { nearestOnPath } from '../player.js';
import { sfx } from '../sfx.js';
import { subtitle } from '../hud.js';

// The yellow marks along the bottom of "Background Section 1": small glowing shapes in the
// grass that lead along the path, fainter along the hidden paths and thinning out into the
// forest. Some of them are eyes. They watch him go by, blink, and turn to follow him; a
// pebble shuts them and they open somewhere else. The further from the path he goes, the
// more of them there are.

const rand = (r, [a, b]) => a + r() * (b - a);
const glow = () => glowTexture([[0, 'rgba(255,190,80,0.55)'], [0.4, 'rgba(255,140,40,0.18)'], [1, 'rgba(255,120,30,0)']]);

// Glowing things shine further through the fog than the rest (fading out from 20 m past
// where it starts to 16 m past where it hides everything): the fog's own maths, moved back.
// Added light fades to nothing instead of to the fog colour. Keeps any patch the material
// already has (the mushrooms').
export function glowFog(mat, added = false) {
  const before = mat.onBeforeCompile, key = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    before.call(mat, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
      gl_FragColor.rgb = mix(gl_FragColor.rgb, ${added ? 'vec3(0.0)' : 'fogColor'}, smoothstep(fogNear + 18.0, fogFar + 16.0, vFogDepth));
    #endif`);
  };
  mat.customProgramCacheKey = () => `${key.call(mat)}-glowfog-${added}`;
  return mat;
}

// --- Marks on the ground --------------------------------------------------------------------

// All the marks are one mesh of flat quads, each showing one frame of marks.png, brighter or
// fainter through its vertex colours. blocked(x, z): no mark there (inside a trunk).
// levels.json "marks": { spacing, spread, size, tilt, glow, out: { count, near, far, glow } }
// and each side path's "marks": { from, spacing, glow }.
export async function buildMarks(def, path, sidePaths, heightAt, blocked) {
  const sheet = await loadSheet(def.sheet);
  const map = await loadTexture(`${def.sheet}.png`);
  const r = rng(def.seed);
  const W = sheet.img.width, H = sheet.img.height;
  const pos = [], uv = [], colors = [], index = [], halos = [];

  // A mark at (x, z), turned to `a`, `bright` times as bright as the path's.
  function mark(x, z, a, bright) {
    if (blocked(x, z)) return;
    const f = sheet.frames[Math.floor(r() * sheet.count)];
    const w = (def.size * (0.8 + r() * 0.4)) / 2, h = (w * f.h) / f.w;
    const c = Math.cos(a), sn = Math.sin(a);
    const y = heightAt(x, z) + 0.04;
    // Propped up a little on the grass, tipped toward someone coming down the path.
    const tilt = rand(r, def.tilt), up = Math.sin(tilt), flat = Math.cos(tilt);
    const n = pos.length / 3;
    for (const [lx, lz] of [[-w, h], [w, h], [w, -h], [-w, -h]]) {
      pos.push(x + lx * c + lz * flat * sn, y + (lz + h) * up, z - lx * sn + lz * flat * c);
      colors.push(bright, bright, bright);
    }
    const u0 = f.x / W, u1 = (f.x + f.w) / W, v0 = 1 - (f.y + f.h) / H, v1 = 1 - f.y / H;
    uv.push(u0, v1, u1, v1, u1, v0, u0, v0);
    index.push(n, n + 1, n + 2, n, n + 2, n + 3);
    // and a soft glow on the grass under it
    const size = def.size * 2.4;
    const halo = drape(new THREE.PlaneGeometry(size, size, 3, 3).rotateX(-Math.PI / 2).translate(x, 0, z), heightAt, 0.03);
    halo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(halo.attributes.position.count * 3).fill(bright), 3));
    halos.push(halo);
  }
  // Along the main path, from just ahead of the start to the end.
  for (const s of walkPath(path.points, def.spacing, 3).slice(0, -1)) {
    const off = (r() - 0.5) * 2 * def.spread;
    mark(s.x + s.nx * off, s.z + s.nz * off, Math.atan2(s.dx, s.dz) + (r() - 0.5) * 1.2, 1);
  }
  // Fainter and further apart along the hidden paths, and none at their mouths.
  for (const p of sidePaths) {
    for (const s of walkPath(p.points, p.marks.spacing, p.marks.from)) {
      const off = (r() - 0.5) * p.width * 0.5;
      mark(s.x + s.nx * off, s.z + s.nz * off, Math.atan2(s.dx, s.dz) + (r() - 0.5) * 1.6, p.marks.glow);
    }
  }
  // Out in the forest: fewer and fainter the further from the path.
  const out = def.out, steps = walkPath(path.points, 1);
  for (let i = 0; i < out.count; i++) {
    const s = steps[Math.floor(r() * steps.length)];
    const k = r() ** 1.7, d = (r() < 0.5 ? -1 : 1) * THREE.MathUtils.lerp(out.near, out.far, k);
    const x = s.x + s.nx * d + (r() - 0.5) * 8, z = s.z + s.nz * d + (r() - 0.5) * 8;
    if (nearestOnPath(path.points, x, z).d > out.near - 1) mark(x, z, r() * Math.PI * 2, out.glow * (1 - 0.7 * k));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(index);
  const mat = glowFog(new THREE.MeshBasicMaterial({ map, vertexColors: true, alphaTest: 0.4 }));
  const haloMat = glowFog(new THREE.MeshBasicMaterial({ map: glow(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), true);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat), new THREE.Mesh(mergeGeometries(halos), haloMat));
  for (const h of halos) h.dispose();
  return {
    group,
    // A slow pulse, as if they were breathing.
    update(t) { mat.color.setScalar(def.glow * (0.85 + 0.15 * Math.sin(t * 1.3))); },
  };
}

// --- Eyes -----------------------------------------------------------------------------------

// An eye made from the marks: a lens of their orange paint with a goat's flat pupil.
function eyeTexture(sheet) {
  const c = canvas(32, 20);
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(1, 10);
  g.quadraticCurveTo(16, -3, 31, 10);
  g.quadraticCurveTo(16, 23, 1, 10);
  g.clip();
  g.fillStyle = '#c47414';
  g.fillRect(0, 0, 32, 20);
  const f = sheet.frames[4];
  g.drawImage(sheet.img, f.x + 4, f.y + 4, f.w - 8, f.h - 8, 0, 0, 32, 20);
  g.fillStyle = 'rgba(255,200,90,0.35)';
  g.fillRect(0, 0, 32, 20);
  g.fillStyle = '#120400';
  g.fillRect(9, 8, 14, 4);
  return crunchy(c);
}

// Pairs of eyes open at spots near him (woods.js puts them beside trunks, more of them deeper
// in, and a ring of them round the dell where they gather): a few by the path, more the further
// he strays, all of them in the dell. Each pair is two copies of an instanced eye and one of
// a glow, so all the eyes draw in two goes.
// hush: { x, z, radius } where they all shut at once when he gets there, and open again together.
// levels.json "eyes": { count, want: [by the path, deep in], far, blink, away, shy, range }
export async function buildEyes(def, spots, path, camera, hush = null) {
  const sheet = await loadSheet(def.sheet);
  const r = rng(def.seed);
  const mat = glowFog(new THREE.MeshBasicMaterial({ map: eyeTexture(sheet), alphaTest: 0.5, side: THREE.DoubleSide }));
  const haloMat = glowFog(new THREE.MeshBasicMaterial({ map: glow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), true);
  const eyes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 0.3), mat, def.count * 2);
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 1.4), haloMat, def.count);
  eyes.frustumCulled = halos.frustumCulled = false; // they move about
  const group = new THREE.Group();
  group.add(eyes, halos);
  const hitGeo = new THREE.SphereGeometry(0.5, 6, 4);
  const targets = []; // what a pebble can hit
  const pairs = [];
  for (let i = 0; i < def.count; i++) {
    const hit = new THREE.Mesh(hitGeo, mat);
    hit.visible = false; // only for pebbles to hit
    group.add(hit);
    const pair = { hit, spot: null, yaw: r() * 6, tilt: (r() - 0.5) * 0.5, open: 0, state: 'shut', clock: r() * 2 };
    hit.userData.onRock = () => shut(pair, true);
    targets.push(hit);
    pairs.push(pair);
  }
  const dell = spots.filter((s) => s.gather);
  let hushed = false;

  function shut(pair, struck) {
    if (pair.state === 'shut') return;
    pair.state = 'shut';
    pair.clock = rand(Math.random, def.away);
    if (struck) {
      sfx.blink(pan(pair));
      subtitle('[eyes snap shut]', 2);
    }
  }

  // Somewhere new, not too near him and not too far, ahead of him if possible (in the dell
  // when he is there).
  const ahead = new THREE.Vector3();
  function reopen(pair, gathered) {
    const p = camera.position;
    camera.getWorldDirection(ahead);
    const free = (s) => !s.taken && Math.hypot(s.x - p.x, s.z - p.z) > 6 && Math.hypot(s.x - p.x, s.z - p.z) < 22;
    const near = (gathered ? dell : spots).filter(free);
    const seen = near.filter((s) => (s.x - p.x) * ahead.x + (s.z - p.z) * ahead.z > 0);
    const pick = seen.length ? seen : near;
    if (!pick.length) { pair.clock = 1; return; }
    if (pair.spot) pair.spot.taken = false;
    pair.spot = pick[Math.floor(Math.random() * pick.length)];
    pair.spot.taken = true;
    pair.hit.position.set(pair.spot.x, pair.spot.y, pair.spot.z);
    pair.state = 'opening';
  }

  const right = new THREE.Vector3();
  function pan(pair) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const dx = pair.spot.x - camera.position.x, dz = pair.spot.z - camera.position.z;
    return Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / (Math.hypot(dx, dz) || 1)));
  }

  const m = new THREE.Matrix4(), one = new THREE.Matrix4(), none = new THREE.Matrix4().makeScale(0, 0, 0);
  const dummy = new THREE.Object3D();
  const sides = [-1, 1].map((k) => new THREE.Matrix4().compose(new THREE.Vector3(k * 0.33, 0, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), k * -0.12), new THREE.Vector3(1, 1, 1)));
  const behind = new THREE.Matrix4().makeTranslation(0, 0, -0.05);

  return {
    group,
    targets,
    update(dt) {
      const p = camera.position;
      const gathered = dell.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 20);
      const depth = nearestOnPath(path.points, p.x, p.z).d;
      const want = gathered ? def.count : Math.round(THREE.MathUtils.lerp(def.want[0], def.want[1], THREE.MathUtils.smoothstep(depth, 6, 50)));
      if (hush) {
        const d = Math.hypot(p.x - hush.x, p.z - hush.z);
        if (!hushed && d < hush.radius) {
          hushed = true;
          const wait = rand(Math.random, [4, 6]);
          for (const pair of pairs) { shut(pair, false); pair.clock = wait; }
          sfx.blink(0);
          subtitle('[every eye shuts at once]', 3);
        } else if (hushed && d > hush.radius * 3) {
          hushed = false;
        }
      }
      let open = pairs.filter((q) => q.state !== 'shut').length;
      pairs.forEach((pair, i) => {
        pair.clock -= dt;
        if (pair.state === 'shut') {
          pair.open = Math.max(0, pair.open - dt * 12);
          if (pair.clock <= 0 && open < want) { reopen(pair, gathered); if (pair.state !== 'shut') open++; }
        } else {
          const dx = p.x - pair.spot.x, dz = p.z - pair.spot.z;
          const dist = Math.hypot(dx, dz);
          // They turn to watch him, a little late.
          if (dist < def.range) {
            const face = Math.atan2(dx, dz);
            pair.yaw += Math.atan2(Math.sin(face - pair.yaw), Math.cos(face - pair.yaw)) * Math.min(1, dt * 1.6);
          }
          if (dist > def.far) shut(pair, false); // left behind: they close and wait to open near him again
          else if (pair.state === 'open') {
            pair.open = Math.min(1, pair.open + dt * 4);
            if (dist < def.shy) shut(pair, false); // too close: gone
            else if (pair.clock <= 0 && open > want) { shut(pair, false); open--; } // fewer of them by the path
            else if (pair.clock <= 0) { pair.state = 'blink'; pair.clock = 0.22; }
          } else if (pair.state === 'blink') {
            pair.open = Math.abs(pair.clock / 0.11 - 1); // shut and open again
            if (pair.clock <= 0) { pair.state = 'open'; pair.clock = rand(Math.random, def.blink); }
          } else if (pair.state === 'opening') {
            pair.open = Math.min(1, pair.open + dt * 1.5);
            if (pair.open >= 1) { pair.state = 'open'; pair.clock = rand(Math.random, def.blink); }
          }
        }
        if (pair.open > 0.01) {
          dummy.position.set(pair.spot.x, pair.spot.y, pair.spot.z);
          dummy.rotation.set(0, pair.yaw, pair.tilt);
          dummy.scale.set(1, pair.open, 1);
          dummy.updateMatrix();
          for (const k of [0, 1]) eyes.setMatrixAt(i * 2 + k, m.multiplyMatrices(dummy.matrix, sides[k]));
          halos.setMatrixAt(i, one.multiplyMatrices(dummy.matrix, behind));
        } else {
          for (const k of [0, 1]) eyes.setMatrixAt(i * 2 + k, none);
          halos.setMatrixAt(i, none);
          if (pair.state === 'shut') pair.hit.position.y = -1e3; // nothing to hit
        }
      });
      eyes.instanceMatrix.needsUpdate = halos.instanceMatrix.needsUpdate = true;
    },
  };
}
