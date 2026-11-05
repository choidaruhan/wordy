import type { User } from '../types';
import { localDate } from '../lib/time';
import { computeFatigue, type FatigueResult } from '../lib/fatigue';

export type LearningPulse = FatigueResult & {
  todayReviews: number;
  studyDays7: number;
  overdue: number;
};

export type WeekSummary = {
  reviews: number;
  correct: number;
  accuracy: number | null;
  studyDays: number;
};

export type WeeklyReport = {
  current: WeekSummary;
  previous: WeekSummary;
  reviewDelta: number;
  accuracyDelta: number | null;
};

function dateMinusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function summarize(
  rows: { local_date: string; n: number; correct: number | null }[]
): WeekSummary {
  const reviews = rows.reduce((sum, row) => sum + row.n, 0);
  const correct = rows.reduce((sum, row) => sum + (row.correct ?? 0), 0);

  return {
    reviews,
    correct,
    accuracy: reviews > 0 ? correct / reviews : null,
    studyDays: rows.length,
  };
}

export async function getLearningPulse(
  db: D1Database,
  user: User,
  now: Date = new Date(),
  dailyReview: number = 200
): Promise<LearningPulse> {
  const today = localDate(now, user.tz_offset_min, user.timezone);
  const from7 = dateMinusDays(today, 6);
  const nowIso = now.toISOString();

  const [recentRows, previousRows, todayRow, studyDaysRow, overdueRow] =
    await Promise.all([
      db
        .prepare(
          `SELECT rating FROM reviews
            WHERE user_id = ?
            ORDER BY reviewed_at DESC
            LIMIT 20 OFFSET 0`
        )
        .bind(user.id)
        .all<{ rating: number }>(),
      db
        .prepare(
          `SELECT rating FROM reviews
            WHERE user_id = ?
            ORDER BY reviewed_at DESC
            LIMIT 20 OFFSET 20`
        )
        .bind(user.id)
        .all<{ rating: number }>(),
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND local_date = ?'
        )
        .bind(user.id, today)
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT COUNT(DISTINCT local_date) AS n
             FROM reviews
            WHERE user_id = ? AND local_date >= ?`
        )
        .bind(user.id, from7)
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) AS n
             FROM cards
            WHERE user_id = ? AND suspended = 0
              AND state IN ('learning','review','relearning')
              AND due_at <= ?`
        )
        .bind(user.id, nowIso)
        .first<{ n: number }>(),
    ]);

  const recentN = recentRows.results.length;
  const recentCorrect = recentRows.results.filter(
    (row) => row.rating >= 2
  ).length;
  const previousN = previousRows.results.length;
  const previousCorrect = previousRows.results.filter(
    (row) => row.rating >= 2
  ).length;

  const fatigue = computeFatigue({
    recentN,
    recentCorrect,
    previousN,
    previousCorrect,
    todayReviews: todayRow?.n ?? 0,
    overdue: overdueRow?.n ?? 0,
    dailyReview,
  });

  return {
    ...fatigue,
    todayReviews: todayRow?.n ?? 0,
    studyDays7: studyDaysRow?.n ?? 0,
    overdue: overdueRow?.n ?? 0,
  };
}

export async function getWeeklyReport(
  db: D1Database,
  userId: string,
  today: string
): Promise<WeeklyReport> {
  const currentStart = dateMinusDays(today, 6);
  const previousStart = dateMinusDays(today, 13);
  const previousEnd = dateMinusDays(today, 7);

  const [currentRows, previousRows] = await Promise.all([
    db
      .prepare(
        `SELECT local_date, COUNT(*) AS n,
                SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END) AS correct
           FROM reviews
          WHERE user_id = ? AND local_date >= ? AND local_date <= ?
          GROUP BY local_date
          ORDER BY local_date`
      )
      .bind(userId, currentStart, today)
      .all<{ local_date: string; n: number; correct: number | null }>(),
    db
      .prepare(
        `SELECT local_date, COUNT(*) AS n,
                SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END) AS correct
           FROM reviews
          WHERE user_id = ? AND local_date >= ? AND local_date <= ?
          GROUP BY local_date
          ORDER BY local_date`
      )
      .bind(userId, previousStart, previousEnd)
      .all<{ local_date: string; n: number; correct: number | null }>(),
  ]);

  const current = summarize(currentRows.results);
  const previous = summarize(previousRows.results);

  return {
    current,
    previous,
    reviewDelta: current.reviews - previous.reviews,
    accuracyDelta:
      current.accuracy != null && previous.accuracy != null
        ? current.accuracy - previous.accuracy
        : null,
  };
}

/** 전체 학습일 중 가장 긴 연속 일수. */
export async function bestStreak(
  db: D1Database,
  userId: string
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT local_date AS d
         FROM reviews
        WHERE user_id = ?
        ORDER BY local_date ASC`
    )
    .bind(userId)
    .all<{ d: string }>();

  let best = 0;
  let current = 0;
  let previous: number | null = null;

  for (const row of results) {
    const value = Date.parse(`${row.d}T00:00:00.000Z`);
    if (previous != null && value - previous === 86_400_000) {
      current += 1;
    } else {
      current = 1;
    }
    previous = value;
    if (current > best) best = current;
  }

  return best;
}
