// ===== マインスイーパー 盤面生成・論理ソルバー =====
// 盤面は長さ w*h の配列。mines[i] = 1 なら地雷、nums[i] = 周囲の地雷数
'use strict';

const MinesCore = (() => {
  const nbCache = new Map();
  function neighbors(w, h, i) {
    const key = `${w},${h}`;
    let list = nbCache.get(key);
    if (!list) {
      list = [];
      for (let k = 0; k < w * h; k++) {
        const x = k % w, y = Math.floor(k / w), arr = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) arr.push(ny * w + nx);
        }
        list.push(arr);
      }
      nbCache.set(key, list);
    }
    return list[i];
  }

  // 最初にタップしたマスとその周囲には地雷を置かない（必ず連鎖して開く）
  function placeMines(w, h, count, safe) {
    const n = w * h;
    const banned = new Set([safe, ...neighbors(w, h, safe)]);
    if (n - banned.size < count) banned.clear(), banned.add(safe);
    const pool = [];
    for (let i = 0; i < n; i++) if (!banned.has(i)) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const mines = new Uint8Array(n);
    for (let k = 0; k < count; k++) mines[pool[k]] = 1;
    return mines;
  }

  function numbers(w, h, mines) {
    const nums = new Int8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      let c = 0;
      for (const j of neighbors(w, h, i)) c += mines[j];
      nums[i] = c;
    }
    return nums;
  }

  // ---------- 論理ソルバー ----------
  // 推測なしで全部開けられるなら true
  // ① 基本ルール（旗の数 = 数字 → 残り安全 / 未開放 + 旗 = 数字 → 全部地雷）
  // ② 境界マスの組み合わせを全列挙し、どの解でも同じになるマスを確定
  // ③ 残り地雷数による判定
  function solvable(w, h, mines, nums, start, totalMines) {
    const n = w * h;
    const st = new Uint8Array(n); // 0:未開放 1:開放 2:地雷確定
    let opened = 0, flagged = 0;
    const safeCount = n - totalMines;

    function open(i) {
      if (st[i]) return;
      if (mines[i]) throw new Error('solver opened a mine');
      const stack = [i];
      st[i] = 1; opened++;
      while (stack.length) {
        const c = stack.pop();
        if (nums[c] !== 0) continue;
        for (const j of neighbors(w, h, c)) {
          if (!st[j]) { st[j] = 1; opened++; stack.push(j); }
        }
      }
    }
    function flag(i) { if (!st[i]) { st[i] = 2; flagged++; } }

    open(start);
    while (opened < safeCount) {
      let progress = false;

      // ① 基本ルール
      for (let i = 0; i < n; i++) {
        if (st[i] !== 1 || nums[i] === 0) continue;
        let unk = 0, fl = 0;
        for (const j of neighbors(w, h, i)) { if (st[j] === 0) unk++; else if (st[j] === 2) fl++; }
        if (!unk) continue;
        if (fl === nums[i]) {
          for (const j of neighbors(w, h, i)) if (st[j] === 0) open(j);
          progress = true;
        } else if (fl + unk === nums[i]) {
          for (const j of neighbors(w, h, i)) flag(j);
          progress = true;
        }
      }
      if (progress) continue;

      // ② 境界の全列挙
      if (enumerate()) continue;

      // ③ 残り地雷数
      const remaining = totalMines - flagged;
      const unknown = n - opened - flagged;
      if (remaining === 0) { for (let i = 0; i < n; i++) if (!st[i]) open(i); continue; }
      if (remaining === unknown) { for (let i = 0; i < n; i++) flag(i); continue; }

      return false; // 推測が必要
    }
    return true;

    function enumerate() {
      // 制約（開放済みの数字マス）と変数（それに隣接する未開放マス）を集める
      const varId = new Map(), vars = [], cons = [];
      for (let i = 0; i < n; i++) {
        if (st[i] !== 1 || nums[i] === 0) continue;
        const vs = []; let fl = 0;
        for (const j of neighbors(w, h, i)) {
          if (st[j] === 0) {
            if (!varId.has(j)) { varId.set(j, vars.length); vars.push(j); }
            vs.push(varId.get(j));
          } else if (st[j] === 2) fl++;
        }
        if (vs.length) cons.push({ vs, need: nums[i] - fl });
      }
      if (!vars.length) return false;

      // 変数を連結成分に分ける
      const parent = vars.map((_, k) => k);
      const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
      for (const c of cons) for (let k = 1; k < c.vs.length; k++) parent[find(c.vs[k])] = find(c.vs[0]);
      const groups = new Map();
      vars.forEach((_, k) => { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k); });

      const varCons = vars.map(() => []);
      cons.forEach((c, ci) => c.vs.forEach((v) => varCons[v].push(ci)));
      const remainingMines = totalMines - flagged;
      let progress = false;

      for (const group of groups.values()) {
        // 制約でつながる順に並べると枝刈りが効く
        const order = [], seen = new Set([group[0]]), q = [group[0]];
        while (q.length) {
          const v = q.shift(); order.push(v);
          for (const ci of varCons[v]) for (const u of cons[ci].vs) if (!seen.has(u)) { seen.add(u); q.push(u); }
        }
        const gCons = [...new Set(order.flatMap((v) => varCons[v]))];
        const cur = new Map(gCons.map((ci) => [ci, 0]));
        const left = new Map(gCons.map((ci) => [ci, cons[ci].vs.length]));
        const assign = new Int8Array(vars.length);
        const mineHits = new Map(order.map((v) => [v, 0]));
        let solutions = 0, nodes = 0, aborted = false, mineCount = 0;

        (function bt(k) {
          if (aborted) return;
          if (++nodes > 50000) { aborted = true; return; }
          if (k === order.length) {
            solutions++;
            for (const v of order) if (assign[v]) mineHits.set(v, mineHits.get(v) + 1);
            return;
          }
          const v = order[k];
          for (const val of [0, 1]) {
            if (val && mineCount + 1 > remainingMines) continue;
            let ok = true;
            for (const ci of varCons[v]) {
              const c = cur.get(ci) + val, l = left.get(ci) - 1;
              if (c > cons[ci].need || c + l < cons[ci].need) { ok = false; break; }
            }
            if (!ok) continue;
            assign[v] = val; mineCount += val;
            for (const ci of varCons[v]) { cur.set(ci, cur.get(ci) + val); left.set(ci, left.get(ci) - 1); }
            bt(k + 1);
            for (const ci of varCons[v]) { cur.set(ci, cur.get(ci) - val); left.set(ci, left.get(ci) + 1); }
            assign[v] = 0; mineCount -= val;
          }
        })(0);

        if (aborted || solutions === 0) continue;
        for (const v of order) {
          const hits = mineHits.get(v);
          if (hits === 0) { open(vars[v]); progress = true; }
          else if (hits === solutions) { flag(vars[v]); progress = true; }
        }
      }
      return progress;
    }
  }

  // 盤面を作る。noGuess = true なら論理だけで解ける盤面を時間内で探す
  function generate(w, h, count, safe, { noGuess = true, budget = 1500 } = {}) {
    const startTime = Date.now();
    let tries = 0;
    while (true) {
      tries++;
      const mines = placeMines(w, h, count, safe);
      const nums = numbers(w, h, mines);
      if (!noGuess) return { mines, nums, logical: false, tries };
      if (solvable(w, h, mines, nums, safe, count)) return { mines, nums, logical: true, tries };
      if (Date.now() - startTime > budget) return { mines, nums, logical: false, tries };
    }
  }

  return { neighbors, placeMines, numbers, solvable, generate };
})();

if (typeof module !== 'undefined') module.exports = MinesCore;
