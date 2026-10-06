import * as THREE from 'three';
import { sfx } from './sfx.js';
import { subtitle } from './hud.js';

// The Walking Thing's scripted moves, for story.js and squash.js: kneeling and getting up,
// walking off somewhere, the stomp, a rider climbing on and off, nuzzling him when petted.
// They steer the creature (walkingthing.js) through its mode, target, crouch and rear, and
// run in game time through its tween(seconds, fn), so they pause with the game.

const ease = (k) => k * k * (3 - 2 * k);

export function addActions(thing, { heightAt, k }) {
  const { legs, pos, fwd, tween } = thing;
  const v = new THREE.Vector3();

  Object.assign(thing, {
    // Down onto its knees, back up, and off somewhere.
    kneel(time) {
      thing.mode = 'script';
      thing.target = null;
      const from = thing.crouch;
      sfx.groan(thing.pan(thing.body.position));
      subtitle('[the Walking Thing kneels, creaking]', 3);
      return tween(time, (t) => { thing.crouch = from + (1 - from) * ease(t); });
    },
    rise(time) {
      const from = thing.crouch;
      sfx.groan(thing.pan(thing.body.position), 0.8);
      subtitle('[the Walking Thing rises, groaning]', 2.5);
      return tween(time, (t) => { thing.crouch = from * (1 - ease(t)); });
    },
    walkTo(point, pace = 1) {
      thing.mode = 'script';
      thing.target = new THREE.Vector3(...point);
      thing.pace = pace;
    },
    wait: (time) => tween(time, () => {}), // seconds of game time

    // The squash: it rears back and lifts the leg nearest him high over his head, its foot
    // swelling, then brings it down on him.
    async raiseFoot(over, time, size) {
      thing.mode = 'script';
      thing.target = null;
      const leg = legs.reduce((a, b) => (a.at.distanceTo(over) < b.at.distanceTo(over) ? a : b));
      const from = leg.at.clone();
      const top = over.clone().add(v.copy(over).sub(pos).setY(0).normalize().multiplyScalar(-1.5)).setY(over.y + 9 * k);
      leg.held = leg.at.clone();
      thing.stomping = leg;
      return tween(time, (t) => {
        const e = ease(t);
        leg.held.lerpVectors(from, top, e);
        leg.held.y += Math.sin(Math.PI * e) * 3 * k;
        leg.grow = 1 + (size - 1) * e;
        thing.rear = e;
      });
    },
    dropFoot(onto, time) {
      const leg = thing.stomping;
      const from = leg.held.clone();
      sfx.whistle(time);
      subtitle('[something whistles down from above]', time);
      return tween(time, (t) => {
        leg.held.lerpVectors(from, onto, t * t); // falling faster and faster
        thing.rear = 1 - t * 0.7;
      });
    },
    // After: the foot slowly lifting off him again, still huge.
    liftFoot(at, time) {
      const leg = thing.stomping;
      const y = heightAt(at.x, at.z);
      return tween(time, (t) => {
        leg.held.set(at.x, y + 0.5 + 4.5 * k * ease(t), at.z);
        thing.rear = 0.3 * (1 - t);
      });
    },
    nearestFoot(p) {
      return legs.reduce((a, b) => (a.at.distanceTo(p) < b.at.distanceTo(p) ? a : b)).at.clone();
    },

    // Climbing on: up from where he stands to its back, turning to look out over its head,
    // then it carries him (player.mount).
    climbOn(rider, time) {
      const start = rider.pos.clone(), end = new THREE.Vector3();
      let t = 0;
      rider.mount = {
        heading: thing.heading,
        look: -0.3, // the view eases round to its heading, looking down a little (player.js)
        seat(out) {
          thing.seat(end);
          out.lerpVectors(start, end, ease(t));
          out.y += Math.sin(Math.PI * t) * 2;
          return out;
        },
      };
      return tween(time, (now) => { t = now; }).then(() => { rider.mount = thing; });
    },
    // Climbing down: from its back to `ahead` metres in front of it, turning round on the
    // way to face it.
    climbOff(rider, ahead, time) {
      const start = thing.seat(new THREE.Vector3());
      const end = pos.clone().addScaledVector(fwd, ahead);
      end.y = heightAt(end.x, end.z);
      let t = 0;
      rider.mount = {
        heading: thing.heading + Math.PI,
        look: 0.1,
        seat(out) {
          out.lerpVectors(start, end, ease(t));
          out.y += Math.sin(Math.PI * t) * 1.5;
          return out;
        },
      };
      return tween(time, (now) => { t = now; }).then(() => { rider.mount = null; });
    },

    // Petted: it kneels and lowers its head to him, stays a moment, then gets up again.
    async nuzzle(time) {
      thing.mode = 'script';
      thing.target = null;
      const from = thing.crouch;
      await tween(time * 0.4, (t) => { thing.crouch = from + (1 - from) * ease(t); thing.rear = -0.8 * ease(t); });
      await tween(time * 0.2, () => {});
      await tween(time * 0.4, (t) => { thing.crouch = 1 - ease(t); thing.rear = -0.8 * (1 - ease(t)); });
      thing.settle();
    },
  });
}
