// ──────────────────────────────────────────────────────────────────
// app/data.jsx — client-side schedule store + parser adapter
//
// Tries /api/schedule first; if not reachable (e.g. opened as a
// static file), falls back to MOCK_SCHEDULE. All user data
// (shifts, site-changes history, settings) lives in localStorage.
// ──────────────────────────────────────────────────────────────────

const STORAGE = {
  shifts: 'rpgu_shifts_v1',
  settings: 'rpgu_settings_v1',
  siteChanges: 'rpgu_site_changes_v1',
  cache: 'rpgu_cache_v1',
};

const TZ = 'Europe/Minsk';

// Дата в зоне Минска как YYYY-MM-DD. Локаль en-CA фиксирует ISO-формат
// независимо от системной локали браузера.
const _ISO_DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
function isoInMinsk(date) { return _ISO_DAY_FMT.format(date); }

// Текущая дата в зоне Минска — НЕ замораживается на старт сессии. Геттер
// вычисляется каждый раз, чтобы долго работающий PWA после полуночи не
// показывал «вчера» как «сегодня».
function todayIso() { return isoInMinsk(new Date()); }

// «Сейчас» в минутах от полуночи в зоне Минска. Раньше home.jsx брал
// new Date().getHours()*60 + getMinutes(), но это локальное время браузера —
// для пользователя в другой TZ подсветка «сейчас» и «прошедшие сессии»
// рассинхронизировались с минскими датами (today тут — минский).
const _MINSK_HM_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function nowMinutesInMinsk() {
  const [h, m] = _MINSK_HM_FMT.format(new Date()).split(':').map(Number);
  return h * 60 + m;
}

// ── Facility catalog (mirrors api/schedule.js) ──────────────────
const FACILITIES = [
  { id: 'ice_arena',   name: 'Ледовая арена',   icon: 'ac_unit',
    hint: 'массовое · хоккей',
    sourceUrl: 'https://www.polessu.by/%D0%BB%D0%B5%D0%B4%D0%BE%D0%B2%D0%B0%D1%8F-%D0%B0%D1%80%D0%B5%D0%BD%D0%B0-%D0%BF%D0%BE%D0%BB%D0%B5%D1%81%D0%B3%D1%83' },
  { id: 'sports_pool', name: 'Большой бассейн', icon: 'pool',
    hint: '25 м · 5 дорожек',
    sourceUrl: 'https://www.polessu.by/%D0%B1%D0%BE%D0%BB%D1%8C%D1%88%D0%BE%D0%B9-%D0%B1%D0%B0%D1%81%D1%81%D0%B5%D0%B9%D0%BD' },
  { id: 'small_pool',  name: 'Малый бассейн',   icon: 'water_drop',
    hint: 'детский',
    sourceUrl: 'https://www.polessu.by/%D0%BC%D0%B0%D0%BB%D1%8B%D0%B9-%D0%B1%D0%B0%D1%81%D1%81%D0%B5%D0%B9%D0%BD' },
  { id: 'rowing_base', name: 'Гребная база',    icon: 'rowing',
    hint: 'зал · штанга',
    sourceUrl: 'https://www.polessu.by/%D1%80%D0%B0%D1%81%D0%BF%D0%B8%D1%81%D0%B0%D0%BD%D0%B8%D0%B5-%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D1%8B-%D1%82%D1%80%D0%B5%D0%BD%D0%B0%D0%B6%D0%B5%D1%80%D0%BD%D0%BE%D0%B3%D0%BE-%D0%B7%D0%B0%D0%BB%D0%B0-%D0%B8-%D0%B7%D0%B0%D0%BB%D0%B0-%D1%88%D1%82%D0%B0%D0%BD%D0%B3%D0%B8-%D0%B3%D1%80%D0%B5%D0%B1%D0%BD%D0%B0%D1%8F-%D0%B1%D0%B0%D0%B7%D0%B0-%E2%84%961' },
];

const INSTRUCTORS = [
  { id: 'lapchuk_as',   name: 'Липчук А.С.',     initials: 'ЛА' },
  { id: 'krylychuk_ps', name: 'Крыльчук П.С.',   initials: 'КП' },
  { id: 'melnikova_ov', name: 'Мельникова О.В.', initials: 'МО' },
  { id: 'ivshin_my',    name: 'Ившина М.Ю.',     initials: 'ИМ' },
  { id: 'moiseenko_vv', name: 'Моисеенко В.В.',  initials: 'МВ' },
  { id: 'karavaychik_kv', name: 'Каравайчик К.В.', initials: 'КК' },
];

// ── Mock site response (used if /api/schedule fails) ─────────────
const isoOffset = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return isoInMinsk(d);
};

const MOCK_SCHEDULE = {
  schemaVersion: 4,
  generatedAt: new Date().toISOString(),
  sourceCheckedAt: new Date().toISOString(),
  timezone: TZ,
  facilities: FACILITIES.map((f, i) => ({
    id: f.id, name: f.name, sourceUrl: f.sourceUrl,
    dataQuality: f.id === 'rowing_base' ? 'template' : 'ok',
    sourceCheckedAt: new Date(Date.now() - i * 60_000).toISOString(),
    sessions: [],
    closureRanges: [],
  })),
  meta: { cached: false, sourceCount: 4, sourceIssueCount: 0, sourceIssues: [] },
};

// ── Demo shifts for first-run users (used if empty) ──────────────
// Пусто: новый пользователь сразу попадает в EmptyState с онбордингом,
// а не на чужие тестовые смены.
const DEMO_SHIFTS = [];

// Демо-журнал убран: новый пользователь должен видеть пустой журнал
// (или baseline, который запишет recordSiteCheck при первом fetchSchedule),
// а не фейковые события со ссылками на несуществующие смены.
const DEMO_CHANGES = [];

// ── Helpers ─────────────────────────────────────────────────────

// Уведомление подписчиков об изменении хранилища — ASYNC, чтобы не
// прерывать текущий вызывающий код (например handleDelete в editor,
// который сразу после save вызывает router.pop()). Без асинхронности
// listener'ы успевают сработать, дёргают setState в Home, и React
// перерасчёт стэка роутера успевает обнулить условие pop() до того,
// как тот выполнится.
function notifyAsync(eventName) {
  try {
    const fire = () => window.dispatchEvent(new CustomEvent(eventName));
    if (typeof queueMicrotask === 'function') queueMicrotask(fire);
    else Promise.resolve().then(fire);
  } catch {}
}

function classifyBreak(minutes, facilityId) {
  if (facilityId === 'ice_arena' && minutes >= 20 && minutes <= 90) return 'заливка льда';
  if (minutes >= 120) return 'перерыв';
  if (minutes >= 45) return 'пауза';
  return 'перерыв';
}

// ── Эвристика для end-indicator у сессии ────────────────────────
// Парсер отдаёт только activity-строку; макет хочет «дорожки / группа /
// зона / бескрайний». Цифры (3/10, 4 группы) парсером НЕ извлекаются —
// если activity их содержит, достаём; иначе рендерим индикатор без числа.
//
// Возвращает: { type: 'lanes'|'lanes-free'|'group'|'zone'|null, ... }
//   lanes      → { type:'lanes', count?: int, total?: int }   — большой бассейн
//   lanes-free → { type:'lanes-free' }                         — «бескрайний»
//   group      → { type:'group', label }                       — лёд/малый
//   zone       → { type:'zone', label, icon }                  — гребная база
//   null       → нет индикатора (fallback: пустая ячейка)
function inferSessionIndicator(facilityId, activity) {
  const a = String(activity || '').toLowerCase();
  if (!a.trim() && !facilityId) return null;

  // «бескрайний» / «без разделения» — приоритет, потому что «дорожки»
  // ниже подхватили бы общий случай.
  if (/бескрайн|без\s+раздел|свободн\w*\s+вод/.test(a)) {
    return { type: 'lanes-free' };
  }

  // Большой бассейн: визуальные дорожки. Модель — какие дорожки СВОБОДНЫ
  // (доступны посетителю) vs ЗАНЯТЫ (тренировкой/группой/закрыты).
  //
  // Семантика реальных активностей с polessu:
  //   «N дорожек»                   — N свободных, остальные ?
  //   «кроме крайних / без крайних» — 2 края закрыты
  //   «кроме крайней / без крайней» — 1 край закрыт
  //   «без N крайних»               — явное число краёв закрыто
  //   «свободно N дорожек, без M крайних» — комбинация: N свободны в
  //                                  середине, M краёв закрыты, total=N+M
  //
  // Возврат: { type:'lanes', occupied: int[], free: int, total }
  //   occupied — индексы закрытых дорожек (для позиционного рендера)
  //   free     — кол-во свободных
  //   total    — переменный: 8 или 10 в зависимости от данных
  //
  // Морфология: корень /дорож/ (не /дорожк/) — иначе «дорожек» (после 5+
  // с вставочным «е») не матчит.
  if (facilityId === 'sports_pool' || /дорож/.test(a)) {
    const baseTotal = 10;
    // У большого бассейна total дорожек ФИКСИРОВАН — всегда 10. Сайт
    // обычно пишет только «N свободно» и/или «без M крайних»; остаток
    // (если меньше 10) — занят тренировкой. Раньше total собирался как
    // freeCount+edgeOcc и в карточке появлялись «короткие» бассейны на
    // 7-8 дорожек, которых физически не существует.
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
        // ВАЖНО: без \b — в JS regex \b работает по ASCII, конец
        // кириллического слова не считается word-boundary.
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
        const occupied = [];
        for (let i = cappedFree; i < total; i++) occupied.push(i);
        return { type: 'lanes', occupied, free: cappedFree, total };
      }
    }

    // Раскладка позиций: edges по краям, остаток свободных в середине,
    // оставшиеся middle-слоты — заняты тренировкой и упираются к
    // внутренней стороне правого края.
    function buildLanes(total, free, edges) {
      const occupied = [];
      if (edges >= 1) occupied.push(0);
      if (edges >= 2) occupied.push(total - 1);
      const middleSlots = total - edges;
      const middleOcc = Math.max(0, middleSlots - free);
      // Заполняем middle-occupied начиная от внутреннего края правого
      // борта и двигаясь к центру.
      let idx = (edges >= 2) ? total - 2 : total - 1;
      let placed = 0;
      while (placed < middleOcc && idx >= 0) {
        if (!occupied.includes(idx)) { occupied.push(idx); placed++; }
        idx--;
      }
      occupied.sort((a, b) => a - b);
      return occupied;
    }

    // Сборка с учётом и edges и freeCount
    if (edgeOcc > 0 && freeCount && freeCount > 0) {
      // «свободно 6, без 2 крайних» при isPool → total=10, edges=[0,9],
      // 6 свободных в середине, 2 средних слота заняты тренировкой.
      const total = isPool ? baseTotal : (freeCount + edgeOcc);
      const cappedFree = Math.min(freeCount, total - edgeOcc);
      return { type: 'lanes', occupied: buildLanes(total, cappedFree, edgeOcc), free: cappedFree, total };
    }
    if (edgeOcc > 0) {
      // Только края, без указания свободных. Total=10 по умолчанию.
      const total = baseTotal;
      const occupied = edgeOcc >= 2 ? [0, total - 1] : [0];
      return { type: 'lanes', occupied, free: total - edgeOcc, total };
    }
    if (freeCount && freeCount > 0) {
      // Только свободные, без краёв. Trailing занятые.
      const total = isPool ? baseTotal : Math.max(freeCount, baseTotal);
      const cappedFree = Math.min(freeCount, total);
      const occupied = [];
      for (let i = cappedFree; i < total; i++) occupied.push(i);
      return { type: 'lanes', occupied, free: cappedFree, total };
    }

    // Просто «дорож» без числа — весь бассейн свободен
    if (/дорож/.test(a)) {
      return { type: 'lanes', occupied: [], free: baseTotal, total: baseTotal };
    }
    // Для большого бассейна: если на сайте нет НИКАКОГО ограничения
    // (пустое описание / просто «Свободное плавание» / любой текст без
    // явных маркеров «N дорожек», «N крайних», «бескрайн») — считаем,
    // что весь бассейн свободен посетителю. Раньше тут возвращался null
    // и индикатор не рисовался вовсе, хотя дефолт «всё открыто» — то,
    // что на самом деле происходит на стороне бассейна.
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

function toMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} ч ${String(m).padStart(2, '0')} м`;
  if (h) return `${h} ч`;
  return `${m} м`;
}

// 750 → "12:30"
function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatRelativeMinutes(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.round((Date.now() - t) / 60_000);
  if (diff < 1) return 'только что';
  if (diff < 60) return `${diff} мин назад`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  return `${d} д назад`;
}

const RU_WEEKDAYS_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const RU_WEEKDAYS_LONG  = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
const RU_MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

function formatDayHeading(iso) {
  const d = new Date(iso + 'T12:00:00');
  const today = todayIso();
  if (iso === today) return 'сегодня';
  if (iso === isoOffset(1)) return 'завтра';
  if (iso === isoOffset(-1)) return 'вчера';
  return `${RU_WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()} ${RU_MONTHS[d.getMonth()]}`;
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

// ── Schedule diff (client-side) ─────────────────────────────────
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

// Пересечение события сайта с конкретной сменой пользователя. Базовая
// единица для аннотации журнала И для on-the-fly валидации в UI:
// UI не может доверять записанному affectsShiftId, потому что смена могла
// быть удалена/перенесена после recordSiteCheck (orphan-ссылка), либо
// наоборот — добавлена ПОСЛЕ (тогда affectsShiftId пуст, но overlap есть).
function eventOverlapsShift(ev, shift) {
  return shift.facilityId === ev.facilityId
    && shift.date === ev.date
    && toMinutes(shift.start) < toMinutes(ev.end)
    && toMinutes(shift.end)   > toMinutes(ev.start);
}

// Помечает события, пересекающиеся с пользовательскими сменами. Аннотация
// «снимок на момент сверки» — для журнала и для wasStart/wasEnd.
// UI должен валидировать affectsShiftId через eventOverlapsShift, а не
// полагаться на сохранённое значение.
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

// ── Store API ───────────────────────────────────────────────────
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// In-memory кэш распарсенного /api/schedule snapshot. Раньше каждый вызов
// getCachedFacility делал JSON.parse полного payload — при 10 сменах на день
// и minute-tick получалось ~30 JSON.parse в минуту. Теперь парсим один раз,
// инвалидируем через _invalidateCache при saveJSON(STORAGE.cache).
let _cacheParsed = null;       // { at, payload, mock }
let _cacheRawHash = null;      // строка из localStorage, для детектирования multi-tab изменений

// Результат ПОСЛЕДНЕЙ попытки fetchSchedule: true если свалились в mock.
// Раньше mock-флаг писали в cache.mock и читали через loadCachedMock — но
// теперь при mock-фолбэке мы НЕ перезатираем кэш реальных данных, поэтому
// флаг живёт в памяти модуля. handleRefresh читает его сразу после await,
// поэтому page-reload (сбрасывающий флаг) не критичен — toast уже показан.
let _lastFetchWasMock = false;
function _readCachedSnapshot() {
  const raw = localStorage.getItem(STORAGE.cache);
  if (raw === _cacheRawHash) return _cacheParsed;
  _cacheRawHash = raw;
  try { _cacheParsed = raw ? JSON.parse(raw) : null; }
  catch { _cacheParsed = null; }
  return _cacheParsed;
}
function _invalidateCache() {
  _cacheParsed = null;
  _cacheRawHash = null;
}

const Data = {
  FACILITIES,
  INSTRUCTORS,
  get TODAY_ISO() { return todayIso(); },

  // ── Settings ──
  defaultSettings: () => ({ theme: 'dark' }),
  loadSettings() { return { ...this.defaultSettings(), ...loadJSON(STORAGE.settings, {}) }; },
  saveSettings(patch) {
    const next = { ...this.loadSettings(), ...patch };
    saveJSON(STORAGE.settings, next);
    return next;
  },

  // ── Shifts ──
  loadShifts() {
    const stored = loadJSON(STORAGE.shifts, null);
    if (stored === null) return DEMO_SHIFTS.slice();
    return stored;
  },
  saveShifts(list) {
    saveJSON(STORAGE.shifts, list);
    // Уведомляем подписчиков ASYNC (через microtask), чтобы listener'ы
    // (например HomeScreen) не сработали посреди обработчика кнопки и не
    // конкурировали с следующими шагами (router.pop, toast.show и т.д.).
    notifyAsync('rpgu:shifts-changed');
  },
  upsertShift(shift) {
    const list = this.loadShifts();
    const i = list.findIndex(s => s.id === shift.id);
    if (i >= 0) list[i] = shift; else list.push({ ...shift, id: shift.id || `s${Date.now()}` });
    this.saveShifts(list);
    return list;
  },
  removeShift(id) {
    const list = this.loadShifts().filter(s => s.id !== id);
    this.saveShifts(list);
    return list;
  },
  clearShifts() { this.saveShifts([]); },

  // ── Site changes ──
  loadSiteChanges() {
    const stored = loadJSON(STORAGE.siteChanges, null);
    if (stored === null) return DEMO_CHANGES.slice();
    return stored;
  },
  saveSiteChanges(list) {
    saveJSON(STORAGE.siteChanges, list);
    notifyAsync('rpgu:site-changes-changed');
  },
  ackChange(id) {
    const list = this.loadSiteChanges().map(c =>
      c.id === id ? { ...c, acknowledgedAt: new Date().toISOString() } : c
    );
    this.saveSiteChanges(list);
    return list;
  },
  // Квитируем ВСЕ непросмотренные записи журнала. Кнопка «Просмотрено»
  // на экране сверки означает «я ознакомился со всем» — если оставлять
  // старую unacked-запись с affectsMe, плашка на главной не уйдёт вниз
  // (unreadChange найдёт её и снова поднимет SiteCard вверх).
  ackAllPending() {
    const now = new Date().toISOString();
    const list = this.loadSiteChanges().map(c =>
      (!c.acknowledgedAt && (c.hasChanges || c.hasSourceIssues))
        ? { ...c, acknowledgedAt: now }
        : c
    );
    this.saveSiteChanges(list);
    return list;
  },

  // ── Parser/adapter ──
  async fetchSchedule({ force = false } = {}) {
    const cached = loadJSON(STORAGE.cache, null);
    if (!force && cached && (Date.now() - new Date(cached.at).getTime() < 5 * 60_000)) {
      _lastFetchWasMock = false;  // вернули кэш, реальной попытки не было
      return cached.payload;
    }
    const prevPayload = cached?.payload || null;
    let payload, isMock = false;
    try {
      const r = await fetch('/api/schedule' + (force ? '?refresh=1' : ''), {
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      payload = await r.json();
    } catch (err) {
      // Фолбэк для статичного превью без бекенда
      payload = { ...MOCK_SCHEDULE, generatedAt: new Date().toISOString() };
      isMock = true;
    }

    _lastFetchWasMock = isMock;

    if (isMock) {
      // НЕ перезаписываем кэш реальных данных моком и НЕ зовём recordSiteCheck.
      // Иначе diff(real_prev, mock_empty) пометит ВСЕ реальные сессии как
      // 'rem', а на следующем успешном fetch они вернутся как 'add' —
      // в журнале появятся phantom события (баг #3 из аудита).
      // Если реального prev ещё не было — отдадим mock как best-effort
      // ответ для UI, но в кэш всё равно не пишем, чтобы первый успешный
      // fetch попал в ветку baseline (prev=null), а не diff'нулся с mock'ом.
      return cached?.payload || payload;
    }

    saveJSON(STORAGE.cache, { at: new Date().toISOString(), payload, mock: false });
    _invalidateCache();
    // Сверка с предыдущим снапшотом — на клиенте, без обращения к серверу
    try { Data.recordSiteCheck(prevPayload, payload, { mock: false }); } catch {}
    return payload;
  },

  // Считает diff между двумя снапшотами /api/schedule и пишет запись
  // в журнал siteChanges. Возвращает добавленную запись (или null).
  recordSiteCheck(prev, next, { mock = false } = {}) {
    if (!next) return null;
    const checkedAt = next.generatedAt || new Date().toISOString();
    const issues = next.meta?.sourceIssues || [];
    const hasSourceIssues = issues.length > 0;

    // Первый снапшот — baseline, событий нет
    if (!prev) {
      const list = this.loadSiteChanges();
      // Не плодим baseline, если он уже есть в журнале
      if (!list.some(c => c.baseline)) {
        const baseline = {
          id: 'c' + Date.now(),
          checkedAt,
          hasChanges: false,
          hasSourceIssues,
          acknowledgedAt: new Date().toISOString(),
          baseline: true,
          events: [],
        };
        this.saveSiteChanges([baseline, ...list]);
        return baseline;
      }
      return null;
    }

    const events = computeScheduleDiff(prev, next);
    const shifts = this.loadShifts();
    annotateAffectedShifts(events, shifts);
    const affectsMe = events.some(ev => ev.affectsShiftId);

    const entry = {
      id: 'c' + Date.now(),
      checkedAt,
      hasChanges: events.length > 0,
      hasSourceIssues,
      affectsMe,
      acknowledgedAt: null,
      events,
      mock: mock || undefined,
    };
    const list = this.loadSiteChanges();
    // Если ничего не изменилось и предыдущая запись тоже "тихая" — не дублируем
    const prevEntry = list.find(c => !c.baseline);
    if (!entry.hasChanges && !entry.hasSourceIssues && prevEntry
        && !prevEntry.hasChanges && !prevEntry.hasSourceIssues) {
      // Обновим время проверки в предыдущей записи и выйдем
      prevEntry.checkedAt = checkedAt;
      this.saveSiteChanges(list);
      return null;
    }
    // Тихую запись всё-таки сохраняем для журнала, но автоквитируем
    if (!entry.hasChanges && !entry.hasSourceIssues) {
      entry.acknowledgedAt = checkedAt;
    }
    this.saveSiteChanges([entry, ...list].slice(0, 50));
    return entry;
  },

  // ── Derived ──
  buildTimelineForDate,
  classifyBreak,
  inferSessionIndicator,
  toMinutes,
  minutesToHHMM,
  formatDuration,
  formatRelativeMinutes,
  formatDayHeading,
  isoOffset,
  nowMinutesInMinsk,
  eventOverlapsShift,
  RU_WEEKDAYS_SHORT,
  RU_WEEKDAYS_LONG,
  RU_MONTHS,

  getFacility(id) { return FACILITIES.find(f => f.id === id) || null; },
  getInstructor(id) { return INSTRUCTORS.find(i => i.id === id) || null; },

  // ── Доступ к закэшированному снапшоту сайта ──
  loadCachedSchedule() {
    return _readCachedSnapshot()?.payload || null;
  },
  // ISO-таймстемп последнего успешного fetchSchedule (или null, если ещё не было)
  loadCachedAt() {
    return _readCachedSnapshot()?.at || null;
  },
  // true, если ПОСЛЕДНЯЯ попытка fetchSchedule свалилась в MOCK_SCHEDULE
  // (нет доступа к /api/schedule). UI читает сразу после await — флаг
  // отражает только что произошедшую попытку, не состояние кэша.
  loadCachedMock() {
    return _lastFetchWasMock === true;
  },
  getCachedFacility(facilityId) {
    const payload = _readCachedSnapshot()?.payload;
    if (!payload) return null;
    return payload.facilities?.find(f => f.id === facilityId) || null;
  },
  // Возвращает массив сайтовых сессий на дату для объекта, отсортированных по start.
  getSiteSessionsForDay(facilityId, date) {
    const fac = this.getCachedFacility(facilityId);
    if (!fac) return [];
    return (fac.sessions || [])
      .filter(s => s.date === date)
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  },
  // Сравнивает смену пользователя с сайтом. Возвращает:
  //   { state: 'matches'|'mismatch'|'gap'|'closed'|'unknown',
  //     siteSessions, notice, dataQuality, sourceCheckedAt }
  compareShiftWithSite(shift) {
    const fac = this.getCachedFacility(shift.facilityId);
    if (!fac) return { state: 'unknown', siteSessions: [] };
    if (fac.dataQuality === 'closed') {
      return { state: 'closed', siteSessions: [], notice: fac.notice, dataQuality: 'closed', sourceCheckedAt: fac.sourceCheckedAt };
    }
    if (fac.dataQuality === 'parse_error' || fac.dataQuality === 'template') {
      return { state: 'unknown', siteSessions: [], dataQuality: fac.dataQuality };
    }
    const sessions = this.getSiteSessionsForDay(shift.facilityId, shift.date);
    if (!sessions.length) {
      return { state: 'gap', siteSessions: [], dataQuality: fac.dataQuality, sourceCheckedAt: fac.sourceCheckedAt };
    }
    const exact = sessions.find(s => s.start === shift.start && s.end === shift.end);
    if (exact) {
      return { state: 'matches', siteSessions: sessions, exact, dataQuality: fac.dataQuality, sourceCheckedAt: fac.sourceCheckedAt };
    }
    return { state: 'mismatch', siteSessions: sessions, dataQuality: fac.dataQuality, sourceCheckedAt: fac.sourceCheckedAt };
  },

  // «Фактическое» представление смены — то, что пользователь увидит на карточке.
  //
  // Когда есть данные сайта (dataQuality === 'ok'):
  //   - окно [start, end] = min(siteStart) … max(siteEnd) в пределах смены пользователя
  //   - minutes = сумма пересечений с сайтовыми сессиями
  //   - activity = активность с сайта (первая из пересекающихся)
  //   - gaps[]   = зазоры между смежными сайтовыми слотами (если есть)
  //   - badge = 'confirmed'  → сайт подтвердил смену
  //   - badge = 'not_in_site' → сайт известен, но в это время ничего нет
  // Когда объект закрыт:           badge='closed', minutes=0, notice=…
  // Когда данных сайта нет вообще: badge='no_data', minutes=schedule, fallback на shift
  computeEffectiveShift(shift) {
    const schedMin = toMinutes(shift.end) - toMinutes(shift.start);
    const fac = this.getCachedFacility(shift.facilityId);
    if (!fac) {
      return { start: shift.start, end: shift.end, minutes: schedMin, badge: 'no_data', gaps: [] };
    }
    if (fac.dataQuality === 'closed') {
      return { start: shift.start, end: shift.end, minutes: 0, badge: 'closed', gaps: [], notice: fac.notice };
    }
    if (fac.dataQuality !== 'ok') {
      return { start: shift.start, end: shift.end, minutes: schedMin, badge: 'no_data', gaps: [] };
    }
    // Частичное закрытие: dataQuality === 'ok', но в часть дат объект
    // закрыт (например, отключение горячей воды до 25.05). Сравнение ISO-
    // строк работает лексикографически — равносильно сравнению по дате.
    if (Array.isArray(fac.closureRanges) && fac.closureRanges.length) {
      const inRange = fac.closureRanges.find(r =>
        shift.date >= r.from && shift.date <= r.to
      );
      if (inRange) {
        return { start: shift.start, end: shift.end, minutes: 0, badge: 'closed', gaps: [], notice: inRange.notice };
      }
    }
    const sStart = toMinutes(shift.start);
    const sEnd = toMinutes(shift.end);
    const overlapping = this.getSiteSessionsForDay(shift.facilityId, shift.date)
      .filter(ss => toMinutes(ss.start) < sEnd && toMinutes(ss.end) > sStart);
    if (!overlapping.length) {
      return { start: shift.start, end: shift.end, minutes: schedMin, badge: 'not_in_site', gaps: [] };
    }
    let minutes = 0;
    const gaps = [];
    let prevEnd = null;
    for (const ss of overlapping) {
      const ovStart = Math.max(sStart, toMinutes(ss.start));
      const ovEnd = Math.min(sEnd, toMinutes(ss.end));
      if (ovEnd > ovStart) minutes += (ovEnd - ovStart);
      if (prevEnd !== null && ovStart > prevEnd) {
        gaps.push({ from: minutesToHHMM(prevEnd), to: minutesToHHMM(ovStart), minutes: ovStart - prevEnd });
      }
      prevEnd = ovEnd;
    }
    const effStart = Math.max(sStart, toMinutes(overlapping[0].start));
    const effEnd = Math.min(sEnd, toMinutes(overlapping[overlapping.length - 1].end));
    // Если в окно смены попадает несколько сайтовых активностей
    // («массовое + хоккей»), показываем все уникальные — иначе вторая
    // и далее просто исчезают с карточки.
    const uniqueActs = [];
    const seenAct = new Set();
    for (const o of overlapping) {
      const a = (o.activity || '').trim();
      if (!a || seenAct.has(a)) continue;
      seenAct.add(a);
      uniqueActs.push(a);
    }
    return {
      start: minutesToHHMM(effStart),
      end: minutesToHHMM(effEnd),
      minutes,
      badge: 'confirmed',
      gaps,
      activity: uniqueActs.join(' · ') || null,
      sessions: overlapping,
    };
  },

  // ── Export / Import ──
  exportJSON() {
    return JSON.stringify({
      version: 4,
      app: 'Расписание',
      exportedAt: new Date().toISOString(),
      timezone: TZ,
      shifts: this.loadShifts(),
      siteChanges: { history: this.loadSiteChanges() },
    }, null, 2);
  },

  importJSON(text) {
    const obj = JSON.parse(text);
    // Валидация и нормализация смен. Возвращаем счётчики — UI показывает
    // сколько реально импортировано, сколько пропущено и сколько записей
    // в журнале сверок. Без этого тост говорил «загружено» даже когда
    // 0 смен прошли валидацию, и пользователь думал, что всё ок.
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const HHMM = /^\d{2}:\d{2}$/;
    const facIds = new Set(FACILITIES.map(f => f.id));
    // Принимаем и числовые id (старые экспорты) — нормализуем в строку;
    // отсутствие id — генерируем. Главное, что date/time/facility валидны.
    const isValidShift = (s) => s
      && typeof s === 'object'
      && typeof s.date === 'string' && ISO_DATE.test(s.date)
      && typeof s.facilityId === 'string' && facIds.has(s.facilityId)
      && typeof s.start === 'string' && HHMM.test(s.start)
      && typeof s.end === 'string'   && HHMM.test(s.end)
      && toMinutes(s.end) > toMinutes(s.start);
    let importedShifts = 0;
    let skippedShifts = 0;
    let importedChanges = 0;
    if (Array.isArray(obj.shifts)) {
      const clean = [];
      let autoId = Date.now();
      for (const s of obj.shifts) {
        if (!isValidShift(s)) { skippedShifts++; continue; }
        clean.push({
          id: (s.id != null && String(s.id)) || `s${autoId++}`,
          date: s.date,
          facilityId: s.facilityId,
          start: s.start,
          end: s.end,
          activity: typeof s.activity === 'string' ? s.activity : '',
          source: s.source === 'site' ? 'site' : 'shift',
          instructors: Array.isArray(s.instructors)
            ? s.instructors.filter(x => typeof x === 'string')
            : [],
        });
      }
      this.saveShifts(clean);
      importedShifts = clean.length;
    }
    if (Array.isArray(obj.siteChanges?.history)) {
      this.saveSiteChanges(obj.siteChanges.history);
      importedChanges = obj.siteChanges.history.length;
    }
    return { importedShifts, skippedShifts, importedChanges };
  },
};

window.Data = Data;
