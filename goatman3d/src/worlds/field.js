import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTerrain } from '../terrain.js';
import { loadImage, loadTexture, canvas, crunchy, grade, rng } from '../textures.js';
import { barkTrunks } from './trunks.js';
import { buildSkyDome, buildSkyline } from './horizon.js';
import { createWalkingThing } from '../walkingthing.js';

// Level 2, the red field, from Charlie's layered painting (WALKYBOY/): its layers pulled
// apart into real depth. The BACKGROUND pink is the sky dome, GROUND's dark peaks ring the
// horizon as low-poly mountains, BACKCLOUDS drift slowly far up and frontclouds faster
// lower down, and the red grass runs off to the peaks under GoatMan, who is small here:
// the Walking Thing towers over him. Behind him, the two trunks he came through stand
// alone in the field with the night still between them.

export async function buildField(def, { scene, camera, player }) {
  const group = new THREE.Group();
  const r = rng(def.seed);

  const floor = await loadTexture(def.terrain.texture, 1);
  const groundMat = new THREE.MeshLambertMaterial({ map: floor, flatShading: true, color: new THREE.Color(...def.terrain.tint) });
  const { mesh: ground, heightAt } = buildTerrain(def.terrain, groundMat);
  group.add(ground);

  const sky = await buildSkyDome(def.skyDome, def.fog.color);
  const clouds = await buildClouds(def.clouds, r);
  group.add(sky, await buildSkyline(def.peaks, heightAt), clouds.group, ...(await buildGrass(def.grass, heightAt, r)));

  const gate = await buildGate(def.gate, heightAt);
  group.add(...gate.meshes);

  const thing = await createWalkingThing(def.walkingThing, { heightAt, camera, player });
  group.add(thing.group);

  return {
    group,
    ground: [ground],
    colliders: [{ kind: 'ring', x: 0, z: 0, r: def.bounds }, ...gate.colliders, ...thing.colliders],
    blockers: gate.blockers,
    actors: { walkingThing: thing },
    heightAt,
    update(dt) {
      sky.position.copy(camera.position); // always as far away
      clouds.update(dt);
      thing.update(dt);
    },
  };
}

// Two heights of painted cloud cards drifting on the wind: BACKCLOUDS far up and slow,
// frontclouds lower and faster. Sprites, so they always face him, cut out with alphaTest.
async function buildClouds(d, r) {
  const group = new THREE.Group();
  const drifting = [];
  for (const layer of [d.far, d.near]) {
    const mats = [];
    for (let i = 1; i <= layer.cards; i++) {
      const map = await loadTexture(`${layer.art}${i}.png`);
      // opaque cut-outs (not see-through), so the squash's darkness covers them too
      mats.push({ mat: new THREE.SpriteMaterial({ map, alphaTest: 0.5, transparent: false, fog: false, color: new THREE.Color(layer.tint) }), aspect: map.image.height / map.image.width });
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
    update(dt) {
      for (const { cloud, speed, radius } of drifting) {
        const p = cloud.position;
        p.x += (wx / len) * speed * dt;
        p.z += (wz / len) * speed * dt;
        // gone past the far side: back in on the near side
        if (Math.hypot(p.x, p.z) > radius && p.x * wx + p.z * wz > 0) { p.x = -p.x; p.z = -p.z; }
      }
    },
  };
}

// Tufts of red grass and the painting's little black sprouts, scattered over the field
// as crossed cards, merged into one mesh per patch of ground.
async function buildGrass(d, heightAt, r) {
  const c = canvas(48, 16);
  const g = c.getContext('2d');
  for (let i = 0; i < 22; i++) { // blades, in the field's reds
    g.strokeStyle = d.colors[Math.floor(r() * d.colors.length)];
    g.beginPath();
    const x = 2 + r() * 28;
    g.moveTo(x, 16);
    g.lineTo(x + (r() - 0.5) * 9, 1 + r() * 9);
    g.stroke();
  }
  g.strokeStyle = d.sprout; // a sprout: a stem with leaves going up and out
  g.beginPath();
  g.moveTo(40, 16);
  g.lineTo(40, 2);
  for (const [y, w] of [[5, 3], [9, 4], [13, 3]]) {
    g.moveTo(40, y + 1);
    g.lineTo(40 - w, y - 1);
    g.moveTo(40, y + 1);
    g.lineTo(40 + w, y - 1);
  }
  g.stroke();
  const tuft = [0, 32 / 48], sprout = [32 / 48, 1];

  const patches = new Map();
  const card = (x, z, w, h, [u0, u1], turn) => {
    const geo = new THREE.PlaneGeometry(w, h).translate(0, h / 2 - 0.05, 0).rotateY(turn).translate(x, heightAt(x, z), z);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + (u1 - u0) * uv.getX(i));
    const key = `${Math.floor(x / d.patch)},${Math.floor(z / d.patch)}`;
    if (!patches.has(key)) patches.set(key, []);
    patches.get(key).push(geo);
  };
  const place = (count, size, art) => {
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, dist = Math.sqrt(r()) * d.radius;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      const s = size[0] + r() * (size[1] - size[0]);
      const turn = r() * Math.PI;
      card(x, z, art === tuft ? s * 1.6 : s * 0.55, s, art, turn);
      card(x, z, art === tuft ? s * 1.6 : s * 0.55, s, art, turn + Math.PI / 2);
    }
  };
  place(d.tufts, d.tuftSize, tuft);
  place(d.sprouts, d.sproutSize, sprout);
  const mat = new THREE.MeshLambertMaterial({ map: crunchy(c), alphaTest: 0.5, side: THREE.DoubleSide });
  const meshes = [];
  for (const geos of patches.values()) {
    meshes.push(new THREE.Mesh(mergeGeometries(geos), mat));
    for (const geo of geos) geo.dispose();
  }
  return meshes;
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
