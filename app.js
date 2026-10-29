// ===== ナンプレ 画面・操作・保存 =====
'use strict';

const SAVE_KEY = 'numpre-save-v1';   // 途中経過
const STATS_KEY = 'numpre-stats-v1'; // ベストタイムなど

const DIFFICULTY = {
  easy:   { label: 'かんたん',     clues: 40 },
  normal: { label: 'ふつう',       clues: 34 },
  hard:   { label: 'むずかしい',   clues: 28 },
  expert: { label: '超むずかしい', clues: 24 },
  // ヒントを極限まで減らした問題（どのヒントも欠かせない状態、21〜23個程度）
  extreme: { label: 'エクストリーム', minimal: true, budget: 1500 },
};

// ---------- 問題生成（Web Worker で別スレッド実行。使えなければその場で生成） ----------
let worker = null;
let requestId = 0;
try { worker = new Worker('worker.js'); } catch { worker = null; }

function generatePuzzle(difficulty) {
  const d = DIFFICULTY[difficulty];
  if (!worker) {
    return Promise.resolve(d.minimal ? Sudoku.generateMinimal(d.budget) : Sudoku.generate(d.clues));
  }
  const id = ++requestId;
  return new Promise((resolve) => {
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', onMsg);
      resolve(e.data);
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ id, clues: d.clues, minimal: !!d.minimal, budget: d.budget });
  });
}

// ---------- 状態 ----------
// notes はマスごとのビットマスク（bit n が立っていれば数字 n をメモ）
let state = null;
let selected = -1;
let memoMode = false;
let timerId = null;

// ---------- localStorage（失敗しても落ちないように try/catch） ----------
function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 容量超過・プライベートモード等 */ }
}
function save() { if (state) store(SAVE_KEY, state); }

// ---------- ゲーム開始 ----------
let generating = false;
async function newGame(difficulty) {
  if (generating) return;
  generating = true;
  stopTimer();
  $('#loading').hidden = false;
  const { puzzle, solution } = await generatePuzzle(difficulty);
  $('#loading').hidden = true;
  generating = false;
  state = {
    difficulty,
    puzzle,
    solution,
    board: puzzle.slice(),
    notes: new Array(81).fill(0),
    history: [],
    elapsed: 0,
    mistakes: 0,
    completed: false,
  };
  selected = -1;
  save();
  render();
  startTimer();
}

// ---------- 入力処理 ----------
const peersCache = [];
function peers(i) {
  if (peersCache[i]) return peersCache[i];
  const r = Math.floor(i / 9), c = i % 9;
  const br = r - (r % 3), bc = c - (c % 3);
  const set = new Set();
  for (let k = 0; k < 9; k++) {
    set.add(r * 9 + k);
    set.add(k * 9 + c);
    set.add((br + Math.floor(k / 3)) * 9 + bc + (k % 3));
  }
  set.delete(i);
  return (peersCache[i] = [...set]);
}

// 変更を記録しながらマスを書き換える（Undo 用）
function apply(changes) {
  const record = changes.map(({ i }) => ({ i, v: state.board[i], n: state.notes[i] }));
  for (const { i, v, n } of changes) {
    state.board[i] = v;
    state.notes[i] = n;
  }
  state.history.push(record);
  if (state.history.length > 200) state.history.shift();
}

function inputNumber(n) {
  if (!state || state.completed || selected < 0) return;
  const i = selected;
  if (state.puzzle[i] !== 0) return; // 最初からある数字は変更不可

  if (memoMode) {
    if (state.board[i] !== 0) return;
    apply([{ i, v: 0, n: state.notes[i] ^ (1 << n) }]);
  } else {
    if (state.board[i] === n) return;
    const changes = [{ i, v: n, n: 0 }];
    // 同じ行・列・ブロックのメモから n を自動で消す
    for (const p of peers(i)) {
      if (state.notes[p] & (1 << n)) {
        changes.push({ i: p, v: state.board[p], n: state.notes[p] & ~(1 << n) });
      }
    }
    apply(changes);
    if (n !== state.solution[i]) state.mistakes++;
  }
  afterChange();
}

function erase() {
  if (!state || state.completed || selected < 0) return;
  const i = selected;
  if (state.puzzle[i] !== 0) return;
  if (state.board[i] === 0 && state.notes[i] === 0) return;
  apply([{ i, v: 0, n: 0 }]);
  afterChange();
}

function undo() {
  if (!state || state.completed) return;
  const record = state.history.pop();
  if (!record) return;
  for (const { i, v, n } of record) {
    state.board[i] = v;
    state.notes[i] = n;
  }
  selected = record[0].i;
  save();
  render();
}

function hint() {
  if (!state || state.completed) return;
  // 選択中のマスが空いていて未正解ならそこ、なければ空きマスからランダム
  let i = selected;
  if (i < 0 || state.puzzle[i] !== 0 || state.board[i] === state.solution[i]) {
    const empties = [];
    for (let k = 0; k < 81; k++) if (state.board[k] !== state.solution[k]) empties.push(k);
    if (!empties.length) return;
    i = empties[Math.floor(Math.random() * empties.length)];
  }
  selected = i;
  const n = state.solution[i];
  const changes = [{ i, v: n, n: 0 }];
  for (const p of peers(i)) {
    if (state.notes[p] & (1 << n)) changes.push({ i: p, v: state.board[p], n: state.notes[p] & ~(1 << n) });
  }
  apply(changes);
  afterChange();
  cells[i].classList.add('flash');
}

function afterChange() {
  if (state.board.every((v, i) => v === state.solution[i])) {
    state.completed = true;
    stopTimer();
    save();
    render();
    showClear();
    return;
  }
  save();
  render();
}

// ---------- タイマー ----------
function startTimer() {
  stopTimer();
  if (!state || state.completed) return;
  timerId = setInterval(() => {
    if (document.hidden) return;
    state.elapsed++;
    renderStatus();
    if (state.elapsed % 5 === 0) save();
  }, 1000);
}
function stopTimer() { if (timerId) clearInterval(timerId); timerId = null; }
function fmt(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------- クリア ----------
function showClear() {
  const stats = load(STATS_KEY) || {};
  const s = stats[state.difficulty] || { cleared: 0, best: null };
  s.cleared++;
  const isBest = s.best === null || state.elapsed < s.best;
  if (isBest) s.best = state.elapsed;
  stats[state.difficulty] = s;
  store(STATS_KEY, stats);

  $('#dialogTitle').textContent = 'クリア！';
  $('#dialogBody').textContent =
    `${DIFFICULTY[state.difficulty].label}\n` +
    `タイム ${fmt(state.elapsed)}${isBest ? '（自己ベスト！）' : ''}\n` +
    `ミス ${state.mistakes} 回\n` +
    `ベスト ${fmt(s.best)}・クリア ${s.cleared} 回`;
  $('#overlay').hidden = false;
}

// ---------- 描画 ----------
const $ = (q) => document.querySelector(q);
const boardEl = $('#board');
const padEl = $('#pad');
const cells = [];
const padBtns = [];

function buildUI() {
  for (let i = 0; i < 81; i++) {
    const el = document.createElement('div');
    el.className = 'cell';
    const r = Math.floor(i / 9), c = i % 9;
    if (c === 2 || c === 5) el.classList.add('box-r');
    if (r === 2 || r === 5) el.classList.add('box-b');
    el.setAttribute('role', 'gridcell');
    el.addEventListener('pointerdown', () => { selected = i; render(); });
    boardEl.appendChild(el);
    cells.push(el);
  }
  for (let n = 1; n <= 9; n++) {
    const b = document.createElement('button');
    b.className = 'num';
    b.innerHTML = `${n}<small></small>`;
    b.addEventListener('click', () => inputNumber(n));
    padEl.appendChild(b);
    padBtns.push(b);
  }
}

function render() {
  if (!state) return;
  const selVal = selected >= 0 ? state.board[selected] : 0;
  const peerSet = selected >= 0 ? new Set(peers(selected)) : new Set();

  for (let i = 0; i < 81; i++) {
    const el = cells[i];
    const v = state.board[i];
    el.className = el.className.replace(/\b(given|peer|same|selected|error|flash)\b/g, '').trim();
    if (state.puzzle[i]) el.classList.add('given');
    if (peerSet.has(i)) el.classList.add('peer');
    if (selVal && v === selVal) el.classList.add('same');
    if (i === selected) el.classList.add('selected');
    if (v && v !== state.solution[i]) el.classList.add('error');

    if (v) {
      el.textContent = v;
    } else if (state.notes[i]) {
      let html = '<div class="notes">';
      for (let n = 1; n <= 9; n++) {
        const on = state.notes[i] & (1 << n);
        html += `<span class="${on && n === selVal ? 'hl' : ''}">${on ? n : ''}</span>`;
      }
      el.innerHTML = html + '</div>';
    } else {
      el.textContent = '';
    }
  }

  // 数字パッド：残り個数を表示、9個そろった数字は隠す
  const counts = new Array(10).fill(0);
  state.board.forEach((v, i) => { if (v && v === state.solution[i]) counts[v]++; });
  padBtns.forEach((b, k) => {
    const left = 9 - counts[k + 1];
    b.disabled = left === 0;
    b.querySelector('small').textContent = left;
  });

  $('#memo').classList.toggle('on', memoMode);
  $('#memoState').textContent = memoMode ? 'ON' : 'OFF';
  $('#difficulty').value = state.difficulty;
  renderStatus();
}

function renderStatus() {
  $('#timer').textContent = fmt(state.elapsed);
  $('#mistakes').textContent = `ミス ${state.mistakes}`;
}

// ---------- イベント ----------
function bindEvents() {
  $('#undo').addEventListener('click', undo);
  $('#erase').addEventListener('click', erase);
  $('#hint').addEventListener('click', hint);
  $('#memo').addEventListener('click', () => { memoMode = !memoMode; render(); });

  const confirmNew = (difficulty) => {
    const inProgress = state && !state.completed && state.history.length > 0;
    if (inProgress && !confirm('今の問題を破棄して新しい問題を始めますか？')) {
      $('#difficulty').value = state.difficulty;
      return;
    }
    newGame(difficulty);
  };
  $('#newGame').addEventListener('click', () => confirmNew($('#difficulty').value));
  $('#difficulty').addEventListener('change', (e) => confirmNew(e.target.value));

  $('#dialogBtn').addEventListener('click', () => {
    $('#overlay').hidden = true;
    newGame(state.difficulty);
  });

  // PC で試すとき用のキーボード操作
  document.addEventListener('keydown', (e) => {
    if (e.key >= '1' && e.key <= '9') inputNumber(Number(e.key));
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') erase();
    else if (e.key === 'm') { memoMode = !memoMode; render(); }
    else if ((e.metaKey || e.ctrlKey) && e.key === 'z') undo();
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      if (selected < 0) selected = 0;
      const r = Math.floor(selected / 9), c = selected % 9;
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      selected = ((r + d[0] + 9) % 9) * 9 + ((c + d[1] + 9) % 9);
      render();
    }
  });

  // アプリを閉じる・裏に回すときに確実に保存
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);
}

// ---------- 起動 ----------
function init() {
  buildUI();
  bindEvents();

  const saved = load(SAVE_KEY);
  if (saved && Array.isArray(saved.board) && saved.board.length === 81 && !saved.completed) {
    state = saved;        // 続きから
    render();
    startTimer();
  } else {
    newGame(saved?.difficulty || 'normal');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
