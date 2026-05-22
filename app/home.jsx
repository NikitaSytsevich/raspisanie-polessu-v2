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
  const [mode, setMode]       = _hs('day'); // 'day' | 'feed'
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
  _he(() => {
    let cancelled = false;
    window.Data.fetchSchedule().then(() => {
      if (!cancelled) {
        setChanges(window.Data.loadSiteChanges());
        force(x => x + 1);
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

  const rows = _hm(() => window.Data.buildTimelineForDate(shifts, selectedDate), [shifts, selectedDate]);

  // Один проход через computeEffectiveShift на день: { shift, eff } для всех
  // смен. Раньше функцию звали отдельно в Hero (totalMin), в currentNow и
  // потом в каждом ShiftCard — три раза на одну смену. Теперь карты строим
  // здесь и прокидываем готовые eff внутрь.
  const dayEffShifts = _hm(
    () => dayShifts.map(s => ({ shift: s, eff: window.Data.computeEffectiveShift(s) })),
    [dayShifts]
  );
  const effById = _hm(() => {
    const m = new Map();
    for (const e of dayEffShifts) m.set(e.shift.id, e.eff);
    return m;
  }, [dayEffShifts]);

  // Hero stats — суммируем «фактическое» время по сайту.
  // Подтверждённые смены идут в totalMin; неподтверждённые (нет данных или
  // объект работает, но в это окно ничего) — в unconfirmedMin как контекст.
  const { totalMin, unconfirmedMin, facCount } = _hm(() => {
    let t = 0, u = 0;
    const facs = new Set();
    for (const { shift: s, eff: e } of dayEffShifts) {
      facs.add(s.facilityId);
      if (e.badge === 'closed') continue;
      if (e.badge === 'confirmed') t += e.minutes;
      else u += e.minutes;
    }
    return { totalMin: t, unconfirmedMin: u, facCount: facs.size };
  }, [dayEffShifts]);

  // Current "now" shift — only when looking at today.
  // При пересечении смен берём ту, что началась **позже** — пользователь
  // физически на одном объекте, и в момент старта более поздней смены
  // переходит туда. Если объект закрыт — пропускаем.
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const currentNow = isToday
    ? [...dayEffShifts]
        .sort((a, b) => window.Data.toMinutes(b.eff.start) - window.Data.toMinutes(a.eff.start))
        .find(({ eff }) => {
          if (eff.badge === 'closed') return false;
          const start = window.Data.toMinutes(eff.start);
          const end   = window.Data.toMinutes(eff.end);
          return start <= nowMins && end > nowMins;
        })
    : null;

  // Site-changes summary (latest unread)
  const unreadChange = changes.find(c => !c.acknowledgedAt && (c.hasChanges || c.hasSourceIssues));

  // Pull-to-refresh handler (один и тот же путь и для кнопки в шапке,
  // и для PTR-жеста). Дополнительно тикает refreshing-флаг для анимации
  // в кнопке шапки.
  const handleRefresh = _hcb(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await window.Data.fetchSchedule({ force: true });
      toast.show('Сайт сверён');
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
  _he(() => {
    const today = window.Data.TODAY_ISO;
    const t = new Date(today + 'T12:00:00').getTime();
    const s = new Date(selectedDate + 'T12:00:00').getTime();
    const dayDiff = Math.round((s - t) / 86400000);
    // Текущее окно покрывает [-1+offset*7 ... +5+offset*7]
    const lo = -1 + weekOffset * 7;
    const hi =  5 + weekOffset * 7;
    if (dayDiff < lo || dayDiff > hi) {
      // ближайший offset, при котором dayDiff попадает в [-1..5]
      const newOffset = Math.round((dayDiff - 2) / 7);
      setWeekOffset(newOffset);
    }
  }, [selectedDate, weekOffset]);

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
                  SiteCard вверх, чтобы пользователь сразу увидел проблему. */}
              {unreadChange?.affectsMe && (
                <SiteCard change={unreadChange} onClick={() => router.push('changes')}/>
              )}
              <ModeTabs mode={mode} onChange={setMode}/>
              {mode === 'day' ? (
                <>
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
                  {currentNow && <NowStrip shift={currentNow.shift} eff={currentNow.eff}/>}
                  <Timeline
                    rows={rows}
                    today={today}
                    date={selectedDate}
                    nowMins={nowMins}
                    currentShiftId={currentNow?.shift?.id}
                    effById={effById}
                    onAddDay={() => router.push('editor', { date: selectedDate })}
                  />
                  {rows.length > 0 && (
                    <AddShiftInlineLink date={selectedDate} onPush={() => router.push('editor', { date: selectedDate })}/>
                  )}
                </>
              ) : (
                <Feed shifts={shifts} today={today} nowMins={nowMins} currentShiftId={currentNow?.shift?.id} onPickDate={(d) => { setSelectedDate(d); setMode('day'); }}/>
              )}
              {!unreadChange?.affectsMe && (
                <SiteCard change={unreadChange} onClick={() => router.push('changes')}/>
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
function ModeTabs({ mode, onChange }) {
  return (
    <div className="mode-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'day'}
        className={`mode-tab ${mode === 'day' ? 'is-active' : ''}`}
        onClick={() => onChange('day')}
      >
        День
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'feed'}
        className={`mode-tab ${mode === 'feed' ? 'is-active' : ''}`}
        onClick={() => onChange('feed')}
      >
        Лента
      </button>
    </div>
  );
}

// ── Feed (все смены, сгруппированные по датам) ──────────────────
function Feed({ shifts, today, nowMins, currentShiftId, onPickDate }) {
  const groups = _hm(() => {
    const byDate = new Map();
    for (const s of shifts) {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(s);
    }
    const dates = Array.from(byDate.keys()).sort();
    const future = dates.filter(d => d >= today);
    const past   = dates.filter(d => d <  today).reverse();
    return [...future, ...past].map(date => {
      const dayShifts = byDate.get(date).sort((a, b) =>
        window.Data.toMinutes(a.start) - window.Data.toMinutes(b.start));
      return {
        date,
        shifts: dayShifts,
        siteMin: dayShifts.reduce((sum, s) => {
          const e = window.Data.computeEffectiveShift(s);
          return e.badge === 'confirmed' ? sum + e.minutes : sum;
        }, 0),
      };
    });
  }, [shifts, today]);

  if (!groups.length) {
    return <div className="feed-empty">Смен пока нет.</div>;
  }
  return (
    <section className="feed">
      {groups.map(g => {
        const d = new Date(g.date + 'T12:00:00');
        const wd = window.Data.RU_WEEKDAYS_SHORT[d.getDay()];
        const dayNum = d.getDate();
        const mo = window.Data.RU_MONTHS[d.getMonth()];
        let kicker = null;
        if (g.date === today) kicker = 'сегодня';
        else if (g.date === window.Data.isoOffset(1))  kicker = 'завтра';
        else if (g.date === window.Data.isoOffset(-1)) kicker = 'вчера';
        return (
          <div key={g.date} className={`feed-day ${g.date < today ? 'is-past' : ''}`}>
            <button type="button" className="feed-day-head" onClick={() => onPickDate?.(g.date)}>
              {kicker && <span className="kicker">{kicker}</span>}
              <span className="date">{wd}, {dayNum}&nbsp;{mo}</span>
              <span className="meta">
                {g.shifts.length}&nbsp;{pluralizeShifts(g.shifts.length)}
                {g.siteMin > 0 && <> · {window.Data.formatDuration(g.siteMin)}</>}
              </span>
            </button>
            {g.shifts.map(s => (
              <ShiftCard
                key={s.id}
                shift={s}
                nowMins={nowMins}
                today={today}
                date={g.date}
                variant="feed"
                currentShiftId={currentShiftId}
              />
            ))}
          </div>
        );
      })}
    </section>
  );
}

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

  const handleMonthPick = (year, monthIdx) => {
    const todayIso = window.Data.TODAY_ISO;
    const t = new Date(todayIso + 'T12:00:00');
    let targetIso;
    if (t.getFullYear() === year && t.getMonth() === monthIdx) {
      targetIso = todayIso;
    } else {
      const sel = new Date(selectedDate + 'T12:00:00');
      // Сохраняем число — с поправкой на короткие месяцы (31 янв → 28/29 фев).
      const day = Math.min(sel.getDate(), daysInMonth(year, monthIdx));
      targetIso = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    onPick?.(targetIso);
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
          title="Выбрать месяц"
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
          <MonthPicker
            popoverRef={popoverRef}
            anchorDate={selectedDate}
            onSelect={handleMonthPick}
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

function daysInMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate();
}

// ── Month picker popover ────────────────────────────────────────
function MonthPicker({ popoverRef, anchorDate, onSelect }) {
  const todayIso = window.Data.TODAY_ISO;
  const today = new Date(todayIso + 'T12:00:00');
  const todayY = today.getFullYear();
  const todayM = today.getMonth();
  const anchor = new Date(anchorDate + 'T12:00:00');

  const [viewYear, setViewYear] = _hs(anchor.getFullYear());

  return (
    <div className="month-popover" ref={popoverRef} role="dialog" aria-label="Выбор месяца">
      <div className="month-popover-head">
        <button
          type="button"
          className="month-popover-nav"
          onClick={() => setViewYear(y => y - 1)}
          aria-label="Предыдущий год"
        >
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <span className="month-popover-year">{viewYear}</span>
        <button
          type="button"
          className="month-popover-nav"
          onClick={() => setViewYear(y => y + 1)}
          aria-label="Следующий год"
        >
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>
      <div className="month-popover-grid">
        {window.Data.RU_MONTHS.map((name, i) => {
          const isCurrent = viewYear === todayY && i === todayM;
          const isSelected = viewYear === anchor.getFullYear() && i === anchor.getMonth();
          return (
            <button
              key={i}
              type="button"
              className={`month-cell ${isSelected ? 'is-selected' : ''} ${isCurrent ? 'is-today' : ''}`}
              onClick={() => onSelect(viewYear, i)}
            >
              {name.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Now strip ───────────────────────────────────────────────────
function NowStrip({ shift, eff }) {
  const fac = window.Data.getFacility(shift.facilityId);
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const left = window.Data.toMinutes(eff.end) - nowMins;
  const leftText = left <= 1 ? 'менее минуты' : window.Data.formatDuration(left);
  // Берём первые два сегмента активности до « · » — обычно это «название · подзаголовок».
  const parts = (eff.activity || shift.activity || '')
    .split('·').map(s => s.trim()).filter(Boolean);
  const label = parts.slice(0, 2).join(' · ') || fac?.name || '';
  return (
    <div className="now-strip">
      <span className="pulse"/>
      <div className="body">
        <span className="label">сейчас · {new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span>
        <span className="title">{label}{fac?.name && !label.includes(fac.name) ? ` · ${fac.name}` : ''}</span>
      </div>
      <span className="countdown">осталось&nbsp;<strong>{leftText}</strong></span>
    </div>
  );
}

// ── Timeline ────────────────────────────────────────────────────
function Timeline({ rows, today, date, nowMins, currentShiftId, effById, onAddDay }) {
  if (!rows.length) {
    const isToday = date === today;
    const isTomorrow = date === window.Data.isoOffset(1);
    const dayLabel = isToday ? 'на сегодня' : isTomorrow ? 'на завтра' : 'на этот день';
    return (
      <section className="timeline">
        <div className="day-empty is-cta">
          <span className="material-symbols-outlined glyph">event_available</span>
          <p className="text">Смен&nbsp;<em>{dayLabel}</em>&nbsp;ещё нет.</p>
          {onAddDay && (
            <button type="button" className="day-empty-btn" onClick={onAddDay}>
              <span className="material-symbols-outlined">add</span>
              <span>Добавить смену</span>
            </button>
          )}
        </div>
      </section>
    );
  }
  return (
    <section className="timeline">
      {rows.map((r, i) => r.kind === 'shift'
        ? <ShiftCard key={r.shift.id} shift={r.shift} eff={effById?.get(r.shift.id)} nowMins={nowMins} today={today} date={date} currentShiftId={currentShiftId}/>
        : <BreakDivider key={`brk-${i}`} br={r}/>
      )}
    </section>
  );
}

function ShiftCard({ shift, eff: effProp, nowMins, today, date, variant, currentShiftId }) {
  const fac = window.Data.getFacility(shift.facilityId);
  // eff может прийти готовым из родителя (Timeline/Feed считают карту один
  // раз на день, чтобы не звать computeEffectiveShift трижды на смену).
  const eff = effProp || window.Data.computeEffectiveShift(shift);
  const start = window.Data.toMinutes(eff.start);
  const end   = window.Data.toMinutes(eff.end);
  const onToday = date === today;
  const hasClosed = eff.badge === 'closed';
  // Подсветка «сейчас» — только для смены, выбранной верхним уровнем
  // (HomeScreen → currentNow). При пересечении смен это гарантирует, что
  // подсвечена ровно одна карточка — та же, что в NowStrip.
  const isNow  = currentShiftId != null
    ? shift.id === currentShiftId
    : onToday && !hasClosed && start <= nowMins && end > nowMins;
  const isPast = (date < today) || (onToday && end <= nowMins);
  const isSite = shift.source === 'site';
  const activity = eff.activity || shift.activity;
  const dur = window.Data.formatDuration(eff.minutes);

  // Сопоставление пользовательской смены с реальным расписанием сайта
  const gapsNote = eff.gaps?.length
    ? `· с перерыв${eff.gaps.length > 1 ? 'ами' : 'ом'} ${eff.gaps.map(g => window.Data.formatDuration(g.minutes)).join(' + ')}`
    : null;

  const cls = [
    'seg',
    variant === 'feed' ? 'seg--feed' : '',
    isSite ? 'is-site' : 'is-personal',
    isNow ? 'is-now' : '',
    isPast ? 'is-past' : '',
    hasClosed ? 'has-closed' : '',
  ].filter(Boolean).join(' ');

  let pill;
  if (hasClosed) {
    pill = { icon: 'event_busy', text: 'объект закрыт', mod: 'is-warn' };
  } else if (eff.badge === 'not_in_site') {
    pill = { icon: 'help_outline', text: 'нет на сайте', mod: '' };
  } else if (eff.badge === 'confirmed') {
    pill = { icon: 'verified', text: 'по сайту', mod: 'is-ok' };
  } else if (false) {
    pill = { icon: 'verified', text: 'по сайту', mod: '' };
  } else {
    pill = { icon: 'edit_note', text: 'по графику', mod: '' };
  }

  return (
    <article className={cls}>
      <div className="card">
        <header className="card-cover">
          <div className="time">
            <span className="from">{eff.start}</span>
            <span className="to">— {eff.end}</span>
            {gapsNote && <span className="gaps-note">{gapsNote}</span>}
          </div>
          {fac?.sourceUrl && (
            <a className="cover-site-btn"
               href={fac.sourceUrl}
               target="_blank"
               rel="noopener noreferrer"
               onClick={(e) => e.stopPropagation()}
               title={`Открыть страницу «${fac.name}» на сайте ПолесГУ`}
               aria-label={`Открыть «${fac.name}» на сайте ПолесГУ`}>
              <span className="material-symbols-outlined">open_in_new</span>
            </a>
          )}
          {(eff.start !== shift.start || eff.end !== shift.end) && !hasClosed && (
            <span className="schedule-hint" title="Время по вашему графику">
              <span className="material-symbols-outlined">edit_note</span>
              {shift.start}&ndash;{shift.end}
            </span>
          )}
        </header>

        {hasClosed ? (
          <div className="card-body is-closed-body">
            <p className="place">{fac?.name}</p>
            <p className="closed-note">{eff.notice || 'на сайте объявление о приостановке работы.'}</p>
          </div>
        ) : (
          <div className="card-body">
            <p className="place">{fac?.name}</p>
            {activity && <p className="activity">{activity}</p>}
          </div>
        )}

        <footer className="card-footer">
          <span className={`status ${pill.mod}`}>
            <span className="material-symbols-outlined">{pill.icon}</span>
            {pill.text}
          </span>
          <span className="duration">
            {hasClosed ? '— не отработано' : dur}
          </span>
        </footer>
      </div>
    </article>
  );
}

// (SiteCompareRow удалён — карточка теперь сразу показывает сайтовое окно)
function _SiteCompareRowRemoved({ cmp, shift }) {
  if (cmp.state === 'closed') {
    return (
      <div className="site-compare is-closed">
        <span className="material-symbols-outlined">event_busy</span>
        <div className="body">
          <p className="kicker">объект закрыт</p>
          <p className="text">{cmp.notice || 'на сайте сейчас объявление о приостановке работы.'}</p>
        </div>
      </div>
    );
  }
  // Если у всех сеансов одна активность — не повторяем в каждом slot,
  // чтобы не плодить визуальный шум.
  const acts = Array.from(new Set(cmp.siteSessions.map(s => s.activity).filter(Boolean)));
  const sharedActivity = acts.length === 1;
  return (
    <div className="site-compare is-mismatch">
      <span className="material-symbols-outlined">compare_arrows</span>
      <div className="body">
        <p className="kicker">по сайту в этот день</p>
        <ul className="slots">
          {cmp.siteSessions.map((s, i) => {
            const overlap = window.Data.toMinutes(s.start) < window.Data.toMinutes(shift.end)
              && window.Data.toMinutes(s.end) > window.Data.toMinutes(shift.start);
            return (
              <li key={i} className={overlap ? 'is-overlap' : ''}>
                <span className="tm">{s.start}&ndash;{s.end}</span>
                {!sharedActivity && s.activity && <span className="act">{s.activity}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function BreakDivider({ br }) {
  const cls = ['brk'];
  if (br.label === 'заливка льда') cls.push('is-ice');
  if (br.crossFacility) cls.push('is-cross');
  const labelText = br.crossFacility
    ? `${window.Data.getFacility(br.prevFacility)?.name} → ${window.Data.getFacility(br.nextFacility)?.name}`
    : `${br.from} — ${br.to}`;
  return (
    <div className={cls.join(' ')}>
      <div className="brk-spine">{window.Data.formatDuration(br.minutes)}</div>
      <div className="brk-line">
        <span className="label"><strong>{br.crossFacility ? 'переход' : br.label}</strong>{labelText}</span>
        <span className="rule"/>
      </div>
    </div>
  );
}

// ── Inline add link ─────────────────────────────────────────────
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
function SiteCard({ change, onClick }) {
  const hasUnread = Boolean(change);
  const checkedAt = change?.checkedAt || window.Data.loadCachedAt();
  const affectedCount = change?.events?.filter(e => e.affectsShiftId).length || 0;
  const affectsMe = affectedCount > 0;
  let head;
  if (!hasUnread) {
    head = <>Все источники сматчены, изменений <em>не найдено</em></>;
  } else if (affectsMe) {
    const p = affectedShiftsPhrase(affectedCount);
    head = <>{p.verb} <em>{affectedCount}</em> {p.noun}</>;
  } else {
    const total = change.events?.length || 0;
    head = <>Есть события — <em>{total}</em> {pluralizeEvents(total)}, ваши смены не тронуты</>;
  }
  const checkedText = checkedAt
    ? `проверено ${window.Data.formatRelativeMinutes(checkedAt)}`
    : 'ещё не проверено';
  const icon = affectsMe ? 'event_busy' : hasUnread ? 'compare_arrows' : 'sync';
  return (
    <button
      className={`site-card ${hasUnread ? 'is-attention' : ''} ${affectsMe ? 'is-important' : ''}`}
      onClick={onClick}
    >
      <div className="icon-cell">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div className="body">
        <p className="kicker">Проверка сайта · <span className="meta">{checkedText}</span></p>
        <p className="head">{head}</p>
      </div>
      <span className="material-symbols-outlined arrow">chevron_right</span>
    </button>
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
      window.Data.importJSON(text);
      setShifts(window.Data.loadShifts());
      setChanges(window.Data.loadSiteChanges());
      toast.show('JSON загружен');
    } catch (e) {
      toast.show('Не удалось прочитать файл');
    }
  };
  input.click();
}

const useMemo = _hm;
window.HomeScreen = HomeScreen;
