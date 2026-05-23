// GET /api/schedule
// Vercel serverless function. Параллельно тянет 4 страницы ПолесГУ,
// гонит через per-facility парсер и возвращает сводный snapshot.
//
// Параметры:
//   ?refresh=1 → отключить CDN-кеш (Cache-Control: no-store)
//
// Ответ соответствует schemaVersion 3, ожидаемой фронтендом
// (см. MOCK_SCHEDULE в app/data.jsx).

const { FACILITIES } = require('./_parsers');
const { fetchHtml } = require('./_lib/fetcher');
const { todayIsoMinsk } = require('./_lib/timeParse');

const TZ = 'Europe/Minsk';

async function loadFacility(f, ctx) {
  const startedAt = new Date().toISOString();
  const res = await fetchHtml(f.sourceUrl);
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
      _issue: { id: f.id, reason: 'parser_threw', message: err?.message || String(err) },
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
    _issue: { id: f.id, reason: parsed.reason || 'unknown' },
  };
}

module.exports = async (req, res) => {
  const refresh = String(req?.query?.refresh ?? '') === '1';
  const todayIso = todayIsoMinsk();
  const ctx = { todayIso };

  const generatedAt = new Date().toISOString();
  const results = await Promise.all(FACILITIES.map(f => loadFacility(f, ctx)));

  const facilities = results.map(({ _issue, ...rest }) => rest);
  const sourceIssues = results
    .filter(r => r._issue || r.dataQuality === 'parse_error')
    .map(r => r._issue || { id: r.id, reason: 'unknown' });

  const payload = {
    // v4: facility.closureRanges?: [{from, to, notice}] для частичного
    // закрытия (когда расписание есть, но в часть дат объект закрыт).
    // v3 поля (dataQuality, sessions, notice, closureRange при closed)
    // сохранены без изменений — старые клиенты продолжат работать.
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
      todayIso,
    },
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (refresh) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  } else {
    // Vercel Edge CDN кеш на 5 минут, stale-while-revalidate ещё 10.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  }
  res.status(200).end(JSON.stringify(payload));
};
