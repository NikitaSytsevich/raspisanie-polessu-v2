// Переходы состояний объектов между prev/next снапшотами — чистая логика
// уведомлений /api/notify. Вынесена из notify.js, потому что glob тестов
// (`api/_lib/*.test.js`) не покрывает сами endpoint'ы.

// Здоровье источников: template/parse_error — парсер не понял страницу,
// stale — источник не ответил и подставлен last-known-good. closed сюда
// НЕ входит — это валидное состояние контента, а не сбой парсера.
const BAD_QUALITY = new Set(['template', 'parse_error', 'stale']);

function healthMap(payload) {
  const m = {};
  for (const f of payload.facilities || []) {
    m[f.id] = f.stale ? 'stale' : (f.dataQuality || 'unknown');
  }
  return m;
}

// Переходы здоровья между prev и next: деградация (ok/closed → bad) и
// восстановление (bad → ok/closed). Сравнение с prev даёт «N=1 с дедупом»:
// алерт уходит один раз на переход, а не на каждый прогон.
function healthTransitions(prev, next) {
  if (!prev) return [];
  const was = healthMap(prev);
  const now = healthMap(next);
  const lines = [];
  for (const f of next.facilities || []) {
    const a = was[f.id];
    const b = now[f.id];
    if (!a || a === b) continue;
    if (BAD_QUALITY.has(b) && !BAD_QUALITY.has(a)) lines.push(`🔴 ${f.name}: ${a} → ${b}`);
    else if (BAD_QUALITY.has(a) && !BAD_QUALITY.has(b)) lines.push(`🟢 ${f.name}: ${a} → ${b}`);
  }
  return lines;
}

// Переходы «работает ↔ закрыт» — пользовательское уведомление: в отличие
// от template/parse_error это содержательное состояние сайта, а не сбой
// парсера. Сессии закрывшегося/открывшегося объекта в diff не попадают
// (computeScheduleDiff пропускает не-ok объекты с любой стороны) — иначе
// закрытие выглядело бы как flood ➖ на каждый слот без объяснения.
function closureTransitions(prev, next) {
  if (!prev) return [];
  const was = new Map((prev.facilities || []).map(f => [f.id, f]));
  const out = [];
  for (const f of next.facilities || []) {
    const a = was.get(f.id);
    if (!a || a.dataQuality === f.dataQuality) continue;
    if (f.dataQuality === 'closed' && a.dataQuality === 'ok') {
      out.push({ kind: 'closed', name: f.name, notice: f.notice || null });
    } else if (a.dataQuality === 'closed' && f.dataQuality === 'ok') {
      out.push({ kind: 'reopened', name: f.name });
    }
  }
  return out;
}

module.exports = { BAD_QUALITY, healthMap, healthTransitions, closureTransitions };
