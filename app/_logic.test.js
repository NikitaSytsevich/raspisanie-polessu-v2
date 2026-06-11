// node --test — покрывает чистую клиентскую логику из app/_logic.js.
// Это самая багоопасная часть (комментарии в data.jsx ссылались на
// «баг #1/#3/#4 из аудита» именно в diff'е и раскладке дорожек), но до
// выноса в отдельный модуль она была заперта в window.Data и не тестилась.

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./_logic.js');

test('toMinutes / minutesToHHMM: туда-обратно', () => {
  assert.equal(L.toMinutes('12:30'), 750);
  assert.equal(L.toMinutes('00:00'), 0);
  assert.equal(L.minutesToHHMM(750), '12:30');
  assert.equal(L.minutesToHHMM(0), '00:00');
  assert.equal(L.minutesToHHMM(L.toMinutes('07:05')), '07:05');
});

test('formatDuration: часы и минуты', () => {
  assert.equal(L.formatDuration(90), '1 ч 30 м');
  assert.equal(L.formatDuration(120), '2 ч');
  assert.equal(L.formatDuration(45), '45 м');
});

test('buildLanes: «6 свободно, без 2 крайних» → {0,7,8,9}', () => {
  // Пример из README: крайний правый + два слева к центру | шесть свободных | крайний правый.
  assert.deepEqual(L.buildLanes(10, 6, 2), [0, 7, 8, 9]);
});

test('buildLanes: один край занят', () => {
  assert.deepEqual(L.buildLanes(10, 9, 1), [0]);
});

test('inferSessionIndicator: бескрайний → lanes-free', () => {
  assert.deepEqual(L.inferSessionIndicator('sports_pool', 'свободная вода'), { type: 'lanes-free' });
  assert.deepEqual(L.inferSessionIndicator('sports_pool', 'без разделения'), { type: 'lanes-free' });
});

test('inferSessionIndicator: «6 дорожек, без 2 крайних»', () => {
  const ind = L.inferSessionIndicator('sports_pool', 'свободно 6 дорожек, без 2 крайних');
  assert.equal(ind.type, 'lanes');
  assert.equal(ind.total, 10);
  assert.equal(ind.free, 6);
  assert.deepEqual(ind.occupied, [0, 7, 8, 9]);
});

test('inferSessionIndicator: фракция «4/10»', () => {
  const ind = L.inferSessionIndicator('sports_pool', '4/10 дорожек');
  assert.equal(ind.type, 'lanes');
  assert.equal(ind.free, 4);
  assert.equal(ind.total, 10);
});

test('inferSessionIndicator: «без крайней» (ед.ч.) → 1 край, «без крайних» (мн.ч.) → 2', () => {
  const one = L.inferSessionIndicator('sports_pool', 'без крайней дорожки');
  assert.equal(one.free, 9);
  assert.deepEqual(one.occupied, [0]);
  const two = L.inferSessionIndicator('sports_pool', 'кроме крайних');
  assert.equal(two.free, 8);
  assert.deepEqual(two.occupied, [0, 9]);
});

test('inferSessionIndicator: пустая активность у большого бассейна → весь бассейн свободен', () => {
  assert.deepEqual(
    L.inferSessionIndicator('sports_pool', ''),
    { type: 'lanes', occupied: [], free: 10, total: 10 }
  );
});

test('inferSessionIndicator: лёд/штанга/дети', () => {
  assert.equal(L.inferSessionIndicator('ice_arena', 'массовое катание').label, 'массовое');
  assert.equal(L.inferSessionIndicator('rowing_base', 'силовая').label, 'штанга');
  assert.equal(L.inferSessionIndicator('ice_arena', 'детская группа').label, 'дети');
});

// ── diff ──
const snap = (sessions) => ({
  facilities: [{ id: 'ice_arena', sessions }],
});

test('computeScheduleDiff: add / rem / mod', () => {
  const prev = snap([
    { date: '2026-06-01', start: '09:00', end: '10:00', activity: 'массовое' },
    { date: '2026-06-01', start: '11:00', end: '12:00', activity: 'хоккей' },
  ]);
  const next = snap([
    { date: '2026-06-01', start: '09:00', end: '10:00', activity: 'свободное катание' }, // mod
    { date: '2026-06-01', start: '13:00', end: '14:00', activity: 'массовое' },           // add
    // 11:00-12:00 удалён → rem
  ]);
  const events = L.computeScheduleDiff(prev, next);
  const kinds = events.map(e => e.kind).sort();
  assert.deepEqual(kinds, ['add', 'mod', 'rem']);
  const mod = events.find(e => e.kind === 'mod');
  assert.equal(mod.start, '09:00');
  assert.equal(mod.wasActivity, 'массовое');
  assert.equal(mod.activity, 'свободное катание');
});

test('computeScheduleDiff: одинаковые снапшоты → нет событий', () => {
  const s = snap([{ date: '2026-06-01', start: '09:00', end: '10:00', activity: 'a' }]);
  assert.equal(L.computeScheduleDiff(s, structuredClone(s)).length, 0);
});

test('eventOverlapsShift: пересечение по объекту/дате/времени', () => {
  const ev = { facilityId: 'ice_arena', date: '2026-06-01', start: '09:30', end: '10:30' };
  assert.ok(L.eventOverlapsShift(ev, { facilityId: 'ice_arena', date: '2026-06-01', start: '09:00', end: '10:00' }));
  // примыкание (end == start) не считается пересечением
  assert.ok(!L.eventOverlapsShift(ev, { facilityId: 'ice_arena', date: '2026-06-01', start: '10:30', end: '11:00' }));
  // другой объект
  assert.ok(!L.eventOverlapsShift(ev, { facilityId: 'sports_pool', date: '2026-06-01', start: '09:00', end: '10:00' }));
});

test('annotateAffectedShifts: проставляет affectsShiftId и was* для mod', () => {
  const events = [
    { id: 'e1', kind: 'mod', facilityId: 'ice_arena', date: '2026-06-01', start: '09:30', end: '10:30' },
  ];
  const shifts = [{ id: 's1', facilityId: 'ice_arena', date: '2026-06-01', start: '09:00', end: '10:00' }];
  L.annotateAffectedShifts(events, shifts);
  assert.equal(events[0].affectsShiftId, 's1');
  assert.equal(events[0].wasStart, '09:00');
  assert.equal(events[0].wasEnd, '10:00');
});

test('classifyBreak: монотонно — пауза до 2 ч, дальше перерыв; лёд — заливка', () => {
  assert.equal(L.classifyBreak(30, 'sports_pool'), 'пауза');
  assert.equal(L.classifyBreak(75, 'sports_pool'), 'пауза');
  assert.equal(L.classifyBreak(120, 'sports_pool'), 'перерыв');
  assert.equal(L.classifyBreak(30, 'ice_arena'), 'заливка льда');
  assert.equal(L.classifyBreak(120, 'ice_arena'), 'перерыв');
});

test('mergeIntervals: пересечения и смежности сливаются, пустые выкидываются', () => {
  assert.deepEqual(
    L.mergeIntervals([[480, 720], [450, 810], [900, 960], [960, 990], [500, 500]]),
    [[450, 810], [900, 990]]
  );
  assert.deepEqual(L.mergeIntervals([]), []);
});

test('facilityDayUsage: пересекающиеся смены не считают сеансы дважды', () => {
  // Смены 07:30–13:30 и 08:00–12:00, сеансы 08:00–08:45, 09:15–10:00,
  // 10:30–11:15. Раньше каждая смена пересекалась с каждым сеансом
  // независимо → 135×2=270 мин; правильно — 135.
  const shifts = [[450, 810], [480, 720]];
  const sessions = [[480, 525], [555, 600], [630, 675]];
  assert.deepEqual(L.facilityDayUsage(shifts, sessions),
    { confirmedMin: 135, unconfirmedMin: 0 });
});

test('facilityDayUsage: окно без сеансов уходит в unconfirmed целиком', () => {
  // Утренняя смена подтверждена частично, вечерняя — сайт молчит.
  const shifts = [[450, 600], [840, 960]];
  const sessions = [[480, 540]];
  assert.deepEqual(L.facilityDayUsage(shifts, sessions),
    { confirmedMin: 60, unconfirmedMin: 120 });
});

test('facilityDayUsage: совсем без данных сайта → весь график unconfirmed', () => {
  assert.deepEqual(L.facilityDayUsage([[450, 810]], []),
    { confirmedMin: 0, unconfirmedMin: 360 });
});

test('buildTimelineForDate: зазор между сменами даёт break-строку', () => {
  const shifts = [
    { id: 's1', facilityId: 'ice_arena', date: '2026-06-01', start: '09:00', end: '10:00' },
    { id: 's2', facilityId: 'ice_arena', date: '2026-06-01', start: '12:00', end: '13:00' },
  ];
  const rows = L.buildTimelineForDate(shifts, '2026-06-01');
  assert.deepEqual(rows.map(r => r.kind), ['shift', 'break', 'shift']);
  assert.equal(rows[1].minutes, 120);
});

test('buildICS: минское время → UTC, экранирование, инструкторы', () => {
  const ics = L.buildICS(
    [{ id: 's1', date: '2026-06-09', facilityId: 'sports_pool',
       start: '07:30', end: '13:30', activity: 'замена; группа, U-12',
       instructors: ['i1'] }],
    [{ id: 'sports_pool', name: 'Большой бассейн' }],
    [{ id: 'i1', name: 'Иванов И.И.' }]
  );
  assert.match(ics, /DTSTART:20260609T043000Z/);   // 07:30 Минска = 04:30 UTC
  assert.match(ics, /DTEND:20260609T103000Z/);
  assert.match(ics, /SUMMARY:Смена · Большой бассейн/);
  assert.match(ics, /замена\\; группа\\, U-12/); // ; и , экранированы
  assert.match(ics, /с Иванов И\.И\./);
  assert.match(ics, /UID:s1@raspisanie-polessu/);
});

test('buildICS: раннее утро уходит на предыдущий день UTC', () => {
  const ics = L.buildICS(
    [{ id: 's2', date: '2026-06-09', facilityId: 'x', start: '01:00', end: '02:30' }],
    [], []
  );
  assert.match(ics, /DTSTART:20260608T220000Z/);
  assert.match(ics, /DTEND:20260608T233000Z/);
});

test('buildICS: битые смены пропускаются, календарь валиден', () => {
  const ics = L.buildICS([null, { id: 'x' }], [], []);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 0);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR/);
});
