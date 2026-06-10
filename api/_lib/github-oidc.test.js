// Тесты проверки GitHub Actions OIDC (api/_lib/github-oidc.js).
// JWKS не ходим в сеть — генерим свой RSA-ключ, подписываем им JWT и
// отдаём публичный ключ через инъектируемый fetchJwks.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyGitHubOidc, _resetCache, ISSUER } = require('./github-oidc');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };
const fetchJwks = async () => ({ keys: [jwk] });

const REPO = 'NikitaSytsevich/raspisanie-polessu-v2';
const AUD = 'https://raspisanie-polessu-v2.vercel.app';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(claims, { kid = KID, key = privateKey, alg = 'RS256' } = {}) {
  const header = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    iss: ISSUER, aud: AUD, repository: REPO, exp: now + 600, nbf: now - 10, ...claims,
  }));
  if (alg === 'none') return `${header}.${payload}.`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${b64url(sig)}`;
}

const opts = { expectedRepo: REPO, expectedAudience: AUD, fetchJwks };

test('valid token from our repo passes', async () => {
  _resetCache();
  const r = await verifyGitHubOidc(makeToken({}), opts);
  assert.equal(r.ok, true);
  assert.equal(r.claims.repository, REPO);
});

test('wrong repository rejected', async () => {
  _resetCache();
  const r = await verifyGitHubOidc(makeToken({ repository: 'evil/repo' }), opts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad_repo');
});

test('wrong audience rejected', async () => {
  _resetCache();
  const r = await verifyGitHubOidc(makeToken({ aud: 'https://evil.example' }), opts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad_audience');
});

test('expired token rejected', async () => {
  _resetCache();
  const now = Math.floor(Date.now() / 1000);
  const r = await verifyGitHubOidc(makeToken({ exp: now - 5 }), opts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
});

test('bad issuer rejected', async () => {
  _resetCache();
  const r = await verifyGitHubOidc(makeToken({ iss: 'https://evil.example' }), opts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad_issuer');
});

test('signature from foreign key rejected', async () => {
  _resetCache();
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const r = await verifyGitHubOidc(makeToken({}, { key: other }), opts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad_signature');
});

test('unknown kid rejected', async () => {
  _resetCache();
  const r = await verifyGitHubOidc(makeToken({}, { kid: 'nope' }), opts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unknown_kid');
});

test('alg:none rejected (no algorithm confusion)', async () => {
  _resetCache();
  const r = await verifyGitHubOidc(makeToken({}, { alg: 'none' }), opts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad_alg');
});

test('malformed / empty tokens rejected', async () => {
  _resetCache();
  assert.equal((await verifyGitHubOidc('', opts)).reason, 'no_token');
  assert.equal((await verifyGitHubOidc('a.b', opts)).reason, 'malformed');
  assert.equal((await verifyGitHubOidc('!!.??.$$', opts)).reason, 'bad_json');
});
