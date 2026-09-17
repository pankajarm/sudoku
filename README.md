# Sudoku

A quiet Sudoku game that runs entirely on GitHub Pages. Every puzzle, icon, and line of code lives in this repository. No accounts, ads, analytics, CDNs, remote fonts, or backend.

[Play Sudoku](https://pankajarm.github.io/sudoku/) · [Build plan and research](PLAN.md) · [Testing](TESTING.md)

## Play

- Four difficulty levels, from Easy to Expert, with 128 original puzzles and fresh layouts created through valid Sudoku transformations.
- One daily challenge shared by everyone, selected deterministically by the UTC date.
- Pencil notes, automatic candidates, undo and redo, optional mistake feedback, and explained hints.
- Touch controls and keyboard entry, light and dark themes, pause, and a timer.
- Separate saved classic and daily games, completion statistics, and daily streaks.
- Share a puzzle with a link. The puzzle travels in the URL fragment.
- Offline play after the first successful online visit, when the browser allows caching. Compatible browsers can also install the game.

Fill every row, column, and 3 by 3 box with the digits 1 through 9, without repeating a digit. The Help button in the game lists the keyboard shortcuts.

Progress and statistics stay in your current browser. They do not sync between devices, and clearing browser storage removes them. Daily challenges change at midnight UTC. The game makes no analytics requests; GitHub serves the files and operates its own hosting infrastructure.

An unfinished daily puzzle from an earlier date stays available after reload, including moves waiting to be redone. Starting today's challenge asks before replacing that progress. Completing an older daily puzzle records the solve but does not extend today's streak.

## Run locally

Use Node.js 22 or newer. There are no packages to install and no build step.

```sh
npm start
```

Open [localhost:4173/sudoku/](http://localhost:4173/sudoku/). Serve the files over HTTP instead of opening `index.html` directly, because the game uses JavaScript modules.

```sh
npm test        # Run all automated regression tests
npm run puzzles # Regenerate the original puzzle bank
```

## Puzzles and hints

The generator creates 32 puzzles per difficulty and checks that each has exactly one solution. New games reorder digits, rows within bands, columns within stacks, entire bands and stacks, and optionally transpose the board. These transformations preserve the solution count.

Difficulty describes the techniques used by this engine, not the number of clues or a universal Sudoku rating:

| Level | Techniques needed by the engine |
| --- | --- |
| Easy | Naked singles |
| Medium | Hidden singles as well as naked singles |
| Hard | Candidate elimination through locked candidates or naked pairs |
| Expert | Beyond the implemented logical techniques |

Hints explain the reasoning before you apply a move. When the guide cannot find a logical move, it explicitly offers a cell reveal. Hints and reveals count as assistance. Mistakes do not end the game.

The daily puzzle uses a versioned UTC date seed and the committed puzzle bank. Keep the seed version and bank stable to preserve past daily puzzles.

## Publish on GitHub Pages

The live repository uses `main` and the repository root:

1. Push the source files to `main`.
2. In GitHub, open Settings, then Pages.
3. Select Deploy from a branch, choose `main` and `/ (root)`, and save.
4. Wait for the Pages deployment, then open [the game](https://pankajarm.github.io/sudoku/).

The committed `.nojekyll` file makes this a plain static site. Asset paths, the manifest, and the service worker all work under `/sudoku/`; no custom domain or external service is needed.

For updates, change `CACHE_VERSION` in `sw.js` whenever a runtime file changes. The service worker caches a complete release and lets existing game tabs finish using it. Close all game tabs and reopen to activate a downloaded update. Its cache names include the app scope, so cleanup does not touch other sites hosted under the same GitHub Pages origin. Missing cached files are saved again when fetched successfully online. If browser storage is unavailable, online play still works.

## Code and references

`src/engine.js` contains Sudoku rules, search, generation, ratings, and hints. `src/game.js` manages moves, save validation, and statistics. `src/puzzles.js` is the generated puzzle bank.

`src/storage.js` uses optimistic revision checks to detect stale saves and merges completion statistics by puzzle identity. `src/clock.js` tracks active play with a monotonic clock, excluding pauses, hidden tabs, and dialogs. `src/app.js` connects these modules to the interface. The local server, generator, and tests use Node's standard library.

The [test report](TESTING.md) describes the automated coverage, browser checks, and remaining browser coverage limits.

The [research and implementation plan](PLAN.md) records the design choices. Product references include [Sudoku Exchange](https://sudokuexchange.com/), [SudokuPad](https://sudokupad.app/), [Sudoku.com](https://sudoku.com/), and [Sudoku Coach's technique guide](https://sudoku.coach/en/learn/technique-overview). The code, puzzles, and artwork in this repository are original.
