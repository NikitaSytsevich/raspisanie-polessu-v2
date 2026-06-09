// GET /api/schedule
// Vercel serverless function. Сборка снапшота — в _lib/snapshot.js
// (общая с /api/notify): параллельный фетч 4 страниц, парсеры,
// last-known-good подмена упавших источников.
//
// Параметры:
//   ?refresh=1 → отключить CDN-кеш (Cache-Control: no-store)
//
// Ответ соответствует schemaVersion 4, ожидаемой фронтендом
// (см. MOCK_SCHEDULE в app/data.jsx).

const crypto = require('crypto');
const { buildPayload } = require('./_lib/snapshot');

module.exports = async (req, res) => {
  const refresh = String(req?.query?.refresh ?? '') === '1';
  const payload = await buildPayload();

  // ETag по СОДЕРЖИМОМУ расписания (без волатильных таймстемпов —
  // generatedAt/sourceCheckedAt меняются каждый вызов и сломали бы кэш).
  // Браузер хранит ответ с max-age=0/must-revalidate и на каждую
  // 5-минутную проверку шлёт If-None-Match: если расписание не менялось,
  // уходит пустой 304 вместо полного JSON — экономия мобильного трафика.
  const basis = JSON.stringify(payload.facilities.map(f => [
    f.id, f.dataQuality, f.notice, f.stale || false,
    f.sessions, f.closureRanges || null, f.closureRange || null,
  ]));
  const etag = '"' + crypto.createHash('sha1').update(basis).digest('base64url').slice(0, 20) + '"';

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('ETag', etag);
  if (refresh) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  } else {
    // s-maxage=300 — Vercel CDN на 5 минут (+10 stale-while-revalidate);
    // max-age=0, must-revalidate — браузеру можно хранить, но каждый раз
    // ревалидировать условным запросом (дёшево благодаря ETag выше).
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=600');
  }

  const inm = req.headers && req.headers['if-none-match'];
  if (!refresh && inm && inm === etag) {
    res.status(304).end();
    return;
  }
  res.status(200).end(JSON.stringify(payload));
};
