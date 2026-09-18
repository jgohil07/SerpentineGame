/**
 * Input handling. Keyboard, swipe and the on-screen D-pad all reduce to two
 * callbacks: onDirection('up' | 'down' | 'left' | 'right') and
 * onCommand(name). The game decides what each one means in the current phase.
 */

const KEY_DIRECTIONS = {
  arrowup: 'up',
  w: 'up',
  k: 'up',
  arrowdown: 'down',
  s: 'down',
  j: 'down',
  arrowleft: 'left',
  a: 'left',
  h: 'left',
  arrowright: 'right',
  d: 'right',
  l: 'right',
};

const KEY_COMMANDS = {
  ' ': 'confirm',
  enter: 'confirm',
  p: 'pause',
  escape: 'escape',
  r: 'restart',
  m: 'mute',
  t: 'theme',
  1: 'mode-classic',
  2: 'mode-wrap',
};

const SWIPE_MIN_PX = 14;

export function bindInput({ stage, dpad, onDirection, onCommand, getCellPx, onTouch }) {
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    // Chrome can fire keydown without a key (e.g. autofill).
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    const focusedControl =
      event.target instanceof Element && event.target.closest('button, a, input, select, textarea');
    if (focusedControl && (key === ' ' || key === 'enter')) {
      // Let the focused button activate itself instead of doing both.
      return;
    }

    const direction = KEY_DIRECTIONS[key];
    if (direction) {
      event.preventDefault(); // arrow keys must never scroll the page
      if (!event.repeat) {
        onDirection(direction, 'key');
      }
      return;
    }

    const command = KEY_COMMANDS[key];
    if (command) {
      if (key === ' ') {
        event.preventDefault();
      }
      if (!event.repeat) {
        onCommand(command);
      }
    }
  });

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        onTouch();
      }
    },
    { capture: true, passive: true },
  );

  // Swipe to steer. A turn fires as soon as the finger has travelled far
  // enough, not on release, and the origin then resets so one continuous
  // gesture can chain several turns.
  let swipe = null;

  stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || (event.target instanceof Element && event.target.closest('button'))) {
      return;
    }
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best effort; the swipe still works inside the stage.
    }
  });

  stage.addEventListener('pointermove', (event) => {
    if (!swipe || event.pointerId !== swipe.id) {
      return;
    }
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    const threshold = Math.max(SWIPE_MIN_PX, getCellPx() * 0.75);
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
      return;
    }
    const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    onDirection(direction, 'swipe');
    swipe.x = event.clientX;
    swipe.y = event.clientY;
  });

  const endSwipe = (event) => {
    if (swipe && event.pointerId === swipe.id) {
      swipe = null;
    }
  };
  stage.addEventListener('pointerup', endSwipe);
  stage.addEventListener('pointercancel', endSwipe);

  // D-pad reacts on pointerdown, which is noticeably faster than waiting for
  // click. Keyboard activation (click with detail 0) is still honoured.
  dpad.addEventListener('pointerdown', (event) => {
    const button = event.target instanceof Element && event.target.closest('[data-dir]');
    if (!button) {
      return;
    }
    event.preventDefault();
    button.classList.add('is-pressed');
    window.setTimeout(() => button.classList.remove('is-pressed'), 110);
    onDirection(button.dataset.dir, 'pad');
  });

  dpad.addEventListener('click', (event) => {
    const button = event.target instanceof Element && event.target.closest('[data-dir]');
    if (button && event.detail === 0) {
      onDirection(button.dataset.dir, 'pad');
    }
  });
}
