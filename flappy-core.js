// ===== パタパタ 物理・当たり判定（画面とは切り離してテストできるようにしている） =====
// 座標は論理ピクセル。高さ H = 640 固定、幅 W は画面の縦横比に合わせる。
// 時間は秒。step() を一定間隔（1/120 秒）で呼ぶと、画面のリフレッシュレート（60Hz / 120Hz）に関係なく同じ動きになる。
'use strict';

const FlappyCore = (() => {
  const H = 640;
  const GROUND = 72;          // 地面の高さ
  const PIPE_W = 68;          // 柱の幅
  const GRAVITY = 1800;       // 重力（px/s²）
  const MAX_FALL = 900;       // 落ちる速さの上限
  const BIRD_R = 14;          // 見た目の半径
  const HIT_R = 11.5;         // 当たり判定の半径（見た目より少し小さくして理不尽さを減らす）

  // 難易度：すき間の高さ・横に進む速さ・柱の間隔・すき間の上下の振れ幅・羽ばたきの強さ
  // どの難易度も、0.12 秒刻みのタップで先読みして操作すれば必ず抜けられることを自動テストで確認して決めた
  // （上下の振れ幅が大きすぎると、完璧に操作しても間に合わない配置が出るため）
  const LEVELS = [
    { name: '入門', gap: 200, speed: 140, spacing: 270, swing: 110, flap: -500 },
    { name: '初級', gap: 178, speed: 160, spacing: 250, swing: 150, flap: -510 },
    { name: '中級', gap: 160, speed: 180, spacing: 235, swing: 185, flap: -520 },
    { name: '上級', gap: 150, speed: 195, spacing: 230, swing: 160, flap: -495 },
    { name: '鬼',   gap: 142, speed: 215, spacing: 228, swing: 140, flap: -490 },
  ];

  function createWorld(level, W, rand = Math.random) {
    const cfg = LEVELS[level];
    const w = {
      W, H, groundY: H - GROUND, cfg, rand,
      bird: { x: Math.round(W * 0.3), y: H * 0.42, vy: 0 },
      pipes: [],
      speed: cfg.speed,
      dist: 0,
      score: 0,
      alive: true,
    };
    while (!w.pipes.length || w.pipes[w.pipes.length - 1].x < w.W + 40) spawn(w);
    return w;
  }

  function spawn(w) {
    const last = w.pipes[w.pipes.length - 1];
    const x = last ? last.x + w.cfg.spacing : w.W + 120;
    const half = w.cfg.gap / 2;
    const minY = 70 + half, maxY = w.groundY - 60 - half;
    const base = last ? last.gapY : (minY + maxY) / 2;
    let gapY = base + (w.rand() * 2 - 1) * w.cfg.swing;
    gapY = Math.max(minY, Math.min(maxY, gapY));
    w.pipes.push({ x, gapY, gap: w.cfg.gap, passed: false });
  }

  // 円と長方形の当たり判定
  function hitRect(cx, cy, r, x, y, w, h) {
    const nx = Math.max(x, Math.min(cx, x + w));
    const ny = Math.max(y, Math.min(cy, y + h));
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
  }

  // 1ステップ進める。戻り値はこのステップで起きたこと
  function step(w, dt, flap) {
    const ev = { scored: false, hit: null };
    if (!w.alive) return ev;
    const b = w.bird;
    if (flap) b.vy = w.cfg.flap;
    b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
    b.y += b.vy * dt;
    if (b.y < BIRD_R) { b.y = BIRD_R; b.vy = Math.max(b.vy, 0); }   // 天井ではぶつからず止まるだけ

    // スコアが上がるほど少しずつ速くなる（最大 +20%）
    w.speed = w.cfg.speed * (1 + Math.min(w.score, 50) * 0.004);
    const dx = w.speed * dt;
    w.dist += dx;
    for (const p of w.pipes) p.x -= dx;
    while (w.pipes.length && w.pipes[0].x + PIPE_W < -20) w.pipes.shift();
    while (!w.pipes.length || w.pipes[w.pipes.length - 1].x < w.W + 40) spawn(w);

    for (const p of w.pipes) {
      if (!p.passed && p.x + PIPE_W < b.x - HIT_R) { p.passed = true; w.score++; ev.scored = true; }
      const top = p.gapY - p.gap / 2, bottom = p.gapY + p.gap / 2;
      if (hitRect(b.x, b.y, HIT_R, p.x, -200, PIPE_W, top + 200) ||
          hitRect(b.x, b.y, HIT_R, p.x, bottom, PIPE_W, w.groundY - bottom)) {
        ev.hit = 'pipe';
      }
    }
    if (b.y + HIT_R >= w.groundY) { b.y = w.groundY - HIT_R; ev.hit = 'ground'; }
    if (ev.hit) w.alive = false;
    return ev;
  }

  // ぶつかった後：鳥だけ地面まで落とす
  function fall(w, dt) {
    const b = w.bird;
    b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
    b.y = Math.min(b.y + b.vy * dt, w.groundY - BIRD_R + 2);
    return b.y >= w.groundY - BIRD_R + 2;
  }

  return { H, GROUND, PIPE_W, GRAVITY, BIRD_R, HIT_R, LEVELS, createWorld, step, fall };
})();

if (typeof module !== 'undefined') module.exports = FlappyCore;
