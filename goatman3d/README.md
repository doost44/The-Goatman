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

The box in the top right shows the level, the camera's position and yaw, the fly speed, the frame rate and the draw calls.

## The story

GoatMan floating in space on the start screen, then four places, as in the original:

1. **The night forest.** Find your way through the trunks to the gap and enter.
2. **The red field.** Meet the Walking Thing. What you say to it matters.
3. **The savanna.** Wade the bog, be kind to the Walking Thing, then leave toward the horizon.
4. **The end.**

## How it is made

Plain JavaScript modules and Three.js, no build step. Level content is in `data/levels.json`; the textures, sounds and cutscenes in `assets/` are generated from Charlie's originals by `tools/prep-assets.sh` (see `assets/MANIFEST.md`). `CLAUDE.md` describes the project for anyone extending it.
