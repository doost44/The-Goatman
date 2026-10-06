// Admin mode's map (M): the level from above in amber lines, north up. M once shows the whole
// level, again a close-up round him, a third time hides it. Drawn: the ground's edge, paths,
// what is solid, water, exits, spawns, landmarks, places (numbered, as [ and ] visit them),
// creatures, the terrain chunks built round the camera (big levels), and him.
// The still parts are drawn once per level onto a canvas of their own; each frame only
// copies it and adds what moves.

const AMBER = '#ffb43c', DIM = 'rgba(255,180,60,0.45)', FAINT = 'rgba(255,180,60,0.16)';
const SIZE = 1024; // pixels across the still layer
const CLOSE = 240; // metres across the close-up

export function createMap(hud) {
  const view = document.createElement('canvas');
  view.id = 'admin-map';
  view.className = 'hidden';
  hud.append(view);
  const g = view.getContext('2d');
  let mode = 0; // 0 hidden, 1 whole level, 2 close-up
  let layer = null; // { canvas, x0, z0, span } for the level it was drawn for
  let drawnFor = null;

  // The square of the world the level covers: [x0, z0, span].
  function extent(def) {
    const t = def.terrain ?? {};
    const [cx, cz] = t.center ?? [0, 0];
    const half = t.radius ?? Math.max(...(t.size ?? [400, 400])) / 2;
    return [cx - half * 1.05, cz - half * 1.05, half * 2.1];
  }

  function still(def, world) {
    const [x0, z0, span] = extent(def);
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const s = c.getContext('2d');
    const k = SIZE / span;
    const X = (x) => (x - x0) * k, Z = (z) => (z - z0) * k;
    // the layer is shown at about 40% (whole level), so lines and labels are drawn large
    s.lineWidth = 2;
    s.font = 'bold 26px monospace';
    s.textBaseline = 'middle';

    // the ground's edge
    const t = def.terrain ?? {};
    const [cx, cz] = t.center ?? [0, 0];
    s.strokeStyle = DIM;
    s.beginPath();
    if (t.radius) s.arc(X(cx), Z(cz), t.radius * k, 0, Math.PI * 2);
    else if (t.size) s.rect(X(cx - t.size[0] / 2), Z(cz - t.size[1] / 2), t.size[0] * k, t.size[1] * k);
    s.stroke();

    // water: sampled on a grid (only levels with any)
    if (world.waterDepth && world.heightAt) {
      const n = 160, step = span / n;
      s.fillStyle = 'rgba(120,190,255,0.35)';
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = x0 + (i + 0.5) * step, z = z0 + (j + 0.5) * step;
        if (world.waterDepth(x, z, world.heightAt(x, z)) > 0.05) s.fillRect(X(x - step / 2), Z(z - step / 2), step * k + 0.5, step * k + 0.5);
      }
    }

    // what is solid (the forest keeps its trunks in a grid, so ask for all of them)
    const solid = world.solidNear?.(cx, cz, span) ?? world.colliders ?? [];
    s.strokeStyle = FAINT;
    for (const c of solid) {
      s.beginPath();
      if (c.kind === 'circle') s.arc(X(c.x), Z(c.z), Math.max(0.8, c.r * k), 0, Math.PI * 2);
      else if (c.kind === 'ring') s.arc(X(c.x), Z(c.z), c.r * k, 0, Math.PI * 2);
      else if (c.kind === 'box') s.rect(X(c.minX), Z(c.minZ), (c.maxX - c.minX) * k, (c.maxZ - c.minZ) * k);
      else if (c.kind === 'line') { s.moveTo(X(c.ax), Z(c.az)); s.lineTo(X(c.bx), Z(c.bz)); }
      else if (c.kind === 'path') c.points.forEach(([x, z], i) => (i ? s.lineTo(X(x), Z(z)) : s.moveTo(X(x), Z(z))));
      s.stroke();
    }

    // paths: the main one, the side paths, the river's course
    const line = (points, style, dash = []) => {
      s.strokeStyle = style;
      s.setLineDash(dash);
      s.beginPath();
      points.forEach(([x, z], i) => (i ? s.lineTo(X(x), Z(z)) : s.moveTo(X(x), Z(z))));
      s.stroke();
      s.setLineDash([]);
    };
    s.lineWidth = 5;
    if (def.path?.points) line(def.path.points, AMBER);
    for (const p of def.sidePaths ?? []) line(p.points, AMBER, [4, 3]);
    if (def.river?.points) line(def.river.points, 'rgba(120,190,255,0.8)', [2, 2]);
    s.lineWidth = 2;

    const label = (x, z, text, color = AMBER) => {
      s.fillStyle = color;
      s.fillText(text, X(x) + 14, Z(z));
    };
    // landmarks: their footprint and kind
    for (const m of def.landmarks ?? []) {
      s.strokeStyle = AMBER;
      s.beginPath();
      s.arc(X(m.at[0]), Z(m.at[1]), Math.max(6, m.size[0] * k), 0, Math.PI * 2);
      s.stroke();
      label(m.at[0] + m.size[0], m.at[1], m.kind.toUpperCase(), DIM);
    }
    // exits and spawns
    for (const i of def.interactions ?? []) {
      if (i.type !== 'exit' || !i.at) continue;
      s.fillStyle = AMBER;
      s.fillRect(X(i.at[0]) - 8, Z(i.at[2]) - 8, 16, 16);
      label(i.at[0], i.at[2], `EXIT > ${i.to.toUpperCase()}`);
    }
    for (const [name, sp] of Object.entries(def.spawns ?? {})) {
      s.strokeStyle = AMBER;
      s.strokeRect(X(sp.at[0]) - 8, Z(sp.at[2]) - 8, 16, 16);
      label(sp.at[0], sp.at[2] + 28 / k, `SPAWN ${name.toUpperCase()}`, DIM);
    }
    // places, numbered
    for (const [n, p] of (def.places ?? []).entries()) {
      s.fillStyle = AMBER;
      s.beginPath();
      s.arc(X(p.at[0]), Z(p.at[1]), 6, 0, Math.PI * 2);
      s.fill();
      label(p.at[0], p.at[1], `${n + 1} ${p.name.toUpperCase()}`);
    }
    return { canvas: c, x0, z0, span };
  }

  return {
    get mode() { return mode; },
    toggle() {
      mode = (mode + 1) % 3;
      view.classList.toggle('hidden', !mode);
    },
    // Each frame while shown. at: the camera's position, yaw: which way he faces.
    update(def, world, at, yaw) {
      if (!mode || !def || !world) return;
      if (drawnFor !== world) { layer = still(def, world); drawnFor = world; }
      const px = Math.round(Math.min(innerWidth, innerHeight) * 0.7);
      if (view.width !== px) view.width = view.height = px;
      // the part of the world shown: all of it, or CLOSE metres round him
      const span = mode === 1 ? layer.span : CLOSE;
      const x0 = mode === 1 ? layer.x0 : at.x - span / 2, z0 = mode === 1 ? layer.z0 : at.z - span / 2;
      const k = px / span, X = (x) => (x - x0) * k, Z = (z) => (z - z0) * k;
      g.clearRect(0, 0, px, px);
      g.fillStyle = 'rgba(8,6,4,0.78)';
      g.fillRect(0, 0, px, px);
      g.imageSmoothingEnabled = false;
      const lk = SIZE / layer.span; // still layer pixels per metre
      g.drawImage(layer.canvas, (x0 - layer.x0) * lk, (z0 - layer.z0) * lk, span * lk, span * lk, 0, 0, px, px);

      // terrain chunks built round the camera, finer ones brighter
      const chunks = world.chunks;
      if (chunks) {
        const { x0: cx0, z0: cz0, chunk } = chunks.bounds;
        const finest = Math.max(...chunks.drawn().map((c) => c[2]));
        for (const [i, j, segs] of chunks.drawn()) {
          g.strokeStyle = `rgba(255,180,60,${0.1 + 0.35 * (segs / finest)})`;
          g.strokeRect(X(cx0 + i * chunk) + 1, Z(cz0 + j * chunk) + 1, chunk * k - 2, chunk * k - 2);
        }
      }
      // creatures
      g.fillStyle = '#ff6a5a';
      for (const a of Object.values(world.actors ?? {})) {
        const p = a.talkPoint ?? a.pos;
        if (p) g.fillRect(X(p.x) - 3, Z(p.z) - 3, 6, 6);
      }
      // him: an arrow the way he faces (yaw 0 faces north, up the map)
      g.save();
      g.translate(X(at.x), Z(at.z));
      g.rotate(-yaw);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(0, -9);
      g.lineTo(5, 6);
      g.lineTo(0, 3);
      g.lineTo(-5, 6);
      g.closePath();
      g.fill();
      g.restore();
      g.fillStyle = AMBER;
      g.font = '12px monospace';
      g.fillText(mode === 1 ? `MAP · ${Math.round(layer.span)} M ACROSS · M CLOSER` : `MAP · ${CLOSE} M ACROSS · M HIDE`, 8, 16);
    },
  };
}
