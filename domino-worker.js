// ===== ドミノ倒し 問題生成用 Web Worker =====
importScripts('domino-core.js');

self.onmessage = (e) => {
  const { id, n, opts } = e.data;
  const p = DominoCore.generate(n, opts);
  self.postMessage({ id, ...p });
};
