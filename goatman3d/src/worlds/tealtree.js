import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadImage, toCanvas, canvas, crunchy, grade, glowTexture } from '../textures.js';
import { drape } from '../terrain.js';

// The teal tree, the savanna's landmark, from tree.png. Its canopy is the painting cut out
// of cardboard: a few cut-outs standing crossed round the middle so it looks whole from
// anywhere, and one lying flat inside, which is what you see from underneath. The trunk
// and branches are low-poly cylinders wrapped in the painted trunk.
//
// levels.json "tree": { at: [x, z], texture, height, thick (cut-out thickness), cards,
//   grade, keepOut (how close the Walking Thing's body comes) }

const BAND = 4; // pixel rows per strip of a cut-out
const CANOPY_BOTTOM = 178; // rows below this are only trunk
const TRUNK = [113, 132, 186, 254]; // the trunk in the painting: x0, x1, y0, y1
const EDGE = '#1d5a62'; // the cut edges

// Runs of paint along one row of pixels: [[from, to], ...].
function runs(data, W, row) {
  const out = [];
  let from = -1;
  for (let x = 0; x <= W; x++) {
    const on = x < W && data[(row * W + x) * 4 + 3] > 127;
    if (on && from < 0) from = x;
    if (!on && from >= 0) { if (x - from > 1) out.push([from, x]); from = -1; }
  }
  return out;
}

// A cut-out with thickness that follows the paint: each run of paint in every few rows is a
// thin box, so its edges are only where the paint is and the drips hang free. In pixels,
// x from 0 to W and y up from the bottom row; the faces show the painting, the edges `edgeU`.
function cutout(data, W, H, rows, texW, edgeU) {
  const boxes = [];
  for (let y = 0; y < rows; y += BAND) {
    for (const [a, b] of runs(data, W, Math.min(y + BAND / 2, rows - 1))) {
      const box = new THREE.BoxGeometry(b - a, BAND, 1).translate((a + b) / 2, H - y - BAND / 2, 0);
      const pos = box.attributes.position, uv = box.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        // BoxGeometry's faces are +x, -x, +y, -y (the edges), then +z, -z (front and back)
        if (i >= 16) uv.setXY(i, pos.getX(i) / texW, pos.getY(i) / H);
        else uv.setXY(i, edgeU, 0.5);
      }
      boxes.push(box);
    }
  }
  const geo = mergeGeometries(boxes);
  for (const box of boxes) box.dispose();
  return geo;
}

export async function buildTealTree(d, heightAt) {
  const img = await loadImage(d.texture);
  const W = img.width, H = img.height;
  const m = d.height / H; // metres per pixel
  const [x, z] = d.at;
  const y = heightAt(x, z) - 0.3;

  // The painting, brightened like the video, plus a strip of the edge colour.
  const c = canvas(W + 4, H);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  grade(c, d.grade);
  g.fillStyle = EDGE;
  g.fillRect(W, 0, 4, H);
  const alpha = toCanvas(img).getContext('2d').getImageData(0, 0, W, H).data;
  const map = crunchy(c);

  // One cut-out of the canopy, centred on its middle, in metres.
  const card = cutout(alpha, W, H, CANOPY_BOTTOM, W + 4, (W + 2) / (W + 4));
  card.computeBoundingBox();
  const mid = (card.boundingBox.min.x + card.boundingBox.max.x) / 2;
  card.translate(-mid, 0, 0);
  card.scale(m, m, d.thick);

  const group = new THREE.Group();
  group.position.set(x, y, z);
  const cardMat = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, flatShading: true });
  const canopy = [];
  // turned half a step so that none is seen edge-on (a thin line) from where he arrives
  for (let i = 0; i < d.cards; i++) canopy.push(card.clone().rotateY(((i + 0.5) / d.cards) * Math.PI));
  // Lying flat in the canopy: the underside of the leaves.
  const low = (H - CANOPY_BOTTOM) * m, high = H * m;
  canopy.push(card.clone().translate(0, -(low + high) / 2, 0).scale(0.7, 0.8, 0.7).rotateX(-Math.PI / 2).rotateY(0.4).translate(0, low + (high - low) * 0.4, 0));
  group.add(new THREE.Mesh(mergeGeometries(canopy), cardMat));
  for (const geo of canopy) geo.dispose();

  // The trunk and its branches, in the painting's orange-red trunk.
  const bark = canvas(16, 64);
  bark.getContext('2d').drawImage(img, TRUNK[0] + 3, TRUNK[2], TRUNK[1] - TRUNK[0] - 6, TRUNK[3] - TRUNK[2], 0, 0, 16, 64);
  grade(bark, d.grade);
  const barkMat = new THREE.MeshLambertMaterial({ map: crunchy(bark, [2, 3]), flatShading: true });
  const top = low + 3; // the trunk goes up into the canopy
  const width = (TRUNK[1] - TRUNK[0]) * m;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.32, width * 0.5, top, 7).translate(0, top / 2, 0), barkMat);
  group.add(trunk);
  // Branches: up and out from where the canopy starts, into it.
  for (let i = 0; i < 6; i++) {
    const turn = i * 1.1 + 0.4, tilt = 0.6 + (i % 3) * 0.17, len = d.height * (0.2 + (i % 2) * 0.07);
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.08, width * 0.26, len, 5).translate(0, len / 2, 0), barkMat);
    branch.position.y = low - 1 + (i % 3) * 1.1;
    branch.rotation.set(0, turn, tilt, 'YZX');
    group.add(branch);
  }

  // Its shade on the grass.
  const reach = W * m * 0.45;
  const shade = new THREE.Mesh(
    drape(new THREE.CircleGeometry(reach, 16).rotateX(-Math.PI / 2).translate(x, 0, z), heightAt, 0.05),
    new THREE.MeshBasicMaterial({ map: glowTexture([[0, 'rgba(8,0,6,0.55)'], [0.6, 'rgba(8,0,6,0.3)'], [1, 'rgba(8,0,6,0)']]), transparent: true, depthWrite: false }),
  );

  return {
    meshes: [group, shade],
    blockers: [trunk],
    colliders: [{ kind: 'circle', x, z, r: width * 0.5 + 0.2 }],
    // The Walking Thing keeps its body out of the canopy.
    keepOut: { kind: 'circle', x, z, r: d.keepOut },
  };
}
