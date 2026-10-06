import * as THREE from 'three';

// Things that hang and sway: the willow's tendrils (tealtree.js) and the Spanish moss on the
// live oaks and dead trees (lowcountry.js). Each strand is a ribbon along a smooth curve,
// tapering to a thin tip, with more segments the longer it is, twisting a little as it falls
// so it is never seen only edge-on. In the shader a slow wave travels down each one, the tip
// moving most, and things walking through push them aside.

const UP = new THREE.Vector3(0, 1, 0);

// A willow branch's fall: it leaves the limb at `from` heading `out` (a flat unit vector
// away from the trunk), arcs up and over like water from a fountain, falls, makes a gentle
// S low down and curls its tip back in a little. `drop`: metres from the limb to the tip.
export function fountain(from, out, drop, r) {
  const arc = 0.5 + r() * 0.7, rise = 0.25 + r() * 0.35;
  const at = (o, y) => from.clone().addScaledVector(out, o).addScaledVector(UP, y);
  const s = 0.25 + r() * 0.3; // how far the S swings out and back
  return [
    from.clone(),
    at(arc * 0.45, rise),
    at(arc, rise * 0.4),
    at(arc * 1.15, -drop * 0.3),
    at(arc * 1.1 + s, -drop * 0.62),
    at(arc * 1.1 - s * 0.4, -drop * 0.88),
    at(arc * 1.1 - s * 0.9, -drop),
  ];
}

// Moss's fall: straight down from a branch in a loose, slightly wavering beard.
export function beard(from, drop, r) {
  const sway = () => (r() - 0.5) * 0.3;
  return [0, 0.35, 0.7, 1].map((k) => from.clone().add(new THREE.Vector3(sway() * k, -drop * k, sway() * k)));
}

// The ribbons for a list of strands: { points (along it, from where it hangs), width, out
// (the flat direction its curve bends in), u0, u1 (its column of the paint), seed }.
// Attributes: sway = (how far down it 0..1, seed) for the shader.
export function strandGeometry(list, spacing = 0.4) {
  const pos = [], uv = [], sway = [], index = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3(), flat = new THREE.Vector3(), bend = new THREE.Vector3();
  let n = 0;
  for (const s of list) {
    const curve = new THREE.CatmullRomCurve3(s.points, false, 'centripetal');
    const rows = THREE.MathUtils.clamp(Math.ceil(curve.getLength() / spacing), 3, 16);
    flat.set(-s.out.z, 0, s.out.x); // across the plane it bends in
    const twist = (s.seed - 0.5) * 2.2;
    for (let i = 0; i <= rows; i++) {
      const k = i / rows;
      curve.getPointAt(k, p);
      curve.getTangentAt(k, t);
      bend.crossVectors(t, flat).normalize();
      const a = twist * k;
      side.copy(flat).multiplyScalar(Math.cos(a)).addScaledVector(bend, Math.sin(a));
      const w = (s.width / 2) * (1 - 0.8 * k ** 1.5); // tapering to a thin tip
      pos.push(p.x - side.x * w, p.y - side.y * w, p.z - side.z * w, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      uv.push(s.u0, 1 - k * 0.98, s.u1, 1 - k * 0.98);
      sway.push(k, s.seed, k, s.seed);
      if (i > 0) index.push(n - 2, n, n - 1, n - 1, n, n + 1);
      n += 2;
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

// The wind and the parting, added to a Lambert material's vertex shader. uniforms: uTime,
// and uPush (up to `pushers` things pushing through: x, z in the mesh's space, radius, the
// height of their top). amount: metres the tips swing.
export function swaying(mat, uniforms, { pushers = 0, amount = 1, key = 'strands' } = {}) {
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const push = pushers ? `
        for (int i = 0; i < ${pushers}; i++) {
          vec2 d = transformed.xz - uPush[i].xy;
          float dist = max(length(d), 0.001);
          float k = sway.x * smoothstep(uPush[i].w + 1.0, uPush[i].w - 1.0, transformed.y);
          transformed.xz += d / dist * max(uPush[i].z - dist, 0.0) * k;
        }` : '';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 sway;
        uniform float uTime;
        ${pushers ? `uniform vec4 uPush[${pushers}];` : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 at = transformed;
        #ifdef USE_INSTANCING
          at += instanceMatrix[3].xyz; // each copy out of step with the others
        #endif
        float bend = sway.x * sway.x * ${amount.toFixed(2)}; // the tips swing most
        float gust = 0.6 + 0.4 * sin(uTime * 0.3 + at.x * 0.06);
        float wave = uTime * 0.9 - sway.x * 3.2 + sway.y * 6.28; // a slow wave travelling down it
        transformed.x += bend * gust * (0.8 * sin(wave) + 0.2 * sin(wave * 2.6 + at.z));
        transformed.z += bend * gust * 0.55 * cos(wave * 0.8 + sway.y * 3.0);
        ${push}`);
  };
  return mat;
}
