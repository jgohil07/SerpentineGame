import {
  DIRECTIONS,
  makeInitialState,
  nextState,
  setDirection,
  togglePause,
} from './snakeLogic.js';

const GRID_SIZE = 16;
const TICK_MS = 140;

const boardEl = document.querySelector('[data-board]');
const scoreEl = document.querySelector('[data-score]');
const statusEl = document.querySelector('[data-status]');
const statusDotEl = document.querySelector('.status-dot');
const restartBtn = document.querySelector('[data-restart]');
const pauseBtn = document.querySelector('[data-pause]');
const themeToggle = document.querySelector('[data-theme-toggle]');
const themeIcon = document.querySelector('[data-theme-icon]');
const themeLabel = document.querySelector('[data-theme-label]');
const directionButtons = document.querySelectorAll('[data-direction]');

let state = makeInitialState(GRID_SIZE);

function setTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  themeIcon.textContent = isDark ? '\u2600' : '\u263e';
  themeLabel.textContent = isDark ? 'Light mode' : 'Dark mode';
  themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  localStorage.setItem('serpentine-theme', isDark ? 'dark' : 'light');
}

function render() {
  boardEl.replaceChildren();

  for (let y = 0; y < state.gridSize; y += 1) {
    for (let x = 0; x < state.gridSize; x += 1) {
      const cell = document.createElement('div');
      cell.className = 'cell';

      if (state.food && state.food.x === x && state.food.y === y) {
        const food = document.createElement('span');
        food.className = 'food';
        food.setAttribute('aria-label', 'Food');
        cell.appendChild(food);
      }

      const snakeIndex = state.snake.findIndex((segment) => segment.x === x && segment.y === y);
      if (snakeIndex !== -1) {
        const snakeSegment = document.createElement('span');
        snakeSegment.className = snakeIndex === 0 ? 'snake-head' : 'snake';
        if (snakeIndex === 0) {
          snakeSegment.setAttribute('aria-label', 'Snake head');
        }
        cell.appendChild(snakeSegment);
      }

      boardEl.appendChild(cell);
    }
  }

  scoreEl.textContent = String(state.score);

  if (state.gameOver) {
    statusEl.textContent = 'Game Over';
    statusDotEl.className = 'status-dot status-dot-danger';
  } else if (state.paused) {
    statusEl.textContent = 'Paused';
    statusDotEl.className = 'status-dot status-dot-paused';
  } else {
    statusEl.textContent = 'Running';
    statusDotEl.className = 'status-dot';
  }

  pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
}

function restart() {
  state = makeInitialState(GRID_SIZE);
  render();
}

function step() {
  state = nextState(state);
  render();
}

function handleDirectionInput(key) {
  const nextDirection = mapKeyToDirection(key);
  if (!nextDirection) {
    return;
  }
  state = setDirection(state, nextDirection);
}

function mapKeyToDirection(key) {
  const normalized = key.toLowerCase();

  switch (normalized) {
    case 'arrowup':
    case 'w':
      return DIRECTIONS.up;
    case 'arrowdown':
    case 's':
      return DIRECTIONS.down;
    case 'arrowleft':
    case 'a':
      return DIRECTIONS.left;
    case 'arrowright':
    case 'd':
      return DIRECTIONS.right;
    default:
      return null;
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key === ' ') {
    event.preventDefault();
    state = togglePause(state);
    render();
    return;
  }

  handleDirectionInput(event.key);
});

restartBtn.addEventListener('click', restart);
pauseBtn.addEventListener('click', () => {
  state = togglePause(state);
  render();
});

themeToggle.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

directionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const direction = button.getAttribute('data-direction');
    if (direction && DIRECTIONS[direction]) {
      state = setDirection(state, DIRECTIONS[direction]);
    }
  });
});

setInterval(step, TICK_MS);
setTheme(localStorage.getItem('serpentine-theme') || 'light');
render();
