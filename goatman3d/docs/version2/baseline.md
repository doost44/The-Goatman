# Version 2 baseline

Frame rate, draw calls and memory per level on `main` (c6c099f, version 1) before any
version 2 change, to compare each section against.

## How it was measured

- Headless Chromium (Playwright) with the software renderer (SwiftShader), 960 x 600 window,
  the game's default half-resolution pixel ratio. Three.js 0.160.0 served locally in place of
  jsDelivr; the soundtracks routed to Ogg copies.
- Each level opened with `?admin&level=<id>`, standing at its start spawn and looking the
  spawn's way, 3 s to settle, then 6 s sampled: average frame rate, draw calls and triangles
  per frame (both render passes, as the admin box counts them), then `renderer.info.memory`
  and the page's JavaScript heap.
- SwiftShader is far slower than a real graphics card, so the frame rates only mean something
  next to each other. Compare against a copy of `main` measured the same way on the same
  machine (`git archive` it and serve it beside the working copy), not against these numbers
  on other hardware.

## On main

Two runs each:

| Level | FPS | Draw calls | Triangles | GPU geometries | GPU textures | JS heap |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Night forest | 22-26 | 42 | 42K | 47 | 19 | 33 MB |
| 2 Red field | 41-45 | 59 | 18K | 52 | 26 | 14 MB |
| 3 Savanna | 7-8 | 77-84 | 94-96K | 42 | 26 | 13-17 MB |

(The savanna's calls and triangles move a little as its creatures wander in and out of view.)

## After section 0 (groundwork)

Same machine, same method, run alternately with main:

| Level | FPS | Draw calls | Triangles | GPU geometries | GPU textures | JS heap |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Night forest | 23-25 | 42 | 42K | 47 | 19 | 32-33 MB |
| 2 Red field | 37-44 | 59 | 18K | 52 | 26 | 13-19 MB |
| 3 Savanna | 7.6-8 | 83-85 | 96K | 42 | 26 | 15-17 MB |
| Test: the expanse (2 km) | 24-26 | 92 | 78K | 98 | 7 | 15-19 MB |

The three story levels are unchanged within the noise. The 2 km test level runs between the
forest and the field.

## A long flight over the expanse

Flown for 4 minutes in admin mode in a figure of eight over the whole level at 120 m/s,
30 m above the ground, logging every 5 s. Chunks were built and freed the whole way
(5,565 built, 5,305 freed), the cache stayed at its limit of 260 chunks, and the graphics
card's geometries stayed between 143 and 251 with no upward drift (the count moves with how
many chunks are in view, repeating with each lap). The JavaScript heap went up and down
between 19 and 50 MB as the browser collected garbage (rebuilding chunks makes short-lived
arrays) and was back at 19 MB at the end, so nothing piles up there either.

| Time | GPU geometries | Chunks drawn | Kept | Built | Freed | JS heap |
| --- | --- | --- | --- | --- | --- | --- |
| 4 s | 143 | 161 | 260 | 401 | 141 | 21 MB |
| 54 s | 175 | 125 | 260 | 1513 | 1253 | 26 MB |
| 114 s | 251 | 155 | 260 | 2774 | 2514 | 28 MB |
| 174 s | 181 | 121 | 260 | 4199 | 3939 | 35 MB |
| 235 s | 215 | 212 | 260 | 5565 | 5305 | 33 MB |
| 250 s | 249 | | | | | 19 MB |
