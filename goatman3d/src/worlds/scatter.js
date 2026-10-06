import * as THREE from 'three';

// Thousands of copies of a few things spread over a big level (the forest's trunks, roots,
// fallen trunks, undergrowth and stones), drawn only where the camera can see them. Each kind
// of thing is one InstancedMesh, refilled whenever the camera moves or turns with the copies
// within `reach` (the fog hides everything further) that are in its view, so the whole forest
// is a draw call per kind with a few hundred copies in each.
//
// kind(geometry, material) adds a kind of thing and returns its number; add(kind, matrix,
// color?) puts a copy in (matrix: its place in the world, color: a THREE.Color tint);
// done() makes the meshes, one per kind in the same order, once everything is in.

const CELL = 16; // metres per square of the grid the copies are sorted into
const NEAR = 6; // metres round the camera where everything is drawn, in view or not (the chase camera bumps into it)
const MARGIN = 0.5; // metres added round each copy when testing whether it is in view

export function createScatter({ reach = 45 } = {}) {
  const kinds = []; // { geometry, material, matrices, colors, mesh }
  // "ix,iz" -> per copy: kind, number, x, z (where it stands), and the middle and radius of
  // a ball round it (x, y, z, r)
  const grid = new Map();
  const meshes = [];
  const frustum = new THREE.Frustum(), ball = new THREE.Sphere(), seen = new THREE.Matrix4(), p = new THREE.Vector3();
  const lastView = new THREE.Matrix4(), lastLens = new THREE.Matrix4();
  let lastReach = 0;

  function kind(geometry, material) {
    kinds.push({ geometry, material, matrices: [], colors: [] });
    return kinds.length - 1;
  }

  function add(k, matrix, color) {
    const { matrices, colors } = kinds[k];
    const copy = colors.length / 3;
    matrices.push(...matrix.elements);
    colors.push(color?.r ?? 1, color?.g ?? 1, color?.b ?? 1);
    const x = matrix.elements[12], z = matrix.elements[14];
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    const { geometry } = kinds[k];
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    ball.copy(geometry.boundingSphere).applyMatrix4(matrix);
    grid.get(key).push(k, copy, x, z, ball.center.x, ball.center.y, ball.center.z, ball.radius);
  }

  function done() {
    for (const K of kinds) {
      const n = Math.max(1, K.colors.length / 3);
      K.matrices = Float32Array.from(K.matrices);
      K.colors = Float32Array.from(K.colors);
      K.mesh = new THREE.InstancedMesh(K.geometry, K.material, n);
      K.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      K.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
      K.mesh.count = 0;
      K.mesh.frustumCulled = false; // each copy is tested instead
      K.mesh.renderOrder = -1; // before the ground and sky, so the graphics card can skip what the wood hides
      meshes.push(K.mesh);
    }
    return meshes;
  }

  function refill(camera) {
    const reach = scatter.reach;
    p.setFromMatrixPosition(camera.matrixWorld);
    frustum.setFromProjectionMatrix(seen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const K of kinds) K.mesh.count = 0;
    // The squares nearest the camera first, so the nearest copies are drawn first and the
    // graphics card can skip the parts of the ones behind that they hide.
    const n = Math.ceil(reach / CELL), cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    const cells = [];
    for (let ix = cx - n; ix <= cx + n; ix++) {
      for (let iz = cz - n; iz <= cz + n; iz++) {
        const cell = grid.get(`${ix},${iz}`);
        if (cell) cells.push([((ix + 0.5) * CELL - p.x) ** 2 + ((iz + 0.5) * CELL - p.z) ** 2, cell]);
      }
    }
    cells.sort((a, b) => a[0] - b[0]);
    for (const [, cell] of cells) {
      for (let j = 0; j < cell.length; j += 8) {
        const d2 = (cell[j + 2] - p.x) ** 2 + (cell[j + 3] - p.z) ** 2;
        if (d2 > reach * reach) continue;
        if (d2 > NEAR * NEAR) {
          ball.center.set(cell[j + 4], cell[j + 5], cell[j + 6]);
          ball.radius = cell[j + 7] + MARGIN;
          if (!frustum.intersectsSphere(ball)) continue;
        }
        const K = kinds[cell[j]], from = cell[j + 1], to = K.mesh.count++;
        for (let e = 0; e < 16; e++) K.mesh.instanceMatrix.array[to * 16 + e] = K.matrices[from * 16 + e];
        for (let e = 0; e < 3; e++) K.mesh.instanceColor.array[to * 3 + e] = K.colors[from * 3 + e];
      }
    }
    for (const { mesh } of kinds) {
      mesh.visible = mesh.count > 0;
      // only the copies in use go to the graphics card
      for (const [buffer, size] of [[mesh.instanceMatrix, 16], [mesh.instanceColor, 3]]) {
        buffer.clearUpdateRanges();
        buffer.addUpdateRange(0, Math.max(1, mesh.count) * size);
        buffer.needsUpdate = true;
      }
      mesh.boundingSphere = null; // worked out again for raycasts
    }
  }

  const scatter = {
    meshes,
    reach, // can be changed (admin mode draws the whole forest with the fog off)
    kind,
    add,
    done,
    // Call once the camera is placed for the frame: refills if it has moved, turned or zoomed.
    update(camera) {
      camera.updateMatrixWorld();
      if (lastView.equals(camera.matrixWorld) && lastLens.equals(camera.projectionMatrix) && lastReach === scatter.reach) return;
      lastView.copy(camera.matrixWorld);
      lastLens.copy(camera.projectionMatrix);
      lastReach = scatter.reach;
      refill(camera);
    },
  };
  return scatter;
}
