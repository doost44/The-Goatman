import * as THREE from 'three';
import { buildTerrain, walkPath, drape } from '../terrain.js';
import { loadTexture, canvas, crunchy, glowTexture, rng } from '../textures.js';
import { buildSkyDome, buildStars, buildSkyline } from './horizon.js';
import { buildTealTree } from './tealtree.js';
import { buildClumps } from './clumps.js';
import { createBushes } from '../bushes.js';
import { createWalkingThing } from '../walkingthing.js';

// Level 3, the savanna, from Charlie's layered painting (the savannahg/) and its videos:
// long purple grass swaying under a crimson sky that slowly darkens until nsky's stars come
// through, a dark treeline all round, the teal tree with the pool near it, and the striped
// creatures drifting through the grass. GoatMan arrives on the Walking Thing's back. The
// way on is the path from under the tree to a gap in the treeline, and it only lights up
// once the Walking Thing has been petted.

export async function buildSavanna(def, { scene, camera, player, lights, flag }) {
  const group = new THREE.Group();
  const r = rng(def.seed);

  const floor = await loadTexture(def.terrain.texture, 1);
  const groundMat = new THREE.MeshLambertMaterial({ map: floor, color: new THREE.Color(...def.terrain.tint) });
  const { mesh: ground, heightAt } = buildTerrain(def.terrain, groundMat);

  const sky = await buildSkyDome(def.skyDome, def.fog.color);
  const stars = await buildStars(def.stars);
  const treeline = await buildSkyline(def.treeline, heightAt);
  const tree = await buildTealTree(def.tree, heightAt);
  const pool = await buildPool(def.pool, heightAt);
  const path = await buildPath(def.path, heightAt);
  const exit = buildExit(def.exit, heightAt);
  const [tx, tz] = def.tree.at, [px, pz] = def.pool.at;
  const grass = await buildClumps(def.grass, heightAt, r, [[tx, tz, 2], [px, pz, def.pool.radius + 1]], def.path);
  group.add(ground, sky, stars, treeline, ...tree.meshes, pool.mesh, path, exit.group, ...grass.meshes);

  const edge = { kind: 'ring', x: 0, z: 0, r: def.bounds };
  const poolCollider = { kind: 'circle', x: px, z: pz, r: def.pool.radius - 0.5 };
  const bushes = await createBushes(def.bushes, { heightAt, camera, player, avoid: [edge, ...tree.colliders, poolCollider] });
  const thing = await createWalkingThing(def.walkingThing, { heightAt, camera, player });
  thing.avoid = [{ ...edge, r: def.walkingThing.bounds }, tree.keepOut, { ...poolCollider, r: def.pool.radius + 3 }];
  group.add(bushes.group, thing.group);

  const fog = new THREE.Color(def.fog.color);
  let opened = 0;
  const world = {
    group,
    ground: [ground],
    colliders: [edge, ...tree.colliders, poolCollider, ...bushes.colliders, ...thing.colliders],
    blockers: tree.blockers,
    rockTargets: bushes.targets,
    actors: { walkingThing: thing },
    heightAt,
    time: 0, // seconds in the level: over def.dusk.time the sky, light and fog darken and the stars come out
    update(dt, t) {
      world.time += dt;
      const k = THREE.MathUtils.smoothstep(world.time, 0, def.dusk.time);
      const dim = 1 - (1 - def.dusk.dim) * k;
      sky.material.color.setScalar(dim);
      treeline.material.color.setScalar(dim);
      stars.material.opacity = k * def.dusk.stars;
      scene.fog?.color.copy(fog).multiplyScalar(dim);
      lights.ambient.intensity = def.ambient.intensity * (0.4 + 0.6 * dim);
      lights.sun.intensity = def.sun.intensity * dim;
      sky.position.copy(camera.position); // always as far away
      stars.position.copy(camera.position);
      stars.rotation.y = world.time * 0.004; // the night sky turning, very slowly

      grass.update(t, camera.position);
      bushes.update(dt, dim);
      thing.update(dt);
      pool.update(t, dim);
      opened = flag('petted') ? Math.min(1, opened + dt / 3) : 0; // the way on lights up
      exit.update(t, opened);
    },
  };
  return world;
}

// thepool.png as a small round pool near the tree: the painting's rings are an ellipse seen
// from the side, so laid flat they become round. They shimmer and turn very slowly.
async function buildPool(d, heightAt) {
  const map = await loadTexture(d.texture);
  map.center.set(0.5, 0.5);
  const [x, z] = d.at;
  const mesh = new THREE.Mesh(
    drape(new THREE.CircleGeometry(d.radius, 20).rotateX(-Math.PI / 2).translate(x, 0, z), heightAt, 0.06),
    new THREE.MeshBasicMaterial({ map, alphaTest: 0.5 }),
  );
  return {
    mesh,
    update(t, dim) {
      map.rotation = t * 0.04;
      mesh.material.color.setScalar((0.85 + 0.1 * Math.sin(t * 1.3)) * (0.5 + 0.5 * dim));
    },
  };
}

// The path from under the tree to the gap in the treeline: a strip of dark red earth, like
// the band under the grass in the painting, ragged at its edges.
async function buildPath(d, heightAt) {
  const c = canvas(32, 64);
  const g = c.getContext('2d');
  const r = rng(11);
  g.fillStyle = '#1c060e';
  g.fillRect(0, 0, 32, 64);
  for (let i = 0; i < 90; i++) { // streaks of red and purple, mostly along the path
    g.fillStyle = ['#33091a', '#2a0c26', '#4a1236', '#3b1a5c'][Math.floor(r() * 4)];
    g.fillRect(Math.floor(r() * 32), Math.floor(r() * 64), 1, 2 + Math.floor(r() * 6));
  }
  for (let y = 0; y < 64; y++) { // ragged edges: a few pixels in from each side are see-through
    g.clearRect(0, y, Math.floor(r() * 5), 1);
    g.clearRect(32 - Math.floor(r() * 5), y, 5, 1);
  }
  const map = crunchy(c);
  map.wrapT = THREE.RepeatWrapping;

  const pos = [], uv = [], index = [];
  const steps = walkPath(d.points, 1.5);
  steps.forEach((s, i) => {
    for (const side of [-1, 1]) pos.push(s.x + s.nx * side * d.width / 2, 0, s.z + s.nz * side * d.width / 2);
    uv.push(0, s.t / 6, 1, s.t / 6);
    if (i > 0) { const k = i * 2; index.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  drape(geo, heightAt, 0.07);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }));
}

// The way on, once it has been petted: light pouring through the gap in the treeline, a
// pillar of it where the path ends (E there goes on), and its glow on the ground.
function buildExit(d, heightAt) {
  const glow = glowTexture([[0, 'rgba(255,238,242,1)'], [0.35, 'rgba(255,170,195,0.45)'], [1, 'rgba(255,120,160,0)']]);
  const additive = { map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 };
  const [x, z] = d.at, [gx, gz] = d.gap;
  const far = new THREE.Sprite(new THREE.SpriteMaterial(additive));
  far.scale.set(...d.gapSize);
  far.position.set(gx, heightAt(gx, gz) + d.gapSize[1] * 0.3, gz);
  const pillar = new THREE.Sprite(new THREE.SpriteMaterial(additive));
  pillar.scale.set(...d.pillarSize);
  pillar.position.set(x, heightAt(x, z) + d.pillarSize[1] * 0.4, z);
  const spill = new THREE.Mesh(
    drape(new THREE.PlaneGeometry(12, 12, 4, 4).rotateX(-Math.PI / 2).translate(x, 0, z), heightAt, 0.09),
    new THREE.MeshBasicMaterial(additive),
  );
  const group = new THREE.Group();
  group.add(far, pillar, spill);
  return {
    group,
    update(t, open) {
      const breathe = 0.85 + 0.1 * Math.sin(t * 0.9) + 0.05 * Math.sin(t * 2.7);
      far.material.opacity = open * breathe;
      pillar.material.opacity = open * breathe * 0.9;
      spill.material.opacity = open * breathe * 0.6;
      group.visible = open > 0;
    },
  };
}
