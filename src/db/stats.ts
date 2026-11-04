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
              SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END) AS correct
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
              SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END) AS correct
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

/**
 * 외운 단어 = 고유 단어 수.
 * 영→한 21일 이상 + 생산형 카드(한→영/빈칸) 1장 이상, 그중 하나가 7일 이상.
 * 생산형 카드가 없으면 아직 Known이 아니다.
 */
export async function learnedCount(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM words w
         JOIN decks d ON d.id = w.deck_id
        WHERE d.user_id = ?
          AND EXISTS (
            SELECT 1 FROM cards r
             WHERE r.word_id = w.id AND r.user_id = ?
               AND r.card_type = 'recognition'
               AND r.state = 'review'
               AND r.scheduled_days >= 21
          )
          AND EXISTS (
            SELECT 1 FROM cards p
             WHERE p.word_id = w.id AND p.user_id = ?
               AND p.card_type IN ('recall','cloze')
               AND p.scheduled_days >= 7
          )`
    )
    .bind(userId, userId, userId)
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
