const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseTime, parseTimeRange, weekdayIndex, parseDateRange, nextDateForWeekday,
} = require('../_lib/timeParse');

test('parseTime: разные сепараторы', () => {
  assert.equal(parseTime('7:30'), '07:30');
  assert.equal(parseTime('7.30'), '07:30');
  assert.equal(parseTime('07-30'), '07:30');
  assert.equal(parseTime('0730'), '07:30');
  assert.equal(parseTime('23:59'), '23:59');
  assert.equal(parseTime('25:00'), null);
  assert.equal(parseTime(' 9:05 '), '09:05');
});

test('parseTimeRange: дефис и тире', () => {
  assert.deepEqual(parseTimeRange('07:30-09:00'), { start: '07:30', end: '09:00' });
  assert.deepEqual(parseTimeRange('7.30 — 9.00'), { start: '07:30', end: '09:00' });
  assert.deepEqual(parseTimeRange('18.30-19.30'), { start: '18:30', end: '19:30' });
  assert.equal(parseTimeRange('07:30'), null);
});

test('weekdayIndex', () => {
  assert.equal(weekdayIndex('Пн'), 1);
  assert.equal(weekdayIndex('понедельник'), 1);
  assert.equal(weekdayIndex('Вс'), 0);
  assert.equal(weekdayIndex('воскресенье'), 0);
  assert.equal(weekdayIndex('xxx'), -1);
});

test('parseDateRange', () => {
  const r1 = parseDateRange('с 18.05.2026-24.05.2026');
  assert.deepEqual(r1, { from: '2026-05-18', to: '2026-05-24' });
  const r2 = parseDateRange('закрыта с 29.04.2026г. по 31.05.2026г.');
  assert.deepEqual(r2, { from: '2026-04-29', to: '2026-05-31' });
});

test('nextDateForWeekday: считает от среды', () => {
  // 2026-05-20 — среда (wd=3)
  assert.equal(nextDateForWeekday('2026-05-20', 3), '2026-05-20'); // сегодня
  assert.equal(nextDateForWeekday('2026-05-20', 4), '2026-05-21'); // завтра
  assert.equal(nextDateForWeekday('2026-05-20', 1), '2026-05-25'); // следующий пн
  assert.equal(nextDateForWeekday('2026-05-20', 0), '2026-05-24'); // ближайшее вс
});
