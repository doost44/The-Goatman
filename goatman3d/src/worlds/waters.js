import * as THREE from 'three';
import { valueNoise } from '../terrain.js';
import { riverCourse } from './river.js';
import { nearestOnPath } from '../player.js';

// The savanna's wet ground, put together (South Carolina's lowcountry in the painting's
// colours). Most of the land is tidal salt marsh: a sheet of shallow water broken into
// hundreds of winding hummocks of marsh grass, with dry islands rising out of it (where he
// arrives, the pine flats, the sandy hills, the swamp) and the path crossing it on an old
// raised dike. The river and the marsh's tidal creeks wind through it (river.js), and there
// is still water in shallow round hollows on the islands: the Carolina bays, each with a
// sandy rim on its south-east side, and the cypress swamp. Everything the level asks about
// water comes from here: the ground's height and tint, how deep the water is, whether a spot
// is wet.
//
// levels.json "marsh": { level (the water's height), reach (metres from the middle the marsh
//   fills, before the forest at the edge), edge (metres the land takes to come down to it),
//   islands: [[x, z, radius], ...] (dry land), hummocks: { scale (how many to a metre),
//   cover (-1..1: higher, fewer), rise (metres their tops stand out of the water), shallow
//   (how deep the water is between them), tint ([r, g, b] of the grass on top) }, dike
//   (metres either side of the path it raises) }
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
  const m = def.marsh, hm = m.hummocks;
  const bed = m.level - hm.shallow; // the mud between the hummocks
  // 0 on dry land, 1 out on the marsh (its edges waver a little).
  const marsh = (x, z) => {
    const wob = 1 + 0.12 * valueNoise(x * 0.012, z * 0.012);
    let land = smooth(Math.hypot(x, z) * wob, m.reach, m.reach + m.edge);
    for (const [ix, iz, ir] of m.islands) land = Math.max(land, 1 - smooth(Math.hypot(x - ix, z - iz) * wob, ir, ir + m.edge));
    return 1 - land;
  };
  // 0 in the water, 1 on a hummock: winding shapes from noise pushed about by broader noise,
  // drawn out twice as long one way as the other (the way slowly turning across the marsh).
  const hummock = (x, z) => {
    const wx = x + 30 * valueNoise(x * 0.013 + 7, z * 0.013), wz = z + 30 * valueNoise(x * 0.013, z * 0.013 - 3);
    const a = 1.6 * valueNoise(x * 0.004 + 3, z * 0.004), c = Math.cos(a), s = Math.sin(a);
    const u = (wx * c + wz * s) * 0.5, v = wz * c - wx * s;
    const n = valueNoise(u * hm.scale, v * hm.scale) + 0.45 * valueNoise(u * hm.scale * 2.3 + 11, v * hm.scale * 2.3);
    return smooth(n, hm.cover - 0.06, hm.cover + 0.06);
  };
  // 1 on the dike the path crosses the marsh on.
  const dike = (x, z) => 1 - smooth(nearestOnPath(def.path.points, x, z).d, m.dike, m.dike + 3);
  // The marsh's ground: the hummocks (or, flat, just the mud), and the dike over them.
  const flats = (x, z, bumps) => {
    const top = m.level + hm.rise;
    return THREE.MathUtils.lerp(bumps ? bed + (top - bed) * hummock(x, z) : bed, top + 0.1, dike(x, z));
  };
  const lowland = (x, z, h = natural(x, z), bumps = true) => {
    const k = marsh(x, z);
    return k > 0 ? THREE.MathUtils.lerp(h, flats(x, z, bumps), k) : h;
  };
  const pools = (def.bays ?? []).map((b) => bay(b, lowland));
  const dug = (x, z, h, bumps = true) => pools.reduce((g, p) => p.reshape(x, z, g), lowland(x, z, h, bumps));
  // The river and creeks take their banks' level from the land as it is by then (on the
  // marsh, the mud under the water: they are its deeper channels).
  const river = riverCourse(def.river, (x, z) => dug(x, z, undefined, false));
  const creeks = (def.creeks ?? []).map((c) => riverCourse({ ...def.river, ...c }, (x, z) => dug(x, z, undefined, false)));
  const courses = [river, ...creeks];
  const all = [...courses, ...pools];
  // Out on the open water of the marsh (not on a hummock or the dike).
  const open = (x, z) => marsh(x, z) > 0.5 && hummock(x, z) < 0.5 && dike(x, z) < 0.5;
  const sheet = (x, z) => marsh(x, z) > 0.02; // where the marsh's water is drawn

  return {
    river, creeks, courses, pools, marsh, sheet, level: m.level, marshAt: [0, 0], marshSize: [m.reach, m.reach],
    swamp: pools.find((p) => p.swamp),
    // The ground's height, from the land's own (h): the marsh, the hollows, then the channels.
    reshape: (x, z, h) => courses.reduce((g, c) => c.reshape(x, z, g), dug(x, z, h)),
    // The ground's tint, [r, g, b]: mud by the water, the marsh grass on the hummocks, pale
    // sand on the rises and the bays' rims. high(x, z): 0..1 how high the land is there.
    shade(x, z, high) {
      const mud = Math.max(...all.map((w) => w.mud(x, z)));
      const sand = Math.max(high, ...pools.map((p) => p.sand(x, z)));
      const grass = marsh(x, z) * hummock(x, z) * (1 - dike(x, z));
      const c = [(1 + 0.35 * sand) * (1 - 0.6 * mud), (1 + 0.22 * sand) * (1 - 0.76 * mud), (1 + 0.05 * sand) * (1 - 0.7 * mud)];
      return c.map((v, i) => THREE.MathUtils.lerp(v, hm.tint[i], grass));
    },
    // The marsh's water is over everything there, so it is as deep as the deepest.
    depth: (x, z, y) => Math.max(sheet(x, z) ? m.level - y : 0, ...all.map((w) => w.depth(x, z, y))),
    surface(x, z) {
      if (open(x, z)) return m.level; // on the marsh, the channels are under its water
      for (const w of all) {
        const s = w.surface(x, z);
        if (s !== null) return s;
      }
      return null;
    },
    // In the water (or within `margin` metres of a channel or pool): out on the marsh's open
    // water, not its hummocks.
    wet: (x, z, margin = 1) => open(x, z) || all.some((w) => w.wet(x, z, margin)),
    // Water too deep to wander through: the channels and pools (the creatures and the Walking
    // Thing keep out of it, but splash about the marsh).
    deep: (x, z) => all.some((w) => w.wet(x, z, 0)),
    hummock,
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
