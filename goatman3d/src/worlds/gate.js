import * as THREE from 'three';
import { drape } from '../terrain.js';
import { loadImage, canvas, crunchy, glowTexture } from '../textures.js';

// The way out of the night forest: not a doorway at the end of the path but a low gap where a
// fallen trunk leans against a standing one, in a thicket off to the side of where the path
// gives out. Only a faint pink in the fog, over the trees and on the wood nearby gives it
// away, and the red field shows through the gap only when he is close and facing it.
//
// levels.json "exit": { at: [x, z] (the middle of the gap), facing (degrees: which way he
//   looks into it, like a spawn's yaw), gap (metres across at the ground), apex (how high it
//   is where the trunks meet), trunkRadius, reach (how far the pink reaches), fog (its colour),
//   tint (how pink the fog gets), glimpse: { sky, cloud, peaks, grass } }

const HORIZON = 1.1; // metres up the gap where the red field's horizon shows (a little under his eyes, for more sky)

export async function buildGate(def, heightAt, r) {
  const E = def.exit;
  const [gx, gz] = E.at;
  const f = THREE.MathUtils.degToRad(E.facing);
  const ix = -Math.sin(f), iz = -Math.cos(f); // into the gap
  const nx = -iz, nz = ix; // across it
  const R = E.trunkRadius, w = E.gap / 2;
  const y = heightAt(gx, gz);
  const trunk = (x, z, o) => ({
    x, z, y: heightAt(x, z) - 0.3, card: false, yaw: r() * 6, art: 0, tint: 1.2 + r() * 0.5, noRoots: true,
    lean: 0.04 + r() * 0.08, leanDir: r() * 6, height: 24 + r() * 8, room: o.radius, ...o,
    collider: { kind: 'circle', x, z, r: o.radius },
  });
  const across = (side) => [gx + nx * side, gz + nz * side];
  // The standing trunk on one side; the fallen one from the other side leans on it, its
  // underside running from the ground up to the standing one's side at the apex.
  const lean = Math.atan((2 * w) / E.apex), rb = R * 0.8;
  const standing = w + R, fallen = -w - rb / Math.cos(lean); // across, from the gap's middle
  const trunks = [
    trunk(...across(standing), { radius: R, height: 30, lean: 0.04, leanDir: Math.atan2(nz, nx) }),
    trunk(...across(fallen), { radius: rb, height: (standing - fallen) / Math.sin(lean) + 0.4, lean, leanDir: Math.atan2(nz, nx) }),
  ];
  // The thicket round its back and sides, open only in front.
  for (let i = 0; i < 22; i++) {
    const a = Math.atan2(iz, ix) + (r() - 0.5) * 2 * 2.1, d = 3.6 + r() * 3.6;
    trunks.push(trunk(gx + Math.cos(a) * d, gz + Math.sin(a) * d, { radius: 0.35 + r() * 0.5 }));
  }

  // Level 2 seen through the gap, painted from its own art: a triangle the shape of the gap,
  // a little bigger so its edges are hidden in the wood, just behind the trunks' middles.
  const low = -0.3, top = E.apex + 0.4, left = -w - 0.5, right = w + 0.4;
  const geo = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(left, low), new THREE.Vector2(right, low), new THREE.Vector2(right, top)]));
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - left) / (right - left), (pos.getY(i) - low) / (top - low));
  const fade = { transparent: true, depthWrite: false, fog: false, opacity: 0 };
  const view = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: await paintGlimpse(E.glimpse, 1 - (HORIZON - low) / (top - low)), ...fade }));
  view.position.set(gx + ix * 0.25, y, gz + iz * 0.25);
  view.rotation.y = Math.atan2(-ix, -iz);
  // A faint glow in the gap, on the ground in front of it, and over the trees above it.
  const pink = (a) => glowTexture([[0, `rgba(255,190,215,${a})`], [0.45, `rgba(255,140,190,${a * 0.35})`], [1, 'rgba(255,120,180,0)']]);
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 };
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: pink(0.6), ...additive }));
  halo.scale.set(3, 3.4, 1);
  halo.position.set(gx - ix * 0.5, y + 1.2, gz - iz * 0.5);
  const spillGeo = new THREE.PlaneGeometry(3, 3.6, 3, 4).rotateX(-Math.PI / 2).rotateY(Math.atan2(ix, iz)).translate(gx - ix * 1.6, 0, gz - iz * 1.6);
  const spill = new THREE.Mesh(drape(spillGeo, heightAt, 0.05), new THREE.MeshBasicMaterial({ map: pink(0.5), ...additive }));
  const above = new THREE.Sprite(new THREE.SpriteMaterial({ map: pink(0.5), ...additive }));
  above.scale.set(26, 18, 1);
  above.position.set(gx + ix * 2, y + 12, gz + iz * 2);
  const light = new THREE.Group();
  light.add(view, halo, spill, above);

  const to = new THREE.Vector3(), look = new THREE.Vector3();
  const smooth = THREE.MathUtils.smoothstep;
  return {
    x: gx, z: gz, trunks, light,
    // Room in front to stand, and behind the gap.
    keepClear: [[gx - ix * 3, gz - iz * 3, 2.6], [gx + ix * 1.5, gz + iz * 1.5, 1.5]],
    // He can stand at the gap, not go through it.
    colliders: [{ kind: 'circle', x: gx + ix * 0.4, z: gz + iz * 0.4, r: 0.7 }],
    // How much the pink tints the wood at (x, z).
    blush: (x, z) => 0.9 * (1 - smooth(Math.hypot(x - gx, z - gz), 4, 18)),
    // How near he is (0 far off, 1 at it), for the fog's tint.
    near: (p) => 1 - smooth(Math.hypot(p.x - gx, p.z - gz), 3, E.reach),
    update(t, camera) {
      // Seen only close up, from in front and looking at it.
      to.set(gx - camera.position.x, 0, gz - camera.position.z);
      const dist = to.length();
      to.divideScalar(dist || 1);
      camera.getWorldDirection(look).setY(0).normalize();
      const front = smooth(to.x * ix + to.z * iz, 0.2, 0.6);
      const seen = (1 - smooth(dist, 4, 10)) * smooth(to.dot(look), 0.55, 0.9) * front;
      const breathe = 0.8 + 0.12 * Math.sin(t * 0.8) + 0.05 * Math.sin(t * 3.1);
      view.material.opacity = seen;
      view.visible = seen > 0.01;
      halo.material.opacity = breathe * (0.15 + 0.6 * seen) * front;
      spill.material.opacity = breathe * (0.2 + 0.5 * seen) * front;
      above.material.opacity = breathe * 0.14;
    },
  };
}

// The glimpse as a picture 256 x 320, its horizon (0-1 down from the top) where the far peaks go.
async function paintGlimpse(art, horizon) {
  const W = 256, H = 320, h = Math.round(H * horizon);
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.drawImage(await loadImage(art.sky), 30, 0, 196, 157, 0, 0, W, h + 4);
  g.drawImage(await loadImage(art.cloud), 20, h * 0.35, 200, 80);
  g.drawImage(await loadImage(art.peaks), 100, 0, 300, 56, 0, h - 44, W, 46);
  // haze toward the horizon, like the fog of level 2
  const haze = g.createLinearGradient(0, h * 0.4, 0, h);
  haze.addColorStop(0, 'rgba(255,215,228,0)');
  haze.addColorStop(1, 'rgba(255,215,228,0.5)');
  g.fillStyle = haze;
  g.fillRect(0, h * 0.4, W, h * 0.6);
  g.drawImage(await loadImage(art.grass), 0, 0, 128, 40, 0, h - 2, W, H - h + 2);
  return crunchy(c);
}
