import * as THREE from 'three';
import { EYE } from './player.js';
import { showMessage, showPrompt, showHint } from './hud.js';
import { createNightVision } from './nightvision.js';

// Admin mode, for working on the levels. main.js only loads this module when the page's
// address has ?admin, so the public game never sees it. ` (backquote) turns it on and off.
// While it is on GoatMan flies: no gravity, nothing is solid, the story waits, and a box in
// the top right shows where the camera is, ready to copy into levels.json.
//   W/S fly along the view, A/D sideways, Space up, C or Q down, Shift 4x, wheel: speed
//   1 2 3 forest, field, savanna · 4 the finale · F fog · T night (savanna) · Y petted
//   H hide the HUD and arms · K copy the position
// N night vision (the forest), flying or not.

const SPEEDS = [2, 5, 10, 20, 40]; // metres a second, picked with the mouse wheel
const LEVELS = { Digit1: 'forest', Digit2: 'field', Digit3: 'savanna' };
const UP = new THREE.Vector3(0, 1, 0);
const deg = (rad) => Math.round(THREE.MathUtils.radToDeg(Math.atan2(Math.sin(rad), Math.cos(rad))));
const fixed = (v) => Math.round(v * 10) / 10;

export function createAdmin({ renderer, scene, camera, head, controls, keys, player, levels, gm, arms, view, story, playing }) {
  const box = document.createElement('div');
  box.id = 'admin';
  box.className = 'box hidden';
  document.getElementById('hud').append(box);
  renderer.info.autoReset = false; // the world and the arms are two renders: count both
  const nightVision = createNightVision({ renderer, scene, levels });

  let on = false;
  let speed = 2; // index into SPEEDS
  let fogOff = false;
  let clean = false; // HUD and arms hidden for screenshots
  let night = null; // the savanna's clock before T made it night
  let fps = 60, calls = 0;
  const vel = new THREE.Vector3(), want = new THREE.Vector3();
  const fwd = new THREE.Vector3(), side = new THREE.Vector3();
  const held = (...codes) => (codes.some((c) => keys[c]) ? 1 : 0);

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

  addEventListener('keydown', (e) => {
    if (!playing() || e.repeat) return;
    if (e.code === 'Backquote') {
      if (on) stop(); else start();
      return;
    }
    if (e.code === 'KeyN') nightVision.toggle();
    if (!on) return;
    if (LEVELS[e.code]) { night = null; levels.go(LEVELS[e.code]); }
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
      renderer.info.reset();
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
        `${Math.round(fps)} FPS · ${calls} DRAW CALLS`,
        '1 2 3 LEVELS · 4 FINALE · F FOG · T NIGHT',
        `Y PETTED · H HIDE · K COPY${nightVision.here ? ' · N NIGHT VISION' : ''} · \` OFF`,
      ].join('\n');
    },
  };
}
