// ===== ころころ惑星 描画・入力・ゲームの流れ =====
'use strict';

const SAVE_KEY = 'merge-save-v1';
const STATS_KEY = 'merge-stats-v1';
const SOUND_KEY = 'merge-sound';
const HELP_KEY = 'merge-help-seen';

const M = MergeCore;
const DT = 1 / 120;
const COOLDOWN = 0.45;               // 連続で落とせる間隔（秒）
const $ = (q) => document.querySelector(q);
const stage = $('#stage');
const cv = $('#cv');
const ctx = cv.getContext('2d');

function load(key, def) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? def; } catch { return def; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

let world = null;
let aimX = 200;
let cool = 0;
let scale = 1;
let particles = [], texts = [], rings = [];
let sunFlash = 0, t = 0, acc = 0, lastT = 0, saveT = 0, overShown = false;
let sound = load(SOUND_KEY, false);

// ---------- 開始・保存 ----------
function newGame() {
  world = M.createWorld();
  particles = []; texts = []; rings = []; sunFlash = 0; overShown = false; cool = 0;
  $('#overlay').hidden = true;
  save();
  updateHud();
  drawChain();
}
function save() { if (world) store(SAVE_KEY, M.serialize(world)); }

// ---------- 画面サイズ ----------
function resize() {
  const width = stage.parentElement.clientWidth;
  const top = stage.getBoundingClientRect().top + window.scrollY;
  const avail = window.innerHeight - top - 16 - 52;       // 下の「合体の順番」のぶん
  const w = Math.min(width, Math.max(260, avail) * (M.W / M.H));
  const h = w * (M.H / M.W);
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  scale = cv.width / M.W;
  drawChain();
}

// ---------- 入力：指を動かして狙い、離すと落とす ----------
let pressing = false;
function toWorldX(e) {
  const r = cv.getBoundingClientRect();
  return ((e.clientX - r.left) / r.width) * M.W;
}
stage.addEventListener('pointerdown', (e) => {
  if (!world || world.gameOver) return;
  e.preventDefault();
  stage.setPointerCapture(e.pointerId);
  pressing = true;
  aimX = toWorldX(e);
  ensureAudio();
});
stage.addEventListener('pointermove', (e) => { if (pressing || e.pointerType === 'mouse') aimX = toWorldX(e); });
stage.addEventListener('pointerup', (e) => {
  if (!pressing) return;
  pressing = false;
  aimX = toWorldX(e);
  tryDrop();
});
stage.addEventListener('pointercancel', () => { pressing = false; });
document.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft') aimX -= 12;
  if (e.code === 'ArrowRight') aimX += 12;
  if (e.code === 'Space') { e.preventDefault(); tryDrop(); }
});

function tryDrop() {
  if (!world || world.gameOver || cool > 0) return;
  M.drop(world, aimX);
  cool = COOLDOWN;
  drawChain();
  if (sound) tone(260, 180, 0.08, 0.05, 'triangle');
  updateHud();
}

// ---------- 進行 ----------
function update(dt) {
  t += dt;
  cool = Math.max(0, cool - dt);
  sunFlash = Math.max(0, sunFlash - dt * 1.2);
  for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.vx *= 0.97; }
  particles = particles.filter((p) => p.life > 0);
  for (const s of texts) { s.life -= dt; s.y -= 40 * dt; }
  texts = texts.filter((s) => s.life > 0);
  for (const r of rings) r.life -= dt;
  rings = rings.filter((r) => r.life > 0);
  if (!world) return;

  for (const e of M.step(world, dt)) {
    if (e.type === 'merge') onMerge(e);
    if (e.type === 'sun') onSun(e);
    if (e.type === 'gameover') onGameOver();
  }
  saveT += dt;
  if (saveT > 2) { saveT = 0; save(); }
}

const COLORS = ['#ffe066', '#a8865f', '#e9ecf2', '#a98bff', '#ff5a3c', '#ff8fb8', '#3f8be0', '#4a4ae0', '#5fe0d8', '#e8c27a', '#f08a3c'];

function onMerge(e) {
  const r = M.KINDS[e.level].r;
  rings.push({ x: e.x, y: e.y, r, color: COLORS[e.level], life: 0.45, max: 0.45 });
  for (let k = 0; k < 10 + e.level * 2; k++) {
    const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * (120 + e.level * 20);
    particles.push({ x: e.x + Math.cos(a) * r * 0.6, y: e.y + Math.sin(a) * r * 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0.6, max: 0.6, color: COLORS[e.level], size: 2 + Math.random() * 3 });
  }
  texts.push({ x: e.x, y: e.y - r * 0.4, text: `+${e.points}`, life: 0.9, max: 0.9, big: e.level >= 6 });
  if (e.level >= 6) texts.push({ x: e.x, y: e.y + 6, text: M.KINDS[e.level].name + '！', life: 1.1, max: 1.1, big: false, name: true });
  if (sound) tone(330 * Math.pow(2, e.level / 6), 520 * Math.pow(2, e.level / 6), 0.12, 0.05, 'sine');
  bumpScore();
  drawChain();
}

function onSun(e) {
  sunFlash = 1;
  for (let k = 0; k < 60; k++) {
    const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 380;
    particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 1.2, max: 1.2, color: Math.random() < 0.5 ? '#ffd23f' : '#ff8a3d', size: 3 + Math.random() * 4 });
  }
  texts.push({ x: M.W / 2, y: 260, text: '☀ 太陽誕生！', life: 2, max: 2, big: true, center: true });
  texts.push({ x: M.W / 2, y: 300, text: `+${e.points}`, life: 2, max: 2, big: false, center: true });
  if (sound) [523, 659, 784, 1047, 1319].forEach((f, k) => tone(f, f, 0.4, 0.045, 'sine', k * 0.09));
  bumpScore();
  drawChain();
}

function bumpScore() {
  const s = $('#score');
  s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop');
  updateHud();
}

function onGameOver() {
  if (overShown) return;
  overShown = true;
  const stats = load(STATS_KEY, { best: 0, plays: 0, bestLevel: 0, suns: 0 });
  stats.plays++;
  const isNew = world.score > stats.best;
  if (isNew) stats.best = world.score;
  stats.bestLevel = Math.max(stats.bestLevel || 0, world.maxLevel);
  stats.suns = (stats.suns || 0) + world.suns;
  store(STATS_KEY, stats);
  save();
  if (sound) tone(300, 90, 0.5, 0.07, 'sawtooth');
  setTimeout(() => {
    $('#resScore').textContent = world.score;
    $('#resBest').innerHTML = isNew && world.score > 0 ? `${stats.best}<span class="new-best"> NEW</span>` : stats.best;
    $('#dialogTitle').textContent = isNew && world.score > 0 ? 'ベスト更新！' : 'あふれた！';
    $('#dialogBody').textContent =
      `いちばん大きな惑星：${M.KINDS[world.maxLevel].name}` +
      `${world.suns ? `\n☀ 太陽を ${world.suns} 個つくった！` : ''}\n` +
      `合体 ${world.merges} 回・プレイ ${stats.plays} 回`;
    const bc = $('#bigCv').getContext('2d');
    bc.clearRect(0, 0, 160, 160);
    planet(bc, world.maxLevel, 80, 80, 60, 0);
    $('#overlay').hidden = false;
    updateHud();
  }, 900);
}

function updateHud() {
  if (!world) return;
  $('#score').textContent = world.score;
  $('#best').textContent = `ベスト ${load(STATS_KEY, { best: 0 }).best}`;
  $('#sound').textContent = sound ? '🔊' : '🔇';
}

// ---------- 描画 ----------
const STARS = Array.from({ length: 70 }, () => ({ x: Math.random() * M.W, y: Math.random() * M.H, r: Math.random() * 1.2 + 0.3, tw: Math.random() * 6 }));
const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif';

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // 宇宙の背景
  const g = ctx.createLinearGradient(0, 0, 0, M.H);
  g.addColorStop(0, '#0e1328'); g.addColorStop(1, '#232c52');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, M.W, M.H);
  for (const s of STARS) {
    ctx.globalAlpha = 0.4 + 0.4 * Math.sin(t * 1.5 + s.tw);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 箱（ガラスのビン）
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  roundRect(M.BOX_L, M.LINE_Y - 30, M.BOX_R - M.BOX_L, M.BOX_B - M.LINE_Y + 30, 18); ctx.fill();
  ctx.strokeStyle = 'rgba(200,220,255,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(M.BOX_L - 1.5, M.LINE_Y - 30);
  ctx.lineTo(M.BOX_L - 1.5, M.BOX_B - 16);
  ctx.quadraticCurveTo(M.BOX_L - 1.5, M.BOX_B + 1.5, M.BOX_L + 16, M.BOX_B + 1.5);
  ctx.lineTo(M.BOX_R - 16, M.BOX_B + 1.5);
  ctx.quadraticCurveTo(M.BOX_R + 1.5, M.BOX_B + 1.5, M.BOX_R + 1.5, M.BOX_B - 16);
  ctx.lineTo(M.BOX_R + 1.5, M.LINE_Y - 30);
  ctx.stroke();

  // あふれ線（危ないときは赤く点滅）
  const danger = world.danger || 0;
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = danger > 0 ? `rgba(255,80,90,${0.5 + 0.5 * Math.sin(t * 18)})` : 'rgba(255,255,255,0.28)';
  ctx.beginPath(); ctx.moveTo(M.BOX_L, M.LINE_Y); ctx.lineTo(M.BOX_R, M.LINE_Y); ctx.stroke();
  ctx.setLineDash([]);
  if (danger > 0) {
    ctx.fillStyle = `rgba(255,110,120,${0.6 + 0.4 * Math.sin(t * 18)})`;
    ctx.font = `800 12px ${FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('あふれそう！', M.BOX_R - 4, M.LINE_Y - 4);
  }

  // 狙いのガイド線と、落とす惑星（名前つき）
  const lv = world.current;
  if (!world.gameOver) {
    const r = M.KINDS[lv].r;
    const x = M.clampDropX(lv, aimX);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, M.DROP_Y + r); ctx.lineTo(x, M.BOX_B); ctx.stroke();
    ctx.globalAlpha = cool > 0 ? 0.35 : 1;
    planet(ctx, lv, x, M.DROP_Y, r, 0);
    ctx.globalAlpha = 1;
    label(M.KINDS[lv].name, x, M.DROP_Y - r - 9, 12);
  }

  // 次の惑星（名前つき）
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = `700 12px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('つぎ', M.W - 38, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.arc(M.W - 38, 54, 24, 0, Math.PI * 2); ctx.fill();
  planet(ctx, world.next, M.W - 38, 54, Math.min(20, M.KINDS[world.next].r), 0);
  label(M.KINDS[world.next].name, M.W - 38, 92, 11);

  // 惑星たち。今落とす惑星と同じ種類は点線の輪で光らせる（くっつける相手がひと目でわかる）
  for (const b of world.bodies) planet(ctx, b.level, b.x, b.y, b.r, b.angle);
  if (!world.gameOver) {
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -t * 20;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.35 * Math.sin(t * 5)})`;
    for (const b of world.bodies) {
      if (b.level !== lv) continue;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }
  for (const b of world.bodies) {
    if (b.over > 0) {        // 線を越えている惑星は赤く光る
      ctx.strokeStyle = `rgba(255,80,90,${0.4 + 0.4 * Math.sin(t * 18)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 2, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // 合体の輪・粒・得点
  for (const r of rings) {
    const k = 1 - r.life / r.max;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = r.color; ctx.lineWidth = 4 * (1 - k) + 1;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (1 + k * 0.8), 0, Math.PI * 2); ctx.stroke();
  }
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const s of texts) {
    ctx.globalAlpha = Math.min(1, s.life / s.max * 2);
    ctx.font = `900 ${s.big ? 26 : s.name ? 15 : 18}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(14,19,40,0.85)';
    ctx.strokeText(s.text, s.x, s.y);
    ctx.fillStyle = s.name ? '#fff3b0' : '#ffffff';
    ctx.fillText(s.text, s.x, s.y);
  }
  ctx.globalAlpha = 1;

  // 太陽ができた瞬間のまぶしい光
  if (sunFlash > 0) {
    const rg = ctx.createRadialGradient(M.W / 2, 280, 10, M.W / 2, 280, 420);
    rg.addColorStop(0, `rgba(255,236,150,${sunFlash})`);
    rg.addColorStop(1, `rgba(255,140,60,${sunFlash * 0.3})`);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, M.W, M.H);
  }
  // あふれた
  if (world.gameOver) {
    ctx.fillStyle = 'rgba(14,19,40,0.35)';
    ctx.fillRect(0, 0, M.W, M.H);
  }
}

// 縁取りつきの小さな文字
function label(text, x, y, size) {
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(14,19,40,0.9)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ---------- 惑星の絵（すべてオリジナル。転がると模様と顔が回る） ----------
// 見分けやすいように、本物の色にこだわらず、段階ごとに色の系統をはっきり変えている
//   ほし屑=黄 / 小惑星=茶 / 月=白 / 水星=紫 / 火星=赤 / 金星=ピンク / 地球=青と緑
//   海王星=藍 / 天王星=水色 / 土星=金色＋輪 / 木星=オレンジのしま
function planet(c, lv, x, y, r, angle) {
  c.save();
  c.translate(x, y);
  if (lv === 9) ring(c, r, true);            // 土星の輪（後ろ半分）
  c.save();
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
  c.rotate(angle);
  const base = (c1, c2) => {
    const gr = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    c.fillStyle = gr; c.fillRect(-r, -r, r * 2, r * 2);
  };
  const blob = (bx, by, br, color) => { c.fillStyle = color; c.beginPath(); c.arc(bx * r, by * r, br * r, 0, Math.PI * 2); c.fill(); };
  const band = (y0, h, color) => { c.fillStyle = color; c.fillRect(-r, y0 * r, r * 2, h * r); };
  switch (lv) {
    case 0: base('#fffbe0', '#ffcf3a'); break;                                  // ほし屑
    case 1:                                                                      // 小惑星：ごつごつの茶色
      base('#d6b48a', '#7a5a38');
      blob(0.3, 0.2, 0.22, 'rgba(70,45,20,0.35)'); blob(-0.35, -0.1, 0.16, 'rgba(70,45,20,0.35)'); blob(0.05, -0.45, 0.12, 'rgba(70,45,20,0.3)');
      break;
    case 2:                                                                      // 月：白っぽくクレーター
      base('#ffffff', '#c9cdd8');
      blob(-0.35, 0.25, 0.2, 'rgba(130,135,150,0.3)'); blob(0.35, -0.3, 0.14, 'rgba(130,135,150,0.3)'); blob(0.3, 0.45, 0.1, 'rgba(130,135,150,0.25)');
      break;
    case 3:                                                                      // 水星：むらさき
      base('#d9c8ff', '#7a5ad6');
      blob(-0.3, -0.35, 0.18, 'rgba(70,40,140,0.35)'); blob(0.4, 0.15, 0.2, 'rgba(70,40,140,0.3)'); blob(-0.2, 0.5, 0.12, 'rgba(70,40,140,0.3)');
      break;
    case 4:                                                                      // 火星：赤
      base('#ff8a6a', '#d0301e');
      blob(-0.3, 0.3, 0.3, 'rgba(120,20,10,0.35)'); blob(0.45, -0.2, 0.2, 'rgba(120,20,10,0.3)');
      band(-1.0, 0.22, 'rgba(255,255,255,0.8)');
      break;
    case 5:                                                                      // 金星：ピンク
      base('#ffd6e6', '#f0709e');
      band(-0.55, 0.18, 'rgba(200,60,110,0.22)'); band(0.05, 0.22, 'rgba(200,60,110,0.2)'); band(0.55, 0.15, 'rgba(200,60,110,0.22)');
      break;
    case 6:                                                                      // 地球：青い海と緑の陸
      base('#7cc4ff', '#1f5fc4');
      blob(-0.35, -0.15, 0.32, '#5cbf6a'); blob(-0.1, 0.1, 0.22, '#5cbf6a'); blob(0.45, 0.35, 0.26, '#5cbf6a'); blob(0.5, -0.45, 0.15, '#5cbf6a');
      band(-0.72, 0.1, 'rgba(255,255,255,0.65)'); band(0.62, 0.08, 'rgba(255,255,255,0.55)');
      break;
    case 7:                                                                      // 海王星：藍色
      base('#8a8aff', '#2a22a8');
      band(-0.3, 0.12, 'rgba(255,255,255,0.2)'); band(0.25, 0.1, 'rgba(20,10,90,0.35)');
      blob(0.35, -0.05, 0.14, 'rgba(15,10,80,0.45)');
      break;
    case 8:                                                                      // 天王星：水色
      base('#e0fffb', '#3cc9c0');
      band(-0.1, 0.1, 'rgba(255,255,255,0.4)');
      break;
    case 9:                                                                      // 土星：金色
      base('#fff0c8', '#d4a548');
      band(-0.55, 0.14, 'rgba(160,110,30,0.3)'); band(-0.15, 0.1, 'rgba(160,110,30,0.25)'); band(0.3, 0.16, 'rgba(160,110,30,0.3)');
      break;
    case 10:                                                                     // 木星：オレンジのしまと斑点
      base('#ffd2a0', '#e0702a');
      band(-0.7, 0.14, 'rgba(150,60,20,0.35)'); band(-0.35, 0.12, 'rgba(255,240,220,0.5)'); band(-0.05, 0.16, 'rgba(150,60,20,0.35)');
      band(0.3, 0.12, 'rgba(255,240,220,0.5)'); band(0.55, 0.16, 'rgba(150,60,20,0.3)');
      c.fillStyle = '#b8321e'; c.beginPath(); c.ellipse(0.35 * r, 0.38 * r, 0.2 * r, 0.11 * r, 0, 0, Math.PI * 2); c.fill();
      break;
  }
  if (r >= 11) face(c, r, lv);
  c.restore();
  // ふち
  c.strokeStyle = 'rgba(0,0,0,0.2)';
  c.lineWidth = Math.max(1, r * 0.05);
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
  if (lv === 0) {                             // ほし屑はきらきら
    c.fillStyle = 'rgba(255,255,255,0.95)';
    starShape(c, r * 0.95, -r * 0.85, r * 0.38);
  }
  if (lv === 9) ring(c, r, false);            // 土星の輪（手前半分）
  c.restore();
}

function ring(c, r, back) {
  c.save();
  c.rotate(-0.35);
  c.beginPath();
  if (back) c.ellipse(0, 0, r * 1.32, r * 0.32, 0, Math.PI, Math.PI * 2);
  else c.ellipse(0, 0, r * 1.32, r * 0.32, 0, 0, Math.PI);
  c.strokeStyle = 'rgba(240,210,150,0.95)';
  c.lineWidth = r * 0.12;
  c.stroke();
  c.restore();
}

function face(c, r, lv) {
  const light = lv === 7;                     // 藍色の海王星は白い目
  const ink = light ? '#ffffff' : '#2b2340';
  const ex = r * 0.3, ey = -r * 0.05, es = Math.max(1.2, r * 0.09);
  c.fillStyle = ink;
  c.beginPath(); c.arc(-ex, ey, es, 0, Math.PI * 2); c.arc(ex, ey, es, 0, Math.PI * 2); c.fill();
  if (r > 20 && !light) {
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(-ex + es * 0.35, ey - es * 0.4, es * 0.35, 0, Math.PI * 2); c.arc(ex + es * 0.35, ey - es * 0.4, es * 0.35, 0, Math.PI * 2); c.fill();
  }
  c.strokeStyle = ink; c.lineWidth = Math.max(1, r * 0.05); c.lineCap = 'round';
  c.beginPath(); c.arc(0, ey + r * 0.12, r * 0.12, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
  c.fillStyle = 'rgba(255,110,140,0.4)';
  c.beginPath(); c.ellipse(-ex * 1.45, ey + r * 0.18, r * 0.11, r * 0.07, 0, 0, Math.PI * 2); c.ellipse(ex * 1.45, ey + r * 0.18, r * 0.11, r * 0.07, 0, 0, Math.PI * 2); c.fill();
}

function starShape(c, x, y, r) {
  c.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, rr = k % 2 ? r * 0.3 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath(); c.fill();
}

// 下の「合体の順番」：名前つき。つくったことのある惑星は明るく、今と次の惑星には印
function drawChain() {
  const ch = $('#chain');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = ch.clientWidth, h = ch.clientHeight;
  if (!w) return;
  ch.width = Math.round(w * dpr); ch.height = Math.round(h * dpr);
  const c = ch.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const n = M.KINDS.length + 1;
  const step = w / n;
  const reached = world ? world.maxLevel : 0;
  const ink = getComputedStyle(document.body).color;
  for (let k = 0; k < n; k++) {
    const cx = step * (k + 0.5), cy = 20;
    const r = Math.min(step * 0.38, 7 + k * 0.9);
    const lit = k <= reached || (k === M.SUN && world && world.suns);
    // 今と次の惑星には下線
    if (world && (k === world.current || k === world.next)) {
      c.globalAlpha = 1;
      c.fillStyle = k === world.current ? '#ffb020' : 'rgba(127,127,127,0.6)';
      c.fillRect(cx - step * 0.38, h - 3, step * 0.76, 3);
    }
    c.globalAlpha = lit ? 1 : 0.3;
    if (k === M.SUN) {
      const gr = c.createRadialGradient(cx, cy, 1, cx, cy, r * 1.3);
      gr.addColorStop(0, '#fff6b0'); gr.addColorStop(0.6, '#ffb83f'); gr.addColorStop(1, 'rgba(255,120,40,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(cx, cy, r * 1.3, 0, Math.PI * 2); c.fill();
    } else {
      planet(c, k, cx, cy, r, 0);
    }
    c.fillStyle = ink;
    c.font = `700 ${Math.min(9, step * 0.27)}px ${FONT}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(k === M.SUN ? '太陽' : M.KINDS[k].name, cx, 42);
    if (k < n - 1) {
      c.globalAlpha = 0.35;
      c.font = '9px sans-serif';
      c.fillText('›', step * (k + 1), cy);
    }
  }
  c.globalAlpha = 1;
}

// ---------- ループ ----------
function frame(now) {
  if (!lastT) lastT = now;
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.1) dt = 0.1;
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
  const st = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, st);
  o.frequency.exponentialRampToValueAtTime(f2, st + dur);
  g.gain.setValueAtTime(vol, st);
  g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
  o.connect(g).connect(actx.destination);
  o.start(st); o.stop(st + dur + 0.02);
}

// ---------- ボタン ----------
$('#retry').addEventListener('click', newGame);
$('#help').addEventListener('click', () => { $('#helpBox').hidden = false; });
$('#helpClose').addEventListener('click', () => { $('#helpBox').hidden = true; store(HELP_KEY, true); });
$('#dialogClose').addEventListener('click', () => { $('#overlay').hidden = true; });
$('#restart').addEventListener('click', () => {
  if (world && !world.gameOver && world.bodies.length > 3 && !confirm('今のゲームをやめて最初からにしますか？')) return;
  newGame();
});
$('#sound').addEventListener('click', () => {
  sound = !sound;
  store(SOUND_KEY, sound);
  if (sound) { ensureAudio(); tone(660, 990, 0.12, 0.05); }
  updateHud();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else lastT = 0; });
window.addEventListener('pagehide', save);
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// ---------- 起動 ----------
(function init() {
  const saved = load(SAVE_KEY, null);
  if (saved && saved.bodies && !saved.gameOver) {
    try { world = M.restore(saved); } catch { world = null; }
  }
  if (!world) newGame();
  if (!load(HELP_KEY, false)) $('#helpBox').hidden = false;   // 初回だけ遊び方を表示
  resize();
  updateHud();
  drawChain();
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// 自動テスト用（遊ぶ上では使わない）
window.__merge = { get world() { return world; }, drop: (x) => { aimX = x; cool = 0; tryDrop(); } };
