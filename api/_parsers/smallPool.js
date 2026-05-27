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
// текста — `genericParse` из _common.js не находит в них дней-в-шапке
// и возвращает пусто. Поэтому ходим по плоскому тексту.

const cheerio = require('cheerio');
const { extractContentRoot } = require('./_common');
const closure = require('./closureNotice');
const { normalizeText, parseTime } = require('../_lib/timeParse');

const DAY_HEADER_RE = /(понедельник|вторник|сред[ауы]|четверг|пятниц[аы]|суббот[аы]|воскресень[еяю])\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/giu;
// Слот: «HH.MM – HH.MM». Активность пишется СРАЗУ после, до следующего
// слота или дня. Захватываем только время — описание выдерем срезом
// между совпадениями.
const SLOT_RE = /(\d{1,2})[.:](\d{2})\s*[-–—]\s*(\d{1,2})[.:](\d{2})/g;

function isoDate(y, m, d) {
  return `${y}-${String(+m).padStart(2, '0')}-${String(+d).padStart(2, '0')}`;
}

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

function flatTextWithSpaces($, $root) {
  const $clone = cheerio.load('<root>' + $root.html() + '</root>').root().find('root');
  $clone.find('br').replaceWith(' ');
  const BLOCKS = 'p, div, h1, h2, h3, h4, h5, h6, li, tr, td, th, blockquote';
  $clone.find(BLOCKS).each((_, el) => {
    cheerio.load('<x> </x>')('x').prependTo(el);
    cheerio.load('<x> </x>')('x').appendTo(el);
  });
  return normalizeText($clone.text());
}

function extractInlineSessions(text) {
  const anchors = [];
  let m;
  DAY_HEADER_RE.lastIndex = 0;
  while ((m = DAY_HEADER_RE.exec(text)) !== null) {
    anchors.push({ pos: m.index, end: m.index + m[0].length, date: isoDate(m[4], m[3], m[2]) });
  }
  if (!anchors.length) return [];

  const sessions = [];
  for (let i = 0; i < anchors.length; i++) {
    const from = anchors[i].end;
    const to = i + 1 < anchors.length ? anchors[i + 1].pos : text.length;
    const slice = text.slice(from, to);

    // Сначала собираем ВСЕ слоты в slice — нужно знать позицию следующего,
    // чтобы понять, где обрывается описание текущего.
    const slots = [];
    SLOT_RE.lastIndex = 0;
    let sm;
    while ((sm = SLOT_RE.exec(slice)) !== null) {
      slots.push({
        start: parseTime(`${sm[1]}.${sm[2]}`),
        end:   parseTime(`${sm[3]}.${sm[4]}`),
        matchStart: sm.index,
        matchEnd: sm.index + sm[0].length,
      });
    }

    for (let j = 0; j < slots.length; j++) {
      const s = slots[j];
      if (!s.start || !s.end) continue;
      const descFrom = s.matchEnd;
      const descTo = j + 1 < slots.length ? slots[j + 1].matchStart : slice.length;
      const activity = cleanActivity(slice.slice(descFrom, descTo)) || '';
      sessions.push({
        date: anchors[i].date,
        start: s.start,
        end: s.end,
        activity,
      });
    }
  }

  const seen = new Set();
  return sessions.filter(s => {
    const k = `${s.date}|${s.start}|${s.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parse(html, _ctx) {
  const $ = cheerio.load(html);
  const $root = extractContentRoot($);
  const text = flatTextWithSpaces($, $root);
  const notice = closure.detect($, $root, text);
  const sessions = extractInlineSessions(text);

  if (sessions.length > 0) {
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

  if (notice) {
    return { ok: false, reason: 'closed', notice: notice.notice, range: notice.range || null };
  }
  return { ok: false, reason: 'no_table' };
}

module.exports = { parse };
