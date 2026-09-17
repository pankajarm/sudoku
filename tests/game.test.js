import test from 'node:test';
import assert from 'node:assert/strict';
import { PUZZLES } from '../src/puzzles.js';
import { FULL, PEERS, candidates, getHint, makePuzzle } from '../src/engine.js';
import {
  DEFAULT_SETTINGS, applyHint, createGame, emptyStats, enterDigit, eraseCell,
  fillNotes, parseShared, puzzleId, recordWin, redo, streaks, undo,
  validateGame, validateSettings, validateStats,
} from '../src/game.js';

const newGame = (mode = 'classic', date = null) => createGame(makePuzzle(PUZZLES, 'medium', 'game-tests'), mode, date);
const clone = (data) => JSON.parse(JSON.stringify(data));

test('digits and pencil marks cannot overwrite clues or accept malformed input', () => {
  const game = newGame(), original = clone(game), clue = game.initial.findIndex(Boolean), blank = game.initial.indexOf(0);
  assert.equal(enterDigit(game, clue, game.initial[clue] % 9 + 1), false);
  assert.equal(eraseCell(game, clue), false);
  for (const value of [0, 10, -1, 1.5, NaN, undefined, null, '1']) assert.equal(enterDigit(game, blank, value), false);
  for (const index of [-1, 81, 0.5, NaN, undefined, null, '0']) {
    assert.equal(enterDigit(game, index, 1), false);
    assert.equal(eraseCell(game, index), false);
  }
  assert.deepEqual(game, original);
  assert.equal(enterDigit(game, blank, 2, DEFAULT_SETTINGS, true), true);
  assert.equal(game.notes[blank], 1 << 2);
  assert.equal(game.values[blank], 0);
  assert.equal(enterDigit(game, blank, 2, DEFAULT_SETTINGS, true), true);
  assert.equal(game.notes[blank], 0);
  assert.equal(enterDigit(game, blank, game.solution[blank]), true);
  assert.equal(enterDigit(game, blank, 3, DEFAULT_SETTINGS, true), false);
});

test('placing digits cleans peer notes, keeps unrelated notes, and preserves the setting', () => {
  const game = newGame(), blank = game.initial.indexOf(0), value = game.solution[blank];
  fillNotes(game);
  const original = [...game.notes];
  enterDigit(game, blank, value);
  assert.equal(game.notes[blank], 0);
  for (let i = 0; i < 81; i++) {
    if (i === blank) continue;
    assert.equal(game.notes[i], PEERS[blank].includes(i) ? original[i] & ~(1 << value) : original[i]);
  }
  const manual = newGame();
  fillNotes(manual);
  const manualNotes = [...manual.notes];
  enterDigit(manual, blank, value, { ...DEFAULT_SETTINGS, cleanNotes: false });
  manualNotes[blank] = 0;
  assert.deepEqual(manual.notes, manualNotes);
});

test('undo and redo restore values and notes, count mistakes once, and clear stale redo', () => {
  const game = newGame(), index = game.initial.indexOf(0), wrong = game.solution[index] % 9 + 1;
  fillNotes(game);
  const before = { values: [...game.values], notes: [...game.notes] };
  enterDigit(game, index, wrong);
  assert.equal(game.mistakes, 1);
  assert.equal(enterDigit(game, index, wrong), false);
  assert.equal(game.mistakes, 1);
  assert.equal(undo(game), true);
  assert.deepEqual(game.values, before.values);
  assert.deepEqual(game.notes, before.notes);
  assert.equal(game.mistakes, 1, 'undo does not erase assistance history');
  assert.equal(redo(game), true);
  assert.equal(game.values[index], wrong);
  assert.equal(game.mistakes, 1);
  undo(game);
  enterDigit(game, index, game.solution[index]);
  assert.equal(game.future.length, 0);
  assert.equal(redo(game), false);
  assert.equal(eraseCell(game, index), true);
  assert.equal(game.values[index], 0);
  assert.equal(eraseCell(game, index), false);
});

test('history is bounded and snapshots do not share arrays with active state', () => {
  const game = newGame(), index = game.initial.indexOf(0);
  for (let n = 0; n < 210; n++) enterDigit(game, index, 1, DEFAULT_SETTINGS, true);
  assert.equal(game.history.length, 200);
  assert.notEqual(game.history[0].values, game.values);
  assert.notEqual(game.history[0].notes, game.notes);
  const savedSnapshot = game.history[0], snapshot = [...savedSnapshot.notes];
  enterDigit(game, index, 2, DEFAULT_SETTINGS, true);
  assert.deepEqual(savedSnapshot.notes, snapshot);
  assert.notDeepEqual(game.notes, snapshot);
});

test('fill notes uses legal candidates and hints count only applied moves', () => {
  const game = newGame();
  assert.equal(fillNotes(game), true);
  assert.deepEqual(game.notes, candidates(game.values));
  assert.equal(fillNotes(game), false);
  const hint = getHint(game.values, game.solution);
  assert.equal(game.hints, 0);
  assert.equal(applyHint(game, hint, DEFAULT_SETTINGS), true);
  assert.equal(game.hints, 1);
  assert.equal(applyHint(game, hint, DEFAULT_SETTINGS), false);
  assert.equal(applyHint(game, null), false);
  assert.equal(applyHint(game, { type: 'invalid' }), false);
  assert.equal(game.hints, 1);
  undo(game);
  assert.equal(game.hints, 1);
  const index = game.initial.indexOf(0);
  enterDigit(game, index, game.solution[index] % 9 + 1);
  assert.equal(applyHint(game, getHint(game.values, game.solution), DEFAULT_SETTINGS), true);
  assert.equal(game.values[index], 0);
  assert.equal(game.hints, 2);
});

test('completion requires the correct solution and locks editing after the final move', () => {
  const game = newGame();
  const blanks = game.values.map((n, i) => n ? -1 : i).filter((i) => i !== -1);
  const last = blanks.pop();
  for (const i of blanks) enterDigit(game, i, game.solution[i]);
  assert.equal(game.completed, false);
  enterDigit(game, last, game.solution[last] % 9 + 1);
  assert.equal(game.completed, false);
  enterDigit(game, last, game.solution[last]);
  assert.equal(game.completed, true);
  for (const action of [() => enterDigit(game, last, 1), () => eraseCell(game, last), () => fillNotes(game), () => undo(game), () => redo(game)]) assert.equal(action(), false);
});

test('saved games round trip, rebuild the solution, and discard untrusted snapshot fields', () => {
  const game = newGame('daily', '2026-09-17');
  fillNotes(game);
  enterDigit(game, game.selected, game.solution[game.selected]);
  undo(game);
  const saved = clone(game);
  saved.solution = Array(81).fill(9);
  saved.completed = true;
  saved.history[0].initial = Array(81).fill(0);
  saved.history[0].solution = Array(81).fill(1);
  saved.future[0].elapsed = -200;
  const restored = validateGame(saved);
  assert.ok(restored);
  assert.deepEqual(restored.solution, game.solution);
  assert.equal(restored.completed, false);
  assert.deepEqual(Object.keys(restored.history[0]).sort(), ['notes', 'values']);
  assert.deepEqual(Object.keys(restored.future[0]).sort(), ['notes', 'values']);
  assert.notEqual(restored.values, saved.values);
  assert.notEqual(restored.history[0].values, saved.history[0].values);
  assert.equal(redo(restored), true);
  assert.equal(restored.elapsed, 0);
  undo(restored);
  undo(restored);
  assert.deepEqual(restored.initial, game.initial);
  assert.deepEqual(restored.solution, game.solution);
});

test('malformed and malicious persisted state fails validation', () => {
  for (const value of [null, undefined, {}, [], '']) assert.equal(validateGame(value), null);
  const corruptions = [
    (g) => { g.version = 99; }, (g) => { g.initial = Array(81); },
    (g) => { g.initial = Array(81).fill(0); }, (g) => { g.level = 'bad'; },
    (g) => { g.mode = 'bad'; }, (g) => { g.values.pop(); },
    (g) => { g.values[g.initial.findIndex(Boolean)] = 0; },
    (g) => { g.values[g.selected] = 1.5; }, (g) => { g.notes = Array(81); },
    (g) => { g.notes[g.selected] = 1; }, (g) => { g.notes[g.selected] = FULL + 2; },
    (g) => { g.notes[g.initial.findIndex(Boolean)] = 2; },
    (g) => { g.history = Array(201).fill({ values: g.values, notes: g.notes }); },
    (g) => { g.history = [{ values: Array(81).fill(0), notes: g.notes }]; },
    (g) => { g.history = Array(1); }, (g) => { g.future = Array(1); },
    (g) => { g.future = null; }, (g) => { g.elapsed = Infinity; },
    (g) => { g.elapsed = -1; }, (g) => { g.mistakes = 0.5; },
    (g) => { g.hints = '1'; }, (g) => { g.hints = 1e12; },
    (g) => { g.mode = 'daily'; g.date = '2026-02-31'; },
    (g) => { g.mode = 'daily'; g.date = 'September 17'; },
  ];
  for (const corrupt of corruptions) {
    const game = newGame();
    corrupt(game);
    assert.equal(validateGame(game), null, corrupt.toString());
  }
  const recoverable = newGame();
  recoverable.selected = 'bad';
  recoverable.extra = 'discard this';
  assert.equal(validateGame(recoverable).selected, recoverable.initial.indexOf(0));
  assert.equal(validateGame(recoverable).extra, undefined);
});

test('settings validate known values and ignore corruption or unrelated fields', () => {
  assert.deepEqual(validateSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(validateSettings({ theme: 'neon', highlight: 'no', admin: true }), DEFAULT_SETTINGS);
  assert.deepEqual(validateSettings({ theme: 'dark', showTimer: false }), { ...DEFAULT_SETTINGS, theme: 'dark', showTimer: false });
});

test('shared links accept only valid uniquely solvable puzzles and safe difficulty names', () => {
  const game = newGame(), code = game.initial.join('');
  const result = parseShared(`#puzzle=${code}&level=hard`);
  assert.deepEqual(result.puzzle, game.initial);
  assert.deepEqual(result.solution, game.solution);
  assert.equal(result.level, 'hard');
  assert.equal(parseShared(`#puzzle=${code}&level=invalid`).level, 'medium');
  assert.equal(parseShared(`#puzzle=${game.solution.join('')}`), null, 'a completed grid is not a playable shared puzzle');
  const conflicting = [...game.initial];
  conflicting[0] = conflicting[1] = 1;
  for (const hash of [null, {}, '', '#puzzle=123', `#puzzle=${'0'.repeat(81)}`, `#puzzle=${'1'.repeat(81)}`, `#puzzle=${conflicting.join('')}`, `#puzzle=${'a'.repeat(81)}`, '#'.repeat(2049)]) assert.equal(parseShared(hash), null);
  const ambiguous = Array(81).fill(0);
  ambiguous.splice(0, 18, ...game.solution.slice(0, 18));
  assert.equal(parseShared(`#puzzle=${ambiguous.join('')}`), null);
});

test('adversarial shared puzzles and saved boards have a bounded validation cost', () => {
  const code = '000000357705000900000050000809070000000030000070000080001000004000000700000000009';
  assert.equal(parseShared(`#puzzle=${code}`), null);
  const game = newGame();
  game.initial = [...code].map(Number);
  game.values = [...game.initial];
  assert.equal(validateGame(game), null);
  // Every puzzle the app itself shares must stay well inside the same budget.
  for (const [level, puzzles] of Object.entries(PUZZLES)) {
    for (const puzzle of puzzles) assert.ok(parseShared(`#puzzle=${puzzle}&level=${level}`));
  }
});

test('stats record each puzzle only once and daily streaks only on the matching UTC day', () => {
  const stats = emptyStats(), game = newGame();
  assert.equal(recordWin(stats, game, '2026-09-17'), false);
  game.completed = true;
  game.elapsed = 95;
  assert.equal(recordWin(stats, game, '2026-09-17'), true);
  assert.equal(recordWin(stats, game, '2026-09-18'), false);
  assert.equal(stats.wins.length, 1);
  assert.equal(stats.wins[0].id, puzzleId(game));
  const daily = newGame('daily', '2026-09-17');
  daily.completed = true;
  assert.equal(recordWin(stats, daily, '2026-09-17'), true);
  assert.deepEqual(stats.dailyDates, ['2026-09-17']);
  const old = newGame('daily', '2026-09-16');
  old.completed = true;
  recordWin(stats, old, '2026-09-17');
  assert.deepEqual(stats.dailyDates, ['2026-09-17']);
  assert.notEqual(puzzleId(daily), puzzleId(game));
});

test('stats validation deduplicates records and drops malformed or unsafe fields', () => {
  const win = { id: 'classic:123', level: 'easy', elapsed: 100, hints: 0, date: '2026-09-17', unrelated: true };
  assert.deepEqual(validateStats(null), emptyStats());
  assert.deepEqual(validateStats({ version: 99, wins: [], dailyDates: [] }), emptyStats());
  const result = validateStats({ version: 1, wins: [win, win, null, { ...win, id: 'other', hints: -1 }, { ...win, id: 'invalid-date', date: '2026-02-31' }],
    dailyDates: ['2026-09-17', '2026-09-16', '2026-09-17', '2026-02-31', 'invalid'] });
  assert.equal(result.wins.length, 1);
  assert.equal(result.wins[0].unrelated, undefined);
  assert.deepEqual(result.dailyDates, ['2026-09-16', '2026-09-17']);
});

test('daily streaks handle duplicates, missed days, month boundaries, invalid and future dates', () => {
  assert.deepEqual(streaks([], '2026-09-17'), { current: 0, best: 0 });
  const dates = ['2026-09-01', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-04', '2026-09-05'];
  assert.deepEqual(streaks(dates, '2026-09-05'), { current: 2, best: 3 });
  assert.deepEqual(streaks(dates, '2026-09-06'), { current: 2, best: 3 });
  assert.deepEqual(streaks(dates, '2026-09-07'), { current: 0, best: 3 });
  assert.deepEqual(streaks([...dates, '2027-01-01', 'invalid'], '2026-09-06'), { current: 2, best: 3 });
  assert.deepEqual(streaks(['2024-02-28', '2024-02-29', '2024-03-01'], '2024-03-01'), { current: 3, best: 3 });
});
