export type DayStat = {
  date: string;
  total: number;
  correct: number;
};

export async function dailyStats(
  db: D1Database,
  userId: string,
  fromDate: string
): Promise<DayStat[]> {
  const { results } = await db
    .prepare(
      `SELECT local_date AS date,
              COUNT(*) AS total,
              SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END) AS correct
         FROM reviews
        WHERE user_id = ? AND local_date >= ?
        GROUP BY local_date
        ORDER BY local_date`
    )
    .bind(userId, fromDate)
    .all<DayStat>();
  return results;
}

export async function rangeSummary(
  db: D1Database,
  userId: string,
  fromDate: string
): Promise<{ total: number; correct: number }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END) AS correct
         FROM reviews
        WHERE user_id = ? AND local_date >= ?`
    )
    .bind(userId, fromDate)
    .first<{ total: number; correct: number | null }>();

  return { total: row?.total ?? 0, correct: row?.correct ?? 0 };
}

export async function countOn(db: D1Database, userId: string, date: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND local_date = ?')
    .bind(userId, date)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function learnedCount(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM cards
        WHERE user_id = ? AND state = 'review' AND scheduled_days >= 21`
    )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 오늘(또는 어제)부터 거꾸로 이어진 학습일 */
export async function streak(db: D1Database, userId: string, today: string): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT local_date AS d
         FROM reviews
        WHERE user_id = ?
        ORDER BY local_date DESC
        LIMIT 400`
    )
    .bind(userId)
    .all<{ d: string }>();

  const days = new Set(results.map((r) => r.d));
  let count = 0;
  const cursor = new Date(`${today}T00:00:00Z`);

  // 오늘 아직 안 했으면 어제부터 센다
  if (!days.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);

  while (days.has(cursor.toISOString().slice(0, 10))) {
    count++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return count;
}
