// ──────────────────────────────────────────────────────────────────
// app/_logic.js — чистые функции расписания (без localStorage/Date/TZ).
//
// Вынесены из data.jsx, чтобы покрыть тестами самую багоопасную логику
// (diff снапшотов, раскладка дорожек, пересечение событий со сменами).
// Комментарии в data.jsx ссылались на «баг #1/#3/#4 из аудита» именно
// здесь — теперь это тестируется через `node --test`.
//
// CommonJS: подключается и в браузерный бандл (esbuild `require` из
// data.jsx), и в Node-тесты (`require('./_logic.js')`).
// ──────────────────────────────────────────────────────────────────

function toMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// 750 → "12:30"
function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} ч ${String(m).padStart(2, '0')} м`;
  if (h) return `${h} ч`;
  return `${m} м`;
}

// Подпись зазора между сеансами. Монотонно по длительности:
// короткий зазор — «пауза», от двух часов — «перерыв» (раньше <45 минут
// тоже звалось «перерывом», и подписи скакали: перерыв → пауза → перерыв).
function classifyBreak(minutes, facilityId) {
  if (facilityId === 'ice_arena' && minutes >= 20 && minutes <= 90) return 'заливка льда';
  if (minutes >= 120) return 'перерыв';
  return 'пауза';
}

// Раскладка позиций дорожек большого бассейна.
// Нумерация: lane 0 — правый край (физически дорожка №1 в бассейне),
//            lane total-1 — левый край.
// UI рисует bars в reverse-order (n=total-1..0), визуально слева
// направо: lane 9, 8, ..., 1, 0.
//
// Логика заполнения с учётом «крайних»:
//   1) Если edgeOcc≥1 — занят lane 0 (правый край).
//   2) Если edgeOcc≥2 — также занят lane total-1 (левый край).
//   3) Оставшиеся занятые тянутся ОТ ЛЕВОГО края к центру
//      (lane total-1, total-2, …), пропуская уже занятый край.
//   4) Свободные остаются справа (малые номера).
//
// Так «6 свободно, без 2 крайних» даёт occupied={0, 7, 8, 9}.
function buildLanes(total, free, edgeOcc) {
  const occupied = new Set();
  if (edgeOcc >= 1) occupied.add(0);
  if (edgeOcc >= 2) occupied.add(total - 1);
  const remainingOcc = Math.max(0, (total - free) - occupied.size);
  let n = total - 1, placed = 0;
  while (placed < remainingOcc && n >= 0) {
    if (!occupied.has(n)) { occupied.add(n); placed++; }
    n--;
  }
  return Array.from(occupied).sort((a, b) => a - b);
}

// ── Эвристика для end-indicator у сессии ────────────────────────
// Парсер отдаёт только activity-строку; макет хочет «дорожки / группа /
// зона / бескрайний». Цифры (3/10, 4 группы) парсером НЕ извлекаются —
// если activity их содержит, достаём; иначе рендерим индикатор без числа.
//
// Возвращает: { type: 'lanes'|'lanes-free'|'group'|'zone'|null, ... }
//   lanes      → { type:'lanes', occupied:int[], free:int, total:int } — большой бассейн
//   lanes-free → { type:'lanes-free' }                         — «бескрайний»
//   group      → { type:'group', label }                       — лёд/малый
//   zone       → { type:'zone', label, icon }                  — гребная база
//   null       → нет индикатора (fallback: пустая ячейка)
function inferSessionIndicator(facilityId, activity) {
  const a = String(activity || '').toLowerCase();
  if (!a.trim() && !facilityId) return null;

  // «бескрайний» / «без разделения» / «свободная вода» — приоритет, потому
  // что «дорожки» ниже подхватили бы общий случай.
  // ВАЖНО: \w в JS-regex не матчит кириллицу, поэтому «свободн\w*\s+вод»
  // НИКОГДА не срабатывал на «свободная вода» (после «свободн» идёт «ая», а
  // не \w/\s) — индикатор lanes-free не появлялся вопреки README. \S*
  // покрывает кириллический суффикс. «Свободное плавание» по-прежнему мимо
  // (нет «вод» после пробела) — у него свой дефолт 10/10.
  if (/бескрайн|без\s+раздел|свободн\S*\s+вод/.test(a)) {
    return { type: 'lanes-free' };
  }

  // Большой бассейн: визуальные дорожки. Модель — какие дорожки СВОБОДНЫ
  // (доступны посетителю) vs ЗАНЯТЫ (тренировкой/группой/закрыты).
  //
  // Морфология: корень /дорож/ (не /дорожк/) — иначе «дорожек» (после 5+
  // с вставочным «е») не матчит.
  if (facilityId === 'sports_pool' || /дорож/.test(a)) {
    const baseTotal = 10;
    // У большого бассейна total дорожек ФИКСИРОВАН — всегда 10.
    const isPool = facilityId === 'sports_pool';

    // Парсим маркер крайних: «(без|кроме) [N] крайн…».
    // ВАЖНО: \w в JS-regex не матчит кириллицу — поэтому захват формы
    // через (\w*) не работает. Вместо этого проверяем плюрализм
    // отдельным regex на исходной строке.
    let edgeOcc = 0;
    const edgeMatch = a.match(/(?:без|кроме)\s+(?:(\d+)\s+)?крайн/);
    if (edgeMatch) {
      if (edgeMatch[1]) {
        edgeOcc = Number(edgeMatch[1]);
      } else {
        // Без явного числа: множественное → 2, единственное → 1.
        // Плюрал: «крайних», «крайние», «крайними», «крайним».
        // Сингуляр: «крайней», «крайнюю», «крайняя».
        const isPlural = /крайн(?:их|ие|ими|им)/.test(a);
        edgeOcc = isPlural ? 2 : 1;
      }
      edgeOcc = Math.min(edgeOcc, 2);
    }

    // Парсим количество свободных: «N дорожек/дорожки/дорожка»
    let freeCount = null;
    const mCount = a.match(/(\d+)\s*дорож/);
    if (mCount) freeCount = Number(mCount[1]);

    // Парсим явную фракцию «N/M» — переопределяет всё
    const mFraction = a.match(/(\d+)\s*(?:\/|из)\s*(\d+)/);
    if (mFraction) {
      const free = Number(mFraction[1]);
      const tot = Number(mFraction[2]);
      if (free > 0 && tot > 0 && free <= tot) {
        const total = isPool ? baseTotal : tot;
        const cappedFree = Math.min(free, total);
        return { type: 'lanes', occupied: buildLanes(total, cappedFree, 0), free: cappedFree, total };
      }
    }

    if (edgeOcc > 0 && freeCount && freeCount > 0) {
      const total = isPool ? baseTotal : (freeCount + edgeOcc);
      const cappedFree = Math.min(freeCount, total - edgeOcc);
      return { type: 'lanes', occupied: buildLanes(total, cappedFree, edgeOcc), free: cappedFree, total };
    }
    if (edgeOcc > 0) {
      const total = baseTotal;
      const cappedFree = Math.max(0, total - edgeOcc);
      return { type: 'lanes', occupied: buildLanes(total, cappedFree, edgeOcc), free: cappedFree, total };
    }
    if (freeCount && freeCount > 0) {
      const total = isPool ? baseTotal : Math.max(freeCount, baseTotal);
      const cappedFree = Math.min(freeCount, total);
      return { type: 'lanes', occupied: buildLanes(total, cappedFree, 0), free: cappedFree, total };
    }

    // Просто «дорож» без числа — весь бассейн свободен
    if (/дорож/.test(a)) {
      return { type: 'lanes', occupied: [], free: baseTotal, total: baseTotal };
    }
    // Для большого бассейна: если на сайте нет НИКАКОГО ограничения —
    // считаем, что весь бассейн свободен посетителю.
    if (isPool) {
      return { type: 'lanes', occupied: [], free: baseTotal, total: baseTotal };
    }
  }

  // Гребная база: тренажёрный / штанга / силовая.
  if (facilityId === 'rowing_base' || /тренажёр|тренажер|штанг|силов/.test(a)) {
    if (/штанг|силов/.test(a)) return { type: 'zone', label: 'штанга', icon: 'exercise' };
    if (/тренажёр|тренажер/.test(a)) return { type: 'zone', label: 'тренажёрный', icon: 'fitness_center' };
    if (facilityId === 'rowing_base') return { type: 'zone', label: 'зал', icon: 'fitness_center' };
  }

  // Лёд / малый бассейн: массовое / группы / дети / индивидуальное.
  if (/индивидуальн/.test(a)) {
    return { type: 'group', label: 'индивидуально', icon: 'person' };
  }
  if (/дет(и|ск)/.test(a)) {
    return { type: 'group', label: 'дети', icon: 'child_care' };
  }
  if (/массов|катан/.test(a)) {
    return { type: 'group', label: 'массовое', icon: 'groups' };
  }
  if (/групп/.test(a) || facilityId === 'ice_arena' || facilityId === 'small_pool') {
    return { type: 'group', label: 'группа', icon: 'groups' };
  }

  return null;
}

// Слияние пересекающихся/смежных интервалов [startMin, endMin].
// Нужно, когда у пользователя несколько смен на один объект в день:
// без слияния пересекающиеся смены считают одни и те же сайтовые
// сеансы дважды (наблюдалось: 2:15 реальных превращались в 4:30).
function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// «Фактическое» время работы на объекте за день.
// shiftIntervals — окна смен пользователя (минуты), sessionIntervals —
// сайтовые сеансы. Семантика повторяет computeEffectiveShift, но на
// уровне объекта (без двойного счёта пересекающихся смен):
//   • объединённое окно, в которое попал хоть один сеанс →
//     confirmedMin += сумма пересечений (остаток окна не считается);
//   • окно совсем без сеансов → unconfirmedMin += его длина
//     («по графику», сайт не подтвердил).
function facilityDayUsage(shiftIntervals, sessionIntervals) {
  let confirmedMin = 0, unconfirmedMin = 0;
  for (const [a, b] of mergeIntervals(shiftIntervals)) {
    let ov = 0;
    for (const [s, e] of sessionIntervals) {
      const u = Math.max(a, s), v = Math.min(b, e);
      if (v > u) ov += v - u;
    }
    if (ov > 0) confirmedMin += ov;
    else unconfirmedMin += b - a;
  }
  return { confirmedMin, unconfirmedMin };
}

function buildTimelineForDate(shifts, date) {
  const list = shifts
    .filter(s => s.date === date)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const rows = [];
  let prev = null;
  for (const s of list) {
    if (prev) {
      const gap = toMinutes(s.start) - toMinutes(prev.end);
      if (gap > 0) {
        const crossFacility = prev.facilityId !== s.facilityId;
        const label = crossFacility ? 'переход между объектами' : classifyBreak(gap, prev.facilityId);
        rows.push({ kind: 'break', minutes: gap, label, crossFacility, from: prev.end, to: s.start, prevFacility: prev.facilityId, nextFacility: s.facilityId });
      }
    }
    rows.push({ kind: 'shift', shift: s });
    prev = s;
  }
  return rows;
}

// ── Schedule diff ───────────────────────────────────────────────
// Сравнивает два снапшота /api/schedule и возвращает массив событий
// { kind: 'add'|'rem'|'mod', ... }. Два режима сопоставления:
//   • обычные объекты — по парам (facilityId, date): на странице конкретные
//     числа, исчезнувшая/появившаяся дата = реальное изменение;
//   • weeklyPattern-объекты (гребная база и табличный фолбэк) — по парам
//     (facilityId, день недели): даты там синтезированы из «Пн-Пт», окно
//     сдвигается каждый день само, и диф по датам выдавал бы фантомные
//     add/rem без единого изменения на сайте.
// Объект пропускается целиком, если хотя бы с одной стороны он не ok
// (dataQuality template/parse_error/closed или stale-подмена): иначе
// поломка или закрытие источника = phantom-rem на все его сессии, а
// восстановление = phantom-add. Сами переходы здоровья/закрытия — не
// события расписания, их сообщает notify отдельной строкой. Новый объект
// (в prev отсутствует) диффуется: его первые сессии — честные add.

function isoWeekday(iso) {
  return new Date(iso + 'T12:00:00Z').getUTCDay();
}

// Ближайшая дата ≥ todayIso с данным днём недели — дата для rem-события
// weeklyPattern-объекта, когда в next этого дня недели больше нет.
function upcomingDateForWeekday(todayIso, wd) {
  const base = new Date(todayIso + 'T12:00:00Z');
  base.setUTCDate(base.getUTCDate() + (wd - base.getUTCDay() + 7) % 7);
  return base.toISOString().slice(0, 10);
}

function computeScheduleDiff(prev, next) {
  const facsById = (p) => new Map((p?.facilities || []).map(f => [f.id, f]));
  const prevFacs = facsById(prev);
  const nextFacs = facsById(next);
  const notOk = (f) => Boolean(f && ((f.dataQuality && f.dataQuality !== 'ok') || f.stale));
  const todayIso = next?.meta?.todayIso || new Date().toISOString().slice(0, 10);

  const events = [];
  let eid = 1;
  for (const id of new Set([...prevFacs.keys(), ...nextFacs.keys()])) {
    const pf = prevFacs.get(id);
    const nf = nextFacs.get(id);
    if (!nf || notOk(nf) || notOk(pf)) continue;
    const weekly = Boolean(nf.weeklyPattern || (pf && pf.weeklyPattern));

    // Группа сравнения: дата или день недели; внутри группы — ключ по
    // (start,end), тогда изменение activity = 'mod', нет пары — 'add'/'rem'.
    const index = (fac) => {
      const groups = new Map();
      for (const s of fac?.sessions || []) {
        const g = weekly ? String(isoWeekday(s.date)) : s.date;
        if (!groups.has(g)) groups.set(g, new Map());
        const byTime = groups.get(g);
        const k = `${s.start}|${s.end}`;
        // В weekly-режиме один слот может встретиться на двух неделях —
        // оставляем ближайшую дату, чтобы событие указывало на скорую.
        const cur = byTime.get(k);
        if (!cur || s.date < cur.date) byTime.set(k, s);
      }
      return groups;
    };
    const before = index(pf);
    const after = index(nf);

    for (const g of new Set([...before.keys(), ...after.keys()])) {
      const aByTime = new Map(before.get(g) || []);
      const bByTime = after.get(g) || new Map();
      // Дата rem-события в weekly-режиме: дата из prev могла уже пройти —
      // берём дату оставшихся сессий этого дня недели, а если день исчез
      // целиком (выходной/отмена) — ближайшее его вхождение.
      const remDate = weekly
        ? (bByTime.size ? bByTime.values().next().value.date : upcomingDateForWeekday(todayIso, Number(g)))
        : g;
      for (const [k, sB] of bByTime) {
        const sA = aByTime.get(k);
        if (!sA) {
          events.push({ id: `e${eid++}`, kind: 'add', facilityId: id, date: sB.date, start: sB.start, end: sB.end, activity: sB.activity });
        } else if ((sA.activity || '') !== (sB.activity || '')) {
          events.push({ id: `e${eid++}`, kind: 'mod', facilityId: id, date: sB.date, start: sB.start, end: sB.end, activity: sB.activity, wasActivity: sA.activity });
        }
        aByTime.delete(k);
      }
      for (const [, sA] of aByTime) {
        events.push({ id: `e${eid++}`, kind: 'rem', facilityId: id, date: remDate, start: sA.start, end: sA.end, activity: sA.activity });
      }
    }
  }
  // Стабильная сортировка: по дате, потом по времени старта
  events.sort((x, y) => x.date.localeCompare(y.date) || x.start.localeCompare(y.start));
  return events;
}

// Пересечение события сайта с конкретной сменой пользователя.
function eventOverlapsShift(ev, shift) {
  return shift.facilityId === ev.facilityId
    && shift.date === ev.date
    && toMinutes(shift.start) < toMinutes(ev.end)
    && toMinutes(shift.end)   > toMinutes(ev.start);
}

// Помечает события, пересекающиеся с пользовательскими сменами.
function annotateAffectedShifts(events, shifts) {
  for (const ev of events) {
    const overlap = shifts.find(s => eventOverlapsShift(ev, s));
    if (overlap) {
      ev.affectsShiftId = overlap.id;
      if (ev.kind === 'mod' && overlap.start !== ev.start) {
        ev.wasStart = overlap.start;
        ev.wasEnd   = overlap.end;
      }
    }
  }
}


// ── Экспорт в iCalendar (.ics) ──────────────────────────────────
// Минск — UTC+3 без сезонных переходов (с 2011 года), поэтому время
// безопасно конвертируется в UTC простой арифметикой, без VTIMEZONE.
const MINSK_UTC_OFFSET_MIN = 180;

function icsEscape(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function icsUtcStamp(dateIso, hhmm) {
  const [y, mo, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, 0, toMinutes(hhmm) - MINSK_UTC_OFFSET_MIN));
  const p2 = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${p2(dt.getUTCMonth() + 1)}${p2(dt.getUTCDate())}` +
         `T${p2(dt.getUTCHours())}${p2(dt.getUTCMinutes())}00Z`;
}

// Чистая генерация .ics: смены пользователя → VEVENT'ы. Зависимости
// (каталоги объектов/инструкторов) передаются параметрами, чтобы
// функция тестировалась в node без window/localStorage.
function buildICS(shifts, facilities, instructors = []) {
  const facById = new Map((facilities || []).map(f => [f.id, f]));
  const instById = new Map((instructors || []).map(i => [i.id, i]));
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const dtstamp = `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}` +
                  `T${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}${p2(now.getUTCSeconds())}Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//raspisanie-polessu//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Расписание ПолесГУ',
  ];
  for (const s of shifts || []) {
    if (!s || !s.date || !s.start || !s.end) continue;
    const fac = facById.get(s.facilityId);
    const withWho = (s.instructors || [])
      .map(id => (instById.get(id) || {}).name)
      .filter(Boolean).join(', ');
    const descr = [s.activity, withWho && ('с ' + withWho)].filter(Boolean).join(' · ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsEscape(s.id)}@raspisanie-polessu`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${icsUtcStamp(s.date, s.start)}`,
      `DTEND:${icsUtcStamp(s.date, s.end)}`,
      `SUMMARY:${icsEscape('Смена · ' + ((fac && fac.name) || s.facilityId))}`
    );
    if (descr) lines.push(`DESCRIPTION:${icsEscape(descr)}`);
    if (fac && fac.name) lines.push(`LOCATION:${icsEscape(fac.name)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

module.exports = {
  toMinutes,
  minutesToHHMM,
  formatDuration,
  classifyBreak,
  buildLanes,
  inferSessionIndicator,
  mergeIntervals,
  facilityDayUsage,
  buildTimelineForDate,
  computeScheduleDiff,
  eventOverlapsShift,
  annotateAffectedShifts,
  buildICS,
};
