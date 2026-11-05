import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFatigue } from '../src/lib/fatigue.ts';

function input(overrides = {}) {
  return {
    recentN: 20,
    recentCorrect: 18,
    previousN: 20,
    previousCorrect: 18,
    todayReviews: 10,
    overdue: 0,
    dailyReview: 200,
    ...overrides,
  };
}

test('fatigue: 정상 상태', () => {
  const result = computeFatigue(input());
  assert.equal(result.level, 'ok');
  assert.equal(result.message, null);
  assert.equal(result.recentAccuracy, 0.9);
  assert.equal(result.previousAccuracy, 0.9);
});

test('fatigue: 최근 정확도가 낮으면 tired', () => {
  const result = computeFatigue(input({ recentCorrect: 13 }));
  assert.equal(result.level, 'tired');
  assert.match(result.message, /5분 쉬고/);
});

test('fatigue: 정확도 하락이 크면 tired', () => {
  const result = computeFatigue(
    input({ recentCorrect: 16, previousCorrect: 20 })
  );
  assert.equal(result.level, 'tired');
  assert.ok(result.accuracyDrop >= 0.15);
});

test('fatigue: 오늘 처리량이 많으면 high_load', () => {
  const result = computeFatigue(input({ todayReviews: 40 }));
  assert.equal(result.level, 'high_load');
  assert.match(result.message, /처리량/);
});

test('fatigue: 복습이 과도하게 밀리면 high_load', () => {
  const result = computeFatigue(
    input({ overdue: 100, dailyReview: 20 })
  );
  assert.equal(result.level, 'high_load');
});

test('fatigue: 표본이 없으면 ok이고 정확도는 null', () => {
  const result = computeFatigue(
    input({ recentN: 0, recentCorrect: 0, previousN: 0, previousCorrect: 0 })
  );
  assert.equal(result.level, 'ok');
  assert.equal(result.recentAccuracy, null);
  assert.equal(result.previousAccuracy, null);
  assert.equal(result.accuracyDrop, null);
});
