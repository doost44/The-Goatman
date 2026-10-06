import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { drape } from '../terrain.js';
import { glowTexture } from '../textures.js';
import { glowFog } from './marks.js';

// What makes the walk down a hidden path worth it, besides the place at its end
// (levels.json sidePaths[].end.find):
//   "stones": a ring of small standing stones with a faint glow { count, radius, color }
//   "hollow": a huge hollow fallen trunk to walk through, pale and pointing the way out like
//             the rest of the pale wood { at: [x, z], length, radius }
//   "high":   a fallen giant propped up high on a stump, to walk up and look out over the fog
//             { from: [x, z] (its foot), to: [x, z], top (metres up at its high end), radius }
//   "hush":   where every eye shuts at once when he arrives { radius } (marks.js)
// planFinds() makes room for them in woods.js's plan; buildFinds() draws the stones and the
// hollow (the high trunk is drawn with the fallen ones, its stump with the trunks).

const lerp = THREE.MathUtils.lerp;

// tools (from planForest): add (a trunk), remember (something solid), clear and bare (lists
// of [x, z, radius] kept free of trunks, and of undergrowth), logs (the fallen trunks).
export function planFinds(def, heightAt, r, { add, remember, clear, bare, logs }) {
  const out = { stones: [], hollows: [], hush: null, glowAt: [] };
  const [gx, gz] = def.exit.at;
  for (const p of def.sidePaths ?? []) {
    const f = p.end?.find, [ex, ez] = p.end?.at ?? [];
    if (f?.kind === 'stones') {
      for (let i = 0; i < f.count; i++) {
        const a = (i / f.count) * Math.PI * 2 + (r() - 0.5) * 0.2;
        const x = ex + Math.cos(a) * f.radius, z = ez + Math.sin(a) * f.radius;
        out.stones.push({ x, z, y: heightAt(x, z), size: 0.8 + r() * 0.5, yaw: r() * 6, tilt: (r() - 0.5) * 0.25 });
        remember({ x, z, room: 0.45, collider: { kind: 'circle', x, z, r: 0.4 } });
      }
      out.stoneRing = { x: ex, z: ez, radius: f.radius, color: f.color };
    } else if (f?.kind === 'hollow') {
      // Lying along the way to the gate, its walls colliders along both sides, open at the ends.
      const [x, z] = f.at, a = Math.atan2(gz - z, gx - x), dx = Math.cos(a), dz = Math.sin(a), half = f.length / 2;
      const ends = [-1, 1].map((k) => [x + dx * half * k, z + dz * half * k]);
      const h = {
        ax: ends[0][0], az: ends[0][1], bx: ends[1][0], bz: ends[1][1], R: f.radius, inner: f.radius - 0.3,
        ya: heightAt(...ends[0]) + 1.3, yb: heightAt(...ends[1]) + 1.3, // its middle line, so the ground is its floor
      };
      out.hollows.push(h);
      for (let s = -half; s <= half; s += 0.7) {
        for (const side of [-1, 1]) {
          const wx = x + dx * s - dz * side * (h.inner + 0.05), wz = z + dz * s + dx * side * (h.inner + 0.05);
          remember({ x: wx, z: wz, room: 0.35, collider: { kind: 'circle', x: wx, z: wz, r: 0.35 } });
        }
      }
      for (let s = -half - 2; s <= half + 2; s += 2) clear.push([x + dx * s, z + dz * s, f.radius + 0.8]);
      bare.push(...[-0.25, 0.25].map((k) => [x + dx * f.length * k, z + dz * f.length * k, f.radius]));
      out.glowAt.push([x - dx * 1.5 + dz * 0.6, z - dz * 1.5 - dx * 0.6], [x + dx * 2.5 - dz * 0.5, z + dz * 2.5 + dx * 0.5]);
    } else if (f?.kind === 'high') {
      // Its foot sunk so he can step up onto it, its top end resting on a broken stump.
      const [ax, az] = f.from, [bx, bz] = f.to, R = f.radius;
      const log = { ax, az, bx, bz, r: R, ya: heightAt(ax, az) - R * 0.4, yb: heightAt(bx, bz) + f.top, tint: 1.4, dark: true, x: (ax + bx) / 2, z: (az + bz) / 2 };
      log.collider = { kind: 'line', ax, az, bx, bz, r: R, ya: log.ya + R, yb: log.yb + R };
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5);
      for (let i = 0; i <= n; i++) {
        const x = lerp(ax, bx, i / n), z = lerp(az, bz, i / n);
        remember({ x, z, room: R, collider: log.collider });
        clear.push([x, z, R + 1.2]);
      }
      logs.push(log);
      const sx = lerp(ax, bx, 0.9), sz = lerp(az, bz, 0.9), under = lerp(log.ya, log.yb, 0.9) - R;
      const stump = add(sx, sz, { radius: 0.9, card: false, lean: 0.03, height: under - heightAt(sx, sz) + 0.5, noRoots: false }, true);
      Object.assign(stump.collider, { y0: -Infinity, y1: under }); // he walks over it on the trunk
    } else if (f?.kind === 'hush') {
      out.hush = { x: ex, z: ez, radius: f.radius };
    }
  }
  return out;
}

// A hollow trunk lying along x, `length` long: bark outside and in, with ragged broken ends.
function hollowGeometry(R, inner, length) {
  const jag = (a, end) => 0.3 * Math.sin(a * 3 + end * 2) + 0.15 * Math.sin(a * 7 + end);
  const tube = (radius, inward) => {
    const geo = new THREE.CylinderGeometry(radius, radius, length, 10, 2, true);
    const pos = geo.attributes.position, normal = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), a = Math.atan2(pos.getZ(i), pos.getX(i));
      if (Math.abs(y) > length / 2 - 0.01) pos.setY(i, y - Math.sign(y) * Math.abs(jag(a, Math.sign(y))));
      if (inward) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
    }
    if (inward) { // turn its faces to look inward
      const idx = geo.index.array;
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    }
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * (length / 4));
    return geo;
  };
  return mergeGeometries([tube(R, false), tube(inner, true)]).rotateZ(Math.PI / 2);
}

// mats: the forest's wood ({ pale }).
export function buildFinds(finds, { heightAt, mats }) {
  const group = new THREE.Group();
  const blockers = [];
  for (const h of finds.hollows) {
    const len = Math.hypot(h.bx - h.ax, h.bz - h.az);
    const mesh = new THREE.Mesh(hollowGeometry(h.R, h.inner, len), mats.pale);
    mesh.position.set((h.ax + h.bx) / 2, (h.ya + h.yb) / 2, (h.az + h.bz) / 2);
    mesh.rotation.set(0, Math.atan2(-(h.bz - h.az), h.bx - h.ax), Math.atan2(h.yb - h.ya, len), 'YZX');
    group.add(mesh);
    blockers.push(mesh);
  }

  // The stones: grey, glowing faintly from inside, brighter as he comes into the ring; and a
  // soft light on the ground in the middle of it and round each one.
  let stoneMat = null, haloMat = null;
  if (finds.stones.length) {
    const { color } = finds.stoneRing;
    const geos = finds.stones.map((s) => new THREE.DodecahedronGeometry(1, 0).scale(0.45 * s.size, 0.9 * s.size, 0.4 * s.size)
      .rotateZ(s.tilt).rotateY(s.yaw).translate(s.x, s.y + 0.5 * s.size, s.z));
    stoneMat = new THREE.MeshLambertMaterial({ color: '#3a3c50', emissive: color, emissiveIntensity: 0.06, flatShading: true });
    group.add(new THREE.Mesh(mergeGeometries(geos), stoneMat));
    const ring = finds.stoneRing;
    const glows = [[ring.x, ring.z, ring.radius * 2.4], ...finds.stones.map((s) => [s.x, s.z, 2])]
      .map(([x, z, size]) => drape(new THREE.PlaneGeometry(size, size, 4, 4).rotateX(-Math.PI / 2).translate(x, 0, z), heightAt, 0.05));
    const glow = glowTexture([[0, 'rgba(255,255,255,0.5)'], [0.5, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]);
    haloMat = glowFog(new THREE.MeshBasicMaterial({ map: glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), true);
    group.add(new THREE.Mesh(mergeGeometries(glows), haloMat));
    [...geos, ...glows].forEach((g) => g.dispose());
  }

  return {
    group,
    blockers,
    update(t, player) {
      if (!stoneMat) return;
      const ring = finds.stoneRing;
      const near = 1 - THREE.MathUtils.smoothstep(Math.hypot(player.pos.x - ring.x, player.pos.z - ring.z), ring.radius, ring.radius + 10);
      const breathe = 0.85 + 0.15 * Math.sin(t * 0.6);
      stoneMat.emissiveIntensity = (0.06 + 0.2 * near) * breathe;
      haloMat.opacity = (0.4 + 0.6 * near) * breathe;
    },
  };
}
