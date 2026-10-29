// ===== マインスイーパー 画面・操作・保存 =====
'use strict';

const SAVE_KEY = 'mines-save-v1';
const STATS_KEY = 'mines-stats-v1';

// 5段階。どの難易度も「推測なしで解ける盤面」だけを出す
const LEVELS = [
  { name: '入門', w: 8,  h: 8,  mines: 8  },  // 13%
  { name: '初級', w: 9,  h: 9,  mines: 12 },  // 15%
  { name: '中級', w: 10, h: 14, mines: 25 },  // 18%
  { name: '上級', w: 12, h: 18, mines: 45 },  // 21%
  { name: '鬼',   w: 12, h: 20, mines: 60 },  // 25%
];

const HIDDEN = 0, OPEN = 1, FLAG = 2;
const LONG_PRESS_MS = 380;

let state = null;
let flagMode = false;
let timerId = null;

const $ = (q) => document.querySelector(q);
const field = $('#field');
let tiles = [];

// ---------- 保存 ----------
function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
function save() { if (state) store(SAVE_KEY, state); }

// ---------- ゲーム ----------
function newGame(level) {
  const L = LEVELS[level];
  state = {
    level, w: L.w, h: L.h, count: L.mines,
    mines: null,          // 最初のタップで生成
    nums: null,
    view: new Array(L.w * L.h).fill(HIDDEN),
    status: 'ready',      // ready → playing → won / lost
    elapsed: 0,
    boom: -1,
  };
  stopTimer();
  buildField();
  render();
  save();
}

function firstOpen(i) {
  const g = MinesCore.generate(state.w, state.h, state.count, i, { noGuess: true, budget: 1500 });
  state.mines = Array.from(g.mines);
  state.nums = Array.from(g.nums);
  state.status = 'playing';
  startTimer();
}

function openCell(i) {
  if (state.view[i] !== HIDDEN) return;
  if (state.mines[i]) { lose(i); return; }
  const stack = [i];
  state.view[i] = OPEN;
  while (stack.length) {
    const c = stack.pop();
    if (state.nums[c] !== 0) continue;
    for (const j of MinesCore.neighbors(state.w, state.h, c)) {
      if (state.view[j] === HIDDEN) { state.view[j] = OPEN; stack.push(j); }
    }
  }
}

// 数字マスの周りの旗が数字と同じなら、残りをまとめて開く
function chord(i) {
  const nb = MinesCore.neighbors(state.w, state.h, i);
  const flags = nb.filter((j) => state.view[j] === FLAG).length;
  if (flags !== state.nums[i]) return false;
  let any = false;
  for (const j of nb) {
    if (state.view[j] === HIDDEN) { any = true; openCell(j); if (state.status === 'lost') break; }
  }
  return any;
}

function toggleFlag(i) {
  if (state.view[i] === HIDDEN) state.view[i] = FLAG;
  else if (state.view[i] === FLAG) state.view[i] = HIDDEN;
}

function tap(i) {
  if (state.status === 'won' || state.status === 'lost') return;

  if (state.status === 'ready') {
    if (flagMode) return;              // 最初は必ず「開く」から
    firstOpen(i);
    openCell(i);
  } else if (state.view[i] === OPEN) {
    if (state.nums[i] > 0) chord(i);
  } else if (flagMode) {
    toggleFlag(i);
  } else if (state.view[i] === HIDDEN) {
    openCell(i);
  }
  afterMove();
}

function longPress(i) {
  if (state.status !== 'playing') return;
  if (state.view[i] === OPEN) return;
  toggleFlag(i);
  afterMove();
}

function afterMove() {
  if (state.status === 'playing') {
    const opened = state.view.filter((v) => v === OPEN).length;
    if (opened === state.w * state.h - state.count) win();
  }
  render();
  save();
}

function lose(i) {
  state.status = 'lost';
  state.boom = i;
  stopTimer();
  recordPlay(false);
  setTimeout(() => showDialog('ドカン！', `${LEVELS[state.level].name}\nタイム ${fmt(state.elapsed)}`), 450);
}

function win() {
  state.status = 'won';
  stopTimer();
  state.mines.forEach((m, k) => { if (m) state.view[k] = FLAG; });
  const s = recordPlay(true);
  showDialog('クリア！',
    `${LEVELS[state.level].name}\nタイム ${fmt(state.elapsed)}${s.newBest ? '（自己ベスト！）' : ''}\n` +
    `ベスト ${fmt(s.best)}・勝率 ${Math.round((s.wins / s.plays) * 100)}%（${s.wins}/${s.plays}）`);
}

function recordPlay(won) {
  const stats = load(STATS_KEY) || {};
  const s = stats[state.level] || { plays: 0, wins: 0, best: null };
  s.plays++;
  let newBest = false;
  if (won) {
    s.wins++;
    if (s.best === null || state.elapsed < s.best) { s.best = state.elapsed; newBest = true; }
  }
  stats[state.level] = s;
  store(STATS_KEY, stats);
  return { ...s, newBest };
}

// ---------- タイマー ----------
function startTimer() {
  stopTimer();
  timerId = setInterval(() => {
    if (document.hidden) return;
    state.elapsed++;
    $('#timer').textContent = fmt(state.elapsed);
    if (state.elapsed % 5 === 0) save();
  }, 1000);
}
function stopTimer() { if (timerId) clearInterval(timerId); timerId = null; }
function fmt(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------- 描画 ----------
function buildField() {
  field.style.setProperty('--cols', state.w);
  field.innerHTML = '';
  tiles = [];
  for (let i = 0; i < state.w * state.h; i++) {
    const t = document.createElement('div');
    t.className = 'tile';
    t.dataset.i = i;
    t.setAttribute('role', 'gridcell');
    field.appendChild(t);
    tiles.push(t);
  }
}

function render() {
  const over = state.status === 'won' || state.status === 'lost';
  let flags = 0;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i], v = state.view[i];
    let cls = 'tile', text = '';
    if (v === FLAG) {
      flags++;
      text = '🚩';
      if (state.status === 'lost' && !state.mines[i]) { cls += ' wrong'; text = '✕'; }
    } else if (v === OPEN) {
      cls += ' open';
      const n = state.nums[i];
      if (n) { cls += ' n' + n; text = n; }
    } else if (over && state.mines && state.mines[i]) {
      cls += ' open';
      text = '💣';
      if (i === state.boom) cls += ' boom';
    }
    t.className = cls;
    t.textContent = text;
  }
  $('#left').textContent = `💣 ${state.count - flags}`;
  $('#timer').textContent = fmt(state.elapsed);
  $('#level').value = state.level;
  $('#modeOpen').classList.toggle('on', !flagMode);
  $('#modeFlag').classList.toggle('on', flagMode);
}

function showDialog(title, body) {
  $('#dialogTitle').textContent = title;
  $('#dialogBody').textContent = body;
  $('#overlay').hidden = false;
}

// ---------- 入力（タップ・長押し） ----------
let press = null;
field.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.tile');
  if (!t) return;
  const i = Number(t.dataset.i);
  t.classList.add('pressed');
  press = {
    i, t, x: e.clientX, y: e.clientY, done: false,
    timer: setTimeout(() => { press.done = true; t.classList.remove('pressed'); longPress(i); }, LONG_PRESS_MS),
  };
});
field.addEventListener('pointermove', (e) => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) cancelPress();
});
field.addEventListener('pointerup', () => {
  if (!press) return;
  clearTimeout(press.timer);
  press.t.classList.remove('pressed');
  if (!press.done) tap(press.i);
  press = null;
});
field.addEventListener('pointercancel', cancelPress);
field.addEventListener('contextmenu', (e) => e.preventDefault());
function cancelPress() {
  if (!press) return;
  clearTimeout(press.timer);
  press.t.classList.remove('pressed');
  press = null;
}

// ---------- ボタン ----------
$('#modeOpen').addEventListener('click', () => { flagMode = false; render(); });
$('#modeFlag').addEventListener('click', () => { flagMode = true; render(); });
$('#restart').addEventListener('click', () => {
  if (state.status === 'playing' && !confirm('今のゲームをやめて新しく始めますか？')) return;
  newGame(state.level);
});
$('#level').addEventListener('change', (e) => {
  if (state.status === 'playing' && !confirm('今のゲームをやめて難易度を変えますか？')) {
    e.target.value = state.level;
    return;
  }
  newGame(Number(e.target.value));
});
$('#dialogBtn').addEventListener('click', () => { $('#overlay').hidden = true; newGame(state.level); });
$('#dialogClose').addEventListener('click', () => { $('#overlay').hidden = true; });

document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);

// ---------- 起動 ----------
(function init() {
  const saved = load(SAVE_KEY);
  if (saved && saved.view && LEVELS[saved.level] && saved.view.length === saved.w * saved.h) {
    state = saved;
    buildField();
    render();
    if (state.status === 'playing') startTimer();
  } else {
    newGame(1);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
