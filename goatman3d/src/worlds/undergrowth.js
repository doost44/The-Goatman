import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas, crunchy } from '../textures.js';
import { walkPath } from '../terrain.js';

// The night forest's floor: dark undergrowth (ferns and low bushes painted here, each three
// crossed cards) and stones half sunk in the ground, both drawn through the scatter (only
// near the camera); and tufts of grass along the main path.
//
// levels.json "undergrowth": { count, size: [min, max], colors, stone (colour) }

// Ferns on the left half, a low bush on the right, in the dark grass colours.
function paintGrowth(colors, r) {
  const c = canvas(128, 32);
  const g = c.getContext('2d');
  g.lineWidth = 2; // thicker than a pixel, so the cut-out keeps them
  const pick = () => colors[Math.floor(r() * colors.length)];
  for (let i = 0; i < 9; i++) {
    const a = (r() - 0.5) * 2.4, len = 14 + r() * 16;
    const ex = 32 + Math.sin(a) * len, ey = 31 - Math.cos(a) * len * 0.75 + Math.abs(a) * 4; // fronds droop
    const mx = 32 + Math.sin(a) * len * 0.4, my = 31 - len * 0.8;
    g.strokeStyle = pick();
    g.beginPath();
    g.moveTo(32 + (r() - 0.5) * 4, 32);
    g.quadraticCurveTo(mx, my, ex, ey);
    g.stroke();
    for (let k = 0.3; k < 1; k += 0.14) { // leaflets either side
      const x = (1 - k) ** 2 * 32 + 2 * (1 - k) * k * mx + k * k * ex, y = (1 - k) ** 2 * 32 + 2 * (1 - k) * k * my + k * k * ey;
      const leaf = 4 * (1.1 - k);
      g.beginPath();
      g.moveTo(x - leaf, y - leaf * 0.6);
      g.lineTo(x, y);
      g.lineTo(x + leaf, y - leaf * 0.6);
      g.stroke();
    }
  }
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI, d = Math.sqrt(r());
    const x = 96 + Math.cos(a) * d * 28, y = 32 - Math.sin(a) * d * 22;
    g.fillStyle = pick();
    g.beginPath();
    g.ellipse(x, y, 2 + r() * 3, 1.5 + r() * 2, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return crunchy(c);
}

// Three cards crossed at 60 degrees, 1 wide and 0.5 tall, showing u0..u1 of the painting.
// They are lit like the ground they grow from (normals straight up).
function crossed(u0, u1) {
  const cards = [0, 1, 2].map((i) => new THREE.PlaneGeometry(1, 0.5).translate(0, 0.22, 0).rotateY((i * Math.PI) / 3));
  const geo = mergeGeometries(cards);
  const uv = geo.attributes.uv, normal = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    uv.setX(i, u0 + uv.getX(i) * (u1 - u0));
    normal.setXYZ(i, 0, 1, 0);
  }
  return geo;
}

const m = new THREE.Matrix4(), q = new THREE.Quaternion(), turn = new THREE.Euler();
const pos = new THREE.Vector3(), size = new THREE.Vector3(), color = new THREE.Color();

// Puts woods.js's undergrowth and stones into the scatter.
export function buildUndergrowth(plan, scatter, def, r) {
  const mat = new THREE.MeshLambertMaterial({ map: paintGrowth(def.colors, r), alphaTest: 0.5, side: THREE.DoubleSide });
  const shapes = [crossed(0, 0.5), crossed(0.5, 1)].map((geo) => scatter.kind(geo, mat));
  for (const g of plan.growth) {
    m.compose(pos.set(g.x, g.y, g.z), q.setFromEuler(turn.set(0, g.yaw, 0)), size.setScalar(g.size));
    scatter.add(shapes[g.shape], m, color.setScalar(0.8 + r() * 0.6));
  }
  const stone = scatter.kind(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: def.stone, flatShading: true }));
  for (const s of plan.stones) {
    m.compose(pos.set(s.x, s.y - s.size * 0.25, s.z), q.setFromEuler(turn.set(s.tilt, s.yaw, 0)), size.set(s.size, s.size * 0.6, s.size * 0.85));
    scatter.add(stone, m, color.setScalar(0.6 + r() * 0.7));
  }
}

// Tufts of dark grass along the path: crossed cards of thin blades, painted here.
export function buildGrass(def, path, heightAt, r) {
  const c = canvas(32, 16);
  const g = c.getContext('2d');
  for (let i = 0; i < 18; i++) {
    g.strokeStyle = def.colors[Math.floor(r() * def.colors.length)];
    g.beginPath();
    const x = 2 + r() * 28;
    g.moveTo(x, 16);
    g.lineTo(x + (r() - 0.5) * 8, 2 + r() * 9);
    g.stroke();
  }
  const geos = [];
  for (const s of walkPath(path.points, def.spacing)) {
    for (let k = 0; k < 2; k++) {
      const off = (r() < 0.5 ? -1 : 1) * (def.from + r() * (def.to - def.from));
      const x = s.x + s.nx * off + (r() - 0.5) * 2, z = s.z + s.nz * off + (r() - 0.5) * 2;
      const tuft = 0.5 + r() * 0.5;
      const a = r() * Math.PI;
      for (const turn90 of [0, Math.PI / 2]) {
        geos.push(new THREE.PlaneGeometry(tuft * 1.4, tuft * 0.7).translate(0, tuft * 0.33, 0).rotateY(a + turn90).translate(x, heightAt(x, z), z));
      }
    }
  }
  const mat = new THREE.MeshLambertMaterial({ map: crunchy(c), alphaTest: 0.5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
  for (const geo of geos) geo.dispose();
  return mesh;
}
