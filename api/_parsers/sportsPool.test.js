const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parse } = require('./sportsPool');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf-8');
}

const TODAY = '2026-05-20'; // среда

test('sportsPool: полное закрытие — нет таблицы, есть только объявление', () => {
  const out = parse(loadFixture('sports_pool_closed.html'), { todayIso: TODAY });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'closed');
  assert.match(out.notice, /отключени/i);
});

test('sportsPool: парсит синтетическую таблицу', () => {
  const out = parse(loadFixture('synthetic_pool_schedule.html'), { todayIso: TODAY });
  assert.equal(out.ok, true);
  assert.ok(out.sessions.length > 0, 'должны быть сессии');
  // Проверим, что для понедельника (TODAY=ср → понедельник через 5 дней)
  // есть сессия 07:30-09:00 «Свободное плавание»
  const mon = out.sessions.find(s =>
    s.start === '07:30' && s.end === '09:00' && s.activity.includes('Свободное'));
  assert.ok(mon, 'нет сессии понедельника 07:30');
  // Sat пустые ячейки не должны порождать сессии
  const satEmpty = out.sessions.find(s =>
    s.start === '07:30' && new Date(s.date + 'T12:00Z').getUTCDay() === 6);
  assert.equal(satEmpty, undefined, 'пустая ячейка субботы не должна стать сессией');
});

test('sportsPool: частичное закрытие + inline-расписание (закрытие → closureRanges, сессии после открытия)', () => {
  const out = parse(loadFixture('sports_pool_partial_closure.html'), { todayIso: TODAY });
  // Сессии есть (после открытия 26.05)
  assert.equal(out.ok, true, 'ok должно быть true — нашли расписание после ремонта');
  assert.ok(out.sessions.length >= 40, 'должно быть много сессий, было: ' + out.sessions.length);
  // closure упакован в closureRanges, а не в reason: 'closed'
  assert.ok(Array.isArray(out.closureRanges), 'closureRanges должно быть массивом');
  assert.equal(out.closureRanges.length, 1);
  assert.equal(out.closureRanges[0].from, '2026-05-18');
  assert.equal(out.closureRanges[0].to,   '2026-05-25');
  assert.match(out.closureRanges[0].notice, /не работает/);
  // notice не должен быть склеен без пробелов
  assert.doesNotMatch(out.closureRanges[0].notice, /годаплавательный/);
  // Конкретная сессия 26 мая 09:15 должна быть, с «Свободное плавание»
  const s = out.sessions.find(x => x.date === '2026-05-26' && x.start === '09:15');
  assert.ok(s, 'нет сессии 26.05 09:15');
  assert.match(s.activity, /Свободное плавание/);
  // Сессии с описанием «6 дорожек» должны иметь это в activity
  const sLanes = out.sessions.find(x => x.date === '2026-05-26' && x.start === '10:30');
  assert.match(sLanes.activity, /6 дорожек/);
  // КРИТИЧНО: «без N крайних» тоже должно дойти до activity, иначе
  // клиент не сможет нарисовать края закрытыми (см. inferSessionIndicator).
  // Реальная фикстура содержит «свободно 6 дорожек, без 1 крайней» для 10:30.
  assert.match(sLanes.activity, /без\s+\d+\s+крайн/i,
    `activity должна содержать "без N крайних", но got: ${sLanes.activity}`);
  // Сессий ВНУТРИ диапазона закрытия (18-25.05) быть не должно
  const inRange = out.sessions.find(x => x.date >= '2026-05-18' && x.date <= '2026-05-25');
  assert.equal(inRange, undefined, 'не должно быть сессий внутри окна закрытия');
});
