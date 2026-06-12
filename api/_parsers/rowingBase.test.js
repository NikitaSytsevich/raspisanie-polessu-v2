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
  // даты синтезированы из дней недели → diff должен идти по недельному паттерну
  assert.equal(out.weeklyPattern, true, 'нет флага weeklyPattern');
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

// ── mixed-state: closure-notice не должен глушить живое расписание ──
const page = (inner) => `<html><body><div class="field-item" property="content:encoded">${inner}</div></body></html>`;
const SCHEDULE_H1 = '<h1>Понедельник - Пятница<br/>18.30-19.30<br/>19.30-20.30</h1>';

test('rowingBase: «технический перерыв» при живом расписании НЕ закрывает объект', () => {
  const html = page(`${SCHEDULE_H1}<p>Технический перерыв 13.00-14.00</p>`);
  const out = parse(html, { todayIso: TODAY });
  assert.equal(out.ok, true, `ложное закрытие: ${JSON.stringify(out)}`);
  assert.ok(out.sessions.length >= 10, `сессии потерялись: ${out.sessions.length}`);
});

test('rowingBase: закрытие с датами при живом расписании → closureRanges, не full-closed', () => {
  const html = page(`<p>Зал закрыт на ремонт с 01.06.2026 по 07.06.2026</p>${SCHEDULE_H1}`);
  const out = parse(html, { todayIso: TODAY });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.closureRanges?.length, 1);
  assert.equal(out.closureRanges[0].from, '2026-06-01');
  assert.equal(out.closureRanges[0].to, '2026-06-07');
});

test('rowingBase: только объявление о закрытии, расписания нет → reason closed', () => {
  const html = page('<p>Гребная база закрыта на ремонт с 01.06.2026 по 30.06.2026</p>');
  const out = parse(html, { todayIso: TODAY });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'closed');
  assert.ok(out.range, 'диапазон закрытия должен распарситься');
});
