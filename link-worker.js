// ===== ナンバーリンク 問題生成用 Web Worker =====
importScripts('link-core.js');

self.onmessage = (e) => {
  const { id, n, colors } = e.data;
  const p = LinkCore.generate(n, { colors, budget: 4000 });
  self.postMessage({ id, n: p.n, ends: p.ends, solution: p.solution, unique: p.unique });
};
