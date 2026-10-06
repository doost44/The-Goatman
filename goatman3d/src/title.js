import * as THREE from 'three';
import { loadSave } from './save.js';

// The title screen, as in start.js: the title video's first frame behind START, CONTINUE
// (when a level was reached before) and OPTIONS. Once the night forest has loaded behind
// it, the still dissolves into a slow orbit round GoatMan standing among the trees.
// levels.json "title": { level, spawn, radius, height, look (height looked at), speed,
//   light (the level's ambient light is this much brighter, so he shows up in the dark) }

const $ = (id) => document.getElementById(id);

export function createTitle({ levels, view, player }) {
  const el = $('title');
  const more = $('continue');
  const d = levels.data.title;
  const from = new THREE.Vector3(), to = new THREE.Vector3();
  let live = false; // the orbit is showing
  let loading = null;
  let angle = 0;

  // The save's level, if CONTINUE can go there.
  function saved() {
    const id = loadSave()?.level;
    return levels.data.levels[id]?.spawns ? id : null;
  }

  async function backdrop() {
    await levels.load(d.level, d.spawn, { backdrop: true });
    view.enter(levels.def, levels.world);
    levels.world.lights.ambient.intensity *= d.light;
    angle = 0;
    live = true;
    el.classList.add('live');
  }

  return {
    saved,
    show() {
      const id = saved();
      more.classList.toggle('hidden', !id);
      if (id) more.textContent = `CONTINUE · ${levels.data.levels[id].title}`;
      el.classList.remove('hidden', 'live');
      loading = backdrop().catch(() => {}); // if it can't load, the still stays
    },
    // Leaving the title: the still comes back over the orbit and the backdrop goes.
    async leave() {
      await loading;
      live = false;
      el.classList.remove('live');
      levels.unload();
    },
    update(dt, t) {
      if (!live) return;
      levels.update(dt, t);
      angle += dt * d.speed;
      const p = player.pos;
      from.set(p.x + Math.sin(angle) * d.radius, p.y + d.height, p.z + Math.cos(angle) * d.radius);
      view.shot = { from, to: to.set(p.x, p.y + d.look, p.z) };
      view.update(dt);
      view.render();
    },
  };
}
