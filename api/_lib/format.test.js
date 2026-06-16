// Тесты чистого форматирования сообщений бота (api/_lib/format.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  pairMoves, formatChangesMessage, formatDaySchedule, formatStatus, chunkText, esc,
} = require('./format');

// ── pairMoves ───────────────────────────────────────────────────
test('pairMoves: rem+add одного объекта/даты склеиваются в move', () => {
  const events = [
    { id: 'e1', kind: 'rem', facilityId: 'ice_arena', date: '2026-06-10', start: '09:45', end: '11:15', activity: 'Массовое катание' },
    { id: 'e2', kind: 'add', facilityId: 'ice_arena', date: '2026-06-10', start: '10:00', end: '11:30', activity: 'Массовое катание' },
  ];
  const out = pairMoves(events);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'move');
  assert.deepEqual(out[0].from, { start: '09:45', end: '11:15' });
  assert.equal(out[0].start, '10:00');
  assert.equal(out[0].end, '11:30');
});

test('pairMoves: разные даты/объекты не склеиваются', () => {
  const events = [
    { id: 'e1', kind: 'rem', facilityId: 'ice_arena', date: '2026-06-10', start: '09:45', end: '11:15', activity: '' },
    { id: 'e2', kind: 'add', facilityId: 'ice_arena', date: '2026-06-11', start: '09:45', end: '11:15', activity: '' },
    { id: 'e3', kind: 'add', facilityId: 'sports_pool', date: '2026-06-10', start: '09:45', end: '11:15', activity: '' },
  ];
  const out = pairMoves(events);
  assert.deepEqual(out.map(e => e.kind).sort(), ['add', 'add', 'rem']);
});

test('pairMoves: дальше 3 часов не пара', () => {
  const events = [
    { id: 'e1', kind: 'rem', facilityId: 'ice_arena', date: '2026-06-10', start: '08:00', end: '09:00', activity: '' },
    { id: 'e2', kind: 'add', facilityId: 'ice_arena', date: '2026-06-10', start: '20:00', end: '21:00', activity: '' },
  ];
  const out = pairMoves(events);
  assert.deepEqual(out.map(e => e.kind).sort(), ['add', 'rem']);
});

test('pairMoves: при двух кандидатах выигрывает совпадение activity', () => {
  const events = [
    { id: 'e1', kind: 'rem', facilityId: 'ice_arena', date: '2026-06-10', start: '10:00', end: '11:00', activity: 'Хоккей' },
    { id: 'e2', kind: 'add', facilityId: 'ice_arena', date: '2026-06-10', start: '10:15', end: '11:15', activity: 'Массовое' },
    { id: 'e3', kind: 'add', facilityId: 'ice_arena', date: '2026-06-10', start: '11:00', end: '12:00', activity: 'Хоккей' },
  ];
  const out = pairMoves(events);
  const move = out.find(e => e.kind === 'move');
  assert.equal(move.start, '11:00');
  assert.equal(move.activity, 'Хоккей');
  // Непарный add остаётся как есть
  assert.ok(out.some(e => e.kind === 'add' && e.start === '10:15'));
});

test('pairMoves: mod проходит насквозь', () => {
  const events = [
    { id: 'e1', kind: 'mod', facilityId: 'ice_arena', date: '2026-06-10', start: '10:00', end: '11:00', activity: 'Б', wasActivity: 'А' },
  ];
  const out = pairMoves(events);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'mod');
});

// ── formatChangesMessage ────────────────────────────────────────
test('formatChangesMessage: move-строка и пометка «ваша смена»', () => {
  const events = [
    { kind: 'move', facilityId: 'ice_arena', date: '2026-06-10', from: { start: '09:45', end: '11:15' }, start: '10:00', end: '11:30', activity: 'Массовое', affectsMe: true },
    { kind: 'add', facilityId: 'ice_arena', date: '2026-06-10', start: '21:00', end: '22:00', activity: '' },
  ];
  const msg = formatChangesMessage(events, { ice_arena: 'Ледовая арена' });
  assert.match(msg, /Ледовая арена/);
  assert.match(msg, /🔁 09:45–11:15 → 10:00–11:30 \(Массовое\)/);
  assert.match(msg, /⚠️ ваша смена/);
  assert.match(msg, /➕ 21:00–22:00/);
});

test('formatChangesMessage: HTML экранируется', () => {
  const events = [
    { kind: 'add', facilityId: 'x', date: '2026-06-10', start: '10:00', end: '11:00', activity: '<b>хак</b>' },
  ];
  const msg = formatChangesMessage(events, { x: 'A & B' });
  assert.match(msg, /A &amp; B/);
  assert.match(msg, /&lt;b&gt;хак&lt;\/b&gt;/);
});

test('formatChangesMessage: closures — «закрыт» и «снова работает», без событий расписания', () => {
  const msg = formatChangesMessage([], {}, { closures: [
    { kind: 'closed', name: 'Гребная база', notice: 'ремонт до 01.07' },
    { kind: 'reopened', name: 'Малый бассейн' },
  ] });
  assert.match(msg, /⛔ <b>Гребная база<\/b> — закрыт: ремонт до 01\.07/);
  assert.match(msg, /✅ <b>Малый бассейн<\/b> — снова работает/);
  assert.match(msg, /изменения на сайте/);
});

test('formatChangesMessage: события объекта обёрнуты в blockquote, заголовок — снаружи', () => {
  const events = [
    { kind: 'add', facilityId: 'ice_arena', date: '2026-06-10', start: '21:00', end: '22:00', activity: '' },
    { kind: 'rem', facilityId: 'ice_arena', date: '2026-06-10', start: '08:00', end: '09:00', activity: '' },
  ];
  const msg = formatChangesMessage(events, { ice_arena: 'Ледовая арена' });
  assert.match(msg, /<b>Ледовая арена<\/b> · [^\n]+\n<blockquote>/);
  assert.match(msg, /<blockquote>➕ 21:00–22:00\n➖ 08:00–09:00<\/blockquote>/);
});

// ── formatDaySchedule ───────────────────────────────────────────
test('formatDaySchedule: сеансы, пустой день, закрытие', () => {
  const payload = {
    facilities: [
      { id: 'a', name: 'Арена', dataQuality: 'ok', sessions: [
        { date: '2026-06-10', start: '11:00', end: '12:30', activity: 'Массовое' },
        { date: '2026-06-11', start: '09:00', end: '10:00', activity: '' },
      ], closureRanges: [] },
      { id: 'b', name: 'Бассейн', dataQuality: 'ok', sessions: [], closureRanges: [
        { from: '2026-06-01', to: '2026-06-20', notice: 'нет воды' },
      ] },
      { id: 'c', name: 'База', dataQuality: 'template', sessions: [] },
    ],
  };
  const msg = formatDaySchedule(payload, '2026-06-10');
  assert.match(msg, /• 11:00–12:30 Массовое/);
  assert.ok(!msg.includes('09:00–10:00')); // чужая дата не попадает
  assert.match(msg, /Бассейн/);
  assert.match(msg, /⛔ закрыт — нет воды/);
  assert.match(msg, /нет данных/);
});

test('formatDaySchedule: сеансы обёрнуты в blockquote (развёрнутый), заголовок — снаружи', () => {
  const payload = { facilities: [
    { id: 'a', name: 'Арена', dataQuality: 'ok', closureRanges: [], sessions: [
      { date: '2026-06-10', start: '11:00', end: '12:30', activity: 'Массовое' },
      { date: '2026-06-10', start: '13:00', end: '14:00', activity: '' },
    ] },
  ] };
  const msg = formatDaySchedule(payload, '2026-06-10');
  assert.match(msg, /<blockquote>• 11:00–12:30 Массовое\n• 13:00–14:00<\/blockquote>/);
  // Развёрнута по умолчанию — без атрибута expandable.
  assert.ok(!msg.includes('<blockquote expandable>'));
  // Имя объекта — вне цитаты, заголовок виден всегда.
  assert.match(msg, /<b>Арена<\/b>\n<blockquote>/);
});

// ── formatStatus ────────────────────────────────────────────────
test('formatStatus: иконки по качеству данных', () => {
  const payload = {
    generatedAt: new Date().toISOString(),
    facilities: [
      { id: 'a', name: 'Арена', dataQuality: 'ok' },
      { id: 'b', name: 'База', dataQuality: 'template' },
      { id: 'c', name: 'Бассейн', dataQuality: 'ok', stale: true },
    ],
  };
  const msg = formatStatus(payload);
  assert.match(msg, /🟢 Арена/);
  assert.match(msg, /🔴 База/);
  assert.match(msg, /🟡 Бассейн/);
});

// ── chunkText ───────────────────────────────────────────────────
test('chunkText: короткий текст не режется', () => {
  assert.deepEqual(chunkText('hello', 100), ['hello']);
});

test('chunkText: режет по границам строк, ничего не теряя', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `строка ${i} ${'x'.repeat(20)}`);
  const text = lines.join('\n');
  const chunks = chunkText(text, 300);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 300);
  assert.equal(chunks.join('\n'), text);
});

test('chunkText: сверхдлинная строка режется жёстко', () => {
  const text = 'a'.repeat(950);
  const chunks = chunkText(text, 300);
  assert.ok(chunks.every(c => c.length <= 300));
  assert.equal(chunks.join(''), text);
});

// Баланс тегов: разрыв внутри <blockquote> дал бы Telegram битый HTML (400).
const bqBalanced = (c) =>
  (c.match(/<blockquote/g) || []).length === (c.match(/<\/blockquote>/g) || []).length;

test('chunkText: не рвёт blockquote между частями (цитата атомарна)', () => {
  const bq = (label) => '<blockquote expandable>' +
    Array.from({ length: 10 }, (_, i) => `• ${label} строка ${i}`).join('\n') +
    '</blockquote>';
  const text = `<b>A</b>\n${bq('A')}\n\n<b>B</b>\n${bq('B')}`;
  const chunks = chunkText(text, 300);
  assert.ok(chunks.length > 1);                       // реально нарезалось
  for (const c of chunks) assert.ok(bqBalanced(c), `несбалансированные теги: ${c}`);
});

test('chunkText: слишком длинный blockquote режется на валидные под-цитаты', () => {
  const inner = Array.from({ length: 60 }, (_, i) => `• строка номер ${i}`).join('\n');
  const text = `<blockquote expandable>${inner}</blockquote>`;
  const chunks = chunkText(text, 200);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.length <= 200);
    assert.match(c, /^<blockquote expandable>/);      // каждая часть — целая цитата
    assert.match(c, /<\/blockquote>$/);
    assert.equal((c.match(/<blockquote/g) || []).length, 1);
    assert.equal((c.match(/<\/blockquote>/g) || []).length, 1);
  }
  // Содержимое не потеряно: склеив inner всех частей, получаем исходные строки.
  const restored = chunks
    .map(c => c.replace(/^<blockquote expandable>/, '').replace(/<\/blockquote>$/, ''))
    .join('\n');
  assert.equal(restored, inner);
});

test('esc: базовое экранирование', () => {
  assert.equal(esc('<a & b>'), '&lt;a &amp; b&gt;');
});
