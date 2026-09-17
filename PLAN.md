# Sudoku: research and build plan

## Goal

Build a polished classic Sudoku game that lives entirely in this GitHub repository and runs on GitHub Pages. No backend, accounts, analytics, advertisements, remote fonts, CDNs, puzzle APIs, or paid services. All play and storage happen in the browser.

## Research, September 17, 2026

There is no single objectively best Sudoku interface. These references establish the useful baseline:

| Reference | Useful choices | Application here |
| --- | --- | --- |
| [Sudoku Exchange](https://sudokuexchange.com/) | Explained hints, saved progress, customizable highlighting, sharing, dark mode | A calm interface with local saves, optional assistance, and shareable puzzles |
| [SudokuPad](https://sudokupad.app/) | Fast keyboard entry, pencil marks, undo and redo | Complete keyboard support and reversible editing |
| [Sudoku.com](https://sudoku.com/) | Visible difficulty selection, number pad, daily challenges | Immediate play, accessible controls, and a daily habit |
| [Sudoku Coach technique guide](https://sudoku.coach/en/learn/technique-overview) | Teaching the reasoning behind solving techniques | Hints explain singles, locked candidates, and pairs; explicit disclosure when a reveal is needed |

This is an original implementation. Reference sites supply product ideas, not copied code, puzzle data, or artwork.

## Product and visual direction

A quiet, precise puzzle desk: dark ink, cool white paper, blue selection, and a small orange accent. The large board is the main surface. A compact side panel holds a daily challenge, tools, and a generous number pad. On mobile, controls move underneath the board. System fonts and small local SVG icons keep the app fast and self-contained.

## Implementation sequence

### 1. Puzzle engine

- Implement a constraint solver with minimum-remaining-values search and a solution counter.
- Generate an original, reproducible puzzle bank locally, checking every puzzle has exactly one solution.
- Rate puzzles by supported solving techniques: Easy uses naked singles; Medium also needs hidden singles; Hard needs candidate elimination; Expert goes beyond the implemented basic techniques.
- Transform the verified puzzles by Sudoku-preserving permutations to produce fresh games instantly, including offline.
- Derive each daily puzzle from a versioned UTC date seed so everyone receives the same challenge.
- Explain naked singles, hidden singles, locked candidates, and naked pairs. If these techniques cannot find a move, clearly label the offered cell as a reveal.

### 2. Play experience

- Accessible 9 by 9 grid, immutable clues, selected-cell and peer highlighting, and matching digits.
- Touch number pad, arrow navigation, numeric input, pencil mode, erase, undo, and redo.
- Automatically clear related notes when placing a digit; allow assistance settings to be changed.
- Timer, manual pause, automatic pause in background tabs, and a hidden board while paused.
- Mistake feedback that never ends a game or imposes a lives system.
- Hint preview before applying an assisted move.
- Confirmation before replacing an unfinished game.
- Completion summary with time, mistakes, and hints.

### 3. Persistence and daily play

- Version and validate all local storage; gracefully recover from malformed or unavailable storage.
- Save values, notes, history, elapsed time, and settings locally.
- Preserve separate classic and daily games when switching modes.
- Track completion counts, best unassisted times, and daily streaks without double-counting replays.
- Encode shareable puzzles in URL fragments; validate their shape, consistency, and unique solution before loading.

### 4. Finishing and accessibility

- Responsive desktop and phone layouts, light and dark themes, visible keyboard focus, screen-reader cell labels, and reduced-motion support.
- Help dialog with rules and keyboard shortcuts, settings, and personal statistics.
- Local favicon, web app manifest, and a scoped service worker for offline play after the first online visit.
- Keep all links and assets relative so the project works at `/sudoku/` on GitHub Pages.

### 5. Verification

- Node's built-in tests: validity and uniqueness, transformations, deterministic daily puzzles, difficulty classification, hint correctness, undo/redo, save validation, and statistics.
- Browser checks: actual play, pencil notes, erase, undo/redo, hints, pause/resume, persistence, themes, daily switching, sharing, dialogs, and narrow viewport layout.
- Inspect the final rendered UI and browser errors. Verify that game resources use only the local/GitHub Pages origin.

### 6. Publication

- Commit source, generated puzzle bank, tests, documentation, and local verification tools.
- Push to this repository and enable GitHub Pages from `main` at the repository root, with `.nojekyll`.
- Wait for GitHub's Pages build to finish, then verify the public URL and its assets.
- Deliver the live game link, repository, plan, and concise verification results.

## Architecture

Plain ES modules and CSS, no production or development package dependencies. `index.html` is the entry point. `src/engine.js` owns pure Sudoku rules; `src/game.js` owns serializable game state; `src/app.js` handles the DOM. `src/puzzles.js` is generated by `scripts/generate-puzzles.mjs`. `sw.js` caches only this app's assets. `npm test` uses Node's built-in test runner; `npm start` runs a small local static server.

## Practical limits

Progress and statistics stay in the current browser and do not sync between devices. Clearing browser storage removes them. Daily challenges follow UTC, and streaks count consecutive completed UTC challenges. Expert hints can offer a disclosed reveal when the built-in logical techniques run out. The game supports classic 9 by 9 Sudoku; variants and competitive leaderboards are outside this release.

## Release verification

- Implemented the six phases above, including 128 original puzzles (32 per difficulty).
- All 33 automated tests pass: puzzle correctness, unique solutions, difficulty ratings, transformations, logical hint safety, game history, validation, statistics, and offline cache behavior.
- Browser checks passed for pencil notes, number entry, undo/redo, immutable clues, mistakes, hint preview/application, pause/resume, reload persistence, daily/classic switching, settings, themes, help, sharing, replacement confirmation, puzzle completion, and statistics.
- Checked desktop layout at 1280 by 720 and phone layouts at 390 and 320 pixels wide, without horizontal overflow.
- Simulated network disconnection: the cached app reloaded successfully and created a fresh Expert puzzle offline.
- Added bounded validation for imported puzzles and corrupted saves so pathological inputs cannot trigger unbounded solving on the main thread.
- Fixed timer accounting across background tabs and synchronized focused cells with keyboard input during integration review.
