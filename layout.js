// ===== 配置の調整（全ゲーム共通） =====
// 動画の小窓（ピクチャ・イン・ピクチャ）と重ならないように、
// ゲーム画面全体をドラッグで移動・ピンチや スライダーで縮小できるようにする。
// 設定はゲームごとに localStorage（layout-v1）へ保存。
'use strict';

(() => {
  const KEY = 'layout-v1';
  const game = document.body.dataset.game || 'default';
  const app = document.querySelector('.app');
  const header = document.querySelector('.top');
  if (!app || !header) return;

  const MIN_S = 0.5, MAX_S = 1;
  const DEFAULT = { x: 0, y: 0, s: 1 };

  function loadAll() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
  function saveAll(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {} }

  let pos = { ...DEFAULT, ...(loadAll()[game] || {}) };
  let editing = false;

  const isDefault = () => pos.x === 0 && pos.y === 0 && pos.s === 1;

  function apply() {
    const moved = editing || !isDefault();
    document.body.classList.toggle('moved', moved);
    app.style.transform = moved ? `translate(${pos.x}px, ${pos.y}px) scale(${pos.s})` : '';
    slider.value = Math.round(pos.s * 100);
    pct.textContent = `${Math.round(pos.s * 100)}%`;
  }

  // 画面外に行きすぎないように（最低 80px は画面内に残す）
  function clamp() {
    pos.s = Math.min(MAX_S, Math.max(MIN_S, pos.s));
    const w = app.offsetWidth * pos.s, h = app.offsetHeight * pos.s;
    const vw = window.innerWidth, vh = window.innerHeight;
    const keep = 80;
    // transform-origin が上端中央なので、x=0 のとき中央に来る
    const baseLeft = (vw - w) / 2;
    pos.x = Math.min(vw - keep - baseLeft, Math.max(keep - w - baseLeft, pos.x));
    pos.y = Math.min(vh - keep, Math.max(keep - h, pos.y));
    pos.x = Math.round(pos.x); pos.y = Math.round(pos.y);
  }

  function persist() {
    const all = loadAll();
    if (isDefault()) delete all[game]; else all[game] = pos;
    saveAll(all);
  }

  // ---------- ヘッダーの調整ボタン ----------
  const btn = document.createElement('button');
  btn.className = 'layout-btn';
  btn.setAttribute('aria-label', '配置を調整');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>';
  header.appendChild(btn);

  // ---------- 編集中にゲームを覆う膜（ドラッグ・ピンチを受け取る） ----------
  const cover = document.createElement('div');
  cover.className = 'layout-cover';
  cover.innerHTML = '<span>ドラッグで移動<br>2本指でサイズ変更</span>';
  app.appendChild(cover);

  // ---------- 下のパネル ----------
  const panel = document.createElement('div');
  panel.className = 'layout-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="lp-row">
      <span class="lp-label">サイズ</span>
      <input type="range" min="${MIN_S * 100}" max="${MAX_S * 100}" step="1" aria-label="サイズ">
      <span class="lp-pct">100%</span>
    </div>
    <div class="lp-row lp-btns">
      <button data-v="top">上へ</button>
      <button data-v="middle">中央</button>
      <button data-v="bottom">下へ</button>
      <button data-v="reset">元に戻す</button>
      <button class="lp-done">完了</button>
    </div>`;
  document.body.appendChild(panel);
  const slider = panel.querySelector('input');
  const pct = panel.querySelector('.lp-pct');

  function open() {
    editing = true;
    document.body.classList.add('layout-editing');
    panel.hidden = false;
    apply();
  }
  function close() {
    editing = false;
    document.body.classList.remove('layout-editing');
    panel.hidden = true;
    clamp(); apply(); persist();
  }
  btn.addEventListener('click', () => (editing ? close() : open()));
  panel.querySelector('.lp-done').addEventListener('click', close);

  // サイズ変更は画面の中心がずれにくいよう、見た目の中央を基準に調整する
  function setScale(s, cx, cy) {
    const old = pos.s;
    s = Math.min(MAX_S, Math.max(MIN_S, s));
    if (cx !== undefined) {
      const r = app.getBoundingClientRect();
      const ox = r.left + r.width / 2, oy = r.top;       // 現在の基準点（上端中央）
      pos.y += (cy - oy) * (1 - s / old);
      pos.x += (cx - ox) * (1 - s / old);
    }
    pos.s = s;
    clamp(); apply();
  }
  slider.addEventListener('input', () => {
    const r = app.getBoundingClientRect();
    setScale(slider.value / 100, r.left + r.width / 2, r.top + r.height / 2);
  });

  panel.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.v;
    if (v === 'reset') { pos = { ...DEFAULT }; apply(); return; }
    const h = app.offsetHeight * pos.s;
    const vh = window.innerHeight;
    pos.x = 0;
    if (v === 'top') pos.y = 0;
    if (v === 'middle') pos.y = (vh - h) / 2;
    if (v === 'bottom') pos.y = vh - h;
    clamp(); apply();
  }));

  // ---------- ドラッグとピンチ ----------
  const pointers = new Map();
  let start = null;

  function snapshot() {
    const pts = [...pointers.values()];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { cx, cy, dist, x: pos.x, y: pos.y, s: pos.s };
  }

  cover.addEventListener('pointerdown', (e) => {
    cover.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start = snapshot();
  });
  cover.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = snapshot();
    pos.x = start.x + (now.cx - start.cx);
    pos.y = start.y + (now.cy - start.cy);
    if (pointers.size > 1 && start.dist > 0) {
      const s = Math.min(MAX_S, Math.max(MIN_S, start.s * (now.dist / start.dist)));
      // 2本指の中心を基準に拡大縮小
      const r = app.getBoundingClientRect();
      const k = s / pos.s;
      const ox = r.left + r.width / 2, oy = r.top;
      pos.x += (now.cx - ox) * (1 - k);
      pos.y += (now.cy - oy) * (1 - k);
      pos.s = s;
    }
    clamp(); apply();
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    start = pointers.size ? snapshot() : null;
  };
  cover.addEventListener('pointerup', up);
  cover.addEventListener('pointercancel', up);

  // 画面の向きが変わったときなどに、はみ出しを直す
  window.addEventListener('resize', () => { if (!isDefault()) { clamp(); apply(); persist(); } });

  apply();
  if (!isDefault()) requestAnimationFrame(() => { clamp(); apply(); });
})();
