/* Verify the bot-issued connection before any password or API request is allowed. */
(() => {
  'use strict';
  const decode = (value) => {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid-encoding');
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  };
  async function verifyConnection(fragment, jwk, now = Date.now) {
    const params = new URLSearchParams(fragment.replace(/^#/, ''));
    if ([...params.keys()].length !== 2 || !params.has('connect') || !params.has('sig')) throw new Error('invalid-link');
    const payload = decode(params.get('connect'));
    const signature = decode(params.get('sig'));
    if (payload.length > 4096 || signature.length !== 64 || !jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.d) throw new Error('invalid-key');
    const key = await crypto.subtle.importKey('jwk', jwk, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
    if (!await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, signature, payload)) throw new Error('invalid-signature');
    const data = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(payload));
    if (!data || Object.keys(data).sort().join(',') !== 'api,expires,ticket' || typeof data.api !== 'string' || typeof data.ticket !== 'string' || !data.ticket || data.ticket.length > 2048 || !Number.isSafeInteger(data.expires)) throw new Error('invalid-payload');
    const seconds = now() / 1000;
    if (data.expires < seconds || data.expires > seconds + 330) throw new Error('expired-link');
    const candidate = new URL(data.api);
    const cloud = candidate.protocol === 'https:' && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.trycloudflare\.com$/.test(candidate.hostname) && !candidate.port;
    const localPage = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    const local = localPage && candidate.protocol === 'http:' && candidate.hostname === '127.0.0.1' && candidate.port === '8781';
    if (!(cloud || local) || candidate.username || candidate.password || candidate.pathname !== '/' || candidate.search || candidate.hash) throw new Error('invalid-api');
    return {api: candidate.origin, ticket: data.ticket};
  }
  window.IRISConnection = Object.freeze({verifyConnection});
})();
