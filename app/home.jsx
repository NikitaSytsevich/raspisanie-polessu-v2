// ──────────────────────────────────────────────────────────────────
// app/home.jsx — main screen «Мой график»
// ──────────────────────────────────────────────────────────────────

const { useState: _hs, useEffect: _he, useMemo: _hm, useRef: _hr, useCallback: _hcb } = React;

function HomeScreen() {
  const router = window.useRouter();
  const toast = window.UI.useToast();
  const [shifts, setShifts]   = _hs(() => window.Data.loadShifts());
  const [changes, setChanges] = _hs(() => window.Data.loadSiteChanges());
  const [selectedDate, setSelectedDate] = _hs(() => window.Data.TODAY_ISO);
  const [aboutOpen, setAboutOpen] = _hs(false);
  const [refreshing, setRefreshing] = _hs(false);
  const [weekOffset, setWeekOffset] = _hs(0); // 0 — текущая неделя, ±1 — соседние
  const [_, force]            = _hs(0);
  const scrollRef             = _hr(null);

  // Re-render every minute so "now" status stays accurate. Таймер ставим на
  // паузу когда вкладка/PWA свёрнуты — не сжигаем CPU в фоне.
  _he(() => {
    let t = null;
    const tick = () => force(x => x + 1);
    const start = () => { if (!t) t = setInterval(tick, 60_000); };
    const stop  = () => { if (t) { clearInterval(t); t = null; } };
    const onVis = () => {
      if (document.hidden) stop();
      else { tick(); start(); }
    };
    document.addEventListener('visibilitychange', onVis);
    if (!document.hidden) start();
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // Refresh shifts when:
  //   • окно снова получает фокус (вернулись из вкладки),
  //   • editor сохранил/удалил смену (Data.saveShifts → событие),
  //   • история сверки сайта обновилась (Data.saveSiteChanges → событие).
  // Home — persistent screen, не перемонтируется на router.pop(), поэтому без
  // подписки на эти события он бы не узнал об изменениях localStorage.
  _he(() => {
    function reloadShifts() { setShifts(window.Data.loadShifts()); }
    function reloadChanges() { setChanges(window.Data.loadSiteChanges()); }
    function onFocus() { reloadShifts(); reloadChanges(); }
    window.addEventListener('focus', onFocus);
    window.addEventListener('rpgu:shifts-changed', reloadShifts);
    window.addEventListener('rpgu:site-changes-changed', reloadChanges);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('rpgu:shifts-changed', reloadShifts);
      window.removeEventListener('rpgu:site-changes-changed', reloadChanges);
    };
  }, []);

  // Автозагрузка расписания при первом запуске — чтобы карточки смен сразу
  // могли показать сопоставление «по графику vs по сайту».
  //
  // setShifts(loadShifts()) — не косметика, а ИНВАЛИДАЦИЯ useMemo:
  //   • { totalMin, ... } замемоизирован по [dayShifts] и зовёт внутри
  //     computeEffectiveShift → читает кэш расписания;
  //   • FacilityCard.siteSessions — useMemo([facilityId, date]) → читает
  //     getSiteSessionsForDay → тоже кэш.
  // Сам по себе force(x+1) ре-рендер триггерит, но deps useMemo не
  // меняются → возвращается старое значение (с badge='no_data', с пустыми
  // siteSessions). loadShifts() даёт НОВЫЙ массив (JSON.parse), ссылка
  // отличается → useMemo пересчитывается → карточки оживают.
  _he(() => {
    let cancelled = false;
    window.Data.fetchSchedule().then(() => {
      if (!cancelled) {
        setShifts(window.Data.loadShifts());
        setChanges(window.Data.loadSiteChanges());
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const today = window.Data.TODAY_ISO;
  const isToday = selectedDate === today;
  const dayShifts = _hm(() => shifts.filter(s => s.date === selectedDate), [shifts, selectedDate]);
  const allDates = _hm(() => Array.from(new Set(shifts.map(s => s.date))).sort(), [shifts]);
  // Set всех дат — для O(1) проверки hasShift в weekDays-map.
  const dateSet = _hm(() => new Set(shifts.map(s => s.date)), [shifts]);

  // Empty-state detection (based on the whole library, not the selected day)
  let state = 'normal';
  if (!shifts.length) state = 'empty';
  else if (!shifts.some(s => s.date >= today)) state = 'caught_up';

  // Hero stats — суммируем «фактическое» время по сайту через
  // computeEffectiveShift на каждую смену.
  // Подтверждённые смены идут в totalMin; неподтверждённые (нет данных или
  // объект работает, но в это окно ничего) — в unconfirmedMin как контекст.
  const { totalMin, unconfirmedMin, facCount } = _hm(() => {
    let t = 0, u = 0;
    const facs = new Set();
    for (const s of dayShifts) {
      const e = window.Data.computeEffectiveShift(s);
      facs.add(s.facilityId);
      if (e.badge === 'closed') continue;
      if (e.badge === 'confirmed') t += e.minutes;
      else u += e.minutes;
    }
    return { totalMin: t, unconfirmedMin: u, facCount: facs.size };
  }, [dayShifts]);

  // Минск-TZ, не локальный браузерный — `today` и все даты в приложении
  // считаются в зоне Минска, и если бы здесь стояло new Date().getHours(),
  // у пользователя из другой TZ подсветка «сейчас» и «прошедшие сессии»
  // в SessionRow разъезжались бы с минским днём.
  const nowMins = window.Data.nowMinutesInMinsk();

  // Site-changes summary (latest unread)
  const unreadChange = changes.find(c => !c.acknowledgedAt && (c.hasChanges || c.hasSourceIssues));

  // Аффектед-счёт считаем НА ЛЕТУ против ТЕКУЩИХ shifts, а не по
  // сохранённому ev.affectsShiftId. Иначе:
  //   • удалённая смена оставляет orphan ссылку → SiteCard кричит «Затронута
  //     1 ваша смена», хотя её уже нет (баг #1 аудита);
  //   • добавленная ПОСЛЕ recordSiteCheck смена, пересекающая старое
  //     событие, не учитывается (event.affectsShiftId = undefined) — SiteCard
  //     врёт «ваши смены не тронуты» (баг #4).
  // Та же величина управляет и плашкой-вверху/внизу (см. ниже).
  const unreadAffectedCount = _hm(() => {
    if (!unreadChange?.events?.length) return 0;
    return unreadChange.events.filter(
      ev => shifts.some(s => window.Data.eventOverlapsShift(ev, s))
    ).length;
  }, [unreadChange, shifts]);
  const unreadAffectsMe = unreadAffectedCount > 0;

  // Pull-to-refresh handler (один и тот же путь и для кнопки в шапке,
  // и для PTR-жеста). Дополнительно тикает refreshing-флаг для анимации
  // в кнопке шапки.
  const handleRefresh = _hcb(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await window.Data.fetchSchedule({ force: true });
      // Не врём «сайт сверён», если фолбэкнулись в MOCK_SCHEDULE
      // (нет /api/schedule / сеть упала). Раньше тост говорил успех в
      // обоих случаях, пользователь не понимал, почему данные не обновились.
      const wasMock = window.Data.loadCachedMock();
      toast.show(wasMock ? 'Не удалось связаться с сайтом' : 'Сайт сверён');
      setShifts(window.Data.loadShifts());
      setChanges(window.Data.loadSiteChanges());
    } finally {
      setRefreshing(false);
    }
  }, [toast, refreshing]);

  // Week strip — окно из 7 дней. weekOffset=0 центрировано на сегодня,
  // ±1 сдвигает на неделю. Подпись месяца показываем на первом чипе и
  // на любом, который начинает новый месяц в пределах окна.
  const weekDays = _hm(() => {
    const arr = [];
    const baseStart = -1 + weekOffset * 7;
    const baseEnd   = 5 + weekOffset * 7;
    let lastMonth = -1;
    for (let i = baseStart; i <= baseEnd; i++) {
      const date = window.Data.isoOffset(i);
      const d = new Date(date + 'T12:00:00');
      const month = d.getMonth();
      arr.push({
        date,
        wd: window.Data.RU_WEEKDAYS_SHORT[d.getDay()],
        num: d.getDate(),
        mo: window.Data.RU_MONTHS[month].slice(0, 3),
        showMonth: month !== lastMonth,
        isToday: i === 0,
        isSelected: date === selectedDate,
        hasShift: dateSet.has(date),
      });
      lastMonth = month;
    }
    return arr;
  }, [dateSet, selectedDate, weekOffset]);

  // Когда меняется selectedDate — синхронизируем weekOffset так, чтобы
  // выбранный день попадал в текущее окно (если только что вернулись из
  // editor с другой датой и т.п.).
  //
  // ВАЖНО: deps содержат только selectedDate. weekOffset читается через
  // замыкание — это намеренно. Если добавить weekOffset в deps, эффект
  // будет срабатывать на каждое нажатие стрелок ◂/▸ в WeekStrip и сразу
  // же откатывать сдвиг назад, т.к. selectedDate остаётся в старом окне.
  // weekOffset на момент запуска эффекта всегда актуальный (React коммитит
  // state до запуска effects), staleness не страшен.
  const weekOffsetRef = _hr(weekOffset);
  weekOffsetRef.current = weekOffset;
  _he(() => {
    const today = window.Data.TODAY_ISO;
    const t = new Date(today + 'T12:00:00').getTime();
    const s = new Date(selectedDate + 'T12:00:00').getTime();
    const dayDiff = Math.round((s - t) / 86400000);
    const offset = weekOffsetRef.current;
    // Текущее окно покрывает [-1+offset*7 ... +5+offset*7]
    const lo = -1 + offset * 7;
    const hi =  5 + offset * 7;
    if (dayDiff < lo || dayDiff > hi) {
      // ближайший offset, при котором dayDiff попадает в [-1..5]
      const newOffset = Math.round((dayDiff - 2) / 7);
      setWeekOffset(newOffset);
    }
  }, [selectedDate]);

  return (
    <div className="screen home-screen">
      <window.UI.StatusBar/>

      <window.UI.AppHeader
        title="Расписание"
        onBrandClick={() => setAboutOpen(true)}
        meta={(() => {
          const at = window.Data.loadCachedAt();
          return at ? `обновлено ${window.Data.formatRelativeMinutes(at)}` : 'ещё не загружено';
        })()}
        right={
          <>
            <window.UI.IconBtn icon="edit_calendar" title="Редактор смен" onClick={() => router.push('editor')}/>
            <window.UI.IconBtn
              title={refreshing ? 'Идёт сверка…' : 'Обновить'}
              onClick={handleRefresh}
              className={refreshing ? 'is-loading' : ''}
            >
              <span className={`material-symbols-outlined ${refreshing ? 'spin' : ''}`}>
                {refreshing ? 'progress_activity' : 'refresh'}
              </span>
            </window.UI.IconBtn>
            <window.UI.IconBtn icon="tune" title="Настройки" onClick={() => router.push('settings')}/>
          </>
        }
      />

      <div ref={scrollRef} className="screen-scroll">
        <window.UI.PullToRefresh onRefresh={handleRefresh} scrollRef={scrollRef}>

          {state === 'normal' && (
            <>
              <Hero date={selectedDate} count={dayShifts.length} totalMin={totalMin} unconfirmedMin={unconfirmedMin} facCount={facCount} isToday={isToday}/>
              {/* Если сайт нашёл изменения, затронувшие наши смены — поднимаем
                  SiteCard вверх, чтобы пользователь сразу увидел проблему.
                  Используем unreadAffectsMe (рассчитан против ТЕКУЩИХ shifts),
                  а не сохранённый change.affectsMe — иначе ловим orphan и
                  missed-add кейсы из аудита.
                  onAck → ackAllPending: после клика на ✓ запись становится
                  acknowledged, unreadChange исчезает, плашка уезжает вниз. */}
              {unreadAffectsMe && (
                <SiteCard change={unreadChange} affectedCount={unreadAffectedCount}
                          onClick={() => router.push('changes')}
                          onAck={() => setChanges(window.Data.ackAllPending())}/>
              )}
              <WeekStrip
                days={weekDays}
                selectedDate={selectedDate}
                weekOffset={weekOffset}
                onSelect={setSelectedDate}
                onShift={(arg) => {
                  if (arg === 'today') {
                    setWeekOffset(0);
                    setSelectedDate(today);
                  } else {
                    setWeekOffset(o => o + arg);
                  }
                }}
                onPick={(date) => date && setSelectedDate(date)}
              />
              <FacilityList
                shifts={dayShifts}
                today={today}
                date={selectedDate}
                nowMins={nowMins}
                onPushEditor={(shift) => router.push('editor', shift ? { shiftId: shift.id } : { date: selectedDate })}
              />
              {dayShifts.length > 0 && (
                <AddShiftInlineLink date={selectedDate} onPush={() => router.push('editor', { date: selectedDate })}/>
              )}
              {!unreadAffectsMe && (
                <SiteCard change={unreadChange} affectedCount={0}
                          onClick={() => router.push('changes')}/>
              )}
            </>
          )}

          {state === 'empty' && <EmptyState
            kind="first_run"
            onAdd={() => router.push('editor')}
            onImport={() => triggerImport(toast, setShifts, setChanges)}
          />}

          {state === 'caught_up' && <>
            <Hero date={today} count={0} totalMin={0} facCount={0} muted/>
            <EmptyState
              kind="caught_up"
              lastDate={allDates[allDates.length - 1]}
              onAdd={() => router.push('editor')}
              onImport={() => triggerImport(toast, setShifts, setChanges)}
            />
          </>}

        </window.UI.PullToRefresh>
        <window.UI.HomeIndicator/>
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)}/>
    </div>
  );
}

// ── About modal — описание + ссылки на GitHub/Telegram ──────────
function AboutModal({ open, onClose }) {
  _he(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="about-modal-root" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div className="about-backdrop" onClick={onClose}/>
      <div className="about-sheet">
        <button type="button" className="about-close" onClick={onClose} aria-label="Закрыть">
          <span className="material-symbols-outlined">close</span>
        </button>

        <div className="about-logo" aria-hidden="true">
          <img src="/icon-192.png" alt=""/>
        </div>

        <p className="about-eyebrow">о&nbsp;приложении</p>
        <h2 id="about-title" className="about-title">
          Расписание <em>ПолесГУ</em>
        </h2>
        <p className="about-tagline">
          Личный график тренера, сверенный с публичным расписанием спортивных
          объектов&nbsp;университета. Показывает реальное время работы, а&nbsp;не
          плановое.
        </p>

        <ul className="about-features">
          <li><span className="material-symbols-outlined">verified</span><span>сверка с&nbsp;сайтом ПолесГУ</span></li>
          <li><span className="material-symbols-outlined">view_list</span><span>день и&nbsp;лента всех смен</span></li>
          <li><span className="material-symbols-outlined">cloud_off</span><span>работает офлайн&nbsp;— данные локально</span></li>
        </ul>

        <div className="about-links">
          <a className="about-link is-primary"
             href="https://github.com/NikitaSytsevich/raspisanie-polessu-v2"
             target="_blank" rel="noopener noreferrer">
            <span className="material-symbols-outlined">code</span>
            <span className="body">
              <span className="head">GitHub</span>
              <span className="sub">исходники открыты</span>
            </span>
            <span className="material-symbols-outlined arrow">open_in_new</span>
          </a>
          <a className="about-link"
             href="https://t.me/nikita_sytsevich"
             target="_blank" rel="noopener noreferrer">
            <span className="material-symbols-outlined">send</span>
            <span className="body">
              <span className="head">Telegram</span>
              <span className="sub">@nikita_sytsevich</span>
            </span>
            <span className="material-symbols-outlined arrow">open_in_new</span>
          </a>
        </div>

        <p className="about-footer">
          сделано <em>с&nbsp;любовью к&nbsp;деталям</em>
        </p>
      </div>
    </div>
  );
}

// ── Hero ────────────────────────────────────────────────────────
function Hero({ date, count, totalMin, unconfirmedMin, facCount, muted, isToday }) {
  const d = new Date(date + 'T12:00:00');
  const wd = window.Data.RU_WEEKDAYS_SHORT[d.getDay()];
  const day = d.getDate();
  const mo = window.Data.RU_MONTHS[d.getMonth()];
  let kicker = window.Data.formatDayHeading(date);
  if (isToday) kicker = 'Сегодня';
  else if (date === window.Data.isoOffset(1)) kicker = 'Завтра';
  else if (date === window.Data.isoOffset(-1)) kicker = 'Вчера';
  else kicker = kicker[0].toUpperCase() + kicker.slice(1);
  return (
    <section className={`hero ${muted ? 'is-muted' : ''} ${!muted && count === 0 ? 'is-empty-day' : ''}`}>
      <p className="hero-kicker">{kicker}</p>
      <h1 className="hero-title">{wd}, <em>{day}&nbsp;{mo}</em></h1>
      {!muted && count > 0 && (
        <div className="hero-stats">
          <span className="stat"><strong>{count}</strong> {pluralizeShifts(count)}</span>
          <span className="sep"/>
          <span className="stat">
            <strong>{window.Data.formatDuration(totalMin || unconfirmedMin || 0)}</strong> работы
            {totalMin > 0 && unconfirmedMin > 0 && (
              <span className="hint">+ {window.Data.formatDuration(unconfirmedMin)} без&nbsp;подтверждения</span>
            )}
            {totalMin === 0 && unconfirmedMin > 0 && (
              <span className="hint">без подтверждения</span>
            )}
          </span>
          <span className="sep"/>
          <span className="stat"><strong>{facCount}</strong> {pluralizeFacilities(facCount)}</span>
        </div>
      )}
    </section>
  );
}

function pluralizeShifts(n) {
  const last = n % 10, last2 = n % 100;
  if (last === 1 && last2 !== 11) return 'смена';
  if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return 'смены';
  return 'смен';
}

function pluralizeFacilities(n) {
  const last = n % 10, last2 = n % 100;
  if (last === 1 && last2 !== 11) return 'объект';
  if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return 'объекта';
  return 'объектов';
}

// Правильное согласование «затронут{...} N ваш{...} смен{...}»
function affectedShiftsPhrase(n) {
  const last = n % 10, last2 = n % 100;
  if (last === 1 && last2 !== 11) return { verb: 'Затронута', noun: 'ваша смена' };
  if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return { verb: 'Затронуты', noun: 'ваши смены' };
  return { verb: 'Затронуто', noun: 'ваших смен' };
}

// ── Mode tabs (День / Лента) ────────────────────────────────────
// ── Week strip ──────────────────────────────────────────────────
function WeekStrip({ days, selectedDate, weekOffset, onSelect, onShift, onPick }) {
  const [pickerOpen, setPickerOpen] = _hs(false);
  const monthBtnRef = _hr(null);
  const popoverRef  = _hr(null);

  // Заголовок: «май» или «май — июнь» если окно покрывает два месяца.
  const monthsInView = [];
  const seenMonth = new Set();
  for (const d of days) {
    const m = new Date(d.date + 'T12:00:00').getMonth();
    if (!seenMonth.has(m)) {
      seenMonth.add(m);
      monthsInView.push(window.Data.RU_MONTHS[m]);
    }
  }
  const monthLabel = monthsInView.length === 1
    ? monthsInView[0]
    : monthsInView.join(' — ');

  // Outside click / Esc — закрывают попап.
  _he(() => {
    if (!pickerOpen) return;
    function onDown(e) {
      if (popoverRef.current?.contains(e.target)) return;
      if (monthBtnRef.current?.contains(e.target)) return;
      setPickerOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setPickerOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const handleDatePick = (iso) => {
    onPick?.(iso);
    setPickerOpen(false);
  };

  return (
    <div className="week-nav">
      <div className="week-head">
        <button
          ref={monthBtnRef}
          type="button"
          className={`month-label ${pickerOpen ? 'is-open' : ''}`}
          onClick={() => setPickerOpen(o => !o)}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          title="Выбрать дату"
        >
          <span>{monthLabel}</span>
          <span className="material-symbols-outlined">expand_more</span>
        </button>
        {weekOffset !== 0 && (
          <button
            type="button"
            className="ws-today"
            onClick={() => onShift?.('today')}
          >
            <span className="material-symbols-outlined">undo</span>
            к&nbsp;сегодня
          </button>
        )}

        {pickerOpen && (
          <DatePicker
            popoverRef={popoverRef}
            anchorDate={selectedDate}
            onSelect={handleDatePick}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>

      <div className="week-strip-row">
        <button
          type="button"
          className="ws-arrow"
          title="Предыдущая неделя"
          aria-label="Предыдущая неделя"
          onClick={() => onShift?.(-1)}
        >
          <span className="material-symbols-outlined">chevron_left</span>
        </button>

        <div className="week-strip">
          {days.map(d => (
            <button
              key={d.date}
              type="button"
              className={`wd ${d.hasShift ? 'has' : 'off'} ${d.isToday ? 'today' : ''} ${d.isSelected ? 'is-selected' : ''}`}
              onClick={() => onSelect?.(d.date)}
            >
              <span className="label">{d.wd}</span>
              <span className="num">{d.num}</span>
              <span className="dot"/>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="ws-arrow"
          title="Следующая неделя"
          aria-label="Следующая неделя"
          onClick={() => onShift?.(+1)}
        >
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>
    </div>
  );
}

// ── Date picker popover ─────────────────────────────────────────
// Things-style: «Сегодня» / «Завтра» quick-actions + календарь 4 недели
// с inline-ярлыком месяца у 1-го числа. Угловые ячейки сетки — навигация
// между «страницами» по 4 недели (◂ в первой ячейке, ▸ в последней).
// Звезда обозначает «сегодня»; выбранный день — accent-заливка.
function DatePicker({ popoverRef, anchorDate, onSelect, onClose }) {
  const todayIso = window.Data.TODAY_ISO;
  const today = new Date(todayIso + 'T12:00:00');
  const anchor = new Date(anchorDate + 'T12:00:00');

  // page = смещение страницы (в неделях, шаг 4). 0 — текущая страница,
  // начинающаяся с понедельника недели «сегодня».
  const [page, setPage] = _hs(() => {
    // Если anchorDate в другой странице — открываем сразу её.
    const dow = (today.getDay() + 6) % 7; // Пн=0 … Вс=6
    const todayMonOffset = -dow;
    const days = Math.round(
      (new Date(anchorDate + 'T12:00:00').getTime() - today.getTime()) / 86400000
    );
    return Math.floor((days - todayMonOffset) / 28);
  });

  const weeks = _hm(() => {
    // Понедельник недели «сегодня» в днях от сегодня.
    const dow = (today.getDay() + 6) % 7;
    const startOffset = -dow + page * 28;
    const out = [];
    let lastMonth = -1;
    for (let w = 0; w < 4; w++) {
      const row = [];
      for (let d = 0; d < 7; d++) {
        const offset = startOffset + w * 7 + d;
        const date = window.Data.isoOffset(offset);
        const dt = new Date(date + 'T12:00:00');
        const month = dt.getMonth();
        const showMonth = month !== lastMonth;
        lastMonth = month;
        row.push({
          date,
          num: dt.getDate(),
          monthShort: window.Data.RU_MONTHS[month].slice(0, 3),
          showMonth,
          isToday: date === todayIso,
          isSelected: date === anchorDate,
        });
      }
      out.push(row);
    }
    return out;
  }, [page, todayIso, anchorDate]);

  return (
    <div className="date-popover" ref={popoverRef} role="dialog" aria-label="Выбрать дату">
      <header className="dp-head">
        <span className="dp-title">Выбрать дату</span>
        <button type="button" className="dp-close" onClick={onClose} aria-label="Закрыть">
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>

      <div className="dp-quick">
        <button
          type="button"
          className={`dp-quick-row ${anchorDate === todayIso ? 'is-selected' : ''}`}
          onClick={() => onSelect(todayIso)}
        >
          <span className="material-symbols-outlined ic is-star">star</span>
          <span>Сегодня</span>
        </button>
        <button
          type="button"
          className={`dp-quick-row ${anchorDate === window.Data.isoOffset(1) ? 'is-selected' : ''}`}
          onClick={() => onSelect(window.Data.isoOffset(1))}
        >
          <span className="material-symbols-outlined ic is-tomorrow">wb_twilight</span>
          <span>Завтра</span>
        </button>
      </div>

      <div className="dp-cal">
        <div className="dp-cal-head">
          {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="dp-cal-body">
          {weeks.map((row, ri) => (
            <div key={ri} className="dp-cal-row">
              {row.map((d, di) => {
                // Угловые ячейки — навигация по страницам, чтобы не плодить
                // отдельные стрелки рядом с календарём.
                const isPrevSlot = ri === 0 && di === 0;
                const isNextSlot = ri === weeks.length - 1 && di === 6;
                if (isPrevSlot) {
                  return (
                    <button
                      key="prev"
                      type="button"
                      className="dp-cell is-nav"
                      onClick={() => setPage(p => p - 1)}
                      aria-label="Назад"
                    >
                      <span className="material-symbols-outlined">chevron_left</span>
                    </button>
                  );
                }
                if (isNextSlot) {
                  return (
                    <button
                      key="next"
                      type="button"
                      className="dp-cell is-nav"
                      onClick={() => setPage(p => p + 1)}
                      aria-label="Вперёд"
                    >
                      <span className="material-symbols-outlined">chevron_right</span>
                    </button>
                  );
                }
                return (
                  <button
                    key={d.date}
                    type="button"
                    className={`dp-cell ${d.isSelected ? 'is-selected' : ''} ${d.isToday ? 'is-today' : ''}`}
                    onClick={() => onSelect(d.date)}
                  >
                    {d.showMonth && <span className="mo">{d.monthShort}</span>}
                    {d.isToday && !d.isSelected
                      ? <span className="material-symbols-outlined num is-star">star</span>
                      : <span className="num">{d.num}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// (SiteCompareRow удалён — карточка теперь сразу показывает сайтовое окно)


// ──────────────────────────────────────────────────────────────────
// FacilityCard — карточка-на-объект (новый дизайн v2)
// Заменяет shift-centric Timeline в режиме «День». Одна карточка на
// объект, в неё кладутся ВСЕ сайтовые сессии этого объекта на дату;
// смены пользователя сворачиваются в footer-хинт «график 07:30–13:30».
// ──────────────────────────────────────────────────────────────────

function FacilityList({ shifts, today, date, nowMins, onPushEditor }) {
  // Группируем смены по объекту. Порядок карточек — по первому старту смены
  // на каждом объекте (стабильно и совпадает с восприятием «утро → вечер»).
  const groups = _hm(() => {
    const map = new Map();
    for (const s of shifts) {
      if (!map.has(s.facilityId)) map.set(s.facilityId, []);
      map.get(s.facilityId).push(s);
    }
    const entries = [];
    for (const [facilityId, shs] of map.entries()) {
      const sorted = shs.slice().sort(
        (a, b) => window.Data.toMinutes(a.start) - window.Data.toMinutes(b.start)
      );
      entries.push({
        facilityId,
        shifts: sorted,
        firstStart: window.Data.toMinutes(sorted[0].start),
      });
    }
    entries.sort((a, b) => a.firstStart - b.firstStart);
    return entries;
  }, [shifts]);

  if (!groups.length) {
    const isToday = date === today;
    const isTomorrow = date === window.Data.isoOffset(1);
    const dayLabel = isToday ? 'на сегодня' : isTomorrow ? 'на завтра' : 'на этот день';
    return (
      <section className="timeline">
        <div className="day-empty is-cta">
          <span className="material-symbols-outlined glyph">event_available</span>
          <p className="text">Смен&nbsp;<em>{dayLabel}</em>&nbsp;ещё нет.</p>
          <button type="button" className="day-empty-btn" onClick={() => onPushEditor()}>
            <span className="material-symbols-outlined">add</span>
            <span>Добавить смену</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="fc-list">
      {groups.map((g, i) => (
        <FacilityCard
          key={g.facilityId}
          facilityId={g.facilityId}
          shifts={g.shifts}
          today={today}
          date={date}
          nowMins={nowMins}
          idx={i}
          onPushEditor={onPushEditor}
        />
      ))}
    </section>
  );
}

function FacilityCard({ facilityId, shifts, today, date, nowMins, idx, onPushEditor }) {
  const fac = window.Data.getFacility(facilityId);
  const cached = window.Data.getCachedFacility(facilityId);
  const siteSessions = _hm(
    () => window.Data.getSiteSessionsForDay(facilityId, date),
    [facilityId, date]
  );
  // Sheet с детальной разбивкой по сессиям (тап по карточке).
  const [detailOpen, setDetailOpen] = _hs(false);

  // Состояние объекта на эту дату
  let closed = false;
  if (cached) {
    if (cached.dataQuality === 'closed') {
      closed = { notice: cached.notice };
    } else if (Array.isArray(cached.closureRanges)) {
      const hit = cached.closureRanges.find(r => date >= r.from && date <= r.to);
      if (hit) closed = { notice: hit.notice };
    }
  }
  const noData = cached && (cached.dataQuality === 'template' || cached.dataQuality === 'parse_error');
  const facOk = !closed && !noData && cached?.dataQuality === 'ok';

  // Окно карточки = объединение моих смен на объекте. Сессии вне окна
  // отбрасываем (только то, что попадает в моё время — это и есть смысл
  // карточки «что у меня происходит во время смены»).
  const myStart = Math.min(...shifts.map(s => window.Data.toMinutes(s.start)));
  const myEnd   = Math.max(...shifts.map(s => window.Data.toMinutes(s.end)));
  const winStart = myStart;
  const winEnd   = myEnd;

  // Только пересекающиеся с моим окном сессии.
  const overlapSessions = siteSessions.filter(ss =>
    window.Data.toMinutes(ss.start) < winEnd &&
    window.Data.toMinutes(ss.end)   > winStart
  );

  const onToday = date === today;

  // Строки sess-list: сессия → inner-break → сессия → ...
  // (только между смежными отображаемыми сессиями)
  const rows = [];
  for (let i = 0; i < overlapSessions.length; i++) {
    if (i > 0) {
      const gap = window.Data.toMinutes(overlapSessions[i].start)
                - window.Data.toMinutes(overlapSessions[i - 1].end);
      if (gap > 0) {
        rows.push({
          kind: 'brk',
          minutes: gap,
          label: window.Data.classifyBreak(gap, facilityId),
        });
      }
    }
    rows.push({ kind: 'sess', s: overlapSessions[i] });
  }

  // Хинт «график 07:30–13:30» — объединённый диапазон моих смен
  let schedHint;
  if (shifts.length === 1) {
    schedHint = `${shifts[0].start}–${shifts[0].end}`;
  } else {
    schedHint = `${window.Data.minutesToHHMM(myStart)}–${window.Data.minutesToHHMM(myEnd)}`;
  }

  // Pill: «по сайту» только если в моё окно реально что-то попадает.
  // Если сайт работает, но мои часы вне сетки → «нет на сайте».
  const haveSiteForDate = facOk && overlapSessions.length > 0;

  // Итого — сумма пересечений моих смен с overlap-сессиями.
  // Если в моё окно ничего из сайта не попало — schedMin (доверяем графику).
  let totalMin = 0;
  if (closed) {
    totalMin = 0;
  } else if (!haveSiteForDate) {
    totalMin = shifts.reduce((s, sh) =>
      s + (window.Data.toMinutes(sh.end) - window.Data.toMinutes(sh.start)), 0);
  } else {
    for (const sh of shifts) {
      const a = window.Data.toMinutes(sh.start);
      const b = window.Data.toMinutes(sh.end);
      for (const ss of overlapSessions) {
        const u = Math.max(a, window.Data.toMinutes(ss.start));
        const v = Math.min(b, window.Data.toMinutes(ss.end));
        if (v > u) totalMin += (v - u);
      }
    }
  }

  // Все клики по внутренним кнопкам должны останавливать propagation,
  // иначе тап по «график»/«ext» откроет ещё и detail-sheet (карта стала
  // кликабельной — см. onCardClick ниже).
  const openEditor = (e) => { e?.stopPropagation?.(); onPushEditor(shifts[0]); };
  const openSite = (e) => {
    e.stopPropagation();
    if (fac?.sourceUrl) window.open(fac.sourceUrl, '_blank', 'noopener');
  };
  const onCardClick = () => setDetailOpen(true);

  const cls = ['fc-card', `is-fac-${facilityId}`, `idx-${idx}`,
               closed ? 'is-closed' : '', 'is-tappable'].filter(Boolean).join(' ');

  return (
    <article className={cls} onClick={onCardClick} role="button" tabIndex={0}
             onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCardClick(); } }}>
      <div className="fc-watermark" aria-hidden="true">
        <span className="material-symbols-outlined">{fac?.icon || 'place'}</span>
      </div>

      <header className="fc-head">
        <div className="fc-titles">
          <p className="fc-place">{fac?.name}</p>
          {fac?.hint && <p className="fc-hint">{fac.hint}</p>}
        </div>
        {fac?.sourceUrl && (
          <button type="button" className="fc-ext" onClick={openSite}
                  title={`Открыть «${fac.name}» на сайте ПолесГУ`}
                  aria-label={`Открыть «${fac.name}» на сайте ПолесГУ`}>
            <span className="material-symbols-outlined">open_in_new</span>
          </button>
        )}
      </header>

      {closed ? (
        <div className="fc-closed-note">
          {closed.notice || 'на сайте объявление о приостановке работы.'}
        </div>
      ) : (
        <>
          <div className="fc-range">
            <span className="big">{window.Data.minutesToHHMM(winStart)}</span>
            <span className="arr">→</span>
            <span className="big">{window.Data.minutesToHHMM(winEnd)}</span>
          </div>

          {overlapSessions.length ? (
            <div className="fc-sess-list">
              {rows.map((r, i) => r.kind === 'sess'
                ? <SessionRow key={'s' + i} session={r.s} facilityId={facilityId}
                              nowMins={nowMins} onToday={onToday}/>
                : <SessionBreak key={'b' + i} minutes={r.minutes} label={r.label}
                                facilityId={facilityId}/>
              )}
            </div>
          ) : (
            <p className="fc-empty">
              {noData
                ? 'сайт ещё не сматчен — показываем ваш график'
                : siteSessions.length
                  ? 'в это время на сайте ничего'
                  : 'на эту дату на сайте ничего'}
            </p>
          )}
        </>
      )}

      <footer className="fc-foot">
        <span className="left">
          <span className={'fc-src-pill ' + (closed ? 'is-warn' : haveSiteForDate ? '' : 'is-mute')}>
            <span className="material-symbols-outlined">
              {closed ? 'event_busy' : haveSiteForDate ? 'verified' : facOk ? 'help_outline' : 'edit_note'}
            </span>
            {closed ? 'закрыт'
              : haveSiteForDate ? 'по сайту'
              : facOk ? 'нет на сайте'
              : 'по графику'}
          </span>
          <button type="button" className="fc-sched-hint" onClick={openEditor}
                  title="Редактировать смену">
            <span className="material-symbols-outlined">edit_calendar</span>
            <em>график</em>
            {schedHint}
          </button>
        </span>
        <span className="fc-total">
          {closed ? '— не отработано' : window.Data.formatDuration(totalMin)}
        </span>
      </footer>

      {detailOpen && (
        <FacilityDetailSheet
          facility={fac}
          sessions={siteSessions}
          closed={closed}
          dataQuality={cached?.dataQuality}
          isToday={onToday}
          nowMins={nowMins}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </article>
  );
}

// Bottom-sheet с детальной разбивкой сессий за день. Открывается тапом
// по карточке. Для большого бассейна показывает крупный индикатор
// дорожек на каждую сессию + текст «N свободно из 10, занято M». Для
// прочих объектов — просто time + activity. Закрывается по backdrop,
// крестику, Escape.
//
// ВАЖНО: используем createPortal в document.body. Без портала sheet
// рендерится внутри .fc-card, у которой есть transform в анимации
// fcRise — а transform создаёт containing block, и position:fixed
// перестаёт привязываться к viewport (header sheet'а обрезался рамкой
// карточки, backdrop не покрывал весь экран).
function FacilityDetailSheet({ facility, sessions, closed, dataQuality, isToday, nowMins, onClose }) {
  _he(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Прорастает наружу через bubble click — иначе onClick карточки снова
  // откроет sheet после backdrop click.
  const stop = (e) => e.stopPropagation();

  const sheet = (
    <div className="fd-sheet-root" role="dialog" aria-modal="true" aria-label={`Детали: ${facility?.name}`}
         onClick={stop}>
      <div className="fd-sheet-backdrop" onClick={onClose}/>
      <div className={`fd-sheet is-fac-${facility?.id || ''}`}>
        <header className="fd-sheet-head">
          <div className="fd-titles">
            {facility?.hint && <p className="kicker">{facility.hint}</p>}
            <h2>{facility?.name}</h2>
          </div>
          <button type="button" className="fd-close" onClick={onClose} aria-label="Закрыть">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {closed ? (
          <div className="fd-empty is-closed">
            <span className="material-symbols-outlined">event_busy</span>
            <p>{closed.notice || 'на сайте объявление о приостановке работы.'}</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="fd-empty">
            <span className="material-symbols-outlined">event_available</span>
            <p>{dataQuality === 'ok'
                ? 'на эту дату на сайте ничего не запланировано.'
                : 'сайт ещё не сматчен.'}</p>
          </div>
        ) : (
          <ul className="fd-sessions">
            {sessions.map((s, i) => {
              const ind = window.Data.inferSessionIndicator(facility.id, s.activity);
              const sStart = window.Data.toMinutes(s.start);
              const sEnd   = window.Data.toMinutes(s.end);
              const isNow  = isToday && sStart <= nowMins && sEnd > nowMins;
              const isPast = isToday && sEnd <= nowMins;
              return (
                <li key={i} className={`fd-row ${isNow ? 'is-now' : ''} ${isPast ? 'is-past' : ''}`}>
                  <div className="fd-tm">{s.start}<span className="dash">—</span>{s.end}</div>
                  <div className="fd-body">
                    {ind?.type === 'lanes' && (
                      <div className="fd-lanes-row">
                        <SessionIndicator ind={ind}/>
                        <span className="fd-lanes-txt">
                          <strong>{ind.free}</strong> свободно
                          {ind.occupied?.length > 0 && (
                            <> · занято <strong>{ind.occupied.length}</strong></>
                          )}
                          {ind.occupied?.length === 0 && ' · весь бассейн'}
                        </span>
                      </div>
                    )}
                    {ind?.type === 'lanes-free' && (
                      <div className="fd-lanes-row">
                        <SessionIndicator ind={ind}/>
                        <span className="fd-lanes-txt">без разделения дорожек</span>
                      </div>
                    )}
                    {s.activity && <p className="fd-act">{s.activity}</p>}
                    {!s.activity && ind?.type !== 'lanes' && ind?.type !== 'lanes-free' && (
                      <p className="fd-act fd-act-muted">без описания на сайте</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {facility?.sourceUrl && (
          <a className="fd-source" href={facility.sourceUrl}
             target="_blank" rel="noopener noreferrer" onClick={stop}>
            <span className="material-symbols-outlined">open_in_new</span>
            <span>открыть на сайте ПолесГУ</span>
          </a>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(sheet, document.body);
}

function SessionRow({ session, facilityId, nowMins, onToday }) {
  const start = window.Data.toMinutes(session.start);
  const end = window.Data.toMinutes(session.end);
  const isNow = onToday && start <= nowMins && end > nowMins;
  const isPast = onToday && end <= nowMins;
  const ind = window.Data.inferSessionIndicator(facilityId, session.activity);
  // Активность не показываем в строке — индикатор справа несёт смысл
  // (дорожки / зона / группа). Полное описание остаётся в tooltip.
  return (
    <div className={'fc-sess' + (isNow ? ' is-now' : '') + (isPast ? ' is-past' : '')}
         title={session.activity || undefined}>
      <span className="fc-tm">{session.start} — {session.end}</span>
      {ind && (
        <span className="fc-ind">
          <SessionIndicator ind={ind}/>
        </span>
      )}
    </div>
  );
}

function SessionBreak({ minutes, label, facilityId }) {
  const isResurface = label === 'заливка льда';
  const cls = 'fc-sess-brk' + (isResurface ? ' is-resurface' : '');
  const glyph = isResurface ? 'water_drop' : 'more_horiz';
  return (
    <div className={cls}>
      <span className="glyph"><span className="material-symbols-outlined">{glyph}</span></span>
      <span className="label">
        <strong>{label}</strong>
        {window.Data.formatDuration(minutes)}
      </span>
      <span className="rule"/>
    </div>
  );
}

function SessionIndicator({ ind }) {
  if (!ind) return null;
  if (ind.type === 'lanes') {
    const total = ind.total || 10;
    const occupied = new Set(ind.occupied || []);
    const free = ind.free != null ? ind.free : (total - occupied.size);
    const allFree = occupied.size === 0;
    // Bright (facility-color) = занятая дорожка (тренировкой/закрытая).
    // Muted = свободная для посетителя.
    const bars = [];
    for (let i = 0; i < total; i++) {
      bars.push(<span key={i} className={'l' + (occupied.has(i) ? ' occ' : '')}/>);
    }
    return (
      <span className={'fc-lanes' + (allFree ? ' is-full' : '')}
            title={`${free} свободно из ${total}`}>
        {bars}
        <span className="count">{free}/{total}</span>
      </span>
    );
  }
  if (ind.type === 'lanes-free') {
    return (
      <span className="fc-lanes-free">
        <span className="material-symbols-outlined">waves</span>
        бескрайний
      </span>
    );
  }
  if (ind.type === 'group') {
    return (
      <span className="fc-group-chip" title={ind.label}>
        <span className="material-symbols-outlined">{ind.icon || 'groups'}</span>
        {ind.label}
      </span>
    );
  }
  if (ind.type === 'zone') {
    return (
      <span className="fc-zone-chip" title={ind.label}>
        <span className="material-symbols-outlined">{ind.icon || 'fitness_center'}</span>
        {ind.label}
      </span>
    );
  }
  return null;
}

function AddShiftInlineLink({ date, onPush }) {
  const label = date === window.Data.TODAY_ISO ? 'добавить смену сегодня'
    : date === window.Data.isoOffset(1) ? 'добавить смену на завтра'
    : 'добавить смену на этот день';
  return (
    <button type="button" className="add-shift-link" onClick={onPush}>
      <span className="plus">+</span>
      <span>{label}</span>
      <span className="material-symbols-outlined arrow">arrow_forward</span>
    </button>
  );
}

// ── Bottom site-check card ──────────────────────────────────────
//
// affectedCount считается в HomeScreen НА ЛЕТУ против текущих shifts,
// а не из сохранённого events.filter(e => e.affectsShiftId): юзер мог
// удалить смену (orphan ссылка) или добавить смену уже после
// recordSiteCheck (overlap есть, affectsShiftId — нет). Поэтому
// affectedCount приходит prop'ом, а не вычисляется здесь.
//
// checkedAt: предпочитаем loadCachedAt() (метку последнего fetchSchedule)
// над change.checkedAt — у unreadChange может быть СТАРЫЙ checkedAt,
// если с момента события было несколько quiet-проверок, и тогда юзер
// видел «проверено 1 ч назад» при только что прошедшей проверке.
//
// onAck (опциональный) — рендерим ✓-кнопку справа: одним тапом отметить
// запись просмотренной, без перехода в ChangesScreen. Сразу после ack
// unreadChange становится null → плашка уезжает в самый низ страницы.
// Чтобы внутренняя кнопка не нарушала HTML (button-в-button нельзя),
// outer — article, body — отдельная button.
function SiteCard({ change, affectedCount = 0, onClick, onAck }) {
  const hasUnread = Boolean(change);
  const checkedAt = window.Data.loadCachedAt() || change?.checkedAt;
  const eventsLen = change?.events?.length || 0;
  const affectsMe = affectedCount > 0;
  const showAck = Boolean(onAck && hasUnread);
  let head;
  if (!hasUnread) {
    head = <>Все источники сматчены, изменений <em>не найдено</em></>;
  } else if (affectsMe) {
    const p = affectedShiftsPhrase(affectedCount);
    head = <>{p.verb} <em>{affectedCount}</em> {p.noun}</>;
  } else if (eventsLen === 0 && change.hasSourceIssues) {
    // Запись unread только из-за sourceIssues — реальных событий нет.
    // Раньше тут отрисовывалось «Есть события — 0 событий, ваши смены
    // не тронуты» (баг #2 аудита).
    head = <>Один из <em>источников не ответил</em></>;
  } else {
    head = <>Есть события — <em>{eventsLen}</em> {pluralizeEvents(eventsLen)}, ваши смены не тронуты</>;
  }
  const checkedText = checkedAt
    ? `проверено ${window.Data.formatRelativeMinutes(checkedAt)}`
    : 'ещё не проверено';
  const icon = affectsMe ? 'event_busy' : hasUnread ? 'compare_arrows' : 'sync';
  return (
    <article
      className={`site-card ${hasUnread ? 'is-attention' : ''} ${affectsMe ? 'is-important' : ''} ${showAck ? 'has-ack' : ''}`}
    >
      <button type="button" className="site-card-main" onClick={onClick}>
        <div className="icon-cell">
          <span className="material-symbols-outlined">{icon}</span>
        </div>
        <div className="body">
          <p className="kicker">Проверка сайта · <span className="meta">{checkedText}</span></p>
          <p className="head">{head}</p>
        </div>
        {!showAck && <span className="material-symbols-outlined arrow">chevron_right</span>}
      </button>
      {showAck && (
        <button
          type="button"
          className="site-card-ack"
          onClick={onAck}
          title="Отметить просмотренным"
          aria-label="Отметить просмотренным"
        >
          <span className="material-symbols-outlined">done</span>
        </button>
      )}
    </article>
  );
}

function pluralizeEvents(n) {
  const last = n % 10, last2 = n % 100;
  if (last === 1 && last2 !== 11) return 'событие';
  if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return 'события';
  return 'событий';
}

// ── Empty / caught-up states ────────────────────────────────────
function EmptyState({ kind, lastDate, onAdd, onImport }) {
  const isFirstRun = kind === 'first_run';
  const lastDateText = lastDate
    ? new Date(lastDate + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    : '';
  return (
    <section className="empty-state">
      <div className="empty-mark" aria-hidden="true">
        <span className="material-symbols-outlined">{isFirstRun ? 'calendar_clock' : 'check_circle'}</span>
      </div>
      <p className="empty-kicker">{isFirstRun ? 'Первый запуск' : 'Графика на сегодня нет'}</p>
      <h1 className="empty-title">
        {isFirstRun
          ? <>График&nbsp;пока<br/><em>пустой</em>.</>
          : <>Вы прошли<br/><em>весь записанный график</em>.</>}
      </h1>
      <p className="empty-lede">
        {isFirstRun
          ? <>Загрузите <strong>резервный JSON</strong>, если вы уже вели смены раньше,&nbsp;— либо начните с первой смены вручную.</>
          : <>Последняя смена была <strong>{lastDateText}</strong>. Добавьте новые смены или загрузите свежий JSON.</>}
      </p>
      <div className="empty-actions">
        <button className="empty-btn" type="button" onClick={onAdd}>
          <span className="material-symbols-outlined">add</span>
          <span>{isFirstRun ? 'Добавить первую смену' : 'Добавить смену'}</span>
        </button>
        <button className="empty-btn secondary" type="button" onClick={onImport}>
          <span className="material-symbols-outlined">upload_file</span>
          <span>Загрузить JSON</span>
        </button>
      </div>
      {isFirstRun && (
        <ol className="empty-list">
          <li><span className="num">i.</span><span><em>JSON</em>&nbsp;— экспорт из этого приложения на другом устройстве.</span></li>
          <li><span className="num">ii.</span><span>После первой смены появится <em>сверка</em> со сменами на сайте.</span></li>
          <li><span className="num">iii.</span><span>Можно добавлять поодиночке или <em>серией по дням недели</em>.</span></li>
        </ol>
      )}
      <p className="empty-aside">всё хранится локально</p>
    </section>
  );
}

// ── JSON import via hidden file input ──────────────────────────
function triggerImport(toast, setShifts, setChanges) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const res = window.Data.importJSON(text);
      setShifts(window.Data.loadShifts());
      setChanges(window.Data.loadSiteChanges());
      const parts = [];
      if (res.importedShifts) parts.push(`${res.importedShifts} ${pluralizeShifts(res.importedShifts)}`);
      if (res.skippedShifts)  parts.push(`пропущено ${res.skippedShifts}`);
      if (!res.importedShifts && !res.skippedShifts && res.importedChanges) parts.push('журнал сверок');
      toast.show(parts.length ? `Загружено: ${parts.join(', ')}` : 'Файл прочитан, но смен не найдено');
    } catch (e) {
      toast.show('Не удалось прочитать файл');
    }
  };
  input.click();
}

const useMemo = _hm;
window.HomeScreen = HomeScreen;
