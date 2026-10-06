import * as THREE from 'three';
import { loadSave } from './save.js';
import { glowTexture, gradientTexture, rng } from './textures.js';

// The start screen: GoatMan floating in dark space, slowly turning, with the menu on the
// left (START, CONTINUE when a level was reached before, OPTIONS). It has its own little
// scene: sparse stars, slow drifting dust, one ambient light and one sun, and a faint
// glow of colour behind him. W/S or the arrow keys pick a button and Enter presses it.
// levels.json "space": { stars, dust, turn, bob, grade, ambient, sun, glow, fov, from, look }

const $ = (id) => document.getElementById(id);
const DUST = new THREE.Vector3(14, 9, 14); // the box the dust drifts round in, metres

export function createTitle({ renderer, levels, gm }) {
  const el = $('title');
  const more = $('continue');
  const d = levels.data.space;
  const r = rng(7);

  const scene = new THREE.Scene();
  scene.background = gradientTexture([[0, '#000000'], [0.6, '#03030a'], [1, '#0a0614']]);
  const camera = new THREE.PerspectiveCamera(d.fov, innerWidth / innerHeight, 0.1, 600);
  scene.add(new THREE.AmbientLight(d.ambient.color, d.ambient.intensity));
  const sun = new THREE.DirectionalLight(d.sun.color, d.sun.intensity);
  sun.position.fromArray(d.sun.dir);
  scene.add(sun);

  // Stars on a far sphere: many faint ones, a few bright.
  function stars(count, size, bright) {
    const pos = [], col = [];
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(300);
      pos.push(v.x, v.y, v.z);
      const c = new THREE.Color().setHSL(r() < 0.5 ? 0.62 : 0.95, 0.4, bright * (0.5 + 0.5 * r()));
      col.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true }));
  }
  const sky = new THREE.Group();
  sky.add(stars(d.stars, 1, 0.55), stars(Math.round(d.stars / 8), 2, 0.85));
  scene.add(sky);

  // Dust drifting slowly past him, wrapping round a box.
  const dustPos = new Float32Array(d.dust * 3);
  for (let i = 0; i < dustPos.length; i++) dustPos[i] = (r() - 0.5) * DUST.getComponent(i % 3);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 1, sizeAttenuation: false, color: 0x8a84a8 }));
  scene.add(dust);

  // A faint glow of colour behind him.
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, `rgba(${d.glow},0.35)`], [0.5, `rgba(${d.glow},0.08)`], [1, `rgba(${d.glow},0)`]], 64),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.scale.set(4.5, 4.5, 1);
  glow.position.set(0, 1, -1.2);
  scene.add(glow);

  const move = { pos: new THREE.Vector3(), yaw: 0, speed: 0, stride: 0, grounded: true, vy: 0, ground: null, float: true };
  let home = null; // the scene GoatMan belongs to in the game
  let shown = false;
  let turn = 0.6;
  let time = 0;

  // --- The menu: mouse, or W/S or arrows and Enter ---
  let on = 0;
  const buttons = () => [...el.querySelectorAll('.btn')].filter((b) => !b.classList.contains('hidden'));
  function highlight(i) {
    const list = buttons();
    on = (i + list.length) % list.length;
    list.forEach((b, k) => b.classList.toggle('on', k === on));
  }
  el.addEventListener('mouseover', (e) => { const i = buttons().indexOf(e.target); if (i >= 0) highlight(i); });
  addEventListener('keydown', (e) => {
    if (!shown || !$('options').classList.contains('hidden')) return;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') highlight(on + 1);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') highlight(on - 1);
    else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); buttons()[on]?.click(); }
  });

  // The save's level, if CONTINUE can go there.
  function saved() {
    const id = loadSave()?.level;
    return levels.data.levels[id]?.spawns ? id : null;
  }

  return {
    saved,
    show() {
      const id = saved();
      more.classList.toggle('hidden', !id);
      if (id) more.textContent = `CONTINUE · ${levels.data.levels[id].title}`;
      el.classList.remove('hidden');
      highlight(0);
      home = gm.group.parent;
      scene.add(gm.group); // borrowed from the game while the menu is up
      gm.reset();
      gm.setGrade(d.grade);
      gm.setFirstPerson(false);
      shown = true;
    },
    // START or CONTINUE: GoatMan goes back into the game.
    leave() {
      if (!shown) return;
      shown = false;
      gm.group.rotation.set(0, 0, 0);
      home?.add(gm.group);
    },
    update(dt) {
      if (!shown) return;
      time += dt;
      turn += dt * d.turn;
      // Weightless: turning, bobbing and tumbling a little round his middle.
      move.pos.set(0, Math.sin(time * 0.6) * d.bob, 0);
      move.yaw = turn;
      gm.update(dt, move);
      gm.group.rotation.x = 0.12 * Math.sin(time * 0.31);
      gm.group.rotation.z = 0.1 * Math.sin(time * 0.23 + 1);
      sky.rotation.y = time * 0.004;
      const p = dustGeo.attributes.position;
      for (let i = 0; i < p.count; i++) { // drifting across and a little up, round the box
        const x = p.getX(i) - dt * 0.25, y = p.getY(i) + dt * 0.05;
        p.setXY(i, x < -DUST.x / 2 ? x + DUST.x : x, y > DUST.y / 2 ? y - DUST.y : y);
      }
      p.needsUpdate = true;
      // He floats right of the menu on a wide screen, above it on a tall one (a phone).
      camera.aspect = innerWidth / innerHeight;
      const shift = camera.aspect > 1.25 ? d.shift : 0, lift = camera.aspect < 0.9 ? d.lift : 0;
      camera.position.set(d.from[0] - shift, d.from[1] - lift, d.from[2] + lift * 2);
      camera.lookAt(d.look[0] - shift, d.look[1] - lift, d.look[2]);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    },
  };
}
