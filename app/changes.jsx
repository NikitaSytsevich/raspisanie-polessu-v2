// ──────────────────────────────────────────────────────────────────
// app/changes.jsx — site verification screen
// ──────────────────────────────────────────────────────────────────

const { useState: _cs, useEffect: _ce, useMemo: _cm } = React;

function ChangesScreen() {
  const router = window.useRouter();
  const toast = window.UI.useToast();
  const [changes, setChanges] = _cs(() => window.Data.loadSiteChanges());
  const [shifts, setShifts]   = _cs(() => window.Data.loadShifts());
  const [refreshing, setRefreshing] = _cs(false);

  // Подписка на изменения хранилища: refresh, возврат с editor, новый
  // снапшот сайта. Без неё экран замирал на состоянии момента монтирования.
  _ce(() => {
    function reloadShifts()  { setShifts(window.Data.loadShifts()); }
    function reloadChanges() { setChanges(window.Data.loadSiteChanges()); }
    function onFocus()       { reloadShifts(); reloadChanges(); }
    window.addEventListener('focus', onFocus);
    window.addEventListener('rpgu:shifts-changed', reloadShifts);
    window.addEventListener('rpgu:site-changes-changed', reloadChanges);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('rpgu:shifts-changed', reloadShifts);
      window.removeEventListener('rpgu:site-changes-changed', reloadChanges);
    };
  }, []);

  const latest = changes[0];
  const ackPending = !latest?.acknowledgedAt && (latest?.hasChanges || latest?.hasSourceIssues);

  const facilities = window.Data.FACILITIES;

  // Group latest events by facility + date
  const groupedEvents = _cm(() => {
    if (!latest?.events?.length) return [];
    const map = new Map();
    for (const ev of latest.events) {
      const key = `${ev.facilityId}::${ev.date}`;
      if (!map.has(key)) map.set(key, { facilityId: ev.facilityId, date: ev.date, events: [] });
      map.get(key).events.push(ev);
    }
    return Array.from(map.values());
  }, [latest]);

  // Список затронутых смен пересчитываем по ТЕКУЩИМ shifts, а не по
  // сохранённому ev.affectsShiftId. Иначе:
  //   • удалённая смена даёт orphan-ссылку, её всё равно нет в списке (find
  //     по id вернёт undefined) — но «Влияние на мои смены» не покажет
  //     смену, добавленную ПОСЛЕ recordSiteCheck (баг #4 аудита).
  // Расчёт overlap идентичен annotateAffectedShifts → выносим в
  // Data.eventOverlapsShift, чтобы UI и журналирование шли по одной формуле.
  const affectedShifts = _cm(() => {
    if (!latest?.events?.length) return [];
    const out = [];
    for (const ev of latest.events) {
      const shift = shifts.find(s => window.Data.eventOverlapsShift(ev, s));
      if (shift) out.push({ shift, event: ev });
    }
    return out;
  }, [latest, shifts]);
  const affectedEventIds = _cm(() => {
    const set = new Set();
    for (const { event } of affectedShifts) set.add(event.id);
    return set;
  }, [affectedShifts]);

  // hero state: «important» только если ТЕКУЩИЕ смены реально перекрываются
  // — не по storage-флагу latest.affectsMe (он может быть устаревшим).
  let state = 'stable';
  if (latest && ackPending) {
    if (latest.hasSourceIssues && !latest.hasChanges) state = 'issue';
    else if (affectedShifts.length > 0) state = 'important';
    else state = 'changes';
  }

  function handleAck() {
    if (!latest) return;
    // Квитируем ВСЕ unread-записи, а не только latest — иначе старая запись
    // с affectsMe удержит SiteCard в «верхней» позиции на главной.
    setChanges(window.Data.ackAllPending());
    toast.show('Помечено как просмотренное');
  }

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await window.Data.fetchSchedule({ force: true });
      // Подписка на 'rpgu:site-changes-changed' тоже обновит, но дёргаем
      // явно — порядок микротасков с await не даёт гарантии, что listener
      // уже сработал к моменту следующего рендера.
      setChanges(window.Data.loadSiteChanges());
      const wasMock = window.Data.loadCachedMock();
      toast.show(wasMock ? 'Не удалось связаться с сайтом' : 'Сверка обновлена');
    } finally {
      setRefreshing(false);
    }
  }

  const checkedTime = latest?.checkedAt
    ? new Date(latest.checkedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : null;
  const kicker = checkedTime ? `Сегодня в ${checkedTime}` : 'Сверка ещё не запускалась';

  const cached = window.Data.loadCachedSchedule();
  const sourceCount = cached?.meta?.sourceCount ?? window.Data.FACILITIES.length;
  const sourceIssueCount = cached?.meta?.sourceIssueCount ?? 0;
  const okSources = Math.max(0, sourceCount - sourceIssueCount);

  const heroByState = {
    important: {
      kicker,
      title: <>Затронута<br/><em>ваша смена</em></>,
      brandMeta: 'требует внимания',
    },
    changes: {
      kicker,
      title: <>Есть<br/><em>обновления</em></>,
      brandMeta: 'новые события',
    },
    issue: {
      kicker,
      title: <>Проверка<br/><em>неполная</em></>,
      brandMeta: `${okSources} из ${sourceCount} источников`,
    },
    stable: {
      kicker,
      title: <>Без новых<br/><em>изменений</em></>,
      brandMeta: 'всё тихо',
    },
  };
  const hero = heroByState[state];

  return (
    <div className={`screen changes-screen`} data-state={state}>
      <window.UI.StatusBar/>
      <window.UI.AppHeader
        left={<window.UI.IconBtn icon="arrow_back" title="Назад" onClick={() => router.pop()}/>}
        title="Проверка сайта"
        meta={hero.brandMeta}
        metaImportant={state !== 'stable'}
        right={
          <window.UI.IconBtn
            title={refreshing ? 'Идёт сверка…' : 'Перепроверить'}
            onClick={handleRefresh}
            className={refreshing ? 'is-loading' : ''}
          >
            <span className={`material-symbols-outlined ${refreshing ? 'spin' : ''}`}>
              {refreshing ? 'progress_activity' : 'refresh'}
            </span>
          </window.UI.IconBtn>
        }
      />

      <div className="screen-scroll">
        <section className="hero changes-hero">
          <p className="hero-kicker">{hero.kicker}</p>
          <h1 className="hero-title">{hero.title}</h1>
          <p className="hero-lede">
            {state === 'important' && affectedShifts[0] && <>
              <strong>{window.Data.getFacility(affectedShifts[0].event.facilityId)?.name}</strong>
              {' '}{affectedShifts[0].event.kind === 'add' ? 'добавил сеанс' : affectedShifts[0].event.kind === 'rem' ? 'снял сеанс' : 'изменил сеанс'}{' '}
              <strong>{affectedShifts[0].event.start}&nbsp;— {affectedShifts[0].event.end}</strong>.
              {' '}Это пересекается с вашей сменой <strong>{affectedShifts[0].shift.start}&nbsp;— {affectedShifts[0].shift.end}</strong>.
              {latest?.hasSourceIssues && <> Кроме того, не все источники ответили.</>}
            </>}
            {state === 'changes' && <>
              Последняя проверка нашла {latest?.events?.length || 0}&nbsp;событий. Ваши смены не затронуты.
              {latest?.hasSourceIssues && <> Не все источники ответили — данные могут быть неполными.</>}
            </>}
            {state === 'stable' && <>Последняя сверка не нашла различий с предыдущим снимком. Все {sourceCount} источников ответили, ваши смены актуальны.</>}
            {state === 'issue' && <>Не все источники ответили. Повторим попытку через несколько минут.</>}
          </p>
          <div className="hero-meta">
            <span className="strong">{sourceCount} {pluralizeSources(sourceCount)}</span>
            <span className="sep"/>
            <span>{latest?.checkedAt ? `проверено ${window.Data.formatRelativeMinutes(latest.checkedAt)}` : 'ещё не проверено'}</span>
          </div>
        </section>

        {affectedShifts.length > 0 && (
          <>
            <window.UI.SecLabel count={affectedShifts.length}>Влияние на мои смены</window.UI.SecLabel>
            <section className="affected">
              {affectedShifts.map(({ shift, event }) => (
                <AffectedCard key={shift.id} shift={shift} event={event}/>
              ))}
            </section>
          </>
        )}

        {groupedEvents.length > 0 && (
          <>
            <window.UI.SecLabel count={latest.events.length}>Что изменилось</window.UI.SecLabel>
            <section className="diff">
              {groupedEvents.map((g, i) => (
                <DiffGroup key={i} group={g} affectedEventIds={affectedEventIds}/>
              ))}
            </section>
          </>
        )}

        <window.UI.SecLabel count={facilities.length}>Источники</window.UI.SecLabel>
        <section className="sources">
          {facilities.map(f => {
            const facData = cached?.facilities?.find(x => x.id === f.id);
            const dq = facData?.dataQuality;
            let cls = 'ok', status = 'ещё не проверен';
            if (dq === 'ok') {
              cls = 'ok';
              status = facData.sourceCheckedAt
                ? 'ок · ' + new Date(facData.sourceCheckedAt).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})
                : 'ок';
            } else if (dq === 'closed') {
              cls = 'tmpl';
              status = 'закрыт';
            } else if (dq === 'template') {
              cls = 'tmpl';
              status = 'шаблон';
            } else if (dq === 'parse_error') {
              cls = 'tmpl';
              status = 'ошибка парсера';
            }
            return (
            <div key={f.id} className={`src-row ${cls}`}>
              <span className="dot"/>
              <span className="name">{f.name}</span>
              <span className="status">{status}</span>
            </div>
            );
          })}
        </section>

        <window.UI.SecLabel count={changes.length}>Журнал проверок</window.UI.SecLabel>
        <section className="journal">
          {changes.map((c, i) => (
            <JournalRow key={c.id} entry={c} isLatest={i === 0}/>
          ))}
        </section>

        {ackPending && (
          <div className="ack-row">
            <button className="ack-btn" onClick={handleAck}>
              <span className="material-symbols-outlined">done_all</span>
              <span>Просмотрено</span>
            </button>
          </div>
        )}

        <window.UI.HomeIndicator/>
      </div>
    </div>
  );
}

function AffectedCard({ shift, event }) {
  const fac = window.Data.getFacility(shift.facilityId);
  const kindWord = event.kind === 'add' ? 'добавлен' : event.kind === 'rem' ? 'снят' : 'перенесён';
  return (
    <article className="aff-card">
      <header className="aff-head">
        <p className="aff-place">{fac?.name}</p>
        <span className="aff-meta">{window.Data.formatDayHeading(shift.date)}</span>
      </header>
      <div className="aff-time-row">
        <span className="aff-time">{shift.start}–{shift.end}</span>
        <span className="aff-chip">ваша смена</span>
      </div>
      <p className="aff-conflict">
        <span className="aff-arrow">↳</span>
        сеанс «{event.activity || 'без названия'}» {kindWord} в {event.start}–{event.end}.
      </p>
    </article>
  );
}

function DiffGroup({ group, affectedEventIds }) {
  const fac = window.Data.getFacility(group.facilityId);
  return (
    <div className="diff-group">
      <div className="diff-group-head">
        <span className="diff-group-name"><em>{fac?.name}</em></span>
        <span className="diff-group-when">{window.Data.formatDayHeading(group.date)}</span>
      </div>
      {group.events.map(ev => (
        <DiffRow key={ev.id} event={ev} isAffecting={affectedEventIds?.has(ev.id)}/>
      ))}
    </div>
  );
}

function DiffRow({ event, isAffecting }) {
  const isAdd = event.kind === 'add';
  const isRem = event.kind === 'rem';
  const isMod = event.kind === 'mod';
  const glyph = isAdd ? '+' : isRem ? '−' : '↔';
  const kindWord = isAdd ? 'добавлен' : isRem ? 'снят' : 'перенесён';
  // Подсветка «affects-me» — по факту пересечения с ТЕКУЩИМИ shifts
  // (Set рассчитан в ChangesScreen), а не по сохранённому
  // event.affectsShiftId — он мог устареть после remove/add смен.
  return (
    <div className={`diff-row ${isAdd ? 'is-add' : ''} ${isRem ? 'is-rem' : ''} ${isMod ? 'is-mod' : ''} ${isAffecting ? 'affects-me' : ''}`}>
      <span className="glyph">{glyph}</span>
      <span className="when">{event.start}&nbsp;—&nbsp;{event.end}</span>
      <span className="body">
        <span className="activity">{event.activity || 'Сеанс'}</span>
        <span className="kind">{kindWord}</span>
        {isMod && event.wasStart && <span className="was">было {event.wasStart}&nbsp;—&nbsp;{event.wasEnd}</span>}
      </span>
    </div>
  );
}

function JournalRow({ entry, isLatest }) {
  if (entry.baseline) {
    return (
      <div className="jr-row is-baseline">
        <span className="time">{window.Data.formatDayHeading(entry.checkedAt.slice(0, 10))}</span>
        <span className="desc">первый локальный снимок</span>
        <span className="pill">basis</span>
      </div>
    );
  }
  const t = new Date(entry.checkedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const dateIso = entry.checkedAt.slice(0, 10);
  const isOtherDay = dateIso !== window.Data.TODAY_ISO;
  const dateLabel = isOtherDay ? window.Data.formatDayHeading(dateIso) : null;
  const eventCount = entry.events?.length || 0;
  const isStable = !entry.hasChanges;
  const isAck = Boolean(entry.acknowledgedAt);
  return (
    <div className={`jr-row ${isLatest && !isAck ? 'is-active' : ''} ${isStable ? 'is-stable' : ''}`}>
      <span className="time">{isOtherDay ? `${dateLabel}, ${t}` : t}</span>
      <span className="desc">
        {isStable ? 'без изменений' : <><span className="em">{eventCount} {pluralizeEvents(eventCount)}</span></>}
      </span>
      <span className="pill">
        {isStable ? 'тихо' : isLatest && !isAck ? 'сейчас' : 'просмотрено'}
      </span>
    </div>
  );
}

function pluralizeEvents(n) {
  const last = n % 10, last2 = n % 100;
  if (last === 1 && last2 !== 11) return 'событие';
  if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return 'события';
  return 'событий';
}

function pluralizeSources(n) {
  const last = n % 10, last2 = n % 100;
  if (last === 1 && last2 !== 11) return 'источник';
  if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return 'источника';
  return 'источников';
}

window.ChangesScreen = ChangesScreen;
