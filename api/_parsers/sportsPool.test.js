const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parse } = require('./sportsPool');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf-8');
}

const TODAY = '2026-05-20'; // среда

test('sportsPool: фиксирует закрытие на ремонт', () => {
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
