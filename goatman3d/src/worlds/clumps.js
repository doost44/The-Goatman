import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadTexture } from '../textures.js';
import { nearestOnPath } from '../player.js';
import { createScatter } from './scatter.js';

// The savanna's long purple grass: clumps of blades cut from grass1 (blades1-4.png), each
// two crossed cards. Thousands of them, one kind of thing per card in a scatter (scatter.js),
// so only the clumps in view are drawn, nearest first. They lean with the wind, gusts rolling
// across the field (a few lines added to the material's shader).
//
// levels.json "grass": { art, cards, count, radius, width, size: [min, max], tint, sway }

const matrix = new THREE.Matrix4(), turn = new THREE.Quaternion(), at = new THREE.Vector3(), size = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Each clump is tipped about its foot (the wind blows along x) by gusts slowly rising and
// falling across the field and ripples running downwind, each clump a little out of step.
function swaying(mat, time, amount) {
  mat.customProgramCacheKey = () => 'clumps';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime: time, uSway: { value: amount } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uSway;')
      .replace('#include <project_vertex>', `
        vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
        vec3 foot = instanceMatrix[3].xyz;
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

// keepClear: [[x, z, radius], ...] spots with no grass; path: { points, width } likewise;
// skip(x, z): anywhere else with none (the river).
export async function buildClumps(d, heightAt, r, keepClear, path, skip = () => false) {
  const clear = (x, z) => keepClear.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr)
    || nearestOnPath(path.points, x, z).d < path.width / 2 + 0.3 || skip(x, z);
  const scatter = createScatter({ reach: Infinity }); // the fog is far off: all the grass in view
  const time = { value: 0 };

  for (let art = 1; art <= d.cards; art++) {
    const map = await loadTexture(`${d.art}${art}.png`);
    const w = d.width, h = (d.width * map.image.height) / map.image.width;
    const card = new THREE.PlaneGeometry(w, h).translate(0, h / 2 - 0.05, 0);
    const geo = mergeGeometries([card, card.clone().rotateY(Math.PI / 2)]);
    const normal = geo.attributes.normal;
    for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0); // lit like the ground they grow from
    const mat = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, color: new THREE.Color(...d.tint) });
    const kind = scatter.kind(geo, swaying(mat, time, d.sway));
    for (let i = Math.round(d.count / d.cards); i > 0; i--) {
      let x, z;
      do {
        const a = r() * Math.PI * 2, dist = Math.sqrt(r()) * d.radius;
        x = Math.cos(a) * dist;
        z = Math.sin(a) * dist;
      } while (clear(x, z));
      turn.setFromAxisAngle(UP, r() * Math.PI);
      size.setScalar(d.size[0] + r() * (d.size[1] - d.size[0]));
      scatter.add(kind, matrix.compose(at.set(x, heightAt(x, z), z), turn, size));
    }
  }

  return {
    meshes: scatter.done(),
    scatter, // its update(camera) picks the clumps in view, once the camera is placed
    update(t) {
      time.value = t;
    },
  };
}
