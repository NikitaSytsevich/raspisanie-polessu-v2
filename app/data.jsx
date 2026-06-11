// ──────────────────────────────────────────────────────────────────
// app/data.jsx — client-side schedule store + parser adapter
//
// Tries /api/schedule first; if not reachable (e.g. opened as a
// static file), falls back to MOCK_SCHEDULE. All user data
// (shifts, site-changes history, settings) lives in localStorage.
// ──────────────────────────────────────────────────────────────────

// Чистая логика (diff, дорожки, время) вынесена в _logic.js — её
// покрывают node-тесты (app/_logic.test.js). Здесь только обёртка стора:
// localStorage, TZ, сетевой fetch. esbuild инлайнит require в бандл.
const {
  toMinutes,
  minutesToHHMM,
  formatDuration,
  classifyBreak,
  inferSessionIndicator,
  facilityDayUsage,
  buildTimelineForDate,
  computeScheduleDiff,
  eventOverlapsShift,
  annotateAffectedShifts,
  buildICS,
} = require('./_logic.js');

const STORAGE = {
  shifts: 'rpgu_shifts_v1',
  settings: 'rpgu_settings_v1',
  siteChanges: 'rpgu_site_changes_v1',
  cache: 'rpgu_cache_v1',
  instructors: 'rpgu_instructors_v1',
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
    hint: '50 м · 10 дорожек',
    sourceUrl: 'https://www.polessu.by/%D0%B1%D0%BE%D0%BB%D1%8C%D1%88%D0%BE%D0%B9-%D0%B1%D0%B0%D1%81%D1%81%D0%B5%D0%B9%D0%BD' },
  { id: 'small_pool',  name: 'Малый бассейн',   icon: 'water_drop',
    hint: 'детский',
    sourceUrl: 'https://www.polessu.by/%D0%BC%D0%B0%D0%BB%D1%8B%D0%B9-%D0%B1%D0%B0%D1%81%D1%81%D0%B5%D0%B9%D0%BD' },
  { id: 'rowing_base', name: 'Гребная база',    icon: 'rowing',
    hint: 'зал · штанга',
    sourceUrl: 'https://www.polessu.by/%D1%80%D0%B0%D1%81%D0%BF%D0%B8%D1%81%D0%B0%D0%BD%D0%B8%D0%B5-%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D1%8B-%D1%82%D1%80%D0%B5%D0%BD%D0%B0%D0%B6%D0%B5%D1%80%D0%BD%D0%BE%D0%B3%D0%BE-%D0%B7%D0%B0%D0%BB%D0%B0-%D0%B8-%D0%B7%D0%B0%D0%BB%D0%B0-%D1%88%D1%82%D0%B0%D0%BD%D0%B3%D0%B8-%D0%B3%D1%80%D0%B5%D0%B1%D0%BD%D0%B0%D1%8F-%D0%B1%D0%B0%D0%B7%D0%B0-%E2%84%961' },
];

// Дефолтный каталог инструкторов — используется, пока пользователь не
// отредактировал список в настройках (хранится в localStorage,
// см. loadInstructors / saveInstructors ниже).
const DEFAULT_INSTRUCTORS = [
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

// Бейдж на иконке установленного PWA: число непросмотренных проверок
// с изменениями. Поддерживается iOS ≥ 16.4 (PWA с главного экрана),
// Android/Chrome, десктоп-Chromium; в остальных — тихий no-op.
function updateAppBadge() {
  try {
    if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
    const list = loadJSON(STORAGE.siteChanges, []) || [];
    const n = list.filter(c => !c.acknowledgedAt && (c.hasChanges || c.hasSourceIssues)).length;
    if (n > 0) navigator.setAppBadge(n).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  } catch {}
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
// Именительный падеж — для самостоятельных подписей («Июнь», «Июнь — июль»),
// где родительный («июня») читается как обрывок даты.
const RU_MONTHS_NOM = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];

function formatDayHeading(iso) {
  const d = new Date(iso + 'T12:00:00');
  const today = todayIso();
  if (iso === today) return 'сегодня';
  if (iso === isoOffset(1)) return 'завтра';
  if (iso === isoOffset(-1)) return 'вчера';
  return `${RU_WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()} ${RU_MONTHS[d.getMonth()]}`;
}

// ── Store API ───────────────────────────────────────────────────
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// Клиентский /api/schedule раньше шёл без таймаута: при зависшей сети
// await не разрешался никогда, и спиннер refreshing в Home крутился
// вечно. Серверный fetcher жёстко обрывается на 8с — здесь даём ~10с
// и по таймауту падаем в catch → mock-фолбэк + честный toast.
const FETCH_TIMEOUT_MS = 10_000;

function fetchWithTimeout(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  if (typeof AbortController === 'undefined') return fetch(url, opts);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(t));
}

// Prefetch из index.html — уже запущенный промис, его fetch отсюда не
// прервать (AbortController остался в index.html). Поэтому просто
// гонку с таймаутом: если не успел — бросаем, ловим в общем catch.
function withTimeout(promise, ms = FETCH_TIMEOUT_MS) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// In-memory кэш распарсенного /api/schedule snapshot. Раньше каждый вызов
// getCachedFacility делал JSON.parse полного payload — при 10 сменах на день
// и minute-tick получалось ~30 JSON.parse в минуту. Теперь парсим один раз,
// инвалидируем через _invalidateCache при saveJSON(STORAGE.cache).
let _cacheParsed = null;       // { at, payload, mock }
let _instructorsParsed = null; // распарсенный каталог инструкторов
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
  // Каталог инструкторов теперь редактируемый (настройки) — геттер, чтобы
  // существующий код Data.INSTRUCTORS продолжал работать без изменений.
  get INSTRUCTORS() { return this.loadInstructors(); },
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

  // ── Instructors (редактируемый каталог) ──
  loadInstructors() {
    if (_instructorsParsed) return _instructorsParsed;
    const stored = loadJSON(STORAGE.instructors, null);
    _instructorsParsed = (Array.isArray(stored) && stored.length)
      ? stored
      : DEFAULT_INSTRUCTORS.slice();
    return _instructorsParsed;
  },
  saveInstructors(list) {
    _instructorsParsed = list;
    saveJSON(STORAGE.instructors, list);
    notifyAsync('rpgu:instructors-changed');
  },
  addInstructor(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return null;
    const list = this.loadInstructors();
    if (list.some(i => i.name.toLowerCase() === clean.toLowerCase())) return null;
    const parts = clean.split(' ');
    const initials = ((parts[0][0] || '') + ((parts[1] || '')[0] || '')).toUpperCase();
    const inst = { id: 'i' + Date.now().toString(36), name: clean, initials };
    this.saveInstructors([...list, inst]);
    return inst;
  },
  removeInstructor(id) {
    this.saveInstructors(this.loadInstructors().filter(i => i.id !== id));
  },

  // ── Site changes ──
  loadSiteChanges() {
    const stored = loadJSON(STORAGE.siteChanges, null);
    if (stored === null) return DEMO_CHANGES.slice();
    return stored;
  },
  saveSiteChanges(list) {
    saveJSON(STORAGE.siteChanges, list);
    notifyAsync('rpgu:site-changes-changed');
    updateAppBadge();
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
      // Ранний prefetch из index.html (window.__rpguSchedulePrefetch) стартует
      // /api/schedule ещё до загрузки React — перекрывает сетевой round-trip
      // со скачиванием бандла. Подхватываем его вместо нового fetch (один раз,
      // только для не-force запроса). force всегда идёт в сеть с ?refresh=1.
      let pre = null;
      if (!force && typeof window !== 'undefined' && window.__rpguSchedulePrefetch) {
        pre = window.__rpguSchedulePrefetch;
        window.__rpguSchedulePrefetch = null;
      }
      if (pre) {
        payload = await withTimeout(pre);
        if (!payload) throw new Error('prefetch failed');
      } else {
        const r = await fetchWithTimeout('/api/schedule' + (force ? '?refresh=1' : ''), {
          headers: { Accept: 'application/json' },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        payload = await r.json();
      }
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
  facilityDayUsage,
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
  RU_MONTHS_NOM,

  getFacility(id) { return FACILITIES.find(f => f.id === id) || null; },
  getInstructor(id) { return this.loadInstructors().find(i => i.id === id) || null; },

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

  // ── Синхронизация смен с Telegram-ботом ──
  // Пушит копию смен на /api/shifts-sync (→ Vercel Blob), чтобы бот мог
  // помечать изменения сайта, задевающие ИМЕННО ваши смены. Работает только
  // если в настройках задан ключ (botSyncKey) — без него no-op.
  async syncShiftsToBot() {
    const key = this.loadSettings().botSyncKey;
    if (!key) return { ok: false, reason: 'no_key' };
    try {
      const r = await fetchWithTimeout('/api/shifts-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sync-Key': key },
        body: JSON.stringify({ shifts: this.loadShifts() }),
      });
      if (r.status === 401) return { ok: false, reason: 'bad_key' };
      if (r.status === 503) return { ok: false, reason: 'not_configured' };
      return { ok: r.ok };
    } catch {
      return { ok: false, reason: 'network' };
    }
  },

  // ── Export / Import ──
  // .ics для системного календаря телефона/компьютера. Время конвертируется
  // в UTC (Минск = UTC+3 без переходов) — см. buildICS в _logic.js.
  exportICS() {
    return buildICS(this.loadShifts(), FACILITIES, this.loadInstructors());
  },

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
    // Журнал сверок: раньше history сохранялась как есть — битый или чужой
    // JSON мог уронить рендер SiteCard/ChangesScreen (обращения к
    // ev.kind/date/start без проверок). Теперь валидируем форму записи,
    // фильтруем её события и режем историю до 50 (как recordSiteCheck).
    if (Array.isArray(obj.siteChanges?.history)) {
      const EVENT_KINDS = new Set(['add', 'mod', 'rem']);
      const isValidEvent = (e) => e
        && typeof e === 'object'
        && EVENT_KINDS.has(e.kind)
        && typeof e.facilityId === 'string' && facIds.has(e.facilityId)
        && typeof e.date === 'string' && ISO_DATE.test(e.date)
        && typeof e.start === 'string' && HHMM.test(e.start)
        && typeof e.end === 'string'   && HHMM.test(e.end);
      const clean = [];
      for (const c of obj.siteChanges.history) {
        if (!c || typeof c !== 'object') continue;
        if (typeof c.id !== 'string' || typeof c.checkedAt !== 'string') continue;
        const events = Array.isArray(c.events) ? c.events.filter(isValidEvent) : [];
        // baseline валиден без событий; обычная запись без валидных событий
        // и без флага проблем источника — мусор, пропускаем.
        if (!c.baseline && !events.length && !c.hasSourceIssues) continue;
        clean.push({ ...c, events, hasChanges: events.length > 0 });
      }
      this.saveSiteChanges(clean.slice(0, 50));
      importedChanges = Math.min(clean.length, 50);
    }
    return { importedShifts, skippedShifts, importedChanges };
  },
};

window.Data = Data;

// Мульти-таб/мульти-окно: событие storage стреляет в ДРУГИХ вкладках при
// изменении localStorage. Транслируем его в те же события, что и локальные
// мутации, чтобы вторая вкладка или открытое рядом PWA-окно не расходились
// с актуальными данными до ближайшего focus.
window.addEventListener('storage', (e) => {
  if (!e || !e.key) return;
  if (e.key === STORAGE.shifts) notifyAsync('rpgu:shifts-changed');
  else if (e.key === STORAGE.siteChanges) {
    notifyAsync('rpgu:site-changes-changed');
    updateAppBadge();
  } else if (e.key === STORAGE.cache) {
    _invalidateCache();
  } else if (e.key === STORAGE.instructors) {
    _instructorsParsed = null;
    notifyAsync('rpgu:instructors-changed');
  }
});

// Синхронизируем бейдж на иконке при старте (вдруг изменения квитировали
// на другом устройстве/вкладке, а бейдж остался).
updateAppBadge();

// Автосинк смен с ботом: после любого изменения смен (debounce 4 с — серия
// из N смен уйдёт одним запросом) шлём копию на сервер. Тихий best-effort:
// упавшая сеть не мешает работе, при следующем изменении попробуем снова.
let _botSyncTimer = null;
window.addEventListener('rpgu:shifts-changed', () => {
  if (!Data.loadSettings().botSyncKey) return;
  clearTimeout(_botSyncTimer);
  _botSyncTimer = setTimeout(() => { Data.syncShiftsToBot(); }, 4000);
});
