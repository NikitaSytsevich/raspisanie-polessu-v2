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
  const [_, force]            = _hs(0);
  const scrollRef             = _hr(null);

  // Re-render every minute so "now" status stays accurate
  _he(() => {
    const t = setInterval(() => force(x => (x + 1) | 0), 60_000);
    return () => clearInterval(t);
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
        force(x => (x + 1) | 0);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const today = window.Data.TODAY_ISO;
  const isToday = selectedDate === today;
  const dayShifts = _hm(() => shifts.filter(s => s.date === selectedDate), [shifts, selectedDate]);
  const allDates = _hm(() => Array.from(new Set(shifts.map(s => s.date))).sort(), [shifts]);

  // Empty-state detection (based on the whole library, not the selected day)
  let state = 'normal';
  if (!shifts.length) state = 'empty';
  else if (!shifts.some(s => s.date >= today)) state = 'caught_up';

  const rows = _hm(() => window.Data.buildTimelineForDate(shifts, selectedDate), [shifts, selectedDate]);

  // Hero stats — суммируем «фактическое» время по сайту.
  // Подтверждённые смены идут в totalMin; неподтверждённые (нет данных или
  // объект работает, но в это окно ничего) — в unconfirmedMin как контекст.
  let totalMin = 0;
  let unconfirmedMin = 0;
  for (const s of dayShifts) {
    const e = window.Data.computeEffectiveShift(s);
    if (e.badge === 'closed') continue;
    if (e.badge === 'confirmed') totalMin += e.minutes;
    else unconfirmedMin += e.minutes;
  }
  const facCount = new Set(dayShifts.map(s => s.facilityId)).size;

  // Current "now" shift — only when looking at today
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const currentShift = isToday ? dayShifts.find(s =>
    window.Data.toMinutes(s.start) <= nowMins && window.Data.toMinutes(s.end) > nowMins) : null;

  // Site-changes summary (latest unread)
  const unreadChange = changes.find(c => !c.acknowledgedAt && (c.hasChanges || c.hasSourceIssues));

  // Pull-to-refresh handler
  const handleRefresh = _hcb(async () => {
    await window.Data.fetchSchedule({ force: true });
    toast.show('Сайт сверён');
    setShifts(window.Data.loadShifts());
    setChanges(window.Data.loadSiteChanges());
  }, [toast]);

  // Week strip — today ± few days; selected one highlighted
  const weekDays = _hm(() => {
    const arr = [];
    for (let i = -1; i <= 5; i++) {
      const date = window.Data.isoOffset(i);
      const d = new Date(date + 'T12:00:00');
      arr.push({
        date,
        wd: window.Data.RU_WEEKDAYS_SHORT[d.getDay()],
        num: d.getDate(),
        isToday: i === 0,
        isSelected: date === selectedDate,
        hasShift: shifts.some(s => s.date === date),
      });
    }
    return arr;
  }, [shifts, selectedDate]);

  return (
    <div className="screen home-screen">
      <window.UI.StatusBar/>

      <window.UI.AppHeader
        title="Расписание"
        meta={(() => {
          const at = window.Data.loadCachedAt();
          return at ? `обновлено ${window.Data.formatRelativeMinutes(at)}` : 'ещё не загружено';
        })()}
        right={
          <>
            <window.UI.IconBtn icon="edit_calendar" title="Редактор смен" onClick={() => router.push('editor')}/>
            <window.UI.IconBtn icon="refresh" title="Обновить" onClick={handleRefresh}/>
            <window.UI.IconBtn icon="tune" title="Настройки" onClick={() => router.push('settings')}/>
          </>
        }
      />

      <div ref={scrollRef} className="screen-scroll">
        <window.UI.PullToRefresh onRefresh={handleRefresh} scrollRef={scrollRef}>

          {state === 'normal' && (
            <>
              <Hero date={selectedDate} count={dayShifts.length} totalMin={totalMin} unconfirmedMin={unconfirmedMin} facCount={facCount} isToday={isToday}/>
              <ModeTabs mode={mode} onChange={setMode}/>
              {mode === 'day' ? (
                <>
                  <WeekStrip days={weekDays} onSelect={setSelectedDate}/>
                  {currentShift && <NowStrip shift={currentShift}/>}
                  <Timeline rows={rows} today={today} date={selectedDate} nowMins={nowMins}/>
                  <AddShiftInlineLink date={selectedDate} onPush={() => router.push('editor', { date: selectedDate })}/>
                </>
              ) : (
                <Feed shifts={shifts} today={today} nowMins={nowMins} onPickDate={(d) => { setSelectedDate(d); setMode('day'); }}/>
              )}
              <SiteCard change={unreadChange} onClick={() => router.push('changes')}/>
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
    <section className={`hero ${muted ? 'is-muted' : ''}`}>
      <p className="hero-kicker">{kicker}</p>
      <h1 className="hero-title">{wd}, <em>{day}&nbsp;{mo}</em></h1>
      {!muted && (
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
function Feed({ shifts, today, nowMins, onPickDate }) {
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
              />
            ))}
          </div>
        );
      })}
    </section>
  );
}

// ── Week strip ──────────────────────────────────────────────────
function WeekStrip({ days, onSelect }) {
  return (
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
  );
}

// ── Now strip ───────────────────────────────────────────────────
function NowStrip({ shift }) {
  const fac = window.Data.getFacility(shift.facilityId);
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const left = window.Data.toMinutes(shift.end) - nowMins;
  return (
    <div className="now-strip">
      <span className="pulse"/>
      <div className="body">
        <span className="label">сейчас · {new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span>
        <span className="title">{shift.activity?.split('·')[0]?.trim() || fac?.name} · {fac?.name}</span>
      </div>
      <span className="countdown">осталось&nbsp;<strong>{window.Data.formatDuration(left)}</strong></span>
    </div>
  );
}

// ── Timeline ────────────────────────────────────────────────────
function Timeline({ rows, today, date, nowMins }) {
  if (!rows.length) {
    return (
      <section className="timeline">
        <div className="day-empty">
          <p>На&nbsp;<em>эти сутки</em> смены не&nbsp;добавлены.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="timeline">
      {rows.map((r, i) => r.kind === 'shift'
        ? <ShiftCard key={r.shift.id} shift={r.shift} nowMins={nowMins} today={today} date={date}/>
        : <BreakDivider key={`brk-${i}`} br={r}/>
      )}
    </section>
  );
}

function ShiftCard({ shift, nowMins, today, date, variant }) {
  const fac = window.Data.getFacility(shift.facilityId);
  const eff = window.Data.computeEffectiveShift(shift);
  const start = window.Data.toMinutes(eff.start);
  const end   = window.Data.toMinutes(eff.end);
  const onToday = date === today;
  const hasClosed = eff.badge === 'closed';
  const isNow  = onToday && !hasClosed && start <= nowMins && end > nowMins;
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
    <a className="add-shift-link" onClick={(e) => { e.preventDefault(); onPush(); }} href="#">
      <span className="plus">+</span>
      <span>{label}</span>
      <span className="material-symbols-outlined arrow">arrow_forward</span>
    </a>
  );
}

// ── Bottom site-check card ──────────────────────────────────────
function SiteCard({ change, onClick }) {
  const hasUnread = Boolean(change);
  const checkedAt = change?.checkedAt || window.Data.loadCachedAt();
  const facCount = window.Data.FACILITIES.length;
  return (
    <button className={`site-card ${hasUnread ? 'is-attention' : ''}`} onClick={onClick}>
      <div className="row">
        <div className="icon-cell">
          <span className="material-symbols-outlined">{hasUnread ? 'event_busy' : 'sync'}</span>
        </div>
        <div className="body">
          <p className="kicker">Проверка сайта</p>
          <p className="head">
            {hasUnread
              ? <>Затронуто <em>{change.events?.filter(e => e.affectsShiftId).length || 1}</em> ваших смен</>
              : <>Все источники сматчены, изменений&nbsp;<em>не найдено</em></>}
          </p>
        </div>
        <span className="material-symbols-outlined arrow">chevron_right</span>
      </div>
      <div className="footer">
        <span className="meta">
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>schedule</span>
          {' '}{checkedAt ? `проверено ${window.Data.formatRelativeMinutes(checkedAt)}` : 'ещё не проверено'} · {facCount} {pluralizeFacilities(facCount)}
        </span>
        <span className="open-link">{hasUnread ? 'разобрать →' : 'журнал →'}</span>
      </div>
    </button>
  );
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
