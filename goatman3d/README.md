# THE GOATMAN 3D

A first-person 3D version of THE GOATMAN, Charlie Cilla's p5.js game, built from Charlie's own paintings, videos and soundtracks in the style of an early-2000s PC game. The original 2D game is still at the root of this repository.

## Play

Online: https://doost44.github.io/ccilla_sidequestt_W3/goatman3d/

Locally, from the root of this repository:

```
python3 -m http.server
```

then open http://localhost:8000/goatman3d/ in Chrome, Edge, Firefox or Safari. It needs an internet connection the first time, for Three.js from jsDelivr.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrow keys | walk |
| Shift (held, walking forward) | sprint |
| Mouse | look |
| E | interact (enter, talk, pet, ride, get down) |
| W / S / A / D while riding | walk on / stop / turn (Shift: hurry) |
| 1 / 2 or mouse + click | pick a choice |
| Space | jump |
| G / right click | pick up or throw a pebble |
| V | first / third person |
| O | options |
| P | save a 1600x1200 photo |
| Esc | free the mouse (click to carry on) |

## Options

O, or OPTIONS on the start screen, opens the options. They are remembered in this browser.

| Option | |
| --- | --- |
| Camera | first or third person (V switches too) |
| Field of view, mouse sensitivity | |
| Pixel size | chunky, retro (the look it was made for), soft or sharp; sharper costs frame rate |
| Volume, music and soundscapes, mute | the second slider turns the soundtracks down under the sound effects |
| Show HUD | off hides the prompts, hints and level names; choices, messages and captions stay |
| Screen shake | off: the Walking Thing's footfalls and the squash don't shake the view, and sprinting bobs it no more than walking |
| Soften flashes | the two white flashes (the squash, and the way into the light at the end) are dimmer and four times slower |
| Subtitles | every line, plus captions for the sounds that tell you something, like [heavy footfalls] or [knocking, far off] |
| Fullscreen | Esc then only frees the mouse (in Chrome and Edge; in other browsers it goes back to fullscreen when you click into the game) |

## Admin mode

For working on the levels: add `?admin` to the address (for example `.../goatman3d/?admin`, or `?admin&level=savanna` to go straight into a level), then press ` (backquote) to fly. The normal link has none of this.

| Key | Action |
| --- | --- |
| ` | admin mode on / off (off drops him onto the ground below) |
| W / S, A / D | fly where you look, sideways |
| Space / C or Q | straight up / down |
| Shift | 4x faster |
| Mouse wheel | fly speed (2, 5, 10, 20, 40 m/s) |
| 1 / 2 / 3 | the forest / the field / the savanna |
| 4 | the finale |
| F | fog off / on |
| T | night in the savanna, and back |
| Y | count the Walking Thing as petted (opens the savanna's way on) |
| H | hide the HUD and arms, for screenshots (P still saves a photo) |
| K | copy the camera's position and yaw for levels.json |
| N | night vision in the forest, flying or walking: everything green and lifted out of the dark, and the fog further off |

The box in the top right shows the level, the camera's position and yaw, the fly speed, the frame rate and the draw calls.

## The story

GoatMan floating in space on the start screen, then four places, as in the original:

1. **The night forest.** Follow the glowing marks or wander off them: the woods go on in every direction and hide a few paths of their own. The pale trunks all lean toward the way out, a low gap somewhere in the trees given away by a faint pink light. Away from the start, faint glowing mushrooms lead to the hidden places: a ring of standing stones, a hollow trunk to walk through, a fallen giant to climb, and still black ponds to wade in.
2. **The red field.** Meet the Walking Thing. What you say to it matters.
3. **The savanna.** Wade the bog, be kind to the Walking Thing, then leave toward the horizon.
4. **The end.**

## Publishing

GitHub Pages serves the game from this repository: each push to the branch it serves is live a minute or two later, at the address above. While the 3D build is in its pull request, Pages serves the build branch (`claude/goatman3d-build-fn59n1`). Once the pull request is merged:

1. On GitHub, open the repository's **Settings**, then **Pages** in the sidebar.
2. Under **Build and deployment**, keep **Source** on **Deploy from a branch**, pick **main** and **/ (root)**, and press **Save**.
3. In the **Actions** tab, wait for the **pages build and deployment** run to finish with a green tick.
4. Only then delete the build branch, if you want to: Pages would have nothing to serve while it still points at a deleted branch.

The address stays the same, and the 2D original stays at https://doost44.github.io/ccilla_sidequestt_W3/.

## How it is made

Plain JavaScript modules and Three.js, no build step. Level content is in `data/levels.json`; the textures, sounds and cutscenes in `assets/` are generated from Charlie's originals by `tools/prep-assets.sh` (see `assets/MANIFEST.md`). `CLAUDE.md` describes the project for anyone extending it.
