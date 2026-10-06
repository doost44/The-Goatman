import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas, crunchy } from '../textures.js';
import { haze } from './horizon.js';

// The red field's sense of scale: other Walking Things, far bigger, pacing the ridges beyond
// the edge (never reachable), and a giant stilt leg that one of them lost, lying across a
// valley, that he can climb onto and walk along.

// A pale stilt leg's paint: pale bone with the painting's red line down each side.
function legPaint() {
  const c = canvas(32, 8);
  const g = c.getContext('2d');
  g.fillStyle = '#e6dad6';
  g.fillRect(0, 0, 32, 8);
  g.fillStyle = '#b91c32';
  for (const x of [3, 19]) g.fillRect(x, 0, 2, 8);
  g.fillStyle = '#cdbdb8';
  for (const x of [9, 26]) g.fillRect(x, 0, 1, 8);
  const tex = crunchy(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// A tapering tube from a to b (radii ra, rb), the paint wrapped round it and repeated along it.
function tube(a, b, ra, rb, sides = 7) {
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(rb, ra, len, sides, 1, false).translate(0, len / 2, 0);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) * len) / (ra * 6));
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  return geo.translate(a.x, a.y, a.z);
}

// --- The far Walking Things ------------------------------------------------------------------
// levels.json "giants": { look: { body, legs, haze: [from, to, most], low? (see haze()) }, walkers: [{ from: [x, z],
//   to: [x, z], height, speed }] }. Each walks from `from` to `to` and back on the far land,
// legs swinging from the hips: a pale body and two jointed stilt legs, hazed like the landmarks.

export function buildGiants(d, height, fogColor) {
  const group = new THREE.Group();
  const look = d.look;
  const mat = (color) => {
    const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    haze(m, { color: fogColor, from: look.haze[0], to: look.haze[1], a: 0, b: look.haze[2], low: look.low });
    return m;
  };
  const bodyMat = mat(look.body), legMat = mat(look.legs);
  const walkers = d.walkers.map((w, n) => {
    const H = w.height, upper = H * 0.42, lower = H * 0.42, thick = H * 0.018;
    const giant = new THREE.Group();
    // the body and its small head in one mesh; each leg one mesh, thigh and shin bent at the knee
    const body = new THREE.Mesh(mergeGeometries([
      new THREE.SphereGeometry(1, 7, 5).scale(H * 0.1, H * 0.07, H * 0.16),
      new THREE.SphereGeometry(1, 6, 4).scale(H * 0.05, H * 0.045, H * 0.07).translate(0, H * 0.06, -H * 0.17),
    ]), bodyMat);
    giant.add(body);
    const knee = new THREE.Vector3(0, -upper, -upper * 0.12), foot = new THREE.Vector3(0, -upper - lower, upper * 0.1);
    const legGeo = mergeGeometries([tube(new THREE.Vector3(), knee, thick * 1.3, thick), tube(knee, foot, thick * 0.8, thick * 0.5)]);
    const legs = [-1, 1].map((s) => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(s * H * 0.05, upper + lower, 0);
      giant.add(leg);
      return { leg, s };
    });
    group.add(giant);
    const a = new THREE.Vector3(w.from[0], 0, w.from[1]), b = new THREE.Vector3(w.to[0], 0, w.to[1]);
    return { giant, body, legs, a, b, H, speed: w.speed, t: (n * 0.37) % 1, dir: 1, phase: n, len: a.distanceTo(b) };
  });

  const at = new THREE.Vector3();
  return {
    group,
    update(dt) {
      for (const g of walkers) {
        g.t += (g.dir * g.speed * dt) / g.len;
        if (g.t > 1 || g.t < 0) { g.dir = -g.dir; g.t = THREE.MathUtils.clamp(g.t, 0, 1); }
        at.lerpVectors(g.a, g.b, g.t);
        g.giant.position.set(at.x, height(at.x, at.z) - g.H * 0.03, at.z);
        g.giant.rotation.y = Math.atan2(-(g.b.x - g.a.x) * g.dir, -(g.b.z - g.a.z) * g.dir);
        g.phase += (g.speed * dt) / (g.H * 0.5); // one stride every half its height walked
        const swing = Math.sin(g.phase * Math.PI);
        for (const { leg, s } of g.legs) leg.rotation.x = 0.4 * swing * s;
        g.body.position.y = g.H * 0.84 - Math.abs(swing) * g.H * 0.015;
        g.body.rotation.z = swing * 0.04;
      }
    },
  };
}

// --- The fallen leg --------------------------------------------------------------------------
// levels.json "fallenLeg": { joints: [[x, z, radius], ...] from the hip to the hoof, pad }.
// Straight pieces between the joints, each end resting on the ground (so one piece can
// bridge a valley), the pad a squashed ball at the hoof end. Solid, with its top walkable:
// line colliders, as the forest's fallen trunks (player.js), and a ground object whose surface
// is the top of whichever piece is under him.

export function buildFallenLeg(d, heightAt) {
  const pts = d.joints.map(([x, z, r]) => new THREE.Vector3(x, heightAt(x, z) + r * 0.75, z));
  const geos = [];
  const colliders = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ra, rb] = [d.joints[i][2], d.joints[i + 1][2]];
    geos.push(tube(pts[i], pts[i + 1], ra, rb));
    geos.push(new THREE.SphereGeometry(rb, 7, 5).translate(pts[i + 1].x, pts[i + 1].y, pts[i + 1].z)); // the joint's knuckle
    colliders.push({ kind: 'line', ax: pts[i].x, az: pts[i].z, bx: pts[i + 1].x, bz: pts[i + 1].z, r: (ra + rb) / 2, ya: pts[i].y + ra, yb: pts[i + 1].y + rb });
  }
  const end = pts[pts.length - 1], [, , rEnd] = d.joints[d.joints.length - 1];
  const pad = new THREE.SphereGeometry(1, 8, 5).scale(rEnd * d.pad, rEnd * 1.2, rEnd * d.pad).translate(end.x, end.y - rEnd * 0.2, end.z);
  const paint = legPaint(); // a little of its own colour unlit, so it stays pale like the Walking Thing
  const mesh = new THREE.Mesh(mergeGeometries([...geos, pad]), new THREE.MeshLambertMaterial({ map: paint, emissiveMap: paint, emissive: 0x505050, flatShading: true }));
  // the painting's dark line round it: its back faces, pushed out a little along the normals
  const outline = new THREE.Mesh(mesh.geometry.clone(), new THREE.MeshBasicMaterial({ color: 0x4a0a14, side: THREE.BackSide }));
  const pos = outline.geometry.attributes.position, nor = outline.geometry.attributes.normal;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nor.getX(i) * 0.25, pos.getY(i) + nor.getY(i) * 0.25, pos.getZ(i) + nor.getZ(i) * 0.25);

  // The top of whichever piece is under (x, z), rounded over like a log, or null.
  const top = new THREE.Object3D();
  top.userData.surface = (x, z) => {
    let best = null;
    for (const c of colliders) {
      const dx = c.bx - c.ax, dz = c.bz - c.az;
      const k = ((x - c.ax) * dx + (z - c.az) * dz) / (dx * dx + dz * dz);
      const dist = Math.hypot(x - (c.ax + dx * k), z - (c.az + dz * k));
      if (k < 0 || k > 1 || dist > c.r) continue;
      const h = c.ya + (c.yb - c.ya) * k - c.r + Math.sqrt(c.r * c.r - dist * dist);
      if (best === null || h > best) best = h;
    }
    return best;
  };
  return { meshes: [mesh, outline], colliders, ground: top, blockers: [mesh] };
}
