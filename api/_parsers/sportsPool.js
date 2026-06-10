// Парсер «Большой бассейн».
//
// Расписание на странице приходит в двух разных формах:
//
//   1) Таблица «дни недели × слоты» (обычный режим).
//      Обрабатывается универсальным genericParse() из _common.js.
//
//   2) Инлайн-список с КОНКРЕТНЫМИ датами (после ремонта/закрытия):
//
//        Вторник 26.05.2026
//        09.15 – 10.00 (свободно 3 дорожки, без 1 крайней)
//        10.30 – 11.15 (свободно 6 дорожек, без 1 крайней)
//        Среда 27.05.2026
//        ...
//
//      Здесь нет дней недели в шапке таблицы и часто рядом висит
//      объявление о закрытии вида «с 18.05 по 25.05 бассейн не работает».
//      Разбор — общим движком _inline.js.
//
// Стратегия:
//   • «Богатый» inline (≥2 дней или ≥3 слотов) — отдаём сразу; closure
//     уходит в closureRanges, сессии берём из перечисленных дат.
//   • Слабый/пустой inline — сначала таблица через genericParse: одиночное
//     inline-совпадение может оказаться фантомом из новостного абзаца при
//     живой таблице.
//   • Таблицы нет, но слабый inline есть — берём его.
//   • Ничего нет, а closure-notice есть — полное закрытие, как раньше.

const cheerio = require('cheerio');
const { genericParse, extractContentRoot } = require('./_common');
const closure = require('./closureNotice');
const { normalizeText } = require('../_lib/timeParse');
const {
  extractInlineSessions, flatTextWithSpaces, isRichInline, okWithClosure,
} = require('./_inline');

// Слот «HH.MM – HH.MM» с опциональным «(описание дорожек)». Описание матчится
// только при наличии ОБЕИХ скобок. Без `)` (на странице встречаются такие
// «огрызки» вида «09.15 – 10.00 (свободно 3 дорожки, без 1 крайней») слот
// учитывается, но без description — иначе жадный [^)] пожрал бы текст
// следующего слота до его закрывающей скобки. `[^()]` явно исключает
// вложенные скобки.
const SLOT_WITH_DESC_RE = /(\d{1,2})[.:](\d{2})\s*[-–—]\s*(\d{1,2})[.:](\d{2})(?:\s*\(([^()]+)\))?/g;

// «Обучение плаванию …» (на странице — «Обучение плаванию Мельникова О.В.»):
// отдельная секция занятий с тренером, идёт ПОСЛЕ сетки свободного плавания,
// перечислена днями-словами без конкретных дат. К свободному плаванию не
// относится и НЕ должна давать сеансы. Отрезаем секцию целиком — всё от
// маркера и до конца текста — ещё до разбора, чтобы её слоты не попадали в
// сессии независимо от порядка «день/время» внутри блока.
const LESSONS_SECTION_RE = /обучени[ея]\s+плавани[июя]/iu;

function stripLessonsSection(text) {
  const m = LESSONS_SECTION_RE.exec(text);
  return m ? text.slice(0, m.index).trim() : text;
}

// Превращает «(свободно 3 дорожки, без 1 крайней)» →
// «Свободное плавание · 3 дорожки, без 1 крайней».
//
// КРИТИЧНО сохранять «без N крайних» — клиент использует это, чтобы
// показать визуально что крайние дорожки закрыты, а свободные — в
// середине. Без этого клиент рендерит N свободных слева + остаток
// closed справа, что не соответствует реальности (в полесГУ край
// закрывают для безопасности/тренировок).
function activityFromDescription(desc) {
  const base = 'Свободное плавание';
  if (!desc) return base;
  // `\w` в JS — это ASCII, кириллица в него не входит даже с u-флагом.
  // Используем явный диапазон [а-яё].
  const text = normalizeText(desc);
  const mCount = text.match(/свободно\s+(\d+)\s+(дорож[а-яё]+)/iu);
  const mEdge  = text.match(/без\s+(?:\d+\s+)?крайн[а-яё]*/iu);
  const parts = [];
  if (mCount) parts.push(`${mCount[1]} ${mCount[2]}`);
  if (mEdge)  parts.push(mEdge[0]);
  if (!parts.length) return base;
  return `${base} · ${parts.join(', ')}`;
}

function parse(html, ctx) {
  const $ = cheerio.load(html);
  const $root = extractContentRoot($);
  const todayIso = ctx && ctx.todayIso;

  const text = flatTextWithSpaces($, $root);
  // closure.detect получает уже очищенный текст — иначе notice выходит
  // склеенный без пробелов между блочными элементами. Ему отдаём ПОЛНЫЙ
  // текст: объявление о закрытии всегда вверху, до секции занятий.
  const notice = closure.detect($, $root, text, todayIso);
  // Сессии разбираем по тексту БЕЗ хвостовой секции «Обучение плаванию» —
  // её слоты не относятся к свободному плаванию (см. stripLessonsSection).
  const inline = extractInlineSessions(stripLessonsSection(text), {
    slotRe: SLOT_WITH_DESC_RE,
    activityFor: slot => activityFromDescription(slot.m[5]),
    todayIso,
  });

  // Уверенный inline — отдаём сразу.
  if (isRichInline(inline)) return okWithClosure(inline, notice);

  // Иначе сначала таблица: при живой таблице слабый inline — скорее фантом.
  const generic = genericParse(html, ctx);
  if (generic.ok && generic.sessions.length > 0) return generic;

  // Таблицы нет — слабый inline всё же лучше, чем ничего.
  if (inline.length > 0) return okWithClosure(inline, notice);

  // И таблицы нет, но closure-notice был — возвращаем полное закрытие.
  if (notice) {
    return { ok: false, reason: 'closed', notice: notice.notice, range: notice.range || null };
  }
  return generic; // { ok:false, reason:'no_table' } или подобное
}

module.exports = { parse };
