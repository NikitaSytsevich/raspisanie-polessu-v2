// Сборка полного снапшота расписания (общая для /api/schedule и /api/notify).
// Параллельно тянет 4 страницы ПолесГУ, гонит через per-facility парсеры,
// подменяет упавшие источники last-known-good данными.

const crypto = require('crypto');
const { FACILITIES } = require('../_parsers');
const { fetchHtml } = require('./fetcher');
const { todayIsoMinsk } = require('./timeParse');
const lastGood = require('./lastGood');

const TZ = 'Europe/Minsk';

// Отпечаток HTML для диагностики template/parse_error: сам HTML в _issue не
// тащим (большой), но по длине и хэшу видно, менялась ли страница между
// неудачными прогонами — помогает отлаживать сломанную вёрстку без ручного
// повторного fetch'а.
function htmlFingerprint(html) {
  return {
    htmlLength: html.length,
    htmlSha1: crypto.createHash('sha1').update(html).digest('hex').slice(0, 12),
  };
}

async function loadFacility(f, ctx) {
  const startedAt = new Date().toISOString();
  // Один retry с укороченным таймаутом: первая попытка 8 с, вторая 4 с —
  // даже худший случай (4 источника падают дважды) укладывается в
  // maxDuration: 15, потому что источники идут параллельно.
  let res = await fetchHtml(f.sourceUrl);
  if (!res.ok) res = await fetchHtml(f.sourceUrl, { timeoutMs: 4000 });
  if (!res.ok) {
    return {
      id: f.id,
      name: f.name,
      sourceUrl: f.sourceUrl,
      dataQuality: 'parse_error',
      sourceCheckedAt: startedAt,
      notice: null,
      sessions: [],
      _issue: { id: f.id, reason: res.error, status: res.status },
    };
  }
  let parsed;
  try {
    parsed = f.parse(res.html, ctx);
  } catch (err) {
    return {
      id: f.id,
      name: f.name,
      sourceUrl: f.sourceUrl,
      dataQuality: 'parse_error',
      sourceCheckedAt: startedAt,
      notice: null,
      sessions: [],
      _issue: { id: f.id, reason: 'parser_threw', message: err?.message || String(err), ...htmlFingerprint(res.html) },
    };
  }

  if (parsed.ok) {
    return {
      id: f.id,
      name: f.name,
      sourceUrl: f.sourceUrl,
      dataQuality: 'ok',
      sourceCheckedAt: startedAt,
      notice: null,
      sessions: parsed.sessions,
      // Расписание есть, но одновременно объект частично закрыт (ремонт,
      // отключение воды и т.п.). Каждый range = { from, to, notice } в
      // ISO-формате. Фронт пометит смены, попадающие в окно, как closed.
      closureRanges: Array.isArray(parsed.closureRanges) ? parsed.closureRanges : [],
    };
  }
  if (parsed.reason === 'closed') {
    return {
      id: f.id,
      name: f.name,
      sourceUrl: f.sourceUrl,
      dataQuality: 'closed',
      sourceCheckedAt: startedAt,
      notice: parsed.notice || 'объект временно закрыт',
      closureRange: parsed.range || null,
      sessions: [],
    };
  }
  // no_table / прочее
  return {
    id: f.id,
    name: f.name,
    sourceUrl: f.sourceUrl,
    dataQuality: 'template',
    sourceCheckedAt: startedAt,
    notice: null,
    sessions: [],
    _issue: { id: f.id, reason: parsed.reason || 'unknown', ...htmlFingerprint(res.html) },
  };
}

async function buildPayload() {
  const todayIso = todayIsoMinsk();
  const ctx = { todayIso };
  const generatedAt = new Date().toISOString();
  const results = await Promise.all(FACILITIES.map(f => loadFacility(f, ctx)));

  // Last-known-good: источник упал (сеть/парсер) → подменяем последним
  // успешным снапшотом этого объекта с флагом stale:true, вместо того
  // чтобы отдать parse_error и оставить всех клиентов без расписания.
  // dataQuality остаётся 'ok' — фронт работает как обычно; «свежесть»
  // видна по sourceCheckedAt и meta.sourceIssues.
  let staleCount = 0;
  if (results.some(r => r.dataQuality === 'parse_error')) {
    const lg = await lastGood.load();
    if (lg) {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.dataQuality === 'parse_error' && lg[r.id] && lg[r.id].dataQuality === 'ok') {
          results[i] = { ...lg[r.id], stale: true, _issue: r._issue };
          staleCount++;
        }
      }
    }
  }
  // Свежие ok-объекты — в last-good (память инстанса + Vercel Blob).
  // Берём только объекты, у которых есть хоть одна сессия не в прошлом:
  // расписание целиком из прошедших дат (сайт забыл обновить страницу)
  // не должно становиться «последним хорошим».
  try {
    await lastGood.update(results.filter(r =>
      r.dataQuality === 'ok' && !r.stale && r.sessions.some(s => s.date >= todayIso)));
  } catch {}

  const facilities = results.map(({ _issue, ...rest }) => rest);
  const sourceIssues = results
    .filter(r => r._issue || r.dataQuality === 'parse_error')
    .map(r => r._issue || { id: r.id, reason: 'unknown' });

  return {
    // v4: facility.closureRanges?: [{from, to, notice}] для частичного
    // закрытия. v4.1 (additive): facility.stale?: true — данные объекта
    // взяты из last-known-good, источник в этот раз не ответил.
    schemaVersion: 4,
    generatedAt,
    sourceCheckedAt: generatedAt,
    timezone: TZ,
    facilities,
    meta: {
      cached: false,
      sourceCount: FACILITIES.length,
      sourceIssueCount: sourceIssues.length,
      sourceIssues,
      staleCount,
      todayIso,
    },
  };
}

module.exports = { buildPayload, TZ };
