import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';
import { PUZZLES } from '../src/puzzles.js';
import { dailyLevel, dateKey, makePuzzle } from '../src/engine.js';
import { createGame, DEFAULT_SETTINGS, enterDigit, undo } from '../src/game.js';

const fixture = (seed = 'app-integration') => createGame(makePuzzle(PUZZLES, 'medium', seed));
async function app(t, game = fixture(), options = {}) {
  const harness = await loadApp({ classic: game, active: 'classic', settings: DEFAULT_SETTINGS }, options);
  t.after(harness.dispose); return harness;
}

test('actual app remains playable when browser storage is blocked', { concurrency: false }, async (t) => {
  const h = await app(t, fixture(), { blockedStorage: true });
  assert.equal(h.cells().length, 81);
  assert.match(h.element('save-status').textContent, /Storage unavailable/);
  const cell = h.cells().find((element) => element.getAttribute('aria-selected') === 'true');
  assert.match(cell.getAttribute('aria-label'), /empty/);
  h.key('1');
  assert.equal(cell.querySelector('.cell-value').textContent, '1');
  h.click('notes-btn');
  assert.equal(h.element('notes-btn').getAttribute('aria-pressed'), 'true');
  h.click('pause-btn');
  assert.equal(h.element('board').hidden, true);
  h.click('resume-btn');
  assert.equal(h.element('board').hidden, false);
});

test('actual app counts visible play but excludes paused, hidden, and dialog time', { concurrency: false }, async (t) => {
  const h = await app(t);
  h.advance(2000);
  assert.equal(h.element('timer').textContent, '00:02');
  h.click('pause-btn'); h.advance(10000); h.click('resume-btn');
  assert.equal(h.element('timer').textContent, '00:02');
  h.advance(1000);
  h.visibility(true); h.advance(30000, false); h.visibility(false);
  h.advance(1000);
  assert.equal(h.element('timer').textContent, '00:04');
  h.click('nav-help');
  assert.equal(h.element('modal').open, true);
  h.advance(15000);
  assert.equal(h.element('timer').textContent, '00:04');
  h.click('close-modal-btn'); h.advance(1000);
  assert.equal(h.element('timer').textContent, '00:05');
  h.dispatch('pagehide');
  assert.equal(h.saved('classic').elapsed, 5000);
});

test('remote completion reveals a paused board and keeps its recorded completion time', { concurrency: false }, async (t) => {
  const h = await app(t);
  h.advance(12000); h.click('pause-btn');
  assert.equal(h.element('board').hidden, true);
  const remote = h.saved('classic');
  remote.values = [...remote.solution]; remote.notes.fill(0); remote.completed = true; remote.elapsed = 4321;
  h.remote('classic', remote);
  assert.equal(h.element('board').hidden, false);
  assert.equal(h.element('pause-overlay').hidden, true);
  assert.equal(h.element('progress-label').textContent, 'Puzzle complete');
  assert.equal(h.element('timer').textContent, '00:04');
  h.advance(5000);
  assert.equal(h.saved('classic').elapsed, 4321);
  assert.ok(h.cells().every((cell) => cell.getAttribute('aria-readonly') === 'true'));
});

test('new-game confirmation cannot overwrite a newer game discovered during its save', { concurrency: false }, async (t) => {
  const original = fixture();
  enterDigit(original, original.selected, original.solution[original.selected]);
  const h = await app(t, original);
  h.click('new-game-btn');
  h.click(h.element('modal-body').querySelector('.difficulty-option'));
  assert.equal(h.element('modal-title').textContent, 'Start a new puzzle?');
  const confirm = h.button('Start new puzzle');
  assert.ok(confirm);
  const remote = fixture('newer-other-tab');
  enterDigit(remote, remote.selected, remote.solution[remote.selected]);
  h.remote('classic', remote, false); // Remote write arrives before its storage event.
  h.click(confirm);
  assert.deepEqual(h.saved('classic').initial, remote.initial);
  assert.deepEqual(h.saved('classic').values, remote.values);
  assert.equal(h.element('modal').open, false);
  assert.match(h.element('toast').textContent, /another tab|newer/i);
});

test('an open settings dialog follows preferences updated by another tab', { concurrency: false }, async (t) => {
  const h = await app(t);
  h.click('settings-btn');
  assert.equal(h.checkbox('Show timer').checked, true);
  h.remote('settings', { ...DEFAULT_SETTINGS, theme: 'dark', showTimer: false, highlight: false });
  assert.equal(h.element('modal').open, true);
  assert.equal(h.checkbox('Show timer').checked, false);
  assert.equal(h.checkbox('Highlight related cells').checked, false);
  assert.equal(h.element('timer').textContent, '—');
  h.change(h.checkbox('Show mistakes'), false);
  assert.deepEqual(h.saved('settings'), { ...DEFAULT_SETTINGS, theme: 'dark', showTimer: false, highlight: false, mistakes: false });
});

test('keyboard navigation clamps each grid edge and keeps selection and erase state synchronized', { concurrency: false }, async (t) => {
  const h = await app(t), cells = h.cells();
  for (const [index, key, expected] of [[4, 'ArrowUp', 4], [76, 'ArrowDown', 76], [9, 'ArrowLeft', 9], [8, 'ArrowRight', 8], [40, 'ArrowRight', 41]]) {
    h.click(cells[index]); h.key(key);
    assert.equal(h.saved('classic').selected, expected);
    assert.equal(cells[expected].getAttribute('aria-selected'), 'true');
    assert.equal(h.document.activeElement, cells[expected]);
  }
  const game = h.saved('classic'), clue = game.initial.findIndex(Boolean), empty = game.initial.indexOf(0);
  h.click(cells[clue]); assert.equal(h.element('erase-btn').disabled, true);
  h.click(cells[empty]); assert.equal(h.element('erase-btn').disabled, false);
});

test('a stale hint action cannot place a digit into a replacement puzzle', { concurrency: false }, async (t) => {
  const h = await app(t);
  h.click('hint-btn');
  assert.equal(h.element('modal').open, true);
  assert.equal(h.saved('classic').hints, 1);
  const apply = h.element('modal-actions').querySelector('.primary-btn');
  const remote = fixture('replacement-during-hint');
  h.remote('classic', remote, false);
  h.click(apply);
  assert.equal(h.element('modal').open, false);
  assert.deepEqual(h.saved('classic').initial, remote.initial);
  assert.deepEqual(h.saved('classic').values, remote.values);
  assert.equal(h.saved('classic').hints, 0);
});

test('switching classic and daily retains separate boards, progress, and play time', { concurrency: false }, async (t) => {
  const original = fixture(), h = await app(t, original);
  h.key(String(original.solution[original.selected]));
  h.advance(1500);
  h.click('nav-daily');
  assert.equal(h.saved('classic').elapsed, 1500);
  assert.equal(h.saved('active'), 'daily');
  const daily = h.saved('daily');
  assert.equal(daily.elapsed, 0);
  h.key(String(daily.solution[daily.selected]));
  h.advance(2000);
  h.click('nav-classic');
  assert.equal(h.saved('active'), 'classic');
  assert.equal(h.saved('daily').elapsed, 2000);
  assert.equal(h.saved('daily').values[daily.selected], daily.solution[daily.selected]);
  assert.equal(h.saved('classic').values[original.selected], original.solution[original.selected]);
  assert.equal(h.element('timer').textContent, '00:01');
  h.advance(500); h.dispatch('pagehide');
  assert.equal(h.saved('classic').elapsed, 2000);
  assert.equal(h.saved('daily').elapsed, 2000);
});

test('the final correct input saves one completion and stops the clock', { concurrency: false }, async (t) => {
  const game = fixture(), last = game.initial.indexOf(0);
  game.values = [...game.solution]; game.values[last] = 0; game.selected = last;
  const h = await app(t, game);
  h.advance(2500); h.key(String(game.solution[last]));
  assert.equal(h.element('modal-title').textContent, 'Nicely done.');
  assert.equal(h.saved('classic').completed, true);
  assert.equal(h.saved('stats').wins.length, 1);
  assert.equal(h.saved('stats').wins[0].elapsed, 2500);
  h.click('close-modal-btn'); h.advance(10000);
  assert.equal(h.saved('classic').elapsed, 2500);
  assert.equal(h.saved('stats').wins.length, 1);
  assert.equal(h.element('hint-btn').disabled, true);
});

function previousDaily() {
  const date = dateKey(new Date(Date.now() - 86400000));
  return createGame(makePuzzle(PUZZLES, dailyLevel(date), `daily:${date}:v1`), 'daily', date);
}

test('unfinished previous-day daily progress survives reload until replacement is explicitly confirmed', { concurrency: false }, async (t) => {
  const daily = previousDaily();
  enterDigit(daily, daily.selected, daily.solution[daily.selected]);
  daily.elapsed = 12345;
  const h = await loadApp({ classic: fixture(), daily, active: 'daily', settings: DEFAULT_SETTINGS });
  t.after(h.dispose);
  assert.equal(h.saved('daily').date, daily.date);
  assert.deepEqual(h.saved('daily').values, daily.values);
  assert.equal(h.saved('daily').elapsed, 12345);
  assert.match(h.element('mode-label').textContent, new RegExp(daily.date));
  h.click('nav-daily');
  assert.equal(h.element('modal-title').textContent, 'Start today’s challenge?');
  assert.deepEqual(h.saved('daily').values, daily.values);
  h.click(h.button('Keep my puzzle'));
  assert.equal(h.element('modal').open, false);
  assert.equal(h.saved('daily').date, daily.date);
  assert.deepEqual(h.saved('daily').history, daily.history);
  h.click('nav-daily');
  h.click(h.button('Play today’s puzzle'));
  const today = dateKey(), current = h.saved('daily');
  assert.equal(current.date, today);
  assert.deepEqual(current.initial, makePuzzle(PUZZLES, dailyLevel(today), `daily:${today}:v1`).puzzle);
  assert.deepEqual(current.values, current.initial);
  assert.equal(current.elapsed, 0);
  assert.equal(current.history.length, 0);
  assert.equal(h.saved('active'), 'daily');
  assert.match(h.element('mode-label').textContent, new RegExp(today));
});

test('a previous-day daily with only redo history also survives reload and asks before replacement', { concurrency: false }, async (t) => {
  const daily = previousDaily();
  enterDigit(daily, daily.selected, daily.solution[daily.selected]); undo(daily);
  assert.equal(daily.history.length, 0);
  assert.equal(daily.future.length, 1);
  const h = await loadApp({ daily, active: 'daily', settings: DEFAULT_SETTINGS });
  t.after(h.dispose);
  assert.equal(h.saved('daily').date, daily.date);
  assert.deepEqual(h.saved('daily').future, daily.future);
  h.click('nav-daily');
  assert.equal(h.element('modal-title').textContent, 'Start today’s challenge?');
});

for (const state of ['complete', 'untouched']) {
  test(`${state === 'untouched' ? 'an' : 'a'} ${state} previous-day daily opens today's challenge on reload`, { concurrency: false }, async (t) => {
    const daily = previousDaily();
    if (state === 'complete') {
      daily.values = [...daily.solution]; daily.completed = true;
    }
    const h = await loadApp({ daily, active: 'daily', settings: DEFAULT_SETTINGS });
    t.after(h.dispose);
    const today = dateKey();
    assert.equal(h.saved('daily').date, today);
    assert.equal(h.saved('daily').completed, false);
    assert.equal(h.saved('daily').history.length, 0);
    assert.deepEqual(h.saved('daily').values, h.saved('daily').initial);
    assert.match(h.element('mode-label').textContent, new RegExp(today));
    h.click('nav-daily');
    assert.equal(h.element('modal').open, false);
    assert.equal(h.saved('daily').date, today);
  });
}

test('classic redo-only progress requires confirmation for new games and difficulty changes', { concurrency: false }, async (t) => {
  const game = fixture();
  enterDigit(game, game.selected, game.solution[game.selected]); undo(game);
  const h = await app(t, game);
  h.click('new-game-btn');
  h.click(h.element('modal-body').querySelector('.difficulty-option'));
  assert.equal(h.element('modal-title').textContent, 'Start a new puzzle?');
  assert.deepEqual(h.saved('classic').future, game.future);
  h.click(h.button('Keep playing'));
  assert.deepEqual(h.saved('classic').initial, game.initial);
  assert.deepEqual(h.saved('classic').future, game.future);
  const difficulty = h.element('difficulty');
  difficulty.value = 'hard'; difficulty.emit('change');
  assert.equal(h.element('modal-title').textContent, 'Start a new puzzle?');
  assert.deepEqual(h.saved('classic').future, game.future);
  h.click(h.button('Start new puzzle'));
  assert.equal(h.saved('classic').level, 'hard');
  assert.equal(h.saved('classic').future.length, 0);
  assert.notDeepEqual(h.saved('classic').initial, game.initial);
});

test('shared import protects redo-only classic progress while playing daily', { concurrency: false }, async (t) => {
  const game = fixture();
  enterDigit(game, game.selected, game.solution[game.selected]); undo(game);
  const h = await app(t, game), shared = fixture('shared-redo-confirmation');
  h.click('nav-daily');
  const importLink = () => {
    globalThis.location.hash = new URLSearchParams({ puzzle: shared.initial.join(''), level: shared.level }).toString();
    h.dispatch('hashchange');
  };
  importLink();
  assert.equal(h.element('modal-title').textContent, 'Open the shared puzzle?');
  assert.deepEqual(h.saved('classic').future, game.future);
  h.click(h.button('Keep my puzzle'));
  assert.equal(h.saved('active'), 'daily');
  assert.deepEqual(h.saved('classic').initial, game.initial);
  assert.deepEqual(h.saved('classic').future, game.future);
  importLink(); h.click(h.button('Open puzzle'));
  assert.equal(h.saved('active'), 'classic');
  assert.deepEqual(h.saved('classic').initial, shared.initial);
  assert.equal(h.saved('classic').future.length, 0);
});
