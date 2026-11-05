/**
 * M8 학습 정책.
 *
 * /play 의 한 판(session) 모드와 /review 의 하루 목표(daily) 모드를
 * 같은 계산으로 묶는다. DB와 분리된 순수 함수다.
 *
 * - session: 하루 쿼터 없이 session_size 안에서 복습/신규를 배분한다.
 * - daily: daily_plans 의 남은 목표 안에서만 세션을 만든다.
 * - 취약(weak)과 커스텀(custom)은 별도 버킷을 쓴다.
 */

import { clampNewPerSession, clampSessionSize } from './play';
import type { AdaptiveReason } from './adaptive';

export type LearningMode = 'session' | 'daily';
export type SessionKind = 'quick' | 'typing' | 'cloze' | 'listening' | 'weak' | 'custom';
export type NewCardMode = 'auto' | 'fixed';

export type PolicyReason =
  | AdaptiveReason
  | 'session'
  | 'daily_plan'
  | 'goal_done';

export type DailyPlanInput = {
  target: number;
  done: number;
  reviewTarget: number;
  reviewDone: number;
  effectiveNew: number;
  newDone: number;
  reason?: PolicyReason;
};

export type PolicyInput = {
  mode: LearningMode;
  kind: SessionKind;

  /** 사용자 설정 */
  sessionSize: number;
  newPerSession: number;
  dailyNew: number;
  dailyReview: number;
  newCardMode: NewCardMode;

  /** 현재 풀 수 있는 카드 */
  dueCount: number;
  dueByType: Record<string, number | undefined>;
  newCount: number;
  weakDueCount: number;
  deckNewCount: number;

  /** 오늘 진행 */
  todayDone: number;
  todayNewDone: number;
  todayReviewDone: number;

  /** 부담/완료율 */
  overdue: number;
  throughput7: number;
  adherence7: number;

  /** daily 모드에서 getTodayPlan() 결과를 넘긴다. 없으면 일일 설정으로 폴백한다. */
  dailyPlan?: DailyPlanInput | null;
};

export type SessionPlan = {
  policyVersion: 1;
  mode: LearningMode;
  kind: SessionKind;
  targetSize: number;
  reviewTarget: number;
  newTarget: number;
  weakTarget: number;
  reason: PolicyReason;
  backlogWarning: boolean;
  dailyPlanUsed: boolean;
};

const MAX_SESSION_SIZE = 20;
const DEFAULT_NEW_PER_SESSION = 2;

function nonNegativeInt(value: number): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function typeCount(input: PolicyInput, type: string): number {
  return nonNegativeInt(input.dueByType[type] ?? 0);
}

/** 밀린 복습을 현재 처리량으로 다 지우는 데 걸리는 일수. */
export function backlogDaysToClear(overdue: number, throughput7: number): number {
  return Math.max(0, overdue) / Math.max(1, throughput7);
}

/** 7일치 이상 밀리면 경고한다. (adaptive.ts 의 backlogWarning 과 같은 기준) */
export function computeBacklogWarning(overdue: number, throughput7: number): boolean {
  return overdue > 0 && backlogDaysToClear(overdue, throughput7) > 7;
}

function makePlan(
  input: PolicyInput,
  parts: Pick<SessionPlan, 'reviewTarget' | 'newTarget' | 'weakTarget' | 'reason'>,
  dailyPlanUsed: boolean
): SessionPlan {
  const reviewTarget = nonNegativeInt(parts.reviewTarget);
  const newTarget = nonNegativeInt(parts.newTarget);
  const weakTarget = nonNegativeInt(parts.weakTarget);

  return {
    policyVersion: 1,
    mode: input.mode,
    kind: input.kind,
    targetSize: reviewTarget + newTarget + weakTarget,
    reviewTarget,
    newTarget,
    weakTarget,
    reason: parts.reason,
    backlogWarning: computeBacklogWarning(input.overdue, input.throughput7),
    dailyPlanUsed,
  };
}

/**
 * daily 모드의 계획. getTodayPlan() 이 있으면 그 스냅샷을 쓰고,
 * 없으면 일일 설정과 오늘 진행으로 최소한의 폴백을 만든다.
 */
function resolveDailyPlan(input: PolicyInput): DailyPlanInput {
  if (input.dailyPlan) return input.dailyPlan;

  const reviewTarget = nonNegativeInt(input.dailyReview);
  const effectiveNew = nonNegativeInt(input.dailyNew);

  return {
    target: reviewTarget + effectiveNew,
    done: nonNegativeInt(input.todayDone),
    reviewTarget,
    reviewDone: nonNegativeInt(input.todayReviewDone),
    effectiveNew,
    newDone: nonNegativeInt(input.todayNewDone),
    reason: 'daily_plan',
  };
}

function buildSessionModePlan(input: PolicyInput): SessionPlan {
  const size = clampSessionSize(input.sessionSize);
  const newPer = clampNewPerSession(input.newPerSession, DEFAULT_NEW_PER_SESSION);

  switch (input.kind) {
    case 'custom':
      return makePlan(
        input,
        {
          reviewTarget: 0,
          newTarget: Math.min(nonNegativeInt(input.deckNewCount), size),
          weakTarget: 0,
          reason: 'session',
        },
        false
      );

    case 'weak':
      return makePlan(
        input,
        {
          reviewTarget: 0,
          newTarget: 0,
          weakTarget: Math.min(nonNegativeInt(input.weakDueCount), size),
          reason: 'session',
        },
        false
      );

    case 'typing':
      return makePlan(
        input,
        {
          reviewTarget: Math.min(
            typeCount(input, 'recall') + typeCount(input, 'cloze'),
            size
          ),
          newTarget: 0,
          weakTarget: 0,
          reason: 'session',
        },
        false
      );

    case 'cloze':
    case 'listening': {
      const type = input.kind;
      return makePlan(
        input,
        {
          reviewTarget: Math.min(typeCount(input, type), size),
          newTarget: 0,
          weakTarget: 0,
          reason: 'session',
        },
        false
      );
    }

    case 'quick':
    default: {
      const reviewTarget = Math.min(nonNegativeInt(input.dueCount), size);
      const newTarget = Math.min(
        newPer,
        Math.max(0, size - reviewTarget),
        nonNegativeInt(input.newCount)
      );
      return makePlan(
        input,
        { reviewTarget, newTarget, weakTarget: 0, reason: 'session' },
        false
      );
    }
  }
}

function buildDailyModePlan(input: PolicyInput): SessionPlan {
  const daily = resolveDailyPlan(input);
  const remaining = Math.max(0, daily.target - daily.done);

  if (remaining === 0) {
    return makePlan(
      input,
      { reviewTarget: 0, newTarget: 0, weakTarget: 0, reason: 'goal_done' },
      true
    );
  }

  const reviewRemaining = Math.max(0, daily.reviewTarget - daily.reviewDone);
  const newRemaining = Math.max(0, daily.effectiveNew - daily.newDone);
  const size = Math.min(clampSessionSize(input.sessionSize), remaining);
  const newPer = clampNewPerSession(input.newPerSession, DEFAULT_NEW_PER_SESSION);
  const reason = daily.reason ?? 'daily_plan';

  switch (input.kind) {
    case 'custom':
      return makePlan(
        input,
        {
          reviewTarget: 0,
          newTarget: Math.min(
            nonNegativeInt(input.deckNewCount),
            newRemaining,
            size
          ),
          weakTarget: 0,
          reason,
        },
        true
      );

    case 'weak': {
      // 취약 연습은 계획 목표를 소모하지 않지만, 하루 복습 상한은 넘지 않는다.
      const reviewCapacity = Math.max(
        0,
        nonNegativeInt(input.dailyReview) - nonNegativeInt(input.todayReviewDone)
      );
      return makePlan(
        input,
        {
          reviewTarget: 0,
          newTarget: 0,
          weakTarget: Math.min(
            nonNegativeInt(input.weakDueCount),
            size,
            reviewCapacity
          ),
          reason,
        },
        true
      );
    }

    case 'typing':
      return makePlan(
        input,
        {
          reviewTarget: Math.min(
            typeCount(input, 'recall') + typeCount(input, 'cloze'),
            reviewRemaining,
            size
          ),
          newTarget: 0,
          weakTarget: 0,
          reason,
        },
        true
      );

    case 'cloze':
    case 'listening': {
      const type = input.kind;
      return makePlan(
        input,
        {
          reviewTarget: Math.min(typeCount(input, type), reviewRemaining, size),
          newTarget: 0,
          weakTarget: 0,
          reason,
        },
        true
      );
    }

    case 'quick':
    default: {
      const reviewTarget = Math.min(reviewRemaining, size);
      const newTarget = Math.min(
        newRemaining,
        newPer,
        Math.max(0, size - reviewTarget),
        nonNegativeInt(input.newCount)
      );
      return makePlan(
        input,
        { reviewTarget, newTarget, weakTarget: 0, reason },
        true
      );
    }
  }
}

/** 세션 방식과 하루 목표 방식을 하나의 계획으로 계산한다. */
export function buildSessionPlan(input: PolicyInput): SessionPlan {
  return input.mode === 'daily'
    ? buildDailyModePlan(input)
    : buildSessionModePlan(input);
}

export const MAX_POLICY_SESSION_SIZE = MAX_SESSION_SIZE;
