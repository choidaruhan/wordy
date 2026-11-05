/** 학습 피로도와 최근 정확도 변화. DB와 분리된 순수 함수. */

export type FatigueLevel = 'ok' | 'tired' | 'high_load';

export type FatigueInput = {
  recentN: number;
  recentCorrect: number;
  previousN: number;
  previousCorrect: number;
  todayReviews: number;
  overdue: number;
  dailyReview: number;
};

export type FatigueResult = {
  level: FatigueLevel;
  message: string | null;
  recentAccuracy: number | null;
  previousAccuracy: number | null;
  accuracyDrop: number | null;
};

const HIGH_LOAD_TODAY = 40;
const DROP_THRESHOLD = 0.15;
const LOW_ACCURACY = 0.7;

export function computeFatigue(input: FatigueInput): FatigueResult {
  const recentAccuracy =
    input.recentN > 0 ? input.recentCorrect / input.recentN : null;
  const previousAccuracy =
    input.previousN > 0 ? input.previousCorrect / input.previousN : null;
  const accuracyDrop =
    recentAccuracy != null && previousAccuracy != null
      ? previousAccuracy - recentAccuracy
      : null;

  const highLoad =
    input.todayReviews >= HIGH_LOAD_TODAY ||
    input.overdue > Math.max(40, input.dailyReview * 2);

  if (highLoad) {
    return {
      level: 'high_load',
      message:
        '오늘 처리량이 많습니다. 복습만 하거나 잠깐 쉬어가세요.',
      recentAccuracy,
      previousAccuracy,
      accuracyDrop,
    };
  }

  const tired =
    input.recentN >= 10 &&
    ((recentAccuracy ?? 1) < LOW_ACCURACY ||
      (accuracyDrop ?? 0) >= DROP_THRESHOLD);

  if (tired) {
    return {
      level: 'tired',
      message:
        '최근 정확도가 떨어졌습니다. 5분 쉬고 복습 중심으로 이어가세요.',
      recentAccuracy,
      previousAccuracy,
      accuracyDrop,
    };
  }

  return {
    level: 'ok',
    message: null,
    recentAccuracy,
    previousAccuracy,
    accuracyDrop,
  };
}
