// Telegram-транспорт + хранение подписчиков в Vercel Blob.
// Общее для api/notify.js (рассылка) и api/telegram.js (webhook-команды).
//
// ПРИВАТНОСТЬ: Vercel Blob в текущем SDK пишет только с access:'public' —
// подписчики, prev-снапшот и смены доступны по прямому URL. URL содержит
// неугадываемый store-id (защита через неизвестность), поэтому ничего
// чувствительнее chat_id и анонимных смен здесь хранить нельзя.

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
  } catch (err) {
    console.warn('[blob] load failed:', key, err?.message || err);
    return null;
  }
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
  } catch (err) {
    console.warn('[blob] save failed:', key, err?.message || err);
    return false;
  }
}

// ── Подписчики и настройки чатов ─────────────────────────────────
// /subscribe в боте дописывает chat_id сюда — получатели добавляются без
// правки env и редеплоя. env TELEGRAM_CHAT_ID остаётся «вшитым» списком.
// Blob: { chats: [...], prefs: { [chatId]: { objects, digest } } }:
//   objects — id объектов для уведомлений (null/нет = все объекты);
//   digest  — слать ли утренний дайджест (нет = да).
const DEFAULT_PREFS = { objects: null, digest: true };

async function loadSubsData() {
  const data = (await blobLoadJson(SUBSCRIBERS_KEY)) || {};
  return {
    chats: Array.isArray(data.chats) ? data.chats.map(String) : [],
    prefs: (data.prefs && typeof data.prefs === 'object') ? data.prefs : {},
  };
}

async function saveSubsData({ chats, prefs }) {
  return blobSaveJson(SUBSCRIBERS_KEY, {
    updatedAt: new Date().toISOString(),
    chats: [...new Set((chats || []).map(String))],
    prefs: prefs || {},
  });
}

async function loadSubscribers() {
  return (await loadSubsData()).chats;
}

// Сохраняет список подписчиков, не затирая prefs (чистка фатальных чатов,
// /subscribe и /unsubscribe идут через него).
async function saveSubscribers(chats) {
  const data = await loadSubsData();
  return saveSubsData({ chats, prefs: data.prefs });
}

// Эффективные настройки чата из сырого prefs-объекта (с дефолтами).
function resolvePrefs(prefs, chatId) {
  const p = prefs[String(chatId)] || {};
  return {
    objects: Array.isArray(p.objects) ? p.objects : DEFAULT_PREFS.objects,
    digest: p.digest !== false,
  };
}

// Полные настройки чата для /settings: objects/digest + подписан ли он
// (env-чаты подписаны всегда и из Blob-списка не управляются).
async function getChatSettings(chatId) {
  const data = await loadSubsData();
  const id = String(chatId);
  const isEnv = envChats().includes(id);
  return {
    ...resolvePrefs(data.prefs, id),
    subscribed: isEnv || data.chats.includes(id),
    isEnv,
  };
}

// ── Мутаторы настроек (callback-кнопки /settings) ───────────────
async function setChatPrefs(chatId, patch) {
  const data = await loadSubsData();
  const id = String(chatId);
  data.prefs[id] = { ...resolvePrefs(data.prefs, id), ...patch };
  await saveSubsData(data);
}

// Тумблер объекта. allIds — полный список объектов: если после клика
// выбраны все — храним null («все»), иначе явный список.
async function toggleObject(chatId, allIds, facilityId) {
  const cur = (await getChatSettings(chatId)).objects;
  const set = new Set(cur || allIds);
  if (set.has(facilityId)) set.delete(facilityId); else set.add(facilityId);
  const objects = set.size === allIds.length ? null : [...set];
  await setChatPrefs(chatId, { objects });
  return getChatSettings(chatId);
}

async function toggleDigest(chatId) {
  const cur = (await getChatSettings(chatId)).digest;
  await setChatPrefs(chatId, { digest: !cur });
  return getChatSettings(chatId);
}

// Подписка на изменения (членство в Blob-списке). Для env-чатов — no-op.
async function toggleSubscribed(chatId) {
  const data = await loadSubsData();
  const id = String(chatId);
  if (envChats().includes(id)) return getChatSettings(chatId);
  const has = data.chats.includes(id);
  const chats = has ? data.chats.filter(c => c !== id) : [...data.chats, id];
  await saveSubsData({ chats, prefs: data.prefs });
  return getChatSettings(chatId);
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

// Таймаут на Telegram API: зависший запрос без него ел бы весь maxDuration
// функции (fetchHtml свой таймаут имеет, а здесь не было).
const TG_TIMEOUT_MS = 8000;

async function tgApi(method, body) {
  const r = await fetch(tgUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TG_TIMEOUT_MS),
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { ok: r.ok && json?.ok !== false, status: r.status, json };
}

// Фатальные для чата ошибки: бот заблокирован/выкинут (403), чат удалён или
// мигрировал в супергруппу (400). Повторять отправку бессмысленно — такие
// чаты broadcast выписывает из Blob-подписки.
function isFatalChatError(status, json) {
  if (status === 403) return true;
  const desc = String(json?.description || '');
  return status === 400 && /chat not found|group chat was upgraded/i.test(desc);
}

// Одно сообщение одному чату. 429 — ждём retry_after (кап 3 с, чтобы не
// упереться в maxDuration функции) и пробуем ещё раз.
// Возвращает { ok, fatal } — fatal означает «чат мёртв, чистить подписку».
async function sendMessage(chatId, text, extra = {}) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { ok: false, fatal: false };
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
    if (!res.ok) console.warn('[tg] sendMessage failed:', chatId, res.status, res.json?.description || '');
    return { ok: res.ok, fatal: !res.ok && isFatalChatError(res.status, res.json) };
  } catch (err) {
    console.warn('[tg] sendMessage error:', chatId, err?.message || err);
    return { ok: false, fatal: false };
  }
}

// Длинный текст — частями ≤4000; extra (inline-кнопки) вешаем только на
// последнюю часть, чтобы кнопка была внизу сообщения.
// Возвращает { ok, fatal }; на фатальной ошибке остаток частей не шлём.
async function sendLong(chatId, text, extra = {}) {
  const parts = chunkText(text);
  let okAll = true;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    const r = await sendMessage(chatId, parts[i], isLast ? extra : {});
    okAll = okAll && r.ok;
    if (r.fatal) return { ok: false, fatal: true };
  }
  return { ok: okAll, fatal: false };
}

// Рассылка по списку чатов: пачками, а не строго последовательно — на
// десятках получателей последовательная отправка упиралась бы в maxDuration.
// Чаты с фатальной ошибкой (заблокировали бота) выписываются из
// Blob-подписки, чтобы не тратить время на них каждый прогон; env-чатов
// в Blob-списке нет — их чистка не касается. Возвращает { sent, failed }.
const BROADCAST_CONCURRENCY = 8;

async function broadcast(text, chats, extra = {}) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !chats.length) {
    return { sent: 0, failed: 0, reason: 'telegram_not_configured' };
  }
  let sent = 0, failed = 0;
  const fatalChats = [];
  for (let i = 0; i < chats.length; i += BROADCAST_CONCURRENCY) {
    const batch = chats.slice(i, i + BROADCAST_CONCURRENCY);
    const results = await Promise.all(batch.map(c => sendLong(c, text, extra)));
    results.forEach((r, j) => {
      if (r.ok) sent++;
      else {
        failed++;
        if (r.fatal) fatalChats.push(String(batch[j]));
      }
    });
  }
  if (fatalChats.length) {
    const subs = await loadSubscribers();
    const keep = subs.filter(c => !fatalChats.includes(c));
    if (keep.length !== subs.length) {
      await saveSubscribers(keep);
      console.warn('[tg] отписаны недоступные чаты:', fatalChats.join(', '));
    }
  }
  return { sent, failed };
}

// ── Callback-кнопки ─────────────────────────────────────────────
// answerCallbackQuery гасит «часики» на нажатой кнопке (без него Telegram
// крутит спиннер ~30 c). editMessageText/ReplyMarkup правят уже отправленное
// сообщение на месте — навигация по дням и тумблеры /settings не плодят новые.
async function answerCallback(callbackQueryId, text = '') {
  return tgApi('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

async function editMessageText(chatId, messageId, text, extra = {}) {
  return tgApi('editMessageText', {
    chat_id: chatId, message_id: messageId, text,
    parse_mode: 'HTML', disable_web_page_preview: true, ...extra,
  });
}

async function editMessageReplyMarkup(chatId, messageId, reply_markup) {
  return tgApi('editMessageReplyMarkup', {
    chat_id: chatId, message_id: messageId, reply_markup,
  });
}

// Рассылка с индивидуальным текстом на чат (фильтр по объектам). buildText(chatId)
// → строка или null/'' (пропустить чат). Пачками, с чисткой фатальных чатов.
// Возвращает { sent, failed, skipped }.
async function broadcastPerChat(chats, buildText, extra = {}) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !chats.length) {
    return { sent: 0, failed: 0, skipped: 0, reason: 'telegram_not_configured' };
  }
  let sent = 0, failed = 0, skipped = 0;
  const fatalChats = [];
  for (let i = 0; i < chats.length; i += BROADCAST_CONCURRENCY) {
    const batch = chats.slice(i, i + BROADCAST_CONCURRENCY);
    const results = await Promise.all(batch.map(async (c) => {
      const text = await buildText(c);
      if (!text) return { skip: true };
      return sendLong(c, text, extra);
    }));
    results.forEach((r, j) => {
      if (r.skip) { skipped++; return; }
      if (r.ok) sent++;
      else { failed++; if (r.fatal) fatalChats.push(String(batch[j])); }
    });
  }
  if (fatalChats.length) {
    const subs = await loadSubscribers();
    const keep = subs.filter(c => !fatalChats.includes(c));
    if (keep.length !== subs.length) {
      await saveSubscribers(keep);
      console.warn('[tg] отписаны недоступные чаты:', fatalChats.join(', '));
    }
  }
  return { sent, failed, skipped };
}

module.exports = {
  haveBlob,
  blobLoadJson,
  blobSaveJson,
  loadSubsData,
  saveSubsData,
  loadSubscribers,
  saveSubscribers,
  resolvePrefs,
  getChatSettings,
  toggleObject,
  toggleDigest,
  toggleSubscribed,
  envChats,
  allRecipients,
  tgApi,
  sendMessage,
  sendLong,
  broadcast,
  broadcastPerChat,
  answerCallback,
  editMessageText,
  editMessageReplyMarkup,
};
