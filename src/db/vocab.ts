import type { Vocab } from '../types';

export type QuizCard = {
  id: string;
  term: string;
  meaning: string;
  choices: string[];
};

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function listVocab(
  db: D1Database,
  userId: string
): Promise<Vocab[]> {
  const { results } = await db
    .prepare(
      `SELECT id, term, meaning, created_at
         FROM vocab
        WHERE user_id = ?
        ORDER BY created_at DESC`
    )
    .bind(userId)
    .all<Vocab>();
  return results;
}

export async function countVocab(
  db: D1Database,
  userId: string
): Promise<{ words: number; meanings: number }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS words, COUNT(DISTINCT meaning) AS meanings
         FROM vocab
        WHERE user_id = ?`
    )
    .bind(userId)
    .first<{ words: number; meanings: number }>();

  return { words: row?.words ?? 0, meanings: row?.meanings ?? 0 };
}

/** 같은 단어가 있으면 뜻만 갱신한다. */
export async function addVocab(
  db: D1Database,
  userId: string,
  term: string,
  meaning: string
): Promise<'created' | 'updated'> {
  const cleanTerm = term.trim().replace(/\s+/g, ' ');
  const cleanMeaning = meaning.trim().replace(/\s+/g, ' ');

  const existing = await db
    .prepare(
      `SELECT id FROM vocab
        WHERE user_id = ? AND lower(term) = lower(?)`
    )
    .bind(userId, cleanTerm)
    .first<{ id: string }>();

  if (existing) {
    await db
      .prepare('UPDATE vocab SET meaning = ? WHERE id = ? AND user_id = ?')
      .bind(cleanMeaning, existing.id, userId)
      .run();
    return 'updated';
  }

  await db
    .prepare(
      `INSERT INTO vocab (id, user_id, term, meaning, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      userId,
      cleanTerm,
      cleanMeaning,
      new Date().toISOString()
    )
    .run();

  return 'created';
}

export async function getVocabById(
  db: D1Database,
  userId: string,
  id: string
): Promise<{ id: string; term: string; meaning: string } | null> {
  return db
    .prepare(
      'SELECT id, term, meaning FROM vocab WHERE id = ? AND user_id = ?'
    )
    .bind(id, userId)
    .first<{ id: string; term: string; meaning: string }>();
}

export async function updateVocab(
  db: D1Database,
  userId: string,
  id: string,
  term: string,
  meaning: string
): Promise<'updated' | 'duplicate' | 'missing'> {
  const cleanTerm = term.trim().replace(/\s+/g, ' ');
  const cleanMeaning = meaning.trim().replace(/\s+/g, ' ');

  const current = await getVocabById(db, userId, id);
  if (!current) return 'missing';

  const conflict = await db
    .prepare(
      `SELECT id FROM vocab
        WHERE user_id = ? AND lower(term) = lower(?) AND id != ?`
    )
    .bind(userId, cleanTerm, id)
    .first<{ id: string }>();

  if (conflict) return 'duplicate';

  await db
    .prepare('UPDATE vocab SET term = ?, meaning = ? WHERE id = ? AND user_id = ?')
    .bind(cleanTerm, cleanMeaning, id, userId)
    .run();

  return 'updated';
}

export async function deleteVocab(
  db: D1Database,
  userId: string,
  id: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM vocab WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * 무작위 단어 한 개와 보기를 만든다.
 * 뜻이 2개 미만이면 null을 반환한다(4지선다가 성립하지 않음).
 */
export async function randomQuizCard(
  db: D1Database,
  userId: string,
  excludeId?: string | null
): Promise<QuizCard | null> {
  const pick = async (exclude: string | null) =>
    db
      .prepare(
        `SELECT id, term, meaning
           FROM vocab
          WHERE user_id = ? ${exclude ? 'AND id != ?' : ''}
          ORDER BY RANDOM()
          LIMIT 1`
      )
      .bind(...(exclude ? [userId, exclude] : [userId]))
      .first<{ id: string; term: string; meaning: string }>();

  const word = (excludeId ? await pick(excludeId) : null) ?? (await pick(null));
  if (!word) return null;

  const { results } = await db
    .prepare(
      `SELECT DISTINCT meaning
         FROM vocab
        WHERE user_id = ? AND meaning != ?
        ORDER BY RANDOM()
        LIMIT 3`
    )
    .bind(userId, word.meaning)
    .all<{ meaning: string }>();

  if (results.length === 0) return null;

  return {
    id: word.id,
    term: word.term,
    meaning: word.meaning,
    choices: shuffle([word.meaning, ...results.map((row) => row.meaning)]),
  };
}
