/** 확신도 질문을 언제 보여줄지 결정한다. */

export type ConfidenceMode = 'off' | 'sample' | 'always';

export const CONFIDENCE_SAMPLE_EVERY = 5;

export function shouldAskConfidence(
  mode: ConfidenceMode | string,
  questionNumber: number
): boolean {
  if (mode === 'always') return true;
  if (mode === 'sample') {
    return questionNumber > 0 && questionNumber % CONFIDENCE_SAMPLE_EVERY === 0;
  }
  return false;
}
