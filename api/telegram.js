// POST /api/telegram — webhook Telegram-бота (@Raspisanie_polessu_bot).
//
// Telegram сам стучится сюда POST'ом на каждое сообщение боту (после
// одноразовой регистрации через setWebhook с secret_token). Команды:
//   /start, /help   — что умеет бот
//   /today          — расписание объектов на сегодня (по сайту)
//   /tomorrow       — на завтра
//   /status         — здоровье источников парсера
//   /subscribe      — подписать ЭТОТ чат на уведомления об изменениях
//   /unsubscribe    — отписать
//
// Защита: заголовок X-Telegram-Bot-Api-Secret-Token должен совпадать с
// env TELEGRAM_WEBHOOK_SECRET (Telegram шлёт его сам, см. setWebhook).
// Всегда отвечаем 200 — на не-200 Telegram ретраит и копит очередь.

const { buildPayload } = require('./_lib/snapshot');
const {
  tgApi, sendLong, loadSubscribers, saveSubscribers, envChats,
} = require('./_lib/telegram');
const { formatDaySchedule, formatStatus } = require('./_lib/format');
const { safeEqual } = require('./_lib/auth');

const TZ = 'Europe/Minsk';

// /today и /status дёргаются людьми и должны отвечать быстро, а buildPayload —
// это 4 живых фетча polessu.by (худший случай ~12 с). Кэш в памяти warm-инстанса
// на минуту сглаживает повторные команды; свежесть для чата некритична.
const PAYLOAD_TTL_MS = 60_000;
let _payloadCache = null; // { at, payload }
async function cachedPayload() {
  if (_payloadCache && Date.now() - _payloadCache.at < PAYLOAD_TTL_MS) {
    return _payloadCache.payload;
  }
  const payload = await buildPayload();
  _payloadCache = { at: Date.now(), payload };
  return payload;
}

// username бота — чтобы понимать, нам ли адресована команда /cmd@bot.
// getMe кэшируется на жизнь инстанса; при сбое не кэшируем — попробуем снова.
let _botUsername = null;
async function botUsername() {
  if (_botUsername) return _botUsername;
  const r = await tgApi('getMe', {});
  if (r.ok) _botUsername = r.json?.result?.username || null;
  return _botUsername || '';
}

function isoMinskOffset(days = 0) {
  const d = new Date(Date.now() + days * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

const HELP = [
  '👋 Я бот «Расписание ПолесГУ».',
  '',
  'Слежу за расписанием спортивных объектов на сайте университета и присылаю изменения.',
  '',
  '<b>Команды:</b>',
  '/today — расписание на сегодня',
  '/tomorrow — на завтра',
  '/status — здоровье источников',
  '/subscribe — получать уведомления об изменениях в этот чат',
  '/unsubscribe — отписаться',
].join('\n');

async function handleCommand(cmd, chatId, { isPrivate = false, explicit = false } = {}) {
  if (cmd === 'start' || cmd === 'help') {
    return sendLong(chatId, HELP);
  }
  if (cmd === 'subscribe') {
    // env-чаты получают рассылку и так — не дублируем их в Blob-список.
    if (envChats().includes(String(chatId))) {
      return sendLong(chatId, '✅ Этот чат уже получает уведомления.');
    }
    const subs = await loadSubscribers();
    if (subs.includes(String(chatId))) {
      return sendLong(chatId, '✅ Уже подписаны. Отписаться: /unsubscribe');
    }
    const ok = await saveSubscribers([...subs, String(chatId)]);
    return sendLong(chatId, ok
      ? '🔔 Подписал! Буду присылать изменения расписания сюда.'
      : '😕 Не получилось сохранить подписку, попробуйте позже.');
  }
  if (cmd === 'unsubscribe') {
    if (envChats().includes(String(chatId))) {
      return sendLong(chatId, 'Этот чат прописан в настройках сервера — отписать его может только администратор.');
    }
    const subs = await loadSubscribers();
    if (!subs.includes(String(chatId))) {
      return sendLong(chatId, 'Этот чат и не был подписан. Подписаться: /subscribe');
    }
    const ok = await saveSubscribers(subs.filter(c => c !== String(chatId)));
    return sendLong(chatId, ok ? '🔕 Отписал. Вернуться: /subscribe' : '😕 Не получилось, попробуйте позже.');
  }
  if (cmd === 'today' || cmd === 'tomorrow') {
    const payload = await cachedPayload();
    const date = isoMinskOffset(cmd === 'tomorrow' ? 1 : 0);
    return sendLong(chatId, formatDaySchedule(payload, date));
  }
  if (cmd === 'status') {
    const payload = await cachedPayload();
    return sendLong(chatId, formatStatus(payload));
  }
  // Неизвестная команда: отвечаем только в личке или при явном /cmd@нашбот.
  // В группах молчим — privacy mode доставляет нам ВСЕ slash-команды чата,
  // в том числе адресованные другим ботам (/ban, /settings соседнего бота).
  if (isPrivate || explicit) {
    return sendLong(chatId, 'Не знаю такую команду. Список: /help');
  }
  return null;
}

// Однократная (и идемпотентная) регистрация webhook'а у Telegram —
// GET /api/telegram?setup=<TELEGRAM_WEBHOOK_SECRET>. Токен бота знает
// только сервер (sensitive env, из CLI не читается), поэтому setWebhook
// вызывается отсюда, а не с машины разработчика.
async function handleSetup(req, res) {
  const host = process.env.APP_URL
    ? new URL(process.env.APP_URL).host
    : (req.headers['x-forwarded-host'] || req.headers.host);
  const webhook = await tgApi('setWebhook', {
    url: `https://${host}/api/telegram`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    // channel_post — обработчик читает и посты каналов (подписка канала
    // через /subscribe в нём); без этого Telegram их просто не доставит.
    allowed_updates: ['message', 'channel_post'],
    drop_pending_updates: true,
  });
  const commands = await tgApi('setMyCommands', {
    commands: [
      { command: 'today',       description: 'Расписание на сегодня' },
      { command: 'tomorrow',    description: 'Расписание на завтра' },
      { command: 'status',      description: 'Здоровье источников' },
      { command: 'subscribe',   description: 'Получать уведомления об изменениях' },
      { command: 'unsubscribe', description: 'Отписаться' },
      { command: 'help',        description: 'Что умеет бот' },
    ],
  });
  const info = await tgApi('getWebhookInfo', {});
  res.status(200).end(JSON.stringify({
    ok: webhook.ok && commands.ok,
    webhook: webhook.json,
    commands: commands.json,
    info: info.json?.result || null,
  }));
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).end(JSON.stringify({ ok: false, error: 'webhook_not_configured' }));
    return;
  }
  if (req.method === 'GET' && safeEqual(String(req.query?.setup || ''), secret)) {
    await handleSetup(req, res);
    return;
  }

  const got = req.headers && req.headers['x-telegram-bot-api-secret-token'];
  // Без валидного секрета не работаем — не оставляем endpoint открытым:
  // любой мог бы слать «команды» от чужого имени.
  if (!safeEqual(String(got || ''), secret)) {
    res.status(401).end(JSON.stringify({ ok: false }));
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).end(JSON.stringify({ ok: false }));
    return;
  }

  try {
    const update = req.body || {};
    const msg = update.message || update.channel_post || null;
    const chatId = msg?.chat?.id;
    const text = (msg?.text || '').trim();
    // Реагируем только на команды — обычный текст молча игнорируем,
    // чтобы бот не спамил в группах на каждое сообщение.
    const m = /^\/([a-z_]+)(?:@(\w+))?/i.exec(text);
    if (chatId && m) {
      const mention = (m[2] || '').toLowerCase();
      // /cmd@ДругойБот privacy mode доставляет и нам — это не наша команда.
      const mine = !mention || mention === (await botUsername()).toLowerCase();
      if (mine) {
        await handleCommand(m[1].toLowerCase(), chatId, {
          isPrivate: msg?.chat?.type === 'private',
          explicit: Boolean(mention),
        });
      }
    }
  } catch (err) {
    // 200 отдаём в любом случае (иначе Telegram ретраит), но след в логах
    // оставляем — пустой catch превращал любой сбой в молчаливый no-op.
    console.error('[telegram] webhook error:', err?.message || err);
  }

  // Всегда 200, иначе Telegram будет ретраить этот же update.
  res.status(200).end(JSON.stringify({ ok: true }));
};
