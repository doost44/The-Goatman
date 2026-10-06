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
Title video -> 1 Night forest (walk to the exit, E to enter) -> 2 Red field: meet the Walking Thing; "Grab Their LEG" = "They didn't like that, you were SQUASHED", back to title; "Will you be my mount, Walking Thing?" = go on -> 3 Savanna: pet the Walking Thing ("They liked that"), reach the exit (only after petting) -> 4 Finale: white flash (fast in, slow out), ending video plays once, fade back to title.

GoatMan is the red painted figure with hairy backward-bending goat legs and long arms. The Walking Thing is the pale small-bodied creature on very long thin red-lined stilt legs. The striped yellow-pink creature with eyes lives in the savanna (the "bush" in savanaScene.mp4).

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
    main.js            the loop, title, intro video, new game, back to title
    title.js           the title screen: START, CONTINUE, OPTIONS over a slow orbit round GoatMan
    save.js            remembers the last level reached (localStorage), for CONTINUE
    admin.js           admin mode (only loaded with ?admin): fly through everything, coordinates, level keys
    player.js          walking, jumping, falling into the void (his hooves are player.pos)
    goatman.js         his low-poly body, walk cycle and scripted poses (kneel, drink, stand, pet, lose)
    viewmodel.js       first-person arms, drawn in a second pass
    view.js            first/third-person camera, chase-camera pull-in, which way his body faces, rendering
    levels.js          loads levels.json, runs a level's builder (worlds/*.js), sky, fog, lights
    worlds/            one builder per level, plus their parts:
      forest.js        level 1: terrain, backdrop, grass, the exit gate and its glimpse of level 2
      trunks.js        the forest's trunks: cylinders and extruded fore.png bark cards, merged
      marks.js         the glowing ground marks and the eyes that watch, blink and move
      field.js         level 2: sky dome, ring of painted peaks, two cloud layers, red grass, the gate back
      savanna.js       level 3: dusk falling to stars, the pool, the path and the light at its end
      horizon.js       far things: painted sky domes, the stars, rings of painted peaks or trees
      tealtree.js      the savanna's teal tree: cut-out canopy cards, trunk and branches
      clumps.js        the savanna's swaying grass clumps (instanced crossed cards)
    walkingthing.js    the Walking Thing: swept painted body, two-bone IK stilt legs, its 11-drawing walk,
                       kneeling, the stomp, carrying a rider
    squash.js          "Grab Their LEG": dark sky, the giant foot, white-out, the death shot (from doom.js)
    bushes.js          the savanna's striped creatures: painted cards that drift, watch and run off
    story.js, interact.js   what E does (exits, dialogue, petting) and the endings: the ride into
                       the light, the finale flash and video, the credits
    rocks.js           pebbles: right click / G picks one up and throws it
    ambience.js        synthesised sound beds for scenes with no track (the night forest)
    terrain.js         ground meshes, their exact surface height, walkPath() and drape()
    options.js, mouse.js, sound.js, hud.js, fmv.js, capture.js, textures.js
  data/levels.json     ALL level content: positions, prompts, dialogue, colours, audio per level
  data/palettes.json   sky/fog/ground + 8 accent colours per scene, sampled from the art (generated)
  assets/              generated by tools/prep-assets.sh; MANIFEST.md lists every file
    goatman/           walk sheets from 3 angles, kneel/head/backhead sheets, part-*.png 256 px body crops
    forest/ field/ savanna/   level textures, cards and sprite sheets
    audio/             soundscapes (.m4a); *-loop.m4a are seamless crossfaded loops
    video/             title.mp4 and finale.mp4, 640 px FMV cutscenes
  tools/prep-assets.sh     regenerates assets/ from the originals (bash + ffmpeg only)
  tools/contact-sheet.sh   docs/contact-sheet.png of every texture
  docs/                screenshots and the contact sheet for PRs
```

## Conventions
- Level content lives in `data/levels.json`, not in JS: positions, spawn and facing, sky/fog colours, prompt and dialogue text, timings, soundscape file, exits and their targets.
- Sprite sheets come with a `.json` of frame rects (`frameW`, `frameH`, `cols`, `rows`, `frames[]` with `x, y, w, h, src`). Load the JSON, don't hard-code frame sizes.
- A level builder (`src/worlds/*.js`) gets `(def, { palettes, scene, camera, player, lights, flag })` and returns `{ group, ground, colliders, blockers, actors, update }`: `ground` meshes are what he stands on, `colliders` are circles/rings/paths/boxes he can't walk through, `blockers` are meshes the third-person camera pulls in front of (trunks, walls), `actors` are creatures interactions can name. Optional: `heightAt(x, z)` (needed for pebbles) and `rockTargets`, meshes a pebble can hit that react through `userData.onRock(hit)` (an invisible hit mesh still counts). `lights` is the level's `{ ambient, sun }`, which a builder may change as time passes (the savanna's dusk; the first-person arms follow), and `flag(name)` reads a story flag (the savanna's way on lights up once petted).
- `heightAt` from `buildTerrain` is the exact surface of the ground mesh (its flat triangles, not the smooth noise, on rects and discs alike), so flat things laid on it don't sink. Use `drape(geometry, heightAt)` for glows and decals that lie on the ground, and `walkPath(points, spacing)` to place things along a level's path. Terrain options: `hills`, `flat`, `noise`, `rim` (a disc rising to foothills at its edge) and `mottle` (broad darker patches so a tiled texture repeats less obviously).
- Painted art wrapped round a ring (the sky dome, the peaks) is mirrored every other repeat, and the repeat count must be even or a seam shows where the ring closes.
- Cutscene cameras: set `view.shot = { from, to, yaw? }` (the camera sits at `from` looking at `to`, with all of GoatMan drawn); `null` gives the normal view back. A new level clears it.
- Riding: `player.mount` is anything with `heading` and `seat(out)` (the Walking Thing, or a stand-in while he climbs on). It carries him, the view turns when it turns, and an optional `look` pitch eases the view round to face its way. With `steer(forward, turn)` WASD drives it (the savanna). The Walking Thing's `carry(rider)`, `climbOn`, `climbOff(rider, ahead, time)` and `settle()` put him on and off it, and `moveTo(point, facing)` stands it somewhere at once; a spawn with `"ride": "walkingThing"` starts the level on its back (`walkOn` seconds walking on), and `gm.play('kneel', true)` jumps straight to the riding pose.
- `levels.load(id, spawn, { backdrop: true })` builds a level without its sound, story or name card (the title's orbit). A world can have `white` (0-1) and `dissolve(seconds)`: the savanna melts into white fog and light for the ride into the light before the finale.
- Interactions with `"mounted": true` or `false` only work while riding or on foot; one with no `at` or actor works anywhere (getting down). The first in the list wins when two are as close.
- `pushOut(point, colliders, radius)` in player.js keeps any point out of the colliders: the creatures and the Walking Thing use it with their own `avoid` lists.
- Admin mode (`?admin`, then `): `admin.fly(dt)` replaces `player.update` while it is on, `interact.update(false)` stops interactions, and `view.forceFirst` keeps first person. Check new level work by flying round it (F turns the fog off, K copies a position for levels.json).
- Screen shake goes through `shake(amount)` in hud.js, which respects the screen-shake option.
- Anything that must go dark in the squash is opaque (cut out with `alphaTest`, `transparent: false`): transparent things draw after the darkening dome and would stay bright.
- A level with no soundtrack can name a synthesised bed in levels.json (`"ambience": "night"`, built in `ambience.js`). Beds play on the music bus, so they duck and follow the music volume; caption their events with `subtitle()`.
- Merging geometry (`mergeGeometries`) needs every piece indexed the same way with the same attributes; trunks and grass are merged into a few meshes per level to keep draw calls low.
- GoatMan's scripted poses come from the paintings: `gm.play('kneel')` (down1-6), `'drink'` (head1-15: the head sinks to the ground on blue strands), `'stand'`, `'pet'`, `'lose'` (head1-15 then backhead1-13, the SQUASHED death). Each returns a promise; kneel, drink and lose hold their last pose until the next one.
- `STRIDE` in player.js is one footstep; his walk cycle is two of them split into the 18 painted walk frames, so footstep sounds land with his hooves.
- Copy and adapt modules from automation-map/src/ rather than reinventing them.
- Keep modules short and readable for a student; comment only what is non-obvious.
- Check work in a real browser with Playwright (Chromium is preinstalled; jsDelivr may be blocked in the cloud container, so route the import-map URLs to a local copy of three@0.160.0 from npm). Screenshot each level touched for the PR.
- Keep this file up to date when the layout or a convention changes.

## Source art (outside the repo)
Charlie's layered originals are in the project files (`/mnt/project-files/` in cloud sessions; pass another folder to `prep-assets.sh` elsewhere): `Goatman Himself/` (walk from three angles, kneel, head lowering, head coming off, the pool), `WALKYBOY/` (red-field layers and the Walking Thing's walk), `the savannahg/` (savanna layers, the striped creature, `ground1.mp4`). Scene 1 (forest) and the videos come from the repo's `assets/images/`. Scene 1 had no audio in the original; its night bed is synthesised.
