import * as THREE from 'three';

// Low-poly ground from a description in levels.json:
//   { shape: "rect", size: [w, d], center: [x, z], segments: [nx, nz] }  or
//   { shape: "disc", radius, center, segments: [around, rings] }
//   hills: [[x, z, radius, height], ...]   noise: amplitude   tile: metres per texture repeat
//   flat: [[x, z, radius], ...] spots kept level (paths, the pool)
// heightAt(x, z) gives the height of the mesh's surface there (used to place props).

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
  const surface = t.shape === 'disc' ? heightAt : gridSurface(t, heightAt);
  mesh.userData.heightAt = surface;
  return { mesh, heightAt: surface };
}

// On a rect the ground between the vertices is flat triangles, which can sit a little
// above or below the smooth height: this gives the triangles' own height, so small
// things (marks, pebbles) sit exactly on it instead of sinking in.
function gridSurface(t, heightAt) {
  const [cx, cz] = t.center ?? [0, 0];
  const [w, d] = t.size;
  const [nx, nz] = t.segments ?? [Math.ceil(w / 4), Math.ceil(d / 4)];
  const sx = w / nx, sz = d / nz;
  return (x, z) => {
    const u = THREE.MathUtils.clamp((x - cx + w / 2) / sx, 0, nx - 1e-6);
    const v = THREE.MathUtils.clamp((z - cz + d / 2) / sz, 0, nz - 1e-6);
    const ix = Math.floor(u), iz = Math.floor(v);
    const fu = u - ix, fv = v - iz;
    const x0 = cx - w / 2 + ix * sx, z0 = cz - d / 2 + iz * sz;
    const a = heightAt(x0, z0), b = heightAt(x0, z0 + sz), c = heightAt(x0 + sx, z0 + sz), e = heightAt(x0 + sx, z0);
    // PlaneGeometry splits each square along the b-e diagonal
    return fu + fv <= 1 ? a + (e - a) * fu + (b - a) * fv : c + (b - c) * (1 - fu) + (e - c) * (1 - fv);
  };
}

// Points every `spacing` metres along a path of [x, z] points (levels.json "path"), each
// with the direction of travel (dx, dz), the sideways direction (nx, nz) and how far along
// it is (t). Builders use it to line the path with trunks, marks and pebbles.
export function walkPath(points, spacing, from = 0) {
  const out = [];
  let t = 0;
  let next = from;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    for (; next <= t + len; next += spacing) {
      const s = next - t;
      out.push({ x: ax + dx * s, z: az + dz * s, dx, dz, nx: -dz, nz: dx, t: next });
    }
    t += len;
  }
  return out;
}

// Lay a flat geometry (already placed in the world) over the ground, a little above it,
// for glows and decals on uneven ground.
export function drape(geo, heightAt, lift = 0.04) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)) + lift);
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}
