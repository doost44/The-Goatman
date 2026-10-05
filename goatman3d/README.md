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
| Mouse | look |
| E | interact (enter, talk, pet, drink, mount) |
| 1 / 2 or mouse + click | pick a choice |
| Space | jump |
| G / right click | pick up or throw a pebble |
| V | first / third person |
| O | options |
| P | save a 1600x1200 photo |
| Esc | free the mouse (click to carry on) |

## The story

Title video, then four places, as in the original:

1. **The night forest.** Find your way through the trunks to the gap and enter.
2. **The red field.** Meet the Walking Thing. What you say to it matters.
3. **The savanna.** Be kind to the Walking Thing, then leave toward the horizon.
4. **The end.**

## How it is made

Plain JavaScript modules and Three.js, no build step. Level content is in `data/levels.json`; the textures, sounds and cutscenes in `assets/` are generated from Charlie's originals by `tools/prep-assets.sh` (see `assets/MANIFEST.md`). `CLAUDE.md` describes the project for anyone extending it.
