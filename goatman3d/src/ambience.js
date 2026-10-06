import { synthKit as kit } from './sound.js';
import { subtitle } from './hud.js';

// Synthesised beds for scenes that had no sound in the original: the night forest, and
// the savanna's bog under its soundtrack. They play on the music bus, so they duck and
// follow the music volume like Charlie's tracks. Like automation-map's bass line, sounds
// are placed round the listener with an HRTF panner: in the forest something circling you
// in the trees, in the savanna the river, wherever its nearest stretch is.

const BEDS = { night, bog };
let wanted = null; // the bed the level asked for
let source = null; // where its sound comes from, if the level says: (camera position) => point
let bed = null; // the one playing: { name, update, stop }
let fadeOut = 2;

export function playAmbience(name, fade = 2, from = null) {
  wanted = BEDS[name] ? name : null;
  source = from;
  fadeOut = fade;
}
export const stopAmbience = (fade = 1.5) => playAmbience(null, fade);

// Every frame: starts the wanted bed once sound is allowed, and moves its sounds about.
export function updateAmbience(dt, camera) {
  if (!kit.ready()) return;
  if ((bed?.name ?? null) !== wanted) {
    bed?.stop(fadeOut);
    bed = wanted ? BEDS[wanted](source) : null;
  }
  bed?.update(dt, camera);
}

const rnd = (a, b) => a + Math.random() * (b - a);
const LEVEL = 0.45; // about as loud as Charlie's tracks in the other levels

// A bed's one-off sounds: a gain that rises, holds and dies away, and a burst of filtered noise.
function helpers(ctx) {
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  function envelope(t, vol, attack, hold, release) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return g;
  }
  function burst(dest, t, { filter, freq, q = 1, vol, attack = 0.005, hold = 0, release }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = envelope(t, vol, attack, hold, release);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + hold + release + 0.05);
  }
  return { envelope, burst };
}

// A frog: a few rough, nasal pulses (rib-bit), into dest.
function frog(ctx, envelope, dest, t, rate, n) {
  for (let i = 0; i < n; i++) {
    const at = t + i * rnd(0.14, 0.22), dur = rnd(0.06, 0.12);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(rate, at);
    o.frequency.linearRampToValueAtTime(rate * 0.8, at + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = rnd(500, 850);
    f.Q.value = 5;
    const g = envelope(at, 0.35, 0.01, dur, 0.05);
    o.connect(f);
    f.connect(g);
    g.connect(dest);
    o.start(at);
    o.stop(at + dur + 0.1);
  }
}
// A drip: a small plink, rising.
function plink(ctx, envelope, dest, t, vol = 0.12) {
  const o = ctx.createOscillator(), f = rnd(900, 1600);
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 1.8, t + 0.06);
  const g = envelope(t, vol, 0.002, 0, 0.12);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + 0.2);
}

// Move a panner to a point, smoothly.
function moveTo(ctx, panner, { x, y, z }) {
  if (panner.positionX) {
    panner.positionX.setTargetAtTime(x, ctx.currentTime, 0.05);
    panner.positionY.setTargetAtTime(y, ctx.currentTime, 0.05);
    panner.positionZ.setTargetAtTime(z, ctx.currentTime, 0.05);
  } else {
    panner.setPosition(x, y, z);
  }
}

// --- The night forest ---------------------------------------------------------------------
// Low wind through the trunks, a creak now and then, soft knocking far off, and
// footsteps in the leaves that go round and round you, stopping when you listen. Near a
// pond (source(camera position): the nearest one), slow drips and a frog or two.
function night(source) {
  const ctx = kit.ctx();
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, ctx.currentTime);
  out.gain.setTargetAtTime(LEVEL, ctx.currentTime, 1.5);
  out.connect(kit.music());
  const running = []; // sources to stop at the end
  const keep = (node) => { running.push(node.source ?? node); return node; };

  // Wind: a dark rush, and a hollow moan whose pitch wanders.
  const wind = ctx.createGain();
  wind.gain.value = 0.4;
  wind.connect(out);
  keep(kit.wobble(wind.gain, 0.06, 0.18));
  const rush = keep(kit.noiseInto(wind, 'lowpass', 300, 0.7));
  keep(kit.wobble(rush.frequency, 0.04, 120));
  const moanLevel = ctx.createGain();
  moanLevel.gain.value = 2;
  moanLevel.connect(wind);
  keep(kit.wobble(moanLevel.gain, 0.09, 1.6));
  const moan = keep(kit.noiseInto(moanLevel, 'bandpass', 380, 14));
  keep(kit.wobble(moan.frequency, 0.05, 90));
  keep(kit.wobble(moan.frequency, 0.17, 25));

  // A long dark echo, so things sound far away.
  const echo = ctx.createDelay(2);
  echo.delayTime.value = 0.55;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.4;
  const dark = ctx.createBiquadFilter();
  dark.type = 'lowpass';
  dark.frequency.value = 1100;
  echo.connect(dark);
  dark.connect(feedback);
  feedback.connect(echo);
  dark.connect(out);

  // Send a one-off sound somewhere left or right, partly into the echo.
  function place(node, pan, wet) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    p.connect(out);
    const send = ctx.createGain();
    send.gain.value = wet;
    p.connect(send);
    send.connect(echo);
  }
  const { envelope, burst } = helpers(ctx);

  // Wood groaning: a slow buzz (stick and slip) whose rate rises and falls, through a
  // narrow band.
  function creak() {
    const t = ctx.currentTime;
    const dur = rnd(0.6, 1.5);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(rnd(14, 22), t);
    o.frequency.linearRampToValueAtTime(rnd(28, 45), t + dur * 0.55);
    o.frequency.linearRampToValueAtTime(rnd(12, 20), t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = rnd(450, 900);
    f.Q.value = 4;
    const g = envelope(t, 4, 0.15, dur - 0.35, 0.2);
    o.connect(f);
    f.connect(g);
    place(g, rnd(-0.9, 0.9), 0.5);
    o.start(t);
    o.stop(t + dur + 0.05);
    subtitle('[a trunk creaks]', 2.5);
  }

  // Two to four soft knocks on wood, somewhere far off.
  function knocks() {
    const pan = rnd(-1, 1);
    const gap = rnd(0.28, 0.5);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * gap * rnd(0.85, 1.15);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(rnd(260, 340), t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.1);
      const g = envelope(t, 0.6, 0.002, 0, 0.12);
      o.connect(g);
      place(g, pan, 0.9);
      o.start(t);
      o.stop(t + 0.2);
      burst(g, t, { filter: 'bandpass', freq: 900, q: 2, vol: 0.4, release: 0.03 });
    }
    subtitle('[knocking, far off]', 3);
  }

  // The thing that circles you, placed in 3D round the listener (HRTF: heard from all
  // sides on headphones, even behind).
  const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 3, rolloffFactor: 1.1 });
  panner.connect(out);
  const steps = ctx.createGain();
  steps.gain.value = 1;
  steps.connect(panner);
  const circler = { a: rnd(0, 6), dir: 1, moving: false, clock: rnd(4, 8), step: 0, t: 0 };

  function footstep() { // in leaf litter: a rustle and a soft heel
    const t = ctx.currentTime;
    burst(steps, t, { filter: 'bandpass', freq: rnd(1200, 2200), q: 0.9, vol: 1.4, attack: 0.01, release: rnd(0.08, 0.14) });
    burst(steps, t, { filter: 'lowpass', freq: 180, vol: 1.6, release: 0.06 });
  }
  function breathe() { // two slow breaths, from wherever it stopped
    for (let i = 0; i < 2; i++) {
      const t = ctx.currentTime + i * 2.2;
      burst(steps, t, { filter: 'bandpass', freq: 650, q: 2.5, vol: 1, attack: 0.7, hold: 0.2, release: 0.9 });
    }
  }

  let creakIn = rnd(4, 8);
  let knockIn = rnd(9, 16);

  const pond = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'linear', refDistance: 4, maxDistance: 45 });
  pond.connect(out);
  let frogIn = rnd(3, 8), dripIn = rnd(1, 3), heard = false;
  function atPond(dt, p) {
    const at = source?.(p);
    if (!at) return;
    moveTo(ctx, pond, at);
    const t = ctx.currentTime, near = Math.hypot(at.x - p.x, at.z - p.z) < 25;
    if ((dripIn -= dt) <= 0) { plink(ctx, envelope, pond, t, 0.25); dripIn = rnd(0.7, 3); }
    if ((frogIn -= dt) <= 0) {
      frog(ctx, envelope, pond, t, rnd(26, 38), 2 + Math.floor(Math.random() * 2));
      if (Math.random() < 0.3) frog(ctx, envelope, pond, t + rnd(0.7, 1.3), rnd(18, 24), 2); // another, lower
      if (near && !heard) { subtitle('[a frog croaks in the pond]', 2.5); heard = true; }
      frogIn = rnd(5, 12);
    }
    if (!near) heard = false; // captioned again at the next pond
  }

  return {
    name: 'night',
    update(dt, camera) {
      const p = camera.position;
      circler.t += dt;
      circler.clock -= dt;
      if (circler.clock <= 0) {
        circler.moving = !circler.moving;
        circler.clock = circler.moving ? rnd(5, 11) : rnd(7, 16);
        if (circler.moving) {
          circler.dir = Math.random() < 0.5 ? -1 : 1;
          if (Math.random() < 0.4) subtitle('[something moves through the trees]', 3);
        } else if (Math.random() < 0.5) {
          breathe();
        }
      }
      if (circler.moving) {
        circler.a += circler.dir * dt * 0.16;
        circler.step -= dt;
        if (circler.step <= 0) { footstep(); circler.step = rnd(0.45, 0.75); }
      }
      const r = 8 + 3 * Math.sin(circler.t * 0.07);
      moveTo(ctx, panner, { x: p.x + Math.cos(circler.a) * r, y: p.y - 1.2, z: p.z + Math.sin(circler.a) * r });

      creakIn -= dt;
      if (creakIn <= 0) { creak(); creakIn = rnd(6, 14); }
      knockIn -= dt;
      if (knockIn <= 0) { knocks(); knockIn = rnd(10, 22); }
      atPond(dt, p);
    },
    stop(fade) {
      out.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
      setTimeout(() => {
        for (const s of running) s.stop();
        out.disconnect();
        echo.disconnect();
      }, fade * 1000 + 300);
    },
  };
}

// --- The bog ---------------------------------------------------------------------------
// By the savanna's river, under its soundtrack: the murky water moving, insects whirring in
// the reeds, frogs, slow drips and gurgles. It all comes from the nearest stretch of the
// river (source(camera position) gives the point), so it is loudest on its banks and fades
// away over the grass.
function bog(source) {
  const ctx = kit.ctx();
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, ctx.currentTime);
  out.gain.setTargetAtTime(LEVEL * 0.8, ctx.currentTime, 1.5);
  out.connect(kit.music());
  const { envelope, burst } = helpers(ctx);
  const running = [];
  const keep = (node) => { running.push(node.source ?? node); return node; };
  const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'linear', refDistance: 6, maxDistance: 80 });
  panner.connect(out);

  // The water: a low, slow murmur of moving murk.
  const water = ctx.createGain();
  water.gain.value = 0.6;
  water.connect(panner);
  keep(kit.wobble(water.gain, 0.07, 0.25));
  const murk = keep(kit.noiseInto(water, 'lowpass', 240, 0.8));
  keep(kit.wobble(murk.frequency, 0.05, 80));

  // Insects: two dry trills in the reeds, swelling and fading.
  for (const [freq, rate, vol] of [[4600, 27, 0.05], [6900, 13, 0.03]]) {
    const level = ctx.createGain();
    level.gain.value = vol;
    level.connect(panner);
    keep(kit.wobble(level.gain, rnd(0.08, 0.2), vol * 0.8));
    const trill = ctx.createGain();
    trill.gain.value = 0.5;
    trill.connect(level);
    keep(kit.wobble(trill.gain, rate, 0.5));
    keep(kit.noiseInto(trill, 'bandpass', freq, 7));
  }

  const croak = (t, rate, n) => frog(ctx, envelope, panner, t, rate, n);
  const drip = (t) => plink(ctx, envelope, panner, t);
  // A gurgle: bubbles coming up in a quick run, and a soft glug under them.
  function gurgle(t) {
    for (let i = 0, n = 3 + Math.floor(Math.random() * 4); i < n; i++) {
      const at = t + i * rnd(0.05, 0.13), o = ctx.createOscillator(), f = rnd(140, 380);
      o.frequency.setValueAtTime(f, at);
      o.frequency.exponentialRampToValueAtTime(f * rnd(1.6, 2.4), at + 0.05);
      const g = envelope(at, 0.18, 0.004, 0, 0.07);
      o.connect(g);
      g.connect(panner);
      o.start(at);
      o.stop(at + 0.15);
    }
    burst(panner, t, { filter: 'lowpass', freq: 220, vol: 0.4, attack: 0.03, release: 0.25 });
  }

  let frogIn = rnd(2, 6), dripIn = rnd(1, 3), gurgleIn = rnd(5, 10), quiet = 0;
  // Some of it is captioned, when he is near the water (quiet: seconds before the next one).
  const caption = (text, near) => {
    if (near && quiet <= 0 && Math.random() < 0.5) { subtitle(text, 2.5); quiet = 25; }
  };
  return {
    name: 'bog',
    update(dt, camera) {
      const at = source?.(camera.position);
      if (at) moveTo(ctx, panner, at);
      const near = !!at && Math.hypot(at.x - camera.position.x, at.z - camera.position.z) < 30;
      const t = ctx.currentTime;
      quiet -= dt;
      if ((frogIn -= dt) <= 0) {
        croak(t, rnd(30, 45), 2 + Math.floor(Math.random() * 2));
        if (Math.random() < 0.4) croak(t + rnd(0.6, 1.2), rnd(20, 28), 2); // another answers, lower
        caption('[frogs croak in the bog]', near);
        frogIn = rnd(3, 9);
      }
      if ((dripIn -= dt) <= 0) { drip(t); dripIn = rnd(0.8, 3.5); }
      if ((gurgleIn -= dt) <= 0) {
        gurgle(t);
        caption('[the bog gurgles]', near);
        gurgleIn = rnd(6, 14);
      }
    },
    stop(fade) {
      out.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
      setTimeout(() => {
        for (const s of running) s.stop();
        out.disconnect();
      }, fade * 1000 + 300);
    },
  };
}
