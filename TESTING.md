# Testing

This QA pass includes 77 passing automated tests and browser checks at 9 viewport sizes. The browser checks used Chromium, with mobile and tablet sizes emulated. Recorded September 17, 2026.

## Repeat the checks

Use Node.js 22 or newer. No package installation is needed.

```sh
npm test
npm start
```

`npm test` runs the regression suite. `npm start` serves the game at [localhost:4173/sudoku/](http://localhost:4173/sudoku/) for browser checks. The server stays running until stopped.

For a browser smoke test, start a puzzle, enter a number and some notes, undo and redo, then reload and check the saved board. Switch between Classic and Daily, open Help and a hint, pause and resume, and complete a puzzle. Check the time and statistics after reopening the page. Use a separate browser profile to keep test games out of personal statistics.

## Automated coverage

| Area | Verified behavior |
| --- | --- |
| Puzzle engine | All 128 original puzzles have one solution; transformations preserve validity; daily selection is deterministic; ratings and hints follow supported techniques |
| Game state | Entries, notes, undo, redo, erasing, malformed saves, shared puzzle validation, completion records, and UTC streaks |
| Storage | Stale revision detection, corrupt or unavailable storage, recovery, and merging completion statistics without duplicate wins |
| Clock | Monotonic elapsed time, pause and resume boundaries, hidden intervals, and resets |
| Actual app code | Simulated DOM interactions, storage events, blocked storage, timer transitions, stale dialog actions, keyboard edges, mode switching, and daily rollover |
| Service worker | All 13 local assets exist; project and root scopes; cache isolation; offline responses; cache repair; rejected redirects and error responses; failed installations and storage quota failures |

The app tests import the actual application into a small DOM and browser API harness. Storage events and multiple store instances are simulated. Separate real browser tabs were not exercised in this pass. Service worker regressions use a VM harness; they test worker behavior without reproducing a browser's complete worker lifecycle.

## Browser checks

All 9 viewport profiles rendered the 81 cells without horizontal page overflow: 320 × 568, 375 × 667, 390 × 844, 430 × 932, 768 × 1024, 1024 × 768, 1280 × 720, 1440 × 900, and 844 × 390 pixels.

Completed checks:

- Solved a full puzzle through keyboard entry at each of the 4 difficulty levels, plus a daily challenge through the onscreen number pad.
- Reloaded saved games and checked completion persistence and duplicate completion prevention.
- Used pencil notes, temporary notes, auto notes, erase, undo, redo, and mistake feedback.
- Opened and dismissed hints, tested shared puzzle URLs and invalid links, and checked pause, Help, and timer behavior.
- Enlarged text to 200% at 320, 375, 768, and 1280 pixel widths. Navigation reflowed without horizontal overflow; phone dialogs scrolled, closed, and restored focus. Touch entry remained usable.
- Checked light and dark themes. On a 320 × 568 screen, the complete board fits above the fixed number pad at normal text size.
- Installed a fresh offline copy, disabled the network, reloaded, generated a Hard puzzle, entered a correct digit, reloaded again, and opened a working hint. The entry persisted and the browser reported no console errors.

Safari and physical iOS and Android devices were not tested. Chromium viewport emulation covers layout and interaction at these sizes; it does not establish native browser or device compatibility.

## Fixes covered by regressions

- Save revisions detect stale writes from another tab, while statistics merge completed puzzles. Settings follow incoming storage updates.
- A stale hint or new game confirmation cannot act on a puzzle that another save has replaced.
- Timers count the final active interval before pausing and exclude hidden time and time spent in dialogs. New puzzles and remotely completed games keep the correct recorded time.
- Unfinished daily games from earlier dates survive reload, including redo history. Replacing them with today's challenge requires confirmation.
- Classic games with redo history also require confirmation before a new puzzle, difficulty change, or shared import replaces them.
- Keyboard navigation stays within each grid edge, with cell selection and erase availability updated together.
- Evicted offline files are cached again after a successful online fetch. Cache repair rejects error responses, partial responses, redirects, and data from another origin.
