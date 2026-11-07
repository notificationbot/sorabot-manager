/* Real WebCrypto verification; generated test key is never used by the app. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const test = require('node:test');
const now = 1794000000000;
const window = {location: {hostname: 'example.github.io'}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../assets/connection.js'), 'utf8'), {window, crypto: webcrypto, TextDecoder, Uint8Array, URL, URLSearchParams, atob});
const verify = window.IRISConnection.verifyConnection;
let keys;
let jwk;
const ready = (async () => {
  keys = await webcrypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  jwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey);
})();
async function signed(overrides = {}) {
  await ready;
  const payload = Buffer.from(JSON.stringify({api: 'https://valid-room.trycloudflare.com', ticket: 'opaque-test-ticket', expires: now / 1000 + 300, ...overrides}));
  const sig = Buffer.from(await webcrypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, keys.privateKey, payload));
  return `#connect=${payload.toString('base64url')}&sig=${sig.toString('base64url')}`;
}
test('accepts signed payload with exact raw-byte verification', async () => {
  const result = await verify(await signed(), jwk, () => now);
  assert.equal(result.api, 'https://valid-room.trycloudflare.com');
  assert.equal(result.ticket, 'opaque-test-ticket');
});
test('rejects tampering, wrong keys, missing signatures and old fragments', async () => {
  const link = await signed();
  const p = new URLSearchParams(link.slice(1));
  const data = JSON.parse(Buffer.from(p.get('connect'), 'base64url'));
  data.ticket = 'attacker';
  p.set('connect', Buffer.from(JSON.stringify(data)).toString('base64url'));
  await assert.rejects(verify('#' + p, jwk, () => now));
  const other = await webcrypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  await assert.rejects(verify(link, await webcrypto.subtle.exportKey('jwk', other.publicKey), () => now));
  for (const invalid of ['#api=https://x.trycloudflare.com&ticket=x', link.split('&')[0], link + '&api=x', link + '&sig=x']) await assert.rejects(verify(invalid, jwk, () => now));
});
test('rejects expired and excessive expiry windows, extra keys and unsafe hosts', async () => {
  for (const overrides of [{expires: now / 1000 - 1}, {expires: now / 1000 + 331}, {expires: 'later'}, {unexpected: true}, {api: 'https://trycloudflare.com'}, {api: 'https://a.b.trycloudflare.com'}, {api: 'https://a.trycloudflare.com/path'}, {api: 'https://user@a.trycloudflare.com'}, {api: 'https://a.trycloudflare.com?x=1'}, {api: 'http://127.0.0.1:8781'}]) {
    await assert.rejects(verify(await signed(overrides), jwk, () => now));
  }
});
test('loopback API only works on a local page; localhost API is never accepted', async () => {
  window.location.hostname = 'localhost';
  try {
    assert.equal((await verify(await signed({api: 'http://127.0.0.1:8781'}), jwk, () => now)).api, 'http://127.0.0.1:8781');
    await assert.rejects(verify(await signed({api: 'http://localhost:8781'}), jwk, () => now));
  } finally { window.location.hostname = 'example.github.io'; }
});
