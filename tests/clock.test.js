import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../src/clock.js';

function fixture() {
  let time = 0;
  return { clock: createClock(() => time), advance: (ms) => { time += ms; } };
}

test('the play clock counts visible time once across repeated checkpoints', () => {
  const { clock, advance } = fixture();
  assert.equal(clock.update(true), 0);
  advance(200); assert.equal(clock.update(true), 200);
  assert.equal(clock.update(true), 0);
  advance(350); assert.equal(clock.update(true), 350);
});

test('hiding a tab counts the final visible interval but excludes background suspension', () => {
  const { clock, advance } = fixture();
  clock.update(true);
  advance(123); assert.equal(clock.update(false), 123);
  advance(600000); assert.equal(clock.update(true), 0);
  advance(250); assert.equal(clock.update(true), 250);
});

test('dialogs, pause, and completion exclude inactive time', () => {
  const { clock, advance } = fixture();
  for (let cycle = 0; cycle < 4; cycle++) {
    assert.equal(clock.update(true), 0);
    advance(1000); assert.equal(clock.update(false), 1000);
    advance(20000); assert.equal(clock.update(false), 0);
  }
});

test('switching puzzles and restoring a suspended page reset the previous interval', () => {
  const { clock, advance } = fixture();
  clock.update(true); advance(1000);
  assert.equal(clock.update(false), 1000);
  advance(100000); clock.reset();
  assert.equal(clock.update(true), 0);
  advance(100); assert.equal(clock.update(true), 100);
});

test('a regressed clock cannot subtract elapsed time', () => {
  const { clock, advance } = fixture();
  clock.update(true); advance(-100);
  assert.equal(clock.update(true), 0);
});
