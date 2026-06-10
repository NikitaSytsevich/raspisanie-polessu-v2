// Декодирование тела ответа с учётом charset (см. _lib/fetcher.js):
// res.text() всегда декодирует UTF-8, поэтому windows-1251 надо ловить
// самим — по Content-Type или <meta charset> в начале тела.

const test = require('node:test');
const assert = require('node:assert/strict');

const { decodeBody, sniffCharset } = require('../_lib/fetcher');

// «Бассейн» в windows-1251.
const CP1251_WORD = Buffer.from([0xC1, 0xE0, 0xF1, 0xF1, 0xE5, 0xE9, 0xED]);

test('decodeBody: windows-1251 из Content-Type', () => {
  assert.equal(decodeBody(CP1251_WORD, 'text/html; charset=windows-1251'), 'Бассейн');
});

test('decodeBody: windows-1251 из <meta charset> при пустом Content-Type', () => {
  const body = Buffer.concat([
    Buffer.from('<html><head><meta charset="windows-1251"></head><body>', 'latin1'),
    CP1251_WORD,
    Buffer.from('</body></html>', 'latin1'),
  ]);
  assert.equal(sniffCharset(body, null), 'windows-1251');
  assert.ok(decodeBody(body, null).includes('Бассейн'));
});

test('decodeBody: по умолчанию UTF-8', () => {
  assert.equal(decodeBody(Buffer.from('Бассейн', 'utf8'), 'text/html'), 'Бассейн');
});

test('decodeBody: неизвестный charset → fallback UTF-8 без исключения', () => {
  assert.equal(decodeBody(Buffer.from('Бассейн', 'utf8'), 'text/html; charset=x-nonsense'), 'Бассейн');
});
