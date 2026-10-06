import * as THREE from 'three';
import { sfx } from '../sfx.js';

// Splashes on water (the savanna's river, the forest's ponds): a ring spreading on the
// surface and a few drops thrown up, with a splash heard from where it is. surface(x, z)
// is the water's height there, or null where there is none.
// ring and drop: their colours. splash(x, z, size, sound): size about 0.4 for his hoof,
// 0.7 a pebble, 1.5 the Walking Thing's foot.

const clamp = THREE.MathUtils.clamp;

export function createSplashes({ surface, camera, r, ring = 0xc88898, drop = 0xd8a8b4 }) {
  const group = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(0.8, 1, 18).rotateX(-Math.PI / 2);
  const rings = Array.from({ length: 10 }, () => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: ring, transparent: true, depthWrite: false }));
    m.visible = false;
    group.add(m);
    return m;
  });
  const DROPS = 80;
  const dropPos = new Float32Array(DROPS * 3).fill(-999);
  const dropVel = new Float32Array(DROPS * 3), dropFloor = new Float32Array(DROPS);
  const dropGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
  const drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({ color: drop, size: 0.12 }));
  drops.frustumCulled = false;
  group.add(drops);
  let nextDrop = 0, nextRing = 0;

  // Left (-1) to right (1) of the camera, and how loud (quieter further off).
  const right = new THREE.Vector3(), to = new THREE.Vector3();
  function heard(x, z) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    to.set(x - camera.position.x, 0, z - camera.position.z);
    const dist = to.length();
    return { pan: clamp(to.dot(right) / (dist || 1), -1, 1), loud: clamp(1.2 - dist / 40, 0, 1) };
  }
  function ripple(x, y, z, size) {
    const m = rings[nextRing++ % rings.length];
    m.position.set(x, y + 0.04, z);
    m.userData = { life: 0, size };
    m.visible = true;
  }
  function splash(x, z, size = 0.5, sound = true) {
    const y = surface(x, z);
    if (y === null) return;
    ripple(x, y, z, size);
    for (let n = 0; n < 3 + size * 5; n++) {
      const i = nextDrop++ % DROPS, a = r() * Math.PI * 2, out = (0.6 + r()) * size;
      dropPos.set([x, y + 0.05, z], i * 3);
      dropVel.set([Math.cos(a) * out, (2 + r() * 2.5) * Math.sqrt(size), Math.sin(a) * out], i * 3);
      dropFloor[i] = y;
    }
    const s = heard(x, z);
    if (sound && s.loud > 0) sfx.splash(s.pan, s.loud, size);
  }

  return {
    group,
    splash,
    ripple,
    heard,
    // dim: how much the rings show (the savanna's dusk darkens them).
    update(dt, dim = 1) {
      for (const m of rings) {
        if (!m.visible) continue;
        m.userData.life += dt / (0.7 + 0.4 * m.userData.size);
        const k = m.userData.life;
        m.scale.setScalar((0.3 + 1.7 * k) * m.userData.size);
        m.material.opacity = 0.55 * (1 - k) * dim;
        if (k >= 1) m.visible = false;
      }
      for (let i = 0; i < DROPS; i++) {
        if (dropPos[i * 3 + 1] < -900) continue;
        dropVel[i * 3 + 1] -= 12 * dt;
        for (let a = 0; a < 3; a++) dropPos[i * 3 + a] += dropVel[i * 3 + a] * dt;
        if (dropPos[i * 3 + 1] < dropFloor[i]) dropPos[i * 3 + 1] = -999;
      }
      dropGeo.attributes.position.needsUpdate = true;
    },
  };
}
