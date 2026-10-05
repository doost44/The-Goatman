import * as THREE from 'three';
import { glowTexture } from './textures.js';
import { sfx, loopsLevel } from './sound.js';
import { fadeTo, shake, showMessage, subtitle } from './hud.js';
import { settings } from './options.js';

// "Grab Their LEG": the squashed ending, built on automation-map's doom.js (where throwing
// the last rock off the island brings the sky down). GoatMan grabs the nearest leg, the
// Walking Thing shrieks, the sky goes black, a red aura opens overhead, and it rears up
// and lifts its foot over him. The foot swells as it rises and comes down on the camera:
// white. Then, from outside, GoatMan on his knees in the red grass under the lifting foot,
// his head coming off on its blue strands. Timings: levels.json, field "outcomes.squash".

const DOOM_FOG = new THREE.Color(0x1a0406);
const DOOM_AMBIENT = new THREE.Color(0xff5040);
const UP = new THREE.Vector3(0, 1, 0);

export function createSquash({ scene, camera, head, player, gm, view, levels }) {
  const jobs = []; // things changing over time, run by update() in game time
  const during = (time, fn) => new Promise((resolve) => jobs.push({ t: 0, time: Math.max(time, 0.001), fn, resolve }));
  const look = new THREE.Vector3(); // what the camera is made to look at
  let aiming = 0; // how quickly it turns there (0 = it doesn't)
  let doom = null; // the dark sky, while it is happening

  function update(dt) {
    for (const j of [...jobs]) {
      j.t = Math.min(1, j.t + dt / j.time);
      j.fn(j.t);
      if (j.t >= 1) { jobs.splice(jobs.indexOf(j), 1); j.resolve(); }
    }
    if (aiming) aim(dt);
    if (doom) doom.dome.position.copy(camera.position);
  }

  // Turn his head toward `look`, the short way round.
  function aim(dt) {
    const dx = look.x - head.position.x, dy = look.y - head.position.y, dz = look.z - head.position.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const k = Math.min(1, dt * aiming);
    head.rotation.y += Math.atan2(Math.sin(yaw - head.rotation.y), Math.cos(yaw - head.rotation.y)) * k;
    head.rotation.x += (Math.min(1.45, pitch) - head.rotation.x) * k;
  }

  // From doom.js: a black dome round the camera fading in over the sky, the fog going dark
  // red, the lights dimming, and a red aura overhead.
  function darkness() {
    const world = levels.world.group;
    const ambient = world.children.find((o) => o.isAmbientLight);
    const sun = world.children.find((o) => o.isDirectionalLight);
    const base = { fog: scene.fog.color.clone(), ambient: ambient.intensity, ambientColor: ambient.color.clone(), sun: sun.intensity };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(55, 12, 8), // all but the creature and the ground round him
      new THREE.MeshBasicMaterial({ color: 0x060101, side: THREE.BackSide, transparent: true, opacity: 0, fog: false, depthWrite: false }),
    );
    dome.renderOrder = -1;
    const aura = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture([[0, 'rgba(255,60,40,0.9)'], [0.35, 'rgba(200,20,20,0.45)'], [1, 'rgba(120,0,0,0)']]),
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
    }));
    aura.scale.setScalar(0.001);
    world.add(dome, aura);
    return {
      dome, aura,
      set(k) {
        dome.material.opacity = k * 0.94;
        scene.fog.color.copy(base.fog).lerp(DOOM_FOG, k);
        ambient.intensity = base.ambient * (1 - 0.6 * k);
        ambient.color.copy(base.ambientColor).lerp(DOOM_AMBIENT, k * 0.6);
        sun.intensity = base.sun * (1 - 0.8 * k);
        loopsLevel.rumble(k * 0.8);
      },
    };
  }

  async function squash(o, thing) {
    const leg = thing.nearestFoot(player.pos);
    // 1. He lunges at the nearest leg and holds on.
    look.copy(leg).addScaledVector(UP, 1.2);
    aiming = 5;
    const from = player.pos.clone();
    const to = from.clone().lerp(leg, 1 - 0.9 / Math.max(0.9, from.distanceTo(leg))).setY(from.y);
    await during(o.grab, (k) => { player.pos.lerpVectors(from, to, Math.min(1, k * 2)); });
    sfx.shriek();
    subtitle('[the Walking Thing shrieks]', 3);
    shake(0.3);

    // 2. The sky goes dark while it rears back and lifts the foot high over him.
    doom = darkness();
    const over = head.position.clone();
    const foot = thing.raiseFoot(over, o.raise, o.footSize);
    aiming = 2;
    await during(o.darken, (k) => {
      doom.set(k);
      look.copy(thing.stomping.at);
      const grow = THREE.MathUtils.smoothstep(k, 0.3, 1);
      loopsLevel.drone(grow);
      doom.aura.position.copy(thing.stomping.at).addScaledVector(UP, 25);
      doom.aura.scale.setScalar(90 * grow);
    });
    await foot;

    // 3. Down it comes, on the camera.
    aiming = 8;
    const fall = during(o.drop, () => look.copy(thing.stomping.at));
    await thing.dropFoot(camera.position.clone().addScaledVector(UP, 0.4), o.drop);
    await fall;
    sfx.boom();
    shake(1);
    const soft = settings.flash ? 4 : 1; // "soften flashes" slows a flash right down
    await fadeTo(settings.flash ? 0.7 : 1, o.flash.in * soft, '#fff');

    // 4. Outside him: on his knees under the foot as it lifts, losing his head.
    aiming = 0;
    loopsLevel.drone(0.4);
    doom.set(0.75);
    const at = player.pos.clone();
    const side = new THREE.Vector3().subVectors(at, thing.body.position).setY(0).normalize();
    const across = new THREE.Vector3(-side.z, 0, side.x);
    // low down, looking up at him against the dark, the foot above him in the frame (he
    // faces away from it)
    const shot = { from: new THREE.Vector3(), to: at.clone().addScaledVector(UP, 1.7), yaw: Math.atan2(-side.x, -side.z) };
    const start = at.clone().addScaledVector(side, 1).addScaledVector(across, 5.5).addScaledVector(UP, 0.5);
    const end = at.clone().addScaledVector(side, 0.6).addScaledVector(across, 4.2).addScaledVector(UP, 0.7);
    shot.from.copy(start);
    view.shot = shot;
    thing.liftFoot(at, o.shot);
    gm.play('lose');
    fadeTo(0, o.flash.out * soft);
    await during(o.shot, (k) => shot.from.lerpVectors(start, end, k * (2 - k)));
    showMessage(o.message, 0);
    await during(o.hold, () => {});
    loopsLevel.rumble(0);
    loopsLevel.drone(0);
    doom = null;
  }

  return { squash, update };
}
