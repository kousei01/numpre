// ===== ドミノ倒し 問題生成・ソルバー =====
// 盤面 n×n。各マスにドミノが1枚立っていて、矢印の向きに倒れる。
// スタートのドミノを押すと、倒れた先のドミノが連鎖して倒れていく。
// 全部のドミノが倒れるように矢印の向きをそろえる
//   = スタートから全マスを1回ずつ通る道（ハミルトン路）を作る、のと同じ。
// 向きが固定されたドミノ（鍵つき）がヒントになり、答えが1通りに決まる。
'use strict';

const DominoCore = (() => {
  // 方向：0=上 1=右 2=下 3=左
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

  function step(n, i, d) {
    const x = (i % n) + DX[d], y = ((i / n) | 0) + DY[d];
    if (x < 0 || y < 0 || x >= n || y >= n) return -1;
    return y * n + x;
  }
  function dirTo(n, a, b) {
    for (let d = 0; d < 4; d++) if (step(n, a, d) === b) return d;
    return -1;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 連鎖をシミュレーション：倒れた順のマス一覧と、止まった理由を返す
  function simulate(n, holes, start, arrows) {
    const fallen = new Uint8Array(n * n);
    const order = [];
    let cur = start, reason = 'done';
    while (true) {
      fallen[cur] = 1;
      order.push(cur);
      const next = step(n, cur, arrows[cur]);
      if (next < 0) { reason = 'edge'; break; }
      if (holes[next]) { reason = 'hole'; break; }
      if (fallen[next]) { reason = 'fallen'; break; }
      cur = next;
    }
    const total = holes.reduce((a, h) => a + (h ? 0 : 1), 0);
    return { order, all: order.length === total, reason, last: cur, total };
  }

  // ---------- ソルバー：鍵の条件を満たすハミルトン路を数える ----------
  // locked[i] = 固定された方向（なければ -1）
  function countPaths(n, holes, start, locked, limit = 2, nodeLimit = 400000) {
    const N = n * n;
    const free = new Uint8Array(N);
    let total = 0;
    for (let i = 0; i < N; i++) if (!holes[i]) { free[i] = 1; total++; }
    // pointedBy[j] = j を指している鍵つきドミノ（j の直前は必ずそこ）
    const pointedBy = Array.from({ length: N }, () => []);
    let mustEnd = -1; // 外・穴・スタートを指す鍵つきドミノは「最後の1枚」でしかありえない
    for (let i = 0; i < N; i++) {
      if (holes[i] || locked[i] < 0) continue;
      const j = step(n, i, locked[i]);
      if (j < 0 || holes[j] || j === start) {
        if (mustEnd >= 0) return { count: 0, solutions: [] };
        mustEnd = i;
        continue;
      }
      pointedBy[j].push(i);
    }
    const nb = [];
    for (let i = 0; i < N; i++) {
      nb.push([0, 1, 2, 3].map((d) => step(n, i, d)).filter((j) => j >= 0 && !holes[j]));
    }

    const visited = new Uint8Array(N);
    const path = [];
    let count = 0, nodes = 0, aborted = false;
    const solutions = [];
    const seen = new Int32Array(N);
    let stamp = 0;

    // 枝刈り：残りのマスが（今の先頭から）つながっているか、行き止まりが2つ以上ないか
    function ok(head, left) {
      if (left === 0) return true;
      stamp++;
      const stack = [];
      let reached = 0;
      for (const j of nb[head]) if (!visited[j] && seen[j] !== stamp) { seen[j] = stamp; stack.push(j); }
      if (!stack.length) return false;
      while (stack.length) {
        const c = stack.pop(); reached++;
        for (const j of nb[c]) if (!visited[j] && seen[j] !== stamp) { seen[j] = stamp; stack.push(j); }
      }
      if (reached !== left) return false;
      // 未訪問マスで「行ける隣」が1つしかないもの = 終点にしかなれない。2つ以上あったら無理
      let ends = 0;
      for (let i = 0; i < N; i++) {
        if (!free[i] || visited[i]) continue;
        let deg = 0;
        for (const j of nb[i]) if (!visited[j] || j === head) deg++;
        if (deg === 0) return false;
        if (deg === 1 && ++ends > 1) return false;
      }
      return true;
    }

    // 鍵つきドミノ L が X を指しているのに、X に L 以外から入った場合、
    // L は「最後の1枚」（倒れた X にぶつかって終わる）でなければならない
    let forcedLast = mustEnd;

    function dfs(head, left) {
      if (aborted || count >= limit) return;
      if (++nodes > nodeLimit) { aborted = true; return; }
      if (forcedLast >= 0 && head === forcedLast && left > 0) return;
      if (left === 0) {
        if (forcedLast >= 0 && head !== forcedLast) return;
        // 最後の1枚の鍵は、外・穴・倒れたドミノのどれを指していてもよい
        count++;
        if (solutions.length < limit) solutions.push(path.slice());
        return;
      }
      let cands;
      if (locked[head] >= 0) {
        const j = step(n, head, locked[head]);
        cands = j >= 0 && !holes[j] && !visited[j] ? [j] : [];
      } else {
        cands = nb[head].filter((j) => !visited[j]);
      }
      for (const j of cands) {
        const prevForced = forcedLast;
        let bad = false;
        for (const L of pointedBy[j]) {
          if (L === head) continue;
          if (visited[L]) { bad = true; break; }         // L はもう別のマスへ倒れている
          if (forcedLast >= 0 && forcedLast !== L) { bad = true; break; }
          forcedLast = L;
        }
        if (bad) { forcedLast = prevForced; continue; }
        visited[j] = 1; path.push(j);
        if (ok(j, left - 1)) dfs(j, left - 1);
        visited[j] = 0; path.pop();
        forcedLast = prevForced;
        if (aborted || count >= limit) return;
      }
    }

    visited[start] = 1; path.push(start);
    if (ok(start, total - 1)) dfs(start, total - 1);
    return aborted ? -1 : { count, solutions };
  }

  // ---------- ランダムなハミルトン路を1本作る ----------
  function randomPath(n, holes, start, nodeLimit = 20000) {
    const N = n * n;
    let total = 0;
    for (let i = 0; i < N; i++) if (!holes[i]) total++;
    const visited = new Uint8Array(N);
    const path = [start];
    visited[start] = 1;
    let nodes = 0;
    const deg = (i) => [0, 1, 2, 3].reduce((a, d) => { const j = step(n, i, d); return a + (j >= 0 && !holes[j] && !visited[j] ? 1 : 0); }, 0);

    function dfs(head) {
      if (path.length === total) return true;
      if (++nodes > nodeLimit) return false;
      // 進める先の少ないマスを優先（ワーンスドルフの方法）＋少しランダム
      const cands = shuffle([0, 1, 2, 3].map((d) => step(n, head, d)).filter((j) => j >= 0 && !holes[j] && !visited[j]))
        .map((j) => ({ j, k: deg(j) + Math.random() * 0.9 }))
        .sort((a, b) => a.k - b.k);
      for (const { j } of cands) {
        visited[j] = 1; path.push(j);
        if (dfs(j)) return true;
        visited[j] = 0; path.pop();
      }
      return false;
    }
    return dfs(start) ? path : null;
  }

  // ---------- 問題生成 ----------
  // holes: 穴の数、minimize: 鍵を減らせるだけ減らす、extra: 答えに加えて足す鍵の数（易しくする）
  function generate(n, { holes: holeCount = 0, minimize = true, extra = 0, budget = 3000 } = {}) {
    const N = n * n, t0 = Date.now();
    while (true) {
      // 穴とスタート
      const holes = new Array(N).fill(0);
      const cells = shuffle([...Array(N).keys()]);
      for (let k = 0; k < holeCount; k++) holes[cells[k]] = 1;
      const open = cells.slice(holeCount);
      const start = open[Math.floor(Math.random() * open.length)];
      const path = randomPath(n, holes, start);
      if (!path) continue;

      // 答えの矢印（最後の1枚は、盤の外か穴を向くようにする）
      const answer = new Array(N).fill(-1);
      for (let k = 0; k + 1 < path.length; k++) answer[path[k]] = dirTo(n, path[k], path[k + 1]);
      const last = path[path.length - 1];
      const outs = [0, 1, 2, 3].filter((d) => { const j = step(n, last, d); return j < 0 || holes[j]; });
      answer[last] = outs.length ? outs[Math.floor(Math.random() * outs.length)] : Math.floor(Math.random() * 4);

      // 答えが1通りになるまで鍵を足す（別解と食い違うマスに鍵をかける）
      const locked = new Array(N).fill(-1);
      let failed = false;
      for (let guard = 0; guard < N; guard++) {
        const r = countPaths(n, holes, start, locked, 2);
        if (r === -1) { failed = true; break; }
        if (r.count === 1) break;
        const other = r.solutions.find((s) => s.some((c, k) => c !== path[k]));
        const diff = [];
        for (let k = 0; k + 1 < path.length; k++) {
          const c = path[k];
          if (locked[c] >= 0) continue;
          const pos = other.indexOf(c);
          if (pos === -1 || other[pos + 1] !== path[k + 1]) diff.push(c);
        }
        if (!diff.length) { failed = true; break; }
        const c = diff[Math.floor(Math.random() * diff.length)];
        locked[c] = answer[c];
      }
      if (failed) { if (Date.now() - t0 > budget) budget += 1000; continue; }

      // 鍵を1つずつ外してみて、それでも答えが1通りなら外す（難しくする）
      if (minimize) {
        for (const c of shuffle(locked.map((d, i) => (d >= 0 ? i : -1)).filter((i) => i >= 0))) {
          const keep = locked[c];
          locked[c] = -1;
          const r = countPaths(n, holes, start, locked, 2);
          if (r === -1 || r.count !== 1) locked[c] = keep;
        }
      }
      // 易しい難易度では鍵を足す
      const freeCells = shuffle(path.slice(0, -1).filter((c) => locked[c] < 0 && c !== start));
      for (let k = 0; k < extra && k < freeCells.length; k++) locked[freeCells[k]] = answer[freeCells[k]];

      return { n, holes, start, answer, locked, path };
    }
  }

  return { DX, DY, step, simulate, countPaths, randomPath, generate };
})();

if (typeof module !== 'undefined') module.exports = DominoCore;
