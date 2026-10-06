import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadTexture, canvas, crunchy, rng } from '../textures.js';
import { limb } from './tealtree.js';

// The river's bog (river.js): reeds and dark tussocks along its banks, swaying in the
// wind; scum and weed floating slowly down it; dead branches and stumps sticking out of the
// water; and, as the dusk falls, low mist drifting over it. Only a few meshes: the reeds and
// tussocks instanced, the wood merged, the scum and the mist one mesh each.
//
// levels.json "river".bog: { reeds, tussocks, tussock (its art: the blue grass strokes),
//   scum, branches, stumps, mist (how many of each), reach (none further out than this
//   from the middle of the level: they would be behind the treeline), seed }

const dummy = new THREE.Object3D();

// Two crossed cards standing on the ground, lit like the ground (like clumps.js).
function cards(w, h) {
  const card = new THREE.PlaneGeometry(w, h).translate(0, h / 2 - 0.1, 0);
  const geo = mergeGeometries([card, card.clone().rotateY(Math.PI / 2)]);
  const normal = geo.attributes.normal;
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0);
  return geo;
}

// Reeds and tussocks lean with the wind, their tips most (a few lines added to the
// material's shader, after each one is put in place).
function swaying(mat, time, amount) {
  mat.customProgramCacheKey = () => 'reeds';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime: time, uSway: { value: amount } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uSway;')
      .replace('#include <project_vertex>', `
        vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
        float bend = uSway * position.y * position.y;
        mvPosition.x += bend * sin(uTime * 1.3 + mvPosition.x * 0.15 + mvPosition.z * 0.1);
        mvPosition.z += bend * 0.5 * sin(uTime * 0.9 + mvPosition.z * 0.13);
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  return mat;
}

// Reeds: thin dark stalks in the painting's maroons and its grass strokes' blue, a few
// leaves curving off them and some with a seed head.
function reedPaint(r) {
  const c = canvas(64, 128);
  const g = c.getContext('2d');
  const colours = ['#12060c', '#1c0a14', '#28101c', '#1a1440', '#24205a'];
  for (let i = 0; i < 16; i++) {
    const x0 = 3 + r() * 58, lean = (r() - 0.5) * 14, top = 4 + r() * 70, w = r() < 0.3 ? 2 : 1;
    g.fillStyle = colours[Math.floor(r() * colours.length)];
    for (let y = 127; y > top; y--) {
      const k = (127 - y) / (127 - top);
      g.fillRect(Math.round(x0 + lean * k * k), y, w + (k < 0.4 ? 1 : 0), 1);
    }
    if (r() < 0.5) { // a leaf
      const from = 127 - r() * 30, len = 30 + r() * 40, dir = r() < 0.5 ? -1 : 1;
      for (let s = 0; s < len; s++) g.fillRect(Math.round(x0 + dir * (s / len) ** 2 * 14), Math.round(from - s), 1, 1);
    }
    if (r() < 0.35) { // a seed head, with the stalk's tip sticking out of it
      const hx = Math.round(x0 + lean) - 1, hy = Math.round(top) + 4;
      g.fillStyle = '#3a140c';
      g.fillRect(hx, hy, 2 + w, 10 + Math.floor(r() * 5));
      g.fillStyle = '#5a2414';
      g.fillRect(hx, hy + 1, 1, 8);
    }
  }
  return crunchy(c);
}

// Scum: a ragged patch of murky green-brown weed with rusty and pale flecks.
function scumPaint(r) {
  const c = canvas(32, 32);
  const g = c.getContext('2d');
  for (let i = 0; i < 150; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 13;
    g.fillStyle = ['#2a2414', '#33301a', '#4a2014', '#3a1830', '#5a4a2a', '#8a6a5a'][Math.floor(r() ** 1.6 * 6)];
    g.fillRect(Math.round(16 + Math.cos(a) * d), Math.round(16 + Math.sin(a) * d * 0.8), 1 + Math.floor(r() * 3), 1 + Math.floor(r() * 2));
  }
  return crunchy(c);
}

// Dead wood: grey-brown with dark splits along the grain.
function barkPaint(r) {
  const c = canvas(32, 64);
  const g = c.getContext('2d');
  g.fillStyle = '#3a2c2e';
  g.fillRect(0, 0, 32, 64);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = ['#1a1216', '#2a1e22', '#4a3a3a', '#5a4848'][Math.floor(r() * 4)];
    g.fillRect(Math.floor(r() * 32), Math.floor(r() * 64), 1, 3 + Math.floor(r() * 12));
  }
  return crunchy(c, [1, 1]);
}

// Mist: a few soft pale puffs run together, see-through at the edges.
function mistPaint(r) {
  const c = canvas(64, 32);
  const g = c.getContext('2d');
  for (let i = 0; i < 6; i++) {
    const x = 14 + r() * 36, y = 13 + r() * 6, rad = 6 + r() * 7;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(232, 190, 205, 0.45)');
    grad.addColorStop(1, 'rgba(232, 190, 205, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 32);
  }
  const t = crunchy(c);
  t.magFilter = THREE.LinearFilter; // mist is soft even here
  return t;
}

export async function buildBog(d, course, heightAt) {
  const r = rng(d.seed ?? 8);
  const { edge, R } = course;
  const time = { value: 0 };
  const meshes = [];
  // A random spot `from` to `to` metres out from the middle (either side), not behind the treeline.
  const spot = (from, to) => {
    for (;;) {
      const p = course.at(r() * course.length, (r() < 0.5 ? -1 : 1) * (from + r() * (to - from)));
      if (Math.hypot(p.x, p.z) < d.reach) return p;
    }
  };

  // Reeds in clumps at the water's edge, some standing in it; dark tussocks up the banks.
  const reeds = new THREE.InstancedMesh(cards(1.3, 2.2), swaying(new THREE.MeshLambertMaterial({ map: reedPaint(r), alphaTest: 0.5, side: THREE.DoubleSide }), time, 0.035), d.reeds);
  let clump;
  for (let i = 0; i < d.reeds; i++) {
    if (i % 5 === 0) clump = spot(edge - 1.2, edge + 1.6); // five to a clump
    const x = clump.x + (r() - 0.5) * 2.4, z = clump.z + (r() - 0.5) * 2.4;
    dummy.position.set(x, heightAt(x, z), z);
    dummy.rotation.set(0, r() * Math.PI, 0);
    dummy.scale.set(0.8 + r() * 0.4, 0.7 + r() * 0.6, 0.8 + r() * 0.4);
    dummy.updateMatrix();
    reeds.setMatrixAt(i, dummy.matrix);
  }
  const art = await loadTexture(d.tussock);
  const tw = 1.6, th = (tw * art.image.height) / art.image.width;
  const tussocks = new THREE.InstancedMesh(cards(tw, th), swaying(new THREE.MeshLambertMaterial({ map: art, alphaTest: 0.5, side: THREE.DoubleSide, color: new THREE.Color(0.42, 0.3, 0.48) }), time, 0.05), d.tussocks);
  for (let i = 0; i < d.tussocks; i++) {
    const p = spot(edge + 0.4, R + 2);
    dummy.position.set(p.x, heightAt(p.x, p.z), p.z);
    dummy.rotation.set(0, r() * Math.PI, 0);
    dummy.scale.setScalar(0.7 + r() * 0.7);
    dummy.updateMatrix();
    tussocks.setMatrixAt(i, dummy.matrix);
  }
  meshes.push(reeds, tussocks);

  // Dead wood: stumps broken off in the shallows and on the banks, and branches half sunk
  // in the water with their ends sticking up out of it.
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const wood = [];
  for (let i = 0; i < d.stumps; i++) {
    const p = spot(r() * edge, edge + 2), y = heightAt(p.x, p.z), h = 0.7 + r() * 1.3, lean = (r() - 0.5) * 0.4;
    const stump = new THREE.CylinderGeometry(0.22 + r() * 0.12, 0.35 + r() * 0.15, h, 6, 1);
    const pos = stump.attributes.position;
    const jag = Array.from({ length: 7 }, () => (r() - 0.6) * 0.4); // broken off raggedly: a height per corner, and the middle
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      const corner = x * x + z * z < 1e-6 ? 6 : (Math.round(Math.atan2(z, x) / (Math.PI / 3)) + 6) % 6;
      if (y > 0) pos.setY(k, y + jag[corner]);
      pos.setX(k, x + lean * (pos.getY(k) + h / 2));
    }
    wood.push(stump.rotateY(r() * Math.PI).translate(p.x, y + h / 2 - 0.25, p.z));
  }
  for (let i = 0; i < d.branches; i++) {
    const p = spot(r() * edge * 0.8, edge * 0.9), top = p.level - course.water;
    const a = r() * Math.PI * 2, len = 2.5 + r() * 3, dx = Math.cos(a), dz = Math.sin(a);
    const at = (k, up, side = 0) => V(p.x + dx * len * k - dz * side, top + up, p.z + dz * len * k + dx * side);
    const branch = limb([at(0, -0.5), at(0.4, 0.1, 0.2), at(0.75, 0.6, -0.1), at(1, 1 + r() * 0.8, 0.2)], 0.16, 0.04, 5);
    const twig = limb([branch.curve.getPointAt(0.55), at(0.7, 0.9 + r() * 0.6, 0.9), at(0.8, 1.4 + r() * 0.5, 1.3)], 0.07, 0.02, 4);
    wood.push(branch.geo, twig.geo);
  }
  const woodGeo = mergeGeometries(wood);
  wood.forEach((g) => g.dispose());
  meshes.push(new THREE.Mesh(woodGeo, new THREE.MeshLambertMaterial({ map: barkPaint(r), flatShading: true })));

  // Scum floating slowly down the river, turning as it goes.
  const scum = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: scumPaint(r), alphaTest: 0.5 }), d.scum);
  const patches = Array.from({ length: d.scum }, () => ({
    s: r() * course.length, across: (r() - 0.5) * 1.6 * edge, spin: r() * 6, turn: (r() - 0.5) * 0.3, size: 0.8 + r() * 1.8,
  }));
  meshes.push(scum);

  // Mist: cards over the water that always face the camera (turned to it in the shader),
  // drifting slowly about, showing as the dusk falls.
  const mist = new THREE.BufferGeometry();
  const centres = [], corners = [], uvs = [], index = [];
  for (let i = 0; i < d.mist; i++) {
    const p = spot(0, edge * 0.8), w = 7 + r() * 7, h = 1.4 + r() * 1.2, y = p.level - course.water + 0.3 + r() * 0.6;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      centres.push(p.x, y, p.z);
      corners.push((cx * w) / 2, (cy * h) / 2);
      uvs.push((cx + 1) / 2, (cy + 1) / 2);
    }
    index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  }
  mist.setAttribute('position', new THREE.Float32BufferAttribute(centres, 3));
  mist.setAttribute('corner', new THREE.Float32BufferAttribute(corners, 2));
  mist.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  mist.setIndex(index);
  const mistMat = new THREE.MeshBasicMaterial({ map: mistPaint(r), transparent: true, depthWrite: false, opacity: 0 });
  mistMat.customProgramCacheKey = () => 'mist';
  mistMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 corner;\nuniform float uTime;')
      .replace('#include <project_vertex>', `
        transformed.x += 2.5 * sin(uTime * 0.05 + position.z * 0.1);
        transformed.z += 2.5 * cos(uTime * 0.04 + position.x * 0.1);
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        mvPosition.xy += corner;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  const mistMesh = new THREE.Mesh(mist, mistMat);
  mistMesh.frustumCulled = false; // its corners are only put out in the shader
  mistMesh.renderOrder = 1; // over the water
  meshes.push(mistMesh);

  return {
    meshes,
    // t: seconds; dim: the dusk darkening (1 = not at all); dusk: 0..1 how far it has fallen.
    update(dt, t, dim, dusk) {
      time.value = t;
      for (const [i, p] of patches.entries()) {
        p.s = (p.s + dt * course.flow) % course.length;
        const at = course.at(p.s, p.across);
        dummy.position.set(at.x, at.level - course.water + 0.05, at.z);
        dummy.rotation.set(0, p.spin + t * p.turn, 0);
        dummy.scale.setScalar(p.size);
        dummy.updateMatrix();
        scum.setMatrixAt(i, dummy.matrix);
      }
      scum.instanceMatrix.needsUpdate = true;
      mistMat.opacity = 0.5 * THREE.MathUtils.smoothstep(dusk, 0.25, 1);
      mistMat.color.setScalar(dim);
      mistMesh.visible = mistMat.opacity > 0.01;
    },
  };
}
