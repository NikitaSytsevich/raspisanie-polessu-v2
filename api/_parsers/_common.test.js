// Тесты универсального табличного экстрактора (_common.genericParse).
const test = require('node:test');
const assert = require('node:assert/strict');

const { genericParse } = require('./_common');

const TODAY = '2026-05-20'; // среда

const page = (inner) =>
  `<html><body><div class="field-item" property="content:encoded">${inner}</div></body></html>`;

test('genericParse: colspan в теле таблицы раскрывается на все накрытые дни', () => {
  const html = page(`<table>
    <tr><th>Время</th><th>Понедельник</th><th>Вторник</th><th>Среда</th></tr>
    <tr><td>10.00-11.00</td><td colspan="2">Секция</td><td>Другое</td></tr>
  </table>`);
  const out = genericParse(html, { todayIso: TODAY });
  assert.equal(out.ok, true, JSON.stringify(out));
  const wd = (s) => new Date(s.date + 'T12:00:00Z').getUTCDay();
  const byDay = new Map(out.sessions.map(s => [wd(s), s.activity]));
  assert.equal(byDay.get(1), 'Секция', 'понедельник накрыт colspan');
  assert.equal(byDay.get(2), 'Секция', 'вторник накрыт colspan');
  assert.equal(byDay.get(3), 'Другое');
});

test('genericParse: weeklyPattern=true — даты синтезированы из дней недели', () => {
  const html = page(`<table>
    <tr><th>Время</th><th>Понедельник</th><th>Вторник</th><th>Среда</th></tr>
    <tr><td>10.00-11.00</td><td>А</td><td>Б</td><td>В</td></tr>
  </table>`);
  const out = genericParse(html, { todayIso: TODAY });
  assert.equal(out.ok, true);
  assert.equal(out.weeklyPattern, true);
});
