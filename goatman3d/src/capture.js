// P saves a PNG of the current view, from automation-map/src/capture.js: one 4:3 frame
// rendered at half resolution, upscaled to 1600x1200 with nearest-neighbour (same
// chunky look), with a small title in the corner.

export const PHOTO_W = 1600, PHOTO_H = 1200;

export function capturePNG({ renderer, scene, camera, caption = '' }) {
  const prevPR = renderer.getPixelRatio();
  const prevW = renderer.domElement.clientWidth;
  const prevH = renderer.domElement.clientHeight;
  const prevAspect = camera.aspect;

  renderer.setPixelRatio(1);
  renderer.setSize(PHOTO_W / 2, PHOTO_H / 2, false);
  camera.aspect = PHOTO_W / PHOTO_H;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);

  const out = document.createElement('canvas');
  out.width = PHOTO_W;
  out.height = PHOTO_H;
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(renderer.domElement, 0, 0, PHOTO_W, PHOTO_H);

  g.fillStyle = 'rgba(10,10,8,0.68)';
  g.fillRect(40, 40, 600, caption ? 118 : 86);
  g.strokeStyle = 'rgba(255,180,60,0.45)';
  g.lineWidth = 3;
  g.strokeRect(40, 40, 600, caption ? 118 : 86);
  const text = (s, x, y, size, color) => {
    g.font = `bold ${size}px "Courier New", monospace`;
    g.fillStyle = '#000';
    g.fillText(s, x + 3, y + 3);
    g.fillStyle = color;
    g.fillText(s, x, y);
  };
  text('THE GOATMAN', 62, 100, 48, '#ffb43c');
  if (caption) text(caption.toUpperCase(), 64, 138, 22, '#f2ecd8');

  renderer.setPixelRatio(prevPR);
  renderer.setSize(prevW, prevH, false);
  camera.aspect = prevAspect;
  camera.updateProjectionMatrix();

  out.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'goatman.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
  return out;
}
