import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeQuota,
  clampResponseMs,
  isCorrectRating,
} from '../src/lib/quota.ts';

test('computeQuota: 복습이 신규보다 먼저 상한을 쓴다', () => {
  const q = computeQuota({
    dailyNew: 10,
    dailyReview: 200,
    done: 0,
    newDone: 0,
    dueReview: 38,
    promotedDue: 5,
    newAvailable: 100,
  });

  assert.equal(q.reviewLeft, 200);
  assert.equal(q.reviewRemaining, 38);
  assert.equal(q.promotedLeft, 5);
  assert.equal(q.newLeft, 10);
  assert.equal(q.remaining, 53);
});

test('computeQuota: 복습 상한이 차면 승급은 내일로 넘어간다', () => {
  const q = computeQuota({
    dailyNew: 10,
    dailyReview: 4,
    done: 2,
    newDone: 0,
    dueReview: 3,
    promotedDue: 2,
    newAvailable: 100,
  });

  assert.equal(q.reviewLeft, 2);
  assert.equal(q.reviewRemaining, 2);
  assert.equal(q.promotedLeft, 0);
  assert.equal(q.newLeft, 10);
  assert.equal(q.remaining, 12);
});

test('computeQuota: 신규 소개는 daily_new만 쓰고 daily_review는 쓰지 않는다', () => {
  const q = computeQuota({
    dailyNew: 10,
    dailyReview: 200,
    done: 5,
    newDone: 5,
    dueReview: 3,
    promotedDue: 2,
    newAvailable: 100,
  });

  assert.equal(q.reviewDone, 0);
  assert.equal(q.reviewLeft, 200);
  assert.equal(q.reviewRemaining, 3);
  assert.equal(q.promotedLeft, 2);
  assert.equal(q.newLeft, 5);
  assert.equal(q.remaining, 10);
});

test('computeQuota: 신규 쿼터를 초과하지 않는다', () => {
  const q = computeQuota({
    dailyNew: 5,
    dailyReview: 200,
    done: 8,
    newDone: 8,
    dueReview: 0,
    promotedDue: 0,
    newAvailable: 100,
  });

  assert.equal(q.newLeft, 0);
  assert.equal(q.remaining, 0);
});

test('isCorrectRating: Again만 실패', () => {
  assert.equal(isCorrectRating(1), false);
  assert.equal(isCorrectRating(2), true);
  assert.equal(isCorrectRating(3), true);
  assert.equal(isCorrectRating(4), true);
});

test('clampResponseMs: NULL, 음수, 과도한 값 보정', () => {
  const now = new Date('2026-11-04T12:00:00.000Z');

  assert.equal(clampResponseMs(null, now), null);
  assert.equal(clampResponseMs(undefined, now), null);
  assert.equal(clampResponseMs('not-a-date', now), null);
  assert.equal(clampResponseMs('2026-11-04T11:59:50.000Z', now), 10000);
  assert.equal(clampResponseMs('2026-11-04T11:59:50.500Z', now), 9500);
  assert.equal(clampResponseMs('2026-11-04T12:00:01.000Z', now), 0);
  assert.equal(clampResponseMs('2026-11-04T11:00:00.000Z', now), 300000);
});
