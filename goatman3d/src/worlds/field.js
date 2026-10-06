import * as THREE from 'three';
import { createChunkedTerrain } from '../chunks.js';
import { loadImage, loadTexture, canvas, crunchy, grade, rng } from '../textures.js';
import { barkTrunks } from './trunks.js';
import { buildSkyDome, buildSkyline, buildFarLand, haze } from './horizon.js';
import { buildLandmarks } from './landmarks.js';
import { buildStones } from './expanse.js';
import { buildRedGrass } from './redgrass.js';
import { buildGiants, buildFallenLeg } from './giants.js';
import { createWalkingThing } from '../walkingthing.js';

// Level 2, the red field, from Charlie's layered painting (WALKYBOY/), now Kenshi-sized:
// about 1.5 km of red grass rolling in long swells (chunks.js), dark mountains far off that
// take minutes to walk toward (landmarks.js), and the painting's peaks as a last ring on the
// horizon. The BACKGROUND pink is the sky dome, BACKCLOUDS drift far up and frontclouds faster
// lower down, and their shadows slide across the grass. The Walking Thing wanders the middle
// of the field: from the gate you see its long legs over the grass far off and hear its
// footfalls grow as you close in. On the way: dips where the grass closes over GoatMan's
// head, lone dark rocks, foothills to climb for a view, a huge ring of flattened grass, a
// giant's fallen leg across a valley, and the giants themselves pacing the far ridges.
// Behind him at the start, the two trunks he came through stand alone with the night
// still between them.

export async function buildField(def, { scene, camera, player }) {
  const group = new THREE.Group();
  const r = rng(def.seed);
  const fog = new THREE.Color(def.fog.color); // the far things' haze follows the fog (darkening in the squash)
  const shadow = cloudShadows(def.clouds);

  // The dips are hollows in the ground, as well as where the tall grass grows.
  const t = { ...def.terrain, hills: [...def.terrain.hills, ...def.dips.map((d) => [...d.at, d.radius, -d.depth])] };
  const floor = await loadTexture(t.texture, 1);
  const groundMat = new THREE.MeshLambertMaterial({ map: floor, color: new THREE.Color(...t.tint) });
  groundMat.onBeforeCompile = shadow.patch;
  groundMat.customProgramCacheKey = () => 'field-ground';
  const terrain = createChunkedTerrain(t, groundMat, { shade: flattened(def.ring) });
  const { heightAt } = terrain;
  const center = t.center ?? [0, 0];
  const inside = (x, z) => Math.hypot(x - center[0], z - center[1]) < def.bounds;
  inside.bounds = terrain.bounds;

  const sky = await buildSkyDome(def.skyDome, def.fog.color);
  const far = buildFarLand(def.horizon, terrain.height, { center, cut: t.view - 20, fogColor: fog, sun: def.sun.dir });
  const peaks = await buildSkyline(def.peaks, terrain.height);
  // past everything else, so fogged the most: at least `fog` of the way, and fully at the foot
  haze(peaks.material, { color: fog, from: 0, to: 1, a: def.peaks.fog, b: def.peaks.fog, low: def.landmarkLook.low });
  const marks = buildLandmarks(def.landmarks, def.landmarkLook, heightAt, fog);
  const giants = buildGiants(def.giants, terrain.height, fog);
  const leg = buildFallenLeg(def.fallenLeg, heightAt);
  const clouds = await buildClouds(def.clouds, r, fog);
  const grass = buildRedGrass(def.grass, { heightAt, inside, dips: def.dips, ring: def.ring, shadow, seed: def.seed });
  const stones = buildStones(def.stones, terrain, r);
  group.add(terrain.group, far, sky, peaks, marks.group, giants.group, clouds.group, ...leg.meshes, grass.group, ...stones.meshes);

  const gate = await buildGate(def.gate, heightAt);
  group.add(...gate.meshes);

  const thing = await createWalkingThing(def.walkingThing, { heightAt, camera, player });
  const [hx, , hz] = def.walkingThing.home;
  thing.avoid = [{ kind: 'ring', x: hx, z: hz, r: def.walkingThing.roam }, ...marks.colliders, ...leg.colliders];
  const legLines = farLegs(thing, fog, def.walkingThing.farLegs);
  group.add(thing.group, legLines.lines);

  let now = 0;
  return {
    group,
    ground: [terrain.ground, leg.ground],
    colliders: [{ kind: 'ring', x: center[0], z: center[1], r: def.bounds }, ...marks.colliders, ...leg.colliders, ...gate.colliders, ...thing.colliders],
    blockers: [...gate.blockers, ...leg.blockers],
    actors: { walkingThing: thing },
    heightAt,
    chunks: terrain, // the admin box and map show what it has built
    update(dt, time) {
      if (scene.fog) fog.copy(scene.fog.color);
      sky.position.copy(camera.position); // always as far away
      clouds.update(dt, camera.position);
      shadow.update(dt);
      giants.update(dt);
      thing.update(dt);
      legLines.update();
      now = time;
    },
    beforeRender(cam) {
      terrain.update(cam);
      grass.update(now, cam);
      stones.update(cam);
    },
    dispose() {
      terrain.dispose();
      grass.dispose();
    },
  };
}

// From far off the Walking Thing's legs are thinner than a pixel: a line down each (always a
// pixel wide however far) keeps them showing over the grass, hazed like the landmarks rather
// than fogged out. Up close the lines are inside the legs. levels.json walkingThing.farLegs:
// { color, haze: [from, to, most] }
function farLegs(thing, fogColor, d) {
  const per = thing.legs[0].curve.points.length;
  const pos = new Float32Array(thing.legs.length * (per - 1) * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: d.color });
  haze(mat, { color: fogColor, from: d.haze[0], to: d.haze[1], a: 0, b: d.haze[2] });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return {
    lines,
    update() {
      let n = 0;
      for (const leg of thing.legs) {
        const c = leg.curve.points;
        for (let i = 0; i < per - 1; i++) { c[i].toArray(pos, n); c[i + 1].toArray(pos, n + 3); n += 6; }
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// The huge ring of flattened grass shows on the ground as a paler band (pressed grass
// catches the light): the ground's shade at (x, z), for createChunkedTerrain.
function flattened(ring) {
  return (x, z) => {
    const off = Math.abs(Math.hypot(x - ring.at[0], z - ring.at[1]) - ring.radius) / (ring.width / 2);
    const k = 1 + 0.4 * (1 - THREE.MathUtils.smoothstep(off, 0.6, 1.1));
    return [k, k * 0.9, k * 0.9];
  };
}

// The clouds' shadows: soft dark patches of moving noise, drifting downwind, patched into the
// ground's and the grass's shaders (the world point is worked back from the view-space one,
// so it works for instanced grass too). levels.json clouds.shadows: { scale, speed, dark }.
function cloudShadows(d) {
  const s = d.shadows;
  const [wx, wz] = d.wind, len = Math.hypot(wx, wz);
  const drift = { value: new THREE.Vector3(0, 0, s.dark) };
  return {
    update(dt) {
      drift.value.x += (wx / len) * s.speed * dt;
      drift.value.y += (wz / len) * s.speed * dt;
    },
    patch(shader) {
      shader.uniforms.uCloudDrift = drift;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCloudAt;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvCloudAt = (transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vCloudAt;
uniform vec3 uCloudDrift;
float cloudHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cloudNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cloudHash(i), cloudHash(i + vec2(1, 0)), f.x), mix(cloudHash(i + vec2(0, 1)), cloudHash(i + vec2(1, 1)), f.x), f.y);
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
  vec2 cloudP = (vCloudAt - uCloudDrift.xy) / ${s.scale.toFixed(1)};
  float cloud = 0.65 * cloudNoise(cloudP) + 0.35 * cloudNoise(cloudP * 2.3 + 7.1);
  diffuseColor.rgb *= 1.0 - uCloudDrift.z * smoothstep(0.52, 0.66, cloud);`);
    },
  };
}

// Two heights of painted cloud cards drifting on the wind: BACKCLOUDS far up and slow,
// frontclouds lower and faster. Sprites, so they always face him, cut out with alphaTest.
// They drift in a circle round him, so however far he walks the sky is never empty. The far
// ones low over the horizon fade into the haze like the mountains (clouds.haze: [from, to, most]).
async function buildClouds(d, r, fogColor) {
  const group = new THREE.Group();
  const drifting = [];
  for (const layer of [d.far, d.near]) {
    const mats = [];
    for (let i = 1; i <= layer.cards; i++) {
      const map = await loadTexture(`${layer.art}${i}.png`);
      // opaque cut-outs (not see-through), so the squash's darkness covers them too
      const mat = new THREE.SpriteMaterial({ map, alphaTest: 0.5, transparent: false, color: new THREE.Color(layer.tint) });
      haze(mat, { color: fogColor, from: d.haze[0], to: d.haze[1], a: 0, b: d.haze[2] });
      mats.push({ mat, aspect: map.image.height / map.image.width });
    }
    for (let i = 0; i < layer.count; i++) {
      const { mat, aspect } = mats[i % mats.length];
      const cloud = new THREE.Sprite(mat);
      const size = layer.size[0] + r() * (layer.size[1] - layer.size[0]);
      cloud.scale.set(size, size * aspect, 1);
      const a = r() * Math.PI * 2, dist = Math.sqrt(r()) * layer.radius;
      cloud.position.set(Math.cos(a) * dist, layer.height[0] + r() * (layer.height[1] - layer.height[0]), Math.sin(a) * dist);
      group.add(cloud);
      drifting.push({ cloud, speed: layer.speed * (0.8 + r() * 0.4), radius: layer.radius });
    }
  }
  const [wx, wz] = d.wind;
  const len = Math.hypot(wx, wz);
  return {
    group,
    update(dt, eye) {
      for (const { cloud, speed, radius } of drifting) {
        const p = cloud.position;
        p.x += (wx / len) * speed * dt;
        p.z += (wz / len) * speed * dt;
        // too far from him (blown or walked away from): over to the other side of him
        const dx = p.x - eye.x, dz = p.z - eye.z;
        if (Math.hypot(dx, dz) > radius) { p.x = eye.x - dx * 0.98; p.z = eye.z - dz * 0.98; }
      }
    },
  };
}

// The way back: the two huge trunks from the end of the forest, standing on their own in
// the red field, and between them the night forest, still dark, something still watching.
async function buildGate(d, heightAt) {
  const [x, z] = d.at;
  const y = heightAt(x, z);
  const trunks = await barkTrunks([-1, 1].map((side) => ({
    x: x + side * (d.gap / 2 + d.trunkRadius), z, y: y - 0.5, radius: d.trunkRadius, height: d.height,
    yaw: 0, lean: 0.04, leanDir: side < 0 ? 0 : Math.PI,
  })));
  const c = canvas(64, 256);
  const g = c.getContext('2d');
  g.drawImage(await loadImage(d.wall), 96, 0, 64, 180, 0, 0, 64, 256);
  grade(c, [1.2, 0.8, 0.45, 0.1]);
  const dark = g.createLinearGradient(0, 0, 0, 256);
  dark.addColorStop(0, 'rgba(2,3,10,0.9)');
  dark.addColorStop(0.5, 'rgba(2,3,10,0.2)');
  dark.addColorStop(1, 'rgba(2,3,10,0.85)');
  g.fillStyle = dark;
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = '#e08a1c'; // two eyes, low down in the dark
  for (const ex of [28, 34]) g.fillRect(ex, 236, 2, 1);
  const night = new THREE.Mesh(
    new THREE.PlaneGeometry(d.gap + d.trunkRadius * 2, d.height * 0.9),
    new THREE.MeshBasicMaterial({ map: crunchy(c), fog: false }),
  );
  night.position.set(x, y + d.height * 0.45 - 1, z + 0.5);
  night.rotation.y = Math.PI; // facing the field
  return { meshes: [trunks.mesh, night], colliders: trunks.colliders, blockers: [trunks.mesh] };
}
