import * as THREE from 'three';
import { dialogue, fadeTo, showMessage, setCinematic } from './hud.js';
import { duck, stopSoundscape } from './sound.js';
import { sfx } from './sfx.js';
import { stopAmbience } from './ambience.js';
import { freezeLook } from './mouse.js';
import { playFMV } from './fmv.js';
import { settings } from './options.js';
import { clearSave } from './save.js';

// What the interactions do: the story of the p5 game, step by step.
// Texts and timings come from the level's "dialogue" and "outcomes" in levels.json.

const wait = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const newTrust = () => ({ level: 0, petted: false, rides: 0 });

export function createStory({ levels, player, gm, view, squash, toTitle }) {
  const story = {
    flags: {}, // petted, drank, ...
    // How the Walking Thing feels about him: kindness raises it (for later polish).
    trust: newTrust(),
    busy: false,
    cutscene: false, // the squash or the ending is playing: no pause screen
    run,
    promptFor: (it) => it.prompt,
    can: () => true,
    reset() { story.flags = {}; story.trust = newTrust(); story.busy = false; story.cutscene = false; },
    actions: {},
    outcomes: {},
  };
  const outcome = (name) => levels.def?.outcomes?.[name] ?? {};

  async function run(it) {
    const action = story.actions[it.type];
    if (!action || story.busy) return;
    story.busy = true;
    try {
      await action(it);
    } finally {
      story.busy = false;
    }
  }

  // Go to another level, or into the ending if that level is a cutscene.
  async function goTo(id, spawn) {
    const def = levels.data.levels[id];
    if (def.builder === 'cutscene') return ending(def);
    sfx.enter();
    return levels.go(id, spawn);
  }

  // scene4.js, after a prelude in the light: the white flash (fast in, slow out) over the
  // last video, which plays once, then the credits and back to the title. Finishing
  // clears the save: the story is over.
  async function ending(def) {
    story.cutscene = true;
    player.frozen = true;
    setCinematic(true);
    await intoTheLight(outcome('ending'));
    const soft = settings.flash ? 4 : 1; // "soften flashes" slows the flash right down
    duck(1, 'ending');
    await fadeTo(settings.flash ? 0.7 : 1, def.flash.in * soft, '#fff');
    stopSoundscape(0.5);
    stopAmbience(0.5);
    levels.unload();
    const video = playFMV(def.video, { skipAfter: 3 });
    await fadeTo(0, def.flash.out * soft);
    await video;
    await fadeTo(1, levels.data.fade.out, '#000');
    duck(0, 'ending');
    clearSave();
    await credits(def.credits);
    setCinematic(false);
    toTitle({ finished: true });
  }

  // Before the last video he rides the Walking Thing toward the light while the savanna
  // dissolves into white (world.dissolve). If he walked there, the light takes him first and
  // he is on its back when it lets go.
  async function intoTheLight(o) {
    const thing = levels.world?.actors?.[o.ride];
    if (!thing) return;
    freezeLook(true);
    const [tx, , tz] = o.toward;
    if (player.mount !== thing) {
      await fadeTo(1, 0.5, '#fff');
      thing.moveTo([player.pos.x, 0, player.pos.z], Math.atan2(-(tx - player.pos.x), -(tz - player.pos.z)));
      thing.carry(player);
      gm.play('ride', true);
    }
    thing.avoid = []; // on past the edge of the savanna
    thing.look = o.look; // the view eases round to look where it is going
    thing.walkTo(o.toward, o.pace);
    fadeTo(0, 1.2).then(() => fadeTo(o.light, o.time - 1.2, '#fff'));
    await levels.world.dissolve(o.time);
  }

  // The credits card (the finale's "credits" in levels.json), until a click or a key, or
  // for `hold` seconds.
  function credits(c) {
    const el = document.getElementById('credits');
    el.querySelector('h1').textContent = c.title;
    el.querySelector('.by').textContent = c.by;
    el.querySelector('.lines').replaceChildren(...c.lines.map(([role, who]) => {
      const p = document.createElement('p');
      p.innerHTML = '<span></span><b></b>';
      p.firstChild.textContent = role;
      p.lastChild.textContent = who;
      return p;
    }));
    el.classList.remove('hidden');
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        removeEventListener('keydown', done);
        el.removeEventListener('click', done);
        el.classList.add('hidden');
        resolve();
      };
      const timer = setTimeout(done, c.hold * 1000);
      setTimeout(() => { // not skipped by a key still held from the game
        addEventListener('keydown', done);
        el.addEventListener('click', done);
      }, 1500);
    });
  }

  story.actions.exit = (it) => goTo(it.to, it.spawn);

  // The Walking Thing encounter: the two original choices.
  story.actions.talk = async (it) => {
    const d = levels.def.dialogue[it.dialogue];
    const actor = levels.world?.actors?.[it.actor];
    if (actor) actor.stopped = true;
    player.frozen = true;
    freezeLook(true);
    duck(0.5, 'talk');
    sfx.blip();
    const i = await dialogue(d.text, d.choices.map((c) => c.label));
    sfx.blip();
    freezeLook(false);
    duck(0, 'talk');
    const name = d.choices[i].outcome;
    await story.outcomes[name](outcome(name), actor);
    if (actor && !player.mount) actor.stopped = false;
    if (!levels.busy) player.frozen = false;
  };

  // "They didn't like that, you were SQUASHED": the foot comes down (squash.js), the line,
  // then a fade to black and back to the title.
  story.outcomes.squash = async (o, actor) => {
    story.cutscene = true;
    player.frozen = true;
    setCinematic(true);
    freezeLook(true);
    await squash(o, actor);
    await fadeTo(1, levels.data.fade.out, '#000');
    showMessage(null);
    setCinematic(false);
    toTitle({});
  };

  // "Will you be my mount, Walking Thing?": it kneels, he climbs onto its back, it stands
  // up with him and carries him off toward the next level.
  story.outcomes.mount = async (o, actor) => {
    story.trust.level += 1;
    story.trust.rides += 1;
    sfx.chime([0, 4, 7], 147);
    freezeLook(true); // the view is turned for him while he climbs on
    await actor.kneel(o.kneel);
    await actor.climbOn(player, o.climb);
    freezeLook(false);
    gm.play('ride');
    actor.walkTo(o.rideTo, o.pace); // it turns that way as it gets up
    await actor.rise(o.rise);
    await actor.wait(o.ride);
    return goTo(o.to);
  };

  // Riding it (the savanna): E gets down. It kneels and he climbs down in front of it,
  // turning round to face it, then it stands up again and waits there.
  story.actions.dismount = async () => {
    const o = outcome('dismount');
    const thing = player.mount;
    player.frozen = true;
    await thing.kneel(o.kneel);
    await thing.climbOff(player, o.ahead, o.climb);
    gm.play('stand');
    player.frozen = false;
    await thing.rise(o.rise);
    thing.settle();
  };

  // And back on: it kneels for him again.
  story.actions.ride = async (it) => {
    const o = outcome('ride');
    const thing = levels.world.actors[it.actor];
    player.frozen = true;
    freezeLook(true);
    await thing.kneel(o.kneel);
    await thing.climbOn(player, o.climb);
    freezeLook(false);
    gm.play('ride');
    await thing.rise(o.rise);
    thing.carry(player);
    story.trust.rides += 1;
    player.frozen = false;
  };

  // scene3.js: "They liked that", once. He reaches up and pats it; it kneels and lowers its
  // head to him.
  story.actions.pet = async (it) => {
    const o = outcome('pet');
    const thing = levels.world?.actors?.[it.actor];
    story.flags[it.once ?? 'petted'] = true;
    story.trust.petted = true;
    story.trust.level += 1;
    player.frozen = true;
    gm.play('pet');
    sfx.chime([0, 4, 7, 12], 196);
    showMessage(o.message, o.hold ?? 2);
    await thing?.nuzzle?.(o.nuzzle ?? 4);
    player.frozen = false;
  };

  // The pool: he kneels at the edge and his head sinks into the water on its blue strands
  // (down1-6, head1-15), seen from the side, then comes back up.
  story.actions.drink = async (it) => {
    const o = outcome('drink');
    const [px, , pz] = it.at;
    const dx = player.pos.x - px, dz = player.pos.z - pz;
    const len = Math.hypot(dx, dz) || 1;
    const yaw = Math.atan2(dx, dz); // facing the middle of the pool
    player.frozen = true;
    freezeLook(true);
    player.place([px + (dx / len) * o.edge, 0, pz + (dz / len) * o.edge], THREE.MathUtils.radToDeg(yaw));
    const at = player.pos;
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), ahead = new THREE.Vector3(-dx / len, 0, -dz / len);
    view.shot = {
      from: at.clone().addScaledVector(side, o.shot[0]).addScaledVector(ahead, o.shot[1]).setY(at.y + o.shot[2]),
      to: at.clone().addScaledVector(ahead, 0.6).setY(at.y + 0.6),
      yaw,
    };
    await gm.play('drink');
    sfx.drink();
    await wait(o.hold);
    await gm.play('stand');
    view.shot = null;
    freezeLook(false);
    player.frozen = false;
    story.flags.drank = true;
  };

  return story;
}
