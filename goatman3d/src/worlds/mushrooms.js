import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture, rng } from '../textures.js';
import { walkPath, valueNoise, drape } from '../terrain.js';
import { nearestOnPath } from '../player.js';
import { glowFog } from './marks.js';

// Small glowing mushrooms growing in faint trails across the night forest's floor, leading
// to its places (the ring, the pale giant, the eyes' dell, the clearings and ponds), with a
// ring of them round each place. None grow near the start, so the first walk is in the dark.
// They glow brighter and grow closer together the nearer they are to where they lead, and
// shiver and dim as GoatMan passes. The mushrooms go in the forest's scatter (only the ones
// near the camera are drawn); the soft glow under each clump is one mesh.
//
// levels.json "mushrooms": { from (metres round the start where none grow), color, glow:
//   [far, near] (brightness at a trail's start and at its place), spacing: [far, near]
//   (metres between clumps), size: [min, max], ring (clumps round each place), seed,
//   trails: [{ to (a side path's or a pond's name), from?: [x, z] (where it starts: the
//   nearest point of the main path if not given), points?: [[x, z], ...] (a way of its own) }] }

const smooth = THREE.MathUtils.smoothstep, lerp = THREE.MathUtils.lerp;

// A mushroom 1 tall: a pale stem under a glowing cap (round, or a pointed one), its parts
// told apart by how bright their vertex colours are.
function mushroomGeometry(pointed) {
  const shade = (geo, k) => geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count * 3).fill(k), 3));
  const stem = shade(new THREE.CylinderGeometry(0.1, 0.14, 0.7, 5, 1).translate(0, 0.35, 0), 0.45);
  const cap = pointed
    ? new THREE.ConeGeometry(0.26, 0.45, 6, 1).translate(0, 0.85, 0)
    : new THREE.SphereGeometry(0.36, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(0, 0.66, 0);
  shade(cap, 1);
  const gills = shade(new THREE.CircleGeometry(pointed ? 0.26 : 0.36, 7).rotateX(Math.PI / 2).translate(0, pointed ? 0.63 : 0.66, 0), 0.6);
  return mergeGeometries([stem, cap, gills]);
}

// Shiver and dim when he is near (uPlayer: where he is).
function nearHim(mat, time, player) {
  mat.customProgramCacheKey = () => 'mushrooms';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime: time, uPlayer: { value: player.pos } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uPlayer;\nvarying float vNear;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vNear = 1.0 - smoothstep(0.8, 3.5, distance(root.xz, uPlayer.xz));
        transformed.xz += vNear * position.y * 0.12 * vec2(sin(uTime * 41.0 + root.x * 9.0), cos(uTime * 37.0 + root.z * 9.0));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vNear;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.65 * vNear;');
  };
  return mat;
}

// places: name -> { x, z, radius }; start: [x, z] (the spawn); path: the main path;
// blocked(x, z): nowhere to grow (a trunk, the water, the path).
export function buildMushrooms(def, { places, start, path, heightAt, blocked, scatter, player }) {
  const r = rng(def.seed ?? 6);
  const time = { value: 0 };
  const mat = glowFog(nearHim(new THREE.MeshBasicMaterial({ color: def.color, vertexColors: true }), time, player));
  const kinds = [false, true].map((pointed) => scatter.kind(mushroomGeometry(pointed), mat));
  const halos = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const color = new THREE.Color();

  // A clump of two to five, `bright` bright, unless it is too near the start or in the way.
  function clump(x, z, bright) {
    const fromStart = Math.hypot(x - start[0], z - start[1]);
    if (r() > smooth(fromStart, def.from, def.from + 12) || blocked(x, z)) return;
    for (let i = 0, n = 2 + Math.floor(r() * 4); i < n; i++) {
      const mx = x + (r() - 0.5) * 0.9, mz = z + (r() - 0.5) * 0.9, size = lerp(def.size[0], def.size[1], r() * r());
      m.compose(p.set(mx, heightAt(mx, mz) - 0.02, mz), q.setFromEuler(e.set((r() - 0.5) * 0.4, r() * 6, (r() - 0.5) * 0.4)), s.setScalar(size));
      scatter.add(kinds[r() < 0.3 ? 1 : 0], m, color.setScalar(bright * (0.75 + r() * 0.4)));
    }
    halos.push([x, z, bright]);
  }

  for (const trail of def.trails) {
    const place = places[trail.to];
    if (!place) continue;
    const from = trail.from ?? (() => { const n = nearestOnPath(path.points, place.x, place.z); return [n.x, n.z]; })();
    const way = trail.points ?? [from, [place.x, place.z]];
    const steps = walkPath(way, 0.5);
    const length = steps.at(-1).t;
    // Along the way, wandering a little from side to side, until the ring round the place.
    for (let t = 0; t < length;) {
      const st = steps[Math.min(steps.length - 1, Math.round(t / 0.5))];
      if (Math.hypot(st.x - place.x, st.z - place.z) < place.radius) break;
      const k = t / length, wander = 2.2 * valueNoise(t * 0.08 + place.x, place.z * 0.1);
      clump(st.x + st.nx * wander, st.z + st.nz * wander, lerp(def.glow[0], def.glow[1], k * k));
      t += lerp(def.spacing[0], def.spacing[1], k) * (0.7 + r() * 0.6);
    }
  }
  for (const place of new Set(def.trails.map((t) => places[t.to]).filter(Boolean))) {
    for (let i = 0; i < def.ring; i++) {
      const a = (i / def.ring) * Math.PI * 2 + (r() - 0.5) * 0.3, d = place.radius * (0.8 + r() * 0.15);
      clump(place.x + Math.cos(a) * d, place.z + Math.sin(a) * d, def.glow[1]);
    }
  }

  // A soft glow on the ground under each clump.
  const geos = halos.map(([x, z, bright]) => {
    const geo = drape(new THREE.PlaneGeometry(2.4, 2.4, 2, 2).rotateX(-Math.PI / 2).translate(x, 0, z), heightAt, 0.04);
    return geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count * 3).fill(bright), 3));
  });
  const glow = glowTexture([[0, 'rgba(255,255,255,0.6)'], [0.4, 'rgba(255,255,255,0.2)'], [1, 'rgba(255,255,255,0)']]);
  const haloMat = glowFog(new THREE.MeshBasicMaterial({ map: glow, color: def.color, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), true);
  const halo = new THREE.Mesh(mergeGeometries(geos), haloMat);
  geos.forEach((g) => g.dispose());

  return {
    group: halo,
    update(t) {
      time.value = t;
      haloMat.opacity = 0.85 + 0.15 * Math.sin(t * 0.7); // breathing, slower than the marks
    },
  };
}
