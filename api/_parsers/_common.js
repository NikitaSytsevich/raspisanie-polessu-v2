// Общий каркас парсера: извлечь основной контент Drupal-ноды и
// прогнать через универсальный «schedule-table extractor».
// Каждый per-facility парсер берёт это как базу и при желании
// добавляет/корректирует логику.

const cheerio = require('cheerio');
const closure = require('./closureNotice');
const {
  normalizeText, parseTimeRange,
  weekdayIndex, nextDateForWeekday,
} = require('../_lib/timeParse');

// Достаёт корень контента независимо от четности класса (.even/.odd).
function extractContentRoot($) {
  let $root = $('div.field-item[property="content:encoded"]').first();
  if (!$root.length) $root = $('.node-raspisanie .field-name-body').first();
  if (!$root.length) $root = $('#main .region-content').first();
  if (!$root.length) $root = $('body').first();
  return $root;
}

// Преобразование таблицы «дни недели в шапке × строки расписания» в массив сессий.
// Поддерживает два layout'а:
//   A) Дни в шапке (1-й tr содержит названия дней), 1-я колонка — время.
//   B) 1-я колонка — день недели, остальные — слоты времени и активность.
function extractSessionsFromTable($, $table, todayIso) {
  const rows = $table.find('tr').toArray().map(tr => $(tr).find('th,td').toArray());
  if (rows.length < 2) return [];

  const head = rows[0].map(c => normalizeText($(c).text()));
  const headWeekdays = head.map(weekdayIndex);
  const headHasWeekdays = headWeekdays.filter(x => x >= 0).length >= 3;

  const sessions = [];

  if (headHasWeekdays) {
    // Layout A: колонки = дни, строки = слоты времени.
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (!cells.length) continue;
      const timeText = normalizeText($(cells[0]).text());
      const range = parseTimeRange(timeText);
      if (!range) continue;
      for (let c = 1; c < cells.length && c < head.length; c++) {
        const wd = headWeekdays[c];
        if (wd < 0) continue;
        const activity = normalizeText($(cells[c]).text());
        if (!activity) continue;
        sessions.push({
          date: nextDateForWeekday(todayIso, wd),
          start: range.start,
          end: range.end,
          activity,
        });
      }
    }
  } else {
    // Layout B: первая колонка = день недели или слот «день: время — активность».
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (cells.length < 2) continue;
      const dayText = normalizeText($(cells[0]).text());
      const wd = weekdayIndex(dayText);
      if (wd < 0) continue;
      // Каждая последующая ячейка может содержать «HH:MM-HH:MM активность»
      for (let c = 1; c < cells.length; c++) {
        const txt = normalizeText($(cells[c]).text());
        if (!txt) continue;
        const m = txt.match(/^(\d{1,2}\s*[.:\-\s]\s*\d{2}\s*[-–—]\s*\d{1,2}\s*[.:\-\s]\s*\d{2})\s+(.+)$/);
        if (m) {
          const range = parseTimeRange(m[1]);
          if (!range) continue;
          sessions.push({
            date: nextDateForWeekday(todayIso, wd),
            start: range.start,
            end: range.end,
            activity: m[2],
          });
        }
      }
    }
  }

  return sessions;
}

// Универсальный parse() — вызывает per-facility builders, если они есть.
function genericParse(html, { todayIso }) {
  const $ = cheerio.load(html);
  const $root = extractContentRoot($);

  const notice = closure.detect($, $root);
  if (notice) {
    return { ok: false, reason: 'closed', notice: notice.notice, range: notice.range || null };
  }

  const $tables = $root.find('table');
  const sessions = [];
  $tables.each((_, t) => {
    const rows = extractSessionsFromTable($, $(t), todayIso);
    sessions.push(...rows);
  });

  if (!sessions.length) {
    return { ok: false, reason: 'no_table' };
  }
  // На странице бывает несколько таблиц (основная + повтор/превью), и
  // одна и та же (date,start,end,activity) попадает дважды. Лишние слоты
  // потом раздували бы карточку «по сайту» и счётчики Hero.
  const seen = new Set();
  const unique = sessions.filter(s => {
    const k = `${s.date}|${s.start}|${s.end}|${s.activity}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ok: true, sessions: unique };
}

module.exports = { genericParse, extractContentRoot, extractSessionsFromTable };
