/**
 * localStorage wrapper that never throws. Storage can be unavailable
 * (private browsing, blocked cookies, sandboxed iframes) and the game must
 * still run; settings then simply don't persist.
 */

const PREFIX = 'serpentine:';

export function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
