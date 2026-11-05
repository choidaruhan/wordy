/**
 * 평점 캘리브레이션 분석.
 *
 * FSRS 평점이 실제 다음 복습 성과와 어떤 관계인지 확인한다.
 * - rating: 1 Again / 2 Hard / 3 Good / 4 Easy
 * - next rating: 같은 카드의 다음 리뷰 평점
 * - next elapsed days: 다음 리뷰까지 걸린 일수
 *
 * 이 모듈은 DB와 분리된 순수 함수다.
 */

export type ReviewSignal = {
  cardId: string;
  cardType: string;
  rating: number;
  responseMs: number | null;
  gradingReliability: number | null;
  reviewedAt: string;
  nextRating: number | null;
  nextElapsedDays: number | null;
};

export type CalibrationRow = {
  key: string;
  label: string;
  total: number;
  withNext: number;
  success: number;
  successRate: number | null;
  p50ResponseMs: number | null;
  p90ResponseMs: number | null;
  avgReliability: number | null;
};

export type RetentionRow = {
  windowDays: number;
  total: number;
  success: number;
  rate: number | null;
};

export type RatingAnalysis = {
  totalReviews: number;
  withNext: number;
  distinctCards: number;
  overall: CalibrationRow;
  byRating: CalibrationRow[];
  byType: CalibrationRow[];
  byTypeRating: CalibrationRow[];
  byReliability: CalibrationRow[];
  retention: RetentionRow[];
};

export const RATING_LABELS: Record<number, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
};

export function ratingLabel(rating: number): string {
  return RATING_LABELS[rating] ?? `rating ${rating}`;
}

/** 선형 보간 percentile. 값이 없으면 null. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function row(
  key: string,
  label: string,
  reviews: ReviewSignal[]
): CalibrationRow {
  const withNext = reviews.filter((review) => review.nextRating != null);
  const success = withNext.filter(
    (review) => (review.nextRating ?? 0) >= 2
  ).length;
  const responseTimes = reviews
    .map((review) => review.responseMs)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const reliabilities = reviews
    .map((review) => review.gradingReliability)
    .filter((value): value is number => value != null && Number.isFinite(value));

  return {
    key,
    label,
    total: reviews.length,
    withNext: withNext.length,
    success,
    successRate: withNext.length > 0 ? success / withNext.length : null,
    p50ResponseMs: percentile(responseTimes, 0.5),
    p90ResponseMs: percentile(responseTimes, 0.9),
    avgReliability: average(reliabilities),
  };
}

function reliabilityBucket(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'none';
  if (value < 0.5) return '<0.5';
  if (value < 0.7) return '0.5-0.7';
  if (value < 0.9) return '0.7-0.9';
  return '>=0.9';
}

function retention(
  reviews: ReviewSignal[],
  windowDays: number
): RetentionRow {
  const eligible = reviews.filter(
    (review) =>
      review.nextRating != null &&
      review.nextElapsedDays != null &&
      review.nextElapsedDays >= windowDays
  );
  const success = eligible.filter(
    (review) => (review.nextRating ?? 0) >= 2
  ).length;

  return {
    windowDays,
    total: eligible.length,
    success,
    rate: eligible.length > 0 ? success / eligible.length : null,
  };
}

export function analyzeReviews(reviews: ReviewSignal[]): RatingAnalysis {
  const withNext = reviews.filter((review) => review.nextRating != null).length;
  const distinctCards = new Set(reviews.map((review) => review.cardId)).size;

  const byRating = [1, 2, 3, 4].map((rating) =>
    row(
      `rating:${rating}`,
      ratingLabel(rating),
      reviews.filter((review) => review.rating === rating)
    )
  );

  const types = [...new Set(reviews.map((review) => review.cardType))].sort();
  const byType = types.map((type) =>
    row(
      `type:${type}`,
      type,
      reviews.filter((review) => review.cardType === type)
    )
  );

  const byTypeRating = types.flatMap((type) =>
    [1, 2, 3, 4].map((rating) =>
      row(
        `type:${type}:rating:${rating}`,
        `${type} · ${ratingLabel(rating)}`,
        reviews.filter(
          (review) => review.cardType === type && review.rating === rating
        )
      )
    )
  );

  const buckets = ['none', '<0.5', '0.5-0.7', '0.7-0.9', '>=0.9'];
  const byReliability = buckets.map((bucket) =>
    row(
      `reliability:${bucket}`,
      bucket,
      reviews.filter(
        (review) => reliabilityBucket(review.gradingReliability) === bucket
      )
    )
  );

  return {
    totalReviews: reviews.length,
    withNext,
    distinctCards,
    overall: row('all', '전체', reviews),
    byRating,
    byType,
    byTypeRating,
    byReliability,
    retention: [retention(reviews, 7), retention(reviews, 21)],
  };
}
