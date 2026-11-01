// ===== Service Worker：アプリ一式をキャッシュしてオフラインで動かす =====
// ファイルを更新したら CACHE の番号を上げること（v1 → v2）
const CACHE = 'numpre-v7';
const ASSETS = [
  './',
  './index.html',      // ゲーム選択画面
  './style.css',       // 共通スタイル
  // ナンプレ
  './numpre.html',
  './sudoku.js',
  './app.js',
  './worker.js',
  // マインスイーパー
  './mines.html',
  './mines.css',
  './mines-core.js',
  './mines.js',
  // ナンバーリンク
  './link.html',
  './link.css',
  './link-core.js',
  './link-worker.js',
  './link.js',
  // 共通
  './layout.js',       // 配置の調整（共通）
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// キャッシュ優先：あればキャッシュから返し、なければネットから取ってキャッシュする
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
