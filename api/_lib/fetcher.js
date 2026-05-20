// HTTP-загрузка страниц ПолесГУ с таймаутом и нормализацией кодировки.
// В Node 20 есть глобальный fetch (undici под капотом), но AbortController
// нужен явный, чтобы не висеть на медленном источнике дольше maxDuration.

const DEFAULT_TIMEOUT_MS = 8000;
const USER_AGENT = 'raspisanie-polessu-bot/1.0 (+https://github.com/)';

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
    const html = await res.text();
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

module.exports = { fetchHtml };
