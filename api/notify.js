// GET /api/notify — серверная проверка изменений + уведомления в Telegram.
//
// Зачем: фронтенд считает diff локально, но пользователь узнаёт о нём
// только открыв приложение. Эта функция шлёт изменения пушем в Telegram.
//
// Настройка (Vercel → Project → Settings → Environment Variables):
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather. НИКОГДА не коммитить
//                        в репозиторий — только переменная окружения!
//   TELEGRAM_CHAT_ID   — id чата/канала, можно несколько через запятую.
//                        Дополнительно к этому списку рассылка идёт всем,
//                        кто подписался командой /subscribe (Blob).
//   TELEGRAM_ADMIN_CHAT_ID — (опционально) отдельный чат для служебных
//                        оповещений о здоровье парсера.
//   TELEGRAM_DIGEST    — 'off' выключает утренний дайджест (по умолчанию вкл).
//   CRON_SECRET        — защита endpoint'а. Vercel Cron подставляет его сам
//                        (Authorization: Bearer), внешний пингер — ?key=.
//   BLOB_READ_WRITE_TOKEN — Vercel Blob: prev-снапшот, подписчики, смены.
//
// Запуск по расписанию:
//   • Vercel Cron (vercel.json) — на Hobby 1 раз в сутки, 08:00 Минска.
//   • Чаще — GitHub Actions workflow notify-ping.yml (каждые 10 минут,
//     нужен repo-секрет NOTIFY_PING_URL) или любой внешний пингер.
//
// Утренний дайджест: первый прогон в окне 07:50–08:35 Минска шлёт
// расписание на день (дедуп по дате в Blob) — независимо от изменений.

const { buildPayload } = require('./_lib/snapshot');
const { computeScheduleDiff, eventOverlapsShift } = require('../app/_logic.js');
const {
  haveBlob, blobLoadJson, blobSaveJson, allRecipients, envChats,
  broadcast, appButton,
} = require('./_lib/telegram');
const { pairMoves, formatChangesMessage, formatDaySchedule, esc } = require('./_lib/format');

const PREV_KEY = 'notify-prev-snapshot.json';
const SHIFTS_KEY = 'user-shifts.json';
const DIGEST_KEY = 'tg-digest-state.json';
const TZ = 'Europe/Minsk';

const GH_REPO = 'NikitaSytsevich/raspisanie-polessu-v2';
const OIDC_AUDIENCE = 'https://raspisanie-polessu-v2.vercel.app';

// Авторизация пингера. Три пути:
//   1) Bearer <CRON_SECRET> — Vercel Cron (шлёт сам) и ручной вызов.
//   2) ?key=<CRON_SECRET> — внешний пингер по URL.
//   3) GitHub Actions OIDC — secretless: workflow доказывает, что он
//      запущен в НАШЕМ репозитории, валидным подписанным JWT. Так
//      CI-пингер не носит общий секрет (см. _lib/github-oidc.js).
async function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // защита не настроена — не блокируем
  const auth = (req.headers && req.headers.authorization) || '';
  if (auth === `Bearer ${secret}`) return true;
  if (String((req.query && req.query.key) || '') === secret) return true;
  // OIDC: Bearer-токен, не совпавший с CRON_SECRET, пробуем как GitHub JWT.
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (m) {
    try {
      const { verifyGitHubOidc } = require('./_lib/github-oidc');
      const r = await verifyGitHubOidc(m[1], {
        expectedRepo: GH_REPO,
        expectedAudience: OIDC_AUDIENCE,
      });
      if (r.ok) return true;
    } catch {}
  }
  return false;
}

// Переходы «работает ↔ закрыт» — пользовательское уведомление: в отличие
// от template/parse_error это содержательное состояние сайта, а не сбой
// парсера. Сессии закрывшегося/открывшегося объекта в diff не попадают
// (computeScheduleDiff пропускает не-ok объекты с любой стороны) — иначе
// закрытие выглядело бы как flood ➖ на каждый слот без объяснения.
function closureTransitions(prev, next) {
  if (!prev) return [];
  const was = new Map((prev.facilities || []).map(f => [f.id, f]));
  const out = [];
  for (const f of next.facilities || []) {
    const a = was.get(f.id);
    if (!a || a.dataQuality === f.dataQuality) continue;
    if (f.dataQuality === 'closed' && a.dataQuality === 'ok') {
      out.push({ kind: 'closed', name: f.name, notice: f.notice || null });
    } else if (a.dataQuality === 'closed' && f.dataQuality === 'ok') {
      out.push({ kind: 'reopened', name: f.name });
    }
  }
  return out;
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
// алерт уходит один раз на переход, а не на каждый прогон.
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

// Помечаем события, пересекающиеся со сменами пользователя (смены
// синхронизирует приложение через /api/shifts-sync → Blob). Для kind:'move'
// проверяем И новое, И старое окно — перенос задевает смену в обоих случаях.
function markAffected(events, shifts) {
  if (!Array.isArray(shifts) || !shifts.length) return;
  for (const ev of events) {
    const windows = ev.kind === 'move'
      ? [ev, { facilityId: ev.facilityId, date: ev.date, start: ev.from.start, end: ev.from.end }]
      : [ev];
    ev.affectsMe = shifts.some(s => windows.some(w => eventOverlapsShift(w, s)));
  }
}

// Минские часы-минуты текущего момента (для окна дайджеста).
function minskNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date()).split(':').map(Number);
  return { h: parts[0], m: parts[1] };
}

function minskTodayIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// Утренний дайджест: окно 07:50–08:35 Минска (ловит и Vercel-cron в 08:00,
// и 10-минутный пингер), дедуп по дате через Blob.
async function maybeSendDigest(payload, recipients) {
  if (process.env.TELEGRAM_DIGEST === 'off') return { sent: 0, skipped: 'disabled' };
  const { h, m } = minskNow();
  const inWindow = (h === 7 && m >= 50) || (h === 8 && m <= 35);
  if (!inWindow) return { sent: 0, skipped: 'out_of_window' };
  const today = minskTodayIso();
  const state = await blobLoadJson(DIGEST_KEY);
  if (state?.lastDate === today) return { sent: 0, skipped: 'already_sent' };
  const text = formatDaySchedule(payload, today, {
    title: `☀️ <b>Доброе утро! Расписание на сегодня</b>`,
  });
  const out = await broadcast(text, recipients, appButton());
  if (out.sent) await blobSaveJson(DIGEST_KEY, { lastDate: today });
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!(await authorized(req))) {
    res.status(401).end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  const next = await buildPayload();
  const prev = await blobLoadJson(PREV_KEY);
  const recipients = await allRecipients();

  let events = [];
  let closures = [];
  let notified = { sent: 0 };
  if (prev) {
    // computeScheduleDiff сам пропускает объекты, не-ok с любой стороны
    // (включая закрытые и stale), и сравнивает weeklyPattern-объекты
    // (гребная база) по дням недели, а не по скользящим датам.
    events = pairMoves(computeScheduleDiff(prev, next));
    closures = closureTransitions(prev, next);
    if (events.length || closures.length) {
      const userShifts = (await blobLoadJson(SHIFTS_KEY))?.shifts;
      markAffected(events, userShifts);
      const facNames = {};
      for (const f of next.facilities) facNames[f.id] = f.name;
      notified = await broadcast(
        formatChangesMessage(events, facNames, { closures }),
        recipients,
        appButton()
      );
    }
  }

  // Служебный алерт админу: источник сломался/восстановился.
  const health = healthTransitions(prev, next);
  let adminNotified = { sent: 0 };
  if (health.length) {
    const msg = ['🛠 <b>Парсер ПолесГУ — статус источников</b>', '', ...health.map(esc)].join('\n');
    adminNotified = await broadcast(msg, envChats('TELEGRAM_ADMIN_CHAT_ID'));
  }

  const digest = await maybeSendDigest(next, recipients);

  // Пишем prev только когда есть что записать (baseline, изменения,
  // закрытие/открытие или смена здоровья — иначе алерты повторялись бы
  // каждый прогон) — не жжём Blob-операции на каждый тихий прогон.
  if (!prev || events.length || closures.length || health.length) {
    await blobSaveJson(PREV_KEY, next);
  }

  res.status(200).end(JSON.stringify({
    ok: true,
    baseline: !prev,
    events: events.length,
    closures: closures.length,
    notified: notified.sent,
    recipients: recipients.length,
    digest,
    healthChanges: health.length,
    adminNotified: adminNotified.sent,
    blobConfigured: haveBlob(),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && recipients.length),
  }));
};
