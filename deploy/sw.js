/* LinguaDE · Service Worker
 * 仅在 http(s) 部署形态下由前端条件注册（file:// 单文件版不加载、不发任何请求）。
 * 策略：应用外壳 cache-first；页面导航 network-first、断网回退缓存。
 */
const CACHE = "linguade-v22";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-maskable.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // 后端 API 永不缓存（SSE / 转写 / 同步都要求实时）
  if (url.pathname.startsWith("/api/")) return;

  if (e.request.mode === "navigate") {
    /* 导航缓存优先 + 后台更新：2.6MB 单文件外壳在 4Mbps 带宽上来回拉取会被限速，
       首次访问照常走网络，之后立即用缓存并在后台取新版（新 SW 安装时也会预缓存）。 */
    const network = fetch(e.request).then((r) => {
      if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
      return r;
    });
    e.waitUntil(network.catch(() => {}));
    e.respondWith(
      caches.open(CACHE).then((c) => c.match(e.request))
        .then((cached) => cached || network)
        .catch(() => caches.match("./index.html"))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((m) => m || fetch(e.request).then((r) => {
      if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
      return r;
    }))
  );
});
