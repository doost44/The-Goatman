import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTerrain, walkPath, drape } from '../terrain.js';
import { loadImage, loadTexture, toCanvas, canvas, crunchy, grade, glowTexture, rng } from '../textures.js';
import { plantTrunks, buildTrunks } from './trunks.js';
import { buildMarks, buildEyes } from './marks.js';

// Level 1, the night forest, from "Background Section 1.jpg" and fore.png: a corridor
// through dense dark trunks under a woven blue canopy, with glowing marks leading to a
// gap between two huge trunks where the pink light of the red field leaks through.

export async function buildForest(def, { scene, camera, player }) {
  const group = new THREE.Group();
  const r = rng(def.trunks.seed);

  const floor = await loadTexture(def.terrain.texture, 1);
  const groundMat = new THREE.MeshLambertMaterial({ map: floor, color: new THREE.Color(...def.terrain.tint) });
  const { mesh: ground, heightAt } = buildTerrain(def.terrain, groundMat);
  group.add(ground);

  const gate = await exitGate(def, heightAt, await paintGlimpse(def.exit.glimpse));
  const specs = plantTrunks(def.trunks, def.path, heightAt, r, gate.keepClear);
  specs.push(...gate.trunks);
  const trunks = await buildTrunks(specs);
  group.add(...trunks.meshes);

  const backdrop = await buildBackdrop(def.backdrop, def.fog.color);
  group.add(backdrop, await buildGrass(def.grass, def.path, heightAt, r), gate.light);

  const inPath = specs.filter((s) => s.near).map((s) => [s.x, s.z, s.radius + 0.6]);
  const marks = await buildMarks(def.marks, def.path, heightAt, inPath);
  const eyes = await buildEyes(def.eyes, def.path, heightAt, camera, trunks.blockers);
  group.add(marks.group, eyes.group);

  const fogNight = new THREE.Color(def.fog.color), fogPink = new THREE.Color(def.exit.fog);
  return {
    group,
    ground: [ground],
    colliders: [{ kind: 'path', points: def.path.points, width: def.path.width }, ...trunks.colliders],
    blockers: trunks.blockers,
    rockTargets: eyes.targets,
    actors: {},
    heightAt,
    update(dt, t) {
      backdrop.position.copy(camera.position); // always the same far away
      marks.update(t);
      eyes.update(dt);
      // The pink light seeps into the fog near the way out.
      const near = 1 - THREE.MathUtils.smoothstep(Math.hypot(player.pos.x - gate.x, player.pos.z - gate.z), 3, def.exit.reach);
      scene.fog?.color.lerpColors(fogNight, fogPink, near * 0.45);
      gate.update(t, near);
    },
  };
}

// The way out: two huge trunks either side of the end of the path, and between them a
// glimpse of level 2 (its pink sky over red grass) glowing into the dark.
async function exitGate(def, heightAt, glimpse) {
  const pts = def.path.points;
  const [ex, ez] = pts.at(-1), [px, pz] = pts.at(-2);
  const len = Math.hypot(ex - px, ez - pz);
  const dx = (ex - px) / len, dz = (ez - pz) / len; // the way he walks in
  const nx = -dz, nz = dx;
  const { gap, trunkRadius: R } = def.exit;
  const x = ex + dx * 2.5, z = ez + dz * 2.5; // the middle of the gap, as far as he can walk
  const trunks = [-1, 1].map((side) => ({
    x: x + nx * side * (gap / 2 + R), z: z + nz * side * (gap / 2 + R), y: heightAt(x, z) - 0.5,
    radius: R, height: 45, yaw: 0, lean: 0.07, leanDir: Math.atan2(-nz * side, -nx * side),
    card: false, tint: 1.1, art: 0, near: true, t: 1e3,
  }));

  const light = new THREE.Group();
  const y = heightAt(x, z);
  // Level 2 seen through the gap, painted from its own art: pink sky, a cloud, the dark
  // peaks on the horizon (about at eye height from the gap) and the red grass.
  const view = new THREE.Mesh(new THREE.PlaneGeometry(18, 22.5), new THREE.MeshBasicMaterial({ map: glimpse, fog: false }));
  view.position.set(x + dx * 7, heightAt(x + dx * 7, z + dz * 7) - 0.3 + 11.25, z + dz * 7); // its bottom edge just under the ground
  view.rotation.y = Math.atan2(-dx, -dz);
  // Glow in the gap, spilling round the trunks' edges and onto the ground toward him.
  const pink = (a) => glowTexture([[0, `rgba(255,190,215,${a})`], [0.45, `rgba(255,140,190,${a * 0.35})`], [1, 'rgba(255,120,180,0)']]);
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false };
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: pink(0.7), ...additive }));
  halo.scale.set(10, 16, 1);
  halo.position.set(x - dx * 2.6, y + 3.5, z - dz * 2.6); // in front of the trunks, so it glows over them
  // Its red grass carries on over the ground beyond the gap, fading in from his feet.
  const fade = canvas(1, 16);
  const fg = fade.getContext('2d');
  const ramp = fg.createLinearGradient(0, 0, 0, 16);
  ramp.addColorStop(0, '#000');
  ramp.addColorStop(0.5, '#fff');
  ramp.addColorStop(1, '#fff');
  fg.fillStyle = ramp;
  fg.fillRect(0, 0, 1, 16);
  const grassGeo = new THREE.PlaneGeometry(12, 7.4, 6, 4).rotateX(-Math.PI / 2).rotateY(Math.atan2(dx, dz)).translate(x + dx * 3.5, 0, z + dz * 3.5);
  const grass = new THREE.Mesh(drape(grassGeo, heightAt, 0.03), new THREE.MeshBasicMaterial({
    map: await loadTexture(def.exit.glimpse.grass, [2, 2]), alphaMap: crunchy(fade), transparent: true, depthWrite: false, fog: false,
  }));
  const spillGeo = new THREE.PlaneGeometry(9, 14, 6, 10).rotateX(-Math.PI / 2).rotateY(Math.atan2(dx, dz)).translate(x - dx * 4, 0, z - dz * 4);
  const spill = new THREE.Mesh(drape(spillGeo, heightAt, 0.05), new THREE.MeshBasicMaterial({ map: pink(0.7), ...additive }));
  light.add(view, grass, halo, spill);

  return {
    x, z, trunks, light,
    keepClear: [[x, z, 6.5], [x + dx * 7, z + dz * 7, 10]],
    update(t, near) {
      const breathe = 0.75 + 0.12 * Math.sin(t * 0.8) + 0.05 * Math.sin(t * 3.1);
      halo.material.opacity = breathe * (0.6 + 0.4 * near);
      spill.material.opacity = breathe * (0.4 + 0.6 * near);
    },
  };
}

// 256 x 320 pixels over 18 x 22.5 metres, standing on the ground: row 291 is about at his
// eye height seen from the gap, so that is where the horizon goes.
async function paintGlimpse(art) {
  const W = 256, H = 320, h = 291;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.drawImage(await loadImage(art.sky), 30, 0, 196, 157, 0, 0, W, h + 4);
  g.drawImage(await loadImage(art.cloud), 20, h - 120, 200, 80);
  g.drawImage(await loadImage(art.peaks), 100, 0, 300, 56, 0, h - 44, W, 46);
  // haze toward the horizon, like the fog of level 2
  const haze = g.createLinearGradient(0, h - 150, 0, h);
  haze.addColorStop(0, 'rgba(255,215,228,0)');
  haze.addColorStop(1, 'rgba(255,215,228,0.5)');
  g.fillStyle = haze;
  g.fillRect(0, h - 150, W, 150);
  g.drawImage(await loadImage(art.grass), 0, 0, 128, 40, 0, h - 2, W, H - h + 2);
  return crunchy(c);
}

// The far wall of trees (the whole painting, wrapped round and mirrored so it never
// shows a seam) and the woven canopy above. It moves with the camera, so it is always
// as far away as the sky.
async function buildBackdrop(b, fogColor) {
  const img = await loadImage(b.wall);
  const c = grade(toCanvas(img, ...b.crop), [1, 1, b.brightness, 0]);
  const g = c.getContext('2d');
  const fade = g.createLinearGradient(0, 0, 0, c.height);
  fade.addColorStop(0, '#000');
  fade.addColorStop(0.3, 'rgba(0,0,0,0)');
  fade.addColorStop(0.45, `${fogColor}00`);
  fade.addColorStop(0.72, fogColor); // melts into the fog toward the bottom
  fade.addColorStop(1, fogColor);
  g.fillStyle = fade;
  g.fillRect(0, 0, c.width, c.height);
  const wallTex = crunchy(c);
  wallTex.wrapS = THREE.MirroredRepeatWrapping;
  wallTex.repeat.set(b.repeat, 1);
  const flat = { fog: false, depthWrite: false };
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(b.radius, b.radius, b.height, 32, 1, true),
    new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide, ...flat }),
  );
  wall.position.y = b.height / 2 - b.below;
  // The canopy darkens toward its rim, where it meets the black top of the wall.
  const disc = new THREE.CircleGeometry(b.radius, 32);
  const rim = disc.attributes.position;
  const shade = [];
  for (let i = 0; i < rim.count; i++) shade.push(...new Array(3).fill(b.canopyBright * Math.max(0, 1 - Math.hypot(rim.getX(i), rim.getY(i)) / b.radius) ** 0.7));
  disc.setAttribute('color', new THREE.Float32BufferAttribute(shade, 3));
  const canopy = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ map: await loadTexture(b.canopy, b.canopyRepeat), vertexColors: true, ...flat }));
  canopy.rotation.x = Math.PI / 2; // facing down
  canopy.position.y = b.height - b.below;
  wall.renderOrder = canopy.renderOrder = -10; // drawn first, behind everything
  const backdrop = new THREE.Group();
  backdrop.add(wall, canopy);
  return backdrop;
}

// Tufts of dark grass along the path: crossed cards of thin blades, painted here.
async function buildGrass(def, path, heightAt, r) {
  const c = canvas(32, 16);
  const g = c.getContext('2d');
  for (let i = 0; i < 18; i++) {
    g.strokeStyle = def.colors[Math.floor(r() * def.colors.length)];
    g.beginPath();
    const x = 2 + r() * 28;
    g.moveTo(x, 16);
    g.lineTo(x + (r() - 0.5) * 8, 2 + r() * 9);
    g.stroke();
  }
  const geos = [];
  for (const s of walkPath(path.points, def.spacing)) {
    for (let k = 0; k < 2; k++) {
      const off = (r() < 0.5 ? -1 : 1) * (def.from + r() * (def.to - def.from));
      const x = s.x + s.nx * off + (r() - 0.5) * 2, z = s.z + s.nz * off + (r() - 0.5) * 2;
      const size = 0.5 + r() * 0.5;
      const a = r() * Math.PI;
      for (const turn of [0, Math.PI / 2]) {
        geos.push(new THREE.PlaneGeometry(size * 1.4, size * 0.7).translate(0, size * 0.33, 0).rotateY(a + turn).translate(x, heightAt(x, z), z));
      }
    }
  }
  const mat = new THREE.MeshLambertMaterial({ map: crunchy(c), alphaTest: 0.5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
  for (const geo of geos) geo.dispose();
  return mesh;
}
