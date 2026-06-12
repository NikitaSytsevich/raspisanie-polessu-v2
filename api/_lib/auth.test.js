const { test } = require('node:test');
const assert = require('node:assert/strict');

const { safeEqual } = require('./auth');

test('safeEqual: совпадение/несовпадение, пустые и не-строки — false', () => {
  assert.equal(safeEqual('secret', 'secret'), true);
  assert.equal(safeEqual('secret', 'Secret'), false);
  assert.equal(safeEqual('secret', 'secret '), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual('a', ''), false);
  assert.equal(safeEqual(undefined, 'a'), false);
  assert.equal(safeEqual('a', 123), false);
});
