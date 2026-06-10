// Парсер «Ледовая арена».
//
// Раньше страница жила в одном из двух состояний: либо таблица расписания,
// либо объявление «закрыта на ремонт». Сейчас встречается ТРЕТЬЕ, смешанное
// состояние — поверх объявления о закрытии висит инлайн-расписание массового
// катания с КОНКРЕТНЫМИ датами (как у бассейнов после ремонта):
//
//   Ледовая арена с 29.04.2026г. по 31.05.2026г. закрыта … (ремонт)
//   Понедельник 01.06.2026
//   20.30 – 21.15
//   Вторник 02.06.2026
//   20.30 – 21.15
//   …
//
// Особенности именно этой страницы:
//   • Таблицы нет — текст разложен по <p>/<br>, разбор общим движком _inline.js.
//   • Под датой нет названия активности: всё расписание — это «массовое
//     катание» (заголовок «Расписание массового катания» сверху). Поэтому
//     activity у каждой сессии фиксированная.
//   • День и дату иногда пишут слитно («Пятница05.06.2026») — движок это
//     учитывает (\s* между словом-днём и датой).
//
// Стратегия (как в sportsPool/smallPool):
//   • «Богатый» inline — отдаём сразу; closure (если есть) в closureRanges.
//   • Слабый/пустой inline — сначала таблица через genericParse.
//   • Если и таблицы нет, но closure-notice есть — полное закрытие.

const cheerio = require('cheerio');
const { genericParse, extractContentRoot } = require('./_common');
const closure = require('./closureNotice');
const {
  extractInlineSessions, flatTextWithSpaces, isRichInline, okWithClosure,
} = require('./_inline');

// На странице расписание целиком — массовое катание (см. заголовок
// «Расписание массового катания»). У слотов нет собственной подписи, поэтому
// активность общая. Текст «массовое катание» нужен фронту: classifyActivity
// матчит /массов|катан/ и рисует иконку «массовое» (см. app/data.jsx).
const ACTIVITY = 'Массовое катание';

function parse(html, ctx) {
  const $ = cheerio.load(html);
  const $root = extractContentRoot($);
  const todayIso = ctx && ctx.todayIso;

  const text = flatTextWithSpaces($, $root);
  // closure.detect получает уже очищенный текст — иначе notice склеивается
  // без пробелов между блочными элементами.
  const notice = closure.detect($, $root, text, todayIso);
  const inline = extractInlineSessions(text, {
    activityFor: () => ACTIVITY,
    todayIso,
  });

  if (isRichInline(inline)) return okWithClosure(inline, notice);

  // Слабый/пустой inline — пробуем таблицу (на случай возврата к табличной вёрстке).
  const generic = genericParse(html, ctx);
  if (generic.ok && generic.sessions.length > 0) return generic;

  if (inline.length > 0) return okWithClosure(inline, notice);

  // И таблицы нет, но closure-notice был — полное закрытие, как раньше.
  if (notice) {
    return { ok: false, reason: 'closed', notice: notice.notice, range: notice.range || null };
  }
  return generic; // { ok:false, reason:'no_table' } или подобное
}

module.exports = { parse };
