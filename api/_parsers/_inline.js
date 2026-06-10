// Общий движок inline-расписаний: «<День недели> ДД.ММ.ГГГГ» как якорь дня,
// между якорями — слоты «HH.MM – HH.MM». Эту форму используют большой и
// малый бассейны и ледовая арена: после ремонтов сайт публикует расписание
// списком с конкретными датами вместо таблицы «дни × слоты».
//
// Отличия по объектам задаются параметрами extractInlineSessions:
//   slotRe      — своя регулярка слота (sportsPool добавляет «(описание дорожек)»);
//   activityFor — как получить activity: из групп матча (sportsPool), из текста
//                 между слотами (smallPool) или константой (iceArena).
//
// Сетка всегда обрезается по первому «голому» слову-дню БЕЗ даты после него
// (scheduleSliceEnd): внутри сетки день встречается только в шапке
// «<день> ДД.ММ.ГГГГ», а голое слово-день — признак сторонней секции после
// расписания («Обучение плаванию … Вторник, Четверг …» днями-словами).
// Без обрезки слоты такой секции протекали в последний день сетки —
// реальный баг большого бассейна, теперь защита общая для всех объектов.

const cheerio = require('cheerio');
const { normalizeText, parseTime, validateSessions } = require('../_lib/timeParse');

const DAY_WORDS = '(?:понедельник|вторник|сред[ауы]|четверг|пятниц[аы]|суббот[аы]|воскресень[еяю])';

// День и дата могут быть слиты («Пятница05.06.2026») — поэтому \s*.
const DAY_HEADER_RE = new RegExp(`${DAY_WORDS}\\s*(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})`, 'giu');

// То же слово-день, но дата после него опциональна: m[1] есть → шапка сетки,
// нет → «голый» день, конец сетки.
const BARE_DAY_RE = new RegExp(`${DAY_WORDS}(\\s*\\d{1,2}\\.\\d{1,2}\\.\\d{4})?`, 'giu');

// Слот по умолчанию: «HH.MM – HH.MM». Разделитель часов и минут — [.:]:
// исторически на страницах ПолесГУ точка, но если вёрстку поправят на
// «09:15-10:00», парсер не должен молча отдать 0 сессий.
const SLOT_RE = /(\d{1,2})[.:](\d{2})\s*[-–—]\s*(\d{1,2})[.:](\d{2})/g;

function isoDate(y, m, d) {
  return `${y}-${String(+m).padStart(2, '0')}-${String(+d).padStart(2, '0')}`;
}

// Плоский текст root'а с пробелами между блочными элементами: cheerio.text()
// склеивает соседние блоки без пробела — «года» + «плавательный» →
// «годаплавательный». Клонируем, чтобы не портить дерево вызывающему.
function flatTextWithSpaces($, $root) {
  const $doc = cheerio.load('<root>' + ($root.html() || '') + '</root>');
  const $clone = $doc('root');
  $clone.find('br').replaceWith(' ');
  const BLOCKS = 'p, div, h1, h2, h3, h4, h5, h6, li, tr, td, th, blockquote';
  $clone.find(BLOCKS).each((_, el) => {
    const $el = $doc(el);
    $el.prepend(' ');
    $el.append(' ');
  });
  return normalizeText($clone.text());
}

// Конец «дневной сетки» начиная с fromPos: первое голое слово-день без даты.
// Если такого нет — конец текста. Нужен, потому что у ПОСЛЕДНЕГО дня нет
// следующего якоря-даты, и его срез иначе тянулся бы до конца текста.
function scheduleSliceEnd(text, fromPos) {
  BARE_DAY_RE.lastIndex = fromPos;
  let m;
  while ((m = BARE_DAY_RE.exec(text)) !== null) {
    // m[1] есть → это шапка «<день> ДД.ММ.ГГГГ», часть сетки, проматываем.
    if (!m[1]) return m.index;
  }
  return text.length;
}

// text → [{date, start, end, activity}] с дедупом по (date,start,end) и
// валидацией (start < end, окно дат вокруг todayIso).
//
// activityFor(slot, slice) получает slot = { m, index, endIndex, nextIndex }:
//   m         — RegExp-матч слота (для групп вроде «(описание)»),
//   endIndex  — позиция сразу после слота в slice,
//   nextIndex — начало следующего слота (или конец slice) — граница
//               «описания после времени» для smallPool-режима.
function extractInlineSessions(text, { slotRe = SLOT_RE, activityFor = () => '', todayIso = null } = {}) {
  const anchors = [];
  let m;
  DAY_HEADER_RE.lastIndex = 0;
  while ((m = DAY_HEADER_RE.exec(text)) !== null) {
    anchors.push({ pos: m.index, end: m.index + m[0].length, date: isoDate(m[3], m[2], m[1]) });
  }
  if (!anchors.length) return [];

  const sessions = [];
  for (let i = 0; i < anchors.length; i++) {
    // Срез от КОНЦА шапки дня, чтобы дата «26.05.2026» не попала под slotRe;
    // граница — следующий якорь-дата ИЛИ конец сетки, что наступит раньше.
    const from = anchors[i].end;
    const nextAnchor = i + 1 < anchors.length ? anchors[i + 1].pos : text.length;
    const to = Math.min(nextAnchor, scheduleSliceEnd(text, from));
    const slice = text.slice(from, to);

    // Сначала собираем все слоты среза: smallPool-режиму нужна позиция
    // следующего слота, чтобы знать, где обрывается описание текущего.
    const slots = [];
    slotRe.lastIndex = 0;
    let sm;
    while ((sm = slotRe.exec(slice)) !== null) {
      slots.push({ m: sm, index: sm.index, endIndex: sm.index + sm[0].length });
    }
    for (let j = 0; j < slots.length; j++) {
      const slot = slots[j];
      slot.nextIndex = j + 1 < slots.length ? slots[j + 1].index : slice.length;
      const start = parseTime(`${slot.m[1]}.${slot.m[2]}`);
      const end   = parseTime(`${slot.m[3]}.${slot.m[4]}`);
      if (!start || !end) continue;
      sessions.push({
        date: anchors[i].date,
        start,
        end,
        activity: activityFor(slot, slice) || '',
      });
    }
  }

  // Дедуп (date,start,end) — на случай дублирующих фрагментов вёрстки.
  const seen = new Set();
  const unique = sessions.filter(s => {
    const k = `${s.date}|${s.start}|${s.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return validateSessions(unique, todayIso);
}

// «Богатый» inline-результат: ≥2 разных дней или ≥3 слотов. Порог защищает
// от фантомов: если страница вернётся к табличной вёрстке, а в новостном
// абзаце останется «Понедельник 01.09.2026 … 09.00-10.00», inline не должен
// победить настоящую таблицу одной ложной сессией.
function isRichInline(sessions) {
  if (!sessions.length) return false;
  const days = new Set(sessions.map(s => s.date));
  return days.size >= 2 || sessions.length >= 3;
}

// Упаковка успешного результата: closure-notice (если был) уходит в
// closureRanges, чтобы фронт пометил даты внутри окна как «закрыто».
function okWithClosure(sessions, notice) {
  const closureRanges = [];
  if (notice && notice.range) {
    closureRanges.push({ from: notice.range.from, to: notice.range.to, notice: notice.notice });
  }
  return { ok: true, sessions, closureRanges };
}

module.exports = { extractInlineSessions, flatTextWithSpaces, isRichInline, okWithClosure, SLOT_RE };
