import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { createOptions, settings } from './options.js';
import { steadyMouse, freezeLook } from './mouse.js';
import { createPlayer } from './player.js';
import { createLevels } from './levels.js';
import { createStory } from './story.js';
import { createInteract } from './interact.js';
import { createGoatMan } from './goatman.js';
import { createArms } from './viewmodel.js';
import { createView } from './view.js';
import { createRocks } from './rocks.js';
import { updateAmbience, stopAmbience } from './ambience.js';
import { playFMV } from './fmv.js';
import { startSound, updateSound, stopSoundscape, duck } from './sound.js';
import { updateHud, fadeTo, showError, showMessage, setCinematic } from './hud.js';
import { capturePNG } from './capture.js';

// The loop and the frame around the game: title screen, intro video, play, ending.
// state: 'title' | 'intro' | 'play'

const $ = (id) => document.getElementById(id);
const titleEl = $('title');
const pausedEl = $('paused');

const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: false });
renderer.setPixelRatio(0.5); // half internal resolution, upscaled pixelated by CSS (changeable in options)
renderer.setSize(innerWidth, innerHeight, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 800);
scene.add(camera);

// The mouse turns this "head"; the camera follows it (first person) or orbits it (third, view.js).
const head = new THREE.Object3D();
head.rotation.order = 'YXZ';
const controls = new PointerLockControls(head, document.body);
steadyMouse(controls);

const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const player = createPlayer(head, controls, keys);
let state = 'title';

const options = createOptions({
  renderer, camera, controls,
  onOpen: () => pausedEl.classList.add('hidden'),
  onClose: () => { if (state === 'play') pausedEl.classList.remove('hidden'); },
});
$('title-options').addEventListener('click', () => options.open());

controls.addEventListener('lock', () => {
  pausedEl.classList.add('hidden');
  document.activeElement?.blur(); // so Space (jump) doesn't press a menu button
});
controls.addEventListener('unlock', () => {
  if (state === 'play' && !options.isOpen && !story?.cutscene) pausedEl.classList.remove('hidden');
});
pausedEl.addEventListener('click', () => {
  options.restoreFullscreen();
  startSound();
  controls.lock();
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let levels, gm, story, interact;
try {
  levels = await createLevels(scene, player, camera);
  gm = await createGoatMan();
} catch (err) {
  showError(`Could not load the game: ${err.message}`);
  throw err;
}
const arms = createArms(gm.materials);
const view = createView({ renderer, scene, camera, head, player, gm, arms });
const rocks = createRocks({ camera, controls, player, gm, arms });
levels.onEnter = (id, def, world) => {
  view.enter(def, world);
  rocks.place(def, world);
};
story = createStory({ levels, player, toTitle });
interact = createInteract({ levels, player, head, controls, story });
titleEl.style.backgroundImage = 'url(assets/video/title-poster.png)';

// --- Title, intro, new game ---------------------------------------------------------

function showTitle(on) {
  titleEl.classList.toggle('hidden', !on);
  document.body.classList.toggle('on-title', on);
  $('hud').classList.toggle('hidden', on);
}

$('start').addEventListener('click', async () => {
  if (state !== 'title') return;
  startSound(); // browsers only allow audio to start from a click
  state = 'intro';
  showTitle(false);
  const how = await playFMV(levels.data.intro.video, { skipAfter: levels.data.intro.skipAfter });
  if (how === 'skipped') controls.lock(); // the SKIP click lets us take the mouse straight away
  newGame(levels.data.start);
});

async function newGame(id, spawn) {
  story.reset();
  state = 'play';
  player.frozen = true;
  await fadeTo(1, 0.01, '#000');
  await levels.load(id, spawn);
  if (!controls.isLocked) pausedEl.classList.remove('hidden');
  await fadeTo(0, levels.data.fade.in);
  player.frozen = false;
}

// Back to the title (after the squashed ending or the finale). The screen is black.
function toTitle() {
  state = 'title';
  story.cutscene = false;
  controls.unlock();
  freezeLook(false);
  setCinematic(false);
  showMessage(null);
  duck(0, 'talk');
  stopSoundscape(1);
  stopAmbience(1);
  rocks.clear();
  levels.unload();
  player.mount = null;
  pausedEl.classList.add('hidden');
  showTitle(true);
  fadeTo(0, 1.2);
}

addEventListener('keydown', (e) => {
  // With Esc taken over in fullscreen (see options.js), a tap still frees the mouse.
  if (e.code === 'Escape' && controls.isLocked) controls.unlock();
  if (state !== 'play') return;
  if (e.code === 'KeyV') options.toggleCamera();
  if (e.code === 'KeyP') capturePNG({ renderer, scene, camera, caption: levels.def?.title ?? '' });
});

// --- The loop ----------------------------------------------------------------------

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  if (state === 'play') {
    player.update(dt);
    levels.update(dt, t);
    interact.update();
    view.update(dt);
    rocks.update(dt);
  }
  updateSound(dt, camera);
  updateAmbience(dt, camera);
  updateHud(dt);
  if (state === 'play') view.render();
});

// Handy for debugging in the browser console (and for the Playwright checks).
window.goatman = { THREE, renderer, scene, camera, head, controls, keys, player, levels, gm, arms, view, rocks, story, interact, settings, get state() { return state; }, newGame, toTitle };
