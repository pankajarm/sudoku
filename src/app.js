import { PUZZLES } from './puzzles.js';
import { LEVELS, PEERS, rowOf, colOf, digits, cellName, dateKey, dailyLevel, makePuzzle, getHint } from './engine.js';
import { createGame, enterDigit, eraseCell, fillNotes, undo, redo, validateGame, validateSettings,
  validateStats, recordWin, streaks, parseShared } from './game.js';

const $ = (id) => document.getElementById(id);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const storagePrefix = 'sudoku:v1:';
let storageOK = true, recoveredSave = false;
function read(key) {
  try { const raw = localStorage.getItem(storagePrefix + key); return raw ? JSON.parse(raw) : null; }
  catch { recoveredSave = true; return null; }
}
function write(key, value) {
  try { localStorage.setItem(storagePrefix + key, JSON.stringify(value)); }
  catch { storageOK = false; }
}
function restored(mode) {
  const raw = read(mode);
  const valid = validateGame(raw);
  if (raw && (!valid || valid.mode !== mode)) recoveredSave = true;
  return valid?.mode === mode ? valid : null;
}
const settings = validateSettings(read('settings'));
const stats = validateStats(read('stats'));
const saved = { classic: restored('classic'), daily: restored('daily') };
let game, paused = false, hintCell = -1, lastTick = performance.now(), toastTimer, intervalCount = 0;
let visibilityActive = !document.hidden;
let observedDate = dateKey();
const modal = $('modal');
const cellElements = [], numberElements = [];
const descriptions = {
  easy: 'A gentle start. Find the only possible number in each cell.',
  medium: 'Look a little closer. Find the only home for a digit.',
  hard: 'Think in possibilities. Work with pairs and locked candidates.',
  expert: 'Take your time. Advanced patterns and deeper deductions.',
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(text, className, action) {
  const b = node('button', className, text); b.type = 'button'; b.addEventListener('click', action); return b;
}
function paragraph(text) { return node('p', 'dialog-copy', text); }
function formatTime(ms) {
  const total = Math.floor(ms / 1000), seconds = String(total % 60).padStart(2, '0'), minutes = Math.floor(total / 60);
  return minutes < 60 ? `${String(minutes).padStart(2, '0')}:${seconds}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`;
}
function randomSeed() { return [...crypto.getRandomValues(new Uint32Array(3))].join('-'); }
function freshClassic(level = 'easy') { return createGame(makePuzzle(PUZZLES, level, randomSeed())); }
function getDaily() {
  const date = dateKey();
  if (saved.daily?.date === date) return saved.daily;
  return createGame(makePuzzle(PUZZLES, dailyLevel(date), `daily:${date}:v1`), 'daily', date);
}
function checkpoint() {
  const now = performance.now();
  if (game && !game.completed && !paused && !modal.open && visibilityActive) game.elapsed += now - lastTick;
  lastTick = now;
}
function save() {
  if (!game) return;
  saved[game.mode] = game;
  write(game.mode, game); write('active', game.mode); write('settings', settings);
  $('save-status').textContent = storageOK ? 'Progress saved on this device' : 'Storage unavailable · keep this tab open';
}
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200);
}
function clearHash() { if (location.hash) history.replaceState(null, '', location.pathname + location.search); }
function isActive() { return game && !paused && !game.completed && !modal.open && !document.hidden; }
function focusCell() { if (!paused) cellElements[game.selected]?.focus({ preventScroll: true }); }

function buildBoard() {
  for (let r = 0; r < 9; r++) {
    const row = node('div', 'board-row'); row.setAttribute('role', 'row');
    for (let c = 0; c < 9; c++) {
      const index = r * 9 + c, cell = node('button', 'cell');
      cell.type = 'button'; cell.setAttribute('role', 'gridcell'); cell.dataset.index = index;
      cell.setAttribute('aria-rowindex', r + 1); cell.setAttribute('aria-colindex', c + 1);
      cell.addEventListener('click', () => {
        if (paused) return;
        game.selected = index; hintCell = -1; render(); save();
      });
      cell.addEventListener('focus', () => {
        if (paused || game.selected === index) return;
        game.selected = index; hintCell = -1; render(); save();
      });
      row.append(cell); cellElements.push(cell);
    }
    $('board').append(row);
  }
  for (let n = 1; n <= 9; n++) {
    const key = button('', 'number-key', () => input(n));
    key.append(node('span', 'number-digit', n), node('small', 'remaining', '9 left'));
    key.dataset.number = n; $('number-pad').append(key); numberElements.push(key);
  }
}

function renderBoard() {
  const selectedValue = game.values[game.selected];
  for (let i = 0; i < 81; i++) {
    const cell = cellElements[i], value = game.values[i], given = Boolean(game.initial[i]);
    const wrong = !given && value && value !== game.solution[i] && settings.mistakes;
    cell.className = ['cell', given ? 'given' : 'entered', i === game.selected ? 'selected' : '',
      settings.highlight && PEERS[game.selected]?.includes(i) ? 'peer' : '',
      settings.highlight && value && value === selectedValue ? 'same' : '', wrong ? 'conflict' : '',
      i === hintCell ? 'hint-cell' : '', colOf(i) === 2 || colOf(i) === 5 ? 'box-right' : '',
      rowOf(i) === 2 || rowOf(i) === 5 ? 'box-bottom' : ''].filter(Boolean).join(' ');
    cell.tabIndex = i === game.selected ? 0 : -1;
    cell.setAttribute('aria-selected', String(i === game.selected));
    cell.setAttribute('aria-readonly', String(given || game.completed));
    cell.setAttribute('aria-invalid', String(Boolean(wrong)));
    const notes = digits(game.notes[i]);
    cell.setAttribute('aria-label', `${cellName(i)}, ${value ? `${value}${given ? ', given' : ''}${wrong ? ', incorrect' : ''}` : notes.length ? `notes ${notes.join(', ')}` : 'empty'}`);
    // Only replace cell content when it changes, so keyboard focus stays stable.
    const contentKey = `${value}:${game.notes[i]}`;
    if (cell.dataset.content !== contentKey) {
      cell.dataset.content = contentKey;
      if (value) cell.replaceChildren(node('span', 'cell-value', value));
      else {
        const marks = node('span', 'cell-notes'); marks.setAttribute('aria-hidden', 'true');
        for (let n = 1; n <= 9; n++) marks.append(node('span', game.notes[i] & (1 << n) ? 'note filled' : 'note', game.notes[i] & (1 << n) ? n : ''));
        cell.replaceChildren(marks);
      }
    }
  }
  $('board').hidden = paused;
  $('pause-overlay').hidden = !paused;
  $('board-wrap').classList.toggle('is-paused', paused);
}

function renderDaily() {
  const today = dateKey(), done = stats.dailyDates.includes(today);
  $('daily-date').textContent = new Date(`${today}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  $('daily-level').textContent = cap(dailyLevel(today));
  $('daily-status').textContent = done ? 'Today’s challenge complete' : 'Same puzzle for everyone. A fresh one at midnight UTC.';
  $('daily-btn').textContent = done ? 'View today’s puzzle' : saved.daily?.date === today ? 'Continue daily challenge' : 'Play daily challenge';
  const current = streaks(stats.dailyDates, today).current;
  $('daily-streak').textContent = `${current} day${current === 1 ? '' : 's'} in a row`;
}

function render() {
  document.body.dataset.theme = settings.theme;
  document.documentElement.style.colorScheme = settings.theme;
  $('theme-btn').setAttribute('aria-label', settings.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  $('theme-btn').title = settings.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  $('mode-label').textContent = game.mode === 'daily' ? 'THE DAILY CHALLENGE' : 'A LITTLE EVERYDAY CLARITY';
  $('game-title').textContent = game.mode === 'daily' ? 'One day. One puzzle.' : 'Find your focus.';
  $('difficulty').value = game.level;
  $('difficulty').disabled = game.mode === 'daily';
  $('timer').textContent = settings.showTimer ? formatTime(game.elapsed) : '—';
  $('timer').setAttribute('aria-label', settings.showTimer ? `Elapsed time ${formatTime(game.elapsed)}` : 'Timer hidden');
  $('mistakes-count').textContent = settings.mistakes ? String(game.mistakes) : 'Off';
  $('pause-btn').disabled = game.completed;
  $('pause-btn').setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
  $('pause-btn').setAttribute('aria-pressed', String(paused));
  $('pause-btn').title = paused ? 'Resume (P)' : 'Pause (P)';
  $('nav-classic').classList.toggle('active', game.mode === 'classic');
  $('nav-daily').classList.toggle('active', game.mode === 'daily');
  for (const mode of ['classic', 'daily']) {
    if (mode === game.mode) $(`nav-${mode}`).setAttribute('aria-current', 'page');
    else $(`nav-${mode}`).removeAttribute('aria-current');
  }
  const editable = game.initial.filter((n) => !n).length;
  const filled = game.values.filter((n, i) => n && !game.initial[i]).length;
  $('progress-label').textContent = game.completed ? 'Puzzle complete' : `${filled} of ${editable} cells filled`;
  $('progress-fill').style.width = `${editable ? filled / editable * 100 : 100}%`;
  $('undo-btn').disabled = paused || game.completed || !game.history.length;
  $('redo-btn').disabled = paused || game.completed || !game.future.length;
  $('erase-btn').disabled = paused || game.completed || Boolean(game.initial[game.selected]);
  $('notes-btn').disabled = paused || game.completed;
  $('notes-btn').setAttribute('aria-pressed', String(game.noteMode));
  $('notes-state').textContent = game.noteMode ? 'On' : 'Off';
  $('hint-btn').disabled = paused || game.completed;
  $('auto-notes-btn').disabled = paused || game.completed;
  $('new-game-btn').textContent = game.mode === 'daily' ? 'New classic game' : 'New game';
  for (let n = 1; n <= 9; n++) {
    const remaining = Math.max(0, 9 - game.values.filter((v) => v === n).length), key = numberElements[n - 1];
    key.disabled = paused || game.completed;
    key.querySelector('.remaining').textContent = remaining ? `${remaining} left` : 'Done';
    key.setAttribute('aria-label', `Enter ${n}, ${remaining} remaining`);
    key.classList.toggle('number-complete', !remaining);
    key.classList.toggle('pencil-key', game.noteMode);
  }
  renderBoard(); renderDaily();
}

function changed(message) {
  hintCell = -1;
  if (message !== undefined) $('game-status').textContent = message;
  if (game.completed) {
    if (recordWin(stats, game, dateKey())) write('stats', stats);
    render(); save(); showCompletion();
  } else { render(); save(); }
}
function input(n, pencil) {
  if (!isActive()) return;
  checkpoint();
  const previousMistakes = game.mistakes;
  if (enterDigit(game, game.selected, n, settings, pencil ?? game.noteMode)) {
    const wrong = settings.mistakes && game.mistakes > previousMistakes;
    changed(wrong ? 'That number doesn’t fit. Take another look, or undo.' : game.noteMode || pencil ? 'Pencil notes updated.' : '');
  } else if (game.initial[game.selected]) toast('That number is a clue. Choose an empty cell.');
}
function erase() { if (isActive()) { checkpoint(); if (eraseCell(game, game.selected)) changed('Cell cleared.'); } }
function historyMove(fn, message) { if (isActive()) { checkpoint(); if (fn(game)) changed(message); } }
function toggleNotes() {
  if (!isActive()) return;
  game.noteMode = !game.noteMode; render(); save();
  $('game-status').textContent = game.noteMode ? 'Notes on. Add possible numbers to an empty cell.' : 'Notes off. Enter your answer.';
}
function togglePause() {
  if (game.completed || modal.open) return;
  checkpoint(); paused = !paused; render(); save();
  if (paused) $('resume-btn').focus(); else focusCell();
}

function openDialog(title, contents, actions = []) {
  checkpoint();
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(...contents);
  $('modal-actions').replaceChildren(...actions);
  if (!modal.open) modal.showModal();
}
function closeDialog() { modal.close(); lastTick = performance.now(); }
modal.addEventListener('close', () => { lastTick = performance.now(); hintCell = -1; renderBoard(); });
$('close-modal-btn').addEventListener('click', closeDialog);
modal.addEventListener('click', (event) => {
  if (event.target !== modal) return;
  const r = modal.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog();
});

function setGame(next) {
  checkpoint(); save(); game = next; saved[game.mode] = game;
  paused = false; hintCell = -1; lastTick = performance.now();
  if (modal.open) closeDialog();
  clearHash(); $('game-status').textContent = 'Select a cell, then choose a number.';
  if (game.completed && recordWin(stats, game, dateKey())) write('stats', stats);
  render(); save();
}
function startClassic(level) { setGame(freshClassic(level)); toast(`${cap(level)} puzzle ready. Take your time.`); }
function confirmClassic(level) {
  const classic = game.mode === 'classic' ? game : saved.classic;
  if (!classic || classic.completed || !classic.history.length) { startClassic(level); return; }
  openDialog('Start a new puzzle?', [paragraph(`Your unfinished classic puzzle will be replaced with a new ${level} puzzle. Your daily challenge is saved separately.`)],
    [button('Keep playing', 'secondary-btn', closeDialog), button('Start new puzzle', 'primary-btn', () => startClassic(level))]);
}
function chooseDifficulty() {
  const options = node('div', 'difficulty-options');
  for (const level of LEVELS) {
    const b = button('', 'difficulty-option', () => confirmClassic(level));
    b.append(node('strong', '', cap(level)), node('small', '', descriptions[level])); options.append(b);
  }
  const contents = [paragraph('Choose the pace that feels right today.'), options];
  if (!game.completed) contents.push(button('Restart this puzzle', 'text-btn', confirmRestart));
  openDialog('A fresh start.', contents);
}
function confirmRestart() {
  openDialog('Start this puzzle again?', [paragraph('This clears your entries, notes, and timer. Any recorded completion stays in your statistics.')],
    [button('Keep playing', 'secondary-btn', closeDialog), button('Restart puzzle', 'primary-btn', () => {
      setGame(createGame({ puzzle: game.initial, solution: game.solution, level: game.level }, game.mode, game.date));
      toast('A clean grid. A fresh start.');
    })]);
}
function switchDaily() {
  if (game.mode === 'daily' && game.date === dateKey()) { toast(game.completed ? 'You’ve completed today’s challenge.' : 'You’re playing today’s challenge.'); return; }
  setGame(getDaily());
  toast(game.completed ? 'Today’s challenge is complete.' : 'Your classic puzzle is saved. Enjoy today’s challenge.');
}
function switchClassic() {
  if (game.mode === 'classic') return;
  setGame(saved.classic || freshClassic()); toast('Your daily progress is saved.');
}

function showHint() {
  if (!isActive()) return;
  const hint = getHint(game.values, game.solution);
  if (!hint) return;
  // Reading the explanation is already assistance, even without applying it.
  game.hints++; save();
  hintCell = hint.index; game.selected = hint.index; render();
  const explanation = node('div', 'hint-explanation');
  for (const text of hint.explanation.split('\n\n')) explanation.append(paragraph(text));
  openDialog(hint.technique, [explanation, paragraph('This hint is included in your results, even if you place the number yourself.')],
    [button('I’ll try it', 'secondary-btn', closeDialog), button(hint.type === 'clear' ? 'Clear this cell' : hint.reveal ? 'Reveal this cell' : `Place ${hint.value}`, 'primary-btn', () => {
      closeDialog(); checkpoint();
      const applied = hint.type === 'clear' ? eraseCell(game, hint.index) : enterDigit(game, hint.index, hint.value, settings, false);
      if (applied) changed('Hint applied. You’ve got the next move.');
    })]);
}

function showCompletion() {
  const mark = node('div', 'completion-mark', '✓'); mark.setAttribute('aria-hidden', 'true');
  const grid = node('div', 'completion-stats');
  for (const [value, label] of [[formatTime(game.elapsed), 'Time'], [game.mistakes, 'Mistakes'], [game.hints, 'Hints']]) {
    const card = node('div', 'stat-card'); card.append(node('strong', '', value), node('small', '', label)); grid.append(card);
  }
  const daily = game.mode === 'daily';
  const actions = [button('Enjoy the grid', 'secondary-btn', closeDialog), button('Play another', 'primary-btn', chooseDifficulty)];
  openDialog('Nicely done.', [mark, paragraph(daily ? 'One day, one puzzle, one small victory. Come back tomorrow for a fresh challenge.' : `You finished your ${game.level} puzzle. A little focus goes a long way.`), grid], actions);
}

function showStats() {
  const { current, best } = streaks(stats.dailyDates, dateKey());
  const grid = node('div', 'dialog-grid');
  for (const [value, label] of [[stats.wins.length, 'Puzzles solved'], [current, 'Daily streak'], [best, 'Best daily streak'], [stats.dailyDates.length, 'Daily challenges']]) {
    const card = node('div', 'stat-card'); card.append(node('strong', '', value), node('small', '', label)); grid.append(card);
  }
  const table = node('table', 'stats-table');
  const caption = node('caption', '', 'Your best times without hints'); table.append(caption);
  const head = node('thead'), header = node('tr');
  for (const text of ['Difficulty', 'Solved', 'Best time']) { const th = node('th', '', text); th.scope = 'col'; header.append(th); }
  head.append(header); table.append(head);
  const body = node('tbody');
  for (const level of LEVELS) {
    const wins = stats.wins.filter((w) => w.level === level), clean = wins.filter((w) => !w.hints);
    const row = node('tr');
    for (const value of [cap(level), wins.length, clean.length ? formatTime(Math.min(...clean.map((w) => w.elapsed))) : '—']) row.append(node('td', '', value));
    body.append(row);
  }
  table.append(body);
  openDialog('Your little victories.', [grid, table, paragraph('Saved on this browser only. Daily streaks count consecutive UTC challenges completed on their day. Replays count once.')],
    [button('Keep playing', 'primary-btn', closeDialog)]);
}

function showSettings() {
  const list = node('div', 'settings-list');
  const choices = [
    ['highlight', 'Highlight related cells', 'See the selected row, column, box, and matching numbers.'],
    ['mistakes', 'Show mistakes', 'Mark incorrect answers as you play. There is no mistake limit.'],
    ['cleanNotes', 'Tidy pencil notes', 'Remove a placed number from notes in related cells.'],
    ['showTimer', 'Show timer', 'Keep track of time, or keep your focus on the puzzle.'],
  ];
  for (const [key, title, description] of choices) {
    const label = node('label', 'setting-row'), text = node('span');
    text.append(node('strong', '', title), node('small', '', description));
    const input = node('input'); input.type = 'checkbox'; input.checked = settings[key]; input.setAttribute('aria-label', title);
    input.addEventListener('change', () => { settings[key] = input.checked; render(); save(); });
    label.append(text, input); list.append(label);
  }
  openDialog('Make yourself comfortable.', [list, paragraph('Progress and preferences stay on this device. The game has no accounts, tracking, or ads.')],
    [button('Done', 'primary-btn', closeDialog)]);
}

function showHelp() {
  const rules = paragraph('Fill every row, column, and 3 × 3 box with the numbers 1 through 9, without repeating a number. The dark numbers are clues and cannot be changed.');
  const notes = paragraph('Select a cell, then tap or type a number. Turn on Notes to keep track of possible answers. Auto notes fills legal candidates based on your current entries; Undo restores your earlier notes.');
  const list = node('dl', 'shortcut-list');
  for (const [key, description] of [['1–9', 'Enter a number'], ['Arrow keys', 'Move between cells'], ['N', 'Toggle pencil notes'], ['Shift + 1–9', 'Add a pencil note'], ['Delete / Backspace', 'Erase a cell'], ['Ctrl / ⌘ + Z', 'Undo'], ['Ctrl / ⌘ + Shift + Z', 'Redo'], ['H', 'Get a hint'], ['P', 'Pause or resume']]) {
    const dt = node('dt'); dt.append(node('kbd', '', key)); list.append(dt, node('dd', '', description));
  }
  openDialog('A little logic. No maths.', [rules, notes, list, paragraph('Every puzzle has one solution. Easy uses naked singles; Medium adds hidden singles; Hard uses pairs and locked candidates; Expert needs deeper techniques. Hints explain the next move, or clearly offer a reveal when the built-in guide runs out.')],
    [button('Let’s play', 'primary-btn', closeDialog)]);
}

async function sharePuzzle() {
  const url = new URL(location.href); url.hash = new URLSearchParams({ puzzle: game.initial.join(''), level: game.level }).toString();
  const field = node('input', 'share-input'); field.type = 'url'; field.value = url.href; field.readOnly = true; field.setAttribute('aria-label', 'Puzzle link');
  field.addEventListener('click', () => field.select());
  openDialog('A good puzzle is worth sharing.', [paragraph('This link opens the same starting puzzle. Your answers, notes, and time stay private.'), field],
    [button('Done', 'secondary-btn', closeDialog), button('Copy link', 'primary-btn', async () => {
      try { await navigator.clipboard.writeText(url.href); toast('Puzzle link copied.'); }
      catch { field.focus(); field.select(); toast('Select and copy the link above.'); }
    })]);
}
function handleSharedPuzzle() {
  if (!location.hash.includes('puzzle=')) return;
  const imported = parseShared(location.hash);
  if (!imported) { toast('This puzzle link is invalid, ambiguous, or too complex to verify. Your game is safe.'); clearHash(); return; }
  if (game.initial.join('') === imported.puzzle.join('')) { clearHash(); return; }
  const load = () => { setGame(createGame(imported)); toast('Shared puzzle loaded.'); };
  if (game.mode === 'classic' && game.history.length && !game.completed || saved.classic?.history.length && !saved.classic.completed) {
    openDialog('Open the shared puzzle?', [paragraph('This will replace your unfinished classic puzzle. Your daily progress stays saved.')],
      [button('Keep my puzzle', 'secondary-btn', () => { clearHash(); closeDialog(); }), button('Open puzzle', 'primary-btn', load)]);
  } else load();
}

$('undo-btn').addEventListener('click', () => historyMove(undo, 'Move undone.'));
$('redo-btn').addEventListener('click', () => historyMove(redo, 'Move restored.'));
$('erase-btn').addEventListener('click', erase);
$('notes-btn').addEventListener('click', toggleNotes);
$('hint-btn').addEventListener('click', showHint);
$('auto-notes-btn').addEventListener('click', () => {
  if (!isActive()) return;
  checkpoint(); if (fillNotes(game)) changed('Possible numbers filled in. Undo will restore your notes.');
});
$('pause-btn').addEventListener('click', togglePause);
$('resume-btn').addEventListener('click', togglePause);
$('new-game-btn').addEventListener('click', chooseDifficulty);
$('share-btn').addEventListener('click', sharePuzzle);
$('daily-btn').addEventListener('click', switchDaily);
$('nav-classic').addEventListener('click', switchClassic);
$('nav-daily').addEventListener('click', switchDaily);
$('nav-stats').addEventListener('click', showStats);
$('nav-help').addEventListener('click', showHelp);
$('settings-btn').addEventListener('click', showSettings);
$('theme-btn').addEventListener('click', () => { settings.theme = settings.theme === 'light' ? 'dark' : 'light'; render(); save(); });
$('difficulty').addEventListener('change', (event) => { const level = event.target.value; event.target.value = game.level; confirmClassic(level); });

document.addEventListener('keydown', (event) => {
  if (modal.open || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'p' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); togglePause(); return; }
  if (!isActive()) return;
  if (event.ctrlKey || event.metaKey) {
    if (key === 'z') { event.preventDefault(); historyMove(event.shiftKey ? redo : undo, event.shiftKey ? 'Move restored.' : 'Move undone.'); }
    if (key === 'y') { event.preventDefault(); historyMove(redo, 'Move restored.'); }
    return;
  }
  const number = /^[1-9]$/.test(event.key) ? Number(event.key) : event.shiftKey && /^Digit[1-9]$/.test(event.code) ? Number(event.code.slice(-1)) : 0;
  if (number) { event.preventDefault(); input(number, event.shiftKey || game.noteMode); return; }
  if (['backspace', 'delete', '0'].includes(key)) { event.preventDefault(); erase(); return; }
  if (key === 'n') { event.preventDefault(); toggleNotes(); return; }
  if (key === 'h') { event.preventDefault(); showHint(); return; }
  if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 }[event.key];
    game.selected = Math.max(0, Math.min(80, game.selected + delta)); hintCell = -1;
    render(); focusCell(); save();
  }
});

document.addEventListener('visibilitychange', () => {
  checkpoint(); visibilityActive = !document.hidden; lastTick = performance.now(); save();
});
window.addEventListener('pagehide', () => { checkpoint(); save(); });
window.addEventListener('hashchange', handleSharedPuzzle);
window.addEventListener('offline', () => toast('You’re offline. Keep playing; your progress stays here.'));
window.addEventListener('online', () => toast('You’re back online.'));

buildBoard();
game = read('active') === 'daily' ? getDaily() : saved.classic || freshClassic();
saved[game.mode] = game;
if (game.completed && recordWin(stats, game, dateKey())) write('stats', stats);
render(); save(); handleSharedPuzzle();
if (recoveredSave) toast('An unreadable save was skipped. Your game is ready to play.');

setInterval(() => {
  checkpoint();
  $('timer').textContent = settings.showTimer ? formatTime(game.elapsed) : '—';
  if (++intervalCount % 10 === 0) save();
  if (observedDate !== dateKey()) { observedDate = dateKey(); renderDaily(); toast('A new daily challenge is ready. Your current puzzle is saved.'); }
}, 500);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((registration) => {
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) toast('An update is ready for your next visit. Your progress is saved.');
      });
    });
  }).catch(() => { /* The game remains fully playable when offline caching is unavailable. */ });
}
