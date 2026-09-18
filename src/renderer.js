/**
 * Canvas renderer.
 *
 * Everything is drawn in grid units (1 unit = 1 cell) through a scale
 * transform, on a backing store sized for devicePixelRatio so lines stay
 * crisp. Movement is interpolated between the previous and current tick: the
 * head slides into its new cell while the tail slides out of its old one, so
 * the snake glides at display refresh rate while the rules stay grid-based.
 */

import { MODES, pointsEqual, wrapDelta } from './snakeLogic.js';

const TAU = Math.PI * 2;
const EPSILON = 1e-6;
const BODY_WIDTH = 0.62;
const HEAD_SIZE = 0.8;
const GLOW_WIDTH = 1.05;
const MAX_PARTICLES = 260;
const GRADIENT_STEPS = 48;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const gridLayer = document.createElement('canvas');
  const gridCtx = gridLayer.getContext('2d');

  let grid = 20;
  let cssSize = 0;
  let dpr = 1;
  let palette = null;
  let gradient = [];
  let reducedMotion = false;
  let flash = null;
  let swallowed = null;
  const particles = [];
  const popups = [];
  const segments = [];

  function resize(size, pixelRatio, gridSize) {
    cssSize = size;
    dpr = pixelRatio;
    grid = gridSize;
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;
    gridLayer.width = px;
    gridLayer.height = px;
    paintGridLayer();
  }

  function setPalette(next) {
    palette = next;
    gradient = buildGradient(next.snake, next.snakeTail, GRADIENT_STEPS);
    paintGridLayer();
  }

  function setReducedMotion(value) {
    reducedMotion = value;
    if (value) {
      particles.length = 0;
      popups.length = 0;
    }
  }

  function paintGridLayer() {
    if (!palette || !cssSize) {
      return;
    }
    const px = gridLayer.width;
    const cell = px / grid;
    const dot = Math.max(1, Math.round(cell * 0.08));
    gridCtx.fillStyle = palette.board;
    gridCtx.fillRect(0, 0, px, px);
    gridCtx.fillStyle = palette.grid;
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        gridCtx.fillRect(Math.round((x + 0.5) * cell - dot / 2), Math.round((y + 0.5) * cell - dot / 2), dot, dot);
      }
    }
  }

  // ---- effects ------------------------------------------------------------

  function burst(x, y, color, count = 12, speed = 5) {
    if (reducedMotion) {
      return;
    }
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU;
      const velocity = speed * (0.35 + Math.random() * 0.65);
      particles.push({
        x: x + 0.5,
        y: y + 0.5,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: 1,
        decay: 1 / (0.35 + Math.random() * 0.35),
        size: 0.08 + Math.random() * 0.1,
        color,
      });
    }
    if (particles.length > MAX_PARTICLES) {
      particles.splice(0, particles.length - MAX_PARTICLES);
    }
  }

  function popup(x, y, text, color, now) {
    if (reducedMotion) {
      return;
    }
    popups.push({ x: x + 0.5, y: y + 0.5, text, color, start: now, duration: 720 });
  }

  function flashBoard(color, now, duration = 320) {
    flash = { color, start: now, duration };
  }

  /**
   * Rendering trails the rules by one tick (the head is still sliding into
   * the cell it logically entered). Keep drawing an eaten item, shrinking, until
   * the head visually arrives, so food never vanishes before it is reached.
   */
  function swallow(x, y, kind, tick) {
    swallowed = { x, y, kind, tick };
  }

  // ---- frame --------------------------------------------------------------

  /**
   * @param {object} frame
   * @param {object} frame.state     current game state
   * @param {Array}  frame.prevSnake snake before the latest tick
   * @param {number} frame.alpha     0..1 progress towards the next tick
   * @param {number} frame.now       timestamp in ms
   * @param {number} frame.dt        seconds since the previous frame
   */
  function draw({ state, prevSnake, alpha, now, dt }) {
    if (!palette || !cssSize) {
      return;
    }

    const scale = canvas.width / grid;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(gridLayer, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const wrap = state.mode === MODES.wrap;
    if (swallowed && swallowed.tick !== state.tick) {
      swallowed = null;
    }
    if (swallowed) {
      const shrink = 1 - clamp01(alpha);
      if (swallowed.kind === 'bonus') {
        drawDiamond(swallowed.x + 0.5, swallowed.y + 0.5, 0.46 * shrink, 0);
      } else {
        drawFoodAt(swallowed.x, swallowed.y, shrink);
      }
    }
    if (state.food) {
      drawFood(state.food, now);
    }
    if (state.bonus) {
      drawBonus(state.bonus, now, alpha);
    }
    drawSnake(state, prevSnake, alpha, wrap);
    drawParticles(dt);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawPopups(now, scale);
    drawFlash(now);
  }

  function drawFood(food, now) {
    drawFoodAt(food.x, food.y, reducedMotion ? 1 : 1 + 0.08 * Math.sin(now / 150));
  }

  function drawFoodAt(x, y, pulse) {
    const cx = x + 0.5;
    const cy = y + 0.5;
    if (palette.glow > 0) {
      ctx.globalAlpha = 0.18 * palette.glow;
      ctx.fillStyle = palette.food;
      fillRoundRect(cx - 0.45 * pulse, cy - 0.45 * pulse, 0.9 * pulse, 0.9 * pulse, 0.3);
      ctx.globalAlpha = 1;
    }
    const size = 0.5 * pulse;
    ctx.fillStyle = palette.food;
    fillRoundRect(cx - size / 2, cy - size / 2, size, size, 0.08);
  }

  function drawBonus(bonus, now, alpha) {
    const remaining = Math.max(0, (bonus.ttl - alpha) / bonus.maxTtl);
    if (remaining < 0.3 && !reducedMotion && Math.floor(now / 110) % 2 === 0) {
      return; // blink when about to expire
    }
    const cx = bonus.x + 0.5;
    const cy = bonus.y + 0.5;
    drawDiamond(cx, cy, 0.46, reducedMotion ? 0 : now / 900);

    ctx.strokeStyle = palette.bonus;
    ctx.lineWidth = 0.06;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(cx, cy, 0.47, -Math.PI / 2, -Math.PI / 2 + TAU * remaining);
    ctx.stroke();
  }

  function drawDiamond(cx, cy, size, spin) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4 + spin);
    if (palette.glow > 0) {
      ctx.globalAlpha = 0.2 * palette.glow;
      ctx.fillStyle = palette.bonus;
      ctx.fillRect(-size * 0.9, -size * 0.9, size * 1.8, size * 1.8);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = palette.bonus;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }

  function drawSnake(state, prevSnake, alpha, wrap) {
    const snake = state.snake;
    const n = snake.length;
    if (n < 2) {
      return;
    }

    // Only interpolate when the snake really advanced one cell last tick.
    const moved = Array.isArray(prevSnake) && prevSnake !== snake && prevSnake.length > 0 && pointsEqual(prevSnake[0], snake[1]);
    const t = moved ? clamp01(alpha) : 1;

    segments.length = 0;
    const neck = snake[1];
    const d0 = wrapDelta(neck, snake[0], grid);
    const headX = neck.x + 0.5 + d0.x * t;
    const headY = neck.y + 0.5 + d0.y * t;
    segments.push(neck.x + 0.5, neck.y + 0.5, headX, headY);

    for (let i = 1; i < n - 1; i += 1) {
      const a = snake[i];
      const d = wrapDelta(a, snake[i + 1], grid);
      segments.push(a.x + 0.5, a.y + 0.5, a.x + 0.5 + d.x, a.y + 0.5 + d.y);
    }

    if (moved && prevSnake.length === n && t < 1) {
      // Tail is still sliding out of the cell it just left.
      const tail = snake[n - 1];
      const d = wrapDelta(tail, prevSnake[prevSnake.length - 1], grid);
      const k = 1 - t;
      segments.push(tail.x + 0.5, tail.y + 0.5, tail.x + 0.5 + d.x * k, tail.y + 0.5 + d.y * k);
    }

    const count = segments.length / 4;

    // Glow: one wide, faint stroke of the whole body.
    if (palette.glow > 0) {
      ctx.globalAlpha = 0.12 * palette.glow;
      ctx.strokeStyle = palette.snake;
      ctx.lineWidth = GLOW_WIDTH;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < count; i += 1) {
        addSegment(i, wrap);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Body: tail first so segments nearer the head sit on top.
    ctx.lineWidth = BODY_WIDTH;
    ctx.lineCap = 'square';
    for (let i = count - 1; i >= 0; i -= 1) {
      const shade = count > 1 ? Math.round((i / (count - 1)) * (GRADIENT_STEPS - 1)) : 0;
      ctx.strokeStyle = gradient[shade];
      ctx.beginPath();
      addSegment(i, wrap);
      ctx.stroke();
    }

    drawHead(headX, headY, state.direction, state.gameOver ? palette.danger : palette.head, wrap);
  }

  /** Add segment i (plus its wrapped copies when it crosses an edge) to the path. */
  function addSegment(i, wrap) {
    const ax = segments[i * 4];
    const ay = segments[i * 4 + 1];
    const bx = segments[i * 4 + 2];
    const by = segments[i * 4 + 3];
    line(ax, ay, bx, by, 0, 0);
    if (!wrap) {
      return;
    }
    const max = grid - 0.5 + EPSILON;
    const min = 0.5 - EPSILON;
    if (Math.max(ax, bx) > max) line(ax, ay, bx, by, -grid, 0);
    if (Math.min(ax, bx) < min) line(ax, ay, bx, by, grid, 0);
    if (Math.max(ay, by) > max) line(ax, ay, bx, by, 0, -grid);
    if (Math.min(ay, by) < min) line(ax, ay, bx, by, 0, grid);
  }

  function line(ax, ay, bx, by, ox, oy) {
    ctx.moveTo(ax + ox, ay + oy);
    ctx.lineTo(bx + ox, by + oy);
  }

  function drawHead(x, y, direction, color, wrap) {
    const copies = [[0, 0]];
    if (wrap) {
      if (x > grid - 0.5) copies.push([-grid, 0]);
      if (x < 0.5) copies.push([grid, 0]);
      if (y > grid - 0.5) copies.push([0, -grid]);
      if (y < 0.5) copies.push([0, grid]);
    }

    for (const [ox, oy] of copies) {
      const cx = x + ox;
      const cy = y + oy;
      ctx.fillStyle = color;
      fillRoundRect(cx - HEAD_SIZE / 2, cy - HEAD_SIZE / 2, HEAD_SIZE, HEAD_SIZE, 0.16);

      // Eyes look where the snake is heading.
      const fx = direction.x * 0.14;
      const fy = direction.y * 0.14;
      const px = -direction.y * 0.17;
      const py = direction.x * 0.17;
      ctx.fillStyle = palette.board;
      ctx.fillRect(cx + fx + px - 0.06, cy + fy + py - 0.06, 0.12, 0.12);
      ctx.fillRect(cx + fx - px - 0.06, cy + fy - py - 0.06, 0.12, 0.12);
    }
  }

  function drawParticles(dt) {
    if (particles.length === 0) {
      return;
    }
    const step = Math.min(dt, 0.05);
    const drag = Math.max(0, 1 - 3.2 * step);
    let alive = 0;
    for (const p of particles) {
      p.life -= p.decay * step;
      if (p.life <= 0) {
        continue;
      }
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.vx *= drag;
      p.vy *= drag;
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      particles[alive] = p;
      alive += 1;
    }
    particles.length = alive;
    ctx.globalAlpha = 1;
  }

  function drawPopups(now, scale) {
    if (popups.length === 0) {
      return;
    }
    const fontPx = Math.max(10 * dpr, Math.round(scale * 0.62));
    ctx.font = `700 ${fontPx}px ${palette.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let alive = 0;
    for (const p of popups) {
      const t = (now - p.start) / p.duration;
      if (t >= 1) {
        continue;
      }
      const eased = 1 - (1 - t) ** 3;
      const px = Math.min(Math.max(p.x * scale, fontPx * 1.6), canvas.width - fontPx * 1.6);
      const py = Math.max((p.y - 0.4 - eased * 1.1) * scale, fontPx * 0.6);
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, px, py);
      popups[alive] = p;
      alive += 1;
    }
    popups.length = alive;
    ctx.globalAlpha = 1;
  }

  function drawFlash(now) {
    if (!flash) {
      return;
    }
    const t = (now - flash.start) / flash.duration;
    if (t >= 1) {
      flash = null;
      return;
    }
    ctx.globalAlpha = 0.28 * (1 - t);
    ctx.fillStyle = flash.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }

  function fillRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.fill();
  }

  return {
    resize,
    setPalette,
    setReducedMotion,
    burst,
    popup,
    flashBoard,
    swallow,
    draw,
    get cellPx() {
      return cssSize / grid;
    },
  };
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function parseHex(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  const int = Number.parseInt(full, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function buildGradient(fromHex, toHex, steps) {
  const from = parseHex(fromHex);
  const to = parseHex(toHex);
  const colors = [];
  for (let i = 0; i < steps; i += 1) {
    const t = steps > 1 ? i / (steps - 1) : 0;
    const [r, g, b] = from.map((c, k) => Math.round(c + (to[k] - c) * t));
    colors.push(`rgb(${r}, ${g}, ${b})`);
  }
  return colors;
}
