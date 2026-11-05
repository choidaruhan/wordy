import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeReviews,
  percentile,
  ratingLabel,
} from '../src/lib/rating-analysis.ts';

function review(overrides = {}) {
  return {
    cardId: 'c1',
    cardType: 'recognition',
    rating: 3,
    responseMs: 3_000,
    gradingReliability: 0.9,
    reviewedAt: '2026-11-01T00:00:00.000Z',
    nextRating: 3,
    nextElapsedDays: 10,
    ...overrides,
  };
}

test('rating-analysis: percentile를 선형 보간으로 계산한다', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([5], 0.9), 5);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([1, 2, 3, 4], 0.9), 3.7);
});

test('rating-analysis: 평점별·유형별 캘리브레이션을 계산한다', () => {
  const reviews = [
    review({
      cardId: 'a',
      cardType: 'recognition',
      rating: 1,
      responseMs: 1_000,
      gradingReliability: 0.4,
      nextRating: 2,
      nextElapsedDays: 10,
    }),
    review({
      cardId: 'a',
      cardType: 'recognition',
      rating: 2,
      responseMs: 2_000,
      gradingReliability: 0.7,
      nextRating: 3,
      nextElapsedDays: 30,
    }),
    review({
      cardId: 'b',
      cardType: 'recall',
      rating: 3,
      responseMs: 3_000,
      gradingReliability: 0.9,
      nextRating: 1,
      nextElapsedDays: 2,
    }),
    review({
      cardId: 'b',
      cardType: 'recall',
      rating: 4,
      responseMs: null,
      gradingReliability: null,
      nextRating: null,
      nextElapsedDays: null,
    }),
  ];

  const analysis = analyzeReviews(reviews);
  assert.equal(analysis.totalReviews, 4);
  assert.equal(analysis.withNext, 3);
  assert.equal(analysis.distinctCards, 2);
  assert.equal(analysis.overall.success, 2);
  assert.equal(analysis.overall.successRate, 2 / 3);
  assert.equal(analysis.overall.p50ResponseMs, 2_000);
  assert.equal(analysis.overall.p90ResponseMs, 2_800);
  assert.ok(Math.abs(analysis.overall.avgReliability - 2 / 3) < 1e-9);

  const byRating = new Map(analysis.byRating.map((row) => [row.key, row]));
  assert.equal(byRating.get('rating:1').successRate, 1);
  assert.equal(byRating.get('rating:3').successRate, 0);
  assert.equal(byRating.get('rating:4').withNext, 0);
  assert.equal(byRating.get('rating:4').successRate, null);

  const byType = new Map(analysis.byType.map((row) => [row.key, row]));
  assert.equal(byType.get('type:recognition').successRate, 1);
  assert.equal(byType.get('type:recall').successRate, 0);

  const reliability = new Map(
    analysis.byReliability.map((row) => [row.key, row])
  );
  assert.equal(reliability.get('reliability:<0.5').success, 1);
  assert.equal(reliability.get('reliability:0.7-0.9').total, 1);
  assert.equal(reliability.get('reliability:0.7-0.9').success, 1);
  assert.equal(reliability.get('reliability:>=0.9').total, 1);
  assert.equal(reliability.get('reliability:>=0.9').success, 0);
  assert.equal(reliability.get('reliability:none').total, 1);

  assert.equal(analysis.retention[0].windowDays, 7);
  assert.equal(analysis.retention[0].total, 2);
  assert.equal(analysis.retention[0].success, 2);
  assert.equal(analysis.retention[1].windowDays, 21);
  assert.equal(analysis.retention[1].total, 1);
  assert.equal(analysis.retention[1].success, 1);
});

test('rating-analysis: 다음 리뷰가 없으면 성공률을 만들지 않는다', () => {
  const analysis = analyzeReviews([
    review({ nextRating: null, nextElapsedDays: null }),
  ]);
  assert.equal(analysis.overall.withNext, 0);
  assert.equal(analysis.overall.successRate, null);
  assert.equal(analysis.retention[0].total, 0);
});

test('rating-analysis: 평점 라벨을 제공한다', () => {
  assert.equal(ratingLabel(1), 'Again');
  assert.equal(ratingLabel(4), 'Easy');
  assert.equal(ratingLabel(9), 'rating 9');
});
