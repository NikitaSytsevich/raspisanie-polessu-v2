// Парсер «Малый бассейн».
//
// Расписание приходит инлайн-списком с КОНКРЕТНЫМИ датами (как
// альтернативная форма большого бассейна), но активность идёт ПРЯМЫМ
// текстом после диапазона времени, без скобок:
//
//   Вторник 26.05.2026
//   11.45 – 12.30 Сеанс/Родительский сеанс
//   13.00 – 13.45 Сеанс/Родительский сеанс
//   …
//
// Таблицы на странице есть, но это вёрсточные обёртки вокруг того же
// текста — поэтому основной путь: общий inline-движок _inline.js, где
// activity вырезается срезом между текущим и следующим слотом.
// genericParse остаётся фолбэком на случай возврата к настоящей таблице.

const cheerio = require('cheerio');
const { genericParse, extractContentRoot } = require('./_common');
const closure = require('./closureNotice');
const { normalizeText } = require('../_lib/timeParse');
const {
  extractInlineSessions, flatTextWithSpaces, isRichInline, okWithClosure,
} = require('./_inline');

// Чистим описание слота: режем до известных footer-маркеров (страница
// заканчивается блоком «Срок действия абонементов / Оплатить услуги …»,
// который иначе подцепится к последнему слоту дня), затем убираем
// пунктуацию по краям.
const FOOTER_RE = /\s*(?:срок\s+действия|оплатить\s+услуги|оплата\s+услуг|стоимость\s+услуг|желаем\s+вам)/i;
function cleanActivity(raw) {
  let t = normalizeText(raw);
  const fm = t.match(FOOTER_RE);
  if (fm) t = t.slice(0, fm.index);
  return t.replace(/^[\s.,;:–—-]+|[\s.,;:–—-]+$/g, '');
}

function parse(html, ctx) {
  const $ = cheerio.load(html);
  const $root = extractContentRoot($);
  const todayIso = ctx && ctx.todayIso;

  const text = flatTextWithSpaces($, $root);
  const notice = closure.detect($, $root, text, todayIso);
  // Активность пишется сразу после времени, до следующего слота или дня —
  // выдираем срезом между совпадениями (slot.endIndex … slot.nextIndex).
  const inline = extractInlineSessions(text, {
    activityFor: (slot, slice) => cleanActivity(slice.slice(slot.endIndex, slot.nextIndex)),
    todayIso,
  });

  if (isRichInline(inline)) return okWithClosure(inline, notice);

  // Слабый/пустой inline — пробуем таблицу (вдруг вёрстку сменят на честную).
  const generic = genericParse(html, ctx);
  if (generic.ok && generic.sessions.length > 0) return generic;

  if (inline.length > 0) return okWithClosure(inline, notice);

  if (notice) {
    return { ok: false, reason: 'closed', notice: notice.notice, range: notice.range || null };
  }
  return generic; // { ok:false, reason:'no_table' } или подобное
}

module.exports = { parse };
