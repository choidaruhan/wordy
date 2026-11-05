export type MasteryStage = 'new' | 'learning' | 'familiar' | 'known' | 'mastered';

export type MasteryCounts = {
  total: number;
  new: number;
  learning: number;
  familiar: number;
  known: number;
  mastered: number;
};

const STAGES: MasteryStage[] = [
  'new',
  'learning',
  'familiar',
  'known',
  'mastered',
];

export async function getMasteryCounts(
  db: D1Database,
  userId: string
): Promise<MasteryCounts> {
  const { results } = await db
    .prepare(
      `SELECT wm.mastery, COUNT(*) AS n
         FROM word_mastery wm
         JOIN decks d ON d.id = wm.deck_id
        WHERE d.user_id = ?
        GROUP BY wm.mastery`
    )
    .bind(userId)
    .all<{ mastery: string; n: number }>();

  const counts: MasteryCounts = {
    total: 0,
    new: 0,
    learning: 0,
    familiar: 0,
    known: 0,
    mastered: 0,
  };

  for (const row of results) {
    if ((STAGES as string[]).includes(row.mastery)) {
      counts[row.mastery as MasteryStage] = row.n;
      counts.total += row.n;
    }
  }

  return counts;
}

export async function masteredCount(
  db: D1Database,
  userId: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM word_mastery wm
         JOIN decks d ON d.id = wm.deck_id
        WHERE d.user_id = ? AND wm.mastery = 'mastered'`
    )
    .bind(userId)
    .first<{ n: number }>();

  return row?.n ?? 0;
}
