import * as THREE from 'three';
import { showPrompt } from './hud.js';

// Finds the interaction the player can use right now (exits, the Walking Thing,
// the pool...) from the current level's "interactions" in levels.json, shows its
// prompt, and runs it when E is pressed. An interaction is available when:
//   - the player is within its radius (of "at", or of the named actor),
//   - "look" (degrees) is set: the view points that close to it,
//   - "requires" names a story flag that is set, and "once" names one that isn't.

const toward = new THREE.Vector3();
const facing = new THREE.Vector3();

export function createInteract({ levels, player, head, controls, story }) {
  let active = null;

  function where(it) {
    if (it.actor) {
      const a = levels.world?.actors?.[it.actor];
      return a ? a.talkPoint ?? a.group.position : null;
    }
    return toward.fromArray(it.at);
  }

  function available(it) {
    if (it.requires && !story.flags[it.requires]) return false;
    if (it.once && story.flags[it.once]) return false;
    if (it.when && !story.can(it)) return false;
    const p = where(it);
    if (!p) return false;
    const dx = p.x - player.pos.x, dz = p.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > it.radius) return false;
    if (it.look) {
      facing.set(0, 0, -1).applyQuaternion(head.quaternion); // where the view points
      const ang = Math.abs(Math.atan2(facing.x * dz - facing.z * dx, facing.x * dx + facing.z * dz));
      if (d > 1.5 && THREE.MathUtils.radToDeg(ang) > it.look) return false;
    }
    return d;
  }

  function update() {
    active = null;
    const list = levels.def?.interactions;
    if (list && !player.frozen && !levels.busy && controls.isLocked && !story.busy) {
      let best = Infinity;
      for (const it of list) {
        const d = available(it);
        if (d !== false && d < best) { best = d; active = it; }
      }
    }
    showPrompt(active ? story.promptFor(active) : null);
  }

  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyE' || e.repeat || !active) return;
    const it = active;
    active = null;
    showPrompt(null);
    story.run(it);
  });

  return { update, get active() { return active; } };
}
