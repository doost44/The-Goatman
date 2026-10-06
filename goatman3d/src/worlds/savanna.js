import * as THREE from 'three';
import { buildTerrain, terrainHeight, walkPath, drape } from '../terrain.js';
import { loadTexture, canvas, crunchy, glowTexture, rng } from '../textures.js';
import { buildSkyDome, buildStars, buildSkyline } from './horizon.js';
import { buildTealTree } from './tealtree.js';
import { buildClumps } from './clumps.js';
import { riverCourse, buildRiver } from './river.js';
import { buildBog } from './bog.js';
import { createBushes } from '../bushes.js';
import { createWalkingThing } from '../walkingthing.js';

// Level 3, the savanna, from Charlie's layered painting (the savannahg/) and its videos:
// long purple grass swaying under a crimson sky that slowly darkens until nsky's stars come
// through, a dark treeline all round, the teal tree as a weeping willow, a low boggy river
// winding past it, and the striped creatures and their babies drifting through the grass.
// GoatMan arrives on the Walking Thing's back. The way on is the path from under the tree
// (across the river) to a gap in the treeline, and it only lights up once the Walking Thing
// has been petted. At the very end it all dissolves into the light.

const WHITE = new THREE.Color(1, 1, 1);

export async function buildSavanna(def, { scene, camera, player, lights, flag }) {
  const group = new THREE.Group();
  const r = rng(def.seed);

  const floor = await loadTexture(def.terrain.texture, 1);
  const groundMat = new THREE.MeshLambertMaterial({ map: floor, color: new THREE.Color(...def.terrain.tint) });
  const river = riverCourse(def.river, terrainHeight(def.terrain)); // its channel is carved into the ground
  const { mesh: ground, heightAt } = buildTerrain(def.terrain, groundMat, river);
  const wet = (x, z, margin = 1) => (river.nearest(x, z)?.d ?? Infinity) < river.edge + margin; // in the water, or about to be

  const sky = await buildSkyDome(def.skyDome, def.fog.color);
  const stars = await buildStars(def.stars);
  const treeline = await buildSkyline(def.treeline, heightAt);
  const tree = await buildTealTree(def.tree, heightAt);
  const path = await buildPath(def.path, heightAt);
  const exit = buildExit(def.exit, heightAt);
  const [tx, tz] = def.tree.at;
  const grass = await buildClumps(def.grass, heightAt, r, [[tx, tz, 2]], def.path, (x, z) => wet(x, z, 3)); // muddy banks: reeds only
  const water = buildRiver(def.river, river, camera);
  const bog = await buildBog(def.river.bog, river, heightAt);
  group.add(ground, sky, stars, treeline, ...tree.meshes, path, exit.group, ...grass.meshes, water.group, ...bog.meshes);

  const edge = { kind: 'ring', x: 0, z: 0, r: def.bounds };
  const bushes = await createBushes(def.bushes, { heightAt, camera, player, avoid: [edge, ...tree.colliders], wet });
  const thing = await createWalkingThing(def.walkingThing, { heightAt, camera, player });
  thing.avoid = [{ ...edge, r: def.walkingThing.bounds }, tree.keepOut];
  thing.wet = wet;
  thing.onStep = (foot) => water.splash(foot.x, foot.z, 1.5); // only where there is water
  group.add(bushes.group, thing.group);

  // The ending's white-out: a white dome just inside the sky, over the sky and the stars.
  const veil = new THREE.Mesh(
    new THREE.SphereGeometry(def.stars.radius - 10, 16, 8),
    new THREE.MeshBasicMaterial({ color: WHITE, side: THREE.BackSide, fog: false, depthWrite: false, transparent: true, opacity: 0 }),
  );
  veil.renderOrder = -8;
  group.add(veil);
  let dissolving = null;

  const fog = new THREE.Color(def.fog.color);
  let opened = 0;
  const pushers = [];
  const world = {
    group,
    ground: [ground],
    colliders: [edge, ...tree.colliders, ...bushes.colliders, ...thing.colliders],
    blockers: tree.blockers,
    rockTargets: [...bushes.targets, water.water],
    actors: { walkingThing: thing },
    heightAt,
    wet, // no pebbles are put there
    waterDepth: river.depth, // (x, z, y): how deep the water is over ground at y (wading)
    splash: water.splash, // (x, z, size, sound)
    // Where the bog's sounds come from (ambience.js): the nearest stretch of the river.
    soundAt(p) {
      const near = river.closest(p.x, p.z);
      return { x: near.x, y: near.level - def.river.water, z: near.z };
    },
    time: 0, // seconds in the level: over def.dusk.time the sky, light and fog darken and the stars come out
    white: 0, // the ending: 0 .. 1 dissolved into the light
    // Dissolves everything into white over `time` seconds (the prelude to the last video).
    dissolve(time) {
      return new Promise((resolve) => { dissolving = { rate: 1 / time, resolve }; });
    },
    beforeRender(camera) {
      grass.scatter.update(camera);
    },
    update(dt, t) {
      world.time += dt;
      const k = THREE.MathUtils.smoothstep(world.time, 0, def.dusk.time);
      const dim = 1 - (1 - def.dusk.dim) * k;
      sky.material.color.setScalar(dim);
      treeline.material.color.setScalar(dim);
      stars.material.opacity = k * def.dusk.stars;
      stars.visible = stars.material.opacity > 0.005; // see-through things cost as much to draw as solid ones
      scene.fog?.color.copy(fog).multiplyScalar(dim);
      lights.ambient.intensity = def.ambient.intensity * (0.4 + 0.6 * dim);
      lights.sun.intensity = def.sun.intensity * dim;
      if (dissolving) {
        world.white = Math.min(1, world.white + dt * dissolving.rate);
        if (world.white >= 1) { dissolving.resolve(); dissolving = null; }
      }
      const white = world.white; // the fog closes in and turns white, the light swells, the far things fade out
      if (white > 0) {
        scene.fog?.color.lerp(WHITE, white);
        if (scene.fog) {
          scene.fog.near = THREE.MathUtils.lerp(def.fog.near, 2, white);
          scene.fog.far = THREE.MathUtils.lerp(def.fog.far, 36, white);
        }
        lights.ambient.intensity *= 1 + 2.5 * white;
      }
      treeline.material.emissive.setScalar(white);
      veil.material.opacity = white ** 1.3;
      veil.visible = white > 0;
      sky.position.copy(camera.position); // always as far away
      stars.position.copy(camera.position);
      veil.position.copy(camera.position);
      stars.rotation.y = world.time * 0.004; // the night sky turning, very slowly

      grass.update(t);
      water.update(dt, t, dim);
      bog.update(dt, t, dim, k);
      // GoatMan and the Walking Thing's feet push through the willow's tendrils.
      pushers[0] = { x: player.pos.x, y: player.pos.y, z: player.pos.z, r: 1, tall: 2.4 };
      thing.feet.forEach((foot, i) => { pushers[i + 1] = { x: foot.x, y: foot.y, z: foot.z, r: 1.6, tall: thing.hips - foot.y }; });
      tree.update(t, pushers);
      bushes.update(dt, dim);
      thing.update(dt);
      opened = flag('petted') ? Math.min(1, opened + dt / 3) : 0; // the way on lights up
      exit.update(t, opened);
    },
  };
  return world;
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
