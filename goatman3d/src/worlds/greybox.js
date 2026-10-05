import * as THREE from 'three';
import { buildTerrain } from '../terrain.js';
import { noiseTexture, rng } from '../textures.js';

// Grey-box version of a level, built only from levels.json: the ground, the path
// corridor, gates at the exits and stand-ins for the creatures. Enough to walk the
// whole story end to end before the painted levels replace it.

export async function buildGreybox(def) {
  const group = new THREE.Group();
  const ground = [];
  const colliders = [];
  const actors = {};
  const r = rng(7);

  const groundMat = new THREE.MeshLambertMaterial({ map: noiseTexture(def.terrain.color, 30, 16, 1, [1, 1]), flatShading: true });
  const { mesh, heightAt } = buildTerrain(def.terrain, groundMat);
  group.add(mesh);
  ground.push(mesh);

  const grey = new THREE.MeshLambertMaterial({ color: 0x77736e, flatShading: true });
  const post = (x, z, radius, height, mat = grey) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.8, radius, height, 6), mat);
    m.position.set(x, heightAt(x, z) + height / 2 - 0.2, z);
    group.add(m);
    colliders.push({ kind: 'circle', x, z, r: radius });
    return m;
  };

  // A corridor: posts along both sides of the path, and a collider that keeps you on it.
  if (def.path) {
    const { points, width } = def.path;
    colliders.push({ kind: 'path', points, width });
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len, nz = (bx - ax) / len; // sideways
      for (let s = 0; s < len; s += 2.6) {
        for (const side of [-1, 1]) {
          const off = width / 2 + 0.4 + r() * 1.5;
          const x = ax + ((bx - ax) * s) / len + nx * off * side;
          const z = az + ((bz - az) * s) / len + nz * off * side;
          post(x, z, 0.35 + r() * 0.4, 6 + r() * 8);
        }
      }
    }
  }

  if (def.bounds) colliders.push({ kind: 'ring', x: 0, z: 0, r: def.bounds });

  // Gates: two tall posts with a pale glow between them at every exit.
  const glow = new THREE.MeshBasicMaterial({ color: 0xfff0d8, transparent: true, opacity: 0.5, fog: false });
  for (const it of def.interactions ?? []) {
    if (it.type !== 'exit') continue;
    const [x, , z] = it.at;
    post(x - 2.2, z, 0.8, 12);
    post(x + 2.2, z, 0.8, 12);
    const light = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 8), glow);
    light.position.set(x, heightAt(x, z) + 4, z);
    group.add(light);
  }

  // Landmarks in the savanna.
  if (def.tree) post(def.tree[0], def.tree[1], 1.2, 14, new THREE.MeshLambertMaterial({ color: 0x2aa6a0, flatShading: true }));
  if (def.pool) {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(3, 10), new THREE.MeshBasicMaterial({ color: 0x5a2a9a }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(def.pool[0], heightAt(def.pool[0], def.pool[1]) + 0.05, def.pool[1]);
    group.add(pool);
  }

  if (def.walkingThing) {
    actors.walkingThing = standIn(def.walkingThing, heightAt, colliders);
    group.add(actors.walkingThing.group);
  }

  return {
    group, ground, colliders, actors, heightAt,
    update(dt, t) { for (const a of Object.values(actors)) a.update?.(dt, t); },
  };
}

// A pale box on two very long thin legs that wanders slowly round its home.
function standIn({ home, wander, height }, heightAt, colliders) {
  const group = new THREE.Group();
  const pale = new THREE.MeshLambertMaterial({ color: 0xf2dde0, flatShading: true });
  const red = new THREE.MeshLambertMaterial({ color: 0xc23a4e, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 3.2), pale);
  body.position.y = height - 1;
  group.add(body);
  const legs = [-0.8, 0.8].map((x) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, height - 2, 5), red);
    leg.position.set(x, (height - 2) / 2, 0);
    group.add(leg);
    return leg;
  });
  const collider = { kind: 'circle', x: home[0], z: home[2], r: 1.2 };
  colliders.push(collider);
  group.position.set(home[0], heightAt(home[0], home[2]), home[2]);

  const target = new THREE.Vector3().copy(group.position);
  let wait = 2;
  let moving = false;
  const thing = {
    group,
    height,
    talkPoint: new THREE.Vector3(),
    stopped: false,
    update(dt, t) {
      legs.forEach((leg, i) => { leg.rotation.x = moving ? Math.sin(t * 1.4 + i * Math.PI) * 0.12 : 0; });
      moving = false;
      if (!thing.stopped && wander > 0) {
        const to = target.clone().sub(group.position).setY(0);
        if (to.length() < 1) {
          wait -= dt;
          if (wait <= 0) {
            const a = Math.random() * Math.PI * 2, d = Math.random() * wander;
            target.set(home[0] + Math.cos(a) * d, 0, home[2] + Math.sin(a) * d);
            wait = 2 + Math.random() * 4;
          }
        } else {
          moving = true;
          to.normalize();
          group.position.addScaledVector(to, dt * 1.6);
          group.rotation.y = Math.atan2(to.x, to.z);
        }
        group.position.y = heightAt(group.position.x, group.position.z);
      }
      collider.x = group.position.x;
      collider.z = group.position.z;
      thing.talkPoint.copy(group.position).setY(group.position.y + height * 0.5);
    },
  };
  thing.update(0, 0);
  return thing;
}
