export const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function isOppositeDirection(current, next) {
  if (!current || !next) {
    return false;
  }

  return (
    current.x + next.x === 0 &&
    current.y + next.y === 0
  );
}

export function makeInitialState(gridSize = 16) {
  const mid = Math.floor(gridSize / 2);
  const snake = [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
  ];

  return {
    gridSize,
    snake,
    direction: DIRECTIONS.right,
    pendingDirection: DIRECTIONS.right,
    food: placeFood(gridSize, snake),
    score: 0,
    gameOver: false,
    paused: false,
  };
}

export function setDirection(state, nextDirection) {
  if (state.gameOver || state.paused || !nextDirection) {
    return state;
  }

  if (isOppositeDirection(state.direction, nextDirection)) {
    return state;
  }

  return {
    ...state,
    pendingDirection: nextDirection,
  };
}

export function togglePause(state) {
  if (state.gameOver) {
    return state;
  }

  return {
    ...state,
    paused: !state.paused,
  };
}

export function nextState(state, randomFn = Math.random) {
  if (state.gameOver || state.paused) {
    return state;
  }

  const direction = state.pendingDirection;
  const head = state.snake[0];
  const nextHead = {
    x: head.x + direction.x,
    y: head.y + direction.y,
  };

  const wrappedHead = wrapPoint(nextHead, state.gridSize);

  const willEatFood = state.food ? pointsEqual(wrappedHead, state.food) : false;
  const nextSnake = [wrappedHead, ...state.snake];

  if (!willEatFood) {
    nextSnake.pop();
  }

  if (isSelfCollision(nextSnake)) {
    return {
      ...state,
      direction,
      gameOver: true,
    };
  }

  const nextFood = willEatFood
    ? placeFood(state.gridSize, nextSnake, randomFn)
    : state.food;

  return {
    ...state,
    snake: nextSnake,
    direction,
    food: nextFood,
    score: willEatFood ? state.score + 1 : state.score,
  };
}

export function isWallCollision(point, gridSize) {
  return (
    point.x < 0 ||
    point.y < 0 ||
    point.x >= gridSize ||
    point.y >= gridSize
  );
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

export function placeFood(gridSize, snake, randomFn = Math.random) {
  const occupied = new Set(snake.map((segment) => `${segment.x},${segment.y}`));
  const totalCells = gridSize * gridSize;

  if (occupied.size >= totalCells) {
    return null;
  }

  const freeCells = [];
  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const key = `${x},${y}`;
      if (!occupied.has(key)) {
        freeCells.push({ x, y });
      }
    }
  }

  const index = Math.floor(randomFn() * freeCells.length);
  return freeCells[index];
}

function pointsEqual(a, b) {
  return a.x === b.x && a.y === b.y;
}
