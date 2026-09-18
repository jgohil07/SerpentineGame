/**
 * Responsive layout checks across desktop and touch viewports. For every
 * size: nothing overflows the viewport, regions never overlap, the board is
 * a whole number of cells and as large as the space allows, and every
 * overlay screen fits inside the board.
 */

import { describe, test, assert, equal, sleep, waitFor } from './harness.js';
import { GRID_SIZE } from '../src/snakeLogic.js';
import { openGame } from './e2e.test.js';

const VIEWPORTS = [
  { name: 'desktop 1920x1080', width: 1920, height: 1080, input: 'desktop', layout: 'stack' },
  { name: 'desktop 1440x900', width: 1440, height: 900, input: 'desktop', layout: 'stack' },
  { name: 'laptop 1280x720', width: 1280, height: 720, input: 'desktop', layout: 'side' },
  { name: 'desktop 1024x768', width: 1024, height: 768, input: 'desktop', layout: 'side' },
  { name: 'small window 800x600', width: 800, height: 600, input: 'desktop', layout: 'side' },
  { name: 'short window 1280x500', width: 1280, height: 500, input: 'desktop', layout: 'side' },
  { name: 'narrow window 480x800', width: 480, height: 800, input: 'desktop', layout: 'stack' },
  { name: 'iPhone 14 390x844', width: 390, height: 844, input: 'touch', layout: 'stack' },
  { name: 'iPhone SE 375x667', width: 375, height: 667, input: 'touch', layout: 'stack' },
  { name: 'small Android 360x640', width: 360, height: 640, input: 'touch', layout: 'stack' },
  { name: 'tiny phone 320x568', width: 320, height: 568, input: 'touch', layout: 'stack' },
  { name: 'phone landscape 844x390', width: 844, height: 390, input: 'touch', layout: 'side' },
  { name: 'iPhone SE landscape 667x375', width: 667, height: 375, input: 'touch', layout: 'side' },
  { name: 'iPad portrait 768x1024', width: 768, height: 1024, input: 'touch', layout: 'stack' },
  { name: 'iPad landscape 1024x768', width: 1024, height: 768, input: 'touch', layout: 'side' },
  { name: 'iPad Pro landscape 1366x1024', width: 1366, height: 1024, input: 'touch', layout: 'side' },
];

const TOLERANCE = 0.5;

function inside(inner, outer, tolerance = TOLERANCE) {
  return (
    inner.left >= outer.left - tolerance &&
    inner.top >= outer.top - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.bottom <= outer.bottom + tolerance
  );
}

function overlaps(a, b) {
  return a.left < b.right - TOLERANCE && b.left < a.right - TOLERANCE && a.top < b.bottom - TOLERANCE && b.top < a.bottom - TOLERANCE;
}

function grow(rect, by) {
  return { left: rect.left - by, top: rect.top - by, right: rect.right + by, bottom: rect.bottom + by };
}

function describeRect(r) {
  return `[${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}]`;
}

describe('layout: responsive viewports', () => {
  for (const vp of VIEWPORTS) {
    test(vp.name, async () => {
      const g = await openGame({ width: vp.width, height: vp.height, input: vp.input });
      try {
        await waitFor(() => g.doc.documentElement.dataset.layout === vp.layout, 1500, `expected ${vp.layout} layout`);
        await sleep(80); // let ResizeObserver settle
        const viewport = { left: 0, top: 0, right: vp.width, bottom: vp.height };
        const rect = (selector) => g.$(selector).getBoundingClientRect();
        const regions = {
          topbar: rect('.topbar'),
          hud: rect('.hud'),
          board: grow(rect('[data-board]'), 4), // include the mode outline
          footer: rect('.footer'),
        };

        const root = g.doc.documentElement;
        assert(root.scrollHeight <= vp.height + 1 && root.scrollWidth <= vp.width + 1, `page overflows: ${root.scrollWidth}x${root.scrollHeight}`);
        for (const [name, r] of Object.entries(regions)) {
          assert(inside(r, viewport), `${name} ${describeRect(r)} leaves the viewport`);
        }
        const names = Object.keys(regions);
        for (let i = 0; i < names.length; i += 1) {
          for (let j = i + 1; j < names.length; j += 1) {
            assert(!overlaps(regions[names[i]], regions[names[j]]), `${names[i]} overlaps ${names[j]}`);
          }
        }

        const size = g.api.boardSize;
        equal(size % GRID_SIZE, 0, 'whole cells');
        const shortSide = Math.min(vp.width, vp.height);
        const minimum = Math.min(36 * GRID_SIZE, shortSide * (vp.input === 'touch' && vp.layout === 'stack' ? 0.62 : 0.72));
        assert(size >= minimum - GRID_SIZE, `board ${size}px is too small for ${vp.width}x${vp.height} (want ≥ ${Math.round(minimum)})`);

        if (vp.input === 'touch') {
          assert(g.visible('[data-dpad]'), 'D-pad visible');
          assert(inside(rect('[data-dpad]'), viewport), 'D-pad inside viewport');
          assert(!overlaps(rect('[data-dpad]'), regions.board), 'D-pad clear of the board');
          assert(!g.visible('.keys'), 'keyboard legend hidden');
        } else {
          assert(g.visible('.keys'), 'keyboard legend visible');
          assert(!g.visible('[data-dpad]'), 'D-pad hidden');
        }

        for (const dd of g.doc.querySelectorAll('.stat dd')) {
          assert(dd.scrollWidth <= dd.clientWidth + 1, `HUD value "${dd.textContent}" is clipped`);
        }

        // Every overlay screen must fit inside the board.
        const board = rect('[data-board]');
        const checkScreen = (name) => {
          const screen = rect(`section[data-screen="${name}"]`);
          assert(inside(screen, board, 1), `${name} screen ${describeRect(screen)} spills out of board ${describeRect(board)}`);
        };
        checkScreen('ready');
        g.api.freeze(true);
        g.key(' ');
        g.key('p');
        checkScreen('paused');
        g.key('p');
        g.api.patch({
          score: 12340,
          snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }, { x: 7, y: 5 }],
          direction: { x: 0, y: -1 },
          queue: [{ x: 1, y: 0 }],
        });
        g.api.step();
        await waitFor(() => g.visible('[data-screen="over"]'), 2000, 'game-over screen');
        checkScreen('over');
        equal(g.errors, [], 'page errors');
      } finally {
        g.close();
      }
    });
  }
});
