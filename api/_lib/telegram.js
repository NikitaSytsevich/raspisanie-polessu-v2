// Telegram-транспорт + хранение подписчиков в Vercel Blob.
// Общее для api/notify.js (рассылка) и api/telegram.js (webhook-команды).

const { chunkText } = require('./format');

const SUBSCRIBERS_KEY = 'tg-subscribers.json';

function haveBlob() { return Boolean(process.env.BLOB_READ_WRITE_TOKEN); }

// ── Generic JSON-blob helpers ───────────────────────────────────
async function blobLoadJson(key) {
  if (!haveBlob()) return null;
  try {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: key, limit: 1 });
    if (!blobs || !blobs.length) return null;
    const r = await fetch(blobs[0].url, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function blobSaveJson(key, value) {
  if (!haveBlob()) return false;
  try {
    const { put } = require('@vercel/blob');
    await put(key, JSON.stringify(value), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
    return true;
  } catch { return false; }
}

// ── Подписчики ──────────────────────────────────────────────────
// /subscribe в боте дописывает chat_id сюда — получатели добавляются без
// правки env и редеплоя. env TELEGRAM_CHAT_ID остаётся «вшитым» списком.
async function loadSubscribers() {
  const data = await blobLoadJson(SUBSCRIBERS_KEY);
  return Array.isArray(data?.chats) ? data.chats.map(String) : [];
}

async function saveSubscribers(chats) {
  return blobSaveJson(SUBSCRIBERS_KEY, {
    updatedAt: new Date().toISOString(),
    chats: [...new Set(chats.map(String))],
  });
}

function envChats(name = 'TELEGRAM_CHAT_ID') {
  return String(process.env[name] || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

// Все получатели рассылки: env-список + самоподписавшиеся, без дублей.
async function allRecipients() {
  return [...new Set([...envChats(), ...(await loadSubscribers())])];
}

// ── Отправка ────────────────────────────────────────────────────
function tgUrl(method) {
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
}

async function tgApi(method, body) {
  const r = await fetch(tgUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { ok: r.ok && json?.ok !== false, status: r.status, json };
}

// Одно сообщение одному чату. 429 — ждём retry_after (кап 3 с, чтобы не
// упереться в maxDuration функции) и пробуем ещё раз.
async function sendMessage(chatId, text, extra = {}) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  };
  try {
    let res = await tgApi('sendMessage', body);
    if (res.status === 429) {
      const wait = Math.min(3, Number(res.json?.parameters?.retry_after) || 1);
      await new Promise(r => setTimeout(r, wait * 1000));
      res = await tgApi('sendMessage', body);
    }
    return res.ok;
  } catch { return false; }
}

// Длинный текст — частями ≤4000; extra (inline-кнопки) вешаем только на
// последнюю часть, чтобы кнопка была внизу сообщения.
async function sendLong(chatId, text, extra = {}) {
  const parts = chunkText(text);
  let okAll = true;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    const ok = await sendMessage(chatId, parts[i], isLast ? extra : {});
    okAll = okAll && ok;
  }
  return okAll;
}

// Рассылка по списку чатов. Возвращает { sent, failed }.
async function broadcast(text, chats, extra = {}) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !chats.length) {
    return { sent: 0, failed: 0, reason: 'telegram_not_configured' };
  }
  let sent = 0, failed = 0;
  for (const chatId of chats) {
    (await sendLong(chatId, text, extra)) ? sent++ : failed++;
  }
  return { sent, failed };
}

// Inline-кнопка «открыть приложение» под сообщением.
function appButton() {
  const url = process.env.APP_URL || 'https://raspisanie-polessu-v2.vercel.app';
  return { reply_markup: { inline_keyboard: [[{ text: '📲 Открыть приложение', url }]] } };
}

module.exports = {
  haveBlob,
  blobLoadJson,
  blobSaveJson,
  loadSubscribers,
  saveSubscribers,
  envChats,
  allRecipients,
  tgApi,
  sendMessage,
  sendLong,
  broadcast,
  appButton,
};
