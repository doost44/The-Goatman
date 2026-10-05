import * as THREE from 'three';
import { buildGreybox } from './worlds/greybox.js';
import { fadeTo, showLevelName } from './hud.js';
import { playSoundscape, duck } from './sound.js';
import { gradientTexture } from './textures.js';

// Loads data/levels.json and builds one level at a time. A level's look, spawn
// points, sound and interactions all come from its entry there; the "builder"
// names the module that makes its world (grey-box for now, painted later).

const BUILDERS = {
  greybox: buildGreybox,
};

const fetchJSON = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};

export async function createLevels(scene, player) {
  const data = await fetchJSON('data/levels.json');
  const palettes = await fetchJSON('data/palettes.json');

  const levels = {
    data,
    palettes,
    id: null, // current level id
    def: null, // its levels.json entry
    world: null, // what its builder made: { group, ground, colliders, actors, update }
    busy: false, // a transition is running
    onEnter: null, // called after a level is built, before it fades in
    load,
    go,
    unload,
    update(dt, t) { levels.world?.update?.(dt, t); },
  };

  function unload() {
    const w = levels.world;
    if (!w) return;
    scene.remove(w.group);
    w.dispose?.();
    w.group.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [o.material].flat()) {
        if (!m) continue;
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
        m.dispose();
      }
    });
    levels.world = null;
    player.level = null;
  }

  async function load(id, spawnName = 'start') {
    unload();
    const def = data.levels[id];
    levels.id = id;
    levels.def = def;
    const build = BUILDERS[def.builder];
    if (!build) return; // a cutscene level has no world of its own

    const world = await build(def, { palettes, scene });
    if (scene.background?.isTexture) scene.background.dispose();
    scene.background = gradientTexture(def.sky);
    scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
    const sun = new THREE.DirectionalLight(def.sun.color, def.sun.intensity);
    sun.position.fromArray(def.sun.dir).multiplyScalar(50);
    world.group.add(new THREE.AmbientLight(def.ambient.color, def.ambient.intensity), sun);
    scene.add(world.group);
    levels.world = world;

    player.level = {
      ground: world.ground,
      colliders: world.colliders,
      voidY: def.voidY,
      respawn: def.respawn,
      surface: def.surface,
      speed: def.speed,
    };
    const spawn = def.spawns[spawnName] ?? def.spawns.start;
    player.place(spawn.at, spawn.yaw);
    playSoundscape(def.soundscape?.file ?? null, def.soundscape?.volume ?? 1);
    levels.onEnter?.(id, def, world);
    if (def.title) showLevelName(def.title);
  }

  // The p5 startFade(): fade to black, switch while it is dark, fade back in.
  async function go(id, spawnName) {
    if (levels.busy) return;
    levels.busy = true;
    player.frozen = true;
    duck(1, 'fade');
    await fadeTo(1, data.fade.out, '#000');
    await load(id, spawnName);
    duck(0, 'fade');
    await fadeTo(0, data.fade.in);
    player.frozen = false;
    levels.busy = false;
  }

  return levels;
}
