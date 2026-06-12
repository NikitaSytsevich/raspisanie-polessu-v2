// HTTP-загрузка страниц ПолесГУ с таймаутом и нормализацией кодировки.
// В Node 20 есть глобальный fetch (undici под капотом), но AbortController
// нужен явный, чтобы не висеть на медленном источнике дольше maxDuration.

const DEFAULT_TIMEOUT_MS = 8000;
const USER_AGENT = 'raspisanie-polessu-bot/1.0 (+https://github.com/)';
// Страницы ПолесГУ ~100 КБ; всё сильно больше — аномалия (битый ответ,
// прокси-страница), которую нет смысла держать в памяти 256 МБ лямбды.
const MAX_BODY_BYTES = 3 * 1024 * 1024;

// res.text() по спецификации fetch ВСЕГДА декодирует UTF-8, игнорируя
// charset из Content-Type. Если Drupal ПолесГУ отдаст windows-1251,
// кириллические регэкспы парсеров молча перестанут матчиться и все объекты
// уйдут в template. Поэтому charset определяем сами: заголовок Content-Type →
// <meta charset> в начале тела → UTF-8 по умолчанию.
function sniffCharset(buf, contentType) {
  let m = /charset=["']?([\w-]+)/i.exec(contentType || '');
  if (m) return m[1];
  // latin1 — байт-в-байт, безопасно для поиска ASCII-метатега до декодирования.
  const head = buf.slice(0, 4096).toString('latin1');
  m = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return m ? m[1] : 'utf-8';
}

function decodeBody(buf, contentType) {
  const charset = sniffCharset(buf, contentType).toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString('utf8'); // неизвестный charset — fallback на UTF-8
  }
}

async function fetchHtml(url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const t = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);

  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru,en;q=0.5',
      },
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}`, ms: Date.now() - startedAt };
    }
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) {
      return { ok: false, status: res.status, error: 'body_too_large', ms: Date.now() - startedAt };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BODY_BYTES) {
      return { ok: false, status: res.status, error: 'body_too_large', ms: Date.now() - startedAt };
    }
    const html = decodeBody(buf, res.headers.get('content-type'));
    return { ok: true, status: res.status, html, ms: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err)),
      ms: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

module.exports = { fetchHtml, decodeBody, sniffCharset };
