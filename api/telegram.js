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
  sendLong, appButton, loadSubscribers, saveSubscribers, envChats,
} = require('./_lib/telegram');
const { formatDaySchedule, formatStatus } = require('./_lib/format');

const TZ = 'Europe/Minsk';

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

async function handleCommand(cmd, chatId) {
  if (cmd === 'start' || cmd === 'help') {
    return sendLong(chatId, HELP, appButton());
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
    const payload = await buildPayload();
    const date = isoMinskOffset(cmd === 'tomorrow' ? 1 : 0);
    return sendLong(chatId, formatDaySchedule(payload, date), appButton());
  }
  if (cmd === 'status') {
    const payload = await buildPayload();
    return sendLong(chatId, formatStatus(payload));
  }
  return sendLong(chatId, 'Не знаю такую команду. Список: /help');
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const got = req.headers && req.headers['x-telegram-bot-api-secret-token'];
  // Без настроенного секрета webhook не работает — не оставляем endpoint
  // открытым: любой мог бы слать «команды» от чужого имени.
  if (!secret || got !== secret) {
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
    const m = /^\/([a-z_]+)(?:@\w+)?/i.exec(text);
    if (chatId && m) {
      await handleCommand(m[1].toLowerCase(), chatId);
    }
  } catch {}

  // Всегда 200, иначе Telegram будет ретраить этот же update.
  res.status(200).end(JSON.stringify({ ok: true }));
};
