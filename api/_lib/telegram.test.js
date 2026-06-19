// Тесты чистой части Telegram-библиотеки (api/_lib/telegram.js).
// Сетевые/Blob-функции здесь не дёргаем — только разрешение настроек чата.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolvePrefs } = require('./telegram');

test('resolvePrefs: дефолты — все объекты, дайджест включён', () => {
  assert.deepEqual(resolvePrefs({}, '100'), { objects: null, digest: true });
  // Чужой чат в prefs не влияет на наш.
  assert.deepEqual(resolvePrefs({ '999': { digest: false } }, '100'), { objects: null, digest: true });
});

test('resolvePrefs: явные настройки чата читаются, частичные дополняются дефолтами', () => {
  assert.deepEqual(
    resolvePrefs({ '100': { objects: ['ice_arena'], digest: false } }, '100'),
    { objects: ['ice_arena'], digest: false }
  );
  // digest не задан → по умолчанию вкл; objects не массив → «все».
  assert.deepEqual(resolvePrefs({ '100': { objects: 'x' } }, '100'), { objects: null, digest: true });
  assert.deepEqual(resolvePrefs({ '100': { digest: false } }, '100'), { objects: null, digest: false });
});
