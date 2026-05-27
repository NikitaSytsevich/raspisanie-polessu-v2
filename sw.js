// sw.js — service worker для офлайна и SWR-кеша /api/schedule.
//
// Стратегии:
//   1. App-shell (HTML, bundle.js, CSS, иконки, шрифты, manifest)
//      → cache-first. Precache на install для гарантированного
//        старта офлайн. Кеш версионируется, старые версии чистим
//        на activate.
//   2. /api/schedule → stale-while-revalidate. Возвращаем последний
//      кешированный ответ мгновенно, параллельно идём в сеть и
//      обновляем кеш для следующего вызова.
//   3. Внешние шрифты Google → cache-first с TTL по факту (не
//      инвалидируем явно — раз скачали, дальше офлайн).
//   4. Прочее → network-only.

const VERSION = 'v7-2026-05-27-safe-area-paint';
const SHELL_CACHE = `rpgu-shell-${VERSION}`;
const API_CACHE   = `rpgu-api-${VERSION}`;
const FONT_CACHE  = `rpgu-fonts-${VERSION}`;
const CDN_CACHE   = `rpgu-cdn-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app/bundle.js',
  '/app/styles.min.css',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon-32.png',
];

// React UMD грузится с unpkg в index.html. Раньше SW его не кешировал —
// первый офлайн-старт после deploy ронял приложение. Прекеш на install
// + cache-first в fetch-handler фиксит это.
const CDN_ASSETS = [
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // addAll прерывается, если хоть один файл не отдался. На dev-сервере
    // часть путей может отсутствовать — используем individual fetch
    // с suppress-errors, чтобы установка не падала из-за одного 404.
    await Promise.all(SHELL_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await shell.put(url, res);
      } catch {}
    }));
    // CDN-ассеты в отдельный кеш с opaque-fallback (cross-origin без CORS).
    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(CDN_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload', mode: 'no-cors' });
        await cdn.put(url, res);
      } catch {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => {
      if (n !== SHELL_CACHE && n !== API_CACHE && n !== FONT_CACHE && n !== CDN_CACHE) {
        return caches.delete(n);
      }
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1. /api/schedule — stale-while-revalidate
  if (url.pathname === '/api/schedule' && url.origin === self.location.origin) {
    event.respondWith(swrFetch(req, API_CACHE));
    return;
  }

  // 2. Google fonts — cache-first
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  // 3. unpkg — React UMD, cache-first (с opaque-ответом тоже работает).
  if (url.host === 'unpkg.com') {
    event.respondWith(cacheFirst(req, CDN_CACHE));
    return;
  }

  // 4. HTML (навигация по '/' или /index.html) — network-FIRST.
  // index.html содержит inline-скрипт, выставляющий theme-color по
  // localStorage темы пользователя ДО первого paint. Если SW отдаёт
  // устаревший index.html, в iOS PWA возвращается баг с непрозрачной
  // полосой под home-indicator. Поэтому идём в сеть, а кэш — только
  // офлайн-фолбэк.
  const isNavigation = req.mode === 'navigate';
  const isHtmlPath = url.origin === self.location.origin
    && (url.pathname === '/' || url.pathname === '/index.html');
  if (isNavigation || isHtmlPath) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // 5. Прочие same-origin GET — cache-first с network fallback
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    // cache: 'reload' заставляет браузер бить мимо HTTP-кэша и идти в сеть.
    const res = await fetch(req, { cache: 'reload' });
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    const cached = await cache.match(req) || await cache.match('/index.html') || await cache.match('/');
    return cached || new Response('Offline', { status: 504 });
  }
}

async function swrFetch(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  // Если кеш есть — отдаём его сразу, иначе ждём сеть.
  return cached || networkPromise || new Response(
    JSON.stringify({ error: 'offline', schemaVersion: 3, facilities: [], meta: { sourceCount: 0, sourceIssueCount: 0, sourceIssues: [] } }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) {
    // Освежаем из сети «в фоне» с cache:'reload', чтобы бить мимо
    // HTTP-кэша браузера / устаревшего CDN-edge. Иначе background-fetch
    // мог затащить в SHELL_CACHE stale-ответ, и баг возвращался «спустя
    // время» после успешного фикса.
    fetch(req, { cache: 'reload' }).then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    // Сеть упала, в кеше тоже ничего — отдаём оффлайн-страницу или 504.
    const offline = await cache.match('/index.html');
    return offline || new Response('Offline', { status: 504 });
  }
}
