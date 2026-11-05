import type { Grade } from 'ts-fsrs';

/**
 * 퀴즈 결과를 FSRS 평점으로 바꾼다.
 *
 * - 오답은 언제나 Again.
 * - 정답은 응답 시간으로 Hard/Good/Easy를 나눈다.
 * - 객관식은 찍어서 맞힌 경우를 구분하기 위해 Easy를 주지 않는다.
 * - 오타는 정답으로 인정하되 Hard로 둔다.
 */
export const FAST_RESPONSE_MS = 3_000;
export const SLOW_RESPONSE_MS = 8_000;

export type QuizRatingInput = {
  correct: boolean;
  typo?: boolean;
  responseMs?: number | null;
  cardType: string;
};

export function ratingFromQuiz(input: QuizRatingInput): Grade {
  if (!input.correct) return 1;
  if (input.typo) return 2;

  const ms = input.responseMs;
  if (ms == null || !Number.isFinite(ms)) return 3;
  if (ms > SLOW_RESPONSE_MS) return 2;
  if (ms > FAST_RESPONSE_MS) return 3;

  // 인식(객관식)은 맞혀도 Easy까지 주지 않는다. 생산형 입력만 빠른 회상으로 인정한다.
  return input.cardType === 'recognition' ? 3 : 4;
}
