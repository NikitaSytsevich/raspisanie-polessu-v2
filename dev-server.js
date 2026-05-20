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

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 3000);

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

function safePath(reqPath) {
  let p = decodeURIComponent(reqPath.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const abs = path.normalize(path.join(ROOT, p));
  if (!abs.startsWith(ROOT)) return null; // защита от path traversal
  return abs;
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url, true);
    req.query = parsed.query;

    if (parsed.pathname === '/api/schedule') {
      console.log(`[api] ${req.method} ${req.url}`);
      // Адаптируем Node http.ServerResponse под мини-API Vercel
      const origStatus = res.statusCode;
      const wrapped = Object.assign(res, {
        status(code) { res.statusCode = code; return wrapped; },
      });
      await scheduleHandler(req, wrapped);
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
