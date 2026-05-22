// ──────────────────────────────────────────────────────────────────
// app/editor.jsx — shift editor screen (add / edit / remove)
// ──────────────────────────────────────────────────────────────────

const { useState: _es, useEffect: _ee, useMemo: _em } = React;

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
  const [recent, setRecent] = _es(() => window.Data.loadShifts());
  // Модалка подтверждения: 'exit' (несохранённые изменения) | 'delete' | null
  const [confirmKind, setConfirmKind] = _es(null);
  // Что выполнить, если пользователь подтвердит «Выйти без сохранения»
  const [pendingExit, setPendingExit] = _es(null);

  function patch(p) { setDraft(d => ({ ...d, ...p })); }

  function toggleInstructor(id) {
    const cur = draft.instructors || [];
    patch({ instructors: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] });
  }

  // Сериализуем оба объекта одинаково (instructors отсортированы),
  // чтобы сравнение по строке было устойчивым к порядку выбора.
  const isDirty = _em(() => {
    const norm = s => JSON.stringify({
      ...s,
      instructors: [...(s.instructors || [])].sort(),
    });
    return norm(draft) !== norm(initialShift);
  }, [draft, initialShift]);

  const facility = window.Data.getFacility(draft.facilityId);
  const startMins = window.Data.toMinutes(draft.start);
  const endMins   = window.Data.toMinutes(draft.end);
  const hasTime   = Boolean(draft.start && draft.end);
  const isValid   = hasTime && endMins > startMins;
  const duration  = isValid ? window.Data.formatDuration(endMins - startMins) : '—';

  // Пересечения с другими смены пользователя в ту же дату
  const overlaps = _em(() => {
    if (!isValid) return [];
    return recent.filter(s =>
      s.id !== draft.id &&
      s.date === draft.date &&
      window.Data.toMinutes(s.start) < endMins &&
      window.Data.toMinutes(s.end)   > startMins
    );
  }, [recent, draft.id, draft.date, startMins, endMins, isValid]);

  function handleSubmit(e) {
    e?.preventDefault?.();
    if (!hasTime) {
      toast.show('Заполните время');
      return;
    }
    if (!isValid) {
      toast.show('Конец должен быть позже начала');
      return;
    }
    const next = { ...draft, id: draft.id || `s${Date.now()}` };
    window.Data.upsertShift(next);
    toast.show(isEditing ? 'Смена обновлена' : 'Смена добавлена');
    router.pop();
  }

  // Попытка выйти: если есть несохранённые изменения — показать подтверждение.
  // Иначе сразу выполнить `exit`.
  function tryExit(exit) {
    if (isDirty) {
      setPendingExit(() => exit);
      setConfirmKind('exit');
    } else {
      exit();
    }
  }

  function handleDelete() {
    if (!shiftId) return;
    setConfirmKind('delete');
  }
  function confirmDelete() {
    window.Data.removeShift(shiftId);
    setConfirmKind(null);
    toast.show('Смена удалена');
    router.pop();
  }

  // Date strip (today−1 … today+5)
  const dateChips = _em(() => {
    const arr = [];
    for (let i = -1; i <= 5; i++) arr.push(window.Data.isoOffset(i));
    return arr;
  }, []);
  // Сколько смен у пользователя на каждый день — для счётчика на чипе
  const countsByDate = _em(() => {
    const m = new Map();
    for (const s of recent) {
      if (s.id === draft.id) continue;
      m.set(s.date, (m.get(s.date) || 0) + 1);
    }
    return m;
  }, [recent, draft.id]);

  // Recent (today + future, excluding current draft)
  const recentList = _em(() =>
    recent
      .filter(s => s.date >= window.Data.TODAY_ISO && s.id !== draft.id)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
      .slice(0, 4),
    [recent, draft.id]
  );

  // Same-shift history suggestion — мягко: ±15 мин по обеим границам и тот же объект.
  // Показываем и при редактировании тоже (вдруг полезно увидеть, что было в прошлый раз).
  const samePastSuggest = _em(() => {
    if (!isValid) return null;
    return recent
      .filter(s => s.id !== draft.id
        && s.facilityId === draft.facilityId
        && Math.abs(window.Data.toMinutes(s.start) - startMins) <= 15
        && Math.abs(window.Data.toMinutes(s.end)   - endMins)   <= 15
        && s.date < window.Data.TODAY_ISO
        && (s.activity?.trim() || (s.instructors?.length > 0)))
      .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  }, [recent, draft.facilityId, draft.id, startMins, endMins, isValid]);

  return (
    <div className="screen editor-screen" data-edit={isEditing ? 'true' : 'false'}>
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
        <section className="hero editor-hero">
          <p className="hero-kicker">{isEditing ? 'Вы редактируете' : 'Сейчас добавляете'}</p>
          <h1 className="hero-title">
            <span>{window.Data.formatDayHeading(draft.date)}</span> · <em>{draft.start}&nbsp;— {draft.end}</em><br/>
            <span>{facility?.name || 'на объекте'}</span>
          </h1>
          <div className="hero-meta">
            <span><strong>{duration}</strong></span>
            {draft.instructors?.length > 0 && <>
              <span className="sep"/>
              <span>с {draft.instructors.map(id => window.Data.getInstructor(id)?.name).filter(Boolean).join(', ')}</span>
            </>}
          </div>
        </section>

        <window.UI.SecLabel>Дата</window.UI.SecLabel>
        <div className="date-strip">
          {dateChips.map(d => {
            const date = new Date(d + 'T12:00:00');
            const labelByDay = d === window.Data.TODAY_ISO ? 'сегодня'
              : d === window.Data.isoOffset(1) ? 'завтра'
              : d === window.Data.isoOffset(-1) ? 'вчера'
              : window.Data.RU_MONTHS[date.getMonth()].slice(0, 3);
            return (
              <button
                key={d}
                type="button"
                className={`date-chip ${draft.date === d ? 'is-active' : ''} ${countsByDate.get(d) ? 'has-shift' : ''}`}
                onClick={() => patch({ date: d })}
              >
                <span className="wd">{window.Data.RU_WEEKDAYS_SHORT[date.getDay()]}</span>
                <span className="num">{date.getDate()}</span>
                <span className="mo">{labelByDay}</span>
                {countsByDate.get(d) > 0 && <span className="count">{countsByDate.get(d)}</span>}
              </button>
            );
          })}
        </div>

        <window.UI.SecLabel>Объект</window.UI.SecLabel>
        <div className="facility-row">
          {window.Data.FACILITIES.map(f => (
            <button
              key={f.id}
              type="button"
              className={`fc-btn ${draft.facilityId === f.id ? 'is-active' : ''}`}
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

        <window.UI.SecLabel>Время</window.UI.SecLabel>
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

        <div className={`duration-pill ${hasTime && !isValid ? 'is-invalid' : ''}`}>
          <span className="material-symbols-outlined">{isValid ? 'schedule' : 'error'}</span>
          <span>
            {isValid
              ? <>длительность <strong>{duration}</strong></>
              : <>конец должен быть позже начала</>}
          </span>
        </div>

        {overlaps.length > 0 && (
          <div className="overlap-warn">
            <span className="material-symbols-outlined">warning</span>
            <div className="body">
              {overlaps.length === 1
                ? <>Пересекается с вашей сменой <strong>{window.Data.getFacility(overlaps[0].facilityId)?.name} · {overlaps[0].start}—{overlaps[0].end}</strong></>
                : <>Пересекается с {overlaps.length}&nbsp;другими сменами на эту дату</>}
            </div>
          </div>
        )}

        <div className="preset-row">
          {[
            { name: 'утренняя', start: '07:30', end: '09:00' },
            { name: 'детская',  start: '09:45', end: '11:15' },
            { name: 'дневная',  start: '14:30', end: '16:00' },
            { name: 'вечерняя', start: '17:30', end: '19:30' },
          ].map(p => (
            <button
              key={p.name}
              type="button"
              className="preset-chip"
              onClick={() => patch({ start: p.start, end: p.end })}
            >
              <em>{p.name}</em>
              <span className="tm">{p.start} – {p.end}</span>
            </button>
          ))}
        </div>

        <window.UI.SecLabel hint="опционально">С кем работаю</window.UI.SecLabel>
        <div className="insts">
          {window.Data.INSTRUCTORS.map(p => {
            const sel = draft.instructors?.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`inst-chip ${sel ? 'is-selected' : ''}`}
                onClick={() => toggleInstructor(p.id)}
              >
                <span className="av">{p.initials}</span>
                {p.name}
              </button>
            );
          })}
        </div>

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

        <div className="actions">
          <button
            className="btn"
            type="button"
            onClick={handleSubmit}
            disabled={!isValid}
          >
            <span className="material-symbols-outlined">check</span>
            <span>{isEditing ? 'Сохранить изменения' : 'Добавить смену'}</span>
          </button>
          <button className="btn secondary" type="button" onClick={() => tryExit(() => router.pop())}>Отменить</button>
        </div>

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
                      <span className="time">{s.start} — {s.end} · <span className={`src ${s.source === 'site' ? 'site' : ''}`}>{s.source === 'site' ? 'по\u00a0сайту' : 'по\u00a0графику'}</span></span>
                    </div>
                    <div className="chev"><span className="material-symbols-outlined">chevron_right</span></div>
                  </div>
                );
              })}
            </section>
          </>
        )}

        <window.UI.HomeIndicator/>
      </div>

      {confirmKind && (
        <window.UI.ConfirmSheet
          {...(confirmKind === 'delete'
            ? { icon: 'delete', title: 'Удалить смену?', body: 'Действие нельзя отменить — смена пропадёт из расписания.', confirm: 'Удалить', danger: true }
            : { icon: 'edit_off', title: 'Выйти без сохранения?', body: 'У вас есть несохранённые изменения. При выходе они потеряются.', confirm: 'Выйти', danger: true })}
          onCancel={() => { setConfirmKind(null); setPendingExit(null); }}
          onConfirm={() => {
            if (confirmKind === 'delete') {
              confirmDelete();
            } else if (confirmKind === 'exit') {
              const exit = pendingExit;
              setConfirmKind(null);
              setPendingExit(null);
              exit?.();
            }
          }}
        />
      )}
    </div>
  );
}

window.EditorScreen = EditorScreen;
