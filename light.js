// ===== 光の回路 画面・操作・演出・保存 =====
'use strict';

const SAVE_KEY = 'light-save-v1';
const STATS_KEY = 'light-stats-v1';
const HELP_KEY = 'light-help-seen';
const SOUND_KEY = 'light-sound';

const LEVELS = [
  { name: '入門', cfg: { n: 5, sources: 1, mirrors: 6,  splits: 0, walls: 0, gems: 3, minTouched: 4 } },
  { name: '初級', cfg: { n: 6, sources: 1, mirrors: 8,  splits: 0, walls: 2, gems: 4, minTouched: 6 } },
  { name: '中級', cfg: { n: 6, sources: 1, mirrors: 8,  splits: 1, walls: 2, gems: 5, minTouched: 7 } },
  { name: '上級', cfg: { n: 7, sources: 2, mirrors: 11, splits: 1, walls: 2, gems: 6, minTouched: 9 } },
  { name: '鬼',   cfg: { n: 8, sources: 2, mirrors: 14, splits: 2, walls: 3, gems: 7, minTouched: 12 } },
];

const { WALL, SOURCE, MIRROR, SPLIT, DX, DY } = LightCore;
const $ = (q) => document.querySelector(q);
const board = $('#board');
const SVGNS = 'http://www.w3.org/2000/svg';

let state = null;
let timerId = null;
let gameId = 0;          // 問題が変わったら増やす（前の問題の演出が残らないように）
let sound = false;
try { sound = localStorage.getItem(SOUND_KEY) === '1'; } catch {}

// ---------- 保存 ----------
function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
function save() { if (state) store(SAVE_KEY, state); }

// ---------- ゲーム ----------
function newGame(level) {
  const p = LightCore.generate(LEVELS[level].cfg);
  state = {
    level, n: p.n, kind: p.kind, src: p.src, gems: p.gems,
    solution: p.solution, touched: p.touched, par: p.par, start: p.start,
    orient: p.start.slice(),
    locked: p.kind.map(() => false),
    history: [], taps: 0, hints: 0, elapsed: 0, status: 'playing',
  };
  setup();
  save();
  startTimer();
}

const boardOf = () => ({ n: state.n, kind: state.kind, src: state.src, gems: state.gems });
const twoColor = () => state.src.length === 2;
function colorOf(bits) {
  if (!twoColor()) return '#ffd54a';
  return { 1: '#ff4d5e', 2: '#4da3ff', 3: '#c06bff' }[bits] || '#ffffff';
}

// ---------- 盤面の組み立て ----------
let layers = {}, mirrorEls = [], gemEls = {}, angles = [];
let prevGood = new Set();

function el(parent, tag, attrs, text) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

function setup() {
  gameId++;
  const { n, kind } = state;
  board.setAttribute('viewBox', `0 0 ${n} ${n}`);
  board.textContent = '';
  board.classList.remove('solved');
  const defs = el(board, 'defs', {});
  const f = el(defs, 'filter', { id: 'glow', x: '-60%', y: '-60%', width: '220%', height: '220%' });
  el(f, 'feGaussianBlur', { stdDeviation: 0.07, result: 'b' });
  const m = el(f, 'feMerge', {});
  el(m, 'feMergeNode', { in: 'b' }); el(m, 'feMergeNode', { in: 'SourceGraphic' });

  layers.cells = el(board, 'g', {});
  layers.beams = el(board, 'g', { class: 'beams' });
  layers.items = el(board, 'g', {});
  layers.gems = el(board, 'g', {});
  layers.fx = el(board, 'g', {});

  mirrorEls = []; gemEls = {}; angles = [];
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = (i / n) | 0;
    el(layers.cells, 'rect', { x: x + 0.04, y: y + 0.04, width: 0.92, height: 0.92, rx: 0.1, fill: 'var(--l-cell)' });
    if (kind[i] === WALL) {
      el(layers.items, 'rect', { x: x + 0.1, y: y + 0.1, width: 0.8, height: 0.8, rx: 0.1, fill: 'var(--l-wall)' });
      el(layers.items, 'rect', { x: x + 0.1, y: y + 0.1, width: 0.8, height: 0.14, rx: 0.07, fill: '#fff', 'fill-opacity': 0.08 });
    }
    if (kind[i] === MIRROR || kind[i] === SPLIT) {
      angles[i] = state.orient[i] * 90;
      const g = el(layers.items, 'g', { class: 'rot tappable' });
      el(g, 'rect', { x: x + 0.12, y: y + 0.12, width: 0.76, height: 0.76, fill: 'transparent' }); // 回転の中心をマスの中心に
      if (kind[i] === MIRROR) {
        el(g, 'line', { x1: x + 0.2, y1: y + 0.8, x2: x + 0.8, y2: y + 0.2, stroke: 'var(--l-mirror)', 'stroke-width': 0.1, 'stroke-linecap': 'round' });
      } else {
        el(g, 'line', { x1: x + 0.2, y1: y + 0.8, x2: x + 0.8, y2: y + 0.2, stroke: 'var(--l-split)', 'stroke-width': 0.08, 'stroke-linecap': 'round', 'stroke-dasharray': '0.1 0.07', opacity: 0.9 });
      }
      el(g, 'circle', { cx: x + 0.5, cy: y + 0.5, r: 0.06, fill: '#7b8496' });
      g.style.transform = `rotate(${angles[i]}deg)`;
      const pin = el(layers.items, 'circle', { cx: x + 0.84, cy: y + 0.16, r: 0.07, fill: '#f0b44c', opacity: 0 });
      mirrorEls[i] = { g, pin };
    }
  }
  // 光源
  for (const s of state.src) {
    const x = s.cell % n, y = (s.cell / n) | 0, c = colorOf(s.color);
    el(layers.items, 'circle', { cx: x + 0.5, cy: y + 0.5, r: 0.3, fill: c, filter: 'url(#glow)' });
    el(layers.items, 'circle', { cx: x + 0.5, cy: y + 0.5, r: 0.14, fill: '#fff' });
    const tip = [x + 0.5 + DX[s.dir] * 0.45, y + 0.5 + DY[s.dir] * 0.45];
    const side = [DY[s.dir] * 0.14, -DX[s.dir] * 0.14];
    const base = [x + 0.5 + DX[s.dir] * 0.3, y + 0.5 + DY[s.dir] * 0.3];
    el(layers.items, 'polygon', {
      points: `${tip} ${base[0] + side[0]},${base[1] + side[1]} ${base[0] - side[0]},${base[1] - side[1]}`, fill: c,
    });
  }
  // 宝石
  for (const c in state.gems) {
    const i = Number(c), x = i % n, y = (i / n) | 0, r = 0.25;
    const g = el(layers.gems, 'g', { class: 'gem' });
    const shape = el(g, 'polygon', {
      points: `${x + 0.5},${y + 0.5 - r} ${x + 0.5 + r},${y + 0.5} ${x + 0.5},${y + 0.5 + r} ${x + 0.5 - r},${y + 0.5}`,
      'stroke-width': 0.05, 'stroke-linejoin': 'round',
    });
    const shine = el(g, 'polygon', {
      points: `${x + 0.5},${y + 0.5 - r * 0.6} ${x + 0.5 + r * 0.35},${y + 0.5 - r * 0.1} ${x + 0.5},${y + 0.5}`,
      fill: '#fff', opacity: 0,
    });
    gemEls[i] = { g, shape, shine };
  }
  buildLegend();
  prevGood = new Set();
  render(true);
}

function buildLegend() {
  const lg = $('#legend');
  const parts = [];
  if (twoColor()) {
    parts.push(`<span><i style="background:#ff4d5e"></i>赤だけ</span>`);
    parts.push(`<span><i style="background:#4da3ff"></i>青だけ</span>`);
    parts.push(`<span><i style="background:#c06bff"></i>赤＋青</span>`);
  }
  if (state.kind.includes(SPLIT)) parts.push(`<span style="color:#5bb8d6">┅ ハーフミラー（光が分かれる）</span>`);
  lg.innerHTML = parts.join('');
}

// ---------- 描画（光は毎回たどり直す） ----------
function render(initial = false) {
  const { n } = state;
  const t = LightCore.trace(boardOf(), state.orient);
  const ev = LightCore.evaluate(boardOf(), t.lit);

  // 光
  layers.beams.textContent = '';
  for (const s of t.segs) {
    const c = colorOf(s.color);
    const a = { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, 'stroke-linecap': 'round' };
    el(layers.beams, 'line', { ...a, stroke: c, 'stroke-width': 0.26, opacity: 0.45, filter: 'url(#glow)' });
    el(layers.beams, 'line', { ...a, class: 'core', stroke: c, 'stroke-width': 0.1 });
    el(layers.beams, 'line', { ...a, class: 'flow', stroke: '#fff', 'stroke-width': 0.035, opacity: 0.55 });
  }

  // 宝石
  const good = new Set();
  for (const c in state.gems) {
    const i = Number(c), want = state.gems[c], got = t.lit[i];
    const { g, shape, shine } = gemEls[i];
    const col = colorOf(want);
    g.classList.remove('lit');
    if (got === want) {
      good.add(i);
      g.classList.add('lit');
      shape.setAttribute('fill', col); shape.setAttribute('stroke', '#fff'); shape.setAttribute('filter', 'url(#glow)');
      shine.setAttribute('opacity', 0.7);
      shape.removeAttribute('stroke-dasharray');
    } else if (got & ~want) {          // 余計な色が当たっている
      shape.setAttribute('fill', '#2a2f3a'); shape.setAttribute('stroke', '#ff4d5e'); shape.removeAttribute('filter');
      shape.setAttribute('stroke-dasharray', '0.06 0.05');
      shine.setAttribute('opacity', 0);
    } else {                            // まだ当たっていない（または色が足りない）
      shape.setAttribute('fill', got ? colorOf(got) : '#1f2532');
      shape.setAttribute('fill-opacity', got ? 0.35 : 1);
      shape.setAttribute('stroke', col); shape.removeAttribute('filter');
      shape.removeAttribute('stroke-dasharray');
      shine.setAttribute('opacity', 0);
    }
    if (got === want) shape.setAttribute('fill-opacity', 1);
  }
  // 新しく光った宝石を弾ませる
  if (!initial) {
    let k = 0;
    for (const i of good) {
      if (prevGood.has(i)) continue;
      const g = gemEls[i].g;
      g.classList.remove('pop'); void g.getBBox(); g.classList.add('pop');
      if (sound) blip(523 * Math.pow(2, (good.size + k) / 12 * 2), 0.18, 0.05);
      k++;
    }
  }
  prevGood = good;

  // 鏡の向き・固定ピン
  for (let i = 0; i < n * n; i++) {
    if (!mirrorEls[i]) continue;
    mirrorEls[i].g.style.transform = `rotate(${angles[i]}deg)`;
    mirrorEls[i].pin.setAttribute('opacity', state.locked[i] ? 1 : 0);
  }

  // 表示
  $('#gems').textContent = `💎 ${ev.ok} / ${ev.total}`;
  $('#taps').textContent = `${state.taps} 手（目安 ${state.par} 手）`;
  $('#stars').innerHTML = starHTML(starsFor());
  $('#timer').textContent = fmt(state.elapsed);
  $('#level').value = state.level;
  $('#soundIcon').textContent = sound ? '🔊' : '🔇';
  $('#soundLabel').textContent = sound ? '音 ON' : '音 OFF';

  if (state.status === 'playing') {
    if (ev.wrong) note('赤い点線の宝石に、余計な色の光が当たっています', 'bad');
    else if (ev.ok === ev.total - 1) note('あと1個！');
    else note('鏡をタップして向きを変え、全部の宝石に光を当てよう');
  }
  return ev;
}

function note(text, cls = '') { const e = $('#note'); e.textContent = text; e.className = 'note ' + cls; }

function starsFor() {
  let s = state.taps <= state.par ? 3 : state.taps <= state.par + 3 ? 2 : 1;
  if (state.hints > 0) s = Math.min(s, 2);
  return s;
}
function starHTML(s) { return [1, 2, 3].map((k) => `<span class="${k <= s ? '' : 'off'}">★</span>`).join(''); }

// ---------- 入力 ----------
board.addEventListener('click', (e) => {
  if (state.status !== 'playing') return;
  const r = board.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * state.n);
  const y = Math.floor(((e.clientY - r.top) / r.height) * state.n);
  if (x < 0 || y < 0 || x >= state.n || y >= state.n) return;
  const i = y * state.n + x;
  if (state.kind[i] !== MIRROR && state.kind[i] !== SPLIT) return;
  if (state.locked[i]) { note('ピンで留めた鏡は動かせません', 'bad'); return; }
  state.history.push(state.orient.slice());
  if (state.history.length > 200) state.history.shift();
  state.orient[i] = 1 - state.orient[i];
  angles[i] += 90;                         // いつも時計回りに回す
  state.taps++;
  if (sound) blip(880, 0.03, 0.03);
  const ev = render();
  if (ev.solved) win();
  save();
});

// ---------- クリア ----------
function win(gaveup = false) {
  state.status = gaveup ? 'gaveup' : 'won';
  stopTimer();
  board.classList.add('solved');
  // 宝石から光の輪を広げる（順番に）
  const id = gameId, n = state.n;
  Object.entries(state.gems).forEach(([c, want], k) => {
    const color = colorOf(want);
    setTimeout(() => {
      if (id !== gameId) return;
      const i = Number(c), x = i % n, y = (i / n) | 0;
      const ring = el(layers.fx, 'circle', {
        class: 'ring', cx: x + 0.5, cy: y + 0.5, r: 0.3, fill: 'none', stroke: color, 'stroke-width': 0.06,
      });
      setTimeout(() => ring.remove(), 1000);
    }, k * 110);
  });
  if (gaveup) { note('答えを表示しました。「新しく」で次の問題へ'); save(); return; }
  if (sound) setTimeout(chord, 150);
  note('回路完成！', 'good');

  const stars = starsFor();
  const stats = load(STATS_KEY) || {};
  const s = stats[state.level] || { cleared: 0, best: null, perfect: 0 };
  s.cleared++;
  if (stars === 3) s.perfect++;
  let newBest = false;
  if (state.hints === 0 && (s.best === null || state.elapsed < s.best)) { s.best = state.elapsed; newBest = true; }
  stats[state.level] = s;
  store(STATS_KEY, stats);
  save();
  const id2 = gameId;
  setTimeout(() => {
    if (id2 !== gameId) return;
    $('#dialogStars').innerHTML = starHTML(stars);
    $('#dialogTitle').textContent = stars === 3 ? '最短で回路完成！' : '回路完成！';
    $('#dialogBody').textContent =
      `${LEVELS[state.level].name} ${state.n}×${state.n}・宝石 ${Object.keys(state.gems).length} 個\n` +
      `${state.taps} 手（目安 ${state.par} 手）${state.hints ? `・ヒント ${state.hints} 回` : ''}\n` +
      `タイム ${fmt(state.elapsed)}${newBest ? '（自己ベスト！）' : ''}\n` +
      `ベスト ${s.best === null ? '--:--' : fmt(s.best)}・★3 ${s.perfect} 回／クリア ${s.cleared} 回`;
    $('#overlay').hidden = false;
  }, 1300);
}

// ---------- ボタン ----------
function syncAngles() {
  for (let i = 0; i < state.n * state.n; i++) {
    if (!mirrorEls[i]) continue;
    // 見た目の向きを、なるべく近い回転で合わせる
    if (((angles[i] / 90) % 2 + 2) % 2 !== state.orient[i]) angles[i] += 90;
  }
}
function undo() {
  if (state.status !== 'playing') return;
  const prev = state.history.pop();
  if (!prev) return;
  state.orient = prev;
  syncAngles();
  render(); save();
}
function reset() {
  if (state.status !== 'playing') return;
  state.history.push(state.orient.slice());
  state.orient = state.start.map((o, i) => (state.locked[i] ? state.solution[i] : o));
  syncAngles();
  render(); save();
}
// 今の光が当たっている鏡のうち、向きが違うものを優先して1つ直し、ピンで留める
function hint() {
  if (state.status !== 'playing') return;
  const t = LightCore.trace(boardOf(), state.orient);
  const wrong = state.touched.filter((c) => state.orient[c] !== state.solution[c]);
  if (!wrong.length) return;
  const c = wrong.find((i) => t.touched.has(i)) ?? wrong[0];
  state.history.push(state.orient.slice());
  state.orient[c] = state.solution[c];
  state.locked[c] = true;
  state.hints++;
  syncAngles();
  const ev = render();
  note('💡 鏡を1枚直して、ピンで留めました');
  if (ev.solved) win();
  save();
}
function showAnswer() {
  if (state.status !== 'playing') return;
  if (!confirm('答えを表示しますか？（この問題は記録に残りません）')) return;
  for (const c of state.touched) state.orient[c] = state.solution[c];
  syncAngles();
  render();
  win(true);
}

// ---------- 音（初期設定 OFF） ----------
let actx = null;
function ensureAudio() {
  if (!sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { actx = null; }
}
function blip(freq, dur, vol, type = 'sine') {
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
function chord() { [784, 988, 1175, 1568].forEach((f, k) => setTimeout(() => blip(f, 0.5, 0.05), k * 80)); }

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
$('#undo').addEventListener('click', undo);
$('#reset').addEventListener('click', reset);
$('#hint').addEventListener('click', hint);
$('#answer').addEventListener('click', showAnswer);
$('#sound').addEventListener('click', () => {
  sound = !sound;
  try { localStorage.setItem(SOUND_KEY, sound ? '1' : '0'); } catch {}
  if (sound) { ensureAudio(); blip(988, 0.1, 0.05); }
  $('#soundIcon').textContent = sound ? '🔊' : '🔇';
  $('#soundLabel').textContent = sound ? '音 ON' : '音 OFF';
});
$('#helpClose').addEventListener('click', () => { $('#helpBox').hidden = true; store(HELP_KEY, true); });

const inProgress = () => state && state.status === 'playing' && state.taps > 0;
$('#restart').addEventListener('click', () => {
  if (inProgress() && !confirm('今の問題をやめて新しい問題にしますか？')) return;
  newGame(state.level);
});
$('#level').addEventListener('change', (e) => {
  if (inProgress() && !confirm('今の問題をやめて難易度を変えますか？')) { e.target.value = state.level; return; }
  newGame(Number(e.target.value));
});
$('#dialogBtn').addEventListener('click', () => { $('#overlay').hidden = true; newGame(state.level); });
$('#dialogClose').addEventListener('click', () => { $('#overlay').hidden = true; });

document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);

// ---------- 起動 ----------
(function init() {
  const saved = load(SAVE_KEY);
  if (saved && saved.kind && saved.orient && LEVELS[saved.level]) {
    state = saved;
    setup();
    if (state.status === 'playing') startTimer();
    else { board.classList.add('solved'); note('「新しく」で次の問題へ'); }
  } else {
    newGame(0);
  }
  if (!load(HELP_KEY)) $('#helpBox').hidden = false;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
