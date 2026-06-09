// ──────────────────────────────────────────────────────────────────
// app/stats.jsx — статистика отработанных часов за неделю / месяц.
//
// Агрегирует смены периода через Data.computeEffectiveShift — той же
// формулой, что и карточки на главной: «по сайту» (badge confirmed),
// «по графику» (нет данных сайта / не сматчено), закрытые объекты
// в часы не идут. Разбивка по объектам + экспорт CSV (для бухгалтерии).
// ──────────────────────────────────────────────────────────────────

const { useState: _sts, useEffect: _ste, useMemo: _stm } = React;

const RU_MONTHS_NOM = ['январь','февраль','март','апрель','май','июнь',
                       'июль','август','сентябрь','октябрь','ноябрь','декабрь'];

function _pad2(n) { return String(n).padStart(2, '0'); }
function isoAddDays(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
}
function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00');
  return isoAddDays(iso, -((d.getDay() + 6) % 7));
}
function monthStartOf(iso, offset = 0) {
  const d = new Date(iso + 'T12:00:00');
  const m = new Date(d.getFullYear(), d.getMonth() + offset, 1, 12);
  return `${m.getFullYear()}-${_pad2(m.getMonth() + 1)}-01`;
}
function monthEndOf(startIso) {
  const d = new Date(startIso + 'T12:00:00');
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
  return `${e.getFullYear()}-${_pad2(e.getMonth() + 1)}-${_pad2(e.getDate())}`;
}

function StatsScreen() {
  const router = window.useRouter();
  const toast = window.UI.useToast();
  const [period, setPeriod] = _sts('week'); // 'week' | 'month'
  const [offset, setOffset] = _sts(0);      // 0 — текущий, −1 — предыдущий…
  const [shifts, setShifts] = _sts(() => window.Data.loadShifts());

  _ste(() => {
    const reload = () => setShifts(window.Data.loadShifts());
    window.addEventListener('rpgu:shifts-changed', reload);
    window.addEventListener('focus', reload);
    return () => {
      window.removeEventListener('rpgu:shifts-changed', reload);
      window.removeEventListener('focus', reload);
    };
  }, []);

  const today = window.Data.TODAY_ISO;

  const range = _stm(() => {
    if (period === 'week') {
      const from = isoAddDays(mondayOf(today), offset * 7);
      return { from, to: isoAddDays(from, 6) };
    }
    const from = monthStartOf(today, offset);
    return { from, to: monthEndOf(from) };
  }, [period, offset, today]);

  const rangeLabel = _stm(() => {
    const d1 = new Date(range.from + 'T12:00:00');
    const d2 = new Date(range.to + 'T12:00:00');
    if (period === 'month') return `${RU_MONTHS_NOM[d1.getMonth()]} ${d1.getFullYear()}`;
    const m1 = window.Data.RU_MONTHS[d1.getMonth()];
    const m2 = window.Data.RU_MONTHS[d2.getMonth()];
    return d1.getMonth() === d2.getMonth()
      ? `${d1.getDate()} — ${d2.getDate()} ${m2}`
      : `${d1.getDate()} ${m1} — ${d2.getDate()} ${m2}`;
  }, [range, period]);

  const stats = _stm(() => {
    const rows = [];
    let confirmedMin = 0, plannedMin = 0, closedCount = 0;
    const perFac = new Map();
    const days = new Set();
    for (const s of shifts) {
      if (s.date < range.from || s.date > range.to) continue;
      const eff = window.Data.computeEffectiveShift(s);
      const schedMin = window.Data.toMinutes(s.end) - window.Data.toMinutes(s.start);
      const fac = perFac.get(s.facilityId) || { confirmed: 0, planned: 0, count: 0 };
      if (eff.badge === 'closed') {
        closedCount++;
      } else if (eff.badge === 'confirmed') {
        confirmedMin += eff.minutes;
        fac.confirmed += eff.minutes;
        days.add(s.date);
      } else {
        plannedMin += eff.minutes;
        fac.planned += eff.minutes;
        days.add(s.date);
      }
      fac.count++;
      perFac.set(s.facilityId, fac);
      rows.push({ shift: s, eff, schedMin });
    }
    rows.sort((a, b) =>
      a.shift.date.localeCompare(b.shift.date) ||
      a.shift.start.localeCompare(b.shift.start));
    const facRows = Array.from(perFac.entries())
      .map(([facilityId, agg]) => ({ facilityId, ...agg, total: agg.confirmed + agg.planned }))
      .sort((a, b) => b.total - a.total);
    return { rows, confirmedMin, plannedMin, closedCount, facRows, dayCount: days.size };
  }, [shifts, range]);

  const totalMin = stats.confirmedMin + stats.plannedMin;
  const maxFacTotal = stats.facRows.length ? stats.facRows[0].total : 0;

  // CSV для бухгалтерии/самоконтроля: по строке на смену + итог.
  // BOM, чтобы Excel сразу понял UTF-8; разделитель ';' — локаль RU.
  function handleCsv() {
    if (!stats.rows.length) {
      toast.show('Нет смен за этот период');
      return;
    }
    try {
      const head = 'Дата;Объект;Начало;Конец;По графику, мин;Фактически, мин;Статус';
      const status = { confirmed: 'по сайту', closed: 'закрыт', not_in_site: 'нет на сайте', no_data: 'по графику' };
      const lines = stats.rows.map(({ shift: s, eff, schedMin }) => [
        s.date,
        window.Data.getFacility(s.facilityId)?.name || s.facilityId,
        s.start, s.end, schedMin,
        eff.badge === 'closed' ? 0 : eff.minutes,
        status[eff.badge] || eff.badge,
      ].join(';'));
      lines.push(['Итого', '', '', '', '', totalMin, ''].join(';'));
      const blob = new Blob(['\uFEFF' + [head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `raspisanie-stats-${range.from}-${range.to}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
      toast.show('CSV скачан');
    } catch {
      toast.show('Не удалось сохранить файл');
    }
  }

  return (
    <div className="screen stats-screen">
      <window.UI.StatusBar/>
      <window.UI.AppHeader
        left={<window.UI.IconBtn icon="arrow_back" title="Назад" onClick={() => router.pop()}/>}
        title="Статистика"
        meta={rangeLabel}
        right={
          <window.UI.IconBtn icon="download" title="Скачать CSV" onClick={handleCsv}/>
        }
      />

      <div className="screen-scroll">
        <section className="hero stats-hero">
          <p className="hero-kicker">{period === 'week' ? 'Неделя' : 'Месяц'} · {rangeLabel}</p>
          <h1 className="hero-title">
            <em>{window.Data.formatDuration(totalMin)}</em> работы
          </h1>
          <div className="hero-stats">
            <span className="stat"><strong>{window.Data.formatDuration(stats.confirmedMin)}</strong> по сайту</span>
            <span className="sep"/>
            <span className="stat"><strong>{window.Data.formatDuration(stats.plannedMin)}</strong> по графику</span>
            <span className="sep"/>
            <span className="stat"><strong>{stats.dayCount}</strong> {pluralizeDays(stats.dayCount)}</span>
          </div>
          {stats.closedCount > 0 && (
            <p className="hero-meta">из них {stats.closedCount} {pluralizeShiftsStats(stats.closedCount)} на закрытых объектах — не в счёте</p>
          )}
        </section>

        <div className="stats-controls">
          <div className="stats-seg" role="tablist" aria-label="Период">
            {[['week', 'Неделя'], ['month', 'Месяц']].map(([val, label]) => (
              <button
                key={val}
                type="button"
                role="tab"
                aria-selected={period === val}
                className={`seg-btn ${period === val ? 'is-active' : ''}`}
                onClick={() => { setPeriod(val); setOffset(0); }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="stats-nav">
            <button type="button" className="ws-arrow" aria-label="Предыдущий период"
                    onClick={() => setOffset(o => o - 1)}>
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            {offset !== 0 && (
              <button type="button" className="ws-today" onClick={() => setOffset(0)}>
                <span className="material-symbols-outlined">undo</span>
                к текущему
              </button>
            )}
            <button type="button" className="ws-arrow" aria-label="Следующий период"
                    onClick={() => setOffset(o => o + 1)}>
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        </div>

        {stats.facRows.length > 0 && (
          <>
            <window.UI.SecLabel>По объектам</window.UI.SecLabel>
            <section className="stats-facs">
              {stats.facRows.map(r => {
                const fac = window.Data.getFacility(r.facilityId);
                const pct = maxFacTotal ? Math.round((r.total / maxFacTotal) * 100) : 0;
                const confirmedPct = r.total ? Math.round((r.confirmed / r.total) * 100) : 0;
                return (
                  <div key={r.facilityId} className="stats-fac-row">
                    <span className="ic"><span className="material-symbols-outlined">{fac?.icon || 'place'}</span></span>
                    <div className="body">
                      <div className="top">
                        <span className="name">{fac?.name || r.facilityId}</span>
                        <span className="val">{window.Data.formatDuration(r.total)}</span>
                      </div>
                      <div className="bar" style={{ ['--w']: pct + '%' }}>
                        <span className="fill" style={{ width: pct + '%' }}>
                          <span className="conf" style={{ width: confirmedPct + '%' }}/>
                        </span>
                      </div>
                      <span className="sub">{r.count} {pluralizeShiftsStats(r.count)}
                        {r.planned > 0 && <> · {window.Data.formatDuration(r.planned)} без подтверждения</>}
                      </span>
                    </div>
                  </div>
                );
              })}
            </section>
          </>
        )}

        {stats.rows.length > 0 ? (
          <>
            <window.UI.SecLabel count={stats.rows.length}>Смены периода</window.UI.SecLabel>
            <section className="stats-days">
              {stats.rows.map(({ shift: s, eff }) => {
                const fac = window.Data.getFacility(s.facilityId);
                const d = new Date(s.date + 'T12:00:00');
                return (
                  <div key={s.id} className={`stats-shift-row is-${eff.badge}`}>
                    <span className="when">
                      <span className="num">{d.getDate()}</span>
                      <span className="wd">{window.Data.RU_WEEKDAYS_SHORT[d.getDay()].toLowerCase()}</span>
                    </span>
                    <div className="body">
                      <p className="place">{fac?.name || s.facilityId}</p>
                      <span className="time">{s.start} — {s.end}</span>
                    </div>
                    <span className="mins">
                      {eff.badge === 'closed'
                        ? <span className="closed">закрыт</span>
                        : window.Data.formatDuration(eff.minutes)}
                    </span>
                  </div>
                );
              })}
            </section>
            <button type="button" className="stats-csv-btn" onClick={handleCsv}>
              <span className="material-symbols-outlined">download</span>
              <span>Скачать CSV за период</span>
            </button>
          </>
        ) : (
          <section className="timeline">
            <div className="day-empty">
              <span className="material-symbols-outlined glyph">bar_chart</span>
              <p className="text">Смен&nbsp;<em>за этот период</em>&nbsp;нет.</p>
            </div>
          </section>
        )}

        <window.UI.HomeIndicator/>
      </div>
    </div>
  );
}

function pluralizeDays(n) {
  const last = n % 10, last2 = n % 100;
  if (last === 1 && last2 !== 11) return 'день';
  if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return 'дня';
  return 'дней';
}
function pluralizeShiftsStats(n) {
  const last = n % 10, last2 = n % 100;
  if (last === 1 && last2 !== 11) return 'смена';
  if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return 'смены';
  return 'смен';
}

window.StatsScreen = StatsScreen;
