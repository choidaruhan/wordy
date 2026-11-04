/** 하루 신규 단어 수 자동 조절. DB와 분리된 순수 함수. */

export type NewCardMode = 'auto' | 'fixed';

export type AdaptiveReason =
  | 'fixed'
  | 'no_backlog'
  | 'heavy_backlog'
  | 'moderate_backlog'
  | 'light_backlog'
  | 'low_adherence';

export type AdaptiveInput = {
  base: number;
  overdue: number;
  throughput7: number;
  adherence7: number;
  mode: NewCardMode;
};

export type AdaptiveResult = {
  effectiveNew: number;
  factor: number;
  reason: AdaptiveReason;
  backlogWarning: boolean;
};

export function computeAdaptiveNew(input: AdaptiveInput): AdaptiveResult {
  const base = Math.max(0, Math.floor(input.base));
  const throughput = Math.max(1, input.throughput7);
  const daysToClear = Math.max(0, input.overdue) / throughput;

  // 복습이 2주치 이상 밀리면 고정 모드에서도 경고한다.
  const backlogWarning = input.overdue > 0 && daysToClear > 7;

  if (input.mode === 'fixed') {
    return { effectiveNew: base, factor: 1, reason: 'fixed', backlogWarning };
  }

  if (base === 0 || input.overdue <= 0) {
    return { effectiveNew: base, factor: 1, reason: 'no_backlog', backlogWarning: false };
  }

  const backlogFactor =
    daysToClear > 14 ? 0 : daysToClear > 7 ? 0.5 : daysToClear > 3 ? 0.75 : 1;

  // 완료율이 낮아도 최대 15%만 줄인다. 학습 능력을 과도하게 낮게 보지 않는다.
  const adherenceFactor = input.adherence7 >= 0.6 ? 1 : 0.85;
  const factor = Math.min(backlogFactor, adherenceFactor);
  const effectiveNew = Math.min(base, Math.max(0, Math.floor(base * factor)));

  const reason: AdaptiveReason =
    backlogFactor < 1
      ? daysToClear > 14
        ? 'heavy_backlog'
        : daysToClear > 7
          ? 'moderate_backlog'
          : 'light_backlog'
      : adherenceFactor < 1
        ? 'low_adherence'
        : 'no_backlog';

  return { effectiveNew, factor, reason, backlogWarning };
}
