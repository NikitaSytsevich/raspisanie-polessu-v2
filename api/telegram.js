// POST /api/telegram — webhook Telegram-бота (@Raspisanie_polessu_bot).
//
// Telegram сам стучится сюда POST'ом на каждое сообщение боту (после
// одноразовой регистрации через setWebhook с secret_token). Команды:
//   /start, /help   — что умеет бот
//   /today          — расписание объектов на сегодня (по сайту)
//   /tomorrow       — на завтра
//   /now            — что идёт прямо сейчас (+ свободные дорожки бассейна)
//   /week           — обзор на неделю
//   /status         — здоровье источников парсера
//   /settings       — объекты уведомлений + утренний дайджест (инлайн-меню)
//   /subscribe      — подписать ЭТОТ чат на уведомления об изменениях
//   /unsubscribe    — отписать
// Инлайн-кнопки (callback_query): навигация по дням под расписанием,
// тумблеры в /settings.
//
// Защита: заголовок X-Telegram-Bot-Api-Secret-Token должен совпадать с
// env TELEGRAM_WEBHOOK_SECRET (Telegram шлёт его сам, см. setWebhook).
// Всегда отвечаем 200 — на не-200 Telegram ретраит и копит очередь.

const { buildPayload } = require('./_lib/snapshot');
const { FACILITIES } = require('./_parsers');
const {
  tgApi, sendLong, loadSubscribers, saveSubscribers, envChats,
  blobLoadJson, blobSaveJson,
  getChatSettings, toggleObject, toggleDigest, toggleSubscribed,
  answerCallback, editMessageText, editMessageReplyMarkup,
} = require('./_lib/telegram');
const {
  formatDaySchedule, formatStatus, formatNow, formatWeek,
  dayNavKeyboard, settingsKeyboard,
} = require('./_lib/format');
const { safeEqual } = require('./_lib/auth');

const TZ = 'Europe/Minsk';

// /today и /status дёргаются людьми и должны отвечать быстро, а buildPayload —
// это 4 живых фетча polessu.by (худший случай ~12 с). Кэш в памяти warm-инстанса
// на минуту сглаживает повторные команды; свежесть для чата некритична.
// Два слоя кэша: память warm-инстанса (минута) и общий Blob-снапшот (две
// минуты). Холодный инстанс берёт свежий результат из Blob вместо повторных
// 4 фетчей polessu.by — /today/now/week отвечают мгновенно. Свежесть для
// чата некритична (изменения и так ловит /api/notify).
const PAYLOAD_TTL_MS = 60_000;
const PAYLOAD_BLOB_TTL_MS = 120_000;
const PAYLOAD_CACHE_KEY = 'tg-payload-cache.json';
let _payloadCache = null; // { at, payload }
async function cachedPayload() {
  if (_payloadCache && Date.now() - _payloadCache.at < PAYLOAD_TTL_MS) {
    return _payloadCache.payload;
  }
  const blob = await blobLoadJson(PAYLOAD_CACHE_KEY);
  if (blob?.at && blob.payload && Date.now() - new Date(blob.at).getTime() < PAYLOAD_BLOB_TTL_MS) {
    _payloadCache = { at: Date.now(), payload: blob.payload };
    return blob.payload;
  }
  const payload = await buildPayload();
  _payloadCache = { at: Date.now(), payload };
  await blobSaveJson(PAYLOAD_CACHE_KEY, { at: new Date().toISOString(), payload });
  return payload;
}

// Текущее время в минутах от полуночи (минский пояс) — для /now.
function minskNowMinutes() {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date()).split(':').map(Number);
  return h * 60 + m;
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
  '/now — что идёт прямо сейчас',
  '/week — обзор на неделю',
  '/status — здоровье источников',
  '/settings — объекты уведомлений и дайджест',
  '/subscribe — подписаться на изменения',
  '/unsubscribe — отписаться',
].join('\n');

const SETTINGS_INTRO = [
  '⚙️ <b>Настройки уведомлений</b>',
  '',
  'Отметьте объекты, об изменениях которых присылать уведомления, и включите/выключите утренний дайджест.',
].join('\n');

async function handleCommand(cmd, chatId, { isPrivate = false, explicit = false } = {}) {
  if (cmd === 'start' || cmd === 'help') {
    const today = isoMinskOffset(0);
    return sendLong(chatId, HELP, { reply_markup: { inline_keyboard: [
      [{ text: '📅 Сегодня', callback_data: `d:${today}` },
       { text: 'Завтра ›', callback_data: `d:${isoMinskOffset(1)}` }],
      [{ text: '🕘 Сейчас', callback_data: 'n' },
       { text: '📆 Неделя', callback_data: 'w' }],
    ] } });
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
    const today = isoMinskOffset(0);
    const date = isoMinskOffset(cmd === 'tomorrow' ? 1 : 0);
    return sendLong(chatId, formatDaySchedule(payload, date),
      { reply_markup: dayNavKeyboard(date, today) });
  }
  if (cmd === 'now') {
    const payload = await cachedPayload();
    return sendLong(chatId, formatNow(payload, minskNowMinutes(), isoMinskOffset(0)),
      { reply_markup: { inline_keyboard: [[{ text: '🔄 Обновить', callback_data: 'n' }]] } });
  }
  if (cmd === 'week') {
    const payload = await cachedPayload();
    const today = isoMinskOffset(0);
    return sendLong(chatId, formatWeek(payload, today),
      { reply_markup: { inline_keyboard: [[{ text: '📅 Сегодня', callback_data: `d:${today}` }]] } });
  }
  if (cmd === 'settings') {
    const st = await getChatSettings(chatId);
    const facs = FACILITIES.map(f => ({ id: f.id, name: f.name }));
    return sendLong(chatId, SETTINGS_INTRO, { reply_markup: settingsKeyboard(st, facs) });
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

// Нажатия инлайн-кнопок (callback_query). data:
//   d:<iso> — показать день, r:<iso> — обновить, w — неделя, n — сейчас;
//   s:o:<id> — тумблер объекта, s:digest — дайджест, s:sub — подписка.
// editMessageText/ReplyMarkup правят то же сообщение, answerCallback гасит
// «часики». Всегда отвечаем на callback — иначе у пользователя крутится спиннер.
async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const data = String(cb.data || '');
  if (!chatId || !messageId) { await answerCallback(cb.id); return; }
  const today = isoMinskOffset(0);

  const mDay = /^([dr]):(\d{4}-\d{2}-\d{2})$/.exec(data);
  if (mDay) {
    const date = mDay[2];
    const payload = await cachedPayload();
    await editMessageText(chatId, messageId, formatDaySchedule(payload, date),
      { reply_markup: dayNavKeyboard(date, today) });
    await answerCallback(cb.id, mDay[1] === 'r' ? 'Обновлено' : '');
    return;
  }
  if (data === 'w') {
    const payload = await cachedPayload();
    await editMessageText(chatId, messageId, formatWeek(payload, today),
      { reply_markup: { inline_keyboard: [[{ text: '📅 Сегодня', callback_data: `d:${today}` }]] } });
    await answerCallback(cb.id);
    return;
  }
  if (data === 'n') {
    const payload = await cachedPayload();
    await editMessageText(chatId, messageId, formatNow(payload, minskNowMinutes(), today),
      { reply_markup: { inline_keyboard: [[{ text: '🔄 Обновить', callback_data: 'n' }]] } });
    await answerCallback(cb.id, 'Обновлено');
    return;
  }
  if (data.startsWith('s:')) {
    const facs = FACILITIES.map(f => ({ id: f.id, name: f.name }));
    let st;
    if (data === 's:digest') st = await toggleDigest(chatId);
    else if (data === 's:sub') st = await toggleSubscribed(chatId);
    else if (data.startsWith('s:o:')) st = await toggleObject(chatId, FACILITIES.map(f => f.id), data.slice(4));
    else { await answerCallback(cb.id); return; }
    await editMessageReplyMarkup(chatId, messageId, settingsKeyboard(st, facs));
    await answerCallback(cb.id, 'Сохранено');
    return;
  }
  await answerCallback(cb.id);
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
    // через /subscribe в нём); callback_query — нажатия инлайн-кнопок
    // (навигация по дням, /settings); без этого Telegram их не доставит.
    allowed_updates: ['message', 'channel_post', 'callback_query'],
    drop_pending_updates: true,
  });
  const commands = await tgApi('setMyCommands', {
    commands: [
      { command: 'today',       description: 'Расписание на сегодня' },
      { command: 'tomorrow',    description: 'Расписание на завтра' },
      { command: 'now',         description: 'Что идёт прямо сейчас' },
      { command: 'week',        description: 'Обзор на неделю' },
      { command: 'status',      description: 'Здоровье источников' },
      { command: 'settings',    description: 'Объекты уведомлений и дайджест' },
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
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else {
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
    }
  } catch (err) {
    // 200 отдаём в любом случае (иначе Telegram ретраит), но след в логах
    // оставляем — пустой catch превращал любой сбой в молчаливый no-op.
    console.error('[telegram] webhook error:', err?.message || err);
  }

  // Всегда 200, иначе Telegram будет ретраить этот же update.
  res.status(200).end(JSON.stringify({ ok: true }));
};
