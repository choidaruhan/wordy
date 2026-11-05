import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidTimeZone, localDate } from '../src/lib/time.ts';

test('time: Asia/Seoul 자정 경계를 IANA로 계산한다', () => {
  assert.equal(
    localDate(new Date('2026-11-05T14:59:00.000Z'), 540, 'Asia/Seoul'),
    '2026-11-05'
  );
  assert.equal(
    localDate(new Date('2026-11-05T15:00:00.000Z'), 540, 'Asia/Seoul'),
    '2026-11-06'
  );
});

test('time: America/New_York DST 경계에서 날짜가 맞다', () => {
  assert.equal(
    localDate(new Date('2026-03-09T03:59:59.000Z'), -300, 'America/New_York'),
    '2026-03-08'
  );
  assert.equal(
    localDate(new Date('2026-03-09T04:00:00.000Z'), -300, 'America/New_York'),
    '2026-03-09'
  );
});

test('time: Europe/London DST 경계에서 날짜가 맞다', () => {
  assert.equal(
    localDate(new Date('2026-03-29T22:30:00.000Z'), 0, 'Europe/London'),
    '2026-03-29'
  );
  assert.equal(
    localDate(new Date('2026-03-29T23:30:00.000Z'), 0, 'Europe/London'),
    '2026-03-30'
  );
});

test('time: 잘못된 시간대는 오프셋으로 폴백한다', () => {
  const date = new Date('2026-11-05T15:30:00.000Z');
  assert.equal(localDate(date, 540, 'Not/AZone'), '2026-11-06');
  assert.equal(localDate(date, 540, null), '2026-11-06');
  assert.equal(localDate(date, 0), '2026-11-05');
});

test('time: IANA 시간대 유효성을 검사한다', () => {
  assert.equal(isValidTimeZone('Asia/Seoul'), true);
  assert.equal(isValidTimeZone('America/New_York'), true);
  assert.equal(isValidTimeZone('UTC'), true);
  assert.equal(isValidTimeZone('Not/AZone'), false);
  assert.equal(isValidTimeZone(''), false);
});
