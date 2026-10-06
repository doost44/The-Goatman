import * as THREE from 'three';
import { showHint } from './hud.js';
import { sfx } from './sfx.js';
import { rng } from './textures.js';
import { walkPath } from './terrain.js';

// Pebbles on the path that GoatMan can pick up and throw: right click or G, ported from
// automation-map/src/rocks.js. A thrown pebble knocks on whatever it hits and drops;
// anything that cares (the forest's eyes) puts an onRock() function in its userData,
// and the level lists it in world.rockTargets. One with userData.sinks (the savanna's
// water) swallows it.

const REACH = 2.6; // how close to his hooves a pebble has to be to pick it up
const AIM = 0.6; // and how close to the crosshair
const THROW_SPEED = 26;
const GRAVITY = 12;
const CENTER = new THREE.Vector2(0, 0);

export function createRocks({ camera, controls, player, gm, arms }) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x8e93ac, flatShading: true });
  let rocks = [];
  let targets = []; // what a flying pebble can hit
  let solid = []; // the same without the terrain, whose height is looked up instead
  let ground = [];
  let held = null;
  let aimed = null;
  let voidY = -50;

  // A new level: its pebbles along the path (levels.json "rocks": { count, seed }).
  function place(def, world) {
    drop();
    rocks = [];
    targets = [...(world.blockers ?? []), ...world.ground, ...(world.rockTargets ?? [])];
    solid = targets.filter((o) => !o.userData.surface);
    ground = world.ground;
    voidY = def.voidY;
    if (!def.rocks || !def.path || !world.heightAt) return;
    const r = rng(def.rocks.seed);
    const spots = walkPath(def.path.points, 1, 7);
    for (let i = 0; i < def.rocks.count; i++) {
      // the first one just ahead of the start, where it gets noticed; none in water
      let x, z, tries = 0;
      do {
        const s = spots[i === 0 ? 0 : Math.floor(r() * (spots.length - 8))];
        const off = (r() < 0.5 ? -1 : 1) * (i === 0 ? 1 : 0.8 + r() * 1.8);
        x = s.x + s.nx * off;
        z = s.z + s.nz * off;
      } while (world.wet?.(x, z) && tries++ < 20);
      const radius = 0.09 + r() * 0.07;
      const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), mat);
      mesh.scale.set(1, 0.7 + r() * 0.2, 1);
      mesh.position.set(x, world.heightAt(x, z) + radius * 0.6, z);
      mesh.rotation.set(r() * 3, r() * 3, 0);
      world.group.add(mesh);
      rocks.push({ mesh, radius, vel: new THREE.Vector3(), state: 'rest', age: 0 });
    }
  }

  function drop() {
    held = null;
    gm.holding = arms.holding = false;
  }

  const ray = new THREE.Raycaster();
  const dir = new THREE.Vector3();
  const aimAt = new THREE.Vector3();

  function act() {
    if (!controls.isLocked || player.frozen || player.mount) return;
    if (held) throwRock(held);
    else if (aimed) {
      held = aimed;
      held.state = 'held';
      gm.holding = arms.holding = true;
      sfx.pickup();
    }
  }

  // From his hand toward whatever is under the crosshair, lobbed a little so it lands there.
  function throwRock(rock) {
    const p = rock.mesh.position;
    if (gm.firstPerson) arms.handPos(p).applyMatrix4(camera.matrixWorld); // where the arms show it
    else gm.handWorld(p);
    ray.setFromCamera(CENTER, camera);
    ray.far = 80;
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) aimAt.copy(hit.point);
    else aimAt.copy(ray.ray.origin).addScaledVector(ray.ray.direction, 60);
    dir.subVectors(aimAt, p);
    const time = Math.min(1.2, dir.length() / THROW_SPEED);
    rock.vel.copy(dir.normalize()).multiplyScalar(THROW_SPEED);
    rock.vel.y += 0.5 * GRAVITY * time;
    rock.state = 'flying';
    rock.age = 0;
    rock.mesh.visible = true;
    drop();
    gm.throwArm();
    arms.throwArm();
    sfx.throwRock();
  }

  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('mousedown', (e) => { if (e.button === 2) act(); });
  addEventListener('keydown', (e) => { if (e.code === 'KeyG' && !e.repeat) act(); });

  const step = new THREE.Vector3();
  const along = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const right = new THREE.Vector3();

  // Which side of the screen a sound comes from.
  function pan(point) {
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    along.subVectors(point, camera.position).setY(0).normalize();
    return Math.max(-1, Math.min(1, along.dot(right)));
  }

  // The height of the ground under (x, z), or null off its edge.
  function groundUnder(x, z) {
    let best = null;
    for (const o of ground) {
      const h = o.userData.surface?.(x, z) ?? null;
      if (h !== null && (best === null || h > best)) best = h;
    }
    return best;
  }
  // Where a move of `far` metres from p goes into the terrain, if it does: { distance, point,
  // normal, terrain }, worked out from its height like player.js does.
  function intoGround(p, far) {
    const end = new THREE.Vector3().copy(p).addScaledVector(along, far);
    const below = groundUnder(end.x, end.z);
    if (below === null || end.y > below) return null;
    const above = p.y - (groundUnder(p.x, p.z) ?? p.y);
    const k = above > 0 ? above / (above + below - end.y) : 0; // about where it crosses
    const point = end.copy(p).addScaledVector(along, far * k);
    point.y = groundUnder(point.x, point.z) ?? point.y;
    const h = (dx, dz) => groundUnder(point.x + dx, point.z + dz) ?? point.y;
    const slope = new THREE.Vector3(h(-0.5, 0) - h(0.5, 0), 1, h(0, -0.5) - h(0, 0.5)).normalize();
    return { distance: far * k, point, normal: slope, terrain: true };
  }

  function fly(rock, dt) {
    const p = rock.mesh.position;
    rock.age += dt;
    rock.vel.y -= GRAVITY * dt;
    step.copy(rock.vel).multiplyScalar(dt);
    const len = step.length();
    along.copy(step).divideScalar(len || 1);
    // Sweep this frame's movement, so a fast pebble can't skip through a trunk.
    ray.set(p, along);
    ray.far = len + rock.radius;
    let hit = ray.intersectObjects(solid, false)[0];
    const landing = intoGround(p, ray.far);
    if (landing && (!hit || landing.distance < hit.distance)) hit = landing;
    if (!hit) {
      p.add(step);
      rock.mesh.rotation.x += dt * 9;
      rock.mesh.rotation.z += dt * 6;
      if (p.y < voidY || rock.age > 10) { rock.state = 'gone'; rock.mesh.visible = false; }
      return;
    }
    p.copy(hit.point).addScaledVector(along, -rock.radius);
    if (hit.terrain) normal.copy(hit.normal);
    else normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (hit.terrain || ground.includes(hit.object)) {
      // Land with a small bounce or two, then lie still.
      if (rock.vel.y < -4) {
        sfx.rockLand();
        rock.vel.reflect(normal).multiplyScalar(0.3);
      } else {
        p.y = hit.point.y + rock.radius * 0.6;
        rock.vel.set(0, 0, 0);
        rock.state = 'rest';
      }
      return;
    }
    if (hit.object.userData.onRock) hit.object.userData.onRock(hit);
    else sfx.knock(pan(hit.point)); // a thud on bark
    if (hit.object.userData.sinks) { rock.state = 'gone'; rock.mesh.visible = false; return; } // plop, and gone
    rock.vel.reflect(normal).multiplyScalar(0.25); // and it drops
  }

  function update(dt) {
    aimed = null;
    if (controls.isLocked && !held && !player.frozen) {
      // The pebble nearest the crosshair, if it is near his hooves.
      ray.setFromCamera(CENTER, camera);
      let best = AIM * AIM;
      for (const rock of rocks) {
        if (rock.state !== 'rest') continue;
        const p = rock.mesh.position;
        if (Math.hypot(p.x - player.pos.x, p.z - player.pos.z) > REACH) continue;
        const d = ray.ray.distanceSqToPoint(p);
        if (d < best) { best = d; aimed = rock; }
      }
    }
    for (const rock of rocks) {
      if (rock.state === 'flying') fly(rock, dt);
      else if (rock === held) {
        // In first person the arms (viewmodel.js) show it; in third, it is in his hand.
        rock.mesh.visible = !gm.firstPerson;
        gm.handWorld(rock.mesh.position);
      }
    }
    if (held) showHint('PEBBLE · RIGHT CLICK / G TO THROW', 'rock');
    else if (aimed) showHint('PEBBLE · RIGHT CLICK / G TO PICK UP', 'rock');
    else showHint(null, 'rock');
  }

  return {
    place,
    update,
    // Back to the title: nothing in his hand.
    clear() { drop(); rocks = []; targets = solid = []; showHint(null, 'rock'); },
  };
}
