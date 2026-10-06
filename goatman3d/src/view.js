import * as THREE from 'three';
import { settings } from './options.js';
import { SPRINT_FOV } from './player.js';

// Where the camera goes, and drawing the frame.
// First person: the camera is between GoatMan's eyes, his body is drawn round it with the
// head and neck hidden (looking down shows his chest, belly, legs and hooves) and his arms
// are drawn over the world (viewmodel.js). Third person (V, or the options
// menu): a chase camera behind and above him that the mouse swings round, pulled in
// when a trunk or wall is in the way. Switching eases between the two.

const DIST = 3.4; // chase camera distance
const LIFT = 0.5; // and how far above his shoulders
const SHOULDERS = 1.45;
const SWITCH = 0.5; // seconds to ease between first and third person
const CLEAR = 0.18; // first person: the top of his chest stays at least this far below the camera
const SWING_UP = 0.25; // looking up further than this, the chase camera stops swinging down and only tilts
const WIDE = 0.3; // the chase camera also looks this far to each side of the line back from him
const RIDE_ROLL = 1.5; // first person on the Walking Thing: the view rolls with its sway, a bit more

const clamp01 = (k) => Math.min(1, Math.max(0, k));
const ease = (k) => k * k * (3 - 2 * k);

export function createView({ renderer, scene, camera, head, player, gm, arms }) {
  const follow = new THREE.Vector3(); // eases after him, so the chase camera floats
  const target = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const chasePos = new THREE.Vector3();
  const side = new THREE.Vector3();
  const eyes = new THREE.Vector3();
  const collar = new THREE.Vector3();
  const shift = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const orbit = new THREE.Euler(0, 0, 0, 'YXZ');
  let blockers = []; // what the chase camera can't see through
  let terrain = []; // ground that knows its own height (userData.surface), checked along the way
  let lights = null; // the level's ambient and sun, for the arms
  let blend = settings.camera === 'third' ? 1 : 0; // 0 first person .. 1 third person
  let reach = DIST; // chase distance, shortened when something is in the way
  let yaw = 0; // which way his body faces

  scene.add(gm.group, gm.shadow);

  // First person: his body turns with the view. Third: he faces the way he walks, or the
  // way the creature he rides is going.
  function turnBody(dt) {
    let want = yaw;
    if (blend < 0.5) want = head.rotation.y;
    else if (player.mount) want = player.mount.heading;
    else if (Math.hypot(player.vel.x, player.vel.z) > 0.5 && player.grounded) want = Math.atan2(-player.vel.x, -player.vel.z);
    yaw += Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw)) * Math.min(1, dt * 12); // the short way round
  }

  function chase(dt) {
    target.set(player.pos.x, player.pos.y + SHOULDERS, player.pos.z);
    if (follow.distanceTo(target) > 6) follow.copy(target); // a new level, or falling back in
    follow.lerp(target, 1 - Math.exp(-dt * 10));
    // Behind where he looks, but not swung down into the ground when he looks up at something
    // tall: then it stays behind his shoulders and tilts up, with him low in the frame.
    orbit.set(Math.min(head.rotation.x, SWING_UP), head.rotation.y, 0);
    dir.set(0, 0, DIST).applyEuler(orbit);
    dir.y += LIFT;
    const len = dir.length();
    dir.divideScalar(len);
    // Three lines back from his shoulders, the middle one and one each side, so a trunk just
    // beside the line still pulls the camera in front of it instead of filling the view.
    side.set(dir.z, 0, -dir.x).normalize().multiplyScalar(WIDE);
    let want = len, wall = len; // where the camera would be, and the furthest it may be at all
    for (const s of [0, 1, -1]) {
      ray.set(chasePos.copy(follow).addScaledVector(side, s), dir);
      ray.far = len;
      const hit = ray.intersectObjects(blockers, false)[0];
      if (!hit) continue;
      want = Math.min(want, Math.max(0.5, hit.distance - 0.3));
      if (s === 0) wall = want; // right in the way
    }
    // The terrain: a few points along the way, quicker than a ray through its triangles.
    for (let d = 0.5; d < Math.max(want, reach); d += 0.25) {
      chasePos.copy(follow).addScaledVector(dir, d);
      if (terrain.some((o) => (o.userData.surface(chasePos.x, chasePos.z) ?? -Infinity) > chasePos.y - 0.2)) {
        wall = Math.min(wall, Math.max(0.5, d - 0.3));
        want = Math.min(want, wall);
        break;
      }
    }
    // In at once past what is right in the way, quickly for what is beside it; out slowly.
    reach += (want - reach) * (1 - Math.exp(-dt * (want < reach ? 10 : 3)));
    reach = Math.min(reach, wall);
    return chasePos.copy(follow).addScaledVector(dir, reach);
  }

  const api = {
    get blend() { return blend; },
    forceFirst: false, // first person whatever the option says (admin mode's flying)
    // A cutscene camera (the squash): { from, to, yaw } puts the camera at `from` looking
    // at `to`, with all of him showing and facing `yaw`. Null for the normal view.
    shot: null,
    // A new level: his colours, the arms' light, what blocks the camera.
    enter(def, world) {
      api.shot = null;
      gm.reset();
      gm.setGrade(def.grade);
      lights = world.lights;
      terrain = world.ground.filter((o) => o.userData.surface);
      blockers = [...(world.blockers ?? []), ...world.ground.filter((o) => !o.userData.surface)];
      yaw = head.rotation.y;
      reach = DIST;
    },
    update(dt) {
      blend = clamp01(blend + (settings.camera === 'third' && !api.forceFirst ? dt : -dt) / SWITCH);
      const fov = settings.fov + SPRINT_FOV * player.sprint; // a little wider sprinting
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
      const e = ease(blend);
      turnBody(dt);
      if (api.shot?.yaw !== undefined) yaw = api.shot.yaw;
      // In first person his head and arms are hidden; with the chase camera squeezed up behind
      // him, all but his lower legs.
      const squeezed = blend >= 0.2 && reach < 1.1;
      gm.setFirstPerson(blend < 0.2 || squeezed, squeezed);
      const first = api.shot ? 0 : 1 - e; // a cutscene shows all of him, standing as he does
      gm.first = first;
      gm.update(dt, {
        pos: player.pos, yaw, speed: player.speed, stride: player.stride,
        grounded: player.grounded, vy: player.vel.y, sprint: player.sprint,
        ground: player.groundAt(player.pos.x, player.pos.z, player.pos.y, 0.3, 40),
      });
      // First person: his body moves so his eyes are where the camera is, across the ground.
      // Up and down his hooves stay on the ground, unless the camera dips (landing, wading)
      // further than he does: then he drops with it, so it never goes inside his chest.
      if (first > 0) {
        gm.eyes(eyes);
        gm.collar(collar);
        shift.set(head.position.x - eyes.x, Math.min(0, head.position.y - CLEAR - collar.y), head.position.z - eyes.z);
        gm.group.position.addScaledVector(shift, first);
        gm.group.updateMatrixWorld(true);
      }
      camera.position.lerpVectors(head.position, chase(dt), e);
      camera.quaternion.copy(head.quaternion);
      if (player.mount?.sway) camera.rotateZ(player.mount.sway * RIDE_ROLL * (1 - e));
      if (api.shot) {
        gm.setFirstPerson(false);
        camera.position.copy(api.shot.from);
        camera.lookAt(api.shot.to);
      }
      if (lights) arms.light(lights);
      arms.update(dt, {
        stride: player.stride, speed: player.speed, sprint: player.sprint, grounded: player.grounded,
        pitch: head.rotation.x, lower: e, fov: camera.fov, aspect: camera.aspect,
      });
    },
    render() {
      renderer.render(scene, camera);
      if (blend < 1 && arms.visible && !api.shot) {
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(arms.scene, arms.camera);
        renderer.autoClear = true;
      }
    },
  };
  return api;
}
