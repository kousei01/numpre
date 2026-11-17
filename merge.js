// ===== まぜまぜフルーツ 描画・入力・ゲームの流れ =====
'use strict';

const SAVE_KEY = 'merge-save-v1';
const STATS_KEY = 'merge-stats-v1';
const SOUND_KEY = 'merge-sound';

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

const COLORS = ['#5a6ad6', '#e8406a', '#f06a80', '#9a7a46', '#f7d540', '#f5951f', '#ff9fb2', '#8fd04a', '#f59a6a', '#f5a33a', '#8a5a32'];

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
    particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 1.2, max: 1.2, color: COLORS[Math.floor(Math.random() * COLORS.length)], size: 3 + Math.random() * 4 });
  }
  texts.push({ x: M.W / 2, y: 260, text: '🧺 フルーツバスケット！', life: 2, max: 2, big: true, center: true });
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
      `いちばん大きな果物：${M.KINDS[world.maxLevel].name}` +
      `${world.suns ? `\n🧺 フルーツバスケットを ${world.suns} 個つくった！` : ''}\n` +
      `合体 ${world.merges} 回・プレイ ${stats.plays} 回`;
    const bc = $('#bigCv').getContext('2d');
    bc.clearRect(0, 0, 160, 160);
    fruit(bc, world.maxLevel, 80, 84, 56, 0);
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
const DOTS = Array.from({ length: 40 }, () => ({ x: Math.random() * M.W, y: Math.random() * M.H, r: Math.random() * 2.2 + 1 }));
const INK = 'rgba(92,58,30,';     // こげ茶（線や文字）

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // あたたかいクリーム色の背景と水玉
  const g = ctx.createLinearGradient(0, 0, 0, M.H);
  g.addColorStop(0, '#fff6e6'); g.addColorStop(1, '#ffe2c4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, M.W, M.H);
  ctx.fillStyle = 'rgba(255,170,120,0.18)';
  for (const d of DOTS) { ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill(); }

  // 箱（ガラスのボウル）
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  roundRect(M.BOX_L, M.LINE_Y - 30, M.BOX_R - M.BOX_L, M.BOX_B - M.LINE_Y + 30, 18); ctx.fill();
  ctx.strokeStyle = '#d9a77a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(M.BOX_L - 2, M.LINE_Y - 30);
  ctx.lineTo(M.BOX_L - 2, M.BOX_B - 16);
  ctx.quadraticCurveTo(M.BOX_L - 2, M.BOX_B + 2, M.BOX_L + 16, M.BOX_B + 2);
  ctx.lineTo(M.BOX_R - 16, M.BOX_B + 2);
  ctx.quadraticCurveTo(M.BOX_R + 2, M.BOX_B + 2, M.BOX_R + 2, M.BOX_B - 16);
  ctx.lineTo(M.BOX_R + 2, M.LINE_Y - 30);
  ctx.stroke();

  // あふれ線（危ないときは赤く点滅）
  const danger = world.danger || 0;
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = danger > 0 ? `rgba(230,60,70,${0.5 + 0.5 * Math.sin(t * 18)})` : INK + '0.3)';
  ctx.beginPath(); ctx.moveTo(M.BOX_L, M.LINE_Y); ctx.lineTo(M.BOX_R, M.LINE_Y); ctx.stroke();
  ctx.setLineDash([]);

  // 狙いのガイド線と、落とす果物
  if (!world.gameOver) {
    const lv = world.current, r = M.KINDS[lv].r;
    const x = M.clampDropX(lv, aimX);
    ctx.strokeStyle = INK + '0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, M.DROP_Y + r); ctx.lineTo(x, M.BOX_B); ctx.stroke();
    ctx.globalAlpha = cool > 0 ? 0.35 : 1;
    fruit(ctx, lv, x, M.DROP_Y, r, 0);
    ctx.globalAlpha = 1;
  }

  // 次の果物
  ctx.fillStyle = INK + '0.7)';
  ctx.font = '700 12px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('つぎ', M.W - 38, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath(); ctx.arc(M.W - 38, 58, 24, 0, Math.PI * 2); ctx.fill();
  fruit(ctx, world.next, M.W - 38, 59, Math.min(18, M.KINDS[world.next].r), 0);

  // 果物たち
  for (const b of world.bodies) {
    fruit(ctx, b.level, b.x, b.y, b.r, b.angle);
    if (b.over > 0) {        // 線を越えている果物は赤く光る
      ctx.strokeStyle = `rgba(230,60,70,${0.4 + 0.4 * Math.sin(t * 18)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 2, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // 合体の輪・果汁のしぶき・得点
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
    ctx.font = `900 ${s.big ? 26 : s.name ? 15 : 18}px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = INK + '0.9)';
    ctx.strokeText(s.text, s.x, s.y);
    ctx.fillStyle = s.name ? '#fff3b0' : '#ffffff';
    ctx.fillText(s.text, s.x, s.y);
  }
  ctx.globalAlpha = 1;

  // フルーツバスケットができた瞬間のまぶしい光
  if (sunFlash > 0) {
    const rg = ctx.createRadialGradient(M.W / 2, 280, 10, M.W / 2, 280, 420);
    rg.addColorStop(0, `rgba(255,240,170,${sunFlash})`);
    rg.addColorStop(1, `rgba(255,170,120,${sunFlash * 0.3})`);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, M.W, M.H);
  }
  // あふれた
  if (world.gameOver) {
    ctx.fillStyle = 'rgba(92,58,30,0.22)';
    ctx.fillRect(0, 0, M.W, M.H);
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ---------- 果物の絵（すべてオリジナルの描き方。転がると模様・顔・へたが一緒に回る） ----------
function fruit(c, lv, x, y, r, angle) {
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  // レモンの両端のとんがり（体の後ろ）
  if (lv === 4) {
    c.fillStyle = '#f2c418';
    c.beginPath(); c.ellipse(-r * 0.98, 0, r * 0.2, r * 0.14, 0, 0, Math.PI * 2); c.ellipse(r * 0.98, 0, r * 0.2, r * 0.14, 0, 0, Math.PI * 2); c.fill();
  }
  c.save();
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
  const base = (c1, c2) => {
    const gr = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    c.fillStyle = gr; c.fillRect(-r, -r, r * 2, r * 2);
  };
  const dots = (n, size, color, seed) => {        // 表面の点々（毎回同じ位置になるように決まった並び）
    c.fillStyle = color;
    for (let k = 0; k < n; k++) {
      const a = k * 2.399 + seed, d = Math.sqrt((k + 0.5) / n) * 0.9;
      c.beginPath(); c.arc(Math.cos(a) * d * r, Math.sin(a) * d * r, size * r, 0, Math.PI * 2); c.fill();
    }
  };
  switch (lv) {
    case 0: base('#8e9cff', '#2e3a8c'); break;                                        // ブルーベリー
    case 1: base('#ff8aa6', '#c81f4a'); dots(22, 0.11, 'rgba(255,255,255,0.22)', 0.3); break; // ラズベリー：つぶつぶ
    case 2: base('#ffb0bc', '#d0405a'); dots(30, 0.06, 'rgba(140,20,40,0.28)', 1.1); break;  // ライチ：ぶつぶつ
    case 3: base('#d2ad75', '#7a5a2e'); dots(60, 0.025, 'rgba(70,45,20,0.45)', 0.7); break;  // キウイ：うぶ毛
    case 4: base('#fffab0', '#f0c014'); dots(26, 0.025, 'rgba(200,150,0,0.35)', 0.2); break;  // レモン
    case 5: base('#ffc777', '#ef7a10'); dots(40, 0.03, 'rgba(200,90,0,0.3)', 0.5); break;    // みかん
    case 6:                                                                              // もも：割れ目
      base('#ffe3e6', '#ff8299');
      c.strokeStyle = 'rgba(220,80,110,0.45)'; c.lineWidth = r * 0.06;
      c.beginPath(); c.moveTo(-r * 0.05, -r); c.quadraticCurveTo(-r * 0.45, -r * 0.1, -r * 0.1, r * 0.9); c.stroke();
      break;
    case 7: base('#e4fbaa', '#76bd34'); dots(18, 0.02, 'rgba(255,255,255,0.45)', 0.9); break; // 青りんご
    case 8: base('#ffd8b4', '#ee7f56'); dots(50, 0.025, 'rgba(200,80,40,0.25)', 0.4); break;  // グレープフルーツ
    case 9: {                                                                             // マンゴー：緑→黄→赤
      const gr = c.createLinearGradient(-r, -r, r, r);
      gr.addColorStop(0, '#9fd65a'); gr.addColorStop(0.45, '#ffd84a'); gr.addColorStop(1, '#f2603a');
      c.fillStyle = gr; c.fillRect(-r, -r, r * 2, r * 2);
      break;
    }
    case 10:                                                                              // ココナッツ：繊維
      base('#b98a58', '#5c3a1e');
      c.strokeStyle = 'rgba(60,35,15,0.35)'; c.lineWidth = r * 0.025;
      for (let k = 0; k < 26; k++) {
        const a = k * 0.73, x0 = Math.cos(a) * r * 0.9, y0 = Math.sin(a * 1.7) * r * 0.9;
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + r * 0.18, y0 + r * 0.06); c.stroke();
      }
      break;
  }
  // つや
  c.fillStyle = 'rgba(255,255,255,0.35)';
  c.beginPath(); c.ellipse(-r * 0.42, -r * 0.48, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2); c.fill();
  // 顔
  if (r >= 11) face(c, r, lv);
  c.restore();
  // ふち
  c.strokeStyle = 'rgba(92,58,30,0.25)';
  c.lineWidth = Math.max(1, r * 0.05);
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
  // へた・葉っぱ（体の外にはみ出す飾り）
  topper(c, lv, r);
  c.restore();
}

function leaf(c, x, y, len, rot, color = '#5cb84a') {
  c.save(); c.translate(x, y); c.rotate(rot);
  c.fillStyle = color;
  c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(len * 0.5, -len * 0.45, len, 0); c.quadraticCurveTo(len * 0.5, len * 0.45, 0, 0); c.fill();
  c.restore();
}
function topper(c, lv, r) {
  switch (lv) {
    case 0: {   // ブルーベリーの星形のくぼみ
      c.fillStyle = '#1f2766';
      c.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.12 : r * 0.28; c.lineTo(Math.cos(a) * rr, -r * 0.82 + Math.sin(a) * rr); }
      c.closePath(); c.fill();
      break;
    }
    case 1: leaf(c, -r * 0.05, -r * 0.92, r * 0.55, -2.6); leaf(c, 0, -r * 0.92, r * 0.55, -0.5); break;
    case 2: c.fillStyle = '#7a5a2e'; c.fillRect(-r * 0.06, -r * 1.2, r * 0.12, r * 0.3); break;
    case 3: c.fillStyle = '#5a3f1e'; c.beginPath(); c.arc(0, -r * 0.95, r * 0.1, 0, Math.PI * 2); c.fill(); break;
    case 5: leaf(c, r * 0.05, -r * 0.95, r * 0.5, -0.4); break;
    case 6: leaf(c, r * 0.05, -r * 0.95, r * 0.55, -0.3); break;
    case 7:
      c.strokeStyle = '#7a5a2e'; c.lineWidth = r * 0.08; c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, -r * 0.85); c.quadraticCurveTo(r * 0.04, -r * 1.05, r * 0.12, -r * 1.2); c.stroke();
      leaf(c, r * 0.08, -r * 1.05, r * 0.42, -0.5);
      break;
    case 8: c.fillStyle = '#6aa83a'; c.beginPath(); c.arc(0, -r * 0.93, r * 0.08, 0, Math.PI * 2); c.fill(); break;
    case 9: leaf(c, -r * 0.1, -r * 0.92, r * 0.38, -2.4); break;
    default: break;
  }
}

function face(c, r, lv) {
  const light = lv === 0 || lv === 10;        // 色の濃い果物は白い目
  const ink = light ? '#ffffff' : '#4a2c18';
  const ex = r * 0.3, ey = -r * 0.02, es = Math.max(1.2, r * 0.09);
  c.fillStyle = ink;
  c.beginPath(); c.arc(-ex, ey, es, 0, Math.PI * 2); c.arc(ex, ey, es, 0, Math.PI * 2); c.fill();
  if (r > 20 && !light) {
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(-ex + es * 0.35, ey - es * 0.4, es * 0.35, 0, Math.PI * 2); c.arc(ex + es * 0.35, ey - es * 0.4, es * 0.35, 0, Math.PI * 2); c.fill();
  }
  c.strokeStyle = ink; c.lineWidth = Math.max(1, r * 0.05); c.lineCap = 'round';
  c.beginPath(); c.arc(0, ey + r * 0.12, r * 0.12, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
  c.fillStyle = 'rgba(255,90,120,0.38)';
  c.beginPath(); c.ellipse(-ex * 1.45, ey + r * 0.18, r * 0.11, r * 0.07, 0, 0, Math.PI * 2); c.ellipse(ex * 1.45, ey + r * 0.18, r * 0.11, r * 0.07, 0, 0, Math.PI * 2); c.fill();
}

// 下の「合体の順番」：つくったことのある果物は明るく
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
  for (let k = 0; k < n; k++) {
    const cx = step * (k + 0.5), cy = h / 2 + 2;
    const r = Math.min(step * 0.36, 6 + k * 1.2);
    c.globalAlpha = k <= reached || (k === M.SUN && world && world.suns) ? 1 : 0.28;
    if (k === M.SUN) {
      c.font = `${Math.round(r * 2.4)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('🧺', cx, cy);
    } else {
      fruit(c, k, cx, cy, r, 0);
    }
    if (k < n - 1) {
      c.globalAlpha = 0.35; c.fillStyle = getComputedStyle(document.body).color;
      c.font = '9px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
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
  resize();
  updateHud();
  drawChain();
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// 自動テスト用（遊ぶ上では使わない）
window.__merge = { get world() { return world; }, drop: (x) => { aimX = x; cool = 0; tryDrop(); } };
