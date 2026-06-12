// POST /api/shifts-sync — приём копии смен пользователя для бота.
//
// Зачем: смены живут в localStorage телефона, сервер их не видит — и бот
// мог сказать только «расписание изменилось», но не «задета ТВОЯ смена».
// Приложение (опционально, при заданном в настройках ключе) пушит сюда
// свой список смен; /api/notify пересекает события сайта с ними и
// помечает уведомления «⚠️ ваша смена».
//
// Защита: заголовок X-Sync-Key должен совпадать с env SHIFTS_SYNC_KEY.
// Ключ один (приложение однопользовательское) — задаётся в Vercel и
// вводится один раз в настройках приложения.

const { blobSaveJson, haveBlob } = require('./_lib/telegram');
const { safeEqual } = require('./_lib/auth');

const SHIFTS_KEY = 'user-shifts.json';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;
const FAC_IDS = new Set(['ice_arena', 'sports_pool', 'small_pool', 'rowing_base']);
const MAX_SHIFTS = 500;

function cleanShifts(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const s of raw.slice(0, MAX_SHIFTS)) {
    if (!s || typeof s !== 'object') continue;
    if (typeof s.date !== 'string' || !ISO_DATE.test(s.date)) continue;
    if (typeof s.start !== 'string' || !HHMM.test(s.start)) continue;
    if (typeof s.end !== 'string' || !HHMM.test(s.end)) continue;
    if (s.start >= s.end) continue; // битая/«ночная» смена — пересечения не посчитать
    if (!FAC_IDS.has(s.facilityId)) continue;
    out.push({
      id: String(s.id || ''),
      date: s.date,
      facilityId: s.facilityId,
      start: s.start,
      end: s.end,
    });
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const key = process.env.SHIFTS_SYNC_KEY;
  if (!key || !haveBlob()) {
    res.status(503).end(JSON.stringify({ ok: false, error: 'sync_not_configured' }));
    return;
  }
  if (!safeEqual(String((req.headers && req.headers['x-sync-key']) || ''), key)) {
    res.status(401).end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
    return;
  }

  const shifts = cleanShifts(req.body?.shifts);
  if (!shifts) {
    res.status(400).end(JSON.stringify({ ok: false, error: 'bad_payload' }));
    return;
  }

  const saved = await blobSaveJson(SHIFTS_KEY, {
    updatedAt: new Date().toISOString(),
    shifts,
  });
  res.status(saved ? 200 : 500).end(JSON.stringify({ ok: saved, count: shifts.length }));
};
