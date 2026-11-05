/**
 * 취약 단어 점수.
 *
 * - 카드 단위로 계산하고, 단어 점수는 카드 점수의 최댓값으로 집계한다.
 * - 최근 20회를 우선하되, 5~19회면 누적 데이터와 섞는다.
 * - 최근 5회 미만은 observing, 90일 이상 지난 카드는 stale로 판정하지 않는다.
 * - leech(suspended)는 이 함수의 대상이 아니다.
 */

export type WeakStatus = 'observing' | 'stale' | 'weak' | 'attention' | 'good';
export type WeakConfidence = 'low' | 'medium' | 'high';

export type WeakFactors = {
  recentErrorRate: number;
  lapses: number;
  lowStability: number;
  quizWrongs: number;
};

export type WeakInput = {
  recentN: number;
  recentErrors: number;
  totalN: number;
  totalErrors: number;
  lapses: number;
  stability: number;
  lastReviewedAt: string | null;
  quizWrongs: number;
};

export type WeakResult = {
  score: number;
  status: WeakStatus;
  errorRate: number;
  confidence: WeakConfidence;
  sampleSize: number;
  factors: WeakFactors;
};

const STALE_DAYS = 90;
const OBSERVE_MIN = 5;
const RECENT_WINDOW = 20;
const DAY_MS = 86_400_000;

function confidenceFor(sampleSize: number): WeakConfidence {
  if (sampleSize >= RECENT_WINDOW) return 'high';
  if (sampleSize >= 10) return 'medium';
  return 'low';
}

export function computeWeakness(input: WeakInput, now: Date): WeakResult {
  const totalN = Math.max(1, input.totalN);
  const recentN = Math.max(0, input.recentN);
  const recentErrorRate = recentN > 0 ? input.recentErrors / recentN : 0;
  const totalErrorRate = input.totalErrors / totalN;
  const lapses = Math.max(0, input.lapses);
  const stability = Math.max(0, input.stability);
  const quizWrongs = Math.max(0, input.quizWrongs);

  const factors: WeakFactors = {
    recentErrorRate,
    lapses,
    lowStability: 1 - Math.min(1, stability / 21),
    quizWrongs,
  };

  if (input.lastReviewedAt) {
    const age = now.getTime() - Date.parse(input.lastReviewedAt);
    if (Number.isFinite(age) && age > STALE_DAYS * DAY_MS) {
      return {
        score: 0,
        status: 'stale',
        errorRate: recentErrorRate,
        confidence: 'low',
        sampleSize: recentN,
        factors,
      };
    }
  }

  if (recentN < OBSERVE_MIN) {
    return {
      score: 0,
      status: 'observing',
      errorRate: recentErrorRate,
      confidence: 'low',
      sampleSize: recentN,
      factors,
    };
  }

  const errorRate =
    recentN < RECENT_WINDOW
      ? 0.7 * recentErrorRate + 0.3 * totalErrorRate
      : recentErrorRate;

  const baseScore =
    0.5 * errorRate +
    0.3 * Math.min(1, lapses / 8) +
    0.2 * (1 - Math.min(1, stability / 21));

  const quizBoost = Math.min(0.15, 0.03 * quizWrongs);
  const score = Math.min(1, baseScore + quizBoost);

  const status: WeakStatus =
    score >= 0.6 ? 'weak' : score >= 0.35 ? 'attention' : 'good';

  return {
    score,
    status,
    errorRate,
    confidence: confidenceFor(recentN),
    sampleSize: recentN,
    factors,
  };
}
