const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseTime, parseTimeRange, weekdayIndex, parseDateRange, nextDateForWeekday,
  validateSessions,
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

test('weekdayIndex: склонения дней матчатся, чужие слова — нет', () => {
  assert.equal(weekdayIndex('среды'), 3);
  assert.equal(weekdayIndex('пятницу'), 5);
  assert.equal(weekdayIndex('Сб.'), 6);
  assert.equal(weekdayIndex('понедельник 01.06'), 1);
  // Регресс: префиксное сравнение давало ложные дни.
  assert.equal(weekdayIndex('все группы'), -1);   // раньше: «вс» → воскресенье
  assert.equal(weekdayIndex('пятый корпус'), -1); // раньше: «пят» → пятница
  assert.equal(weekdayIndex('средний'), -1);
  assert.equal(weekdayIndex('время работы'), -1);
});

test('parseDateRange', () => {
  const r1 = parseDateRange('с 18.05.2026-24.05.2026');
  assert.deepEqual(r1, { from: '2026-05-18', to: '2026-05-24' });
  const r2 = parseDateRange('закрыта с 29.04.2026г. по 31.05.2026г.');
  assert.deepEqual(r2, { from: '2026-04-29', to: '2026-05-31' });
});

test('parseDateRange: год по умолчанию из todayIso + перенос через Новый год', () => {
  // Год не указан — берём из todayIso, а не из системных часов.
  assert.deepEqual(parseDateRange('с 18.05 по 24.05', '2026-05-20'),
    { from: '2026-05-18', to: '2026-05-24' });
  // Диапазон через Новый год: «по»-дата уходит в следующий год.
  assert.deepEqual(parseDateRange('с 28.12 по 05.01', '2026-12-20'),
    { from: '2026-12-28', to: '2027-01-05' });
  // Явный год только у «по»-даты: «с»-дата — в предыдущем году.
  assert.deepEqual(parseDateRange('с 28.12 по 05.01.2027', '2026-12-20'),
    { from: '2026-12-28', to: '2027-01-05' });
});

test('validateSessions: режет инверсию времени и даты вне окна', () => {
  const ok = { date: '2026-05-22', start: '10:00', end: '11:00', activity: '' };
  const sessions = [
    { date: '2026-05-22', start: '11:00', end: '10:00', activity: '' }, // инверсия
    ok,
    { date: '2025-05-22', start: '10:00', end: '11:00', activity: '' }, // прошлый год
    { date: '2026-09-01', start: '10:00', end: '11:00', activity: '' }, // слишком далеко
  ];
  assert.deepEqual(validateSessions(sessions, '2026-05-20'), [ok]);
  // Без todayIso — только проверка start < end.
  assert.equal(validateSessions(sessions, null).length, 3);
});

test('nextDateForWeekday: считает от среды', () => {
  // 2026-05-20 — среда (wd=3)
  assert.equal(nextDateForWeekday('2026-05-20', 3), '2026-05-20'); // сегодня
  assert.equal(nextDateForWeekday('2026-05-20', 4), '2026-05-21'); // завтра
  assert.equal(nextDateForWeekday('2026-05-20', 1), '2026-05-25'); // следующий пн
  assert.equal(nextDateForWeekday('2026-05-20', 0), '2026-05-24'); // ближайшее вс
});
