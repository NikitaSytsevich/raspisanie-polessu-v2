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
  broadcast, broadcastPerChat, loadSubsData, resolvePrefs,
} = require('./_lib/telegram');
const { pairMoves, formatChangesMessage, formatDaySchedule, esc } = require('./_lib/format');
const { healthTransitions, closureTransitions } = require('./_lib/transitions');
const { safeEqual } = require('./_lib/auth');

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
  const auth = (req.headers && req.headers.authorization) || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (secret) {
    if (m && safeEqual(m[1], secret)) return true;
    if (safeEqual(String((req.query && req.query.key) || ''), secret)) return true;
  }
  // OIDC: Bearer-токен, не совпавший с CRON_SECRET, пробуем как GitHub JWT.
  // Работает и без CRON_SECRET — GH-пингер не зависит от общего секрета.
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
  // Без CRON_SECRET: локально (dev-server) не блокируем, на Vercel —
  // fail-closed: открытый endpoint = анонимные фетчи polessu.by, Blob-операции
  // и потенциальный спам дайджестом за наш счёт.
  if (!secret) return !process.env.VERCEL;
  return false;
}

// healthTransitions (алерты админу о поломке парсера) и closureTransitions
// (пользовательские «⛔ закрыт / ✅ снова работает») — в _lib/transitions.js.

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

// Тихие часы: ночные уведомления об изменениях доставляем без звука
// (disable_notification), а не молча копим — так ничего не теряется и не
// дублируется. Окно 22:00–07:59 Минск; выключается TELEGRAM_QUIET=off.
// Утренний дайджест под это не попадает (его окно 07:50–08:35 шлём со звуком).
function isQuietNow() {
  if (process.env.TELEGRAM_QUIET === 'off') return false;
  const { h } = minskNow();
  return h >= 22 || h < 8;
}

// Утренний дайджест: окно 07:50–08:35 Минска (ловит и Vercel-cron в 08:00,
// и 10-минутный пингер), дедуп по дате через Blob.
async function maybeSendDigest(payload, recipients, prefs) {
  if (process.env.TELEGRAM_DIGEST === 'off') return { sent: 0, skipped: 'disabled' };
  const { h, m } = minskNow();
  const inWindow = (h === 7 && m >= 50) || (h === 8 && m <= 35);
  if (!inWindow) return { sent: 0, skipped: 'out_of_window' };
  const today = minskTodayIso();
  const state = await blobLoadJson(DIGEST_KEY);
  if (state?.lastDate === today) return { sent: 0, skipped: 'already_sent' };
  // По чату: уважаем тумблер дайджеста и фильтр объектов из /settings.
  const out = await broadcastPerChat(recipients, (chatId) => {
    const p = resolvePrefs(prefs, chatId);
    // Дайджест выключен или объекты сняты все — слать нечего.
    if (!p.digest || (Array.isArray(p.objects) && p.objects.length === 0)) return null;
    return formatDaySchedule(payload, today, {
      title: '☀️ <b>Доброе утро! Расписание на сегодня</b>',
      only: p.objects,
    });
  });
  // Дедуп по дате ставим, если получателей вообще обработали (отправили или
  // сознательно пропустили) — иначе пингер пытался бы слать весь утренний
  // период, когда дайджест у всех выключен.
  if (out.sent || out.skipped) await blobSaveJson(DIGEST_KEY, { lastDate: today });
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
  const { prefs } = await loadSubsData();

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
      const facUrls = {};
      for (const f of next.facilities) { facNames[f.id] = f.name; facUrls[f.id] = f.sourceUrl; }
      // По чату: шлём только выбранные в /settings объекты (objects=null — все),
      // ночью — без звука (тихие часы). Чат без релевантных событий пропускаем.
      const quiet = isQuietNow() ? { disable_notification: true } : {};
      notified = await broadcastPerChat(recipients, (chatId) => {
        const objs = resolvePrefs(prefs, chatId).objects;
        const evs = objs ? events.filter(e => objs.includes(e.facilityId)) : events;
        const cls = objs ? closures.filter(c => objs.includes(c.id)) : closures;
        if (!evs.length && !cls.length) return null;
        return formatChangesMessage(evs, facNames, { closures: cls, facUrls });
      }, quiet);
    }
  }

  // Служебный алерт админу: источник сломался/восстановился.
  const health = healthTransitions(prev, next);
  let adminNotified = { sent: 0 };
  if (health.length) {
    const msg = ['🛠 <b>Парсер ПолесГУ — статус источников</b>', '', ...health.map(esc)].join('\n');
    adminNotified = await broadcast(msg, envChats('TELEGRAM_ADMIN_CHAT_ID'));
  }

  const digest = await maybeSendDigest(next, recipients, prefs);

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
