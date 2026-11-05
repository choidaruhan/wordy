import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64UrlEncode,
  challengeFor,
  createPkcePair,
  randomVerifier,
} from '../src/lib/pkce.ts';

test('pkce: RFC 7636 예제 벡터를 만족한다', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(
    await challengeFor(verifier),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  );
});

test('pkce: verifier는 base64url 43자이고 challenge와 다르다', async () => {
  const pair = await createPkcePair();
  assert.equal(pair.verifier.length, 43);
  assert.equal(pair.challenge.length, 43);
  assert.notEqual(pair.verifier, pair.challenge);
  assert.match(pair.verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(pair.challenge, /^[A-Za-z0-9_-]+$/);
});

test('pkce: base64url 인코딩은 +, /, =을 쓰지 않는다', () => {
  const encoded = base64UrlEncode(new Uint8Array([251, 255, 254, 0, 1, 2]));
  assert.doesNotMatch(encoded, /[+/=]/);
});

test('pkce: randomVerifier는 매번 다른 값을 만든다', () => {
  assert.notEqual(randomVerifier(), randomVerifier());
});
