import * as THREE from 'three';
import { loadSheet, rng } from './textures.js';
import { sfx } from './sfx.js';
import { subtitle } from './hud.js';
import { pushOut } from './player.js';
import { creatureParts } from './bushes-body.js';
import { showFrame } from './bushes-paint.js';

// The striped creatures with eyes (the "bushes" of savanaScene.mp4): lumpy heaps wearing
// their painting (bushes-body.js), each with a few babies. They breathe, creep through the
// grass in slow waves, stop to watch GoatMan when he comes near (the head turning to follow
// him) and shuffle off if he comes at them too fast or a pebble hits one. The babies,
// smaller, rounder and paler, trail behind in a loose line, potter about when it stops,
// hurry wobbling to catch up and run off with it; a pebble on a baby makes the grown one
// turn on GoatMan. The grown ones murmur and purr, the babies chirp.
//
// levels.json "bushes": { at: [[x, z], ...], roam, length, radius, speed, notice, wary,
//   closing (m/s toward one that makes it run), personal, flee: [speed, seconds],
//   babies: [min, max], babyScale: [min, max], follow (metres apart in the line),
//   catchUp (a baby's hurrying speed) }

const TURN = 1.2; // radians a second at most
const LOOK = 0.55; // how far the head turns to watch
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;
const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Their skin, with a few lines added to the shader: it swells a little with each breath
// and, creeping, a wave of swelling runs along it to the head.
function alive(mat, u) {
  mat.customProgramCacheKey = () => 'creature';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uWave, uBreath, uCreep;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.xy *= 1.0 + uBreath + uCreep * 0.07 * sin(transformed.z * 2.2 + uWave);`);
  };
  return mat;
}

// wet(x, z): water they keep out of when they drift about (they still cross it, running off).
export async function createBushes(d, { heightAt, camera, player, avoid, wet = () => false }) {
  const parts = creatureParts(await loadSheet('assets/savanna/cret'), d.length, 0.06);
  const group = new THREE.Group();
  const right = new THREE.Vector3(), v = new THREE.Vector3();
  const r = rng(7);

  // One creature (grown, or a baby: smaller, rounder and paler).
  function make(x, z, heading, scale, baby) {
    const u = { uWave: { value: 0 }, uBreath: { value: 0 }, uCreep: { value: 0 } };
    const map = (baby ? parts.babyTexture : parts.texture).clone(); // its own frame of the shared paint
    // A little of their own colour unlit, so the stripes stay bright in the dusk.
    const skin = alive(new THREE.MeshLambertMaterial({ map, emissiveMap: map, emissive: 0x8a8a8a, flatShading: true }), u);
    const ink = alive(new THREE.MeshBasicMaterial({ color: 0x2a0c1e, side: THREE.BackSide }), u);
    const back = new THREE.Mesh(parts.back, skin), face = new THREE.Mesh(parts.head, skin);
    const eyes = new THREE.Mesh(parts.eyes, new THREE.MeshBasicMaterial({ map: parts.eyeMap }));
    eyes.position.y = parts.eyeY;
    const head = new THREE.Group();
    head.add(face, new THREE.Mesh(parts.headLine, ink), eyes);
    const c = {
      group: new THREE.Group(), head, eyes, u, map, skin, baby, scale,
      pos: new THREE.Vector3(x, heightAt(x, z), z), heading, speed: 0, look: 0,
      size: (baby ? 0.5 : 0.45) * d.length * scale, // how far its middle keeps from things
      frame: Math.random() * 4, rolled: 0, breath: Math.random() * 6, puff: 1.3,
      blink: rnd(1, 6), shut: 0, wobble: 0,
      near: null, closing: 0, sound: rnd(4, 12),
    };
    c.group.add(back, new THREE.Mesh(parts.backLine, ink), head);
    c.group.scale.set(scale * (baby ? 1.12 : 1), scale * (baby ? 1.1 : 1), scale * (baby ? 0.88 : 1));
    for (const mesh of [back, face]) mesh.userData.onRock = (hit) => hitBy(c, hit.point);
    group.add(c.group);
    return c;
  }

  const adults = d.at.map(([x, z]) => {
    const b = make(x, z, Math.random() * Math.PI * 2, 1, false);
    Object.assign(b, {
      home: new THREE.Vector3(x, 0, z), mode: 'drift', // drift | watch | flee | guard
      target: null, rest: rnd(0, 4), fleeing: 0, guarding: 0, rustle: 0,
      colliders: [parts.backZ, parts.headZ].map(() => ({ kind: 'circle', x, z, r: d.radius })),
      babies: [],
    });
    const n = d.babies[0] + Math.floor(r() * (d.babies[1] - d.babies[0] + 1));
    for (let i = 0; i < n; i++) {
      const back = d.length * 0.6 + d.follow * (i + 1);
      const k = make(x + Math.sin(b.heading) * back, z + Math.cos(b.heading) * back, b.heading,
        THREE.MathUtils.lerp(...d.babyScale, r()), true);
      Object.assign(k, {
        parent: b, leader: i ? b.babies[i - 1] : b, wander: new THREE.Vector3(), potter: rnd(1, 4), scared: 0,
        collider: { kind: 'circle', x: k.pos.x, z: k.pos.z, r: d.radius * k.scale * 1.1 },
      });
      b.babies.push(k);
    }
    return b;
  });
  const babies = adults.flatMap((b) => b.babies);
  const colliders = [...adults.flatMap((b) => b.colliders), ...babies.map((k) => k.collider)];

  // Left (-1) to right (1) of the camera, and quieter further away.
  function pan(p) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const dx = p.x - camera.position.x, dz = p.z - camera.position.z;
    return clamp((dx * right.x + dz * right.z) / (Math.hypot(dx, dz) || 1), -1, 1);
  }
  const loud = (c) => clamp(1.3 - Math.hypot(camera.position.x - c.pos.x, camera.position.z - c.pos.z) / 35, 0.05, 1);
  const facing = (c, p) => Math.atan2(-(p.x - c.pos.x), -(p.z - c.pos.z));

  function flee(b, from) {
    b.mode = 'flee';
    b.fleeing = d.flee[1];
    b.target = null;
    b.want = facing(b, from) + Math.PI + rnd(-0.4, 0.4); // away
    b.rustle = 0;
    subtitle('[something rushes off through the grass]', 2.5, 10);
  }
  // A pebble: a grown one runs off; a baby squeaks and runs to it, and it turns on GoatMan.
  function hitBy(c, point) {
    if (!c.baby) { flee(c, point); return; }
    c.scared = 2.5;
    sfx.chirp(pan(c.pos), loud(c) * 1.4, 4);
    subtitle('[the baby squeals]', 2);
    const b = c.parent;
    if (b.mode === 'flee') return;
    b.mode = 'guard';
    b.guarding = 5;
    sfx.murmur(pan(b.pos), loud(b) * 1.8, true);
    subtitle('[the baby squeals and the striped creature turns on you, rumbling]', 3);
  }

  // Turns smoothly toward a heading; true when it is roughly facing that way.
  function turn(c, want, dt, rate = TURN) {
    const diff = angle(want - c.heading);
    c.heading += clamp(diff * Math.min(1, dt * 2), -rate * dt, rate * dt);
    return Math.abs(diff) < 0.4;
  }
  function drift(b, dt) {
    if (!b.target || Math.hypot(b.target.x - b.pos.x, b.target.z - b.pos.z) < 1) {
      b.target = null;
      b.rest -= dt;
      if (b.rest > 0) return 0;
      const a = Math.random() * Math.PI * 2, dist = Math.sqrt(Math.random()) * d.roam;
      const x = b.home.x + Math.cos(a) * dist, z = b.home.z + Math.sin(a) * dist;
      if (wet(x, z)) return 0; // somewhere else next time
      b.target = new THREE.Vector3(x, 0, z);
      b.rest = rnd(2, 7);
    }
    return turn(b, facing(b, b.target), dt) ? d.speed : d.speed * 0.3;
  }

  // A grown one: what it does next, and how fast it wants to go.
  function think(b, dt) {
    const near = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
    if (b.near !== null) b.closing += ((b.near - near) / dt - b.closing) * Math.min(1, dt * 4);
    b.near = near;
    b.look = 0;
    if (b.mode === 'watch' && near > d.notice * 1.3) b.mode = 'drift';
    const rushed = near < d.personal || (near < d.wary && b.closing > d.closing);
    if (b.mode !== 'flee' && b.mode !== 'guard' && rushed) flee(b, player.pos);
    else if (b.mode === 'drift' && near < d.notice) {
      b.mode = 'watch';
      b.target = null;
      sfx.murmur(pan(b.pos), loud(b));
      subtitle('[the striped creature purrs]', 2);
    }

    if (b.mode === 'flee') {
      b.fleeing -= dt;
      b.rustle -= dt;
      if (b.rustle <= 0) { sfx.rustle(pan(b.pos), loud(b)); b.rustle = 0.45; }
      if (b.fleeing <= 0) { b.mode = 'drift'; b.home.copy(b.pos); b.rest = rnd(2, 5); } // settles where it ran to
      turn(b, b.want, dt, TURN * 2);
      return d.flee[0];
    }
    if (b.mode === 'watch' || b.mode === 'guard') {
      const to = facing(b, player.pos);
      b.look = clamp(angle(to - b.heading), -LOOK, LOOK); // the head follows him
      if (b.mode === 'guard') {
        turn(b, to, dt, TURN * 1.5);
        b.sound -= dt;
        if (b.sound <= 0) { sfx.murmur(pan(b.pos), loud(b) * 1.5, true); b.sound = rnd(1.5, 2.5); }
        if ((b.guarding -= dt) <= 0) b.mode = near < d.notice ? 'watch' : 'drift';
      } else if (Math.abs(angle(to - b.heading)) > LOOK) turn(b, to, dt, TURN * 0.5); // shuffles round to keep him in view
      return 0;
    }
    // Drifting about, now and then a murmur to itself.
    b.sound -= dt;
    if (b.sound <= 0) {
      if (near < 45) {
        sfx.murmur(pan(b.pos), loud(b) * 0.6);
        subtitle('[a low murmur in the grass]', 2.5, 30);
      }
      b.sound = rnd(8, 18);
    }
    return drift(b, dt);
  }

  // A baby: its place in the line behind the one in front, wandering a little from it when
  // they have stopped; how fast it wants to go to get there.
  function trail(k, dt) {
    const lead = k.leader, b = k.parent;
    k.potter -= dt;
    if (k.potter <= 0) {
      k.potter = rnd(2, 5);
      const a = Math.random() * Math.PI * 2, far = b.speed < 0.2 ? rnd(0.5, 2) : rnd(0, 0.6);
      k.wander.set(Math.cos(a) * far, 0, Math.sin(a) * far);
    }
    const gap = (lead.baby ? 0 : d.length * 0.5) + d.follow;
    v.set(Math.sin(lead.heading), 0, Math.cos(lead.heading)).multiplyScalar(gap).add(lead.pos).add(k.wander);
    if (k.scared > 0) { k.scared -= dt; v.copy(b.pos); } // straight to it
    const dist = Math.hypot(v.x - k.pos.x, v.z - k.pos.z);
    const hurry = b.mode === 'flee' || k.scared > 0;
    let want = clamp((dist - 0.4) * 0.9, 0, d.catchUp);
    if (hurry) want = Math.max(want, d.flee[0] * 1.05);
    turn(k, facing(k, v), dt, TURN * 2.5);
    k.wobble += ((want > b.speed + 0.4 ? 1 : 0) - k.wobble) * Math.min(1, dt * 4); // hurrying: a wobbly waddle
    // Curious: it looks at GoatMan when he is close, otherwise at the one it follows.
    const watching = Math.hypot(player.pos.x - k.pos.x, player.pos.z - k.pos.z) < d.notice * 0.6;
    k.look = clamp(angle(facing(k, watching ? player.pos : lead.pos) - k.heading), -LOOK, LOOK);
    k.sound -= dt * (k.wobble > 0.5 ? 3 : 1);
    if (k.sound <= 0) {
      if (loud(k) > 0.1) {
        sfx.chirp(pan(k.pos), loud(k) * (watching ? 1 : 0.6));
        subtitle('[small chirps in the grass]', 2, 30);
      }
      k.sound = rnd(5, 12);
    }
    return want;
  }

  function move(c, want, dt, keepOff) {
    c.speed += (want - c.speed) * Math.min(1, dt * 3);
    c.pos.x -= Math.sin(c.heading) * c.speed * dt;
    c.pos.z -= Math.cos(c.heading) * c.speed * dt;
    pushOut(c.pos, keepOff, c.size);
    c.pos.y = heightAt(c.pos.x, c.pos.z);
    c.rolled += c.speed * dt;
  }

  // Into place: breathing (faster after running), the creeping wave, the head turning to
  // look, blinking, the painting boiling, a hurrying baby's waddle.
  function pose(c, dt, dim) {
    const pace = c.speed / d.speed, fleeing = (c.baby ? c.parent : c).mode === 'flee';
    c.puff += ((fleeing ? 3.5 : c.baby ? 2.2 : 1.3) - c.puff) * Math.min(1, dt * 0.5);
    c.breath += dt * c.puff;
    c.u.uBreath.value = (c.baby ? 0.035 : 0.025) * Math.sin(c.breath);
    c.u.uCreep.value = Math.min(1.5, pace);
    c.u.uWave.value = c.rolled * 2.4 / c.scale;
    c.head.rotation.y += (c.look - c.head.rotation.y) * Math.min(1, dt * 3);
    if ((c.blink -= dt) <= 0) { c.blink = rnd(2.5, 7); c.shut = 0.14; }
    c.shut -= dt;
    const shut = c.shut > 0;
    c.eyes.material.map = shut ? parts.lidMap : parts.eyeMap; // the dark lids close over them
    c.eyes.scale.y = shut ? 0.85 : 1;
    c.eyes.material.color.setScalar(dim);
    c.skin.emissiveIntensity = dim;
    c.frame += dt * (fleeing ? 10 : c.speed > 0.2 ? 5 : 1.5);
    showFrame(c.map, Math.floor(c.frame) % 4);
    const waddle = Math.sin(c.rolled * 7 / c.scale);
    c.group.position.set(c.pos.x, c.pos.y + c.wobble * Math.abs(waddle) * 0.25 * c.scale, c.pos.z);
    c.group.rotation.set(0, c.heading, c.wobble * waddle * 0.14, 'YXZ');
  }

  return {
    group,
    colliders,
    targets: [...adults, ...babies].flatMap((c) => [c.group.children[0], c.head.children[0]]), // pebbles hit them
    // dim: how much the dusk has darkened the level (1 = not at all).
    update(dt, dim = 1) {
      for (const b of adults) {
        move(b, think(b, dt), dt, [...avoid, ...adults.filter((o) => o !== b).flatMap((o) => o.colliders)]);
        [parts.backZ, parts.headZ].forEach((z, i) => {
          b.colliders[i].x = b.pos.x + Math.sin(b.heading) * z;
          b.colliders[i].z = b.pos.z + Math.cos(b.heading) * z;
        });
      }
      for (const k of babies) {
        move(k, trail(k, dt), dt, [...avoid, ...k.parent.colliders, ...babies.filter((o) => o !== k).map((o) => o.collider)]);
        k.collider.x = k.pos.x;
        k.collider.z = k.pos.z;
      }
      for (const c of [...adults, ...babies]) pose(c, dt, dim);
    },
  };
}
