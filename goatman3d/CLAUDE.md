# GoatMan 3D

A first-person (V toggles third-person) 3D version of Charlie Cilla's p5.js game THE GOATMAN, built from Charlie's own paintings, videos and soundtracks. It lives in `goatman3d/` next to the p5 original, which stays untouched and playable from the repo root.

Mechanics are ported from Charlie's other project, `doost44/automation-map` (read-only reference): player movement, falling into the void, pointer-lock mouse fixes, options menu, synthesised sound, the giant-rock "doom" event.

## Stack (do not change)
- Plain JavaScript ES modules + Three.js 0.160.0 from jsDelivr via an import map in `index.html`, exactly like automation-map. No bundler, npm, TypeScript or frameworks.
- Relative paths only. Runs from `python3 -m http.server` at the repo root (open `/goatman3d/`) and on GitHub Pages.
- Never modify the p5 files at the repo root or anything in `assets/images/`.
- Never commit Charlie's layered originals (about 400 MB, kept in the project files). Only the small derivatives in `goatman3d/assets/`, made by `tools/prep-assets.sh`.

## Look
Early-2000s PC shooter (Half-Life 1 era) built from Charlie's paintings, not realism: "a paper diorama in a 2001 engine".
- Low-poly flat-shaded geometry. Painted art becomes alpha-tested cards (`alphaTest`, never blended) and extruded silhouettes.
- Textures 64-256 px, palette-reduced to 16-32 colours, `NearestFilter`, no mipmaps.
- Renderer at half internal resolution, upscaled with `image-rendering: pixelated`, no antialiasing.
- One ambient + one directional light, Lambert/Basic materials, linear fog into each level's painted sky colour (`data/palettes.json`).
- HUD: blocky monospace, amber (`#ffb43c`) on translucent dark boxes, centre crosshair.
- The world should feel slightly off, paced and gated (see `Process & Decisions Documentation.pdf` at the repo root): choices have consequences and the ending resolves instead of looping.

## Story (must be preserved)
Start screen (GoatMan floating in space; START, CONTINUE once a level was reached, OPTIONS) -> 1 Night forest (walk to the exit, E to enter) -> 2 Red field: meet the Walking Thing; "Grab Their LEG" = "They didn't like that, you were SQUASHED", back to the start screen; "Will you be my mount, Walking Thing?" = go on -> 3 Savanna: pet the Walking Thing ("They liked that"), reach the exit (only after petting) -> 4 Finale: a ride into the light, white flash (fast in, slow out), ending video plays once, credits, back to the start screen. The p5 title video and its intro cutscene are left out for now (revision pass 1).

GoatMan is the red painted figure with hairy backward-bending goat legs and long arms. The Walking Thing is the pale small-bodied creature on very long thin red-lined stilt legs. The striped yellow-pink creature with eyes lives in the savanna with its babies (the "bush" in savanaScene.mp4).

## Per-scene GoatMan colour grades
From `applyContrastAndSaturation(img, contrast, saturation, brightness, blackness)` in the root `main.js`. Same per-pixel maths in 3D (applied to his texture canvases at level load):

| Level | Contrast | Saturation | Brightness | Blackness |
| --- | --- | --- | --- | --- |
| 1 Night forest | 1.8 | 0.57 | 0.9 | 0.45 |
| 2 Red field | 1.2 | 1.8 | 1.0 | 0.0 |
| 3 Savanna | 1.1 | 1.0 | 1.0 | 0.15 |

Per pixel: `c = (c-128)*contrast+128`; `gray = (r+g+b)/3; c = gray+(c-gray)*saturation`; `c *= brightness`; `c -= blackness*255`; clamp each step to 0-255. Alpha unchanged.

## File layout
```
goatman3d/
  CLAUDE.md            this file
  README.md            how to run, controls
  index.html, style.css
  src/                 one short module per concern:
    main.js            the loop, the start screen, new game, back to the start screen
    title.js           the start screen: GoatMan floating in space, START, CONTINUE and OPTIONS on the left
    save.js            remembers the last level reached (localStorage), for CONTINUE
    admin.js           admin mode (only loaded with ?admin): fly through everything, coordinates, level keys,
                       places, the frame rate, triangles and memory readout
    adminmap.js        admin mode's map (M): the level from above in amber lines
    nightvision.js     admin mode's night vision (N): the frame through a green intensifier shader
    player.js          walking, sprinting, jumping, falling into the void (his hooves are player.pos)
    goatman.js         his low-poly body: tapered limbs, the head that comes off, colour grades
    goatman-hand.js    his hands: a narrow palm and long thin three-jointed fingers and a thumb, one
                       skinned mesh each; they curl, close round a pebble, splay and stroke
    goatman-head.js    his shaped head: skull rings wearing the painted face and profile, a tousled hair cap
    goatman-poses.js   his joint angles: standing, the walk and sprint cycle (two-bone IK goat legs),
                       the scripted poses (kneel, ride, drink, stand, pet, lose), all eased by damped springs
    viewmodel.js       first-person arms (with his hands), drawn in a second pass
    view.js            first/third-person camera, chase-camera pull-in, which way his body faces, rendering
    levels.js          loads levels.json, runs a level's builder (worlds/*.js), sky, fog, lights
    worlds/            one builder per level, plus their parts:
      forest.js        level 1: rolling ground, the dome sky, putting the forest together
      woods.js         where everything in the forest goes: trunks (thickest by the paths, in clusters,
                       round clearings), the hidden side paths and what they lead to, fallen trunks,
                       arches, roots, undergrowth, stones, the impassable edge; a grid of what is solid
      scatter.js       thousands of copies of a few things, drawn only near the camera and in view
      trunks.js        the forest's wood: bark cylinders, extruded fore.png cards, roots, fallen
                       trunks, arches and pale dead wood
      undergrowth.js   ferns and bushes painted on crossed cards, half-sunk stones, tufts by the path
      gate.js          the way out: a gap under a trunk leaning on another, its pink haze and the
                       glimpse of level 2 through it
      marks.js         the glowing ground marks and the eyes that watch, blink, move and all shut
                       at once in the hush; glowFog() for anything that should glow through fog
      mushrooms.js     glowing mushroom trails leading to the forest's places, shivering as he passes
      ponds.js         the forest's still black ponds: their bowls in the ground, the water, reeds,
                       dead wood and mist
      finds.js         what waits at the side paths' ends: standing stones, the hollow trunk, the
                       high trunk on its stump
      field.js         level 2: sky dome, ring of painted peaks, two cloud layers, red grass, the gate back
      savanna.js       level 3: dusk falling to stars, the path and the light at its end
      river.js         the savanna's bog river: its course (carved into the ground along a spline),
                       the murky flowing water, splashes and bubbles
      bog.js           the river's dressing: swaying reeds and tussocks, dead wood, floating scum, dusk mist
                       (its reeds, stumps and mist are shared with the forest's ponds)
      splash.js        splashes and ripples on any water (the river and the ponds)
      pool.js          the orange and blue swirl pool (thepool.png), kept for the final level
      horizon.js       far things: painted sky domes, the stars, rings of painted peaks or trees; for big
                       levels the far land past the fog and haze() for things seen beyond it
      landmarks.js     big levels' landmarks: peaks, spires, mesas, stones (real up close, coarse far off)
      expanse.js       the big-world test level (admin only): 2 km of chunked land, far land, landmarks
      tealtree.js      the savanna's teal tree as a weeping willow: trunk, arcing boughs, hanging
                       tendrils that sway and part round GoatMan and the Walking Thing's feet
      clumps.js        the savanna's grass clumps: crossed cards in a scatter, swaying in the shader
    walkingthing.js    the Walking Thing: wandering, watching, its 11-drawing stride (dipping and leaning
                       onto each foot), carrying a rider
    walkingthing-acts.js   its scripted moves: kneeling, walking off, the stomp, climbing on and off, nuzzling
    walkingthing-body.js   its swept painted body (rounded snout and back), the legs' paint, outline hull, shadow
    walkingthing-legs.js   its legs: two-bone IK drawn as tapering tubes along a curve, knee and pad springs
    squash.js          "Grab Their LEG": dark sky, the giant foot, white-out, the death shot (from doom.js)
    bushes.js          the savanna's striped creatures and their babies: creep, watch him, run off
    bushes-body.js     their lumpy bodies, swept from the side drawing (cret1-4) like the Walking Thing's
    story.js, interact.js   what E does (exits, dialogue, petting) and the endings: the ride into
                       the light, the finale flash and video, the credits
    rocks.js           pebbles: right click / G picks one up and throws it
    ambience.js        synthesised sound beds: the night forest, the savanna's bog (placed at the river)
    sound.js           the sound engine: buses, echo, the building blocks (tone, noise, synth), tracks, ducking
    sfx.js             every sound effect, synthesised from sound.js's building blocks
    terrain.js         ground meshes, their exact surface height, walkPath() and drape()
    chunks.js          big levels' ground in chunks built and freed round the camera, with a bounded cache
    options.js, mouse.js, hud.js, fmv.js, capture.js, textures.js
  data/levels.json     ALL level content: positions, prompts, dialogue, colours, audio per level
  data/palettes.json   sky/fog/ground + 8 accent colours per scene, sampled from the art (generated)
  assets/              generated by tools/prep-assets.sh; MANIFEST.md lists every file
    goatman/           walk sheets from 3 angles, kneel/head/backhead sheets, part-*.png 256 px body crops
    forest/ field/ savanna/   level textures, cards and sprite sheets
    audio/             soundscapes (.m4a); *-loop.m4a are seamless crossfaded loops
    video/             finale.mp4, the 640 px FMV ending
  tools/prep-assets.sh     regenerates assets/ from the originals (bash + ffmpeg only)
  tools/contact-sheet.sh   docs/contact-sheet.png of every texture
  docs/                screenshots and the contact sheet for PRs
```

## Conventions
- Level content lives in `data/levels.json`, not in JS: positions, spawn and facing, sky/fog colours, prompt and dialogue text, timings, soundscape file, exits and their targets.
- Sprite sheets come with a `.json` of frame rects (`frameW`, `frameH`, `cols`, `rows`, `frames[]` with `x, y, w, h, src`). Load the JSON, don't hard-code frame sizes.
- A level builder (`src/worlds/*.js`) gets `(def, { palettes, scene, camera, player, lights, flag })` and returns `{ group, ground, colliders, blockers, actors, update }`: `ground` meshes are what he stands on, `colliders` are circles/rings/paths/boxes/lines he can't walk through, `blockers` are meshes the third-person camera pulls in front of (trunks, walls), `actors` are creatures interactions can name. Optional: `heightAt(x, z)` (needed for pebbles), `rockTargets`, meshes a pebble can hit that react through `userData.onRock(hit)` (an invisible hit mesh still counts), and `beforeRender(camera)`, called each frame once the camera is placed (the forest and the savanna's grass pick what is in view). `lights` is the level's `{ ambient, sun }`, which a builder may change as time passes (the savanna's dusk; the first-person arms follow), and `flag(name)` reads a story flag (the savanna's way on lights up once petted).
- `heightAt` from `buildTerrain` is the exact surface of the ground mesh (its flat triangles, not the smooth noise, on rects and discs alike), so flat things laid on it don't sink. Use `drape(geometry, heightAt)` for glows and decals that lie on the ground, and `walkPath(points, spacing)` to place things along a level's path. Terrain options: `hills`, `flat`, `noise`, `rim` (a disc rising to foothills at its edge) and `mottle` (broad darker patches so a tiled texture repeats less obviously). A level can also pass `{ reshape(x, z, h), shade(x, z) }` to `buildTerrain` (the river carves its channel and darkens its mud).
- What he stands on is found by height function, not raycasting, wherever the ground is a terrain: its mesh's `userData.surface(x, z)` is the exact height, or null off its edge (a raycast against the savanna's 49k triangles costs about 3 ms; player.js and the pebbles raycast only other ground).
- Water: a world can return `waterDepth(x, z, y)` (how deep the water is over ground at height y) and `splash(x, z, size, sound)`. Deeper than his fetlocks he wades: slower, no sprint, sloshing steps and splashes, and the view dips. A rock target with `userData.sinks` swallows the pebble (its `onRock` makes the splash). Creatures and the Walking Thing keep out of it through `wet(x, z)` (`thing.wet`, and `wet` in the creatures' options) and the Walking Thing's `onStep(foot)` splashes its feet.
- Things that move in the shader (the willow's tendrils, the grass, the reeds and tussocks, the water's flow, the mist, the creatures breathing) patch a Lambert/Basic material in `onBeforeCompile` and set a `customProgramCacheKey` of their own, so differently patched materials never share a program; their `uTime`-style uniforms are updated by the level each frame.
- Painted art wrapped round a ring (the sky dome, the peaks) is mirrored every other repeat, and the repeat count must be even or a seam shows where the ring closes.
- Cutscene cameras: set `view.shot = { from, to, yaw? }` (the camera sits at `from` looking at `to`, with all of GoatMan drawn); `null` gives the normal view back. A new level clears it.
- Riding: `player.mount` is anything with `heading` and `seat(out)` (the Walking Thing, or a stand-in while he climbs on). It carries him, the view turns when it turns, and an optional `look` pitch eases the view round to face its way. With `steer(forward, turn, fast)` WASD drives it (the savanna; Shift hurries it to `rideSpeed` times its `hurry`). The Walking Thing's `carry(rider)`, `climbOn`, `climbOff(rider, ahead, time)` and `settle()` put him on and off it, and `moveTo(point, facing)` stands it somewhere at once; a spawn with `"ride": "walkingThing"` starts the level on its back (`walkOn` seconds walking on), and `gm.play('kneel', true)` jumps straight to the riding pose.
- A world can have `white` (0-1) and `dissolve(seconds)`: the savanna melts into white fog and light for the ride into the light before the finale.
- Interactions with `"mounted": true` or `false` only work while riding or on foot; one with no `at` or actor works anywhere (getting down). The first in the list wins when two are as close.
- `pushOut(point, colliders, radius)` in player.js keeps any point out of the colliders: the creatures and the Walking Thing use it with their own `avoid` lists. A `line` collider is a fallen trunk (`ax, az, bx, bz, r` and the heights of its top at each end, `ya, yb`): he steps over it when it is lower than `STEP_UP` under his hooves and walks on it through a ground object whose `userData.surface` gives its top. A step that would leave him wedged between colliders (a gap narrower than his body) is undone, so he can't squeeze through.
- Big levels (the forest is a disc 500 m across): put the thousands of things in a `createScatter` (scatter.js), one InstancedMesh per kind, refilled each frame with the copies within `reach` that are in view, nearest first (the savanna's grass too, with `reach: Infinity`: its fog is far off). Fog is by depth, so things at the sides of the view fade later: `reach` must be past the fog's far distance by about 1 / cos(half the horizontal field of view). Collisions come from a grid of what is solid near him (woods.js `near()`), refreshed as he moves, never from the whole level.
- The forest's sky is a dome that moves with the camera (so trunks never show outside it); its painting melts into the live fog colour near the horizon, so it follows the fog's pink near the way out.
- Forest layout lives in levels.json: `woods` (spacing, clearings and clusters, the edge rings, how many logs, arches, stones, snags), `sidePaths` (each with its points, `mouth` hidden by `leaning` trunks or `undergrowth`, faint `marks` and an `end`: a `ring` of pale trunks, a pale giant `tree`, the `eyes` dell or a `clearing`, with an optional `find`), `dome`, `undergrowth`, `marks.out` (fainter marks thinning away from the path) and `exit`.
- The forest's pale trunks lean toward the gate (`trunks.toGate`: [max degrees at the gate, min degrees, metres where it is greatest, metres where it is least]); their roots and colliders follow the lean, and `woods.snags` adds pale dead snags. Fallen trunks point toward it too.
- `mushrooms` in levels.json: trails (`to` a side path's or pond's name, starting at `from` or the nearest point of the main path) past `from` metres from the spawn, brighter and closer together near their place, with a ring of clumps round it. They are scatter kinds; their shader reads `uPlayer` to shiver and dim near him.
- `ponds` in levels.json: each pond `{ name, at, radius, depth }` plus shared dressing counts. `pondCourse()` works on the forest's coarse height: under each pond its ground is lowered out of the way and a finer basin mesh (a bowl) is laid on top, so `heightAt` is the basin there and the coarse ground everywhere else. The ponds give the forest `wet`, `waterDepth`, `splash` and `soundAt` (the nearest pond, for the night bed's frogs and drips). Each pond is its own group, hidden when past the fog.
- A side path's `end.find` (finds.js): `stones`, `hollow`, `high` or `hush`. Collider heights `y0`/`y1` let him walk over a collider (the high trunk's stump) when he is above it.
- When he is up high in the forest (the high trunk), the fog lifts a little so he can look out over it.
- Big levels (1.5 km and more, sections 3 and 4 of version 2; `expanse` is the test level): terrain `"shape": "chunks"` goes to `createChunkedTerrain` (chunks.js), not `buildTerrain`. Its `group` goes in the level's group, its `ground` (a stand-in whose `userData.surface` is the exact height of whichever chunk is drawn there) in `ground`, and the world calls `update(camera)` from `beforeRender` and `dispose()` from its own `dispose`. `heightAt` is the finest grid (for placing things), `height` the smooth function (for the far land beyond the level), and the world returns the terrain as `chunks` so the admin box and map can show it. Chunks are 128 m squares at a few levels of detail (`lods`, finest first) out to `view` metres; a chunk keeps its detail until it is a quarter chunk past a boundary, at most `budget` chunks are rebuilt a frame (a missing one is built at once, so there is never a hole), and skirts hang from every edge to hide cracks between details. Memory: built chunks stay in a cache of `cache` chunks and the one unused longest is freed (`geometry.dispose()`) past that, so the graphics card's geometries (the admin box's GPU line) level off however far he goes; the material is shared and freed with the level. Past the fog, `buildFarLand` (horizon.js) draws one coarse grid of the land out to the horizon (not drawn within `cut` of the camera, where the chunks are) and `buildLandmarks` (landmarks.js) the big shapes, both hazed toward the fog colour by `haze()` instead of fogged out; set the level's `view` (the camera's far plane, 800 by default) past them. The level's scatter `reach` stays near what the fog lets you see of small things, not the whole fog distance.
- Places: each level's `places` in levels.json (`name`, `at: [x, z]`, `yaw`, `up` metres above eye height) are named points admin mode visits with [ and ]; the map numbers them. Add one for anything new worth flying to.
- Admin mode (`?admin`, then `): `admin.fly(dt)` replaces `player.update` while it is on, `interact.update(false)` stops interactions, and `view.forceFirst` keeps first person. Check new level work by flying round it (F turns the fog off, K copies a position for levels.json, M shows the map, [ and ] go to the places). The box shows frame rate, draw calls and triangles (both passes), what the graphics card holds (`renderer.info.memory`), the page's JavaScript memory (Chrome) and, in big levels, the chunks drawn, kept and freed. A level with `"test": true` (expanse; 5 while flying) is never saved for CONTINUE. N is night vision, in a level with `nightVision` in levels.json (the forest): the frame is drawn into a render target and through a shader onto the screen, and the fog is pushed back and the light turned up while it is on; main.js draws through `admin.nightVision.render(draw)`, and a level's scatter `reach` follows the fog's far distance.
- Screen shake goes through `shake(amount)` in hud.js, which respects the screen-shake option. A new white flash should do what squash.js and story.js do with `settings.flash` (soften flashes: only 70% white, four times slower).
- Captions: any sound that tells the player something gets `subtitle('[heavy footfalls]', seconds, again)` from hud.js, in square brackets; `again` is how many seconds before the same caption may show again, for sounds that keep coming. They show only with the subtitles option on; dialogue, prompts and messages always show.
- The chase camera looks back along three lines from his shoulders (its own and one `WIDE` to each side): something right on its line pulls it in at once, something beside it eases it in, and it eases back out slowly. A level's `blockers` are what it can't see through; terrain is checked by its height along the line.
- `levels.unload()` disposes every geometry, material, texture and instanced mesh in the level's group; a world with anything else to free can return a `dispose()` of its own.
- Anything that must go dark in the squash is opaque (cut out with `alphaTest`, `transparent: false`): transparent things draw after the darkening dome and would stay bright.
- A level can name a synthesised bed in levels.json (`"ambience": "night"` or `"bog"`, built in `ambience.js`), with or without a soundtrack. Beds play on the music bus, so they duck and follow the music volume; caption their events with `subtitle()`. A bed can come from somewhere: the level's `world.soundAt(cameraPosition)` gives the point (the bog: the nearest point of the river), and the bed is panned there and fades with distance.
- Sound effects are all in `sfx.js` (footsteps per surface, splashes, calls, thuds...), built from `synthKit` (sound.js's building blocks), so modules import `sfx` from sfx.js and only the music and ducking from sound.js.
- Merging geometry (`mergeGeometries`) needs every piece indexed the same way with the same attributes; trunks and grass are merged into a few meshes per level to keep draw calls low.
- Frame rate: every triangle of a mesh is worked on each frame it is drawn, even the parts off screen, and a see-through thing costs as much as a solid one. So thousands of small things go in a scatter, ground meshes stay as coarse as still looks right (the forest's 580 m square is 80 x 80), and anything faded right out is hidden (`visible = false`). Raycasts cost too (the chase camera casts three a frame, a flying pebble one): all of a mesh's triangles are tested whenever the ray passes through its bounding sphere, so a blocker is a scatter kind (its raycast only looks at the copies near the ray) or a small mesh of its own (the forest's arches, one by one for raycasts and merged for drawing), never one big merged mesh. Compare a level's frame rate and draw calls (the admin box) before and after a change to it, and with `docs/version2/baseline.md` (the numbers on main before version 2, measured as it describes).
- First person draws his real body round the camera (view.js): the body is moved across the ground so his eyes (`gm.eyes()`) are where the camera is, and down (never up) only when the camera dips so close that the top of his chest (`gm.collar()`) would come within `CLEAR` of it. His head, neck and arms are hidden; the arms on screen are viewmodel.js's. Nobody sees him in first person, so his pose there is adjusted (`UPRIGHT` in goatman-poses.js, scaled by `gm.first`): back straighter, knees bent more and hooves set further forward (`foot`), so looking down finds his legs and hooves past his chest. A cutscene shot (`view.shot`) always shows his own pose.
- Riding uses `gm.play('ride')`: sitting astride the Walking Thing's back, a leg out to each side (`straddle` spreads the thighs).
- GoatMan's scripted poses come from the paintings: `gm.play('kneel')` (down1-6), `'drink'` (head1-15: the head sinks to the ground on blue strands), `'stand'`, `'pet'`, `'lose'` (head1-15 then backhead1-13, the SQUASHED death). Each returns a promise; kneel, drink and lose hold their last pose until the next one.
- The swirl pool and drinking from it are kept for the final level but are in no level for now (revision pass 1): `buildPool` in worlds/pool.js, `story.actions.drink` (an interaction `{ "type": "drink", "at" }` with an outcome `"drink": { edge, hold, shot }`), `sfx.drink()` and `gm.play('drink')`.
- `STRIDE` in player.js is one footstep and his walk cycle is two of them, as one continuous phase, so footstep sounds land with his hooves. Sprinting steps are `SPRINT_STEP` times longer, and the stride keeps counting in the air so his legs keep their rhythm through a jump. All the movement numbers (speed, sprint, its ramp, the sprint FOV) sit together at the top of player.js.
- GoatMan's pose is a set of joint angles (`STAND` in goatman-poses.js). Everything eases towards its target through a critically damped spring (`SMOOTH` seconds), and the walk cycle is added on top, so nothing snaps; his legs are worked out from where the hooves go (`leg()`), the knee forward and the hock back.
- Copy and adapt modules from automation-map/src/ rather than reinventing them.
- Keep modules short and readable for a student; comment only what is non-obvious.
- Check work in a real browser with Playwright (Chromium is preinstalled; jsDelivr may be blocked in the cloud container, so route the import-map URLs to a local copy of three@0.160.0 from npm). Screenshot each level touched for the PR.
- Keep this file up to date when the layout or a convention changes.

## Source art (outside the repo)
Charlie's layered originals are in the project files (`/mnt/project-files/` in cloud sessions; pass another folder to `prep-assets.sh` elsewhere): `Goatman Himself/` (walk from three angles, kneel, head lowering, head coming off, the pool), `WALKYBOY/` (red-field layers and the Walking Thing's walk), `the savannahg/` (savanna layers, the striped creature, `ground1.mp4`). Scene 1 (forest) and the videos come from the repo's `assets/images/`. Scene 1 had no audio in the original; its night bed is synthesised.
