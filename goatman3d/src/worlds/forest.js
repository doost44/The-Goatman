import * as THREE from 'three';
import { buildTerrain, terrainHeight, valueNoise, walkPath } from '../terrain.js';
import { loadImage, loadTexture, toCanvas, canvas, crunchy, grade, rng } from '../textures.js';
import { nearestOnPath } from '../player.js';
import { createScatter } from './scatter.js';
import { planForest } from './woods.js';
import { buildTrunks } from './trunks.js';
import { buildUndergrowth, buildGrass } from './undergrowth.js';
import { buildMarks, buildEyes } from './marks.js';
import { buildGate } from './gate.js';
import { pondCourse, buildPonds } from './ponds.js';
import { buildMushrooms } from './mushrooms.js';

// Level 1, the night forest, from "Background Section 1.jpg" and fore.png: an open forest of
// dense dark trunks under a dome of blue burlap, the ground rising and dipping, a path of
// glowing marks through it with hidden paths off it, still black ponds in its clearings, and
// somewhere past its end a gap where the pink light of the red field leaks through. woods.js plans where everything goes, and
// the scatter draws only what is near the camera.

export async function buildForest(def, { scene, camera, player }) {
  const group = new THREE.Group();
  const r = rng(def.trunks.seed);
  const smooth = THREE.MathUtils.smoothstep;

  // The ground rolls into dips and rises away from the main path (level along it, and round
  // the way out).
  const [roll, scale] = def.terrain.rolling;
  const [gx, gz] = def.exit.at;
  const reshape = (x, z, h) => {
    const off = smooth(nearestOnPath(def.path.points, x, z).d, 4, 16) * smooth(Math.hypot(x - gx, z - gz), 6, 14);
    return h + roll * off * (valueNoise(x * scale, z * scale) + 0.35 * valueNoise(x * scale * 3.1 + 7, z * scale * 3.1 - 3));
  };
  const floor = await loadTexture(def.terrain.texture, 1);
  const groundMat = new THREE.MeshLambertMaterial({ map: floor, color: new THREE.Color(...def.terrain.tint) });
  // The ponds lie in finer patches of ground of their own; the coarse ground sinks out of sight under them.
  const natural = terrainHeight(def.terrain);
  const course = pondCourse(def.ponds, def.terrain, (x, z) => reshape(x, z, natural(x, z)));
  const { mesh: ground, heightAt: coarse } = buildTerrain(def.terrain, groundMat, { reshape: (x, z, h) => course.lower(x, z, reshape(x, z, h)) });
  const heightAt = (x, z) => course.height(x, z) ?? coarse(x, z);
  const ponds = buildPonds(def.ponds, course, def.terrain, groundMat, camera);
  group.add(ground, ponds.group);

  const gate = await buildGate(def, heightAt, r);
  const plan = planForest(def, heightAt, r, { keepClear: [...gate.keepClear, ...course.keepClear], trunks: gate.trunks, wet: course.wet });
  const scatter = createScatter({ reach: def.woods.reach });
  const wood = await buildTrunks(plan, scatter, gate.blush);
  buildUndergrowth(plan, scatter, def.undergrowth, r);
  // Glowing mushrooms leading to the places: the side paths' ends and the ponds.
  const places = {};
  for (const p of def.sidePaths) if (p.end) places[p.name] = { x: p.end.at[0], z: p.end.at[1], radius: p.end.radius };
  for (const p of course.list) places[p.name] = { x: p.x, z: p.z, radius: p.bank };
  const mushrooms = buildMushrooms(def.mushrooms, {
    places, start: [def.spawns.start.at[0], def.spawns.start.at[2]], path: def.path, heightAt, scatter, player,
    blocked: (x, z) => plan.crowded(x, z, 0.2, 0.1) || course.wet(x, z, 0.5) || nearestOnPath(def.path.points, x, z).d < def.path.width / 2,
  });
  const fog = new THREE.Color(def.fog.color);
  const dome = await buildDome(def.dome, fog, r);
  group.add(...scatter.done(), wood.arches, gate.light, dome, buildGrass(def.grass, def.path, heightAt, r));

  const marks = await buildMarks(def.marks, def.path, def.sidePaths, heightAt, (x, z) => plan.crowded(x, z, 0, 0.15) || course.wet(x, z, 0.5));
  const eyes = await buildEyes(def.eyes, plan.spots, def.path, camera);
  group.add(marks.group, eyes.group, mushrooms.group);

  // What he can stand on besides the ground: the tops of the fallen trunks.
  const logs = new THREE.Object3D();
  logs.userData.surface = (x, z) => logTop(plan.near(x, z, 1), x, z);
  // Only the colliders near him, picked again each time he has moved a couple of metres.
  const colliders = [];
  const last = new THREE.Vector3(Infinity, 0, 0);
  // Pebbles to throw along the hidden paths too (rocks.js).
  const pebbles = def.sidePaths.flatMap((p) => walkPath(p.points, 9, 6).map((s) => [s.x + s.nx * 0.8, s.z + s.nz * 0.8]));

  const fogNight = new THREE.Color(def.fog.color), fogPink = new THREE.Color(def.exit.fog);
  return {
    group,
    ground: [ground, ...ponds.basins, logs],
    colliders,
    blockers: [...wood.solid.map((k) => scatter.meshes[k]), ...wood.archBlockers],
    rockTargets: [...eyes.targets, ponds.water],
    actors: {},
    heightAt,
    pebbles,
    wet: course.wet,
    waterDepth: course.depth, // (x, z, y): wading in the ponds
    splash: ponds.splash, // (x, z, size, sound)
    // Where the night bed's pond sounds come from (ambience.js): the nearest pond.
    soundAt: (p) => course.nearest(p.x, p.z),
    scatter,
    update(dt, t) {
      if (player.pos.distanceToSquared(last) > 4) {
        last.copy(player.pos);
        colliders.length = 0;
        colliders.push(plan.wall, ...gate.colliders, ...plan.near(last.x, last.z, 10));
      }
      marks.update(t);
      eyes.update(dt);
      ponds.update(dt, t);
      mushrooms.update(t);
      // The pink light seeps into the fog near the way out.
      scene.fog?.color.lerpColors(fogNight, fogPink, gate.near(player.pos) * def.exit.tint);
      fog.copy(scene.fog?.color ?? fogNight);
      gate.update(t, camera);
    },
    // Once the camera is placed for the frame: only the wood it can see is drawn.
    beforeRender() {
      dome.position.copy(camera.position); // always the same far away
      // As far as the fog lets him see: further with night vision, the whole forest with the fog off (admin mode).
      const far = scene.fog?.far ?? def.fog.far;
      scatter.reach = far > 1e3 ? 300 : def.woods.reach * Math.max(1, far / def.fog.far);
      scatter.update(camera);
    },
  };
}

// The height of the top of whichever fallen trunk (line colliders) is under (x, z), or null.
function logTop(near, x, z) {
  let best = null;
  for (const c of near) {
    if (c.kind !== 'line') continue;
    const dx = c.bx - c.ax, dz = c.bz - c.az;
    const k = ((x - c.ax) * dx + (z - c.az) * dz) / (dx * dx + dz * dz);
    const d = Math.hypot(x - (c.ax + dx * k), z - (c.az + dz * k));
    if (k < 0 || k > 1 || d > c.r) continue;
    const top = c.ya + (c.yb - c.ya) * k - c.r + Math.sqrt(c.r * c.r - d * d); // round over the top
    if (best === null || top > best) best = top;
  }
  return best;
}

// The sky: a dome painted like the reference, deep blue burlap with dark trunks low down,
// darkening toward the top, with a few specks of light. It is mirrored round an even number
// of times (so there is no seam) and moves with the camera, so it is always as far away.
// Near the horizon it melts into the fog, whatever colour the fog is (pink near the way out).
// levels.json "dome": { wall, crop, brightness, weave, repeat (even), zenith, specks, radius }
async function buildDome(d, fog, r) {
  const W = 256, H = 256, span = Math.PI / 2 + 0.25; // from the top to a little below the horizon
  const row = (deg) => Math.round(((90 - deg) / 180) * Math.PI / span * H); // the canvas row of an elevation
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const weave = await loadImage(d.weave);
  for (let x = 0; x < W; x += weave.width) for (let y = 0; y < H; y += weave.height) g.drawImage(weave, x, y);
  // The painting's trunks from the horizon up to about 50 degrees, fading into the burlap.
  const wall = grade(toCanvas(await loadImage(d.wall), ...d.crop), [1, 1, d.brightness, 0]);
  const top = row(50), tall = row(0) - top;
  const band = canvas(W, tall);
  const bg = band.getContext('2d');
  bg.drawImage(wall, 0, 0, W, tall);
  bg.globalCompositeOperation = 'destination-in';
  const mask = bg.createLinearGradient(0, 0, 0, tall);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(0.3, '#000');
  bg.fillStyle = mask;
  bg.fillRect(0, 0, W, tall);
  g.drawImage(band, 0, top);
  // Darker toward the top, nearly black overhead.
  const dark = g.createLinearGradient(0, 0, 0, row(35));
  dark.addColorStop(0, `${d.zenith}ff`);
  dark.addColorStop(0.35, `${d.zenith}e0`);
  dark.addColorStop(1, `${d.zenith}00`);
  g.fillStyle = dark;
  g.fillRect(0, 0, W, row(35));
  // A few specks of light through the gaps.
  for (let i = 0; i < d.specks; i++) {
    g.fillStyle = `rgba(190,205,255,${0.35 + r() * 0.5})`;
    g.fillRect(Math.floor(r() * W), row(THREE.MathUtils.lerp(30, 68, r())), 1, 1);
  }
  const tex = crunchy(c);
  tex.wrapS = THREE.MirroredRepeatWrapping;
  tex.repeat.x = d.repeat;
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  // The fog's colour mixed in toward the horizon (vUp: how high up the dome, 0 at the horizon).
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFog = { value: fog };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUp = normalize(position).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uFog;\nvarying float vUp;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(uFog, diffuseColor.rgb, smoothstep(0.03, 0.24, vUp));');
  };
  mat.customProgramCacheKey = () => 'forest-dome';
  const dome = new THREE.Mesh(new THREE.SphereGeometry(d.radius, 48, 16, 0, Math.PI * 2, 0, span), mat);
  dome.renderOrder = -10; // drawn first, behind everything
  return dome;
}
