/**
 * Minimal in-browser test harness (no dependencies, no build step).
 * Suites register with describe/test; run() executes them in order.
 */

const suites = [];
let currentSuite = null;

export function describe(name, register) {
  currentSuite = { name, tests: [] };
  suites.push(currentSuite);
  register();
  currentSuite = null;
}

export function test(name, fn) {
  if (!currentSuite) {
    throw new Error(`test "${name}" must be declared inside describe()`);
  }
  currentSuite.tests.push({ name, fn });
}

export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

export function assert(condition, message = 'assertion failed') {
  if (!condition) {
    throw new AssertionError(message);
  }
}

export function equal(actual, expected, message = 'values differ') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new AssertionError(`${message}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(check, timeoutMs = 3000, message = 'condition not met') {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = check();
    } catch {
      value = false;
    }
    if (value) {
      return value;
    }
    if (performance.now() > deadline) {
      throw new AssertionError(`${message} (after ${timeoutMs}ms)`);
    }
    await sleep(16);
  }
}

export async function run({ timeoutMs = 20000, filter = '', onResult } = {}) {
  const results = [];
  for (const suite of suites) {
    for (const t of suite.tests) {
      const fullName = `${suite.name} > ${t.name}`;
      if (filter && !fullName.toLowerCase().includes(filter.toLowerCase())) {
        continue;
      }
      const started = performance.now();
      let error = null;
      let timer = 0;
      try {
        await Promise.race([
          Promise.resolve().then(t.fn),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
          }),
        ]);
      } catch (caught) {
        error = caught;
      } finally {
        clearTimeout(timer);
      }
      const result = {
        suite: suite.name,
        name: t.name,
        ok: error === null,
        error: error ? String((error && error.stack) || error) : null,
        ms: Math.round(performance.now() - started),
      };
      results.push(result);
      if (onResult) {
        onResult(result);
      }
    }
  }
  return results;
}
