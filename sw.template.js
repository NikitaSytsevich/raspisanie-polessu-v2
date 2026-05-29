// sw.template.js — ШАБЛОН service worker'а.
//
// Реальный sw.js генерируется из него scripts/build.js: подставляются
// плейсхолдеры версии сборки и списка precache-ассетов (с хэшированными
// именами). Правьте этот файл, а не сгенерированный sw.js.
//
// Стратегии:
//   1. App-shell (HTML, bundle, CSS, React-vendor, иконки, manifest)
//      → precache на install. Хэшированные /app/* — cache-first БЕЗ
//        фоновой ревалидации (имена immutable, содержимое не меняется).
//   2. /api/schedule → stale-while-revalidate.
//   3. Внешние шрифты Google → cache-first с фоновым обновлением.
//   4. HTML (навигация) → network-first (нужен свежий inline theme-color
//      для iOS PWA), кэш — офлайн-фолбэк.
//   5. Прочее same-origin → cache-first.

const VERSION = '__VERSION__';
const SHELL_CACHE = `rpgu-shell-${VERSION}`;
const API_CACHE   = `rpgu-api-${VERSION}`;
const FONT_CACHE  = `rpgu-fonts-${VERSION}`;

// Список генерируется сборкой и включает хэшированные bundle/styles/react.
const SHELL_ASSETS = __PRECACHE_ASSETS__;

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
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => {
      if (n !== SHELL_CACHE && n !== API_CACHE && n !== FONT_CACHE) {
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

  // 2. Google fonts — cache-first (с фоновым обновлением)
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  // 3. HTML (навигация по '/' или /index.html) — network-FIRST.
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

  // 4. Хэшированные ассеты /app/* — cache-first БЕЗ ревалидации.
  // Имена содержат content-hash → содержимое неизменно. Нет смысла
  // ходить в сеть в фоне (это раньше жгло трафик на каждый hit).
  if (url.origin === self.location.origin && url.pathname.startsWith('/app/')) {
    event.respondWith(cacheFirstImmutable(req, SHELL_CACHE));
    return;
  }

  // 5. Прочие same-origin GET — cache-first с фоновым обновлением.
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

// Immutable-ассеты: вернуть из кэша без фонового запроса. В кэше нет —
// тащим из сети и кладём.
async function cacheFirstImmutable(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    const offline = await cache.match('/index.html');
    return offline || new Response('Offline', { status: 504 });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) {
    // Освежаем из сети «в фоне» с cache:'reload', чтобы бить мимо
    // HTTP-кэша браузера / устаревшего CDN-edge.
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
