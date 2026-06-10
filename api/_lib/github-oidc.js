// Проверка GitHub Actions OIDC-токена — чтобы CI-пингер не носил общий
// секрет. Workflow с `permissions: id-token: write` запрашивает у GitHub
// короткоживущий JWT, подписанный приватным ключом GitHub, и шлёт его
// Bearer'ом. Здесь проверяем подпись против публичного JWKS GitHub и
// сверяем claim'ы (issuer, audience, repository, exp). Это безопаснее
// shared-секрета: токен живёт минуты, не лежит в репозитории/секретах и
// привязан к конкретному репозиторию.
//
// Зависимостей нет: RS256 проверяется штатным crypto (createPublicKey из
// JWK + verify). JWKS кэшируется в памяти инстанса на 10 минут.

const crypto = require('crypto');

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const JWKS_TTL_MS = 10 * 60_000;

let _jwksCache = null; // { at, keys: Map(kid → jwk) }

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function b64urlToJson(s) {
  return JSON.parse(b64urlToBuf(s).toString('utf8'));
}

async function defaultFetchJwks() {
  const r = await fetch(JWKS_URL, { cache: 'no-store' });
  if (!r.ok) throw new Error(`jwks HTTP ${r.status}`);
  return r.json();
}

async function getKeys(fetchJwks) {
  if (_jwksCache && Date.now() - _jwksCache.at < JWKS_TTL_MS) return _jwksCache.keys;
  const data = await fetchJwks();
  const keys = new Map();
  for (const jwk of data.keys || []) keys.set(jwk.kid, jwk);
  _jwksCache = { at: Date.now(), keys };
  return keys;
}

// Сбрасывает кэш JWKS (для тестов и форс-рефреша при незнакомом kid).
function _resetCache() { _jwksCache = null; }

// Возвращает { ok, reason?, claims? }.
async function verifyGitHubOidc(token, {
  expectedRepo,
  expectedAudience,
  fetchJwks = defaultFetchJwks,
  now = Date.now(),
} = {}) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'no_token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, sig] = parts;

  let header, claims;
  try { header = b64urlToJson(h); claims = b64urlToJson(p); }
  catch { return { ok: false, reason: 'bad_json' }; }

  if (header.alg !== 'RS256') return { ok: false, reason: 'bad_alg' };
  if (claims.iss !== ISSUER) return { ok: false, reason: 'bad_issuer' };

  let keys;
  try { keys = await getKeys(fetchJwks); }
  catch { return { ok: false, reason: 'jwks_unavailable' }; }
  let jwk = keys.get(header.kid);
  if (!jwk) {
    // Незнакомый kid — возможно, GitHub проротировал ключи; обновим кэш раз.
    _resetCache();
    try { keys = await getKeys(fetchJwks); } catch { return { ok: false, reason: 'jwks_unavailable' }; }
    jwk = keys.get(header.kid);
  }
  if (!jwk) return { ok: false, reason: 'unknown_kid' };

  let verified = false;
  try {
    const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    verified = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), pub, b64urlToBuf(sig));
  } catch { return { ok: false, reason: 'verify_error' }; }
  if (!verified) return { ok: false, reason: 'bad_signature' };

  const nowSec = Math.floor(now / 1000);
  if (typeof claims.exp === 'number' && claims.exp < nowSec) return { ok: false, reason: 'expired' };
  if (typeof claims.nbf === 'number' && claims.nbf > nowSec + 60) return { ok: false, reason: 'not_yet_valid' };
  if (expectedAudience && claims.aud !== expectedAudience) return { ok: false, reason: 'bad_audience' };
  if (expectedRepo && claims.repository !== expectedRepo) return { ok: false, reason: 'bad_repo' };

  return { ok: true, claims };
}

module.exports = { verifyGitHubOidc, _resetCache, ISSUER, JWKS_URL };
