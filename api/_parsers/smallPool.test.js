const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parse } = require('./smallPool');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf-8');
}

const TODAY = '2026-05-26';

test('smallPool: inline-расписание — все 6 дней, активности без скобок', () => {
  const out = parse(loadFixture('small_pool_schedule.html'), { todayIso: TODAY });
  assert.equal(out.ok, true);
  assert.ok(out.sessions.length >= 30, 'мало сессий: ' + out.sessions.length);

  const dates = new Set(out.sessions.map(s => s.date));
  // Расписание с 26.05 по 31.05 — 6 разных дат.
  assert.equal(dates.size, 6, 'дат должно быть 6, нашли ' + dates.size);

  // Контрольная сессия из верха фикстуры.
  const first = out.sessions.find(s =>
    s.date === '2026-05-26' && s.start === '11:45' && s.end === '12:30');
  assert.ok(first, 'нет сессии 26.05 11:45–12:30');
  assert.equal(first.activity, 'Сеанс/Родительский сеанс');

  // Активность с инструктором в скобках.
  const lesson = out.sessions.find(s =>
    s.date === '2026-05-30' && s.start === '14:00' && s.end === '14:45');
  assert.ok(lesson, 'нет сессии субботы 14:00');
  assert.match(lesson.activity, /Обучение плаванию/);
});

test('smallPool: footer-болванка не цепляется к последней сессии дня', () => {
  const out = parse(loadFixture('small_pool_schedule.html'), { todayIso: TODAY });
  const last = out.sessions.find(s =>
    s.date === '2026-05-31' && s.start === '15:30' && s.end === '16:15');
  assert.ok(last, 'нет последней сессии воскресенья');
  // Активность короткая — без «Срок действия абонементов…»
  assert.ok(last.activity.length < 60, 'activity подцепил footer: ' + last.activity);
  assert.doesNotMatch(last.activity, /Срок действия/);
  assert.doesNotMatch(last.activity, /Оплатить услуги/);
});

test('smallPool: distinct activities only — реальные сеансы, без шума', () => {
  const out = parse(loadFixture('small_pool_schedule.html'), { todayIso: TODAY });
  const distinct = new Set(out.sessions.map(s => s.activity));
  for (const a of distinct) {
    assert.ok(a.length > 0 && a.length < 80,
      'странная активность: ' + JSON.stringify(a));
  }
});

test('smallPool: полное закрытие — fixture с notice без расписания', () => {
  const out = parse(loadFixture('small_pool_closed.html'), { todayIso: TODAY });
  assert.equal(out.ok, false);
  // closed или no_table в зависимости от формы fixture
  assert.ok(['closed', 'no_table'].includes(out.reason));
});
