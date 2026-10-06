import { canvas, crunchy, rng } from './textures.js';

// The striped creatures' skin, painted for the whole body instead of wrapping the side
// drawing round it (which smeared over the back and the ends). u runs from the tip of the
// tail to the tip of the nose, v once round the body (the top at 0.5). The stripes are lines
// of nearly constant u, so they run over the back and close in rings round both ends,
// wavering as they go. Their colours and how many there are come from the drawing (cret1):
// bands of its pinks and purples, a thin yellow line between each, crisp dark edges either
// side. Four frames, each wavering a little differently, swapped as it moves so the
// painting boils like the drawings did. Babies are lighter and softer, with fewer stripes.

export const FRAME = 128; // px each way; the sheet is 2 x 2 frames

const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
const mean = (list) => [0, 1, 2].map((k) => list.reduce((s, c) => s + c[k], 0) / Math.max(1, list.length));
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

// The drawing's colours (its yellow lines, the darkest shadows, four bands from its pinks
// and purples) and how many yellow lines cross it from tail to nose.
export function sampleDrawing(sheet) {
  const { frameW: W, frameH: H } = sheet, f = sheet.frames[0];
  const c = canvas(W, H);
  c.getContext('2d').drawImage(sheet.img, f.x, f.y, f.w, f.h, 0, 0, W, H);
  const p = c.getContext('2d').getImageData(0, 0, W, H).data;
  const at = (x, y) => (y * W + x) * 4;
  const isYellow = (i) => p[i] > 170 && p[i + 1] > 140 && p[i] - p[i + 2] > 70;
  const yellow = [], rest = [];
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] < 128) continue;
    (isYellow(i) ? yellow : rest).push([p[i], p[i + 1], p[i + 2]]);
  }
  // From the purples to the reds (how much redder than blue for how light), each band a
  // little more saturated than the average it comes from, as bright as the painting looks.
  const part = (list, a, b) => mean(list.slice(Math.floor(a * list.length), Math.floor(b * list.length)));
  const vivid = (c, k = 1.35) => { const m = lum(c); return c.map((v) => Math.min(255, m + (v - m) * k)); };
  rest.sort((a, b) => lum(a) - lum(b));
  const dark = part(rest, 0, 0.08);
  const lit = rest.slice(Math.floor(rest.length * 0.15)).sort((a, b) => (a[0] - a[2]) / (lum(a) + 1) - (b[0] - b[2]) / (lum(b) + 1));
  yellow.sort((a, b) => lum(b) - lum(a));
  // Yellow lines met along rows through the middle of the body, per pixel of body crossed.
  let lines = 0, span = 0;
  for (let y = Math.floor(H * 0.35); y < H * 0.65; y += 3) {
    let inside = 0, was = false;
    for (let x = 0; x < W; x++) {
      const i = at(x, y);
      if (p[i + 3] < 128) { was = false; continue; }
      inside++;
      const now = isYellow(i);
      if (now && !was) lines++;
      was = now;
    }
    span += inside;
  }
  return {
    yellow: vivid(part(yellow, 0, 0.3), 1.2), dark,
    bands: [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1]].map(([a, b]) => vivid(part(lit, a, b))),
    perPx: lines / Math.max(1, span),
  };
}

// The sheet: 2 x 2 frames of FRAME px. look: sampleDrawing(); lines: yellow lines from tail
// to nose; baby: lighter and softer.
export function stripeSheet(look, lines, baby, seed = 3) {
  const r = rng(seed);
  const light = [255, 222, 232];
  const bands = look.bands.map((c) => (baby ? mix(c, light, 0.35) : c));
  const yellow = baby ? mix(look.yellow, light, 0.25) : look.yellow;
  const dark = baby ? mix(look.dark, bands[1], 0.55) : look.dark; // softer edges on a baby
  // Neighbouring bands never the same colour.
  const order = [0];
  for (let i = 1; i < 64; i++) {
    let k;
    do k = Math.floor(r() * bands.length); while (k === order[i - 1]);
    order.push(k);
  }
  const c = canvas(FRAME * 2, FRAME * 2);
  const g = c.getContext('2d');
  const img = g.createImageData(FRAME * 2, FRAME * 2);
  const TAU = Math.PI * 2;
  for (let frame = 0; frame < 4; frame++) {
    const ox = (frame % 2) * FRAME, oy = Math.floor(frame / 2) * FRAME, ph = frame * 0.7;
    for (let j = 0; j < FRAME; j++) {
      const v = (j + 0.5) / FRAME;
      for (let i = 0; i < FRAME; i++) {
        const u = (i + 0.5) / FRAME;
        // Lines of constant u, wavering round the body (every term repeats once round it).
        const s = u * lines + 0.7 * Math.sin(TAU * v + 2.1 + u * 7 + ph)
          + 0.35 * Math.sin(2 * TAU * v + u * 13 + ph * 1.3) + 0.1 * Math.sin(3 * TAU * v + u * 29 + ph * 0.6);
        const band = Math.floor(s), f = s - band;
        let col;
        if (f < (baby ? 0.13 : 0.18)) col = yellow;
        else if (f < (baby ? 0.21 : 0.26) || f > 0.95) col = dark;
        else col = bands[order[((band % 64) + 64) % 64]];
        const k = 0.9 + r() * 0.2; // the painting's grain
        const o = ((oy + j) * FRAME * 2 + ox + i) * 4;
        img.data.set([col[0] * k, col[1] * k, col[2] * k, 255], o);
      }
    }
  }
  g.putImageData(img, 0, 0);
  return crunchy(c);
}

// Points a creature's (cloned) skin at frame n of its sheet.
export function showFrame(map, n) {
  map.offset.set((n % 2) * 0.5, Math.floor(n / 2) ? 0 : 0.5); // the canvas's top row of frames is the texture's upper half
}

// The eyes' paint, on a sphere facing out of each side: a yellow ring round a dark pupil
// with a white glint up and forward, or (shut) a dark lid with a pale crease.
export function eyePaint(shut) {
  const c = canvas(32, 16);
  const g = c.getContext('2d');
  g.fillStyle = shut ? '#3a1028' : '#1c0612';
  g.fillRect(0, 0, 32, 16);
  if (shut) {
    g.fillStyle = '#7a3a58';
    g.fillRect(0, 8, 32, 1); // the crease where the lids meet
    g.fillStyle = '#56203e';
    g.fillRect(0, 0, 32, 4);
    return crunchy(c);
  }
  for (const [x, glint] of [[0, 29], [16, 19], [32, 29]]) {
    g.fillStyle = '#f0d468';
    g.beginPath(); g.ellipse(x, 8, 5, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#a8742a';
    g.beginPath(); g.ellipse(x, 9, 4, 4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0c0208';
    g.beginPath(); g.ellipse(x, 8, 2, 3.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.fillRect(glint, 5, 2, 2);
  }
  return crunchy(c);
}
