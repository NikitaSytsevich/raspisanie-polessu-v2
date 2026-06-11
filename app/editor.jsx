// ──────────────────────────────────────────────────────────────────
// app/editor.jsx — экран редактирования смены (v2).
//
// Что изменилось против v1:
//   • Подсказки времени из САЙТА: для выбранных объекта+даты показываем
//     сеансы из кэша /api/schedule — тап подставляет start/end. Если
//     объект в эту дату закрыт (closureRanges) — честно предупреждаем.
//   • Любая дата: лента из 15 дней + inline-календарь (страницы по
//     4 недели, как DatePicker на главной).
//   • Серия: при создании можно выбрать несколько дат — сохранится
//     по смене на каждую (обещание онбординга «серией по дням недели»).
//   • Пресеты времени теперь из ИСТОРИИ: топ частых окон для выбранного
//     объекта; у нового пользователя — старые дефолтные.
//   • Инструктора можно добавить прямо из чипов, без похода в настройки.
//   • Кнопки действий — закреплённая нижняя панель (.ed-bar), а не хвост
//     скролла: сохранение всегда под пальцем.
// Сохранилось: dirty-check с ConfirmSheet, удаление с undo-тостом,
// предупреждение о пересечениях (теперь по всем датам серии), список
// ближайших смен, подсказка «такая же смена была».
// ──────────────────────────────────────────────────────────────────

const { useState: _es, useEffect: _ee, useMemo: _em, useRef: _er } = React;

// Дефолтные окна — фолбэк, пока у пользователя нет своей истории.
const ED_FALLBACK_PRESETS = [
  { label: 'утренняя', start: '07:30', end: '09:00' },
  { label: 'детская',  start: '09:45', end: '11:15' },
  { label: 'дневная',  start: '14:30', end: '16:00' },
  { label: 'вечерняя', start: '17:30', end: '19:30' },
];

// «Добавить 2 смены / 5 смен / 21 смену» — винительный падеж.
function edPluralShifts(n) {
  const l = n % 10, l2 = n % 100;
  if (l === 1 && l2 !== 11) return 'смену';
  if (l >= 2 && l <= 4 && (l2 < 12 || l2 > 14)) return 'смены';
  return 'смен';
}
function edPluralTimes(n) {
  const l = n % 10, l2 = n % 100;
  if (l >= 2 && l <= 4 && (l2 < 12 || l2 > 14)) return 'раза';
  return 'раз';
}

// «12 мая, 14 мая +2» — компактная подпись серии дат для тикета.
function edFormatDates(dates) {
  const parts = dates.map(d => {
    const dt = new Date(d + 'T12:00:00');
    return `${dt.getDate()} ${window.Data.RU_MONTHS[dt.getMonth()].slice(0, 3)}`;
  });
  if (parts.length <= 3) return parts.join(', ');
  return parts.slice(0, 3).join(', ') + ` +${parts.length - 3}`;
}

// ── Inline-календарь (страницы по 4 недели, Пн-выравнивание) ──────
// Лента покрывает ближайшие ~2 недели; календарь — всё остальное.
// selected — Set ISO-дат; counts — Map(date → число смен на дату).
function EdCalendar({ selected, counts, onPick }) {
  const todayIso = window.Data.TODAY_ISO;
  const [page, setPage] = _es(0);

  const { weeks, label } = _em(() => {
    const today = new Date(todayIso + 'T12:00:00');
    const dow = (today.getDay() + 6) % 7; // Пн=0 … Вс=6
    const startOffset = -dow + page * 28;
    const out = [];
    const months = [];
    const seen = new Set();
    let lastMonth = -1;
    for (let w = 0; w < 4; w++) {
      const row = [];
      for (let d = 0; d < 7; d++) {
        const offset = startOffset + w * 7 + d;
        const date = window.Data.isoOffset(offset);
        const dt = new Date(date + 'T12:00:00');
        const month = dt.getMonth();
        if (!seen.has(month)) { seen.add(month); months.push(window.Data.RU_MONTHS[month]); }
        row.push({
          date,
          num: dt.getDate(),
          monthShort: window.Data.RU_MONTHS[month].slice(0, 3),
          showMonth: month !== lastMonth,
          isToday: date === todayIso,
          isPast: date < todayIso,
        });
        lastMonth = month;
      }
      out.push(row);
    }
    return { weeks: out, label: months.join(' — ') };
  }, [page, todayIso]);

  return (
    <div className="ed-cal">
      <header className="ed-cal-head">
        <button type="button" className="ed-cal-nav" aria-label="Назад"
                onClick={() => setPage(p => p - 1)}>
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <span className="ed-cal-label">{label}</span>
        <button type="button" className="ed-cal-nav" aria-label="Вперёд"
                onClick={() => setPage(p => p + 1)}>
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </header>
      <div className="ed-cal-dow">
        {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="ed-cal-body">
        {weeks.map((row, ri) => (
          <div key={ri} className="ed-cal-row">
            {row.map(d => (
              <button
                key={d.date}
                type="button"
                className={`ed-cal-cell ${selected.has(d.date) ? 'is-selected' : ''} ${d.isToday ? 'is-today' : ''} ${d.isPast ? 'is-past' : ''}`}
                onClick={() => onPick(d.date)}
              >
                {d.showMonth && <span className="mo">{d.monthShort}</span>}
                <span className="num">{d.num}</span>
                {counts.get(d.date) > 0 && <span className="dot"/>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function EditorScreen({ shiftId, date } = {}) {
  const router = window.useRouter();
  const toast = window.UI.useToast();

  const initialShift = _em(() => {
    if (shiftId) {
      const found = window.Data.loadShifts().find(s => s.id === shiftId);
      if (found) return { ...found };
    }
    return {
      id: '',
      date: date || window.Data.TODAY_ISO,
      facilityId: 'ice_arena',
      start: '09:45',
      end: '11:15',
      activity: '',
      source: 'shift',
      instructors: [],
    };
  }, [shiftId, date]);

  const isEditing = Boolean(shiftId);
  const [draft, setDraft] = _es(initialShift);
  const [allShifts, setAllShifts] = _es(() => window.Data.loadShifts());
  const [instructors, setInstructors] = _es(() => window.Data.loadInstructors());

  // Выбранные даты. В режиме «серия» (только создание) — несколько;
  // обычно ровно одна. Источник истины для дат — ЭТОТ Set, а не draft.date.
  const [dateSel, setDateSel] = _es(() => new Set([initialShift.date]));
  const [seriesOn, setSeriesOn] = _es(false);
  const [calOpen, setCalOpen] = _es(false);
  const [siteExpanded, setSiteExpanded] = _es(false);

  // Инлайн-добавление инструктора прямо из чипов.
  const [addingInst, setAddingInst] = _es(false);
  const [newInstName, setNewInstName] = _es('');
  // Режим редактирования каталога: чипы получают крестики и по тапу
  // удаляются из каталога (а не выбираются). Единственное место
  // управления инструкторами — настройки больше этим не занимаются.
  const [editInsts, setEditInsts] = _es(false);

  // Модалка подтверждения: 'exit' (несохранённые изменения) | null
  const [confirmKind, setConfirmKind] = _es(null);
  const [pendingExit, setPendingExit] = _es(null);

  _ee(() => {
    const reloadInst = () => setInstructors(window.Data.loadInstructors());
    const reloadShifts = () => setAllShifts(window.Data.loadShifts());
    window.addEventListener('rpgu:instructors-changed', reloadInst);
    window.addEventListener('rpgu:shifts-changed', reloadShifts);
    return () => {
      window.removeEventListener('rpgu:instructors-changed', reloadInst);
      window.removeEventListener('rpgu:shifts-changed', reloadShifts);
    };
  }, []);

  function patch(p) { setDraft(d => ({ ...d, ...p })); }

  const dates = _em(() => [...dateSel].sort(), [dateSel]);
  const anchorDate = dates[0];

  function pickDate(d) {
    setDateSel(sel => {
      if (!seriesOn) return new Set([d]);
      const next = new Set(sel);
      if (next.has(d)) {
        if (next.size > 1) next.delete(d); // последнюю дату снять нельзя
      } else {
        next.add(d);
      }
      return next;
    });
  }

  function toggleSeries() {
    // Выключение серии схлопывает выбор до самой ранней даты.
    if (seriesOn) setDateSel(sel => new Set([[...sel].sort()[0]]));
    setSeriesOn(!seriesOn);
  }

  function toggleInstructor(id) {
    const cur = draft.instructors || [];
    patch({ instructors: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] });
  }

  function commitNewInstructor() {
    const name = newInstName.trim();
    setNewInstName('');
    setAddingInst(false);
    if (!name) return;
    const added = window.Data.addInstructor(name);
    if (added) {
      // Свежедобавленного сразу отмечаем выбранным — за этим и добавляли.
      patch({ instructors: [...(draft.instructors || []), added.id] });
      toast.show(`Добавлено: ${added.name}`, { icon: 'person_add' });
    } else {
      toast.show('Такой инструктор уже есть');
    }
  }

  function toggleEditInsts() {
    // Вход в режим редактирования прячет чип «добавить» — бросаем
    // незакоммиченный инлайн-ввод, чтобы он не «воскрес» после «готово».
    setAddingInst(false);
    setNewInstName('');
    setEditInsts(v => !v);
  }

  // Удаление из каталога — без модалки, но с «Вернуть» в тосте: жест
  // обратимый, подтверждение только мешало бы. Возврат вставляет
  // инструктора на прежнее место списка и в выбор смены, если был выбран.
  function removeInstFromCatalog(p) {
    const prevIdx = window.Data.loadInstructors().findIndex(i => i.id === p.id);
    const wasSelected = (draft.instructors || []).includes(p.id);
    window.Data.removeInstructor(p.id);
    if (wasSelected) {
      setDraft(d => ({ ...d, instructors: (d.instructors || []).filter(x => x !== p.id) }));
    }
    if (window.Data.loadInstructors().length === 0) setEditInsts(false);
    // «Удалено: …», а не «… удалён» — в каталоге есть и женские фамилии,
    // спрягать по роду не берёмся.
    toast.show(`Удалено: ${p.name}`, {
      icon: 'person_remove',
      danger: true,
      actionLabel: 'Вернуть',
      onAction: () => {
        const cur = window.Data.loadInstructors();
        if (!cur.some(i => i.id === p.id)) {
          const idx = Math.max(0, Math.min(prevIdx, cur.length));
          window.Data.saveInstructors([...cur.slice(0, idx), p, ...cur.slice(idx)]);
        }
        if (wasSelected) {
          setDraft(d => (d.instructors || []).includes(p.id)
            ? d
            : { ...d, instructors: [...(d.instructors || []), p.id] });
        }
      },
    });
  }

  // Дата в сравнение не входит (живёт в dateSel), instructors сортируем,
  // чтобы порядок выбора не считался изменением.
  const isDirty = _em(() => {
    const norm = s => JSON.stringify({
      ...s,
      date: null,
      instructors: [...(s.instructors || [])].sort(),
    });
    const datesDirty = dates.length !== 1 || dates[0] !== initialShift.date;
    return datesDirty || norm(draft) !== norm(initialShift);
  }, [draft, initialShift, dates]);

  const facility  = window.Data.getFacility(draft.facilityId);
  const startMins = window.Data.toMinutes(draft.start);
  const endMins   = window.Data.toMinutes(draft.end);
  const hasTime   = Boolean(draft.start && draft.end);
  const isValid   = hasTime && endMins > startMins;
  const duration  = isValid ? window.Data.formatDuration(endMins - startMins) : '—';

  // ── Сайт: сеансы выбранного объекта на якорную дату ─────────────
  // Главная идея v2: не заставлять вспоминать расписание — оно уже
  // в кэше. small_pool фильтруем как на главной (только «сеансы»,
  // платные/обучение ведёт другой персонал).
  const siteInfo = _em(() => {
    const fac = window.Data.getCachedFacility(draft.facilityId);
    if (!fac) return { state: 'no_data' };
    if (fac.dataQuality === 'closed') return { state: 'closed', notice: fac.notice };
    if (Array.isArray(fac.closureRanges)) {
      const hit = fac.closureRanges.find(r => anchorDate >= r.from && anchorDate <= r.to);
      if (hit) return { state: 'closed', notice: hit.notice };
    }
    if (fac.dataQuality !== 'ok') return { state: 'no_data' };
    let sessions = window.Data.getSiteSessionsForDay(draft.facilityId, anchorDate);
    if (draft.facilityId === 'small_pool') {
      sessions = sessions.filter(s => /сеанс/i.test(s.activity || ''));
    }
    return { state: 'ok', sessions };
  }, [draft.facilityId, anchorDate, allShifts]);

  const siteSessions = siteInfo.state === 'ok' ? siteInfo.sessions : [];
  const visibleSiteSessions = siteExpanded ? siteSessions : siteSessions.slice(0, 4);

  // ── Пресеты времени из истории ──────────────────────────────────
  // Топ-4 частых окон для выбранного объекта; меньше двух → дефолтные.
  const presets = _em(() => {
    const freq = new Map();
    for (const s of allShifts) {
      if (s.facilityId !== draft.facilityId || s.id === draft.id) continue;
      const k = `${s.start}|${s.end}`;
      const e = freq.get(k) || { start: s.start, end: s.end, n: 0, last: '' };
      e.n++;
      if (s.date > e.last) e.last = s.date;
      freq.set(k, e);
    }
    const top = [...freq.values()]
      .sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
      .slice(0, 4);
    if (top.length >= 2) {
      return top.map(p => ({ label: `${p.n} ${edPluralTimes(p.n)}`, start: p.start, end: p.end }));
    }
    return ED_FALLBACK_PRESETS;
  }, [allShifts, draft.facilityId, draft.id]);

  // ── Пересечения по ВСЕМ выбранным датам ─────────────────────────
  const overlaps = _em(() => {
    if (!isValid) return [];
    const dset = new Set(dates);
    return allShifts.filter(s =>
      s.id !== draft.id &&
      dset.has(s.date) &&
      window.Data.toMinutes(s.start) < endMins &&
      window.Data.toMinutes(s.end)   > startMins
    );
  }, [allShifts, draft.id, dates, startMins, endMins, isValid]);

  function handleSubmit() {
    if (!hasTime)  { toast.show('Заполните время'); return; }
    if (!isValid)  { toast.show('Конец должен быть позже начала'); return; }
    if (isEditing) {
      window.Data.upsertShift({ ...draft, date: anchorDate });
      toast.show('Смена обновлена');
    } else {
      // Серия: по смене на каждую дату, одним сохранением (один event).
      const base = Date.now();
      const list = window.Data.loadShifts();
      dates.forEach((d, i) => list.push({ ...draft, date: d, id: `s${base + i}` }));
      window.Data.saveShifts(list);
      toast.show(dates.length > 1
        ? `Добавлено: ${dates.length} ${edPluralShifts(dates.length)}`
        : 'Смена добавлена');
    }
    router.pop();
  }

  function tryExit(exit) {
    if (isDirty) {
      setPendingExit(() => exit);
      setConfirmKind('exit');
    } else {
      exit();
    }
  }

  // Удаление без confirm-модалки: сразу удаляем, undo живёт в тосте 6с.
  function handleDelete() {
    if (!shiftId) return;
    const removed = window.Data.loadShifts().find(s => s.id === shiftId);
    window.Data.removeShift(shiftId);
    toast.show('Смена удалена', {
      icon: 'delete',
      danger: true,
      actionLabel: 'Отменить',
      onAction: () => { if (removed) window.Data.upsertShift(removed); },
    });
    router.pop();
  }

  // ── Лента дат: вчера … +13 дней ─────────────────────────────────
  const dateChips = _em(() => {
    const arr = [];
    for (let i = -1; i <= 13; i++) arr.push(window.Data.isoOffset(i));
    return arr;
  }, []);
  const countsByDate = _em(() => {
    const m = new Map();
    for (const s of allShifts) {
      if (s.id === draft.id) continue;
      m.set(s.date, (m.get(s.date) || 0) + 1);
    }
    return m;
  }, [allShifts, draft.id]);

  // Ближайшие смены (сегодня и дальше, без текущего черновика)
  const recentList = _em(() =>
    allShifts
      .filter(s => s.date >= window.Data.TODAY_ISO && s.id !== draft.id)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
      .slice(0, 4),
    [allShifts, draft.id]
  );

  // «Такая же смена была …» — ±15 мин по границам, тот же объект, в прошлом.
  const samePastSuggest = _em(() => {
    if (!isValid) return null;
    return allShifts
      .filter(s => s.id !== draft.id
        && s.facilityId === draft.facilityId
        && Math.abs(window.Data.toMinutes(s.start) - startMins) <= 15
        && Math.abs(window.Data.toMinutes(s.end)   - endMins)   <= 15
        && s.date < window.Data.TODAY_ISO
        && (s.activity?.trim() || (s.instructors?.length > 0)))
      .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  }, [allShifts, draft.facilityId, draft.id, startMins, endMins, isValid]);

  const selectedNames = (draft.instructors || [])
    .map(id => window.Data.getInstructor(id)?.name)
    .filter(Boolean);

  const submitLabel = isEditing
    ? 'Сохранить'
    : dates.length > 1
      ? `Добавить ${dates.length} ${edPluralShifts(dates.length)}`
      : 'Добавить смену';

  return (
    <div className="screen editor-screen">
      <window.UI.StatusBar/>

      <window.UI.AppHeader
        left={<window.UI.IconBtn icon="arrow_back" title="Назад" onClick={() => tryExit(() => router.pop())}/>}
        title={isEditing ? 'Редактировать смену' : 'Новая смена'}
        meta={isEditing ? (isDirty ? 'есть изменения' : 'правка существующей') : (isDirty ? 'черновик · не сохранён' : 'новая смена')}
        metaImportant={isDirty}
        right={isEditing
          ? <window.UI.IconBtn icon="delete" title="Удалить" danger onClick={handleDelete}/>
          : null}
      />

      <div className="screen-scroll">
        {/* ── Живой тикет-превью того, что сохранится ── */}
        <section className={`ed-ticket is-fac-${draft.facilityId}`}>
          <div className="ed-ticket-mark" aria-hidden="true">
            <span className="material-symbols-outlined">{facility?.icon || 'event'}</span>
          </div>
          <p className="ed-ticket-kicker">
            {isEditing ? 'вы редактируете' : dates.length > 1 ? `серия · ${dates.length} ${edPluralShifts(dates.length)}` : 'сейчас добавляете'}
          </p>
          <div className="ed-ticket-time">
            <span className="t">{draft.start || '—:—'}</span>
            <span className="arr">→</span>
            <span className="t">{draft.end || '—:—'}</span>
            <span className={`dur ${hasTime && !isValid ? 'is-bad' : ''}`}>
              {hasTime && !isValid ? 'конец раньше начала' : duration}
            </span>
          </div>
          <p className="ed-ticket-sub">
            <strong>{dates.length > 1 ? edFormatDates(dates) : window.Data.formatDayHeading(anchorDate)}</strong>
            <span className="sep">·</span>
            {facility?.name}
          </p>
          {selectedNames.length > 0 && (
            <p className="ed-ticket-with">с {selectedNames.join(', ')}</p>
          )}
        </section>

        {/* ── Дата ── */}
        <window.UI.SecLabel
          hint={!isEditing && (
            <button
              type="button"
              className={`ed-series-toggle ${seriesOn ? 'is-on' : ''}`}
              onClick={toggleSeries}
            >
              <span className="material-symbols-outlined">{seriesOn ? 'check_box' : 'check_box_outline_blank'}</span>
              несколько дат
            </button>
          )}
        >Дата</window.UI.SecLabel>

        <div className="date-strip">
          <button
            type="button"
            className={`date-chip is-cal ${calOpen ? 'is-active' : ''}`}
            onClick={() => setCalOpen(o => !o)}
            title="Календарь"
          >
            <span className="material-symbols-outlined">calendar_month</span>
            <span className="mo">ещё</span>
          </button>
          {dateChips.map(d => {
            const dt = new Date(d + 'T12:00:00');
            const labelByDay = d === window.Data.TODAY_ISO ? 'сегодня'
              : d === window.Data.isoOffset(1) ? 'завтра'
              : d === window.Data.isoOffset(-1) ? 'вчера'
              : window.Data.RU_MONTHS[dt.getMonth()].slice(0, 3);
            return (
              <button
                key={d}
                type="button"
                className={`date-chip ${dateSel.has(d) ? 'is-active' : ''} ${countsByDate.get(d) ? 'has-shift' : ''}`}
                onClick={() => pickDate(d)}
              >
                <span className="wd">{window.Data.RU_WEEKDAYS_SHORT[dt.getDay()]}</span>
                <span className="num">{dt.getDate()}</span>
                <span className="mo">{labelByDay}</span>
                {countsByDate.get(d) > 0 && <span className="count">{countsByDate.get(d)}</span>}
              </button>
            );
          })}
        </div>

        {calOpen && (
          <EdCalendar selected={dateSel} counts={countsByDate} onPick={pickDate}/>
        )}

        {seriesOn && dates.length > 1 && (
          <p className="ed-series-info">
            <span className="material-symbols-outlined">stacks</span>
            выбрано {dates.length} {dates.length < 5 ? 'даты' : 'дат'}: {edFormatDates(dates)}
          </p>
        )}

        {/* ── Объект ── */}
        <window.UI.SecLabel>Объект</window.UI.SecLabel>
        <div className="facility-row">
          {window.Data.FACILITIES.map(f => (
            <button
              key={f.id}
              type="button"
              className={`fc-btn is-fac-${f.id} ${draft.facilityId === f.id ? 'is-active' : ''}`}
              onClick={() => patch({ facilityId: f.id })}
            >
              <span className="ic"><span className="material-symbols-outlined">{f.icon}</span></span>
              <span className="text">
                <span className="name">{f.name}</span>
                <span className="hint">{f.hint}</span>
              </span>
            </button>
          ))}
        </div>

        {/* ── Время ── */}
        <window.UI.SecLabel hint={isValid ? duration : null}>Время</window.UI.SecLabel>
        <div className={`time-row ${hasTime && !isValid ? 'is-invalid' : ''}`}>
          <label className="time-cell">
            <span className="label">Начало</span>
            <input
              className="time-input"
              type="time"
              value={draft.start}
              onChange={e => patch({ start: e.target.value })}
            />
          </label>
          <label className="time-cell">
            <span className="label">Конец</span>
            <input
              className="time-input"
              type="time"
              value={draft.end}
              onChange={e => patch({ end: e.target.value })}
            />
          </label>
        </div>

        {hasTime && !isValid && (
          <div className="duration-pill is-invalid">
            <span className="material-symbols-outlined">error</span>
            <span>конец должен быть позже начала</span>
          </div>
        )}

        {/* Сеансы с сайта: тап — подставить время */}
        {siteInfo.state === 'closed' && (
          <div className="ed-closed">
            <span className="material-symbols-outlined">event_busy</span>
            <div className="body">
              <strong>{facility?.name}</strong> {window.Data.formatDayHeading(anchorDate)} закрыт{' '}—{' '}
              {siteInfo.notice || 'на сайте объявление о приостановке работы'}
            </div>
          </div>
        )}
        {siteSessions.length > 0 && (
          <div className="ed-site">
            <p className="ed-site-head">
              <span className="material-symbols-outlined">verified</span>
              на сайте · {window.Data.formatDayHeading(anchorDate)}
              <span className="ed-site-hint">тап — подставить время</span>
            </p>
            {visibleSiteSessions.map((s, i) => {
              const active = draft.start === s.start && draft.end === s.end;
              return (
                <button
                  key={i}
                  type="button"
                  className={`ed-site-row ${active ? 'is-active' : ''}`}
                  onClick={() => patch({ start: s.start, end: s.end })}
                >
                  <span className="tm">{s.start}–{s.end}</span>
                  <span className="act">{s.activity || 'сеанс'}</span>
                  <span className="material-symbols-outlined apply">
                    {active ? 'check' : 'arrow_outward'}
                  </span>
                </button>
              );
            })}
            {siteSessions.length > 4 && (
              <button
                type="button"
                className="ed-site-more"
                onClick={() => setSiteExpanded(x => !x)}
              >
                {siteExpanded ? 'свернуть' : `ещё ${siteSessions.length - 4}`}
                <span className="material-symbols-outlined">{siteExpanded ? 'expand_less' : 'expand_more'}</span>
              </button>
            )}
          </div>
        )}

        <div className="preset-row">
          {presets.map(p => {
            const active = draft.start === p.start && draft.end === p.end;
            return (
              <button
                key={p.start + p.end}
                type="button"
                className={`preset-chip ${active ? 'is-active' : ''}`}
                onClick={() => patch({ start: p.start, end: p.end })}
              >
                <em>{p.start}–{p.end}</em>
                <span className="tm">{p.label}</span>
              </button>
            );
          })}
        </div>

        {overlaps.length > 0 && (
          <div className="overlap-warn">
            <span className="material-symbols-outlined">warning</span>
            <div className="body">
              {overlaps.length === 1
                ? <>Пересекается с вашей сменой <strong>{window.Data.getFacility(overlaps[0].facilityId)?.name} · {window.Data.formatDayHeading(overlaps[0].date)} {overlaps[0].start}—{overlaps[0].end}</strong></>
                : <>Пересекается с {overlaps.length}&nbsp;вашими сменами ({edFormatDates([...new Set(overlaps.map(o => o.date))].sort())})</>}
            </div>
          </div>
        )}

        {/* ── Инструкторы ── */}
        <window.UI.SecLabel
          hint={editInsts ? 'коснитесь — удалить' : 'опционально'}
          action={instructors.length > 0 && (
            <button type="button" className="sec-action" onClick={toggleEditInsts}>
              {editInsts ? 'готово' : 'изменить'}
            </button>
          )}
        >С кем работаю</window.UI.SecLabel>
        <div className="insts">
          {instructors.map(p => {
            const sel = draft.instructors?.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`inst-chip ${sel ? 'is-selected' : ''} ${editInsts ? 'is-editing' : ''}`}
                title={editInsts ? `Удалить «${p.name}» из каталога` : undefined}
                onClick={() => (editInsts ? removeInstFromCatalog(p) : toggleInstructor(p.id))}
              >
                <span className="av">{p.initials}</span>
                {p.name}
                {editInsts && (
                  <span className="del-badge" aria-hidden="true">
                    <span className="material-symbols-outlined">close</span>
                  </span>
                )}
              </button>
            );
          })}
          {editInsts ? null : addingInst ? (
            <span className="inst-chip is-input">
              <span className="av"><span className="material-symbols-outlined">person_add</span></span>
              <input
                autoFocus
                placeholder="Фамилия И.О."
                value={newInstName}
                onChange={e => setNewInstName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitNewInstructor();
                  if (e.key === 'Escape') { setNewInstName(''); setAddingInst(false); }
                }}
                onBlur={commitNewInstructor}
              />
            </span>
          ) : (
            <button type="button" className="inst-chip is-add" onClick={() => setAddingInst(true)}>
              <span className="av"><span className="material-symbols-outlined">add</span></span>
              добавить
            </button>
          )}
        </div>

        {/* ── Комментарий ── */}
        <window.UI.SecLabel hint="опционально">Комментарий</window.UI.SecLabel>
        <div className="note-wrap">
          <textarea
            className="note"
            placeholder="например, замена · группа U-12"
            value={draft.activity}
            onChange={e => patch({ activity: e.target.value })}
          />
        </div>

        {samePastSuggest && (
          <div className="suggest">
            <span className="material-symbols-outlined">history</span>
            <div className="body">
              Такая&nbsp;же смена была <strong>{window.Data.formatDayHeading(samePastSuggest.date)}</strong>&nbsp;—{' '}
              <a onClick={() => patch({
                activity: samePastSuggest.activity,
                instructors: samePastSuggest.instructors || [],
              })}>повторить точь-в-точь&nbsp;→</a>
            </div>
          </div>
        )}

        {recentList.length > 0 && (
          <>
            <window.UI.SecLabel hint="тап → редактировать">Ближайшие смены</window.UI.SecLabel>
            <section className="recent">
              {recentList.map(s => {
                const fac = window.Data.getFacility(s.facilityId);
                const d = new Date(s.date + 'T12:00:00');
                return (
                  <div
                    key={s.id}
                    className={`recent-row ${s.source === 'site' ? 'is-site' : ''}`}
                    onClick={() => tryExit(() => router.replace('editor', { shiftId: s.id }))}
                  >
                    <div className="when">
                      <span className="num">{d.getDate()}</span>
                      <span className="wd">{window.Data.RU_WEEKDAYS_SHORT[d.getDay()].toLowerCase()} {window.Data.RU_MONTHS[d.getMonth()].slice(0, 3)}</span>
                    </div>
                    <div className="body">
                      <p className="place">{fac?.name}</p>
                      <span className="time">{s.start} — {s.end} · <span className={`src ${s.source === 'site' ? 'site' : ''}`}>{s.source === 'site' ? 'по сайту' : 'по графику'}</span></span>
                    </div>
                    <div className="chev"><span className="material-symbols-outlined">chevron_right</span></div>
                  </div>
                );
              })}
            </section>
          </>
        )}

        <div className="ed-scroll-tail" aria-hidden="true"/>
        <window.UI.HomeIndicator/>
      </div>

      {/* ── Закреплённая панель действий ── */}
      <div className="ed-bar">
        <button className="btn secondary" type="button" onClick={() => tryExit(() => router.pop())}>
          Отменить
        </button>
        <button className="btn" type="button" onClick={handleSubmit} disabled={!isValid}>
          <span className="material-symbols-outlined">check</span>
          <span>{submitLabel}</span>
        </button>
      </div>

      {confirmKind === 'exit' && (
        <window.UI.ConfirmSheet
          icon="edit_off"
          title="Выйти без сохранения?"
          body="У вас есть несохранённые изменения. При выходе они потеряются."
          confirm="Выйти"
          danger
          onCancel={() => { setConfirmKind(null); setPendingExit(null); }}
          onConfirm={() => {
            const exit = pendingExit;
            setConfirmKind(null);
            setPendingExit(null);
            exit?.();
          }}
        />
      )}
    </div>
  );
}

window.EditorScreen = EditorScreen;
