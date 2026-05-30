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
//   Суббота 06.06.2026
//   15.00 – 15.45
//   16.15 – 17.00
//
// Особенности именно этой страницы:
//   • Таблицы нет — текст разложен по <p>/<br>, как у малого бассейна.
//   • Под датой нет названия активности: всё расписание — это «массовое
//     катание» (заголовок «Расписание массового катания» сверху). Поэтому
//     activity у каждой сессии фиксированная.
//   • День и дату иногда пишут слитно («Пятница05.06.2026») — отсюда `\s*`
//     между названием дня и датой.
//
// Стратегия (как в sportsPool/smallPool):
//   • Сначала inline-парсер: closure (если есть) уходит в closureRanges,
//     сессии берём только из перечисленных дат.
//   • Если inline пуст — пробуем таблицу через genericParse.
//   • Если и таблицы нет, но closure-notice есть — полное закрытие.

const cheerio = require('cheerio');
const { genericParse, extractContentRoot } = require('./_common');
const closure = require('./closureNotice');
const { normalizeText, parseTime } = require('../_lib/timeParse');

// «Понедельник 01.06.2026» / «Пятница05.06.2026» (день и дата могут быть
// слитно — отсюда `\s*`). Сам день недели не несёт информации (дата задана),
// он лишь служит якорем начала блока.
const DAY_HEADER_RE = /(понедельник|вторник|сред[ауы]|четверг|пятниц[аы]|суббот[аы]|воскресень[еяю])\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/giu;
// Слот «HH.MM – HH.MM». Разделитель часов/минут [.:] — на странице исторически
// точка, но если вёрстку поправят на «20:30-21:15», парсер не должен молча
// отдать 0 сессий.
const SLOT_RE = /(\d{1,2})[.:](\d{2})\s*[-–—]\s*(\d{1,2})[.:](\d{2})/g;

// На странице расписание целиком — массовое катание (см. заголовок
// «Расписание массового катания»). У слотов нет собственной подписи, поэтому
// активность общая. Текст «массовое катание» нужен фронту: classifyActivity
// матчит /массов|катан/ и рисует иконку «массовое» (см. app/data.jsx).
const ACTIVITY = 'Массовое катание';

function isoDate(y, m, d) {
  return `${y}-${String(+m).padStart(2, '0')}-${String(+d).padStart(2, '0')}`;
}

// Плоский текст с разделителями между блочными элементами (cheerio.text()
// склеивает соседние блоки без пробела). Идентично хелперам бассейнов.
function flatTextWithSpaces($, $root) {
  const $clone = cheerio.load('<root>' + ($root.html() || '') + '</root>').root().find('root');
  $clone.find('br').replaceWith(' ');
  const BLOCKS = 'p, div, h1, h2, h3, h4, h5, h6, li, tr, td, th, blockquote';
  $clone.find(BLOCKS).each((_, el) => {
    cheerio.load('<x> </x>')('x').prependTo(el);
    cheerio.load('<x> </x>')('x').appendTo(el);
  });
  return normalizeText($clone.text());
}

// Идём по якорям-дням, между соседними якорями собираем все слоты времени.
// Срез берём от КОНЦА заголовка дня (anchor.end), чтобы дата в шапке
// («01.06.2026») не попала под SLOT_RE.
function extractInlineSessions(text) {
  const anchors = [];
  let m;
  DAY_HEADER_RE.lastIndex = 0;
  while ((m = DAY_HEADER_RE.exec(text)) !== null) {
    anchors.push({ end: m.index + m[0].length, pos: m.index, date: isoDate(m[4], m[3], m[2]) });
  }
  if (!anchors.length) return [];

  const sessions = [];
  for (let i = 0; i < anchors.length; i++) {
    const from = anchors[i].end;
    const to = i + 1 < anchors.length ? anchors[i + 1].pos : text.length;
    const slice = text.slice(from, to);
    SLOT_RE.lastIndex = 0;
    let sm;
    while ((sm = SLOT_RE.exec(slice)) !== null) {
      const start = parseTime(`${sm[1]}.${sm[2]}`);
      const end   = parseTime(`${sm[3]}.${sm[4]}`);
      if (!start || !end) continue;
      sessions.push({ date: anchors[i].date, start, end, activity: ACTIVITY });
    }
  }

  // Уникализуем (date,start,end) — на случай дублирующих фрагментов вёрстки.
  const seen = new Set();
  return sessions.filter(s => {
    const k = `${s.date}|${s.start}|${s.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parse(html, ctx) {
  const $ = cheerio.load(html);
  const $root = extractContentRoot($);

  const text = flatTextWithSpaces($, $root);
  // closure.detect получает уже очищенный текст — иначе notice склеивается
  // без пробелов между блочными элементами.
  const notice = closure.detect($, $root, text);
  const sessions = extractInlineSessions(text);

  if (sessions.length > 0) {
    // Расписание есть — отдаём. closure (если был) уходит в closureRanges,
    // чтобы фронт пометил «закрыт» для дат внутри окна ремонта.
    const closureRanges = [];
    if (notice?.range) {
      closureRanges.push({
        from: notice.range.from,
        to: notice.range.to,
        notice: notice.notice,
      });
    }
    return { ok: true, sessions, closureRanges };
  }

  // Inline пусто — пробуем таблицу (на случай возврата к табличной вёрстке).
  const generic = genericParse(html, ctx);
  if (generic.ok && generic.sessions.length > 0) return generic;

  // И таблицы нет, но closure-notice был — полное закрытие, как раньше.
  if (notice) {
    return { ok: false, reason: 'closed', notice: notice.notice, range: notice.range || null };
  }
  return generic; // { ok:false, reason:'no_table' } или подобное
}

module.exports = { parse };
