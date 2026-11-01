// ===== ドミノ倒し 画面・操作・演出・保存 =====
'use strict';

const SAVE_KEY = 'domino-save-v1';
const STATS_KEY = 'domino-stats-v1';
const HELP_KEY = 'domino-help-seen';
const SOUND_KEY = 'domino-sound';

const LEVELS = [
  { name: '入門', n: 4, opts: { holes: 0, minimize: false, extra: 1 } },
  { name: '初級', n: 5, opts: { holes: 1, minimize: true, extra: 2 } },
  { name: '中級', n: 6, opts: { holes: 2, minimize: true } },
  { name: '上級', n: 7, opts: { holes: 3, minimize: true } },
  { name: '鬼',   n: 8, opts: { holes: 6, minimize: true } },
];

const { DX, DY, step, simulate } = DominoCore;
const $ = (q) => document.querySelector(q);
const board = $('#board');
const SVGNS = 'http://www.w3.org/2000/svg';

let state = null;
let animating = false;
let timerId = null;
let sound = false;
try { sound = localStorage.getItem(SOUND_KEY) === '1'; } catch {}

// ---------- 保存 ----------
function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
function save() { if (state) store(SAVE_KEY, state); }

// ---------- 問題生成（Web Worker） ----------
let worker = null, reqId = 0;
try { worker = new Worker('domino-worker.js'); } catch { worker = null; }
function generate(level) {
  const L = LEVELS[level];
  if (!worker) return Promise.resolve(DominoCore.generate(L.n, L.opts));
  const id = ++reqId;
  return new Promise((resolve) => {
    const h = (e) => { if (e.data.id === id) { worker.removeEventListener('message', h); resolve(e.data); } };
    worker.addEventListener('message', h);
    worker.postMessage({ id, n: L.n, opts: L.opts });
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

  // 鍵のないドミノはランダムな向きから
  const arrows = p.answer.map((d, i) => (p.holes[i] ? -1 : p.locked[i] >= 0 ? p.locked[i] : Math.floor(Math.random() * 4)));
  state = {
    level, n: p.n, holes: p.holes, start: p.start, answer: p.answer,
    locked: p.locked.map((d) => d >= 0),
    hinted: p.answer.map(() => false),
    arrows, history: [], elapsed: 0, hints: 0, tries: 0, status: 'playing',
  };
  setup();
  save();
  startTimer();
}

// ---------- 盤面の組み立て ----------
let pieces = [];        // マスごとの { g, rect, arrow, lock }
let stopMark = null;

function el(parent, tag, attrs, text) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

function setup() {
  const { n } = state;
  board.setAttribute('viewBox', `0 0 ${n} ${n}`);
  board.textContent = '';
  const floor = el(board, 'g', {});
  const layer = el(board, 'g', {});
  pieces = [];
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = (i / n) | 0;
    if (state.holes[i]) { pieces.push(null); continue; }
    el(floor, 'rect', {
      x: x + 0.05, y: y + 0.05, width: 0.9, height: 0.9, rx: 0.14,
      fill: i === state.start ? 'var(--d-start)' : 'var(--d-floor)',
    });
    if (i === state.start) {
      // 右上の角にスタートの印（矢印や🔒と重ならない位置）
      el(floor, 'circle', { cx: x + 0.82, cy: y + 0.18, r: 0.13, fill: 'var(--d-hint)' });
      el(floor, 'text', {
        x: x + 0.82, y: y + 0.185, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': 0.16, 'font-weight': 900, fill: '#fff', style: 'pointer-events:none',
      }, 'S');
    }
  }
  // 手前（下の行）のドミノが上に重なるように、上の行から順に置く
  for (let i = 0; i < n * n; i++) {
    if (state.holes[i]) continue;
    const g = el(layer, 'g', {});
    const rect = el(g, 'rect', { rx: 0.05 });
    const arrow = el(g, 'polygon', {});
    const lock = el(g, 'text', {
      x: (i % n) + 0.2, y: ((i / n) | 0) + 0.27, 'text-anchor': 'middle', 'font-size': 0.2, style: 'pointer-events:none',
    }, '🔒');
    pieces[i] = { g, rect, arrow, lock };
  }
  stopMark = el(board, 'rect', { fill: 'none', stroke: 'var(--d-stop)', 'stroke-width': 0.08, rx: 0.14, opacity: 0 });
  render();
}

// ドミノの形：p = 0 で立っている、1 で倒れきった状態
const T = 0.2, WD = 0.72, LF = 0.9;
function geom(i, d, p) {
  const n = state.n, cx = (i % n) + 0.5, cy = ((i / n) | 0) + 0.5;
  const len = T + (LF - T) * p;
  if (d === 1) return { x: cx - T / 2, y: cy - WD / 2, w: len, h: WD };
  if (d === 3) return { x: cx + T / 2 - len, y: cy - WD / 2, w: len, h: WD };
  if (d === 0) return { x: cx - WD / 2, y: cy + T / 2 - len, w: WD, h: len };
  return { x: cx - WD / 2, y: cy - T / 2, w: WD, h: len };
}
function arrowPoints(i, d) {
  const n = state.n, cx = (i % n) + 0.5, cy = ((i / n) | 0) + 0.5;
  // 上向きの三角形を回転
  const pts = [[0, -0.42], [-0.12, -0.2], [0.12, -0.2]];
  const rot = ([x, y]) => {
    const a = (Math.PI / 2) * d, c = Math.cos(a), s = Math.sin(a);
    return [cx + x * c - y * s, cy + x * s + y * c];
  };
  return pts.map(rot).map((p) => p.join(',')).join(' ');
}
const rainbow = (k, total) => `hsl(${(205 + (k / Math.max(1, total - 1)) * 300) % 360} 80% 58%)`;

function setPiece(i, d, p, color) {
  const pc = pieces[i];
  const g = geom(i, d, p);
  pc.rect.setAttribute('x', g.x); pc.rect.setAttribute('y', g.y);
  pc.rect.setAttribute('width', g.w); pc.rect.setAttribute('height', g.h);
  pc.rect.setAttribute('fill', color);
  pc.arrow.setAttribute('points', arrowPoints(i, d));
  pc.arrow.setAttribute('fill', color);
  pc.arrow.setAttribute('opacity', p > 0 ? 0 : 1);
  pc.lock.setAttribute('opacity', p > 0 ? 0 : (state.locked[i] || state.hinted[i]) ? 1 : 0);
}

function pieceColor(i) {
  if (state.hinted[i]) return 'var(--d-hint)';
  if (state.locked[i]) return 'var(--d-lock)';
  return 'var(--d-piece)';
}

// 立っている状態で全部描く（クリア済みなら倒れた状態で描く）
function render() {
  const { n } = state;
  if (state.status === 'won' || state.status === 'gaveup') {
    const sim = simulate(n, state.holes, state.start, state.arrows);
    sim.order.forEach((c, k) => setPiece(c, state.arrows[c], 1, rainbow(k, sim.total)));
  } else {
    for (let i = 0; i < n * n; i++) if (pieces[i]) setPiece(i, state.arrows[i], 0, pieceColor(i));
  }
  renderStatus();
}

function starsFor(tries, hints) {
  let s = tries === 0 ? 3 : tries <= 2 ? 2 : 1;
  if (hints > 0) s = Math.min(s, 2);
  return s;
}
function starHTML(s) { return [1, 2, 3].map((k) => `<span class="${k <= s ? '' : 'off'}">★</span>`).join(''); }

function renderStatus() {
  $('#timer').textContent = fmt(state.elapsed);
  $('#level').value = state.level;
  $('#tries').textContent = state.status === 'playing' ? `挑戦 ${state.tries + 1}回目` : `挑戦 ${state.tries + 1}回`;
  $('#stars').innerHTML = starHTML(starsFor(state.tries, state.hints));
  $('#push').disabled = animating || state.status !== 'playing';
  $('#soundIcon').textContent = sound ? '🔊' : '🔇';
  $('#soundLabel').textContent = sound ? '音 ON' : '音 OFF';
}

function note(text, cls = '') { const e = $('#note'); e.textContent = text; e.className = 'note ' + cls; }

// ---------- 入力：タップで回転、スワイプで向き指定 ----------
let press = null;
function cellAt(e) {
  const r = board.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * state.n);
  const y = Math.floor(((e.clientY - r.top) / r.height) * state.n);
  if (x < 0 || y < 0 || x >= state.n || y >= state.n) return -1;
  return y * state.n + x;
}
board.addEventListener('pointerdown', (e) => {
  if (animating || state.status !== 'playing') return;
  const i = cellAt(e);
  if (i < 0 || state.holes[i]) return;
  board.setPointerCapture(e.pointerId);
  press = { i, x: e.clientX, y: e.clientY };
});
board.addEventListener('pointerup', (e) => {
  if (!press) return;
  const { i } = press;
  const r = board.getBoundingClientRect();
  const cell = r.width / state.n;
  const dx = e.clientX - press.x, dy = e.clientY - press.y;
  press = null;
  if (state.locked[i] || state.hinted[i]) {
    note('🔒 のドミノは動かせません', 'bad');
    return;
  }
  let d;
  if (Math.hypot(dx, dy) > cell * 0.3) {
    d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
  } else {
    d = (state.arrows[i] + 1) % 4;
  }
  if (d === state.arrows[i]) return;
  state.history.push(state.arrows.slice());
  if (state.history.length > 200) state.history.shift();
  state.arrows[i] = d;
  setPiece(i, d, 0, pieceColor(i));
  note('タップで回転・スワイプで向きを指定。全部倒れるように並べよう');
  if (sound) blip(520, 0.03, 0.04);
  save();
});
board.addEventListener('pointercancel', () => { press = null; });

// ---------- 倒す！ ----------
function push() {
  if (animating || state.status !== 'playing') return;
  const sim = simulate(state.n, state.holes, state.start, state.arrows);
  animating = true;
  renderStatus();
  ensureAudio();
  run(sim.order, sim.total, () => {
    if (sim.all) win(sim);
    else fail(sim);
  });
}

// 連鎖のアニメーション（倒れはじめる時刻をずらして、前のドミノが当たった瞬間に次が倒れる）
function run(order, total, done, speed = 1) {
  const starts = [];
  let t = 0;
  order.forEach((c, k) => {
    starts.push(t);
    const dur = Math.max(95, 175 - k * 3) / speed;
    t += dur * 0.55;
  });
  const durOf = (k) => Math.max(95, 175 - k * 3) / speed;
  const t0 = performance.now();
  let lastPlayed = -1;

  function frame(now) {
    const elapsed = now - t0;
    let finished = true;
    order.forEach((c, k) => {
      const s = starts[k], d = durOf(k);
      if (elapsed < s) { finished = false; return; }
      const p = Math.min(1, (elapsed - s) / d);
      if (p < 1) finished = false;
      const e = p * p; // だんだん速く倒れる
      setPiece(c, state.arrows[c], e, p > 0.45 ? rainbow(k, total) : pieceColor(c));
      if (k > lastPlayed) { lastPlayed = k; if (sound) blip(330 + Math.min(k, 60) * 14, 0.05, 0.05); }
    });
    if (!finished) requestAnimationFrame(frame);
    else done();
  }
  requestAnimationFrame(frame);
}

function fail(sim) {
  const { n } = state;
  const last = sim.last, d = state.arrows[last];
  const reasonText = { edge: '盤の外に倒れた', hole: '穴に倒れた', fallen: '倒れたドミノにぶつかった' }[sim.reason];
  note(`${reasonText}… ${sim.order.length} / ${sim.total} 枚`, 'bad');
  // 止まった場所を赤で示す
  const tx = (last % n) + DX[d], ty = ((last / n) | 0) + DY[d];
  stopMark.setAttribute('x', tx + 0.05); stopMark.setAttribute('y', ty + 0.05);
  stopMark.setAttribute('width', 0.9); stopMark.setAttribute('height', 0.9);
  stopMark.setAttribute('opacity', 1);
  board.classList.remove('shake'); void board.offsetWidth; board.classList.add('shake');
  if (sound) blip(140, 0.18, 0.08, 'sawtooth');

  setTimeout(() => {
    // 起き上がる
    const order = sim.order;
    const t0 = performance.now();
    function frame(now) {
      const p = Math.min(1, (now - t0) / 260);
      order.forEach((c, k) => setPiece(c, state.arrows[c], 1 - p, p > 0.5 ? pieceColor(c) : rainbow(k, sim.total)));
      if (p < 1) requestAnimationFrame(frame);
      else {
        stopMark.setAttribute('opacity', 0);
        state.tries++;
        animating = false;
        render();
        note(`${reasonText}… ${sim.order.length} / ${sim.total} 枚。向きを直してもう一度！`, 'bad');
        save();
      }
    }
    requestAnimationFrame(frame);
  }, 1300);
}

function win(sim) {
  state.status = 'won';
  stopTimer();
  animating = false;
  board.classList.remove('win'); void board.offsetWidth; board.classList.add('win');
  if (sound) chord();
  note('全部倒れた！', 'good');
  const stars = starsFor(state.tries, state.hints);
  const stats = load(STATS_KEY) || {};
  const s = stats[state.level] || { cleared: 0, best: null, perfect: 0 };
  s.cleared++;
  if (stars === 3) s.perfect++;
  let newBest = false;
  if (state.hints === 0 && (s.best === null || state.elapsed < s.best)) { s.best = state.elapsed; newBest = true; }
  stats[state.level] = s;
  store(STATS_KEY, stats);
  save();
  renderStatus();
  setTimeout(() => {
    $('#dialogStars').innerHTML = starHTML(stars);
    $('#dialogTitle').textContent = stars === 3 ? '一発で全部倒れた！' : '全部倒れた！';
    $('#dialogBody').textContent =
      `${LEVELS[state.level].name} ${state.n}×${state.n}・${sim.total} 枚\n` +
      `タイム ${fmt(state.elapsed)}${newBest ? '（自己ベスト！）' : ''}\n` +
      `挑戦 ${state.tries + 1} 回${state.hints ? `・ヒント ${state.hints} 回` : ''}\n` +
      `ベスト ${s.best === null ? '--:--' : fmt(s.best)}・★3 ${s.perfect} 回／クリア ${s.cleared} 回`;
    $('#overlay').hidden = false;
  }, 900);
}

// ---------- ボタン ----------
function undo() {
  if (animating || state.status !== 'playing') return;
  const prev = state.history.pop();
  if (!prev) return;
  state.arrows = prev;
  render(); save();
}
function reset() {
  if (animating || state.status !== 'playing') return;
  state.history.push(state.arrows.slice());
  state.arrows = state.arrows.map((d, i) => (state.holes[i] || state.locked[i] || state.hinted[i] ? d : 0));
  render(); save();
}
// スタートから答えの順にたどり、最初に向きが違うドミノを正しい向きにして固定する
function hint() {
  if (animating || state.status !== 'playing') return;
  const path = simulate(state.n, state.holes, state.start, state.answer).order;
  const c = path.slice(0, -1).find((i) => state.arrows[i] !== state.answer[i]);
  if (c === undefined) { note('並びは合っています。「倒す！」を押そう', 'good'); return; }
  state.history.push(state.arrows.slice());
  state.arrows[c] = state.answer[c];
  state.hinted[c] = true;
  state.hints++;
  render(); save();
  note('💡 1枚の向きを直して固定しました');
}
function showAnswer() {
  if (animating || state.status !== 'playing') return;
  if (!confirm('答えを表示しますか？（この問題は記録に残りません）')) return;
  state.arrows = state.answer.slice();
  stopTimer();
  render();
  // 答えでも連鎖を見せる
  const sim = simulate(state.n, state.holes, state.start, state.arrows);
  animating = true; renderStatus(); ensureAudio();
  run(sim.order, sim.total, () => {
    animating = false;
    state.status = 'gaveup';
    render(); save();
    note('答えを表示しました。「新しく」で次の問題へ');
  });
}

// ---------- 音（WebAudio。動画を見ながら遊ぶことも考えて初期設定はOFF） ----------
let actx = null;
function ensureAudio() {
  if (!sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { actx = null; }
}
function blip(freq, dur, vol, type = 'triangle') {
  if (!actx) ensureAudio();
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function chord() {
  [523, 659, 784, 1047].forEach((f, k) => setTimeout(() => blip(f, 0.35, 0.06), k * 90));
}

// ---------- タイマー ----------
function startTimer() {
  stopTimer();
  if (state.status !== 'playing') return;
  timerId = setInterval(() => {
    if (document.hidden || !$('#helpBox').hidden) return;
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

// ---------- イベント ----------
$('#push').addEventListener('click', push);
$('#undo').addEventListener('click', undo);
$('#reset').addEventListener('click', reset);
$('#hint').addEventListener('click', hint);
$('#answer').addEventListener('click', showAnswer);
$('#sound').addEventListener('click', () => {
  sound = !sound;
  try { localStorage.setItem(SOUND_KEY, sound ? '1' : '0'); } catch {}
  if (sound) { ensureAudio(); blip(660, 0.08, 0.06); }
  renderStatus();
});
$('#helpClose').addEventListener('click', () => { $('#helpBox').hidden = true; store(HELP_KEY, true); });

const inProgress = () => state && state.status === 'playing' && (state.history.length > 0 || state.tries > 0);
$('#restart').addEventListener('click', () => {
  if (animating) return;
  if (inProgress() && !confirm('今の問題をやめて新しい問題にしますか？')) return;
  newGame(state.level);
});
$('#level').addEventListener('change', (e) => {
  if (animating) { e.target.value = state.level; return; }
  if (inProgress() && !confirm('今の問題をやめて難易度を変えますか？')) { e.target.value = state.level; return; }
  newGame(Number(e.target.value));
});
$('#dialogBtn').addEventListener('click', () => { $('#overlay').hidden = true; newGame(state.level); });
$('#dialogClose').addEventListener('click', () => { $('#overlay').hidden = true; });

document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);

// ---------- 起動 ----------
(function init() {
  // 前の版の「影ブロック」のデータを片付ける
  try { ['shadow-save-v1', 'shadow-stats-v1', 'shadow-help-seen'].forEach((k) => localStorage.removeItem(k)); } catch {}

  const saved = load(SAVE_KEY);
  if (saved && saved.arrows && saved.holes && LEVELS[saved.level]) {
    state = saved;
    setup();
    if (state.status === 'playing') startTimer();
    else note('「新しく」で次の問題へ');
  } else {
    newGame(0);
  }
  if (!load(HELP_KEY)) $('#helpBox').hidden = false;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
