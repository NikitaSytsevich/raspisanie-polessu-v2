// Парсер «Гребная база №1 — тренажерный зал и зал штанги».
//
// На странице расписание дано не таблицей, а инлайн-текстом:
//   <h1>Понедельник - Пятница<br/>18.30-19.30<br/>19.30-20.30</h1>
// плюс отдельной строкой могут быть исключения вида
// "1.05.2026 Выходной день".

const cheerio = require('cheerio');
const { genericParse, extractContentRoot } = require('./_common');
const closure = require('./closureNotice');
const {
  normalizeText, parseTimeRange, weekdayIndex, nextDateForWeekday,
} = require('../_lib/timeParse');

// Собирает список конкретных дат-исключений вида «1.05.2026 Выходной день»
// или «12.06.2026 закрыт». Возвращает Set из ISO-дат.
function collectExceptionDates(text) {
  const set = new Set();
  const re = /(\d{1,2})\.(\d{1,2})\.(\d{4})[^\n]{0,40}?(выходн|не\s+работа|закрыт|отмен|праздн)/giu;
  let m;
  while ((m = re.exec(text)) !== null) {
    const iso = `${m[3]}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
    set.add(iso);
  }
  return set;
}

// Разбирает диапазон дней недели «Понедельник - Пятница» → [1,2,3,4,5].
function parseWeekdayRange(raw) {
  const s = normalizeText(raw).toLowerCase().replace(/[–—−]/g, '-');
  const m = s.match(/([а-яё]+)\s*-\s*([а-яё]+)/);
  if (!m) {
    const single = weekdayIndex(s);
    return single >= 0 ? [single] : [];
  }
  const from = weekdayIndex(m[1]);
  const to   = weekdayIndex(m[2]);
  if (from < 0 || to < 0) return [];
  const days = [];
  // Понедельник=1...Воскресенье=0, обходим по календарному порядку с пн.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const a = order.indexOf(from), b = order.indexOf(to);
  if (a < 0 || b < 0) return [];
  for (let i = a; i <= b; i++) days.push(order[i]);
  return days;
}

function parse(html, { todayIso }) {
  const $ = cheerio.load(html);
  const $root = extractContentRoot($);

  const notice = closure.detect($, $root);
  if (notice) {
    return { ok: false, reason: 'closed', notice: notice.notice, range: notice.range || null };
  }

  // Собираем даты-исключения по всему контенту (выходные, отмены и т.п.).
  const exceptions = collectExceptionDates(normalizeText($root.text()));

  // Сначала пробуем универсальный табличный парсер — на случай если разметку поменяют.
  const generic = genericParse(html, { todayIso });
  if (generic.ok && generic.sessions.length > 0) {
    generic.sessions = generic.sessions.filter(s => !exceptions.has(s.date));
    return generic;
  }

  // Иначе — инлайн-формат. Берём h1/h2/p, склеиваем по <br>.
  const sessions = [];
  $root.find('h1, h2, h3, p, div').each((_, el) => {
    const html = $(el).html() || '';
    // Разрезаем по <br/> / переводам строк
    const chunks = html.split(/<br\s*\/?>|\r?\n/i).map(s => normalizeText(cheerio.load('<x>'+s+'</x>')('x').text()));
    let activeDays = null;
    for (const chunk of chunks) {
      if (!chunk) continue;
      const days = parseWeekdayRange(chunk);
      if (days.length) {
        activeDays = days;
        continue;
      }
      const range = parseTimeRange(chunk);
      if (range && activeDays && activeDays.length) {
        for (const wd of activeDays) {
          const date = nextDateForWeekday(todayIso, wd);
          if (exceptions.has(date)) continue;
          sessions.push({
            date,
            start: range.start,
            end: range.end,
            activity: 'Тренажерный зал / зал силовой подготовки',
          });
        }
      }
    }
  });

  // Уникализуем (date,start,end)
  const seen = new Set();
  const unique = sessions.filter(s => {
    const k = `${s.date}|${s.start}|${s.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!unique.length) {
    return { ok: false, reason: 'no_table' };
  }
  return { ok: true, sessions: unique };
}

module.exports = { parse };
