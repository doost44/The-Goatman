import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadSheet, loadTexture, canvas, crunchy, glowTexture, rng } from '../textures.js';
import { walkPath, drape } from '../terrain.js';
import { sfx } from '../sfx.js';
import { subtitle } from '../hud.js';

// The yellow marks along the bottom of "Background Section 1": small glowing shapes in
// the grass that lead to the way out. Some of them are eyes. They watch him go by,
// blink, and turn to follow him; a pebble shuts them and they open somewhere else.

const rand = (r, [a, b]) => a + r() * (b - a);
const glow = () => glowTexture([[0, 'rgba(255,190,80,0.55)'], [0.4, 'rgba(255,140,40,0.18)'], [1, 'rgba(255,120,30,0)']]);

// --- Marks on the ground --------------------------------------------------------------------

// All the marks are one mesh of flat quads, each showing one frame of marks.png.
export async function buildMarks(def, path, heightAt, avoid) {
  const sheet = await loadSheet(def.sheet);
  const map = await loadTexture(`${def.sheet}.png`);
  const r = rng(def.seed);
  const W = sheet.img.width, H = sheet.img.height;
  const pos = [], uv = [], index = [];
  const halos = [];
  const steps = walkPath(path.points, def.spacing, 3);
  for (const s of steps.slice(0, -1)) {
    const off = (r() - 0.5) * 2 * def.spread;
    const x = s.x + s.nx * off, z = s.z + s.nz * off;
    if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    const f = sheet.frames[Math.floor(r() * sheet.count)];
    const w = def.size * (0.8 + r() * 0.4) / 2, h = (w * f.h) / f.w;
    const a = Math.atan2(s.dx, s.dz) + (r() - 0.5) * 1.2;
    const c = Math.cos(a), sn = Math.sin(a);
    const y = heightAt(x, z) + 0.04;
    // Propped up a little on the grass, tipped toward someone coming down the path.
    const tilt = rand(r, def.tilt), up = Math.sin(tilt), flat = Math.cos(tilt);
    const n = pos.length / 3;
    for (const [lx, lz] of [[-w, h], [w, h], [w, -h], [-w, -h]]) {
      pos.push(x + lx * c + lz * flat * sn, y + (lz + h) * up, z - lx * sn + lz * flat * c);
    }
    const u0 = f.x / W, u1 = (f.x + f.w) / W, v0 = 1 - (f.y + f.h) / H, v1 = 1 - f.y / H;
    uv.push(u0, v1, u1, v1, u1, v0, u0, v0);
    index.push(n, n + 1, n + 2, n, n + 2, n + 3);
    const size = def.size * 2.4;
    halos.push(drape(new THREE.PlaneGeometry(size, size, 3, 3).rotateX(-Math.PI / 2).translate(x, 0, z), heightAt, 0.03));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  const mat = new THREE.MeshBasicMaterial({ map, alphaTest: 0.4, fog: false });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));

  // A soft glow on the grass under each one.
  const haloMat = new THREE.MeshBasicMaterial({ map: glow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  group.add(new THREE.Mesh(mergeGeometries(halos), haloMat));
  for (const h of halos) h.dispose();
  return {
    group,
    // A slow pulse, as if they were breathing.
    update(t) { mat.color.setScalar(def.glow * (0.85 + 0.15 * Math.sin(t * 1.3))); },
  };
}

// --- Eyes -----------------------------------------------------------------------------------

// An eye made from the marks: a lens of their orange paint with a goat's flat pupil.
async function eyeTexture(sheet) {
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

// Spots for eyes either side of the path, mostly low in the undergrowth, a few up the
// trunks, and only where they can be seen from the path between the trunks (blockers).
// There are more spots than eyes, so the eyes can move.
export async function buildEyes(def, path, heightAt, camera, blockers) {
  const sheet = await loadSheet(def.sheet);
  const r = rng(def.seed);
  const ray = new THREE.Raycaster();
  const from = new THREE.Vector3(), to = new THREE.Vector3();
  const seen = (spot, s) => [-4, 0, 4].filter((ahead) => {
    from.set(spot.x, spot.y, spot.z);
    to.set(s.x + s.dx * ahead, 0, s.z + s.dz * ahead);
    to.y = heightAt(to.x, to.z) + 1.7;
    ray.set(from, to.sub(from).normalize());
    ray.far = from.distanceTo(to.set(s.x + s.dx * ahead, to.y, s.z + s.dz * ahead));
    return ray.intersectObjects(blockers, false).length === 0;
  }).length >= 2;
  const spots = [];
  for (const s of walkPath(path.points, def.every, 6).slice(0, -1)) {
    for (let tries = 0; tries < 4; tries++) {
      const off = (r() < 0.5 ? -1 : 1) * rand(r, def.out);
      const x = s.x + s.nx * off, z = s.z + s.nz * off;
      const high = r() < 0.2;
      const spot = { x, z, y: heightAt(x, z) + (high ? rand(r, [2, 4.5]) : rand(r, [0.25, 1.1])), taken: false };
      if (seen(spot, s)) { spots.push(spot); break; }
    }
  }

  const mat = new THREE.MeshBasicMaterial({ map: await eyeTexture(sheet), alphaTest: 0.5, fog: false, side: THREE.DoubleSide });
  const eyeGeo = new THREE.PlaneGeometry(0.5, 0.3);
  const haloMat = new THREE.MeshBasicMaterial({ map: glow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const haloGeo = new THREE.PlaneGeometry(2, 1.4);
  const hitGeo = new THREE.SphereGeometry(0.5, 6, 4);
  const group = new THREE.Group();
  const targets = []; // what a pebble can hit
  const pairs = [];

  function moveTo(pair, spot) {
    if (pair.spot) pair.spot.taken = false;
    spot.taken = true;
    pair.spot = spot;
    pair.g.position.set(spot.x, spot.y, spot.z);
  }

  for (let i = 0; i < def.count; i++) {
    const g = new THREE.Group();
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, mat);
      eye.position.x = side * 0.33;
      eye.rotation.z = side * -0.12; // a little slanted
      g.add(eye);
    }
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.z = -0.05;
    const hit = new THREE.Mesh(hitGeo, mat);
    hit.visible = false; // only for pebbles to hit
    g.add(halo, hit);
    group.add(g);
    const pair = { g, spot: null, yaw: r() * 6, tilt: (r() - 0.5) * 0.5, open: 1, state: 'open', clock: rand(r, def.blink) };
    hit.userData.onRock = () => shut(pair, true);
    targets.push(hit);
    pairs.push(pair);
    const free = spots.filter((s) => !s.taken);
    moveTo(pair, free[Math.floor((i / def.count) * free.length)]);
  }

  function shut(pair, struck) {
    if (pair.state === 'shut' || pair.state === 'gone') return;
    pair.state = 'shut';
    pair.clock = rand(Math.random, def.away);
    if (struck) {
      sfx.blink(pan(pair));
      subtitle('[eyes snap shut]', 2);
    }
  }

  // Somewhere new, not too near him and not too far, ahead of him if possible.
  function reopen(pair) {
    const p = camera.position;
    const ok = spots.filter((s) => !s.taken && Math.hypot(s.x - p.x, s.z - p.z) > 7 && Math.hypot(s.x - p.x, s.z - p.z) < 22);
    if (ok.length) moveTo(pair, ok[Math.floor(Math.random() * ok.length)]);
    pair.state = 'opening';
  }

  const right = new THREE.Vector3();
  function pan(pair) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const dx = pair.g.position.x - camera.position.x, dz = pair.g.position.z - camera.position.z;
    return Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / (Math.hypot(dx, dz) || 1)));
  }

  return {
    group,
    targets,
    update(dt) {
      const p = camera.position;
      for (const pair of pairs) {
        const { g } = pair;
        const dx = p.x - g.position.x, dz = p.z - g.position.z;
        const dist = Math.hypot(dx, dz);
        // They turn to watch him, a little late.
        if (dist < def.range) {
          const want = Math.atan2(dx, dz);
          pair.yaw += Math.atan2(Math.sin(want - pair.yaw), Math.cos(want - pair.yaw)) * Math.min(1, dt * 1.6);
        }
        pair.clock -= dt;
        if (pair.state === 'open') {
          pair.open = Math.min(1, pair.open + dt * 4);
          if (dist < def.shy) shut(pair, false); // too close: gone
          else if (pair.clock <= 0) { pair.state = 'blink'; pair.clock = 0.22; }
        } else if (pair.state === 'blink') {
          pair.open = Math.abs(pair.clock / 0.11 - 1); // shut and open again
          if (pair.clock <= 0) { pair.state = 'open'; pair.clock = rand(Math.random, def.blink); }
        } else if (pair.state === 'shut') {
          pair.open = Math.max(0, pair.open - dt * 12);
          if (pair.clock <= 0) reopen(pair);
        } else if (pair.state === 'opening') {
          pair.open = Math.min(1, pair.open + dt * 1.5);
          if (pair.open >= 1) { pair.state = 'open'; pair.clock = rand(Math.random, def.blink); }
        }
        g.rotation.set(0, pair.yaw, pair.tilt);
        g.scale.y = Math.max(0.001, pair.open);
        g.visible = pair.open > 0.01;
      }
    },
  };
}
