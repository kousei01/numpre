// ===== パタパタ 描画・入力・ゲームの流れ =====
'use strict';

const STATS_KEY = 'flappy-stats-v1';
const LEVEL_KEY = 'flappy-level';
const SOUND_KEY = 'flappy-sound';

const F = FlappyCore;
const DT = 1 / 120;                  // 物理の刻み（画面のリフレッシュレートに関係なく一定）
const $ = (q) => document.querySelector(q);
const stage = $('#stage');
const cv = $('#cv');
const ctx = cv.getContext('2d');

const MEDALS = [
  { min: 100, icon: '🏆', name: 'プラチナ' },
  { min: 50,  icon: '🥇', name: 'ゴールド' },
  { min: 25,  icon: '🥈', name: 'シルバー' },
  { min: 10,  icon: '🥉', name: 'ブロンズ' },
];

// ---------- 保存 ----------
function load(key, def) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? def; } catch { return def; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

let level = Math.min(4, Math.max(0, load(LEVEL_KEY, 0)));
let sound = load(SOUND_KEY, false);

// ---------- 状態 ----------
// mode: ready（スタート待ち）→ playing → dying（落ちていく）→ over（結果表示）／ paused（一時停止）
let game = null;
let W = 360;                        // 論理幅（画面の縦横比で決まる）
let scale = 1;                      // 論理ピクセル → 実ピクセル
let pendingFlap = false;
let particles = [];
let flash = 0, shake = 0, scorePop = 0, readyT = 0, wingT = 0;
let acc = 0, lastT = 0;

function newGame() {
  game = { mode: 'ready', world: F.createWorld(level, W), deadT: 0 };
  particles = [];
  flash = shake = scorePop = 0;
  pendingFlap = false;
  $('#pause').hidden = true;
  $('#overlay').hidden = true;
  updateBest();
}

// ---------- 画面サイズ ----------
function resize() {
  const width = stage.clientWidth;
  const top = stage.getBoundingClientRect().top + window.scrollY;
  const avail = window.innerHeight - top - 16;
  const height = Math.max(360, Math.min(avail, width * 1.9));
  stage.style.height = `${height}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.round(width * dpr);
  cv.height = Math.round(height * dpr);
  scale = cv.height / F.H;
  const newW = Math.round(F.H * (width / height));
  // プレイ中に幅を変えると柱の位置がずれるので、スタート前だけ作り直す
  if (newW !== W) { W = newW; if (!game || game.mode === 'ready') newGame(); }
}

// ---------- 入力 ----------
function tap() {
  ensureAudio();
  if (!game) return;
  if (game.mode === 'ready') { game.mode = 'playing'; $('#pause').hidden = false; pendingFlap = true; }
  else if (game.mode === 'playing') pendingFlap = true;
  else if (game.mode === 'paused') { game.mode = 'playing'; $('#pause').hidden = false; pendingFlap = true; }
}
stage.addEventListener('pointerdown', (e) => {
  if (e.target === $('#pause')) return;
  e.preventDefault();
  tap();
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); if ($('#overlay').hidden) tap(); else retry(); }
});
$('#pause').addEventListener('pointerdown', (e) => { e.stopPropagation(); });
$('#pause').addEventListener('click', () => pause());
function pause() {
  if (game && game.mode === 'playing') { game.mode = 'paused'; $('#pause').hidden = true; }
}
// 動画アプリに切り替えたときなど、画面が隠れたら自動で一時停止
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);

// ---------- ゲームの進行 ----------
function update(dt) {
  wingT += dt;
  readyT += dt;
  flash = Math.max(0, flash - dt * 3);
  shake = Math.max(0, shake - dt);
  scorePop = Math.max(0, scorePop - dt * 4);
  updateParticles(dt);
  if (!game) return;
  const w = game.world;

  if (game.mode === 'playing') {
    const flap = pendingFlap;
    pendingFlap = false;
    if (flap) { puff(w.bird.x - 10, w.bird.y + 4); wingT = 0; if (sound) sfxFlap(); }
    const ev = F.step(w, dt, flap);
    if (ev.scored) {
      scorePop = 1;
      const p = w.pipes.find((q) => q.passed && q.x + F.PIPE_W < w.bird.x && q.x + F.PIPE_W > w.bird.x - 40);
      sparkle(w.bird.x + 20, p ? p.gapY : w.bird.y);
      if (sound) sfxScore();
    }
    if (ev.hit) crash();
  } else if (game.mode === 'dying') {
    const landed = F.fall(w, dt);
    game.deadT += dt;
    if (landed && game.deadT > 0.6 && !game.shown) { game.shown = true; showResult(); }
  }
}

function crash() {
  game.mode = 'dying';
  game.deadT = 0;
  $('#pause').hidden = true;
  flash = 1; shake = 0.35;
  feathers(game.world.bird.x, game.world.bird.y);
  if (sound) sfxHit();
  if (navigator.vibrate) navigator.vibrate(60);
}

// ---------- 結果 ----------
function showResult() {
  game.mode = 'over';
  const score = game.world.score;
  const stats = load(STATS_KEY, {});
  const s = stats[level] || { best: 0, plays: 0, total: 0 };
  s.plays++; s.total += score;
  const isNew = score > s.best;
  if (isNew) s.best = score;
  stats[level] = s;
  store(STATS_KEY, stats);
  updateBest();

  const medal = MEDALS.find((m) => score >= m.min);
  const md = $('#medal');
  md.textContent = medal ? medal.icon : '🪶';
  md.classList.remove('pop'); void md.offsetWidth; md.classList.add('pop');
  $('#dialogTitle').textContent = medal ? `${medal.name}メダル！` : 'ゲームオーバー';
  $('#resScore').textContent = score;
  $('#resBest').innerHTML = isNew && score > 0 ? `${s.best}<span class="new-best"> NEW</span>` : s.best;
  const nextMedal = [...MEDALS].reverse().find((m) => score < m.min);
  $('#dialogBody').textContent =
    `${F.LEVELS[level].name}・プレイ ${s.plays} 回\n` +
    (nextMedal ? `${nextMedal.icon} ${nextMedal.name}まで あと ${nextMedal.min - score}` : '最高のメダルを獲得！');
  if (sound && medal) setTimeout(sfxMedal, 200);
  // 連打の勢いで「もう一度」を押してしまわないように、少しだけ待ってから押せるようにする
  const btn = $('#retry');
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, 450);
  $('#overlay').hidden = false;
}
function retry() { if (!$('#retry').disabled) newGame(); }
$('#retry').addEventListener('click', retry);

function updateBest() {
  const s = load(STATS_KEY, {})[level];
  $('#best').textContent = `ベスト ${s ? s.best : 0}`;
  $('#level').value = level;
  $('#sound').textContent = sound ? '🔊' : '🔇';
}
$('#level').addEventListener('change', (e) => {
  level = Number(e.target.value);
  store(LEVEL_KEY, level);
  newGame();
  e.target.blur();
});
$('#sound').addEventListener('click', () => {
  sound = !sound;
  store(SOUND_KEY, sound);
  if (sound) { ensureAudio(); sfxScore(); }
  updateBest();
});

// ---------- パーティクル ----------
function puff(x, y) {
  for (let k = 0; k < 4; k++) {
    particles.push({ t: 'puff', x, y, vx: -60 - Math.random() * 60, vy: (Math.random() - 0.3) * 60, life: 0.35, max: 0.35, r: 3 + Math.random() * 3 });
  }
}
function sparkle(x, y) {
  for (let k = 0; k < 10; k++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 120;
    particles.push({ t: 'star', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5, max: 0.5, r: 3 + Math.random() * 3 });
  }
}
function feathers(x, y) {
  for (let k = 0; k < 12; k++) {
    const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 160;
    particles.push({ t: 'feather', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 1.1, max: 1.1, r: 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10 });
  }
}
function updateParticles(dt) {
  for (const p of particles) {
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.t === 'feather') { p.vy += 300 * dt; p.vx *= 0.98; p.rot += p.vr * dt; }
    else { p.vx *= 0.94; p.vy *= 0.94; }
  }
  particles = particles.filter((p) => p.life > 0);
}

// ---------- 描画 ----------
// 空の色：昼 → 夕方 → 夜 → 朝 → 昼 …（進んだ距離で少しずつ変わる）
const SKIES = [
  { top: '#59b7ff', bottom: '#c9ecff', hill: '#7fc98a', night: 0 },  // 昼
  { top: '#ff8a65', bottom: '#ffd59e', hill: '#c98a6a', night: 0.15 },// 夕方
  { top: '#0d1b3d', bottom: '#3a4a7a', hill: '#2c3b5e', night: 1 },  // 夜
  { top: '#8ec5ff', bottom: '#ffe0c2', hill: '#8fc79a', night: 0.1 }, // 朝
];
const CYCLE = 14000;   // 空が一周する距離（昼→夕方→夜→朝）
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`; };
function sky(dist) {
  const f = ((dist % CYCLE) / CYCLE) * SKIES.length;
  const i = Math.floor(f), t = f - i;
  // 色が切り替わるのは区間の最後 35% だけ（それ以外はその時間帯の色）
  const k = Math.max(0, (t - 0.65) / 0.35);
  const a = SKIES[i], b = SKIES[(i + 1) % SKIES.length];
  return { top: mix(a.top, b.top, k), bottom: mix(a.bottom, b.bottom, k), hill: mix(a.hill, b.hill, k), night: a.night + (b.night - a.night) * k };
}

const STARS = Array.from({ length: 45 }, () => ({ x: Math.random(), y: Math.random() * 0.6, r: Math.random() * 1.3 + 0.4, tw: Math.random() * 6 }));
const CLOUDS = Array.from({ length: 6 }, (_, k) => ({ x: k / 6 + Math.random() * 0.1, y: 40 + Math.random() * 220, s: 0.6 + Math.random() * 0.7 }));

function draw() {
  const w = game.world;
  const sc = sky(w.dist);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  let sx = 0, sy = 0;
  if (shake > 0) { sx = (Math.random() - 0.5) * 16 * shake / 0.35; sy = (Math.random() - 0.5) * 16 * shake / 0.35; }
  ctx.setTransform(scale, 0, 0, scale, sx * scale, sy * scale);

  // 空
  const g = ctx.createLinearGradient(0, 0, 0, w.groundY);
  g.addColorStop(0, sc.top); g.addColorStop(1, sc.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(-20, -20, W + 40, F.H + 40);

  // 星（夜だけ）
  if (sc.night > 0.2) {
    for (const s of STARS) {
      ctx.globalAlpha = (sc.night - 0.2) * (0.6 + 0.4 * Math.sin(readyT * 2 + s.tw));
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(s.x * W, s.y * F.H, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // 太陽と月
  ctx.globalAlpha = 1 - sc.night;
  ctx.fillStyle = '#fff3b0';
  ctx.beginPath(); ctx.arc(W * 0.78, 110, 26, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = sc.night;
  ctx.fillStyle = '#f4f1d0';
  ctx.beginPath(); ctx.arc(W * 0.78, 110, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = sc.top;
  ctx.beginPath(); ctx.arc(W * 0.78 + 9, 104, 17, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // 雲（ゆっくり流れる）
  ctx.fillStyle = sc.night > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)';
  for (const c of CLOUDS) {
    const x = ((c.x * (W + 160) - w.dist * 0.15) % (W + 160) + (W + 160)) % (W + 160) - 80;
    cloud(x, c.y, c.s);
  }

  // 遠くの丘
  ctx.fillStyle = sc.hill;
  ctx.beginPath();
  ctx.moveTo(0, w.groundY);
  for (let x = 0; x <= W + 10; x += 10) {
    const t = (x + w.dist * 0.35) / 90;
    ctx.lineTo(x, w.groundY - 40 - Math.sin(t) * 18 - Math.sin(t * 0.37 + 1) * 22);
  }
  ctx.lineTo(W, w.groundY); ctx.closePath(); ctx.fill();

  // 柱
  for (const p of w.pipes) pillar(p, w.groundY, sc.night);

  // 地面
  ground(w);

  // パーティクル
  for (const p of particles) {
    const a = Math.max(0, p.life / p.max);
    ctx.globalAlpha = a;
    if (p.t === 'puff') { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.5 - a * 0.5), 0, Math.PI * 2); ctx.fill(); }
    if (p.t === 'star') { ctx.fillStyle = '#ffe066'; star(p.x, p.y, p.r); }
    if (p.t === 'feather') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = '#ff9a7a'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;

  // 鳥
  const b = w.bird;
  let by = b.y;
  if (game.mode === 'ready') by = w.H * 0.42 + Math.sin(readyT * 3) * 8;
  let ang = Math.max(-0.45, Math.min(1.35, b.vy / 650));
  if (game.mode === 'ready') ang = 0;
  bird(b.x, by, ang, game.mode === 'dying' || game.mode === 'over');

  // スコア
  if (game.mode !== 'ready') {
    const s = 1 + scorePop * 0.35;
    ctx.save();
    ctx.translate(W / 2, 74); ctx.scale(s, s);
    ctx.font = '900 52px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(31,36,48,0.85)'; ctx.lineJoin = 'round';
    ctx.strokeText(w.score, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillText(w.score, 0, 0);
    ctx.restore();
  }

  // スタート前
  if (game.mode === 'ready') {
    banner(`${F.LEVELS[level].name}`, 'タップでスタート', w.H * 0.62);
    ctx.font = '40px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('👆', W / 2, w.H * 0.62 + 92 + Math.sin(readyT * 6) * 6);
  }
  // 一時停止
  if (game.mode === 'paused') {
    ctx.fillStyle = 'rgba(15,19,27,0.45)';
    ctx.fillRect(-20, -20, W + 40, F.H + 40);
    banner('一時停止中', 'タップで再開', w.H * 0.45);
  }

  // ぶつかった瞬間の白いフラッシュ
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flash * 0.8})`;
    ctx.fillRect(-20, -20, W + 40, F.H + 40);
  }
}

function cloud(x, y, s) {
  ctx.beginPath();
  ctx.arc(x, y, 18 * s, 0, Math.PI * 2);
  ctx.arc(x + 20 * s, y - 10 * s, 22 * s, 0, Math.PI * 2);
  ctx.arc(x + 44 * s, y, 18 * s, 0, Math.PI * 2);
  ctx.arc(x + 22 * s, y + 6 * s, 18 * s, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// 柱：やわらかいミント色の円柱。すき間側に少し太いふち
function pillar(p, groundY, night) {
  const x = p.x, w = F.PIPE_W;
  const top = p.gapY - p.gap / 2, bottom = p.gapY + p.gap / 2;
  const body = ctx.createLinearGradient(x, 0, x + w, 0);
  body.addColorStop(0, '#5fd3b0'); body.addColorStop(0.35, '#8ae6c9'); body.addColorStop(1, '#3aa88a');
  ctx.fillStyle = body;
  ctx.fillRect(x + 4, -10, w - 8, top + 10);
  ctx.fillRect(x + 4, bottom, w - 8, groundY - bottom);
  // ふち
  const cap = ctx.createLinearGradient(x - 5, 0, x + w + 5, 0);
  cap.addColorStop(0, '#4cc4a0'); cap.addColorStop(0.35, '#a3f0d6'); cap.addColorStop(1, '#2f9478');
  ctx.fillStyle = cap;
  roundRect(x - 4, top - 24, w + 8, 24, 7); ctx.fill();
  roundRect(x - 4, bottom, w + 8, 24, 7); ctx.fill();
  // 縦の模様
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x + 14, -10, 6, top - 14);
  ctx.fillRect(x + 14, bottom + 24, 6, groundY - bottom - 24);
  if (night > 0.3) {
    ctx.fillStyle = `rgba(13,27,61,${(night - 0.3) * 0.5})`;
    ctx.fillRect(x - 4, -10, w + 8, top + 10);
    ctx.fillRect(x - 4, bottom, w + 8, groundY - bottom);
  }
}

function ground(w) {
  const y = w.groundY;
  ctx.fillStyle = '#e9cf98';
  ctx.fillRect(-20, y, W + 40, F.GROUND + 20);
  // 進む方向に流れる斜めの模様
  ctx.fillStyle = 'rgba(160,120,60,0.18)';
  const off = w.dist % 28;
  for (let x = -40 - off; x < W + 40; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, y + 14); ctx.lineTo(x + 14, y + 14); ctx.lineTo(x + 34, y + F.GROUND); ctx.lineTo(x + 20, y + F.GROUND);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#7ccf6a';
  ctx.fillRect(-20, y, W + 40, 12);
  ctx.fillStyle = '#5fb24f';
  ctx.fillRect(-20, y + 12, W + 40, 3);
}

// 主人公：まんまるのコーラル色の鳥（オリジナル）
function bird(x, y, ang, dead) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const R = F.BIRD_R + 2;
  // 体
  const body = ctx.createRadialGradient(-4, -5, 2, 0, 0, R);
  body.addColorStop(0, '#ffb199'); body.addColorStop(1, '#ff6f4f');
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  // おなか
  ctx.fillStyle = '#ffe3d6';
  ctx.beginPath(); ctx.ellipse(1, 6, 9, 6.5, 0, 0, Math.PI * 2); ctx.fill();
  // しっぽ
  ctx.fillStyle = '#ff6f4f';
  ctx.beginPath(); ctx.moveTo(-R + 2, -2); ctx.lineTo(-R - 7, -7); ctx.lineTo(-R - 5, 3); ctx.closePath(); ctx.fill();
  // 羽（羽ばたいた直後は大きく動く）
  const flapPhase = dead ? 0 : Math.sin(Math.min(wingT, 0.3) / 0.3 * Math.PI * 2 + readyT * 4) * (wingT < 0.3 ? 1 : 0.35);
  ctx.save();
  ctx.translate(-3, 1);
  ctx.rotate(-0.3 - flapPhase * 0.9);
  ctx.fillStyle = '#ff8a6e';
  ctx.beginPath(); ctx.ellipse(-2, 0, 9, 5.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 目
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(6, -5, 5.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1f2430';
  if (dead) {
    ctx.lineWidth = 1.6; ctx.strokeStyle = '#1f2430';
    ctx.beginPath(); ctx.moveTo(4, -7); ctx.lineTo(8, -3); ctx.moveTo(8, -7); ctx.lineTo(4, -3); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(7.2, -5, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(8, -6, 0.9, 0, Math.PI * 2); ctx.fill();
  }
  // ほっぺ
  ctx.fillStyle = 'rgba(255,90,110,0.45)';
  ctx.beginPath(); ctx.ellipse(4, 3, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
  // くちばし
  ctx.fillStyle = '#ffc23d';
  ctx.beginPath(); ctx.moveTo(R - 2, -3); ctx.lineTo(R + 7, 0); ctx.lineTo(R - 2, 3); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function star(x, y, r) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}

function banner(title, sub, y) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = '900 34px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif';
  ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(31,36,48,0.85)';
  ctx.strokeText(title, W / 2, y); ctx.fillStyle = '#fff'; ctx.fillText(title, W / 2, y);
  ctx.font = '800 20px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif';
  ctx.lineWidth = 5;
  ctx.strokeText(sub, W / 2, y + 42); ctx.fillStyle = '#fff3b0'; ctx.fillText(sub, W / 2, y + 42);
}

// ---------- ループ（物理は 1/120 秒刻み、描画は画面の更新ごと） ----------
function frame(t) {
  if (!lastT) lastT = t;
  let dt = (t - lastT) / 1000;
  lastT = t;
  if (dt > 0.1) dt = 0.1;              // 画面が止まっていた後に一気に進まないように
  acc += dt;
  while (acc >= DT) { update(DT); acc -= DT; }
  draw();
  requestAnimationFrame(frame);
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
function tone(f1, f2, dur, vol, type = 'sine', delay = 0) {
  if (!actx) ensureAudio();
  if (!actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const sfxFlap = () => tone(380, 620, 0.07, 0.05, 'triangle');
const sfxScore = () => { tone(880, 880, 0.08, 0.05); tone(1320, 1320, 0.14, 0.05, 'sine', 0.07); };
const sfxHit = () => tone(220, 60, 0.25, 0.08, 'sawtooth');
const sfxMedal = () => [784, 988, 1175, 1568].forEach((f, k) => tone(f, f, 0.3, 0.04, 'sine', k * 0.08));

// ---------- 起動 ----------
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();
if (!game) newGame();
updateBest();
requestAnimationFrame(frame);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// 自動テスト用（遊ぶ上では使わない）
window.__flappy = { get game() { return game; }, tap, pause };
