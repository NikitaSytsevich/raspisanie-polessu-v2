// Тесты чистого форматирования сообщений бота (api/_lib/format.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  pairMoves, formatChangesMessage, formatDaySchedule, formatStatus, chunkText, esc,
  laneInfo, formatNow, formatWeek, dayNavKeyboard, settingsKeyboard,
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

test('formatChangesMessage: заголовок объекта — ссылка при наличии facUrls', () => {
  const events = [
    { kind: 'add', facilityId: 'ice_arena', date: '2026-06-10', start: '21:00', end: '22:00', activity: '' },
  ];
  const msg = formatChangesMessage(events, { ice_arena: 'Ледовая арена' }, {
    facUrls: { ice_arena: 'https://www.polessu.by/ice' },
  });
  assert.match(msg, /<b><a href="https:\/\/www\.polessu\.by\/ice">Ледовая арена<\/a><\/b> ·/);
});

test('formatChangesMessage: closure-заголовок — ссылка при наличии sourceUrl', () => {
  const msg = formatChangesMessage([], {}, { closures: [
    { kind: 'closed', name: 'Гребная база', sourceUrl: 'https://www.polessu.by/row', notice: 'ремонт' },
  ] });
  assert.match(msg, /⛔ <b><a href="https:\/\/www\.polessu\.by\/row">Гребная база<\/a><\/b> — закрыт: ремонт/);
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

test('formatDaySchedule: имя объекта — ссылка на источник при наличии sourceUrl', () => {
  const payload = { facilities: [
    { id: 'a', name: 'Арена', sourceUrl: 'https://www.polessu.by/arena', dataQuality: 'ok', closureRanges: [], sessions: [
      { date: '2026-06-10', start: '11:00', end: '12:30', activity: '' },
    ] },
  ] };
  const msg = formatDaySchedule(payload, '2026-06-10');
  assert.match(msg, /<b><a href="https:\/\/www\.polessu\.by\/arena">Арена<\/a><\/b>/);
});

test('formatDaySchedule: href в ссылке объекта экранируется', () => {
  const payload = { facilities: [
    { id: 'a', name: 'A', sourceUrl: 'https://x.test/?a=1&b=2', dataQuality: 'ok', closureRanges: [], sessions: [
      { date: '2026-06-10', start: '11:00', end: '12:00', activity: '' },
    ] },
  ] };
  const msg = formatDaySchedule(payload, '2026-06-10');
  assert.match(msg, /href="https:\/\/x\.test\/\?a=1&amp;b=2"/);
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

// ── laneInfo / дорожки в расписании ─────────────────────────────
test('laneInfo: большой бассейн отдаёт «N/M», ограничение крайних учтено', () => {
  assert.equal(laneInfo('sports_pool', ''), '🏊 свободно 10/10');
  assert.equal(laneInfo('sports_pool', 'Свободное плавание, без 2 крайних дорожек'), '🏊 свободно 8/10');
});

test('laneInfo: не-бассейновые объекты без дорожек → пусто', () => {
  assert.equal(laneInfo('ice_arena', 'Хоккей'), '');
  assert.equal(laneInfo('rowing_base', 'Тренажёрный зал'), '');
});

test('formatDaySchedule: у большого бассейна в строке сеанса — свободные дорожки', () => {
  const payload = { facilities: [
    { id: 'sports_pool', name: 'Большой бассейн', dataQuality: 'ok', closureRanges: [], sessions: [
      { date: '2026-06-10', start: '07:00', end: '08:00', activity: '' },
    ] },
  ] };
  const msg = formatDaySchedule(payload, '2026-06-10');
  assert.match(msg, /• 07:00–08:00 · 🏊 свободно 10\/10/);
});

test('formatDaySchedule: only фильтрует объекты', () => {
  const payload = { facilities: [
    { id: 'a', name: 'Арена', dataQuality: 'ok', closureRanges: [], sessions: [{ date: '2026-06-10', start: '11:00', end: '12:00', activity: '' }] },
    { id: 'b', name: 'Бассейн', dataQuality: 'ok', closureRanges: [], sessions: [{ date: '2026-06-10', start: '07:00', end: '08:00', activity: '' }] },
  ] };
  const msg = formatDaySchedule(payload, '2026-06-10', { only: ['a'] });
  assert.match(msg, /Арена/);
  assert.ok(!msg.includes('Бассейн'));
});

// ── formatNow ───────────────────────────────────────────────────
test('formatNow: текущий и следующий сеанс, потом — «больше нет»', () => {
  const payload = { facilities: [
    { id: 'a', name: 'Арена', dataQuality: 'ok', closureRanges: [], sessions: [
      { date: '2026-06-10', start: '10:00', end: '11:00', activity: 'Хоккей' },
      { date: '2026-06-10', start: '14:00', end: '15:00', activity: 'Массовое' },
    ] },
  ] };
  const at1030 = formatNow(payload, 630, '2026-06-10');
  assert.match(at1030, /🕘 <b>Сейчас · 10:30<\/b>/);
  assert.match(at1030, /🟢 идёт 10:00–11:00 Хоккей/);
  assert.match(at1030, /→ далее 14:00–15:00 Массовое/);

  const at1600 = formatNow(payload, 960, '2026-06-10');
  assert.match(at1600, /⚪ сейчас ничего/);
  assert.match(at1600, /на сегодня сеансов больше нет/);
});

// ── formatWeek ──────────────────────────────────────────────────
test('formatWeek: по дню — диапазоны объекта, пустые дни помечены', () => {
  const payload = { facilities: [
    { id: 'a', name: 'Арена', dataQuality: 'ok', closureRanges: [], sessions: [
      { date: '2026-06-10', start: '10:00', end: '11:00', activity: '' },
      { date: '2026-06-10', start: '19:00', end: '20:00', activity: '' },
    ] },
  ] };
  const msg = formatWeek(payload, '2026-06-10');
  assert.match(msg, /📆 <b>Расписание на неделю<\/b>/);
  assert.match(msg, /10 июня<\/b> · сегодня/);
  assert.match(msg, /<blockquote>Арена: 10:00–11:00, 19:00–20:00<\/blockquote>/);
  assert.match(msg, /— сеансов нет/); // дни без сеансов
});

// ── Инлайн-клавиатуры ───────────────────────────────────────────
test('dayNavKeyboard: соседние дни в callback_data, «Сегодня» только не на сегодня', () => {
  const kb = dayNavKeyboard('2026-06-10', '2026-06-10');
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'd:2026-06-09');
  assert.equal(kb.inline_keyboard[0][1].callback_data, 'r:2026-06-10');
  assert.equal(kb.inline_keyboard[0][2].callback_data, 'd:2026-06-11');
  assert.ok(!JSON.stringify(kb).includes('Сегодня'));

  const kb2 = dayNavKeyboard('2026-06-12', '2026-06-10');
  assert.ok(JSON.stringify(kb2).includes('"callback_data":"d:2026-06-10"'));
});

test('settingsKeyboard: галочки и тумблеры отражают prefs', () => {
  const facs = [{ id: 'a', name: 'Арена' }, { id: 'b', name: 'Бассейн' }];
  const all = settingsKeyboard({ objects: null, digest: true, subscribed: true }, facs);
  assert.match(all.inline_keyboard[0][0].text, /✅ Арена/);
  assert.equal(all.inline_keyboard[0][0].callback_data, 's:o:a');
  assert.match(JSON.stringify(all), /🔔 Утренний дайджест: вкл/);

  const some = settingsKeyboard({ objects: ['a'], digest: false, subscribed: false }, facs);
  assert.match(some.inline_keyboard[0][0].text, /✅ Арена/);
  assert.match(some.inline_keyboard[1][0].text, /⬜ Бассейн/);
  assert.match(JSON.stringify(some), /Утренний дайджест: выкл/);
  assert.match(JSON.stringify(some), /Уведомления: выкл/);
});
