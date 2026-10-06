// A tiny save in this browser: the last level reached, so the title can offer CONTINUE.
// Finishing the game clears it.

const KEY = 'goatman3d-save';

export function loadSave() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
export function writeSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* storage is off: no CONTINUE */ }
}
export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
