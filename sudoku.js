// ===== ナンプレ 問題生成・解析ロジック =====
// 盤面は長さ81の配列（0 = 空きマス, 1〜9 = 数字）で表す
'use strict';

const Sudoku = (() => {
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // マス i に数字 n を置けるか（行・列・3×3ブロックの重複チェック）
  function canPlace(b, i, n) {
    const r = Math.floor(i / 9), c = i % 9;
    const br = r - (r % 3), bc = c - (c % 3);
    for (let k = 0; k < 9; k++) {
      if (b[r * 9 + k] === n) return false;
      if (b[k * 9 + c] === n) return false;
      if (b[(br + Math.floor(k / 3)) * 9 + bc + (k % 3)] === n) return false;
    }
    return true;
  }

  // バックトラッキングでランダムな完成盤面を作る
  function fillBoard(b) {
    const i = b.indexOf(0);
    if (i === -1) return true;
    for (const n of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      if (canPlace(b, i, n)) {
        b[i] = n;
        if (fillBoard(b)) return true;
        b[i] = 0;
      }
    }
    return false;
  }

  // 解の個数を数える（limit 個見つかったら打ち切り）
  // 候補が最も少ないマスから試すことで高速化している
  function countSolutions(b, limit = 2) {
    let best = -1;
    let bestCands = null;
    for (let i = 0; i < 81; i++) {
      if (b[i] !== 0) continue;
      const cands = [];
      for (let n = 1; n <= 9; n++) if (canPlace(b, i, n)) cands.push(n);
      if (cands.length === 0) return 0;
      if (!bestCands || cands.length < bestCands.length) {
        best = i;
        bestCands = cands;
        if (cands.length === 1) break;
      }
    }
    if (best === -1) return 1; // 空きマスなし = 解が1つ見つかった

    let count = 0;
    for (const n of bestCands) {
      b[best] = n;
      count += countSolutions(b, limit - count);
      b[best] = 0;
      if (count >= limit) break;
    }
    return count;
  }

  // 問題を生成する。clues = 残すヒント数の目標
  function generate(clues) {
    const solution = new Array(81).fill(0);
    fillBoard(solution);

    const puzzle = solution.slice();
    let filled = 81;
    const order = shuffle([...Array(81).keys()]);

    for (const i of order) {
      if (filled <= clues) break;
      const backup = puzzle[i];
      puzzle[i] = 0;
      if (countSolutions(puzzle, 2) !== 1) {
        puzzle[i] = backup; // 解が一意でなくなるなら戻す
      } else {
        filled--;
      }
    }
    return { puzzle, solution, clues: filled };
  }

  // 解くのにどれだけ探索が必要か（分岐したノード数）。大きいほど難しい目安
  function searchEffort(puzzle) {
    const b = puzzle.slice();
    let nodes = 0;
    (function solve() {
      let best = -1, bestCands = null;
      for (let i = 0; i < 81; i++) {
        if (b[i] !== 0) continue;
        const cands = [];
        for (let n = 1; n <= 9; n++) if (canPlace(b, i, n)) cands.push(n);
        if (cands.length === 0) return false;
        if (!bestCands || cands.length < bestCands.length) {
          best = i; bestCands = cands;
          if (cands.length === 1) break;
        }
      }
      if (best === -1) return true;
      if (bestCands.length > 1) nodes += bestCands.length;
      for (const n of bestCands) {
        b[best] = n;
        if (solve()) return true;
        b[best] = 0;
      }
      return false;
    })();
    return nodes;
  }

  // 最小限のヒントだけの問題を作る
  // 「どのヒントを1つ消しても解が1つに定まらない」状態（極小問題）を
  // 時間内に何問も作り、ヒントが最も少ないもの（同数なら探索量が多いもの）を選ぶ
  function generateMinimal(timeBudgetMs = 1500, maxTries = 400) {
    const start = Date.now();
    let best = null;
    for (let t = 0; t < maxTries; t++) {
      const g = generate(0); // 目標0 = 消せるだけ消す → 必ず極小問題になる
      g.effort = searchEffort(g.puzzle);
      if (!best || g.clues < best.clues || (g.clues === best.clues && g.effort > best.effort)) {
        best = g;
      }
      if (Date.now() - start > timeBudgetMs) break;
    }
    return best;
  }

  // すべてのヒントが必要か（1つでも消せるヒントがあれば false）
  function isMinimal(puzzle) {
    const b = puzzle.slice();
    for (let i = 0; i < 81; i++) {
      if (!b[i]) continue;
      const v = b[i];
      b[i] = 0;
      const unique = countSolutions(b, 2) === 1;
      b[i] = v;
      if (unique) return false;
    }
    return true;
  }

  return { generate, generateMinimal, countSolutions, canPlace, searchEffort, isMinimal };
})();

if (typeof module !== 'undefined') module.exports = Sudoku;
