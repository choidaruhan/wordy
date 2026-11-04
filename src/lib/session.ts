/** 하루 세션의 유형 혼합과 예상 시간. DB와 분리된 순수 함수. */

export type TypeCounts = Record<string, number>;

/** 복습 블록의 목표 비율. listening은 M6.5에서 켠다. */
export const DEFAULT_REVIEW_RATIOS: Record<string, number> = {
  recognition: 0.5,
  recall: 0.3,
  cloze: 0.2,
};

export const FALLBACK_SECONDS: Record<string, number> = {
  recognition: 8,
  recall: 18,
  cloze: 20,
  listening: 15,
  newIntro: 25,
};

/**
 * 목표 비율과 현재 due/처리량을 보고 다음 복습 유형을 고른다.
 * due 카드가 없는 유형은 비율에서 제외하고 남은 유형으로 정규화한다.
 */
export function selectNextType(
  ratios: Record<string, number>,
  dueCounts: TypeCounts,
  servedCounts: TypeCounts
): string | null {
  const available = Object.keys(ratios).filter(
    (type) => (ratios[type] ?? 0) > 0 && (dueCounts[type] ?? 0) > 0
  );

  if (available.length === 0) return null;

  const targetSum = available.reduce((sum, type) => sum + (ratios[type] ?? 0), 0);
  const servedTotal = available.reduce((sum, type) => sum + (servedCounts[type] ?? 0), 0);

  let best: string | null = null;
  let bestDeficit = -Infinity;

  for (const type of available) {
    const target = targetSum > 0 ? (ratios[type] ?? 0) / targetSum : 1 / available.length;
    const served = servedTotal > 0 ? (servedCounts[type] ?? 0) / servedTotal : 0;
    const deficit = target - served;

    if (deficit > bestDeficit) {
      best = type;
      bestDeficit = deficit;
    }
  }

  return best;
}

export type EstimateInput = {
  reviewTarget: number;
  promotedTarget: number;
  newTarget: number;
  dueCounts: TypeCounts;
  averages: Record<string, number>;
};

/** 복습/승급/신규 목표와 유형별 응답 시간으로 예상 학습 시간(분)을 계산한다. */
export function estimateMinutes(input: EstimateInput): number {
  const reviewTarget = Math.max(0, input.reviewTarget);
  const promotedTarget = Math.max(0, input.promotedTarget);
  const newTarget = Math.max(0, input.newTarget);

  if (reviewTarget + promotedTarget + newTarget === 0) return 0;

  const reviewTypes = ['recognition', 'recall', 'cloze', 'listening'];
  const dueTotal = reviewTypes.reduce((sum, type) => sum + Math.max(0, input.dueCounts[type] ?? 0), 0);

  let reviewSeconds = 10;
  if (dueTotal > 0) {
    reviewSeconds =
      reviewTypes.reduce(
        (sum, type) =>
          sum +
          Math.max(0, input.dueCounts[type] ?? 0) *
            (input.averages[type] ?? FALLBACK_SECONDS[type] ?? 10),
        0
      ) / dueTotal;
  }

  const promotedTypes = ['recall', 'cloze', 'listening'];
  const promotedSeconds =
    promotedTypes.reduce(
      (sum, type) => sum + (input.averages[type] ?? FALLBACK_SECONDS[type] ?? 20),
      0
    ) / promotedTypes.length;

  const newSeconds = input.averages['newIntro'] ?? FALLBACK_SECONDS['newIntro'];

  const seconds =
    reviewTarget * reviewSeconds + promotedTarget * promotedSeconds + newTarget * newSeconds;

  return Math.max(0, Math.ceil(seconds / 60));
}
