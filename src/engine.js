// Original Sudoku engine. Bit n represents candidate n (bits 1 through 9).
export const FULL = 0b1111111110;
export const LEVELS = ['easy', 'medium', 'hard', 'expert'];
export const rowOf = (i) => Math.floor(i / 9);
export const colOf = (i) => i % 9;
export const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
export const cellName = (i) => `row ${rowOf(i) + 1}, column ${colOf(i) + 1}`;
export const UNITS = [
  ...Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, b) => Array.from({ length: 9 }, (_, k) =>
    (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + k % 3)),
];
export const PEERS = Array.from({ length: 81 }, (_, i) =>
  [...new Set(UNITS.filter((u) => u.includes(i)).flat())].filter((j) => i !== j));
export const digits = (mask) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => mask & (1 << d));
export const bitCount = (mask) => { let n = 0; while (mask) { mask &= mask - 1; n++; } return n; };
export const isBoard = (board) => Array.isArray(board) && board.length === 81 &&
  Array.from(board).every((n) => Number.isInteger(n) && n >= 0 && n <= 9);
export const isConsistent = (board) => isBoard(board) && UNITS.every((unit) => {
  const values = unit.map((i) => board[i]).filter(Boolean);
  return new Set(values).size === values.length;
});
export const candidates = (board) => board.map((n, i) => n ? 0 :
  PEERS[i].reduce((mask, j) => mask & ~(1 << board[j]), FULL));

export function seededRandom(seed) {
  let state = 2166136261;
  for (const c of String(seed)) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function search(board, limit = 2, random = null, maxNodes = Infinity) {
  if (!isConsistent(board)) return { count: 0, solution: null };
  const values = [...board];
  const rows = Array(9).fill(0), cols = Array(9).fill(0), boxes = Array(9).fill(0);
  values.forEach((n, i) => { if (n) { const bit = 1 << n; rows[rowOf(i)] |= bit; cols[colOf(i)] |= bit; boxes[boxOf(i)] |= bit; } });
  let count = 0, solution = null, visited = 0, exhausted = false;
  function visit() {
    if (++visited > maxNodes) { exhausted = true; return; }
    let best = -1, bestMask = 0, size = 10;
    for (let i = 0; i < 81; i++) {
      if (values[i]) continue;
      const mask = FULL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const n = bitCount(mask);
      if (!n) return;
      if (n < size) { best = i; bestMask = mask; size = n; if (n === 1) break; }
    }
    if (best === -1) { count++; solution ??= [...values]; return; }
    const r = rowOf(best), c = colOf(best), b = boxOf(best);
    const options = random ? shuffle(digits(bestMask), random) : digits(bestMask);
    for (const n of options) {
      const bit = 1 << n;
      values[best] = n; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      visit();
      values[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      if (count >= limit || exhausted) return;
    }
  }
  visit();
  // A partial search cannot establish uniqueness, even after finding one solution.
  return exhausted ? { count: 0, solution: null, exhausted: true } : { count, solution };
}

function unitName(u) { return u < 9 ? `row ${u + 1}` : u < 18 ? `column ${u - 8}` : `box ${u - 17}`; }

export function logicalStep(board, masks = candidates(board), maxRank = 3) {
  for (let i = 0; i < 81; i++) {
    if (!board[i] && bitCount(masks[i]) === 1) {
      const value = digits(masks[i])[0];
      return { type: 'place', rank: 1, technique: 'Naked single', index: i, value,
        cells: [i], explanation: `Only ${value} can go in ${cellName(i)}. Every other digit already appears in its row, column, or box, or has been ruled out by an earlier step.` };
    }
  }
  if (maxRank < 2) return null;
  for (let u = 0; u < 27; u++) {
    for (let n = 1; n <= 9; n++) {
      const cells = UNITS[u].filter((i) => !board[i] && (masks[i] & (1 << n)));
      if (cells.length === 1) return { type: 'place', rank: 2, technique: 'Hidden single', index: cells[0], value: n,
        cells, explanation: `In ${unitName(u)}, ${cellName(cells[0])} is the only open cell where ${n} can go.` };
    }
  }
  if (maxRank < 3) return null;
  // Locked candidates: if a unit's candidates all share another unit, remove there.
  for (let u = 0; u < 27; u++) {
    for (let n = 1; n <= 9; n++) {
      const bit = 1 << n;
      const cells = UNITS[u].filter((i) => !board[i] && (masks[i] & bit));
      if (cells.length < 2 || cells.length > 3) continue;
      const targetUnits = u >= 18 ? [rowOf(cells[0]), colOf(cells[0]) + 9] : [boxOf(cells[0]) + 18];
      for (const v of targetUnits) {
        if (!cells.every((i) => UNITS[v].includes(i))) continue;
        const removals = UNITS[v].filter((i) => !UNITS[u].includes(i) && (masks[i] & bit)).map((index) => ({ index, mask: bit }));
        if (removals.length) return { type: 'eliminate', rank: 3, technique: 'Locked candidates', cells, removals,
          explanation: `In ${unitName(u)}, every possible ${n} lies in ${unitName(v)}. Remove ${n} from the other cells in ${unitName(v)}.` };
      }
    }
  }
  for (let u = 0; u < 27; u++) {
    const pairs = UNITS[u].filter((i) => !board[i] && bitCount(masks[i]) === 2);
    for (let a = 0; a < pairs.length; a++) {
      for (let b = a + 1; b < pairs.length; b++) {
        const i = pairs[a], j = pairs[b];
        if (masks[i] !== masks[j]) continue;
        const mask = masks[i];
        const removals = UNITS[u].filter((k) => k !== i && k !== j && (masks[k] & mask)).map((index) => ({ index, mask: masks[index] & mask }));
        if (removals.length) return { type: 'eliminate', rank: 3, technique: 'Naked pair', cells: [i, j], removals,
          explanation: `The cells at ${cellName(i)} and ${cellName(j)} can only contain ${digits(mask).join(' and ')}. Those digits can be removed from the other cells in ${unitName(u)}.` };
      }
    }
  }
  return null;
}

export function analyze(board, maxRank = 3) {
  const values = [...board], masks = candidates(board), steps = [];
  while (values.includes(0) && steps.length < 400) {
    const step = logicalStep(values, masks, maxRank);
    if (!step) break;
    steps.push(step);
    if (step.type === 'place') {
      values[step.index] = step.value; masks[step.index] = 0;
      for (const p of PEERS[step.index]) masks[p] &= ~(1 << step.value);
    } else for (const { index, mask } of step.removals) masks[index] &= ~mask;
  }
  return { solved: !values.includes(0), values, steps, rank: Math.max(1, ...steps.map((s) => s.rank)) };
}

export function ratePuzzle(board) {
  const result = analyze(board);
  return result.solved ? LEVELS[result.rank - 1] : 'expert';
}

export function generatePuzzle(seed, targetClues = 28) {
  const random = seededRandom(seed);
  const solution = search(Array(81).fill(0), 1, random).solution;
  const puzzle = [...solution];
  // Remove rotational pairs while retaining exactly one solution.
  for (const i of shuffle(Array.from({ length: 41 }, (_, i) => i), random)) {
    const j = 80 - i, remaining = puzzle.filter(Boolean).length;
    if (remaining - (i === j ? 1 : 2) < targetClues) continue;
    const a = puzzle[i], b = puzzle[j]; puzzle[i] = 0; puzzle[j] = 0;
    if (search(puzzle, 2).count !== 1) { puzzle[i] = a; puzzle[j] = b; }
  }
  return { puzzle, solution };
}

export function transformPuzzle(board, random) {
  const groups = () => shuffle([0, 1, 2], random).flatMap((g) => shuffle([0, 1, 2], random).map((n) => g * 3 + n));
  const rows = groups(), cols = groups(), mapping = [0, ...shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], random)];
  const transpose = random() > 0.5;
  return Array.from({ length: 81 }, (_, i) => {
    const r = rows[rowOf(i)], c = cols[colOf(i)];
    return mapping[board[transpose ? c * 9 + r : r * 9 + c]];
  });
}

export const dateKey = (date = new Date()) => date.toISOString().slice(0, 10);
export function dailyLevel(date = dateKey()) {
  return ['medium', 'easy', 'medium', 'hard', 'medium', 'hard', 'expert'][new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export function makePuzzle(bank, level, seed) {
  if (!LEVELS.includes(level) || !bank[level]?.length) throw new Error('Unknown difficulty');
  const random = seededRandom(seed), pool = bank[level];
  const original = pool[Math.floor(random() * pool.length)].split('').map(Number);
  const puzzle = transformPuzzle(original, random);
  return { puzzle, solution: search(puzzle, 1).solution, level };
}

export function getHint(values, solution) {
  const wrong = values.findIndex((n, i) => n && n !== solution[i]);
  if (wrong !== -1) return { type: 'clear', index: wrong, technique: 'A fresh look', cells: [wrong],
    explanation: `The ${values[wrong]} in ${cellName(wrong)} does not fit this puzzle's solution. Clear it and take another look at the surrounding cells.` };
  const result = analyze(values);
  const firstPlacement = result.steps.findIndex((s) => s.type === 'place');
  if (firstPlacement !== -1) {
    const step = result.steps[firstPlacement];
    const lead = result.steps.slice(0, firstPlacement);
    return { ...step, explanation: [...lead.map((s) => s.explanation), step.explanation].join('\n\n'),
      technique: lead.length ? `${lead[0].technique} → ${step.technique.toLowerCase()}` : step.technique };
  }
  const masks = candidates(values);
  const index = values.map((n, i) => ({ n, i })).filter(({ n }) => !n).sort((a, b) => bitCount(masks[a.i]) - bitCount(masks[b.i]))[0]?.i;
  if (index === undefined) return null;
  return { type: 'place', index, value: solution[index], technique: 'Reveal a cell', cells: [index], reveal: true,
    explanation: `This position needs a technique beyond the built-in hint guide. You can reveal ${solution[index]} in ${cellName(index)} to keep going. This is a solution reveal, not a logical explanation.` };
}
