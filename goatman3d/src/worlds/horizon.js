import * as THREE from 'three';
import { loadImage, toCanvas, crunchy, grade } from '../textures.js';

// Things far away all round: a painted sky dome, stars, and a ring of painted shapes on
// the horizon. The dome and the stars move with the camera (builders do that in update),
// so they are always as far away.

// A painting as a dome over everything (the field's BACKGROUND.png, the savanna's crimson
// sky from its video), melting into the fog colour at the horizon. A zenith colour hides
// the painting where it gathers into a point overhead.
// levels.json: { texture, radius, repeat (even), grade?, zenith? }
export async function buildSkyDome(d, fogColor) {
  const c = toCanvas(await loadImage(d.texture));
  if (d.grade) grade(c, d.grade);
  const g = c.getContext('2d');
  if (d.zenith) {
    const top = g.createLinearGradient(0, 0, 0, c.height * 0.35);
    top.addColorStop(0, d.zenith);
    top.addColorStop(1, `${d.zenith}00`);
    g.fillStyle = top;
    g.fillRect(0, 0, c.width, c.height * 0.35);
  }
  const fade = g.createLinearGradient(0, 0, 0, c.height);
  fade.addColorStop(0, `${fogColor}00`);
  fade.addColorStop(0.55, `${fogColor}00`);
  fade.addColorStop(0.92, fogColor);
  fade.addColorStop(1, fogColor);
  g.fillStyle = fade;
  g.fillRect(0, 0, c.width, c.height);
  const tex = crunchy(c);
  tex.wrapS = THREE.MirroredRepeatWrapping;
  tex.repeat.x = d.repeat;
  // the top half of a sphere, and a little below the horizon
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(d.radius, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2 + 0.15),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -10; // drawn first, behind everything
  return dome;
}

// Stars (nsky.png) on a dome just inside the sky, added over it, so the black between
// them adds nothing. The painting is laid on the dome as if looked at from straight below,
// so the stars stay dots everywhere (wrapped round it like the sky, they streak toward the
// top), and they fade out toward the horizon. Set material.opacity to show them.
// levels.json: { texture, radius, repeat (times the painting fits from overhead to the horizon) }
export async function buildStars(d) {
  const tex = crunchy(toCanvas(await loadImage(d.texture)));
  tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
  const geo = new THREE.SphereGeometry(d.radius, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const up = pos.getY(i) / d.radius;
    const out = (Math.acos(up) / (Math.PI / 2)) * d.repeat; // how far from overhead, in paintings
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    uv.setXY(i, Math.cos(a) * out, Math.sin(a) * out);
    const fade = THREE.MathUtils.smoothstep(up, 0.03, 0.5); // none at the horizon
    colors.push(fade, fade, fade);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex, vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  }));
  dome.renderOrder = -9; // just after the sky
  return dome;
}

// A ring of painted shapes all round the horizon from one strip of a painting: the field's
// dark peaks (GROUND.png), the savanna's treeline (trreeline.png). The strip's skyline (its
// top painted pixel in each column) becomes the ridge of the ring, with a front and a back
// slope so the sun picks out their faces. It is mirrored every other repeat so there is
// no seam, and the sky above the paint is cut out.
//
// levels.json: { texture, crop: [from, to] (part of the strip's width to use), radius, depth,
//   height, ground (how far out the ground is sampled), columns, repeat (even), haze,
//   gaps: [[x, z, width], ...] (openings in the ring) }
export async function buildSkyline(d, heightAt) {
  const img = await loadImage(d.texture);
  const [from, to] = d.crop ?? [0, 1];
  const c = toCanvas(img, Math.round(from * img.width), 0, Math.round((to - from) * img.width), img.height);
  const g = c.getContext('2d');
  const pixels = g.getImageData(0, 0, c.width, c.height);
  const data = pixels.data;
  // Under the skyline the strip has see-through gaps: fill each column down with its paint.
  for (let x = 0; x < c.width; x++) {
    let last = -1;
    for (let y = 0; y < c.height; y++) {
      const i = (y * c.width + x) * 4;
      if (data[i + 3] > 127) last = i;
      else if (last >= 0) { data.copyWithin(i, last, last + 3); data[i + 3] = 254; }
    }
  }
  g.putImageData(pixels, 0, 0);
  // The highest paint in the strip between two u's (0..1 across it).
  const skyline = (u0, u1) => {
    let top = 0;
    const x0 = Math.floor(Math.min(u0, u1) * (c.width - 1)), x1 = Math.ceil(Math.max(u0, u1) * (c.width - 1));
    for (let x = x0; x <= x1; x++) {
      for (let y = 0; y < c.height; y++) if (data[(y * c.width + x) * 4 + 3] > 127) { top = Math.max(top, 1 - y / c.height); break; }
    }
    return top;
  };
  const n = d.columns;
  const strip = (i) => { // where column i is in the strip, mirrored every other time (an even number of times)
    const s = ((((i % n) + n) % n) / n) * d.repeat;
    return Math.floor(s) % 2 ? 1 - (s % 1) : s % 1;
  };
  // Openings: the angle round the ring and how wide (in radians) each one is.
  const gaps = (d.gaps ?? []).map(([x, z, width]) => [Math.atan2(z, x), width / 2 / d.radius]);
  const open = (a) => gaps.some(([at, half]) => Math.abs(Math.atan2(Math.sin(a - at), Math.cos(a - at))) < half);

  const pos = [], uv = [], index = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const u = strip(i);
    // The ridge clears all the paint on either side of it; the sky above the paint is cut out.
    const top = open(a) ? 0 : Math.max(0.04, skyline(strip(i - 1), u), skyline(u, strip(i + 1)));
    const cos = Math.cos(a), sin = Math.sin(a);
    const base = (rad) => heightAt(cos * Math.min(rad, d.ground), sin * Math.min(rad, d.ground)) - 2;
    // front foot, ridge, back foot
    pos.push(cos * (d.radius - d.depth), base(d.radius - d.depth), sin * (d.radius - d.depth));
    pos.push(cos * d.radius, base(d.radius) + top * d.height, sin * d.radius);
    pos.push(cos * (d.radius + d.depth), base(d.radius + d.depth), sin * (d.radius + d.depth));
    uv.push(u, 0, u, top, u, 0);
    if (i < n) {
      const k = i * 3;
      index.push(k, k + 3, k + 4, k, k + 4, k + 1); // front slope, facing the middle
      index.push(k + 1, k + 4, k + 5, k + 1, k + 5, k + 2); // back slope
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // Hazed a little toward the sky by hand (fog would wash it out entirely).
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = d.haze;
  g.fillRect(0, 0, c.width, c.height);
  const tex = crunchy(c);
  tex.wrapS = THREE.RepeatWrapping;
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, flatShading: true, fog: false, side: THREE.DoubleSide }));
}

// Haze for things seen from much further than the fog reaches (big levels' landmarks and
// far land): the material ignores the scene's fog and is mixed toward `color` by distance
// instead, from `a` at `from` metres to `b` at `to`. With `cut`, nothing is drawn nearer
// than that (on the ground plane): the far land leaves the middle to the terrain chunks.
// color is a THREE.Color the level keeps in step with its fog (it can change, as at dusk).
export function haze(material, { color, from, to, a = 0, b = 0.85, cut = 0 }) {
  const uniforms = {
    uHaze: { value: color }, uHazeRamp: { value: new THREE.Vector4(from, to, a, b) }, uHazeCut: { value: cut },
  };
  material.fog = false;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHazeAt;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHazeAt = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHazeAt;\nuniform vec3 uHaze;\nuniform vec4 uHazeRamp;\nuniform float uHazeCut;')
      .replace('void main() {', 'void main() {\n  if (length(vHazeAt.xz - cameraPosition.xz) < uHazeCut) discard;')
      .replace('#include <fog_fragment>', `#include <fog_fragment>
  float hazeK = smoothstep(uHazeRamp.x, uHazeRamp.y, distance(vHazeAt, cameraPosition));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, mix(uHazeRamp.z, uHazeRamp.w, hazeK));`);
  };
  material.customProgramCacheKey = () => `haze${cut > 0 ? '-cut' : ''}`;
  return uniforms;
}

// The land beyond the terrain chunks, out to the horizon: one coarse grid fixed in the world
// (so it never shifts as he moves), heights from the level's own height function (its rim
// rises into far hills), lit by hand in its vertex colours and hazed toward the fog. Within
// `cut` metres of the camera it isn't drawn: the chunks are there.
// levels.json "horizon": { size (metres across), segments, color, haze: [near, far], sink }
export function buildFarLand(d, height, { center = [0, 0], cut, fogColor, sun }) {
  const geo = new THREE.PlaneGeometry(d.size, d.size, d.segments, d.segments).rotateX(-Math.PI / 2);
  geo.translate(center[0], 0, center[1]);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)) - (d.sink ?? 4));
  geo.computeVertexNormals();
  const base = new THREE.Color(d.color), light = new THREE.Vector3(...sun).normalize(), n = new THREE.Vector3();
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(geo.attributes.normal, i);
    const k = 0.7 + 0.45 * Math.max(0, n.dot(light));
    colors.push(base.r * k, base.g * k, base.b * k);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const [a, b] = d.haze ?? [1, 0.7];
  haze(mat, { color: fogColor, from: cut, to: d.size / 2, a, b, cut });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -5; // after the sky, before the near ground
  return mesh;
}
