import * as THREE from 'three';
import { valueNoise } from '../terrain.js';
import { riverCourse } from './river.js';

// The savanna's wet ground, put together (South Carolina's lowcountry in the painting's
// colours): the salt marsh, a broad lowland flattened to just above the water; the river and
// the marsh's tidal creeks winding through it (river.js); and still water in shallow round
// hollows: the Carolina bays out on the open land, each with a sandy rim on its south-east
// side, and the cypress swamp. Everything the level asks about water comes from here: the
// ground's height and tint, how deep the water is, whether a spot is wet.
//
// levels.json "marsh": { at: [x, z], size: [rx, rz], level (the flats' height), edge (metres
//   the land takes to come down to it) }
// "bays": [{ at, size: [long, short] (to the waterline), turn (degrees; Carolina bays all
//   lie north-west to south-east), deep (the hollow), water (how deep in the middle), rim
//   (the sandy rim's height), swamp (true: the cypress swamp) }]
// plus "river" and "creeks" (river.js).

const smooth = THREE.MathUtils.smoothstep;

// A Carolina bay (or the swamp): an oval hollow with a gently wavering edge.
function bay(b, ground) {
  const [cx, cz] = b.at, [long, short] = b.size, turn = THREE.MathUtils.degToRad(b.turn ?? -45);
  const wobble = b.swamp ? 0.22 : 0.08;
  const bank = ground(cx, cz); // the land's height round it, before it was dug
  // From the waterline at 1 (cos profile), the hollow reaches out to `out`.
  const out = Math.PI / Math.acos(1 - (2 * b.water) / b.deep);
  const level = bank - b.deep + b.water;
  // Metres from the middle to the waterline, at an angle round it (world angle, from +x).
  const outline = (a) => {
    const t = a - turn;
    const e = (long * short) / Math.hypot(short * Math.cos(t), long * Math.sin(t));
    return e * (1 + wobble * valueNoise(Math.cos(a) * 1.7 + cx * 0.01, Math.sin(a) * 1.7 + cz * 0.01));
  };
  // How far out (x, z) is, with the waterline at 1.
  const at = (x, z) => Math.hypot(x - cx, z - cz) / outline(Math.atan2(z - cz, x - cx));
  const se = new THREE.Vector2(Math.cos(Math.PI / 4), Math.sin(Math.PI / 4)); // +x east, +z south
  return {
    at: b.at, level, outline, swamp: !!b.swamp, size: long,
    reshape(x, z, h) {
      const e = at(x, z);
      if (e > out * 1.25) return h;
      const flat = THREE.MathUtils.lerp(h, bank, 1 - smooth(e, out * 0.8, out * 1.2));
      const dig = e < out ? b.deep * (0.5 + 0.5 * Math.cos((Math.PI * e) / out)) : 0;
      const side = Math.max(0, ((x - cx) * se.x + (z - cz) * se.y) / (Math.hypot(x - cx, z - cz) || 1));
      const rim = (b.rim ?? 0) * side * Math.exp(-(((e - out) / (out * 0.18)) ** 2));
      return flat - dig + rim;
    },
    sand(x, z) { // the rim and the shore
      const e = at(x, z);
      return e > 0.9 && e < out * 1.3 ? smooth(e, 0.9, 1.4) * (1 - smooth(e, out, out * 1.3)) : 0;
    },
    mud: (x, z) => 1 - smooth(at(x, z), 1, 1.35),
    depth: (x, z, y) => (at(x, z) < 1.2 ? Math.max(0, level - y) : 0),
    surface: (x, z) => (at(x, z) < 1.1 ? level : null),
    wet: (x, z, margin = 1) => Math.hypot(x - cx, z - cz) < outline(Math.atan2(z - cz, x - cx)) + margin,
    inside: (x, z, k = 1) => at(x, z) < k,
  };
}

// natural(x, z): the land's own height (terrain.js terrainHeight).
export function createWaters(def, natural) {
  const m = def.marsh;
  const [mx, mz] = m.at, [rx, rz] = m.size;
  // 0 out on the land, 1 on the marsh flats (its edge wavers a little).
  const marsh = (x, z) => {
    const e = Math.hypot((x - mx) / rx, (z - mz) / rz) * (1 + 0.12 * valueNoise(x * 0.012, z * 0.012));
    return 1 - smooth(e, 1, 1 + m.edge / Math.min(rx, rz));
  };
  const lowland = (x, z, h = natural(x, z)) => THREE.MathUtils.lerp(h, m.level, marsh(x, z));
  const pools = (def.bays ?? []).map((b) => bay(b, lowland));
  const dug = (x, z, h) => pools.reduce((g, p) => p.reshape(x, z, g), lowland(x, z, h));
  // The river and creeks take their banks' level from the land as it is by then.
  const river = riverCourse(def.river, dug);
  const creeks = (def.creeks ?? []).map((c) => riverCourse({ ...def.river, ...c }, dug));
  const courses = [river, ...creeks];
  const all = [...courses, ...pools];

  return {
    river, creeks, courses, pools, marsh, marshAt: m.at, marshSize: m.size,
    swamp: pools.find((p) => p.swamp),
    // The ground's height, from the land's own (h): the marsh, the hollows, then the channels.
    reshape: (x, z, h) => courses.reduce((g, c) => c.reshape(x, z, g), dug(x, z, h)),
    // The ground's tint, [r, g, b]: mud by the water, the marsh's darker flats, pale sand on
    // the rises and the bays' rims. high(x, z): 0..1 how high the land is there (the rises).
    shade(x, z, high) {
      const mud = Math.max(...all.map((w) => w.mud(x, z)));
      const flats = marsh(x, z), sand = Math.max(high, ...pools.map((p) => p.sand(x, z)));
      const k = 1 - 0.25 * flats;
      return [
        k * (1 + 0.35 * sand) * (1 - 0.6 * mud),
        k * (1 + 0.22 * sand) * (1 - 0.76 * mud),
        (k + 0.12 * flats) * (1 + 0.05 * sand) * (1 - 0.7 * mud),
      ];
    },
    depth: (x, z, y) => Math.max(...all.map((w) => w.depth(x, z, y))),
    surface(x, z) {
      for (const w of all) {
        const s = w.surface(x, z);
        if (s !== null) return s;
      }
      return null;
    },
    wet: (x, z, margin = 1) => all.some((w) => w.wet(x, z, margin)),
    // Roughly where the water's sounds come from: its nearest point to p.
    closest(p) {
      let best = null;
      for (const c of courses) {
        const q = c.closest(p.x, p.z);
        if (!best || q.d < best.d) best = { x: q.x, z: q.z, y: q.level - def.river.water, d: q.d };
      }
      for (const w of pools) {
        const a = Math.atan2(p.z - w.at[1], p.x - w.at[0]), r = Math.min(w.outline(a), Math.hypot(p.x - w.at[0], p.z - w.at[1]));
        const x = w.at[0] + Math.cos(a) * r, z = w.at[1] + Math.sin(a) * r, d = Math.hypot(p.x - x, p.z - z);
        if (d < best.d) best = { x, z, y: w.level, d };
      }
      return best;
    },
  };
}
