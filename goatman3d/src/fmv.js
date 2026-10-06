// Full-screen cutscenes: the 640 px videos, upscaled chunky like a 2001 FMV.
// As in start.js, SKIP fades in after a second; Esc or Enter also skips once it shows.
// Resolves with 'ended' or 'skipped' (a SKIP click counts as a click, so the caller
// can lock the mouse straight away).

const box = document.getElementById('fmv');
const video = box.querySelector('video');
const skip = document.getElementById('skip');

export function playFMV(url, { skipAfter = 1, canSkip = true } = {}) {
  return new Promise((resolve) => {
    let timer = 0;
    function done(how) {
      clearTimeout(timer);
      video.onended = null;
      video.onerror = null;
      skip.onclick = null;
      removeEventListener('keydown', key);
      video.pause();
      box.classList.add('hidden');
      skip.classList.add('hidden');
      document.body.classList.remove('fmv');
      resolve(how);
    }
    function key(e) {
      if (!skip.classList.contains('hidden') && (e.code === 'Escape' || e.code === 'Enter')) done('skipped');
    }
    document.exitPointerLock?.(); // free the mouse so SKIP can be clicked
    box.classList.remove('hidden');
    document.body.classList.add('fmv');
    skip.classList.add('hidden');
    skip.style.opacity = 0;
    video.src = url;
    video.currentTime = 0;
    video.onended = () => done('ended');
    video.onerror = () => done('ended'); // a missing video shouldn't trap the player
    video.play().catch(() => done('ended'));
    if (canSkip) {
      timer = setTimeout(() => {
        skip.classList.remove('hidden');
        requestAnimationFrame(() => { skip.style.opacity = 1; });
      }, skipAfter * 1000);
      skip.onclick = (e) => { e.stopPropagation(); done('skipped'); };
      addEventListener('keydown', key);
    }
  });
}
