// Чистое форматирование сообщений Telegram-бота (без сети и Blob) —
// покрывается node-тестами (format.test.js).

const RU_WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const RU_MO = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
               'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Telegram обрезает сообщения на 4096 символах; режем с запасом.
const TG_TEXT_LIMIT = 4000;

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Имя объекта как ссылка на его страницу-источник (polessu.by). Имя и href
// экранируются для HTML parse_mode; без url — просто имя (closures без
// источника, фикстуры тестов). В <b> оборачиваем на месте вызова —
// Telegram допускает вложенность <b><a>…</a></b>.
function facilityLink(name, url) {
  const safe = esc(name);
  return url ? `<a href="${esc(url)}">${safe}</a>` : safe;
}

function fmtDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return `${RU_WD[d.getDay()]}, ${d.getDate()} ${RU_MO[d.getMonth()]}`;
}

function toMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

// ── Склейка переносов ───────────────────────────────────────────
// computeScheduleDiff матчит сессии по (start,end), поэтому сдвиг времени
// приходит как пара несвязанных rem+add — в сообщении это читается как
// «сеанс отменили» + «появился новый». Здесь спариваем их обратно в одно
// событие kind:'move' («🔁 было → стало»). Матчим внутри (объект, дата):
// ближайший по старту add (совпадение activity — сильный бонус), не дальше
// 3 часов. Непарные add/rem остаются как есть.
function pairMoves(events) {
  const byGroup = new Map();
  for (const ev of events) {
    const k = `${ev.facilityId}::${ev.date}`;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(ev);
  }
  const out = [];
  for (const evs of byGroup.values()) {
    const adds = evs.filter(e => e.kind === 'add');
    const rems = evs.filter(e => e.kind === 'rem');
    const rest = evs.filter(e => e.kind !== 'add' && e.kind !== 'rem');
    const usedAdd = new Set();
    for (const rem of rems) {
      let best = null;
      let bestScore = Infinity;
      for (const add of adds) {
        if (usedAdd.has(add)) continue;
        const dist = Math.abs(toMin(add.start) - toMin(rem.start));
        if (dist > 180) continue;
        const sameAct = (add.activity || '') === (rem.activity || '');
        const score = dist + (sameAct ? 0 : 240);
        if (score < bestScore) { bestScore = score; best = add; }
      }
      if (best) {
        usedAdd.add(best);
        out.push({
          kind: 'move',
          facilityId: rem.facilityId,
          date: rem.date,
          from: { start: rem.start, end: rem.end },
          start: best.start,
          end: best.end,
          activity: best.activity || rem.activity || '',
        });
      } else {
        out.push(rem);
      }
    }
    for (const add of adds) if (!usedAdd.has(add)) out.push(add);
    out.push(...rest);
  }
  out.sort((x, y) => x.date.localeCompare(y.date) || x.start.localeCompare(y.start));
  return out;
}

// ── Сообщение об изменениях ─────────────────────────────────────
// events — после pairMoves (kind: add|rem|mod|move). У события может быть
// affectsMe:true — строка получает пометку «ваша смена».
// opts.closures — переходы «работает ↔ закрыт» из notify.closureTransitions:
// [{ kind: 'closed'|'reopened', name, notice? }] — идут сразу под заголовком.
function formatChangesMessage(events, facNames, { closures = [], facUrls = {} } = {}) {
  const groups = new Map();
  for (const ev of events) {
    const key = `${ev.facilityId}::${ev.date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  const lines = ['🔔 <b>Расписание ПолесГУ — изменения на сайте</b>'];
  for (const c of closures) {
    const head = facilityLink(c.name, c.sourceUrl);
    lines.push('', c.kind === 'closed'
      ? `⛔ <b>${head}</b> — закрыт${c.notice ? `: ${esc(c.notice)}` : ''}`
      : `✅ <b>${head}</b> — снова работает`);
  }
  for (const [key, evs] of groups) {
    const [facId, date] = key.split('::');
    lines.push('', `<b>${facilityLink(facNames[facId] || facId, facUrls[facId])}</b> · ${fmtDate(date)}`);
    const evLines = [];
    for (const ev of evs.slice(0, 15)) {
      let line;
      if (ev.kind === 'move') {
        line = `🔁 ${ev.from.start}–${ev.from.end} → ${ev.start}–${ev.end}`;
        if (ev.activity) line += ` (${esc(ev.activity)})`;
      } else if (ev.kind === 'mod') {
        line = `✏️ ${ev.start}–${ev.end}: ${esc(ev.wasActivity || '—')} → ${esc(ev.activity || '—')}`;
      } else {
        const sign = ev.kind === 'add' ? '➕' : '➖';
        line = `${sign} ${ev.start}–${ev.end}`;
        if (ev.activity) line += ` (${esc(ev.activity)})`;
      }
      if (ev.affectsMe) line += ' · ⚠️ ваша смена';
      evLines.push(line);
    }
    if (evs.length > 15) evLines.push(`… и ещё ${evs.length - 15}`);
    // Список изменений объекта — в цитату: визуально отделяет объекты друг от
    // друга. Не expandable — уведомление об изменениях должно читаться сразу.
    lines.push(`<blockquote>${evLines.join('\n')}</blockquote>`);
  }
  return lines.join('\n');
}

// ── Расписание на день (/today, /tomorrow, дайджест) ────────────
function formatDaySchedule(payload, dateIso, { title = null } = {}) {
  const lines = [title || `📅 <b>Расписание ПолесГУ · ${fmtDate(dateIso)}</b>`];
  for (const f of payload.facilities || []) {
    lines.push('', `<b>${facilityLink(f.name, f.sourceUrl)}</b>${f.stale ? ' · ⚠️ данные могли устареть' : ''}`);
    if (f.dataQuality === 'closed') {
      lines.push(`⛔ закрыт${f.notice ? ` — ${esc(f.notice)}` : ''}`);
      continue;
    }
    if (f.dataQuality !== 'ok') {
      lines.push('— нет данных (источник не распарсен)');
      continue;
    }
    const closure = (f.closureRanges || []).find(r => dateIso >= r.from && dateIso <= r.to);
    if (closure) {
      lines.push(`⛔ закрыт${closure.notice ? ` — ${esc(closure.notice)}` : ''}`);
      continue;
    }
    const sessions = (f.sessions || [])
      .filter(s => s.date === dateIso)
      .sort((a, b) => toMin(a.start) - toMin(b.start));
    if (!sessions.length) {
      lines.push('— на эту дату сеансов нет');
      continue;
    }
    // Сеансы объекта — в цитату: группирует список под заголовком и отделяет
    // объекты друг от друга. Развёрнута по умолчанию (без expandable) —
    // расписание видно сразу, без тапа «показать ещё».
    const body = sessions
      .map(s => `• ${s.start}–${s.end}${s.activity ? ` ${esc(s.activity)}` : ''}`)
      .join('\n');
    lines.push(`<blockquote>${body}</blockquote>`);
  }
  return lines.join('\n');
}

// ── Статус источников (/status) ─────────────────────────────────
function formatStatus(payload) {
  const lines = ['🛠 <b>Статус источников</b>'];
  for (const f of payload.facilities || []) {
    let icon, note;
    if (f.stale) { icon = '🟡'; note = 'источник не ответил, данные last-good'; }
    else if (f.dataQuality === 'ok') { icon = '🟢'; note = 'ок'; }
    else if (f.dataQuality === 'closed') { icon = '⛔'; note = f.notice || 'закрыт'; }
    else { icon = '🔴'; note = f.dataQuality; }
    lines.push(`${icon} ${esc(f.name)} — ${esc(note)}`);
  }
  const at = payload.generatedAt ? new Date(payload.generatedAt) : null;
  if (at) {
    const hm = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Minsk', hour: '2-digit', minute: '2-digit',
    }).format(at);
    lines.push('', `проверено в ${hm} (Минск)`);
  }
  return lines.join('\n');
}

// ── Разбивка длинного текста на части ≤ limit ───────────────────
// Режем по границам строк. Тонкость: <blockquote>…</blockquote> бывает
// многострочным (сеансы объекта в /today, группа изменений) — рвать его между
// частями нельзя: в одной части окажется незакрытый тег, и Telegram отвергнет
// сообщение как битый HTML. Поэтому blockquote — атомарный сегмент; если он сам
// длиннее лимита (патология), режем на несколько валидных под-цитат, повторяя
// открывающий тег.
const BQ_OPEN = /^<blockquote(?: expandable)?>/;
const BQ_CLOSE_RE = /<\/blockquote>$/;
const BQ_CLOSE = '</blockquote>';

function hardSplit(s, limit) {
  const out = [];
  for (let i = 0; i < s.length; i += limit) out.push(s.slice(i, i + limit));
  return out;
}

// Текст → сегменты: многострочный blockquote целиком одним элементом,
// остальное — построчно.
function segmentize(text) {
  const lines = String(text).split('\n');
  const segs = [];
  for (let i = 0; i < lines.length; i++) {
    if (BQ_OPEN.test(lines[i]) && !BQ_CLOSE_RE.test(lines[i])) {
      const buf = [lines[i]];
      while (i + 1 < lines.length && !BQ_CLOSE_RE.test(lines[i])) buf.push(lines[++i]);
      segs.push(buf.join('\n'));
    } else {
      segs.push(lines[i]);
    }
  }
  return segs;
}

// Слишком длинный blockquote → несколько валидных <blockquote>…</blockquote>,
// каждый ≤ limit; открывающий тег повторяется в каждой части.
function splitBlockquote(seg, limit) {
  const open = BQ_OPEN.exec(seg)[0];
  const inner = seg.slice(open.length).replace(BQ_CLOSE_RE, '');
  const budget = Math.max(1, limit - open.length - BQ_CLOSE.length);
  const pieces = [];
  let body = '';
  const flush = () => { if (body) { pieces.push(open + body + BQ_CLOSE); body = ''; } };
  for (const line of inner.split('\n')) {
    if (line.length > budget) {
      flush();
      for (const part of hardSplit(line, budget)) pieces.push(open + part + BQ_CLOSE);
      continue;
    }
    const candidate = body ? body + '\n' + line : line;
    if (candidate.length > budget) { flush(); body = line; }
    else body = candidate;
  }
  flush();
  return pieces;
}

function chunkText(text, limit = TG_TEXT_LIMIT) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let cur = '';
  const push = (piece) => {
    const candidate = cur ? cur + '\n' + piece : piece;
    if (candidate.length > limit) { if (cur) chunks.push(cur); cur = piece; }
    else cur = candidate;
  };
  for (const seg of segmentize(text)) {
    if (seg.length <= limit) { push(seg); continue; }
    // Сегмент длиннее лимита: blockquote — на под-цитаты, прочее — жёстко.
    if (cur) { chunks.push(cur); cur = ''; }
    const pieces = BQ_OPEN.test(seg) ? splitBlockquote(seg, limit) : hardSplit(seg, limit);
    for (const p of pieces) push(p);
  }
  if (cur) chunks.push(cur);
  return chunks;
}

module.exports = {
  esc,
  fmtDate,
  toMin,
  pairMoves,
  formatChangesMessage,
  formatDaySchedule,
  formatStatus,
  chunkText,
  TG_TEXT_LIMIT,
};
