import { describe, test, assert, equal } from './harness.js';
import {
  BONUS,
  DIRECTIONS as D,
  MAX_QUEUED_TURNS,
  MODES,
  SCORING,
  SPEED,
  createRng,
  gridDistance,
  isOppositeDirection,
  makeInitialState,
  nextState,
  placeFood,
  setDirection,
  tickInterval,
  togglePause,
  wrapDelta,
} from '../src/snakeLogic.js';

const zero = () => 0;
const key = (p) => `${p.x},${p.y}`;

/** A 10x10 state with overrides; food is parked far away unless given. */
function make(overrides = {}, { gridSize = 10, mode = MODES.wrap } = {}) {
  const base = makeInitialState(gridSize, { mode, randomFn: zero });
  return { ...base, food: { x: 0, y: 0 }, ...overrides };
}

function steps(state, count, randomFn = zero) {
  let s = state;
  for (let i = 0; i < count; i += 1) {
    s = nextState(s, randomFn);
  }
  return s;
}

function queue(state, ...names) {
  return names.reduce((s, name) => setDirection(s, D[name]), state);
}

describe('rules: setup', () => {
  test('starts with a 3-long snake in the middle heading right', () => {
    const s = makeInitialState(20, { randomFn: zero });
    equal(s.snake, [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }]);
    equal(s.direction, D.right);
    equal([s.score, s.eaten, s.combo, s.queue.length], [0, 0, 1, 0]);
    equal([s.mode, s.gameOver, s.won, s.paused], ['wrap', false, false, false]);
  });

  test('default mode is wrap, matching v1 behaviour', () => {
    equal(makeInitialState().mode, MODES.wrap);
    equal(makeInitialState().gridSize, 20);
  });

  test('food never spawns on the snake', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const s = makeInitialState(20, { randomFn: createRng(seed) });
      assert(!s.snake.some((c) => key(c) === key(s.food)), `seed ${seed}: food on snake`);
    }
  });

  test('rejects invalid grid sizes and modes', () => {
    for (const bad of [3, 4.5, -1, '10']) {
      let threw = false;
      try {
        makeInitialState(bad);
      } catch (error) {
        threw = error instanceof RangeError;
      }
      assert(threw, `gridSize ${bad} should throw RangeError`);
    }
    let threw = false;
    try {
      makeInitialState(10, { mode: 'portal' });
    } catch (error) {
      threw = error instanceof RangeError;
    }
    assert(threw, 'unknown mode should throw RangeError');
  });
});

describe('rules: movement and input queue', () => {
  test('moves one cell per tick and keeps its length', () => {
    const s = nextState(make());
    equal(s.snake, [{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 }]);
    equal(s.tick, 1);
  });

  test('a queued turn applies on the next tick', () => {
    const s = nextState(queue(make(), 'up'));
    equal(s.snake[0], { x: 5, y: 4 });
    equal(s.direction, D.up);
  });

  test('an immediate reversal is ignored', () => {
    const s = queue(make(), 'left');
    equal(s.queue, []);
    equal(nextState(s).snake[0], { x: 6, y: 5 });
  });

  test('two quick turns within one tick both register (v1 dropped the second)', () => {
    let s = queue(make(), 'up', 'left');
    s = nextState(s);
    equal(s.direction, D.up, 'first tick turns up');
    s = nextState(s);
    equal(s.direction, D.left, 'second tick turns left');
    equal(s.snake[0], { x: 4, y: 4 });
  });

  test('a fast double-tap can never fold the snake back onto itself', () => {
    const s = queue(make(), 'up', 'down');
    equal(s.queue, [D.up], 'down is the reverse of the queued up');
    const after = steps(s, 2);
    assert(!after.gameOver, 'snake must survive');
  });

  test('duplicate turns and turns beyond the buffer are ignored', () => {
    equal(queue(make(), 'up', 'up').queue, [D.up]);
    const full = queue(make(), 'up', 'left', 'down', 'right');
    equal(full.queue.length, MAX_QUEUED_TURNS);
    equal(full.queue, [D.up, D.left, D.down]);
  });

  test('input is ignored while paused or after game over', () => {
    const paused = togglePause(make());
    equal(setDirection(paused, D.up), paused);
    const over = { ...make(), gameOver: true };
    equal(setDirection(over, D.up), over);
  });
});

describe('rules: walls', () => {
  const edges = [
    { name: 'right', snake: [{ x: 9, y: 5 }, { x: 8, y: 5 }, { x: 7, y: 5 }], dir: D.right, wrapped: { x: 0, y: 5 } },
    { name: 'left', snake: [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }], dir: D.left, wrapped: { x: 9, y: 5 } },
    { name: 'top', snake: [{ x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }], dir: D.up, wrapped: { x: 5, y: 9 } },
    { name: 'bottom', snake: [{ x: 5, y: 9 }, { x: 5, y: 8 }, { x: 5, y: 7 }], dir: D.down, wrapped: { x: 5, y: 0 } },
  ];

  for (const edge of edges) {
    test(`wrap mode passes through the ${edge.name} edge`, () => {
      const s = nextState(make({ snake: edge.snake, direction: edge.dir, food: { x: 3, y: 3 } }));
      assert(!s.gameOver, 'should survive');
      equal(s.snake[0], edge.wrapped);
    });

    test(`classic mode crashes into the ${edge.name} wall`, () => {
      const before = make({ snake: edge.snake, direction: edge.dir, food: { x: 3, y: 3 } }, { mode: MODES.classic });
      const s = nextState(before);
      equal([s.gameOver, s.deathCause], [true, 'wall']);
      equal(s.snake, before.snake, 'snake stays where it was');
      equal(s.events, [{ type: 'die', cause: 'wall' }]);
    });
  }
});

describe('rules: collisions', () => {
  test('running into its own body ends the game', () => {
    const snake = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }, { x: 7, y: 5 }];
    const s = nextState(queue(make({ snake, direction: D.up }), 'right'));
    equal([s.gameOver, s.deathCause], [true, 'self']);
    equal(s.events, [{ type: 'die', cause: 'self' }]);
  });

  test('chasing its own tail is legal because the tail moves away', () => {
    const snake = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }];
    const s = nextState(queue(make({ snake, direction: D.left }), 'down'));
    assert(!s.gameOver, 'tail chase must be allowed');
    equal(s.snake[0], { x: 5, y: 6 });
  });
});

describe('rules: food, growth and score', () => {
  test('eating grows the snake by one and scores 10 at x1', () => {
    const s = nextState(make({ food: { x: 6, y: 5 } }));
    equal(s.snake.length, 4);
    equal([s.score, s.eaten, s.combo], [10, 1, 1]);
    equal(s.events[0], { type: 'eat', x: 6, y: 5, points: 10, combo: 1 });
    assert(!s.snake.some((c) => key(c) === key(s.food)), 'new food must not be on the snake');
  });

  test('placeFood picks free cells in row-major order', () => {
    const snake = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    equal(placeFood(4, snake, zero), { x: 2, y: 0 });
    equal(placeFood(4, snake, () => 0.99999), { x: 3, y: 3 });
    equal(placeFood(4, snake, () => 1), { x: 3, y: 3 }, 'randomFn()=1 is clamped');
    equal(placeFood(4, snake, zero, [{ x: 2, y: 0 }]), { x: 3, y: 0 }, 'blocked cells are skipped');
  });

  test('placeFood returns null when no cell is free', () => {
    const snake = [];
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) snake.push({ x, y });
    equal(placeFood(4, snake, zero), null);
  });
});

describe('rules: combo', () => {
  test('eating again inside the window raises the multiplier', () => {
    let s = nextState(make({ food: { x: 6, y: 5 } }));
    assert(s.comboTicks > 0, 'window opens after eating');
    s = nextState({ ...s, food: { x: 7, y: 5 } });
    equal([s.combo, s.score], [2, 30]);
    equal(s.events[0].points, 20);
  });

  test('the window is the shortest path plus slack, wrap-aware', () => {
    const s = nextState(make({ food: { x: 6, y: 5 } }), () => 0);
    const expected = gridDistance(s.snake[0], s.food, 10, MODES.wrap) + SCORING.comboSlackTicks;
    equal([s.comboWindow, s.comboTicks], [expected, expected]);
  });

  test('letting the window run out resets the multiplier', () => {
    let s = make({ combo: 3, comboTicks: 2, comboWindow: 9, food: { x: 0, y: 0 } });
    s = nextState(s);
    equal([s.combo, s.comboTicks], [3, 1]);
    s = nextState(s);
    equal([s.combo, s.comboTicks], [1, 0]);
    equal(s.events, [{ type: 'combo-lost', combo: 3 }]);
  });

  test('the multiplier is capped', () => {
    const s = nextState(make({ combo: SCORING.maxCombo, comboTicks: 5, comboWindow: 9, food: { x: 6, y: 5 } }));
    equal(s.combo, SCORING.maxCombo);
    equal(s.events[0].points, SCORING.food * SCORING.maxCombo);
  });
});

describe('rules: bonus food', () => {
  test('no bonus before enough food has been eaten', () => {
    const s = nextState(make({ food: { x: 6, y: 5 } }));
    equal(s.bonus, null);
  });

  test('a bonus is guaranteed after the pity limit', () => {
    const before = make({ eaten: BONUS.minFoodEaten, foodsSinceBonus: BONUS.pity - 1, food: { x: 6, y: 5 } });
    const s = nextState(before, () => 0.99);
    assert(s.bonus !== null, 'bonus should spawn');
    assert(s.events.some((e) => e.type === 'bonus-spawn'), 'bonus-spawn event');
    assert(key(s.bonus) !== key(s.food), 'bonus not on food');
    assert(!s.snake.some((c) => key(c) === key(s.bonus)), 'bonus not on snake');
    equal(s.bonus.ttl, gridDistance(s.snake[0], s.bonus, 10, MODES.wrap) + BONUS.slackTicks);
    equal(s.foodsSinceBonus, 0);
  });

  test('a bonus expires after its ttl', () => {
    let s = make({ bonus: { x: 0, y: 9, ttl: 2, maxTtl: 2 } });
    s = nextState(s);
    equal(s.bonus.ttl, 1);
    s = nextState(s);
    equal(s.bonus, null);
    equal(s.events, [{ type: 'bonus-expire' }]);
  });

  test('eating a bonus scores 50 x combo and does not grow the snake', () => {
    const s = nextState(make({ combo: 2, comboTicks: 4, comboWindow: 9, bonus: { x: 6, y: 5, ttl: 5, maxTtl: 9 } }));
    equal([s.score, s.snake.length, s.bonus], [SCORING.bonus * 2, 3, null]);
    equal(s.events[0], { type: 'bonus', x: 6, y: 5, points: 100 });
  });

  test('food takes over the last free cell when a bonus occupies it', () => {
    // 4x4 board: snake fills everything except the food ahead and one bonus cell.
    const path = boustrophedon(4);
    const snake = path.slice(0, 14).reverse(); // head at path[13]
    const s = nextState(
      {
        ...makeInitialState(4, { randomFn: zero }),
        snake,
        direction: wrapDelta(path[12], path[13], 4),
        food: path[14],
        bonus: { ...path[15], ttl: 9, maxTtl: 9 },
      },
      zero,
    );
    equal(s.snake.length, 15);
    equal(s.food, path[15]);
    equal(s.bonus, null);
  });
});

describe('rules: win, pause and speed', () => {
  test('filling the board wins the game', () => {
    const path = boustrophedon(4);
    const snake = path.slice(0, 15).reverse();
    let s = {
      ...makeInitialState(4, { randomFn: zero }),
      snake,
      direction: wrapDelta(path[13], path[14], 4),
      food: path[15],
    };
    s = nextState(s, zero);
    equal([s.won, s.gameOver, s.food, s.snake.length], [true, false, null, 16]);
    assert(s.events.some((e) => e.type === 'win'), 'win event');
    const after = nextState(s);
    equal(after.snake, s.snake, 'no movement after winning');
    equal(after.events, [], 'stale events are cleared');
  });

  test('pause freezes the game and cannot be toggled after game over', () => {
    const paused = togglePause(make());
    equal(nextState(paused), paused);
    equal(togglePause(paused).paused, false);
    const over = { ...make(), gameOver: true };
    equal(togglePause(over), over);
  });

  test('speed starts at the v1 tick and eases towards the floor', () => {
    equal(Math.round(tickInterval(0)), SPEED.startMs);
    let previous = Infinity;
    for (let eaten = 0; eaten <= 400; eaten += 1) {
      const interval = tickInterval(eaten);
      assert(interval < previous, `interval must decrease at ${eaten}`);
      assert(interval >= SPEED.minMs, `interval must stay >= ${SPEED.minMs}`);
      previous = interval;
    }
    assert(tickInterval(400) - SPEED.minMs < 0.1, 'approaches the floor');
  });
});

describe('rules: helpers', () => {
  test('wrapDelta handles edge crossings', () => {
    equal(wrapDelta({ x: 9, y: 3 }, { x: 0, y: 3 }, 10), { x: 1, y: 0 });
    equal(wrapDelta({ x: 0, y: 3 }, { x: 9, y: 3 }, 10), { x: -1, y: 0 });
    equal(wrapDelta({ x: 3, y: 0 }, { x: 3, y: 9 }, 10), { x: 0, y: -1 });
    equal(wrapDelta({ x: 3, y: 4 }, { x: 3, y: 5 }, 10), { x: 0, y: 1 });
  });

  test('gridDistance is wrap-aware only in wrap mode', () => {
    equal(gridDistance({ x: 0, y: 0 }, { x: 9, y: 9 }, 10, MODES.wrap), 2);
    equal(gridDistance({ x: 0, y: 0 }, { x: 9, y: 9 }, 10, MODES.classic), 18);
  });

  test('isOppositeDirection', () => {
    assert(isOppositeDirection(D.up, D.down));
    assert(isOppositeDirection(D.left, D.right));
    assert(!isOppositeDirection(D.up, D.left));
    assert(!isOppositeDirection(null, D.left));
  });

  test('createRng is deterministic and stays in [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i += 1) {
      const value = a();
      equal(value, b());
      assert(value >= 0 && value < 1, `out of range: ${value}`);
    }
  });
});

describe('rules: determinism and invariants', () => {
  test('the same seed and inputs replay identically', () => {
    const runOnce = () => {
      const rng = createRng(7);
      const inputs = createRng(99);
      let s = makeInitialState(20, { mode: MODES.wrap, randomFn: rng });
      for (let i = 0; i < 500 && !s.gameOver; i += 1) {
        s = setDirection(s, Object.values(D)[Math.floor(inputs() * 4)]);
        s = nextState(s, rng);
      }
      return s;
    };
    equal(runOnce(), runOnce());
  });

  test('fuzz: 240 random and greedy games keep every invariant', () => {
    let totalTicks = 0;
    const eventsSeen = new Set();
    for (let game = 0; game < 240; game += 1) {
      const mode = game % 2 === 0 ? MODES.wrap : MODES.classic;
      const rng = createRng(1000 + game);
      const inputs = createRng(5000 + game);
      // Thirds: random steering, greedy for food only, greedy for bonus first.
      const greedy = game % 3 !== 0;
      const preferBonus = game % 3 === 2;
      let s = makeInitialState(20, { mode, randomFn: rng });
      for (let tick = 0; tick < 2500 && !s.gameOver && !s.won; tick += 1) {
        const choice = greedy ? greedyMove(s, preferBonus) : Object.values(D)[Math.floor(inputs() * 4)];
        if (greedy || inputs() < 0.3) {
          s = setDirection(s, choice);
        }
        const before = s;
        s = nextState(s, rng);
        s.events.forEach((e) => eventsSeen.add(e.type));
        checkInvariants(before, s);
        totalTicks += 1;
      }
    }
    assert(totalTicks > 50000, `fuzz ran too few ticks: ${totalTicks}`);
    for (const type of ['eat', 'bonus', 'bonus-spawn', 'bonus-expire', 'combo-lost', 'die']) {
      assert(eventsSeen.has(type), `fuzz never produced a "${type}" event`);
    }
  });

  test('a Hamiltonian-cycle bot always clears a 6x6 board, in both modes', () => {
    for (const mode of Object.values(MODES)) {
      for (let seed = 1; seed <= 10; seed += 1) {
        const rng = createRng(seed);
        const cycle = hamiltonianCycle6();
        let s = makeInitialState(6, { mode, randomFn: rng });
        let ticks = 0;
        while (!s.won && !s.gameOver && ticks < 6000) {
          const head = s.snake[0];
          const next = cycle.get(key(head));
          s = setDirection(s, wrapDelta(head, next, 6));
          const before = s;
          s = nextState(s, rng);
          checkInvariants(before, s);
          ticks += 1;
        }
        assert(s.won, `${mode}/${seed}: bot should win (gameOver=${s.gameOver}, len=${s.snake.length})`);
        equal(s.snake.length, 36);
      }
    }
  });
});

// ---- helpers -------------------------------------------------------------

function checkInvariants(before, s) {
  const n = s.gridSize;
  for (const c of s.snake) {
    assert(c.x >= 0 && c.y >= 0 && c.x < n && c.y < n, `segment out of bounds: ${key(c)}`);
  }
  if (!s.gameOver) {
    const cells = new Set(s.snake.map(key));
    assert(cells.size === s.snake.length, 'snake overlaps itself while alive');
    for (let i = 1; i < s.snake.length; i += 1) {
      const d = wrapDelta(s.snake[i - 1], s.snake[i], n);
      assert(Math.abs(d.x) + Math.abs(d.y) === 1, `segments ${i - 1}/${i} not adjacent`);
      if (s.mode === MODES.classic) {
        const raw = Math.abs(s.snake[i - 1].x - s.snake[i].x) + Math.abs(s.snake[i - 1].y - s.snake[i].y);
        assert(raw === 1, 'classic snake must never span an edge');
      }
    }
    if (s.food) {
      assert(!cells.has(key(s.food)), 'food on snake');
    }
    if (s.bonus) {
      assert(!cells.has(key(s.bonus)), 'bonus on snake');
      assert(!s.food || key(s.bonus) !== key(s.food), 'bonus on food');
      assert(s.bonus.ttl > 0 && s.bonus.ttl <= s.bonus.maxTtl, 'bonus ttl out of range');
    }
  }
  assert(s.snake.length === 3 + s.eaten, `length ${s.snake.length} != 3 + eaten ${s.eaten}`);
  assert(s.score % 10 === 0 && s.score >= SCORING.food * s.eaten, `score ${s.score} inconsistent`);
  assert(s.combo >= 1 && s.combo <= SCORING.maxCombo, `combo ${s.combo} out of range`);
  assert(s.comboTicks >= 0 && s.comboTicks <= s.comboWindow, 'combo ticks out of range');
  assert(s.queue.length <= MAX_QUEUED_TURNS, 'queue overflow');
  assert(s.score >= before.score, 'score went down');
  assert(s.tick === before.tick + 1 || s.gameOver, 'tick must advance by one');
}

/** Head toward the food, avoiding immediate death when possible. */
function greedyMove(s, preferBonus) {
  const head = s.snake[0];
  const body = new Set(s.snake.slice(0, -1).map(key));
  let best = null;
  let bestScore = Infinity;
  for (const dir of Object.values(D)) {
    if (isOppositeDirection(s.direction, dir)) continue;
    let next = { x: head.x + dir.x, y: head.y + dir.y };
    const outside = next.x < 0 || next.y < 0 || next.x >= s.gridSize || next.y >= s.gridSize;
    if (outside && s.mode === MODES.classic) continue;
    next = { x: (next.x + s.gridSize) % s.gridSize, y: (next.y + s.gridSize) % s.gridSize };
    if (body.has(key(next))) continue;
    const target = preferBonus ? (s.bonus ?? s.food) : s.food;
    const score = target ? gridDistance(next, target, s.gridSize, s.mode) : 0;
    if (score < bestScore) {
      best = dir;
      bestScore = score;
    }
  }
  return best ?? s.direction;
}

/** Cells of an n x n board in back-and-forth row order. */
function boustrophedon(n) {
  const cells = [];
  for (let y = 0; y < n; y += 1) {
    for (let i = 0; i < n; i += 1) {
      cells.push({ x: y % 2 === 0 ? i : n - 1 - i, y });
    }
  }
  return cells;
}

/**
 * A Hamiltonian cycle on 6x6 that runs through the default start position
 * (tail 1,3 -> head 3,3, heading right): up column 0, then back and forth
 * through columns 1-5 from the bottom row to the top row.
 */
function hamiltonianCycle6() {
  const order = [];
  for (let y = 0; y <= 5; y += 1) order.push({ x: 0, y });
  for (let y = 5; y >= 0; y -= 1) {
    const leftToRight = (5 - y) % 2 === 0;
    for (let i = 1; i <= 5; i += 1) order.push({ x: leftToRight ? i : 6 - i, y });
  }
  // The last cell (row 0) must lead back to (0,0): row 0 is walked 5 -> 1.
  const next = new Map();
  order.forEach((cell, i) => next.set(key(cell), order[(i + 1) % order.length]));
  return next;
}
