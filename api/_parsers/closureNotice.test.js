const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const closure = require('./closureNotice');
const { extractContentRoot } = require('./_common');

function loadFixture(name) {
  const p = path.join(__dirname, '__fixtures__', name);
  return fs.readFileSync(p, 'utf-8');
}

test('closure detector: ice arena (закрыта на ремонт)', () => {
  const $ = cheerio.load(loadFixture('ice_arena_closed.html'));
  const result = closure.detect($, extractContentRoot($));
  assert.ok(result, 'ожидалось обнаружение объявления');
  assert.match(result.notice, /закрыт|ремонт/i);
});

test('closure detector: большой бассейн (отключение горячей воды)', () => {
  const $ = cheerio.load(loadFixture('sports_pool_closed.html'));
  const result = closure.detect($, extractContentRoot($));
  assert.ok(result);
  assert.match(result.notice, /отключени|не работает/i);
  assert.ok(result.range, 'должен извлечься диапазон дат');
  assert.equal(result.range.from.slice(5), '05-18');
});

test('closure detector: малый бассейн', () => {
  const $ = cheerio.load(loadFixture('small_pool_closed.html'));
  const result = closure.detect($, extractContentRoot($));
  assert.ok(result);
  assert.match(result.notice, /отключени|не работает/i);
});

test('closure detector: не срабатывает на странице с расписанием', () => {
  const $ = cheerio.load(loadFixture('synthetic_pool_schedule.html'));
  const result = closure.detect($, extractContentRoot($));
  assert.equal(result, null, 'на нормальной странице не должно ложно срабатывать');
});
