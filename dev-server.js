// Локальный dev-сервер для проверки приложения без Vercel CLI.
// Раздаёт статику из корня проекта и роутит /api/schedule на serverless-функцию.
// Запуск: node dev-server.js [port]
//
// На проде на Vercel этот файл не используется — там / отдаёт vercel-static-server,
// а /api/schedule — это сама serverless-функция api/schedule.js.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 3000);

// Запускаем esbuild в watch-режиме как дочерний процесс. Это держит
// app/bundle.js в актуальном состоянии при правках в app/*.jsx без
// необходимости вручную дёргать npm run build.
const NO_WATCH = process.argv.includes('--no-build') || process.env.NO_BUILD === '1';
let builder = null;
if (!NO_WATCH) {
  builder = spawn(process.execPath, [path.join(ROOT, 'scripts', 'build.js'), '--watch'], {
    stdio: 'inherit',
  });
  process.on('exit', () => { try { builder?.kill(); } catch {} });
  process.on('SIGINT', () => { try { builder?.kill(); } catch {}; process.exit(0); });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.jsx':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.map':  'application/json',
};

const scheduleHandler = require('./api/schedule');
const notifyHandler = require('./api/notify');
const telegramHandler = require('./api/telegram');
const shiftsSyncHandler = require('./api/shifts-sync');

const API_ROUTES = {
  '/api/schedule': scheduleHandler,
  '/api/notify': notifyHandler,
  '/api/telegram': telegramHandler,
  '/api/shifts-sync': shiftsSyncHandler,
};

// Vercel-runtime парсит JSON-body сам; здесь читаем поток вручную.
function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function safePath(reqPath) {
  let p = decodeURIComponent(reqPath.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const abs = path.normalize(path.join(ROOT, p));
  // Защита от path traversal. Сравнение с ROOT+sep, а не голым ROOT:
  // иначе соседняя папка с тем же префиксом имени проходила бы проверку.
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url, true);
    req.query = parsed.query;

    const apiHandler = API_ROUTES[parsed.pathname];
    if (apiHandler) {
      console.log(`[api] ${req.method} ${req.url}`);
      if (req.method === 'POST') req.body = await readJsonBody(req);
      // Адаптируем Node http.ServerResponse под мини-API Vercel
      const wrapped = Object.assign(res, {
        status(code) { res.statusCode = code; return wrapped; },
      });
      await apiHandler(req, wrapped);
      return;
    }

    const abs = safePath(parsed.pathname);
    if (!abs) { res.statusCode = 403; return res.end('Forbidden'); }

    fs.stat(abs, (err, stat) => {
      if (err || !stat.isFile()) {
        res.statusCode = 404;
        return res.end(`Not Found: ${parsed.pathname}`);
      }
      const ext = path.extname(abs).toLowerCase();
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(abs).pipe(res);
    });
  } catch (err) {
    console.error('handler error:', err);
    res.statusCode = 500;
    res.end('Internal error: ' + (err?.message || String(err)));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`dev-server listening on 0.0.0.0:${PORT}`);
  console.log(`  static root: ${ROOT}`);
  console.log(`  API:         /api/schedule (?refresh=1 чтобы обойти 5-мин кеш)`);
  console.log('');
  console.log('  Открывайте на этом ПК:');
  console.log(`    http://localhost:${PORT}`);
  console.log('  С телефона в той же Wi-Fi-сети:');
  const ifs = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifs)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`    http://${a.address}:${PORT}   (${name})`);
      }
    }
  }
});
