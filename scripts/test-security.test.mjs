import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedMutationOrigin } from '../src/lib/security.ts';

test('security: same-origin POST를 허용한다', () => {
  assert.equal(
    isAllowedMutationOrigin({
      requestUrl: 'https://wordy.example/play',
      origin: 'https://wordy.example',
    }),
    true
  );
  assert.equal(
    isAllowedMutationOrigin({
      requestUrl: 'https://wordy.example/play',
      origin: null,
      referer: 'https://wordy.example/play/abc',
    }),
    true
  );
});

test('security: cross-site Origin/Sec-Fetch-Site를 거부한다', () => {
  assert.equal(
    isAllowedMutationOrigin({
      requestUrl: 'https://wordy.example/play',
      origin: 'https://evil.example',
    }),
    false
  );
  assert.equal(
    isAllowedMutationOrigin({
      requestUrl: 'https://wordy.example/play',
      origin: null,
      referer: 'https://evil.example/attack',
    }),
    false
  );
  assert.equal(
    isAllowedMutationOrigin({
      requestUrl: 'https://wordy.example/play',
      origin: 'https://wordy.example',
      secFetchSite: 'cross-site',
    }),
    false
  );
});

test('security: Origin도 Referer도 없으면 non-browser 요청으로 허용한다', () => {
  assert.equal(
    isAllowedMutationOrigin({
      requestUrl: 'https://wordy.example/play',
      origin: null,
      referer: null,
    }),
    true
  );
});

test('security: 잘못된 URL은 거부한다', () => {
  assert.equal(
    isAllowedMutationOrigin({
      requestUrl: 'not-a-url',
      origin: 'https://wordy.example',
    }),
    false
  );
  assert.equal(
    isAllowedMutationOrigin({
      requestUrl: 'https://wordy.example/play',
      origin: 'null',
    }),
    false
  );
});
