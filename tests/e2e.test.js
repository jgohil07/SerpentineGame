/**
 * End-to-end tests: load the real game in an iframe and drive it through the
 * DOM with keyboard, click, pointer and visibility events. `?debug` exposes
 * window.__serpentine so tests can freeze the loop and step deterministically;
 * `?seed` makes food placement reproducible.
 */

import { describe, test, assert, equal, sleep, waitFor } from './harness.js';
import { GRID_SIZE } from '../src/snakeLogic.js';

/**
 * Remove only this game's saved data. Never localStorage.clear(): on GitHub
 * Pages every project site of the same user shares one origin.
 */
export function clearGameStorage() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('serpentine:') || key === 'serpentine-theme') {
      localStorage.removeItem(key);
    }
  }
}

export async function openGame({ width = 1024, height = 768, input = 'desktop', query = {}, clearStorage = true } = {}) {
  if (clearStorage) {
    clearGameStorage();
  }
  const params = new URLSearchParams({ debug: '1', seed: '7', ...query });
  if (input) {
    params.set('input', input);
  }
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `position:fixed;left:0;top:0;z-index:10;width:${width}px;height:${height}px;border:0;`;
  iframe.src = `../index.html?${params}`;
  const loaded = new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
  document.body.append(iframe);
  await loaded;

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  const errors = [];
  win.addEventListener('error', (event) => errors.push(event.message || String(event.error)));
  win.addEventListener('unhandledrejection', (event) => errors.push(`unhandled rejection: ${event.reason}`));
  await waitFor(() => win.__serpentine && win.__serpentine.boardSize > 0, 5000, 'game did not boot');

  const $ = (selector) => doc.querySelector(selector);
  const game = {
    iframe,
    win,
    doc,
    errors,
    $,
    api: win.__serpentine,
    /** Dispatch keydown on the focused element, like a real keyboard. */
    key(name, init = {}) {
      const event = new win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
      (doc.activeElement || doc.body).dispatchEvent(event);
      return event;
    },
    click(selector) {
      const element = typeof selector === 'string' ? $(selector) : selector;
      assert(element, `no element for ${selector}`);
      element.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    },
    pointer(type, target, x, y, pointerType = 'touch') {
      target.dispatchEvent(
        new win.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType,
          isPrimary: true,
          clientX: x,
          clientY: y,
        }),
      );
    },
    visible(selector) {
      const element = typeof selector === 'string' ? $(selector) : selector;
      return Boolean(element) && !element.closest('[hidden]') && element.getClientRects().length > 0;
    },
    stored(name) {
      const raw = win.localStorage.getItem(`serpentine:${name}`);
      return raw === null ? null : JSON.parse(raw);
    },
    close() {
      iframe.remove();
    },
  };
  return game;
}

/** Run a test body against a fresh game and fail on any page error. */
function gameTest(name, options, body) {
  test(name, async () => {
    const game = await openGame(options);
    try {
      await body(game);
      await sleep(30);
      equal(game.errors, [], 'page errors');
    } finally {
      game.close();
    }
  });
}

/** Freeze the loop and start a run so the test can step it by hand. */
function startFrozen(game) {
  game.api.freeze(true);
  game.key(' ');
  equal(game.api.phase, 'playing');
}

describe('e2e: boot and screens', () => {
  gameTest('boots to the ready screen with a correctly sized board', {}, async (g) => {
    assert(g.visible('[data-screen="ready"]'), 'ready screen visible');
    equal(g.api.phase, 'ready');
    equal(g.$('[data-score]').textContent, '00000');
    equal(g.$('[data-length]').textContent, '003');
    equal(g.$('[data-speed]').textContent, '1.0x');
    equal(g.$('[data-status]').textContent, 'ready');
    const size = g.api.boardSize;
    equal(size % GRID_SIZE, 0, 'board is a whole number of cells');
    const rect = g.$('[data-board]').getBoundingClientRect();
    equal([Math.round(rect.width), Math.round(rect.height)], [size, size], 'board CSS size');
    const canvas = g.$('[data-canvas]');
    equal(canvas.width, Math.round(size * Math.min(g.win.devicePixelRatio || 1, 3)), 'canvas backing store matches DPR');
    assert(g.$('[data-action="pause"]').disabled, 'pause disabled before start');
  });

  gameTest('space starts the game and the real-time loop moves the snake', {}, async (g) => {
    const start = g.api.state.snake[0];
    g.key(' ');
    equal(g.api.phase, 'playing');
    assert(!g.visible('[data-overlay]'), 'overlay hidden while playing');
    equal(g.$('[data-status]').textContent, 'running');
    await waitFor(() => g.api.state.tick >= 3, 3000, 'loop should tick in real time');
    const head = g.api.state.snake[0];
    assert(head.x !== start.x || head.y !== start.y, 'head moved');
    assert(!g.$('[data-action="pause"]').disabled, 'pause enabled while playing');
  });

  gameTest('an arrow key on the ready screen starts the game in that direction', {}, async (g) => {
    g.api.freeze(true);
    const event = g.key('ArrowUp');
    equal(g.api.phase, 'playing');
    assert(event.defaultPrevented, 'arrow keys must not scroll the page');
    g.api.step();
    equal(g.api.state.direction, { x: 0, y: -1 });
  });

  gameTest('the canvas actually draws the snake and the food', {}, async (g) => {
    await sleep(60);
    const { state } = g.api;
    const canvas = g.$('[data-canvas]');
    const ctx = canvas.getContext('2d');
    const cell = canvas.width / GRID_SIZE;
    const sample = (p) => Array.from(ctx.getImageData(Math.floor((p.x + 0.5) * cell), Math.floor((p.y + 0.5) * cell), 1, 1).data.slice(0, 3));
    const css = getComputedStyle(g.doc.documentElement);
    const hex = (name) => {
      const value = Number.parseInt(css.getPropertyValue(name).trim().slice(1), 16);
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    };
    const near = (actual, expected, tolerance = 24) => actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);
    // Cell centres, as drawn: head in head colour, food in food colour, a
    // body segment in snake colours, and an empty cell showing only the grid dot.
    const head = sample(state.snake[0]);
    const food = sample(state.food);
    const body = sample(state.snake[1]);
    assert(near(head, hex('--c-head')), `head pixel ${head} should be ~${hex('--c-head')}`);
    assert(near(food, hex('--c-food'), 40), `food pixel ${food} should be ~${hex('--c-food')}`);
    assert(near(body, hex('--c-snake'), 60) || near(body, hex('--c-snake-tail'), 60), `body pixel ${body} should be snake-coloured`);
    const taken = [state.food, ...state.snake];
    const empty = [{ x: 0, y: 0 }, { x: 19, y: 0 }, { x: 0, y: 19 }, { x: 19, y: 19 }].find((c) =>
      taken.every((t) => Math.abs(t.x - c.x) + Math.abs(t.y - c.y) > 2),
    );
    assert(near(sample(empty), hex('--c-grid'), 30), 'an empty cell centre shows the grid dot');
  });
});

describe('e2e: controls', () => {
  gameTest('two quick turns within one tick both register', {}, async (g) => {
    startFrozen(g);
    g.key('ArrowUp');
    g.key('ArrowLeft');
    g.api.step();
    equal(g.api.state.direction, { x: 0, y: -1 });
    g.api.step();
    equal(g.api.state.direction, { x: -1, y: 0 });
  });

  gameTest('reverse keys are ignored and WASD / HJKL steer', {}, async (g) => {
    startFrozen(g);
    g.key('ArrowLeft');
    equal(g.api.state.queue, [], 'reverse ignored');
    g.key('w');
    g.api.step();
    equal(g.api.state.direction, { x: 0, y: -1 }, 'w = up');
    g.key('h');
    g.api.step();
    equal(g.api.state.direction, { x: -1, y: 0 }, 'h = left');
    g.key('J');
    g.api.step();
    equal(g.api.state.direction, { x: 0, y: 1 }, 'J (shift) = down');
  });

  gameTest('a keydown without a key (autofill) is ignored safely', {}, async (g) => {
    g.doc.body.dispatchEvent(new g.win.Event('keydown', { bubbles: true, cancelable: true }));
    equal(g.api.phase, 'ready');
  });

  gameTest('keys with Ctrl/Cmd/Alt are left to the browser', {}, async (g) => {
    startFrozen(g);
    const event = g.key('w', { metaKey: true });
    equal(g.api.state.queue, []);
    assert(!event.defaultPrevented, 'Cmd+W must not be swallowed');
  });

  gameTest('space pauses and resumes; the snake is frozen while paused', {}, async (g) => {
    g.key(' ');
    await waitFor(() => g.api.state.tick >= 1, 3000, 'loop running');
    g.key(' ');
    assert(g.api.state.paused, 'paused');
    assert(g.visible('[data-screen="paused"]'), 'paused screen visible');
    equal(g.$('[data-status]').textContent, 'paused');
    const tick = g.api.state.tick;
    await sleep(450);
    equal(g.api.state.tick, tick, 'no ticks while paused');
    g.key(' ');
    assert(!g.api.state.paused, 'resumed');
    assert(!g.visible('[data-overlay]'), 'overlay hidden');
    await waitFor(() => g.api.state.tick > tick, 3000, 'ticks again after resume');
  });

  gameTest('P, Escape and the pause button all toggle pause', {}, async (g) => {
    startFrozen(g);
    g.key('p');
    assert(g.api.state.paused, 'p pauses');
    g.key('Escape');
    assert(!g.api.state.paused, 'escape resumes');
    g.click('[data-action="pause"]');
    assert(g.api.state.paused, 'button pauses');
    assert(g.$('[data-action="pause"]').hasAttribute('data-paused'), 'button shows play icon');
    equal(g.$('[data-action="pause"]').getAttribute('aria-label'), 'Resume');
    g.click('[data-screen="paused"] [data-action="resume"]');
    assert(!g.api.state.paused, 'resume button resumes');
  });

  gameTest('R restarts with a fresh board mid-game', {}, async (g) => {
    startFrozen(g);
    g.api.patch({ score: 120, eaten: 2, snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 5 }] });
    g.key('r');
    equal(g.api.phase, 'playing');
    equal([g.api.state.score, g.api.state.snake.length, g.api.state.tick], [0, 3, 0]);
    equal(g.$('[data-score]').textContent, '00000');
  });

  gameTest('eating updates score, length and the HUD', {}, async (g) => {
    startFrozen(g);
    const head = g.api.state.snake[0];
    g.api.patch({ food: { x: head.x + 1, y: head.y } });
    g.api.step();
    equal([g.api.state.score, g.api.state.snake.length], [10, 4]);
    equal(g.$('[data-score]').textContent, '00010');
    equal(g.$('[data-length]').textContent, '004');
    equal(g.$('[data-best]').textContent, '00010', 'hi follows a new best live');
  });

  gameTest('chaining food shows the combo meter', {}, async (g) => {
    startFrozen(g);
    const head = g.api.state.snake[0];
    g.api.patch({ food: { x: head.x + 1, y: head.y }, combo: 1, comboTicks: 5, comboWindow: 10 });
    g.api.step();
    equal(g.api.state.combo, 2);
    await waitFor(() => g.visible('[data-combo]'), 1000, 'combo meter visible');
    equal(g.$('[data-combo-label]').textContent, 'combo x2');
  });
});

describe('e2e: modes, game over and win', () => {
  gameTest('mode keys and buttons switch mode and persist it', {}, async (g) => {
    g.key('1');
    equal(g.api.state.mode, 'classic');
    equal(g.$('[data-mode-option="classic"]').getAttribute('aria-pressed'), 'true');
    equal(g.$('[data-mode-option="wrap"]').getAttribute('aria-pressed'), 'false');
    equal(g.$('[data-board]').dataset.mode, 'classic');
    equal(g.$('[data-mode-tag]').textContent, 'classic');
    equal(g.stored('mode'), 'classic');
    g.click('[data-mode-option="wrap"]');
    equal(g.api.state.mode, 'wrap');
    equal(g.stored('mode'), 'wrap');
  });

  gameTest('classic: hitting a wall crashes, then shows the game-over screen', {}, async (g) => {
    g.key('1');
    startFrozen(g);
    g.api.patch({ snake: [{ x: 19, y: 10 }, { x: 18, y: 10 }, { x: 17, y: 10 }], direction: { x: 1, y: 0 } });
    g.api.step();
    equal(g.api.phase, 'over');
    equal(g.api.state.deathCause, 'wall');
    equal(g.$('[data-status]').textContent, 'core dumped');
    await waitFor(() => g.visible('[data-screen="over"]'), 2000, 'game-over screen');
    equal(g.$('[data-over-title]').textContent, 'SIGSEGV');
    assert(g.$('[data-over-reason]').textContent.includes('wall'), 'reason mentions the wall');
  });

  gameTest('wrap: the snake passes through the wall', {}, async (g) => {
    startFrozen(g);
    g.api.patch({ snake: [{ x: 19, y: 10 }, { x: 18, y: 10 }, { x: 17, y: 10 }], direction: { x: 1, y: 0 }, food: { x: 3, y: 3 } });
    g.api.step();
    equal(g.api.phase, 'playing');
    equal(g.api.state.snake[0], { x: 0, y: 10 });
  });

  gameTest('keys mashed right after a crash do not restart instantly', {}, async (g) => {
    startFrozen(g);
    g.api.patch({ snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }, { x: 7, y: 5 }], direction: { x: 0, y: -1 }, queue: [{ x: 1, y: 0 }] });
    g.api.step();
    equal(g.api.phase, 'over');
    g.key(' ');
    g.key('Enter');
    equal(g.api.phase, 'over', 'still on game over');
    await sleep(1000);
    g.key(' ');
    equal(g.api.phase, 'playing', 'space restarts once the lock expires');
    equal(g.api.state.score, 0);
  });

  gameTest('a new best is saved per mode and flagged', {}, async (g) => {
    startFrozen(g);
    g.api.patch({
      score: 250,
      snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }, { x: 7, y: 5 }],
      direction: { x: 0, y: -1 },
      queue: [{ x: 1, y: 0 }],
    });
    g.api.step();
    equal(g.stored('best'), { classic: 0, wrap: 250 });
    await waitFor(() => g.visible('[data-screen="over"]'), 2000, 'game-over screen');
    assert(g.visible('[data-new-best]'), 'new best flag');
    equal(g.$('[data-over-best]').textContent, '250');
    equal(g.$('[data-best]').textContent, '00250');
    await sleep(350); // post-crash key lock
    g.key('Escape');
    equal(g.api.phase, 'ready', 'escape goes to the menu');
    equal(g.$('[data-ready-best]').textContent, '00250');
  });

  gameTest('filling the board shows the win screen', {}, async (g) => {
    startFrozen(g);
    const path = [];
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let i = 0; i < GRID_SIZE; i += 1) path.push({ x: y % 2 === 0 ? i : GRID_SIZE - 1 - i, y });
    }
    const snake = path.slice(0, path.length - 1).reverse();
    g.api.patch({ snake, direction: { x: -1, y: 0 }, food: path[path.length - 1], eaten: snake.length - 3, bonus: null });
    g.api.step();
    assert(g.api.state.won, 'won');
    equal(g.api.phase, 'over');
    await waitFor(() => g.visible('[data-screen="over"]'), 2000, 'end screen');
    equal(g.$('[data-over-title]').textContent, 'EXIT 0');
    equal(g.$('[data-status]').textContent, 'exit 0');
  });

  gameTest('eating a bonus scores 50 x combo', {}, async (g) => {
    startFrozen(g);
    const head = g.api.state.snake[0];
    g.api.patch({ bonus: { x: head.x + 1, y: head.y, ttl: 10, maxTtl: 10 }, food: { x: 0, y: 0 } });
    g.api.step();
    equal([g.api.state.score, g.api.state.bonus, g.api.state.snake.length], [50, null, 3]);
  });
});

describe('e2e: settings and lifecycle', () => {
  gameTest('theme toggle flips the theme, persists it and updates theme-color', {}, async (g) => {
    const before = g.doc.documentElement.dataset.theme;
    g.click('[data-action="theme"]');
    const after = g.doc.documentElement.dataset.theme;
    assert(after !== before, 'theme changed');
    equal(g.stored('theme'), after);
    const bg = getComputedStyle(g.doc.documentElement).getPropertyValue('--c-bg').trim();
    equal(g.$('[data-theme-color]').getAttribute('content'), bg);
    g.key('t');
    equal(g.doc.documentElement.dataset.theme, before, 't toggles back');
  });

  gameTest('M toggles sound and persists the choice', {}, async (g) => {
    equal(g.$('[data-action="sound"]').getAttribute('aria-pressed'), 'true');
    g.key('m');
    equal(g.$('[data-action="sound"]').getAttribute('aria-pressed'), 'false');
    equal(g.stored('sound'), false);
  });

  gameTest('auto-pauses when the tab is hidden', {}, async (g) => {
    startFrozen(g);
    Object.defineProperty(g.doc, 'visibilityState', { value: 'hidden', configurable: true });
    g.doc.dispatchEvent(new g.win.Event('visibilitychange'));
    assert(g.api.state.paused, 'paused on hide');
    equal(g.$('[data-status]').textContent, 'suspended');
  });

  gameTest('auto-pauses when the window loses focus', {}, async (g) => {
    startFrozen(g);
    g.win.dispatchEvent(new g.win.Event('blur'));
    assert(g.api.state.paused, 'paused on blur');
  });

  gameTest('a focused button keeps Space for itself instead of double-firing', {}, async (g) => {
    const start = g.$('[data-action="start"]');
    start.focus();
    g.key(' ');
    equal(g.api.phase, 'ready', 'global handler must not also start the game');
  });

  test('a v1 theme preference is honoured', async () => {
    clearGameStorage();
    localStorage.setItem('serpentine-theme', 'light');
    const g = await openGame({ clearStorage: false });
    try {
      equal(g.doc.documentElement.dataset.theme, 'light');
      equal(g.errors, []);
    } finally {
      g.close();
    }
  });

  test('corrupt saved data falls back to defaults', async () => {
    clearGameStorage();
    localStorage.setItem('serpentine:best', '{not json');
    localStorage.setItem('serpentine:mode', '"portal"');
    localStorage.setItem('serpentine:theme', '42');
    const g = await openGame({ clearStorage: false });
    try {
      equal(g.api.state.mode, 'wrap');
      equal(g.$('[data-best]').textContent, '00000');
      assert(['dark', 'light'].includes(g.doc.documentElement.dataset.theme), 'valid theme');
      equal(g.errors, []);
    } finally {
      g.close();
    }
  });

  gameTest('the service worker installs and precaches the app shell', {}, async (g) => {
    const registration = await Promise.race([g.win.navigator.serviceWorker.ready, sleep(8000).then(() => null)]);
    assert(registration, 'service worker ready');
    await waitFor(() => registration.active && registration.active.state === 'activated', 8000, 'worker activated');
    const cache = await g.win.caches.open('serpentine-v2');
    const keys = (await cache.keys()).map((request) => new URL(request.url).pathname);
    for (const path of ['/index.html', '/src/game.js', '/src/renderer.js', '/manifest.webmanifest', '/icons/icon-192.png']) {
      assert(keys.includes(path), `precache is missing ${path}`);
    }
  });
});

describe('e2e: touch', () => {
  gameTest('touch layout shows the D-pad and hides keyboard hints', { input: 'touch', width: 390, height: 844 }, async (g) => {
    assert(g.visible('[data-dpad]'), 'D-pad visible');
    assert(!g.visible('.keys'), 'keyboard legend hidden');
    const pad = g.$('[data-dir="up"]').getBoundingClientRect();
    assert(pad.width >= 44 && pad.height >= 44, `pad buttons need a 44px target, got ${pad.width}x${pad.height}`);
  });

  gameTest('D-pad starts the game and steers', { input: 'touch', width: 390, height: 844 }, async (g) => {
    g.api.freeze(true);
    g.pointer('pointerdown', g.$('[data-dir="up"]'), 10, 10);
    equal(g.api.phase, 'playing');
    g.api.step();
    equal(g.api.state.direction, { x: 0, y: -1 });
    g.pointer('pointerdown', g.$('[data-dir="left"]'), 10, 10);
    g.api.step();
    equal(g.api.state.direction, { x: -1, y: 0 });
  });

  gameTest('swiping on the board steers, including chained turns in one gesture', { input: 'touch', width: 390, height: 844 }, async (g) => {
    startFrozen(g);
    const stage = g.$('[data-stage]');
    const rect = stage.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    g.pointer('pointerdown', stage, x, y);
    g.pointer('pointermove', stage, x + 4, y - 60);
    equal(g.api.state.queue, [{ x: 0, y: -1 }], 'swipe up queued');
    g.pointer('pointermove', stage, x - 60, y - 64);
    equal(g.api.state.queue, [{ x: 0, y: -1 }, { x: -1, y: 0 }], 'continuing left chains a second turn');
    g.pointer('pointerup', stage, x - 60, y - 64);
    g.pointer('pointermove', stage, x + 200, y);
    equal(g.api.state.queue.length, 2, 'moves after lifting the finger do nothing');
  });

  gameTest('the first real touch switches a desktop layout to touch', { input: null }, async (g) => {
    equal(g.doc.documentElement.dataset.input, 'desktop');
    assert(!g.visible('[data-dpad]'), 'no D-pad on desktop');
    g.pointer('pointerdown', g.doc.body, 5, 5, 'touch');
    equal(g.doc.documentElement.dataset.input, 'touch');
    assert(g.visible('[data-dpad]'), 'D-pad appears');
  });
});
