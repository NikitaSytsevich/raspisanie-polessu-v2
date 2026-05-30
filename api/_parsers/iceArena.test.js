const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parse } = require('./iceArena');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf-8');
}

const TODAY = '2026-05-20'; // среда — до открытия после ремонта

test('iceArena: inline-расписание массового катания + закрытие → closureRanges', () => {
  const out = parse(loadFixture('ice_arena_schedule.html'), { todayIso: TODAY });
  assert.equal(out.ok, true, 'нашли расписание — ok должно быть true');

  // 7 дней (01.06–07.06), будни по 1 слоту, сб/вс по 2 → 9 сессий.
  const dates = new Set(out.sessions.map(s => s.date));
  assert.equal(dates.size, 7, 'дат должно быть 7, нашли ' + dates.size);
  assert.equal(out.sessions.length, 9, 'сессий должно быть 9, было ' + out.sessions.length);

  // Понедельник 01.06.2026 20.30–21.15.
  const mon = out.sessions.find(s => s.date === '2026-06-01');
  assert.ok(mon, 'нет понедельника 01.06');
  assert.equal(mon.start, '20:30');
  assert.equal(mon.end, '21:15');
  assert.match(mon.activity, /массов|катан/i, 'фронт ждёт «массовое/катание» в activity');

  // Четверг 04.06 — другое время (21.00–21.45).
  const thu = out.sessions.find(s => s.date === '2026-06-04');
  assert.equal(thu.start, '21:00');
  assert.equal(thu.end, '21:45');

  // Пятница пишется слитно с датой («Пятница05.06.2026») — всё равно ловим.
  const fri = out.sessions.filter(s => s.date === '2026-06-05');
  assert.equal(fri.length, 1, 'пятница должна распарситься, несмотря на склейку дня и даты');
  assert.equal(fri[0].start, '21:15');

  // Суббота 06.06 — два слота.
  const sat = out.sessions.filter(s => s.date === '2026-06-06').sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(sat.length, 2, 'суббота — два слота');
  assert.deepEqual(sat.map(s => `${s.start}-${s.end}`), ['15:00-15:45', '16:15-17:00']);

  // Воскресенье 07.06 — два слота, второй 17.30–18.15.
  const sun = out.sessions.filter(s => s.date === '2026-06-07').sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(sun.length, 2, 'воскресенье — два слота');
  assert.deepEqual(sun.map(s => `${s.start}-${s.end}`), ['15:00-15:45', '17:30-18:15']);

  // Закрытие на ремонт упаковано в closureRanges (29.04–31.05), не в reason:closed.
  assert.ok(Array.isArray(out.closureRanges), 'closureRanges должно быть массивом');
  assert.equal(out.closureRanges.length, 1);
  assert.equal(out.closureRanges[0].from, '2026-04-29');
  assert.equal(out.closureRanges[0].to, '2026-05-31');

  // Окно ремонта (29.04–31.05) и расписание (01.06+) не пересекаются —
  // сессий внутри окна быть не должно.
  const inRange = out.sessions.find(s => s.date >= '2026-04-29' && s.date <= '2026-05-31');
  assert.equal(inRange, undefined, 'не должно быть сессий внутри окна ремонта');

  // Кассовый «с 09.00 до 21.00» и прочий footer не должны стать слотами.
  for (const s of out.sessions) {
    assert.match(s.activity, /массов|катан/i);
  }
});

test('iceArena: полное закрытие без расписания → reason:closed', () => {
  const out = parse(loadFixture('ice_arena_closed.html'), { todayIso: TODAY });
  assert.equal(out.ok, false);
  // Старая фикстура — только объявление, без перечня дат.
  assert.ok(['closed', 'no_table'].includes(out.reason));
});
