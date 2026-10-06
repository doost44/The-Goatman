import * as THREE from 'three';
import { terrainHeight, walkPath, drape } from '../terrain.js';
import { createChunkedTerrain } from '../chunks.js';
import { loadTexture, canvas, crunchy, glowTexture, rng } from '../textures.js';
import { nearestOnPath } from '../player.js';
import { buildSkyDome, buildStars, buildSkyline } from './horizon.js';
import { buildTealTree } from './tealtree.js';
import { buildClumps } from './clumps.js';
import { buildRiver } from './river.js';
import { createWaters } from './waters.js';
import { buildBog } from './bog.js';
import { buildLowcountry } from './lowcountry.js';
import { createBushes } from '../bushes.js';
import { createWalkingThing } from '../walkingthing.js';

// Level 3, the savanna, from Charlie's layered painting (the savannahg/) and its videos, and
// as big as the land in Kenshi: about 1.5 km across, in chunks (chunks.js). The painted
// colours stay (crimson sky, lavender ground, blue grass, the teal tree) but the land is
// South Carolina's lowcountry: most of it a tidal salt marsh, a shining sheet of shallow
// water broken into hundreds of winding hummocks of golden marsh grass, crossed by the
// path on an old dike. Out of it rise islands: the one he arrives on, with the willow, live
// oaks hung with moss and the low boggy river winding past through a ford; longleaf pines
// far apart on sandy rises with round wet hollows (Carolina bays); a cypress swamp; a
// second willow on its own hummock; and a band of dark forest round the edge (waters.js,
// lowcountry.js). Three herds of the striped creatures
// and their babies keep to their own places. The crimson sky slowly darkens until nsky's
// stars come through, and the night goes on getting deeper the longer he stays: more stars,
// thicker fog and mist, the herds settling down to sleep.
// GoatMan arrives on the Walking Thing's back. The way on is the long path from under the
// tree (across the ford) to a gap in the far treeline, and it only lights up once the
// Walking Thing has been petted; then its light can be seen from anywhere. At the very end
// it all dissolves into the light.

const WHITE = new THREE.Color(1, 1, 1);
const smooth = THREE.MathUtils.smoothstep;

export async function buildSavanna(def, { scene, camera, player, lights, flag }) {
  const group = new THREE.Group();
  const r = rng(def.seed);

  const natural = terrainHeight(def.terrain);
  const waters = createWaters(def, natural);
  const [s0, s1] = def.terrain.sand; // the rises turn sandy from s0 to s1 metres up
  const floor = await loadTexture(def.terrain.texture, 1);
  const groundMat = new THREE.MeshLambertMaterial({ map: floor, color: new THREE.Color(...def.terrain.tint) });
  const terrain = createChunkedTerrain(def.terrain, groundMat, {
    reshape: waters.reshape,
    shade: (x, z) => waters.shade(x, z, smooth(natural(x, z), s0, s1)),
  });
  const { heightAt } = terrain;
  const { wet, deep } = waters; // wet(x, z, margin): in the water, or within margin metres of it

  const sky = await buildSkyDome(def.skyDome, def.fog.color);
  const stars = await buildStars(def.stars);
  const deepStars = await buildStars({ ...def.stars, radius: def.stars.radius - 5, repeat: def.night.repeat }); // more, as the night deepens
  deepStars.rotation.y = 1.3;
  const treeline = await buildSkyline(def.treeline, heightAt);
  const tree = await buildTealTree(def.tree, heightAt);
  const willows = await Promise.all((def.willows ?? []).map((w) => buildTealTree({ ...def.tree, ...w }, heightAt)));
  const path = await buildPath(def.path, heightAt);
  const exit = buildExit(def.exit, heightAt);
  const trees = [tree, ...willows];
  const offPath = (x, z, by) => nearestOnPath(def.path.points, x, z).d > def.path.width / 2 + by;
  const [sx, , sz] = def.spawns.start.at;
  // Where a tree may stand: dry land off the path, clear of the willows and the arrival.
  const open = (x, z) => !wet(x, z, 6) && waters.marsh(x, z) < 0.3 && offPath(x, z, 5) && Math.hypot(x - sx, z - sz) > 25
    && trees.every((t) => Math.hypot(x - t.at[0], z - t.at[1]) > t.reach + 4);
  const grass = await buildClumps(def.grass, heightAt,
    (x, z) => wet(x, z, 3) || !offPath(x, z, 0.3) || trees.some((t) => Math.hypot(x - t.at[0], z - t.at[1]) < 2), // muddy banks: reeds only
    waters.marsh);
  const water = buildRiver(def.river, waters, camera);
  const bog = await buildBog(def.river.bog, waters, heightAt, waters.marsh);
  const haze = new THREE.Color(def.fog.color); // kept like the live fog: the giants are hazed toward it
  const land = await buildLowcountry(def.lowcountry, { heightAt, waters, open, bounds: def.bounds, fog: haze });
  group.add(terrain.group, sky, stars, deepStars, treeline, ...trees.flatMap((t) => t.meshes), path, exit.group,
    ...grass.meshes, water.group, ...bog.meshes, ...land.meshes);

  const edge = { kind: 'ring', x: 0, z: 0, r: def.bounds };
  const fixed = [edge, ...trees.flatMap((t) => t.colliders)];
  const bushes = await createBushes(def.bushes, { heightAt, camera, player, avoid: fixed, wet: deep }); // they splash about the marsh
  const thing = await createWalkingThing(def.walkingThing, { heightAt, camera, player });
  thing.avoid = [{ ...edge, r: def.walkingThing.bounds }, ...trees.map((t) => t.keepOut)];
  thing.wet = deep;
  thing.onStep = (foot) => water.splash(foot.x, foot.z, 1.5); // only where there is water
  group.add(bushes.group, thing.group);
  // What he can walk into: the edge, the willows' trunks, the creatures, the Walking Thing's
  // legs, and the trunks near him (picked again each time he has moved a few metres).
  const colliders = [];
  const last = new THREE.Vector3(1e9, 0, 0);
  const solidNear = () => {
    if (last.distanceToSquared(player.pos) < 9) return;
    last.copy(player.pos);
    colliders.length = 0;
    colliders.push(...fixed, ...bushes.colliders, ...thing.colliders, ...land.near(player.pos.x, player.pos.z, 12));
  };
  solidNear();

  // The ending's white-out: a white dome just inside the sky, over the sky and the stars.
  const veil = new THREE.Mesh(
    new THREE.SphereGeometry(def.stars.radius - 10, 16, 8),
    new THREE.MeshBasicMaterial({ color: WHITE, side: THREE.BackSide, fog: false, depthWrite: false, transparent: true, opacity: 0 }),
  );
  veil.renderOrder = -8;
  group.add(veil);
  let dissolving = null;

  const fog = new THREE.Color(def.fog.color);
  let opened = 0, clock = 0;
  const pushers = [];
  const world = {
    group,
    ground: [terrain.ground],
    colliders,
    blockers: trees.flatMap((t) => t.blockers),
    rockTargets: [...bushes.targets, ...water.meshes],
    actors: { walkingThing: thing },
    heightAt,
    chunks: terrain, // the admin box and map show what it has built
    wet, // no pebbles are put there
    waterDepth: waters.depth, // (x, z, y): how deep the water is over ground at y (wading)
    splash: water.splash, // (x, z, size, sound)
    // Everything solid within `span` of (x, z), for admin mode's map.
    solidNear: (x, z, span) => [...fixed, ...land.near(x, z, span)],
    // Where the bog's sounds come from (ambience.js): the nearest water.
    soundAt: (p) => waters.closest(p),
    time: 0, // seconds in the level: over def.dusk.time the sky, light and fog darken and the stars come out
    white: 0, // the ending: 0 .. 1 dissolved into the light
    // Dissolves everything into white over `time` seconds (the prelude to the last video).
    dissolve(time) {
      return new Promise((resolve) => { dissolving = { rate: 1 / time, resolve }; });
    },
    beforeRender(cam) {
      terrain.update(cam);
      grass.update(cam);
      bog.scatter.update(cam);
      land.update(cam, clock);
    },
    dispose() {
      terrain.dispose();
    },
    update(dt, t) {
      clock = t;
      world.time += dt;
      // The dusk, then the night going on getting deeper.
      const k = smooth(world.time, 0, def.dusk.time);
      const night = smooth(world.time, def.dusk.time, def.night.time);
      const dim = (1 - (1 - def.dusk.dim) * k) * (1 - (1 - def.night.dim) * night);
      sky.material.color.setScalar(dim);
      treeline.material.color.setScalar(dim);
      stars.material.opacity = k * def.dusk.stars;
      stars.visible = stars.material.opacity > 0.005; // see-through things cost as much to draw as solid ones
      deepStars.material.opacity = night * def.night.stars;
      deepStars.visible = deepStars.material.opacity > 0.005;
      scene.fog?.color.copy(fog).multiplyScalar(dim);
      if (scene.fog) {
        scene.fog.near = THREE.MathUtils.lerp(def.fog.near, def.night.fog[0], night);
        scene.fog.far = THREE.MathUtils.lerp(def.fog.far, def.night.fog[1], night);
      }
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
          scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, 2, white);
          scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, 36, white);
        }
        lights.ambient.intensity *= 1 + 2.5 * white;
      }
      if (scene.fog) haze.copy(scene.fog.color);
      treeline.material.emissive.setScalar(white);
      veil.material.opacity = white ** 1.3;
      veil.visible = white > 0;
      for (const o of [sky, stars, deepStars, veil]) o.position.copy(camera.position); // always as far away
      stars.rotation.y = world.time * 0.004; // the night sky turning, very slowly
      deepStars.rotation.y = 1.3 + world.time * 0.004;

      grass.tick(t);
      water.update(dt, t, dim);
      bog.update(dt, t, dim, k, night);
      // GoatMan and the Walking Thing's feet push through the willows' tendrils.
      pushers[0] = { x: player.pos.x, y: player.pos.y, z: player.pos.z, r: 1, tall: 2.4 };
      thing.feet.forEach((foot, i) => { pushers[i + 1] = { x: foot.x, y: foot.y, z: foot.z, r: 1.6, tall: thing.hips - foot.y }; });
      for (const w of trees) {
        const seen = Math.hypot(camera.position.x - w.at[0], camera.position.z - w.at[1]) < (scene.fog?.far ?? 1e4) + w.reach;
        for (const m of w.meshes) m.visible = seen; // past the fog: not drawn at all
        if (seen) w.update(t, pushers);
      }
      bushes.update(dt, dim, night);
      thing.update(dt);
      solidNear();
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
