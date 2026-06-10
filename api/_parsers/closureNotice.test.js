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

// Реальная форма страницы большого бассейна (июнь 2026): расписание
// последнего рабочего дня идёт сплошным текстом без единой точки, и
// «предложение» с триггером вбирало всю простыню слотов. Notice должен
// обрезаться до смысловой клаузы «С DD.MM.YYYY по DD.MM.YYYY … не работает».
test('closure detector: объявление после простыни расписания без точек', () => {
  const { flatTextWithSpaces } = require('./_inline');
  const html = `<html><body><div class="field-item even" property="content:encoded">
    <p>Расписание плавательного бассейна</p>
    <h4>Воскресенье 07.06.2026</h4>
    <p>09.15 – 10.00<br/>10.30 – 11.15<br/>11.45 – 12.30<br/>13.00 – 13.45<br/>
       14.15 – 15.00<br/>15.30 – 16.15<br/>16.45 – 17.30<br/>18.00 – 18.45<br/>
       19.15 – 20.00<br/>20.30 – 21.15</p>
    <p>С 08.06.2026 по 20.06.2026 плавательный бассейн не работает.</p>
  </div></body></html>`;
  const $ = cheerio.load(html);
  const $root = extractContentRoot($);
  const result = closure.detect($, $root, flatTextWithSpaces($, $root), '2026-06-10');
  assert.ok(result);
  assert.equal(result.notice, 'С 08.06.2026 по 20.06.2026 плавательный бассейн не работает.');
  assert.deepEqual(result.range, { from: '2026-06-08', to: '2026-06-20' });
});

test('closure detector: длинная шапка без маркера дат — обрезка по границе слова', () => {
  const slots = Array(10).fill('09.15 – 10.00').join(' ');
  const text = `Расписание плавательного бассейна ${slots} плавательный бассейн закрыт на ремонт до особого распоряжения.`;
  const result = closure.detect(null, null, text);
  assert.ok(result);
  assert.equal(result.notice, 'Плавательный бассейн закрыт на ремонт до особого распоряжения.');
});

test('closure detector: не срабатывает на странице с расписанием', () => {
  const $ = cheerio.load(loadFixture('synthetic_pool_schedule.html'));
  const result = closure.detect($, extractContentRoot($));
  assert.equal(result, null, 'на нормальной странице не должно ложно срабатывать');
});
