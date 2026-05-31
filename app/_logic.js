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

function classifyBreak(minutes, facilityId) {
  if (facilityId === 'ice_arena' && minutes >= 20 && minutes <= 90) return 'заливка льда';
  if (minutes >= 120) return 'перерыв';
  if (minutes >= 45) return 'пауза';
  return 'перерыв';
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
// Сравнивает два снапшота /api/schedule по парам (facilityId, date)
// и возвращает массив событий { kind: 'add'|'rem'|'mod', ... }.
function indexSessionsByFacDate(payload) {
  const map = new Map();
  for (const fac of payload?.facilities || []) {
    for (const s of fac.sessions || []) {
      const key = `${fac.id}::${s.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
  }
  return map;
}

function computeScheduleDiff(prev, next) {
  const before = indexSessionsByFacDate(prev);
  const after  = indexSessionsByFacDate(next);
  const keys = new Set([...before.keys(), ...after.keys()]);
  const events = [];
  let eid = 1;
  for (const key of keys) {
    const [facilityId, date] = key.split('::');
    const a = before.get(key) || [];
    const b = after.get(key) || [];
    // Сопоставление: ключ по (start,end) — тогда изменение activity = 'mod';
    // отсутствие пары — 'add'/'rem'.
    const aByTime = new Map(a.map(s => [`${s.start}|${s.end}`, s]));
    const bByTime = new Map(b.map(s => [`${s.start}|${s.end}`, s]));
    for (const [k, sB] of bByTime) {
      const sA = aByTime.get(k);
      if (!sA) {
        events.push({ id: `e${eid++}`, kind: 'add', facilityId, date, start: sB.start, end: sB.end, activity: sB.activity });
      } else if ((sA.activity || '') !== (sB.activity || '')) {
        events.push({ id: `e${eid++}`, kind: 'mod', facilityId, date, start: sB.start, end: sB.end, activity: sB.activity, wasActivity: sA.activity });
      }
      aByTime.delete(k);
    }
    for (const [, sA] of aByTime) {
      events.push({ id: `e${eid++}`, kind: 'rem', facilityId, date, start: sA.start, end: sA.end, activity: sA.activity });
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

module.exports = {
  toMinutes,
  minutesToHHMM,
  formatDuration,
  classifyBreak,
  buildLanes,
  inferSessionIndicator,
  buildTimelineForDate,
  indexSessionsByFacDate,
  computeScheduleDiff,
  eventOverlapsShift,
  annotateAffectedShifts,
};
