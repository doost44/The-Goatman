import { settings } from './options.js';

// Everything drawn over the 3D view: prompts, messages, subtitles, the dialogue
// box and full-screen fades. Timers run off the game loop (updateHud).

const $ = (id) => document.getElementById(id);

// The centre prompt ("PRESS E TO ENTER"). Null hides it.
export function showPrompt(text) {
  const el = $('prompt');
  el.classList.toggle('hidden', !text);
  if (text && el.textContent !== text) el.textContent = text;
}

// Small hint in the lower right. Several things can ask for it, so each has its own
// slot and the first one with something to say wins.
const hints = {};
export function showHint(text, slot = 'main') {
  hints[slot] = text;
  const shown = Object.values(hints).find(Boolean);
  const el = $('hint');
  el.classList.toggle('hidden', !shown);
  if (shown) el.textContent = shown;
}

let messageLeft = 0;
// A centred line such as "They liked that", shown for a few seconds (0 = until cleared).
export function showMessage(text, seconds = 2) {
  const el = $('message');
  el.textContent = text ?? '';
  el.classList.toggle('hidden', !text);
  messageLeft = text ? seconds || Infinity : 0;
  if (text) subtitle(null);
}

let levelNameLeft = 0;
export function showLevelName(text, seconds = 4) {
  const el = $('level-name');
  el.textContent = text ?? '';
  el.classList.toggle('hidden', !text);
  levelNameLeft = seconds;
}

let subtitleLeft = 0;
// Captions for sounds, e.g. "[distant knocking]". Only shown with the subtitles option on.
export function subtitle(text, seconds = 3) {
  const el = $('subtitle');
  const on = !!text && settings.subtitles;
  el.classList.toggle('hidden', !on);
  if (on) el.textContent = text;
  subtitleLeft = on ? seconds : 0;
}

export function showError(msg) {
  const el = $('error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

export function setCinematic(on) {
  document.body.classList.toggle('cinematic', on);
  if (on) { showPrompt(null); showHint(null); }
}

// --- Fades -----------------------------------------------------------------------
// fadeTo(1, 0.8) fades to black over 0.8 s; fadeTo(0, 2, '#fff') fades a white flash out.
// Returns a promise that resolves when the fade is done.
const fade = { alpha: 0, from: 0, to: 0, t: 0, dur: 0, resolve: null };
export function fadeTo(alpha, seconds, color) {
  const el = $('fade');
  if (color) el.style.background = color;
  fade.resolve?.(); // a new fade replaces one in progress
  Object.assign(fade, { from: fade.alpha, to: alpha, t: 0, dur: Math.max(seconds, 0.0001) });
  return new Promise((resolve) => { fade.resolve = resolve; });
}
export const fadeAlpha = () => fade.alpha;

// --- Dialogue -----------------------------------------------------------------------
// Opens the dialogue box with a line and some choices; resolves with the chosen index.
// With the mouse locked, moving it up and down highlights a choice and a click picks it;
// 1, 2... pick directly; with the mouse free the buttons can be clicked.
export function dialogue(text, choices) {
  const box = $('dialogue');
  const list = $('choices');
  $('dialogue-text').textContent = text ?? '';
  $('dialogue-text').classList.toggle('hidden', !text);
  list.replaceChildren();
  let on = 0;
  let drift = 0;
  const buttons = choices.map((label, i) => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.textContent = `${i + 1}. ${label}`;
    b.addEventListener('mouseenter', () => highlight(i));
    list.append(b);
    return b;
  });
  function highlight(i) {
    on = i;
    buttons.forEach((b, k) => b.classList.toggle('on', k === on));
  }
  highlight(0);
  box.classList.remove('hidden');

  return new Promise((resolve) => {
    function done(i) {
      removeEventListener('keydown', key);
      removeEventListener('mousemove', move, true);
      removeEventListener('mousedown', click, true);
      box.classList.add('hidden');
      resolve(i);
    }
    function key(e) {
      const n = Number(e.key);
      if (n >= 1 && n <= choices.length) done(n - 1);
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') highlight((on + 1) % choices.length);
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') highlight((on + choices.length - 1) % choices.length);
      else if (e.code === 'Enter' || e.code === 'Space') done(on);
    }
    function move(e) {
      if (!document.pointerLockElement) return;
      drift += e.movementY;
      if (Math.abs(drift) > 40) {
        highlight(Math.max(0, Math.min(choices.length - 1, on + Math.sign(drift))));
        drift = 0;
      }
    }
    function click(e) {
      if (e.button !== 0) return;
      if (document.pointerLockElement) { e.stopPropagation(); done(on); return; }
      const i = buttons.indexOf(e.target);
      if (i >= 0) { e.stopPropagation(); done(i); }
    }
    addEventListener('keydown', key);
    addEventListener('mousemove', move, true);
    addEventListener('mousedown', click, true);
  });
}

// --- Per-frame timers ---------------------------------------------------------------
export function updateHud(dt) {
  if (messageLeft > 0 && (messageLeft -= dt) <= 0) showMessage(null);
  if (levelNameLeft > 0 && (levelNameLeft -= dt) <= 0) showLevelName(null);
  if (subtitleLeft > 0 && (subtitleLeft -= dt) <= 0) subtitle(null);
  if (fade.dur) {
    fade.t = Math.min(fade.dur, fade.t + dt);
    fade.alpha = fade.from + (fade.to - fade.from) * (fade.t / fade.dur);
    $('fade').style.opacity = fade.alpha;
    if (fade.t >= fade.dur) {
      fade.dur = 0;
      const r = fade.resolve;
      fade.resolve = null;
      r?.();
    }
  }
}
