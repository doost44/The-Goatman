import * as THREE from 'three';

// Texture helpers. Everything is drawn chunky: nearest-neighbour, no mipmaps.

// Small seeded RNG so procedural placement looks the same on every load.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function retro(t, repeat) {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (Array.isArray(repeat)) t.repeat.set(repeat[0], repeat[1]);
    else t.repeat.set(repeat, repeat);
  }
  return t;
}

// A texture made from a canvas.
export const crunchy = (c, repeat) => retro(new THREE.CanvasTexture(c), repeat);

// Images are cached by URL; each call still gets its own texture (own repeat/offset).
const images = new Map();
export function loadImage(url) {
  if (!images.has(url)) {
    images.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${url}`));
      img.src = url;
    }));
  }
  return images.get(url);
}

export async function loadTexture(url, repeat) {
  const t = new THREE.Texture(await loadImage(url));
  t.needsUpdate = true;
  return retro(t, repeat);
}

// A sprite sheet made by tools/prep-assets.sh: the PNG plus its JSON of frame rects.
// setFrame(texture, i) points a (cloned) texture at one frame.
export async function loadSheet(base) {
  const json = await (await fetch(`${base}.json`)).json();
  const img = await loadImage(`${base}.png`);
  return {
    ...json,
    img,
    texture() {
      const t = retro(new THREE.Texture(img));
      t.needsUpdate = true;
      t.repeat.set(json.frameW / img.width, json.frameH / img.height);
      return t;
    },
    setFrame(t, i) {
      const f = json.frames[((i % json.count) + json.count) % json.count];
      t.offset.set(f.x / img.width, 1 - (f.y + f.h) / img.height);
    },
  };
}

// Charlie's applyContrastAndSaturation from the p5 main.js, on a canvas, same maths:
// contrast around mid grey, saturation away from the grey average, brightness, then
// a flat "blackness" subtracted from every channel. Alpha is left alone.
export function grade(c, [contrast, saturation, brightness = 1, blackness = 0]) {
  const g = c.getContext('2d');
  const data = g.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const black = blackness * 255;
  for (let i = 0; i < p.length; i += 4) {
    let r = clamp((p[i] - 128) * contrast + 128);
    let gr = clamp((p[i + 1] - 128) * contrast + 128);
    let b = clamp((p[i + 2] - 128) * contrast + 128);
    const grey = (r + gr + b) / 3;
    r = clamp(grey + (r - grey) * saturation);
    gr = clamp(grey + (gr - grey) * saturation);
    b = clamp(grey + (b - grey) * saturation);
    p[i] = clamp(clamp(r * brightness) - black);
    p[i + 1] = clamp(clamp(gr * brightness) - black);
    p[i + 2] = clamp(clamp(b * brightness) - black);
  }
  g.putImageData(data, 0, 0);
  return c;
}

// Copy an image (or part of one) into a fresh canvas so it can be graded or drawn on.
export function toCanvas(img, sx = 0, sy = 0, sw = img.width, sh = img.height) {
  const c = canvas(sw, sh);
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

// Vertical sky gradient from a list of [stop, colour] pairs.
export function gradientTexture(stops, h = 128) {
  const c = canvas(2, h);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, h);
  return crunchy(c);
}

// Soft round glow, painted small so it stays pixelated.
export function glowTexture(stops, size = 32) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 1, r, r, r);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return crunchy(c);
}

// A plain noisy colour tile for grey-box surfaces.
export function noiseTexture(base, spread = 30, size = 32, seed = 3, repeat = 1) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(seed);
  const col = new THREE.Color(base).getRGB({}, THREE.SRGBColorSpace);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = (r() - 0.5) * spread;
      g.fillStyle = `rgb(${col.r * 255 + n | 0},${col.g * 255 + n | 0},${col.b * 255 + n | 0})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  return crunchy(c, repeat);
}
