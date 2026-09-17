import { candidates, isBoard, isConsistent, LEVELS, PEERS, search } from './engine.js';

export const SAVE_VERSION = 1;
export const DEFAULT_SETTINGS = { theme: 'light', highlight: true, mistakes: true, cleanNotes: true, showTimer: true };
// Untrusted links and saves must not freeze the UI with an adversarial puzzle.
const VALIDATION_SEARCH_BUDGET = 50000;
const validCell = (index) => Number.isInteger(index) && index >= 0 && index < 81;
const validDate = (date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
export const puzzleId = (game) => `${game.mode === 'daily' ? `daily:${game.date}:` : 'classic:'}${game.initial.join('')}`;

export function createGame({ puzzle, solution, level }, mode = 'classic', date = null) {
  return { version: SAVE_VERSION, initial: [...puzzle], solution: [...solution], values: [...puzzle],
    notes: Array(81).fill(0), level, mode, date, history: [], future: [], elapsed: 0,
    mistakes: 0, hints: 0, completed: false, selected: puzzle.indexOf(0), noteMode: false };
}

function snapshot(game) { return { values: [...game.values], notes: [...game.notes] }; }
function commit(game, change) {
  const before = snapshot(game);
  change();
  if (JSON.stringify(before) === JSON.stringify(snapshot(game))) return false;
  game.history.push(before);
  if (game.history.length > 200) game.history.shift();
  game.future = [];
  game.completed = game.values.every((n, i) => n === game.solution[i]);
  return true;
}

export function enterDigit(game, index, value, settings = DEFAULT_SETTINGS, pencil = game.noteMode) {
  if (game.completed || !validCell(index) || game.initial[index] || !Number.isInteger(value) || value < 1 || value > 9) return false;
  if (pencil && game.values[index]) return false;
  if (!pencil && game.values[index] === value) return false;
  return commit(game, () => {
    if (pencil) game.notes[index] ^= 1 << value;
    else {
      game.values[index] = value;
      game.notes[index] = 0;
      if (settings.cleanNotes) for (const i of PEERS[index]) game.notes[i] &= ~(1 << value);
      if (value !== game.solution[index]) game.mistakes++;
    }
  });
}

export function eraseCell(game, index) {
  if (game.completed || !validCell(index) || game.initial[index]) return false;
  return commit(game, () => { game.values[index] = 0; game.notes[index] = 0; });
}

export function fillNotes(game) {
  if (game.completed) return false;
  return commit(game, () => { game.notes = candidates(game.values); });
}

export function undo(game) {
  if (!game.history.length || game.completed) return false;
  game.future.push(snapshot(game));
  Object.assign(game, game.history.pop());
  return true;
}

export function redo(game) {
  if (!game.future.length || game.completed) return false;
  game.history.push(snapshot(game));
  Object.assign(game, game.future.pop());
  game.completed = game.values.every((n, i) => n === game.solution[i]);
  return true;
}

export function applyHint(game, hint, settings) {
  if (!hint || !['clear', 'place'].includes(hint.type)) return false;
  const changed = hint.type === 'clear' ? eraseCell(game, hint.index) : enterDigit(game, hint.index, hint.value, settings, false);
  if (changed) game.hints++;
  return changed;
}

export function validateGame(data) {
  if (!data || data.version !== SAVE_VERSION || !isBoard(data.initial) || !isConsistent(data.initial) ||
    data.initial.filter(Boolean).length < 17 || !LEVELS.includes(data.level) || !['classic', 'daily'].includes(data.mode)) return null;
  if (data.mode === 'daily' && !validDate(data.date)) return null;
  const validSnapshot = (s) => s && isBoard(s.values) && Array.isArray(s.notes) && s.notes.length === 81 &&
    Array.from(s.notes).every((n, i) => Number.isInteger(n) && n >= 0 && n <= 1022 && !(n & 1) && (!s.values[i] || !n)) &&
    data.initial.every((n, i) => !n || n === s.values[i]);
  if (!validSnapshot(data) || !Array.isArray(data.history) || !Array.isArray(data.future) ||
    data.history.length > 200 || data.future.length > 200 || !Array.from(data.history).every(validSnapshot) || !Array.from(data.future).every(validSnapshot)) return null;
  if (!['elapsed', 'mistakes', 'hints'].every((k) => Number.isFinite(data[k]) && data[k] >= 0 && data[k] < 1e12) ||
    !['mistakes', 'hints'].every((k) => Number.isInteger(data[k]))) return null;
  const solved = search(data.initial, 2, null, VALIDATION_SEARCH_BUDGET);
  if (solved.count !== 1) return null;
  return { version: SAVE_VERSION, initial: [...data.initial], solution: solved.solution, values: [...data.values], notes: [...data.notes],
    history: data.history.map(snapshot), future: data.future.map(snapshot), level: data.level, mode: data.mode, date: data.mode === 'daily' ? data.date : null,
    elapsed: data.elapsed, mistakes: data.mistakes, hints: data.hints,
    completed: data.values.every((n, i) => n === solved.solution[i]),
    selected: Number.isInteger(data.selected) && data.selected >= 0 && data.selected < 81 ? data.selected : data.initial.indexOf(0),
    noteMode: Boolean(data.noteMode) };
}

export function validateSettings(data) {
  const settings = { ...DEFAULT_SETTINGS };
  if (!data || typeof data !== 'object') return settings;
  if (['dark', 'light'].includes(data.theme)) settings.theme = data.theme;
  for (const k of ['highlight', 'mistakes', 'cleanNotes', 'showTimer']) if (typeof data[k] === 'boolean') settings[k] = data[k];
  return settings;
}

export function emptyStats() { return { version: 1, wins: [], dailyDates: [] }; }
export function validateStats(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.wins) || !Array.isArray(data.dailyDates)) return emptyStats();
  const seen = new Set();
  const wins = data.wins.filter((w) => {
    if (!w || typeof w.id !== 'string' || !w.id.length || w.id.length >= 120 || seen.has(w.id) || !LEVELS.includes(w.level) ||
      !Number.isFinite(w.elapsed) || w.elapsed < 0 || w.elapsed >= 1e12 || !Number.isInteger(w.hints) || w.hints < 0 || w.hints >= 1e12 || !validDate(w.date)) return false;
    seen.add(w.id);
    return true;
  }).map(({ id, level, elapsed, hints, date }) => ({ id, level, elapsed, hints, date }));
  return { version: 1, wins, dailyDates: [...new Set(data.dailyDates.filter(validDate))].sort() };
}

export function recordWin(stats, game, today) {
  if (!game.completed || stats.wins.some((w) => w.id === puzzleId(game))) return false;
  stats.wins.push({ id: puzzleId(game), level: game.level, elapsed: game.elapsed, hints: game.hints, date: today });
  if (game.mode === 'daily' && game.date === today && !stats.dailyDates.includes(today)) stats.dailyDates.push(today);
  stats.dailyDates.sort();
  return true;
}

export function streaks(dates, today) {
  const unique = [...new Set(dates.filter((date) => validDate(date) && date <= today))].sort();
  let best = 0, run = 0, previous = null;
  for (const d of unique) {
    run = previous && Date.parse(d) - Date.parse(previous) === 86400000 ? run + 1 : 1;
    best = Math.max(best, run); previous = d;
  }
  const gap = previous ? (Date.parse(today) - Date.parse(previous)) / 86400000 : Infinity;
  return { best, current: gap === 0 || gap === 1 ? run : 0 };
}

export function parseShared(hash) {
  if (typeof hash !== 'string' || hash.length > 2048) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('puzzle');
  if (!code || !/^[0-9]{81}$/.test(code) || !code.includes('0') || [...code].filter((c) => c !== '0').length < 17) return null;
  const puzzle = [...code].map(Number), solved = search(puzzle, 2, null, VALIDATION_SEARCH_BUDGET);
  if (solved.count !== 1) return null;
  const level = LEVELS.includes(params.get('level')) ? params.get('level') : 'medium';
  return { puzzle, solution: solved.solution, level };
}
