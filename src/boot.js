/*
 * Runs synchronously in <head>, before first paint, so the page never
 * flashes the wrong theme or layout. Kept as a tiny classic script (not a
 * module) so it can block rendering; it is external so the CSP can forbid
 * inline scripts.
 */
(function boot() {
  var root = document.documentElement;
  var theme = null;

  try {
    var stored = window.localStorage.getItem('serpentine:theme');
    theme = stored ? JSON.parse(stored) : null;
    if (theme !== 'light' && theme !== 'dark') {
      // Preference saved by the first version of the game.
      theme = window.localStorage.getItem('serpentine-theme');
    }
  } catch (error) {
    theme = null;
  }

  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  root.setAttribute('data-theme', theme);

  // Layout follows the primary pointer: coarse means phone/tablet. A
  // "?input=touch|desktop" override exists for testing. The game also
  // switches to touch the first time a finger touches the screen.
  var forced = null;
  try {
    forced = new URLSearchParams(window.location.search).get('input');
  } catch (error) {
    forced = null;
  }
  var input = forced === 'touch' || forced === 'desktop'
    ? forced
    : window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'desktop';
  root.setAttribute('data-input', input);
  if (forced === 'touch' || forced === 'desktop') {
    root.setAttribute('data-input-forced', '');
  }

  // Stacked (HUD above the board, controls below) or side by side (controls
  // in a column on the right): pick whichever leaves room for the bigger
  // board. Rough chrome sizes are enough. game.js re-runs this on resize.
  function chooseLayout(width, height, inputType) {
    var maxBoard = 720; // MAX_CELL_PX * GRID_SIZE in game.js
    var chrome = inputType === 'touch' ? 360 : 170; // top bar + HUD + footer
    var stack = Math.min(maxBoard, width - 24, height - chrome);
    var side = Math.min(maxBoard, width - 250 - 40, height - 24); // 250 = --side-min
    return side > stack * 1.08 ? 'side' : 'stack';
  }
  window.serpentineChooseLayout = chooseLayout;
  root.setAttribute('data-layout', chooseLayout(window.innerWidth, window.innerHeight, input));
})();
