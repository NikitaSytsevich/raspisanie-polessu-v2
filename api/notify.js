// GET /api/notify — серверная проверка изменений + уведомление в Telegram.
//
// Зачем: фронтенд считает diff локально, но пользователь узнаёт о нём
// только открыв приложение. Эта функция шлёт изменения пушем в Telegram.
//
// Настройка (Vercel → Project → Settings → Environment Variables):
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather. НИКОГДА не коммитить
//                        в репозиторий — только переменная окружения!
//   TELEGRAM_CHAT_ID   — id чата/канала, можно несколько через запятую.
//                        Свой id проще всего узнать у @userinfobot.
//   TELEGRAM_ADMIN_CHAT_ID — (опционально) отдельный чат для служебных
//                        оповещений о здоровье парсера: источник перестал
//                        парситься (ok → template/parse_error/stale) или
//                        восстановился. Не настроен — health-алерты выключены,
//                        пользовательский канал ими не засоряется.
//   CRON_SECRET        — произвольная строка, защищает endpoint от чужих
//                        вызовов. Vercel Cron подставляет её сам в
//                        заголовок Authorization: Bearer <CRON_SECRET>.
//   BLOB_READ_WRITE_TOKEN — появляется при подключении Vercel Blob;
//                        нужен для хранения «предыдущего» снапшота.
//
// Запуск по расписанию:
//   • Vercel Cron (vercel.json → crons) — на Hobby максимум 1 раз в сутки.
//   • Чаще — бесплатный внешний пингер (cron-job.org / UptimeRobot):
//     GET https://<домен>/api/notify?key=<CRON_SECRET> каждые 10–15 минут.

const { buildPayload } = require('./_lib/snapshot');
const { computeScheduleDiff } = require('../app/_logic.js');

const PREV_KEY = 'notify-prev-snapshot.json';
const RU_WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const RU_MO = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
               'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // защита не настроена — не блокируем
  if ((req.headers && req.headers.authorization) === `Bearer ${secret}`) return true;
  return String((req.query && req.query.key) || '') === secret;
}

function haveBlob() { return Boolean(process.env.BLOB_READ_WRITE_TOKEN); }

async function loadPrev() {
  if (!haveBlob()) return null;
  try {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: PREV_KEY, limit: 1 });
    if (!blobs || !blobs.length) return null;
    const r = await fetch(blobs[0].url, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function savePrev(payload) {
  if (!haveBlob()) return;
  try {
    const { put } = require('@vercel/blob');
    await put(PREV_KEY, JSON.stringify(payload), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  } catch {}
}

function fmtDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return `${RU_WD[d.getDay()]}, ${d.getDate()} ${RU_MO[d.getMonth()]}`;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatMessage(events, facNames) {
  const groups = new Map();
  for (const ev of events) {
    const key = `${ev.facilityId}::${ev.date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  const lines = ['🔔 <b>Расписание ПолесГУ — изменения на сайте</b>'];
  for (const [key, evs] of groups) {
    const [facId, date] = key.split('::');
    lines.push('', `<b>${esc(facNames[facId] || facId)}</b> · ${fmtDate(date)}`);
    for (const ev of evs.slice(0, 15)) {
      const sign = ev.kind === 'add' ? '➕' : ev.kind === 'rem' ? '➖' : '✏️';
      const act = ev.activity ? ` (${esc(ev.activity)})` : '';
      lines.push(`${sign} ${ev.start}–${ev.end}${act}`);
    }
    if (evs.length > 15) lines.push(`… и ещё ${evs.length - 15}`);
  }
  return lines.join('\n');
}

function chatsFromEnv(name) {
  return String(process.env[name] || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

async function sendTelegram(text, chats) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chats.length) return { sent: 0, reason: 'telegram_not_configured' };
  let sent = 0;
  for (const chatId of chats) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      if (r.ok) sent++;
    } catch {}
  }
  return { sent };
}

// Diff только по объектам с dataQuality 'ok' С ОБЕИХ сторон. Иначе упавший
// без last-good источник (sessions=[]) дал бы phantom 'rem' на все его
// сессии — та же защита, что и mock-фолбэк на клиенте.
function okOnly(payload) {
  return { facilities: (payload.facilities || []).filter(f => f.dataQuality === 'ok') };
}

// Здоровье источников: template/parse_error — парсер не понял страницу,
// stale — источник не ответил и подставлен last-known-good. closed сюда
// НЕ входит — это валидное состояние контента, а не сбой парсера.
const BAD_QUALITY = new Set(['template', 'parse_error', 'stale']);

function healthMap(payload) {
  const m = {};
  for (const f of payload.facilities || []) {
    m[f.id] = f.stale ? 'stale' : (f.dataQuality || 'unknown');
  }
  return m;
}

// Переходы здоровья между prev и next: деградация (ok/closed → bad) и
// восстановление (bad → ok/closed). Сравнение с prev даёт «N=1 с дедупом»:
// алерт уходит один раз на переход, а не на каждый прогон в сломанном состоянии.
function healthTransitions(prev, next) {
  if (!prev) return [];
  const was = healthMap(prev);
  const now = healthMap(next);
  const lines = [];
  for (const f of next.facilities || []) {
    const a = was[f.id];
    const b = now[f.id];
    if (!a || a === b) continue;
    if (BAD_QUALITY.has(b) && !BAD_QUALITY.has(a)) lines.push(`🔴 ${f.name}: ${a} → ${b}`);
    else if (BAD_QUALITY.has(a) && !BAD_QUALITY.has(b)) lines.push(`🟢 ${f.name}: ${a} → ${b}`);
  }
  return lines;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!authorized(req)) {
    res.status(401).end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  const next = await buildPayload();
  const prev = await loadPrev();

  let events = [];
  let notified = { sent: 0 };
  if (prev) {
    events = computeScheduleDiff(okOnly(prev), okOnly(next));
    if (events.length) {
      const facNames = {};
      for (const f of next.facilities) facNames[f.id] = f.name;
      notified = await sendTelegram(formatMessage(events, facNames), chatsFromEnv('TELEGRAM_CHAT_ID'));
    }
  }

  // Служебный алерт админу: источник сломался/восстановился.
  const health = healthTransitions(prev, next);
  let adminNotified = { sent: 0 };
  if (health.length) {
    const msg = ['🛠 <b>Парсер ПолесГУ — статус источников</b>', '', ...health.map(esc)].join('\n');
    adminNotified = await sendTelegram(msg, chatsFromEnv('TELEGRAM_ADMIN_CHAT_ID'));
  }

  // Пишем prev только когда есть что записать (baseline, изменения или
  // смена здоровья — иначе health-алерт повторялся бы каждый прогон) —
  // не жжём Blob-операции на каждый тихий прогон.
  if (!prev || events.length || health.length) await savePrev(next);

  res.status(200).end(JSON.stringify({
    ok: true,
    baseline: !prev,
    events: events.length,
    notified: notified.sent,
    healthChanges: health.length,
    adminNotified: adminNotified.sent,
    blobConfigured: haveBlob(),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  }));
};
