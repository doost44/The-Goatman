import * as THREE from 'three';
import { settings } from './options.js';
import { sfx } from './sfx.js';

// Night vision for admin mode (admin.js makes it): N switches it on and off in a level with
// "nightVision" in levels.json (the forest), to see the layout in the dark. The frame is
// drawn into a texture first, then onto the screen through a shader that works like an
// image intensifier: the dark is lifted far more than the light, all of it phosphor green,
// with grain, scanlines and a dark rim. The fog is pushed back and the light turned up
// (light times the level's own), to see further and make out the bark.
// levels.json "nightVision": { gain, fog: [near, far], light, tint (rgb, 0-1), grain }

const WARM_UP = 0.6; // seconds of glare as the tube comes on

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragmentShader = `
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uTime, uGain, uGrain;
uniform vec3 uTint;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Worked in screen brightness (the square root is about what the screen's curve does):
  // the dark lifted a long way and the bright only up to white, then grain, scanlines, the rim.
  float v = sqrt(1.0 - exp(-l * uGain));
  vec2 px = floor(vUv * uRes);
  v += (hash(px + floor(uTime * 24.0) * 17.3) - 0.5) * uGrain;
  v *= 0.86 + 0.14 * mod(px.y, 2.0);
  v *= 1.0 - smoothstep(0.4, 1.0, length((vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0)));
  vec3 col = clamp(uTint * v + smoothstep(0.8, 1.0, v) * 0.5, 0.0, 1.0); // the brightest washes to white
  gl_FragColor = vec4(col * col, 1.0); // back to light, which the screen's curve is applied to
  #include <colorspace_fragment>
}`;

export function createNightVision({ renderer, scene, levels }) {
  // Half floats, so the very dark keeps its detail when it is lifted.
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
  const uniforms = {
    tScene: { value: target.texture }, uRes: { value: new THREE.Vector2() },
    uTime: { value: 0 }, uGain: { value: 1 }, uGrain: { value: 0 }, uTint: { value: new THREE.Vector3() },
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false;
  const screen = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2();
  let world = null; // the level they were last checked against
  let def = null; // its "nightVision", or null where there is none
  let on = false, warm = 0, time = 0;

  // The level's own fog (unless admin mode has the fog off) and light back.
  function restore() {
    const fog = scene.fog, own = levels.def;
    if (fog && own && fog.far < 1e3) Object.assign(fog, { near: own.fog.near, far: own.fog.far });
    brighten(1);
  }
  function brighten(k) {
    const lights = levels.world?.lights;
    if (!lights) return;
    lights.ambient.intensity = levels.def.ambient.intensity * k;
    lights.sun.intensity = levels.def.sun.intensity * k;
  }

  const api = {
    get on() { return on; },
    get here() { return !!def; }, // does this level have it
    toggle() {
      if (!def) return;
      on = !on;
      if (on) {
        warm = settings.flash ? 0 : 1; // "soften flashes": no glare
        uniforms.uTint.value.fromArray(def.tint);
        uniforms.uGrain.value = def.grain;
        sfx.goggles(true);
      } else {
        restore();
        sfx.goggles(false);
      }
    },
    // Every frame. A new level (or none: the start screen) switches it off.
    update(dt) {
      if (levels.world !== world) {
        world = levels.world;
        def = world ? levels.def.nightVision ?? null : null;
        on = false;
      }
      if (!on) return;
      warm = Math.max(0, warm - dt / WARM_UP);
      uniforms.uGain.value = def.gain * (1 + 4 * warm * warm);
      uniforms.uTime.value = time += dt;
      const fog = scene.fog;
      if (fog && fog.far < 1e3) [fog.near, fog.far] = def.fog;
      brighten(def.light);
    },
    // Draws the frame (draw() renders it as usual) through the goggles when they are on.
    render(draw) {
      if (!on) return draw();
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
      renderer.setRenderTarget(target);
      draw();
      renderer.setRenderTarget(null);
      uniforms.uRes.value.copy(size);
      renderer.render(quad, screen);
    },
  };
  return api;
}
