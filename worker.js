// ===== 問題生成用 Web Worker =====
// 生成に時間がかかっても画面が固まらないよう、別スレッドで動かす
importScripts('sudoku.js');

self.onmessage = (e) => {
  const { id, clues, minimal, budget } = e.data;
  const result = minimal ? Sudoku.generateMinimal(budget) : Sudoku.generate(clues);
  self.postMessage({ id, puzzle: result.puzzle, solution: result.solution, clues: result.clues });
};
