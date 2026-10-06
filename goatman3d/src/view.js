import * as THREE from 'three';
import { settings } from './options.js';
import { SPRINT_FOV } from './player.js';

// Where the camera goes, and drawing the frame.
// First person: the camera is GoatMan's head, his arms are drawn over the world
// (viewmodel.js) and looking down shows his legs. Third person (V, or the options
// menu): a chase camera behind and above him that the mouse swings round, pulled in
// when a trunk or wall is in the way. Switching eases between the two.

const DIST = 3.4; // chase camera distance
const LIFT = 0.5; // and how far above his shoulders
const SHOULDERS = 1.45;
const SWITCH = 0.5; // seconds to ease between first and third person
const LEGS_AHEAD = 0.2; // first person: his legs sit a little in front, so looking down finds them
const SWING_UP = 0.25; // looking up further than this, the chase camera stops swinging down and only tilts
const RIDE_ROLL = 1.5; // first person on the Walking Thing: the view rolls with its sway, a bit more

const clamp01 = (k) => Math.min(1, Math.max(0, k));
const ease = (k) => k * k * (3 - 2 * k);

export function createView({ renderer, scene, camera, head, player, gm, arms }) {
  const follow = new THREE.Vector3(); // eases after him, so the chase camera floats
  const target = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const chasePos = new THREE.Vector3();
  const bodyPos = new THREE.Vector3();
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
    ray.set(follow, dir.divideScalar(len));
    ray.far = len;
    const hit = ray.intersectObjects(blockers, false)[0];
    let want = hit ? Math.max(0.5, hit.distance - 0.3) : len;
    // The terrain: a few points along the way, quicker than a ray through its triangles.
    for (let d = 0.5; d < want; d += 0.25) {
      chasePos.copy(follow).addScaledVector(dir, d);
      if (terrain.some((o) => (o.userData.surface(chasePos.x, chasePos.z) ?? -Infinity) > chasePos.y - 0.2)) {
        want = Math.max(0.5, d - 0.3);
        break;
      }
    }
    // Pull in at once, ease back out.
    reach = want < reach ? want : reach + (want - reach) * (1 - Math.exp(-dt * 3));
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
      // In first person, or with the chase camera squeezed up behind him, his upper body
      // would fill the screen: only his legs are drawn.
      gm.setFirstPerson(blend < 0.2 || reach < 1.1);
      const ahead = LEGS_AHEAD * (1 - e);
      bodyPos.set(player.pos.x - Math.sin(yaw) * ahead, player.pos.y, player.pos.z - Math.cos(yaw) * ahead);
      gm.update(dt, {
        pos: bodyPos, yaw, speed: player.speed, stride: player.stride,
        grounded: player.grounded, vy: player.vel.y, sprint: player.sprint,
        ground: player.groundAt(player.pos.x, player.pos.z, player.pos.y, 0.3, 40),
      });
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
