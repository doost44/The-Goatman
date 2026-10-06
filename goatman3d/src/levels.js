import * as THREE from 'three';
import { buildForest } from './worlds/forest.js';
import { buildField } from './worlds/field.js';
import { buildSavanna } from './worlds/savanna.js';
import { fadeTo, showLevelName } from './hud.js';
import { playSoundscape, duck, tuneWind } from './sound.js';
import { playAmbience } from './ambience.js';
import { gradientTexture } from './textures.js';

// Loads data/levels.json and builds one level at a time. A level's look, spawn
// points, sound and interactions all come from its entry there; the "builder"
// names the module that makes its world (worlds/*.js).

const BUILDERS = {
  forest: buildForest,
  field: buildField,
  savanna: buildSavanna,
};

const fetchJSON = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};

export async function createLevels(scene, player, camera) {
  const data = await fetchJSON('data/levels.json');
  const palettes = await fetchJSON('data/palettes.json');

  const levels = {
    data,
    palettes,
    id: null, // current level id
    def: null, // its levels.json entry
    world: null, // what its builder made: { group, ground, colliders, blockers, actors, update }
    busy: false, // a transition is running
    onEnter: null, // called after a level is built, before it fades in
    flag: () => false, // is a story flag set (main.js points it at the story)
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

    // The lights are made first, so a builder can change them as the level goes on (dusk).
    const ambient = new THREE.AmbientLight(def.ambient.color, def.ambient.intensity);
    const sun = new THREE.DirectionalLight(def.sun.color, def.sun.intensity);
    sun.position.fromArray(def.sun.dir).multiplyScalar(50);
    const lights = { ambient, sun };
    const world = await build(def, { palettes, scene, camera, player, lights, flag: (name) => levels.flag(name) });
    if (scene.background?.isTexture) scene.background.dispose();
    scene.background = gradientTexture(def.sky);
    scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
    world.lights = lights;
    world.group.add(ambient, sun);
    scene.add(world.group);
    levels.world = world;

    player.mount = null; // a new level starts on foot
    player.level = {
      ground: world.ground,
      colliders: world.colliders,
      voidY: def.voidY,
      respawn: def.respawn,
      surface: def.surface,
      speed: def.speed,
    };
    tuneWind(def.wind);
    const spawn = def.spawns[spawnName] ?? def.spawns.start;
    player.place(spawn.at, spawn.yaw);
    if (spawn.ride) world.actors[spawn.ride].carry(player, spawn.walkOn); // arriving on its back
    playSoundscape(def.soundscape?.file ?? null, def.soundscape?.volume ?? 1);
    playAmbience(def.ambience ?? null); // synthesised beds for scenes with no track
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
