import test from 'node:test';
import assert from 'node:assert/strict';
import { PUZZLES } from '../src/puzzles.js';
import {
  FULL, LEVELS, PEERS, UNITS, analyze, bitCount, candidates, dailyLevel, dateKey,
  digits, generatePuzzle, getHint, isBoard, isConsistent, logicalStep, makePuzzle,
  ratePuzzle, search, seededRandom, transformPuzzle,
} from '../src/engine.js';

const board = (code) => [...code].map(Number);
const sample = board(PUZZLES.medium[0]);

test('the board topology has nine cells per unit and 20 symmetric peers per cell', () => {
  assert.equal(UNITS.length, 27);
  for (const unit of UNITS) assert.equal(new Set(unit).size, 9);
  for (let i = 0; i < 81; i++) {
    assert.equal(PEERS[i].length, 20);
    assert.ok(!PEERS[i].includes(i));
    for (const peer of PEERS[i]) assert.ok(PEERS[peer].includes(i));
  }
  assert.equal(bitCount(FULL), 9);
  assert.deepEqual(digits(FULL), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('invalid boards are rejected, including sparse arrays and duplicate clues', () => {
  for (const value of [null, {}, '', [], Array(81), Array(81).fill('0'), Array(81).fill(NaN), Array(81).fill(1.5)]) {
    assert.equal(isBoard(value), false);
    assert.deepEqual(search(value), { count: 0, solution: null });
  }
  const conflicting = Array(81).fill(0);
  conflicting[0] = conflicting[1] = 1;
  assert.equal(isBoard(conflicting), true);
  assert.equal(isConsistent(conflicting), false);
  assert.equal(search(conflicting).count, 0);
  assert.equal(search(Array(81).fill(0), 2).count, 2);
});

test('the solver detects a consistent-looking puzzle with no solution', () => {
  const impossible = [...sample], solution = search(sample, 1).solution, masks = candidates(sample);
  const index = masks.findIndex((mask) => bitCount(mask) > 1);
  impossible[index] = digits(masks[index]).find((n) => n !== solution[index]);
  assert.equal(isConsistent(impossible), true);
  assert.deepEqual(search(impossible, 2), { count: 0, solution: null });
});

test('bounded searches reject incomplete uniqueness checks instead of accepting partial results', () => {
  assert.deepEqual(search(sample, 2, null, 1), { count: 0, solution: null, exhausted: true });
  const solved = search(sample, 1).solution;
  assert.deepEqual(search(solved, 2, null, 1), { count: 1, solution: solved });
});

test('all 128 original bank puzzles are unique, correctly rated, and solve without changing clues', () => {
  let count = 0;
  const seen = new Set();
  for (const level of LEVELS) {
    assert.equal(PUZZLES[level].length, 32);
    for (const code of PUZZLES[level]) {
      count++;
      assert.ok(!seen.has(code), `${level}: duplicate puzzle`);
      seen.add(code);
      const puzzle = board(code), original = [...puzzle];
      assert.equal(isConsistent(puzzle), true);
      const { count: solutions, solution } = search(puzzle, 2);
      assert.equal(solutions, 1, `${level}: ${code}`);
      assert.equal(isConsistent(solution), true);
      assert.ok(solution.every(Boolean));
      assert.ok(puzzle.every((n, i) => !n || n === solution[i]));
      assert.deepEqual(puzzle, original, 'search must not mutate its input');
      assert.equal(ratePuzzle(puzzle), level, code);
    }
  }
  assert.equal(count, 128);
});

test('logical solving steps never place a wrong digit or eliminate the actual solution', () => {
  const techniques = new Set();
  for (const level of LEVELS) {
    for (const code of PUZZLES[level]) {
      const puzzle = board(code), solution = search(puzzle, 1).solution;
      const values = [...puzzle], masks = candidates(values);
      let steps = 0;
      while (values.includes(0)) {
        const step = logicalStep(values, masks);
        if (!step) break;
        techniques.add(step.technique);
        assert.ok(++steps < 400, 'logical solver should terminate');
        if (step.type === 'place') {
          assert.equal(step.value, solution[step.index]);
          assert.equal(values[step.index], 0);
          values[step.index] = step.value;
          masks[step.index] = 0;
          for (const peer of PEERS[step.index]) masks[peer] &= ~(1 << step.value);
        } else {
          assert.ok(step.removals.length > 0);
          for (const { index, mask } of step.removals) {
            assert.equal(mask & (1 << solution[index]), 0, step.explanation);
            assert.ok(masks[index] & mask, 'elimination must remove an existing candidate');
            masks[index] &= ~mask;
            assert.ok(masks[index], 'every unsolved cell must retain a candidate');
          }
        }
        assert.equal(isConsistent(values), true);
      }
      const result = analyze(puzzle);
      assert.deepEqual(result.values, values);
      assert.equal(result.solved, level !== 'expert');
    }
  }
  for (const technique of ['Naked single', 'Hidden single', 'Locked candidates', 'Naked pair']) assert.ok(techniques.has(technique), technique);
});

test('Sudoku transformations preserve clues, uniqueness, solution mapping and difficulty', () => {
  for (const level of LEVELS) {
    for (let n = 0; n < PUZZLES[level].length; n++) {
      const puzzle = board(PUZZLES[level][n]), solution = search(puzzle, 1).solution;
      const seed = `transformation-${level}-${n}`;
      const transformed = transformPuzzle(puzzle, seededRandom(seed));
      const transformedSolution = transformPuzzle(solution, seededRandom(seed));
      assert.equal(puzzle.filter(Boolean).length, transformed.filter(Boolean).length);
      const solved = search(transformed, 2);
      assert.equal(solved.count, 1);
      assert.deepEqual(solved.solution, transformedSolution);
      assert.equal(ratePuzzle(transformed), level);
    }
  }
});

test('seeded games and UTC daily levels are deterministic across local timezone boundaries', () => {
  const date = dateKey(new Date('2026-09-17T23:30:00-04:00'));
  assert.equal(date, '2026-09-18');
  assert.equal(dailyLevel('2026-09-14'), 'easy');
  assert.equal(dailyLevel('2026-09-19'), 'expert');
  const seed = `daily-v1:${date}`, level = dailyLevel(date);
  assert.deepEqual(makePuzzle(PUZZLES, level, seed), makePuzzle(PUZZLES, level, seed));
  assert.notDeepEqual(makePuzzle(PUZZLES, level, seed).puzzle, makePuzzle(PUZZLES, level, `${seed}-next`).puzzle);
  assert.throws(() => makePuzzle(PUZZLES, 'impossible', seed), /Unknown difficulty/);
});

test('generation is reproducible, unique, and rotationally symmetric', () => {
  const first = generatePuzzle('regression-generation', 30);
  assert.deepEqual(first, generatePuzzle('regression-generation', 30));
  assert.equal(search(first.puzzle, 2).count, 1);
  assert.ok(first.puzzle.filter(Boolean).length >= 30);
  first.puzzle.forEach((n, i) => assert.equal(Boolean(n), Boolean(first.puzzle[80 - i])));
});

test('hints correct mistakes, teach valid moves, and disclose a reveal when logic is exhausted', () => {
  const solution = search(sample, 1).solution;
  const index = sample.indexOf(0), wrong = [...sample];
  wrong[index] = solution[index] % 9 + 1;
  assert.equal(getHint(wrong, solution).type, 'clear');
  assert.equal(getHint(wrong, solution).index, index);
  assert.equal(getHint(solution, solution), null);
  const hint = getHint(sample, solution);
  assert.equal(hint.type, 'place');
  assert.equal(hint.value, solution[hint.index]);
  assert.ok(hint.explanation.length > 30);
  const expert = board(PUZZLES.expert[0]);
  const remaining = analyze(expert).values;
  const reveal = getHint(remaining, search(expert, 1).solution);
  assert.equal(reveal.reveal, true);
  assert.match(reveal.explanation, /solution reveal/);
});
