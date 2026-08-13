import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionSecrets, guardRequest, serializePublicError } from '../server/auth.mjs';

function request(headers) {
  const rawHeaders = [];
  for (const [name, value] of headers) rawHeaders.push(name, value);
  return { rawHeaders };
}
const origin = 'http://127.0.0.1:43123';
const session = { token: 'session-token', csrfToken: 'csrf-token' };
const windowsPath = (...segments) => ['C:', ...segments].join('\\');

test('session and CSRF secrets are independent fixed-strength values', () => {
  let byte = 0;
  assert.deepEqual(createSessionSecrets((size) => Buffer.alloc(size, ++byte)), {
    sessionToken: '01'.repeat(32), csrfToken: '02'.repeat(32),
  });
});

test('navigation permits absent Origin but rejects hostile Host and present wrong Origin', () => {
  assert.equal(guardRequest({ request: request([['Host', '127.0.0.1:43123']]), origin, routeClass: 'navigation', session }).ok, true);
  for (const headers of [[], [['Host', 'evil.invalid']], [['Host', '127.0.0.1:43123'], ['Host', 'evil.invalid']], [['Host', '127.0.0.1:43123'], ['Origin', 'null']], [['Host', '127.0.0.1:43123'], ['Origin', `${origin}.evil`]]]) {
    assert.equal(guardRequest({ request: request(headers), origin, routeClass: 'navigation', session }).status, 403);
  }
});

test('exact Origin rejects scheme, port, userinfo, prefix and suffix variants', () => {
  const variants=['https://127.0.0.1:43123','http://127.0.0.1:9','http://user@127.0.0.1:43123',`http://evil${origin}`,`${origin}.invalid`];
  for(const hostile of variants) assert.equal(guardRequest({request:request([['Host','127.0.0.1:43123'],['Origin',hostile]]),origin,routeClass:'navigation',session}).status,403);
});

test('bootstrap fetch metadata is same-origin compatible when supplied', () => {
  assert.equal(guardRequest({ request: request([['Host', '127.0.0.1:43123'], ['Sec-Fetch-Site', 'same-origin'], ['Sec-Fetch-Mode', 'navigate']]), origin, routeClass: 'bootstrap', session }).ok, true);
  for (const pair of [['cross-site', 'navigate'], ['same-origin', 'cors']]) {
    assert.equal(guardRequest({ request: request([['Host', '127.0.0.1:43123'], ['Sec-Fetch-Site', pair[0]], ['Sec-Fetch-Mode', pair[1]]]), origin, routeClass: 'bootstrap', session }).status, 403);
  }
});

test('request guard rejects every unregistered route class', () => {
  for (const routeClass of [undefined, '', 'navigaton', 'future']) {
    assert.deepEqual(guardRequest({
      request: request([['Host', '127.0.0.1:43123']]), origin, routeClass, session,
    }), { ok: false, status: 403, code: 'FORBIDDEN' });
  }
});

test('sensitive and state requests enforce session, exact Origin and CSRF', () => {
  const cookie = ['Cookie', 'editor_session=session-token'];
  assert.equal(guardRequest({ request: request([['Host', '127.0.0.1:43123'], cookie]), origin, routeClass: 'sensitive', session }).ok, true);
  assert.equal(guardRequest({ request: request([['Host', '127.0.0.1:43123']]), origin, routeClass: 'sensitive', session }).status, 401);
  const valid = [['Host', '127.0.0.1:43123'], ['Origin', origin], cookie, ['X-Editor-CSRF', 'csrf-token']];
  assert.equal(guardRequest({ request: request(valid), origin, routeClass: 'state', session }).ok, true);
  for (const headers of [valid.filter(([n]) => n !== 'Origin'), [...valid, ['Origin', origin]], valid.map(([n,v]) => [n, n === 'Origin' ? `${origin}/x` : v]), valid.filter(([n]) => n !== 'X-Editor-CSRF')]) {
    assert.equal(guardRequest({ request: request(headers), origin, routeClass: 'state', session }).status, 403);
  }
});

test('public errors contain only allowlisted logical data', () => {
  const privatePath=windowsPath('private');
  const error = Object.assign(new Error(`secret ${privatePath} token=abc`), { code: 'BAD_INPUT', field: 'title', details: { reason: 'invalid' }, path: privatePath, token: 'abc' });
  const value = serializePublicError(error);
  assert.deepEqual(value, { ok: false, code: 'BAD_INPUT', messageZh: '请求无效', field: 'title', details: { reason: 'invalid' } });
  assert.doesNotMatch(JSON.stringify(value), /private|token=|stack/i);
});

test('public error details reject safe-looking keys carrying secret values', () => {
  const privatePath=windowsPath('private');
  const value = serializePublicError({
    code: 'BAD_INPUT',
    details: {
      reason: 'invalid',
      location: windowsPath('private','content.yml'),
      credential: 'session-token-abc',
      environment: 'EDITOR_SECRET=abc',
      source: 'private source bytes',
      count: 7,
    },
  });
  assert.deepEqual(value.details, { reason: 'invalid' });
  assert.equal(serializePublicError({ code: 'BAD_INPUT', details: { reason: privatePath } }).details, undefined);
  assert.equal(serializePublicError({ code: 'UNKNOWN_CODE', details: { reason: 'invalid' } }).details, undefined);
});
