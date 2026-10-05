import * as THREE from 'three';

// Low-poly ground from a description in levels.json:
//   { shape: "rect", size: [w, d], center: [x, z], segments: [nx, nz] }  or
//   { shape: "disc", radius, center, segments: [around, rings] }
//   hills: [[x, z, radius, height], ...]   noise: amplitude   tile: metres per texture repeat
//   flat: [[x, z, radius], ...] spots kept level (paths, the pool)
// heightAt(x, z) gives the same height the mesh has there (used to place props).

// Smooth value noise, so the ground has a few soft lumps without any texture lookups.
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function valueNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

export function terrainHeight(t) {
  const hills = t.hills ?? [];
  const flat = t.flat ?? [];
  const amp = t.noise ?? 0;
  const scale = t.noiseScale ?? 0.06;
  return (x, z) => {
    let h = 0;
    for (const [hx, hz, r, height] of hills) {
      const d2 = (x - hx) ** 2 + (z - hz) ** 2;
      h += height * Math.exp(-d2 / (r * r));
    }
    if (amp) h += amp * valueNoise(x * scale, z * scale);
    for (const [fx, fz, r] of flat) {
      const d = Math.hypot(x - fx, z - fz);
      if (d < r) h *= THREE.MathUtils.smoothstep(d, r * 0.6, r);
    }
    return h;
  };
}

export function buildTerrain(t, material) {
  const [cx, cz] = t.center ?? [0, 0];
  let geo;
  if (t.shape === 'disc') {
    const [around, rings] = t.segments ?? [48, 16];
    geo = new THREE.RingGeometry(0.01, t.radius, around, rings);
  } else {
    const [w, d] = t.size;
    const [nx, nz] = t.segments ?? [Math.ceil(w / 4), Math.ceil(d / 4)];
    geo = new THREE.PlaneGeometry(w, d, nx, nz);
  }
  geo.rotateX(-Math.PI / 2);
  geo.translate(cx, 0, cz);

  const heightAt = terrainHeight(t);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const tile = t.tile ?? 8;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    uv.setXY(i, x / tile, -z / tile); // world-space UVs: the texture tiles evenly on any shape
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.heightAt = heightAt;
  return { mesh, heightAt };
}
