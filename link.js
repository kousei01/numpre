// ===== ナンバーリンク 画面・操作・保存 =====
'use strict';

const SAVE_KEY = 'link-save-v1';
const STATS_KEY = 'link-stats-v1';

const LEVELS = [
  { name: '入門', n: 5, colors: 5 },
  { name: '初級', n: 6, colors: 6 },
  { name: '中級', n: 7, colors: 7 },
  { name: '上級', n: 8, colors: 8 },
  { name: '鬼',   n: 9, colors: 9 },
];

// 色（数字1〜12）。黄色など明るい色は数字を黒にする
const COLORS = ['#e5484d', '#3e7cf0', '#30a46c', '#f5c518', '#f08c2e', '#2bb3c0',
                '#d34fb5', '#8e5bd8', '#9a6a3a', '#86c43f', '#f78fb3', '#6b7a99'];
const DARK_TEXT = new Set([3, 9, 10]);

const $ = (q) => document.querySelector(q);
const svg = $('#board');
const SVGNS = 'http://www.w3.org/2000/svg';

let state = null;
let endpointOf = null; // セル -> 色（端点でなければ -1）
let stroke = null;     // なぞっている最中の情報
let timerId = null;

// ---------- 保存 ----------
function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
function save() { if (state) store(SAVE_KEY, state); }

// ---------- 問題生成（Web Worker） ----------
let worker = null, reqId = 0;
try { worker = new Worker('link-worker.js'); } catch { worker = null; }
function generate(level) {
  const L = LEVELS[level];
  if (!worker) return Promise.resolve(LinkCore.generate(L.n, { colors: L.colors, budget: 4000 }));
  const id = ++reqId;
  return new Promise((resolve) => {
    const h = (e) => { if (e.data.id === id) { worker.removeEventListener('message', h); resolve(e.data); } };
    worker.addEventListener('message', h);
    worker.postMessage({ id, n: L.n, colors: L.colors });
  });
}

let generating = false;
async function newGame(level) {
  if (generating) return;
  generating = true;
  stopTimer();
  $('#loading').hidden = false;
  const p = await generate(level);
  $('#loading').hidden = true;
  generating = false;
  state = {
    level, n: p.n, ends: p.ends, solution: p.solution,
    paths: p.ends.map(() => []),
    history: [],
    elapsed: 0, hints: 0, status: 'playing',
  };
  setup();
  save();
  startTimer();
}

function setup() {
  const N = state.n * state.n;
  endpointOf = new Int16Array(N).fill(-1);
  state.ends.forEach(([a, b], k) => { endpointOf[a] = k; endpointOf[b] = k; });
  svg.setAttribute('viewBox', `0 0 ${state.n} ${state.n}`);
  render();
}

// ---------- 線の操作 ----------
const isComplete = (k, p) => {
  if (p.length < 2) return false;
  const [a, b] = state.ends[k];
  return (p[0] === a && p[p.length - 1] === b) || (p[0] === b && p[p.length - 1] === a);
};
const adjacent = (a, b) => {
  const n = state.n;
  return (Math.abs(a - b) === n) || (Math.abs(a - b) === 1 && Math.floor(a / n) === Math.floor(b / n));
};
const clonePaths = (ps) => ps.map((p) => p.slice());

function cellAt(e) {
  const r = svg.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * state.n);
  const y = Math.floor(((e.clientY - r.top) / r.height) * state.n);
  if (x < 0 || y < 0 || x >= state.n || y >= state.n) return -1;
  return y * state.n + x;
}

function beginStroke(c) {
  let k = endpointOf[c], path;
  if (k >= 0) {
    path = [c];                                   // 端点から新しく引き直す
  } else {
    k = state.paths.findIndex((p) => p.includes(c));
    if (k < 0) return;
    const p = state.paths[k];
    path = p.slice(0, p.indexOf(c) + 1);          // 途中から引き直す
  }
  const before = clonePaths(state.paths);
  const base = clonePaths(state.paths);
  base[k] = [];
  stroke = { k, path, before, base };
  applyStroke();
}

// 指の位置まで1マスずつ進める（速くなぞってマスを飛ばしても途切れないように）
function moveStroke(target) {
  if (!stroke || target < 0) return;
  const n = state.n;
  let guard = 0;
  while (stroke.path[stroke.path.length - 1] !== target && guard++ < 40) {
    const h = stroke.path[stroke.path.length - 1];
    const hx = h % n, hy = (h / n) | 0, tx = target % n, ty = (target / n) | 0;
    const dx = tx - hx, dy = ty - hy;
    const next = Math.abs(dx) >= Math.abs(dy) ? h + Math.sign(dx) : h + Math.sign(dy) * n;
    if (!stepTo(next)) break;
  }
  applyStroke();
}

function stepTo(c) {
  const { k, path } = stroke;
  const idx = path.indexOf(c);
  if (idx >= 0) { path.length = idx + 1; return true; }        // 戻る
  if (!adjacent(path[path.length - 1], c)) return false;
  if (isComplete(k, path)) return false;                       // つながった後は伸ばさない
  if (endpointOf[c] >= 0 && endpointOf[c] !== k) return false; // 他の数字には入れない
  path.push(c);
  return true;
}

// なぞっている線と重なった他の線は、重なった所から先を一時的に切る
function applyStroke() {
  const { k, path, base } = stroke;
  const used = new Set(path);
  state.paths = base.map((p, j) => {
    if (j === k) return path.slice();
    const cut = p.findIndex((c) => used.has(c));
    return cut < 0 ? p.slice() : p.slice(0, cut);
  });
  render();
}

function endStroke() {
  if (!stroke) return;
  const changed = JSON.stringify(stroke.before) !== JSON.stringify(state.paths);
  if (changed) {
    state.history.push(stroke.before);
    if (state.history.length > 100) state.history.shift();
  }
  stroke = null;
  render();
  checkWin();
  save();
}

// ---------- ボタンの操作 ----------
function undo() {
  if (state.status !== 'playing') return;
  const prev = state.history.pop();
  if (!prev) return;
  state.paths = prev;
  render(); save();
}

function clearAll() {
  if (state.status !== 'playing') return;
  if (state.paths.every((p) => p.length <= 1)) return;
  state.history.push(clonePaths(state.paths));
  state.paths = state.ends.map(() => []);
  render(); save();
}

// まだ正解と違う色を1本、正解の線で引く
function hint() {
  if (state.status !== 'playing') return;
  const k = state.solution.findIndex((sol, j) => {
    const p = state.paths[j];
    return !(p.length === sol.length && (p.every((c, t) => c === sol[t]) || p.every((c, t) => c === sol[sol.length - 1 - t])));
  });
  if (k < 0) return;
  state.history.push(clonePaths(state.paths));
  const sol = state.solution[k], used = new Set(sol);
  state.paths = state.paths.map((p, j) => {
    if (j === k) return sol.slice();
    const cut = p.findIndex((c) => used.has(c));
    return cut < 0 ? p : p.slice(0, cut);
  });
  state.hints++;
  render(); checkWin(); save();
}

function showAnswer() {
  if (state.status !== 'playing') return;
  if (!confirm('答えを表示しますか？（この問題は記録に残りません）')) return;
  state.paths = state.solution.map((p) => p.slice());
  state.status = 'gaveup';
  stopTimer();
  render(); save();
  $('#note').textContent = '答えを表示しました。「新しく」で次の問題へ';
  $('#note').className = 'note';
}

// ---------- クリア判定 ----------
function checkWin() {
  if (state.status !== 'playing') return;
  if (LinkCore.isSolved(state.n, state.ends, state.paths)) {
    state.status = 'won';
    stopTimer();
    const stats = load(STATS_KEY) || {};
    const s = stats[state.level] || { cleared: 0, best: null };
    s.cleared++;
    let newBest = false;
    if (state.hints === 0 && (s.best === null || state.elapsed < s.best)) { s.best = state.elapsed; newBest = true; }
    stats[state.level] = s;
    store(STATS_KEY, stats);
    setTimeout(() => {
      $('#dialogBody').textContent =
        `${LEVELS[state.level].name} ${state.n}×${state.n}\n` +
        `タイム ${fmt(state.elapsed)}${newBest ? '（自己ベスト！）' : ''}` +
        `${state.hints ? `\nヒント ${state.hints} 回（記録対象外）` : ''}\n` +
        `ベスト ${s.best === null ? '--:--' : fmt(s.best)}・クリア ${s.cleared} 回`;
      $('#overlay').hidden = false;
    }, 250);
  }
}

// ---------- タイマー ----------
function startTimer() {
  stopTimer();
  if (state.status !== 'playing') return;
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

// ---------- 描画（SVG） ----------
function el(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function render() {
  const n = state.n;
  svg.textContent = '';

  // 線が通っているマスを薄く塗る
  state.paths.forEach((p, k) => {
    for (const c of p) {
      svg.appendChild(el('rect', { x: c % n, y: (c / n) | 0, width: 1, height: 1, fill: COLORS[k], 'fill-opacity': 0.2 }));
    }
  });

  // マス目
  for (let i = 1; i < n; i++) {
    svg.appendChild(el('line', { x1: i, y1: 0, x2: i, y2: n, class: 'gl' }));
    svg.appendChild(el('line', { x1: 0, y1: i, x2: n, y2: i, class: 'gl' }));
  }

  // 線
  state.paths.forEach((p, k) => {
    if (p.length < 2) return;
    const pts = p.map((c) => `${(c % n) + 0.5},${((c / n) | 0) + 0.5}`).join(' ');
    svg.appendChild(el('polyline', {
      points: pts, fill: 'none', stroke: COLORS[k], 'stroke-width': 0.32,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));
  });

  // 端点（数字）
  state.ends.forEach(([a, b], k) => {
    const done = isComplete(k, state.paths[k]);
    for (const c of [a, b]) {
      const cx = (c % n) + 0.5, cy = ((c / n) | 0) + 0.5;
      svg.appendChild(el('circle', { cx, cy, r: done ? 0.4 : 0.36, fill: COLORS[k] }));
      const t = el('text', {
        x: cx, y: cy + 0.015, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': 0.46, fill: DARK_TEXT.has(k) ? '#1f2430' : '#fff',
      });
      t.textContent = k + 1;
      svg.appendChild(t);
    }
  });

  // 進み具合
  const doneCount = state.paths.filter((p, k) => isComplete(k, p)).length;
  // 端点は最初から埋まっている扱い
  const endSet = new Set(state.ends.flat());
  const filledAll = new Set([...state.paths.flat(), ...endSet]).size;
  $('#lines').textContent = `ライン ${doneCount}/${state.ends.length}`;
  $('#fill').textContent = `埋め ${Math.floor((filledAll / (n * n)) * 100)}%`;
  $('#timer').textContent = fmt(state.elapsed);
  $('#level').value = state.level;

  const note = $('#note');
  if (state.status === 'playing') {
    if (doneCount === state.ends.length && filledAll < n * n) {
      note.textContent = '全部つながりました。空いているマスも埋めよう';
      note.className = 'note warn';
    } else {
      note.textContent = '同じ数字同士を線でつなぎ、すべてのマスを埋めよう';
      note.className = 'note';
    }
  }
}

// ---------- 入力 ----------
svg.addEventListener('pointerdown', (e) => {
  if (state.status !== 'playing') return;
  const c = cellAt(e);
  if (c < 0) return;
  svg.setPointerCapture(e.pointerId);
  beginStroke(c);
});
svg.addEventListener('pointermove', (e) => { if (stroke) moveStroke(cellAt(e)); });
svg.addEventListener('pointerup', endStroke);
svg.addEventListener('pointercancel', endStroke);

$('#undo').addEventListener('click', undo);
$('#clear').addEventListener('click', clearAll);
$('#hint').addEventListener('click', hint);
$('#answer').addEventListener('click', showAnswer);

const inProgress = () => state && state.status === 'playing' && state.history.length > 0;
$('#restart').addEventListener('click', () => {
  if (inProgress() && !confirm('今の問題をやめて新しい問題にしますか？')) return;
  newGame(state.level);
});
$('#level').addEventListener('change', (e) => {
  if (inProgress() && !confirm('今の問題をやめて難易度を変えますか？')) { e.target.value = state.level; return; }
  newGame(Number(e.target.value));
});
$('#dialogBtn').addEventListener('click', () => { $('#overlay').hidden = true; newGame(state.level); });

document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);

// ---------- 起動 ----------
(function init() {
  const saved = load(SAVE_KEY);
  if (saved && saved.ends && saved.paths && LEVELS[saved.level]) {
    state = saved;
    setup();
    if (state.status === 'playing') startTimer();
    else if (state.status === 'won' || state.status === 'gaveup') {
      $('#note').textContent = '「新しく」で次の問題へ';
    }
  } else {
    newGame(1);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
