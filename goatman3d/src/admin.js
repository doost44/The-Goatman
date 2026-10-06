import * as THREE from 'three';
import { EYE } from './player.js';
import { showMessage, showPrompt, showHint } from './hud.js';
import { createNightVision } from './nightvision.js';
import { createMap } from './adminmap.js';

// Admin mode, for working on the levels. main.js only loads this module when the page's
// address has ?admin, so the public game never sees it. ` (backquote) turns it on and off.
// While it is on GoatMan flies: no gravity, nothing is solid, the story waits, and a box in
// the top right shows where the camera is, ready to copy into levels.json.
//   W/S fly along the view, A/D sideways, Space up, C or Q down, Shift 4x, wheel: speed
//   1 2 3 forest, field, savanna · 4 the finale · F fog · T night (savanna) · Y petted
//   H hide the HUD and arms · K copy the position · 5 the big-world test level
// Flying or not: N night vision (the forest), M the map, [ and ] the level's places.
// The box also shows the frame rate, draw calls and triangles, what the graphics card holds
// (geometries, textures), the page's memory and, in big levels, the terrain chunks built.

const SPEEDS = [2, 5, 10, 20, 40]; // metres a second, picked with the mouse wheel
const LEVELS = { Digit1: 'forest', Digit2: 'field', Digit3: 'savanna', Digit5: 'expanse' };
const UP = new THREE.Vector3(0, 1, 0);
const deg = (rad) => Math.round(THREE.MathUtils.radToDeg(Math.atan2(Math.sin(rad), Math.cos(rad))));
const fixed = (v) => Math.round(v * 10) / 10;
const kilo = (n) => (n >= 1e4 ? `${Math.round(n / 1000)}K` : `${n}`);

export function createAdmin({ renderer, scene, camera, head, controls, keys, player, levels, gm, arms, view, story, playing }) {
  const box = document.createElement('div');
  box.id = 'admin';
  box.className = 'box hidden';
  document.getElementById('hud').append(box);
  renderer.info.autoReset = false; // the world and the arms are two renders: count both
  const nightVision = createNightVision({ renderer, scene, levels });
  const map = createMap(document.getElementById('hud'));

  let on = false;
  let speed = 2; // index into SPEEDS
  let fogOff = false;
  let clean = false; // HUD and arms hidden for screenshots
  let night = null; // the savanna's clock before T made it night
  let fps = 60, calls = 0, triangles = 0;
  let place = -1; // which of the level's places [ and ] last went to
  const vel = new THREE.Vector3(), want = new THREE.Vector3();
  const fwd = new THREE.Vector3(), side = new THREE.Vector3();
  const held = (...codes) => (codes.some((c) => keys[c]) ? 1 : 0);

  // What the graphics card holds (renderer.info.memory counts geometries and textures it
  // has been given and not yet freed), the page's JavaScript memory (Chrome only), and the
  // terrain chunks of a big level: drawn now, built and kept, the cache's limit, waiting.
  function memory() {
    const { geometries, textures } = renderer.info.memory;
    const heap = performance.memory ? ` · JS ${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB` : '';
    const lines = [`GPU ${geometries} GEOMETRIES · ${textures} TEXTURES${heap}`];
    const c = levels.world?.chunks?.stats;
    if (c) lines.push(`CHUNKS ${c.shown} DRAWN · ${c.cached}/${c.limit} KEPT${c.waiting ? ` · ${c.waiting} WAITING` : ''} · ${c.freed} FREED`);
    return lines;
  }

  // Off the Walking Thing's back, if he is on it: it stays where it is.
  function liftOff() {
    const mount = player.mount;
    player.mount = null;
    mount?.settle?.();
    gm.reset();
  }

  function start() {
    if (player.frozen || levels.busy || story.busy || story.cutscene) return; // not mid-scene
    on = true;
    liftOff();
    vel.set(0, 0, 0);
    view.forceFirst = true;
    showPrompt(null);
    showHint(null, 'ride');
  }

  // Back to walking: down onto the ground under the camera, or the level's respawn if
  // there is none (over the void). Under the ground, he comes up onto it.
  function stop() {
    on = false;
    view.forceFirst = false;
    gm.group.visible = true;
    setClean(false);
    if (fogOff) toggleFog();
    if (!player.level) return;
    const p = head.position, pitch = head.rotation.x, yaw = THREE.MathUtils.radToDeg(head.rotation.y);
    const ground = player.groundAt(p.x, p.z, p.y, 0.5, 3000) ?? player.groundAt(p.x, p.z, p.y + 1000, 0, 4000);
    player.place(ground === null ? player.level.respawn : [p.x, ground, p.z], yaw);
    head.rotation.x = pitch;
    gm.reset();
  }

  function toggleFog() {
    fogOff = !fogOff;
    const fog = levels.world && levels.def?.fog;
    if (!fogOff && fog && scene.fog) Object.assign(scene.fog, { near: fog.near, far: fog.far });
  }

  function setClean(c) {
    clean = c;
    document.body.classList.toggle('admin-clean', c);
    arms.visible = !c;
  }

  // T: the savanna's dusk jumps to full night, and back to where it was.
  function toggleNight() {
    const w = levels.world;
    if (levels.id !== 'savanna' || !w) return;
    if (night === null) { night = w.time; w.time = levels.def.dusk.time; } else { w.time = night; night = null; }
  }

  // K: the camera's position and yaw, as levels.json writes them.
  function copy() {
    const p = camera.position;
    const text = `"at": [${fixed(p.x)}, ${fixed(p.y)}, ${fixed(p.z)}], "yaw": ${deg(head.rotation.y)}`;
    navigator.clipboard?.writeText(text).then(() => showMessage(`COPIED ${text}`, 2), () => showMessage(text, 4));
    if (!navigator.clipboard) showMessage(text, 4); // no clipboard here: read it off the screen
  }

  // [ and ]: the level's places in turn (levels.json "places": name, at [x, z], yaw, up).
  // Flying, the camera goes there at eye height (plus `up`); walking, he stands there.
  function visit(step) {
    const list = levels.def?.places;
    if (!list?.length || !levels.world || levels.busy) return;
    place = (place + step + list.length) % list.length;
    const p = list[place];
    const [x, z] = p.at;
    const ground = player.groundAt(x, z, 1e4, 0, 2e4) ?? levels.world.heightAt?.(x, z) ?? 0;
    if (on) {
      head.position.set(x, ground + EYE + (p.up ?? 0), z);
      head.rotation.set(0, THREE.MathUtils.degToRad(p.yaw ?? 0), 0);
      vel.set(0, 0, 0);
    } else {
      player.place([x, ground, z], p.yaw ?? 0);
    }
    showMessage(`${place + 1}/${list.length} ${p.name.toUpperCase()}`, 2);
  }

  addEventListener('keydown', (e) => {
    if (!playing() || e.repeat) return;
    if (e.code === 'Backquote') {
      if (on) stop(); else start();
      return;
    }
    if (e.code === 'KeyN') nightVision.toggle();
    if (e.code === 'KeyM') map.toggle();
    if (e.code === 'BracketLeft') visit(-1);
    if (e.code === 'BracketRight') visit(1);
    if (!on) return;
    if (LEVELS[e.code]) { night = null; place = -1; levels.go(LEVELS[e.code]); }
    else if (e.code === 'Digit4') { stop(); story.run({ type: 'exit', to: 'finale' }); }
    else if (e.code === 'KeyF') toggleFog();
    else if (e.code === 'KeyT') toggleNight();
    else if (e.code === 'KeyY') { story.flags.petted = true; showMessage('PETTED: THE WAY ON IS OPEN', 2); }
    else if (e.code === 'KeyH') setClean(!clean);
    else if (e.code === 'KeyK') copy();
  });
  addEventListener('wheel', (e) => {
    if (on) speed = THREE.MathUtils.clamp(speed + (e.deltaY < 0 ? 1 : -1), 0, SPEEDS.length - 1);
  }, { passive: true });

  return {
    get on() { return on; },
    nightVision, // main.js draws the frame through it
    // Instead of player.update while it is on: fly where he looks.
    fly(dt) {
      if (player.mount && !levels.busy) liftOff(); // a level that starts on the Walking Thing's back
      want.set(0, 0, 0);
      if (controls.isLocked && !levels.busy) {
        fwd.set(0, 0, -1).applyQuaternion(head.quaternion);
        side.set(1, 0, 0).applyAxisAngle(UP, head.rotation.y);
        want.addScaledVector(fwd, held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown'));
        want.addScaledVector(side, held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft'));
        want.y += held('Space') - held('KeyC', 'KeyQ');
        if (want.lengthSq() > 1) want.normalize();
        want.multiplyScalar(SPEEDS[speed] * (held('ShiftLeft', 'ShiftRight') ? 4 : 1));
      }
      vel.lerp(want, Math.min(1, dt * 8)); // a little glide when starting and stopping
      head.position.addScaledVector(vel, dt);
      player.pos.copy(head.position).y -= EYE;
      player.vel.set(0, 0, 0);
      player.speed = 0;
      player.grounded = true;
    },
    // Every frame: the readout, and the fog kept off.
    update(dt) {
      nightVision.update(dt);
      calls = renderer.info.render.calls;
      triangles = renderer.info.render.triangles;
      renderer.info.reset();
      map.update(levels.def, levels.world, camera.position, head.rotation.y);
      if (on && !playing()) { on = false; view.forceFirst = false; setClean(false); fogOff = false; } // the story ended
      box.classList.toggle('hidden', !on);
      gm.group.visible = !on;
      if (!on) return;
      if (fogOff && scene.fog) Object.assign(scene.fog, { near: 1e5, far: 2e5 });
      fps += (1 / Math.max(dt, 1e-3) - fps) * Math.min(1, dt * 2);
      const p = camera.position;
      box.textContent = [
        `ADMIN · ${(levels.id ?? '-').toUpperCase()}`,
        `X ${fixed(p.x)}  Y ${fixed(p.y)}  Z ${fixed(p.z)}`,
        `YAW ${deg(head.rotation.y)}°  PITCH ${deg(head.rotation.x)}°`,
        `FLY ${SPEEDS[speed]} M/S${fogOff ? ' · NO FOG' : ''}${night !== null ? ' · NIGHT' : ''}`,
        `${Math.round(fps)} FPS · ${calls} DRAW CALLS · ${kilo(triangles)} TRIANGLES`,
        ...memory(),
        '1 2 3 LEVELS · 4 FINALE · 5 TEST · F FOG · T NIGHT',
        `Y PETTED · H HIDE · K COPY${nightVision.here ? ' · N NIGHT VISION' : ''}`,
        `M MAP · [ ] PLACES · \` OFF`,
      ].join('\n');
    },
  };
}
