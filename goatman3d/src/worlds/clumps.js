import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadTexture } from '../textures.js';
import { nearestOnPath } from '../player.js';

// The savanna's long purple grass: clumps of blades cut from grass1 (blades1-4.png), each
// two crossed cards. Thousands of them, drawn as one InstancedMesh per card. Every frame
// the clumps near the camera lean with the wind, gusts rolling across the field.
//
// levels.json "grass": { art, cards, count, radius, width, size: [min, max], tint, sway, near }

const dummy = new THREE.Object3D();
dummy.rotation.order = 'ZYX'; // turned about its stem first, then tipped by the wind (it blows along x)

// keepClear: [[x, z, radius], ...] spots with no grass; path: { points, width } likewise.
export async function buildClumps(d, heightAt, r, keepClear, path) {
  const meshes = [];
  const clumps = []; // { mesh, i, x, y, z, yaw, size, phase }
  const clear = (x, z) => keepClear.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr)
    || nearestOnPath(path.points, x, z).d < path.width / 2 + 0.3;

  for (let art = 1; art <= d.cards; art++) {
    const map = await loadTexture(`${d.art}${art}.png`);
    const w = d.width, h = (d.width * map.image.height) / map.image.width;
    const card = new THREE.PlaneGeometry(w, h).translate(0, h / 2 - 0.05, 0);
    const geo = mergeGeometries([card, card.clone().rotateY(Math.PI / 2)]);
    const normal = geo.attributes.normal;
    for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0); // lit like the ground they grow from
    const count = Math.round(d.count / d.cards);
    const mat = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, color: new THREE.Color(...d.tint) });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false; // spread over the whole level
    meshes.push(mesh);
    for (let i = 0; i < count; i++) {
      let x, z;
      do {
        const a = r() * Math.PI * 2, dist = Math.sqrt(r()) * d.radius;
        x = Math.cos(a) * dist;
        z = Math.sin(a) * dist;
      } while (clear(x, z));
      const clump = { mesh, i, x, y: heightAt(x, z), z, yaw: r() * Math.PI, size: d.size[0] + r() * (d.size[1] - d.size[0]), phase: r() * 2 };
      clumps.push(clump);
      place(clump, 0);
    }
  }

  function place(c, tilt) {
    dummy.position.set(c.x, c.y, c.z);
    dummy.rotation.set(0, c.yaw, -tilt);
    dummy.scale.setScalar(c.size);
    dummy.updateMatrix();
    c.mesh.setMatrixAt(c.i, dummy.matrix);
  }

  return {
    meshes,
    update(t, eye) {
      for (const c of clumps) {
        if (Math.abs(c.x - eye.x) > d.near || Math.abs(c.z - eye.z) > d.near) continue; // far ones stay still
        const gust = 0.5 + 0.5 * Math.sin(t * 0.3 - c.x * 0.015); // slowly rising and falling
        const wave = Math.sin(t * 1.7 - c.x * 0.12 + c.phase); // ripples running downwind
        place(c, d.sway * (0.3 + 0.7 * gust) * (0.65 + 0.35 * wave));
      }
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
