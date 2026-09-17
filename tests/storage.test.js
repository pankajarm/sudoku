import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, mergeStats } from '../src/storage.js';

function memoryBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data, writes: 0,
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { this.writes++; data.set(key, value); },
  };
}

test('the store loads JSON, saves revisions, and avoids unchanged writes', () => {
  const backend = memoryBackend(), store = createStore(backend);
  assert.equal(store.available, true);
  assert.equal(store.recovered, false);
  assert.equal(store.load('classic'), null);
  assert.equal(store.save('classic', { move: 1 }), 'saved');
  assert.equal(backend.data.get('sudoku:v1:classic'), '{"move":1}');
  assert.equal(store.hasChanged('classic'), false);
  assert.deepEqual(store.load('classic'), { move: 1 });
  assert.equal(store.save('classic', { move: 1 }), 'saved');
  assert.equal(backend.writes, 1);
  assert.equal(store.save('classic', { move: 2 }), 'saved');
  assert.equal(backend.writes, 2);
});

test('two tabs cannot overwrite a loaded revision after another tab changes it', () => {
  const backend = memoryBackend({ 'sudoku:v1:classic': '{"move":1}' });
  const first = createStore(backend), second = createStore(backend);
  assert.deepEqual(first.load('classic'), { move: 1 });
  assert.deepEqual(second.load('classic'), { move: 1 });
  assert.equal(first.save('classic', { move: 2 }), 'saved');
  assert.equal(second.hasChanged('classic'), true);
  assert.equal(second.hasChanged('classic'), true, 'checking a conflict must not acknowledge the new revision');
  assert.equal(second.save('classic', { move: 3 }), 'conflict');
  assert.equal(second.save('classic', { move: 2 }), 'conflict', 'even identical desired data must not silently acknowledge a conflict');
  assert.equal(backend.writes, 1);
  assert.deepEqual(second.load('classic'), { move: 2 });
  assert.equal(second.save('classic', { move: 3 }), 'saved');
  assert.equal(first.hasChanged('classic'), true);
  assert.equal(first.save('classic', { move: 4 }), 'conflict');
});

test('an unloaded key expects absence and never overwrites existing data', () => {
  const backend = memoryBackend({ 'custom:existing': '{"kept":true}' });
  const store = createStore(backend, 'custom:');
  assert.equal(store.hasChanged('existing'), true);
  assert.equal(store.save('existing', { replacement: true }), 'conflict');
  assert.equal(backend.data.get('custom:existing'), '{"kept":true}');
  assert.equal(store.save('new', { created: true }), 'saved');
  assert.equal(backend.data.get('custom:new'), '{"created":true}');
});

test('different game modes and keys have independent optimistic revisions', () => {
  const backend = memoryBackend(), first = createStore(backend), second = createStore(backend);
  first.load('classic'); first.load('daily'); second.load('classic'); second.load('daily');
  assert.equal(first.save('classic', { move: 2 }), 'saved');
  assert.equal(second.save('daily', { move: 3 }), 'saved');
  assert.equal(first.hasChanged('classic'), false);
  assert.equal(first.hasChanged('daily'), true);
  assert.equal(second.hasChanged('daily'), false);
  assert.equal(second.hasChanged('classic'), true);
});

test('exact raw revisions detect whitespace-only changes and remote deletion', () => {
  const backend = memoryBackend({ 'sudoku:v1:classic': '{"move":1}' }), store = createStore(backend);
  store.load('classic');
  backend.data.set('sudoku:v1:classic', '{ "move": 1 }');
  assert.equal(store.save('classic', { move: 2 }), 'conflict');
  store.load('classic');
  backend.data.delete('sudoku:v1:classic');
  assert.equal(store.hasChanged('classic'), true);
  assert.equal(store.save('classic', { move: 2 }), 'conflict');
  store.load('classic');
  assert.equal(store.save('classic', { move: 2 }), 'saved');
});

test('JSON null and absent keys are distinct revisions', () => {
  const backend = memoryBackend(), first = createStore(backend), second = createStore(backend);
  assert.equal(first.load('classic'), null);
  assert.equal(first.save('classic', null), 'saved');
  assert.equal(second.save('classic', null), 'conflict');
  assert.equal(second.load('classic'), null);
  assert.equal(second.hasChanged('classic'), false);
  assert.equal(second.save('classic', null), 'saved');
  assert.equal(backend.writes, 1);
});

test('malformed JSON can recover without overwriting another tabs repair', () => {
  const backend = memoryBackend({ 'sudoku:v1:classic': '{broken' });
  const first = createStore(backend), second = createStore(backend);
  assert.equal(first.load('classic'), null);
  assert.equal(first.available, true);
  assert.equal(first.recovered, true);
  assert.equal(first.hasChanged('classic'), false);
  assert.equal(second.load('classic'), null);
  assert.equal(second.save('classic', { repaired: true }), 'saved');
  assert.equal(first.save('classic', { staleRepair: true }), 'conflict');
  assert.deepEqual(first.load('classic'), { repaired: true });
  assert.equal(first.recovered, true);
  assert.equal(first.save('classic', { repaired: 'better' }), 'saved');
});

test('blocked reads and missing storage never propagate exceptions or overwrite unread data', () => {
  let blocked = true;
  const backend = memoryBackend({ 'sudoku:v1:classic': '{"existing":true}' });
  const read = backend.getItem;
  backend.getItem = function(key) { if (blocked) throw new Error('SecurityError'); return read.call(this, key); };
  const store = createStore(backend);
  assert.equal(store.load('classic'), null);
  assert.equal(store.available, false);
  assert.equal(store.hasChanged('classic'), false);
  assert.equal(store.save('classic', { lost: true }), 'unavailable');
  blocked = false;
  assert.equal(store.save('classic', { lost: true }), 'conflict');
  assert.equal(store.available, true);
  assert.deepEqual(store.load('classic'), { existing: true });
  assert.equal(store.save('classic', { kept: true }), 'saved');
  for (const unavailable of [null, undefined, {}, { get getItem() { throw new Error('blocked'); } }]) {
    const missing = createStore(unavailable);
    assert.equal(missing.load('classic'), null);
    assert.equal(missing.hasChanged('classic'), false);
    assert.equal(missing.save('classic', {}), 'unavailable');
    assert.equal(missing.available, false);
  }
});

test('quota failures retain the old revision and availability recovers when writing resumes', () => {
  const backend = memoryBackend(), write = backend.setItem;
  let blocked = true;
  backend.setItem = function(key, value) { if (blocked) throw new Error('QuotaExceededError'); write.call(this, key, value); };
  const store = createStore(backend);
  store.load('classic');
  assert.equal(store.save('classic', { move: 1 }), 'unavailable');
  assert.equal(store.available, false);
  assert.equal(backend.data.size, 0);
  blocked = false;
  assert.equal(store.save('classic', { move: 1 }), 'saved');
  assert.equal(store.available, true);
  blocked = true;
  assert.equal(store.save('classic', { move: 2 }), 'unavailable');
  assert.deepEqual(store.load('classic'), { move: 1 });
  assert.equal(store.available, true, 'a successful load confirms storage can be read again');
});

test('serialization failures leave saved data untouched and do not propagate', () => {
  const backend = memoryBackend(), store = createStore(backend);
  store.load('classic');
  assert.equal(store.save('classic', { safe: true }), 'saved');
  const cycle = {}; cycle.self = cycle;
  const invalid = [cycle, 1n, undefined, () => {}, Symbol('bad'), { get value() { throw new Error('bad getter'); } }];
  for (const value of invalid) {
    assert.equal(store.save('classic', value), 'unavailable');
    assert.equal(store.available, false);
    assert.equal(backend.data.get('sudoku:v1:classic'), '{"safe":true}');
  }
  assert.equal(store.save('classic', { safe: true }), 'saved');
  assert.equal(store.available, true);
  assert.equal(backend.writes, 1);
});

test('stats merges preserve persisted first completions and union unique daily dates', () => {
  const win = (id, elapsed, date = '2026-09-17') => ({ id, level: 'easy', elapsed, hints: 0, date });
  const remote = { version: 1, wins: [win('same', 100), win('remote', 300)], dailyDates: ['2026-09-16', '2026-09-17'] };
  const local = { version: 1, wins: [win('same', 50, '2026-09-18'), win('local', 200)], dailyDates: ['2026-09-17', '2026-09-18'] };
  const before = JSON.stringify({ local, remote }), merged = mergeStats(local, remote);
  assert.deepEqual(merged.wins.map(({ id }) => id), ['same', 'remote', 'local']);
  assert.equal(merged.wins[0].elapsed, 100);
  assert.equal(merged.wins[0].date, '2026-09-17');
  assert.deepEqual(merged.dailyDates, ['2026-09-16', '2026-09-17', '2026-09-18']);
  assert.equal(JSON.stringify({ local, remote }), before);
  merged.wins[0].elapsed = 999;
  assert.equal(remote.wins[0].elapsed, 100);
});

test('stats merging validates corruption and can retry against a new remote revision', () => {
  assert.deepEqual(mergeStats(null, { broken: true }), { version: 1, wins: [], dailyDates: [] });
  const backend = memoryBackend(), first = createStore(backend), second = createStore(backend);
  const local = { version: 1, wins: [{ id: 'local', level: 'hard', elapsed: 100, hints: 0, date: '2026-09-17' }], dailyDates: ['2026-09-17'] };
  const remote = { version: 1, wins: [{ id: 'remote', level: 'easy', elapsed: 50, hints: 1, date: '2026-09-16' }], dailyDates: ['2026-09-16', 'bad'] };
  first.load('stats'); second.load('stats');
  assert.equal(first.save('stats', remote), 'saved');
  assert.equal(second.save('stats', local), 'conflict');
  assert.equal(second.save('stats', mergeStats(local, second.load('stats'))), 'saved');
  const saved = first.load('stats');
  assert.equal(saved.wins.length, 2);
  assert.deepEqual(saved.dailyDates, ['2026-09-16', '2026-09-17']);
});
