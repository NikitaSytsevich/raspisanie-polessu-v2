// Тесты переходов состояний объектов (api/_lib/transitions.js) —
// админ-алерты о здоровье и пользовательские «закрыт/снова работает».
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { healthTransitions, closureTransitions } = require('./transitions');

const payload = (facs) => ({ facilities: facs });
const fac = (id, dataQuality, extra = {}) => ({ id, name: id, dataQuality, ...extra });

test('healthTransitions: ok → template даёт 🔴, обратно — 🟢, без изменений — пусто', () => {
  const ok = payload([fac('rowing_base', 'ok')]);
  const broken = payload([fac('rowing_base', 'template')]);
  assert.match(healthTransitions(ok, broken)[0], /🔴 rowing_base: ok → template/);
  assert.match(healthTransitions(broken, ok)[0], /🟢 rowing_base: template → ok/);
  assert.equal(healthTransitions(ok, payload([fac('rowing_base', 'ok')])).length, 0);
});

test('healthTransitions: stale-подмена считается деградацией', () => {
  const ok = payload([fac('rowing_base', 'ok')]);
  const stale = payload([fac('rowing_base', 'ok', { stale: true })]);
  assert.match(healthTransitions(ok, stale)[0], /🔴 rowing_base: ok → stale/);
});

test('healthTransitions: ok → closed НЕ считается сбоем парсера', () => {
  const ok = payload([fac('rowing_base', 'ok')]);
  const closed = payload([fac('rowing_base', 'closed')]);
  assert.equal(healthTransitions(ok, closed).length, 0);
});

test('closureTransitions: ok → closed и closed → ok', () => {
  const ok = payload([fac('rowing_base', 'ok')]);
  const closed = payload([fac('rowing_base', 'closed', { notice: 'ремонт' })]);
  assert.deepEqual(closureTransitions(ok, closed), [
    { kind: 'closed', name: 'rowing_base', notice: 'ремонт' },
  ]);
  assert.deepEqual(closureTransitions(closed, ok), [
    { kind: 'reopened', name: 'rowing_base' },
  ]);
});

test('closureTransitions: sourceUrl объекта прокидывается в событие (для ссылки в боте)', () => {
  const ok = payload([fac('rowing_base', 'ok', { sourceUrl: 'https://www.polessu.by/row' })]);
  const closed = payload([fac('rowing_base', 'closed', { notice: 'ремонт', sourceUrl: 'https://www.polessu.by/row' })]);
  assert.deepEqual(closureTransitions(ok, closed), [
    { kind: 'closed', name: 'rowing_base', notice: 'ремонт', sourceUrl: 'https://www.polessu.by/row' },
  ]);
});

test('closureTransitions: closed → template это не «снова работает»; новый объект — не переход', () => {
  const closed = payload([fac('rowing_base', 'closed')]);
  const broken = payload([fac('rowing_base', 'template')]);
  assert.equal(closureTransitions(closed, broken).length, 0);
  assert.equal(closureTransitions(payload([]), closed).length, 0);
  assert.equal(closureTransitions(null, closed).length, 0); // baseline
});
