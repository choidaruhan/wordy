import type { User } from '../types';
import { localDate } from '../lib/time';
import { computeAdaptiveNew, type AdaptiveReason } from '../lib/adaptive';
import { estimateMinutes, type TypeCounts } from '../lib/session';
import { getProgress } from './review';

export type DailyPlanRow = {
  user_id: string;
  local_date: string;
  base_new: number;
  effective_new: number;
  review_target: number;
  promoted_target: number;
  due_count: number;
  estimated_minutes: number;
  reason: string;
  created_at: string;
  completed_at: string | null;
};

export type PlanProgress = {
  done: number;
  target: number;
  remaining: number;
  reviewLeft: number;
  promotedLeft: number;
  newLeft: number;
  completed: boolean;
};

export type TodayPlan = {
  active: boolean;
  baseNew: number;
  effectiveNew: number;
  reviewTarget: number;
  promotedTarget: number;
  dueCount: number;
  estimatedMinutes: number;
  reason: string;
  done: number;
  remaining: number;
  completed: boolean;
};

type PlanComputation = {
  baseNew: number;
  effectiveNew: number;
  reviewTarget: number;
  promotedTarget: number;
  dueCount: number;
  estimatedMinutes: number;
  reason: AdaptiveReason | 'limited_new';
};

type TodayPlanResult = {
  plan: TodayPlan;
  row: DailyPlanRow | null;
  progress: PlanProgress;
};

function dateMinusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function getDailyPlan(
  db: D1Database,
  userId: string,
  today: string
): Promise<DailyPlanRow | null> {
  return db
    .prepare(
      `SELECT user_id, local_date, base_new, effective_new, review_target, promoted_target,
              due_count, estimated_minutes, reason, created_at, completed_at
         FROM daily_plans
        WHERE user_id = ? AND local_date = ?`
    )
    .bind(userId, today)
    .first<DailyPlanRow>();
}

/** 최근 7일 하루 평균 처리량 */
async function getThroughput7(db: D1Database, userId: string, today: string): Promise<number> {
  const from = dateMinusDays(today, 6);
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND local_date >= ?')
    .bind(userId, from)
    .first<{ n: number }>();
  return (row?.n ?? 0) / 7;
}

export type Completion7 = {
  planned: number;
  completed: number;
  rate: number;
};

/** 최근 7일 계획 완료율. 계획이 없는 날은 분모에서 제외한다. */
export async function getCompletion7(
  db: D1Database,
  userId: string,
  today: string
): Promise<Completion7> {
  const from = dateMinusDays(today, 6);

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS planned,
              SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed
         FROM daily_plans
        WHERE user_id = ? AND local_date >= ?`
    )
    .bind(userId, from)
    .first<{ planned: number; completed: number | null }>();

  const planned = row?.planned ?? 0;
  const completed = row?.completed ?? 0;

  return {
    planned,
    completed,
    rate: planned > 0 ? completed / planned : 0,
  };
}

/** 최근 7일 계획 완료율. 계획이 없으면 리뷰가 있는 날 비율로 대체. */
async function getAdherence7(db: D1Database, userId: string, today: string): Promise<number> {
  const completion = await getCompletion7(db, userId, today);
  if (completion.planned > 0) return completion.rate;

  const from = dateMinusDays(today, 6);
  const active = await db
    .prepare(
      `SELECT COUNT(DISTINCT local_date) AS n
         FROM reviews
        WHERE user_id = ? AND local_date >= ?`
    )
    .bind(userId, from)
    .first<{ n: number }>();

  return (active?.n ?? 0) / 7;
}

/** 최근 30일 유형별 응답 시간 중앙값(초). 표본 10건 미만은 버린다. */
async function getTypeAverages(
  db: D1Database,
  userId: string,
  now: Date
): Promise<Record<string, number>> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  const { results } = await db
    .prepare(
      `WITH ranked AS (
         SELECT question_type, response_ms,
                ROW_NUMBER() OVER (
                  PARTITION BY question_type ORDER BY response_ms
                ) AS rn,
                COUNT(*) OVER (PARTITION BY question_type) AS cnt
           FROM reviews
          WHERE user_id = ? AND response_ms IS NOT NULL AND reviewed_at >= ?
       )
       SELECT question_type,
              AVG(response_ms) AS median_ms,
              MAX(cnt) AS n
         FROM ranked
        WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)
        GROUP BY question_type`
    )
    .bind(userId, since)
    .all<{ question_type: string; median_ms: number; n: number }>();

  const out: Record<string, number> = {};
  for (const row of results) {
    if ((row.n ?? 0) >= 10) out[row.question_type] = row.median_ms / 1000;
  }
  return out;
}

/** 기한 지난 복습 카드 수를 유형별로 센다. */
export async function countDueByType(
  db: D1Database,
  userId: string,
  nowIso: string
): Promise<TypeCounts> {
  const { results } = await db
    .prepare(
      `SELECT card_type, COUNT(*) AS n
         FROM cards
        WHERE user_id = ? AND suspended = 0
          AND state IN ('learning','review','relearning')
          AND due_at <= ?
        GROUP BY card_type`
    )
    .bind(userId, nowIso)
    .all<{ card_type: string; n: number }>();

  const out: TypeCounts = {};
  for (const row of results) out[row.card_type] = row.n;
  return out;
}

/** 계획 생성 이후 복습 블록에서 처리한 유형별 리뷰 수 (첫 리뷰 제외). */
export async function servedByTypeSince(
  db: D1Database,
  userId: string,
  sinceIso: string
): Promise<TypeCounts> {
  const { results } = await db
    .prepare(
      `SELECT question_type, COUNT(*) AS n
         FROM reviews
        WHERE user_id = ? AND reviewed_at >= ? AND source = 'review'
          AND reps_before > 0
        GROUP BY question_type`
    )
    .bind(userId, sinceIso)
    .all<{ question_type: string; n: number }>();

  const out: TypeCounts = {};
  for (const row of results) out[row.question_type] = row.n;
  return out;
}

async function computePlan(
  db: D1Database,
  user: User,
  now: Date,
  today: string
): Promise<PlanComputation> {
  const nowIso = now.toISOString();
  const progress = await getProgress(
    db,
    user.id,
    today,
    nowIso,
    user.daily_new,
    user.daily_review
  );

  const [throughput7, adherence7, dueCounts, averages] = await Promise.all([
    getThroughput7(db, user.id, today),
    getAdherence7(db, user.id, today),
    countDueByType(db, user.id, nowIso),
    getTypeAverages(db, user.id, now),
  ]);

  const adaptive = computeAdaptiveNew({
    base: user.daily_new,
    overdue: progress.dueReview,
    throughput7,
    adherence7,
    mode: user.new_card_mode,
  });

  const reviewTarget = Math.min(progress.dueReview, progress.reviewLeft);
  const promotedTarget = Math.min(
    progress.promotedDue,
    Math.max(0, progress.reviewLeft - reviewTarget)
  );
  const effectiveNew = Math.min(adaptive.effectiveNew, progress.newLeft);

  const estimatedMinutes = estimateMinutes({
    reviewTarget,
    promotedTarget,
    newTarget: effectiveNew,
    dueCounts,
    averages,
  });

  return {
    baseNew: user.daily_new,
    effectiveNew,
    reviewTarget,
    promotedTarget,
    dueCount: progress.dueReview,
    estimatedMinutes,
    // 신규 후보가 부족해 더 줄어든 경우, 적응형 이유보다 정확한 이유를 보여준다.
    reason: effectiveNew < adaptive.effectiveNew ? 'limited_new' : adaptive.reason,
  };
}

async function getPlanProgress(
  db: D1Database,
  user: User,
  row: DailyPlanRow,
  now: Date
): Promise<PlanProgress> {
  const today = localDate(now, user.tz_offset_min, user.timezone);
  const nowIso = now.toISOString();

  const [done, newDone, promotedDone, dynamic] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM reviews
          WHERE user_id = ? AND reviewed_at >= ? AND source = 'review'`
      )
      .bind(user.id, row.created_at)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM reviews
          WHERE user_id = ? AND reviewed_at >= ? AND source = 'review'
            AND reps_before = 0 AND question_type = 'recognition'`
      )
      .bind(user.id, row.created_at)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM reviews
          WHERE user_id = ? AND reviewed_at >= ? AND source = 'review'
            AND reps_before = 0 AND question_type != 'recognition'`
      )
      .bind(user.id, row.created_at)
      .first<{ n: number }>(),
    getProgress(db, user.id, today, nowIso, user.daily_new, user.daily_review),
  ]);

  const doneCount = done?.n ?? 0;
  const newCount = newDone?.n ?? 0;
  const promotedCount = promotedDone?.n ?? 0;
  const reviewDone = Math.max(0, doneCount - newCount - promotedCount);

  const reviewLeft = Math.max(
    0,
    Math.min(dynamic.reviewLeft, row.review_target - reviewDone)
  );
  const promotedLeft = Math.max(
    0,
    Math.min(dynamic.promotedLeft, row.promoted_target - promotedCount)
  );
  const newLeft = Math.max(0, Math.min(dynamic.newLeft, row.effective_new - newCount));

  const target = row.review_target + row.promoted_target + row.effective_new;
  const remaining = Math.max(0, target - doneCount);

  return {
    done: doneCount,
    target,
    remaining,
    reviewLeft,
    promotedLeft,
    newLeft,
    completed: doneCount >= target,
  };
}

function toTodayPlan(
  row: DailyPlanRow,
  progress: PlanProgress,
  active: boolean
): TodayPlan {
  return {
    active,
    baseNew: row.base_new,
    effectiveNew: row.effective_new,
    reviewTarget: row.review_target,
    promotedTarget: row.promoted_target,
    dueCount: row.due_count,
    estimatedMinutes: row.estimated_minutes,
    reason: row.reason,
    done: progress.done,
    remaining: progress.remaining,
    completed: progress.completed,
  };
}

/**
 * 오늘 계획을 반환한다.
 * create=false면 저장하지 않고 미리보기를 만든다. create=true면 스냅샷을 고정한다.
 */
export async function getTodayPlan(
  db: D1Database,
  user: User,
  now: Date,
  create: boolean
): Promise<TodayPlanResult> {
  const today = localDate(now, user.tz_offset_min, user.timezone);
  let row = await getDailyPlan(db, user.id, today);

  if (!row && create) {
    const computed = await computePlan(db, user, now, today);
    await db
      .prepare(
        `INSERT INTO daily_plans (
           user_id, local_date, base_new, effective_new, review_target, promoted_target,
           due_count, estimated_minutes, reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, local_date) DO NOTHING`
      )
      .bind(
        user.id,
        today,
        computed.baseNew,
        computed.effectiveNew,
        computed.reviewTarget,
        computed.promotedTarget,
        computed.dueCount,
        computed.estimatedMinutes,
        computed.reason,
        now.toISOString()
      )
      .run();

    row = await getDailyPlan(db, user.id, today);
  }

  // 오늘 할 카드가 없는 계획은 바로 완료로 기록한다. (완료율 분모가 0이 되지 않게)
  if (
    row &&
    row.completed_at === null &&
    row.review_target + row.promoted_target + row.effective_new === 0
  ) {
    await db
      .prepare(
        `UPDATE daily_plans
            SET completed_at = ?
          WHERE user_id = ? AND local_date = ? AND completed_at IS NULL`
      )
      .bind(now.toISOString(), user.id, today)
      .run();
    row = await getDailyPlan(db, user.id, today);
  }

  if (row) {
    const progress = await getPlanProgress(db, user, row, now);
    return { plan: toTodayPlan(row, progress, true), row, progress };
  }

  const computed = await computePlan(db, user, now, today);
  const target = computed.reviewTarget + computed.promotedTarget + computed.effectiveNew;
  const progress: PlanProgress = {
    done: 0,
    target,
    remaining: target,
    reviewLeft: computed.reviewTarget,
    promotedLeft: computed.promotedTarget,
    newLeft: computed.effectiveNew,
    completed: false,
  };

  return {
    plan: {
      active: false,
      baseNew: computed.baseNew,
      effectiveNew: computed.effectiveNew,
      reviewTarget: computed.reviewTarget,
      promotedTarget: computed.promotedTarget,
      dueCount: computed.dueCount,
      estimatedMinutes: computed.estimatedMinutes,
      reason: computed.reason,
      done: 0,
      remaining: target,
      completed: false,
    },
    row: null,
    progress,
  };
}

/** 특정 시각 이후의 일반 복습 수. 마무리 재시험 상한에 쓴다. */
export async function countReviewsSince(
  db: D1Database,
  userId: string,
  sinceIso: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM reviews
        WHERE user_id = ? AND reviewed_at > ? AND source = 'review'`
    )
    .bind(userId, sinceIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 리뷰 저장 후 오늘 계획이 목표에 도달했는지 확인한다. */
export async function updatePlanCompletion(
  db: D1Database,
  userId: string,
  today: string,
  now: Date
): Promise<void> {
  await db
    .prepare(
      `UPDATE daily_plans
          SET completed_at = ?
        WHERE user_id = ? AND local_date = ? AND completed_at IS NULL
          AND (
            SELECT COUNT(*) FROM reviews
             WHERE user_id = ? AND reviewed_at >= daily_plans.created_at
               AND source = 'review'
          ) >= (review_target + promoted_target + effective_new)`
    )
    .bind(now.toISOString(), userId, today, userId)
    .run();
}
