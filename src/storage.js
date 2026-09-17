import { validateStats } from './game.js';

// Each instance remembers the exact revision it last loaded or saved per key.
// A caller must explicitly load a conflicting revision before replacing it.
export function createStore(backend, prefix = 'sudoku:v1:') {
  const revisions = new Map();
  let available = true, recovered = false;

  function readRaw(key) {
    const raw = backend.getItem(prefix + key);
    return raw ?? null;
  }

  return {
    get available() { return available; },
    get recovered() { return recovered; },

    load(key) {
      let raw;
      try {
        raw = readRaw(key);
        revisions.set(key, raw);
        available = true;
      } catch {
        available = false;
        return null;
      }
      if (raw === null) return null;
      try { return JSON.parse(raw); }
      catch {
        // Remembering the corrupt revision permits recovery without overwriting
        // another tab that repairs or replaces it in the meantime.
        recovered = true;
        return null;
      }
    },

    hasChanged(key) {
      try {
        const changed = readRaw(key) !== (revisions.get(key) ?? null);
        available = true;
        return changed;
      } catch {
        available = false;
        return false;
      }
    },

    save(key, value) {
      try {
        const raw = JSON.stringify(value);
        // Undefined/functions/symbols do not serialize into a JSON document.
        if (raw === undefined) { available = false; return 'unavailable'; }
        const latest = readRaw(key), expected = revisions.get(key) ?? null;
        available = true;
        if (latest !== expected) return 'conflict';
        if (raw !== latest) backend.setItem(prefix + key, raw);
        revisions.set(key, raw);
        return 'saved';
      } catch {
        available = false;
        return 'unavailable';
      }
    },
  };
}

// Keep the already-persisted first completion when the same puzzle appears in
// both tabs. Daily dates merge independently, so neither tab loses a streak day.
export function mergeStats(local, remote) {
  const first = validateStats(remote), second = validateStats(local);
  return validateStats({ version: 1, wins: [...first.wins, ...second.wins],
    dailyDates: [...first.dailyDates, ...second.dailyDates] });
}
