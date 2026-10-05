import { dialogue, fadeTo, showMessage, setCinematic } from './hud.js';
import { sfx, duck, stopSoundscape } from './sound.js';
import { stopAmbience } from './ambience.js';
import { freezeLook } from './mouse.js';
import { playFMV } from './fmv.js';
import { settings } from './options.js';

// What the interactions do: the story of the p5 game, step by step.
// Texts and timings come from the level's "dialogue" and "outcomes" in levels.json.

export function createStory({ levels, player, gm, squash, toTitle }) {
  const story = {
    flags: {}, // petted, ...
    trust: 0, // grows when the Walking Thing is treated kindly (for later polish)
    busy: false,
    cutscene: false, // the squash or the ending is playing: no pause screen
    run,
    promptFor: (it) => it.prompt,
    can: () => true,
    reset() { story.flags = {}; story.trust = 0; story.busy = false; story.cutscene = false; },
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

  // scene4.js: a white flash (fast in, slow out) over the last video, which plays once,
  // then a fade to black and back to the title.
  async function ending(def) {
    story.cutscene = true;
    player.frozen = true;
    setCinematic(true);
    const soft = settings.flash ? 4 : 1; // "soften flashes" slows the flash right down
    duck(1, 'ending');
    await fadeTo(settings.flash ? 0.6 : 1, def.flash.in * soft, '#fff');
    stopSoundscape(0.5);
    stopAmbience(0.5);
    levels.unload();
    const video = playFMV(def.video, { skipAfter: 3 });
    await fadeTo(0, def.flash.out * soft);
    await video;
    await fadeTo(1, levels.data.fade.out, '#000');
    duck(0, 'ending');
    setCinematic(false);
    toTitle({ finished: true });
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
    sfx.chime([0, 4, 7], 147);
    freezeLook(true); // the view is turned for him while he climbs on
    await actor.kneel(o.kneel);
    await actor.climbOn(player, o.climb);
    freezeLook(false);
    gm.play('kneel');
    actor.walkTo(o.rideTo, o.pace); // it turns that way as it gets up
    await actor.rise(o.rise);
    await actor.wait(o.ride);
    return goTo(o.to);
  };

  // scene3.js: "They liked that", once.
  story.actions.pet = async (it) => {
    const o = outcome('pet');
    story.flags[it.once ?? 'petted'] = true;
    story.trust += 1;
    sfx.chime([0, 4, 7, 12], 196);
    showMessage(o.message, o.hold ?? 2);
  };

  return story;
}
