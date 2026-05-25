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
//
// Стратегия:
//   • Сначала пробуем inline-парсер (закрытие будет частичным closureRange,
//     а сессии берём только из тех дней, что прямо перечислены).
//   • Если inline пуст — пробуем таблицу через genericParse.
//   • Если таблица тоже пуста, а closure-notice есть — возвращаем
//     полное закрытие, как раньше.

const cheerio = require('cheerio');
const { genericParse, extractContentRoot } = require('./_common');
const closure = require('./closureNotice');
const { normalizeText, parseTime } = require('../_lib/timeParse');

// «Вторник 26.05.2026» / «Воскресенье 31.05.2026» — все 7 дней недели.
// Сам день недели не несёт информации (дата уже задана), мы его просто
// проматываем при поиске следующего якоря.
const DAY_HEADER_RE = /(понедельник|вторник|сред[ауы]|четверг|пятниц[аы]|суббот[аы]|воскресень[еяю])\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/giu;

// «HH.MM – HH.MM» с опциональным «(описание дорожек)». Описание матчится
// только при наличии ОБЕИХ скобок. Без `)` (на странице встречаются такие
// «огрызки» вида «09.15 – 10.00 (свободно 3 дорожки, без 1 крайней») слот
// учитывается, но без description — иначе жадный [^)] пожрал бы текст
// следующего слота до его закрывающей скобки. `[^()]` явно исключает
// вложенные скобки.
//
// Разделитель часов и минут — [.:]: исторически на этой странице ставят
// точку, но если вёрстку поправят на «09:15-10:00» (стандарт остальных
// страниц ПолесГУ), парсер не должен молча отдавать 0 сессий.
const SLOT_RE = /(\d{1,2})[.:](\d{2})\s*[-–—]\s*(\d{1,2})[.:](\d{2})(?:\s*\(([^()]+)\))?/g;

function isoDate(y, m, d) {
  return `${y}-${String(+m).padStart(2, '0')}-${String(+d).padStart(2, '0')}`;
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

// Извлекает inline-сессии из плоского нормализованного текста.
// Логика: идём слева направо, переключаем «активную дату» по DAY_HEADER_RE,
// между двумя соседними якорями собираем все слоты SLOT_RE.
function extractInlineSessions(text) {
  const sessions = [];
  // Сначала собираем якоря-дни — позиции и распарсенные даты.
  const anchors = [];
  let m;
  DAY_HEADER_RE.lastIndex = 0;
  while ((m = DAY_HEADER_RE.exec(text)) !== null) {
    anchors.push({ pos: m.index, date: isoDate(m[4], m[3], m[2]) });
  }
  if (!anchors.length) return [];
  // К каждому якорю — кусок текста до следующего, в нём ищем слоты.
  for (let i = 0; i < anchors.length; i++) {
    const from = anchors[i].pos;
    const to = i + 1 < anchors.length ? anchors[i + 1].pos : text.length;
    const slice = text.slice(from, to);
    SLOT_RE.lastIndex = 0;
    let sm;
    while ((sm = SLOT_RE.exec(slice)) !== null) {
      const start = parseTime(`${sm[1]}.${sm[2]}`);
      const end   = parseTime(`${sm[3]}.${sm[4]}`);
      if (!start || !end) continue;
      sessions.push({
        date: anchors[i].date,
        start,
        end,
        activity: activityFromDescription(sm[5]),
      });
    }
  }
  // Уникализуем (date,start,end) — на случай дублирующих текстовых фрагментов.
  const seen = new Set();
  return sessions.filter(s => {
    const k = `${s.date}|${s.start}|${s.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Превращает root-элемент в плоский текст, но с разделителями между
// блочными элементами (по умолчанию cheerio.text() склеивает соседние
// блоки без пробела — получается «года‚плавательный» вместо «года плавательный»).
function flatTextWithSpaces($, $root) {
  // Клонируем — иначе портим дерево вызывающему.
  const $clone = cheerio.load('<root>' + $root.html() + '</root>').root().find('root');
  $clone.find('br').replaceWith(' ');
  // Между любыми <p>, <div>, <h1..6>, <li>, <tr>, <td>, <th> вставляем пробел перед закрывающим тегом
  // через .text(), просто пройдёмся .each и накопим текст.
  // Проще: для каждого блочного элемента подменим контент на «<пробел>content<пробел>».
  // Но это рекурсивно сложно. Используем простой трюк: добавим пробел в начале каждого
  // блочного элемента через прокладку.
  const BLOCKS = 'p, div, h1, h2, h3, h4, h5, h6, li, tr, td, th, blockquote';
  $clone.find(BLOCKS).each((_, el) => {
    cheerio.load('<x> </x>')('x').prependTo(el);
    cheerio.load('<x> </x>')('x').appendTo(el);
  });
  return normalizeText($clone.text());
}

function parse(html, ctx) {
  const $ = cheerio.load(html);
  const $root = extractContentRoot($);

  const text = flatTextWithSpaces($, $root);
  // closure.detect получает уже очищенный текст — иначе notice выходит
  // склеенный без пробелов между блочными элементами.
  const notice = closure.detect($, $root, text);
  const sessions = extractInlineSessions(text);

  if (sessions.length > 0) {
    // Расписание есть — отдаём его. closure (если был) приходит как
    // closureRanges, чтобы фронт мог пометить «закрыт» для дат в окне.
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

  // Inline пусто — пробуем таблицу.
  const generic = genericParse(html, ctx);
  if (generic.ok && generic.sessions.length > 0) return generic;

  // И таблицы нет, но closure-notice был — возвращаем полное закрытие.
  if (notice) {
    return { ok: false, reason: 'closed', notice: notice.notice, range: notice.range || null };
  }
  return generic; // { ok:false, reason:'no_table' } или подобное
}

module.exports = { parse };
