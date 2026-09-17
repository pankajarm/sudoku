import test from 'node:test';
import assert from 'node:assert/strict';
import { PUZZLES } from '../src/puzzles.js';
import { FULL, LEVELS, PEERS, candidates, dateKey, dailyLevel, getHint, isBoard, makePuzzle, seededRandom } from '../src/engine.js';
import {
  DEFAULT_SETTINGS, applyHint, createGame, emptyStats, enterDigit, eraseCell,
  fillNotes, moveSelection, parseShared, puzzleId, recordWin, redo, streaks, undo,
  validateGame, validateSettings, validateStats,
} from '../src/game.js';

const newGame = (mode = 'classic', date = null) => createGame(makePuzzle(PUZZLES, 'medium', 'game-tests'), mode, date);
const clone = (data) => JSON.parse(JSON.stringify(data));
const complete = (game) => { game.values = [...game.solution]; game.notes.fill(0); game.completed = true; return game; };

test('arrow navigation preserves row or column and clamps independently at every edge', () => {
  for (let i = 0; i < 81; i++) {
    const row = Math.floor(i / 9), column = i % 9;
    assert.equal(moveSelection(i, 'ArrowLeft'), column === 0 ? i : i - 1);
    assert.equal(moveSelection(i, 'ArrowRight'), column === 8 ? i : i + 1);
    assert.equal(moveSelection(i, 'ArrowUp'), row === 0 ? i : i - 9);
    assert.equal(moveSelection(i, 'ArrowDown'), row === 8 ? i : i + 9);
    assert.equal(moveSelection(i, 'Other'), i);
  }
  assert.equal(moveSelection(4, 'ArrowUp'), 4);
  assert.equal(moveSelection(76, 'ArrowDown'), 76);
  assert.equal(moveSelection(9, 'ArrowLeft'), 9);
  assert.equal(moveSelection(8, 'ArrowRight'), 8);
  assert.equal(moveSelection(-1, 'ArrowLeft'), 0);
  assert.equal(moveSelection(undefined, 'ArrowUp'), 0);
});

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
    (g) => { g.history = Array(200).fill({ values: g.values, notes: g.notes }); g.future = [{ values: g.values, notes: g.notes }]; },
    (g) => { g.history = [{ values: Array(81).fill(0), notes: g.notes }]; },
    (g) => { g.history = Array(1); }, (g) => { g.future = Array(1); },
    (g) => { g.future = null; }, (g) => { g.elapsed = Infinity; },
    (g) => { g.elapsed = -1; }, (g) => { g.mistakes = 0.5; },
    (g) => { g.hints = '1'; }, (g) => { g.hints = 1e12; },
    (g) => { g.mode = 'daily'; g.date = '2026-02-31'; },
    (g) => { g.mode = 'daily'; g.date = 'September 17'; },
    (g) => { g.initial = [...g.solution]; g.values = [...g.solution]; },
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

test('shared links accept only valid uniquely solvable puzzles and derive their difficulty', () => {
  const game = newGame(), code = game.initial.join('');
  const result = parseShared(`#puzzle=${code}&level=hard`);
  assert.deepEqual(result.puzzle, game.initial);
  assert.deepEqual(result.solution, game.solution);
  assert.equal(result.level, 'medium');
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
    for (const puzzle of puzzles) assert.equal(parseShared(`#puzzle=${puzzle}&level=expert`).level, level);
  }
});

test('stats record each puzzle only once and daily streaks only on the matching UTC day', () => {
  const stats = emptyStats(), game = newGame();
  assert.equal(recordWin(stats, game, '2026-09-17'), false);
  complete(game);
  game.elapsed = 95;
  assert.equal(recordWin(stats, game, '2026-09-17'), true);
  assert.equal(recordWin(stats, game, '2026-09-18'), false);
  assert.equal(stats.wins.length, 1);
  assert.equal(stats.wins[0].id, puzzleId(game));
  const daily = newGame('daily', '2026-09-17');
  complete(daily);
  assert.equal(recordWin(stats, daily, '2026-09-17'), true);
  assert.deepEqual(stats.dailyDates, ['2026-09-17']);
  const old = newGame('daily', '2026-09-16');
  complete(old);
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

test('restoring a game recomputes forged difficulty and uses strict boolean note mode', () => {
  for (const level of LEVELS) {
    const game = createGame(makePuzzle(PUZZLES, level, `restored-rating-${level}`));
    game.level = level === 'easy' ? 'expert' : 'easy';
    assert.equal(validateGame(game).level, level);
    for (const noteMode of ['false', 'true', 1, [], {}, null, undefined]) {
      game.noteMode = noteMode;
      assert.equal(validateGame(game).noteMode, false);
    }
    game.noteMode = true;
    assert.equal(validateGame(game).noteMode, true);
  }
});

test('completed saves recover completion from the solution while incorrect full boards stay playable', () => {
  const game = complete(newGame());
  game.completed = false;
  const completed = validateGame(clone(game));
  assert.equal(completed.completed, true);
  assert.equal(enterDigit(completed, completed.selected, 1), false);
  const wrong = clone(game), blank = wrong.initial.indexOf(0);
  wrong.values[blank] = wrong.solution[blank] % 9 + 1;
  wrong.completed = true;
  const restored = validateGame(wrong);
  assert.equal(restored.completed, false);
  assert.equal(enterDigit(restored, blank, restored.solution[blank]), true);
  assert.equal(restored.completed, true);
});

test('seeded mixed edit sessions preserve clues, reversible states, and serializable saves', () => {
  const random = seededRandom('mixed-game-actions-v1');
  for (const level of LEVELS) {
    let game = createGame(makePuzzle(PUZZLES, level, `fuzz-game-${level}`));
    for (let move = 0; move < 600; move++) {
      const index = Math.floor(random() * 81), value = Math.floor(random() * 9) + 1;
      const before = { values: [...game.values], notes: [...game.notes] };
      const previousMistakes = game.mistakes, previousHints = game.hints;
      const operation = Math.floor(random() * 8);
      if (operation < 3) enterDigit(game, index, value, { ...DEFAULT_SETTINGS, cleanNotes: random() > 0.5 }, operation === 2);
      else if (operation === 3) eraseCell(game, index);
      else if (operation === 4) undo(game);
      else if (operation === 5) redo(game);
      else if (operation === 6) fillNotes(game);
      else {
        const changed = enterDigit(game, index, value, DEFAULT_SETTINGS, true);
        if (changed) {
          assert.equal(undo(game), true);
          assert.deepEqual({ values: game.values, notes: game.notes }, before);
          assert.equal(redo(game), true);
        }
      }
      assert.equal(isBoard(game.values), true);
      assert.ok(game.initial.every((n, i) => !n || n === game.values[i]), 'clues must remain immutable');
      assert.ok(game.notes.every((n, i) => Number.isInteger(n) && !(n & ~FULL) && (!game.values[i] || !n)));
      assert.ok(game.history.length + game.future.length <= 200);
      assert.ok(game.mistakes >= previousMistakes && game.hints >= previousHints);
      if (move % 40 === 0) {
        const restored = validateGame(clone(game));
        assert.deepEqual(restored, game, `save round trip after ${level} move ${move}`);
        game = restored;
      }
    }
    // The complete undo/redo sequence must also survive a JSON save boundary.
    const restored = validateGame(clone(game));
    while (game.history.length) { assert.equal(undo(game), undo(restored)); assert.deepEqual(restored, game); }
    while (game.future.length) { assert.equal(redo(game), redo(restored)); assert.deepEqual(restored, game); }
  }
});

test('UTC daily puzzles survive year and leap-day rollovers without transferring progress or wins', () => {
  const dates = ['2023-12-31', '2024-01-01', '2024-02-28', '2024-02-29', '2024-03-01'];
  const stats = emptyStats();
  for (const date of dates) {
    const puzzle = makePuzzle(PUZZLES, dailyLevel(date), `daily:${date}:v1`);
    const saved = createGame(puzzle, 'daily', date);
    const index = saved.selected;
    enterDigit(saved, index, saved.solution[index]);
    saved.elapsed = 12345;
    const tomorrow = dateKey(new Date(Date.parse(`${date}T00:00:00Z`) + 86400000));
    const next = createGame(makePuzzle(PUZZLES, dailyLevel(tomorrow), `daily:${tomorrow}:v1`), 'daily', tomorrow);
    assert.notEqual(puzzleId(saved), puzzleId(next));
    assert.equal(next.elapsed, 0);
    assert.equal(next.history.length, 0);
    assert.deepEqual(validateGame(clone(saved)), saved);
    assert.equal(recordWin(stats, complete(saved), tomorrow), true, 'late completions still count as solved puzzles');
    assert.ok(!stats.dailyDates.includes(date), 'a late completion must not extend a past daily streak');
    assert.equal(recordWin(stats, saved, tomorrow), false, 'restored completion must not count again');
  }
  assert.equal(stats.wins.length, dates.length);
  assert.deepEqual(stats.dailyDates, []);
});

test('replay completions count once and an incomplete or malformed game cannot create a win', () => {
  const stats = emptyStats(), original = complete(newGame());
  original.elapsed = 45000;
  assert.equal(recordWin(stats, original, '2026-09-17'), true);
  const replay = complete(newGame());
  replay.elapsed = 10000;
  replay.hints = 2;
  assert.equal(recordWin(stats, replay, '2026-09-18'), false);
  assert.equal(stats.wins.length, 1);
  assert.equal(stats.wins[0].elapsed, 45000);
  const incomplete = newGame('daily', '2026-09-17');
  incomplete.completed = true;
  assert.equal(recordWin(stats, incomplete, '2026-09-17'), false);
  for (const malformed of [null, {}, { completed: true }, { completed: true, solution: Array(81).fill(0), values: Array(81).fill(0) }]) {
    assert.equal(recordWin(stats, malformed, '2026-09-17'), false);
  }
  assert.equal(recordWin(stats, complete(newGame('daily', '2026-09-17')), '2026-02-31'), false);
});

test('validators tolerate seeded malformed JSON payloads and return only usable data', () => {
  const random = seededRandom('malformed-json-v1');
  const junk = [null, false, 0, 1.25, '', 'false', [], {}, [null], { version: 1 }];
  const keys = ['initial', 'solution', 'values', 'notes', 'history', 'future', 'elapsed', 'mistakes', 'hints', 'date', 'mode', 'level', 'version', 'selected', 'noteMode'];
  for (let n = 0; n < 200; n++) {
    const payload = clone(newGame());
    const key = keys[Math.floor(random() * keys.length)];
    payload[key] = clone(junk[Math.floor(random() * junk.length)]);
    const restored = validateGame(payload);
    if (restored) {
      assert.ok(isBoard(restored.values));
      assert.equal(restored.initial.length, 81);
      assert.ok(restored.history.length + restored.future.length <= 200);
      assert.equal(typeof restored.noteMode, 'boolean');
      assert.deepEqual(validateGame(clone(restored)), restored);
    }
    assert.ok(validateStats(payload));
    assert.ok(validateSettings(payload));
  }
});
