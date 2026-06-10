// Утилиты времени, дат и нормализации текста для парсеров.

const WEEKDAY_MAP = {
  'пн': 1, 'пон': 1, 'понедельник': 1,
  'вт': 2, 'вто': 2, 'вторник': 2,
  'ср': 3, 'сре': 3, 'среда': 3,
  'чт': 4, 'чет': 4, 'четверг': 4,
  'пт': 5, 'пят': 5, 'пятница': 5,
  'сб': 6, 'суб': 6, 'суббота': 6,
  'вс': 0, 'вос': 0, 'воскресенье': 0,
};

// Сокращения матчатся только как ЦЕЛОЕ слово: префиксное сравнение давало
// ложные дни — «все группы» → «вс» (воскресенье), «пятый» → «пят» (пятница).
const WEEKDAY_ABBREVS = {
  'пн': 1, 'пон': 1, 'вт': 2, 'вто': 2, 'ср': 3, 'сре': 3,
  'чт': 4, 'чет': 4, 'пт': 5, 'пят': 5, 'сб': 6, 'суб': 6, 'вс': 0, 'вос': 0,
};
// Полные названия — по основе; хвост склонения ограничен 2 буквами,
// чтобы «среды/среду» матчились, а «средний» — нет.
const WEEKDAY_STEMS = [
  ['понедельник', 1], ['вторник', 2], ['сред', 3], ['четверг', 4],
  ['пятниц', 5], ['суббот', 6], ['воскресень', 0],
];

const MONTHS = ['января','февраля','марта','апреля','мая','июня',
                'июля','августа','сентября','октября','ноября','декабря'];

// Очистка текста: NBSP, мягкие переносы, повторяющиеся пробелы.
function normalizeText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/ /g, ' ')
    .replace(/­/g, '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "7.30" / "7:30" / "07-30" / "0730" → "07:30"; иначе null.
function parseTime(raw) {
  const s = normalizeText(raw);
  const m = s.match(/^(\d{1,2})\s*[.:\-\s]\s*(\d{2})$/) || s.match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// "07:30-09:00" / "7.30 — 9.00" → { start, end } или null.
function parseTimeRange(raw) {
  const s = normalizeText(raw).replace(/[–—−]/g, '-');
  const m = s.match(/^(\d{1,2}\s*[.:\-\s]\s*\d{2})\s*-\s*(\d{1,2}\s*[.:\-\s]\s*\d{2})$/);
  if (!m) return null;
  const start = parseTime(m[1]);
  const end = parseTime(m[2]);
  if (!start || !end) return null;
  return { start, end };
}

function weekdayIndex(raw) {
  const s = normalizeText(raw).toLowerCase().replace(/\./g, '');
  const m = s.match(/^[а-яё]+/);
  if (!m) return -1;
  const word = m[0];
  if (word in WEEKDAY_ABBREVS) return WEEKDAY_ABBREVS[word];
  for (const [stem, idx] of WEEKDAY_STEMS) {
    if (word.startsWith(stem) && word.length - stem.length <= 2) return idx;
  }
  return -1;
}

function todayIsoMinsk() {
  // Vercel runs UTC; Europe/Minsk = UTC+3 (без перехода на летнее время).
  const now = new Date();
  const minskMs = now.getTime() + 3 * 60 * 60 * 1000;
  return new Date(minskMs).toISOString().slice(0, 10);
}

function isoOffset(baseIso, days) {
  const d = new Date(baseIso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Для заданного индекса дня недели возвращает ближайшую дату ≥ baseIso,
// у которой соответствующий weekday. Используется при разборе таблиц,
// где дни описаны словами «Понедельник», «Вторник», ...
function nextDateForWeekday(baseIso, wdIdx) {
  const base = new Date(baseIso + 'T12:00:00Z');
  const baseWd = base.getUTCDay();
  const diff = (wdIdx - baseWd + 7) % 7;
  return isoOffset(baseIso, diff);
}

// Распознавание диапазона дат вида "18.05.2026-24.05.2026" или "с 18.05 по 24.05".
// todayIso (опционально) задаёт год по умолчанию, когда он не указан в тексте —
// иначе берётся текущий UTC-год, который ошибается на стыке годов.
function parseDateRange(raw, todayIso) {
  const s = normalizeText(raw).replace(/[–—−]/g, '-');
  let m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*г?\.?\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*г?\.?/);
  if (m) {
    return {
      from: `${m[3]}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`,
      to:   `${m[6]}-${String(+m[5]).padStart(2, '0')}-${String(+m[4]).padStart(2, '0')}`,
    };
  }
  m = s.match(/с\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s*г?\.?\s*по\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s*г?\.?/i);
  if (m) {
    const baseYear = todayIso ? Number(todayIso.slice(0, 4)) : new Date().getUTCFullYear();
    const yFrom = m[3] ? Number(m[3]) : (m[6] ? Number(m[6]) : baseYear);
    const yTo   = m[6] ? Number(m[6]) : yFrom;
    const iso = (y, mo, d) => `${y}-${String(+mo).padStart(2, '0')}-${String(+d).padStart(2, '0')}`;
    let from = iso(yFrom, m[2], m[1]);
    let to   = iso(yTo, m[5], m[4]);
    // Диапазон через Новый год с неполными годами: «с 28.12 по 05.01».
    if (to < from) {
      if (m[6] && !m[3])  from = iso(yFrom - 1, m[2], m[1]);
      else if (!m[6])     to   = iso(yTo + 1, m[5], m[4]);
    }
    return { from, to };
  }
  return null;
}

// Окно правдоподобия дат сессии относительно «сегодня».
const SESSION_PAST_DAYS = 7;
const SESSION_FUTURE_DAYS = 45;

// Отбрасывает явно битые сессии: инвертированное время (start ≥ end) и даты
// вне окна [today−7, today+45]. Защита от опечаток на сайте и от «забытых»
// страниц с прошлогодним расписанием — иначе мусор получит dataQuality:'ok',
// перезапишет last-known-good и уйдёт в Telegram-диффы.
function validateSessions(sessions, todayIso) {
  const min = todayIso ? isoOffset(todayIso, -SESSION_PAST_DAYS) : null;
  const max = todayIso ? isoOffset(todayIso, SESSION_FUTURE_DAYS) : null;
  return sessions.filter(s =>
    s.start < s.end && (!todayIso || (s.date >= min && s.date <= max)));
}

module.exports = {
  normalizeText,
  parseTime,
  parseTimeRange,
  weekdayIndex,
  todayIsoMinsk,
  isoOffset,
  nextDateForWeekday,
  parseDateRange,
  validateSessions,
  WEEKDAY_MAP,
  MONTHS,
};
