## Project Title

THE GOATMAN - Interactive Multi-Scene Narrative Experience

---

## Authors

Charlie Cilla

---

## Description

THE GOATMAN is a multi-scene interactive narrative experience built with p5.js that follows a character's journey through an atmospheric savanna landscape. The game features branching dialogue, consequence-driven storytelling, and scene-specific visual processing. Players encounter the mysterious "Walking Thing" (Goatman) and must make critical choices that determine their fate—cooperation leads to progression, while hostility results in immediate consequences.

The project demonstrates advanced p5.js techniques including manual pixel-level image processing for atmospheric effects, video background integration with synchronized audio, fade transitions between scenes, branching dialogue systems with mouse-driven choices, and state-based progression gating.

---

## THE GOATMAN 3D

A first-person 3D version of the game, built from the same paintings, videos and soundscapes, lives in [`goatman3d/`](goatman3d/). Play it in the browser at https://doost44.github.io/The-Goatman/goatman3d/ (how to run it locally and the controls are in [`goatman3d/README.md`](goatman3d/README.md)).

---

## Game Structure

**Scene 1:** Initial area with desaturated, high-contrast character visuals. Player moves to left edge to progress.

**Scene 2:** GROUND.mp4 video background with looping audio. Player encounters the Walking Thing and must choose:

- "Grab Their LEG" → Hostile ending, returns to title
- "Will you be my mount, Walking Thing?" → Progresses to Scene 3

**Scene 3:** savanaScene.mp4 background. Player can pet the Walking Thing to gain trust, then progress from the left edge.

**Scene 4:** Savana scene trigger.mp4 plays once with dramatic white flash effect (quick fade in, slow fade out), then automatically returns to title screen.

---

## Technical Features

- **Manual Pixel Processing:** Custom `applyContrastAndSaturation()` function applies contrast, saturation, brightness, and blackness adjustments per pixel using RGB/HSL conversion
- **Scene-Specific Visual Filters:** Three processed character frame arrays with different values per scene (Scene 1: dark/desaturated, Scene 2: vibrant/saturated, Scene 3: natural with blackness)
- **Video Integration:** Four video backgrounds with aspect-ratio-aware scaling, conditional playback, and synchronized audio
- **Fade Transition System:** Black fade with alpha blending transitions smoothly between all scenes
- **Branching Narrative:** Mouse-driven dialogue choices with immediate consequences
- **Progression Gating:** Flag-based systems prevent premature scene access (Scene 4 only plays after Scene 3 interaction)
- **One-Time Interactions:** Pet mechanic uses completion flag to prevent repeated prompts

---

## Controls

- **WASD / Arrow Keys:** Character movement
- **E Key:** Interact with prompts/progress to next scene
- **Mouse Click:** Select dialogue options and interaction prompts

---

## Assets

**Character Sprites:** Custom sprite sheets with frame-based animation (idle, transition_start, walking, transition_end states)

**Video Backgrounds:**

- GROUND.mp4 (Scene 2)
- savanaScene.mp4 (Scene 3)
- Savana scene trigger.mp4 (Scene 4)

**Libraries:** p5.js

---

## GenAI

This project was developed with assistance from GitHub Copilot (Claude Sonnet 4.5). GenAI was used for:

- Implementing manual pixel-level processing algorithms
- Video background integration and playback control
- Fade transition system architecture
- Scene routing and state management
- CSS layout and centering solutions

All design decisions, narrative choices, visual processing values, scene progression structure, and interaction mechanics were determined by Charlie Cilla. GenAI provided implementation guidance and debugging support, but all creative direction and final outcomes were human-directed.

---
