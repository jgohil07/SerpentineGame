/**
 * Serpentine game rules.
 *
 * Pure and deterministic: no DOM, no timers, no hidden randomness. Every
 * function takes a state and returns a new one, so the rules can be unit
 * tested and a run can be replayed exactly from a seed plus its inputs.
 */

export const GRID_SIZE = 20;

export const MODES = Object.freeze({
  classic: 'classic', // walls are solid
  wrap: 'wrap', // edges loop to the opposite side
});

export const DIRECTIONS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});

/** Turns buffered ahead of the next tick: enough for a fast U-turn. */
export const MAX_QUEUED_TURNS = 3;

export const SCORING = Object.freeze({
  food: 10,
  bonus: 50,
  maxCombo: 5,
  /** Extra ticks on top of the shortest path to keep a combo alive. */
  comboSlackTicks: 8,
});

export const BONUS = Object.freeze({
  /** No bonus food until this many regular foods have been eaten. */
  minFoodEaten: 2,
  /** Chance of spawning a bonus each time food is eaten... */
  chance: 0.25,
  /** ...but always spawn one after this many foods without one. */
  pity: 6,
  /** Extra ticks on top of the shortest path before the bonus expires. */
  slackTicks: 20,
});

export const SPEED = Object.freeze({
  startMs: 140,
  minMs: 60,
  /** Foods eaten for the interval to close ~63% of the gap to minMs. */
  rampFoods: 28,
});

export function makeInitialState(
  gridSize = GRID_SIZE,
  { mode = MODES.wrap, randomFn = Math.random } = {},
) {
  if (!Number.isInteger(gridSize) || gridSize < 4) {
    throw new RangeError(`gridSize must be an integer >= 4, got ${gridSize}`);
  }
  if (!Object.values(MODES).includes(mode)) {
    throw new RangeError(`unknown mode: ${mode}`);
  }

  const mid = Math.floor(gridSize / 2);
  const snake = [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
  ];

  return {
    gridSize,
    mode,
    snake,
    direction: DIRECTIONS.right,
    queue: [],
    food: placeFood(gridSize, snake, randomFn),
    bonus: null,
    score: 0,
    eaten: 0,
    combo: 1,
    comboTicks: 0,
    comboWindow: 0,
    foodsSinceBonus: 0,
    tick: 0,
    paused: false,
    gameOver: false,
    won: false,
    deathCause: null,
    events: [],
  };
}

/**
 * Queue a turn for an upcoming tick. Each turn is checked against the turn
 * queued before it (not just the current heading), so two quick presses
 * within one tick both register and can never fold the snake back on itself.
 */
export function setDirection(state, nextDirection) {
  if (state.gameOver || state.won || state.paused || !nextDirection) {
    return state;
  }

  const last = state.queue.length > 0 ? state.queue[state.queue.length - 1] : state.direction;
  if (
    state.queue.length >= MAX_QUEUED_TURNS ||
    sameDirection(last, nextDirection) ||
    isOppositeDirection(last, nextDirection)
  ) {
    return state;
  }

  return { ...state, queue: [...state.queue, nextDirection] };
}

export function togglePause(state) {
  if (state.gameOver || state.won) {
    return state;
  }

  return { ...state, paused: !state.paused };
}

/**
 * Advance the game by one tick. `events` on the returned state lists what
 * happened during this tick (eat, bonus, die, win, ...) for sound and effects.
 */
export function nextState(state, randomFn = Math.random) {
  if (state.gameOver || state.won || state.paused) {
    return state.events.length > 0 ? { ...state, events: [] } : state;
  }

  const { gridSize, mode } = state;
  const [turn, ...queue] = state.queue;
  const direction = turn ?? state.direction;
  const head = state.snake[0];
  let nextHead = { x: head.x + direction.x, y: head.y + direction.y };

  if (isWallCollision(nextHead, gridSize)) {
    if (mode === MODES.classic) {
      return crash(state, direction, 'wall');
    }
    nextHead = wrapPoint(nextHead, gridSize);
  }

  const ateFood = state.food !== null && pointsEqual(nextHead, state.food);
  const ateBonus = state.bonus !== null && pointsEqual(nextHead, state.bonus);
  const snake = [nextHead, ...state.snake];
  if (!ateFood) {
    // The tail moves out of its cell this tick, so chasing it is legal.
    snake.pop();
  }

  if (isSelfCollision(snake)) {
    return crash(state, direction, 'self');
  }

  const events = [];
  let { score, eaten, combo, comboTicks, comboWindow, foodsSinceBonus, food, bonus } = state;

  if (ateBonus) {
    const points = SCORING.bonus * combo;
    score += points;
    bonus = null;
    events.push({ type: 'bonus', x: nextHead.x, y: nextHead.y, points });
  } else if (bonus !== null) {
    bonus = bonus.ttl > 1 ? { ...bonus, ttl: bonus.ttl - 1 } : null;
    if (bonus === null) {
      events.push({ type: 'bonus-expire' });
    }
  }

  if (ateFood) {
    combo = comboTicks > 0 ? Math.min(combo + 1, SCORING.maxCombo) : 1;
    const points = SCORING.food * combo;
    score += points;
    eaten += 1;
    foodsSinceBonus += 1;
    events.push({ type: 'eat', x: nextHead.x, y: nextHead.y, points, combo });

    if (snake.length >= gridSize * gridSize) {
      events.push({ type: 'win' });
      return {
        ...state,
        snake,
        direction,
        queue: [],
        food: null,
        bonus: null,
        score,
        eaten,
        combo,
        comboTicks: 0,
        comboWindow: 0,
        foodsSinceBonus,
        tick: state.tick + 1,
        won: true,
        events,
      };
    }

    food = placeFood(gridSize, snake, randomFn, bonus ? [bonus] : []);
    if (food === null) {
      // The bonus was sitting on the last free cell: regular food wins it.
      food = { x: bonus.x, y: bonus.y };
      bonus = null;
    }

    comboWindow = gridDistance(nextHead, food, gridSize, mode) + SCORING.comboSlackTicks;
    comboTicks = comboWindow;

    const bonusDue = foodsSinceBonus >= BONUS.pity || randomFn() < BONUS.chance;
    if (bonus === null && eaten >= BONUS.minFoodEaten && bonusDue) {
      const cell = placeFood(gridSize, snake, randomFn, [food]);
      if (cell !== null) {
        const ttl = gridDistance(nextHead, cell, gridSize, mode) + BONUS.slackTicks;
        bonus = { ...cell, ttl, maxTtl: ttl };
        foodsSinceBonus = 0;
        events.push({ type: 'bonus-spawn', x: cell.x, y: cell.y });
      }
    }
  } else if (comboTicks > 0) {
    comboTicks -= 1;
    if (comboTicks === 0) {
      if (combo > 1) {
        events.push({ type: 'combo-lost', combo });
      }
      combo = 1;
    }
  }

  return {
    ...state,
    snake,
    direction,
    queue,
    food,
    bonus,
    score,
    eaten,
    combo,
    comboTicks,
    comboWindow,
    foodsSinceBonus,
    tick: state.tick + 1,
    events,
  };
}

function crash(state, direction, cause) {
  return {
    ...state,
    direction,
    queue: [],
    gameOver: true,
    deathCause: cause,
    events: [{ type: 'die', cause }],
  };
}

/** Milliseconds per tick after `eaten` foods: eases from startMs to minMs. */
export function tickInterval(eaten) {
  const { startMs, minMs, rampFoods } = SPEED;
  return minMs + (startMs - minMs) * Math.exp(-eaten / rampFoods);
}

export function isOppositeDirection(current, next) {
  if (!current || !next) {
    return false;
  }

  return current.x + next.x === 0 && current.y + next.y === 0;
}

export function sameDirection(a, b) {
  return Boolean(a && b) && a.x === b.x && a.y === b.y;
}

export function isWallCollision(point, gridSize) {
  return point.x < 0 || point.y < 0 || point.x >= gridSize || point.y >= gridSize;
}

export function wrapPoint(point, gridSize) {
  return {
    x: (point.x + gridSize) % gridSize,
    y: (point.y + gridSize) % gridSize,
  };
}

export function isSelfCollision(snake) {
  const [head, ...body] = snake;
  return body.some((segment) => pointsEqual(segment, head));
}

/**
 * Pick a random free cell, in row-major order, avoiding the snake and any
 * `blocked` cells. Returns null when no cell is free.
 */
export function placeFood(gridSize, snake, randomFn = Math.random, blocked = []) {
  const occupied = new Set();
  for (const cell of snake) {
    occupied.add(cell.y * gridSize + cell.x);
  }
  for (const cell of blocked) {
    if (cell) {
      occupied.add(cell.y * gridSize + cell.x);
    }
  }

  const totalCells = gridSize * gridSize;
  const freeCount = totalCells - occupied.size;
  if (freeCount <= 0) {
    return null;
  }

  let target = Math.min(freeCount - 1, Math.floor(randomFn() * freeCount));
  for (let index = 0; index < totalCells; index += 1) {
    if (occupied.has(index)) {
      continue;
    }
    if (target === 0) {
      return { x: index % gridSize, y: Math.floor(index / gridSize) };
    }
    target -= 1;
  }

  return null;
}

/** Fewest moves between two cells, taking wrap-around into account. */
export function gridDistance(a, b, gridSize, mode) {
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  if (mode === MODES.wrap) {
    dx = Math.min(dx, gridSize - dx);
    dy = Math.min(dy, gridSize - dy);
  }
  return dx + dy;
}

/** Step from one cell to an adjacent one, where "adjacent" may cross an edge. */
export function wrapDelta(from, to, gridSize) {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (dx > 1) dx -= gridSize;
  else if (dx < -1) dx += gridSize;
  if (dy > 1) dy -= gridSize;
  else if (dy < -1) dy += gridSize;
  return { x: dx, y: dy };
}

export function pointsEqual(a, b) {
  return a.x === b.x && a.y === b.y;
}

/** Small, fast seeded PRNG (mulberry32) returning floats in [0, 1). */
export function createRng(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
