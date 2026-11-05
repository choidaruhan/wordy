/**
 * 평점 신뢰도 계측 설정.
 *
 * 중요: 이 파일의 시간 기준은 **FSRS 평점을 바꾸는 데 쓰지 않는다.**
 * P1에서는 리뷰 로그에 `grading_reliability`를 남겨
 * 나중에 카드 유형별 임계값을 보정할 근거로만 사용한다.
 */

export const RATING_MODEL_VERSION = 1;

export type RatingTiming = {
  /** 이 시간 안이면 정상적인 인출로 본다. */
  targetMs: number;
  /** 이 시간을 넘으면 느린 응답으로 본다. */
  slowMs: number;
  /** 생산형에서 Easy 후보가 되는 시간. 인식형은 null. */
  easyMs: number | null;
};

export const RATING_TIMING: Record<string, RatingTiming> = {
  recognition: { targetMs: 8_000, slowMs: 12_000, easyMs: null },
  recall: { targetMs: 18_000, slowMs: 30_000, easyMs: 4_000 },
  cloze: { targetMs: 20_000, slowMs: 35_000, easyMs: 5_000 },
  listening: { targetMs: 18_000, slowMs: 30_000, easyMs: 5_000 },
};

const DEFAULT_TIMING: RatingTiming = {
  targetMs: 20_000,
  slowMs: 35_000,
  easyMs: null,
};

export function timingFor(cardType: string): RatingTiming {
  return RATING_TIMING[cardType] ?? DEFAULT_TIMING;
}

export type ReliabilityInput = {
  correct: boolean;
  typo?: boolean;
  responseMs?: number | null;
  cardType: string;
  confidence?: number | null;
};

/**
 * 0~1 사이의 채점 신뢰도. 정답/오답 확률이 아니라
 * “이 평점이 얼마나 믿을 만한 신호에서 나왔는가”를 나타낸다.
 */
export function computeGradingReliability(input: ReliabilityInput): number {
  const correctnessSignal = input.correct ? (input.typo ? 0.85 : 1) : 0;

  const timing = timingFor(input.cardType);
  let timingSignal = 0.5;
  if (
    input.responseMs != null &&
    Number.isFinite(input.responseMs) &&
    input.responseMs >= 0
  ) {
    if (input.responseMs <= timing.targetMs) timingSignal = 1;
    else if (input.responseMs <= timing.slowMs) timingSignal = 0.75;
    else timingSignal = 0.45;
  }

  const typeSignal = input.cardType === 'recognition' ? 0.8 : 1;

  const confidenceSignal =
    input.confidence == null
      ? 0.5
      : input.confidence >= 2
        ? 1
        : input.confidence >= 1
          ? 0.7
          : 0.4;

  const score =
    0.45 * correctnessSignal +
    0.25 * timingSignal +
    0.2 * typeSignal +
    0.1 * confidenceSignal;

  return Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000;
}
