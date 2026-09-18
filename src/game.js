/**
 * Serpentine: game shell.
 *
 * Owns the loop, the phase machine (ready -> playing <-> paused -> over) and
 * all DOM wiring. The rules live in snakeLogic.js and drawing in renderer.js.
 *
 * Timing: the simulation runs on a fixed timestep driven by
 * requestAnimationFrame plus an accumulator, so speed is independent of the
 * display refresh rate. The renderer interpolates between ticks for smooth
 * motion.
 */

import {
  DIRECTIONS,
  GRID_SIZE,
  MODES,
  SPEED,
  createRng,
  makeInitialState,
  nextState,
  setDirection,
  tickInterval,
  togglePause,
} from './snakeLogic.js';
import { createRenderer } from './renderer.js';
import { bindInput } from './input.js';
import { createAudio } from './audio.js';
import { load, save } from './storage.js';

const MAX_CELL_PX = 36;
const BOARD_OUTLINE_ROOM = 5; // px kept clear around the board for its mode outline
const MAX_FRAME_MS = 250; // longer gaps (tab switch, debugger) are clamped
const MAX_STEPS_PER_FRAME = 4;
const OVER_SCREEN_DELAY_MS = 650; // let the crash play out before the overlay covers it
const KEY_LOCK_AFTER_CRASH_MS = 900; // ignore keys mashed in panic right after dying
const FX_AT_ALPHA = 0.8; // fire eat feedback once the head has visually (almost) arrived

const params = new URLSearchParams(window.location.search);
const seed = Number.parseInt(params.get('seed') ?? '', 10);
const random = Number.isFinite(seed) ? createRng(seed) : Math.random;

const root = document.documentElement;
const $ = (selector) => document.querySelector(selector);
const ui = {
  app: $('[data-app]'),
  stage: $('[data-stage]'),
  board: $('[data-board]'),
  canvas: $('[data-canvas]'),
  overlay: $('[data-overlay]'),
  screens: {
    ready: $('[data-screen="ready"]'),
    paused: $('[data-screen="paused"]'),
    over: $('[data-screen="over"]'),
  },
  score: $('[data-score]'),
  best: $('[data-best]'),
  length: $('[data-length]'),
  speed: $('[data-speed]'),
  status: $('[data-status]'),
  combo: $('[data-combo]'),
  comboLabel: $('[data-combo-label]'),
  comboFill: $('[data-combo-fill]'),
  modeTag: $('[data-mode-tag]'),
  modeOptions: document.querySelectorAll('[data-mode-option]'),
  readyBest: $('[data-ready-best]'),
  overTitle: $('[data-over-title]'),
  overReason: $('[data-over-reason]'),
  overScore: $('[data-over-score]'),
  overLength: $('[data-over-length]'),
  overBest: $('[data-over-best]'),
  newBest: $('[data-new-best]'),
  pauseButtons: document.querySelectorAll('[data-action="pause"]'),
  soundButton: $('[data-action="sound"]'),
  themeButton: $('[data-action="theme"]'),
  themeColor: $('[data-theme-color]'),
  announce: $('[data-announce]'),
  dpad: $('[data-dpad]'),
};

const storedMode = load('mode', MODES.wrap);
const settings = {
  mode: Object.values(MODES).includes(storedMode) ? storedMode : MODES.wrap,
  sound: load('sound', true) !== false,
};
const best = sanitizeBest(load('best', {}));

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const lightQuery = window.matchMedia('(prefers-color-scheme: light)');
const renderer = createRenderer(ui.canvas);
const audio = createAudio();

let state;
let prevSnake;
let phase = 'ready'; // 'ready' | 'playing' | 'over'   (pause lives in state.paused)
let accumulator = 0;
let lastFrameAt = 0;
let keyLockUntil = 0;
let overTimer = 0;
let runStartBest = 0;
let boardSize = 0;
let pixelRatio = 0;
let layoutQueued = false;
let palette;
let pendingFx = [];
let loopFrozen = false; // debug hook only

// ---- run lifecycle ----------------------------------------------------------

function newGame() {
  if (state) {
    persistBest();
  }
  clearTimeout(overTimer);
  pendingFx = [];
  state = makeInitialState(GRID_SIZE, { mode: settings.mode, randomFn: random });
  prevSnake = state.snake;
  accumulator = 0;
  runStartBest = best[settings.mode];
}

function toMenu() {
  newGame();
  phase = 'ready';
  showScreen('ready');
  setStatus('ready');
  syncControls();
  updateHud();
}

function startRun(directionName) {
  phase = 'playing';
  if (directionName) {
    state = setDirection(state, DIRECTIONS[directionName]);
  }
  accumulator = 0;
  showScreen(null);
  setStatus('running');
  audio.unlock();
  audio.play('start');
  announce(`Game started, ${state.mode} mode.`);
  syncControls();
  updateHud();
}

function restart() {
  newGame();
  startRun();
}

function setPaused(paused, auto = false) {
  if (phase !== 'playing' || state.paused === paused) {
    return;
  }
  state = togglePause(state);
  if (paused) {
    showScreen('paused');
    setStatus(auto ? 'suspended' : 'paused');
    audio.play('pause');
    announce('Paused.');
  } else {
    showScreen(null);
    setStatus('running');
    audio.unlock();
    audio.play('resume');
    announce('Resumed.');
  }
  syncControls();
}

function setMode(mode) {
  if (!Object.values(MODES).includes(mode) || phase === 'playing') {
    return;
  }
  if (mode !== settings.mode) {
    settings.mode = mode;
    save('mode', mode);
    audio.play('toggle');
  }
  toMenu();
}

function finishRun(now) {
  phase = 'over';
  keyLockUntil = now + KEY_LOCK_AFTER_CRASH_MS;
  const { score, mode } = state;
  const isNewBest = score > runStartBest;
  persistBest();

  if (state.won) {
    ui.overTitle.textContent = 'EXIT 0';
    ui.overReason.textContent = '// board complete. you win.';
    renderer.flashBoard(palette.snake, now, 700);
    audio.play('win');
    haptic([20, 40, 20, 40, 80]);
    setStatus('exit 0');
    announce(`You win! Score ${score}.`);
  } else {
    const head = state.snake[0];
    ui.overTitle.textContent = 'SIGSEGV';
    ui.overReason.textContent =
      state.deathCause === 'wall' ? '// segfault: wrote past the wall' : '// segfault: self-reference detected';
    renderer.burst(head.x, head.y, palette.danger, 26, 7);
    renderer.flashBoard(palette.danger, now);
    shakeBoard();
    audio.play('die');
    haptic([35, 40, 90]);
    setStatus('core dumped');
    announce(`Game over. Score ${score}.`);
  }

  ui.overScore.textContent = String(score);
  ui.overLength.textContent = String(state.snake.length);
  ui.overBest.textContent = String(best[mode]);
  ui.newBest.hidden = !isNewBest;
  overTimer = window.setTimeout(() => showScreen('over'), OVER_SCREEN_DELAY_MS);
  syncControls();
  updateHud();
}

function persistBest() {
  if (state.score > best[state.mode]) {
    best[state.mode] = state.score;
    save('best', best);
  }
}

// ---- simulation ---------------------------------------------------------------

function step(now) {
  const before = state;
  state = nextState(state, random);
  // A crash leaves the snake where it was; otherwise interpolate from `before`.
  prevSnake = state.snake === before.snake ? state.snake : before.snake;

  for (const event of state.events) {
    handleEvent(event);
  }
  updateHud();

  if (state.gameOver || state.won) {
    finishRun(now);
  }
}

function handleEvent(event) {
  switch (event.type) {
    case 'eat':
      renderer.swallow(event.x, event.y, 'food', state.tick);
      deferFx((now) => {
        renderer.burst(event.x, event.y, palette.food, 10);
        renderer.popup(
          event.x,
          event.y,
          event.combo > 1 ? `+${event.points} x${event.combo}` : `+${event.points}`,
          event.combo > 1 ? palette.bonus : palette.fg,
          now,
        );
        audio.play('eat', event.combo);
        haptic(10);
      });
      break;
    case 'bonus':
      renderer.swallow(event.x, event.y, 'bonus', state.tick);
      deferFx((now) => {
        renderer.burst(event.x, event.y, palette.bonus, 18, 6);
        renderer.popup(event.x, event.y, `+${event.points}`, palette.bonus, now);
        audio.play('bonus');
        haptic([12, 30, 12]);
      });
      break;
    case 'bonus-spawn':
      audio.play('spawn');
      break;
    case 'bonus-expire':
      audio.play('expire');
      break;
    default:
      break;
  }
}

/** Queue feedback for the current tick until the head visually reaches it. */
function deferFx(run) {
  pendingFx.push({ tick: state.tick, run });
}

function flushFx(alpha, now) {
  if (pendingFx.length === 0) {
    return;
  }
  const settled = phase !== 'playing' || alpha >= FX_AT_ALPHA;
  const due = pendingFx.filter((fx) => settled || fx.tick < state.tick);
  if (due.length > 0) {
    pendingFx = pendingFx.filter((fx) => !due.includes(fx));
    for (const fx of due) {
      fx.run(now);
    }
  }
}

function frame(now) {
  window.requestAnimationFrame(frame);
  const dt = lastFrameAt ? Math.min(now - lastFrameAt, MAX_FRAME_MS) : 0;
  lastFrameAt = now;

  if (phase === 'playing' && !state.paused && !loopFrozen) {
    accumulator += dt;
    let interval = tickInterval(state.eaten);
    let steps = 0;
    while (accumulator >= interval && phase === 'playing') {
      accumulator -= interval;
      step(now);
      interval = tickInterval(state.eaten);
      steps += 1;
      if (steps >= MAX_STEPS_PER_FRAME) {
        accumulator = 0; // drop the backlog rather than fast-forward
        break;
      }
    }
  }

  const alpha = phase === 'playing' ? Math.min(accumulator / tickInterval(state.eaten), 1) : 1;
  flushFx(alpha, now);
  renderer.draw({ state, prevSnake, alpha, now, dt: dt / 1000 });
  updateCombo(alpha);
}

// ---- input --------------------------------------------------------------------

function onDirection(name) {
  const direction = DIRECTIONS[name];
  if (!direction) {
    return;
  }
  if (phase === 'ready') {
    startRun(name);
  } else if (phase === 'playing' && !state.paused) {
    state = setDirection(state, direction);
  }
}

function onCommand(command) {
  const unlocked = performance.now() >= keyLockUntil;
  switch (command) {
    case 'confirm':
      if (phase === 'ready') startRun();
      else if (phase === 'playing') setPaused(!state.paused);
      else if (unlocked) restart();
      break;
    case 'pause':
      if (phase === 'playing') setPaused(!state.paused);
      break;
    case 'escape':
      if (phase === 'playing') setPaused(!state.paused);
      else if (phase === 'over' && unlocked) toMenu();
      break;
    case 'restart':
      if (phase === 'ready') startRun();
      else if (phase === 'playing' || unlocked) restart();
      break;
    case 'mute':
      toggleSound();
      break;
    case 'theme':
      toggleTheme();
      break;
    case 'mode-classic':
    case 'mode-wrap':
      if (phase === 'ready' || (phase === 'over' && unlocked)) setMode(command.slice('mode-'.length));
      break;
    default:
      break;
  }
}

function onClick(event) {
  const target = event.target instanceof Element ? event.target.closest('[data-action], [data-mode-option]') : null;
  if (!target || target.disabled) {
    return;
  }
  if (event.detail > 0) {
    // Mouse/touch clicks shouldn't leave focus on a button, where Space
    // would re-trigger it instead of reaching the game.
    target.blur();
  }
  if (target.dataset.modeOption) {
    setMode(target.dataset.modeOption);
    return;
  }
  switch (target.dataset.action) {
    case 'start':
      startRun();
      break;
    case 'resume':
      setPaused(false);
      break;
    case 'pause':
      if (phase === 'playing') setPaused(!state.paused);
      break;
    case 'restart':
      restart();
      break;
    case 'menu':
      toMenu();
      break;
    case 'sound':
      toggleSound();
      break;
    case 'theme':
      toggleTheme();
      break;
    default:
      break;
  }
}

function onTouch() {
  if (root.dataset.input !== 'touch' && !root.hasAttribute('data-input-forced')) {
    root.dataset.input = 'touch';
    queueLayout();
  }
}

// ---- settings -----------------------------------------------------------------

function toggleSound() {
  settings.sound = !settings.sound;
  save('sound', settings.sound);
  audio.setMuted(!settings.sound);
  ui.soundButton.setAttribute('aria-pressed', String(settings.sound));
  if (settings.sound) {
    audio.unlock();
    audio.play('toggle');
  }
  announce(settings.sound ? 'Sound on.' : 'Sound off.');
}

function toggleTheme() {
  applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
  audio.play('toggle');
}

function applyTheme(theme, persist) {
  root.dataset.theme = theme;
  if (persist) {
    save('theme', theme);
  }
  palette = readPalette();
  renderer.setPalette(palette);
  ui.themeColor.setAttribute('content', palette.bg);
  ui.themeButton.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}

function readPalette() {
  const styles = getComputedStyle(root);
  const read = (name) => styles.getPropertyValue(name).trim();
  return {
    bg: read('--c-bg'),
    fg: read('--c-fg'),
    board: read('--c-board'),
    grid: read('--c-grid'),
    snake: read('--c-snake'),
    snakeTail: read('--c-snake-tail'),
    head: read('--c-head'),
    food: read('--c-food'),
    bonus: read('--c-bonus'),
    danger: read('--c-danger'),
    glow: Number.parseFloat(read('--glow')) || 0,
    font: read('--mono') || 'monospace',
  };
}

function sanitizeBest(raw) {
  const clean = {};
  for (const mode of Object.values(MODES)) {
    const value = raw && typeof raw === 'object' ? Number(raw[mode]) : 0;
    clean[mode] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return clean;
}

// ---- view ---------------------------------------------------------------------

function showScreen(name) {
  clearTimeout(overTimer);
  for (const [key, node] of Object.entries(ui.screens)) {
    node.hidden = key !== name;
  }
  ui.overlay.hidden = name === null;
  ui.overlay.dataset.showing = name ?? ''; // not data-screen: that names the screens themselves
}

function syncControls() {
  const canPause = phase === 'playing';
  for (const button of ui.pauseButtons) {
    button.disabled = !canPause;
    button.toggleAttribute('data-paused', canPause && state.paused);
    button.setAttribute('aria-label', canPause && state.paused ? 'Resume' : 'Pause');
  }
  ui.modeTag.textContent = state.mode;
  ui.board.dataset.mode = state.mode;
  for (const option of ui.modeOptions) {
    option.setAttribute('aria-pressed', String(option.dataset.modeOption === settings.mode));
  }
  ui.readyBest.textContent = pad(best[settings.mode], 5);
}

function updateHud() {
  setText(ui.score, pad(state.score, 5), true);
  setText(ui.best, pad(Math.max(best[state.mode], state.score), 5));
  setText(ui.length, pad(state.snake.length, 3));
  setText(ui.speed, `${(SPEED.startMs / tickInterval(state.eaten)).toFixed(1)}x`);
}

function updateCombo(alpha) {
  const active = phase === 'playing' && state.combo > 1 && state.comboTicks > 0;
  if (ui.combo.hidden !== !active) {
    ui.combo.hidden = !active;
  }
  if (!active) {
    return;
  }
  setText(ui.comboLabel, `combo x${state.combo}`);
  const remaining = Math.max(0, Math.min(1, (state.comboTicks - alpha) / state.comboWindow));
  ui.comboFill.style.transform = `scaleX(${remaining.toFixed(3)})`;
}

function setText(node, text, bump = false) {
  if (node.textContent === text) {
    return;
  }
  node.textContent = text;
  if (bump && !motionQuery.matches && typeof node.animate === 'function') {
    node.animate(
      [{ transform: 'translateY(-3px)', color: palette.bonus }, { transform: 'none' }],
      { duration: 240, easing: 'ease-out' },
    );
  }
}

function setStatus(text) {
  ui.status.textContent = text;
}

function announce(text) {
  // Re-announce identical messages by toggling a trailing no-break space.
  ui.announce.textContent = ui.announce.textContent === text ? `${text} ` : text;
}

function shakeBoard() {
  if (motionQuery.matches || typeof ui.board.animate !== 'function') {
    return;
  }
  ui.board.animate(
    [
      { transform: 'translate(0, 0)' },
      { transform: 'translate(-5px, 1px)' },
      { transform: 'translate(5px, -1px)' },
      { transform: 'translate(-4px, -1px)' },
      { transform: 'translate(3px, 1px)' },
      { transform: 'translate(-1px, 0)' },
      { transform: 'translate(0, 0)' },
    ],
    { duration: 320, easing: 'cubic-bezier(.36,.07,.19,.97)' },
  );
}

function haptic(pattern) {
  if (!settings.sound || root.dataset.input !== 'touch' || typeof navigator.vibrate !== 'function') {
    return;
  }
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) {
    return; // browsers block (and log) vibration before the first tap
  }
  try {
    navigator.vibrate(pattern);
  } catch {
    // Vibration is optional; some browsers throw without user activation.
  }
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}

// ---- layout -------------------------------------------------------------------

function layout() {
  layoutQueued = false;
  // Same rule boot.js applied before first paint (stacked if boot.js is missing).
  const choose = window.serpentineChooseLayout ?? (() => 'stack');
  const mode = choose(window.innerWidth, window.innerHeight, root.dataset.input);
  if (root.dataset.layout !== mode) {
    root.dataset.layout = mode; // re-flows the grid; ResizeObserver re-runs layout
  }
  let width;
  let height;
  if (mode === 'side') {
    // The stage column is sized by the board, so measure the whole app and
    // leave the side column its minimum width.
    const style = getComputedStyle(ui.app);
    const px = (value) => Number.parseFloat(value) || 0;
    width = ui.app.clientWidth - px(style.paddingLeft) - px(style.paddingRight) - px(style.columnGap) - px(style.getPropertyValue('--side-min'));
    height = ui.app.clientHeight - px(style.paddingTop) - px(style.paddingBottom);
  } else {
    const rect = ui.stage.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
  }
  const available = Math.floor(Math.min(width, height)) - BOARD_OUTLINE_ROOM * 2;
  const cell = Math.max(4, Math.min(MAX_CELL_PX, Math.floor(available / GRID_SIZE)));
  const size = cell * GRID_SIZE;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  if (size === boardSize && ratio === pixelRatio) {
    return;
  }
  boardSize = size;
  pixelRatio = ratio;
  ui.app.style.setProperty('--board-size', `${size}px`);
  renderer.resize(size, ratio, GRID_SIZE);
}

function queueLayout() {
  // Deferred to the next frame so a resize never re-enters ResizeObserver.
  if (!layoutQueued) {
    layoutQueued = true;
    window.requestAnimationFrame(layout);
  }
}

// ---- boot ---------------------------------------------------------------------

function init() {
  audio.setMuted(!settings.sound);
  ui.soundButton.setAttribute('aria-pressed', String(settings.sound));
  applyTheme(root.dataset.theme === 'light' ? 'light' : 'dark', false);
  renderer.setReducedMotion(motionQuery.matches);

  bindInput({
    stage: ui.stage,
    dpad: ui.dpad,
    onDirection,
    onCommand,
    onTouch,
    getCellPx: () => renderer.cellPx,
  });
  document.addEventListener('click', onClick);
  // A swipe's pointermove is not a user gesture, so audio started by one would
  // stay suspended. Retry on the next event that browsers do accept.
  for (const type of ['pointerup', 'keydown']) {
    document.addEventListener(type, () => audio.unlock(), { passive: true });
  }

  motionQuery.addEventListener('change', (event) => renderer.setReducedMotion(event.matches));
  lightQuery.addEventListener('change', (event) => {
    if (load('theme', null) === null) {
      applyTheme(event.matches ? 'light' : 'dark', false);
    }
  });

  // Never keep running while the player can't see the board.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      setPaused(true, true);
      persistBest();
    }
  });
  window.addEventListener('blur', () => setPaused(true, true));
  window.addEventListener('pagehide', persistBest);

  const resizeObserver = new ResizeObserver(queueLayout);
  resizeObserver.observe(ui.stage);
  resizeObserver.observe(ui.app);
  window.addEventListener('resize', queueLayout);
  layout();

  toMenu();
  window.requestAnimationFrame(frame);

  if (params.has('debug')) {
    exposeDebugHooks();
  }

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline support is progressive; the game works without it.
    });
  }
}

/** Test-only handle, enabled with ?debug. Lets tests step the game deterministically. */
function exposeDebugHooks() {
  window.__serpentine = {
    get state() {
      return state;
    },
    get phase() {
      return phase;
    },
    get boardSize() {
      return boardSize;
    },
    get settings() {
      return { ...settings, best: { ...best } };
    },
    freeze(value = true) {
      loopFrozen = value;
    },
    step() {
      if (phase === 'playing' && !state.paused) {
        step(performance.now());
      }
      return state;
    },
    patch(fields) {
      state = { ...state, ...fields };
      prevSnake = state.snake;
      updateHud();
      return state;
    },
  };
}

init();
