// Last-known-good снапшот объектов: если источник упал (сеть/парсер),
// /api/schedule подменяет его последними успешно распарсенными данными
// с флагом stale, вместо того чтобы отдавать parse_error и терять
// расписание у всех клиентов.
//
// Два слоя:
//   1. Память warm-инстанса лямбды — бесплатно, живёт между вызовами,
//      пока инстанс тёплый (минуты-часы).
//   2. Vercel Blob — переживает холодные старты и деплои. Включается
//      автоматически, если в проекте подключён Blob-стор
//      (Vercel → Storage → Blob → Connect, появится BLOB_READ_WRITE_TOKEN).
//      Без токена слой просто молча выключен.
//
// Формат: { [facilityId]: facility } — facility в том же виде, что и в
// payload /api/schedule (dataQuality: 'ok', sessions, closureRanges, …).

const BLOB_KEY = 'last-good-schedule.json';

let _memory = null;        // { [facilityId]: facility }
let _blobLoadedOnce = false;

function haveBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function load() {
  if (_memory) return _memory;
  if (!haveBlob() || _blobLoadedOnce) return _memory;
  _blobLoadedOnce = true;
  try {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: BLOB_KEY, limit: 1 });
    if (!blobs || !blobs.length) return null;
    const r = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!r.ok) return null;
    _memory = await r.json();
  } catch {
    // Blob недоступен — работаем только на памяти инстанса.
  }
  return _memory;
}

// Обновляет last-good свежими «ok»-объектами. В Blob пишем только если
// что-то реально изменилось (сравнение по JSON), чтобы не жечь операции
// записи на каждый запрос мимо CDN-кеша.
async function update(freshOkFacilities) {
  if (!freshOkFacilities || !freshOkFacilities.length) return;
  const prev = _memory || {};
  const next = { ...prev };
  let changed = false;
  for (const f of freshOkFacilities) {
    const clean = { ...f };
    delete clean._issue;
    if (JSON.stringify(prev[f.id]) !== JSON.stringify(clean)) {
      next[f.id] = clean;
      changed = true;
    }
  }
  _memory = next;
  if (!changed || !haveBlob()) return;
  try {
    const { put } = require('@vercel/blob');
    await put(BLOB_KEY, JSON.stringify(next), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  } catch {}
}

module.exports = { load, update };
