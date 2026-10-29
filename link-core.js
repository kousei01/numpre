// ===== ナンバーリンク 問題生成・ソルバー =====
// 盤面は n×n、セル番号 i = y*n + x
// 問題 = 色(数字)ごとの2つの端点。ルール：同じ数字同士を線でつなぎ、全マスを埋める
'use strict';

const LinkCore = (() => {
  function nbrs(n, i) {
    const x = i % n, y = (i / n) | 0, r = [];
    if (y > 0) r.push(i - n);
    if (y < n - 1) r.push(i + n);
    if (x > 0) r.push(i - 1);
    if (x < n - 1) r.push(i + 1);
    return r;
  }
  const nbCache = new Map();
  function neighborsTable(n) {
    if (!nbCache.has(n)) nbCache.set(n, Array.from({ length: n * n }, (_, i) => nbrs(n, i)));
    return nbCache.get(n);
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- 盤面を線で分割する ----------
  // 全マスを1マスずつの線から始め、隣り合う線の端同士をランダムにつないでいく。
  // 線が自分自身に接しないようにつなぐ（自然な形になり、解も一意になりやすい）
  function randomPartition(n, targetPaths) {
    const NB = neighborsTable(n);
    const N = n * n;
    let paths = new Map();          // id -> セル配列
    const owner = new Int32Array(N); // セル -> 線id
    for (let i = 0; i < N; i++) { paths.set(i, [i]); owner[i] = i; }

    const isEnd = (i) => { const p = paths.get(owner[i]); return p[0] === i || p[p.length - 1] === i; };

    function touches(A, B, u, v) {
      const setB = new Set(B);
      for (const x of A) for (const y of NB[x]) {
        if (setB.has(y) && !(x === u && y === v)) return true;
      }
      return false;
    }

    while (paths.size > targetPaths) {
      // 短い線を優先して端同士をつなぐ候補を集める
      const cands = [];
      for (const [id, p] of paths) {
        for (const u of p.length === 1 ? [p[0]] : [p[0], p[p.length - 1]]) {
          for (const v of NB[u]) {
            const jd = owner[v];
            if (jd === id || !isEnd(v)) continue;
            cands.push({ u, v, w: Math.min(p.length, paths.get(jd).length) + Math.random() * 2.5 });
          }
        }
      }
      if (!cands.length) break;
      cands.sort((a, b) => a.w - b.w);

      let merged = false;
      for (const { u, v } of cands.slice(0, 40)) {
        const A = paths.get(owner[u]), B = paths.get(owner[v]);
        if (touches(A, B, u, v)) continue;
        const a = A[A.length - 1] === u ? A : A.slice().reverse();
        const b = B[0] === v ? B : B.slice().reverse();
        const joined = a.concat(b);
        paths.delete(owner[u]); paths.delete(owner[v]);
        const id = owner[u];
        paths.set(id, joined);
        for (const c of joined) owner[c] = id;
        merged = true;
        break;
      }
      if (!merged) break;
    }
    return [...paths.values()];
  }

  // ---------- ソルバー ----------
  // 解の個数を limit まで数える。nodeLimit を超えたら -1（判定不能）
  function countSolutions(n, ends, limit = 2, nodeLimit = 300000) {
    const NB = neighborsTable(n);
    const N = n * n, K = ends.length;
    const grid = new Int8Array(N).fill(-1);
    const isEndpoint = new Int8Array(N).fill(0);
    const head = new Int32Array(K), goal = new Int32Array(K), done = new Uint8Array(K);
    ends.forEach(([a, b], k) => {
      grid[a] = k; grid[b] = k; isEndpoint[a] = 1; isEndpoint[b] = 1;
      head[k] = a; goal[k] = b;
    });

    let solutions = 0, nodes = 0, aborted = false;
    const region = new Int32Array(N);

    // 行き止まり・孤立領域・到達不能を検出して枝刈り
    function feasible() {
      // 空きマスは「空き・未完成の先頭・未完成のゴール」の隣接が2つ以上必要
      for (let i = 0; i < N; i++) {
        if (grid[i] !== -1) continue;
        let c = 0;
        for (const j of NB[i]) {
          const g = grid[j];
          if (g === -1) c++;
          else if (!done[g] && (head[g] === j || goal[g] === j)) c++;
        }
        if (c < 2) return false;
      }
      // 空き領域にラベル付け
      region.fill(-1);
      let R = 0;
      const stack = [];
      for (let i = 0; i < N; i++) {
        if (grid[i] !== -1 || region[i] !== -1) continue;
        region[i] = R; stack.push(i);
        while (stack.length) {
          const c = stack.pop();
          for (const j of NB[c]) if (grid[j] === -1 && region[j] === -1) { region[j] = R; stack.push(j); }
        }
        R++;
      }
      // 各領域は、どれかの未完成の色の「先頭とゴールの両方」に接していなければならない
      const regionOk = new Uint8Array(R);
      for (let k = 0; k < K; k++) {
        if (done[k]) continue;
        const hr = new Set(), gr = new Set();
        for (const j of NB[head[k]]) if (grid[j] === -1) hr.add(region[j]);
        for (const j of NB[goal[k]]) if (grid[j] === -1) gr.add(region[j]);
        let reach = NB[head[k]].includes(goal[k]);
        for (const r of hr) if (gr.has(r)) { reach = true; regionOk[r] = 1; }
        if (!reach) return false; // 先頭からゴールへ行けない
      }
      for (let r = 0; r < R; r++) if (!regionOk[r]) return false;
      return true;
    }

    function solve() {
      if (aborted || solutions >= limit) return;
      if (++nodes > nodeLimit) { aborted = true; return; }

      // 未完成の色のうち、進める先が最も少ないものを選ぶ
      let best = -1, bestMoves = null;
      for (let k = 0; k < K; k++) {
        if (done[k]) continue;
        const moves = [];
        for (const j of NB[head[k]]) {
          if (grid[j] === -1 || j === goal[k]) moves.push(j);
        }
        if (moves.length === 0) return;
        if (!bestMoves || moves.length < bestMoves.length) {
          best = k; bestMoves = moves;
          if (moves.length === 1) break;
        }
      }
      if (best === -1) {
        for (let i = 0; i < N; i++) if (grid[i] === -1) return;
        solutions++;
        return;
      }

      const k = best, prev = head[k];
      for (const j of bestMoves) {
        if (j === goal[k]) {
          done[k] = 1;
          if (feasible()) solve();
          done[k] = 0;
        } else {
          grid[j] = k; head[k] = j;
          if (feasible()) solve();
          grid[j] = -1; head[k] = prev;
        }
        if (aborted || solutions >= limit) return;
      }
    }

    if (feasible()) solve();
    return aborted ? -1 : solutions;
  }

  // ---------- 問題生成 ----------
  // 解が1通りの問題が出るまで分割をやり直す
  function generate(n, { colors = n, budget = 2500 } = {}) {
    const start = Date.now();
    let fallback = null, tries = 0;
    while (true) {
      tries++;
      const paths = randomPartition(n, colors);
      const ok = paths.every((p) => p.length >= 3) && paths.length >= Math.max(2, colors - 1) && paths.length <= colors + 1;
      if (ok) {
        const ends = paths.map((p) => [p[0], p[p.length - 1]]);
        const cnt = countSolutions(n, ends, 2);
        const puzzle = { n, ends, solution: paths, unique: cnt === 1, tries };
        if (cnt === 1) return puzzle;
        if (!fallback && cnt >= 1) fallback = puzzle;
      }
      if (Date.now() - start > budget && fallback) return fallback;
    }
  }

  // プレイヤーの線が正解条件を満たすか（保存した解との一致ではなく、ルールで判定）
  function isSolved(n, ends, paths) {
    const NB = neighborsTable(n);
    const seen = new Uint8Array(n * n);
    for (let k = 0; k < ends.length; k++) {
      const p = paths[k];
      if (!p || p.length < 2) return false;
      const [a, b] = ends[k];
      if (!((p[0] === a && p[p.length - 1] === b) || (p[0] === b && p[p.length - 1] === a))) return false;
      for (let t = 0; t < p.length; t++) {
        if (seen[p[t]]) return false;
        seen[p[t]] = 1;
        if (t > 0 && !NB[p[t]].includes(p[t - 1])) return false;
      }
    }
    return seen.every((v) => v === 1);
  }

  return { generate, countSolutions, randomPartition, isSolved, neighborsTable };
})();

if (typeof module !== 'undefined') module.exports = LinkCore;
