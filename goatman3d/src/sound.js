import { settings } from './options.js';

// Sound, made with the Web Audio API, modelled on automation-map/src/sound.js.
// Effects are synthesised on the fly (oscillators and filtered noise). Each level's
// soundscape is one of Charlie's own tracks (assets/audio/*.m4a), streamed from an
// <audio> element and looped. Browsers only allow sound after a click, so nothing
// plays until startSound() is called from one.

let ctx = null;
let master = null;
let sfxBus = null; // effects
let musicBus = null; // soundscapes, through the duck filter
let duckFilter = null;
let duckGain = null;
let echo = null;
let noiseBuf = null;
const loops = {};

export function startSound() {
  if (ctx) { ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.connect(master);
  // Soundscapes go through a lowpass that closes when something needs the space
  // (falling wind, dialogue, fades), then the music volume.
  duckFilter = ctx.createBiquadFilter();
  duckFilter.type = 'lowpass';
  duckFilter.frequency.value = 20000;
  duckGain = ctx.createGain();
  musicBus = ctx.createGain();
  duckFilter.connect(duckGain);
  duckGain.connect(musicBus);
  musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  buildEcho();
  buildLoops();
}

const ready = () => ctx && ctx.state === 'running';
export const audioContext = () => ctx;

// Send a node to the effects bus, panned left (-1) to right (1), optionally into the echo.
function out(node, pan = 0, echoAmount = 0) {
  let last = node;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    last = p;
  }
  last.connect(sfxBus);
  if (echoAmount) {
    const send = ctx.createGain();
    send.gain.value = echoAmount;
    last.connect(send);
    send.connect(echo);
  }
}

// A soft, dark echo with fading repeats.
function buildEcho() {
  echo = ctx.createDelay(1.5);
  echo.delayTime.value = 0.42;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.42;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 1500;
  echo.connect(tone);
  tone.connect(feedback);
  feedback.connect(echo);
  tone.connect(sfxBus);
}

// Gain that rises quickly then fades, so sounds don't click.
function envelope(vol, attack, dur, t = ctx.currentTime) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  return g;
}

function tone({ freq, to = freq, dur = 0.15, type = 'sine', vol = 0.2, pan = 0, attack = 0.005, delay = 0, echoAmount = 0 }) {
  if (!ready()) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + attack + dur);
  const g = envelope(vol, attack, dur, t);
  o.connect(g);
  out(g, pan, echoAmount);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
}

function noise({ dur = 0.2, filter = 'lowpass', freq = 1000, to = freq, q = 1, vol = 0.2, pan = 0, attack = 0.005, delay = 0, echoAmount = 0 }) {
  if (!ready()) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + attack + dur);
  const g = envelope(vol, attack, dur, t);
  src.connect(f);
  f.connect(g);
  out(g, pan, echoAmount);
  src.start(t, Math.random() * 0.5);
  src.stop(t + attack + dur + 0.05);
}

// One synth note: two detuned oscillators through a filter that closes as it fades.
function synth({ freq, dur = 0.3, type = 'sawtooth', vol = 0.06, pan = 0, attack = 0.01, cutoff = 2400, cutoffEnd = 400, echoAmount = 0.35, delay = 0, spread = 7 }) {
  if (!ready()) return;
  const t = ctx.currentTime + delay;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 3;
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(cutoffEnd, t + attack + dur);
  const g = envelope(vol, attack, dur, t);
  f.connect(g);
  out(g, pan, echoAmount);
  for (const detune of [-spread, spread]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(f);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }
}

// --- Continuous sounds --------------------------------------------------------------

function loop(name, base, build) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(sfxBus);
  loops[name] = { gain, base, ...build(gain) };
}

function noiseInto(dest, type, freq, q = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f);
  f.connect(dest);
  src.start(0, Math.random());
  f.source = src; // so whoever made it can stop it
  return f;
}

function oscInto(dest, type, freq) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.connect(dest);
  o.start();
  return o;
}

// Slowly push an audio setting up and down with a sine (an LFO).
function wobble(param, rate, amount) {
  const depth = ctx.createGain();
  depth.gain.value = amount;
  depth.connect(param);
  return oscInto(depth, 'sine', rate * (0.9 + Math.random() * 0.2));
}

function buildLoops() {
  // Falling: wind. Two resonant bands of noise whose pitch wanders (howl and whistle)
  // over a soft airy rush, gusting unevenly. From automation-map.
  loop('fall', 0.16, (g) => {
    const gust = ctx.createGain();
    gust.gain.value = 0.6;
    wobble(gust.gain, 0.17, 0.25);
    wobble(gust.gain, 0.53, 0.12);
    gust.connect(g);
    const howl = noiseInto(gust, 'bandpass', 450, 6);
    wobble(howl.frequency, 0.13, 180);
    wobble(howl.frequency, 0.37, 60);
    const whistle = noiseInto(gust, 'bandpass', 900, 5);
    wobble(whistle.frequency, 0.21, 320);
    const air = ctx.createGain();
    air.gain.value = 0.35;
    air.connect(gust);
    noiseInto(air, 'highpass', 900, 0.5);
    return { filter: whistle };
  });
  // The squash: a deep rumble and a drone, from automation-map's giant rock.
  loop('rumble', 0.5, (g) => { noiseInto(g, 'lowpass', 90); oscInto(g, 'sine', 38); return {}; });
  loop('drone', 0.1, (g) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    f.connect(g);
    return { osc: oscInto(f, 'sawtooth', 55), osc2: oscInto(f, 'sawtooth', 55.6) };
  });
}

// Fade a continuous sound to a level from 0 to 1, optionally retuning it.
function setLoop(name, level, freq) {
  const l = loops[name];
  if (!l) return;
  const t = ctx.currentTime;
  l.gain.gain.setTargetAtTime(level * l.base, t, 0.08);
  if (freq && l.osc) {
    l.osc.frequency.setTargetAtTime(freq, t, 0.05);
    l.osc2?.frequency.setTargetAtTime(freq * 1.01, t, 0.05);
  }
  if (freq && l.filter) l.filter.frequency.setTargetAtTime(freq, t, 0.1);
}

// Levels for the continuous sounds, set every frame by whoever owns them.
export const loopsLevel = {
  // Grows gently and brightens as you fall faster.
  wind: (level) => ready() && setLoop('fall', level ** 1.5, 600 + level * 1100),
  rumble: (level) => ready() && setLoop('rumble', level),
  drone: (level) => ready() && setLoop('drone', level, 55 + level * 55),
};

// --- Soundscapes ------------------------------------------------------------------------
// One <audio> element per track, created when a level asks for it and dropped when
// the level is left, so only the current level's track is downloaded.
let scape = null; // { url, el, gain }

export function playSoundscape(url, volume = 1, fade = 2) {
  if (!ctx) return;
  if (scape?.url === url) {
    scape.gain.gain.setTargetAtTime(volume, ctx.currentTime, fade / 3);
    return;
  }
  stopSoundscape(fade);
  if (!url) return;
  const el = new Audio(url);
  el.loop = true;
  el.preload = 'auto';
  const gain = ctx.createGain();
  gain.gain.value = 0;
  ctx.createMediaElementSource(el).connect(gain);
  gain.connect(duckFilter);
  el.play().catch(() => {});
  gain.gain.setTargetAtTime(volume, ctx.currentTime, fade / 3);
  scape = { url, el, gain };
}

export function stopSoundscape(fade = 1.5) {
  if (!scape || !ctx) return;
  const { el, gain } = scape;
  gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
  setTimeout(() => { el.pause(); el.removeAttribute('src'); el.load(); gain.disconnect(); }, fade * 1000 + 200);
  scape = null;
}

// 0 = soundscape as is, 1 = muffled and quiet. Several things can duck at once; the most wins.
const ducks = {};
export function duck(amount, who = 'main') {
  ducks[who] = amount;
}

// --- Sound effects ----------------------------------------------------------------------

const rnd = (a, b) => a + Math.random() * (b - a);
let stepSide = 1;

// Footstep character per ground surface.
const SURFACES = {
  // Soft forest floor: damp leaf litter and the odd twig.
  forest: { rustle: [1400, 2400], to: 900, vol: 0.05, ticks: 1, tickFreq: [3000, 5000], thump: 0.08 },
  // Red grass: dry, crunchy blades.
  grass: { rustle: [2800, 4200], to: 1800, vol: 0.06, ticks: 3, tickFreq: [5000, 8000], thump: 0.06 },
  // Purple savanna grass: long and swishy.
  purple: { rustle: [1800, 3000], to: 700, vol: 0.07, ticks: 0, tickFreq: [0, 0], thump: 0.05, swish: true },
  stone: { rustle: [600, 900], to: 400, vol: 0.03, ticks: 2, tickFreq: [2500, 4000], thump: 0.1 },
};

export const sfx = {
  // GoatMan's step: a hoof on the ground plus the surface's rustle; left/right alternate.
  step(surface = 'grass', vol = 1) {
    const s = SURFACES[surface] ?? SURFACES.grass;
    stepSide = -stepSide;
    const pan = stepSide * 0.15;
    noise({ dur: s.swish ? rnd(0.16, 0.22) : rnd(0.08, 0.12), filter: 'bandpass', freq: rnd(...s.rustle), to: s.to, q: 0.7, vol: s.vol * vol, pan, attack: s.swish ? 0.04 : 0.01 });
    for (let i = 0; i < s.ticks; i++) noise({ dur: 0.012, filter: 'highpass', freq: rnd(...s.tickFreq), vol: 0.022 * vol, pan, delay: rnd(0, 0.06) });
    noise({ dur: 0.05, filter: 'lowpass', freq: 160, vol: s.thump * vol, pan });
    tone({ freq: rnd(150, 190), to: 90, dur: 0.04, vol: 0.03 * vol, pan }); // hoof knock
  },
  jump(surface = 'grass') {
    const s = SURFACES[surface] ?? SURFACES.grass;
    noise({ dur: 0.1, filter: 'bandpass', freq: s.rustle[1], to: s.to, q: 0.8, vol: 0.08 });
    noise({ dur: 0.05, filter: 'lowpass', freq: 200, vol: 0.06 });
    noise({ dur: 0.3, filter: 'bandpass', freq: 900, to: 350, q: 0.6, vol: 0.05, attack: 0.04, delay: 0.03 });
  },
  land(strength = 0.5, surface = 'grass') {
    const v = Math.max(0, Math.min(1, strength));
    const s = SURFACES[surface] ?? SURFACES.grass;
    noise({ dur: 0.12 + v * 0.2, filter: 'lowpass', freq: 300, to: 80, vol: 0.1 + v * 0.3 });
    tone({ freq: 90, to: 40, dur: 0.15 + v * 0.2, vol: 0.08 + v * 0.3 });
    noise({ dur: 0.12, filter: 'bandpass', freq: s.rustle[1], to: s.to, q: 0.7, vol: 0.05 + v * 0.05 });
  },
  // The Walking Thing planting a foot: felt more than heard.
  thud(strength = 1, pan = 0) {
    const v = Math.max(0, Math.min(1.5, strength));
    tone({ freq: 55, to: 28, dur: 0.6, vol: 0.35 * v, pan });
    noise({ dur: 0.35, filter: 'lowpass', freq: 220, to: 60, vol: 0.25 * v, pan });
    noise({ dur: 0.2, filter: 'bandpass', freq: 2600, to: 1200, q: 0.8, vol: 0.03 * v, pan, delay: 0.02 }); // grass flattened
  },
  creak(pan = 0) {
    tone({ freq: rnd(120, 160), to: 90, dur: 0.5, type: 'sawtooth', vol: 0.03, attack: 0.08, pan });
    tone({ freq: rnd(200, 240), to: 150, dur: 0.35, type: 'sawtooth', vol: 0.02, attack: 0.12, pan });
  },
  // Soft synth tones for the gentle moments (pet, drink, mount), in a minor-ish key.
  chime(notes = [0, 3, 7], base = 220, vol = 0.04) {
    notes.forEach((n, i) => synth({ freq: base * 2 ** (n / 12), dur: 1.4, type: 'triangle', vol, attack: 0.08, cutoff: 1800, cutoffEnd: 300, echoAmount: 0.6, delay: i * 0.16 }));
  },
  // Choices and prompts.
  blip() { synth({ freq: 440, dur: 0.08, type: 'square', vol: 0.02, cutoff: 2400, cutoffEnd: 800, echoAmount: 0.1 }); },
  enter() {
    noise({ dur: 0.6, filter: 'bandpass', freq: 300, to: 1600, q: 0.8, vol: 0.06, attack: 0.3 });
    synth({ freq: 110, dur: 1.2, type: 'sawtooth', vol: 0.03, attack: 0.2, cutoff: 300, cutoffEnd: 1200, echoAmount: 0.5 });
  },
  // Rocks
  pickup: () => noise({ dur: 0.14, filter: 'highpass', freq: 1800, to: 900, vol: 0.1 }),
  throwRock: () => noise({ dur: 0.22, filter: 'bandpass', freq: 1800, to: 400, q: 1.5, vol: 0.12 }),
  knock(pan = 0) { // rock on bark: hollow
    tone({ freq: rnd(220, 300), to: 120, dur: 0.12, vol: 0.18, pan, echoAmount: 0.4 });
    noise({ dur: 0.06, filter: 'bandpass', freq: 900, q: 2, vol: 0.12, pan });
  },
  thunk(pan = 0) {
    tone({ freq: 160, to: 60, dur: 0.16, vol: 0.22, pan });
    noise({ dur: 0.08, filter: 'lowpass', freq: 600, vol: 0.12, pan });
  },
  rockLand: () => noise({ dur: 0.08, filter: 'lowpass', freq: 400, vol: 0.08 }),
  // The forest's eyes shutting when a pebble hits them, and opening somewhere else.
  blink(pan = 0) {
    synth({ freq: 988, dur: 0.12, type: 'triangle', vol: 0.03, pan, cutoff: 3000, cutoffEnd: 600, echoAmount: 0.5 });
    synth({ freq: 740, dur: 0.2, type: 'triangle', vol: 0.03, pan, cutoff: 2000, cutoffEnd: 400, echoAmount: 0.5, delay: 0.09 });
  },
  whisper(pan = 0) { noise({ dur: 0.9, filter: 'bandpass', freq: 2200, to: 1400, q: 6, vol: 0.035, attack: 0.35, pan, echoAmount: 0.6 }); },
  // The squash: the foot coming down.
  boom() {
    noise({ dur: 2.2, filter: 'lowpass', freq: 400, to: 60, vol: 0.8 });
    tone({ freq: 70, to: 22, dur: 2, vol: 0.55 });
    noise({ dur: 0.4, filter: 'highpass', freq: 1500, to: 400, vol: 0.18 });
  },
  whoosh(vol = 0.1) { noise({ dur: 0.6, filter: 'bandpass', freq: 400, to: 2400, q: 1, vol, attack: 0.4 }); },
};

// Raw building blocks for level ambiences (ambience.js). music() is where a bed plugs in
// to be ducked and set by the music volume like the soundscapes.
export const synthKit = { tone, noise, synth, noiseInto, oscInto, wobble, ready, ctx: () => ctx, out: (n, pan, e) => out(n, pan, e), bus: () => sfxBus, music: () => duckFilter };

// --- Each frame ---------------------------------------------------------------------------

// The listener's ears follow the camera, so 3D sounds move as you turn.
function updateListener(camera) {
  const l = ctx.listener;
  const p = camera.position;
  const e = camera.matrixWorld.elements;
  const fwd = [-e[8], -e[9], -e[10]], up = [e[4], e[5], e[6]];
  if (l.positionX) {
    l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
    l.forwardX.value = fwd[0]; l.forwardY.value = fwd[1]; l.forwardZ.value = fwd[2];
    l.upX.value = up[0]; l.upY.value = up[1]; l.upZ.value = up[2];
  } else {
    l.setPosition(p.x, p.y, p.z);
    l.setOrientation(...fwd, ...up);
  }
}

export function updateSound(dt, camera) {
  if (!ready()) return;
  const now = ctx.currentTime;
  master.gain.setTargetAtTime(settings.mute ? 0 : settings.volume, now, 0.05);
  musicBus.gain.setTargetAtTime(settings.music, now, 0.1);
  const d = Math.max(0, ...Object.values(ducks));
  duckFilter.frequency.setTargetAtTime(20000 * (1 - d) ** 3 + 350, now, 0.15);
  duckGain.gain.setTargetAtTime(1 - 0.6 * d, now, 0.15);
  updateListener(camera);
}
