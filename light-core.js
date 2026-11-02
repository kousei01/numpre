// ===== 光の回路 問題生成・ソルバー =====
// 盤面 n×n。マスの種類：
//   空き / 壁 / 光源（向きと色つき）/ 鏡（／＼をタップで切り替え）/ ハーフミラー（光を通しつつ反射もする）
// 宝石は空きマスに置かれ、光が通り抜ける。宝石ごとに「当たるべき光の色」が決まっている。
// 全部の宝石が、ちょうどその色の光で照らされたらクリア。
'use strict';

const LightCore = (() => {
  // 方向：0=上 1=右 2=下 3=左
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const SLASH = [1, 0, 3, 2];  // ／ に当たったときの向き
  const BACK  = [3, 2, 1, 0];  // ＼ に当たったときの向き
  // 色はビットで表す：1 = 黄（単色の面）または赤、2 = 青、3 = 紫（赤＋青）
  const EMPTY = 0, WALL = 1, SOURCE = 2, MIRROR = 3, SPLIT = 4;

  function step(n, i, d) {
    const x = (i % n) + DX[d], y = ((i / n) | 0) + DY[d];
    if (x < 0 || y < 0 || x >= n || y >= n) return -1;
    return y * n + x;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- 光の追跡 ----------
  // board: { n, kind[], src: [{cell, dir, color}], gems: {cell: color} }
  // orient[i]：鏡・ハーフミラーの向き（0=／ 1=＼ -1=未定）
  // 未定の鏡に光が当たったら、そこで止めて halted に記録する（ソルバー用）
  // 戻り値：lit[i]（そのマスを通った光の色）、segs（描画用の線分）、halted、touched（光が当たった鏡）
  function trace(b, orient) {
    const { n, kind } = b;
    const lit = new Uint8Array(n * n);
    const seen = new Uint8Array(n * n * 4 * 4);   // [マス][向き][色] の通過済み（ループ防止）
    const segs = [];
    const halted = [], touched = new Set();
    const queue = [];
    for (const s of b.src) queue.push({ from: s.cell, dir: s.dir, color: s.color });

    while (queue.length) {
      const { from, dir, color } = queue.shift();
      const next = step(n, from, dir);
      const fx = (from % n) + 0.5, fy = ((from / n) | 0) + 0.5;
      if (next < 0) {                                            // 盤の外へ
        segs.push({ color, x1: fx, y1: fy, x2: fx + DX[dir] * 0.5, y2: fy + DY[dir] * 0.5 });
        continue;
      }
      const k = kind[next];
      if (k === WALL || k === SOURCE) {                          // 壁・光源で止まる
        segs.push({ color, x1: fx, y1: fy, x2: fx + DX[dir] * 0.5, y2: fy + DY[dir] * 0.5 });
        continue;
      }
      const key = ((next * 4 + dir) << 2) | color;
      if (seen[key]) continue;
      seen[key] = 1;
      lit[next] |= color;
      segs.push({ color, x1: fx, y1: fy, x2: (next % n) + 0.5, y2: ((next / n) | 0) + 0.5 });

      if (k === MIRROR || k === SPLIT) {
        touched.add(next);
        const o = orient[next];
        if (o < 0) { halted.push(next); continue; }
        const turned = (o === 0 ? SLASH : BACK)[dir];
        queue.push({ from: next, dir: turned, color });
        if (k === SPLIT) queue.push({ from: next, dir, color });
      } else {
        queue.push({ from: next, dir, color });
      }
    }
    return { lit, segs, halted, touched };
  }

  // 宝石がすべて「ちょうどその色」で照らされているか
  function evaluate(b, lit) {
    let ok = 0, wrong = 0;
    for (const c in b.gems) {
      const want = b.gems[c], got = lit[c];
      if (got === want) ok++;
      else if (got & ~want) wrong++;
    }
    return { ok, wrong, total: Object.keys(b.gems).length, solved: ok === Object.keys(b.gems).length };
  }

  // ---------- ソルバー：全部の宝石を正しく照らす鏡の向きを数える ----------
  // 光が当たった鏡だけを順に決めていく（当たらない鏡の向きは答えに関係ない）
  function countSolutions(b, fixed, limit = 2, nodeLimit = 200000) {
    const N = b.n * b.n;
    const orient = new Int8Array(N).fill(-1);
    if (fixed) for (let i = 0; i < N; i++) if (fixed[i] >= 0) orient[i] = fixed[i];
    const sols = [];
    let count = 0, nodes = 0, aborted = false;

    (function dfs() {
      if (aborted || count >= limit) return;
      if (++nodes > nodeLimit) { aborted = true; return; }
      const t = trace(b, orient);
      // 宝石に余計な色がもう当たっていたら、この先どうしても直らない
      for (const c in b.gems) if (t.lit[c] & ~b.gems[c]) return;
      if (t.halted.length) {
        const e = t.halted[0];
        for (const v of [0, 1]) {
          orient[e] = v;
          dfs();
          orient[e] = -1;
          if (aborted || count >= limit) return;
        }
        return;
      }
      if (evaluate(b, t.lit).solved) {
        count++;
        if (sols.length < limit) sols.push(Array.from(orient));
      }
    })();
    return aborted ? -1 : { count, solutions: sols };
  }

  // ---------- 問題生成 ----------
  // cfg: { n, sources(1|2), mirrors, splits, walls, gems, minTouched }
  function generate(cfg) {
    const { n } = cfg;
    const N = n * n;
    for (let attempt = 0; attempt < 5000; attempt++) {
      const kind = new Array(N).fill(EMPTY);
      const orient = new Array(N).fill(-1);
      const free = () => shuffle([...Array(N).keys()].filter((i) => kind[i] === EMPTY));

      // 光源：外周のマスに、内側を向けて置く
      const src = [];
      const colors = cfg.sources === 2 ? [1, 2] : [1];
      for (const color of colors) {
        const edge = free().filter((i) => {
          const x = i % n, y = (i / n) | 0;
          return x === 0 || y === 0 || x === n - 1 || y === n - 1;
        });
        const cell = edge[0];
        const x = cell % n, y = (cell / n) | 0;
        const dirs = [];
        if (y === n - 1) dirs.push(0);
        if (x === 0) dirs.push(1);
        if (y === 0) dirs.push(2);
        if (x === n - 1) dirs.push(3);
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        if (step(n, cell, dir) < 0) continue;
        kind[cell] = SOURCE;
        src.push({ cell, dir, color });
      }
      if (src.length !== colors.length) continue;

      // 光の道をたどりながら、曲がる地点に鏡を置いていく
      const front = new Set(src.map((s) => step(n, s.cell, s.dir)));
      const passed = new Set();                // 光がまっすぐ通ったマス（ここに鏡を置くと道が変わる）
      let splitsLeft = cfg.splits;
      let turnsLeft = cfg.minTouched + Math.floor(Math.random() * 2);
      for (let si = 0; si < src.length; si++) {
        let cur = src[si].cell, dir = src[si].dir;
        let turns = Math.ceil(turnsLeft / (src.length - si));
        let guard = 0;
        while (turns > 0 && guard++ < 60) {
          // 1〜3マス進む
          const len = 1 + Math.floor(Math.random() * 3);
          let moved = 0;
          for (let k = 0; k < len; k++) {
            const nx = step(n, cur, dir);
            if (nx < 0 || kind[nx] !== EMPTY) break;
            if (k < len - 1) passed.add(nx);
            cur = nx; moved++;
          }
          if (!moved || kind[cur] !== EMPTY || passed.has(cur) && moved === len) {
            // 進めない／置けない：まっすぐ通過扱いにして終わり
            break;
          }
          passed.delete(cur);
          // 曲がる向き（盤の中で、次のマスが空いている向き）
          const opts = shuffle([(dir + 1) % 4, (dir + 3) % 4]).filter((d) => {
            const nx = step(n, cur, d);
            return nx >= 0 && kind[nx] === EMPTY;
          });
          if (!opts.length || passed.has(cur)) { passed.add(cur); break; }
          const nd = opts[0];
          // ／ と ＼ のどちらで dir → nd に曲がるか
          const o = SLASH[dir] === nd ? 0 : 1;
          const useSplit = splitsLeft > 0 && Math.random() < 0.35;
          kind[cur] = useSplit ? SPLIT : MIRROR;
          if (useSplit) splitsLeft--;
          orient[cur] = o;
          dir = nd;
          turns--; turnsLeft--;
        }
      }
      // まだ置いていないハーフミラーは、光の通るマスに後から置く
      {
        const t0 = trace({ n, kind, src, gems: {} }, orient);
        for (const c of shuffle([...Array(n * n).keys()]).filter((i) => kind[i] === EMPTY && t0.lit[i] && !front.has(i))) {
          if (splitsLeft <= 0) break;
          kind[c] = SPLIT; orient[c] = Math.random() < 0.5 ? 0 : 1; splitsLeft--;
        }
      }
      // ダミーの鏡と壁は、光が通らないマスに置く
      {
        const t1 = trace({ n, kind, src, gems: {} }, orient);
        const placed = kind.filter((k) => k === MIRROR || k === SPLIT).length;
        const dark = shuffle([...Array(n * n).keys()].filter((i) => kind[i] === EMPTY && !t1.lit[i] && !front.has(i)));
        let k = 0;
        for (let m = placed; m < cfg.mirrors + cfg.splits && k < dark.length; m++, k++) {
          kind[dark[k]] = MIRROR; orient[dark[k]] = Math.random() < 0.5 ? 0 : 1;
        }
        for (let w = 0; w < cfg.walls && k < dark.length; w++, k++) kind[dark[k]] = WALL;
      }

      const b = { n, kind, src, gems: {} };
      const t = trace(b, orient);
      // 光がたくさんの鏡で曲がる配置だけを使う
      if (t.touched.size < cfg.minTouched) continue;
      if (cfg.splits && ![...t.touched].some((c) => kind[c] === SPLIT)) continue;
      if (cfg.sources === 2 && !t.lit.some((v) => v === 3)) continue;

      // 宝石：光が通る空きマスから選ぶ（2色の面では色の種類が偏らないように）
      const litCells = shuffle([...Array(N).keys()].filter((i) => kind[i] === EMPTY && t.lit[i]));
      if (litCells.length < cfg.gems + 2) continue;
      // 光源から遠い（たくさん曲がった先の）マスを優先したいので、順番の後ろ半分を多めに
      for (const c of litCells.slice(0, cfg.gems)) b.gems[c] = t.lit[c];
      if (cfg.sources === 2) {
        const kinds = new Set(Object.values(b.gems));
        if (kinds.size < 2) continue;
      }

      // 答えが1通りになるまで、別解と違う所に宝石（または壁）を足す
      let ok = false;
      for (let guard = 0; guard < 20; guard++) {
        const r = countSolutions(b, null, 2);
        if (r === -1) break;
        if (r.count === 1) { ok = true; break; }
        const alt = r.solutions.find((s) => [...t.touched].some((c) => s[c] !== orient[c])) || r.solutions[1];
        const ta = trace(b, alt.map((v) => (v < 0 ? 0 : v)));
        const diffLit = shuffle([...Array(N).keys()].filter((i) =>
          kind[i] === EMPTY && !(i in b.gems) && t.lit[i] && t.lit[i] !== ta.lit[i]));
        if (diffLit.length) { b.gems[diffLit[0]] = t.lit[diffLit[0]]; continue; }
        const diffDark = shuffle([...Array(N).keys()].filter((i) =>
          kind[i] === EMPTY && !(i in b.gems) && !t.lit[i] && ta.lit[i] && !front.has(i)));
        if (diffDark.length) { kind[diffDark[0]] = WALL; continue; }
        break;
      }
      if (!ok) continue;
      if (Object.keys(b.gems).length > cfg.gems + 4) continue;   // 宝石が多すぎる問題は見た目がうるさいので捨てる

      // 答え（光が当たる鏡だけが意味を持つ）とスクランブル
      const solution = orient.slice();
      const touched = [...trace(b, solution).touched];
      const start = orient.map((o, i) => (o < 0 ? -1 : Math.random() < 0.5 ? 0 : 1));
      const wrong = touched.filter((c) => start[c] !== solution[c]).length;
      if (wrong < Math.ceil(touched.length / 3)) continue;
      if (evaluate(b, trace(b, start).lit).solved) continue;

      return { n, kind, src, gems: b.gems, solution, start, touched, par: wrong };
    }
    throw new Error('generate failed');
  }

  return { DX, DY, EMPTY, WALL, SOURCE, MIRROR, SPLIT, step, trace, evaluate, countSolutions, generate };
})();

if (typeof module !== 'undefined') module.exports = LightCore;
