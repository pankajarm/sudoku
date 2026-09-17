import { writeFile } from 'node:fs/promises';
import { generatePuzzle, ratePuzzle, LEVELS } from '../src/engine.js';

const count = 32;
const bank = Object.fromEntries(LEVELS.map((level) => [level, []]));
for (let attempt = 0; attempt < 20000 && LEVELS.some((l) => bank[l].length < count); attempt++) {
  const target = bank.easy.length < count && attempt % 3 === 0 ? 40 : 24 + attempt % 6;
  const { puzzle } = generatePuzzle(`still-original-bank-v1-${attempt}`, target);
  const level = ratePuzzle(puzzle);
  if (bank[level].length < count) bank[level].push(puzzle.join(''));
  if (attempt % 100 === 0) console.log(attempt, Object.fromEntries(LEVELS.map((l) => [l, bank[l].length])));
}
if (LEVELS.some((l) => bank[l].length < count)) throw new Error('Could not fill each difficulty');
await writeFile(new URL('../src/puzzles.js', import.meta.url),
  `// Original puzzles, generated and uniquely solved by scripts/generate-puzzles.mjs.\n// Difficulty is rated by the logical techniques in engine.js.\nexport const PUZZLES = ${JSON.stringify(bank, null, 2)};\n`);
console.log(`Saved ${count * LEVELS.length} original puzzles.`);
