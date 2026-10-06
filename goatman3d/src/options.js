// Options menu: O (or OPTIONS on the title screen) opens it.
// Settings are remembered in this browser via localStorage.
// Ported from automation-map/src/options.js, plus camera mode, flashes and subtitles.

const KEY = 'goatman3d-options';
const DEFAULTS = {
  camera: 'first', fov: 75, sensitivity: 1, pixel: 0.5, hud: true, shake: true,
  flash: false, subtitles: true, volume: 0.7, music: 0.8, mute: false,
};

// Other modules read this (e.g. the Walking Thing's footfalls check settings.shake).
export const settings = { ...DEFAULTS };

const PIXEL_SIZES = [
  [0.25, 'CHUNKY'],
  [0.5, 'RETRO (DEFAULT)'],
  [0.75, 'SOFT'],
  [1, 'SHARP'],
];

function load() {
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(KEY)) ?? {});
  } catch { /* storage blocked or bad JSON: keep defaults */ }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

export function createOptions({ renderer, camera, controls, onOpen, onClose, onChange }) {
  const menu = document.getElementById('options');
  const $ = (id) => document.getElementById(id);
  const ui = {
    camera: $('opt-camera'),
    fov: $('opt-fov'), fovVal: $('opt-fov-val'),
    sens: $('opt-sens'), sensVal: $('opt-sens-val'),
    pixel: $('opt-pixel'),
    hud: $('opt-hud'), shake: $('opt-shake'), flash: $('opt-flash'), subs: $('opt-subs'),
    full: $('opt-full'),
    vol: $('opt-vol'), volVal: $('opt-vol-val'), mute: $('opt-mute'),
    music: $('opt-music'), musicVal: $('opt-music-val'),
  };
  for (const [v, name] of PIXEL_SIZES) ui.pixel.add(new Option(name, v));

  function apply() {
    camera.fov = settings.fov;
    camera.updateProjectionMatrix();
    controls.pointerSpeed = settings.sensitivity;
    renderer.setPixelRatio(settings.pixel);
    renderer.setSize(innerWidth, innerHeight, false);
    document.body.classList.toggle('no-hud', !settings.hud);

    ui.camera.value = settings.camera;
    ui.fov.value = settings.fov;
    ui.fovVal.textContent = settings.fov;
    ui.sens.value = settings.sensitivity;
    ui.sensVal.textContent = Number(settings.sensitivity).toFixed(1);
    ui.pixel.value = settings.pixel;
    ui.hud.checked = settings.hud;
    ui.shake.checked = settings.shake;
    ui.flash.checked = settings.flash;
    ui.subs.checked = settings.subtitles;
    ui.vol.value = settings.volume;
    ui.volVal.textContent = Math.round(settings.volume * 100);
    ui.mute.checked = settings.mute;
    ui.music.value = settings.music;
    ui.musicVal.textContent = Math.round(settings.music * 100);
    ui.full.textContent = document.fullscreenElement ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
    save();
    onChange?.(settings);
  }

  const set = (key, value) => { settings[key] = value; apply(); };
  ui.camera.addEventListener('change', () => set('camera', ui.camera.value));
  ui.fov.addEventListener('input', () => set('fov', Number(ui.fov.value)));
  ui.sens.addEventListener('input', () => set('sensitivity', Number(ui.sens.value)));
  ui.pixel.addEventListener('change', () => set('pixel', Number(ui.pixel.value)));
  ui.hud.addEventListener('change', () => set('hud', ui.hud.checked));
  ui.shake.addEventListener('change', () => set('shake', ui.shake.checked));
  ui.flash.addEventListener('change', () => set('flash', ui.flash.checked));
  ui.subs.addEventListener('change', () => set('subtitles', ui.subs.checked));
  ui.vol.addEventListener('input', () => set('volume', Number(ui.vol.value)));
  ui.mute.addEventListener('change', () => set('mute', ui.mute.checked));
  ui.music.addEventListener('input', () => set('music', Number(ui.music.value)));
  $('opt-reset').addEventListener('click', () => { Object.assign(settings, DEFAULTS); apply(); });

  // Fullscreen. Chrome normally leaves fullscreen when Esc is pressed to free the mouse.
  // Keyboard Lock takes Esc over while fullscreen, so a tap only frees the mouse
  // (holding Esc still leaves fullscreen). Browsers without it get put back into
  // fullscreen when you click to re-enter the game.
  const canLockEsc = !!navigator.keyboard?.lock;
  let wantFull = false;
  function goFullscreen() {
    return document.documentElement.requestFullscreen?.()
      .then(() => navigator.keyboard?.lock?.(['Escape']))
      .catch(() => {});
  }
  ui.full.addEventListener('click', () => {
    wantFull = !document.fullscreenElement;
    if (wantFull) goFullscreen();
    else document.exitFullscreen();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) navigator.keyboard?.unlock?.();
    apply();
  });

  const options = {
    isOpen: false,
    // Called from the click that re-enters the game (fallback for browsers without Keyboard Lock).
    restoreFullscreen() {
      if (wantFull && !canLockEsc && !document.fullscreenElement) goFullscreen();
    },
    open() {
      options.isOpen = true;
      menu.classList.remove('hidden');
      onOpen?.();
      controls.unlock();
    },
    close() {
      options.isOpen = false;
      menu.classList.add('hidden');
      onClose?.();
    },
    toggleCamera() {
      set('camera', settings.camera === 'first' ? 'third' : 'first');
    },
  };
  $('opt-close').addEventListener('click', options.close);

  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && options.isOpen) options.close();
    if (e.code !== 'KeyO') return;
    if (options.isOpen) options.close();
    else options.open();
  });

  load();
  apply();
  return options;
}
