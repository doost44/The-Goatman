import * as THREE from 'three';

// Low-poly ground from a description in levels.json:
//   { shape: "rect", size: [w, d], center: [x, z], segments: [nx, nz] }  or
//   { shape: "disc", radius, center, segments: [around, rings] }
//   hills: [[x, z, radius, height], ...]   noise: amplitude   tile: metres per texture repeat
//   flat: [[x, z, radius], ...] spots kept level (under trees, where a level starts)
//   rim: [from, to, height] the ground rises toward the edge of a disc (foothills)
//   mottle: [amount, scale] broad darker patches, so the tiled texture repeats less obviously
// heightAt(x, z) gives the height of the mesh's surface there (used to place props), and
// the mesh's userData.surface(x, z) the same, or null off its edge.
// A level can also pass { reshape(x, z, h), shade(x, z) } to buildTerrain: reshape changes
// the height (the savanna's river carves its channel), shade tints the ground ([r, g, b]:
// the river's mud).

// Smooth value noise, so the ground has a few soft lumps without any texture lookups.
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function valueNoise(x, z) {
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
    if (t.rim) {
      const [cx, cz] = t.center ?? [0, 0];
      const [from, to, height] = t.rim;
      h += height * THREE.MathUtils.smootherstep(Math.hypot(x - cx, z - cz), from, to);
    }
    return h;
  };
}

export function buildTerrain(t, material, { reshape, shade } = {}) {
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

  const natural = terrainHeight(t);
  const heightAt = reshape ? (x, z) => reshape(x, z, natural(x, z)) : natural;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const tile = t.tile ?? 8;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    uv.setXY(i, x / tile, -z / tile); // world-space UVs: the texture tiles evenly on any shape
  }
  geo.computeVertexNormals();
  if (t.mottle || shade) {
    const [amount, scale] = t.mottle ?? [0, 1];
    const colors = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) * scale, z = pos.getZ(i) * scale;
      const n = 0.65 * valueNoise(x + 31.7, z - 17.3) + 0.35 * valueNoise(x * 2.3 - 5.1, z * 2.3 + 8.9);
      const k = 1 - amount * (0.5 + 0.5 * n);
      const [r, g, b] = shade ? shade(pos.getX(i), pos.getZ(i)) : [1, 1, 1];
      colors.push(k * r, k * g, k * b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    material.vertexColors = true;
  }
  const mesh = new THREE.Mesh(geo, material);
  const surface = t.shape === 'disc' ? discSurface(t, heightAt) : gridSurface(t, pos);
  // What player.js stands him on: the height where there is ground, null off its edge
  // (quicker than raycasting thousands of triangles every frame).
  const inside = t.shape === 'disc'
    ? (x, z) => Math.hypot(x - cx, z - cz) <= t.radius
    : (x, z) => Math.abs(x - cx) <= t.size[0] / 2 && Math.abs(z - cz) <= t.size[1] / 2;
  mesh.userData.surface = (x, z) => (inside(x, z) ? surface(x, z) : null);
  return { mesh, heightAt: surface };
}

// On a rect the ground between the vertices is flat triangles, which can sit a little
// above or below the smooth height: this gives the triangles' own height, so small
// things (marks, pebbles) sit exactly on it instead of sinking in. The corners' heights
// are read back from the mesh (row by row along z), so it is quick enough to call often.
function gridSurface(t, pos) {
  const [cx, cz] = t.center ?? [0, 0];
  const [w, d] = t.size;
  const [nx, nz] = t.segments ?? [Math.ceil(w / 4), Math.ceil(d / 4)];
  const sx = w / nx, sz = d / nz;
  const corner = (ix, iz) => pos.getY(iz * (nx + 1) + ix);
  return (x, z) => {
    const u = THREE.MathUtils.clamp((x - cx + w / 2) / sx, 0, nx - 1e-6);
    const v = THREE.MathUtils.clamp((z - cz + d / 2) / sz, 0, nz - 1e-6);
    const ix = Math.floor(u), iz = Math.floor(v);
    const fu = u - ix, fv = v - iz;
    const a = corner(ix, iz), b = corner(ix, iz + 1), c = corner(ix + 1, iz + 1), e = corner(ix + 1, iz);
    // PlaneGeometry splits each square along the b-e diagonal
    return fu + fv <= 1 ? a + (e - a) * fu + (b - a) * fv : c + (b - c) * (1 - fu) + (e - c) * (1 - fv);
  };
}

// The same for a disc. RingGeometry makes rings of quads round the centre, each split
// into the triangles (a, b, d) and (b, c, d); this finds the quad and the triangle.
function discSurface(t, heightAt) {
  const [cx, cz] = t.center ?? [0, 0];
  const [around, rings] = t.segments ?? [48, 16];
  const r0 = 0.01, dr = (t.radius - r0) / rings, da = (Math.PI * 2) / around;
  const corner = (j, i) => {
    const r = r0 + j * dr;
    const x = cx + r * Math.cos(i * da), z = cz - r * Math.sin(i * da); // built in XY, then laid flat
    return [x, z, heightAt(x, z)];
  };
  // Height on the plane through three corners, or null if (x, z) is outside the triangle.
  const onTriangle = (x, z, [ax, az, ah], [bx, bz, bh], [cx2, cz2, ch], always) => {
    const det = (bz - cz2) * (ax - cx2) + (cx2 - bx) * (az - cz2);
    if (Math.abs(det) < 1e-9) return always ? ah : null;
    const wa = ((bz - cz2) * (x - cx2) + (cx2 - bx) * (z - cz2)) / det;
    const wb = ((cz2 - az) * (x - cx2) + (ax - cx2) * (z - cz2)) / det;
    const wc = 1 - wa - wb;
    if (!always && (wa < -1e-6 || wb < -1e-6 || wc < -1e-6)) return null;
    return wa * ah + wb * bh + wc * ch;
  };
  return (x, z) => {
    let a = Math.atan2(-(z - cz), x - cx);
    if (a < 0) a += Math.PI * 2;
    const i = Math.min(around - 1, Math.floor(a / da));
    const j = THREE.MathUtils.clamp(Math.floor((Math.hypot(x - cx, z - cz) - r0) / dr), 0, rings - 1);
    // The quads' edges are straight, not arcs, so a point can be in the next ring out.
    const last = Math.min(j + 1, rings - 1);
    for (let k = j; k <= last; k++) {
      const A = corner(k, i), B = corner(k + 1, i), C = corner(k + 1, i + 1), D = corner(k, i + 1);
      const h = onTriangle(x, z, A, B, D) ?? onTriangle(x, z, B, C, D, k === last);
      if (h !== null) return h;
    }
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
