const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parse } = require('./rowingBase');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf-8');
}

const TODAY = '2026-05-20'; // среда

test('rowingBase: исключает дату-выходной из расписания', () => {
  // На странице: «1.05.2026 Выходной день» — пятница.
  // Если смотреть с понедельника 27.04.2026, ближайшая пятница = 2026-05-01,
  // и её сессий НЕ должно быть.
  const out = parse(loadFixture('rowing_base.html'), { todayIso: '2026-04-27' });
  assert.equal(out.ok, true);
  const may1 = out.sessions.filter(s => s.date === '2026-05-01');
  assert.equal(may1.length, 0, `1.05.2026 — выходной, но в расписании ${may1.length} сессий`);
  // При этом остальные будни (пн-чт) той же недели должны быть на месте — 4 дня × 2 слота.
  assert.equal(out.sessions.length, 8, `ожидалось 8 сессий (5 будних дней минус выходной × 2 слота), а вышло ${out.sessions.length}`);
});

test('rowingBase: парсит инлайн-формат "Пн-Пт 18.30-19.30"', () => {
  const out = parse(loadFixture('rowing_base.html'), { todayIso: TODAY });
  assert.equal(out.ok, true, `ожидалось ok=true, получили ${JSON.stringify(out)}`);
  assert.ok(out.sessions.length >= 10, `мало сессий: ${out.sessions.length}`);

  const slot1 = out.sessions.find(s => s.start === '18:30' && s.end === '19:30');
  assert.ok(slot1, 'не нашли слот 18:30-19:30');

  const slot2 = out.sessions.find(s => s.start === '19:30' && s.end === '20:30');
  assert.ok(slot2, 'не нашли слот 19:30-20:30');

  // Должны быть пн-пт (5 рабочих дней × 2 слота = 10 сессий минимум)
  const weekdays = new Set(out.sessions.map(s => new Date(s.date + 'T12:00:00Z').getUTCDay()));
  // Минимум 5 разных будних дней (1..5)
  for (const d of [1, 2, 3, 4, 5]) {
    assert.ok(weekdays.has(d), `нет сессии в день недели ${d}`);
  }
  // Сб/Вс быть не должно
  assert.ok(!weekdays.has(0), 'воскресенье не должно быть в расписании');
  assert.ok(!weekdays.has(6), 'суббота не должна быть в расписании');
});
