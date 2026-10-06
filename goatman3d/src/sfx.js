import { synthKit as kit } from './sound.js';

// Every sound effect, synthesised on the fly from sound.js's building blocks: tone() (one
// oscillator), noise() (filtered noise) and synth() (two detuned oscillators through a
// closing filter). pan is where it comes from, -1 left to 1 right.

const { tone, noise, synth } = kit;

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
  // Wading in the savanna's bog: a slosh, drips, and the hoof sucked out of the mud.
  water: { rustle: [500, 800], to: 220, vol: 0.1, ticks: 3, tickFreq: [3000, 5200], thump: 0.03, swish: true, slosh: true },
};

export const sfx = {
  // GoatMan's step: a hoof on the ground plus the surface's rustle; left/right alternate.
  // heavy (0..1, sprinting): a deeper, longer thump.
  step(surface = 'grass', vol = 1, heavy = 0) {
    const s = SURFACES[surface] ?? SURFACES.grass;
    stepSide = -stepSide;
    const pan = stepSide * 0.15;
    noise({ dur: s.swish ? rnd(0.16, 0.22) : rnd(0.08, 0.12), filter: 'bandpass', freq: rnd(...s.rustle), to: s.to, q: 0.7, vol: s.vol * vol, pan, attack: s.swish ? 0.04 : 0.01 });
    for (let i = 0; i < s.ticks; i++) noise({ dur: 0.012, filter: 'highpass', freq: rnd(...s.tickFreq), vol: 0.022 * vol, pan, delay: rnd(0, 0.06) });
    noise({ dur: 0.05 + 0.04 * heavy, filter: 'lowpass', freq: 160 - 50 * heavy, vol: s.thump * vol * (1 + heavy), pan });
    if (s.slosh) { // plunging in, then pulling out of the mud
      tone({ freq: rnd(260, 340), to: 110, dur: 0.07, vol: 0.035 * vol, pan });
      noise({ dur: 0.12, filter: 'lowpass', freq: 260, vol: 0.05 * vol, pan, attack: 0.03, delay: rnd(0.12, 0.18) });
    } else {
      tone({ freq: rnd(150, 190) * (1 - 0.25 * heavy), to: 90 - 30 * heavy, dur: 0.04 + 0.03 * heavy, vol: 0.03 * vol, pan }); // hoof knock
    }
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
  // Admin mode's night vision: a click, then the tube's whine rising as it comes on, or dying away.
  goggles(on) {
    noise({ dur: 0.015, filter: 'highpass', freq: 3500, vol: 0.05 });
    tone({ freq: on ? 700 : 3800, to: on ? 4200 : 500, dur: on ? 0.55 : 0.25, vol: on ? 0.018 : 0.012, attack: 0.03 });
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
  // The Walking Thing: a low, breathy hum when it notices him, two notes falling.
  call(pan = 0) {
    synth({ freq: 98, dur: 1.6, type: 'triangle', vol: 0.06, pan, attack: 0.4, cutoff: 900, cutoffEnd: 300, echoAmount: 0.6 });
    synth({ freq: 73.4, dur: 1.8, type: 'triangle', vol: 0.05, pan, attack: 0.4, cutoff: 700, cutoffEnd: 250, echoAmount: 0.6, delay: 0.9 });
    noise({ dur: 1.4, filter: 'bandpass', freq: 500, to: 300, q: 3, vol: 0.04, attack: 0.5, pan, echoAmount: 0.5 });
  },
  // Its joints as it kneels or gets up: slow, deep groans.
  groan(pan = 0, vol = 1) {
    tone({ freq: rnd(60, 75), to: rnd(40, 50), dur: 2.2, type: 'sawtooth', vol: 0.05 * vol, attack: 0.3, pan, echoAmount: 0.4 });
    tone({ freq: rnd(95, 120), to: rnd(70, 85), dur: 1.6, type: 'sawtooth', vol: 0.03 * vol, attack: 0.5, pan, delay: 0.4, echoAmount: 0.4 });
  },
  // Grabbing its leg: a thin, scraping shriek far above.
  shriek(pan = 0) {
    tone({ freq: 900, to: 1500, dur: 0.5, type: 'sawtooth', vol: 0.03, attack: 0.05, pan, echoAmount: 0.7 });
    tone({ freq: 1340, to: 700, dur: 0.9, type: 'sawtooth', vol: 0.025, attack: 0.1, pan, delay: 0.35, echoAmount: 0.7 });
    noise({ dur: 0.8, filter: 'bandpass', freq: 3000, to: 1800, q: 4, vol: 0.05, attack: 0.05, pan, echoAmount: 0.5 });
  },
  // Its foot falling on him.
  whistle(time = 0.6) {
    tone({ freq: 1400, to: 260, dur: time, type: 'triangle', vol: 0.06, attack: 0.05 });
    noise({ dur: time, filter: 'bandpass', freq: 600, to: 2400, q: 1, vol: 0.12, attack: time * 0.8 });
  },
  // The squash: the foot coming down.
  boom() {
    noise({ dur: 2.2, filter: 'lowpass', freq: 400, to: 60, vol: 0.8 });
    tone({ freq: 70, to: 22, dur: 2, vol: 0.55 });
    noise({ dur: 0.4, filter: 'highpass', freq: 1500, to: 400, vol: 0.18 });
  },
  whoosh(vol = 0.1) { noise({ dur: 0.6, filter: 'bandpass', freq: 400, to: 2400, q: 1, vol, attack: 0.4 }); },
  // Drinking at the pool: water lapping, and a low, quiet tone (A-flat and E-flat).
  drink() {
    noise({ dur: 1.4, filter: 'bandpass', freq: 650, to: 280, q: 2.5, vol: 0.03, attack: 0.3, echoAmount: 0.5 });
    synth({ freq: 103.8, dur: 3.2, type: 'sine', vol: 0.06, attack: 0.7, cutoff: 900, cutoffEnd: 300, echoAmount: 0.6 });
    synth({ freq: 155.6, dur: 2.8, type: 'triangle', vol: 0.025, attack: 0.9, cutoff: 1200, cutoffEnd: 300, echoAmount: 0.6, delay: 0.6 });
  },
  // The striped creatures: a dry rustle as one shuffles off through the grass...
  rustle(pan = 0, vol = 1) {
    for (let i = 0; i < 3; i++) {
      noise({ dur: rnd(0.12, 0.22), filter: 'bandpass', freq: rnd(1500, 2600), to: 700, q: 0.9, vol: 0.06 * vol, pan, attack: 0.03, delay: i * rnd(0.08, 0.14) });
    }
  },
  // ...a grown one's soft purring murmur (low: a rumble, turning on GoatMan)...
  murmur(pan = 0, vol = 1, low = false) {
    if (!kit.ready()) return;
    const ctx = kit.ctx(), t = ctx.currentTime, dur = rnd(0.9, 1.5), base = low ? rnd(52, 62) : rnd(72, 96);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * rnd(0.85, 1.15), t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = low ? 320 : 480;
    f.Q.value = 2;
    const purr = ctx.createGain(); // the purr: its loudness fluttering twenty-odd times a second
    purr.gain.value = 0.5;
    const flutter = ctx.createOscillator();
    flutter.frequency.value = rnd(18, 26);
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    flutter.connect(depth);
    depth.connect(purr.gain);
    const g = kit.envelope(0.09 * vol, 0.25, dur, t);
    o.connect(f);
    f.connect(purr);
    purr.connect(g);
    kit.out(g, pan, 0.2);
    for (const osc of [o, flutter]) { osc.start(t); osc.stop(t + dur + 0.4); }
  },
  // ...and a baby's chirps: a few quick high notes, rising.
  chirp(pan = 0, vol = 1, n = 2) {
    for (let i = 0; i < n; i++) {
      const f = rnd(1300, 1900);
      tone({ freq: f, to: f * rnd(1.2, 1.5), dur: rnd(0.05, 0.08), vol: 0.03 * vol, pan, attack: 0.01, delay: i * rnd(0.09, 0.14), echoAmount: 0.3 });
    }
  },
  // The bog: something going into the water (size: about 0.5 a hoof, 0.7 a pebble, 1.5 the
  // Walking Thing's foot), the drops falling back...
  splash(pan = 0, vol = 1, size = 1) {
    const big = Math.min(1.5, size);
    noise({ dur: 0.18 + 0.25 * big, filter: 'bandpass', freq: rnd(900, 1400) / (0.6 + 0.4 * big), to: 250, q: 0.8, vol: 0.09 * vol * (0.6 + 0.5 * big), pan });
    tone({ freq: rnd(220, 320) / (0.7 + 0.5 * big), to: 80, dur: 0.1 + 0.06 * big, vol: 0.05 * vol * big, pan });
    for (let i = 0; i < 3 + Math.round(big * 3); i++) noise({ dur: 0.015, filter: 'bandpass', freq: rnd(2500, 5000), q: 3, vol: 0.03 * vol, pan, delay: rnd(0.08, 0.35 + 0.2 * big) });
  },
  // ...and a bubble coming up through it and popping: a quick rising blip.
  bloop(pan = 0, vol = 1) {
    const f = rnd(180, 320);
    tone({ freq: f, to: f * rnd(2.2, 3), dur: rnd(0.05, 0.09), vol: 0.06 * vol, pan, echoAmount: 0.3 });
    noise({ dur: 0.03, filter: 'bandpass', freq: rnd(1200, 1800), q: 4, vol: 0.02 * vol, pan, delay: 0.06 });
  },
};
