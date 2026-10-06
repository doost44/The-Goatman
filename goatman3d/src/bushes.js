import * as THREE from 'three';
import { loadSheet } from './textures.js';
import { sfx } from './sound.js';
import { pushOut } from './player.js';

// The striped creatures with eyes (the "bushes" of savanaScene.mp4), from cret (side),
// cretb/creb (back) and cretc (front). Each is one painted card turned to face the camera,
// showing the drawing for the way it faces from where you look, and cycling that
// drawing's 4 frames. They roll and drift through the grass, stop and watch GoatMan when
// he comes near, and shuffle off if he comes at them too fast (or a pebble hits them).
//
// levels.json "bushes": { at: [[x, z], ...], roam, height, radius, speed, notice, wary,
//   closing (m/s toward one that makes it run), personal, flee: [speed, seconds] }

// Which way each drawing faces on the page: 1 right, -1 left.
const VIEWS = { cret: 1, cretb: -1, cretc: 1 };
const TURN = 1.2; // radians a second
const ROCK = 0.1; // how far a card rocks from side to side as it rolls along
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;

export async function createBushes(d, { heightAt, camera, player, avoid }) {
  const sheets = {};
  for (const name in VIEWS) sheets[name] = await loadSheet(`assets/savanna/${name}`);
  const group = new THREE.Group();
  const plane = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const right = new THREE.Vector3();

  const bushes = d.at.map(([x, z]) => {
    const textures = {};
    for (const name in VIEWS) textures[name] = sheets[name].texture();
    const mat = new THREE.MeshBasicMaterial({ map: textures.cret, alphaTest: 0.5, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(plane, mat);
    group.add(mesh);
    const b = {
      mesh, mat, textures,
      pos: new THREE.Vector3(x, heightAt(x, z), z),
      home: new THREE.Vector3(x, 0, z),
      heading: Math.random() * Math.PI * 2, // the way it faces: (-sin, -cos), like the Walking Thing
      speed: 0,
      mode: 'drift', // drift | watch | flee
      target: null,
      rest: rnd(0, 4), // seconds before it drifts somewhere else
      fleeing: 0, // seconds left running
      rustle: 0,
      chirp: rnd(4, 12),
      frame: Math.random() * 4,
      rolled: Math.random() * 10, // how far it has rolled (it rocks with it)
      near: null, closing: 0, // how far he is, and how fast he is coming
      collider: { kind: 'circle', x, z, r: d.radius },
    };
    mesh.userData.onRock = (hit) => flee(b, hit.point);
    return b;
  });
  const colliders = bushes.map((b) => b.collider);

  // Left (-1) to right (1) of the camera, and quieter further away.
  function pan(p) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const dx = p.x - camera.position.x, dz = p.z - camera.position.z;
    return clamp((dx * right.x + dz * right.z) / (Math.hypot(dx, dz) || 1), -1, 1);
  }
  const loud = (b) => clamp(1.3 - b.near / 35, 0.1, 1);

  function flee(b, from) {
    b.mode = 'flee';
    b.fleeing = d.flee[1];
    b.target = null;
    b.heading = Math.atan2(-(b.pos.x - from.x), -(b.pos.z - from.z)) + rnd(-0.4, 0.4); // away
    b.rustle = 0;
  }
  // Turns toward a point; true when it is roughly facing it.
  function turnToward(b, p, dt) {
    const want = Math.atan2(-(p.x - b.pos.x), -(p.z - b.pos.z));
    const diff = Math.atan2(Math.sin(want - b.heading), Math.cos(want - b.heading));
    b.heading += clamp(diff, -TURN * dt, TURN * dt);
    return Math.abs(diff) < 0.4;
  }
  function drift(b, dt) {
    if (!b.target || Math.hypot(b.target.x - b.pos.x, b.target.z - b.pos.z) < 1) {
      b.target = null;
      b.rest -= dt;
      if (b.rest > 0) return 0;
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * d.roam;
      b.target = new THREE.Vector3(b.home.x + Math.cos(a) * r, 0, b.home.z + Math.sin(a) * r);
      b.rest = rnd(2, 7);
    }
    return turnToward(b, b.target, dt) ? d.speed : d.speed * 0.3;
  }

  function think(b, dt) {
    const near = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
    if (b.near !== null) b.closing += ((b.near - near) / dt - b.closing) * Math.min(1, dt * 4);
    b.near = near;
    if (b.mode === 'watch' && near > d.notice * 1.3) b.mode = 'drift';
    const rushed = near < d.personal || (near < d.wary && b.closing > d.closing);
    if (b.mode !== 'flee' && rushed) flee(b, player.pos);
    else if (b.mode === 'drift' && near < d.notice) {
      b.mode = 'watch';
      b.target = null;
      sfx.trill(pan(b.pos), loud(b));
    }

    if (b.mode === 'flee') {
      b.fleeing -= dt;
      b.rustle -= dt;
      if (b.rustle <= 0) { sfx.rustle(pan(b.pos), loud(b)); b.rustle = 0.45; }
      if (b.fleeing <= 0) { b.mode = 'drift'; b.home.copy(b.pos); b.rest = rnd(2, 5); } // settles where it ran to
      return d.flee[0];
    }
    if (b.mode === 'watch') {
      turnToward(b, player.pos, dt);
      return 0;
    }
    // Drifting about, now and then a soft trill to itself.
    b.chirp -= dt;
    if (b.chirp <= 0) {
      if (near < 45) sfx.trill(pan(b.pos), loud(b) * 0.5);
      b.chirp = rnd(8, 18);
    }
    return drift(b, dt);
  }

  // Turned to face the camera, showing its front (cretc) when it faces the camera, its back
  // (cretb) when it faces away, its side (cret) otherwise: flipped to face the way it goes.
  function show(b, dim) {
    const tx = camera.position.x - b.pos.x, tz = camera.position.z - b.pos.z;
    const len = Math.hypot(tx, tz) || 1;
    const fx = -Math.sin(b.heading), fz = -Math.cos(b.heading);
    const toward = (fx * tx + fz * tz) / len;
    const name = toward > 0.6 ? 'cretc' : toward < -0.6 ? 'cretb' : 'cret';
    const sheet = sheets[name];
    b.mat.map = b.textures[name];
    sheet.setFrame(b.mat.map, Math.floor(b.frame));
    const goesRight = fx * tz - fz * tx > 0;
    const width = d.height * (sheet.frameW / sheet.frameH);
    const roll = Math.min(1, b.speed / d.speed);
    b.mesh.scale.set(width * (goesRight ? VIEWS[name] : -VIEWS[name]), d.height, 1);
    b.mesh.rotation.set(0, Math.atan2(tx, tz), Math.sin(b.rolled * 2.2) * ROCK * roll);
    b.mesh.position.set(b.pos.x, b.pos.y - 0.3 + Math.abs(Math.sin(b.rolled * 2.2)) * 0.2 * roll, b.pos.z);
    b.mat.color.setScalar(0.92 * dim);
  }

  return {
    group,
    colliders,
    targets: bushes.map((b) => b.mesh), // pebbles hit them
    // dim: how much the dusk has darkened the level (1 = not at all).
    update(dt, dim = 1) {
      for (const b of bushes) {
        const want = think(b, dt);
        b.speed += (want - b.speed) * Math.min(1, dt * 3);
        b.pos.x -= Math.sin(b.heading) * b.speed * dt;
        b.pos.z -= Math.cos(b.heading) * b.speed * dt;
        pushOut(b.pos, avoid, d.radius);
        pushOut(b.pos, colliders.filter((c) => c !== b.collider), d.radius);
        b.pos.y = heightAt(b.pos.x, b.pos.z);
        b.collider.x = b.pos.x;
        b.collider.z = b.pos.z;
        b.rolled += b.speed * dt;
        b.frame += dt * (b.mode === 'flee' ? 10 : b.speed > 0.2 ? 5 : 1.5);
        show(b, dim);
      }
    },
  };
}
