import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadTexture, rng } from '../textures.js';

// The savanna's long purple grass: clumps of blades cut from grass1 (blades1-4.png), each
// two crossed cards, one InstancedMesh per card. The land is far too big to hold every clump,
// so they are made a square at a time as the camera comes near (each square from its own
// seed, so it grows back the same) and forgotten again far behind it. Each frame the clumps
// in view within `reach` are drawn, nearest first; over the last part of the reach they
// shrink away into the ground, so there is no hard line where the grass ends. On the marsh
// the grass is the painting's blue, taller and thicker (the lowcountry's salt marsh grass).
// They lean with the wind, gusts rolling across the land (a few lines added to the shader).
//
// levels.json "grass": { art, cards, density (clumps a square metre), cell (metres a square),
//   reach, width, size: [min, max], tint, sway, marsh: { tint, size, density } (times the usual) }

const STRIDE = 8; // numbers per clump: x, y, z, turn, size, r, g, b

// Each clump is tipped about its foot (the wind blows along x) by gusts slowly rising and
// falling across the field and ripples running downwind, each clump a little out of step,
// and shrunk to nothing near the edge of the reach.
function swaying(mat, uniforms) {
  mat.customProgramCacheKey = () => 'clumps';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uSway, uReach;')
      .replace('#include <project_vertex>', `
        vec3 foot = instanceMatrix[3].xyz;
        float away = length(foot.xz - cameraPosition.xz);
        vec4 mvPosition = instanceMatrix * vec4(transformed * (1.0 - smoothstep(uReach * 0.7, uReach, away)), 1.0);
        float phase = fract(sin(dot(foot.xz, vec2(12.9898, 78.233))) * 43758.5453) * 2.0;
        float gust = 0.5 + 0.5 * sin(uTime * 0.3 - foot.x * 0.015);
        float wave = sin(uTime * 1.7 - foot.x * 0.12 + phase);
        float tilt = uSway * (0.3 + 0.7 * gust) * (0.65 + 0.35 * wave);
        vec2 up = mvPosition.xy - foot.xy;
        mvPosition.xy = foot.xy + vec2(up.x * cos(tilt) + up.y * sin(tilt), up.y * cos(tilt) - up.x * sin(tilt));
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  return mat;
}

// clear(x, z): true where no grass grows (water, the path, under trees); marsh(x, z): 0..1.
export async function buildClumps(d, heightAt, clear, marsh = () => 0) {
  const uniforms = { uTime: { value: 0 }, uSway: { value: d.sway }, uReach: { value: d.reach } };
  const C = d.cell ?? 32;
  const most = Math.ceil((Math.PI * (d.reach + C) ** 2 * d.density * (d.marsh?.density ?? 1)) / d.cards);
  const kinds = [];
  for (let art = 1; art <= d.cards; art++) {
    const map = await loadTexture(`${d.art}${art}.png`);
    const w = d.width, h = (d.width * map.image.height) / map.image.width;
    const card = new THREE.PlaneGeometry(w, h).translate(0, h / 2 - 0.05, 0);
    const geo = mergeGeometries([card, card.clone().rotateY(Math.PI / 2)]);
    const normal = geo.attributes.normal;
    for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0); // lit like the ground they grow from
    const mat = swaying(new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }), uniforms);
    const mesh = new THREE.InstancedMesh(geo, mat, most);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(most * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // each clump is tested instead
    mesh.count = 0;
    kinds.push({ mesh, height: h });
  }

  // A square's clumps, the same every time it is made.
  const tint = new THREE.Color(), blue = new THREE.Color();
  function grow(ix, iz) {
    const r = rng((ix * 73856093) ^ (iz * 19349663) ^ 0x5bd1e995);
    const out = Array.from({ length: kinds.length }, () => []);
    const x0 = ix * C, z0 = iz * C;
    const wet = marsh(x0 + C / 2, z0 + C / 2);
    const n = Math.round(C * C * d.density * (1 + ((d.marsh?.density ?? 1) - 1) * wet));
    for (let i = 0; i < n; i++) {
      const x = x0 + r() * C, z = z0 + r() * C, k = Math.floor(r() * kinds.length), turn = r() * Math.PI;
      let size = d.size[0] + r() * (d.size[1] - d.size[0]);
      if (clear(x, z)) continue;
      const m = marsh(x, z);
      size *= 1 + ((d.marsh?.size ?? 1) - 1) * m;
      tint.setRGB(...d.tint).lerp(blue.setRGB(...(d.marsh?.tint ?? d.tint)), m);
      out[k].push(x, heightAt(x, z), z, turn, size, tint.r, tint.g, tint.b);
    }
    return { x: x0 + C / 2, z: z0 + C / 2, kinds: out.map((list) => Float32Array.from(list)) };
  }

  const cells = new Map();
  const frustum = new THREE.Frustum(), seen = new THREE.Matrix4(), ball = new THREE.Sphere();
  const lastView = new THREE.Matrix4(), lastLens = new THREE.Matrix4();
  let lastReach = -1;

  function refill(camera) {
    const reach = uniforms.uReach.value, px = camera.position.x, pz = camera.position.z;
    frustum.setFromProjectionMatrix(seen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const near = [];
    const span = Math.ceil(reach / C) + 1, cx = Math.floor(px / C), cz = Math.floor(pz / C);
    for (let iz = cz - span; iz <= cz + span; iz++) {
      for (let ix = cx - span; ix <= cx + span; ix++) {
        const d2 = ((ix + 0.5) * C - px) ** 2 + ((iz + 0.5) * C - pz) ** 2;
        if (d2 > (reach + C) ** 2) continue;
        const key = `${ix},${iz}`;
        if (!cells.has(key)) cells.set(key, grow(ix, iz));
        const cell = cells.get(key);
        cell.used = true;
        near.push([d2, cell]);
      }
    }
    near.sort((a, b) => a[0] - b[0]);
    for (const k of kinds) k.mesh.count = 0;
    for (const [, cell] of near) {
      cell.kinds.forEach((list, k) => {
        const { mesh, height } = kinds[k];
        const m = mesh.instanceMatrix.array, c = mesh.instanceColor.array;
        for (let j = 0; j < list.length && mesh.count < most; j += STRIDE) {
          const x = list[j], y = list[j + 1], z = list[j + 2], s = list[j + 4];
          if ((x - px) ** 2 + (z - pz) ** 2 > reach * reach) continue;
          ball.center.set(x, y + height * s * 0.5, z);
          ball.radius = height * s;
          if (!frustum.intersectsSphere(ball)) continue;
          const cos = Math.cos(list[j + 3]) * s, sin = Math.sin(list[j + 3]) * s, i = mesh.count++;
          m.set([cos, 0, -sin, 0, 0, s, 0, 0, sin, 0, cos, 0, x, y, z, 1], i * 16);
          c.set([list[j + 5], list[j + 6], list[j + 7]], i * 3);
        }
      });
    }
    for (const { mesh } of kinds) {
      mesh.visible = mesh.count > 0;
      for (const [buffer, size] of [[mesh.instanceMatrix, 16], [mesh.instanceColor, 3]]) {
        buffer.clearUpdateRanges();
        buffer.addUpdateRange(0, Math.max(1, mesh.count) * size);
        buffer.needsUpdate = true;
      }
    }
    // Forget the squares far behind (they grow back the same).
    if (cells.size > (span * 2 + 1) ** 2 * 2) {
      for (const [key, cell] of cells) if (!cell.used) cells.delete(key);
    }
    for (const cell of cells.values()) cell.used = false;
  }

  return {
    meshes: kinds.map((k) => k.mesh),
    get reach() { return uniforms.uReach.value; },
    set reach(v) { uniforms.uReach.value = v; },
    // Once the camera is placed for the frame: refills if it has moved, turned or zoomed.
    update(camera) {
      camera.updateMatrixWorld();
      if (lastView.equals(camera.matrixWorld) && lastLens.equals(camera.projectionMatrix) && lastReach === uniforms.uReach.value) return;
      lastView.copy(camera.matrixWorld);
      lastLens.copy(camera.projectionMatrix);
      lastReach = uniforms.uReach.value;
      refill(camera);
    },
    tick(t) {
      uniforms.uTime.value = t;
    },
  };
}
