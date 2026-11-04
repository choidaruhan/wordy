/** 오늘의 복습·신규 쿼터 계산. DB와 분리된 순수 함수. */

export type QuotaInput = {
  dailyNew: number;
  dailyReview: number;
  done: number; // 오늘 전체 리뷰 수
  newDone: number; // 오늘 처음 본 recognition 카드 수
  dueReview: number;
  promotedDue: number;
  newAvailable: number;
};

export type Quota = {
  reviewDone: number;
  reviewLeft: number;
  reviewRemaining: number;
  promotedLeft: number;
  newLeft: number;
  remaining: number;
};

export function computeQuota(input: QuotaInput): Quota {
  const reviewDone = Math.max(0, input.done - input.newDone);
  const reviewLeft = Math.max(0, input.dailyReview - reviewDone);

  // 복습 → 승급 → 신규 순서. 복습이 상한을 다 쓰면 승급은 내일로 넘어간다.
  const reviewRemaining = Math.min(input.dueReview, reviewLeft);
  const promotedLeft = Math.min(
    input.promotedDue,
    Math.max(0, reviewLeft - reviewRemaining)
  );
  const newLeft = Math.min(Math.max(0, input.dailyNew - input.newDone), input.newAvailable);

  return {
    reviewDone,
    reviewLeft,
    reviewRemaining,
    promotedLeft,
    newLeft,
    remaining: reviewRemaining + promotedLeft + newLeft,
  };
}

/** FSRS 기준: Again(1)만 실패. */
export function isCorrectRating(rating: number): boolean {
  return rating >= 2;
}

const MAX_RESPONSE_MS = 5 * 60 * 1000;

/** 서버가 받은 shown_at으로 응답 시간을 계산한다. 음수와 과도한 값은 보정. */
export function clampResponseMs(shownAt: string | null | undefined, now: Date): number | null {
  if (!shownAt) return null;

  const t = Date.parse(shownAt);
  if (!Number.isFinite(t)) return null;

  return Math.max(0, Math.min(MAX_RESPONSE_MS, Math.trunc(now.getTime() - t)));
}
