import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWeakness } from '../src/lib/weak.ts';

const now = new Date('2026-11-04T12:00:00.000Z');

function input(overrides = {}) {
  return {
    recentN: 20,
    recentErrors: 8,
    totalN: 30,
    totalErrors: 10,
    lapses: 3,
    stability: 6,
    lastReviewedAt: '2026-11-01T00:00:00.000Z',
    quizWrongs: 1,
    ...overrides,
  };
}

test('computeWeakness: 최근 5회 미만은 observing', () => {
  const result = computeWeakness(input({ recentN: 4, recentErrors: 3 }), now);
  assert.equal(result.status, 'observing');
  assert.equal(result.score, 0);
});

test('computeWeakness: 90일 이상 지난 카드는 stale', () => {
  const result = computeWeakness(
    input({ recentN: 3, lastReviewedAt: '2026-07-01T00:00:00.000Z' }),
    now
  );
  assert.equal(result.status, 'stale');
});

test('computeWeakness: 20회 중 8회 오답 + 퀴즈 1회 → attention', () => {
  const result = computeWeakness(input(), now);
  assert.ok(result.score > 0.45 && result.score < 0.5);
  assert.equal(result.status, 'attention');
});

test('computeWeakness: 최근 20회 중 14회 오답 → weak', () => {
  const result = computeWeakness(
    input({ recentErrors: 14, lapses: 5, stability: 2, quizWrongs: 0 }),
    now
  );
  assert.ok(result.score >= 0.6);
  assert.equal(result.status, 'weak');
});

test('computeWeakness: 최근 20회 중 1회 오답, 안정된 카드 → good', () => {
  const result = computeWeakness(
    input({ recentErrors: 1, lapses: 0, stability: 30, quizWrongs: 0 }),
    now
  );
  assert.equal(result.status, 'good');
  assert.ok(result.score < 0.1);
});

test('computeWeakness: 5~19회는 최근/누적을 섞는다', () => {
  const result = computeWeakness(
    input({
      recentN: 5,
      recentErrors: 3,
      totalN: 10,
      totalErrors: 5,
      lapses: 0,
      stability: 10,
      quizWrongs: 0,
    }),
    now
  );

  // 0.7 * 0.6 + 0.3 * 0.5 = 0.57
  assert.ok(Math.abs(result.errorRate - 0.57) < 1e-9);
  assert.equal(result.status, 'attention');
});

test('computeWeakness: 퀴즈 보너스는 0.15로 제한', () => {
  const result = computeWeakness(
    input({ recentErrors: 0, totalErrors: 0, lapses: 0, stability: 30, quizWrongs: 100 }),
    now
  );
  assert.equal(result.score, 0.15);
  assert.equal(result.status, 'good');
});
